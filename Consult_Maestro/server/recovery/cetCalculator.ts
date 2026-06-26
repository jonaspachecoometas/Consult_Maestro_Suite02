/**
 * cetCalculator.ts — Cálculo de CET (Custo Efetivo Total) e TIR (IRR) para
 * propostas de renegociação no módulo Recovery.
 *
 * Algoritmo:
 *  1. Monta um fluxo de caixa: t=0 entra +valorOriginal (dívida vira "caixa"
 *     do devedor, do ponto de vista do credor é -valorOriginal). Cada parcela
 *     é uma saída em data futura.
 *  2. Resolve a TIR diária (taxa que zera o VPL) por Newton-Raphson, com
 *     fallback para bisseção em caso de divergência.
 *  3. Converte para taxa mensal (composta) e anual.
 *
 * Inspirado nas convenções do BACEN (PR-1.A) — usa dias corridos entre fluxos
 * e composição diária equivalente para mensal/anual.
 */

export type CashFlowEntry = { date: Date; amount: number };

export type ScheduleParams = {
  valorOriginal: number;
  primeiraParcelaData: Date;
  intervaloDias: number; // 30 = mensal
  // Lista explícita de parcelas (valor, na ordem). Ex: [800,800,800,800,800,800,2700,2700,...]
  parcelas: number[];
};

export type CETResult = {
  cetMensal: number; // ex: 0.010559 = 1,0559% a.m.
  cetAnual: number; // ex: 0.1343 = 13,43% a.a.
  cetDiaria: number;
  totalPagoNominal: number;
  totalJurosPagos: number; // total - principal
  // Score de viabilidade simples: 1 quando taxa <= 0; 0 quando >= 5% a.m.
  viabilityScore: number;
  // Convergência (debug)
  iterations: number;
  converged: boolean;
};

const MS_PER_DAY = 86_400_000;

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/** Valor presente líquido para uma taxa diária `rd`. */
function npv(flows: CashFlowEntry[], rd: number, t0: Date): number {
  let sum = 0;
  for (const f of flows) {
    const d = diffDays(f.date, t0);
    sum += f.amount / Math.pow(1 + rd, d);
  }
  return sum;
}

/** Derivada do NPV em relação a `rd`. */
function npvDerivative(flows: CashFlowEntry[], rd: number, t0: Date): number {
  let sum = 0;
  for (const f of flows) {
    const d = diffDays(f.date, t0);
    if (d === 0) continue;
    sum += -d * f.amount / Math.pow(1 + rd, d + 1);
  }
  return sum;
}

/**
 * Resolve a TIR diária pelo método de Newton-Raphson com fallback de bisseção.
 * Retorna a taxa diária equivalente que zera o VPL do fluxo informado.
 */
export function solveIRRDaily(flows: CashFlowEntry[]): { rate: number; iterations: number; converged: boolean } {
  if (flows.length < 2) return { rate: 0, iterations: 0, converged: false };
  const t0 = flows[0].date;
  // Newton-Raphson
  let rd = 0.001; // chute inicial: 0.1% a.d. (~3% a.m.)
  let converged = false;
  let i = 0;
  for (i = 0; i < 80; i++) {
    const f = npv(flows, rd, t0);
    const fp = npvDerivative(flows, rd, t0);
    if (Math.abs(f) < 1e-7) { converged = true; break; }
    if (Math.abs(fp) < 1e-12) break;
    const next = rd - f / fp;
    if (!isFinite(next)) break;
    if (next <= -0.999) { rd = -0.5; continue; } // evita estouro
    if (Math.abs(next - rd) < 1e-10) { rd = next; converged = true; break; }
    rd = next;
  }
  if (converged) return { rate: rd, iterations: i, converged };

  // Fallback bisseção em [-0.5, 1.0] (taxa diária — limite generoso)
  let lo = -0.5;
  let hi = 1.0;
  let fLo = npv(flows, lo, t0);
  let fHi = npv(flows, hi, t0);
  // Se mesma assinatura, expande hi
  let expand = 0;
  while (Math.sign(fLo) === Math.sign(fHi) && expand < 6) {
    hi *= 2;
    fHi = npv(flows, hi, t0);
    expand++;
  }
  if (Math.sign(fLo) === Math.sign(fHi)) {
    return { rate: rd, iterations: i, converged: false };
  }
  let mid = lo;
  let bIters = 0;
  for (bIters = 0; bIters < 200; bIters++) {
    mid = (lo + hi) / 2;
    const fMid = npv(flows, mid, t0);
    if (Math.abs(fMid) < 1e-7 || (hi - lo) < 1e-10) { converged = true; break; }
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; }
    else { hi = mid; }
  }
  return { rate: mid, iterations: i + bIters, converged };
}

