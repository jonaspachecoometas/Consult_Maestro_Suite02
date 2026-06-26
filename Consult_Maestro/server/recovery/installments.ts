/**
 * installments.ts — Sprint 3 Recovery
 *
 * Endpoints:
 *   POST   /api/recovery/scenarios/:id/homologate
 *   GET    /api/recovery/processes/:processId/installments
 *   GET    /api/recovery/processes/:processId/installments/pending-release
 *   POST   /api/recovery/installments/:id/release
 *   POST   /api/recovery/processes/:processId/installments/batch-release
 *   POST   /api/recovery/installments/:id/mark-paid
 *   DELETE /api/recovery/installments/:id
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  recoveryInstallments,
  recoveryScenarios,
  recoveryProposals,
  recoveryProcesses,
  recoveryCreditors,
  recoveryTimeline,
  pessoas,
  lancamentosFinanceiros,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, eq, desc, asc, inArray, lte, gte, sql } from "drizzle-orm";
import { canReleaseToControl } from "../control/cashFlowProjection";
import { runOverdueCheck } from "./overdueCron";
import { createRecoveryNotification } from "./notifications";

function getUserId(req: any): string | null {
  return req?.user?.claims?.sub || req?.user?.id || null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function ensureScenario(id: string, tenantId: string) {
  const [s] = await db.select().from(recoveryScenarios)
    .where(and(eq(recoveryScenarios.id, id), eq(recoveryScenarios.tenantId, tenantId))).limit(1);
  return s;
}
async function ensureInstallment(id: string, tenantId: string) {
  const [i] = await db.select().from(recoveryInstallments)
    .where(and(eq(recoveryInstallments.id, id), eq(recoveryInstallments.tenantId, tenantId))).limit(1);
  return i;
}
async function ensureProcess(id: string, tenantId: string) {
  const [p] = await db.select().from(recoveryProcesses)
    .where(and(eq(recoveryProcesses.id, id), eq(recoveryProcesses.tenantId, tenantId))).limit(1);
  return p;
}

/**
 * Resolve o `clients.id` do Control (legacyClientId) a partir do
 * `clientePessoaId` do processo. Retorna null se não houver vínculo.
 */
async function resolveControlClienteId(tenantId: string, processClientePessoaId: string | null): Promise<string | null> {
  if (!processClientePessoaId) return null;
  const [pessoa] = await db.select({ legacyClientId: pessoas.legacyClientId })
    .from(pessoas)
    .where(and(eq(pessoas.id, processClientePessoaId), eq(pessoas.tenantId, tenantId)))
    .limit(1);
  return pessoa?.legacyClientId || null;
}

/**
 * Gera as parcelas a partir de um cenário homologado.
 * Estratégia:
 *  - Para cada proposta com status IN (enviada, aceita, contraproposta) do cenário,
 *    cria N parcelas usando os parâmetros do cenário (numParcelas, intervaloDias,
 *    carenciaMeses, primeiraParcelaData) e o valor da proposta (valorOriginal).
 *  - Se o cenário tem hasReducedInitial: reducedCount parcelas iniciais usam reducedAmount,
 *    as restantes dividem (valorOriginal − reducedCount*reducedAmount) uniformemente.
 *  - Senão: divide valorOriginal uniformemente em numParcelas.
 *  - Se não há propostas: gera UMA série para todos credores agrupados (1 série por
 *    credor, valor proporcional ao valorAtualizado).
 */
