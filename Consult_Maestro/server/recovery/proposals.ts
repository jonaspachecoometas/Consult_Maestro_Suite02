/**
 * proposals.ts — Endpoints de propostas por credor (Sprint 2).
 *
 * Endpoints:
 *   GET    /api/recovery/scenarios/:scenarioId/proposals
 *   POST   /api/recovery/scenarios/:scenarioId/proposals
 *   GET    /api/recovery/proposals/:id
 *   PATCH  /api/recovery/proposals/:id
 *   DELETE /api/recovery/proposals/:id
 *   POST   /api/recovery/proposals/:id/send         (rascunho -> enviada)
 *   POST   /api/recovery/proposals/:id/respond      (registra resposta do credor)
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  recoveryProposals, recoveryScenarios, recoveryCreditors, recoveryTimeline,
  recoveryProcesses, pessoas,
  insertRecoveryProposalSchema,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, eq, desc } from "drizzle-orm";
import { calculateCET, buildScheduleFromScenario } from "./cetCalculator";
import { generateProposalPdf } from "./proposalPdfService";

const NUMERIC_PROPOSAL_FIELDS = [
  "valorOriginal", "valorProposto", "taxaPropostaMensal", "cetMensal",
];

function coerceNumericFields<T extends Record<string, any>>(obj: T, fields: string[]): T {
  const out: any = { ...obj };
  for (const f of fields) {
    const v = out[f];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out[f] = String(v);
      else delete out[f];
    } else if (typeof v === "string" && v.trim() === "") {
      delete out[f];
    }
  }
  return out;
}

function getUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  if (req.user?.dbUserId) return req.user.dbUserId;
  return null;
}

const PROPOSAL_PATCH_FIELDS = new Set([
  "valorOriginal", "valorProposto", "descontoPct",
  "numParcelas", "intervaloDias", "carenciaMeses",
  "primeiraParcelaData", "taxaPropostaMensal", "justificativa",
]);

function pickFields<T extends Record<string, any>>(obj: T, allowed: Set<string>): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (allowed.has(k)) out[k] = v;
  return out as Partial<T>;
}

async function ensureScenario(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryScenarios)
    .where(and(eq(recoveryScenarios.id, id), eq(recoveryScenarios.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureCreditor(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryCreditors)
    .where(and(eq(recoveryCreditors.id, id), eq(recoveryCreditors.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureProposal(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryProposals)
    .where(and(eq(recoveryProposals.id, id), eq(recoveryProposals.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

/** Calcula CET de uma proposta isolada (sem reduced initial — usa valorProposto/numParcelas). */
function computeProposalCet(p: any): number | null {
  const valorOriginal = Number(p.valorOriginal || 0);
  const valorProposto = Number(p.valorProposto || 0);
  const num = Number(p.numParcelas || 0);
  if (valorOriginal <= 0 || valorProposto <= 0 || num <= 0) return null;
  const intervaloDias = Number(p.intervaloDias || 30);
  const carenciaMeses = Number(p.carenciaMeses || 0);
  const primeiraData = p.primeiraParcelaData ? new Date(p.primeiraParcelaData) : new Date();
  const parcelaUnica = valorProposto / num;
  const schedule = buildScheduleFromScenario({
    valorOriginal, numParcelas: num, intervaloDias, carenciaMeses,
    primeiraParcelaData: primeiraData,
    hasReducedInitial: false, reducedCount: 0, reducedAmount: 0,
    normalAmount: parcelaUnica, parcelaUnica,
  });
  return calculateCET(schedule).cetMensal;
}

