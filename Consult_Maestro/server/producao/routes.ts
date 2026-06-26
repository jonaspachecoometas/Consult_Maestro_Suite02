// Central de Produção — Evolução
// Rotas: subprojetos, drive, calendário, agente scrum (Modo 1 e Modo 2)
// Padrão Control: tenantContext explícito no chain (registradas antes do app.use(tenantContext) global)

import type { Express } from "express";
import multer from "multer";
import { db } from "../db";
import {
  projects, tasks, subprojects, projectFiles, projectCalendarEvents,
  taskAgentSessions, superAgentMessages, scrumSprints, scrumBacklogItems,
  scrumInternalProjects,
  insertSubprojectSchema, insertProjectCalendarEventSchema,
} from "@shared/schema";
import { and, eq, desc, asc, gte, lte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant } from "../tenantContext";
import { ObjectStorageService } from "../objectStorage";
import { extractText, mapFileType } from "./projectFileService";
import { analisarDocumento, aplicarPlano, sendTaskMessage, buildTaskSystemPrompt } from "./scrumAgent";
import { gerarCronogramaTemplate } from "./cronogramaTemplateService";
import { importarCronograma } from "./cronogramaImportService";
import {
  listarReunioes, obterReuniao, criarReuniao, atualizarReuniao,
  adicionarAcao, atualizarAcao, listarAcoesPendentes, gerarPauta,
} from "./reunioesService";
import { gerarAta, getAtaAbsolutePath } from "./ataGeradaService";
import { getRelatorio, exportarXlsx as exportarRelatorioXlsx, exportarHtml as exportarRelatorioHtml, invalidarCacheAlertas } from "./relatorioProjetoService";
import * as demandasService from "./demandasCentralService";
import { insertDemandaCentralSchema } from "@shared/schema";
import * as fs from "fs";
import { randomUUID } from "crypto";

const auth = [isAuthenticated, tenantContext, requireTenant];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function projectBelongsToTenant(projectId: string, tenantId: string): Promise<boolean> {
  const [p] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
  return !!p;
}

async function getProjectTypeIfTenantOwner(projectId: string, tenantId: string): Promise<string | null> {
  const [p] = await db.select({ type: projects.type }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
  return p?.type ?? null;
}

async function subprojectBelongsToProject(subprojectId: string, projectId: string, tenantId: string): Promise<boolean> {
  const [r] = await db.select({ id: subprojects.id }).from(subprojects)
    .where(and(
      eq(subprojects.id, subprojectId),
      eq(subprojects.projectId, projectId),
      eq(subprojects.tenantId, tenantId),
    )).limit(1);
  return !!r;
}

async function taskBelongsToTenant(taskId: string, tenantId: string): Promise<{ task: typeof tasks.$inferSelect } | null> {
  const [t] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId))).limit(1);
  return t ? { task: t } : null;
}

// ─── F2: Subprojetos ────────────────────────────────────────────────────────

const subprojectInputSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().nullable().optional(),
  ordem: z.number().int().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(["ativo", "concluido", "pausado"]).optional(),
  color: z.string().max(20).nullable().optional(),
});

