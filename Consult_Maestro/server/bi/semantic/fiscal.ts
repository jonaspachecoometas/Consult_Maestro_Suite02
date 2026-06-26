import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "fiscal" — carga tributária.
 * Usa lancamentos_financeiros filtrando descricao por palavras-chave fiscais.
 * (categoria não existe na tabela — busca por descricao ILIKE.)
 */

const FISCAL_FILTER = `
  AND (descricao ILIKE '%imposto%' OR descricao ILIKE '%tributo%'
    OR descricao ILIKE '%DAS%'    OR descricao ILIKE '%INSS%'
    OR descricao ILIKE '%ISS%'    OR descricao ILIKE '%ICMS%'
    OR descricao ILIKE '%PIS%'    OR descricao ILIKE '%COFINS%'
    OR descricao ILIKE '%IRPJ%'   OR descricao ILIKE '%CSLL%')
`;

export const metrics: SemanticMetric[] = [
  {
    id: "fiscal.tax_burden_by_period",
    label: "Carga tributária por mês",
    description: "Soma de lançamentos de saída identificados como tributos por mês.",
    module: "fiscal",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               ABS(SUM(valor))::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'pagar'
           ${FISCAL_FILTER}
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "fiscal.total_tax_period",
    label: "Total de impostos no período",
    description: "KPI: soma de todos os tributos lançados no período.",
    module: "fiscal",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Total tributos' AS name,
               ABS(COALESCE(SUM(valor), 0))::float AS value
          FROM lancamentos_financeiros
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'pagar'
           ${FISCAL_FILTER}
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
];
