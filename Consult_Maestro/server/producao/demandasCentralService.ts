// PROD-4 — Central de Produção (PCP) — orquestração de demandas humanas e agente IA.

import { db } from "../db";
import {
  demandasCentral, scrumInternalProjects, scrumSprints, scrumBacklogItems,
  projects,
} from "@shared/schema";
import type { DemandaCentral, InsertDemandaCentral } from "@shared/schema";
import { and, eq, desc, asc, gte, sql, inArray } from "drizzle-orm";
import { runWithOrchestration } from "../mcp/llmOrchestrator";
import { callChatLLM } from "../mcp/llmClient";

const PRIORIDADE_RANK: Record<string, number> = {
  critico: 4, alto: 3, medio: 2, baixo: 1,
};

export interface FiltrosDemandas {
  status?: string;
  tipo?: string;
  prioridade?: string;
  projetoId?: string;
  assigneeType?: string;
}

export async function listar(tenantId: string, filtros: FiltrosDemandas = {}): Promise<DemandaCentral[]> {
  const conds = [eq(demandasCentral.tenantId, tenantId)];
  if (filtros.status) conds.push(eq(demandasCentral.status, filtros.status));
  if (filtros.tipo) conds.push(eq(demandasCentral.tipo, filtros.tipo));
  if (filtros.prioridade) conds.push(eq(demandasCentral.prioridade, filtros.prioridade));
  if (filtros.projetoId) conds.push(eq(demandasCentral.projetoId, filtros.projetoId));
  if (filtros.assigneeType) conds.push(eq(demandasCentral.assigneeType, filtros.assigneeType));

  const rows = await db.select().from(demandasCentral).where(and(...conds));
  return rows.sort((a, b) => {
    const pa = PRIORIDADE_RANK[a.prioridade] ?? 0;
    const pb = PRIORIDADE_RANK[b.prioridade] ?? 0;
    if (pa !== pb) return pb - pa;
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db_ = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return da - db_;
  });
}

export async function obter(tenantId: string, id: string): Promise<DemandaCentral | null> {
  const [row] = await db.select().from(demandasCentral)
    .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, id))).limit(1);
  return row ?? null;
}

export async function criar(tenantId: string, input: InsertDemandaCentral): Promise<DemandaCentral> {
  const [row] = await db.insert(demandasCentral)
    .values({ ...input, tenantId })
    .returning();
  return row;
}

/**
 * Dispara execucaoAgente em background, aguardando o retorno do INSERT (passa-se a row já comitada).
 * Chamado no route handler após criar() retornar para evitar race condition de leitura prematura.
 */
export function dispararAgenteSeNecessario(row: DemandaCentral): void {
  if (row.assigneeType === "agent" && row.agenteTask) {
    setImmediate(() => {
      execucaoAgente(row.id, row.tenantId).catch(err =>
        console.error("[demandas] execucaoAgente erro:", err?.message),
      );
    });
  }
}

export async function atualizar(tenantId: string, id: string, patch: Partial<InsertDemandaCentral>): Promise<DemandaCentral | null> {
  const existing = await obter(tenantId, id);
  if (!existing) return null;
  const [row] = await db.update(demandasCentral)
    .set(patch)
    .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, id)))
    .returning();
  return row ?? null;
}

export async function cancelar(tenantId: string, id: string): Promise<DemandaCentral | null> {
  const [row] = await db.update(demandasCentral)
    .set({ status: "cancelado", resolvidoAt: new Date() })
    .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, id)))
    .returning();
  return row ?? null;
}

