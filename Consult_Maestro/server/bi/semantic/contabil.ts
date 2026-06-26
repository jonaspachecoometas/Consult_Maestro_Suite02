/**
 * Módulo semântico "contabil" — métricas contábeis consolidadas.
 *
 * Camada ACIMA do Control: combina Atlas ERP (analytics.atlas_pagar_recebers)
 * com Control nativo (lancamentos_financeiros) via UNION ALL, e ainda inclui
 * HR (folha), Societário e Recovery. Alimenta os 57 agentes contábeis e o
 * BI Builder.
 *
 * Notas de schema (adaptações vs anexo de referência):
 * - `analytics.atlas_categoria_conta` NÃO existe → tributos/folha são
 *   identificados por `descricao ILIKE` direto no atlas_pagar_recebers
 *   (mesma estratégia do `fiscal.ts`).
 * - `lancamentos_financeiros.tipo` é 'pagar' | 'receber' (não receita/despesa)
 *   → mapeia receber→receita (R) e pagar→despesa (D) nos UNIONs.
 * - `hr_payroll_periods.competence` é VARCHAR(7) 'YYYY-MM' → converte com
 *   `to_date(pp.competence || '-01', 'YYYY-MM-DD')`.
 * - `hr_departments.nome` (não name).
 * - Próxima evolução: leitura via `contabilDataLayer` quando o tenant tem
 *   ERPNext (resolvers Frappe TODO).
 */
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

const TRIBUTOS_FILTER = `
  AND (descricao ILIKE '%imposto%' OR descricao ILIKE '%tributo%'
    OR descricao ILIKE '%DAS%'    OR descricao ILIKE '%DARF%'
    OR descricao ILIKE '%GPS%'    OR descricao ILIKE '%INSS%'
    OR descricao ILIKE '%ISS%'    OR descricao ILIKE '%ICMS%'
    OR descricao ILIKE '%IRPJ%'   OR descricao ILIKE '%CSLL%'
    OR descricao ILIKE '%PIS%'    OR descricao ILIKE '%COFINS%'
    OR descricao ILIKE '%FGTS%')
`;

const FOLHA_FILTER = `
  AND (descricao ILIKE '%folha%' OR descricao ILIKE '%salário%'
    OR descricao ILIKE '%salario%' OR descricao ILIKE '%INSS%'
    OR descricao ILIKE '%FGTS%'   OR descricao ILIKE '%pro-labore%'
    OR descricao ILIKE '%pró-labore%' OR descricao ILIKE '%pessoal%'
    OR descricao ILIKE '%funcionário%' OR descricao ILIKE '%funcionario%')
`;

