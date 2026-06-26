// Arcádia IDE — Endpoints REST do Dev Center.
// Padrão: registerIdeRoutes(app), chain de auth [isAuthenticated, tenantContext, requireTenant].

import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant } from "../tenantContext";
import {
  createRun,
  startPipelineAsync,
  listRuns,
  getRunDetail,
  deleteRun,
  approveDeploy,
  markPreviewVisited,
  updateArtifactContent,
  resetArtifact,
  revalidateWithQa,
  handleDeployError,
  exportRunToExternalRemote,
} from "./orchestrator";
import { getIdePreferences, upsertIdePreferences } from "./preferences";
import { IDE_MODEL_CATALOG, isAllowedModel } from "./models";

const auth = [isAuthenticated, tenantContext, requireTenant];

const startRunSchema = z.object({
  title: z.string().min(3).max(300),
  requirement: z.string().min(10).max(20000),
  projectId: z.string().uuid().nullable().optional(),
  // Sprint 6 — alvo do deploy. Default 'frappe' por compatibilidade.
  target: z.enum(["frappe", "suite", "consult", "consultoria", "standalone", "clone"]).optional(),
});

const updateFileSchema = z.object({
  content: z.string().max(200_000),
});

const retryFixSchema = z.object({
  errorMessage: z.string().min(3).max(4000),
});

const modelSchema = z
  .string()
  .refine((v) => isAllowedModel(v), { message: "Modelo não permitido" });

const updatePrefsSchema = z.object({
  modelArchitect: modelSchema.optional(),
  modelDeveloper: modelSchema.optional(),
  modelQa: modelSchema.optional(),
});

