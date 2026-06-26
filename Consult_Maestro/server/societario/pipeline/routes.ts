/**
 * Pipeline Societário — Sprint 1 (rotas backend)
 *
 * Endpoints REST para o Kanban manual + checklist de processos societários.
 * Princípio dual-mode: tudo aqui é manual; agente é camada aditiva (Sprint 2+).
 *
 *   GET    /api/societario/pipeline/configs           → lista (lazy-seed 2 templates)
 *   GET    /api/societario/pipeline/processos         → lista p/ Kanban (filtros)
 *   GET    /api/societario/pipeline/processos/:id     → detalhe (+ tarefas + movs)
 *   POST   /api/societario/pipeline/processos         → cria + materializa checklist
 *   PATCH  /api/societario/pipeline/processos/:id     → atualiza campos editáveis
 *   PATCH  /api/societario/pipeline/processos/:id/coluna → move coluna (com guard)
 *   POST   /api/societario/pipeline/processos/:id/tarefas/:tid/concluir → manual
 *   POST   /api/societario/pipeline/processos/:id/tarefas/:tid/reabrir  → manual
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../../db";
import {
  pipelineConfigs,
  pipelineChecklistItems,
  processosSocietarios,
  processoTarefas,
  processoMovimentacoes,
  sociedades,
  users,
  insertProcessoSocietarioSchema,
} from "@shared/schema";
import { isAuthenticated } from "../../portableAuth";
import { requireTenant } from "../../tenantContext";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ObjectStorageService } from "../../objectStorage";
import { dispatchSkill, skillForTarefaKey, SKILLS, type SkillKey } from "./skills";
import { registerPipelineConfigsCrudRoutes } from "./configsRoutes";
import { registerPipelineDashboardRoutes } from "./dashboard";
import { renderProcessoRelatorioPdf, renderPipelineRelatorioConsolidadoPdf } from "./relatorioPdf";
import { pessoas as pessoasTable, pessoaPapeis } from "@shared/schema";

async function validateClientePessoa(tenantId: string, pessoaId: string | null | undefined): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!pessoaId) return { ok: true };
  const [row] = await db
    .select({ id: pessoaPapeis.id })
    .from(pessoaPapeis)
    .innerJoin(pessoasTable, eq(pessoasTable.id, pessoaPapeis.pessoaId))
    .where(and(
      eq(pessoasTable.tenantId, tenantId),
      eq(pessoasTable.id, pessoaId),
      eq(pessoaPapeis.tenantId, tenantId),
      eq(pessoaPapeis.tipoPapel, "cliente"),
      eq(pessoaPapeis.status, "ativo"),
    ))
    .limit(1);
  if (!row) return { ok: false, message: "Pessoa cliente inválida ou não pertence ao seu tenant." };
  return { ok: true };
}

function getUserId(req: any): string | null {
  return req?.user?.claims?.sub || req?.user?.id || null;
}

// ───── Upload token HMAC (escopo: tenant+usuário+processo+tarefa+path, TTL 30min) ─────
const PIPELINE_UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;
function pipelineUploadSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.UPLOAD_INTENT_SECRET;
  if (s && s.length >= 16) return s;
  // Fail-closed em produção: nunca aceitar fallback previsível para assinar HMAC.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Pipeline upload secret missing: configure SESSION_SECRET (>=16 chars) ou UPLOAD_INTENT_SECRET em produção.",
    );
  }
  return "dev-pipeline-secret-do-not-use-in-prod";
}
function createTarefaUploadToken(opts: {
  tenantId: string; userId: string; processoId: string; tarefaId: string; path: string;
}): string {
  const expiry = Date.now() + PIPELINE_UPLOAD_TOKEN_TTL_MS;
  const payload = `${opts.tenantId}|${opts.userId}|${opts.processoId}|${opts.tarefaId}|${opts.path}|${expiry}`;
  const sig = createHmac("sha256", pipelineUploadSecret()).update(payload).digest("base64url");
  return `${expiry}.${sig}`;
}
function verifyTarefaUploadToken(opts: {
  token: string; tenantId: string; userId: string; processoId: string; tarefaId: string; path: string;
}): boolean {
  try {
    const [expiryStr, sig] = String(opts.token).split(".");
    if (!expiryStr || !sig) return false;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
    const payload = `${opts.tenantId}|${opts.userId}|${opts.processoId}|${opts.tarefaId}|${opts.path}|${expiry}`;
    const expected = createHmac("sha256", pipelineUploadSecret()).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

// ─────────────────────────── SEED de pipelines default ───────────────────────────
// Lazy: só roda quando o tenant lista pipelineConfigs e está vazio. Idempotente.
// `autoAdvance` por coluna: ao concluir a última obrigatória aplicável da etapa,
// o processo avança sozinho para a próxima coluna (motor dinâmico).
const COLUNAS_PADRAO = [
  { id: "backlog",                nome: "Backlog",               ordem: 0, cor: "bg-slate-500",   autoAdvance: true  },
  { id: "em_analise",             nome: "Em Análise",            ordem: 1, cor: "bg-blue-500",    autoAdvance: true  },
  { id: "aguardando_documentos",  nome: "Aguardando Documentos", ordem: 2, cor: "bg-amber-500",   autoAdvance: false },
  { id: "em_elaboracao",          nome: "Em Elaboração",         ordem: 3, cor: "bg-violet-500",  autoAdvance: false },
  { id: "em_registro",            nome: "Em Registro",           ordem: 4, cor: "bg-cyan-500",    autoAdvance: false },
  { id: "concluido",              nome: "Concluído",             ordem: 5, cor: "bg-emerald-500", autoAdvance: false },
];

type ChecklistTpl = {
  etapa: string;
  ordem: number;
  titulo: string;
  executorType: "agente" | "analista" | "cliente" | "sistema";
  descricao?: string;
  isRequired?: boolean;
  bloqueiaAvanco?: boolean;
  // Motor dinâmico
  tipo?: "checkbox" | "upload" | "date" | "form" | "approval";
  tarefaKey?: string;
  dependsOnKeys?: string[];
  condicaoJson?: Record<string, any>;
  formSchemaJson?: Array<Record<string, any>>;
};

const CHECKLIST_CONSTITUICAO: ChecklistTpl[] = [
  // backlog
  { etapa: "backlog",               ordem: 0, titulo: "Receber solicitação",            executorType: "analista", tarefaKey: "receber_solicitacao" },
  { etapa: "backlog",               ordem: 1, titulo: "Definir analista responsável",   executorType: "analista", tarefaKey: "definir_analista" },
  // em_analise (autoAdvance — assim que vencer obrigatórias, segue sozinho)
  { etapa: "em_analise",            ordem: 0, titulo: "Verificar dados da empresa",     executorType: "analista", tarefaKey: "verificar_dados",
    dependsOnKeys: ["receber_solicitacao"] },
  { etapa: "em_analise",            ordem: 1, titulo: "Analisar viabilidade societária",executorType: "analista", tarefaKey: "analisar_viabilidade",
    dependsOnKeys: ["verificar_dados"] },
  // aguardando_documentos
  { etapa: "aguardando_documentos", ordem: 0, titulo: "Solicitar documentos ao cliente",executorType: "cliente",  tarefaKey: "solicitar_documentos" },
  { etapa: "aguardando_documentos", ordem: 1, titulo: "Anexar RG dos sócios",           executorType: "analista", tarefaKey: "rg_socios",
    tipo: "upload", descricao: "PDF ou JPG do RG/CNH dos sócios." },
  { etapa: "aguardando_documentos", ordem: 2, titulo: "Anexar comprovante de endereço", executorType: "analista", tarefaKey: "comprovante_endereco",
    tipo: "upload" },
  // CONDICIONAL: só aplicável quando a sociedade é S/A
  { etapa: "aguardando_documentos", ordem: 3, titulo: "Anexar boletim de subscrição",   executorType: "analista", tarefaKey: "boletim_subscricao",
    tipo: "upload", condicaoJson: { field: "sociedade.naturezaJuridica", op: "eq", value: "sa" },
    descricao: "Obrigatório apenas para constituição de S/A." },
  // em_elaboracao
  { etapa: "em_elaboracao",         ordem: 0, titulo: "Elaborar contrato social",       executorType: "analista", tarefaKey: "elaborar_contrato",
    dependsOnKeys: ["solicitar_documentos"] },
  { etapa: "em_elaboracao",         ordem: 1, titulo: "Aprovar minuta",                 executorType: "analista", tarefaKey: "aprovar_minuta",
    tipo: "approval", dependsOnKeys: ["elaborar_contrato"] },
  // em_registro (form com campos do protocolo)
  { etapa: "em_registro",           ordem: 0, titulo: "Protocolar na junta comercial",  executorType: "analista", tarefaKey: "protocolar",
    tipo: "form", dependsOnKeys: ["aprovar_minuta"], formSchemaJson: [
      { name: "orgao",            label: "Órgão de registro",  type: "text", required: true },
      { name: "numero_protocolo", label: "Número do protocolo",type: "text", required: true },
      { name: "data_protocolo",   label: "Data do protocolo",  type: "date", required: true },
    ] },
  { etapa: "em_registro",           ordem: 1, titulo: "Prazo previsto de deferimento",  executorType: "analista", tarefaKey: "prazo_deferimento",
    tipo: "date", isRequired: false, bloqueiaAvanco: false, dependsOnKeys: ["protocolar"] },
  { etapa: "em_registro",           ordem: 2, titulo: "Acompanhar deferimento",         executorType: "analista", tarefaKey: "acompanhar_deferimento",
    isRequired: false, bloqueiaAvanco: false },
  // concluido
  { etapa: "concluido",             ordem: 0, titulo: "Anexar contrato registrado",     executorType: "analista", tarefaKey: "contrato_registrado",
    tipo: "upload" },
  { etapa: "concluido",             ordem: 1, titulo: "Notificar cliente",              executorType: "analista", tarefaKey: "notificar_cliente" },
];

const CHECKLIST_ALTERACAO: ChecklistTpl[] = [
  { etapa: "backlog",               ordem: 0, titulo: "Receber solicitação",            executorType: "analista", tarefaKey: "receber_solicitacao" },
  { etapa: "backlog",               ordem: 1, titulo: "Definir analista responsável",   executorType: "analista", tarefaKey: "definir_analista" },
  { etapa: "em_analise",            ordem: 0, titulo: "Identificar tipo de alteração",  executorType: "analista", tarefaKey: "identificar_tipo",
    dependsOnKeys: ["receber_solicitacao"] },
  { etapa: "em_analise",            ordem: 1, titulo: "Verificar dados da empresa",     executorType: "analista", tarefaKey: "verificar_dados" },
  { etapa: "aguardando_documentos", ordem: 0, titulo: "Solicitar documentos ao cliente",executorType: "cliente",  tarefaKey: "solicitar_documentos" },
  { etapa: "aguardando_documentos", ordem: 1, titulo: "Anexar documentos recebidos",    executorType: "analista", tarefaKey: "anexar_documentos",
    tipo: "upload" },
  { etapa: "em_elaboracao",         ordem: 0, titulo: "Elaborar minuta de alteração",   executorType: "analista", tarefaKey: "elaborar_minuta",
    dependsOnKeys: ["anexar_documentos"] },
  { etapa: "em_elaboracao",         ordem: 1, titulo: "Aprovar minuta",                 executorType: "analista", tarefaKey: "aprovar_minuta",
    tipo: "approval", dependsOnKeys: ["elaborar_minuta"] },
  { etapa: "em_registro",           ordem: 0, titulo: "Protocolar alteração",           executorType: "analista", tarefaKey: "protocolar",
    tipo: "form", dependsOnKeys: ["aprovar_minuta"], formSchemaJson: [
      { name: "orgao",            label: "Órgão de registro",  type: "text", required: true },
      { name: "numero_protocolo", label: "Número do protocolo",type: "text", required: true },
      { name: "data_protocolo",   label: "Data do protocolo",  type: "date", required: true },
    ] },
  { etapa: "em_registro",           ordem: 1, titulo: "Acompanhar deferimento",         executorType: "analista", tarefaKey: "acompanhar_deferimento",
    isRequired: false, bloqueiaAvanco: false },
  { etapa: "concluido",             ordem: 0, titulo: "Anexar alteração registrada",    executorType: "analista", tarefaKey: "alteracao_registrada",
    tipo: "upload" },
  { etapa: "concluido",             ordem: 1, titulo: "Atualizar cadastro da sociedade",executorType: "analista", tarefaKey: "atualizar_cadastro" },
];

async function ensureDefaultConfigs(tenantId: string, userId: string | null): Promise<void> {
  // Idempotente sob concorrência: depende do índice único parcial
  // uq_pipeline_configs_default (tenant_id, tipo_processo) WHERE is_default=true
  // criado em runStartupMigrations. onConflictDoNothing absorve race entre tabs/usuários.
  const seeds = [
    { nome: "Constituição",         tipoProcesso: "constituicao",         checklist: CHECKLIST_CONSTITUICAO },
    { nome: "Alteração Contratual", tipoProcesso: "alteracao_contratual", checklist: CHECKLIST_ALTERACAO   },
  ];
  await db.transaction(async (tx) => {
    for (const s of seeds) {
      // Tenta inserir; se já existe (race), pega o existente.
      const inserted = await tx.insert(pipelineConfigs).values({
        tenantId,
        nome: s.nome,
        tipoProcesso: s.tipoProcesso,
        colunas: COLUNAS_PADRAO,
        regrasTransicao: {},
        isDefault: true,
        isActive: true,
        createdBy: userId,
      }).onConflictDoNothing().returning({ id: pipelineConfigs.id });

      // Helper local para inserir items do template
      const insertItems = async (cfgId: string) => {
        if (s.checklist.length === 0) return;
        await tx.insert(pipelineChecklistItems).values(
          s.checklist.map((c) => ({
            tenantId,
            pipelineConfigId: cfgId,
            etapa: c.etapa,
            ordem: c.ordem,
            titulo: c.titulo,
            descricao: c.descricao ?? null,
            executorType: c.executorType,
            isRequired: c.isRequired ?? true,
            bloqueiaAvanco: c.bloqueiaAvanco ?? true,
            tipo: c.tipo ?? "checkbox",
            tarefaKey: c.tarefaKey ?? null,
            dependsOnKeys: c.dependsOnKeys ?? null,
            condicaoJson: c.condicaoJson ?? null,
            formSchemaJson: c.formSchemaJson ?? null,
          })),
        );
      };

      if (inserted.length > 0) {
        await insertItems(inserted[0].id);
      } else {
        // Config default já existia → backfill se template está desatualizado.
        // Detecta seed antigo (sem tarefaKey) ou count divergente e re-popula.
        // FK em processoTarefas.checklistItemId é ON DELETE SET NULL: processos
        // existentes mantêm seu snapshot intacto; só perdem o ponteiro de origem.
        const [existing] = await tx.select({ id: pipelineConfigs.id, colunas: pipelineConfigs.colunas })
          .from(pipelineConfigs)
          .where(and(
            eq(pipelineConfigs.tenantId, tenantId),
            eq(pipelineConfigs.tipoProcesso, s.tipoProcesso),
            eq(pipelineConfigs.isDefault, true),
          ))
          .limit(1);
        if (existing) {
          const existingItems = await tx.select({
            id: pipelineChecklistItems.id,
            tarefaKey: pipelineChecklistItems.tarefaKey,
          })
            .from(pipelineChecklistItems)
            .where(eq(pipelineChecklistItems.pipelineConfigId, existing.id));
          const itemsStale = existingItems.length !== s.checklist.length
            || existingItems.some((i) => !i.tarefaKey);
          // Detecta colunas desatualizadas (sem flag autoAdvance no novo padrão)
          const cols: any[] = Array.isArray(existing.colunas) ? (existing.colunas as any[]) : [];
          const colunasStale = cols.length === 0 || !cols.some((c) => typeof c?.autoAdvance === "boolean");
          if (itemsStale) {
            await tx.delete(pipelineChecklistItems)
              .where(eq(pipelineChecklistItems.pipelineConfigId, existing.id));
            await insertItems(existing.id);
          }
          if (colunasStale) {
            // Nota: pipelineConfigs não tem coluna updatedAt no schema — só atualizamos `colunas`.
            await tx.update(pipelineConfigs)
              .set({ colunas: COLUNAS_PADRAO })
              .where(eq(pipelineConfigs.id, existing.id));
          }
        }
      }
    }
  });
}

// ─────────────────────────── helpers ───────────────────────────
async function generateProcessNumber(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SOC-${year}-`;
  // Usa right(...,4) para extrair o sufixo numérico (zero-padded em 4 dígitos).
  // Evita o pitfall do SUBSTRING(text FROM $1) que o driver pg interpreta como regex
  // quando o parâmetro chega como TEXT, retornando null.
  const result: any = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(right(process_number, 4) AS INTEGER)), 0) AS max_seq
    FROM processos_societarios
    WHERE tenant_id = ${tenantId}
      AND process_number LIKE ${prefix + "%"}
  `);
  const row = (result.rows ?? result)[0];
  const seq = Number(row?.max_seq ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// (materializeChecklist foi inlinada na transação de POST /processos para garantir atomicidade.)

// ─────────────────────────── motor dinâmico ───────────────────────────
/**
 * Avalia condição opcional contra a sociedade. Retorna true se aplicável.
 * Suporta: { field: 'sociedade.<campo>', op: 'eq'|'neq'|'in'|'notIn', value: any }.
 * Ausência de condição = sempre aplicável.
 */
