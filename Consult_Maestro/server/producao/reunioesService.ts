// PROD-2 — Service de Reuniões de projeto
// CRUD + geração de pauta via Agente + listagem de ações pendentes.

import { db } from "../db";
import {
  reunioesProjeto, acoesReuniao, scrumInternalProjects,
  scrumSprints, scrumBacklogItems, projects,
  type ReuniaoProjeto, type InsertReuniaoProjeto,
  type AcaoReuniao, type InsertAcaoReuniao,
} from "@shared/schema";
import { and, eq, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { runWithOrchestration } from "../mcp/llmOrchestrator";
import { callChatLLM } from "../mcp/llmClient";

export interface PautaItem {
  titulo: string;
  descricao?: string;
  ordem?: number;
  tempoMin?: number;
}

async function assertReuniaoTenant(reuniaoId: string, tenantId: string): Promise<ReuniaoProjeto> {
  const [r] = await db.select().from(reunioesProjeto)
    .where(and(eq(reunioesProjeto.id, reuniaoId), eq(reunioesProjeto.tenantId, tenantId))).limit(1);
  if (!r) throw new Error("Reunião não encontrada");
  return r;
}

export async function listarReunioes(
  tenantId: string, projetoId: string,
): Promise<Array<ReuniaoProjeto & { numAcoes: number }>> {
  const rows = await db.select().from(reunioesProjeto)
    .where(and(eq(reunioesProjeto.tenantId, tenantId), eq(reunioesProjeto.projetoId, projetoId)))
    .orderBy(desc(reunioesProjeto.data));
  if (rows.length === 0) return [];
  const counts = await db.select({
    reuniaoId: acoesReuniao.reuniaoId,
    n: sql<number>`count(*)::int`,
  }).from(acoesReuniao)
    .where(and(eq(acoesReuniao.tenantId, tenantId), inArray(acoesReuniao.reuniaoId, rows.map(r => r.id))))
    .groupBy(acoesReuniao.reuniaoId);
  const map = new Map(counts.map(c => [c.reuniaoId, c.n]));
  return rows.map(r => ({ ...r, numAcoes: map.get(r.id) ?? 0 }));
}

export async function obterReuniao(
  tenantId: string, reuniaoId: string,
): Promise<{ reuniao: ReuniaoProjeto; acoes: AcaoReuniao[] }> {
  const reuniao = await assertReuniaoTenant(reuniaoId, tenantId);
  const acoes = await db.select().from(acoesReuniao)
    .where(eq(acoesReuniao.reuniaoId, reuniaoId))
    .orderBy(desc(acoesReuniao.createdAt));
  return { reuniao, acoes };
}

export async function criarReuniao(
  tenantId: string, projetoId: string, data: Partial<InsertReuniaoProjeto>,
): Promise<ReuniaoProjeto> {
  // Valida projeto pertence ao tenant via clientProjectId (mesma estratégia do importador)
  const [iproj] = await db.select().from(scrumInternalProjects)
    .where(eq(scrumInternalProjects.id, projetoId)).limit(1);
  if (!iproj) throw new Error("Projeto interno não encontrado");
  if (iproj.clientProjectId) {
    const [cp] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, iproj.clientProjectId), eq(projects.tenantId, tenantId))).limit(1);
    if (!cp) throw new Error("Sem acesso a este projeto");
  }
  // Próximo número
  const [{ max }] = await db.select({ max: sql<number>`COALESCE(MAX(numero), 0)::int` })
    .from(reunioesProjeto)
    .where(and(eq(reunioesProjeto.tenantId, tenantId), eq(reunioesProjeto.projetoId, projetoId)));
  const numero = (max ?? 0) + 1;

  const [created] = await db.insert(reunioesProjeto).values({
    tenantId,
    projetoId,
    numero,
    data: data.data ? new Date(data.data as any) : new Date(),
    tipo: data.tipo || "acompanhamento",
    sprint: data.sprint || null,
    pautaJson: (data.pautaJson as any) || [],
    participantes: (data.participantes as any) || [],
    anotacoes: data.anotacoes || null,
    status: data.status || "agendada",
  } as any).returning();
  return created;
}

