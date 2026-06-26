/**
 * MCP Hub — OAuth Service (Sprint 3)
 *
 * Multi-tenant OAuth2 layer. Currently supports Google Workspace.
 *
 * Architecture:
 *  - Platform-level OAuth credentials (Client ID + Secret) are stored encrypted
 *    in `platform_oauth_apps` and configured by the superadmin via the UI
 *    (NOT by env vars — superadmin pastes them at deploy time so the developer
 *    never has to handle them). Env vars are kept as a fallback only.
 *  - Tenant-level connections (access/refresh tokens, account email) live in
 *    `oauth_connections`, ALWAYS encrypted with cryptoService AES-256-GCM.
 *  - The OAuth `state` param is a signed token containing tenantId + nonce,
 *    so the callback can verify the response without trusting the query string.
 *  - Tokens are NEVER logged, never leaked in API responses, never sent to LLMs.
 *
 * Each tool that calls the Google APIs goes through `getValidAccessToken`,
 * which transparently refreshes expired tokens.
 */

import { createHmac, randomBytes } from "crypto";
import { google, Auth } from "googleapis";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { encryptConfig, decryptConfig } from "../cryptoService";
import { oauthConnections, platformOauthApps, tenantUsers, users } from "@shared/schema";

/**
 * Confirms that `userId` is allowed to operate inside `tenantId`. Used by the
 * OAuth callback because it cannot rely on the `X-Tenant-Id` header (the
 * Google redirect comes from outside our SPA).
 *
 * Returns:
 *  - "superadmin" if the user is a platform superadmin (any tenant)
 *  - "admin" / "member" / etc. if there is an active membership row
 *  - null if access is denied
 */
export async function resolveTenantMembership(
  userId: string,
  tenantId: string,
): Promise<string | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  if (u.role === "superadmin" || u.systemRole === "superadmin") return "superadmin";
  const [m] = await db
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.isActive, 1)))
    .limit(1);
  if (!m) return null;
  return m.role || "member";
}

// Use the OAuth2Client type from googleapis' bundled google-auth-library so
// we keep full type safety on token/credential operations.
type OAuth2Client = Auth.OAuth2Client;

export type OauthProvider = "google" | "microsoft" | "whatsapp";

/**
 * Stable error code for "this tenant has not connected its Google account".
 * Tool handlers surface this code in their `{error}` payload so the frontend
 * (and the LLM orchestrator) can react consistently.
 */
export class GoogleNotConnectedError extends Error {
  code = "google_not_connected" as const;
  constructor(message?: string) {
    super(message || "Google não conectado para este tenant.");
    this.name = "GoogleNotConnectedError";
  }
}

const GOOGLE_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export interface PlatformAppPublic {
  provider: OauthProvider;
  configured: boolean;
  redirectUri: string;
  enabled: boolean;
  updatedAt: Date | null;
  // Last 4 chars of client_id for visual confirmation (NEVER full id, NEVER secret)
  clientIdMasked: string | null;
}

export interface ConnectionPublic {
  provider: OauthProvider;
  connected: boolean;
  accountEmail: string | null;
  scopes: string[];
  expiresAt: Date | null;
  status: string | null;
  updatedAt: Date | null;
}

// ────────────────────────────────────────────────────────────────────────────
// State signing (CSRF protection on the OAuth callback)
// ────────────────────────────────────────────────────────────────────────────

function getStateSecret(): string {
  // OAuth state CSRF protection MUST use a secret with sufficient entropy.
  // Falling back to a hardcoded constant would be a serious vulnerability —
  // anyone could forge a state. We require SESSION_SECRET (always set in
  // Replit) or ENCRYPTION_KEY. If neither is present, refuse to operate.
  const secret = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET (or ENCRYPTION_KEY) must be set with at least 16 chars to use OAuth.",
    );
  }
  return secret;
}

// State expira em 10 minutos para limitar replay window. Não persistimos o
// nonce em DB para manter o callback stateless; a checagem combinada de
// (signature + exp + binding tenantId/userId no callback) cobre o requisito.
const STATE_TTL_MS = 10 * 60 * 1000;

interface OauthState {
  tenantId: string;
  userId: string;
  nonce: string;
  exp: number; // ms epoch
}

