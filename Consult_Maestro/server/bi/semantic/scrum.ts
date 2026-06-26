import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "scrum" — velocity, lead time, burn-down.
 * Lê de analytics.fact_scrum (ETL de scrum_backlog_items + scrum_sprints).
 */

export const metrics: SemanticMetric[] = [
  {
    id: "scrum.velocity_by_sprint",
    label: "Velocity por sprint",
    description: "Tarefas concluídas por sprint — mede produtividade da equipe.",
    module: "scrum",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(period_start, 'YYYY-MM-DD') AS name,
               tasks_done::float AS value
          FROM analytics.fact_scrum
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period_start", ctx.startDate, ctx.endDate)}
         ORDER BY period_start
         LIMIT 20
      `,
    }),
  },
  {
    id: "scrum.completion_rate",
    label: "Taxa de conclusão (%)",
    description: "tasks_done / tasks_planned × 100 — eficácia do planejamento.",
    module: "scrum",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Conclusão' AS name,
               ROUND(
                 100.0 * COALESCE(SUM(tasks_done), 0)
                 / NULLIF(SUM(tasks_planned), 0),
               2)::float AS value
          FROM analytics.fact_scrum
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period_start", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "scrum.carry_over_by_sprint",
    label: "Carry-over por sprint",
    description: "Tarefas não concluídas e arrastadas para o próximo sprint.",
    module: "scrum",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(period_start, 'YYYY-MM-DD') AS name,
               tasks_carried::float AS value
          FROM analytics.fact_scrum
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period_start", ctx.startDate, ctx.endDate)}
         ORDER BY period_start
         LIMIT 20
      `,
    }),
  },
  {
    id: "scrum.story_points_velocity",
    label: "Story points por sprint",
    description: "Pontos entregues por sprint — mais preciso que contagem de tarefas.",
    module: "scrum",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(period_start, 'YYYY-MM-DD') AS name,
               story_points_done::float AS value
          FROM analytics.fact_scrum
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period_start", ctx.startDate, ctx.endDate)}
         ORDER BY period_start
         LIMIT 20
      `,
    }),
  },
];
