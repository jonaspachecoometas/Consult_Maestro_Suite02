// Fase 4 — App Store interna: cron de cobrança mensal.
//
// Para cada installation ativa de app com billingModel='monthly' e
// priceCents>0, cria um registro `marketplace_charges` por mês corrente.
// A unicidade (installation_id + period_month) está garantida via UNIQUE
// INDEX `uq_mkt_charge_monthly` — re-execuções são idempotentes.
//
// Em produção, o processamento real (Stripe etc.) consome esses registros
// `pending`. Aqui só geramos a obrigação financeira para visibilidade do
// owner via /api/marketplace/charges/report.

import { db } from "../db";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import {
  marketplaceApps,
  marketplaceInstallations,
  marketplaceCharges,
} from "@shared/schema";

function periodMonthOf(d: Date = new Date()): string {
  // YYYY-MM em UTC para idempotência cross-timezone.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function runMarketplaceMonthlyBilling(now: Date = new Date()): Promise<{
  created: number;
  skipped: number;
}> {
  const period = periodMonthOf(now);
  // Apps de cobrança recorrente.
  const monthlyApps = await db
    .select()
    .from(marketplaceApps)
    .where(and(
      eq(marketplaceApps.billingModel, "monthly"),
      eq(marketplaceApps.status, "published"),
    ));
  let created = 0;
  let skipped = 0;
  for (const app of monthlyApps) {
    if ((app.priceCents ?? 0) <= 0) continue;
    const installs = await db
      .select()
      .from(marketplaceInstallations)
      .where(and(
        eq(marketplaceInstallations.appId, app.id),
        eq(marketplaceInstallations.status, "installed"),
      ));
    for (const inst of installs) {
      try {
        // .returning() devolve [] quando ON CONFLICT DO NOTHING não inseriu,
        // permitindo contar apenas charges efetivamente criados (telemetria
        // honesta).
        const inserted = await db
          .insert(marketplaceCharges)
          .values({
            appId: app.id,
            installationId: inst.id,
            tenantId: inst.tenantId,
            ownerTenantId: app.ownerTenantId,
            amountCents: app.priceCents,
            kind: "monthly",
            status: "pending",
            periodMonth: period,
          })
          .onConflictDoNothing({
            target: [marketplaceCharges.installationId, marketplaceCharges.periodMonth],
          })
          .returning({ id: marketplaceCharges.id });
        if (inserted.length > 0) {
          created += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        skipped += 1;
        console.error("[marketplace:billing] charge insert failed:", err);
      }
    }
  }
  return { created, skipped };
}

let started = false;
/**
 * Cron diário (03:30 UTC) que tenta gerar charges do mês. Como o INSERT é
 * ON CONFLICT DO NOTHING contra (installation_id, period_month), rodar 30
 * vezes no mês não duplica.
 */
export function startMarketplaceMonthlyBillingCron() {
  if (started) return;
  started = true;
  const HOUR = 60 * 60 * 1000;
  const tick = async () => {
    try {
      const r = await runMarketplaceMonthlyBilling();
      if (r.created > 0 || r.skipped > 0) {
        console.log(`[marketplace:billing] tick: created=${r.created} skipped=${r.skipped}`);
      }
    } catch (err) {
      console.error("[marketplace:billing] tick failed:", err);
    }
  };
  // Roda 30s após o boot e depois a cada 12h.
  setTimeout(tick, 30_000);
  setInterval(tick, 12 * HOUR);
  console.log("[marketplace:billing] monthly billing cron started (12h interval)");
}
