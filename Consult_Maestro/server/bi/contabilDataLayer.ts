/**
 * server/bi/contabilDataLayer.ts
 *
 * Camada de dados contábil unificada — porta única de entrada do módulo
 * Contábil. Decide automaticamente de onde ler (ERPNext > Atlas > Control
 * nativo > HR nativo) e normaliza tudo em DTOs.
 *
 * O módulo Contábil é uma CAMADA ACIMA do Control, nunca um substituto:
 * Control segue operacional; Contábil consolida quando houver mais fontes.
 *
 * Toda métrica/agent que precise de dados financeiros DEVE passar por aqui
 * — nunca acessar diretamente lancamentos_financeiros, analytics.atlas_*
 * ou ERPNext. Para homologar um novo ERP, basta adicionar um resolver.
 *
 * Segurança:
 * - tenantId / clienteId passam por `quoteIdent` (anti-SQLi).
 * - Datas passam por `quoteIsoDate`.
 * - ERPNext usa o `FrappeClient` (com SSRF guard).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getFrappeClientForTenant } from "../frappeClient";
import { quoteIdent, quoteIsoDate } from "./semantic/sqlHelpers";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type DataSource =
  | "control" | "hr" | "societario" | "recovery"
  | "erpnext" | "atlas" | "omie" | "dominio";

export interface ContabilLancamento {
  id: string;
  data: string;            // YYYY-MM-DD
  descricao: string;
  valor: number;           // positivo = receita, negativo = despesa
  tipo: "receita" | "despesa" | "transferencia";
  categoria: string;
  centroCusto?: string;
  status: "pago" | "pendente" | "vencido" | "extornado";
  source: DataSource;
  clienteId?: string;
}

export interface ContabilFolha {
  mes: string;             // YYYY-MM
  funcionarioId: string;
  funcionarioNome: string;
  departamento: string;
  salarioBruto: number;
  inss: number;
  irrf: number;
  fgts: number;
  salarioLiquido: number;
  source: DataSource;
}

export interface ContabilResumoMes {
  mes: string;
  receita: number;
  despesa: number;
  resultado: number;
  impostos: number;
  folha: number;
  source: DataSource[];
}

export interface ContabilDataOptions {
  tenantId: string;
  clienteId?: string;
  startDate?: string;      // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD
  limit?: number;
}

export interface TenantDataSources {
  hasErpNext: boolean;
  hasAtlas: boolean;
  hasControl: boolean;
  hasHr: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Source detection
// ────────────────────────────────────────────────────────────────────────────

export async function detectTenantSources(tenantId: string): Promise<TenantDataSources> {
  const tId = quoteIdent(tenantId);

  let hasErpNext = false;
  try {
    const r = (await db.execute(sql.raw(
      `SELECT 1 FROM tenants
        WHERE id = ${tId}
          AND frappe_url IS NOT NULL AND frappe_url <> ''
        LIMIT 1`,
    ))) as any;
    hasErpNext = (r.rows?.length ?? 0) > 0;
  } catch (err) {
    console.warn("[contabil-data] detect erpnext:", (err as Error).message.slice(0, 120));
  }

  let hasAtlas = false;
  try {
    // Detecta Atlas se: (a) fonte ativa com last_sync_at, OU (b) já há dados
    // staging em atlas_pagar_recebers (cobre dumps importados antes da
    // coluna last_sync_at ter sido populada).
    const r = (await db.execute(sql.raw(
      `SELECT 1 FROM analytics.atlas_data_sources
        WHERE arcadia_tenant_id = ${tId}
          AND is_active = 1
          AND last_sync_at IS NOT NULL
       UNION ALL
       SELECT 1 FROM analytics.atlas_pagar_recebers
        WHERE arcadia_tenant_id = ${tId}
        LIMIT 1`,
    ))) as any;
    hasAtlas = (r.rows?.length ?? 0) > 0;
  } catch (err) {
    console.warn("[contabil-data] detect atlas:", (err as Error).message.slice(0, 120));
  }

  let hasControl = false;
  try {
    const r = (await db.execute(sql.raw(
      `SELECT 1 FROM lancamentos_financeiros WHERE tenant_id = ${tId} LIMIT 1`,
    ))) as any;
    hasControl = (r.rows?.length ?? 0) > 0;
  } catch (err) {
    console.warn("[contabil-data] detect control:", (err as Error).message.slice(0, 120));
  }

  let hasHr = false;
  try {
    const r = (await db.execute(sql.raw(
      `SELECT 1 FROM hr_payroll_entries WHERE tenant_id = ${tId} LIMIT 1`,
    ))) as any;
    hasHr = (r.rows?.length ?? 0) > 0;
  } catch (err) {
    console.warn("[contabil-data] detect hr:", (err as Error).message.slice(0, 120));
  }

  return { hasErpNext, hasAtlas, hasControl, hasHr };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampLimit(limit?: number, fallback = 1000, max = 5000): number {
  const n = Number(limit ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function ensureTenant(opts: ContabilDataOptions) {
  if (!opts.tenantId) {
    throw new Error("[contabil-data] tenantId é obrigatório");
  }
}

function fmtDate(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Lançamentos financeiros — multi-source
// ────────────────────────────────────────────────────────────────────────────

export async function getLancamentos(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  ensureTenant(opts);
  const sources = await detectTenantSources(opts.tenantId);
  const results: ContabilLancamento[] = [];

  // Prioridade: ERPNext > Atlas > Control. Fallback se anterior vazio/falhar.
  if (sources.hasErpNext) {
    try {
      const erp = await getLancamentosErpNext(opts);
      results.push(...erp);
    } catch (err) {
      console.warn("[contabil-data] ERPNext falhou, usando fallback:",
        (err as Error).message.slice(0, 120));
    }
  }

  if (sources.hasAtlas && results.length === 0) {
    try {
      results.push(...(await getLancamentosAtlas(opts)));
    } catch (err) {
      console.warn("[contabil-data] Atlas falhou:",
        (err as Error).message.slice(0, 120));
    }
  }

  if (sources.hasControl && results.length === 0) {
    try {
      results.push(...(await getLancamentosControl(opts)));
    } catch (err) {
      console.warn("[contabil-data] Control falhou:",
        (err as Error).message.slice(0, 120));
    }
  }

  return results;
}

// ── ERPNext: GL Entry ──────────────────────────────────────────────────────
async function getLancamentosErpNext(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  const filters: any[] = [
    ["posting_date", "between", [opts.startDate ?? "2024-01-01", opts.endDate ?? todayIso()]],
  ];
  if (opts.clienteId) filters.push(["party", "=", opts.clienteId]);

  const entries = await client.getList<any>("GL Entry", {
    fields: ["name", "posting_date", "account", "debit", "credit",
             "voucher_type", "voucher_no", "remarks", "cost_center",
             "party", "is_cancelled"],
    filters,
    limit: clampLimit(opts.limit),
    orderBy: "posting_date desc",
  });

  return entries
    .filter(e => !e.is_cancelled)
    .map(e => {
      const credit = Number(e.credit ?? 0);
      const debit = Number(e.debit ?? 0);
      const isReceita = credit > 0;
      return {
        id: `erpnext-gl-${e.name}`,
        data: fmtDate(e.posting_date),
        descricao: e.remarks || e.voucher_type || "GL Entry",
        valor: isReceita ? credit : -debit,
        tipo: isReceita ? ("receita" as const) : ("despesa" as const),
        categoria: e.account ?? "Sem categoria",
        centroCusto: e.cost_center ?? undefined,
        status: "pago" as const,
        source: "erpnext" as const,
        clienteId: e.party ?? undefined,
      };
    });
}

// ── Atlas: analytics.atlas_pagar_recebers ──────────────────────────────────
// Schema real (sem JOIN analytics.atlas_categoria_conta — tabela não existe).
// `tipo` = 'C' | 'R' (crédito/receber) → receita; demais → despesa.
async function getLancamentosAtlas(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const where: string[] = [
    `arcadia_tenant_id = ${quoteIdent(opts.tenantId)}`,
    "ativo = true",
    "extornado = false",
  ];
  if (opts.startDate) where.push(`COALESCE(data_competencia, data_vencimento) >= ${quoteIsoDate(opts.startDate)}::timestamp`);
  if (opts.endDate)   where.push(`COALESCE(data_competencia, data_vencimento) <= ${quoteIsoDate(opts.endDate)}::timestamp`);

  const r = (await db.execute(sql.raw(
    `SELECT id, tipo, descricao,
            COALESCE(data_competencia, data_vencimento) AS data,
            valor, pago, data_vencimento, data_pagamento
       FROM analytics.atlas_pagar_recebers
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(data_competencia, data_vencimento) DESC
      LIMIT ${clampLimit(opts.limit)}`,
  ))) as any;

  return (r.rows ?? []).map((row: any) => {
    const t = String(row.tipo ?? "").toUpperCase();
    const isReceita = t === "C" || t === "R";
    const valor = Number(row.valor ?? 0);
    const vencido = !row.pago && row.data_vencimento
      && new Date(row.data_vencimento) < new Date();
    return {
      id: `atlas-pr-${row.id}`,
      data: fmtDate(row.data),
      descricao: row.descricao || "Atlas",
      valor: isReceita ? valor : -Math.abs(valor),
      tipo: isReceita ? ("receita" as const) : ("despesa" as const),
      categoria: isReceita ? "Receber" : "Pagar",
      status: row.pago ? ("pago" as const)
            : vencido ? ("vencido" as const)
            : ("pendente" as const),
      source: "atlas" as const,
    };
  });
}

// ── Control nativo: lancamentos_financeiros ────────────────────────────────
// Schema real: tipo = 'pagar' | 'receber'; status = 'previsto'|'aprovado'|
// 'pago'|'vencido'|'cancelado'|'inadimplente'; plano_contas.descricao;
// centros_custo.nome.
async function getLancamentosControl(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const where: string[] = [`lf.tenant_id = ${quoteIdent(opts.tenantId)}`];
  if (opts.clienteId) where.push(`lf.cliente_id = ${quoteIdent(opts.clienteId)}`);
  if (opts.startDate) where.push(`lf.data_vencimento >= ${quoteIsoDate(opts.startDate)}`);
  if (opts.endDate)   where.push(`lf.data_vencimento <= ${quoteIsoDate(opts.endDate)}`);

  const r = (await db.execute(sql.raw(
    `SELECT lf.id, lf.tipo, lf.descricao, lf.cliente_id,
            COALESCE(lf.data_pagamento, lf.data_vencimento) AS data,
            lf.valor, lf.status,
            pc.descricao AS categoria,
            cc.nome AS centro_custo
       FROM lancamentos_financeiros lf
       LEFT JOIN planos_contas pc ON pc.id = lf.plano_conta_id
       LEFT JOIN centros_custo cc ON cc.id = lf.centro_custo_id
      WHERE ${where.join(" AND ")}
      ORDER BY lf.data_vencimento DESC
      LIMIT ${clampLimit(opts.limit)}`,
  ))) as any;

  return (r.rows ?? []).map((row: any) => {
    const isReceita = row.tipo === "receber";
    const valor = Number(row.valor ?? 0);
    const rawStatus = String(row.status ?? "previsto");
    // Normaliza status para o vocabulário ContabilLancamento.
    const status: ContabilLancamento["status"] =
      rawStatus === "pago" ? "pago"
      : rawStatus === "vencido" || rawStatus === "inadimplente" ? "vencido"
      : rawStatus === "cancelado" ? "extornado"
      : "pendente";
    return {
      id: `control-${row.id}`,
      data: fmtDate(row.data),
      descricao: row.descricao || "Control",
      valor: isReceita ? valor : -Math.abs(valor),
      tipo: isReceita ? ("receita" as const) : ("despesa" as const),
      categoria: row.categoria || "Sem categoria",
      centroCusto: row.centro_custo ?? undefined,
      status,
      source: "control" as const,
      clienteId: row.cliente_id ?? undefined,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Folha de pagamento — multi-source
// ────────────────────────────────────────────────────────────────────────────

export async function getFolha(opts: ContabilDataOptions): Promise<ContabilFolha[]> {
  ensureTenant(opts);
  const sources = await detectTenantSources(opts.tenantId);

  if (sources.hasErpNext) {
    try {
      return await getFolhaErpNext(opts);
    } catch (err) {
      console.warn("[contabil-data] ERPNext folha falhou, usando HR:",
        (err as Error).message.slice(0, 120));
    }
  }
  if (sources.hasHr) {
    return await getFolhaControl(opts);
  }
  return [];
}

// ── ERPNext: Salary Slip ───────────────────────────────────────────────────
async function getFolhaErpNext(opts: ContabilDataOptions): Promise<ContabilFolha[]> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  const slips = await client.getList<any>("Salary Slip", {
    fields: ["name", "posting_date", "employee", "employee_name", "department",
             "gross_pay", "total_deduction", "net_pay",
             "total_employer_pf_contribution", "total_employer_tax_contribution"],
    filters: [
      ["posting_date", "between", [opts.startDate ?? "2024-01-01", opts.endDate ?? todayIso()]],
      ["docstatus", "=", 1],
    ],
    limit: clampLimit(opts.limit, 500, 2000),
  });

  return slips.map((s: any) => ({
    mes: fmtDate(s.posting_date).slice(0, 7),
    funcionarioId: s.employee,
    funcionarioNome: s.employee_name || s.employee,
    departamento: s.department || "Sem departamento",
    salarioBruto: Number(s.gross_pay ?? 0),
    inss: Number(s.total_employer_pf_contribution ?? 0),
    irrf: Number(s.total_employer_tax_contribution ?? 0),
    fgts: Number(s.gross_pay ?? 0) * 0.08,
    salarioLiquido: Number(s.net_pay ?? 0),
    source: "erpnext" as const,
  }));
}

// ── HR nativo: hr_payroll_entries + periods + employees + departments ──────
async function getFolhaControl(opts: ContabilDataOptions): Promise<ContabilFolha[]> {
  const where: string[] = [`pe.tenant_id = ${quoteIdent(opts.tenantId)}`];
  if (opts.clienteId) where.push(`pp.cliente_id = ${quoteIdent(opts.clienteId)}`);
  // Defense-in-depth: valida via quoteIsoDate antes de derivar YYYY-MM.
  if (opts.startDate) {
    const v = quoteIsoDate(opts.startDate); // 'YYYY-MM-DD'
    where.push(`pp.competence >= '${v.slice(1, 8)}'`);
  }
  if (opts.endDate) {
    const v = quoteIsoDate(opts.endDate);
    where.push(`pp.competence <= '${v.slice(1, 8)}'`);
  }

  const r = (await db.execute(sql.raw(
    `SELECT pe.id, pe.employee_id, pe.department_id,
            pp.competence AS mes,
            pe.total_gross AS salario_bruto,
            pe.inss_value AS inss,
            pe.irrf_value AS irrf,
            pe.fgts_value AS fgts,
            pe.net_salary AS salario_liquido,
            e.full_name AS funcionario_nome,
            d.nome AS departamento_nome
       FROM hr_payroll_entries pe
       JOIN hr_payroll_periods pp ON pp.id = pe.period_id
       LEFT JOIN hr_employees e ON e.id = pe.employee_id
       LEFT JOIN hr_departments d ON d.id = pe.department_id
      WHERE ${where.join(" AND ")}
      ORDER BY pp.competence DESC
      LIMIT ${clampLimit(opts.limit, 500, 2000)}`,
  ))) as any;

  return (r.rows ?? []).map((row: any) => ({
    mes: String(row.mes ?? "").slice(0, 7),
    funcionarioId: row.employee_id,
    funcionarioNome: row.funcionario_nome || row.employee_id,
    departamento: row.departamento_nome || "Sem departamento",
    salarioBruto: Number(row.salario_bruto ?? 0),
    inss: Number(row.inss ?? 0),
    irrf: Number(row.irrf ?? 0),
    fgts: Number(row.fgts ?? 0),
    salarioLiquido: Number(row.salario_liquido ?? 0),
    source: "hr" as const,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Resumo mensal consolidado
// ────────────────────────────────────────────────────────────────────────────

export async function getResumoMensal(opts: ContabilDataOptions): Promise<ContabilResumoMes[]> {
  ensureTenant(opts);
  const [lancamentos, folha] = await Promise.all([
    getLancamentos(opts),
    getFolha(opts),
  ]);

  const mesesMap = new Map<string, ContabilResumoMes>();
  const ensureMes = (mes: string): ContabilResumoMes => {
    let r = mesesMap.get(mes);
    if (!r) {
      r = { mes, receita: 0, despesa: 0, resultado: 0, impostos: 0, folha: 0, source: [] };
      mesesMap.set(mes, r);
    }
    return r;
  };

  for (const l of lancamentos) {
    const mes = l.data.slice(0, 7);
    if (!mes) continue;
    const r = ensureMes(mes);
    if (l.valor > 0) r.receita += l.valor;
    else r.despesa += Math.abs(l.valor);
    if (/das|darf|gps|inss|irpj|csll|pis|cofins|icms|iss|fgts/i.test(l.categoria)) {
      r.impostos += Math.abs(l.valor);
    }
    if (!r.source.includes(l.source)) r.source.push(l.source);
  }

  for (const f of folha) {
    if (!f.mes) continue;
    const r = ensureMes(f.mes);
    r.folha += f.salarioBruto + f.inss + f.fgts;
    if (!r.source.includes(f.source)) r.source.push(f.source);
  }

  for (const r of mesesMap.values()) {
    r.resultado = r.receita - r.despesa;
  }

  return Array.from(mesesMap.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Status das fontes para a UI de configuração
// ────────────────────────────────────────────────────────────────────────────

export async function getContabilDataSourceStatus(tenantId: string): Promise<{
  sources: Array<{
    id: DataSource;
    label: string;
    status: "ok" | "empty" | "not_configured";
    description: string;
  }>;
}> {
  const detected = await detectTenantSources(tenantId);
  return {
    sources: [
      { id: "erpnext", label: "ERPNext / Frappe",
        status: detected.hasErpNext ? "ok" : "not_configured",
        description: detected.hasErpNext
          ? "GL Entry, Journal Entry, Salary Slip"
          : "Configure a URL do Frappe em Configurações → Integrações" },
      { id: "atlas", label: "Atlas ERP",
        status: detected.hasAtlas ? "ok" : "not_configured",
        description: detected.hasAtlas
          ? "Dados importados via DatasetAtlas (pagar_recebers, pedidos)"
          : "Importe um dump do Atlas em Datasets → Atlas" },
      { id: "control", label: "Arcádia Control",
        status: detected.hasControl ? "ok" : "empty",
        description: detected.hasControl
          ? "Lançamentos financeiros do módulo Control"
          : "Nenhum lançamento cadastrado no Control ainda" },
      { id: "hr", label: "Arcádia HR",
        status: detected.hasHr ? "ok" : "empty",
        description: detected.hasHr
          ? "Folha de pagamento do módulo HR"
          : "Nenhuma folha processada no HR ainda" },
    ],
  };
}

// TODO: Resolvers para Omie e Domínio Sistemas (REST API).