function avaliarCondicao(cond: any, sociedade: Record<string, any> | null): boolean {
  if (!cond || typeof cond !== "object") return true;
  const field = String(cond.field || "");
  if (!field.startsWith("sociedade.")) return true; // só suporta sociedade.* hoje
  const key = field.slice("sociedade.".length);
  const lhs = sociedade?.[key];
  const op = String(cond.op || "eq");
  const rhs = cond.value;
  switch (op) {
    case "eq":     return String(lhs ?? "") === String(rhs ?? "");
    case "neq":    return String(lhs ?? "") !== String(rhs ?? "");
    case "in":     return Array.isArray(rhs) && rhs.map(String).includes(String(lhs ?? ""));
    case "notIn":  return Array.isArray(rhs) && !rhs.map(String).includes(String(lhs ?? ""));
    default:       return true;
  }
}

/**
 * Para uma lista de tarefas, computa por tarefa:
 *  - bloqueadaPorDependencia: keys das deps ainda não concluídas (ou não-aplicáveis quentes).
 * Tarefas não-aplicáveis NUNCA bloqueiam outras (são tratadas como "satisfeitas").
 * Conclusão de tarefa não-aplicável é considerada satisfeita também.
 */
function computarBloqueios(tarefas: Array<any>): Array<any> {
  const byKey = new Map<string, any>();
  for (const t of tarefas) {
    if (t.tarefaKey) byKey.set(t.tarefaKey, t);
  }
  return tarefas.map((t) => {
    const deps: string[] = Array.isArray(t.dependsOnKeys) ? t.dependsOnKeys : [];
    const faltando = deps.filter((k) => {
      const dep = byKey.get(k);
      if (!dep) return false; // dep inexistente é ignorada (tarefa antiga, key removida)
      if (dep.aplicavel === false) return false; // dep não-aplicável conta como satisfeita
      return dep.status !== "concluido";
    });
    return { ...t, bloqueadaPorDependencia: faltando };
  });
}

