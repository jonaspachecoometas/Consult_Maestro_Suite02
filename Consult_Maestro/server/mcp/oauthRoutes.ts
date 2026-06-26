/**
 * MCP Hub — OAuth HTTP routes (Sprint 3)
 *
 * Endpoints (mounted under /api/oauth):
 *
 *   Platform-level (superadmin only — set the OAuth app credentials)
 *   GET    /platform/google           → status (configured? redirectUri, masked client_id)
 *   PUT    /platform/google           → set client_id + client_secret (encrypted on write)
 *   DELETE /platform/google           → remove
 *
 *   Tenant connections (any authenticated user; the resolved tenantId is used)
 *   GET    /connections               → list connections for the current tenant
 *   GET    /google/connect            → 302 redirect to Google's consent screen
 *   GET    /google/callback           → Google redirects back here; tokens persisted
 *   POST   /google/disconnect         → remove the tenant's Google connection
 *
 * IMPORTANT: tokens (access/refresh) NEVER appear in any response body or log.
 * Only metadata (account email, scopes, status, dates) is exposed.
 */

import type { Express, Response, Request } from "express";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant, requireTenantAdmin, requireSuperadmin } from "../tenantContext";
import {
  deletePlatformGoogleApp,
  disconnectGoogle,
  getGoogleAuthUrl,
  getPlatformAppPublic,
  getTenantConnection,
  handleGoogleCallback,
  resolveTenantMembership,
  setPlatformGoogleApp,
  // Microsoft
  deletePlatformMicrosoftApp,
  disconnectMicrosoft,
  getMicrosoftAuthUrl,
  getPlatformMicrosoftAppPublic,
  getTenantMicrosoftConnection,
  handleMicrosoftCallback,
  setPlatformMicrosoftApp,
  // WhatsApp
  disconnectWhatsapp,
  getTenantWhatsappConnection,
  setWhatsappConnection,
} from "./oauthService";

function getUserId(req: any): string | null {
  // Sempre usa o ID interno (users.id). Necessário porque OAuth handlers consultam
  // tenant_users.user_id e oauth_connections.user_id, que armazenam o ID interno.
  // Local auth: req.user.id é o users.id; OIDC: portableAuth grava users.id em dbUserId
  // após upsertOidcUser. Não fazemos fallback para claims.sub (provider subject) porque
  // ele NÃO bate com users.id e quebraria o lookup silenciosamente.
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.dbUserId) return req.user.dbUserId;
  return null;
}

const setPlatformSchema = z.object({
  clientId: z.string().min(8, "Client ID muito curto"),
  clientSecret: z.string().min(8, "Client Secret muito curto"),
  redirectUri: z.string().url().optional().nullable(),
});