/**
 * Constrói o fluxo de caixa a partir do schedule (1 entrada negativa em t=0
 * representando o desembolso do credor + N saídas positivas, do ponto de vista
 * do credor) e calcula CET.
 */
export function calculateCET(params: ScheduleParams): CETResult {
  const { valorOriginal, primeiraParcelaData, intervaloDias, parcelas } = params;
  if (!parcelas?.length || valorOriginal <= 0) {
    return {
      cetDiaria: 0, cetMensal: 0, cetAnual: 0,
      totalPagoNominal: 0, totalJurosPagos: 0, viabilityScore: 0,
      iterations: 0, converged: false,
    };
  }
  // Data-base para o fluxo: 1 dia antes da 1a parcela ou hoje (o que vier antes).
  const today = new Date();
  const t0Date = new Date(primeiraParcelaData.getTime() - intervaloDias * MS_PER_DAY);
  const t0 = t0Date < today ? t0Date : today;

  const flows: CashFlowEntry[] = [{ date: t0, amount: -valorOriginal }];
  let totalPago = 0;
  for (let i = 0; i < parcelas.length; i++) {
    const dueDate = new Date(primeiraParcelaData.getTime() + i * intervaloDias * MS_PER_DAY);
    flows.push({ date: dueDate, amount: parcelas[i] });
    totalPago += parcelas[i];
  }

  const { rate: cetDiaria, iterations, converged } = solveIRRDaily(flows);
  // Composição: (1 + rd)^30 = 1 + rm; (1 + rd)^365 = 1 + ra
  const cetMensal = Math.pow(1 + cetDiaria, 30) - 1;
  const cetAnual = Math.pow(1 + cetDiaria, 365) - 1;

  // Score de viabilidade: linear de 0% a 5% a.m. -> 1.0 a 0.0
  const v = 1 - Math.max(0, Math.min(1, cetMensal / 0.05));

  return {
    cetDiaria,
    cetMensal,
    cetAnual,
    totalPagoNominal: round2(totalPago),
    totalJurosPagos: round2(totalPago - valorOriginal),
    viabilityScore: round4(v),
    iterations,
    converged,
  };
}

/**
 * Helper de alto nível usado pelo serviço de cenários: monta a lista de
 * parcelas a partir dos parâmetros do cenário (incluindo carência e bloco
 * de parcelas reduzidas iniciais).
 */
export function buildScheduleFromScenario(input: {
  valorOriginal: number;
  numParcelas: number;
  intervaloDias: number;
  carenciaMeses: number;
  primeiraParcelaData: Date;
  hasReducedInitial: boolean;
  reducedCount: number;
  reducedAmount: number;
  normalAmount: number;
  // Se hasReducedInitial=false, usa parcelaUnica para todas
  parcelaUnica?: number;
}): ScheduleParams {
  const {
    valorOriginal, numParcelas, intervaloDias, carenciaMeses,
    primeiraParcelaData, hasReducedInitial, reducedCount, reducedAmount,
    normalAmount, parcelaUnica,
  } = input;

  const startDate = new Date(primeiraParcelaData.getTime() + carenciaMeses * 30 * MS_PER_DAY);

  const parcelas: number[] = [];
  if (hasReducedInitial && reducedCount > 0) {
    for (let i = 0; i < reducedCount; i++) parcelas.push(reducedAmount);
    for (let i = 0; i < (numParcelas - reducedCount); i++) parcelas.push(normalAmount);
  } else {
    const v = parcelaUnica ?? normalAmount;
    for (let i = 0; i < numParcelas; i++) parcelas.push(v);
  }
  return { valorOriginal, primeiraParcelaData: startDate, intervaloDias, parcelas };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
