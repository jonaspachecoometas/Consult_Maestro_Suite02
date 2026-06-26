/**
 * Escritório Agente — rotas HTTP.
 *
 * Montadas sob:
 *   /api/agent/credentials   → CRUD do cofre de credenciais web (segredo nunca volta)
 *   /api/agent/approvals     → fila HITL (listar / aprovar / rejeitar)
 *   /api/browser/status      → diagnóstico do Chromium/Playwright
 *   /api/browser/test        → smoke test (navega + snapshot) para o painel da UI
 *
 * Segredos (senha/token) só entram via POST/PATCH e são criptografados; nunca
 * aparecem em respostas nem em logs.
 */
import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { insertWebCredentialSchema } from "@shared/schema";
import {
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
} from "./credentialVault";
import { listApprovals, resolveApproval } from "./hitlApproval";
import { listSkills, archiveSkill, executeSkill } from "./skillsLibrary";
import * as driver from "./playwrightDriver";

function authUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.dbUserId) return req.user.dbUserId;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  return null;
}

const secretSchema = z
  .object({
    password: z.string().optional(),
    token: z.string().optional(),
    extra: z.record(z.any()).optional(),
  })
  .optional();

const createBody = insertWebCredentialSchema
  .omit({ tenantId: true, createdBy: true })
  .extend({ secret: secretSchema });

const updateBody = insertWebCredentialSchema
  .omit({ tenantId: true, createdBy: true })
  .partial()
  .extend({ secret: secretSchema });

export function registerBrowserAgentRoutes(app: Express): void {
  // ── Credenciais ──────────────────────────────────────────────────────────
  app.get("/api/agent/credentials", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const rows = await listCredentials(req.tenantId);
      res.json(rows);
    } catch (e) {
      console.error("[agent] list credentials:", e);
      res.status(500).json({ message: "Falha ao listar credenciais" });
    }
  });

  app.post("/api/agent/credentials", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }
      const { secret, ...data } = parsed.data;
      const row = await createCredential(req.tenantId, data, secret, authUserId(req));
      res.status(201).json(row);
    } catch (e) {
      console.error("[agent] create credential:", e);
      res.status(500).json({ message: "Falha ao criar credencial" });
    }
  });

  app.patch("/api/agent/credentials/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = updateBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }
      const { secret, ...data } = parsed.data;
      const row = await updateCredential(req.tenantId, req.params.id, data, secret);
      if (!row) return res.status(404).json({ message: "Credencial não encontrada" });
      res.json(row);
    } catch (e) {
      console.error("[agent] update credential:", e);
      res.status(500).json({ message: "Falha ao atualizar credencial" });
    }
  });

  app.delete("/api/agent/credentials/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const ok = await deleteCredential(req.tenantId, req.params.id);
      if (!ok) return res.status(404).json({ message: "Credencial não encontrada" });
      res.json({ ok: true });
    } catch (e) {
      console.error("[agent] delete credential:", e);
      res.status(500).json({ message: "Falha ao remover credencial" });
    }
  });

  // ── Aprovações (HITL) ─────────────────────────────────────────────────────
  app.get("/api/agent/approvals", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const rows = await listApprovals(req.tenantId, status);
      res.json(rows);
    } catch (e) {
      console.error("[agent] list approvals:", e);
      res.status(500).json({ message: "Falha ao listar aprovações" });
    }
  });

  app.post("/api/agent/approvals/:id/resolve", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const approved = req.body?.approved === true;
      const row = await resolveApproval(req.tenantId, req.params.id, approved, authUserId(req));
      if (!row) return res.status(404).json({ message: "Aprovação não encontrada ou já resolvida" });
      res.json(row);
    } catch (e) {
      console.error("[agent] resolve approval:", e);
      res.status(500).json({ message: "Falha ao resolver aprovação" });
    }
  });

  // ── Browser diagnóstico / teste ───────────────────────────────────────────
  app.get("/api/browser/status", isAuthenticated, requireTenant, async (_req: any, res) => {
    try {
      const status = await driver.isBrowserAvailable();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/browser/test", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const url = z.string().url().safeParse(req.body?.url);
      if (!url.success) return res.status(400).json({ message: "URL inválida" });
      const taskId = `test:${req.tenantId}`;
      const nav = await driver.navigate(taskId, url.data);
      const snap = await driver.snapshot(taskId);
      await driver.closeSession(taskId);
      res.json({ ...nav, snapshot: snap.snapshot });
    } catch (e: any) {
      console.error("[agent] browser test:", e);
      res.status(500).json({ message: "Falha no teste de browser", error: e?.message ?? String(e) });
    }
  });

  // ── Skills ─────────────────────────────────────────────────────────────────
  app.get("/api/browser/skills", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      res.json(await listSkills(req.tenantId));
    } catch (e: any) {
      res.status(500).json({ message: "Falha ao listar skills", error: e?.message ?? String(e) });
    }
  });

  app.post("/api/browser/skills/:id/archive", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const row = await archiveSkill(req.tenantId, req.params.id);
      if (!row) return res.status(404).json({ message: "Skill não encontrada" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: "Falha ao arquivar skill", error: e?.message ?? String(e) });
    }
  });

  app.post("/api/browser/skills/:id/test", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const taskId = `test:${req.tenantId}:${Date.now()}`;
      const result = await executeSkill(req.params.id, taskId, {
        tenantId: req.tenantId,
        userId: authUserId(req) ?? undefined,
        userConfirmed: true,
      });
      await driver.closeSession(taskId).catch(() => {});
      res.json(result);
    } catch (e: any) {
      console.error("[agent] skill test:", e);
      res.status(500).json({ message: "Falha ao testar skill", error: e?.message ?? String(e) });
    }
  });
}