function signState(input: { tenantId: string; userId: string; nonce: string }): string {
  const payload: OauthState = { ...input, exp: Date.now() + STATE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state: string): OauthState | null {
  if (!state || typeof state !== "string") return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  // timing-safe equality
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OauthState>;
    if (!parsed || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    if (!parsed.tenantId || !parsed.userId || !parsed.nonce) return null;
    return parsed as OauthState;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Default redirect URI derivation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derives the default OAuth callback URL from the runtime environment when
 * superadmin doesn't override it. Order:
 *   1. APP_URL env var (explicit override)
 *   2. First domain from REPLIT_DOMAINS (production publish)
 *   3. REPLIT_DEV_DOMAIN (dev container)
 *   4. Localhost fallback
 */
export function deriveDefaultRedirectUri(provider: OauthProvider = "google"): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/api/oauth/${provider}/callback`;
  const domains = (process.env.REPLIT_DOMAINS || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length > 0) return `https://${domains[0]}/api/oauth/${provider}/callback`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}/api/oauth/${provider}/callback`;
  return `http://localhost:5000/api/oauth/${provider}/callback`;
}

// ────────────────────────────────────────────────────────────────────────────
// Platform OAuth app management (superadmin only)
// ────────────────────────────────────────────────────────────────────────────

interface ResolvedPlatformConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  source: "db" | "env";
  enabled: boolean;
}

async function resolveGoogleAppConfig(): Promise<ResolvedPlatformConfig | null> {
  // 1. Database (preferred — superadmin paste in UI)
  const [row] = await db
    .select()
    .from(platformOauthApps)
    .where(eq(platformOauthApps.provider, "google"))
    .limit(1);
  if (row && row.enabled) {
    try {
      const idObj = decryptConfig<{ value: string }>(row.clientIdEnc);
      const secObj = decryptConfig<{ value: string }>(row.clientSecretEnc);
      if (idObj.value && secObj.value) {
        return {
          clientId: idObj.value,
          clientSecret: secObj.value,
          redirectUri: row.redirectUri || deriveDefaultRedirectUri("google"),
          source: "db",
          enabled: true,
        };
      }
    } catch (e) {
      console.error("[oauth] failed to decrypt platform google app:", (e as any)?.message);
    }
  }
  // 2. Env-var fallback (kept for backwards compat / private deployments).
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const sec = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (id && sec) {
    return {
      clientId: id,
      clientSecret: sec,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || deriveDefaultRedirectUri("google"),
      source: "env",
      enabled: true,
    };
  }
  return null;
}

export async function getPlatformAppPublic(provider: OauthProvider = "google"): Promise<PlatformAppPublic> {
  if (provider !== "google") {
    return { provider, configured: false, redirectUri: deriveDefaultRedirectUri(provider), enabled: false, updatedAt: null, clientIdMasked: null };
  }
  const cfg = await resolveGoogleAppConfig();
  if (!cfg) {
    return {
      provider,
      configured: false,
      redirectUri: deriveDefaultRedirectUri(provider),
      enabled: false,
      updatedAt: null,
      clientIdMasked: null,
    };
  }
  // Show only the last 6 chars of client id (it's the public part of the OAuth
  // app, not a secret, but we still mask to make the UI clean).
  const masked = cfg.clientId.length > 6 ? `••••${cfg.clientId.slice(-6)}` : cfg.clientId;
  // updatedAt only available when source=db
  let updatedAt: Date | null = null;
  if (cfg.source === "db") {
    const [row] = await db
      .select({ updatedAt: platformOauthApps.updatedAt })
      .from(platformOauthApps)
      .where(eq(platformOauthApps.provider, "google"))
      .limit(1);
    updatedAt = row?.updatedAt ?? null;
  }
  return {
    provider,
    configured: true,
    redirectUri: cfg.redirectUri,
    enabled: cfg.enabled,
    updatedAt,
    clientIdMasked: masked,
  };
}

export async function setPlatformGoogleApp(input: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
  updatedBy: string;
}): Promise<PlatformAppPublic> {
  const clientId = (input.clientId || "").trim();
  const clientSecret = (input.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Client ID e Client Secret são obrigatórios.");
  }
  const clientIdEnc = encryptConfig({ value: clientId });
  const clientSecretEnc = encryptConfig({ value: clientSecret });
  const redirectUri = (input.redirectUri || "").trim() || null;
  // Upsert by provider.
  const [existing] = await db
    .select({ id: platformOauthApps.id })
    .from(platformOauthApps)
    .where(eq(platformOauthApps.provider, "google"))
    .limit(1);
  if (existing) {
    await db
      .update(platformOauthApps)
      .set({
        clientIdEnc,
        clientSecretEnc,
        redirectUri,
        enabled: true,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(platformOauthApps.id, existing.id));
  } else {
    await db.insert(platformOauthApps).values({
      provider: "google",
      clientIdEnc,
      clientSecretEnc,
      redirectUri,
      enabled: true,
      updatedBy: input.updatedBy,
    });
  }
  return getPlatformAppPublic("google");
}

export async function deletePlatformGoogleApp(): Promise<void> {
  await db.delete(platformOauthApps).where(eq(platformOauthApps.provider, "google"));
}

// ────────────────────────────────────────────────────────────────────────────
// Google OAuth flow
// ────────────────────────────────────────────────────────────────────────────

async function buildGoogleClient(): Promise<{ client: OAuth2Client; redirectUri: string }> {
  const cfg = await resolveGoogleAppConfig();
  if (!cfg) {
    throw new Error(
      "Google OAuth não configurado. O superadmin precisa cadastrar Client ID e Secret em Configurações → Integrações.",
    );
  }
  const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  return { client, redirectUri: cfg.redirectUri };
}

export async function getGoogleAuthUrl(tenantId: string, userId: string): Promise<string> {
  const { client } = await buildGoogleClient();
  const state = signState({ tenantId, userId, nonce: randomBytes(12).toString("hex") });
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance even on re-connect
    scope: GOOGLE_DEFAULT_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function handleGoogleCallback(
  state: string,
  code: string,
  authedUser: { userId: string },
): Promise<{ tenantId: string; accountEmail: string | null; scopes: string[]; }> {
  const verified = verifyState(state);
  if (!verified) throw new Error("State OAuth inválido ou expirado.");
  // Anti-CSRF binding: the user that came back from Google MUST be the same
  // that initiated the flow. We trust the tenantId from the (signed) state
  // — header `X-Tenant-Id` is unreliable in popup/redirect flows — but we
  // still verify the user has admin access on that tenant.
  if (verified.userId !== authedUser.userId) {
    throw new Error("State OAuth não pertence ao usuário autenticado.");
  }
  const role = await resolveTenantMembership(authedUser.userId, verified.tenantId);
  if (!role || (role !== "superadmin" && role !== "admin")) {
    throw new Error("Sem permissão de admin para conectar este tenant.");
  }
  const { client } = await buildGoogleClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Resolve account email via userinfo endpoint (uses access_token).
  let accountEmail: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    accountEmail = me.data?.email ?? null;
  } catch (e) {
    console.error("[oauth] userinfo fetch failed:", (e as any)?.message);
  }

  // Encrypt tokens BEFORE persisting. cryptoService wraps the JSON payload
  // (string vs null is preserved).
  const accessTokenEnc = tokens.access_token ? encryptConfig({ value: tokens.access_token }) : null;
  const refreshTokenEnc = tokens.refresh_token ? encryptConfig({ value: tokens.refresh_token }) : null;
  const scopes = (tokens.scope || "").split(/\s+/).filter(Boolean);
  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  // Upsert by (tenantId, provider).
  const [existing] = await db
    .select({ id: oauthConnections.id, refreshTokenEnc: oauthConnections.refreshTokenEnc })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, verified.tenantId), eq(oauthConnections.provider, "google")))
    .limit(1);

  if (existing) {
    // Keep existing refresh token if Google didn't return a new one (common on re-consent).
    const finalRefresh = refreshTokenEnc ?? existing.refreshTokenEnc ?? null;
    await db
      .update(oauthConnections)
      .set({
        accountEmail,
        accessTokenEnc,
        refreshTokenEnc: finalRefresh,
        scopes,
        expiresAt,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, existing.id));
  } else {
    await db.insert(oauthConnections).values({
      tenantId: verified.tenantId,
      provider: "google",
      accountEmail,
      accessTokenEnc,
      refreshTokenEnc,
      scopes,
      expiresAt,
      status: "active",
    });
  }
  return { tenantId: verified.tenantId, accountEmail, scopes };
}