export function registerProposalRoutes(app: Express) {
  // Listar propostas de um cenário
  app.get("/api/recovery/scenarios/:scenarioId/proposals", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const sc = await ensureScenario(req.params.scenarioId, tenantId);
      if (!sc) return res.status(404).json({ message: "Cenário não encontrado" });
      const rows = await db
        .select()
        .from(recoveryProposals)
        .where(and(eq(recoveryProposals.tenantId, tenantId), eq(recoveryProposals.scenarioId, req.params.scenarioId)))
        .orderBy(desc(recoveryProposals.createdAt));
      res.json(rows);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao listar propostas" });
    }
  });

  // Criar proposta para um credor dentro de um cenário
  app.post("/api/recovery/scenarios/:scenarioId/proposals", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const sc = await ensureScenario(req.params.scenarioId, tenantId);
      if (!sc) return res.status(404).json({ message: "Cenário não encontrado" });
      // Bloqueia criar proposta em cenário rejeitado/homologado/aceito
      const blockedScenarioStatuses = ["rejeitado", "homologado", "aceito_credores"];
      if (blockedScenarioStatuses.includes(sc.status)) {
        return res.status(409).json({ message: `Cenário no status '${sc.status}' não aceita novas propostas` });
      }
      const creditorId = req.body?.creditorId;
      if (!creditorId) return res.status(400).json({ message: "creditorId obrigatório" });
      const cr = await ensureCreditor(creditorId, tenantId);
      if (!cr) return res.status(400).json({ message: "Credor não pertence a este tenant" });
      if (cr.processId !== sc.processId) {
        return res.status(400).json({ message: "Credor pertence a outro processo" });
      }
      // Default valorOriginal = valor atualizado do credor
      const valorOriginal = Number(req.body?.valorOriginal ?? cr.valorAtualizado ?? cr.valorOriginal ?? 0);
      const payload = coerceNumericFields({
        ...req.body,
        tenantId,
        scenarioId: req.params.scenarioId,
        processId: sc.processId,
        creditorId,
        valorOriginal,
      }, NUMERIC_PROPOSAL_FIELDS);
      const parsed = insertRecoveryProposalSchema.parse(payload);
      const cet = computeProposalCet(parsed);

      const [created] = await db.insert(recoveryProposals).values({
        ...parsed,
        cetMensal: cet != null ? String(cet) : null,
        createdById: userId || undefined,
        updatedById: userId || undefined,
      }).returning();

      await db.insert(recoveryTimeline).values({
        tenantId, processId: sc.processId,
        eventType: "proposal_created",
        title: `Proposta criada: ${cr.credorNome}`,
        description: cet != null ? `CET ${(cet * 100).toFixed(4)}% a.m.` : undefined,
        payload: { proposalId: created.id, scenarioId: sc.id, creditorId },
        createdById: userId || undefined,
      });
      res.status(201).json(created);
    } catch (e: any) {
      res.status(e.statusCode || 400).json({ message: e.message || "Erro ao criar proposta", details: e.errors });
    }
  });

  // Buscar proposta
  app.get("/api/recovery/proposals/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      res.json(p);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao buscar proposta" });
    }
  });

  // Atualizar proposta (apenas em rascunho/contraproposta)
  app.patch("/api/recovery/proposals/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      if (!["rascunho", "contraproposta"].includes(p.status)) {
        return res.status(409).json({ message: `Proposta no status '${p.status}' não pode ser editada` });
      }
      const updates = coerceNumericFields(pickFields(req.body || {}, PROPOSAL_PATCH_FIELDS), NUMERIC_PROPOSAL_FIELDS);
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nenhum campo válido" });
      // Validação parcial via Zod
      try {
        insertRecoveryProposalSchema.partial().parse(updates);
      } catch (zErr: any) {
        return res.status(400).json({ message: "Validação falhou", details: zErr.errors });
      }

      // Recalcula CET se mudou algo financeiro
      const merged = { ...p, ...updates };
      const cet = computeProposalCet(merged);
      const [updated] = await db.update(recoveryProposals)
        .set({
          ...updates,
          cetMensal: cet != null ? String(cet) : null,
          updatedAt: new Date(),
          updatedById: userId || undefined,
        })
        .where(and(eq(recoveryProposals.id, req.params.id), eq(recoveryProposals.tenantId, tenantId)))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 400).json({ message: e.message || "Erro ao atualizar proposta" });
    }
  });

  // Deletar proposta (apenas rascunho/cancelada)
  app.delete("/api/recovery/proposals/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      if (!["rascunho", "cancelada"].includes(p.status)) {
        return res.status(409).json({ message: `Proposta no status '${p.status}' não pode ser excluída` });
      }
      await db.delete(recoveryProposals)
        .where(and(eq(recoveryProposals.id, req.params.id), eq(recoveryProposals.tenantId, tenantId)));
      await db.insert(recoveryTimeline).values({
        tenantId, processId: p.processId,
        eventType: "proposal_deleted",
        title: `Proposta excluída`,
        payload: { proposalId: p.id, creditorId: p.creditorId },
        createdById: userId || undefined,
      });
      res.status(204).end();
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao excluir proposta" });
    }
  });

  // Enviar proposta (rascunho -> enviada)
  app.post("/api/recovery/proposals/:id/send", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      if (p.status !== "rascunho") {
        return res.status(409).json({ message: `Proposta no status '${p.status}' não pode ser enviada` });
      }
      const now = new Date();
      const [updated] = await db.update(recoveryProposals)
        .set({
          status: "enviada", enviadaEm: now, ultimaInteracaoData: now,
          updatedAt: now, updatedById: userId || undefined,
        })
        .where(and(eq(recoveryProposals.id, req.params.id), eq(recoveryProposals.tenantId, tenantId)))
        .returning();
      // Atualiza status do credor
      await db.update(recoveryCreditors)
        .set({ statusNegociacao: "acordo_proposto", updatedAt: now })
        .where(and(eq(recoveryCreditors.id, p.creditorId), eq(recoveryCreditors.tenantId, tenantId)));
      await db.insert(recoveryTimeline).values({
        tenantId, processId: p.processId,
        eventType: "proposal_sent",
        title: `Proposta enviada ao credor`,
        payload: { proposalId: p.id, creditorId: p.creditorId, scenarioId: p.scenarioId },
        createdById: userId || undefined,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao enviar proposta" });
    }
  });

  // Gerar PDF formal da proposta
  app.get("/api/recovery/proposals/:id/pdf", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      const [scenario] = await db.select().from(recoveryScenarios)
        .where(and(eq(recoveryScenarios.id, p.scenarioId), eq(recoveryScenarios.tenantId, tenantId)))
        .limit(1);
      const [creditor] = await db.select().from(recoveryCreditors)
        .where(and(eq(recoveryCreditors.id, p.creditorId), eq(recoveryCreditors.tenantId, tenantId)))
        .limit(1);
      const [process] = await db.select().from(recoveryProcesses)
        .where(and(eq(recoveryProcesses.id, p.processId), eq(recoveryProcesses.tenantId, tenantId)))
        .limit(1);
      if (!scenario || !creditor || !process) {
        return res.status(404).json({ message: "Dados associados não encontrados" });
      }
      let cliente = null;
      if (process.clientePessoaId) {
        const [c] = await db.select().from(pessoas)
          .where(and(eq(pessoas.id, process.clientePessoaId), eq(pessoas.tenantId, tenantId)))
          .limit(1);
        cliente = c || null;
      }
      const pdfBytes = await generateProposalPdf({ proposal: p, scenario, creditor, process, cliente });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="proposta-${creditor.credorNome.replace(/\s+/g, "_")}-${p.id.slice(0, 8)}.pdf"`);
      res.send(Buffer.from(pdfBytes));
    } catch (e: any) {
      console.error("[recovery] erro ao gerar PDF:", e);
      res.status(500).json({ message: e.message || "Erro ao gerar PDF" });
    }
  });

  // Registrar resposta do credor
  app.post("/api/recovery/proposals/:id/respond", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const p = await ensureProposal(req.params.id, tenantId);
      if (!p) return res.status(404).json({ message: "Proposta não encontrada" });
      const { tipo, mensagem, contraPropostaValor, contraPropostaParcelas, contraPropostaDetalhes } = req.body || {};
      if (!["aceita", "recusada", "contraproposta"].includes(tipo)) {
        return res.status(400).json({ message: "tipo deve ser 'aceita' | 'recusada' | 'contraproposta'" });
      }
      const now = new Date();
      const newStatus = tipo === "aceita" ? "aceita" : tipo === "recusada" ? "recusada" : "contraproposta";
      const [updated] = await db.update(recoveryProposals)
        .set({
          status: newStatus,
          respostaCredor: mensagem || null,
          contraPropostaValor: contraPropostaValor != null ? String(contraPropostaValor) : null,
          contraPropostaParcelas: contraPropostaParcelas != null ? Number(contraPropostaParcelas) : null,
          contraPropostaDetalhes: contraPropostaDetalhes || null,
          rounds: (p.rounds || 0) + 1,
          respondidaEm: now, ultimaInteracaoData: now,
          updatedAt: now, updatedById: userId || undefined,
        })
        .where(and(eq(recoveryProposals.id, req.params.id), eq(recoveryProposals.tenantId, tenantId)))
        .returning();
      // Atualiza status do credor coerentemente
      const creditorStatus = newStatus === "aceita" ? "acordo_aceito" : newStatus === "recusada" ? "recusado" : "em_negociacao";
      await db.update(recoveryCreditors)
        .set({ statusNegociacao: creditorStatus, updatedAt: now })
        .where(and(eq(recoveryCreditors.id, p.creditorId), eq(recoveryCreditors.tenantId, tenantId)));
      await db.insert(recoveryTimeline).values({
        tenantId, processId: p.processId,
        eventType: "proposal_response",
        title: `Resposta do credor: ${newStatus}`,
        description: mensagem || undefined,
        payload: { proposalId: p.id, creditorId: p.creditorId, scenarioId: p.scenarioId, response: newStatus, contraPropostaValor },
        createdById: userId || undefined,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao registrar resposta" });
    }
  });
}