export function registerProducaoRoutes(app: Express) {
  // Subprojetos
  app.get("/api/projects/:id/subprojects", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const list = await db.select().from(subprojects)
        .where(and(eq(subprojects.projectId, req.params.id), eq(subprojects.tenantId, req.tenantId)))
        .orderBy(asc(subprojects.ordem), asc(subprojects.createdAt));
      res.json(list);
    } catch (err: any) {
      console.error("[producao] GET subprojects:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/subprojects", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const data = subprojectInputSchema.parse(req.body);
      const [created] = await db.insert(subprojects).values({
        projectId: req.params.id,
        tenantId: req.tenantId,
        createdById: req.user?.id || null,
        ...data,
      }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      console.error("[producao] POST subprojects:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/projects/:id/subprojects/:sid", ...auth, async (req: any, res) => {
    try {
      if (!(await subprojectBelongsToProject(req.params.sid, req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Subprojeto não encontrado" });
      }
      const data = subprojectInputSchema.partial().parse(req.body);
      const [updated] = await db.update(subprojects).set({ ...data, updatedAt: new Date() })
        .where(eq(subprojects.id, req.params.sid)).returning();
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/subprojects/:sid", ...auth, async (req: any, res) => {
    try {
      if (!(await subprojectBelongsToProject(req.params.sid, req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Subprojeto não encontrado" });
      }
      // Tasks/sprints/PBIs com este subprojectId mantêm o ID — frontend trata como órfão.
      // Limpeza explícita p/ evitar referência quebrada (FK na verdade é nullable, mas
      // limpamos para que a árvore Subprojeto→Sprint→PBI não fique inconsistente).
      await db.update(tasks).set({ subprojectId: null }).where(eq(tasks.subprojectId, req.params.sid));
      await db.update(scrumSprints).set({ subprojectId: null }).where(eq(scrumSprints.subprojectId, req.params.sid));
      await db.update(scrumBacklogItems).set({ subprojectId: null }).where(eq(scrumBacklogItems.subprojectId, req.params.sid));
      await db.delete(subprojects).where(eq(subprojects.id, req.params.sid));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Scrum Context — bootstrap/leitura do internal_project deste projeto ──
  // Permite que a UI saiba o internalProjectId para consumir endpoints scrum/* existentes.
  app.get("/api/projects/:id/scrum-context", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [ip] = await db.select().from(scrumInternalProjects)
        .where(eq(scrumInternalProjects.clientProjectId, req.params.id))
        .orderBy(asc(scrumInternalProjects.createdAt))
        .limit(1);
      res.json({ internalProjectId: ip?.id || null, internalProject: ip || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cria o internal_project se ainda não existir (idempotente). Útil quando
  // o usuário cria a primeira sprint/PBI pela UI antes de rodar o Agente.
  app.post("/api/projects/:id/scrum-context/ensure", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [proj] = await db.select().from(projects).where(eq(projects.id, req.params.id)).limit(1);
      if (!proj) return res.status(404).json({ message: "Projeto não encontrado" });

      const [existing] = await db.select().from(scrumInternalProjects)
        .where(eq(scrumInternalProjects.clientProjectId, req.params.id))
        .orderBy(asc(scrumInternalProjects.createdAt))
        .limit(1);
      if (existing) return res.json({ internalProjectId: existing.id, internalProject: existing, created: false });

      try {
        const [created] = await db.insert(scrumInternalProjects).values({
          name: proj.name,
          description: `Projeto Scrum vinculado a ${proj.name}`,
          clientProjectId: req.params.id,
          isInternal: 0,
          status: "active",
          createdById: req.user?.claims?.sub || req.user?.id,
        }).returning();
        res.status(201).json({ internalProjectId: created.id, internalProject: created, created: true });
      } catch (e: any) {
        if (e?.code === "23505") {
          // Race: outra request criou simultaneamente
          const [retry] = await db.select().from(scrumInternalProjects)
            .where(eq(scrumInternalProjects.clientProjectId, req.params.id))
            .orderBy(asc(scrumInternalProjects.createdAt))
            .limit(1);
          if (retry) return res.json({ internalProjectId: retry.id, internalProject: retry, created: false });
        }
        throw e;
      }
    } catch (err: any) {
      console.error("[producao] ensure scrum-context:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── PBIs por projeto (Scrum Backlog Items gerados pelo Agente) ───────────
  // Lista PBIs vinculados ao internal_project derivado deste cliente,
  // com filtros opcionais por subprojectId / sprintId.
  app.get("/api/projects/:id/pbis", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      // Resolve internal project (se não houver, lista vazia — não há PBIs ainda).
      // Há índice único parcial em client_project_id, mas ordenamos para garantir
      // determinismo caso o índice ainda não exista (env legado).
      const [ip] = await db.select({ id: scrumInternalProjects.id }).from(scrumInternalProjects)
        .where(eq(scrumInternalProjects.clientProjectId, req.params.id))
        .orderBy(asc(scrumInternalProjects.createdAt))
        .limit(1);
      if (!ip) return res.json([]);

      const conds: any[] = [
        eq(scrumBacklogItems.tenantId, req.tenantId),
        eq(scrumBacklogItems.internalProjectId, ip.id),
      ];
      if (req.query.subprojectId) {
        conds.push(eq(scrumBacklogItems.subprojectId, String(req.query.subprojectId)));
      }
      if (req.query.sprintId) {
        conds.push(eq(scrumBacklogItems.sprintId, String(req.query.sprintId)));
      }
      const list = await db.select().from(scrumBacklogItems)
        .where(and(...conds))
        .orderBy(asc(scrumBacklogItems.sprintOrder), asc(scrumBacklogItems.backlogOrder));
      res.json(list);
    } catch (err: any) {
      console.error("[producao] GET pbis:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Lista sprints do projeto (via internal_project)
  app.get("/api/projects/:id/sprints", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [ip] = await db.select({ id: scrumInternalProjects.id }).from(scrumInternalProjects)
        .where(eq(scrumInternalProjects.clientProjectId, req.params.id))
        .orderBy(asc(scrumInternalProjects.createdAt))
        .limit(1);
      if (!ip) return res.json([]);

      const list = await db.select().from(scrumSprints)
        .where(eq(scrumSprints.internalProjectId, ip.id))
        .orderBy(asc(scrumSprints.startDate));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── F3: Drive — arquivos por projeto ─────────────────────────────────────
  app.get("/api/projects/:id/drive", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const conds = [eq(projectFiles.projectId, req.params.id)];
      // Filtros opcionais
      if (req.query.categoria) conds.push(eq(projectFiles.categoria, String(req.query.categoria)));
      if (req.query.subprojectId) conds.push(eq(projectFiles.subprojectId, String(req.query.subprojectId)));
      if (req.query.taskId) conds.push(eq(projectFiles.taskId, String(req.query.taskId)));
      if (req.query.unlinked === "1") {
        conds.push(sql`${projectFiles.taskId} IS NULL`);
      }
      const list = await db.select().from(projectFiles)
        .where(and(...conds))
        .orderBy(desc(projectFiles.createdAt));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id/drive/:fid", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [f] = await db.select().from(projectFiles)
        .where(and(eq(projectFiles.id, req.params.fid), eq(projectFiles.projectId, req.params.id))).limit(1);
      if (!f) return res.status(404).json({ message: "Arquivo não encontrado" });
      res.json(f);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id/drive/:fid/download", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [f] = await db.select().from(projectFiles)
        .where(and(eq(projectFiles.id, req.params.fid), eq(projectFiles.projectId, req.params.id))).limit(1);
      if (!f) return res.status(404).json({ message: "Arquivo não encontrado" });
      const svc = new ObjectStorageService();
      const url = await svc.getSignedUrl(f.storageKey, 3600);
      res.json({ url, mimeType: f.mimeType, originalName: f.originalName });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST upload no projeto (multipart) — pode opcionalmente vincular subprojeto OU task
  app.post("/api/projects/:id/drive", ...auth, upload.single("file"), async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Arquivo ausente" });

      const subprojectId = req.body.subprojectId || null;
      const taskId = req.body.taskId || null;
      const categoria = req.body.categoria || "documento";
      const description = req.body.description || null;

      if (subprojectId && !(await subprojectBelongsToProject(subprojectId, req.params.id, req.tenantId))) {
        return res.status(400).json({ message: "Subprojeto inválido" });
      }
      if (taskId) {
        const checkTask = await taskBelongsToTenant(taskId, req.tenantId);
        if (!checkTask || checkTask.task.projectId !== req.params.id) {
          return res.status(400).json({ message: "Task inválida para este projeto" });
        }
      }

      // 1. Upload pro Object Storage
      const svc = new ObjectStorageService();
      const objectId = randomUUID();
      const storageKey = `.private/produccao-files/${req.params.id}/${objectId}-${file.originalname}`.replace(/\s+/g, "_");
      await svc.upload(storageKey, file.buffer, file.mimetype || "application/octet-stream");

      // 2. Extrair texto (silencioso)
      const extractedText = await extractText(file.buffer, file.mimetype || "", file.originalname);

      // 3. Persistir registro
      const [created] = await db.insert(projectFiles).values({
        projectId: req.params.id,
        tenantId: req.tenantId,
        subprojectId,
        taskId,
        fileName: file.originalname.slice(0, 255),
        originalName: file.originalname.slice(0, 255),
        fileType: mapFileType(file.mimetype || "", file.originalname),
        mimeType: file.mimetype || null,
        fileSize: file.size,
        storageKey,
        description,
        categoria,
        extractedText: extractedText || null,
        uploadedById: req.user?.id || null,
      }).returning();

      res.status(201).json(created);
    } catch (err: any) {
      console.error("[producao] POST files:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/projects/:id/drive/:fid", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [f] = await db.select().from(projectFiles)
        .where(and(eq(projectFiles.id, req.params.fid), eq(projectFiles.projectId, req.params.id))).limit(1);
      if (!f) return res.status(404).json({ message: "Arquivo não encontrado" });

      const patchSchema = z.object({
        categoria: z.string().max(50).optional(),
        description: z.string().nullable().optional(),
        subprojectId: z.string().nullable().optional(),
        taskId: z.string().nullable().optional(),
      });
      const data = patchSchema.parse(req.body);

      if (data.subprojectId && !(await subprojectBelongsToProject(data.subprojectId, req.params.id, req.tenantId))) {
        return res.status(400).json({ message: "Subprojeto inválido" });
      }
      if (data.taskId) {
        const ck = await taskBelongsToTenant(data.taskId, req.tenantId);
        if (!ck || ck.task.projectId !== req.params.id) {
          return res.status(400).json({ message: "Task inválida para este projeto" });
        }
      }

      const [updated] = await db.update(projectFiles).set({ ...data, updatedAt: new Date() })
        .where(eq(projectFiles.id, req.params.fid)).returning();
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/drive/:fid", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const [f] = await db.select().from(projectFiles)
        .where(and(eq(projectFiles.id, req.params.fid), eq(projectFiles.projectId, req.params.id))).limit(1);
      if (!f) return res.status(404).json({ message: "Arquivo não encontrado" });
      const svc = new ObjectStorageService();
      try { await svc.deleteObject(f.storageKey); } catch { /* já pode estar removido */ }
      await db.delete(projectFiles).where(eq(projectFiles.id, req.params.fid));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Arquivos por task ────────────────────────────────────────────────────
  app.get("/api/tasks/:id/files", ...auth, async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const list = await db.select().from(projectFiles)
        .where(eq(projectFiles.taskId, req.params.id))
        .orderBy(desc(projectFiles.createdAt));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/files", ...auth, upload.single("file"), async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Arquivo ausente" });

      const svc = new ObjectStorageService();
      const objectId = randomUUID();
      const storageKey = `.private/produccao-files/${ck.task.projectId}/${objectId}-${file.originalname}`.replace(/\s+/g, "_");
      await svc.upload(storageKey, file.buffer, file.mimetype || "application/octet-stream");
      const extractedText = await extractText(file.buffer, file.mimetype || "", file.originalname);

      const [created] = await db.insert(projectFiles).values({
        projectId: ck.task.projectId,
        tenantId: req.tenantId,
        subprojectId: ck.task.subprojectId || null,
        taskId: req.params.id,
        fileName: file.originalname.slice(0, 255),
        originalName: file.originalname.slice(0, 255),
        fileType: mapFileType(file.mimetype || "", file.originalname),
        mimeType: file.mimetype || null,
        fileSize: file.size,
        storageKey,
        categoria: req.body.categoria || "documento",
        description: req.body.description || null,
        extractedText: extractedText || null,
        uploadedById: req.user?.id || null,
      }).returning();

      res.status(201).json(created);
    } catch (err: any) {
      console.error("[producao] POST tasks/:id/files:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── F4: Calendário ──────────────────────────────────────────────────────
  const eventInputSchema = z.object({
    titulo: z.string().min(1).max(300),
    descricao: z.string().nullable().optional(),
    dataInicio: z.string(),
    dataFim: z.string().nullable().optional(),
    horaInicio: z.string().max(5).nullable().optional(),
    horaFim: z.string().max(5).nullable().optional(),
    tipo: z.enum(["reuniao_sprint", "marco_go_live", "entrega", "tarefa", "bloqueio", "outro"]).optional(),
    participantes: z.string().nullable().optional(),
    local: z.string().max(300).nullable().optional(),
    subprojectId: z.string().nullable().optional(),
    sprintId: z.string().nullable().optional(),
  });

  app.get("/api/projects/:id/calendar", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const conds = [eq(projectCalendarEvents.projectId, req.params.id)];
      if (req.query.from) conds.push(gte(projectCalendarEvents.dataInicio, String(req.query.from)));
      if (req.query.to) conds.push(lte(projectCalendarEvents.dataInicio, String(req.query.to)));
      const list = await db.select().from(projectCalendarEvents)
        .where(and(...conds))
        .orderBy(asc(projectCalendarEvents.dataInicio));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Helper: garante que subprojectId/sprintId referenciados pertencem ao projeto+tenant
  async function validateCalendarRefs(projectId: string, tenantId: string, data: any): Promise<string | null> {
    if (data.subprojectId) {
      const ck = await subprojectBelongsToProject(data.subprojectId, projectId, tenantId);
      if (!ck) return "subprojectId não pertence a este projeto";
    }
    if (data.sprintId) {
      // Sprint precisa pertencer a um subprojeto deste projeto
      const [row] = await db.select({ id: scrumSprints.id })
        .from(scrumSprints)
        .innerJoin(subprojects, eq(subprojects.id, scrumSprints.subprojectId))
        .where(and(
          eq(scrumSprints.id, data.sprintId),
          eq(subprojects.projectId, projectId),
          eq(subprojects.tenantId, tenantId),
        )).limit(1);
      if (!row) return "sprintId não pertence a este projeto";
    }
    return null;
  }

  app.post("/api/projects/:id/calendar", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const data = eventInputSchema.parse(req.body);
      const refErr = await validateCalendarRefs(req.params.id, req.tenantId, data);
      if (refErr) return res.status(400).json({ message: refErr });
      const [created] = await db.insert(projectCalendarEvents).values({
        projectId: req.params.id,
        tenantId: req.tenantId,
        createdById: req.user?.id || null,
        ...data,
      }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/projects/:id/calendar/:eid", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      const data = eventInputSchema.partial().parse(req.body);
      const refErr = await validateCalendarRefs(req.params.id, req.tenantId, data);
      if (refErr) return res.status(400).json({ message: refErr });
      const [updated] = await db.update(projectCalendarEvents).set({ ...data, updatedAt: new Date() })
        .where(and(eq(projectCalendarEvents.id, req.params.eid), eq(projectCalendarEvents.projectId, req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Evento não encontrado" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/projects/:id/calendar/:eid", ...auth, async (req: any, res) => {
    try {
      if (!(await projectBelongsToTenant(req.params.id, req.tenantId))) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      await db.delete(projectCalendarEvents)
        .where(and(eq(projectCalendarEvents.id, req.params.eid), eq(projectCalendarEvents.projectId, req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── F5: Agente Scrum — Modo 1 (análise documento) ───────────────────────
  app.post("/api/projects/:id/drive/:fid/analyze", ...auth, async (req: any, res) => {
    try {
      const projectType = await getProjectTypeIfTenantOwner(req.params.id, req.tenantId);
      if (!projectType) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      if (projectType === "compass") {
        return res.status(400).json({
          message: "Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum — isso cria um projeto de produção em que o Agente Scrum poderá atuar.",
        });
      }
      const result = await analisarDocumento({
        tenantId: req.tenantId, projectId: req.params.id, fileId: req.params.fid,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[producao] analyze:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects/:id/drive/:fid/apply-plan", ...auth, async (req: any, res) => {
    try {
      const projectType = await getProjectTypeIfTenantOwner(req.params.id, req.tenantId);
      if (!projectType) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      if (projectType === "compass") {
        return res.status(400).json({
          message: "Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum — isso cria um projeto de produção em que o Agente Scrum poderá atuar.",
        });
      }
      const plan = req.body?.plan;
      if (!plan) return res.status(400).json({ message: "Plano ausente" });
      const result = await aplicarPlano({
        tenantId: req.tenantId, userId: req.user.id,
        projectId: req.params.id, plan,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[producao] apply-plan:", err);
      const msg = err?.message || "Erro";
      const status = msg.startsWith("Plano inválido") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  // Aplicar plano vindo do chat (sem arquivo de origem). Reusa aplicarPlano.
  app.post("/api/projects/:id/apply-plan", ...auth, async (req: any, res) => {
    try {
      const projectType = await getProjectTypeIfTenantOwner(req.params.id, req.tenantId);
      if (!projectType) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      if (projectType === "compass") {
        return res.status(400).json({
          message: "Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum — isso cria um projeto de produção em que o Agente Scrum poderá atuar.",
        });
      }
      const plan = req.body?.plan;
      if (!plan) return res.status(400).json({ message: "Plano ausente" });
      const result = await aplicarPlano({
        tenantId: req.tenantId, userId: req.user.id,
        projectId: req.params.id, plan,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[producao] apply-plan (chat):", err);
      const msg = err?.message || "Erro";
      const status = msg.startsWith("Plano inválido") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  // ─── F5: Agente Scrum — Modo 2 (chat na tarefa) ──────────────────────────
  app.get("/api/tasks/:id/agent/sessions", ...auth, async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const list = await db.select().from(taskAgentSessions)
        .where(and(eq(taskAgentSessions.taskId, req.params.id), eq(taskAgentSessions.tenantId, req.tenantId)))
        .orderBy(desc(taskAgentSessions.updatedAt));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/agent/sessions", ...auth, async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const projectType = await getProjectTypeIfTenantOwner(ck.task.projectId, req.tenantId);
      if (projectType === "compass") {
        return res.status(400).json({
          message: "Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum — isso cria um projeto de produção em que o Agente Scrum poderá atuar.",
        });
      }
      const titulo = (req.body?.titulo || "Conversa com Agente Scrum").slice(0, 200);
      const { task } = ck;
      const [created] = await db.insert(taskAgentSessions).values({
        taskId: req.params.id,
        projectId: task.projectId,
        tenantId: req.tenantId,
        userId: req.user?.id || null,
        titulo,
        taskContext: { title: task.title, description: task.description, entregavel: task.entregavel, status: task.status },
      }).returning();
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tasks/:id/agent/sessions/:sid/messages", ...auth, async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const [sess] = await db.select().from(taskAgentSessions)
        .where(and(
          eq(taskAgentSessions.id, req.params.sid),
          eq(taskAgentSessions.taskId, req.params.id),
          eq(taskAgentSessions.tenantId, req.tenantId),
        )).limit(1);
      if (!sess) return res.status(404).json({ message: "Sessão não encontrada" });
      const msgs = await db.select().from(superAgentMessages)
        .where(eq(superAgentMessages.taskSessionId, req.params.sid))
        .orderBy(asc(superAgentMessages.createdAt));
      res.json(msgs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/agent/sessions/:sid/messages", ...auth, async (req: any, res) => {
    try {
      const ck = await taskBelongsToTenant(req.params.id, req.tenantId);
      if (!ck) return res.status(404).json({ message: "Tarefa não encontrada" });
      const projectType = await getProjectTypeIfTenantOwner(ck.task.projectId, req.tenantId);
      if (projectType === "compass") {
        return res.status(400).json({
          message: "Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum — isso cria um projeto de produção em que o Agente Scrum poderá atuar.",
        });
      }
      const userMessage = String(req.body?.content || "").trim();
      if (!userMessage) return res.status(400).json({ message: "Mensagem vazia" });

      const result = await sendTaskMessage({
        tenantId: req.tenantId,
        userId: req.user.id,
        taskId: req.params.id,
        sessionId: req.params.sid,
        userMessage,
      });
      res.json({ assistant: { content: result.assistantContent }, ...result });
    } catch (err: any) {
      console.error("[producao] task agent send:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── PROD-1: Cronograma — Template + Importador ───────────────────────────

  // GET /api/producao/templates/cronograma?projeto=&cliente=&parceiro=&dataInicio=YYYY-MM-DD
  // Gera .xlsx no layout exato Impacto Geologia
  app.get("/api/producao/templates/cronograma", ...auth, async (req: any, res) => {
    try {
      const projetoNome = String(req.query.projeto || "").trim() || undefined;
      const clienteNome = String(req.query.cliente || "").trim() || undefined;
      const parceiroNome = String(req.query.parceiro || "ARCadia Capital").trim();
      const dataInicioStr = String(req.query.dataInicio || "").trim();
      const dataInicio = dataInicioStr && /^\d{4}-\d{2}-\d{2}$/.test(dataInicioStr)
        ? new Date(dataInicioStr + "T00:00:00")
        : new Date();

      const buf = gerarCronogramaTemplate({
        projetoNome,
        clienteNome,
        parceiroNome,
        dataInicio,
        numeroReunioes: 20,
      });

      const filename = `cronograma_${(projetoNome || "projeto").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[producao] template cronograma:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── PROD-2: Reuniões + Atas ──────────────────────────────────────────────

  // Helper: garante que o internal project existe e tem clientProject pertencente ao tenant
  async function assertProjetoTenant(projetoId: string, tenantId: string): Promise<void> {
    const [iproj] = await db.select().from(scrumInternalProjects)
      .where(eq(scrumInternalProjects.id, projetoId)).limit(1);
    if (!iproj) throw Object.assign(new Error("Projeto não encontrado"), { httpStatus: 404 });
    if (!iproj.clientProjectId) {
      throw Object.assign(new Error("Vincule este projeto a um projeto cliente antes de gerenciar reuniões."), { httpStatus: 400 });
    }
    const ok = await projectBelongsToTenant(iproj.clientProjectId, tenantId);
    if (!ok) throw Object.assign(new Error("Sem acesso a este projeto"), { httpStatus: 403 });
  }

  app.get("/api/producao/projetos/:id/reunioes", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      const list = await listarReunioes(req.tenantId, req.params.id);
      res.json(list);
    } catch (err: any) {
      res.status(err.httpStatus || 500).json({ message: err.message });
    }
  });

  app.post("/api/producao/projetos/:id/reunioes", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      const r = await criarReuniao(req.tenantId, req.params.id, req.body);
      res.status(201).json(r);
    } catch (err: any) {
      res.status(err.httpStatus || 400).json({ message: err.message });
    }
  });

  app.get("/api/producao/projetos/:id/acoes-pendentes", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      const list = await listarAcoesPendentes(req.tenantId, req.params.id);
      res.json(list);
    } catch (err: any) {
      res.status(err.httpStatus || 500).json({ message: err.message });
    }
  });

  app.get("/api/producao/reunioes/:id", ...auth, async (req: any, res) => {
    try {
      const r = await obterReuniao(req.tenantId, req.params.id);
      res.json(r);
    } catch (err: any) {
      res.status(err.message === "Reunião não encontrada" ? 404 : 500).json({ message: err.message });
    }
  });

  app.put("/api/producao/reunioes/:id", ...auth, async (req: any, res) => {
    try {
      const r = await atualizarReuniao(req.tenantId, req.params.id, req.body);
      res.json(r);
    } catch (err: any) {
      res.status(err.message === "Reunião não encontrada" ? 404 : 400).json({ message: err.message });
    }
  });

  app.post("/api/producao/reunioes/:id/gerar-pauta", ...auth, async (req: any, res) => {
    try {
      const r = await gerarPauta(req.tenantId, req.params.id);
      res.json(r);
    } catch (err: any) {
      res.status(err.message === "Reunião não encontrada" ? 404 : 500).json({ message: err.message });
    }
  });

  app.post("/api/producao/reunioes/:id/gerar-ata", ...auth, async (req: any, res) => {
    try {
      const r = await gerarAta(req.tenantId, req.params.id);
      res.json(r);
    } catch (err: any) {
      console.error("[producao] gerar-ata:", err);
      res.status(err.message === "Reunião não encontrada" ? 404 : 500).json({ message: err.message });
    }
  });

  app.get("/api/producao/reunioes/:id/ata/download", ...auth, async (req: any, res) => {
    try {
      // Garante tenant
      const { reuniao } = await obterReuniao(req.tenantId, req.params.id);
      if (!reuniao.ataDocUrl) return res.status(404).json({ message: "Ata ainda não gerada" });
      const abs = getAtaAbsolutePath(req.params.id);
      if (!fs.existsSync(abs)) return res.status(404).json({ message: "Arquivo da ata não encontrado em disco" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="ata_reuniao_${reuniao.numero ?? "x"}.docx"`);
      res.sendFile(abs);
    } catch (err: any) {
      res.status(err.message === "Reunião não encontrada" ? 404 : 500).json({ message: err.message });
    }
  });

  app.post("/api/producao/reunioes/:id/acoes", ...auth, async (req: any, res) => {
    try {
      const a = await adicionarAcao(req.tenantId, req.params.id, req.body);
      res.status(201).json(a);
    } catch (err: any) {
      res.status(err.message === "Reunião não encontrada" ? 404 : 400).json({ message: err.message });
    }
  });

  app.put("/api/producao/acoes/:id", ...auth, async (req: any, res) => {
    try {
      const a = await atualizarAcao(req.tenantId, req.params.id, req.body);
      res.json(a);
    } catch (err: any) {
      res.status(err.message === "Ação não encontrada" ? 404 : 400).json({ message: err.message });
    }
  });

  // ─── PROD-4: Central de Produção (PCP / Demandas) ─────────────────────────
  app.get("/api/producao/central/kpis", ...auth, async (req: any, res) => {
    try { res.json(await demandasService.getKpis(req.tenantId)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  app.get("/api/producao/central/timeline", ...auth, async (req: any, res) => {
    try { res.json(await demandasService.getTimeline(req.tenantId)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  app.get("/api/producao/central/demandas", ...auth, async (req: any, res) => {
    try {
      const filtros = {
        status: req.query.status as string | undefined,
        tipo: req.query.tipo as string | undefined,
        prioridade: req.query.prioridade as string | undefined,
        projetoId: req.query.projetoId as string | undefined,
        assigneeType: req.query.assigneeType as string | undefined,
      };
      res.json(await demandasService.listar(req.tenantId, filtros));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  app.post("/api/producao/central/demandas", ...auth, async (req: any, res) => {
    try {
      const parsed = insertDemandaCentralSchema.parse({ ...req.body, tenantId: req.tenantId });
      const row = await demandasService.criar(req.tenantId, parsed);
      res.status(201).json(row);
      // Dispara o agente APÓS responder (evita race com obter() lendo antes do commit propagar).
      demandasService.dispararAgenteSeNecessario(row);
    } catch (err: any) { res.status(400).json({ message: err.message }); }
  });
  app.get("/api/producao/central/demandas/:id", ...auth, async (req: any, res) => {
    try {
      const row = await demandasService.obter(req.tenantId, req.params.id);
      if (!row) return res.status(404).json({ message: "Demanda não encontrada" });
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  app.patch("/api/producao/central/demandas/:id", ...auth, async (req: any, res) => {
    try {
      // Valida e bloqueia tenant_id no patch (impede tenant-stealing).
      const patchSchema = insertDemandaCentralSchema.partial().omit({ tenantId: true } as any);
      const patch = patchSchema.parse(req.body);
      const row = await demandasService.atualizar(req.tenantId, req.params.id, patch);
      if (!row) return res.status(404).json({ message: "Demanda não encontrada" });
      res.json(row);
    } catch (err: any) { res.status(400).json({ message: err.message }); }
  });
  app.post("/api/producao/central/demandas/:id/executar-agente", ...auth, async (req: any, res) => {
    try {
      const row = await demandasService.execucaoAgente(req.params.id, req.tenantId);
      if (!row) return res.status(404).json({ message: "Demanda não encontrada" });
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  app.post("/api/producao/central/demandas/:id/cancelar", ...auth, async (req: any, res) => {
    try {
      const row = await demandasService.cancelar(req.tenantId, req.params.id);
      if (!row) return res.status(404).json({ message: "Demanda não encontrada" });
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── PROD-3: Relatório Dinâmico ───────────────────────────────────────────
  app.get("/api/producao/projetos/:id/relatorio", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      if (req.query.refresh === "1") invalidarCacheAlertas(req.tenantId, req.params.id);
      const rel = await getRelatorio(req.tenantId, req.params.id);
      res.json(rel);
    } catch (err: any) {
      res.status(err.httpStatus || 500).json({ message: err.message });
    }
  });
  app.get("/api/producao/projetos/:id/relatorio/export/xlsx", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      const { buffer, filename } = await exportarRelatorioXlsx(req.tenantId, req.params.id);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(err.httpStatus || 500).json({ message: err.message });
    }
  });
  app.get("/api/producao/projetos/:id/relatorio/export/pdf", ...auth, async (req: any, res) => {
    try {
      await assertProjetoTenant(req.params.id, req.tenantId);
      const { html } = await exportarRelatorioHtml(req.tenantId, req.params.id);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: any) {
      res.status(err.httpStatus || 500).json({ message: err.message });
    }
  });

  // POST /api/producao/projetos/:id/importar-cronograma
  // Body: multipart/form-data { file: <.xlsx> }
  // :id = scrum_internal_projects.id
  app.post("/api/producao/projetos/:id/importar-cronograma", ...auth, upload.single("file"), async (req: any, res) => {
    try {
      const internalProjectId = req.params.id;
      if (!req.file?.buffer) {
        return res.status(400).json({ message: "Arquivo .xlsx não enviado (campo 'file')" });
      }
      // Validar que o internal project existe (não tem tenantId no schema, mas validamos via clientProjectId se houver)
      const [iproj] = await db.select().from(scrumInternalProjects)
        .where(eq(scrumInternalProjects.id, internalProjectId)).limit(1);
      if (!iproj) {
        return res.status(404).json({ message: "Projeto interno não encontrado" });
      }
      // SEGURANÇA: scrum_internal_projects ainda não tem coluna tenant_id (débito técnico).
      // Para evitar gravação cross-tenant, EXIGIMOS que o projeto esteja vinculado a um
      // clientProjectId pertencente ao tenant atual. Projetos puramente internos (isInternal=1
      // sem clientProjectId) não podem receber import via esta rota — vincule a um cliente primeiro.
      if (!iproj.clientProjectId) {
        return res.status(400).json({
          message: "Vincule este projeto a um projeto cliente (campo 'Projeto Cliente') antes de importar o cronograma.",
        });
      }
      const ok = await projectBelongsToTenant(iproj.clientProjectId, req.tenantId);
      if (!ok) return res.status(403).json({ message: "Sem acesso a este projeto" });

      const result = await importarCronograma(req.file.buffer, {
        internalProjectId,
        tenantId: req.tenantId,
        userId: req.user?.id,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[producao] importar cronograma:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
