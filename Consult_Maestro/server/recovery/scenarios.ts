/**
 * scenarios.ts — Endpoints de cenários de negociação (Sprint 2).
 *
 * Endpoints registrados em routes.ts:
 *   GET    /api/recovery/processes/:processId/scenarios
 *   POST   /api/recovery/processes/:processId/scenarios
 *   GET    /api/recovery/scenarios/:id
 *   PATCH  /api/recovery/scenarios/:id
 *   DELETE /api/recovery/scenarios/:id
 *   POST   /api/recovery/scenarios/:id/simulate
 *   POST   /api/recovery/scenarios/:id/approve
 *   POST   /api/recovery/scenarios/:id/reject
 *   GET    /api/recovery/scenarios/compare?ids=a,b,c
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  recoveryScenarios, recoveryProposals, recoveryProcesses, recoveryTimeline,
  insertRecoveryScenarioSchema,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, eq, inArray, desc } from "drizzle-orm";
import { calculateCET, buildScheduleFromScenario } from "./cetCalculator";

const NUMERIC_SCENARIO_FIELDS = [
  "valorTotalDivida", "valorTotalProposto", "reducedAmount", "normalAmount",
  "cetMensal", "cetAnual", "totalPagoNominal", "totalJurosPagos", "viabilityScore",
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

const SCENARIO_PATCH_FIELDS = new Set([
  "nome", "descricao", "tipoCenario",
  "valorTotalDivida", "valorTotalProposto", "descontoPct",
  "numParcelas", "intervaloDias", "carenciaMeses",
  "hasReducedInitial", "reducedCount", "reducedAmount", "normalAmount",
  "primeiraParcelaData", "taxaPropostaMensal",
]);

const FINAL_STATUSES = new Set(["aprovado_interno", "enviado_credores", "aceito_credores", "homologado", "rejeitado"]);

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

async function ensureProcess(processId: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(recoveryProcesses)
    .where(and(eq(recoveryProcesses.id, processId), eq(recoveryProcesses.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

/**
 * Roda o simulador CET sobre os dados atuais do cenário. Retorna o resultado
 * sem persistir (caller decide).
 *
 * Exportado para reuso pela tool de agente `simular_cenario_recovery`
 * (MCP Hub Sprint 2). NÃO duplique essa lógica em outro lugar — use esta
 * função.
 */
