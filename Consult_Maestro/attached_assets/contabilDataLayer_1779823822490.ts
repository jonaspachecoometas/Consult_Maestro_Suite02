/**
 * server/bi/contabilDataLayer.ts
 *
 * Camada de dados contábil unificada — resolve de onde ler os dados:
 *
 *  1. Control nativo (lancamentos_financeiros, lancamentos_contabeis)
 *  2. HR nativo (hr_payroll_entries, hr_employees)
 *  3. Societário nativo (processos_societarios)
 *  4. Recovery nativo (recovery_installments)
 *  5. ERPNext/Frappe (via FrappeClient — GL Entry, Journal Entry, Payment Entry, Salary Slip)
 *  6. Atlas ERP (analytics.atlas_pagar_recebers — já populado via dump/live)
 *  7. Omie (futuro — REST API)
 *  8. Domínio Sistemas (futuro — REST API)
 *
 * O módulo semântico "contabil" chama SEMPRE esta camada, nunca acessa
 * as tabelas diretamente. Isso garante que ao homologar um novo ERP,
 * basta implementar um novo resolver aqui.
 *
 * Fontes disponíveis por tenant (resolvidas em ordem de prioridade):
 *   - se tenant tem frappeUrl configurado → lê do ERPNext primeiro
 *   - se tenant tem atlas_data_source ativo → lê do Atlas staging
 *   - fallback → lê dos módulos nativos do Arcádia
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getFrappeClientForTenant, FrappeError } from "../frappeClient";
import type { Pool } from "pg";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type DataSource = "control" | "hr" | "societario" | "recovery" | "erpnext" | "atlas" | "omie" | "dominio";

export interface ContabilLancamento {
  id: string;
  data: string;           // YYYY-MM-DD
  descricao: string;
  valor: number;          // positivo = receita, negativo = despesa
  tipo: "receita" | "despesa" | "transferencia";
  categoria: string;
  centroCusto?: string;
  status: "pago" | "pendente" | "vencido" | "extornado";
  source: DataSource;
  clienteId?: string;
}

export interface ContabilFolha {
  mes: string;            // YYYY-MM
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
  startDate?: string;
  endDate?: string;
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Source detection
// ────────────────────────────────────────────────────────────────────────────

interface TenantDataSources {
  hasErpNext: boolean;
  hasAtlas: boolean;
  hasControl: boolean;
  hasHr: boolean;
}

export async function detectTenantSources(tenantId: string): Promise<TenantDataSources> {
  // Check ERPNext
  let hasErpNext = false;
  try {
    const result = await db.execute(sql.raw(`
      SELECT frappe_url FROM tenants
      WHERE id = '${tenantId}' AND frappe_url IS NOT NULL AND frappe_url != ''
      LIMIT 1
    `)) as any;
    hasErpNext = (result.rows?.length ?? 0) > 0;
  } catch { /* no frappe */ }

  // Check Atlas staging data
  let hasAtlas = false;
  try {
    const result = await db.execute(sql.raw(`
      SELECT 1 FROM analytics.atlas_data_sources
      WHERE arcadia_tenant_id = '${tenantId}' AND is_active = 1 AND last_sync_at IS NOT NULL
      LIMIT 1
    `)) as any;
    hasAtlas = (result.rows?.length ?? 0) > 0;
  } catch { /* no atlas tables */ }

  // Check Control data
  let hasControl = false;
  try {
    const result = await db.execute(sql.raw(`
      SELECT 1 FROM lancamentos_financeiros
      WHERE tenant_id = '${tenantId}' LIMIT 1
    `)) as any;
    hasControl = (result.rows?.length ?? 0) > 0;
  } catch { /* no data */ }

  // Check HR data
  let hasHr = false;
  try {
    const result = await db.execute(sql.raw(`
      SELECT 1 FROM hr_payroll_entries
      WHERE tenant_id = '${tenantId}' LIMIT 1
    `)) as any;
    hasHr = (result.rows?.length ?? 0) > 0;
  } catch { /* no data */ }

  return { hasErpNext, hasAtlas, hasControl, hasHr };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Lançamentos financeiros — multi-source
// ────────────────────────────────────────────────────────────────────────────

export async function getLancamentos(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const sources = await detectTenantSources(opts.tenantId);
  const results: ContabilLancamento[] = [];

  // Priority: ERPNext > Atlas > Control nativo
  if (sources.hasErpNext) {
    try {
      const erpnext = await getLancamentosErpNext(opts);
      results.push(...erpnext);
    } catch (err) {
      console.warn("[contabil-data] ERPNext falhou, usando fallback:", (err as Error).message.slice(0, 100));
    }
  }

  if (sources.hasAtlas && results.length === 0) {
    const atlas = await getLancamentosAtlas(opts);
    results.push(...atlas);
  }

  if (sources.hasControl && results.length === 0) {
    const control = await getLancamentosControl(opts);
    results.push(...control);
  }

  return results;
}