/**
 * Returns a valid Google access token for a tenant. Refreshes transparently
 * when it's expired (or about to expire in <60s). Throws when there's no
 * connection or the refresh fails — handlers should catch and turn it into
 * a friendly `{error}`.
 */
export async function getValidAccessToken(tenantId: string): Promise<string> {
  const [conn] = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "google")))
    .limit(1);
  if (!conn || conn.status !== "active") {
    throw new GoogleNotConnectedError(
      "Google não conectado para este tenant. Vá em Configurações → Integrações para conectar a conta Google.",
    );
  }

  const accessToken = conn.accessTokenEnc ? decryptConfig<{ value: string }>(conn.accessTokenEnc).value : null;
  const refreshToken = conn.refreshTokenEnc ? decryptConfig<{ value: string }>(conn.refreshTokenEnc).value : null;
  const expiresAt = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  const isExpired = !accessToken || expiresAt - Date.now() < 60_000;

  if (!isExpired && accessToken) return accessToken;
  if (!refreshToken) {
    // Mark as expired so UI shows "Reconectar".
    await db.update(oauthConnections).set({ status: "expired", updatedAt: new Date() }).where(eq(oauthConnections.id, conn.id));
    throw new Error("Token Google expirado e sem refresh disponível. Reconecte a conta.");
  }

  const { client } = await buildGoogleClient();
  client.setCredentials({ refresh_token: refreshToken });
  const refreshed = await client.refreshAccessToken().catch((e: any) => {
    throw new Error(`Falha ao renovar token Google: ${e?.message || e}`);
  });
  const newAccess = refreshed.credentials.access_token;
  const newExpiry = refreshed.credentials.expiry_date ? new Date(refreshed.credentials.expiry_date) : null;
  if (!newAccess) throw new Error("Refresh não retornou novo access_token.");

  await db
    .update(oauthConnections)
    .set({
      accessTokenEnc: encryptConfig({ value: newAccess }),
      expiresAt: newExpiry,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(oauthConnections.id, conn.id));

  return newAccess;
}