// ── Single-source (Atlas) — métricas baseadas em descricao ILIKE ────────────
const metricsAtlas: SemanticMetric[] = [
  {
    id: "contabil.carga_tributaria_mensal",
    label: "Carga tributária por mês",
    description: "Total de impostos (DAS, DARF, GPS, etc.) por mês — fonte Atlas.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_competencia), 'YYYY-MM') AS name,
               ABS(SUM(valor))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'D' AND ativo = true AND extornado = false
           ${TRIBUTOS_FILTER}
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.impostos_por_categoria",
    label: "Impostos por tipo",
    description: "Breakdown de tributos por palavra-chave na descrição (DAS, IRPJ, ICMS...).",
    module: "contabil",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT CASE
                 WHEN descricao ILIKE '%DAS%'    THEN 'DAS'
                 WHEN descricao ILIKE '%DARF%'   THEN 'DARF'
                 WHEN descricao ILIKE '%GPS%'    THEN 'GPS'
                 WHEN descricao ILIKE '%INSS%'   THEN 'INSS'
                 WHEN descricao ILIKE '%FGTS%'   THEN 'FGTS'
                 WHEN descricao ILIKE '%ISS%'    THEN 'ISS'
                 WHEN descricao ILIKE '%ICMS%'   THEN 'ICMS'
                 WHEN descricao ILIKE '%IRPJ%'   THEN 'IRPJ'
                 WHEN descricao ILIKE '%CSLL%'   THEN 'CSLL'
                 WHEN descricao ILIKE '%PIS%'    THEN 'PIS'
                 WHEN descricao ILIKE '%COFINS%' THEN 'COFINS'
                 ELSE 'Outros tributos'
               END AS name,
               ABS(SUM(valor))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'D' AND ativo = true AND extornado = false
           ${TRIBUTOS_FILTER}
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY value DESC LIMIT 12
      `,
    }),
  },
  {
    id: "contabil.resultado_liquido_mensal",
    label: "Resultado líquido por mês (Atlas)",
    description: "Receitas (C/R) menos despesas (D) por mês de competência — Atlas.",
    module: "contabil",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_competencia), 'YYYY-MM') AS name,
               SUM(CASE WHEN tipo IN ('C','R') THEN valor ELSE 0 END)::float AS value,
               SUM(CASE WHEN tipo = 'D' THEN ABS(valor) ELSE 0 END)::float AS series
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ativo = true AND extornado = false
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
      freeform: true,
    }),
  },
  {
    id: "contabil.custo_folha_mensal",
    label: "Custo de folha por mês",
    description: "Despesas com pessoal (folha + encargos) por mês — Atlas.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_competencia), 'YYYY-MM') AS name,
               ABS(SUM(valor))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'D' AND ativo = true AND extornado = false
           ${FOLHA_FILTER}
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.aging_contas_receber",
    label: "Aging — contas a receber",
    description: "Distribuição do contas a receber por faixa de vencimento.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT CASE
                 WHEN data_vencimento >= CURRENT_DATE         THEN '0 — A vencer'
                 WHEN data_vencimento >= CURRENT_DATE - 30    THEN '1 — Venc. 1-30d'
                 WHEN data_vencimento >= CURRENT_DATE - 60    THEN '2 — Venc. 31-60d'
                 WHEN data_vencimento >= CURRENT_DATE - 90    THEN '3 — Venc. 61-90d'
                 ELSE '4 — Venc. >90d'
               END AS name,
               SUM(valor - COALESCE(valor_pago, 0))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo IN ('C','R') AND pago = false
           AND ativo = true AND extornado = false
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.obrigacoes_vencendo_15d",
    label: "Obrigações vencendo em 15 dias",
    description: "Contas a pagar (tributos e despesas) com vencimento nos próximos 15 dias.",
    module: "contabil",
    defaultWidget: "data_table",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Sem credor') AS name,
               (pr.valor - COALESCE(pr.valor_pago, 0))::float AS value
          FROM analytics.atlas_pagar_recebers pr
          LEFT JOIN analytics.atlas_pessoas p
                 ON p.id = pr.pessoa_id AND p.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.tipo = 'D' AND pr.pago = false AND pr.ativo = true
           AND pr.data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
         ORDER BY pr.data_vencimento
         LIMIT 50
      `,
    }),
  },
  {
    id: "contabil.provisao_estimada_rh",
    label: "Provisão estimada férias + 13º",
    description: "Estimativa (16,67%) de provisão sobre custo de folha do período.",
    module: "contabil",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Provisão RH' AS name,
               ROUND(ABS(COALESCE(SUM(valor), 0)) * 0.1667, 2)::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'D' AND ativo = true AND extornado = false
           ${FOLHA_FILTER}
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "contabil.comparativo_trimestral",
    label: "Resultado comparativo trimestral",
    description: "Resultado líquido (Receita − Despesa) agrupado por trimestre.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'T' || EXTRACT(QUARTER FROM data_competencia)::text
               || '/' || EXTRACT(YEAR FROM data_competencia)::text AS name,
               SUM(CASE WHEN tipo IN ('C','R') THEN valor ELSE -ABS(valor) END)::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ativo = true AND extornado = false
           ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY MIN(data_competencia)
      `,
    }),
  },
];

// ── Multi-source (Atlas UNION ALL Control) — DRE consolidado ────────────────
const metricsMultiSource: SemanticMetric[] = [
  {
    id: "contabil.dre_receita_bruta",
    label: "Receita bruta consolidada por mês",
    description: "Receita unificada: Atlas (C/R) + Control nativo (receber).",
    module: "contabil",
    defaultWidget: "area_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS name,
               SUM(valor)::float AS value
          FROM (
            SELECT COALESCE(data_competencia, data_vencimento) AS data, valor
              FROM analytics.atlas_pagar_recebers
             WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
               AND tipo IN ('C','R') AND ativo = true AND extornado = false
            UNION ALL
            SELECT data_vencimento AS data, valor
              FROM lancamentos_financeiros
             WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
               AND tipo = 'receber'
          ) t
         WHERE data IS NOT NULL
           ${dateRangeClause("data", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.dre_despesa_total",
    label: "Despesa total consolidada por mês",
    description: "Despesas unificadas: Atlas (D) + Control nativo (pagar).",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS name,
               SUM(valor)::float AS value
          FROM (
            SELECT COALESCE(data_competencia, data_vencimento) AS data, ABS(valor) AS valor
              FROM analytics.atlas_pagar_recebers
             WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
               AND tipo = 'D' AND ativo = true AND extornado = false
            UNION ALL
            SELECT data_vencimento AS data, ABS(valor) AS valor
              FROM lancamentos_financeiros
             WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
               AND tipo = 'pagar'
          ) t
         WHERE data IS NOT NULL
           ${dateRangeClause("data", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.resultado_consolidado",
    label: "Resultado líquido consolidado por mês",
    description: "Receita − Despesa de todas as fontes (Atlas + Control).",
    module: "contabil",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS name,
               SUM(CASE WHEN tipo_sinal = 'R' THEN valor ELSE 0 END)::float AS value,
               SUM(CASE WHEN tipo_sinal = 'D' THEN valor ELSE 0 END)::float AS series
          FROM (
            SELECT COALESCE(data_competencia, data_vencimento) AS data,
                   CASE WHEN tipo IN ('C','R') THEN 'R' ELSE 'D' END AS tipo_sinal,
                   ABS(valor) AS valor
              FROM analytics.atlas_pagar_recebers
             WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
               AND ativo = true AND extornado = false
            UNION ALL
            SELECT data_vencimento AS data,
                   CASE WHEN tipo = 'receber' THEN 'R' ELSE 'D' END AS tipo_sinal,
                   ABS(valor) AS valor
              FROM lancamentos_financeiros
             WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
          ) t
         WHERE data IS NOT NULL
           ${dateRangeClause("data", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
      freeform: true,
    }),
  },
  {
    id: "contabil.carga_tributaria_pct_receita",
    label: "Carga tributária % da receita",
    description: "Impostos / receita bruta do período (Atlas + Control consolidados).",
    module: "contabil",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH base AS (
          SELECT
            SUM(CASE WHEN tipo_sinal = 'R' THEN valor ELSE 0 END) AS receita,
            SUM(CASE WHEN tipo_sinal = 'D' AND eh_tributo THEN valor ELSE 0 END) AS impostos
            FROM (
              SELECT CASE WHEN tipo IN ('C','R') THEN 'R' ELSE 'D' END AS tipo_sinal,
                     ABS(valor) AS valor,
                     (descricao ILIKE '%DAS%' OR descricao ILIKE '%DARF%'
                      OR descricao ILIKE '%GPS%' OR descricao ILIKE '%INSS%'
                      OR descricao ILIKE '%FGTS%' OR descricao ILIKE '%ISS%'
                      OR descricao ILIKE '%ICMS%' OR descricao ILIKE '%PIS%'
                      OR descricao ILIKE '%COFINS%' OR descricao ILIKE '%IRPJ%'
                      OR descricao ILIKE '%CSLL%') AS eh_tributo
                FROM analytics.atlas_pagar_recebers
               WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
                 AND ativo = true AND extornado = false
                 ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
              UNION ALL
              SELECT CASE WHEN tipo = 'receber' THEN 'R' ELSE 'D' END AS tipo_sinal,
                     ABS(valor) AS valor,
                     (descricao ILIKE '%DAS%' OR descricao ILIKE '%DARF%'
                      OR descricao ILIKE '%GPS%' OR descricao ILIKE '%INSS%'
                      OR descricao ILIKE '%FGTS%' OR descricao ILIKE '%ISS%'
                      OR descricao ILIKE '%ICMS%' OR descricao ILIKE '%PIS%'
                      OR descricao ILIKE '%COFINS%' OR descricao ILIKE '%IRPJ%'
                      OR descricao ILIKE '%CSLL%') AS eh_tributo
                FROM lancamentos_financeiros
               WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
                 ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
            ) t
        )
        SELECT 'Carga %' AS name,
               COALESCE(ROUND(100.0 * impostos / NULLIF(receita, 0), 2), 0)::float AS value
          FROM base
      `,
    }),
  },
  {
    id: "contabil.fontes_de_dados",
    label: "Fontes de dados contábeis ativas",
    description: "Quantas fontes (Control, HR, Atlas, ERPNext) estão alimentando o módulo.",
    module: "contabil",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Fontes ativas' AS name,
               (
                 (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                    FROM lancamentos_financeiros
                   WHERE tenant_id = ${quoteIdent(ctx.tenantId)}) +
                 (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                    FROM hr_payroll_entries
                   WHERE tenant_id = ${quoteIdent(ctx.tenantId)}) +
                 (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                    FROM analytics.atlas_pagar_recebers
                   WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}) +
                 (SELECT CASE WHEN frappe_url IS NOT NULL AND frappe_url != ''
                              THEN 1 ELSE 0 END
                    FROM tenants
                   WHERE id = ${quoteIdent(ctx.tenantId)})
               )::float AS value
      `,
    }),
  },
];

// ── HR nativo (hr_payroll_*) ────────────────────────────────────────────────
const metricsHr: SemanticMetric[] = [
  {
    id: "contabil.custo_pessoal_consolidado",
    label: "Custo de pessoal por mês (HR nativo)",
    description: "Folha bruta + INSS + FGTS do módulo HR do Arcádia.",
    module: "contabil",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT pp.competence AS name,
               SUM(pe.total_gross + COALESCE(pe.inss_value,0) + COALESCE(pe.fgts_value,0))::float AS value
          FROM hr_payroll_entries pe
          JOIN hr_payroll_periods pp ON pp.id = pe.period_id
         WHERE pe.tenant_id = ${quoteIdent(ctx.tenantId)}
           ${ctx.startDate ? `AND pp.competence >= '${ctx.startDate.slice(0,7)}'` : ""}
           ${ctx.endDate ? `AND pp.competence <= '${ctx.endDate.slice(0,7)}'` : ""}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "contabil.headcount_ativo",
    label: "Headcount ativo",
    description: "Total de funcionários com status active no HR.",
    module: "contabil",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Headcount' AS name, COUNT(*)::float AS value
          FROM hr_employees
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status = 'active'
      `,
    }),
  },
  {
    id: "contabil.custo_por_departamento",
    label: "Custo de pessoal por departamento",
    description: "Folha bruta total agrupada por departamento.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(d.nome, 'Sem departamento') AS name,
               SUM(pe.total_gross)::float AS value
          FROM hr_payroll_entries pe
          JOIN hr_payroll_periods pp ON pp.id = pe.period_id
          LEFT JOIN hr_departments d ON d.id = pe.department_id
         WHERE pe.tenant_id = ${quoteIdent(ctx.tenantId)}
           ${ctx.startDate ? `AND pp.competence >= '${ctx.startDate.slice(0,7)}'` : ""}
           ${ctx.endDate ? `AND pp.competence <= '${ctx.endDate.slice(0,7)}'` : ""}
         GROUP BY 1 ORDER BY value DESC
      `,
    }),
  },
];

// ── Societário ──────────────────────────────────────────────────────────────
const metricsSocietario: SemanticMetric[] = [
  {
    id: "contabil.societario_por_fase",
    label: "Processos societários por fase",
    description: "Distribuição dos processos societários ativos por fase do pipeline.",
    module: "contabil",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(coluna_atual, 'Sem fase') AS name,
               COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('concluido','cancelado')
         GROUP BY 1 ORDER BY value DESC
      `,
    }),
  },
  {
    id: "contabil.societario_vencendo_30d",
    label: "Processos societários vencendo em 30 dias",
    description: "Processos com data prevista de conclusão nos próximos 30 dias.",
    module: "contabil",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Vencendo 30d' AS name, COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('concluido','cancelado')
           AND data_prevista_conclusao BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
      `,
    }),
  },
  {
    id: "contabil.societario_por_tipo",
    label: "Processos societários por tipo",
    description: "Abertura, alteração, encerramento e outros tipos de processo.",
    module: "contabil",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(tipo_processo, 'Outros') AS name,
               COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('concluido','cancelado')
         GROUP BY 1 ORDER BY value DESC
      `,
    }),
  },
];

