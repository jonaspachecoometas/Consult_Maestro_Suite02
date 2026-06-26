import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent } from "./sqlHelpers";

/**
 * Módulo "dq" — Data Quality entre fontes.
 * Lê findings produzidos pelo ETL ao detectar discrepâncias (ex.:
 * receita ERPNext vs Domínio para o mesmo período).
 */

export const metrics: SemanticMetric[] = [
  {
    id: "dq.findings_recent",
    label: "Discrepâncias recentes",
    description: "Findings de Data Quality dos últimos 30 dias (por métrica).",
    module: "dq",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 60,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT metric_id AS name, COUNT(*)::float AS value
          FROM analytics.dq_findings
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND observed_at > now() - interval '30 days'
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 20
      `,
    }),
  },
  {
    id: "dq.findings_by_severity",
    label: "Findings por severidade",
    description: "Distribuição dos findings por severity (info/warning/critical).",
    module: "dq",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 60,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT severity AS name, COUNT(*)::float AS value
          FROM analytics.dq_findings
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
];