/**
 * Returns an authenticated `OAuth2Client` for the tenant — convenience for
 * tools that prefer the SDK client over a raw bearer token.
 */
export async function getGoogleAuthClient(tenantId: string): Promise<OAuth2Client> {
  const accessToken = await getValidAccessToken(tenantId);
  const { client } = await buildGoogleClient();
  client.setCredentials({ access_token: accessToken });
  return client;
}

export async function disconnectGoogle(tenantId: string): Promise<void> {
  await db
    .delete(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "google")));
}

export async function getTenantConnection(
  tenantId: string,
  provider: OauthProvider = "google",
): Promise<ConnectionPublic> {
  const [conn] = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, provider)))
    .limit(1);
  if (!conn) {
    return {
      provider,
      connected: false,
      accountEmail: null,
      scopes: [],
      expiresAt: null,
      status: null,
      updatedAt: null,
    };
  }
  return {
    provider,
    connected: conn.status === "active" && !!conn.accessTokenEnc,
    accountEmail: conn.accountEmail ?? null,
    scopes: conn.scopes ?? [],
    expiresAt: conn.expiresAt ? new Date(conn.expiresAt) : null,
    status: conn.status,
    updatedAt: conn.updatedAt ? new Date(conn.updatedAt) : null,
  };
}

export const GOOGLE_SCOPES = GOOGLE_DEFAULT_SCOPES;

// ════════════════════════════════════════════════════════════════════════════
// MICROSOFT 365 OAuth (Sprint 4)
// ════════════════════════════════════════════════════════════════════════════
// Uses Microsoft identity platform (v2.0 endpoint) directly via fetch — no
// SDK dependency added. Multi-tenant app (`common`) by default; superadmin can
// override `tenantId` for single-tenant apps via the platform config.

export class MicrosoftNotConnectedError extends Error {
  code = "microsoft_not_connected" as const;
  constructor(message?: string) {
    super(message || "Microsoft 365 não conectado para este tenant.");
    this.name = "MicrosoftNotConnectedError";
  }
}

export class WhatsappNotConnectedError extends Error {
  code = "whatsapp_not_connected" as const;
  constructor(message?: string) {
    super(message || "WhatsApp Business não conectado para este tenant.");
    this.name = "WhatsappNotConnectedError";
  }
}

const MICROSOFT_DEFAULT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Files.ReadWrite",
  "Mail.Send",
  "ChannelMessage.Send",
  "ChatMessage.Send",
];

interface ResolvedMicrosoftConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  msTenantId: string; // 'common' | 'organizations' | actual tenant id
  source: "db" | "env";
  enabled: boolean;
}