function buildInstallmentsForProposal(opts: {
  numParcelas: number;
  intervaloDias: number;
  carenciaMeses: number;
  primeiraParcelaData: Date;
  hasReducedInitial: boolean;
  reducedCount: number;
  reducedAmount: number;
  valorBase: number;
}): Array<{ numero: number; dueDate: Date; valor: number }> {
  const { numParcelas, intervaloDias, carenciaMeses, primeiraParcelaData,
    hasReducedInitial, reducedCount, reducedAmount, valorBase } = opts;
  const startDate = new Date(primeiraParcelaData.getTime() + carenciaMeses * 30 * MS_PER_DAY);
  const out: Array<{ numero: number; dueDate: Date; valor: number }> = [];
  const valores: number[] = [];

  if (hasReducedInitial && reducedCount > 0 && reducedCount < numParcelas) {
    // Garante que a parte reduzida nunca exceda valorBase
    const reducedTotalCap = Math.min(reducedCount * reducedAmount, valorBase);
    const effectiveReduced = reducedTotalCap / reducedCount;
    const restante = Math.max(0, valorBase - reducedTotalCap);
    const normal = restante / (numParcelas - reducedCount);
    for (let i = 0; i < reducedCount; i++) valores.push(effectiveReduced);
    for (let i = 0; i < numParcelas - reducedCount; i++) valores.push(normal);
  } else {
    const v = valorBase / numParcelas;
    for (let i = 0; i < numParcelas; i++) valores.push(v);
  }
  // Arredonda parcela a parcela e absorve sobra/falta de centavos na última.
  const rounded = valores.map((v) => Math.round(v * 100) / 100);
  const totalRounded = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round((valorBase - totalRounded) * 100) / 100;
  if (diff !== 0 && rounded.length > 0) {
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + diff) * 100) / 100;
  }
  for (let i = 0; i < numParcelas; i++) {
    const due = new Date(startDate.getTime() + i * intervaloDias * MS_PER_DAY);
    out.push({ numero: i + 1, dueDate: due, valor: rounded[i] });
  }
  return out;
}