function buildPromptDemanda(d: DemandaCentral): { systemPrompt: string; userPrompt: string } {
  const ctx = d.projetoId ? `Projeto ID: ${d.projetoId}\n` : "";
  const desc = d.descricao ? `Descrição: ${d.descricao}\n` : "";
  let systemPrompt = "Você é um agente especialista da plataforma Arcádia Consulting. Seja conciso, técnico e acionável.";
  let userPrompt = `${ctx}Título: ${d.titulo}\n${desc}`;

  switch (d.tipo) {
    case "documento":
      systemPrompt = "Você é um agente gerador de documentos (atas, relatórios, propostas). Produza conteúdo completo, estruturado em seções, em português.";
      userPrompt += "\n\nGere o documento solicitado em formato Markdown estruturado.";
      break;
    case "analise":
      systemPrompt = "Você é um Project Manager sênior. Analise o contexto e produza recomendações priorizadas.";
      userPrompt += "\n\nProduza análise com: 1) diagnóstico, 2) riscos, 3) próximos passos. Seja específico.";
      break;
    case "modulo":
      systemPrompt = "Você é um arquiteto de software. Esboce um módulo com escopo, dependências, entregáveis e estimativa.";
      userPrompt += "\n\nEntregue: visão geral, principais entidades, telas/endpoints, dependências, estimativa em sprints.";
      break;
    case "projeto":
      systemPrompt = "Você é um PM. Esboce o plano inicial do projeto com fases, marcos e riscos.";
      userPrompt += "\n\nEntregue: fases, marcos, riscos iniciais, sugestão de equipe.";
      break;
    case "bug":
      systemPrompt = "Você é um agente de triagem de bugs. Reproduza, classifique e proponha correção.";
      userPrompt += "\n\nProponha: severidade, hipótese de causa, passos de reprodução, sugestão de correção.";
      break;
  }
  return { systemPrompt, userPrompt };
}

export async function execucaoAgente(demandaId: string, tenantId: string): Promise<DemandaCentral | null> {
  const d = await obter(tenantId, demandaId);
  if (!d) return null;
  if (d.status === "cancelado" || d.status === "concluido") return d;

  await db.update(demandasCentral)
    .set({ status: "em_execucao" })
    .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, demandaId)));

  try {
    const { systemPrompt, userPrompt } = buildPromptDemanda(d);
    const taskType = d.agenteTask || "analise_projeto";
    const orch = await runWithOrchestration(
      taskType, tenantId,
      { sensitivity: "internal" },
      (cb) => callChatLLM(cb, { systemPrompt, userPrompt, maxTokens: 1500 }),
    );

    const resultado = {
      conteudo: String(orch.data || "").trim(),
      provider: orch.providerUsed,
      tokensIn: orch.tokensIn,
      tokensOut: orch.tokensOut,
      taskType,
      executadoEm: new Date().toISOString(),
    };

    const [updated] = await db.update(demandasCentral)
      .set({ status: "revisao", resultadoJson: resultado, resolvidoAt: new Date() })
      .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, demandaId)))
      .returning();
    return updated ?? null;
  } catch (err: any) {
    console.error("[demandas] execucaoAgente falhou:", err?.message);
    const [reverted] = await db.update(demandasCentral)
      .set({
        status: "fila",
        resultadoJson: { erro: String(err?.message || err), at: new Date().toISOString() },
      })
      .where(and(eq(demandasCentral.tenantId, tenantId), eq(demandasCentral.id, demandaId)))
      .returning();
    return reverted ?? null;
  }
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

export interface CentralKpis {
  projetosAtivos: number;
  demandasHoje: number;
  taxaEntregasPrazo: number; // 0..100
  demandasAgente: number;
  tempoMedioResolucaoH: number; // horas
}