// ── Recovery ────────────────────────────────────────────────────────────────
const metricsRecovery: SemanticMetric[] = [
  {
    id: "contabil.recovery_runway_meses",
    label: "Recovery — parcelas em dia (%)",
    description: "Percentual do plano de recuperação já adimplido.",
    module: "contabil",
    defaultWidget: "gauge_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Recuperação %' AS name,
               COALESCE(ROUND(
                 100.0 * SUM(CASE WHEN ri.status = 'pago' THEN ri.valor ELSE 0 END)
                 / NULLIF(SUM(ri.valor), 0),
               2), 0)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
      `,
    }),
  },
  {
    id: "contabil.recovery_parcelas_por_status",
    label: "Recovery — parcelas por status",
    description: "Distribuição das parcelas por status: pago, pendente, atrasado.",
    module: "contabil",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT CASE
                 WHEN ri.status = 'pago' THEN 'Pago'
                 WHEN ri.due_date < CURRENT_DATE AND ri.status <> 'pago' THEN 'Atrasado'
                 ELSE 'Pendente'
               END AS name,
               COUNT(*)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
      `,
    }),
  },
  {
    id: "contabil.recovery_evolucao_pagamentos",
    label: "Recovery — evolução de pagamentos por mês",
    description: "Valor recuperado (parcelas pagas) por mês.",
    module: "contabil",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', ri.paid_date), 'YYYY-MM') AS name,
               SUM(ri.paid_amount)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ri.status = 'pago' AND ri.paid_date IS NOT NULL
           ${dateRangeClause("ri.paid_date", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
];

// TODO: métricas que dependem de ERPNext (FrappeClient) — adicionar quando
// `contabilDataLayer` ganhar resolvers DRE/Balancete/ECD via Frappe.

export const metrics: SemanticMetric[] = [
  ...metricsAtlas,
  ...metricsMultiSource,
  ...metricsHr,
  ...metricsSocietario,
  ...metricsRecovery,
];
