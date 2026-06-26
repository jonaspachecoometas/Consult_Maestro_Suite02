import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent } from "./sqlHelpers";

/**
 * Módulo "migration" — métricas usadas pelo Migration Monitor para
 * acompanhar a transição entre dois conectores (ex.: ERP legado → ERP
 * novo). Usa `analytics.migration_state` (snapshot atualizado pelo ETL)
 * + SCD Type 2 em `dim_client`.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "migration.client_progress",
    label: "Migração de clientes",
    description: "Qtd de clientes presentes no destino vs origem para cada par fonte_a / fonte_b.",
    module: "migration",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 120,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT source_a || ' → ' || source_b AS name,
               matched::float AS value
          FROM analytics.migration_state
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND dimension = 'dim_client'
         ORDER BY observed_at DESC
         LIMIT 10
      `,
    }),
  },
  {
    id: "migration.client_pending",
    label: "Clientes pendentes na migração",
    description: "Clientes no fonte_a sem correspondente no fonte_b.",
    module: "migration",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 120,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'pendentes' AS name,
               COALESCE(SUM(missing_in_b), 0)::float AS value
          FROM analytics.migration_state
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND dimension = 'dim_client'
      `,
    }),
  },
];
