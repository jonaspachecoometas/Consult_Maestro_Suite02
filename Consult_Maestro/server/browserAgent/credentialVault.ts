/**
 * credentialVault — cofre de credenciais web por tenant.
 *
 * Cada tenant guarda usuário/senha/token de sistemas externos (ERP, SEFAZ,
 * prefeituras, bancos). O segredo é criptografado (AES-256-GCM via cryptoService)
 * e NUNCA é devolvido em listagens nem exposto ao LLM. Tradução TS do
 * agent/credential_pool.py do Hermes.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  webCredentials,
  type InsertWebCredential,
  type WebCredential,
} from "@shared/schema";
import { encryptConfig, decryptConfig } from "../cryptoService";

export interface DecryptedSecret {
  password?: string;
  token?: string;
  extra?: Record<string, any>;
}

export type SafeCredential = Omit<WebCredential, "encryptedSecret"> & {
  hasSecret: boolean;
};

function strip(row: WebCredential): SafeCredential {
  const { encryptedSecret, ...rest } = row;
  return { ...rest, hasSecret: !!encryptedSecret };
}

export async function listCredentials(tenantId: string): Promise<SafeCredential[]> {
  const rows = await db
    .select()
    .from(webCredentials)
    .where(eq(webCredentials.tenantId, tenantId));
  return rows.map(strip);
}

export async function createCredential(
  tenantId: string,
  data: Omit<InsertWebCredential, "tenantId">,
  secret: DecryptedSecret | undefined,
  userId?: string | null,
): Promise<SafeCredential> {
  const encryptedSecret =
    secret && Object.values(secret).some((v) => v != null && v !== "")
      ? encryptConfig(secret)
      : null;
  const [row] = await db
    .insert(webCredentials)
    .values({
      ...data,
      tenantId,
      encryptedSecret,
      createdBy: userId ?? null,
    })
    .returning();
  return strip(row);
}

export async function updateCredential(
  tenantId: string,
  id: string,
  data: Partial<Omit<InsertWebCredential, "tenantId">>,
  secret?: DecryptedSecret,
): Promise<SafeCredential | null> {
  const patch: Record<string, any> = { ...data, updatedAt: new Date() };
  if (secret && Object.values(secret).some((v) => v != null && v !== "")) {
    patch.encryptedSecret = encryptConfig(secret);
  }
  const [row] = await db
    .update(webCredentials)
    .set(patch)
    .where(and(eq(webCredentials.id, id), eq(webCredentials.tenantId, tenantId)))
    .returning();
  return row ? strip(row) : null;
}

export async function deleteCredential(
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(webCredentials)
    .where(and(eq(webCredentials.id, id), eq(webCredentials.tenantId, tenantId)))
    .returning({ id: webCredentials.id });
  return rows.length > 0;
}

/** Uso interno do browserAgent — devolve o segredo decriptado. NUNCA expor via API. */
export async function getCredentialWithSecret(
  tenantId: string,
  id: string,
): Promise<{ credential: WebCredential; secret: DecryptedSecret } | null> {
  const [row] = await db
    .select()
    .from(webCredentials)
    .where(and(eq(webCredentials.id, id), eq(webCredentials.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const secret = row.encryptedSecret
    ? decryptConfig<DecryptedSecret>(row.encryptedSecret)
    : {};
  return { credential: row, secret };
}

export async function markLogin(tenantId: string, id: string): Promise<void> {
  await db
    .update(webCredentials)
    .set({ lastLoginAt: new Date(), status: "ok", updatedAt: new Date() })
    .where(and(eq(webCredentials.id, id), eq(webCredentials.tenantId, tenantId)));
}
