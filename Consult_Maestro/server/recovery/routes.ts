/**
 * recovery/routes.ts — Sprint 1 do módulo Recovery (Recuperação de Empresas).
 *
 * Endpoints:
 *   GET    /api/recovery/processes
 *   POST   /api/recovery/processes
 *   GET    /api/recovery/processes/:id
 *   PATCH  /api/recovery/processes/:id
 *   DELETE /api/recovery/processes/:id
 *   GET    /api/recovery/processes/:id/summary
 *   GET    /api/recovery/processes/:id/creditors
 *   POST   /api/recovery/processes/:id/creditors
 *   POST   /api/recovery/processes/:id/creditors/import
 *   PATCH  /api/recovery/creditors/:id
 *   DELETE /api/recovery/creditors/:id
 *   GET    /api/recovery/processes/:id/actions
 *   POST   /api/recovery/processes/:id/actions
 *   PATCH  /api/recovery/actions/:id
 *   DELETE /api/recovery/actions/:id
 *   GET    /api/recovery/processes/:id/timeline
 *   POST   /api/recovery/processes/:id/timeline
 *   GET    /api/recovery/dashboard            (KPIs do tenant)
 */
import type { Express } from "express";
import multer from "multer";
import { db } from "../db";
import {
  recoveryProcesses,
  recoveryCreditors,
  recoveryActions,
  recoveryTimeline,
  pessoas,
  insertRecoveryProcessSchema,
  insertRecoveryCreditorSchema,
  insertRecoveryActionSchema,
  insertRecoveryTimelineSchema,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, eq, sql, desc, ilike, or, inArray } from "drizzle-orm";
import { importarCreditores } from "./importService";
import { registerScenarioRoutes } from "./scenarios";
import { registerProposalRoutes } from "./proposals";
import { registerInstallmentRoutes } from "./installments";
import { registerTimelineRoutes } from "./timeline";
import { registerRecoveryNotificationRoutes } from "./notifications";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  if (req.user?.dbUserId) return req.user.dbUserId;
  return null;
}

const PROCESS_PATCH_FIELDS = new Set([
  "clientePessoaId", "nomeProcesso", "tipoRecuperacao", "status",
  "numeroProcessoJudicial", "varaJudicial", "comarca",
  "dataInicio", "dataLimiteHomologacao", "dataConclusao",
  "bufferCaixa", "responsavelId", "observacoes",
]);
const CREDITOR_PATCH_FIELDS = new Set([
  "credorPessoaId", "credorNome", "credorDocumento", "tipoCredor", "tipoDebito",
  "numeroDocumento", "valorOriginal", "juros", "multas", "correcaoMonetaria",
  "valorAtualizado", "dataVencimentoOriginal", "statusNegociacao", "prioridade",
  "garantias", "observacoes",
]);
const ACTION_PATCH_FIELDS = new Set([
  "tipoAcao", "titulo", "descricao", "status", "responsavelId",
  "dataPrevista", "dataConcluida", "resultado", "anexos", "creditorId",
]);

function pickFields<T extends Record<string, any>>(obj: T, allowed: Set<string>): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (allowed.has(k)) out[k] = v;
  return out as Partial<T>;
}

