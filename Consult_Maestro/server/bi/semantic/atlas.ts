/**
 * Semantic Layer — módulo "atlas" (ERP autopeças).
 * Lê de analytics.atlas_* (staging populado pelos connectors).
 */
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

export const metrics: SemanticMetric[] = [
  {
    id: "atlas.receita_por_periodo",
    label: "Receita de vendas por mês (Atlas)",
    description: "Pedidos entregues (status=14) agrupados por mês.",
    module: "atlas",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_pedido), 'YYYY-MM') AS name,
               SUM(valor_total)::float AS value
          FROM analytics.atlas_pedidos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status_id = 14
           ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "atlas.ticket_medio",
    label: "Ticket médio de pedidos",
    description: "Valor médio por pedido entregue.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Ticket médio' AS name,
               COALESCE(ROUND(AVG(valor_total), 2), 0)::float AS value
          FROM analytics.atlas_pedidos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status_id = 14
           ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
      `,
    }),
  },
  {
    id: "atlas.top_clientes",
    label: "Top 15 clientes por receita",
    description: "Clientes com maior volume de pedidos entregues.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Cliente ' || ped.cliente_id::text) AS name,
               SUM(ped.valor_total)::float AS value
          FROM analytics.atlas_pedidos ped
          LEFT JOIN analytics.atlas_pessoas p
                 ON p.id = ped.cliente_id AND p.arcadia_tenant_id = ped.arcadia_tenant_id
         WHERE ped.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC NULLS LAST
         LIMIT 15
      `,
    }),
  },
  {
    id: "atlas.top_produtos_vendidos",
    label: "Top 20 produtos mais vendidos",
    description: "Produtos por quantidade vendida em pedidos entregues.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, 'Produto ' || pp.produto_id::text) AS name,
               SUM(pp.quantidade)::float AS value
          FROM analytics.atlas_pedido_produtos pp
          JOIN analytics.atlas_pedidos ped
            ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
          LEFT JOIN analytics.atlas_produtos pr
            ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC NULLS LAST
         LIMIT 20
      `,
    }),
  },
  {
    id: "atlas.margem_por_produto",
    label: "Margem por produto (Top 20)",
    description: "(valor_unitario - valor_custo) / valor_unitario × 100.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, 'Produto ' || pp.produto_id::text) AS name,
               ROUND(
                 100.0 * (AVG(pp.valor_unitario) - AVG(COALESCE(pp.valor_custo, pr.valor_custo, 0)))
                 / NULLIF(AVG(pp.valor_unitario), 0),
               2)::float AS value
          FROM analytics.atlas_pedido_produtos pp
          JOIN analytics.atlas_pedidos ped
            ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
          LEFT JOIN analytics.atlas_produtos pr
            ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           AND pp.valor_unitario > 0
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY pp.produto_id, pr.nome, pr.apelido
         ORDER BY value DESC NULLS LAST
         LIMIT 20
      `,
    }),
  },
  {
    id: "atlas.curva_abc_produtos",
    label: "Curva ABC de produtos",
    description: "Classificação A/B/C por receita acumulada (A=80%, B=15%, C=5%).",
    module: "atlas",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH produto_receita AS (
          SELECT pp.produto_id,
                 SUM(pp.valor_total) AS receita
            FROM analytics.atlas_pedido_produtos pp
            JOIN analytics.atlas_pedidos ped
              ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
           GROUP BY pp.produto_id
           HAVING SUM(pp.valor_total) > 0
        ),
        ranked AS (
          SELECT produto_id, receita,
                 SUM(receita) OVER () AS total,
                 SUM(receita) OVER (ORDER BY receita DESC) AS acumulada
            FROM produto_receita
        )
        SELECT
          CASE
            WHEN total = 0 THEN 'Sem dados'
            WHEN acumulada / total <= 0.80 THEN 'A — Alto giro (80%)'
            WHEN acumulada / total <= 0.95 THEN 'B — Médio giro (15%)'
            ELSE 'C — Baixo giro (5%)'
          END AS name,
          COUNT(*)::float AS value
          FROM ranked
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },
  {
    id: "atlas.estoque_por_grupo",
    label: "Estoque por grupo de produto",
    description: "Saldo de estoque atual agrupado por grupo/categoria.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(g.nome, 'Sem grupo') AS name,
               SUM(pr.saldo_estoque)::float AS value
          FROM analytics.atlas_produtos pr
          LEFT JOIN analytics.atlas_grupos_produtos g
                 ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true
         GROUP BY 1
         ORDER BY value DESC NULLS LAST
         LIMIT 20
      `,
    }),
  },
  {
    id: "atlas.inadimplencia_valor",
    label: "Inadimplência — valor em atraso (R$)",
    description: "Total de recebíveis não pagos com vencimento passado.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Inadimplência' AS name,
               COALESCE(SUM(valor - COALESCE(valor_pago, 0)), 0)::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'C'
           AND pago = false
           AND ativo = true
           AND data_vencimento < NOW()
      `,
    }),
  },
  {
    id: "atlas.contas_a_receber_por_vencimento",
    label: "Contas a receber por vencimento",
    description: "Distribuição do contas a receber em vencer por mês.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               SUM(valor - COALESCE(valor_pago, 0))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'C'
           AND pago = false
           AND ativo = true
           AND data_vencimento >= CURRENT_DATE
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
         LIMIT 12
      `,
    }),
  },
];