export async function atualizarReuniao(
  tenantId: string, reuniaoId: string, data: Partial<InsertReuniaoProjeto>,
): Promise<ReuniaoProjeto> {
  await assertReuniaoTenant(reuniaoId, tenantId);
  const patch: any = { updatedAt: new Date() };
  if (data.data !== undefined) patch.data = new Date(data.data as any);
  if (data.tipo !== undefined) patch.tipo = data.tipo;
  if (data.sprint !== undefined) patch.sprint = data.sprint;
  if (data.pautaJson !== undefined) patch.pautaJson = data.pautaJson;
  if (data.anotacoes !== undefined) patch.anotacoes = data.anotacoes;
  if (data.participantes !== undefined) patch.participantes = data.participantes;
  if (data.status !== undefined) patch.status = data.status;
  const [updated] = await db.update(reunioesProjeto)
    .set(patch)
    .where(and(eq(reunioesProjeto.id, reuniaoId), eq(reunioesProjeto.tenantId, tenantId)))
    .returning();
  return updated;
}

export async function adicionarAcao(
  tenantId: string, reuniaoId: string, payload: Partial<InsertAcaoReuniao>,
): Promise<AcaoReuniao> {
  await assertReuniaoTenant(reuniaoId, tenantId);
  if (!payload.descricao) throw new Error("descricao é obrigatória");
  const [created] = await db.insert(acoesReuniao).values({
    tenantId,
    reuniaoId,
    descricao: payload.descricao!,
    responsavel: payload.responsavel || null,
    prazo: payload.prazo ? new Date(payload.prazo as any) : null,
    status: payload.status || "pendente",
  } as any).returning();
  return created;
}

export async function atualizarAcao(
  tenantId: string, acaoId: string, payload: Partial<InsertAcaoReuniao>,
): Promise<AcaoReuniao> {
  const patch: any = { updatedAt: new Date() };
  if (payload.descricao !== undefined) patch.descricao = payload.descricao;
  if (payload.responsavel !== undefined) patch.responsavel = payload.responsavel;
  if (payload.prazo !== undefined) patch.prazo = payload.prazo ? new Date(payload.prazo as any) : null;
  if (payload.status !== undefined) patch.status = payload.status;
  const [updated] = await db.update(acoesReuniao)
    .set(patch)
    .where(and(eq(acoesReuniao.id, acaoId), eq(acoesReuniao.tenantId, tenantId)))
    .returning();
  if (!updated) throw new Error("Ação não encontrada");
  return updated;
}

export async function listarAcoesPendentes(
  tenantId: string, projetoId: string,
): Promise<Array<AcaoReuniao & { reuniaoNumero: number; reuniaoData: Date }>> {
  // Ações das últimas 3 reuniões com status='pendente'
  const ultimas = await db.select({ id: reunioesProjeto.id, numero: reunioesProjeto.numero, data: reunioesProjeto.data })
    .from(reunioesProjeto)
    .where(and(eq(reunioesProjeto.tenantId, tenantId), eq(reunioesProjeto.projetoId, projetoId)))
    .orderBy(desc(reunioesProjeto.data))
    .limit(3);
  if (ultimas.length === 0) return [];
  const ids = ultimas.map(u => u.id);
  const acoes = await db.select().from(acoesReuniao)
    .where(and(
      eq(acoesReuniao.tenantId, tenantId),
      inArray(acoesReuniao.reuniaoId, ids),
      eq(acoesReuniao.status, "pendente"),
    ));
  const map = new Map(ultimas.map(u => [u.id, u]));
  return acoes.map(a => {
    const r = map.get(a.reuniaoId)!;
    return { ...a, reuniaoNumero: r.numero ?? 0, reuniaoData: r.data };
  });
}

/**
 * Gera a pauta de uma reunião com base no contexto do projeto:
 *   - sprint atual (status active) e suas tarefas pendentes/concluídas
 *   - última reunião realizada (anotações)
 *   - ações pendentes
 *
 * Usa runWithOrchestration para gerar uma pauta estruturada em JSON.
 * Em caso de falha do LLM, devolve uma pauta padrão derivada das tarefas.
 */
