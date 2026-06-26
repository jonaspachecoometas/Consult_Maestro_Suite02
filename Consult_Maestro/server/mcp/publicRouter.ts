/**
 * MCP Hub — Public router (Sprint 4)
 *
 * Exposes the tool registry over a public HTTP endpoint at `/mcp/v1` for
 * external partners. Authentication is by `X-MCP-Key` header (an HMAC-SHA-256-hashed
 * partner API key persisted in `partner_api_keys`). The router is mounted
 * OUTSIDE `/api` and BEFORE `tenantContext`, so cookies/sessions/tenant headers
 * have no effect — the only credential is the API key, which itself binds the
 * call to one tenant.
 *
 * Endpoints:
 *   GET  /mcp/v1/health          — liveness check (no auth)
 *   GET  /mcp/v1/tools           — list tools allowed by the key's scopes
 *   POST /mcp/v1/tools/:name     — execute tool (scope-checked)
 *
 * Rate limit: in-memory token bucket per API key. Default 60 req/min, override
 * via `partner_api_keys.rate_limit`. The bucket resets every 60s.
 *
 * Security:
 *   - Key is never logged in plain text.
 *   - HMAC-SHA-256 hash lookup in DB; revoked keys (revoked_at IS NOT NULL) rejected.
 *   - Scopes filter tool list and gate POST.
 *   - Tools that `requiresConfirmation: true` work as in /api/mcp/tools/:name:
 *     no `userConfirmed: true` → 202 + sentinel.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { storage } from "../storage";
import { hashApiKey, isValidKeyFormat } from "./apiKeyService";
import { toolRegistry, type ToolContext } from "./toolRegistry";
import { recordAiUsage } from "./usageLogger";

interface AuthedRequest extends Request {
  apiKey?: {
    id: string;
    tenantId: string;
    scopes: string[];
    rateLimit: number;
    name: string;
  };
}

// ── In-memory rate limiter ──────────────────────────────────────────────────
// Per-process bucket. Multi-process deployments would need Redis; this is fine
// for the current single-process Replit deploy.
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

// Periodic GC so revoked / inactive keys don't pile up in memory forever.
// Runs every 5 minutes and drops every bucket whose window has already expired.
const BUCKET_GC_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [keyId, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(keyId);
  }
}, BUCKET_GC_INTERVAL_MS).unref?.();

function checkRateLimit(keyId: string, limit: number): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let b = buckets.get(keyId);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(keyId, b);
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt };
}

// ── Auth middleware ─────────────────────────────────────────────────────────
async function authApiKey(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.header("x-mcp-key") || req.header("X-MCP-Key");
    if (!header || !isValidKeyFormat(header)) {
      return res.status(401).json({ error: "missing_or_invalid_api_key" });
    }
    const hash = hashApiKey(header);
    const row = await storage.getPartnerApiKeyByHash(hash);
    if (!row) {
      return res.status(401).json({ error: "invalid_api_key" });
    }
    if (row.revokedAt) {
      return res.status(401).json({ error: "revoked_api_key" });
    }
    req.apiKey = {
      id: row.id,
      tenantId: row.tenantId,
      scopes: row.scopes ?? [],
      rateLimit: row.rateLimit ?? 60,
      name: row.name,
    };
    // Best-effort touch (fire-and-forget). We swallow errors so DB hiccups
    // don't fail the actual request.
    storage.touchPartnerApiKeyUsage(row.id).catch(() => undefined);
    next();
  } catch (e: any) {
    console.error("[mcp/public] auth error:", e?.message ?? e);
    res.status(500).json({ error: "internal_error" });
  }
}

// ── Rate-limit middleware (after auth) ──────────────────────────────────────
function rateLimitMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.apiKey) return res.status(401).json({ error: "unauthenticated" });
  const result = checkRateLimit(req.apiKey.id, req.apiKey.rateLimit);
  res.setHeader("X-RateLimit-Limit", String(req.apiKey.rateLimit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.ok) {
    return res.status(429).json({
      error: "rate_limit_exceeded",
      retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
    });
  }
  next();
}

// ── Scope checking ──────────────────────────────────────────────────────────
function isToolAllowed(scopes: string[], module: string): boolean {
  // Empty scopes = no access. Wildcard '*' = all modules.
  if (!scopes || scopes.length === 0) return false;
  if (scopes.includes("*")) return true;
  return scopes.includes(module);
}

export function buildPublicMcpRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /mcp/v1/health:
   *   get:
   *     summary: Liveness check (no auth)
   *     tags: [MCP Public]
   *     responses:
   *       200:
   *         description: Service is up
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "mcp-public", version: "v1" });
  });

  /**
   * @openapi
   * /mcp/v1/tools:
   *   get:
   *     summary: List tools allowed by the API key's scopes
   *     tags: [MCP Public]
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Tools list
   */
  router.get("/tools", authApiKey, rateLimitMiddleware, (req: AuthedRequest, res: Response) => {
    try {
      const all = toolRegistry.listForAgent(req.apiKey!.tenantId);
      const allowed = all.filter((t) => isToolAllowed(req.apiKey!.scopes, t.module));
      res.json({
        count: allowed.length,
        tools: allowed.map((t) => ({
          name: t.name,
          module: t.module,
          description: t.description,
          requiresConfirmation: t.requiresConfirmation,
          inputSchema: t.inputSchema,
        })),
      });
    } catch (e: any) {
      console.error("[mcp/public] GET /tools failed:", e?.message ?? e);
      res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * @openapi
   * /mcp/v1/tools/{name}:
   *   post:
   *     summary: Execute a tool by name
   *     tags: [MCP Public]
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               input: { type: object }
   *               userConfirmed: { type: boolean }
   *               projectId: { type: string }
   *     responses:
   *       200: { description: Tool result }
   *       202: { description: Confirmation required (sentinel) }
   *       400: { description: Bad input or domain error }
   *       403: { description: Scope not granted }
   *       404: { description: Tool not registered }
   *       429: { description: Rate limit exceeded }
   */
  router.post("/tools/:name", authApiKey, rateLimitMiddleware, async (req: AuthedRequest, res: Response) => {
    const startedAt = Date.now();
    const name = String(req.params.name || "").trim();
    let outcome: "ok" | "confirmation_required" | "error" | "scope_denied" | "bad_input" = "ok";
    try {
      if (!name) {
        outcome = "bad_input";
        return res.status(400).json({ error: "missing_tool_name" });
      }
      const tool = toolRegistry.get(name);
      // To avoid leaking which tools exist for keys that lack scope,
      // collapse "tool not found" and "tool out of scope" into the same response.
      if (!tool || !isToolAllowed(req.apiKey!.scopes, tool.module)) {
        outcome = "scope_denied";
        return res.status(403).json({ error: "tool_not_available" });
      }
      const body = req.body || {};
      const input = body.input ?? (() => {
        const { userConfirmed, projectId, ...rest } = body;
        return rest;
      })();
      const ctx: ToolContext = {
        tenantId: req.apiKey!.tenantId,
        userId: null,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        userConfirmed: body.userConfirmed === true,
        meta: { source: "mcp_public_v1", apiKeyId: req.apiKey!.id, apiKeyName: req.apiKey!.name },
      };
      const result = await toolRegistry.execute(name, input, ctx);
      if (result && typeof result === "object" && (result as any).__requires_confirmation) {
        outcome = "confirmation_required";
        return res.status(202).json(result);
      }
      if (result && typeof result === "object" && (result as any).error) {
        outcome = "error";
        return res.status(400).json({ error: (result as any).error, message: (result as any).message });
      }
      res.json(result);
    } catch (e: any) {
      outcome = "error";
      console.error(`[mcp/public] POST /tools/${req.params.name} failed:`, e?.message ?? e);
      res.status(500).json({ error: "internal_error" });
    } finally {
      // Record every public MCP call into ai_usage_logs with source='partner_api'.
      // Tool calls have no LLM token usage, so we record 0 tokens; the dashboard
      // counts requests via row count, and `task_type` carries the tool + outcome.
      // taskType is varchar(50): keep the encoded value short.
      const durationMs = Date.now() - startedAt;
      void recordAiUsage({
        tenantId: req.apiKey?.tenantId ?? null,
        userId: null,
        provider: "mcp_public",
        model: name || "unknown",
        source: "partner_api",
        tokensInput: 0,
        tokensOutput: 0,
        taskType: `${outcome}:${durationMs}ms`.slice(0, 50),
      });
    }
  });

  return router;
}