async function ensureProcess(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryProcesses)
    .where(and(eq(recoveryProcesses.id, id), eq(recoveryProcesses.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

/**
 * Garante que `pessoaId` (se informado) pertence ao tenant. Lança 400 caso
 * contrário, evitando vazamento cross-tenant via FK arbitrária.
 */
async function ensurePessoaBelongsToTenant(pessoaId: string | null | undefined, tenantId: string) {
  if (!pessoaId) return;
  const [row] = await db
    .select({ id: pessoas.id })
    .from(pessoas)
    .where(and(eq(pessoas.id, pessoaId), eq(pessoas.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    const e: any = new Error("Pessoa não encontrada neste tenant");
    e.statusCode = 400;
    throw e;
  }
}

async function ensureCreditor(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryCreditors)
    .where(and(eq(recoveryCreditors.id, id), eq(recoveryCreditors.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureAction(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryActions)
    .where(and(eq(recoveryActions.id, id), eq(recoveryActions.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function logTimeline(
  tenantId: string,
  processId: string,
  eventType: string,
  title: string,
  description: string | null,
  payload: Record<string, any> | null,
  userId: string | null,
) {
  try {
    await db.insert(recoveryTimeline).values({
      tenantId,
      processId,
      eventType,
      title,
      description: description ?? undefined,
      payload: payload ?? {},
      createdById: userId ?? undefined,
    } as any);
  } catch (err) {
    console.error("[recovery] timeline insert failed:", err);
  }
}

/** Recalcula totais do processo (somatório dos credores) e atualiza. */
async function recalcProcessTotals(tenantId: string, processId: string) {
  const [agg] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${recoveryCreditors.valorAtualizado})::numeric, 0)::text`,
      acordos: sql<string>`COALESCE(SUM(CASE WHEN ${recoveryCreditors.statusNegociacao} IN ('acordo_aceito','acordo_homologado') THEN ${recoveryCreditors.valorAtualizado} ELSE 0 END)::numeric, 0)::text`,
    })
    .from(recoveryCreditors)
    .where(and(eq(recoveryCreditors.tenantId, tenantId), eq(recoveryCreditors.processId, processId)));
  await db
    .update(recoveryProcesses)
    .set({
      valorTotalDividas: agg?.total ?? "0",
      valorAcordosFechados: agg?.acordos ?? "0",
      updatedAt: new Date(),
    })
    .where(and(eq(recoveryProcesses.id, processId), eq(recoveryProcesses.tenantId, tenantId)));
}

export function registerRecoveryRoutes(app: Express) {
  // Sprint 2: cenários de negociação + propostas por credor (CET/TIR + workflow)
  registerScenarioRoutes(app);
  registerProposalRoutes(app);
  registerInstallmentRoutes(app);
  // Sprint 4: Toneraud (timeline filtros + PDF + anexos) e notificações
  registerTimelineRoutes(app);
  registerRecoveryNotificationRoutes(app);

  // ---------- DASHBOARD GLOBAL DO TENANT ----------
  app.get("/api/recovery/dashboard", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const [counts] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          ativos: sql<number>`COUNT(*) FILTER (WHERE status IN ('diagnostico','negociacao','acordo_homologado','em_cumprimento','inadimplente'))::int`,
          concluidos: sql<number>`COUNT(*) FILTER (WHERE status = 'concluido')::int`,
          totalDividas: sql<string>`COALESCE(SUM(valor_total_dividas)::numeric, 0)::text`,
          totalAcordos: sql<string>`COALESCE(SUM(valor_acordos_fechados)::numeric, 0)::text`,
          totalPago: sql<string>`COALESCE(SUM(valor_pago)::numeric, 0)::text`,
        })
        .from(recoveryProcesses)
        .where(eq(recoveryProcesses.tenantId, tenantId));

      const tipos = await db
        .select({
          tipoCredor: recoveryCreditors.tipoCredor,
          total: sql<string>`COALESCE(SUM(${recoveryCreditors.valorAtualizado})::numeric, 0)::text`,
          quantidade: sql<number>`COUNT(*)::int`,
        })
        .from(recoveryCreditors)
        .where(eq(recoveryCreditors.tenantId, tenantId))
        .groupBy(recoveryCreditors.tipoCredor);

      res.json({
        ...counts,
        porTipoCredor: tipos,
      });
    } catch (err: any) {
      console.error("[recovery] dashboard error:", err);
      res.status(500).json({ message: err?.message || "Falha ao carregar dashboard" });
    }
  });

  // ---------- PROCESSES — LIST ----------
  app.get("/api/recovery/processes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const { status, tipo, q, limit = "100", offset = "0" } = req.query as Record<string, string>;
      const conds = [eq(recoveryProcesses.tenantId, tenantId)];
      if (status && status !== "todos") conds.push(eq(recoveryProcesses.status, status));
      if (tipo && tipo !== "todos") conds.push(eq(recoveryProcesses.tipoRecuperacao, tipo));
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        conds.push(or(
          ilike(recoveryProcesses.nomeProcesso, like),
          ilike(recoveryProcesses.numeroProcessoJudicial, like),
        )!);
      }
      const rows = await db
        .select({
          process: recoveryProcesses,
          clienteNome: pessoas.nomeFantasia,
        })
        .from(recoveryProcesses)
        .leftJoin(
          pessoas,
          and(eq(recoveryProcesses.clientePessoaId, pessoas.id), eq(pessoas.tenantId, tenantId)),
        )
        .where(and(...conds))
        .orderBy(desc(recoveryProcesses.createdAt))
        .limit(Math.min(Number(limit) || 100, 500))
        .offset(Number(offset) || 0);

      // Conta credores por processo
      const ids = rows.map((r) => r.process.id);
      const counts = ids.length
        ? await db
            .select({
              processId: recoveryCreditors.processId,
              total: sql<number>`COUNT(*)::int`,
            })
            .from(recoveryCreditors)
            .where(inArray(recoveryCreditors.processId, ids))
            .groupBy(recoveryCreditors.processId)
        : [];
      const countMap = new Map(counts.map((c) => [c.processId, c.total]));

      res.json(rows.map((r) => ({ ...r.process, clienteNome: r.clienteNome, credoresCount: countMap.get(r.process.id) ?? 0 })));
    } catch (err: any) {
      console.error("[recovery] list error:", err);
      res.status(500).json({ message: err?.message || "Falha ao listar processos" });
    }
  });

  // ---------- PROCESS — CREATE ----------
  app.post("/api/recovery/processes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const parsed = insertRecoveryProcessSchema.parse({
        ...req.body,
        tenantId,
        createdById: userId ?? undefined,
        updatedById: userId ?? undefined,
      });
      // Garante que clientePessoaId (se informado) pertence ao tenant
      await ensurePessoaBelongsToTenant((parsed as any).clientePessoaId, tenantId);
      const [row] = await db.insert(recoveryProcesses).values(parsed as any).returning();
      await logTimeline(
        tenantId,
        row.id,
        "process_created",
        `Processo "${row.nomeProcesso}" criado`,
        `Tipo: ${row.tipoRecuperacao} · Status inicial: ${row.status}`,
        { tipo: row.tipoRecuperacao, status: row.status },
        userId,
      );
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[recovery] create process error:", err);
      res.status(400).json({ message: err?.message || "Falha ao criar processo" });
    }
  });

  // ---------- PROCESS — GET ONE ----------
  app.get("/api/recovery/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      let cliente = null;
      if (proc.clientePessoaId) {
        const [p] = await db
          .select()
          .from(pessoas)
          .where(and(eq(pessoas.id, proc.clientePessoaId), eq(pessoas.tenantId, tenantId)))
          .limit(1);
        cliente = p ?? null;
      }
      res.json({ ...proc, cliente });
    } catch (err: any) {
      console.error("[recovery] get process error:", err);
      res.status(500).json({ message: err?.message || "Falha ao buscar processo" });
    }
  });

  // ---------- PROCESS — SUMMARY (KPIs do processo) ----------
  app.get("/api/recovery/processes/:id/summary", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });

      const porTipo = await db
        .select({
          tipoCredor: recoveryCreditors.tipoCredor,
          total: sql<string>`COALESCE(SUM(${recoveryCreditors.valorAtualizado})::numeric, 0)::text`,
          quantidade: sql<number>`COUNT(*)::int`,
        })
        .from(recoveryCreditors)
        .where(and(eq(recoveryCreditors.tenantId, tenantId), eq(recoveryCreditors.processId, proc.id)))
        .groupBy(recoveryCreditors.tipoCredor);

      const porStatus = await db
        .select({
          statusNegociacao: recoveryCreditors.statusNegociacao,
          total: sql<string>`COALESCE(SUM(${recoveryCreditors.valorAtualizado})::numeric, 0)::text`,
          quantidade: sql<number>`COUNT(*)::int`,
        })
        .from(recoveryCreditors)
        .where(and(eq(recoveryCreditors.tenantId, tenantId), eq(recoveryCreditors.processId, proc.id)))
        .groupBy(recoveryCreditors.statusNegociacao);

      const [acoesAg] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          pendentes: sql<number>`COUNT(*) FILTER (WHERE status = 'pendente')::int`,
          emAndamento: sql<number>`COUNT(*) FILTER (WHERE status = 'em_andamento')::int`,
          concluidas: sql<number>`COUNT(*) FILTER (WHERE status = 'concluida')::int`,
        })
        .from(recoveryActions)
        .where(and(eq(recoveryActions.tenantId, tenantId), eq(recoveryActions.processId, proc.id)));

      res.json({
        process: proc,
        porTipoCredor: porTipo,
        porStatusNegociacao: porStatus,
        acoes: acoesAg ?? { total: 0, pendentes: 0, emAndamento: 0, concluidas: 0 },
      });
    } catch (err: any) {
      console.error("[recovery] summary error:", err);
      res.status(500).json({ message: err?.message || "Falha ao montar resumo" });
    }
  });

  // ---------- PROCESS — PATCH ----------
  app.patch("/api/recovery/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const patch = pickFields(req.body, PROCESS_PATCH_FIELDS);
      // Validação extra: se mudou clientePessoaId, garantir tenant
      if ("clientePessoaId" in patch) {
        await ensurePessoaBelongsToTenant(patch.clientePessoaId as any, tenantId);
      }
      const [row] = await db
        .update(recoveryProcesses)
        .set({ ...patch, updatedAt: new Date(), updatedById: userId ?? undefined } as any)
        .where(and(eq(recoveryProcesses.id, proc.id), eq(recoveryProcesses.tenantId, tenantId)))
        .returning();
      // Log status change
      if (patch.status && patch.status !== proc.status) {
        await logTimeline(
          tenantId,
          proc.id,
          "status_changed",
          `Status alterado: ${proc.status} → ${patch.status}`,
          null,
          { from: proc.status, to: patch.status },
          userId,
        );
      }
      res.json(row);
    } catch (err: any) {
      console.error("[recovery] patch process error:", err);
      res.status(400).json({ message: err?.message || "Falha ao atualizar processo" });
    }
  });

  // ---------- PROCESS — DELETE ----------
  app.delete("/api/recovery/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      await db
        .delete(recoveryProcesses)
        .where(and(eq(recoveryProcesses.id, proc.id), eq(recoveryProcesses.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[recovery] delete process error:", err);
      res.status(500).json({ message: err?.message || "Falha ao excluir processo" });
    }
  });

  // ---------- CREDITORS — LIST BY PROCESS ----------
  app.get("/api/recovery/processes/:id/creditors", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const { tipo, status, q } = req.query as Record<string, string>;
      const conds = [
        eq(recoveryCreditors.tenantId, tenantId),
        eq(recoveryCreditors.processId, proc.id),
      ];
      if (tipo && tipo !== "todos") conds.push(eq(recoveryCreditors.tipoCredor, tipo));
      if (status && status !== "todos") conds.push(eq(recoveryCreditors.statusNegociacao, status));
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        conds.push(or(
          ilike(recoveryCreditors.credorNome, like),
          ilike(recoveryCreditors.credorDocumento, like),
          ilike(recoveryCreditors.tipoDebito, like),
        )!);
      }
      const rows = await db
        .select()
        .from(recoveryCreditors)
        .where(and(...conds))
        .orderBy(desc(recoveryCreditors.valorAtualizado));
      res.json(rows);
    } catch (err: any) {
      console.error("[recovery] list creditors error:", err);
      res.status(500).json({ message: err?.message || "Falha ao listar credores" });
    }
  });

  // ---------- CREDITOR — CREATE ----------
  app.post("/api/recovery/processes/:id/creditors", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const parsed = insertRecoveryCreditorSchema.parse({
        ...req.body,
        tenantId,
        processId: proc.id,
      });
      // Garante que credorPessoaId (se informado) pertence ao tenant
      await ensurePessoaBelongsToTenant((parsed as any).credorPessoaId, tenantId);
      const [row] = await db.insert(recoveryCreditors).values(parsed as any).returning();
      await recalcProcessTotals(tenantId, proc.id);
      await logTimeline(
        tenantId,
        proc.id,
        "creditor_added",
        `Credor adicionado: ${row.credorNome}`,
        `Tipo: ${row.tipoCredor} · Valor: R$ ${row.valorAtualizado ?? row.valorOriginal}`,
        { creditorId: row.id, tipo: row.tipoCredor, valor: row.valorAtualizado },
        userId,
      );
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[recovery] create creditor error:", err);
      res.status(400).json({ message: err?.message || "Falha ao criar credor" });
    }
  });

  // ---------- CREDITOR — IMPORT ----------
  app.post(
    "/api/recovery/processes/:id/creditors/import",
    isAuthenticated,
    requireTenant,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const tenantId = req.tenantId as string;
        const userId = getUserId(req);
        const proc = await ensureProcess(req.params.id, tenantId);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        if (!req.file) return res.status(400).json({ message: "Arquivo não enviado (campo 'file' obrigatório)" });
        const nome = String(req.file.originalname ?? "").toLowerCase();
        if (!/\.(xlsx|xls|csv)$/.test(nome)) {
          return res.status(400).json({ message: "Formato inválido. Envie .xlsx, .xls ou .csv" });
        }
        const result = await importarCreditores(tenantId, proc.id, req.file.buffer, userId);
        await recalcProcessTotals(tenantId, proc.id);
        res.json(result);
      } catch (err: any) {
        console.error("[recovery] import creditors error:", err);
        res.status(500).json({ message: err?.message || "Falha ao importar credores" });
      }
    },
  );

  // ---------- CREDITOR — PATCH ----------
  app.patch("/api/recovery/creditors/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const cred = await ensureCreditor(req.params.id, tenantId);
      if (!cred) return res.status(404).json({ message: "Credor não encontrado" });
      const patch = pickFields(req.body, CREDITOR_PATCH_FIELDS);
      if ("credorPessoaId" in patch) {
        await ensurePessoaBelongsToTenant(patch.credorPessoaId as any, tenantId);
      }
      const [row] = await db
        .update(recoveryCreditors)
        .set({ ...patch, updatedAt: new Date() } as any)
        .where(and(eq(recoveryCreditors.id, cred.id), eq(recoveryCreditors.tenantId, tenantId)))
        .returning();
      if (patch.statusNegociacao && patch.statusNegociacao !== cred.statusNegociacao) {
        await logTimeline(
          tenantId,
          cred.processId,
          "creditor_status_changed",
          `Credor "${cred.credorNome}": ${cred.statusNegociacao} → ${patch.statusNegociacao}`,
          null,
          { creditorId: cred.id, from: cred.statusNegociacao, to: patch.statusNegociacao },
          userId,
        );
      }
      await recalcProcessTotals(tenantId, cred.processId);
      res.json(row);
    } catch (err: any) {
      console.error("[recovery] patch creditor error:", err);
      res.status(400).json({ message: err?.message || "Falha ao atualizar credor" });
    }
  });

  // ---------- CREDITOR — DELETE ----------
  app.delete("/api/recovery/creditors/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const cred = await ensureCreditor(req.params.id, tenantId);
      if (!cred) return res.status(404).json({ message: "Credor não encontrado" });
      await db
        .delete(recoveryCreditors)
        .where(and(eq(recoveryCreditors.id, cred.id), eq(recoveryCreditors.tenantId, tenantId)));
      await recalcProcessTotals(tenantId, cred.processId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[recovery] delete creditor error:", err);
      res.status(500).json({ message: err?.message || "Falha ao excluir credor" });
    }
  });

  // ---------- ACTIONS — LIST BY PROCESS ----------
  app.get("/api/recovery/processes/:id/actions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const rows = await db
        .select()
        .from(recoveryActions)
        .where(and(eq(recoveryActions.tenantId, tenantId), eq(recoveryActions.processId, proc.id)))
        .orderBy(desc(recoveryActions.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[recovery] list actions error:", err);
      res.status(500).json({ message: err?.message || "Falha ao listar ações" });
    }
  });

  // ---------- ACTION — CREATE ----------
  app.post("/api/recovery/processes/:id/actions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const proc = await ensureProcess(req.params.id, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const parsed = insertRecoveryActionSchema.parse({
        ...req.body,
        tenantId,
        processId: proc.id,
        createdById: userId ?? undefined,
      });
      const [row] = await db.insert(recoveryActions).values(parsed as any).returning();
      await logTimeline(
        tenantId,
        proc.id,
        "action_created",
        `Ação criada: ${row.titulo}`,
        `Tipo: ${row.tipoAcao} · Status: ${row.status}`,
        { actionId: row.id, tipo: row.tipoAcao, status: row.status },
        userId,
      );
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[recovery] create action error:", err);
      res.status(400).json({ message: err?.message || "Falha ao criar ação" });
    }
  });

  // ---------- ACTION — PATCH ----------
  app.patch("/api/recovery/actions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const action = await ensureAction(req.params.id, tenantId);
      if (!action) return res.status(404).json({ message: "Ação não encontrada" });
      const patch = pickFields(req.body, ACTION_PATCH_FIELDS);
      // Auto-set dataConcluida quando status vira "concluida"
      if (patch.status === "concluida" && !patch.dataConcluida && action.status !== "concluida") {
        (patch as any).dataConcluida = new Date();
      }
      const [row] = await db
        .update(recoveryActions)
        .set({ ...patch, updatedAt: new Date() } as any)
        .where(and(eq(recoveryActions.id, action.id), eq(recoveryActions.tenantId, tenantId)))
        .returning();
      if (patch.status === "concluida" && action.status !== "concluida") {
        await logTimeline(
          tenantId,
          action.processId,
          "action_completed",
          `Ação concluída: ${action.titulo}`,
          null,
          { actionId: action.id },
          userId,
        );
      }
      res.json(row);
    } catch (err: any) {
      console.error("[recovery] patch action error:", err);
      res.status(400).json({ message: err?.message || "Falha ao atualizar ação" });
    }
  });

  // ---------- ACTION — DELETE ----------
  app.delete("/api/recovery/actions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const action = await ensureAction(req.params.id, tenantId);
      if (!action) return res.status(404).json({ message: "Ação não encontrada" });
      await db
        .delete(recoveryActions)
        .where(and(eq(recoveryActions.id, action.id), eq(recoveryActions.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[recovery] delete action error:", err);
      res.status(500).json({ message: err?.message || "Falha ao excluir ação" });
    }
  });

  // Endpoints de timeline (list + create + PDF + anexos) movidos para
  // server/recovery/timeline.ts (Sprint 4 — Toneraud).
}
