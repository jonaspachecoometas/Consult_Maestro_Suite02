/**
 * MCP Hub — Partner API key management routes (Sprint 4)
 *
 * Authenticated user-facing endpoints to manage `partner_api_keys` rows
 * for the current tenant. Mounted under /api/api-keys.
 *
 *   GET    /api/api-keys              — list (no plain key returned)
 *   POST   /api/api-keys              — create; returns plainKey ONCE
 *   POST   /api/api-keys/:id/revoke   — revoke
 *
 * Only tenant admins can mutate; any tenant member can list (so non-admins
 * can see what's active without revealing secrets).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant, requireTenantAdmin } from "../tenantContext";
import { storage } from "../storage";
import { generateApiKey } from "./apiKeyService";

function getUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.dbUserId) return req.user.dbUserId;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  return null;
}

const ALLOWED_SCOPES = ["core", "control", "societario", "recovery", "google", "microsoft", "whatsapp", "*"];

const createSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(200),
  scopes: z.array(z.string()).min(1, "Pelo menos um escopo é obrigatório"),
  rateLimit: z.number().int().min(1).max(6000).optional(),
});

export function registerApiKeyRoutes(app: Express) {
  // ── GET /api/api-keys ────────────────────────────────────────────────────
  app.get(
    "/api/api-keys",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const rows = await storage.listPartnerApiKeys(req.tenantId);
        res.json({
          count: rows.length,
          keys: rows.map((k) => ({
            id: k.id,
            name: k.name,
            keyPrefix: k.keyPrefix,
            scopes: k.scopes,
            rateLimit: k.rateLimit,
            lastUsedAt: k.lastUsedAt,
            revokedAt: k.revokedAt,
            createdAt: k.createdAt,
          })),
          allowedScopes: ALLOWED_SCOPES,
        });
      } catch (e: any) {
        console.error("[api-keys] GET failed:", e?.message);
        res.status(500).json({ message: "Erro ao listar API keys" });
      }
    },
  );

  // ── POST /api/api-keys ───────────────────────────────────────────────────
  app.post(
    "/api/api-keys",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const parsed = createSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") });
        }
        const invalidScopes = parsed.data.scopes.filter((s) => !ALLOWED_SCOPES.includes(s));
        if (invalidScopes.length > 0) {
          return res.status(400).json({ message: `Escopos inválidos: ${invalidScopes.join(", ")}` });
        }
        const userId = getUserId(req);
        const { plainKey, hash, prefix } = generateApiKey();
        const created = await storage.createPartnerApiKey({
          tenantId: req.tenantId,
          name: parsed.data.name,
          keyHash: hash,
          keyPrefix: prefix,
          scopes: parsed.data.scopes,
          rateLimit: parsed.data.rateLimit ?? 60,
          createdById: userId,
        });
        // Plain key is returned ONLY here; never persisted, never logged.
        res.status(201).json({
          plainKey,
          key: {
            id: created.id,
            name: created.name,
            keyPrefix: created.keyPrefix,
            scopes: created.scopes,
            rateLimit: created.rateLimit,
            createdAt: created.createdAt,
          },
        });
      } catch (e: any) {
        console.error("[api-keys] POST failed:", e?.message);
        res.status(500).json({ message: e?.message || "Erro ao criar API key" });
      }
    },
  );

  // ── POST /api/api-keys/:id/revoke ────────────────────────────────────────
  app.post(
    "/api/api-keys/:id/revoke",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ message: "ID obrigatório" });
        const row = await storage.revokePartnerApiKey(id, req.tenantId);
        if (!row) return res.status(404).json({ message: "API key não encontrada" });
        res.json({ ok: true, id: row.id, revokedAt: row.revokedAt });
      } catch (e: any) {
        console.error("[api-keys] revoke failed:", e?.message);
        res.status(500).json({ message: "Erro ao revogar API key" });
      }
    },
  );
}