export function runSimulation(s: any) {
  const valorOriginal = Number(s.valorTotalDivida || 0);
  const numParcelas = Number(s.numParcelas || 0);
  const intervaloDias = Number(s.intervaloDias || 30);
  const carenciaMeses = Number(s.carenciaMeses || 0);
  const hasReducedInitial = Boolean(s.hasReducedInitial);
  const reducedCount = Number(s.reducedCount || 0);
  const reducedAmount = Number(s.reducedAmount || 0);
  const normalAmount = Number(s.normalAmount || 0);
  const totalProposto = Number(s.valorTotalProposto || 0);

  // Se não há parcelas reduzidas e normalAmount é 0, infere parcela = totalProposto / numParcelas
  let parcelaUnica = normalAmount;
  if (!hasReducedInitial && normalAmount <= 0 && numParcelas > 0 && totalProposto > 0) {
    parcelaUnica = totalProposto / numParcelas;
  }

  const primeiraData = s.primeiraParcelaData ? new Date(s.primeiraParcelaData) : new Date();

  if (valorOriginal <= 0 || numParcelas <= 0) {
    return null;
  }

  const schedule = buildScheduleFromScenario({
    valorOriginal,
    numParcelas,
    intervaloDias,
    carenciaMeses,
    primeiraParcelaData: primeiraData,
    hasReducedInitial,
    reducedCount,
    reducedAmount,
    normalAmount,
    parcelaUnica,
  });
  const result = calculateCET(schedule);

  // Cash flow impact mensal (agrega parcelas por mês)
  const impactMap = new Map<string, number>();
  for (let i = 0; i < schedule.parcelas.length; i++) {
    const dueDate = new Date(schedule.primeiraParcelaData.getTime() + i * schedule.intervaloDias * 86_400_000);
    const key = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}`;
    impactMap.set(key, (impactMap.get(key) || 0) + schedule.parcelas[i]);
  }
  let cumulative = 0;
  const cashFlowImpact = Array.from(impactMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => {
      cumulative += amount;
      return { month, amount: Math.round(amount * 100) / 100, cumulative: Math.round(cumulative * 100) / 100 };
    });

  return { result, cashFlowImpact };
}

export function registerScenarioRoutes(app: Express) {
  // List scenarios for a process
  app.get("/api/recovery/processes/:processId/scenarios", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const proc = await ensureProcess(req.params.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      const rows = await db
        .select()
        .from(recoveryScenarios)
        .where(and(eq(recoveryScenarios.tenantId, tenantId), eq(recoveryScenarios.processId, req.params.processId)))
        .orderBy(desc(recoveryScenarios.createdAt));
      res.json(rows);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao listar cenários" });
    }
  });

  // Create scenario for a process
  app.post("/api/recovery/processes/:processId/scenarios", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const proc = await ensureProcess(req.params.processId, tenantId);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });

      const payload = coerceNumericFields({ ...req.body, tenantId, processId: req.params.processId }, NUMERIC_SCENARIO_FIELDS);
      const parsed = insertRecoveryScenarioSchema.parse(payload);

      const [created] = await db.insert(recoveryScenarios).values({
        ...parsed,
        createdById: userId || undefined,
        updatedById: userId || undefined,
      }).returning();

      // Roda simulação inicial se houver dados suficientes
      const sim = runSimulation(created);
      if (sim) {
        const [updated] = await db.update(recoveryScenarios)
          .set({
            cetMensal: String(sim.result.cetMensal),
            cetAnual: String(sim.result.cetAnual),
            totalPagoNominal: String(sim.result.totalPagoNominal),
            totalJurosPagos: String(sim.result.totalJurosPagos),
            viabilityScore: String(sim.result.viabilityScore),
            cashFlowImpact: sim.cashFlowImpact,
            updatedAt: new Date(),
          })
          .where(eq(recoveryScenarios.id, created.id))
          .returning();
        await db.insert(recoveryTimeline).values({
          tenantId, processId: req.params.processId,
          eventType: "scenario_created",
          title: `Cenário criado: ${created.nome}`,
          description: `CET ${(sim.result.cetMensal * 100).toFixed(4)}% a.m. — viabilidade ${(sim.result.viabilityScore * 100).toFixed(0)}%`,
          payload: { scenarioId: created.id, cetMensal: sim.result.cetMensal, viabilityScore: sim.result.viabilityScore },
          createdById: userId || undefined,
        });
        return res.status(201).json(updated);
      }

      await db.insert(recoveryTimeline).values({
        tenantId, processId: req.params.processId,
        eventType: "scenario_created",
        title: `Cenário criado: ${created.nome}`,
        description: "Cenário em rascunho (parâmetros incompletos para simulação)",
        payload: { scenarioId: created.id },
        createdById: userId || undefined,
      });
      res.status(201).json(created);
    } catch (e: any) {
      res.status(e.statusCode || 400).json({ message: e.message || "Erro ao criar cenário", details: e.errors });
    }
  });

  // Get scenario detail (with proposals)
  // IMPORTANTE: rota /compare deve vir ANTES da rota :id para não ser capturada
  app.get("/api/recovery/scenarios/compare", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const idsParam = String(req.query.ids || "");
      const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
      if (ids.length < 2 || ids.length > 4) {
        return res.status(400).json({ message: "Informe entre 2 e 4 IDs de cenários para comparar" });
      }
      const rows = await db
        .select()
        .from(recoveryScenarios)
        .where(and(eq(recoveryScenarios.tenantId, tenantId), inArray(recoveryScenarios.id, ids)));
      if (rows.length !== ids.length) {
        return res.status(404).json({ message: "Um ou mais cenários não foram encontrados neste tenant" });
      }
      const ranked = rows
        .map(r => ({ ...r, _vs: Number(r.viabilityScore || 0) }))
        .sort((a, b) => b._vs - a._vs);
      res.json({
        scenarios: ranked,
        winner: ranked[0]?.id || null,
      });
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao comparar cenários" });
    }
  });

  app.get("/api/recovery/scenarios/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      const proposals = await db
        .select()
        .from(recoveryProposals)
        .where(and(eq(recoveryProposals.tenantId, tenantId), eq(recoveryProposals.scenarioId, req.params.id)));
      res.json({ ...scenario, proposals });
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao buscar cenário" });
    }
  });

  // Update scenario (only when in editable status)
  app.patch("/api/recovery/scenarios/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      if (FINAL_STATUSES.has(scenario.status)) {
        return res.status(409).json({ message: `Cenário no status '${scenario.status}' não pode ser editado` });
      }
      const updates = coerceNumericFields(pickFields(req.body || {}, SCENARIO_PATCH_FIELDS), NUMERIC_SCENARIO_FIELDS);
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      }
      // Validação parcial via Zod (apenas campos presentes)
      try {
        insertRecoveryScenarioSchema.partial().parse(updates);
      } catch (zErr: any) {
        return res.status(400).json({ message: "Validação falhou", details: zErr.errors });
      }
      const [updated] = await db.update(recoveryScenarios)
        .set({ ...updates, updatedAt: new Date(), updatedById: userId || undefined })
        .where(and(eq(recoveryScenarios.id, req.params.id), eq(recoveryScenarios.tenantId, tenantId)))
        .returning();
      // Re-roda simulação se algum parâmetro relevante mudou
      const sim = runSimulation(updated);
      if (sim) {
        const [resimulated] = await db.update(recoveryScenarios)
          .set({
            cetMensal: String(sim.result.cetMensal),
            cetAnual: String(sim.result.cetAnual),
            totalPagoNominal: String(sim.result.totalPagoNominal),
            totalJurosPagos: String(sim.result.totalJurosPagos),
            viabilityScore: String(sim.result.viabilityScore),
            cashFlowImpact: sim.cashFlowImpact,
            updatedAt: new Date(),
          })
          .where(eq(recoveryScenarios.id, req.params.id))
          .returning();
        return res.json(resimulated);
      }
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 400).json({ message: e.message || "Erro ao atualizar cenário" });
    }
  });

  // Delete scenario (only rascunho or rejeitado)
  app.delete("/api/recovery/scenarios/:id", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      if (!["rascunho", "em_analise", "rejeitado"].includes(scenario.status)) {
        return res.status(409).json({ message: `Cenário no status '${scenario.status}' não pode ser excluído` });
      }
      await db.delete(recoveryScenarios)
        .where(and(eq(recoveryScenarios.id, req.params.id), eq(recoveryScenarios.tenantId, tenantId)));
      await db.insert(recoveryTimeline).values({
        tenantId, processId: scenario.processId,
        eventType: "scenario_deleted",
        title: `Cenário excluído: ${scenario.nome}`,
        payload: { scenarioId: scenario.id },
        createdById: userId || undefined,
      });
      res.status(204).end();
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao excluir cenário" });
    }
  });

  // Simulate (recalcula CET com parâmetros atuais ou enviados em body)
  app.post("/api/recovery/scenarios/:id/simulate", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      // Permite override de parâmetros sem persistir (preview)
      const merged = { ...scenario, ...(req.body || {}) };
      const sim = runSimulation(merged);
      if (!sim) return res.status(400).json({ message: "Parâmetros insuficientes para simular (valor e número de parcelas obrigatórios)" });
      // Se persist=true, salva
      if (req.body?.persist) {
        if (FINAL_STATUSES.has(scenario.status)) {
          return res.status(409).json({ message: `Cenário no status '${scenario.status}' não permite re-simular` });
        }
        await db.update(recoveryScenarios)
          .set({
            cetMensal: String(sim.result.cetMensal),
            cetAnual: String(sim.result.cetAnual),
            totalPagoNominal: String(sim.result.totalPagoNominal),
            totalJurosPagos: String(sim.result.totalJurosPagos),
            viabilityScore: String(sim.result.viabilityScore),
            cashFlowImpact: sim.cashFlowImpact,
            updatedAt: new Date(),
          })
          .where(eq(recoveryScenarios.id, req.params.id));
      }
      res.json({ ...sim.result, cashFlowImpact: sim.cashFlowImpact });
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao simular cenário" });
    }
  });

  // Aprovar (rascunho/em_analise -> aprovado_interno)
  app.post("/api/recovery/scenarios/:id/approve", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      if (!["rascunho", "em_analise"].includes(scenario.status)) {
        return res.status(409).json({ message: `Cenário no status '${scenario.status}' não pode ser aprovado` });
      }
      // Validação: precisa ter CET calculado
      if (!scenario.cetMensal) {
        return res.status(400).json({ message: "Cenário sem CET calculado — execute simulação antes de aprovar" });
      }
      const [updated] = await db.update(recoveryScenarios)
        .set({
          status: "aprovado_interno",
          approvedById: userId || undefined,
          approvedAt: new Date(),
          updatedAt: new Date(),
          updatedById: userId || undefined,
        })
        .where(and(eq(recoveryScenarios.id, req.params.id), eq(recoveryScenarios.tenantId, tenantId)))
        .returning();
      await db.insert(recoveryTimeline).values({
        tenantId, processId: scenario.processId,
        eventType: "scenario_approved",
        title: `Cenário aprovado internamente: ${scenario.nome}`,
        description: `CET ${(Number(scenario.cetMensal) * 100).toFixed(4)}% a.m.`,
        payload: { scenarioId: scenario.id, approvedBy: userId, cetMensal: scenario.cetMensal },
        createdById: userId || undefined,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao aprovar cenário" });
    }
  });

  // Rejeitar
  app.post("/api/recovery/scenarios/:id/reject", isAuthenticated, requireTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string;
      const userId = getUserId(req);
      const scenario = await ensureScenario(req.params.id, tenantId);
      if (!scenario) return res.status(404).json({ message: "Cenário não encontrado" });
      // Bloqueia rebaixamento de status finais (homologado/aceito/etc)
      if (FINAL_STATUSES.has(scenario.status) && scenario.status !== "rejeitado") {
        return res.status(409).json({ message: `Cenário no status '${scenario.status}' não pode ser rejeitado` });
      }
      const reason = String(req.body?.reason || "").trim();
      const [updated] = await db.update(recoveryScenarios)
        .set({
          status: "rejeitado", rejectedReason: reason || null,
          updatedAt: new Date(), updatedById: userId || undefined,
        })
        .where(and(eq(recoveryScenarios.id, req.params.id), eq(recoveryScenarios.tenantId, tenantId)))
        .returning();
      await db.insert(recoveryTimeline).values({
        tenantId, processId: scenario.processId,
        eventType: "scenario_rejected",
        title: `Cenário rejeitado: ${scenario.nome}`,
        description: reason || undefined,
        payload: { scenarioId: scenario.id, reason },
        createdById: userId || undefined,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(e.statusCode || 500).json({ message: e.message || "Erro ao rejeitar cenário" });
    }
  });

  // Comparar 2-3 cenários (mesmo tenant; valida que pertencem)
}