/**
 * Resolve a próxima coluna no array config.colunas (por ordem). Null se já está na última.
 */
function proximaColuna(colunas: Array<any> | undefined, atual: string): string | null {
  const sorted = (colunas ?? []).slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const idx = sorted.findIndex((c) => c.id === atual);
  if (idx < 0 || idx >= sorted.length - 1) return null;
  return sorted[idx + 1].id;
}

/**
 * Verifica se a coluna atual tem flag autoAdvance no config.
 */
function temAutoAdvance(colunas: Array<any> | undefined, atual: string): boolean {
  const c = (colunas ?? []).find((x) => x.id === atual);
  return Boolean(c?.autoAdvance);
}

/**
 * Validação por tipo de tarefa: garante que `dadosColetados` está completo.
 * Retorna null se ok, ou mensagem de erro.
 */
function validarDadosPorTipo(tipo: string, dados: any, formSchema: any): string | null {
  if (tipo === "upload") {
    if (!dados || typeof dados !== "object") return "Anexe um arquivo para concluir esta tarefa.";
    if (!dados.path || !dados.name) return "Anexe um arquivo válido (path e nome) para concluir esta tarefa.";
    return null;
  }
  if (tipo === "date") {
    if (!dados?.data) return "Informe uma data para concluir esta tarefa.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dados.data))) return "Data inválida (formato esperado: AAAA-MM-DD).";
    return null;
  }
  if (tipo === "form") {
    const values = dados?.values;
    if (!values || typeof values !== "object") return "Preencha os campos do formulário para concluir esta tarefa.";
    const schema: Array<any> = Array.isArray(formSchema) ? formSchema : [];
    for (const f of schema) {
      if (f.required) {
        const v = values[f.name];
        if (v === undefined || v === null || String(v).trim() === "") {
          return `Campo obrigatório não preenchido: ${f.label || f.name}`;
        }
      }
    }
    return null;
  }
  // checkbox e approval não exigem dados extras (approval carimba aprovador).
  return null;
}