export function registerOauthRoutes(app: Express) {
  // ── Platform OAuth app (superadmin) ──────────────────────────────────────
  app.get(
    "/api/oauth/platform/google",
    isAuthenticated,
    requireSuperadmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await getPlatformAppPublic("google");
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] GET platform/google failed:", e?.message);
        res.status(500).json({ message: "Erro ao buscar configuração da plataforma" });
      }
    },
  );

  app.put(
    "/api/oauth/platform/google",
    isAuthenticated,
    requireSuperadmin,
    async (req: any, res: Response) => {
      try {
        const parsed = setPlatformSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") });
        }
        const userId = getUserId(req) || "superadmin";
        const data = await setPlatformGoogleApp({
          clientId: parsed.data.clientId,
          clientSecret: parsed.data.clientSecret,
          redirectUri: parsed.data.redirectUri ?? null,
          updatedBy: userId,
        });
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] PUT platform/google failed:", e?.message);
        res.status(500).json({ message: e?.message || "Erro ao salvar configuração" });
      }
    },
  );

  app.delete(
    "/api/oauth/platform/google",
    isAuthenticated,
    requireSuperadmin,
    async (_req: Request, res: Response) => {
      try {
        await deletePlatformGoogleApp();
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[oauth] DELETE platform/google failed:", e?.message);
        res.status(500).json({ message: "Erro ao remover configuração" });
      }
    },
  );

  // ── Tenant connection status ─────────────────────────────────────────────
  app.get(
    "/api/oauth/connections",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string | undefined;
        const platform = await getPlatformAppPublic("google");
        // Superadmin platform-only session (sem X-Tenant-Id) → devolve status da plataforma
        // sem tentar resolver conexão de tenant. UI exibe avisos apropriados.
        if (!tenantId) {
          const platformMicrosoft = await getPlatformMicrosoftAppPublic();
          const emptyStatus = { connected: false, accountEmail: null, scopes: [] as string[], expiresAt: null, status: null, updatedAt: null };
          return res.json({
            tenantId: null,
            providers: [
              { provider: "google", ...emptyStatus, platformConfigured: platform.configured },
              { provider: "microsoft", ...emptyStatus, platformConfigured: platformMicrosoft.configured },
              { provider: "whatsapp", ...emptyStatus, phoneNumberId: null, displayName: null, platformConfigured: true },
            ],
          });
        }
        const google = await getTenantConnection(tenantId, "google");
        const microsoft = await getTenantMicrosoftConnection(tenantId);
        const whatsapp = await getTenantWhatsappConnection(tenantId);
        const platformMicrosoft = await getPlatformMicrosoftAppPublic();
        res.json({
          tenantId,
          providers: [
            {
              ...google,
              platformConfigured: platform.configured,
            },
            {
              ...microsoft,
              platformConfigured: platformMicrosoft.configured,
            },
            {
              ...whatsapp,
              // WhatsApp não tem app de plataforma; é credencial direta do tenant.
              platformConfigured: true,
            },
          ],
        });
      } catch (e: any) {
        console.error("[oauth] GET /connections failed:", e?.message);
        res.status(500).json({ message: "Erro ao listar conexões" });
      }
    },
  );

  // ── Google OAuth flow ────────────────────────────────────────────────────
  // NOTE: this endpoint cannot rely on `requireTenant` because the popup
  // opened by `window.open(...)` does not carry the `X-Tenant-Id` header.
  // We accept the tenant in the query string and validate membership/admin
  // role server-side before issuing the OAuth state.
  app.get(
    "/api/oauth/google/connect",
    isAuthenticated,
    async (req: any, res: Response) => {
      try {
        const userId = getUserId(req);
        if (!userId) {
          return res
            .status(401)
            .send(renderConnectError("Sessão não identificada."));
        }
        const tenantId = (req.query?.tenantId as string | undefined)?.trim();
        if (!tenantId) {
          return res
            .status(400)
            .send(renderConnectError("Tenant não informado."));
        }
        const role = await resolveTenantMembership(userId, tenantId);
        if (!role || (role !== "superadmin" && role !== "admin")) {
          return res
            .status(403)
            .send(renderConnectError("Você precisa ser admin do tenant para conectar."));
        }
        const url = await getGoogleAuthUrl(tenantId, userId);
        res.redirect(url);
      } catch (e: any) {
        console.error("[oauth] /google/connect failed:", e?.message);
        res.status(400).send(renderConnectError(e?.message || "Erro desconhecido"));
      }
    },
  );

  // Google's callback — comes back from outside our SPA, so it CANNOT rely
  // on the `X-Tenant-Id` header. The tenant is taken from the signed `state`
  // (validated by `handleGoogleCallback`) which also enforces user binding
  // and active admin membership before persisting any tokens.
  app.get(
    "/api/oauth/google/callback",
    isAuthenticated,
    async (req: any, res: Response) => {
      try {
        const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
        if (error) {
          return res.send(renderCallbackHtml({ ok: false, message: `Google retornou erro: ${error}`, provider: "google" }));
        }
        if (!code || !state) {
          return res.send(renderCallbackHtml({ ok: false, message: "Resposta inválida do Google (faltam code/state).", provider: "google" }));
        }
        const userId = getUserId(req);
        if (!userId) {
          return res.send(renderCallbackHtml({ ok: false, message: "Sessão não identificada.", provider: "google" }));
        }
        const result = await handleGoogleCallback(state, code, { userId });
        res.send(renderCallbackHtml({ ok: true, message: `Conta ${result.accountEmail || ""} conectada com sucesso.`, provider: "google" }));
      } catch (e: any) {
        console.error("[oauth] /google/callback failed:", e?.message);
        res.send(renderCallbackHtml({ ok: false, message: e?.message || "Erro ao concluir conexão.", provider: "google" }));
      }
    },
  );

  app.post(
    "/api/oauth/google/disconnect",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        await disconnectGoogle(req.tenantId);
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[oauth] /google/disconnect failed:", e?.message);
        res.status(500).json({ message: "Erro ao desconectar" });
      }
    },
  );

  // ── Platform Microsoft app (superadmin) ──────────────────────────────────
  app.get(
    "/api/oauth/platform/microsoft",
    isAuthenticated,
    requireSuperadmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await getPlatformMicrosoftAppPublic();
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] GET platform/microsoft failed:", e?.message);
        res.status(500).json({ message: "Erro ao buscar configuração da plataforma" });
      }
    },
  );

  app.put(
    "/api/oauth/platform/microsoft",
    isAuthenticated,
    requireSuperadmin,
    async (req: any, res: Response) => {
      try {
        const parsed = setPlatformSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") });
        }
        const userId = getUserId(req) || "superadmin";
        const data = await setPlatformMicrosoftApp({
          clientId: parsed.data.clientId,
          clientSecret: parsed.data.clientSecret,
          redirectUri: parsed.data.redirectUri ?? null,
          updatedBy: userId,
        });
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] PUT platform/microsoft failed:", e?.message);
        res.status(500).json({ message: e?.message || "Erro ao salvar configuração" });
      }
    },
  );

  app.delete(
    "/api/oauth/platform/microsoft",
    isAuthenticated,
    requireSuperadmin,
    async (_req: Request, res: Response) => {
      try {
        await deletePlatformMicrosoftApp();
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[oauth] DELETE platform/microsoft failed:", e?.message);
        res.status(500).json({ message: "Erro ao remover configuração" });
      }
    },
  );

  // ── Microsoft OAuth flow (popup com ?tenantId= na query) ─────────────────
  app.get(
    "/api/oauth/microsoft/connect",
    isAuthenticated,
    async (req: any, res: Response) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).send(renderConnectError("Sessão não identificada."));
        const tenantId = (req.query?.tenantId as string | undefined)?.trim();
        if (!tenantId) return res.status(400).send(renderConnectError("Tenant não informado."));
        const role = await resolveTenantMembership(userId, tenantId);
        if (!role || (role !== "superadmin" && role !== "admin")) {
          return res.status(403).send(renderConnectError("Você precisa ser admin do tenant para conectar."));
        }
        const url = await getMicrosoftAuthUrl(tenantId, userId);
        res.redirect(url);
      } catch (e: any) {
        console.error("[oauth] /microsoft/connect failed:", e?.message);
        res.status(400).send(renderConnectError(e?.message || "Erro desconhecido"));
      }
    },
  );

  app.get(
    "/api/oauth/microsoft/callback",
    isAuthenticated,
    async (req: any, res: Response) => {
      try {
        const { code, state, error, error_description } = req.query as Record<string, string>;
        if (error) {
          return res.send(renderCallbackHtml({ ok: false, message: `Microsoft retornou erro: ${error_description || error}`, provider: "microsoft" }));
        }
        if (!code || !state) {
          return res.send(renderCallbackHtml({ ok: false, message: "Resposta inválida da Microsoft (faltam code/state).", provider: "microsoft" }));
        }
        const userId = getUserId(req);
        if (!userId) {
          return res.send(renderCallbackHtml({ ok: false, message: "Sessão não identificada.", provider: "microsoft" }));
        }
        const result = await handleMicrosoftCallback(state, code, { userId });
        res.send(renderCallbackHtml({ ok: true, message: `Conta ${result.accountEmail || ""} conectada com sucesso.`, provider: "microsoft" }));
      } catch (e: any) {
        console.error("[oauth] /microsoft/callback failed:", e?.message);
        res.send(renderCallbackHtml({ ok: false, message: e?.message || "Erro ao concluir conexão.", provider: "microsoft" }));
      }
    },
  );

  app.post(
    "/api/oauth/microsoft/disconnect",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        await disconnectMicrosoft(req.tenantId);
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[oauth] /microsoft/disconnect failed:", e?.message);
        res.status(500).json({ message: "Erro ao desconectar" });
      }
    },
  );

  // ── WhatsApp Business (config manual — não é OAuth) ──────────────────────
  const whatsappSchema = z.object({
    accessToken: z.string().min(20, "Access token inválido"),
    phoneNumberId: z.string().min(5, "Phone Number ID inválido"),
    businessAccountId: z.string().optional().nullable(),
    displayName: z.string().optional().nullable(),
  });

  app.get(
    "/api/oauth/whatsapp",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const data = await getTenantWhatsappConnection(req.tenantId);
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] GET /whatsapp failed:", e?.message);
        res.status(500).json({ message: "Erro ao buscar conexão WhatsApp" });
      }
    },
  );

  app.put(
    "/api/oauth/whatsapp",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const parsed = whatsappSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") });
        }
        await setWhatsappConnection(req.tenantId, {
          accessToken: parsed.data.accessToken,
          phoneNumberId: parsed.data.phoneNumberId,
          businessAccountId: parsed.data.businessAccountId ?? null,
          displayName: parsed.data.displayName ?? null,
        });
        const data = await getTenantWhatsappConnection(req.tenantId);
        res.json(data);
      } catch (e: any) {
        console.error("[oauth] PUT /whatsapp failed:", e?.message);
        res.status(500).json({ message: e?.message || "Erro ao salvar conexão WhatsApp" });
      }
    },
  );

  app.delete(
    "/api/oauth/whatsapp",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        await disconnectWhatsapp(req.tenantId);
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[oauth] DELETE /whatsapp failed:", e?.message);
        res.status(500).json({ message: "Erro ao desconectar WhatsApp" });
      }
    },
  );
}

