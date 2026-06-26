import type { Express, Response } from "express";
import { db } from "../../db";
import {
  pipelineConfigs,
  processosSocietarios,
  processoTarefas,
  users,
} from "@shared/schema";
import { isAuthenticated } from "../../portableAuth";
import { requireTenant } from "../../tenantContext";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

/**
 * Opções aceitas pelo dashboard / agente.
 *  - `tipo`         filtro por tipoProcesso
 *  - `analista`     filtro por analista responsável (ID ou "__me__")
 *  - `status`       filtro por status do processo (ativo|concluido|pausado|cancelado).
 *                   Quando informado restringe a base de processos antes da agregação,
 *                   sendo útil para perguntas do agente como "quantos processos
 *                   concluídos temos?".
 *  - `viewerId`     usado para resolver "__me__" e calcular `meusProcessos`
 *  - `incluirGargalos` (default true) — quando false, pula a query de
 *    movimentações (a tool "agente proativo" não precisa do top-10 e isso
 *    economiza uma round-trip extra).
 */
export interface PipelineDashboardOpts {
  tipo?: string;
  analista?: string;
  status?: string;
  viewerId?: string;
  incluirGargalos?: boolean;
}

/**
 * Núcleo de agregação do dashboard de pipeline societário. Extraído da rota
 * para permitir reuso pela tool de agente `analisar_pipeline_societario`
 * sem reimplementar lógica de negócio.
 */