async function resolveMicrosoftAppConfig(): Promise<ResolvedMicrosoftConfig | null> {
  const [row] = await db
    .select()
    .from(platformOauthApps)
    .where(eq(platformOauthApps.provider, "microsoft"))
    .limit(1);
  if (row && row.enabled) {
    try {
      const idObj = decryptConfig<{ value: string }>(row.clientIdEnc);
      const secObj = decryptConfig<{ value: string }>(row.clientSecretEnc);
      if (idObj.value && secObj.value) {
        // The Azure directory tenant id is NOT persisted in `platform_oauth_apps`
        // (table holds only encrypted clientId/secret + redirectUri). It comes
        // from MICROSOFT_OAUTH_TENANT_ID, defaulting to 'common' for the Microsoft
        // multi-tenant endpoint. Per-deploy persistence is a future schema
        // extension (would need a `metadata` jsonb column).
        const msTenantId = process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || "common";
        return {
          clientId: idObj.value,
          clientSecret: secObj.value,
          redirectUri: row.redirectUri || deriveDefaultRedirectUri("microsoft"),
          msTenantId,
          source: "db",
          enabled: true,
        };
      }
    } catch (e) {
      console.error("[oauth] failed to decrypt platform microsoft app:", (e as any)?.message);
    }
  }
  const id = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const sec = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  if (id && sec) {
    return {
      clientId: id,
      clientSecret: sec,
      redirectUri: process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim() || deriveDefaultRedirectUri("microsoft"),
      msTenantId: process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || "common",
      source: "env",
      enabled: true,
    };
  }
  return null;
}

export async function getPlatformMicrosoftAppPublic(): Promise<PlatformAppPublic> {
  const cfg = await resolveMicrosoftAppConfig();
  if (!cfg) {
    return {
      provider: "microsoft",
      configured: false,
      redirectUri: deriveDefaultRedirectUri("microsoft"),
      enabled: false,
      updatedAt: null,
      clientIdMasked: null,
    };
  }
  const masked = cfg.clientId.length > 6 ? `••••${cfg.clientId.slice(-6)}` : cfg.clientId;
  let updatedAt: Date | null = null;
  if (cfg.source === "db") {
    const [row] = await db
      .select({ updatedAt: platformOauthApps.updatedAt })
      .from(platformOauthApps)
      .where(eq(platformOauthApps.provider, "microsoft"))
      .limit(1);
    updatedAt = row?.updatedAt ?? null;
  }
  return {
    provider: "microsoft",
    configured: true,
    redirectUri: cfg.redirectUri,
    enabled: cfg.enabled,
    updatedAt,
    clientIdMasked: masked,
  };
}

