/**
 * Semantic Layer (TS-only) — Fase 3 BI Multi-Fonte.
 *
 * **Cube.js está PROIBIDO** por decisão de arquitetura registrada em
 * `task-32.md` ("Restrições inegociáveis"). Esta camada é 100% TS,
 * versionada em Git, carregada em runtime pelo backend.
 *
 * Cada arquivo em `server/bi/semantic/<modulo>.ts` exporta `metrics` e
 * (opcionalmente) `dimensions`. O `index.ts` consolida o catálogo.
 *
 * As métricas escrevem SQL contra `analytics.*` (schema materializado
 * por `runEtl`). Nunca contra as fontes originais (que ficam intocadas).
 */

export interface SemanticContext {
  tenantId: string;
  /**
   * Quando o usuário pede "combine 2+ fontes", a UI envia aqui a lista
   * dos `data_source_id` selecionados. A query usa
   * `WHERE source_data_source_id = ANY($sources)`. Se vazio, considera
   * todas.
   */
  sources?: string[];
  /** Filtros globais do dashboard (data range etc.). */
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  clientNaturalKey?: string;
}

export interface MetricRow {
  name: string;
  value: number;
  /** Para combinar séries, indica qual fonte gerou esta linha. */
  series?: string;
}

export interface SemanticMetric {
  /** Identificador estável, ex.: "control.revenue_by_period". */
  id: string;
  /** Nome curto para a UI. */
  label: string;
  /** Texto exibido no tooltip do catálogo. */
  description: string;
  /** Módulo lógico (control, crm, projects...). */
  module: string;
  /** Widget sugerido na UI. */
  defaultWidget:
    | "kpi_card" | "bar_chart" | "line_chart" | "radar_chart"
    | "area_chart" | "pie_chart" | "donut_chart" | "big_number"
    | "waterfall_chart" | "funnel_chart" | "gauge_chart"
    | "mixed_timeseries" | "data_table" | "scatter_plot";
  /** Quanto tempo o resultado pode ser servido pelo cache. */
  cacheTtlSeconds: number;
  /**
   * Constrói a query. O `ctx.tenantId` é injetado e validado a montante;
   * SemanticMetric NUNCA deve concatenar valores não validados.
   */
  buildQuery: (ctx: SemanticContext) => SemanticQuery;
}

export interface SemanticQuery {
  /** SQL final, sempre `SELECT name, value [, series]` ou colunas livres. */
  sql: string;
  /**
   * Quando true, o runner trata a saída como séries multi-coluna
   * (qualquer coluna numérica vira value; primeira coluna texto vira name).
   */
  freeform?: boolean;
}

export interface SemanticDimension {
  id: string;
  label: string;
  module: string;
  table: string;        // "analytics.dim_client"
  naturalKey: string;   // "natural_key"
  displayColumn: string; // "name"
}
