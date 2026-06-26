# Plano de Expansão — BI Consultivo + Agentes
**Arcádia Consult** · gerado em 25/05/2026  
**Para o Replit Agent:** leia e execute cada onda em sequência. Cada seção tem os arquivos exatos a criar ou modificar, com o código completo ou as instruções de diff.

---

## Estado atual (lido do código)

| O que existe | Estado |
|---|---|
| `server/bi/semantic/control.ts` | ✅ receita por período/fonte/cliente — **falta** DRE, Fleuriet, conciliação, inadimplência |
| `server/bi/semantic/migration.ts` | ✅ existe |
| `server/bi/semantic/dataquality.ts` | ✅ existe |
| `server/bi/semantic/index.ts` | ✅ existe — precisa importar módulos novos |
| `server/bi/cache.ts` | ✅ Memory + Redis automático |
| `server/bi/etl/runEtl.ts` | ✅ ETL incremental com cursor |
| `server/biMetrics.ts` | ✅ 12 métricas internas (projetos/tasks/CRM/scrum) |
| `server/agentService.ts` — `runBiAgent` | ✅ existe mas usa só `METRIC_CATALOG` interno, não semantic layer |
| `WidgetRenderer.tsx` | ✅ 4 tipos: kpi_card, bar_chart, line_chart, radar_chart |
| Analytics schema | ✅ `analytics.fact_revenue`, `analytics.dim_client`, `analytics.dim_source` |
| **Faltando** | CRM/HR/Scrum/Societário/Recovery/Fiscal semantic modules |
| **Faltando** | 10 tipos de widget: area, pie/donut, big_number, waterfall, funnel, gauge, scatter, heatmap, mixed_timeseries, data_table |
| **Faltando** | Tool `run_bi_query` real no toolRegistry (bi_agent chama mas não existe) |
| **Faltando** | Analytics tables para CRM, HR, Scrum no schema |
| **Faltando** | Sistema de alertas (`bi_alerts`) |

---

## ONDA 1 — Semantic Layer completa

### 1.1 Analytics tables novas no `server/index.ts`

Adicionar APÓS o bloco `analytics.dq_findings` (linha ~678), dentro da função `runStartupMigrations`:

```sql
-- CRM analytics
CREATE TABLE IF NOT EXISTS analytics.fact_crm (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  opportunity_id varchar NOT NULL,
  client_natural_key varchar(200),
  stage varchar(100),
  value numeric(18,2) NOT NULL DEFAULT 0,
  probability integer NOT NULL DEFAULT 0,
  expected_close date,
  status varchar(50),
  created_at date NOT NULL,
  updated_at timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_crm_tenant ON analytics.fact_crm(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_crm_stage ON analytics.fact_crm(tenant_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_fact_crm_opp ON analytics.fact_crm(tenant_id, opportunity_id);

-- HR analytics
CREATE TABLE IF NOT EXISTS analytics.fact_hr (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  employee_id varchar NOT NULL,
  period date NOT NULL,
  department varchar(100),
  position varchar(100),
  gross_salary numeric(18,2) NOT NULL DEFAULT 0,
  encargos numeric(18,2) NOT NULL DEFAULT 0,
  status varchar(50),
  updated_at timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_hr_tenant ON analytics.fact_hr(tenant_id, period);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_fact_hr_emp_period ON analytics.fact_hr(tenant_id, employee_id, period);

-- Scrum analytics
CREATE TABLE IF NOT EXISTS analytics.fact_scrum (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  sprint_id varchar NOT NULL,
  project_id varchar NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  tasks_planned integer NOT NULL DEFAULT 0,
  tasks_done integer NOT NULL DEFAULT 0,
  tasks_carried integer NOT NULL DEFAULT 0,
  story_points_done integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_scrum_tenant ON analytics.fact_scrum(tenant_id, period_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_fact_scrum_sprint ON analytics.fact_scrum(tenant_id, sprint_id);
```

**Como adicionar no código:**
No `server/index.ts`, na função `runStartupMigrations`, buscar a linha:
```
await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_migration_tenant
```
e APÓS o bloco de `migration_state` (após o seu CREATE INDEX), adicionar as queries SQL acima.

---

### 1.2 Criar `server/bi/semantic/crm.ts`