// ── ERPNext: GL Entry + Payment Entry ──────────────────────────────────────
async function getLancamentosErpNext(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  const filters: any[] = [["posting_date", "between", [opts.startDate ?? "2024-01-01", opts.endDate ?? new Date().toISOString().slice(0, 10)]]];
  if (opts.clienteId) {
    filters.push(["party", "=", opts.clienteId]);
  }

  const entries = await client.getList<any>("GL Entry", {
    fields: ["name", "posting_date", "account", "debit", "credit", "voucher_type",
             "voucher_no", "remarks", "cost_center", "party", "is_cancelled"],
    filters,
    limit: opts.limit ?? 1000,
    orderBy: "posting_date desc",
  });

  return entries
    .filter(e => !e.is_cancelled)
    .map(e => ({
      id: `erpnext-gl-${e.name}`,
      data: e.posting_date,
      descricao: e.remarks || e.voucher_type || "GL Entry",
      valor: e.credit > 0 ? e.credit : -e.debit,
      tipo: e.credit > 0 ? "receita" as const : "despesa" as const,
      categoria: e.account,
      centroCusto: e.cost_center,
      status: "pago" as const,
      source: "erpnext" as const,
      clienteId: e.party,
    }));
}

// ── Atlas: pagar_recebers ──────────────────────────────────────────────────
async function getLancamentosAtlas(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const where: string[] = [`arcadia_tenant_id = '${opts.tenantId}'`, "ativo = true", "extornado = false"];
  if (opts.startDate) where.push(`data_competencia >= '${opts.startDate}'`);
  if (opts.endDate) where.push(`data_competencia <= '${opts.endDate}'`);
  if (opts.clienteId) where.push(`pessoa_id::text = '${opts.clienteId}'`);

  const result = await db.execute(sql.raw(`
    SELECT pr.id, pr.tipo, pr.descricao,
           COALESCE(pr.data_competencia, pr.data_vencimento) AS data,
           pr.valor, pr.pago, pr.data_vencimento,
           pr.data_pagamento, cc.nome AS categoria
      FROM analytics.atlas_pagar_recebers pr
      LEFT JOIN analytics.atlas_categoria_conta cc
             ON cc.id = pr.categoria_conta_id AND cc.arcadia_tenant_id = pr.arcadia_tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY data DESC
     LIMIT ${opts.limit ?? 1000}
  `)) as any;

  return (result.rows ?? []).map((r: any) => ({
    id: `atlas-pr-${r.id}`,
    data: r.data?.toISOString?.().slice(0, 10) ?? r.data,
    descricao: r.descricao || "Atlas",
    valor: r.tipo === "C" || r.tipo === "R" ? Number(r.valor) : -Math.abs(Number(r.valor)),
    tipo: r.tipo === "C" || r.tipo === "R" ? "receita" as const : "despesa" as const,
    categoria: r.categoria || "Sem categoria",
    status: r.pago ? "pago" as const
      : r.data_vencimento && new Date(r.data_vencimento) < new Date() ? "vencido" as const
      : "pendente" as const,
    source: "atlas" as const,
  }));
}