export async function getKpis(tenantId: string): Promise<CentralKpis> {
  const hoje = new Date();
  const inicioDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const trinta = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Projetos ativos: scrum_internal_projects vinculados a projects do tenant que tenham sprint 'active'
  const projetosTenant = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.tenantId, tenantId));
  const projetoIds = projetosTenant.map(p => p.id);
  let projetosAtivos = 0;
  if (projetoIds.length > 0) {
    const ips = await db.select({ id: scrumInternalProjects.id })
      .from(scrumInternalProjects)
      .where(inArray(scrumInternalProjects.clientProjectId, projetoIds));
    const ipIds = ips.map(p => p.id);
    if (ipIds.length > 0) {
      const ativos = await db.select({ id: scrumSprints.internalProjectId })
        .from(scrumSprints)
        .where(and(
          inArray(scrumSprints.internalProjectId, ipIds),
          eq(scrumSprints.status, "active"),
        ));
      projetosAtivos = new Set(ativos.map(a => a.id)).size;
    }
  }

  // Demandas hoje
  const dHoje = await db.select({ id: demandasCentral.id }).from(demandasCentral)
    .where(and(eq(demandasCentral.tenantId, tenantId), gte(demandasCentral.createdAt, inicioDia)));
  const demandasHoje = dHoje.length;

  // Demandas para agente em fila/em_execucao
  const dAgente = await db.select({ id: demandasCentral.id }).from(demandasCentral)
    .where(and(
      eq(demandasCentral.tenantId, tenantId),
      eq(demandasCentral.assigneeType, "agent"),
      inArray(demandasCentral.status, ["fila", "em_analise", "em_execucao"]),
    ));
  const demandasAgente = dAgente.length;

  // Taxa entrega no prazo: sprints completed nos últimos 30d com endDate >= updatedAt-ish
  let taxaEntregasPrazo = 0;
  if (projetoIds.length > 0) {
    const ips = await db.select({ id: scrumInternalProjects.id })
      .from(scrumInternalProjects)
      .where(inArray(scrumInternalProjects.clientProjectId, projetoIds));
    const ipIds = ips.map(p => p.id);
    if (ipIds.length > 0) {
      const concluidos = await db.select({
        id: scrumSprints.id, endDate: scrumSprints.endDate, updatedAt: scrumSprints.updatedAt,
      }).from(scrumSprints).where(and(
        inArray(scrumSprints.internalProjectId, ipIds),
        eq(scrumSprints.status, "completed"),
        gte(scrumSprints.updatedAt, trinta),
      ));
      if (concluidos.length > 0) {
        const noPrazo = concluidos.filter(s =>
          s.endDate && s.updatedAt && new Date(s.updatedAt).getTime() <= new Date(s.endDate).getTime(),
        ).length;
        taxaEntregasPrazo = Math.round((noPrazo / concluidos.length) * 100);
      }
    }
  }

  // Tempo médio resolução: AVG(resolvidoAt - createdAt) WHERE concluido últimos 30d
  const concl = await db.select({
    createdAt: demandasCentral.createdAt, resolvidoAt: demandasCentral.resolvidoAt,
  }).from(demandasCentral).where(and(
    eq(demandasCentral.tenantId, tenantId),
    eq(demandasCentral.status, "concluido"),
    gte(demandasCentral.resolvidoAt, trinta),
  ));
  let tempoMedioResolucaoH = 0;
  if (concl.length > 0) {
    const totalMs = concl.reduce((acc, c) => {
      if (!c.createdAt || !c.resolvidoAt) return acc;
      return acc + (new Date(c.resolvidoAt).getTime() - new Date(c.createdAt).getTime());
    }, 0);
    tempoMedioResolucaoH = Math.round((totalMs / concl.length / 1000 / 3600) * 10) / 10;
  }

  return { projetosAtivos, demandasHoje, taxaEntregasPrazo, demandasAgente, tempoMedioResolucaoH };
}

// ─── Linha do Tempo (Gantt simplificado) ─────────────────────────────────────

export interface ProjetoTimeline {
  id: string;
  nome: string;
  sprints: { id: string; nome: string; startDate: string | null; endDate: string | null; status: string }[];
}

export async function getTimeline(tenantId: string): Promise<ProjetoTimeline[]> {
  const projetosTenant = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.tenantId, tenantId));
  const projetoIds = projetosTenant.map(p => p.id);
  if (projetoIds.length === 0) return [];

  const ips = await db.select().from(scrumInternalProjects)
    .where(inArray(scrumInternalProjects.clientProjectId, projetoIds));
  if (ips.length === 0) return [];

  const ipIds = ips.map(p => p.id);
  const sprints = await db.select().from(scrumSprints)
    .where(inArray(scrumSprints.internalProjectId, ipIds))
    .orderBy(asc(scrumSprints.startDate));

  return ips.map(ip => ({
    id: ip.id,
    nome: ip.name,
    sprints: sprints
      .filter(s => s.internalProjectId === ip.id)
      .map(s => ({
        id: s.id,
        nome: s.name,
        startDate: s.startDate ? new Date(s.startDate).toISOString() : null,
        endDate: s.endDate ? new Date(s.endDate).toISOString() : null,
        status: s.status,
      })),
  })).filter(p => p.sprints.length > 0);
}