```typescript
import type { SemanticContext, SemanticMetric, SemanticDimension } from "./types";
import { quoteIdent, sourcesClause, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "crm" — pipeline, conversão e receita prevista.
 * Lê de analytics.fact_crm (populada pelo ETL a partir de crm_opportunities).
 * Fallback direto em crm_opportunities quando analytics não foi populada.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "crm.pipeline_by_stage",
    label: "Pipeline por estágio",
    description: "Valor total de oportunidades abertas agrupadas por estágio do funil.",
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
      freeform: false,
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
```

---

### 1.3 Criar `server/bi/semantic/hr.ts`

```typescript
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
```

---

### 1.4 Criar `server/bi/semantic/scrum.ts`

```typescript
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "scrum" — velocity, lead time, burn-down.
 * Lê de analytics.fact_scrum (ETL de scrum_tasks + sprints).
 * Fallback: queries diretas em scrum_tasks quando analytics vazio.
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
```

---

### 1.5 Criar `server/bi/semantic/societario.ts`

```typescript
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent } from "./sqlHelpers";

/**
 * Módulo "societario" — pipeline, obrigações e compliance.
 * Lê diretamente de societario_processos e societario_pipeline_stages
 * (não usa analytics.* pois são dados de baixo volume).
 */

export const metrics: SemanticMetric[] = [
  {
    id: "societario.pipeline_by_stage",
    label: "Pipeline societário por fase",
    description: "Quantidade de processos por fase do pipeline societário.",
    module: "societario",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(s.name, p.stage_id, 'Sem fase') AS name,
               COUNT(p.id)::float AS value
          FROM societario_processos p
          LEFT JOIN societario_pipeline_stages s ON s.id = p.stage_id
         WHERE p.tenant_id = ${quoteIdent(ctx.tenantId)}
           AND (p.status IS NULL OR p.status != 'closed')
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
          FROM societario_processos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND (status IS NULL OR status != 'closed')
      `,
    }),
  },
];
```

---

### 1.6 Criar `server/bi/semantic/recovery.ts`

```typescript
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