export function registerIdeRoutes(app: Express) {
  // POST /api/ide/runs — cria pipeline e dispara assíncrono
  app.post("/api/ide/runs", ...auth, async (req: any, res) => {
    try {
      const data = startRunSchema.parse(req.body);
      const runId = await createRun({
        tenantId: req.tenantId,
        userId: req.user?.claims?.sub ?? req.user?.id ?? null,
        projectId: data.projectId ?? null,
        title: data.title,
        requirement: data.requirement,
        target: data.target ?? null,
      });
      startPipelineAsync(runId, req.tenantId);
      res.status(201).json({ id: runId });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[ide] POST /runs failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao iniciar pipeline" });
    }
  });

  // GET /api/ide/runs — lista runs do tenant
  app.get("/api/ide/runs", ...auth, async (req: any, res) => {
    try {
      const runs = await listRuns(req.tenantId);
      res.json(runs);
    } catch (err: any) {
      console.error("[ide] GET /runs failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao listar runs" });
    }
  });

  // GET /api/ide/runs/:id — detalhe + artefatos
  app.get("/api/ide/runs/:id", ...auth, async (req: any, res) => {
    try {
      const detail = await getRunDetail(req.params.id, req.tenantId);
      if (!detail) return res.status(404).json({ message: "Run não encontrada" });
      res.json(detail);
    } catch (err: any) {
      console.error("[ide] GET /runs/:id failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao carregar run" });
    }
  });

  // DELETE /api/ide/runs/:id
  app.delete("/api/ide/runs/:id", ...auth, async (req: any, res) => {
    try {
      const ok = await deleteRun(req.params.id, req.tenantId);
      if (!ok) return res.status(404).json({ message: "Run não encontrada" });
      res.status(204).end();
    } catch (err: any) {
      console.error("[ide] DELETE /runs/:id failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao remover run" });
    }
  });

  // POST /api/ide/runs/:id/preview-visit — registra que usuário viu o Preview
  // (gate server-side para liberar approve-deploy)
  app.post("/api/ide/runs/:id/preview-visit", ...auth, async (req: any, res) => {
    try {
      const visitedAt = await markPreviewVisited(req.params.id, req.tenantId);
      if (!visitedAt) return res.status(404).json({ message: "Run não encontrada" });
      res.json({ previewVisitedAt: visitedAt });
    } catch (err: any) {
      console.error("[ide] preview-visit failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao registrar visita" });
    }
  });

  // POST /api/ide/runs/:id/export-remote — Fase 1: empurra o histórico do
  // repositório interno para um remote externo (GitHub/GitLab). Tenant-scoped.
  app.post("/api/ide/runs/:id/export-remote", ...auth, async (req: any, res) => {
    const schema = z.object({
      remoteUrl: z.string().url().max(500),
      token: z.string().min(8).max(500).optional(),
      branch: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._\-\/]+$/).optional(),
    });
    try {
      const data = schema.parse(req.body ?? {});
      const result = await exportRunToExternalRemote(req.params.id, req.tenantId, data);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      // err.message já vem sanitizado por exportRunToExternalRemote/InternalGit
      // (sem token e com URL mascarada). Mesmo assim aplicamos um último filtro
      // antes do log para evitar regressões futuras.
      const safe = String(err?.message ?? "Falha ao exportar para remote externo")
        .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[REDACTED]@");
      console.error("[ide] export-remote failed:", safe);
      res.status(400).json({ message: safe });
    }
  });

  // POST /api/ide/runs/:id/approve-deploy — Sprint 2 placeholder (sem deploy real)
  app.post("/api/ide/runs/:id/approve-deploy", ...auth, async (req: any, res) => {
    try {
      const result = await approveDeploy(req.params.id, req.tenantId);
      if (!result) return res.status(404).json({ message: "Run não encontrada" });
      res.json(result);
    } catch (err: any) {
      console.error("[ide] approve-deploy failed:", err);
      res.status(400).json({ message: err?.message || "Erro ao aprovar deploy" });
    }
  });

  // ─── Sprint 3A — Edição de artefatos ─────────────────────────────────
  // PATCH /api/ide/runs/:runId/files/:artId
  app.patch("/api/ide/runs/:runId/files/:artId", ...auth, async (req: any, res) => {
    try {
      const data = updateFileSchema.parse(req.body);
      const updated = await updateArtifactContent(
        req.params.runId,
        req.params.artId,
        req.tenantId,
        data.content,
      );
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[ide] update file failed:", err);
      const status = /não encontrado/i.test(err?.message || "") ? 404 : 400;
      res.status(status).json({ message: err?.message || "Erro ao salvar arquivo" });
    }
  });

  // POST /api/ide/runs/:runId/files/:artId/reset
  app.post("/api/ide/runs/:runId/files/:artId/reset", ...auth, async (req: any, res) => {
    try {
      const updated = await resetArtifact(req.params.runId, req.params.artId, req.tenantId);
      res.json(updated);
    } catch (err: any) {
      console.error("[ide] reset file failed:", err);
      const status = /não encontrado/i.test(err?.message || "") ? 404 : 400;
      res.status(status).json({ message: err?.message || "Erro ao resetar arquivo" });
    }
  });

  // POST /api/ide/runs/:runId/revalidate — roda QA somente sobre arquivos editados
  app.post("/api/ide/runs/:runId/revalidate", ...auth, async (req: any, res) => {
    try {
      const detail = await revalidateWithQa(req.params.runId, req.tenantId);
      if (!detail) return res.status(404).json({ message: "Run não encontrada" });
      res.json(detail);
    } catch (err: any) {
      console.error("[ide] revalidate failed:", err);
      const status = /não encontrad/i.test(err?.message || "") ? 404 : 400;
      res.status(status).json({ message: err?.message || "Erro ao re-validar" });
    }
  });

  // ─── Sprint 3B — Auto-correção pós-deploy ────────────────────────────
  // POST /api/ide/runs/:runId/retry-with-fix — body { errorMessage }
  // Pronto para ser chamado internamente pelo executeDeploy do Sprint 6.
  // Exposto também como endpoint para validação manual no Sprint 3.
  app.post("/api/ide/runs/:runId/retry-with-fix", ...auth, async (req: any, res) => {
    try {
      const data = retryFixSchema.parse(req.body);
      const result = await handleDeployError(req.params.runId, req.tenantId, data.errorMessage);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[ide] retry-with-fix failed:", err);
      const status = /não encontrad/i.test(err?.message || "") ? 404 : 400;
      res.status(status).json({ message: err?.message || "Erro ao tentar correção" });
    }
  });

  // ─── Sprint 3C — Preferências de modelo por fase ─────────────────────
  // GET /api/ide/preferences — devolve catálogo + valores efetivos do tenant
  app.get("/api/ide/preferences", ...auth, async (req: any, res) => {
    try {
      const prefs = await getIdePreferences(req.tenantId);
      res.json({ models: IDE_MODEL_CATALOG, preferences: prefs });
    } catch (err: any) {
      console.error("[ide] get preferences failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao carregar preferências" });
    }
  });

  // PATCH /api/ide/preferences
  app.patch("/api/ide/preferences", ...auth, async (req: any, res) => {
    try {
      const data = updatePrefsSchema.parse(req.body);
      const prefs = await upsertIdePreferences(req.tenantId, data);
      res.json({ models: IDE_MODEL_CATALOG, preferences: prefs });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[ide] update preferences failed:", err);
      res.status(400).json({ message: err?.message || "Erro ao salvar preferências" });
    }
  });
}
