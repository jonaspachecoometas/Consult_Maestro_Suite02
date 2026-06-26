import type { SemanticContext, SemanticMetric, SemanticDimension } from "./types";
import { quoteIdent, sourcesClause, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "control" — métricas financeiras (Arcádia Control).
 * Toda métrica lê de `analytics.fact_revenue` que é materializada pelo
 * ETL a partir de qualquer conector com mapping `kind='fact_revenue'`.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "control.revenue_by_period",
    label: "Receita por período",
    description: "Soma de receita por mês a partir de analytics.fact_revenue (combina múltiplas fontes via filtro 'sources').",
    module: "control",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', period), 'YYYY-MM') AS name,
               SUM(amount)::float AS value
          FROM analytics.fact_revenue
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${sourcesClause("source_data_source_id", ctx.sources)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.revenue_by_source",
    label: "Receita por fonte",
    description: "Total de receita agrupada por conector (útil para comparar ERPNext vs Domínio).",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(s.name, f.source_data_source_id) AS name,
               SUM(f.amount)::float AS value
          FROM analytics.fact_revenue f
          LEFT JOIN analytics.dim_source s
                 ON s.data_source_id = f.source_data_source_id
                AND s.tenant_id = f.tenant_id
         WHERE f.tenant_id = ${quoteIdent(ctx.tenantId)}
           ${sourcesClause("f.source_data_source_id", ctx.sources)}
           ${dateRangeClause("f.period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "control.revenue_by_client",
    label: "Receita por cliente (Top 15)",
    description: "Top clientes por receita unificada (qualquer fonte).",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(c.name, f.client_natural_key, '—') AS name,
               SUM(f.amount)::float AS value
          FROM analytics.fact_revenue f
          LEFT JOIN analytics.dim_client c
                 ON c.natural_key = f.client_natural_key
                AND c.tenant_id = f.tenant_id
                AND c.is_current = 1
         WHERE f.tenant_id = ${quoteIdent(ctx.tenantId)}
           ${sourcesClause("f.source_data_source_id", ctx.sources)}
           ${dateRangeClause("f.period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 15
      `,
    }),
  },
  {
    id: "control.revenue_total",
    label: "Receita total",
    description: "KPI agregado a partir de analytics.fact_revenue.",
    module: "control",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Total' AS name,
               COALESCE(SUM(amount), 0)::float AS value
          FROM analytics.fact_revenue
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${sourcesClause("source_data_source_id", ctx.sources)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
      `,
    }),
  },

  // ── DRE simplificado (lê de lancamentos_financeiros: tipo='entrada'/'saida') ──
  {
    id: "control.dre_receita_bruta",
    label: "Receita bruta por mês",
    description: "Soma de lançamentos do tipo 'entrada' por mês.",
    module: "control",
    defaultWidget: "waterfall_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               COALESCE(SUM(valor), 0)::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'receber'
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.dre_despesa_total",
    label: "Despesa total por mês",
    description: "Soma de lançamentos do tipo 'saida' por mês.",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               ABS(COALESCE(SUM(valor), 0))::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'pagar'
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.resultado_liquido",
    label: "Resultado líquido por mês",
    description: "Entradas - Saídas por mês.",
    module: "control",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               SUM(CASE WHEN tipo = 'receber' THEN valor ELSE -ABS(valor) END)::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.inadimplencia_pct",
    label: "Inadimplência (%)",
    description: "% de lançamentos a receber vencidos em relação ao total a receber.",
    module: "control",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Inadimplência %' AS name,
               ROUND(
                 100.0 * COUNT(*) FILTER (WHERE status = 'vencido')
                 / NULLIF(COUNT(*) FILTER (WHERE tipo = 'receber' AND status IN ('previsto','vencido')), 0),
               2)::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
      `,
    }),
  },
  {
    id: "control.cashflow_by_wallet",
    label: "Saldo por carteira",
    description: "Saldo confirmado de cada carteira (contas_bancarias tipo='carteira').",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 60,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(c.apelido, c.banco) AS name,
               COALESCE(SUM(
                 CASE WHEN l.tipo = 'receber' THEN l.valor
                      WHEN l.tipo = 'pagar'   THEN -ABS(l.valor)
                      ELSE 0 END
               ), 0)::float AS value
          FROM contas_bancarias c
          LEFT JOIN lancamentos_financeiros l
                 ON l.conta_bancaria_id = c.id
                AND l.status = 'pago'
         WHERE c.tenant_id = ${quoteIdent(ctx.tenantId)}
           AND c.tipo = 'carteira'
         GROUP BY c.id, c.apelido, c.banco
         ORDER BY value DESC
      `,
    }),
  },
];

export const dimensions: SemanticDimension[] = [
  {
    id: "control.client",
    label: "Cliente (analytics)",
    module: "control",
    table: "analytics.dim_client",
    naturalKey: "natural_key",
    displayColumn: "name",
  },
];