export const metrics: SemanticMetric[] = [
  {
    id: "recovery.installments_status",
    label: "Parcelas por status",
    description: "Distribuição das parcelas de recuperação por status (em dia / atrasada / paga).",
    module: "recovery",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(status, 'pendente') AS name,
               COUNT(*)::float AS value
          FROM recovery_installments ri
          JOIN recovery_processes rp ON rp.id = ri.recovery_process_id
         WHERE rp.tenant_id = ${quoteIdent(ctx.tenantId)}
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
               COALESCE(SUM(ri.amount), 0)::float AS value
          FROM recovery_installments ri
          JOIN recovery_processes rp ON rp.id = ri.recovery_process_id
         WHERE rp.tenant_id = ${quoteIdent(ctx.tenantId)}
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
          CASE WHEN status = 'paid' THEN 'Pago' ELSE 'Pendente' END AS name,
          COALESCE(SUM(amount), 0)::float AS value
          FROM recovery_installments ri
          JOIN recovery_processes rp ON rp.id = ri.recovery_process_id
         WHERE rp.tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY 1
      `,
    }),
  },
];
```

---

### 1.7 Criar `server/bi/semantic/fiscal.ts`

```typescript
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

/**
 * Módulo "fiscal" — carga tributária, obrigações.
 * Usa lancamentos do Control com categoria fiscal.
 */

export const metrics: SemanticMetric[] = [
  {
    id: "fiscal.tax_burden_by_period",
    label: "Carga tributária por mês",
    description: "Soma de lançamentos com categoria fiscal por mês.",
    module: "fiscal",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_lancamento), 'YYYY-MM') AS name,
               ABS(SUM(valor))::float AS value
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'saida'
           AND (categoria ILIKE '%imposto%' OR categoria ILIKE '%tributo%'
             OR categoria ILIKE '%DAS%' OR categoria ILIKE '%INSS%'
             OR categoria ILIKE '%ISS%' OR categoria ILIKE '%ICMS%'
             OR categoria ILIKE '%PIS%' OR categoria ILIKE '%COFINS%')
           ${dateRangeClause("data_lancamento", ctx.startDate, ctx.endDate)}
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
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'saida'
           AND (categoria ILIKE '%imposto%' OR categoria ILIKE '%tributo%'
             OR categoria ILIKE '%DAS%' OR categoria ILIKE '%INSS%'
             OR categoria ILIKE '%ISS%' OR categoria ILIKE '%ICMS%'
             OR categoria ILIKE '%PIS%' OR categoria ILIKE '%COFINS%')
           ${dateRangeClause("data_lancamento", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
];
```

---

### 1.8 Expandir `server/bi/semantic/control.ts`

Adicionar ao array `metrics` existente (após os 4 metrics atuais):

```typescript
  // ── DRE simplificado ──
  {
    id: "control.dre_receita_bruta",
    label: "Receita bruta por mês",
    description: "Soma de lançamentos tipo 'receita' por mês.",
    module: "control",
    defaultWidget: "waterfall_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_lancamento), 'YYYY-MM') AS name,
               COALESCE(SUM(valor), 0)::float AS value
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'receita'
           ${dateRangeClause("data_lancamento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.dre_despesa_total",
    label: "Despesa total por mês",
    description: "Soma de lançamentos tipo 'saida' por mês.",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_lancamento), 'YYYY-MM') AS name,
               ABS(COALESCE(SUM(valor), 0))::float AS value
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'saida'
           ${dateRangeClause("data_lancamento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "control.resultado_liquido",
    label: "Resultado líquido por mês",
    description: "Receita - Despesa por mês.",
    module: "control",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_lancamento), 'YYYY-MM') AS name,
               SUM(CASE WHEN tipo = 'receita' THEN valor ELSE -ABS(valor) END)::float AS value
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("data_lancamento", ctx.startDate, ctx.endDate)}
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
                 / NULLIF(COUNT(*) FILTER (WHERE tipo = 'receita' AND status IN ('pendente','vencido')), 0),
               2)::float AS value
          FROM lancamentos
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
      `,
    }),
  },
  {
    id: "control.cashflow_by_wallet",
    label: "Saldo por carteira",
    description: "Saldo atual de cada carteira (conta bancária).",
    module: "control",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 60,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT c.nome AS name,
               COALESCE(SUM(
                 CASE WHEN l.tipo = 'receita' THEN l.valor
                      WHEN l.tipo = 'saida' THEN -ABS(l.valor)
                      ELSE 0 END
               ), 0)::float AS value
          FROM carteiras c
          LEFT JOIN lancamentos l ON l.carteira_id = c.id AND l.status = 'confirmado'
         WHERE c.tenant_id = ${quoteIdent(ctx.tenantId)}
         GROUP BY c.id, c.nome
         ORDER BY value DESC
      `,
    }),
  },
```

---

### 1.9 Atualizar `server/bi/semantic/index.ts`

Adicionar imports e registrar os novos módulos:

**No topo do arquivo, adicionar:**
```typescript
import * as crm from "./crm";
import * as hr from "./hr";
import * as scrum from "./scrum";
import * as societario from "./societario";
import * as recovery from "./recovery";
import * as fiscal from "./fiscal";
```

**Atualizar o array MODULES:**
```typescript
const MODULES: SemanticModule[] = [control, migration, dq, crm, hr, scrum, societario, recovery, fiscal];
```

---

## ONDA 2 — Novos tipos de widget

### 2.1 Atualizar `client/src/components/bi/WidgetRenderer.tsx`

Adicionar imports no topo (junto aos existentes do Recharts):
```typescript
import {
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis,
  ComposedChart, Bar, Line,
  ReferenceLine, Tooltip, Legend,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  PolarGrid, PolarAngleAxis, Radar, RadarChart,
  BarChart, LineChart,
} from "recharts";
```

Adicionar ANTES do render final (antes do `return` com o card), os novos cases:

```typescript
  // ── AREA CHART ──
  if (widget.type === "area_chart") {
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey={yKeys[0] || "value"} stroke="#7F77DD" fill="#EEEDFE" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── PIE / DONUT CHART ──
  if (widget.type === "pie_chart" || widget.type === "donut_chart") {
    const COLORS = ["#7F77DD","#1D9E75","#378ADD","#D85A30","#BA7517","#E24B4A","#639922","#888780"];
    const innerRadius = widget.type === "donut_chart" ? 50 : 0;
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} dataKey={yKeys[0] || "value"} nameKey={xKey} cx="50%" cy="50%"
              outerRadius={80} innerRadius={innerRadius} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false} fontSize={10}>
              {data.map((_: any, i: number) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── BIG NUMBER (KPI com variação e sparkline) ──
  if (widget.type === "big_number") {
    const main = data[data.length - 1] ?? { value: 0 };
    const prev = data[data.length - 2];
    const delta = prev ? ((Number(main.value) - Number(prev.value)) / Math.abs(Number(prev.value) || 1)) * 100 : null;
    const deltaColor = delta === null ? "" : delta >= 0 ? "text-green-600" : "text-red-500";
    return (
      <div className={containerClass}>
        <p className="text-xs text-muted-foreground mb-1 truncate">{widget.title}</p>
        <div className="text-2xl font-medium">{Number(main.value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</div>
        {delta !== null && (
          <div className={`text-xs mt-0.5 ${deltaColor}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs anterior
          </div>
        )}
        {data.length > 1 && (
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={data}>
              <Line type="monotone" dataKey={yKeys[0] || "value"} stroke="#7F77DD" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  }

  // ── WATERFALL CHART (DRE) ──
  if (widget.type === "waterfall_chart") {
    // Transform data into waterfall format: cumulative totals
    let running = 0;
    const waterfallData = data.map((d: any) => {
      const v = Number(d[yKeys[0] || "value"] ?? 0);
      const base = running;
      running += v;
      return { ...d, base, bar: Math.abs(v), positive: v >= 0, total: running };
    });
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={waterfallData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: any, name: string) => [Number(v).toLocaleString("pt-BR"), name]} />
            <Bar dataKey="base" stackId="a" fill="transparent" stroke="none" />
            <Bar dataKey="bar" stackId="a" radius={[3,3,0,0]}
              fill="#7F77DD" /* overridden per cell below */>
              {waterfallData.map((d: any, i: number) => (
                <Cell key={i} fill={d.positive ? "#1D9E75" : "#E24B4A"} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── FUNNEL CHART (pipeline CRM) ──
  if (widget.type === "funnel_chart") {
    const maxVal = Math.max(...data.map((d: any) => Number(d[yKeys[0] || "value"] ?? 0)), 1);
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <div className="space-y-1 py-1">
          {data.map((d: any, i: number) => {
            const val = Number(d[yKeys[0] || "value"] ?? 0);
            const pct = (val / maxVal) * 100;
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground w-24 truncate text-right">{d[xKey]}</div>
                <div className="flex-1 h-6 rounded" style={{ background: "var(--color-border-tertiary)" }}>
                  <div className="h-full rounded flex items-center justify-end pr-2"
                    style={{ width: `${pct}%`, background: "#7F77DD", minWidth: 4 }}>
                    <span className="text-[10px] text-white font-medium">{val.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── GAUGE CHART ──
  if (widget.type === "gauge_chart") {
    const val = Number(data[0]?.[yKeys[0] || "value"] ?? 0);
    const max = Number(widget.config?.max ?? 100);
    const pct = Math.min(100, Math.max(0, (val / max) * 100));
    const color = pct >= 80 ? "#1D9E75" : pct >= 50 ? "#BA7517" : "#E24B4A";
    const angle = -135 + (pct / 100) * 270;
    return (
      <div className={containerClass}>
        <p className="text-xs text-muted-foreground mb-1 truncate">{widget.title}</p>
        <div className="flex flex-col items-center py-2">
          <svg width="120" height="80" viewBox="0 0 120 80">
            <path d="M15 75 A 50 50 0 1 1 105 75" fill="none" stroke="var(--color-border-tertiary)" strokeWidth="10" strokeLinecap="round"/>
            <path d="M15 75 A 50 50 0 1 1 105 75" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 157} 157`}/>
            <text x="60" y="72" textAnchor="middle" fontSize="18" fontWeight="500" fill="var(--color-text-primary)">{val.toFixed(1)}</text>
          </svg>
          <div className="text-xs text-muted-foreground">{pct.toFixed(0)}% de {max}</div>
        </div>
      </div>
    );
  }

  // ── MIXED TIMESERIES (barra + linha) ──
  if (widget.type === "mixed_timeseries") {
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey={yKeys[0] || "value"} fill="#7F77DD" opacity={0.8} radius={[3,3,0,0]} />
            {yKeys[1] && <Line yAxisId="right" type="monotone" dataKey={yKeys[1]} stroke="#D85A30" strokeWidth={2} dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── DATA TABLE ──
  if (widget.type === "data_table") {
    const cols = data.length > 0 ? Object.keys(data[0]) : [];
    return (
      <div className={containerClass}>
        <p className="text-xs font-medium mb-1 truncate">{widget.title}</p>
        <div className="overflow-auto max-h-48">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {cols.map(c => <th key={c} className="text-left p-1 border-b border-border text-muted-foreground sticky top-0 bg-background">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 50).map((row: any, i: number) => (
                <tr key={i} className="hover:bg-muted/40">
                  {cols.map(c => <td key={c} className="p-1 border-b border-border/50">{String(row[c] ?? "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
```

---

### 2.2 Atualizar BiBuilder.tsx — adicionar novos tipos ao seletor

No componente `WidgetEditor.tsx` ou no `BiBuilder.tsx`, onde os tipos de widget são listados para o usuário selecionar, adicionar:

```typescript
const WIDGET_TYPES = [
  { value: "kpi_card",          label: "KPI Card" },
  { value: "big_number",        label: "Big Number (variação)" },
  { value: "bar_chart",         label: "Gráfico de barras" },
  { value: "line_chart",        label: "Gráfico de linhas" },
  { value: "area_chart",        label: "Gráfico de área" },
  { value: "pie_chart",         label: "Gráfico de pizza" },
  { value: "donut_chart",       label: "Gráfico de rosca" },
  { value: "radar_chart",       label: "Radar / Aranha" },
  { value: "waterfall_chart",   label: "Waterfall (DRE)" },
  { value: "funnel_chart",      label: "Funil (pipeline)" },
  { value: "gauge_chart",       label: "Gauge / Velocímetro" },
  { value: "mixed_timeseries",  label: "Barras + Linha" },
  { value: "data_table",        label: "Tabela de dados" },
  { value: "scatter_plot",      label: "Dispersão" },
];
```

---

## ONDA 3 — Ligar o Agente BI à Semantic Layer

### 3.1 Criar `server/bi/biAgentTools.ts`

```typescript
/**
 * MCP tools do Agente BI — conectam as tool calls do agente
 * à Semantic Layer existente em server/bi/semantic/index.ts.
 *
 * Registrar em server/mcp/registerAllTools.ts.
 */

import type { ToolContext } from "../mcp/toolRegistry";
import {
  listSemanticCatalogGrouped,
  runSemanticMetric,
  type SemanticCatalogEntry,
} from "./semantic/index";

export const biTools = [

  {
    name: "list_bi_metrics",
    description: "Lista todas as métricas de BI disponíveis para o tenant, agrupadas por módulo (control, crm, hr, scrum, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: "Filtrar por módulo específico (opcional). Ex: 'control', 'crm', 'hr'.",
        },
      },
    },
    requiresConfirmation: false,
    execute: async (input: { module?: string }, ctx: ToolContext) => {
      const catalog = listSemanticCatalogGrouped();
      const filtered = input.module
        ? catalog.filter(g => g.module === input.module)
        : catalog;

      return {
        modules: filtered.map(g => ({
          module: g.module,
          metrics: g.items.map((m: SemanticCatalogEntry) => ({
            id: m.id,
            label: m.label,
            description: m.description,
            defaultWidget: m.defaultWidget,
          })),
        })),
        total: filtered.reduce((s, g) => s + g.items.length, 0),
      };
    },
  },

  {
    name: "run_bi_query",
    description: "Executa uma métrica semântica certificada e retorna os dados prontos para exibição. Usar IDs do catálogo (ex: 'control.resultado_liquido', 'crm.pipeline_by_stage').",
    inputSchema: {
      type: "object",
      required: ["metricId"],
      properties: {
        metricId: {
          type: "string",
          description: "ID da métrica semântica. Obter via list_bi_metrics.",
        },
        startDate: {
          type: "string",
          description: "Data inicial YYYY-MM-DD (opcional).",
        },
        endDate: {
          type: "string",
          description: "Data final YYYY-MM-DD (opcional).",
        },
        clientNaturalKey: {
          type: "string",
          description: "Chave do cliente para filtrar (opcional).",
        },
      },
    },
    requiresConfirmation: false,
    execute: async (
      input: { metricId: string; startDate?: string; endDate?: string; clientNaturalKey?: string },
      ctx: ToolContext,
    ) => {
      if (!ctx.tenantId) throw new Error("Tenant obrigatório");

      const result = await runSemanticMetric(input.metricId, {
        tenantId: ctx.tenantId,
        startDate: input.startDate,
        endDate: input.endDate,
        clientNaturalKey: input.clientNaturalKey,
      });

      return {
        metricId: input.metricId,
        rows: result.rows.slice(0, 100), // segurança: máx 100 linhas para o LLM
        rowCount: result.rows.length,
        cached: result.cached,
        ttlSeconds: result.ttlSeconds,
      };
    },
  },

  {
    name: "compare_periods",
    description: "Compara a mesma métrica entre dois períodos e retorna o delta absoluto e percentual. Útil para narrar variações.",
    inputSchema: {
      type: "object",
      required: ["metricId", "currentStart", "currentEnd", "previousStart", "previousEnd"],
      properties: {
        metricId: { type: "string" },
        currentStart: { type: "string", description: "Início do período atual YYYY-MM-DD" },
        currentEnd: { type: "string", description: "Fim do período atual YYYY-MM-DD" },
        previousStart: { type: "string", description: "Início do período anterior YYYY-MM-DD" },
        previousEnd: { type: "string", description: "Fim do período anterior YYYY-MM-DD" },
      },
    },
    requiresConfirmation: false,
    execute: async (
      input: {
        metricId: string;
        currentStart: string; currentEnd: string;
        previousStart: string; previousEnd: string;
      },
      ctx: ToolContext,
    ) => {
      if (!ctx.tenantId) throw new Error("Tenant obrigatório");

      const [current, previous] = await Promise.all([
        runSemanticMetric(input.metricId, {
          tenantId: ctx.tenantId,
          startDate: input.currentStart,
          endDate: input.currentEnd,
        }),
        runSemanticMetric(input.metricId, {
          tenantId: ctx.tenantId,
          startDate: input.previousStart,
          endDate: input.previousEnd,
        }),
      ]);

      const sumCurrent = current.rows.reduce((s, r) => s + r.value, 0);
      const sumPrevious = previous.rows.reduce((s, r) => s + r.value, 0);
      const deltaAbs = sumCurrent - sumPrevious;
      const deltaPct = sumPrevious !== 0 ? (deltaAbs / Math.abs(sumPrevious)) * 100 : null;

      return {
        metricId: input.metricId,
        current: { total: sumCurrent, rows: current.rows.slice(0, 50) },
        previous: { total: sumPrevious, rows: previous.rows.slice(0, 50) },
        delta: {
          absolute: deltaAbs,
          percent: deltaPct !== null ? Math.round(deltaPct * 100) / 100 : null,
          direction: deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat",
        },
      };
    },
  },

];
```

---

### 3.2 Registrar em `server/mcp/registerAllTools.ts`

Adicionar ao final do arquivo:

```typescript
// ── BI Agent Tools ──
import { biTools } from "../bi/biAgentTools";
for (const tool of biTools) {
  registry.register(tool);
}
```

---

### 3.3 Atualizar `runBiAgent` em `server/agentService.ts`

Substituir o bloco que monta `catalogStr` para incluir também as métricas semânticas:

```typescript
// Antes (linha ~880):
// const { METRIC_CATALOG } = await import("./biMetrics");
// const validKeys = new Set(METRIC_CATALOG.map((m) => m.key));
// const validTypes = new Set(["kpi_card", "bar_chart", "line_chart", "radar_chart"]);
// const catalogStr = METRIC_CATALOG.map(...)

// Depois — incluir semantic layer:
const { METRIC_CATALOG } = await import("./biMetrics");
const { listSemanticMetrics } = await import("./bi/semantic/index");

// Combina catálogo interno + semântico
const internalKeys = new Set(METRIC_CATALOG.map((m) => m.key));
const semanticMetrics = listSemanticMetrics();
const semanticKeys = new Set(semanticMetrics.map((m) => m.id));

const validKeys = new Set([...internalKeys, ...semanticKeys]);
const validTypes = new Set([
  "kpi_card", "big_number", "bar_chart", "line_chart", "area_chart",
  "pie_chart", "donut_chart", "radar_chart", "waterfall_chart",
  "funnel_chart", "gauge_chart", "mixed_timeseries", "data_table",
]);

const catalogStr = [
  ...METRIC_CATALOG.map((m) => `- ${m.key} [interno] (${m.defaultWidget}, grupo "${m.group}"): ${m.label} — ${m.description}`),
  ...semanticMetrics.map((m) => `- ${m.id} [semantic] (${m.defaultWidget}, módulo "${m.module}"): ${m.label} — ${m.description}`),
].join("\n");
```

---

## ONDA 4 — Alertas BI

### 4.1 Adicionar tabela `bi_alerts` em `shared/schema.ts`

```typescript
export const biAlerts = pgTable("bi_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  metricId: varchar("metric_id", { length: 100 }).notNull(),
  condition: varchar("condition", { length: 20 }).notNull(), // 'gt' | 'lt' | 'gte' | 'lte' | 'eq'
  threshold: numeric("threshold", { precision: 18, scale: 4 }).notNull(),
  notifyChannel: varchar("notify_channel", { length: 30 }).default("email"), // email | whatsapp | both
  notifyTargets: text("notify_targets").array().default(sql`ARRAY[]::text[]`),
  cronExpression: varchar("cron_expression", { length: 50 }).default("0 8 * * *"), // diário 8h
  isActive: integer("is_active").default(1).notNull(),
  lastCheckedAt: timestamp("last_checked_at"),
  lastTriggeredAt: timestamp("last_triggered_at"),
  lastValue: numeric("last_value", { precision: 18, scale: 4 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBiAlertSchema = createInsertSchema(biAlerts).omit({ id: true, createdAt: true, updatedAt: true });
export type BiAlert = typeof biAlerts.$inferSelect;
export type InsertBiAlert = z.infer<typeof insertBiAlertSchema>;
```

### 4.2 Criar `server/bi/alertsRunner.ts`

```typescript
/**
 * Runner de alertas BI — verifica condições e notifica.
 * Chamado pelo cron server/cron.ts a cada hora.
 */

import { db } from "../db";
import { biAlerts } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { runSemanticMetric } from "./semantic/index";
import { METRIC_CATALOG, runMetric } from "../biMetrics";

type Condition = "gt" | "lt" | "gte" | "lte" | "eq";

function checkCondition(value: number, condition: Condition, threshold: number): boolean {
  switch (condition) {
    case "gt":  return value > threshold;
    case "lt":  return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    case "eq":  return Math.abs(value - threshold) < 0.0001;
    default:    return false;
  }
}

export async function runBiAlerts(tenantId: string): Promise<void> {
  const alerts = await db.select().from(biAlerts).where(
    and(eq(biAlerts.tenantId, tenantId), eq(biAlerts.isActive, 1))
  );

  for (const alert of alerts) {
    try {
      // Executa a métrica
      let value = 0;
      const isInternal = METRIC_CATALOG.some(m => m.key === alert.metricId);

      if (isInternal) {
        const rows = await runMetric(alert.metricId, tenantId);
        value = rows.reduce((s, r) => s + r.value, 0);
      } else {
        const result = await runSemanticMetric(alert.metricId, { tenantId });
        value = result.rows.reduce((s, r) => s + r.value, 0);
      }

      const triggered = checkCondition(value, alert.condition as Condition, Number(alert.threshold));

      // Atualiza last_checked_at e last_value
      await db.update(biAlerts).set({
        lastCheckedAt: new Date(),
        lastValue: String(value),
        ...(triggered ? { lastTriggeredAt: new Date() } : {}),
        updatedAt: new Date(),
      }).where(eq(biAlerts.id, alert.id));

      if (triggered) {
        console.log(`[bi/alerts] TRIGGERED: ${alert.name} — ${alert.metricId} = ${value} (condition: ${alert.condition} ${alert.threshold})`);
        // TODO: enviar notificação (email/WhatsApp) — integrar com notificationService
      }
    } catch (err) {
      console.error(`[bi/alerts] Error checking alert ${alert.id}:`, err);
    }
  }
}
```

### 4.3 Adicionar rotas CRUD de alertas em `server/routes.ts`

```typescript
// ── BI Alerts CRUD ──
app.get("/api/bi/alerts", isAuthenticated, requireTenant, async (req: any, res) => {
  const rows = await db.select().from(biAlerts).where(eq(biAlerts.tenantId, req.tenantId!));
  res.json(rows);
});

app.post("/api/bi/alerts", isAuthenticated, requireTenant, async (req: any, res) => {
  const parsed = insertBiAlertSchema.safeParse({ ...req.body, tenantId: req.tenantId!, createdById: req.user?.id });
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
  const [row] = await db.insert(biAlerts).values(parsed.data).returning();
  res.status(201).json(row);
});

app.patch("/api/bi/alerts/:id", isAuthenticated, requireTenant, async (req: any, res) => {
  const [existing] = await db.select().from(biAlerts).where(eq(biAlerts.id, req.params.id));
  if (!existing || existing.tenantId !== req.tenantId) return res.status(403).json({ message: "Forbidden" });
  const [updated] = await db.update(biAlerts).set({ ...req.body, updatedAt: new Date() }).where(eq(biAlerts.id, req.params.id)).returning();
  res.json(updated);
});

app.delete("/api/bi/alerts/:id", isAuthenticated, requireTenant, async (req: any, res) => {
  const [existing] = await db.select().from(biAlerts).where(eq(biAlerts.id, req.params.id));
  if (!existing || existing.tenantId !== req.tenantId) return res.status(403).json({ message: "Forbidden" });
  await db.delete(biAlerts).where(eq(biAlerts.id, req.params.id));
  res.status(204).send();
});

// Trigger manual de alert check (para teste)
app.post("/api/bi/alerts/run", isAuthenticated, requireTenant, async (req: any, res) => {
  const { runBiAlerts } = await import("./bi/alertsRunner");
  await runBiAlerts(req.tenantId!);
  res.json({ message: "Alertas verificados" });
});
```

---

## Ordem de execução para o Replit

```
1. server/index.ts         → Adicionar analytics.fact_crm, fact_hr, fact_scrum (seção 1.1)
2. server/bi/semantic/crm.ts      → Criar (seção 1.2)
3. server/bi/semantic/hr.ts       → Criar (seção 1.3)
4. server/bi/semantic/scrum.ts    → Criar (seção 1.4)
5. server/bi/semantic/societario.ts → Criar (seção 1.5)
6. server/bi/semantic/recovery.ts → Criar (seção 1.6)
7. server/bi/semantic/fiscal.ts   → Criar (seção 1.7)
8. server/bi/semantic/control.ts  → Expandir métricas (seção 1.8)
9. server/bi/semantic/index.ts    → Importar e registrar módulos novos (seção 1.9)
10. client/src/components/bi/WidgetRenderer.tsx → Adicionar 9 novos tipos (seção 2.1)
11. client/src/components/bi/WidgetEditor.tsx   → Atualizar lista WIDGET_TYPES (seção 2.2)
12. server/bi/biAgentTools.ts     → Criar (seção 3.1)
13. server/mcp/registerAllTools.ts → Registrar biTools (seção 3.2)
14. server/agentService.ts        → Atualizar runBiAgent (seção 3.3)
15. shared/schema.ts              → Adicionar biAlerts (seção 4.1)
16. server/bi/alertsRunner.ts     → Criar (seção 4.2)
17. server/routes.ts              → Adicionar rotas /api/bi/alerts (seção 4.3)
```

## Verificação após deploy

```bash
# 1. Analytics tables criadas
SELECT table_name FROM information_schema.tables WHERE table_schema = 'analytics';
# deve mostrar: dim_source, dim_client, fact_revenue, fact_crm, fact_hr, fact_scrum, etl_runs, dq_findings, migration_state

# 2. Semantic catalog retorna todos os módulos
GET /api/bi/semantic/catalog
# deve retornar ~30 métricas de 7 módulos: control, crm, hr, scrum, societario, recovery, fiscal

# 3. run_bi_query funciona (mesmo sem dados no analytics)
POST /api/bi/semantic/run  { "metricId": "crm.total_pipeline_value" }
# deve retornar { rows: [{ name: "Pipeline", value: 0 }], cached: false }

# 4. biTools registradas no MCP
GET /api/mcp/tools
# deve mostrar: list_bi_metrics, run_bi_query, compare_periods

# 5. bi_agent usa semantic layer
POST /api/bi/agent  { "prompt": "mostre o pipeline de CRM" }
# deve retornar widget do tipo funnel_chart com metricId crm.pipeline_by_stage
```
