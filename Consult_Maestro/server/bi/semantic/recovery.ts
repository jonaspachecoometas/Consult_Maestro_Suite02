import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent } from "./sqlHelpers";

/**
 * Módulo "recovery" — recuperação de empresas (RJ/extrajudicial).
 * Lê de recovery_processes + recovery_installments.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "recovery.installments_status",
    label: "Parcelas por status",
    description: "Distribuição das parcelas de recuperação por status.",
    module: "recovery",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(ri.status, 'pendente') AS name,
               COUNT(*)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "recovery.total_debt",
    label: "Dívida total mapeada",
    description: "Soma do valor total de todas as parcelas de recuperação.",
    module: "recovery",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Dívida total' AS name,
               COALESCE(SUM(ri.valor), 0)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
      `,
    }),
  },
  {
    id: "recovery.paid_vs_outstanding",
    label: "Pago vs pendente",
    description: "Comparativo entre valor já pago e valor ainda pendente.",
    module: "recovery",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT
          CASE WHEN ri.status = 'pago' THEN 'Pago' ELSE 'Pendente' END AS name,
          COALESCE(SUM(ri.valor), 0)::float AS value
          FROM recovery_installments ri
         WHERE ri.tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
      `,
    }),
  },
];