export async function computePipelineDashboard(
  tenantId: string,
  opts: PipelineDashboardOpts = {},
) {
  const { tipo: tipoFiltro, status: statusFiltro, viewerId, incluirGargalos = true } = opts;
  const analistaFiltro = opts.analista === "__me__" ? viewerId : opts.analista;

  const baseConds = [eq(processosSocietarios.tenantId, tenantId)];
  if (tipoFiltro) baseConds.push(eq(processosSocietarios.tipoProcesso, tipoFiltro));
  if (analistaFiltro) baseConds.push(eq(processosSocietarios.analistaResponsavelId, analistaFiltro));
  if (statusFiltro) baseConds.push(eq(processosSocietarios.status, statusFiltro));

  const procs = await db
    .select()
    .from(processosSocietarios)
    .where(and(...baseConds));

  const ativos = procs.filter((p) => p.status === "ativo");
  const concluidos = procs.filter((p) => p.status === "concluido");
  const pausados = procs.filter((p) => p.status === "pausado");
  const cancelados = procs.filter((p) => p.status === "cancelado");

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const toDate = (v: unknown): Date | null => {
    if (v == null) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const vencidos = ativos.filter((p) => {
    const d = toDate(p.dataPrevistaConclusao);
    return d != null && d < hoje;
  });
  const proximoVencimento = ativos.filter((p) => {
    const d = toDate(p.dataPrevistaConclusao);
    if (!d) return false;
    const diff = (d.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });

  const porColuna: Record<string, number> = {};
  for (const p of ativos) {
    porColuna[p.colunaAtual] = (porColuna[p.colunaAtual] ?? 0) + 1;
  }

  const porAnalistaMap = new Map<string, number>();
  for (const p of ativos) {
    const k = p.analistaResponsavelId ?? "__sem_analista__";
    porAnalistaMap.set(k, (porAnalistaMap.get(k) ?? 0) + 1);
  }
  const analistaIds = Array.from(porAnalistaMap.keys()).filter((k) => k !== "__sem_analista__");
  const analistasInfo: Record<string, { nome: string; email: string | null }> = {};
  if (analistaIds.length > 0) {
    const rows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(inArray(users.id, analistaIds));
    for (const u of rows) {
      const nome = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id;
      analistasInfo[u.id] = { nome, email: u.email ?? null };
    }
  }
  const porAnalista = Array.from(porAnalistaMap.entries()).map(([id, total]) => ({
    analistaId: id === "__sem_analista__" ? null : id,
    nome: id === "__sem_analista__" ? "Sem analista" : analistasInfo[id]?.nome ?? id,
    total,
  }));
  porAnalista.sort((a, b) => b.total - a.total);

  const porTipoMap = new Map<string, number>();
  for (const p of ativos) {
    porTipoMap.set(p.tipoProcesso, (porTipoMap.get(p.tipoProcesso) ?? 0) + 1);
  }
  const porTipo = Array.from(porTipoMap.entries()).map(([tipo, total]) => ({ tipo, total }));

  // Tempo médio na coluna atual (em dias) — usa última movimentação para estimar entrada na coluna.
  // Para processos sem movimentação, usa createdAt.
  const procIds = ativos.map((p) => p.id);
  const tempoMedioPorColuna: Record<string, { dias: number; n: number }> = {};
  const gargalos: Array<{ processoId: string; processNumber: string; titulo: string; coluna: string; dias: number }> = [];
  if (incluirGargalos && procIds.length > 0) {
    const lastMovs = await db.execute<{
      processo_id: string;
      coluna_para: string;
      created_at: string;
    }>(sql`
      SELECT DISTINCT ON (processo_id) processo_id, coluna_para, created_at
      FROM processo_movimentacoes
      WHERE tenant_id = ${tenantId} AND processo_id IN (${sql.join(procIds.map((p) => sql`${p}`), sql`, `)})
      ORDER BY processo_id, created_at DESC
    `);
    const lastByProc = new Map<string, { col: string; at: Date }>();
    const rows = (lastMovs as any).rows ?? lastMovs;
    for (const r of rows as any[]) {
      lastByProc.set(r.processo_id, { col: r.coluna_para, at: new Date(r.created_at) });
    }
    for (const p of ativos) {
      const entry = lastByProc.get(p.id);
      const inicio = entry?.at ?? toDate(p.createdAt) ?? new Date();
      const dias = Math.max(0, (hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
      const acc = (tempoMedioPorColuna[p.colunaAtual] ??= { dias: 0, n: 0 });
      acc.dias += dias;
      acc.n += 1;
      if (dias >= 14) {
        gargalos.push({
          processoId: p.id,
          processNumber: p.processNumber,
          titulo: p.titulo,
          coluna: p.colunaAtual,
          dias: Math.round(dias),
        });
      }
    }
  }
  const tempoMedio = Object.entries(tempoMedioPorColuna).map(([coluna, v]) => ({
    coluna,
    mediaDias: v.n > 0 ? Math.round((v.dias / v.n) * 10) / 10 : 0,
    n: v.n,
  }));
  gargalos.sort((a, b) => b.dias - a.dias);

  // Tarefas por executor (apenas pendentes aplicáveis)
  const tarefasPorExecutor = await db
    .select({
      executor: processoTarefas.executorType,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(processoTarefas)
    .innerJoin(processosSocietarios, eq(processosSocietarios.id, processoTarefas.processoId))
    .where(
      and(
        eq(processoTarefas.tenantId, tenantId),
        eq(processosSocietarios.tenantId, tenantId), // defense-in-depth
        sql`${processoTarefas.status} != 'concluido'`,
        sql`(${processoTarefas.aplicavel} IS NULL OR ${processoTarefas.aplicavel} = true)`,
        ...(tipoFiltro ? [eq(processosSocietarios.tipoProcesso, tipoFiltro)] : []),
        ...(analistaFiltro ? [eq(processosSocietarios.analistaResponsavelId, analistaFiltro)] : []),
      ),
    )
    .groupBy(processoTarefas.executorType);

  // Lista de tipos disponíveis (para filtro do front)
  const tiposDisp = await db
    .select({ tipoProcesso: pipelineConfigs.tipoProcesso, nome: pipelineConfigs.nome })
    .from(pipelineConfigs)
    .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.isActive, true)))
    .orderBy(asc(pipelineConfigs.nome));

  // Lista de analistas com processos no tenant (para filtro do front)
  const analistasDisp = porAnalista
    .filter((a) => a.analistaId)
    .map((a) => ({ id: a.analistaId as string, nome: a.nome }));

  // KPI Agente: processos com modoOperacao != 'manual' e tarefas executadas pelo agente
  const agenteAtivoProcs = ativos.filter(
    (p) => (p.modoOperacao ?? "manual") !== "manual",
  );
  const tarefasAgenteRow = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(processoTarefas)
    .innerJoin(processosSocietarios, eq(processosSocietarios.id, processoTarefas.processoId))
    .where(
      and(
        eq(processoTarefas.tenantId, tenantId),
        eq(processosSocietarios.tenantId, tenantId), // defense-in-depth
        sql`${processoTarefas.lastAutoExecutionAt} IS NOT NULL`,
        ...(tipoFiltro ? [eq(processosSocietarios.tipoProcesso, tipoFiltro)] : []),
        ...(analistaFiltro
          ? [eq(processosSocietarios.analistaResponsavelId, analistaFiltro)]
          : []),
      ),
    );
  const agente = {
    processosAutomaticos: agenteAtivoProcs.length,
    tarefasExecutadasAgente: Number(tarefasAgenteRow[0]?.n ?? 0),
  };

  // Meus processos (perspectiva do usuário logado como analista responsável)
  let meusProcessos: { ativos: number; vencidos: number; proximoVencimento: number } | null = null;
  if (viewerId) {
    const meus = ativos.filter((p) => p.analistaResponsavelId === viewerId);
    const meusVenc = meus.filter((p) => {
      const d = toDate(p.dataPrevistaConclusao);
      return d != null && d < hoje;
    });
    const meusProx = meus.filter((p) => {
      const d = toDate(p.dataPrevistaConclusao);
      if (!d) return false;
      const diff = (d.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 7;
    });
    meusProcessos = {
      ativos: meus.length,
      vencidos: meusVenc.length,
      proximoVencimento: meusProx.length,
    };
  }

  return {
    totais: {
      total: procs.length,
      ativos: ativos.length,
      concluidos: concluidos.length,
      pausados: pausados.length,
      cancelados: cancelados.length,
      vencidos: vencidos.length,
      proximoVencimento: proximoVencimento.length,
    },
    porColuna,
    porAnalista,
    porTipo,
    tempoMedio,
    gargalos: gargalos.slice(0, 10),
    tarefasPorExecutor: tarefasPorExecutor.map((r) => ({ executor: r.executor, total: Number(r.n) })),
    tiposDisponiveis: tiposDisp,
    analistasDisponiveis: analistasDisp,
    agente,
    meusProcessos,
    viewerId: viewerId ?? null,
  };
}

export function registerPipelineDashboardRoutes(app: Express) {
  // GET /api/societario/pipeline/dashboard
  app.get(
    "/api/societario/pipeline/dashboard",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const viewerId: string | undefined =
          req?.user?.claims?.sub || req?.user?.id || undefined;
        const tipoFiltro = typeof req.query.tipo === "string" ? req.query.tipo : undefined;
        const analistaFiltro =
          typeof req.query.analista === "string" ? req.query.analista : undefined;
        const statusFiltro =
          typeof req.query.status === "string" ? req.query.status : undefined;
        const data = await computePipelineDashboard(tenantId, {
          tipo: tipoFiltro,
          analista: analistaFiltro,
          status: statusFiltro,
          viewerId,
        });
        res.json(data);
      } catch (e: any) {
        console.error("[societario/pipeline] dashboard:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );
}
