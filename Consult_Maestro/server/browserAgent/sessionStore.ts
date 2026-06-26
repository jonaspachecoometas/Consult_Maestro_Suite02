/**
 * sessionStore — persistência criptografada de sessões de browser (cookies/state).
 *
 * Guarda o `storageState` do Playwright por (tenant, sistema) para que o agente
 * faça login uma vez e reutilize a sessão depois (igual ao credential_pool +
 * cookies do Hermes). O state é criptografado com cryptoService (AES-256-GCM).
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { browserSessions } from "@shared/schema";
import { encryptConfig, decryptConfig } from "../cryptoService";

export async function saveBrowserState(
  tenantId: string,
  systemName: string,
  state: any,
  agentSessionId?: string | null,
): Promise<void> {
  const encryptedState = encryptConfig({ state });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [existing] = await db
    .select({ id: browserSessions.id })
    .from(browserSessions)
    .where(
      and(
        eq(browserSessions.tenantId, tenantId),
        eq(browserSessions.systemName, systemName),
      ),
    )
    .orderBy(desc(browserSessions.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(browserSessions)
      .set({ encryptedState, isActive: 1, expiresAt, updatedAt: new Date() })
      .where(eq(browserSessions.id, existing.id));
  } else {
    await db.insert(browserSessions).values({
      tenantId,
      systemName,
      agentSessionId: agentSessionId ?? null,
      encryptedState,
      isActive: 1,
      expiresAt,
    });
  }
}

export async function loadBrowserState(
  tenantId: string,
  systemName: string,
): Promise<any | null> {
  const [row] = await db
    .select()
    .from(browserSessions)
    .where(
      and(
        eq(browserSessions.tenantId, tenantId),
        eq(browserSessions.systemName, systemName),
        eq(browserSessions.isActive, 1),
      ),
    )
    .orderBy(desc(browserSessions.createdAt))
    .limit(1);

  if (!row || !row.encryptedState) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  try {
    const { state } = decryptConfig<{ state: any }>(row.encryptedState);
    return state ?? null;
  } catch {
    return null;
  }
}
