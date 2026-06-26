/**
 * hitlApproval — Human-in-the-loop. O agente cria um pedido de aprovação antes
 * de executar uma ação irreversível (emitir NF-e, enviar remessa ao banco...).
 * O usuário aprova/rejeita na UI; o agente consulta o status e prossegue.
 * Tradução TS do tools/approval.py do Hermes.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { agentTaskApprovals, type AgentTaskApproval } from "@shared/schema";

export async function requestApproval(
  tenantId: string,
  input: {
    actionDescription: string;
    actionPayload?: Record<string, any>;
    taskId?: string | null;
    agentSessionId?: string | null;
    requestedBy?: string | null;
  },
): Promise<AgentTaskApproval> {
  const [row] = await db
    .insert(agentTaskApprovals)
    .values({
      tenantId,
      actionDescription: input.actionDescription,
      actionPayload: input.actionPayload ?? {},
      taskId: input.taskId ?? null,
      agentSessionId: input.agentSessionId ?? null,
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  return row;
}

export async function listApprovals(
  tenantId: string,
  status?: string,
): Promise<AgentTaskApproval[]> {
  const conds = [eq(agentTaskApprovals.tenantId, tenantId)];
  if (status) conds.push(eq(agentTaskApprovals.status, status));
  return await db
    .select()
    .from(agentTaskApprovals)
    .where(and(...conds))
    .orderBy(desc(agentTaskApprovals.requestedAt));
}

export async function getApproval(
  tenantId: string,
  id: string,
): Promise<AgentTaskApproval | null> {
  const [row] = await db
    .select()
    .from(agentTaskApprovals)
    .where(and(eq(agentTaskApprovals.id, id), eq(agentTaskApprovals.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export async function resolveApproval(
  tenantId: string,
  id: string,
  approved: boolean,
  resolvedBy?: string | null,
): Promise<AgentTaskApproval | null> {
  const [row] = await db
    .update(agentTaskApprovals)
    .set({
      status: approved ? "approved" : "rejected",
      resolvedBy: resolvedBy ?? null,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(agentTaskApprovals.id, id),
        eq(agentTaskApprovals.tenantId, tenantId),
        eq(agentTaskApprovals.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}
