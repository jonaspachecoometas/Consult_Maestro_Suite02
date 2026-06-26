/**
 * Módulo semântico "estoque" — métricas baseadas em regras do ERPNext.
 *
 * Fonte primária: analytics.atlas_produtos + analytics.atlas_pedido_produtos
 *                 + analytics.atlas_pedidos (vendas confirmadas: status_id=14).
 *
 * Algoritmos extraídos de:
 *   - erpnext/stock/valuation.py            (FIFO / Moving Average)
 *   - erpnext/stock/report/stock_balance    (saldo, in_qty, out_qty)
 *   - erpnext/stock/report/stock_ageing     (idade média FIFO)
 *   - erpnext/stock/report/itemwise_recommended_reorder_level
 *
 * Custo unitário: priorizar `pedido_produtos.valor_custo` (snapshot da venda)
 * com fallback para `atlas_produtos.valor_custo` (atual).
 *
 * TODO: BOM (lista de materiais) e FIFO real (consumo de bins).
 */
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

export const metrics: SemanticMetric[] = [
  // ── SALDO ──────────────────────────────────────────────────────────────────
  {
    id: "estoque.saldo_atual_por_produto",
    label: "Saldo de estoque atual por produto",
    description: "Saldo atual (unidades) dos produtos ativos.",
    module: "estoque",
    defaultWidget: "data_table",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, pr.codigo_comercial, 'P-' || pr.id::text) AS name,
               pr.saldo_estoque::float AS value
          FROM analytics.atlas_produtos pr
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true
         ORDER BY value DESC
         LIMIT 200
      `,
    }),
  },
  {
    id: "estoque.valor_total_em_estoque",
    label: "Valor total do estoque (R$)",
    description: "Σ (saldo_estoque × valor_custo). KPI de capital imobilizado.",
    module: "estoque",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Estoque total' AS name,
               COALESCE(ROUND(SUM(saldo_estoque * COALESCE(NULLIF(valor_custo, 'NaN'::numeric), 0))::numeric, 2), 0)::float AS value
          FROM analytics.atlas_produtos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ativo = true AND saldo_estoque > 0
      `,
    }),
  },
  {
    id: "estoque.valor_estoque_por_grupo",
    label: "Valor de estoque por grupo de produto",
    description: "Capital imobilizado distribuído por grupo/categoria.",
    module: "estoque",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(g.nome, 'Sem grupo') AS name,
               COALESCE(ROUND(SUM(pr.saldo_estoque * COALESCE(NULLIF(pr.valor_custo, 'NaN'::numeric), 0))::numeric, 2), 0)::float AS value
          FROM analytics.atlas_produtos pr
          LEFT JOIN analytics.atlas_grupos_produtos g
                 ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true AND pr.saldo_estoque > 0
         GROUP BY 1 ORDER BY value DESC LIMIT 20
      `,
    }),
  },
  // ── RUPTURA & PARADO ───────────────────────────────────────────────────────
  {
    id: "estoque.produtos_sem_estoque",
    label: "Produtos sem estoque (ruptura)",
    description: "Produtos ativos com saldo_estoque ≤ 0. Risco de ruptura.",
    module: "estoque",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Ruptura' AS name, COUNT(*)::float AS value
          FROM analytics.atlas_produtos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ativo = true AND saldo_estoque <= 0
      `,
    }),
  },
  {
    id: "estoque.produtos_sem_giro_90d",
    label: "Produtos sem giro em 90 dias",
    description: "Produtos com saldo > 0 mas sem venda nos últimos 90 dias.",
    module: "estoque",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Sem giro 90d' AS name, COUNT(*)::float AS value
          FROM analytics.atlas_produtos pr
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true AND pr.saldo_estoque > 0
           AND NOT EXISTS (
                 SELECT 1 FROM analytics.atlas_pedido_produtos pp
                   JOIN analytics.atlas_pedidos ped
                     ON ped.id = pp.pedido_id
                    AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
                  WHERE pp.produto_id = pr.id
                    AND pp.arcadia_tenant_id = pr.arcadia_tenant_id
                    AND ped.status_id = 14
                    AND ped.data_pedido >= NOW() - INTERVAL '90 days'
           )
      `,
    }),
  },
  // ── GIRO (regra ERPNext: CMV / estoque_médio) ──────────────────────────────
  {
    id: "estoque.giro_por_produto",
    label: "Giro de estoque por produto (Top 30)",
    description: "qty_vendida_período / saldo_atual. Maior = gira mais rápido.",
    module: "estoque",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH vendas AS (
          SELECT pp.produto_id, SUM(pp.quantidade) AS qty_vendida
            FROM analytics.atlas_pedido_produtos pp
            JOIN analytics.atlas_pedidos ped
              ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
           GROUP BY pp.produto_id
        )
        SELECT COALESCE(pr.nome, pr.apelido, 'P-' || v.produto_id::text) AS name,
               ROUND((v.qty_vendida / NULLIF(pr.saldo_estoque, 0))::numeric, 2)::float AS value
          FROM vendas v
          JOIN analytics.atlas_produtos pr
            ON pr.id = v.produto_id
           AND pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         WHERE pr.saldo_estoque > 0
         ORDER BY value DESC NULLS LAST LIMIT 30
      `,
    }),
  },
  {
    id: "estoque.dias_de_estoque",
    label: "Dias de estoque médio por grupo",
    description: "saldo_atual / consumo_diário_médio (janela 90d). Quantos dias o estoque dura.",
    module: "estoque",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH consumo AS (
          SELECT pp.produto_id, SUM(pp.quantidade) / 90.0 AS consumo_diario
            FROM analytics.atlas_pedido_produtos pp
            JOIN analytics.atlas_pedidos ped
              ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             AND ped.data_pedido >= NOW() - INTERVAL '90 days'
           GROUP BY pp.produto_id
        )
        SELECT COALESCE(g.nome, 'Sem grupo') AS name,
               ROUND(AVG(pr.saldo_estoque / NULLIF(c.consumo_diario, 0))::numeric, 0)::float AS value
          FROM analytics.atlas_produtos pr
          JOIN consumo c ON c.produto_id = pr.id
          LEFT JOIN analytics.atlas_grupos_produtos g
                 ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.saldo_estoque > 0
         GROUP BY 1 ORDER BY value ASC NULLS LAST
      `,
    }),
  },
  // ── CURVA ABC POR VALOR DE ESTOQUE (regra ERPNext: acumulado / total) ─────
  {
    id: "estoque.curva_abc_valor",
    label: "Curva ABC por valor de estoque",
    description: "A=80% do valor total, B=15%, C=5%. Identifica onde está o capital imobilizado.",
    module: "estoque",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH valor_produto AS (
          SELECT id, saldo_estoque * COALESCE(NULLIF(valor_custo, 'NaN'::numeric), 0) AS valor_estoque
            FROM analytics.atlas_produtos
           WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ativo = true AND saldo_estoque > 0
        ),
        ranked AS (
          SELECT id, valor_estoque,
                 SUM(valor_estoque) OVER ()                              AS total,
                 SUM(valor_estoque) OVER (ORDER BY valor_estoque DESC)   AS acumulado
            FROM valor_produto
        )
        SELECT
          CASE
            WHEN total = 0 THEN 'Sem dados'
            WHEN acumulado / NULLIF(total, 0) <= 0.80 THEN 'A — Capital crítico (80%)'
            WHEN acumulado / NULLIF(total, 0) <= 0.95 THEN 'B — Capital médio (15%)'
            ELSE 'C — Capital baixo (5%)'
          END AS name,
          COUNT(*)::float AS value
          FROM ranked
         GROUP BY 1 ORDER BY 1
      `,
    }),
  },
  // ── TOP PARADOS POR VALOR ──────────────────────────────────────────────────
  {
    id: "estoque.top_estoque_parado_valor",
    label: "Top 20 produtos parados por valor",
    description: "Produtos sem giro em 90 dias ordenados por valor imobilizado.",
    module: "estoque",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, pr.codigo_comercial, 'P-' || pr.id::text) AS name,
               ROUND((pr.saldo_estoque * COALESCE(NULLIF(pr.valor_custo, 'NaN'::numeric), 0))::numeric, 2)::float AS value
          FROM analytics.atlas_produtos pr
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true AND pr.saldo_estoque > 0
           AND NOT EXISTS (
                 SELECT 1 FROM analytics.atlas_pedido_produtos pp
                   JOIN analytics.atlas_pedidos ped
                     ON ped.id = pp.pedido_id
                    AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
                  WHERE pp.produto_id = pr.id
                    AND pp.arcadia_tenant_id = pr.arcadia_tenant_id
                    AND ped.status_id = 14
                    AND ped.data_pedido >= NOW() - INTERVAL '90 days'
           )
         ORDER BY value DESC LIMIT 20
      `,
    }),
  },
  // ── PONTO DE REPOSIÇÃO (proxy: saldo < consumo_30d) ────────────────────────
  {
    id: "estoque.produtos_abaixo_ponto_reposicao",
    label: "Produtos abaixo do ponto de reposição",
    description: "Produtos cujo saldo atual está abaixo do consumo de 30 dias (proxy do reorder_level).",
    module: "estoque",
    defaultWidget: "data_table",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH consumo_30d AS (
          SELECT pp.produto_id, SUM(pp.quantidade) AS qty_30d
            FROM analytics.atlas_pedido_produtos pp
            JOIN analytics.atlas_pedidos ped
              ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             AND ped.data_pedido >= NOW() - INTERVAL '30 days'
           GROUP BY pp.produto_id
        )
        SELECT COALESCE(pr.nome, pr.apelido, 'P-' || pr.id::text) AS name,
               pr.saldo_estoque::float AS value
          FROM analytics.atlas_produtos pr
          JOIN consumo_30d c ON c.produto_id = pr.id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true
           AND pr.saldo_estoque < c.qty_30d
           AND pr.saldo_estoque > 0
         ORDER BY pr.saldo_estoque ASC LIMIT 50
      `,
    }),
  },
];
