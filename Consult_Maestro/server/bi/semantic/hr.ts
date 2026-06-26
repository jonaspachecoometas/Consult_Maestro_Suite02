import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "hr" — headcount, folha e encargos.
 * Lê de analytics.fact_hr (ETL de hr_employees + payroll).
 */

export const metrics: SemanticMetric[] = [
  {
    id: "hr.headcount_by_department",
    label: "Headcount por departamento",
    description: "Total de colaboradores ativos por departamento no período.",
    module: "hr",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(department, 'Sem departamento') AS name,
               COUNT(DISTINCT employee_id)::float AS value
          FROM analytics.fact_hr
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status = 'active'
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC
      `,
    }),
  },
  {
    id: "hr.payroll_by_period",
    label: "Folha bruta por mês",
    description: "Soma da folha bruta (gross_salary) por mês.",
    module: "hr",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', period), 'YYYY-MM') AS name,
               SUM(gross_salary)::float AS value
          FROM analytics.fact_hr
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "hr.encargos_by_period",
    label: "Encargos por mês",
    description: "Total de encargos (INSS patronal, FGTS etc.) por mês.",
    module: "hr",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', period), 'YYYY-MM') AS name,
               SUM(encargos)::float AS value
          FROM analytics.fact_hr
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "hr.total_payroll_cost",
    label: "Custo total de pessoal",
    description: "Folha + Encargos do período selecionado.",
    module: "hr",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Custo total' AS name,
               COALESCE(SUM(gross_salary + encargos), 0)::float AS value
          FROM analytics.fact_hr
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "hr.encargos_pct",
    label: "Encargos % sobre folha",
    description: "Encargos / gross_salary × 100 — mede eficiência tributária sobre pessoal.",
    module: "hr",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Encargos %' AS name,
               ROUND(
                 100.0 * COALESCE(SUM(encargos), 0)
                 / NULLIF(SUM(gross_salary), 0),
               2)::float AS value
          FROM analytics.fact_hr
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("period", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
];
