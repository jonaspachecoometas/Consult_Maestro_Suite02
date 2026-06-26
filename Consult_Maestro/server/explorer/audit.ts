// Code Explorer (Fase 5) — helper para registrar ações no audit log.
// Falhas no audit NUNCA quebram a operação principal — apenas logamos no console.
import { db } from "../db";
import { explorerAuditLog } from "@shared/schema";

export type ExplorerAction =
  | "tree"
  | "read"
  | "write"
  | "delete"
  | "revert"
  | "search"
  | "history"
  | "diff";

export async function recordAudit(params: {
  tenantId: string;
  userId: string | null;
  action: ExplorerAction;
  filePath?: string | null;
  sha?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(explorerAuditLog).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      action: params.action,
      filePath: params.filePath ?? null,
      sha: params.sha ?? null,
      metaJson: params.meta ?? null,
    });
  } catch (err) {
    console.error("[explorer/audit] insert failed:", (err as Error).message);
  }
}
