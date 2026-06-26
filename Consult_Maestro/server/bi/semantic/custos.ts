/**
 * Módulo semântico "custos" — CMV, margem bruta e formação de preço.
 *
 * Algoritmos extraídos de:
 *   - erpnext/accounts/report/gross_profit/gross_profit.py
 *       gross_profit         = base_amount - buying_amount
 *       gross_profit_percent = gross_profit / base_amount × 100
 *   - erpnext/accounts/doctype/pricing_rule/utils.py
 *       margem_pct = (preco - custo) / preco × 100   (sobre venda)
 *       markup_pct = (preco - custo) / custo × 100   (sobre custo)
 *   - erpnext/stock/valuation.py (Moving Average)
 *
 * CMV (COGS): Σ qty × COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0).
 * Vendas válidas: atlas_pedidos.status_id = 14 (entregue/faturado).
 * Markup ≠ margem — não confundir.
 */
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

const CMV_JOINS = `
    FROM analytics.atlas_pedido_produtos pp
    JOIN analytics.atlas_pedidos ped
      ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
    LEFT JOIN analytics.atlas_produtos pr
      ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
`;

export const metrics: SemanticMetric[] = [
  // ── CMV (COGS) ─────────────────────────────────────────────────────────────
  {
    id: "custos.cmv_por_mes",
    label: "CMV por mês",
    description: "Custo das Mercadorias Vendidas: Σ qty × valor_custo unitário. Regra cogs_by_item_group.",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', ped.data_pedido), 'YYYY-MM') AS name,
               SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))::float AS value
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "custos.cmv_total_periodo",
    label: "CMV total do período",
    description: "KPI: total do CMV no período selecionado.",
    module: "custos",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'CMV' AS name,
               COALESCE(SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0)), 0)::float AS value
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  // ── MARGEM BRUTA (gross_profit.py) ─────────────────────────────────────────
  {
    id: "custos.margem_bruta_por_mes",
    label: "Margem bruta por mês (%)",
    description: "(Receita − CMV) / Receita × 100. gross_profit_percent do ERPNext.",
    module: "custos",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', ped.data_pedido), 'YYYY-MM') AS name,
               ROUND(100.0 * (
                 SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
               ) / NULLIF(SUM(pp.valor_total), 0)::numeric, 2)::float AS value
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "custos.margem_bruta_total",
    label: "Margem bruta total (%)",
    description: "KPI consolidado: (Receita − CMV) / Receita × 100 no período.",
    module: "custos",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Margem bruta' AS name,
               COALESCE(ROUND(100.0 * (
                 SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
               ) / NULLIF(SUM(pp.valor_total), 0)::numeric, 2), 0)::float AS value
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "custos.margem_por_produto",
    label: "Margem bruta por produto (Top 30)",
    description: "Margem % por produto. Grupo item_code do gross_profit.py.",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, 'P-' || pp.produto_id::text) AS name,
               ROUND(100.0 * (
                 SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
               ) / NULLIF(SUM(pp.valor_total), 0)::numeric, 2)::float AS value
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           AND pp.valor_total > 0
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY pp.produto_id, pr.nome, pr.apelido
         ORDER BY value DESC NULLS LAST LIMIT 30
      `,
    }),
  },
  {
    id: "custos.margem_por_grupo",
    label: "Margem bruta por grupo de produto",
    description: "Margem % consolidada por categoria. Equivalente a item_group.",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(g.nome, 'Sem grupo') AS name,
               ROUND(100.0 * (
                 SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
               ) / NULLIF(SUM(pp.valor_total), 0)::numeric, 2)::float AS value
        ${CMV_JOINS}
          LEFT JOIN analytics.atlas_grupos_produtos g
                 ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY value DESC NULLS LAST
      `,
    }),
  },
  {
    id: "custos.margem_por_cliente",
    label: "Margem bruta por cliente (Top 20)",
    description: "Margem % por cliente. Equivalente ao grupo customer do gross_profit.py.",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'C-' || ped.cliente_id::text) AS name,
               ROUND(100.0 * (
                 SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
               ) / NULLIF(SUM(pp.valor_total), 0)::numeric, 2)::float AS value
        ${CMV_JOINS}
          LEFT JOIN analytics.atlas_pessoas p
                 ON p.id = ped.cliente_id AND p.arcadia_tenant_id = ped.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY ped.cliente_id, p.nome_fantasia, p.nome, p.razao_social
         ORDER BY value DESC NULLS LAST LIMIT 20
      `,
    }),
  },
  {
    id: "custos.produtos_abaixo_margem_minima",
    label: "Produtos com margem abaixo de 15%",
    description: "Produtos vendidos com margem bruta < 15%. Alerta de precificação.",
    module: "custos",
    defaultWidget: "data_table",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH margem_produto AS (
          SELECT pp.produto_id,
                 ROUND(100.0 * (SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0)))
                       / NULLIF(SUM(pp.valor_total), 0)::numeric, 2) AS margem_pct,
                 pr.nome AS produto_nome
          ${CMV_JOINS}
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             AND pp.valor_total > 0
             ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
           GROUP BY pp.produto_id, pr.nome
        )
        SELECT COALESCE(produto_nome, 'P-' || produto_id::text) AS name,
               margem_pct::float AS value
          FROM margem_produto
         WHERE margem_pct < 15
         ORDER BY margem_pct ASC NULLS LAST LIMIT 50
      `,
    }),
  },
  // ── FORMAÇÃO DE PREÇO (pricing_rule.py) ────────────────────────────────────
  {
    id: "custos.analise_markup_por_produto",
    label: "Markup por produto (preço/custo)",
    description: "markup = (preco_venda − custo) / custo × 100. Regra pricing_rule.py.",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, pr.codigo_comercial, 'P-' || pr.id::text) AS name,
               ROUND(100.0 * (pr.preco_venda - COALESCE(NULLIF(pr.valor_custo, 'NaN'::numeric), 0))
                     / NULLIF(NULLIF(pr.valor_custo, 'NaN'::numeric), 0)::numeric, 2)::float AS value
          FROM analytics.atlas_produtos pr
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true
           AND pr.preco_venda > 0
           AND pr.valor_custo > 0 AND pr.valor_custo <> 'NaN'::numeric
         ORDER BY value DESC NULLS LAST LIMIT 30
      `,
    }),
  },
  {
    id: "custos.analise_margem_vs_markup",
    label: "Distribuição de margem (% sobre venda)",
    description: "Distribuição dos produtos por faixa de margem % (sobre venda).",
    module: "custos",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT CASE
                 WHEN margem_pct < 0   THEN '1 — Negativa'
                 WHEN margem_pct < 10  THEN '2 — 0-10%'
                 WHEN margem_pct < 20  THEN '3 — 10-20%'
                 WHEN margem_pct < 30  THEN '4 — 20-30%'
                 WHEN margem_pct < 40  THEN '5 — 30-40%'
                 ELSE                       '6 — > 40%'
               END AS name,
               COUNT(*)::float AS value
          FROM (
            SELECT ROUND(100.0 * (preco_venda - COALESCE(NULLIF(valor_custo, 'NaN'::numeric), 0))
                         / NULLIF(NULLIF(preco_venda, 'NaN'::numeric), 0)::numeric, 2) AS margem_pct
              FROM analytics.atlas_produtos
             WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
               AND ativo = true AND preco_venda > 0 AND valor_custo > 0 AND valor_custo <> 'NaN'::numeric
          ) t
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  {
    id: "custos.receita_vs_cmv_por_mes",
    label: "Receita vs CMV por mês",
    description: "Receita bruta (barra) + CMV (linha). Visualiza evolução da pressão de custo.",
    module: "custos",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', ped.data_pedido), 'YYYY-MM') AS name,
               SUM(pp.valor_total)::float AS value,
               SUM(pp.quantidade * COALESCE(NULLIF(pp.valor_custo, 'NaN'::numeric), NULLIF(pr.valor_custo, 'NaN'::numeric), 0))::float AS series
        ${CMV_JOINS}
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1 ORDER BY 1
      `,
      freeform: true,
    }),
  },
];
