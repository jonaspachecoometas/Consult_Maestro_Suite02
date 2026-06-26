/**
 * MCP Hub — AI Usage dashboard (Sprint 4)
 *
 * Read-only aggregation of `ai_usage_logs` for the current tenant. Used by
 * the `/configuracoes/ia` page to render KPI cards, daily chart, and the
 * platform-pool nudge (>80% consumed).
 *
 *   GET /api/ia/usage?days=30
 *
 * Returns:
 *   {
 *     range: { from, to, days },
 *     totals: { current: { tokens, requests, byProvider, bySource },
 *               previous: { tokens, requests, byProvider, bySource },
 *               variation: { tokensPct } },
 *     daily:  [ { date, provider, source, tokensInput, tokensOutput, requests } ],
 *     platformPool: { used, limit, percent, nudge: bool }
 *   }
 *
 * The platform pool is a lightweight heuristic: only counts rows with
 * `source = 'platform'` against an env-configurable monthly cap
 * `PLATFORM_AI_TOKENS_MONTHLY_QUOTA` (default 1_000_000). Per-tenant pool
 * configuration (Sprint 5) will replace this.
 */

import type { Express, Response } from "express";
import { and, eq, gte, lt, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db";
import { aiUsageLogs } from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";

const DEFAULT_PLATFORM_QUOTA = 1_000_000;

function startOfDayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function startOfMonthUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function registerIaUsageRoutes(app: Express) {
  app.get(
    "/api/ia/usage",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 7), 90);
        const now = new Date();
        const to = startOfDayUTC(now);
        to.setUTCDate(to.getUTCDate() + 1); // exclusive upper bound (start of tomorrow UTC)
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - days);

        // ── Daily breakdown (current window) ─────────────────────────────
        const daily = await db
          .select({
            date: drizzleSql<string>`to_char(date_trunc('day', ${aiUsageLogs.createdAt}), 'YYYY-MM-DD')`,
            provider: aiUsageLogs.provider,
            source: aiUsageLogs.source,
            tokensInput: drizzleSql<number>`coalesce(sum(${aiUsageLogs.tokensInput}), 0)::int`,
            tokensOutput: drizzleSql<number>`coalesce(sum(${aiUsageLogs.tokensOutput}), 0)::int`,
            requests: drizzleSql<number>`count(*)::int`,
          })
          .from(aiUsageLogs)
          .where(
            and(
              eq(aiUsageLogs.tenantId, tenantId),
              gte(aiUsageLogs.createdAt, from),
              lt(aiUsageLogs.createdAt, to),
            ),
          )
          .groupBy(
            drizzleSql`date_trunc('day', ${aiUsageLogs.createdAt})`,
            aiUsageLogs.provider,
            aiUsageLogs.source,
          )
          .orderBy(drizzleSql`date_trunc('day', ${aiUsageLogs.createdAt})`);

        // ── Totals current vs previous (same window length) ─────────────
        const previousFrom = new Date(from);
        previousFrom.setUTCDate(previousFrom.getUTCDate() - days);
        const previousTo = new Date(from);

        async function aggregateWindow(start: Date, end: Date) {
          const rows = await db
            .select({
              provider: aiUsageLogs.provider,
              source: aiUsageLogs.source,
              tokensInput: drizzleSql<number>`coalesce(sum(${aiUsageLogs.tokensInput}), 0)::int`,
              tokensOutput: drizzleSql<number>`coalesce(sum(${aiUsageLogs.tokensOutput}), 0)::int`,
              requests: drizzleSql<number>`count(*)::int`,
            })
            .from(aiUsageLogs)
            .where(
              and(
                eq(aiUsageLogs.tenantId, tenantId),
                gte(aiUsageLogs.createdAt, start),
                lt(aiUsageLogs.createdAt, end),
              ),
            )
            .groupBy(aiUsageLogs.provider, aiUsageLogs.source);

          let tokens = 0;
          let requests = 0;
          const byProvider: Record<string, number> = {};
          const bySource: Record<string, number> = {};
          for (const r of rows) {
            const t = (r.tokensInput || 0) + (r.tokensOutput || 0);
            tokens += t;
            requests += r.requests || 0;
            byProvider[r.provider] = (byProvider[r.provider] || 0) + t;
            bySource[r.source] = (bySource[r.source] || 0) + t;
          }
          return { tokens, requests, byProvider, bySource };
        }

        const [current, previous] = await Promise.all([
          aggregateWindow(from, to),
          aggregateWindow(previousFrom, previousTo),
        ]);
        const tokensPct = previous.tokens > 0
          ? Math.round(((current.tokens - previous.tokens) / previous.tokens) * 1000) / 10
          : null;

        // ── Platform pool (current calendar month, source='platform') ────
        const monthStart = startOfMonthUTC(now);
        const monthEnd = new Date(monthStart);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
        const [poolRow] = await db
          .select({
            tokens: drizzleSql<number>`coalesce(sum(${aiUsageLogs.tokensInput} + ${aiUsageLogs.tokensOutput}), 0)::int`,
          })
          .from(aiUsageLogs)
          .where(
            and(
              eq(aiUsageLogs.tenantId, tenantId),
              eq(aiUsageLogs.source, "platform"),
              gte(aiUsageLogs.createdAt, monthStart),
              lt(aiUsageLogs.createdAt, monthEnd),
            ),
          );
        const poolLimit = parseInt(process.env.PLATFORM_AI_TOKENS_MONTHLY_QUOTA || String(DEFAULT_PLATFORM_QUOTA), 10);
        const poolUsed = poolRow?.tokens || 0;
        const poolPercent = poolLimit > 0 ? Math.round((poolUsed / poolLimit) * 1000) / 10 : 0;

        res.json({
          range: { from: from.toISOString(), to: to.toISOString(), days },
          totals: { current, previous, variation: { tokensPct } },
          daily,
          platformPool: {
            used: poolUsed,
            limit: poolLimit,
            percent: poolPercent,
            nudge: poolPercent >= 80,
            month: monthStart.toISOString().slice(0, 7),
          },
        });
      } catch (e: any) {
        console.error("[ia-usage] failed:", e?.message);
        res.status(500).json({ message: "Erro ao agregar uso de IA" });
      }
    },
  );
}