export function registerInstallmentRoutes(app: Express) {

  // ── DEV/admin: dispara o varredor de inadimplência manualmente
  // Sempre escopa por tenant do solicitante (NUNCA global via API).
  app.post("/api/recovery/admin/run-overdue-check", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      let role: string | undefined =
        (req as any).user?.role
        || (req as any).user?.claims?.role
        || (req as any).user?.systemRole;
      // Fallback: lê o role direto do banco se não estiver na sessão
      if (!role && userId) {
        try {
          const { storage } = await import("../storage");
          const u = await storage.getUser(userId);
          role = (u as any)?.role;
        } catch {}
      }
      if (!["admin", "tenant_admin", "superadmin", "partner"].includes(role || "")) {
        return res.status(403).json({ message: "Apenas administradores podem disparar o varredor manualmente" });
      }
      const thresholdDays = req.body?.thresholdDays != null ? Number(req.body.thresholdDays) : undefined;
      const result = await runOverdueCheck({ thresholdDays, tenantId });
      res.json(result);
    } catch (e: any) {
      console.error("[recovery] run-overdue-check:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Homologar cenário → gera parcelas para cada credor (via propostas)
  // Idempotente: usa UPDATE condicional para "claim" do cenário antes de gerar parcelas.
  // Concorrência: a UNIQUE INDEX (scenario_id, creditor_id, numero) garante no máximo 1 parcela por slot.
  app.post("/api/recovery/scenarios/:id/homologate", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      if (scenario.status === "homologado") {
        return res.status(409).json({ message: "Cenário já homologado" });
      }
      if (!["aprovado_interno", "enviado_credores", "aceito_credores"].includes(scenario.status)) {
        return res.status(409).json({ message: `Cenário no status '${scenario.status}' não pode ser homologado. Aprove internamente primeiro.` });
      }
      // Claim atômico: tenta promover o cenário para "homologado" só se ainda estiver em status válido.
      // Se outro request concorrente já promoveu, esta UPDATE retorna 0 linhas → 409.
      const [claimed] = await db.update(recoveryScenarios)
        .set({ status: "homologado", updatedAt: new Date(), updatedById: userId || undefined })
        .where(and(
          eq(recoveryScenarios.id, scenario.id),
          eq(recoveryScenarios.tenantId, tenantId),
          inArray(recoveryScenarios.status, ["aprovado_interno", "enviado_credores", "aceito_credores"]),
        ))
        .returning({ id: recoveryScenarios.id });
      if (!claimed) {
        return res.status(409).json({ message: "Cenário já está sendo homologado por outra requisição ou mudou de status" });
      }
      if (!scenario.numParcelas || !scenario.intervaloDias) {
        return res.status(400).json({ message: "Cenário sem numParcelas/intervaloDias definidos" });
      }
      const primeiraParcelaData = scenario.primeiraParcelaData
        ? new Date(scenario.primeiraParcelaData as any)
        : new Date(Date.now() + 30 * MS_PER_DAY);

      // Fonte das parcelas: propostas com status enviada/aceita/contraproposta
      const props = await db.select().from(recoveryProposals)
        .where(and(
          eq(recoveryProposals.tenantId, tenantId),
          eq(recoveryProposals.scenarioId, scenario.id),
          inArray(recoveryProposals.status, ["enviada", "aceita", "contraproposta"]),
        ));

      let series: Array<{ creditorId: string; proposalId: string | null; parts: ReturnType<typeof buildInstallmentsForProposal> }> = [];

      if (props.length > 0) {
        for (const p of props) {
          const valorBase = Number(p.contraPropostaValor ?? p.valorOriginal ?? 0);
          if (valorBase <= 0) continue;
          const parts = buildInstallmentsForProposal({
            numParcelas: p.contraPropostaParcelas ?? scenario.numParcelas,
            intervaloDias: scenario.intervaloDias,
            carenciaMeses: scenario.carenciaMeses ?? 0,
            primeiraParcelaData,
            hasReducedInitial: !!scenario.hasReducedInitial,
            reducedCount: scenario.reducedCount ?? 0,
            reducedAmount: Number(scenario.reducedAmount ?? 0),
            valorBase,
          });
          series.push({ creditorId: p.creditorId, proposalId: p.id, parts });
        }
      } else {
        // Fallback: distribuir entre TODOS credores do processo proporcionalmente
        const creds = await db.select().from(recoveryCreditors)
          .where(and(
            eq(recoveryCreditors.tenantId, tenantId),
            eq(recoveryCreditors.processId, scenario.processId),
          ));
        if (creds.length === 0) {
          return res.status(400).json({ message: "Cenário sem propostas e processo sem credores. Crie propostas antes de homologar." });
        }
        const totalDiv = creds.reduce((acc, c) => acc + Number(c.valorAtualizado ?? c.valorOriginal ?? 0), 0);
        const totalProp = Number(scenario.valorTotalProposto ?? 0);
        if (totalDiv <= 0 || totalProp <= 0) {
          return res.status(400).json({ message: "Não foi possível ratear o valor proposto entre credores" });
        }
        for (const c of creds) {
          const peso = Number(c.valorAtualizado ?? c.valorOriginal ?? 0) / totalDiv;
          const valorBase = totalProp * peso;
          const parts = buildInstallmentsForProposal({
            numParcelas: scenario.numParcelas,
            intervaloDias: scenario.intervaloDias,
            carenciaMeses: scenario.carenciaMeses ?? 0,
            primeiraParcelaData,
            hasReducedInitial: !!scenario.hasReducedInitial,
            reducedCount: scenario.reducedCount ?? 0,
            reducedAmount: Number(scenario.reducedAmount ?? 0),
            valorBase,
          });
          series.push({ creditorId: c.id, proposalId: null, parts });
        }
      }

      // Cria parcelas (transação implícita por insert único)
      const inserts = series.flatMap((s) => s.parts.map((part) => ({
        tenantId,
        processId: scenario.processId,
        scenarioId: scenario.id,
        creditorId: s.creditorId,
        proposalId: s.proposalId,
        numero: part.numero,
        dueDate: part.dueDate.toISOString().slice(0, 10),
        valor: String(part.valor),
        status: "pendente" as const,
        createdById: userId || undefined,
        updatedById: userId || undefined,
      })));

      if (inserts.length === 0) {
        return res.status(400).json({ message: "Não foi possível gerar parcelas (séries vazias)" });
      }

      const created = await db.insert(recoveryInstallments).values(inserts).returning({ id: recoveryInstallments.id });

      // Transição: cenário → homologado, credores → acordo_homologado
      await db.update(recoveryScenarios)
        .set({ status: "homologado", updatedAt: new Date(), updatedById: userId || undefined })
        .where(eq(recoveryScenarios.id, scenario.id));
      const credIds = Array.from(new Set(series.map((s) => s.creditorId)));
      if (credIds.length > 0) {
        await db.update(recoveryCreditors)
          .set({ statusNegociacao: "acordo_aceito", updatedAt: new Date() })
          .where(and(
            eq(recoveryCreditors.tenantId, tenantId),
            inArray(recoveryCreditors.id, credIds),
          ));
      }
      // Marca propostas referenciadas como aceitas/homologadas
      const propIds = Array.from(new Set(series.map((s) => s.proposalId).filter((x): x is string => !!x)));
      if (propIds.length > 0) {
        await db.update(recoveryProposals)
          .set({ status: "homologada", updatedAt: new Date(), updatedById: userId || undefined })
          .where(and(
            eq(recoveryProposals.tenantId, tenantId),
            inArray(recoveryProposals.id, propIds),
          ));
      }
      // Atualiza processo para acordo_homologado
      await db.update(recoveryProcesses)
        .set({ status: "acordo_homologado", updatedAt: new Date() })
        .where(eq(recoveryProcesses.id, scenario.processId));

      await db.insert(recoveryTimeline).values({
        tenantId, processId: scenario.processId,
        eventType: "scenario_homologated",
        title: `Cenário homologado: ${scenario.nome}`,
        description: `${created.length} parcelas geradas para ${credIds.length} credor(es)`,
        payload: { scenarioId: scenario.id, installmentsCount: created.length, creditorsCount: credIds.length },
        createdById: userId || undefined,
      });

      // Sprint 4: notificação broadcast do tenant
      await createRecoveryNotification({
        tenantId,
        userId: null,
        title: `Cenário "${scenario.nome}" homologado`,
        body: `${created.length} parcela(s) geradas para ${credIds.length} credor(es). Acesse o processo para liberar parcelas.`,
        type: "success",
        sourceType: "recovery_scenario",
        sourceId: scenario.id,
      });

      res.status(201).json({
        scenarioId: scenario.id,
        installmentsCreated: created.length,
        creditorsAffected: credIds.length,
        installmentIds: created.map((c) => c.id),
      });
    } catch (e: any) {
      console.error("[recovery] homologate:", e);
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao homologar cenário" });
    }
  });

  // ── Listar parcelas do processo
  app.get("/api/recovery/processes/:processId/installments", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const proc = await ensureProcess(req.params.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });

      const status = req.query.status as string | undefined;
      const creditorId = req.query.creditorId as string | undefined;
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));

      const conditions = [
        eq(recoveryInstallments.tenantId, tenantId),
        eq(recoveryInstallments.processId, proc.id),
      ];
      if (status) conditions.push(eq(recoveryInstallments.status, status));
      if (creditorId) conditions.push(eq(recoveryInstallments.creditorId, creditorId));

      const rows = await db.select().from(recoveryInstallments)
        .where(and(...conditions))
        .orderBy(asc(recoveryInstallments.dueDate), asc(recoveryInstallments.numero))
        .limit(limit).offset(offset);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(recoveryInstallments)
        .where(and(...conditions));

      res.json({ items: rows, total: Number(count), limit, offset });
    } catch (e: any) {
      console.error("[recovery] list installments:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Parcelas pendentes de liberação (próximos 30 dias)
  app.get("/api/recovery/processes/:processId/installments/pending-release", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const proc = await ensureProcess(req.params.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const horizon = new Date(Date.now() + 30 * MS_PER_DAY).toISOString().slice(0, 10);
      const rows = await db.select().from(recoveryInstallments)
        .where(and(
          eq(recoveryInstallments.tenantId, tenantId),
          eq(recoveryInstallments.processId, proc.id),
          eq(recoveryInstallments.isReleasedToControl, false),
          inArray(recoveryInstallments.status, ["pendente", "agendado"]),
          lte(recoveryInstallments.dueDate, horizon),
        ))
        .orderBy(asc(recoveryInstallments.dueDate));
      res.json({ items: rows });
    } catch (e: any) {
      console.error("[recovery] pending-release:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Liberar 1 parcela para o Control (cria AP)
  app.post("/api/recovery/installments/:id/release", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const inst = await ensureInstallment(req.params.id, tenantId);
      if (!inst) return res.status(404).json({ message: "Parcela não encontrada" });
      if (inst.isReleasedToControl) {
        return res.status(409).json({ message: "Parcela já liberada", controlApId: inst.controlApId });
      }
      if (inst.status === "cancelado") {
        return res.status(409).json({ message: "Parcela cancelada não pode ser liberada" });
      }

      const proc = await ensureProcess(inst.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const clienteControlId = await resolveControlClienteId(tenantId, proc.clientePessoaId);
      if (!clienteControlId) {
        return res.status(409).json({
          message: "O cliente do processo não está vinculado a um cadastro do Control. Vincule o cliente em /pessoas/<id> antes de liberar.",
        });
      }

      const valor = Number(inst.valor);
      const bufferPct = req.body?.bufferPct != null ? Number(req.body.bufferPct) : 0.15;
      const skipGuard = req.body?.skipGuard === true; // Para casos extremos com justificativa
      let guard = { ok: true, projectedBalance: 0, bufferRequired: 0, monthEvaluated: "", reason: undefined as string | undefined };

      if (!skipGuard) {
        const g = await canReleaseToControl(tenantId, clienteControlId, inst.dueDate as any, valor, bufferPct);
        if (!g.ok) {
          return res.status(409).json({ message: g.reason, ...g });
        }
        guard = g;
      }

      // Buscar nome do credor para descrição da AP
      const [cred] = await db.select().from(recoveryCreditors)
        .where(eq(recoveryCreditors.id, inst.creditorId)).limit(1);

      // Idempotência transacional: claim atômico da parcela ANTES de criar a AP.
      // O UPDATE só sucede se isReleasedToControl ainda for false; em concorrência,
      // apenas 1 request consegue avançar. A UNIQUE INDEX em
      // lancamentos_financeiros(recovery_installment_id) é a segunda barreira.
      const result = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(recoveryInstallments)
          .set({
            isReleasedToControl: true,
            releasedAt: new Date(),
            releasedById: userId || undefined,
            status: inst.status === "pendente" ? "agendado" : inst.status,
            updatedAt: new Date(),
            updatedById: userId || undefined,
          })
          .where(and(
            eq(recoveryInstallments.id, inst.id),
            eq(recoveryInstallments.tenantId, tenantId),
            eq(recoveryInstallments.isReleasedToControl, false),
          ))
          .returning();
        if (!claimed) {
          throw Object.assign(new Error("Parcela já liberada (concorrência detectada)"), { statusCode: 409 });
        }

        const [ap] = await tx.insert(lancamentosFinanceiros).values({
          tenantId,
          clienteId: clienteControlId,
          tipo: "pagar",
          descricao: `Recuperação ${proc.numeroProcesso || ""} — Parcela ${inst.numero} ${cred?.credorNome ? `— ${cred.credorNome}` : ""}`.trim(),
          favorecido: cred?.credorNome || undefined,
          valor: String(valor),
          dataVencimento: inst.dueDate as any,
          status: "aprovado", // bypass workflow normal
          origem: "integracao", // valor existente; identificável via recoveryInstallmentId
          criadoPor: userId || undefined,
          aprovadoPor: userId || undefined,
          aprovadoEm: new Date(),
          recoveryInstallmentId: inst.id,
          observacoes: `AP gerada automaticamente pelo módulo Recovery. Cenário ${inst.scenarioId.slice(0, 8)} / Processo ${inst.processId.slice(0, 8)}.`,
        }).returning();

        const [updated] = await tx.update(recoveryInstallments)
          .set({ controlApId: ap.id, updatedAt: new Date(), updatedById: userId || undefined })
          .where(eq(recoveryInstallments.id, inst.id))
          .returning();
        return { updated, ap };
      });
      const updated = result.updated;
      const ap = result.ap;

      await db.insert(recoveryTimeline).values({
        tenantId, processId: inst.processId,
        eventType: "installment_released",
        title: `Parcela #${inst.numero} liberada para o Control`,
        description: `R$ ${valor.toFixed(2)} para vencimento ${inst.dueDate}. Caixa projetado em ${guard.monthEvaluated || "—"}: R$ ${guard.projectedBalance.toFixed(2)}.`,
        payload: { installmentId: inst.id, controlApId: ap.id, guard },
        createdById: userId || undefined,
      });

      await createRecoveryNotification({
        tenantId,
        userId: null,
        title: `Parcela liberada para o Control`,
        body: `Parcela #${inst.numero} (R$ ${valor.toFixed(2)}) ${cred?.credorNome ? `de ${cred.credorNome} ` : ""}foi enviada ao Control para vencimento em ${inst.dueDate}.`,
        type: "info",
        sourceType: "recovery_installment",
        sourceId: inst.id,
      });

      res.json({ installment: updated, controlApId: ap.id, guard });
    } catch (e: any) {
      console.error("[recovery] release:", e);
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao liberar parcela" });
    }
  });

  // ── Liberar várias em lote (continue on error)
  app.post("/api/recovery/processes/:processId/installments/batch-release", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const proc = await ensureProcess(req.params.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const ids: string[] = Array.isArray(req.body?.installmentIds) ? req.body.installmentIds : [];
      if (ids.length === 0) return res.status(400).json({ message: "installmentIds vazio" });
      const bufferPct = req.body?.bufferPct != null ? Number(req.body.bufferPct) : 0.15;
      const skipGuard = req.body?.skipGuard === true;

      const clienteControlId = await resolveControlClienteId(tenantId, proc.clientePessoaId);
      if (!clienteControlId) {
        return res.status(409).json({ message: "Cliente do processo sem vínculo com o Control" });
      }

      const released: Array<{ installmentId: string; controlApId: string }> = [];
      const failed: Array<{ installmentId: string; reason: string }> = [];

      for (const id of ids) {
        try {
          const inst = await ensureInstallment(id, tenantId);
          if (!inst) { failed.push({ installmentId: id, reason: "não encontrada" }); continue; }
          if (inst.processId !== proc.id) { failed.push({ installmentId: id, reason: "processo divergente" }); continue; }
          if (inst.isReleasedToControl) { failed.push({ installmentId: id, reason: "já liberada" }); continue; }
          if (inst.status === "cancelado") { failed.push({ installmentId: id, reason: "cancelada" }); continue; }
          const valor = Number(inst.valor);
          if (!skipGuard) {
            const g = await canReleaseToControl(tenantId, clienteControlId, inst.dueDate as any, valor, bufferPct);
            if (!g.ok) { failed.push({ installmentId: id, reason: g.reason || "guard falhou" }); continue; }
          }
          const [cred] = await db.select().from(recoveryCreditors).where(eq(recoveryCreditors.id, inst.creditorId)).limit(1);
          const [ap] = await db.insert(lancamentosFinanceiros).values({
            tenantId, clienteId: clienteControlId, tipo: "pagar",
            descricao: `Recuperação ${proc.numeroProcesso || ""} — Parcela ${inst.numero} ${cred?.credorNome ? `— ${cred.credorNome}` : ""}`.trim(),
            favorecido: cred?.credorNome || undefined,
            valor: String(valor),
            dataVencimento: inst.dueDate as any,
            status: "aprovado", origem: "integracao",
            criadoPor: userId || undefined, aprovadoPor: userId || undefined, aprovadoEm: new Date(),
            recoveryInstallmentId: inst.id,
            observacoes: `AP gerada via batch-release Recovery.`,
          }).returning();
          await db.update(recoveryInstallments)
            .set({
              isReleasedToControl: true, releasedAt: new Date(), releasedById: userId || undefined,
              controlApId: ap.id,
              status: inst.status === "pendente" ? "agendado" : inst.status,
              updatedAt: new Date(), updatedById: userId || undefined,
            })
            .where(eq(recoveryInstallments.id, inst.id));
          released.push({ installmentId: id, controlApId: ap.id });
        } catch (err: any) {
          failed.push({ installmentId: id, reason: err.message || "erro interno" });
        }
      }

      if (released.length > 0) {
        await db.insert(recoveryTimeline).values({
          tenantId, processId: proc.id,
          eventType: "installments_batch_released",
          title: `${released.length} parcelas liberadas em lote`,
          description: failed.length > 0 ? `${failed.length} falharam` : undefined,
          payload: { released, failed },
          createdById: userId || undefined,
        });
      }
      res.json({ released, failed, releasedCount: released.length, failedCount: failed.length });
    } catch (e: any) {
      console.error("[recovery] batch-release:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Marcar como paga (sincroniza com AP do Control se existir)
  app.post("/api/recovery/installments/:id/mark-paid", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const inst = await ensureInstallment(req.params.id, tenantId);
      if (!inst) return res.status(404).json({ message: "Parcela não encontrada" });
      if (inst.status === "pago") return res.status(409).json({ message: "Parcela já está paga" });
      const paidAmount = req.body?.paidAmount != null ? Number(req.body.paidAmount) : Number(inst.valor);
      const paidDate = req.body?.paidDate ? String(req.body.paidDate) : new Date().toISOString().slice(0, 10);
      const paymentMethod = req.body?.paymentMethod ? String(req.body.paymentMethod) : null;

      const [updated] = await db.update(recoveryInstallments)
        .set({
          status: "pago",
          paidAmount: String(paidAmount),
          paidDate,
          paymentMethod: paymentMethod || undefined,
          updatedAt: new Date(),
          updatedById: userId || undefined,
        })
        .where(eq(recoveryInstallments.id, inst.id))
        .returning();

      if (inst.controlApId) {
        await db.update(lancamentosFinanceiros)
          .set({
            status: "pago",
            dataPagamento: paidDate,
            updatedAt: new Date(),
          })
          .where(eq(lancamentosFinanceiros.id, inst.controlApId));
      }

      await db.insert(recoveryTimeline).values({
        tenantId, processId: inst.processId,
        eventType: "installment_paid",
        title: `Parcela #${inst.numero} paga`,
        description: `R$ ${paidAmount.toFixed(2)} em ${paidDate}${paymentMethod ? ` via ${paymentMethod}` : ""}`,
        payload: { installmentId: inst.id, paidAmount, paidDate, paymentMethod },
        createdById: userId || undefined,
      });

      await createRecoveryNotification({
        tenantId,
        userId: null,
        title: `Parcela #${inst.numero} paga`,
        body: `Pagamento de R$ ${paidAmount.toFixed(2)} registrado em ${paidDate}${paymentMethod ? ` (${paymentMethod})` : ""}.`,
        type: "success",
        sourceType: "recovery_installment",
        sourceId: inst.id,
      });
      res.json(updated);
    } catch (e: any) {
      console.error("[recovery] mark-paid:", e);
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao marcar paga" });
    }
  });

  // ── Excluir parcela (apenas pendente e não liberada)
  app.delete("/api/recovery/installments/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const inst = await ensureInstallment(req.params.id, tenantId);
      if (!inst) return res.status(404).json({ message: "Parcela não encontrada" });
      if (inst.isReleasedToControl) {
        return res.status(409).json({ message: "Parcela já liberada para o Control não pode ser excluída. Cancele a AP primeiro." });
      }
      if (inst.status !== "pendente") {
        return res.status(409).json({ message: `Parcela no status '${inst.status}' não pode ser excluída` });
      }
      await db.delete(recoveryInstallments).where(eq(recoveryInstallments.id, inst.id));
      await db.insert(recoveryTimeline).values({
        tenantId, processId: inst.processId,
        eventType: "installment_deleted",
        title: `Parcela #${inst.numero} excluída`,
        payload: { installmentId: inst.id },
        createdById: userId || undefined,
      });
      res.status(204).end();
    } catch (e: any) {
      console.error("[recovery] delete installment:", e);
      res.status(500).json({ message: e.message });
    }
  });
}