// ── Control nativo: lancamentos_financeiros ────────────────────────────────
async function getLancamentosControl(opts: ContabilDataOptions): Promise<ContabilLancamento[]> {
  const where: string[] = [`lf.tenant_id = '${opts.tenantId}'`];
  if (opts.startDate) where.push(`lf.data_vencimento >= '${opts.startDate}'`);
  if (opts.endDate) where.push(`lf.data_vencimento <= '${opts.endDate}'`);
  if (opts.clienteId) where.push(`lf.cliente_id = '${opts.clienteId}'`);

  const result = await db.execute(sql.raw(`
    SELECT lf.id, lf.tipo, lf.descricao,
           lf.data_vencimento AS data, lf.valor, lf.status,
           lf.data_pagamento, lf.plano_conta_id,
           pc.nome AS categoria, cc.nome AS centro_custo
      FROM lancamentos_financeiros lf
      LEFT JOIN plano_contas pc ON pc.id = lf.plano_conta_id
      LEFT JOIN centros_custo cc ON cc.id = lf.centro_custo_id
     WHERE ${where.join(" AND ")}
     ORDER BY lf.data_vencimento DESC
     LIMIT ${opts.limit ?? 1000}
  `)) as any;

  return (result.rows ?? []).map((r: any) => ({
    id: `control-${r.id}`,
    data: r.data?.toISOString?.().slice(0, 10) ?? String(r.data),
    descricao: r.descricao || "Control",
    valor: r.tipo === "receita" ? Number(r.valor) : -Math.abs(Number(r.valor)),
    tipo: r.tipo as "receita" | "despesa",
    categoria: r.categoria || "Sem categoria",
    centroCusto: r.centro_custo,
    status: r.status || "pendente",
    source: "control" as const,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Folha de pagamento — multi-source
// ────────────────────────────────────────────────────────────────────────────

export async function getFolha(opts: ContabilDataOptions): Promise<ContabilFolha[]> {
  const sources = await detectTenantSources(opts.tenantId);

  if (sources.hasErpNext) {
    try { return await getFolhaErpNext(opts); } catch {}
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
    fields: ["name","posting_date","employee","employee_name","department",
             "gross_pay","total_deduction","net_pay",
             "total_employer_pf_contribution","total_employer_tax_contribution"],
    filters: [
      ["posting_date", "between", [opts.startDate ?? "2024-01-01", opts.endDate ?? new Date().toISOString().slice(0, 10)]],
      ["docstatus", "=", 1],
    ],
    limit: opts.limit ?? 500,
  });

  return slips.map(s => ({
    mes: s.posting_date?.slice(0, 7) ?? "",
    funcionarioId: s.employee,
    funcionarioNome: s.employee_name,
    departamento: s.department || "Sem departamento",
    salarioBruto: Number(s.gross_pay ?? 0),
    inss: Number(s.total_employer_pf_contribution ?? 0),
    irrf: Number(s.total_employer_tax_contribution ?? 0),
    fgts: Number(s.gross_pay ?? 0) * 0.08,
    salarioLiquido: Number(s.net_pay ?? 0),
    source: "erpnext" as const,
  }));
}

// ── HR nativo: hr_payroll_entries ──────────────────────────────────────────
async function getFolhaControl(opts: ContabilDataOptions): Promise<ContabilFolha[]> {
  const result = await db.execute(sql.raw(`
    SELECT pe.id, pe.employee_id, pe.department_id,
           pp.reference_month AS mes,
           pe.total_gross AS salario_bruto,
           pe.inss_value AS inss,
           pe.irrf_value AS irrf,
           pe.fgts_value AS fgts,
           pe.net_salary AS salario_liquido,
           e.full_name AS funcionario_nome,
           d.name AS departamento_nome
      FROM hr_payroll_entries pe
      JOIN hr_payroll_periods pp ON pp.id = pe.period_id
      LEFT JOIN hr_employees e ON e.id = pe.employee_id
      LEFT JOIN hr_departments d ON d.id = pe.department_id
     WHERE pe.tenant_id = '${opts.tenantId}'
       ${opts.startDate ? `AND pp.reference_month >= '${opts.startDate}'` : ""}
       ${opts.endDate ? `AND pp.reference_month <= '${opts.endDate}'` : ""}
     ORDER BY pp.reference_month DESC
     LIMIT ${opts.limit ?? 500}
  `)) as any;

  return (result.rows ?? []).map((r: any) => ({
    mes: r.mes?.toISOString?.().slice(0, 7) ?? String(r.mes).slice(0, 7),
    funcionarioId: r.employee_id,
    funcionarioNome: r.funcionario_nome || r.employee_id,
    departamento: r.departamento_nome || "Sem departamento",
    salarioBruto: Number(r.salario_bruto ?? 0),
    inss: Number(r.inss ?? 0),
    irrf: Number(r.irrf ?? 0),
    fgts: Number(r.fgts ?? 0),
    salarioLiquido: Number(r.salario_liquido ?? 0),
    source: "hr" as const,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Resumo mensal consolidado
// ────────────────────────────────────────────────────────────────────────────

export async function getResumoMensal(opts: ContabilDataOptions): Promise<ContabilResumoMes[]> {
  const [lancamentos, folha] = await Promise.all([
    getLancamentos(opts),
    getFolha(opts),
  ]);

  const mesesMap = new Map<string, ContabilResumoMes>();

  for (const l of lancamentos) {
    const mes = l.data.slice(0, 7);
    if (!mesesMap.has(mes)) {
      mesesMap.set(mes, { mes, receita: 0, despesa: 0, resultado: 0, impostos: 0, folha: 0, source: [] });
    }
    const r = mesesMap.get(mes)!;
    if (l.valor > 0) r.receita += l.valor;
    else r.despesa += Math.abs(l.valor);

    const isImposto = /das|darf|gps|inss|irpj|csll|pis|cofins|icms|iss|fgts/i.test(l.categoria);
    if (isImposto) r.impostos += Math.abs(l.valor);

    if (!r.source.includes(l.source)) r.source.push(l.source);
  }

  for (const f of folha) {
    if (!mesesMap.has(f.mes)) {
      mesesMap.set(f.mes, { mes: f.mes, receita: 0, despesa: 0, resultado: 0, impostos: 0, folha: 0, source: [] });
    }
    const r = mesesMap.get(f.mes)!;
    r.folha += f.salarioBruto + f.inss + f.fgts;
    if (!r.source.includes(f.source)) r.source.push(f.source);
  }

  for (const r of mesesMap.values()) {
    r.resultado = r.receita - r.despesa;
  }

  return Array.from(mesesMap.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Societário — processos ativos
// ────────────────────────────────────────────────────────────────────────────

export async function getProcessosSocietarios(opts: ContabilDataOptions): Promise<any[]> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT ps.id, ps.process_number, ps.tipo_processo, ps.subtipo,
             ps.titulo, ps.coluna_atual AS fase, ps.status, ps.prioridade,
             ps.data_solicitacao, ps.data_prevista_conclusao
        FROM processos_societarios ps
       WHERE ps.tenant_id = '${opts.tenantId}'
         AND ps.status NOT IN ('concluido','cancelado')
       ORDER BY ps.data_solicitacao DESC
       LIMIT ${opts.limit ?? 100}
    `)) as any;
    return result.rows ?? [];
  } catch { return []; }
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Recovery — parcelas e credores
// ────────────────────────────────────────────────────────────────────────────

export async function getRecoveryResumo(opts: ContabilDataOptions): Promise<{
  totalDivida: number;
  parcelasPagas: number;
  parcelasPendentes: number;
  parcelasAtrasadas: number;
  percentualRecuperado: number;
}> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        SUM(ri.valor) AS total_divida,
        SUM(CASE WHEN ri.status = 'pago' THEN ri.valor ELSE 0 END) AS pagas,
        SUM(CASE WHEN ri.status = 'pendente' AND ri.due_date >= CURRENT_DATE THEN ri.valor ELSE 0 END) AS pendentes,
        SUM(CASE WHEN ri.status != 'pago' AND ri.due_date < CURRENT_DATE THEN ri.valor ELSE 0 END) AS atrasadas
        FROM recovery_installments ri
        JOIN recovery_processes rp ON rp.id = ri.process_id
       WHERE rp.tenant_id = '${opts.tenantId}'
    `)) as any;

    const r = result.rows?.[0] ?? {};
    const total = Number(r.total_divida ?? 0);
    const pagas = Number(r.pagas ?? 0);

    return {
      totalDivida: total,
      parcelasPagas: pagas,
      parcelasPendentes: Number(r.pendentes ?? 0),
      parcelasAtrasadas: Number(r.atrasadas ?? 0),
      percentualRecuperado: total > 0 ? Math.round((pagas / total) * 100) : 0,
    };
  } catch {
    return { totalDivida: 0, parcelasPagas: 0, parcelasPendentes: 0, parcelasAtrasadas: 0, percentualRecuperado: 0 };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. ERPNext — skills específicas para gerar contabilidade
// ────────────────────────────────────────────────────────────────────────────

/**
 * Gera o DRE a partir do ERPNext usando as skills do ERPNext:
 * - Income Account → Receita
 * - Expense Account → Despesa
 * - Profit and Loss via get_balance_on
 */
export async function getDreFromErpNext(opts: ContabilDataOptions): Promise<{
  linhas: { conta: string; tipo: "receita" | "despesa"; valor: number }[];
  receita_total: number;
  despesa_total: number;
  resultado: number;
}> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  // Use ERPNext's built-in P&L report
  const report = await client.rpc("frappe.desk.reportview.run", {
    report_name: "Profit and Loss Statement",
    filters: {
      company: opts.clienteId ?? "",
      from_date: opts.startDate ?? `${new Date().getFullYear()}-01-01`,
      to_date: opts.endDate ?? new Date().toISOString().slice(0, 10),
      accumulated_values: 1,
    },
  });

  // Parse ERPNext P&L response
  const linhas: { conta: string; tipo: "receita" | "despesa"; valor: number }[] = [];
  let receita_total = 0;
  let despesa_total = 0;

  for (const row of report?.result ?? []) {
    if (!row.account) continue;
    const valor = Number(row.total ?? row.balance ?? 0);
    const tipo = row.account_type === "Income" || valor < 0 ? "receita" : "despesa";
    linhas.push({ conta: row.account, tipo, valor: Math.abs(valor) });
    if (tipo === "receita") receita_total += Math.abs(valor);
    else despesa_total += Math.abs(valor);
  }

  return { linhas, receita_total, despesa_total, resultado: receita_total - despesa_total };
}

/**
 * Busca o balancete do ERPNext (Trial Balance)
 */
export async function getBalanceteFromErpNext(opts: ContabilDataOptions): Promise<{
  contas: { conta: string; saldoInicial: number; debitos: number; creditos: number; saldoFinal: number }[];
}> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  const report = await client.rpc("frappe.desk.reportview.run", {
    report_name: "Trial Balance",
    filters: {
      company: opts.clienteId ?? "",
      from_date: opts.startDate ?? `${new Date().getFullYear()}-01-01`,
      to_date: opts.endDate ?? new Date().toISOString().slice(0, 10),
    },
  });

  return {
    contas: (report?.result ?? []).map((r: any) => ({
      conta: r.account,
      saldoInicial: Number(r.opening_debit ?? 0) - Number(r.opening_credit ?? 0),
      debitos: Number(r.debit ?? 0),
      creditos: Number(r.credit ?? 0),
      saldoFinal: Number(r.closing_debit ?? 0) - Number(r.closing_credit ?? 0),
    })),
  };
}

/**
 * Exporta dados para gerar ECD/ECF no formato esperado pelas skills
 * Busca Journal Entries do ERPNext e mapeia para o leiaute I200/I250 da ECD
 */
export async function exportEcdDataFromErpNext(opts: ContabilDataOptions): Promise<{
  lancamentos: { data: string; historico: string; debito: string; credito: string; valor: number }[];
}> {
  const client = await getFrappeClientForTenant(opts.tenantId);

  const journals = await client.getList<any>("Journal Entry", {
    fields: ["name", "posting_date", "user_remark", "accounts"],
    filters: [
      ["posting_date", "between", [opts.startDate ?? "2024-01-01", opts.endDate ?? new Date().toISOString().slice(0, 10)]],
      ["docstatus", "=", 1],
    ],
    limit: opts.limit ?? 5000,
  });

  const lancamentos: { data: string; historico: string; debito: string; credito: string; valor: number }[] = [];

  for (const j of journals) {
    const entries = j.accounts ?? [];
    const debitos = entries.filter((e: any) => Number(e.debit_in_account_currency ?? 0) > 0);
    const creditos = entries.filter((e: any) => Number(e.credit_in_account_currency ?? 0) > 0);

    for (const d of debitos) {
      const c = creditos[0];
      if (!c) continue;
      lancamentos.push({
        data: j.posting_date,
        historico: j.user_remark || `Lançamento ${j.name}`,
        debito: d.account,
        credito: c.account,
        valor: Number(d.debit_in_account_currency),
      });
    }
  }

  return { lancamentos };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. getDataSourceStatus — visível na UI de configuração
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
      {
        id: "erpnext",
        label: "ERPNext / Frappe",
        status: detected.hasErpNext ? "ok" : "not_configured",
        description: detected.hasErpNext
          ? "GL Entry, Journal Entry, Salary Slip"
          : "Configure a URL do Frappe em Configurações → Integrações",
      },
      {
        id: "atlas",
        label: "Atlas ERP",
        status: detected.hasAtlas ? "ok" : "not_configured",
        description: detected.hasAtlas
          ? "Dados importados via DatasetAtlas (pagar_recebers, pedidos)"
          : "Importe um dump do Atlas em Datasets → Atlas",
      },
      {
        id: "control",
        label: "Arcádia Control",
        status: detected.hasControl ? "ok" : "empty",
        description: detected.hasControl
          ? "Lançamentos financeiros do módulo Control"
          : "Nenhum lançamento cadastrado no Control ainda",
      },
      {
        id: "hr",
        label: "Arcádia HR",
        status: detected.hasHr ? "ok" : "empty",
        description: detected.hasHr
          ? "Folha de pagamento do módulo HR"
          : "Nenhuma folha processada no HR ainda",
      },
      {
        id: "societario",
        label: "Societário",
        status: "ok",
        description: "Processos societários do módulo Societário",
      },
      {
        id: "recovery",
        label: "Recovery",
        status: "ok",
        description: "Parcelamentos e credores do módulo Recovery",
      },
    ],
  };
}
