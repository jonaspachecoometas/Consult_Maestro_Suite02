/**
 * ETL Atlas — staging analytics.atlas_* → analytics.fact_*
 *
 *   atlas_pagar_recebers (C/D)  → fact_revenue
 *   atlas_pedidos                → fact_crm (opportunity_natural_key)
 */
import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";
import { invalidateTenantCache } from "../cache";

export async function runAtlasEtl(arcadiaTenantId: string): Promise<{
  revenue: number;
  crm: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let revenue = 0, crm = 0;

  // 1) pagar_recebers → fact_revenue
  try {
    const r: any = await db.execute(drizzleSql`
      INSERT INTO analytics.fact_revenue (
        id, tenant_id, source_data_source_id, natural_key,
        client_natural_key, period, amount, category, payload, ingested_at
      )
      SELECT
        gen_random_uuid(),
        ${arcadiaTenantId},
        'atlas',
        'atlas-pr-' || pr.id::text,
        pr.pessoa_id::text,
        COALESCE(pr.data_competencia, pr.data_vencimento)::date,
        CASE WHEN pr.tipo = 'C' THEN pr.valor ELSE -ABS(pr.valor) END,
        LEFT(COALESCE(pr.descricao, 'Atlas'), 80),
        jsonb_build_object(
          'atlas_id', pr.id,
          'tipo', pr.tipo,
          'tabela_pai', pr.tabela_pai,
          'empresa_id', pr.empresa_id,
          'pago', pr.pago,
          'status', CASE WHEN pr.pago THEN 'pago' ELSE 'pendente' END
        ),
        NOW()
      FROM analytics.atlas_pagar_recebers pr
      WHERE pr.arcadia_tenant_id = ${arcadiaTenantId}
        AND pr.ativo = true
        AND pr.extornado = false
        AND COALESCE(pr.data_competencia, pr.data_vencimento) IS NOT NULL
      ON CONFLICT (tenant_id, source_data_source_id, natural_key)
      WHERE natural_key IS NOT NULL
      DO UPDATE SET
        amount = EXCLUDED.amount,
        category = EXCLUDED.category,
        payload = EXCLUDED.payload,
        ingested_at = NOW()
    `);
    revenue = r.rowCount ?? 0;
  } catch (err: any) {
    errors.push(`fact_revenue: ${err.message}`);
    console.error("[atlas-etl] fact_revenue:", err.message);
  }

  // 2) pedidos → fact_crm
  try {
    const r: any = await db.execute(drizzleSql`
      INSERT INTO analytics.fact_crm (
        id, tenant_id, opportunity_natural_key, client_natural_key,
        stage, status, value, probability, created_at, closed_at, ingested_at
      )
      SELECT
        gen_random_uuid(),
        ${arcadiaTenantId},
        'atlas-ped-' || p.id::text,
        p.cliente_id::text,
        CASE p.status_id
          WHEN 14 THEN 'Entregue'
          WHEN 15 THEN 'Cancelado'
          ELSE 'Em andamento'
        END,
        CASE p.status_id
          WHEN 14 THEN 'won'
          WHEN 15 THEN 'lost'
          ELSE 'open'
        END,
        COALESCE(p.valor_total, 0),
        CASE WHEN p.status_id = 14 THEN 100 ELSE 50 END,
        COALESCE(p.data_pedido, NOW()),
        CASE WHEN p.status_id IN (14, 15) THEN p.data_pedido ELSE NULL END,
        NOW()
      FROM analytics.atlas_pedidos p
      WHERE p.arcadia_tenant_id = ${arcadiaTenantId}
        AND p.data_pedido IS NOT NULL
      ON CONFLICT (tenant_id, opportunity_natural_key)
      DO UPDATE SET
        stage = EXCLUDED.stage,
        status = EXCLUDED.status,
        value = EXCLUDED.value,
        probability = EXCLUDED.probability,
        closed_at = EXCLUDED.closed_at,
        ingested_at = NOW()
    `);
    crm = r.rowCount ?? 0;
  } catch (err: any) {
    errors.push(`fact_crm: ${err.message}`);
    console.error("[atlas-etl] fact_crm:", err.message);
  }

  try { await invalidateTenantCache(arcadiaTenantId); } catch {}

  return { revenue, crm, errors };
}
