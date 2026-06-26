/**
 * Runner de alertas BI — avalia condições e dispara notificações.
 * Chamado pelo cron ou pelo endpoint POST /api/bi/alerts/run.
 */

import { db } from "../db";
import { biAlerts } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { runSemanticMetric, getSemanticMetric } from "./semantic/index";

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

export async function runBiAlerts(tenantId: string): Promise<{ checked: number; triggered: number }> {
  const alerts = await db.select().from(biAlerts).where(
    and(eq(biAlerts.tenantId, tenantId), eq(biAlerts.isActive, 1)),
  );

  let triggeredCount = 0;
  for (const alert of alerts) {
    try {
      let value = 0;
      const semanticMetric = getSemanticMetric(alert.metricId);

      if (semanticMetric) {
        const result = await runSemanticMetric(alert.metricId, { tenantId });
        value = result.rows.reduce((s, r) => s + r.value, 0);
      } else {
        // Fallback ao catálogo interno (METRIC_CATALOG)
        const { METRIC_CATALOG, runMetric } = await import("../biMetrics");
        const isInternal = METRIC_CATALOG.some((m) => m.key === alert.metricId);
        if (!isInternal) {
          console.warn(`[bi/alerts] métrica desconhecida: ${alert.metricId} (alert ${alert.id})`);
          continue;
        }
        const rows = await runMetric(alert.metricId, tenantId);
        value = rows.reduce((s, r) => s + r.value, 0);
      }

      const triggered = checkCondition(value, alert.condition as Condition, Number(alert.threshold));

      const updates: any = {
        lastCheckedAt: new Date(),
        lastValue: String(value),
        updatedAt: new Date(),
      };
      if (triggered) updates.lastTriggeredAt = new Date();
      await db.update(biAlerts).set(updates).where(eq(biAlerts.id, alert.id));

      if (triggered) {
        triggeredCount++;
        console.log(
          `[bi/alerts] TRIGGERED: ${alert.name} — ${alert.metricId} = ${value} (${alert.condition} ${alert.threshold})`,
        );
        // TODO: integrar com notificationService para email/WhatsApp
      }
    } catch (err) {
      console.error(`[bi/alerts] erro ao avaliar alert ${alert.id}:`, err);
    }
  }

  return { checked: alerts.length, triggered: triggeredCount };
}