function renderConnectError(message: string): string {
  return `<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;padding:24px"><h2>Não foi possível iniciar a conexão</h2><p>${escapeHtml(
    message,
  )}</p><p>Você pode fechar esta janela.</p></body>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML returned to the OAuth popup. It posts a message to the opener so the
 * Integrações page can refresh its state, then closes itself after a short
 * delay so the user sees the success/failure message.
 */
function renderCallbackHtml(args: { ok: boolean; message: string; provider?: string }): string {
  const safeMsg = escapeHtml(args.message);
  const color = args.ok ? "#16a34a" : "#dc2626";
  const icon = args.ok ? "✓" : "✗";
  const provider = (args.provider || "google").replace(/[^a-z0-9_-]/gi, "");
  const title = provider === "microsoft" ? "Integração Microsoft 365" : "Integração Google";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;background:#f8fafc;color:#0f172a}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 40px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.06)}
  .icon{font-size:48px;color:${color};margin-bottom:8px;line-height:1}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;color:#475569;margin:0}
  small{display:block;margin-top:16px;color:#94a3b8}
</style></head>
<body><div class="card"><div class="icon">${icon}</div>
<h1>${args.ok ? "Conexão concluída" : "Falha na conexão"}</h1>
<p>${safeMsg}</p>
<small>Esta janela fecha automaticamente…</small></div>
<script>
  try {
    if (window.opener) {
      // Restringe target à própria origem (callback é servido pelo mesmo backend que hospeda a UI).
      window.opener.postMessage({ type: 'arcadia:oauth:${provider}', provider: '${provider}', ok: ${args.ok ? "true" : "false"} }, window.location.origin);
    }
  } catch(e) {}
  setTimeout(function(){ try { window.close(); } catch(e) {} }, 1800);
</script></body></html>`;
}
