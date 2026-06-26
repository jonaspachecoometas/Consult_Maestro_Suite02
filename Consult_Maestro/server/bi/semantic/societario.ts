import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent } from "./sqlHelpers";

/**
 * Módulo "societario" — pipeline e processos.
 * Lê diretamente de processos_societarios (não usa analytics.* — baixo volume).
 * Campo `coluna_atual` é o estágio do pipeline; `status='ativo'` = aberto.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "societario.pipeline_by_stage",
    label: "Pipeline societário por fase",
    description: "Quantidade de processos por fase atual (coluna_atual).",
    module: "societario",
    defaultWidget: "funnel_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(coluna_atual, 'Sem fase') AS name,
               COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND (status IS NULL OR status = 'ativo')
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "societario.total_processos",
    label: "Total de processos ativos",
    description: "Processos societários em andamento.",
    module: "societario",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Processos ativos' AS name,
               COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND (status IS NULL OR status = 'ativo')
      `,
    }),
  },
  {
    id: "societario.processos_by_tipo",
    label: "Processos por tipo",
    description: "Distribuição por tipo de processo societário.",
    module: "societario",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(tipo_processo, 'Outros') AS name,
               COUNT(*)::float AS value
          FROM processos_societarios
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
];