// ─────────────────────────── ROUTES ───────────────────────────
export function registerPipelineSocietarioRoutes(app: Express) {
  // Sprint 4: módulos auxiliares (CRUD configs/items + dashboard analista)
  registerPipelineConfigsCrudRoutes(app);
  registerPipelineDashboardRoutes(app);

  // GET /configs — lista (com lazy seed)
  app.get("/api/societario/pipeline/configs", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      await ensureDefaultConfigs(tenantId, userId);
      const rows = await db.select().from(pipelineConfigs)
        .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.isActive, true)))
        .orderBy(asc(pipelineConfigs.tipoProcesso));
      res.json(rows);
    } catch (e: any) {
      console.error("[societario/pipeline] list configs:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // GET /processos — lista para o Kanban
  app.get("/api/societario/pipeline/processos", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const tipoProcesso = typeof req.query.tipo === "string" ? req.query.tipo : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;

      const conds = [eq(processosSocietarios.tenantId, tenantId)];
      if (tipoProcesso) conds.push(eq(processosSocietarios.tipoProcesso, tipoProcesso));
      if (status) conds.push(eq(processosSocietarios.status, status));

      const rows = await db.select({
        p: processosSocietarios,
        sociedadeRazao: sociedades.razaoSocial,
      })
        .from(processosSocietarios)
        .leftJoin(sociedades, eq(sociedades.id, processosSocietarios.sociedadeId))
        .where(and(...conds))
        .orderBy(desc(processosSocietarios.createdAt));

      // Conta tarefas pendentes por processo (para badge nos cards)
      // Usa parametrização segura via inArray + agregação Drizzle (sem sql.raw).
      const ids = rows.map((r) => r.p.id);
      const pendByProc = new Map<string, { pendentes: number; obrigatoriasPend: number }>();
      if (ids.length > 0) {
        // Conta pendentes APLICÁVEIS (aplicavel != false; trata null como aplicável p/ retrocompat com snapshots antigos).
        // Sem este filtro, tarefas N/A (condicaoJson não satisfeita) inflariam o badge no Hub e
        // divergiriam do detalhe + auto-advance que já filtram aplicavel.
        const counts = await db
          .select({
            processoId: processoTarefas.processoId,
            pendentes: sql<number>`COUNT(*)::int`,
            obrig: sql<number>`COUNT(*) FILTER (WHERE ${processoTarefas.isRequired} = true AND ${processoTarefas.bloqueiaAvanco} = true AND (${processoTarefas.aplicavel} IS NULL OR ${processoTarefas.aplicavel} = true))::int`,
          })
          .from(processoTarefas)
          .where(and(
            eq(processoTarefas.tenantId, tenantId),
            inArray(processoTarefas.processoId, ids),
            sql`${processoTarefas.status} != 'concluido'`,
            sql`(${processoTarefas.aplicavel} IS NULL OR ${processoTarefas.aplicavel} = true)`,
          ))
          .groupBy(processoTarefas.processoId);
        for (const c of counts) {
          pendByProc.set(c.processoId, { pendentes: Number(c.pendentes), obrigatoriasPend: Number(c.obrig) });
        }
      }

      res.json(rows.map((r) => ({
        ...r.p,
        sociedadeRazao: r.sociedadeRazao,
        tarefasPendentes: pendByProc.get(r.p.id)?.pendentes ?? 0,
        obrigatoriasPendentes: pendByProc.get(r.p.id)?.obrigatoriasPend ?? 0,
      })));
    } catch (e: any) {
      console.error("[societario/pipeline] list processos:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // GET /processos/:id — detalhe
  app.get("/api/societario/pipeline/processos/:id", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const id = req.params.id;
      const [proc] = await db.select().from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, id)))
        .limit(1);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });

      const [config] = await db.select().from(pipelineConfigs)
        .where(eq(pipelineConfigs.id, proc.pipelineConfigId))
        .limit(1);

      const [sociedade] = await db.select().from(sociedades)
        .where(eq(sociedades.id, proc.sociedadeId)).limit(1);

      const tarefasRaw = await db.select().from(processoTarefas)
        .where(eq(processoTarefas.processoId, id))
        .orderBy(asc(processoTarefas.etapa), asc(processoTarefas.ordem));

      // Motor dinâmico: anota cada tarefa com bloqueadaPorDependencia[] (keys faltando)
      const tarefas = computarBloqueios(tarefasRaw);

      const movs = await db.select().from(processoMovimentacoes)
        .where(eq(processoMovimentacoes.processoId, id))
        .orderBy(desc(processoMovimentacoes.createdAt));

      res.json({ processo: proc, config: config ?? null, sociedade: sociedade ?? null, tarefas, movimentacoes: movs });
    } catch (e: any) {
      console.error("[societario/pipeline] get processo:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /processos — cria. tenantId/createdBy/timestamps são preenchidos pelo servidor.
  const criarSchema = z.object({
    titulo: z.string().min(3).max(255),
    sociedadeId: z.string().uuid(),
    pipelineConfigId: z.string().uuid(),
    tipoProcesso: z.string().min(1),
    subtipo: z.string().optional().nullable(),
    descricao: z.string().optional().nullable(),
    colunaAtual: z.string().optional(),
    modoOperacao: z.enum(["manual", "assistido", "auto"]).optional(),
    analistaResponsavelId: z.string().uuid().optional().nullable(),
    solicitanteId: z.string().uuid().optional().nullable(),
    clientePessoaId: z.string().optional().nullable(),
    clienteContatoPreferido: z.enum(["whatsapp", "email", "inapp", "ambos"]).optional(),
    dataPrevistaConclusao: z.string().optional().nullable(),
    status: z.enum(["ativo", "pausado", "concluido", "cancelado"]).optional(),
    prioridade: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
    notasInternas: z.string().optional().nullable(),
  });

  app.post("/api/societario/pipeline/processos", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const parsed = criarSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });

      const data = parsed.data;
      // Garante sociedade do tenant (carrega completa para avaliar condicaoJson nas tarefas)
      const [soc] = await db.select().from(sociedades)
        .where(and(eq(sociedades.id, data.sociedadeId), eq(sociedades.tenantId, tenantId))).limit(1);
      if (!soc) return res.status(400).json({ message: "Sociedade inválida" });

      // Garante config do tenant
      const [cfg] = await db.select().from(pipelineConfigs)
        .where(and(eq(pipelineConfigs.id, data.pipelineConfigId), eq(pipelineConfigs.tenantId, tenantId))).limit(1);
      if (!cfg) return res.status(400).json({ message: "Configuração de pipeline inválida" });

      // Coerência: tipoProcesso DEVE bater com o da config. Clientes não-UI poderiam
      // enviar valores arbitrários e gerar registros inconsistentes. Server é a verdade.
      if (data.tipoProcesso !== cfg.tipoProcesso) {
        return res.status(400).json({
          message: `tipoProcesso '${data.tipoProcesso}' não corresponde ao da configuração ('${cfg.tipoProcesso}')`,
        });
      }

      // Tenant-isolation da Pessoa cliente: precisa pertencer ao tenant E ter papel cliente ativo.
      const valPessoa = await validateClientePessoa(tenantId, data.clientePessoaId);
      if (!valPessoa.ok) return res.status(400).json({ message: valPessoa.message });

      const colInicial = (cfg.colunas?.[0]?.id as string) || "backlog";

      // Retry da TRANSAÇÃO INTEIRA em colisão de processNumber (unique constraint 23505).
      // No PostgreSQL, ao primeiro erro a tx fica em estado abortado e qualquer próxima
      // query falha; portanto retry tem que recriar a tx do zero (não basta loop interno).
      let inserted: any = null;
      let tarefasCriadas = 0;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const processNumber = await generateProcessNumber(tenantId);
        try {
          const out = await db.transaction(async (tx) => {
            const rows = await tx.insert(processosSocietarios).values({
              tenantId,
              processNumber,
              sociedadeId: data.sociedadeId,
              pipelineConfigId: data.pipelineConfigId,
              tipoProcesso: data.tipoProcesso,
              subtipo: data.subtipo ?? null,
              titulo: data.titulo,
              descricao: data.descricao ?? null,
              colunaAtual: data.colunaAtual ?? colInicial,
              modoOperacao: data.modoOperacao ?? "assistido",
              analistaResponsavelId: data.analistaResponsavelId ?? userId,
              solicitanteId: data.solicitanteId ?? userId,
              clientePessoaId: data.clientePessoaId ?? null,
              clienteContatoPreferido: data.clienteContatoPreferido ?? "inapp",
              dataPrevistaConclusao: data.dataPrevistaConclusao ?? null,
              status: data.status ?? "ativo",
              prioridade: data.prioridade ?? "media",
              notasInternas: data.notasInternas ?? null,
              createdBy: userId,
            }).returning();
            const processoRow = rows[0];

            // Materializa checklist (in-tx) — snapshot completo + aplicabilidade por sociedade
            const items = await tx.select().from(pipelineChecklistItems)
              .where(eq(pipelineChecklistItems.pipelineConfigId, data.pipelineConfigId))
              .orderBy(asc(pipelineChecklistItems.etapa), asc(pipelineChecklistItems.ordem));
            if (items.length > 0) {
              await tx.insert(processoTarefas).values(
                items.map((i) => ({
                  tenantId,
                  processoId: processoRow.id,
                  checklistItemId: i.id,
                  etapa: i.etapa,
                  ordem: i.ordem,
                  titulo: i.titulo,
                  descricao: i.descricao ?? null,
                  executorType: i.executorType,
                  isRequired: i.isRequired ?? true,
                  bloqueiaAvanco: i.bloqueiaAvanco ?? true,
                  acaoAutomatica: i.acaoAutomatica ?? null,
                  tipo: (i as any).tipo ?? "checkbox",
                  tarefaKey: (i as any).tarefaKey ?? null,
                  dependsOnKeys: (i as any).dependsOnKeys ?? null,
                  condicaoJson: (i as any).condicaoJson ?? null,
                  formSchemaJson: (i as any).formSchemaJson ?? null,
                  aplicavel: avaliarCondicao((i as any).condicaoJson, soc as any),
                })),
              );
            }

            await tx.insert(processoMovimentacoes).values({
              tenantId,
              processoId: processoRow.id,
              colunaDe: null,
              colunaPara: processoRow.colunaAtual,
              movidoPor: userId,
              movidoPorAgente: false,
              motivo: "Processo criado",
            });

            return { inserted: processoRow, tarefasCriadas: items.length };
          });
          inserted = out.inserted;
          tarefasCriadas = out.tarefasCriadas;
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          if (String(e?.code) === "23505" && attempt < 2) continue; // colisão de processNumber: novo número + nova tx
          throw e;
        }
      }
      if (!inserted) throw lastErr ?? new Error("Falha ao criar processo após retries");

      // Hook Sprint 3: ao criar processo, agente verifica dados da empresa em background.
      // Best-effort: erro aqui não invalida criação. Gate dual-mode é feito pelo dispatcher.
      const tarefaVerif = await db.select({ id: processoTarefas.id })
        .from(processoTarefas)
        .where(and(
          eq(processoTarefas.processoId, inserted.id),
          eq(processoTarefas.tarefaKey, "verificar_dados"),
        )).limit(1);
      void dispatchSkill("verificar_dados_empresa", {
        tenantId,
        processoId: inserted.id,
        userId,
        source: "hook",
        tarefaId: tarefaVerif[0]?.id,
      }).catch((e) => console.error("[pipeline/hook create] verificar_dados_empresa:", e));

      res.status(201).json({ ...inserted, tarefasCriadas });
    } catch (e: any) {
      console.error("[societario/pipeline] create processo:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /processos/:id — campos editáveis
  const patchSchema = z.object({
    titulo: z.string().min(3).max(255).optional(),
    descricao: z.string().nullable().optional(),
    analistaResponsavelId: z.string().uuid().nullable().optional(),
    clientePessoaId: z.string().nullable().optional(),
    clienteContatoPreferido: z.enum(["whatsapp", "email", "inapp", "ambos"]).optional(),
    dataPrevistaConclusao: z.string().nullable().optional(),
    status: z.enum(["ativo", "pausado", "concluido", "cancelado"]).optional(),
    prioridade: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
    modoOperacao: z.enum(["manual", "assistido", "auto"]).optional(),
    notasInternas: z.string().nullable().optional(),
  });

  app.patch("/api/societario/pipeline/processos/:id", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const id = req.params.id;
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });

      const [current] = await db.select().from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, id))).limit(1);
      if (!current) return res.status(404).json({ message: "Processo não encontrado" });

      // Readonly guard: processo concluído só aceita reabertura (status concluido→ativo).
      const isReabertura =
        current.status === "concluido" &&
        parsed.data.status === "ativo" &&
        Object.keys(parsed.data).every((k) => k === "status" || k === "notasInternas");
      if (current.status === "concluido" && !isReabertura) {
        return res.status(409).json({
          message: "Processo concluído é somente leitura. Para editar, reabra o processo (status: ativo).",
        });
      }

      // Tenant-isolation da Pessoa cliente em updates parciais.
      if (parsed.data.clientePessoaId !== undefined) {
        const valPessoa = await validateClientePessoa(tenantId, parsed.data.clientePessoaId);
        if (!valPessoa.ok) return res.status(400).json({ message: valPessoa.message });
      }

      const updates: any = { ...parsed.data, updatedAt: new Date() };
      // Reabertura volta para a coluna anterior à conclusão (último colunaDe registrado).
      // Caso não haja histórico, mantém a coluna atual ('concluido').
      let reabriuColuna: { de: string; para: string } | null = null;
      if (isReabertura) {
        updates.dataConclusao = null;
        const [lastMov] = await db.select().from(processoMovimentacoes)
          .where(and(eq(processoMovimentacoes.processoId, id), eq(processoMovimentacoes.colunaPara, "concluido")))
          .orderBy(desc(processoMovimentacoes.createdAt))
          .limit(1);
        if (lastMov?.colunaDe && lastMov.colunaDe !== current.colunaAtual) {
          updates.colunaAtual = lastMov.colunaDe;
          reabriuColuna = { de: current.colunaAtual, para: lastMov.colunaDe };
        }
      }

      // Audit: detecta mudanças de campos rastreados ANTES do UPDATE.
      const TRACKED: Array<{ field: keyof typeof updates; label: string }> = [
        { field: "analistaResponsavelId", label: "Analista responsável" },
        { field: "prioridade", label: "Prioridade" },
        { field: "modoOperacao", label: "Modo de operação" },
        { field: "status", label: "Status" },
        { field: "dataPrevistaConclusao", label: "Prazo previsto" },
        { field: "clientePessoaId", label: "Cliente (pessoa)" },
        { field: "clienteContatoPreferido", label: "Canal preferido do cliente" },
      ];
      const auditMudancas: string[] = [];
      for (const { field, label } of TRACKED) {
        if (parsed.data[field as keyof typeof parsed.data] === undefined) continue;
        const before = (current as any)[field];
        const after = (parsed.data as any)[field];
        const eq2 = (a: any, b: any) => {
          if (a instanceof Date) a = a.toISOString();
          if (b instanceof Date) b = b.toISOString();
          return (a ?? null) === (b ?? null);
        };
        if (!eq2(before, after)) {
          auditMudancas.push(`${label}: ${before ?? "—"} → ${after ?? "—"}`);
        }
      }

      // Atomic readonly guard: a UPDATE só passa se o status no banco ainda for o esperado.
      // Evita TOCTOU se outra requisição concluir o processo entre o SELECT e o UPDATE.
      const expectedStatus: string = current.status ?? "ativo";
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(processosSocietarios)
          .set(updates)
          .where(and(
            eq(processosSocietarios.tenantId, tenantId),
            eq(processosSocietarios.id, id),
            eq(processosSocietarios.status, expectedStatus),
          ))
          .returning();
        if (!row) return null;
        if (auditMudancas.length > 0 || reabriuColuna) {
          const motivos: string[] = [];
          if (reabriuColuna) motivos.push(`Reabertura de processo (volta de ${reabriuColuna.de} para ${reabriuColuna.para})`);
          if (auditMudancas.length > 0) motivos.push(...auditMudancas);
          await tx.insert(processoMovimentacoes).values({
            tenantId,
            processoId: id,
            colunaDe: reabriuColuna?.de ?? row.colunaAtual,
            colunaPara: reabriuColuna?.para ?? row.colunaAtual,
            movidoPor: userId,
            movidoPorAgente: false,
            motivo: motivos.join(" | "),
          });
        }
        return row;
      });
      if (!updated) {
        return res.status(409).json({
          message: "O processo foi alterado por outra operação. Recarregue e tente novamente.",
        });
      }
      res.json(updated);
    } catch (e: any) {
      console.error("[societario/pipeline] patch processo:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /processos/:id/coluna — move entre colunas (com guard de obrigatórias)
  const moverSchema = z.object({
    colunaPara: z.string().min(1),
    motivo: z.string().optional(),
  });

  app.patch("/api/societario/pipeline/processos/:id/coluna", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const id = req.params.id;
      const parsed = moverSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });

      const [proc] = await db.select().from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, id))).limit(1);
      if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
      if (proc.status === "concluido") {
        return res.status(409).json({ message: "Processo concluído é somente leitura. Reabra antes de mover de coluna." });
      }

      const colDe = proc.colunaAtual;
      const colPara = parsed.data.colunaPara;
      if (colDe === colPara) return res.status(400).json({ message: "Coluna de origem e destino são iguais" });

      // Carrega config para validar coluna destino
      const [cfg] = await db.select().from(pipelineConfigs)
        .where(eq(pipelineConfigs.id, proc.pipelineConfigId)).limit(1);
      const colsValidas = new Set((cfg?.colunas ?? []).map((c) => c.id));
      if (!colsValidas.has(colPara)) return res.status(400).json({ message: `Coluna '${colPara}' não existe na configuração` });

      // Guard: bloqueia avanço se há tarefas obrigatórias APLICÁVEIS pendentes na etapa atual.
      // Tarefas não-aplicáveis (condição não-bate) não bloqueiam.
      const obrPendentes = await db.execute<{ count: number; titulos: string[] }>(sql`
        SELECT COUNT(*)::int AS count,
               ARRAY_AGG(titulo) AS titulos
        FROM processo_tarefas
        WHERE processo_id = ${id}
          AND etapa = ${colDe}
          AND is_required = true
          AND bloqueia_avanco = true
          AND aplicavel = true
          AND status != 'concluido'
      `).then((r: any) => r.rows?.[0] ?? r[0]);
      const pendCount = Number(obrPendentes?.count ?? 0);
      if (pendCount > 0) {
        return res.status(409).json({
          message: `Não é possível avançar: ${pendCount} tarefa(s) obrigatória(s) pendente(s) em '${colDe}'`,
          pendentes: obrPendentes?.titulos ?? [],
        });
      }

      // Atualização atômica: UPDATE condicional por (tenantId, id, colunaAtual = colDe)
      // garante que duas operações concorrentes (drag duplo, double-submit) não causem
      // overwrite silencioso e nem registro de movimentação impossível. Se a primeira
      // operação venceu a corrida, a segunda devolve 0 linhas → 409.
      const updates: Record<string, unknown> = { colunaAtual: colPara, updatedAt: new Date() };
      if (colPara === "concluido") {
        updates.status = "concluido";
        updates.dataConclusao = new Date();
      }

      const updated = await db.transaction(async (tx) => {
        const rows = await tx.update(processosSocietarios)
          .set(updates)
          .where(and(
            eq(processosSocietarios.tenantId, tenantId),
            eq(processosSocietarios.id, id),
            eq(processosSocietarios.colunaAtual, colDe),
            sql`${processosSocietarios.status} != 'concluido'`,
          ))
          .returning();
        if (rows.length === 0) return null;
        await tx.insert(processoMovimentacoes).values({
          tenantId,
          processoId: id,
          colunaDe: colDe,
          colunaPara: colPara,
          movidoPor: userId,
          movidoPorAgente: false,
          motivo: parsed.data.motivo ?? null,
        });
        return rows[0];
      });

      if (!updated) {
        return res.status(409).json({
          message: "Processo já foi movido por outra operação. Recarregue para ver o estado atual.",
        });
      }

      // Hook Sprint 3: ao entrar em 'aguardando_documentos', agente notifica cliente.
      if (colPara === "aguardando_documentos") {
        void dispatchSkill("solicitar_documentos_cliente", {
          tenantId,
          processoId: id,
          userId,
          source: "hook",
          triggerColuna: colPara,
        }).catch((e) => console.error("[pipeline/hook coluna] solicitar_documentos_cliente:", e));
      }

      res.json(updated);
    } catch (e: any) {
      console.error("[societario/pipeline] mover coluna:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /processos/:id/tarefas/:tid/upload-url — gera signed URL p/ upload de arquivo
  // de tarefa do tipo `upload`. Devolve uploadURL + uploadToken (HMAC).
  app.post(
    "/api/societario/pipeline/processos/:pid/tarefas/:tid/upload-url",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ message: "Usuário não identificado" });

        const [proc] = await db
          .select()
          .from(processosSocietarios)
          .where(and(
            eq(processosSocietarios.id, req.params.pid),
            eq(processosSocietarios.tenantId, tenantId),
          ));
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        if (proc.status === "concluido") {
          return res.status(409).json({
            message: "Processo concluído é somente leitura. Reabra antes de anexar arquivos.",
          });
        }

        const [tarefa] = await db
          .select()
          .from(processoTarefas)
          .where(and(
            eq(processoTarefas.id, req.params.tid),
            eq(processoTarefas.processoId, proc.id),
          ));
        if (!tarefa) return res.status(404).json({ message: "Tarefa não encontrada" });
        if ((tarefa as any).tipo !== "upload") {
          return res.status(400).json({ message: "Esta tarefa não é do tipo upload" });
        }

        const svc = new ObjectStorageService();
        const uploadURL = await svc.getObjectEntityUploadURL();
        const path = svc.normalizeObjectEntityPath(uploadURL);
        const uploadToken = createTarefaUploadToken({
          tenantId, userId, processoId: proc.id, tarefaId: tarefa.id, path,
        });
        res.json({ uploadURL, uploadToken, path });
      } catch (err: any) {
        console.error("[pipeline] upload-url:", err);
        res.status(500).json({ message: err?.message || "Falha ao gerar URL de upload" });
      }
    },
  );

  // POST /processos/:id/tarefas/:tid/concluir — motor dinâmico:
  // valida tipo, deps de outras tarefas, e tenta auto-advance da coluna.
  const concluirSchema = z.object({
    notes: z.string().optional(),
    // Por tipo:
    //   upload:   { path, name, mime?, size? }
    //   date:     { data: 'YYYY-MM-DD' }
    //   form:     { values: { [name]: any } }
    //   approval: opcional (servidor carimba aprovador automaticamente)
    dadosColetados: z.record(z.any()).optional(),
    // Obrigatório quando tipo=upload: HMAC retornado por POST /upload-url,
    // amarrado a tenant|user|processo|tarefa|path. Impede que cliente conclua upload
    // com path arbitrário sem ter passado pelo fluxo de geração de URL.
    uploadToken: z.string().optional(),
  });

  app.post("/api/societario/pipeline/processos/:pid/tarefas/:tid/concluir", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const userId = getUserId(req);
      const { pid, tid } = req.params;
      const parsed = concluirSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });

      // 0) Readonly guard: processo concluído não aceita mudanças em tarefas
      const [procRO] = await db.select({ status: processosSocietarios.status }).from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, pid))).limit(1);
      if (!procRO) return res.status(404).json({ message: "Processo não encontrado" });
      if (procRO.status === "concluido") {
        return res.status(409).json({ message: "Processo concluído é somente leitura. Reabra antes de concluir tarefas." });
      }

      // 1) Carrega TODAS as tarefas do processo (para validar deps + auto-advance)
      const allTarefas = await db.select().from(processoTarefas)
        .where(and(eq(processoTarefas.tenantId, tenantId), eq(processoTarefas.processoId, pid)));
      const tarefa = allTarefas.find((t) => t.id === tid);
      if (!tarefa) return res.status(404).json({ message: "Tarefa não encontrada" });

      // 2) Bloqueia se a tarefa não é aplicável
      if ((tarefa as any).aplicavel === false) {
        return res.status(400).json({ message: "Esta tarefa não é aplicável a este processo (condição não satisfeita)." });
      }

      // 3) Bloqueia se há dependências (de keys) ainda não concluídas
      const annotated = computarBloqueios(allTarefas);
      const ann = annotated.find((t: any) => t.id === tid);
      if (ann?.bloqueadaPorDependencia?.length) {
        const titulosFaltando = ann.bloqueadaPorDependencia
          .map((k: string) => allTarefas.find((t: any) => t.tarefaKey === k)?.titulo || k);
        return res.status(409).json({
          message: `Esta tarefa depende de outras ainda não concluídas`,
          pendentes: titulosFaltando,
        });
      }

      // 4) Validação por tipo de tarefa
      const tipo = String((tarefa as any).tipo || "checkbox");
      let dados = parsed.data.dadosColetados ?? null;
      // approval: servidor carimba aprovador automaticamente
      if (tipo === "approval") {
        dados = { ...(dados || {}), aprovadorId: userId, aprovadoEm: new Date().toISOString() };
      }
      const erro = validarDadosPorTipo(tipo, dados, (tarefa as any).formSchemaJson);
      if (erro) return res.status(400).json({ message: erro });

      // 4b) Para upload, exigir HMAC token escopado ao path apresentado.
      // Sem isto, qualquer cliente autenticado no tenant poderia "concluir" um upload com
      // path arbitrário sem ter passado pelo fluxo de geração de URL (sem prova de escopo).
      if (tipo === "upload") {
        const token = parsed.data.uploadToken;
        const path = String((dados as any)?.path ?? "");
        if (!token || !path || !userId) {
          return res.status(400).json({ message: "Upload sem comprovação: gere a URL via /upload-url e envie o uploadToken." });
        }
        const okToken = verifyTarefaUploadToken({
          token, tenantId, userId, processoId: pid, tarefaId: tid, path,
        });
        if (!okToken) {
          return res.status(403).json({ message: "uploadToken inválido, expirado ou fora de escopo." });
        }
      }

      // 5+6) Atualiza tarefa + auto-advance EM TRANSAÇÃO ATÔMICA.
      // - UPDATE condicional `WHERE status != 'concluido'`: previne double-submit (segunda
      //   chamada concorrente devolve 0 linhas → 409).
      // - Recarrega tarefas/processo dentro da mesma tx para evitar decisão em estado stale.
      // - Movimentação auto-advance é INSERTed na mesma tx (rollback total se algo falhar).
      const txResult = await db.transaction(async (tx) => {
        const updatedRows = await tx.update(processoTarefas)
          .set({
            status: "concluido",
            concluidoAt: new Date(),
            concluidoBy: userId,
            concluidoNotes: parsed.data.notes ?? null,
            dadosColetadosJson: dados,
          })
          .where(and(
            eq(processoTarefas.tenantId, tenantId),
            eq(processoTarefas.processoId, pid),
            eq(processoTarefas.id, tid),
            sql`${processoTarefas.status} != 'concluido'`,
          ))
          .returning();
        if (updatedRows.length === 0) {
          return { conflict: true as const };
        }
        const updated = updatedRows[0];

        let autoAdvanced: { de: string; para: string } | null = null;
        const [proc] = await tx.select().from(processosSocietarios)
          .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, pid))).limit(1);
        if (proc) {
          const [cfg] = await tx.select().from(pipelineConfigs)
            .where(eq(pipelineConfigs.id, proc.pipelineConfigId)).limit(1);
          if (cfg && temAutoAdvance(cfg.colunas as any, proc.colunaAtual)) {
            const tarefasAtuais = await tx.select().from(processoTarefas)
              .where(and(eq(processoTarefas.tenantId, tenantId), eq(processoTarefas.processoId, pid)));
            const restamObrig = tarefasAtuais.filter((t: any) =>
              t.etapa === proc.colunaAtual &&
              t.isRequired === true &&
              t.bloqueiaAvanco === true &&
              t.aplicavel !== false &&
              t.status !== "concluido",
            );
            if (restamObrig.length === 0) {
              const next = proximaColuna(cfg.colunas as any, proc.colunaAtual);
              if (next) {
                const colDe = proc.colunaAtual;
                const updates: any = { colunaAtual: next, updatedAt: new Date() };
                if (next === "concluido") {
                  updates.status = "concluido";
                  updates.dataConclusao = new Date();
                }
                // UPDATE condicional `colunaAtual = colDe`: se outra request já avançou,
                // returning vem vazio e não duplicamos a movimentação.
                const movedRows = await tx.update(processosSocietarios).set(updates)
                  .where(and(
                    eq(processosSocietarios.tenantId, tenantId),
                    eq(processosSocietarios.id, pid),
                    eq(processosSocietarios.colunaAtual, colDe),
                  ))
                  .returning({ id: processosSocietarios.id });
                if (movedRows.length > 0) {
                  await tx.insert(processoMovimentacoes).values({
                    tenantId,
                    processoId: pid,
                    colunaDe: colDe,
                    colunaPara: next,
                    movidoPor: userId,
                    movidoPorAgente: false,
                    motivo: "auto_advance: obrigatórias da etapa concluídas",
                  });
                  autoAdvanced = { de: colDe, para: next };
                }
              }
            }
          }
        }
        return { conflict: false as const, updated, autoAdvanced };
      });

      if (txResult.conflict) {
        return res.status(409).json({ message: "Tarefa já estava concluída ou foi atualizada por outra ação." });
      }

      // Hooks Sprint 3 (best-effort, fora da tx):
      // - upload concluído ⇒ valida texto via OCR/extract.
      // - todas as obrigatórias de em_elaboracao concluídas ⇒ gera minuta.
      if (tipo === "upload") {
        void dispatchSkill("validar_documentos_recebidos", {
          tenantId,
          processoId: pid,
          userId,
          source: "hook",
          tarefaId: tid,
          triggerTarefa: txResult.updated,
        }).catch((e) => console.error("[pipeline/hook concluir] validar:", e));
      }
      if ((tarefa as any).etapa === "em_elaboracao") {
        const tarefasAtuais = await db.select().from(processoTarefas)
          .where(and(eq(processoTarefas.tenantId, tenantId), eq(processoTarefas.processoId, pid)));
        const restamObrigEla = tarefasAtuais.filter((t: any) =>
          t.etapa === "em_elaboracao" &&
          t.isRequired === true &&
          t.bloqueiaAvanco === true &&
          t.aplicavel !== false &&
          t.status !== "concluido",
        );
        const jaTemMinutaAgente = tarefasAtuais.some((t: any) =>
          (t.tarefaKey || "").startsWith("revisar_minuta_"),
        );
        if (restamObrigEla.length === 0 && !jaTemMinutaAgente) {
          void dispatchSkill("gerar_minuta", {
            tenantId, processoId: pid, userId, source: "hook",
          }).catch((e) => console.error("[pipeline/hook concluir] gerar_minuta:", e));
        }
      }

      res.json({ ...txResult.updated, autoAdvanced: txResult.autoAdvanced });
    } catch (e: any) {
      console.error("[societario/pipeline] concluir tarefa:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /processos/:id/tarefas/:tid/reabrir — desmarca conclusão (manual)
  app.post("/api/societario/pipeline/processos/:pid/tarefas/:tid/reabrir", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const { pid, tid } = req.params;
      const [procRO] = await db.select({ status: processosSocietarios.status }).from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, pid))).limit(1);
      if (!procRO) return res.status(404).json({ message: "Processo não encontrado" });
      if (procRO.status === "concluido") {
        return res.status(409).json({ message: "Processo concluído é somente leitura. Reabra antes de reabrir tarefas." });
      }
      const [updated] = await db.update(processoTarefas)
        .set({
          status: "pendente",
          concluidoAt: null,
          concluidoBy: null,
          concluidoNotes: null,
        })
        .where(and(
          eq(processoTarefas.tenantId, tenantId),
          eq(processoTarefas.processoId, pid),
          eq(processoTarefas.id, tid),
        ))
        .returning();
      if (!updated) return res.status(404).json({ message: "Tarefa não encontrada" });
      res.json(updated);
    } catch (e: any) {
      console.error("[societario/pipeline] reabrir tarefa:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // GET /sociedades/:sid/processos — lista processos pertencentes a UMA sociedade
  // (alimenta a aba "Processos" dentro do detalhe da sociedade no módulo Societário)
  app.get("/api/societario/sociedades/:sid/processos", isAuthenticated, requireTenant, async (req: any, res: Response) => {
    try {
      const tenantId = req.tenantId as string;
      const sid = req.params.sid;
      // Confirma que a sociedade pertence ao tenant
      const [soc] = await db.select({ id: sociedades.id }).from(sociedades)
        .where(and(eq(sociedades.id, sid), eq(sociedades.tenantId, tenantId))).limit(1);
      if (!soc) return res.status(404).json({ message: "Sociedade não encontrada" });

      const rows = await db.select().from(processosSocietarios)
        .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.sociedadeId, sid)))
        .orderBy(desc(processosSocietarios.createdAt));

      // Conta tarefas pendentes por processo (mesma lógica do GET geral)
      const ids = rows.map((r) => r.id);
      const pendByProc = new Map<string, { pendentes: number; obrigatoriasPend: number }>();
      if (ids.length > 0) {
        const counts = await db
          .select({
            processoId: processoTarefas.processoId,
            pendentes: sql<number>`COUNT(*)::int`,
            obrig: sql<number>`COUNT(*) FILTER (WHERE ${processoTarefas.isRequired} = true AND ${processoTarefas.bloqueiaAvanco} = true AND (${processoTarefas.aplicavel} IS NULL OR ${processoTarefas.aplicavel} = true))::int`,
          })
          .from(processoTarefas)
          .where(and(
            eq(processoTarefas.tenantId, tenantId),
            inArray(processoTarefas.processoId, ids),
            sql`${processoTarefas.status} != 'concluido'`,
            // Alinha com o GET geral: tarefas N/A (aplicavel=false) não inflam o badge.
            sql`(${processoTarefas.aplicavel} IS NULL OR ${processoTarefas.aplicavel} = true)`,
          ))
          .groupBy(processoTarefas.processoId);
        for (const c of counts) {
          pendByProc.set(c.processoId, { pendentes: Number(c.pendentes), obrigatoriasPend: Number(c.obrig) });
        }
      }

      res.json(rows.map((p) => ({
        ...p,
        tarefasPendentes: pendByProc.get(p.id)?.pendentes ?? 0,
        obrigatoriasPendentes: pendByProc.get(p.id)?.obrigatoriasPend ?? 0,
      })));
    } catch (e: any) {
      console.error("[societario/pipeline] list processos by sociedade:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Sprint 3: lista skills disponíveis (para UI dual-mode descobrir botões)
  app.get("/api/societario/pipeline/skills", isAuthenticated, requireTenant, async (_req: any, res: Response) => {
    res.json(Object.values(SKILLS).map((s) => ({ key: s.key, tarefaKeys: s.tarefaKeys })));
  });

  // Sprint 3: executa skill associada à tarefa manualmente (ignora modoOperacao).
  // Sem override por body — skill é sempre derivada da tarefaKey para evitar
  // execução de skills "ocultas" via API.
  app.post(
    "/api/societario/pipeline/processos/:pid/tarefas/:tid/executar-agente",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const userId = getUserId(req);
        const { pid, tid } = req.params;

        const [procRO] = await db.select({ status: processosSocietarios.status }).from(processosSocietarios)
          .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, pid))).limit(1);
        if (!procRO) return res.status(404).json({ message: "Processo não encontrado" });
        if (procRO.status === "concluido") {
          return res.status(409).json({ message: "Processo concluído é somente leitura. Reabra antes de executar agente." });
        }

        const [tarefa] = await db.select().from(processoTarefas)
          .where(and(
            eq(processoTarefas.tenantId, tenantId),
            eq(processoTarefas.processoId, pid),
            eq(processoTarefas.id, tid),
          )).limit(1);
        if (!tarefa) return res.status(404).json({ message: "Tarefa não encontrada" });

        const skillKey = skillForTarefaKey(tarefa.tarefaKey);
        if (!skillKey || !SKILLS[skillKey]) {
          return res.status(400).json({ message: "Esta tarefa não tem skill associada." });
        }

        const result = await dispatchSkill(skillKey, {
          tenantId,
          processoId: pid,
          userId,
          source: "manual",
          tarefaId: tid,
          triggerTarefa: tarefa,
        });
        res.json({ skill: skillKey, ...result });
      } catch (e: any) {
        console.error("[societario/pipeline] executar-agente:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // Sprint 3: dispara o cron de lembretes restrito ao tenant atual (admin role).
  app.post(
    "/api/societario/pipeline/admin/run-lembretes",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ message: "Não autenticado." });
        const [u] = await db.select({ role: users.role }).from(users)
          .where(eq(users.id, userId)).limit(1);
        if (!u || !["admin", "superadmin"].includes(u.role ?? "")) {
          return res.status(403).json({ message: "Apenas admin pode executar." });
        }
        const tenantId = req.tenantId as string;
        const { runLembretesDiarios } = await import("./skills");
        const r = await runLembretesDiarios({ tenantId });
        res.json(r);
      } catch (e: any) {
        console.error("[societario/pipeline] run-lembretes:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // Sprint 4: relatório PDF consolidado (lista de processos do tenant, com filtros)
  // GET /api/societario/pipeline/relatorio.pdf?tipoProcesso=&status=&analista=
  app.get(
    "/api/societario/pipeline/relatorio.pdf",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const tipoProcesso = typeof req.query.tipoProcesso === "string" ? req.query.tipoProcesso : undefined;
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const analistaId = typeof req.query.analista === "string" ? req.query.analista : undefined;

        const conds: any[] = [eq(processosSocietarios.tenantId, tenantId)];
        if (tipoProcesso) conds.push(eq(processosSocietarios.tipoProcesso, tipoProcesso));
        if (status) conds.push(eq(processosSocietarios.status, status));
        if (analistaId) conds.push(eq(processosSocietarios.analistaResponsavelId, analistaId));

        const procs = await db
          .select()
          .from(processosSocietarios)
          .where(and(...conds))
          .orderBy(desc(processosSocietarios.createdAt))
          .limit(500);

        const socIds = Array.from(new Set(procs.map((p) => p.sociedadeId).filter(Boolean))) as string[];
        const cliIds = Array.from(new Set(procs.map((p) => p.clientePessoaId).filter(Boolean))) as string[];
        const anaIds = Array.from(new Set(procs.map((p) => p.analistaResponsavelId).filter(Boolean))) as string[];

        const [socs, clis, anas] = await Promise.all([
          socIds.length
            ? db.select().from(sociedades).where(and(eq(sociedades.tenantId, tenantId), inArray(sociedades.id, socIds)))
            : Promise.resolve([] as any[]),
          cliIds.length
            ? db
                .select({ id: pessoasTable.id, nomeFantasia: pessoasTable.nomeFantasia, razaoSocial: pessoasTable.razaoSocial })
                .from(pessoasTable)
                .where(and(eq(pessoasTable.tenantId, tenantId), inArray(pessoasTable.id, cliIds)))
            : Promise.resolve([] as any[]),
          anaIds.length
            ? db
                .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
                .from(users)
                .where(inArray(users.id, anaIds))
            : Promise.resolve([] as any[]),
        ]);

        const socMap = new Map(socs.map((s: any) => [s.id, s.razaoSocial ?? s.nomeFantasia ?? null]));
        const cliMap = new Map(clis.map((p: any) => [p.id, p.razaoSocial ?? p.nomeFantasia ?? null]));
        const anaMap = new Map(
          anas.map((u: any) => [
            u.id,
            [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id,
          ]),
        );

        const pdfBytes = await renderPipelineRelatorioConsolidadoPdf({
          processos: procs.map((p) => ({
            processNumber: p.processNumber,
            titulo: p.titulo,
            tipoProcesso: p.tipoProcesso,
            colunaAtual: p.colunaAtual,
            status: p.status,
            prioridade: p.prioridade,
            sociedadeNome: socMap.get(p.sociedadeId) ?? null,
            clienteNome: p.clientePessoaId ? cliMap.get(p.clientePessoaId) ?? null : null,
            analistaNome: p.analistaResponsavelId ? anaMap.get(p.analistaResponsavelId) ?? null : null,
            createdAt: p.createdAt,
            dataPrevistaConclusao: p.dataPrevistaConclusao,
            dataConclusao: p.dataConclusao,
          })),
          filtros: { tipoProcesso, status, analista: analistaId },
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="societario-pipeline-${Date.now()}.pdf"`);
        res.send(Buffer.from(pdfBytes));
      } catch (e: any) {
        console.error("[societario/pipeline] relatorio consolidado pdf:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // Sprint 4: relatório PDF do processo (info + checklist + movimentações)
  app.get(
    "/api/societario/pipeline/processos/:id/relatorio.pdf",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const id = req.params.id;
        const [proc] = await db.select().from(processosSocietarios)
          .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, id))).limit(1);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });

        const [config] = await db.select().from(pipelineConfigs)
          .where(eq(pipelineConfigs.id, proc.pipelineConfigId)).limit(1);
        const [sociedade] = await db.select().from(sociedades)
          .where(eq(sociedades.id, proc.sociedadeId)).limit(1);
        const tarefas = await db.select().from(processoTarefas)
          .where(eq(processoTarefas.processoId, id))
          .orderBy(asc(processoTarefas.etapa), asc(processoTarefas.ordem));
        const movimentacoes = await db.select().from(processoMovimentacoes)
          .where(eq(processoMovimentacoes.processoId, id))
          .orderBy(desc(processoMovimentacoes.createdAt));

        let cliente: { nome: string; documento?: string | null } | null = null;
        if (proc.clientePessoaId) {
          const [p] = await db
            .select({ id: pessoasTable.id, nomeFantasia: pessoasTable.nomeFantasia, razaoSocial: pessoasTable.razaoSocial, cnpjCpf: pessoasTable.cnpjCpf })
            .from(pessoasTable)
            .where(and(eq(pessoasTable.tenantId, tenantId), eq(pessoasTable.id, proc.clientePessoaId)))
            .limit(1);
          if (p) cliente = { nome: p.razaoSocial || p.nomeFantasia, documento: p.cnpjCpf };
        }
        let analistaNome: string | null = null;
        if (proc.analistaResponsavelId) {
          const [u] = await db
            .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
            .from(users)
            .where(eq(users.id, proc.analistaResponsavelId))
            .limit(1);
          if (u) {
            analistaNome = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || proc.analistaResponsavelId;
          }
        }

        const pdfBytes = await renderProcessoRelatorioPdf({
          processo: proc,
          config: config ?? null,
          sociedade: sociedade ?? null,
          cliente,
          analistaNome,
          tarefas,
          movimentacoes,
        });
        const safeNumber = String(proc.processNumber).replace(/[^A-Za-z0-9_\-]/g, "_");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="relatorio-${safeNumber}.pdf"`);
        res.send(Buffer.from(pdfBytes));
      } catch (e: any) {
        console.error("[societario/pipeline] relatorio pdf:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );
}
