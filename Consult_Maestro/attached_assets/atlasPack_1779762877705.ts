/**
 * Dashboard Pack — Atlas ERP Autopeças
 *
 * Template de dashboard pronto para ser instalado por qualquer tenant
 * que tenha o DatasetAtlas configurado. Exportável para o AppStore.
 *
 * Uso:
 *   import { ATLAS_DASHBOARD_PACK } from "./atlasPack";
 *   // salvar como BiDashboard no banco para o tenant
 */

import type { WidgetConfig } from "../../../shared/schema";

export interface DashboardPack {
  slug: string;
  name: string;
  description: string;
  category: string;
  requiredDataset: string; // 'atlas'
  tags: string[];
  dashboards: {
    name: string;
    description: string;
    layout: WidgetConfig[];
  }[];
}

// Helpers de posicionamento no grid (12 colunas, 1 unit = ~80px)
const pos = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

// ── Dashboard 1: Visão Executiva ──────────────────────────────────────────────
const EXECUTIVE_DASHBOARD: WidgetConfig[] = [
  // Row 1: KPIs
  {
    id: "atlas-kpi-receita",
    type: "big_number" as any,
    title: "Receita total (mês atual)",
    gridPos: pos(0, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-kpi-ticket",
    type: "big_number" as any,
    title: "Ticket médio",
    gridPos: pos(3, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.ticket_medio" },
  },
  {
    id: "atlas-kpi-inadimplencia",
    type: "big_number" as any,
    title: "Inadimplência (R$)",
    gridPos: pos(6, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.inadimplencia_valor" },
  },
  {
    id: "atlas-kpi-abc",
    type: "pie_chart" as any,
    title: "Curva ABC — distribuição",
    gridPos: pos(9, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },

  // Row 2: Receita temporal + Top clientes
  {
    id: "atlas-receita-periodo",
    type: "area_chart" as any,
    title: "Receita mensal de vendas",
    gridPos: pos(0, 2, 7, 4),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-top-clientes",
    type: "bar_chart",
    title: "Top 15 clientes por receita",
    gridPos: pos(7, 2, 5, 4),
    dataSource: { type: "semantic", metricId: "atlas.top_clientes" },
  },

  // Row 3: Contas a receber
  {
    id: "atlas-cr-vencimento",
    type: "bar_chart",
    title: "Contas a receber por vencimento",
    gridPos: pos(0, 6, 12, 3),
    dataSource: { type: "semantic", metricId: "atlas.contas_a_receber_por_vencimento" },
  },
];

// ── Dashboard 2: Análise de Produtos ─────────────────────────────────────────
const PRODUCTS_DASHBOARD: WidgetConfig[] = [
  // Row 1: Curva ABC (grande) + Estoque por grupo
  {
    id: "atlas-abc-grande",
    type: "pie_chart" as any,
    title: "Curva ABC de produtos",
    gridPos: pos(0, 0, 4, 4),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },
  {
    id: "atlas-estoque-grupo",
    type: "bar_chart",
    title: "Estoque por grupo de produto",
    gridPos: pos(4, 0, 8, 4),
    dataSource: { type: "semantic", metricId: "atlas.estoque_por_grupo" },
  },

  // Row 2: Top produtos + Margem
  {
    id: "atlas-top-produtos",
    type: "bar_chart",
    title: "Top 20 produtos — quantidade vendida",
    gridPos: pos(0, 4, 6, 5),
    dataSource: { type: "semantic", metricId: "atlas.top_produtos_vendidos" },
  },
  {
    id: "atlas-margem",
    type: "bar_chart",
    title: "Margem bruta por produto (Top 20)",
    gridPos: pos(6, 4, 6, 5),
    dataSource: { type: "semantic", metricId: "atlas.margem_por_produto" },
  },
];

// ── Dashboard 3: Financeiro ───────────────────────────────────────────────────
const FINANCIAL_DASHBOARD: WidgetConfig[] = [
  {
    id: "atlas-fin-inadimplencia-kpi",
    type: "kpi_card",
    title: "Valor inadimplente (R$)",
    gridPos: pos(0, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.inadimplencia_valor" },
  },
  {
    id: "atlas-fin-ticket-kpi",
    type: "kpi_card",
    title: "Ticket médio de pedidos",
    gridPos: pos(4, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.ticket_medio" },
  },
  {
    id: "atlas-fin-abc-kpi",
    type: "pie_chart" as any,
    title: "Concentração de receita (ABC)",
    gridPos: pos(8, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },
  {
    id: "atlas-fin-receita",
    type: "mixed_timeseries" as any,
    title: "Receita realizada por mês",
    gridPos: pos(0, 2, 12, 4),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-fin-cr",
    type: "bar_chart",
    title: "Contas a receber — vencimento",
    gridPos: pos(0, 6, 6, 4),
    dataSource: { type: "semantic", metricId: "atlas.contas_a_receber_por_vencimento" },
  },
  {
    id: "atlas-fin-clientes",
    type: "bar_chart",
    title: "Concentração de receita por cliente",
    gridPos: pos(6, 6, 6, 4),
    dataSource: { type: "semantic", metricId: "atlas.top_clientes" },
  },
];

// ── Pack completo ─────────────────────────────────────────────────────────────
export const ATLAS_DASHBOARD_PACK: DashboardPack = {
  slug: "atlas-autopecas",
  name: "Atlas ERP — Autopeças",
  description: "Dashboards executivos para distribuidores e varejistas de autopeças usando o Atlas ERP. Inclui análise de vendas, curva ABC, estoque por grupo, inadimplência e contas a receber.",
  category: "ERP Integrado",
  requiredDataset: "atlas",
  tags: ["autopeças", "atlas", "vendas", "estoque", "financeiro", "curva ABC"],
  dashboards: [
    {
      name: "Visão Executiva — Atlas",
      description: "KPIs gerenciais: receita, ticket médio, inadimplência, curva ABC e contas a receber.",
      layout: EXECUTIVE_DASHBOARD,
    },
    {
      name: "Análise de Produtos — Atlas",
      description: "Curva ABC detalhada, estoque por grupo, top produtos vendidos e margem bruta.",
      layout: PRODUCTS_DASHBOARD,
    },
    {
      name: "Financeiro — Atlas",
      description: "Receita realizada, inadimplência, contas a receber por vencimento e concentração por cliente.",
      layout: FINANCIAL_DASHBOARD,
    },
  ],
};