export async function gerarPauta(
  tenantId: string, reuniaoId: string,
): Promise<{ itens: PautaItem[]; gerado: "agente" | "fallback" }> {
  const reuniao = await assertReuniaoTenant(reuniaoId, tenantId);

  const [iproj] = await db.select().from(scrumInternalProjects)
    .where(eq(scrumInternalProjects.id, reuniao.projetoId)).limit(1);

  // Sprint atual (active) ou última se não houver
  const [sprintAtivo] = await db.select().from(scrumSprints)
    .where(and(
      eq(scrumSprints.internalProjectId, reuniao.projetoId),
      eq(scrumSprints.status, "active"),
    )).limit(1);
  const [sprintRef] = sprintAtivo
    ? [sprintAtivo]
    : await db.select().from(scrumSprints)
        .where(eq(scrumSprints.internalProjectId, reuniao.projetoId))
        .orderBy(desc(scrumSprints.startDate)).limit(1);

  const tarefasPend = sprintRef
    ? await db.select().from(scrumBacklogItems)
        .where(and(
          eq(scrumBacklogItems.sprintId, sprintRef.id),
          inArray(scrumBacklogItems.status, ["backlog", "em_execucao"]),
        ))
    : [];
  const tarefasConcl = sprintRef
    ? await db.select().from(scrumBacklogItems)
        .where(and(
          eq(scrumBacklogItems.sprintId, sprintRef.id),
          eq(scrumBacklogItems.status, "concluido"),
        ))
    : [];

  const acoesPend = await listarAcoesPendentes(tenantId, reuniao.projetoId);

  // Última reunião realizada anterior a esta
  const [ultima] = await db.select().from(reunioesProjeto)
    .where(and(
      eq(reunioesProjeto.tenantId, tenantId),
      eq(reunioesProjeto.projetoId, reuniao.projetoId),
      eq(reunioesProjeto.status, "realizada"),
    ))
    .orderBy(desc(reunioesProjeto.data)).limit(1);

  const contexto = {
    projeto: iproj?.name,
    reuniao: { numero: reuniao.numero, data: reuniao.data, tipo: reuniao.tipo },
    sprint: sprintRef ? { nome: sprintRef.name, goal: sprintRef.goal } : null,
    tarefasPendentes: tarefasPend.slice(0, 20).map(t => ({ titulo: t.title, status: t.status })),
    tarefasConcluidas: tarefasConcl.slice(0, 10).map(t => ({ titulo: t.title })),
    acoesPendentes: acoesPend.slice(0, 10).map(a => ({ descricao: a.descricao, responsavel: a.responsavel })),
    ultimaReuniao: ultima ? {
      numero: ultima.numero, data: ultima.data,
      anotacoes: (ultima.anotacoes || "").slice(0, 600),
    } : null,
  };

  const systemPrompt = `Você é o Agente Scrum da ARCadia Consulting. Gere a PAUTA de uma reunião de projeto em JSON.

Saída deve ser um array JSON puro (sem markdown, sem comentários) com 4 a 8 itens, cada item no formato:
  { "titulo": "...", "descricao": "...", "tempoMin": <inteiro 5..30> }

Sequência típica esperada:
  1. Abertura e revisão de pendências da última reunião
  2. Status do sprint atual (concluído + em andamento)
  3. Bloqueios e riscos
  4. Decisões e próximos passos
  5. Encerramento`;
  const userPrompt = `Contexto do projeto:\n${JSON.stringify(contexto, null, 2)}\n\nGere a pauta agora.`;

  let itens: PautaItem[] | null = null;
  try {
    const orch = await runWithOrchestration(
      "gerar_pauta_reuniao",
      tenantId,
      { sensitivity: "internal" },
      (cb) => callChatLLM(cb, { systemPrompt, userPrompt, maxTokens: 1500 }),
    );
    const text: string = String(orch.data || "").trim();
    // Tenta extrair JSON do texto
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        itens = parsed.slice(0, 12).map((it: any, i: number) => ({
          titulo: String(it.titulo || it.title || `Item ${i + 1}`).slice(0, 200),
          descricao: it.descricao ? String(it.descricao).slice(0, 600) : undefined,
          ordem: i + 1,
          tempoMin: typeof it.tempoMin === "number" ? Math.min(60, Math.max(5, it.tempoMin)) : 10,
        }));
      }
    }
  } catch (err) {
    console.warn("[reunioes] gerarPauta agente falhou:", (err as any)?.message);
  }

  let origem: "agente" | "fallback" = "agente";
  if (!itens || itens.length === 0) {
    origem = "fallback";
    itens = [
      { titulo: "Abertura e revisão da última reunião", ordem: 1, tempoMin: 10 },
      ...(acoesPend.length > 0 ? [{ titulo: `Pendências (${acoesPend.length} ações abertas)`, ordem: 2, tempoMin: 15 }] : []),
      ...(sprintRef ? [{ titulo: `Status do sprint: ${sprintRef.name}`, descricao: `${tarefasConcl.length} concluídas / ${tarefasPend.length} em aberto`, ordem: 3, tempoMin: 20 }] : []),
      { titulo: "Bloqueios e riscos", ordem: 4, tempoMin: 10 },
      { titulo: "Próximos passos e novas ações", ordem: 5, tempoMin: 10 },
      { titulo: "Encerramento", ordem: 6, tempoMin: 5 },
    ].map((it, i) => ({ ...it, ordem: i + 1 }));
  }

  await db.update(reunioesProjeto)
    .set({ pautaJson: itens as any, updatedAt: new Date() })
    .where(eq(reunioesProjeto.id, reuniaoId));

  return { itens, gerado: origem };
}
