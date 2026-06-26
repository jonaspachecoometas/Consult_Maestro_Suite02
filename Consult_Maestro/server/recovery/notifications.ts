/**
 * notifications.ts — Sprint 4 Recovery
 *
 * Helper + endpoints para notificações in-app do módulo Recovery.
 * Reutiliza a tabela global `notifications` filtrando por sourceType LIKE 'recovery_%'.
 *
 *  - GET    /api/recovery/notifications?unreadOnly&limit
 *  - POST   /api/recovery/notifications/:id/mark-read
 *  - POST   /api/recovery/notifications/mark-all-read
 *
 * Helper exportado:
 *   createRecoveryNotification({ tenantId, userId|null, title, body, type, sourceType, sourceId })
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { notifications } from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

function getUserId(req: any): string | null {
  return req?.user?.claims?.sub || req?.user?.id || null;
}

export type RecoveryNotificationType = "info" | "warning" | "success" | "error";

/**
 * Cria notificação Recovery. NUNCA lança — apenas loga em caso de erro.
 * Use `userId=null` para broadcast para todos do tenant.
 */
export async function createRecoveryNotification(opts: {
  tenantId: string;
  userId?: string | null;
  title: string;
  body: string;
  type?: RecoveryNotificationType;
  sourceType: string; // ex: 'recovery_process', 'recovery_installment', 'recovery_action', 'recovery_scenario'
  sourceId: string;
}): Promise<void> {
  try {
    await db.insert(notifications).values({
      tenantId: opts.tenantId,
      userId: opts.userId ?? null,
      title: opts.title.slice(0, 200),
      body: opts.body,
      type: opts.type ?? "info",
      sourceType: opts.sourceType.slice(0, 50),
      sourceId: opts.sourceId,
    });
  } catch (err) {
    console.error("[recovery] createRecoveryNotification failed:", err);
  }
}

export function registerRecoveryNotificationRoutes(app: Express) {
  // ── LIST: notificações Recovery do tenant (do user + broadcast)
  app.get(
    "/api/recovery/notifications",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const userId = getUserId(req);
        const unreadOnly = req.query.unreadOnly === "true" || req.query.unreadOnly === "1";
        const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));

        const conds = [
          eq(notifications.tenantId, tenantId),
          sql`${notifications.sourceType} LIKE 'recovery_%'`,
        ];
        if (userId) {
          conds.push(or(eq(notifications.userId, userId), isNull(notifications.userId))!);
        } else {
          conds.push(isNull(notifications.userId));
        }
        if (unreadOnly) conds.push(eq(notifications.isRead, 0));

        const rows = await db
          .select()
          .from(notifications)
          .where(and(...conds))
          .orderBy(desc(notifications.createdAt))
          .limit(limit);

        const [agg] = await db
          .select({ unread: sql<number>`COUNT(*) FILTER (WHERE is_read = 0)::int` })
          .from(notifications)
          .where(and(
            eq(notifications.tenantId, tenantId),
            sql`${notifications.sourceType} LIKE 'recovery_%'`,
            userId
              ? or(eq(notifications.userId, userId), isNull(notifications.userId))!
              : isNull(notifications.userId),
          ));

        res.json({ items: rows, unreadCount: Number(agg?.unread ?? 0) });
      } catch (e: any) {
        console.error("[recovery] list notifications:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // ── MARK ONE READ (escopo: tenant + sourceType recovery_% + (userId atual OR broadcast))
  app.post(
    "/api/recovery/notifications/:id/mark-read",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const userId = getUserId(req);
        const conds = [
          eq(notifications.id, req.params.id),
          eq(notifications.tenantId, tenantId),
          sql`${notifications.sourceType} LIKE 'recovery_%'`,
        ];
        if (userId) {
          conds.push(or(eq(notifications.userId, userId), isNull(notifications.userId))!);
        } else {
          conds.push(isNull(notifications.userId));
        }
        const result = await db
          .update(notifications)
          .set({ isRead: 1 })
          .where(and(...conds))
          .returning({ id: notifications.id });
        if (result.length === 0) return res.status(404).json({ message: "Notificação não encontrada" });
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[recovery] mark-read:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // ── MARK ALL READ (Recovery only, escopado por user/broadcast)
  app.post(
    "/api/recovery/notifications/mark-all-read",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const userId = getUserId(req);
        const conds = [
          eq(notifications.tenantId, tenantId),
          sql`${notifications.sourceType} LIKE 'recovery_%'`,
          eq(notifications.isRead, 0),
        ];
        if (userId) {
          conds.push(or(eq(notifications.userId, userId), isNull(notifications.userId))!);
        } else {
          conds.push(isNull(notifications.userId));
        }
        const result = await db.update(notifications).set({ isRead: 1 }).where(and(...conds)).returning({ id: notifications.id });
        res.json({ ok: true, updated: result.length });
      } catch (e: any) {
        console.error("[recovery] mark-all-read:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );
}
