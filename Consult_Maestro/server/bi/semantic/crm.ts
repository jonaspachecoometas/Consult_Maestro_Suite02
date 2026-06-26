import type { SemanticContext, SemanticMetric, SemanticDimension } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "crm" — pipeline, conversão e receita prevista.
 * Lê de analytics.fact_crm (populada pelo ETL a partir de crm_opportunities).
 */

export const metrics: SemanticMetric[] = [
  {
    id: "crm.pipeline_by_stage",
    label: "Pipeline por estágio",
    description: "Quantidade de oportunidades abertas agrupadas por estágio do funil.",
    module: "crm",
    defaultWidget: "funnel_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(stage, 'Sem estágio') AS name,
               COUNT(*)::float AS value
          FROM analytics.fact_crm
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('won','lost','closed')
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "crm.pipeline_value_by_stage",
    label: "Valor do pipeline por estágio",
    description: "Soma do valor ponderado (value × probability) por estágio.",
    module: "crm",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(stage, 'Sem estágio') AS name,
               ROUND(SUM(value * probability / 100.0), 2)::float AS value
          FROM analytics.fact_crm
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('won','lost','closed')
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "crm.conversion_rate",
    label: "Taxa de conversão (%)",
    description: "Won / (Won + Lost) × 100 — só oportunidades finalizadas.",
    module: "crm",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Conversão' AS name,
               ROUND(
                 100.0 * COUNT(*) FILTER (WHERE status = 'won')
                 / NULLIF(COUNT(*) FILTER (WHERE status IN ('won','lost')), 0),
               2)::float AS value
          FROM analytics.fact_crm
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("created_at", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "crm.won_revenue_by_period",
    label: "Receita fechada por mês",
    description: "Soma de oportunidades 'won' por mês de criação.",
    module: "crm",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS name,
               SUM(value)::float AS value
          FROM analytics.fact_crm
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status = 'won'
           ${dateRangeClause("created_at", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "crm.total_pipeline_value",
    label: "Valor total do pipeline",
    description: "Soma de value × probability de todas as oportunidades abertas.",
    module: "crm",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Pipeline' AS name,
               ROUND(COALESCE(SUM(value * probability / 100.0), 0), 2)::float AS value
          FROM analytics.fact_crm
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status NOT IN ('won','lost','closed')
      `,
    }),
  },
  {
    id: "crm.top_clients_by_pipeline",
    label: "Top clientes por pipeline",
    description: "Clientes com maior valor de pipeline ponderado aberto.",
    module: "crm",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(c.name, f.client_natural_key, '—') AS name,
               ROUND(SUM(f.value * f.probability / 100.0), 2)::float AS value
          FROM analytics.fact_crm f
          LEFT JOIN analytics.dim_client c
                 ON c.natural_key = f.client_natural_key
                AND c.tenant_id = f.tenant_id
                AND c.is_current = 1
         WHERE f.tenant_id = ${quoteIdent(ctx.tenantId)}
           AND f.status NOT IN ('won','lost','closed')
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 10
      `,
    }),
  },
];

export const dimensions: SemanticDimension[] = [
  {
    id: "crm.stage",
    label: "Estágio do pipeline",
    module: "crm",
    table: "analytics.fact_crm",
    naturalKey: "stage",
    displayColumn: "stage",
  },
];
