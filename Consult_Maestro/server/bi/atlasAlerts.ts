/**
 * Definições de alertas BI específicos do Atlas/ERPNext (estoque + custos).
 *
 * Estes são templates que podem ser materializados em `bi_alerts` por tenant
 * (via `seedAtlasAlerts(tenantId, createdById)`). O avaliador roda em
 * `server/bi/alertsRunner.ts` e consulta as métricas semânticas
 * `estoque.*` e `custos.*`.
 *
 * Regras-de-bolso herdadas das práticas do ERPNext (relatórios de estoque
 * e gross_profit).
 */
import { db } from "../db";
import { biAlerts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";

export interface AtlasAlertTemplate {
  name: string;
  metricId: string;
  condition: "gt" | "lt" | "gte" | "lte" | "eq";
  threshold: number;
}

export const ATLAS_ALERT_TEMPLATES: AtlasAlertTemplate[] = [
  {
    name: "Ruptura de estoque (> 20 produtos)",
    metricId: "estoque.produtos_sem_estoque",
    condition: "gt",
    threshold: 20,
  },
  {
    name: "Margem bruta caindo (< 20%)",
    metricId: "custos.margem_bruta_total",
    condition: "lt",
    threshold: 20,
  },
  {
    name: "Produtos sem giro parado > 100",
    metricId: "estoque.produtos_sem_giro_90d",
    condition: "gt",
    threshold: 100,
  },
  {
    name: "CMV > 80% da receita (margem < 20%)",
    metricId: "custos.margem_bruta_total",
    condition: "lt",
    threshold: 20,
  },
];

/**
 * Garante que os 4 alertas do Atlas existam para o tenant.
 * Idempotente: usa `(tenant_id, name)` como chave lógica.
 */
export async function seedAtlasAlerts(
  tenantId: string,
  createdById?: string,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const tpl of ATLAS_ALERT_TEMPLATES) {
    const existing = await db.select({ id: biAlerts.id })
      .from(biAlerts)
      .where(and(eq(biAlerts.tenantId, tenantId), eq(biAlerts.name, tpl.name)))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(biAlerts).values({
      tenantId,
      name: tpl.name,
      metricId: tpl.metricId,
      condition: tpl.condition,
      threshold: String(tpl.threshold),
      isActive: 1,
      notifyChannels: [],
      createdById,
    });
    created++;
  }
  return { created, skipped };
}