export async function setPlatformMicrosoftApp(input: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
  updatedBy: string;
}): Promise<PlatformAppPublic> {
  const clientId = (input.clientId || "").trim();
  const clientSecret = (input.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Client ID e Client Secret são obrigatórios.");
  }
  const clientIdEnc = encryptConfig({ value: clientId });
  const clientSecretEnc = encryptConfig({ value: clientSecret });
  const redirectUri = (input.redirectUri || "").trim() || null;
  const [existing] = await db
    .select({ id: platformOauthApps.id })
    .from(platformOauthApps)
    .where(eq(platformOauthApps.provider, "microsoft"))
    .limit(1);
  if (existing) {
    await db
      .update(platformOauthApps)
      .set({
        clientIdEnc,
        clientSecretEnc,
        redirectUri,
        enabled: true,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(platformOauthApps.id, existing.id));
  } else {
    await db.insert(platformOauthApps).values({
      provider: "microsoft",
      clientIdEnc,
      clientSecretEnc,
      redirectUri,
      enabled: true,
      updatedBy: input.updatedBy,
    });
  }
  return getPlatformMicrosoftAppPublic();
}

export async function deletePlatformMicrosoftApp(): Promise<void> {
  await db.delete(platformOauthApps).where(eq(platformOauthApps.provider, "microsoft"));
}

export async function getMicrosoftAuthUrl(tenantId: string, userId: string): Promise<string> {
  const cfg = await resolveMicrosoftAppConfig();
  if (!cfg) {
    throw new Error(
      "Microsoft OAuth não configurado. O superadmin precisa cadastrar Client ID e Secret em Configurações → Integrações.",
    );
  }
  const state = signState({ tenantId, userId, nonce: randomBytes(12).toString("hex") });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_DEFAULT_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `https://login.microsoftonline.com/${cfg.msTenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface MsTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function exchangeMicrosoftCode(cfg: ResolvedMicrosoftConfig, code: string): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    scope: MICROSOFT_DEFAULT_SCOPES.join(" "),
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.msTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return (await r.json()) as MsTokenResponse;
}

async function refreshMicrosoftToken(cfg: ResolvedMicrosoftConfig, refreshToken: string): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_DEFAULT_SCOPES.join(" "),
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.msTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return (await r.json()) as MsTokenResponse;
}

export async function handleMicrosoftCallback(
  state: string,
  code: string,
  authedUser: { userId: string },
): Promise<{ tenantId: string; accountEmail: string | null; scopes: string[] }> {
  const verified = verifyState(state);
  if (!verified) throw new Error("State OAuth inválido ou expirado.");
  if (verified.userId !== authedUser.userId) {
    throw new Error("State OAuth não pertence ao usuário autenticado.");
  }
  const role = await resolveTenantMembership(authedUser.userId, verified.tenantId);
  if (!role || (role !== "superadmin" && role !== "admin")) {
    throw new Error("Sem permissão de admin para conectar este tenant.");
  }
  const cfg = await resolveMicrosoftAppConfig();
  if (!cfg) throw new Error("Microsoft OAuth não configurado.");

  const tokens = await exchangeMicrosoftCode(cfg, code);
  if (tokens.error || !tokens.access_token) {
    throw new Error(`Erro Microsoft: ${tokens.error_description || tokens.error || "sem access_token"}`);
  }

  // Resolve account email via Graph /me
  let accountEmail: string | null = null;
  try {
    const me = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (me.ok) {
      const data = (await me.json()) as { mail?: string; userPrincipalName?: string };
      accountEmail = data.mail || data.userPrincipalName || null;
    }
  } catch (e) {
    console.error("[oauth] microsoft /me fetch failed:", (e as any)?.message);
  }

  const accessTokenEnc = encryptConfig({ value: tokens.access_token });
  const refreshTokenEnc = tokens.refresh_token ? encryptConfig({ value: tokens.refresh_token }) : null;
  const scopes = (tokens.scope || "").split(/\s+/).filter(Boolean);
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

  const [existing] = await db
    .select({ id: oauthConnections.id, refreshTokenEnc: oauthConnections.refreshTokenEnc })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, verified.tenantId), eq(oauthConnections.provider, "microsoft")))
    .limit(1);

  if (existing) {
    const finalRefresh = refreshTokenEnc ?? existing.refreshTokenEnc ?? null;
    await db
      .update(oauthConnections)
      .set({
        accountEmail,
        accessTokenEnc,
        refreshTokenEnc: finalRefresh,
        scopes,
        expiresAt,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, existing.id));
  } else {
    await db.insert(oauthConnections).values({
      tenantId: verified.tenantId,
      provider: "microsoft",
      accountEmail,
      accessTokenEnc,
      refreshTokenEnc,
      scopes,
      expiresAt,
      status: "active",
    });
  }
  return { tenantId: verified.tenantId, accountEmail, scopes };
}

export async function getValidMicrosoftAccessToken(tenantId: string): Promise<string> {
  const [conn] = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "microsoft")))
    .limit(1);
  if (!conn || conn.status !== "active") {
    throw new MicrosoftNotConnectedError();
  }
  const accessToken = conn.accessTokenEnc ? decryptConfig<{ value: string }>(conn.accessTokenEnc).value : null;
  const refreshToken = conn.refreshTokenEnc ? decryptConfig<{ value: string }>(conn.refreshTokenEnc).value : null;
  const expiresAt = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  const isExpired = !accessToken || expiresAt - Date.now() < 60_000;
  if (!isExpired && accessToken) return accessToken;
  if (!refreshToken) {
    await db.update(oauthConnections).set({ status: "expired", updatedAt: new Date() }).where(eq(oauthConnections.id, conn.id));
    throw new Error("Token Microsoft expirado e sem refresh disponível. Reconecte a conta.");
  }
  const cfg = await resolveMicrosoftAppConfig();
  if (!cfg) throw new Error("Microsoft OAuth não configurado.");
  const refreshed = await refreshMicrosoftToken(cfg, refreshToken);
  if (refreshed.error || !refreshed.access_token) {
    throw new Error(`Falha ao renovar token Microsoft: ${refreshed.error_description || refreshed.error}`);
  }
  const newExpiry = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null;
  await db
    .update(oauthConnections)
    .set({
      accessTokenEnc: encryptConfig({ value: refreshed.access_token }),
      refreshTokenEnc: refreshed.refresh_token ? encryptConfig({ value: refreshed.refresh_token }) : conn.refreshTokenEnc,
      expiresAt: newExpiry,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(oauthConnections.id, conn.id));
  return refreshed.access_token;
}

export async function disconnectMicrosoft(tenantId: string): Promise<void> {
  await db
    .delete(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "microsoft")));
}

export async function getTenantMicrosoftConnection(tenantId: string): Promise<ConnectionPublic> {
  return getTenantConnection(tenantId, "microsoft");
}

// ════════════════════════════════════════════════════════════════════════════
// WHATSAPP BUSINESS (Meta Cloud API) — manual config (Sprint 4)
// ════════════════════════════════════════════════════════════════════════════
// Not OAuth: the tenant admin pastes a Permanent Access Token + Phone Number ID
// + WABA ID generated in the Meta App dashboard. We persist them encrypted in
// `oauth_connections` (provider='whatsapp') reusing the same encryption flow.

export interface WhatsappConnectionInput {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string | null;
  displayName?: string | null;
}

export interface WhatsappConnectionData {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  displayName: string | null;
}

export async function setWhatsappConnection(
  tenantId: string,
  input: WhatsappConnectionInput,
): Promise<ConnectionPublic> {
  const accessToken = (input.accessToken || "").trim();
  const phoneNumberId = (input.phoneNumberId || "").trim();
  if (!accessToken || !phoneNumberId) {
    throw new Error("Access token e Phone Number ID são obrigatórios.");
  }
  const accessTokenEnc = encryptConfig({ value: accessToken });
  const metadata: Record<string, any> = {
    phoneNumberId,
    businessAccountId: input.businessAccountId?.trim() || null,
  };
  const accountEmail = input.displayName?.trim() || null; // reuse field for label
  const [existing] = await db
    .select({ id: oauthConnections.id })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "whatsapp")))
    .limit(1);
  if (existing) {
    await db
      .update(oauthConnections)
      .set({
        accessTokenEnc,
        refreshTokenEnc: null,
        accountEmail,
        scopes: [],
        expiresAt: null,
        status: "active",
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, existing.id));
  } else {
    await db.insert(oauthConnections).values({
      tenantId,
      provider: "whatsapp",
      accessTokenEnc,
      refreshTokenEnc: null,
      accountEmail,
      scopes: [],
      expiresAt: null,
      status: "active",
      metadata,
    });
  }
  return getTenantConnection(tenantId, "whatsapp");
}

export async function getWhatsappConnection(tenantId: string): Promise<WhatsappConnectionData> {
  const [conn] = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "whatsapp")))
    .limit(1);
  if (!conn || conn.status !== "active" || !conn.accessTokenEnc) {
    throw new WhatsappNotConnectedError();
  }
  const accessToken = decryptConfig<{ value: string }>(conn.accessTokenEnc).value;
  const meta = (conn.metadata || {}) as { phoneNumberId?: string; businessAccountId?: string | null };
  if (!meta.phoneNumberId) {
    throw new WhatsappNotConnectedError("Configuração WhatsApp incompleta (phoneNumberId ausente).");
  }
  return {
    accessToken,
    phoneNumberId: meta.phoneNumberId,
    businessAccountId: meta.businessAccountId ?? null,
    displayName: conn.accountEmail ?? null,
  };
}

export async function disconnectWhatsapp(tenantId: string): Promise<void> {
  await db
    .delete(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "whatsapp")));
}

export async function getTenantWhatsappConnection(tenantId: string): Promise<ConnectionPublic & { phoneNumberId: string | null; displayName: string | null }> {
  const base = await getTenantConnection(tenantId, "whatsapp");
  const [conn] = await db
    .select({ metadata: oauthConnections.metadata, accountEmail: oauthConnections.accountEmail })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.tenantId, tenantId), eq(oauthConnections.provider, "whatsapp")))
    .limit(1);
  const meta = (conn?.metadata || {}) as { phoneNumberId?: string };
  return {
    ...base,
    phoneNumberId: meta.phoneNumberId ?? null,
    displayName: conn?.accountEmail ?? null,
  };
}

export const MICROSOFT_SCOPES = MICROSOFT_DEFAULT_SCOPES;
