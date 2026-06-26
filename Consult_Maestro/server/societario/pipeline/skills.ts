/**
 * Pipeline Societário — Sprint 3
 *
 * Skills de ação do agente. Princípio dual-mode:
 *   - Toda tarefa pode ser concluída manualmente OU executada por skill.
 *   - Hooks (criação/movimentação/conclusão/cron) só disparam skill quando
 *     processosSocietarios.modoOperacao !== 'manual'.
 *   - Invocação manual via POST /executar-agente sempre é permitida.
 *
 * Cada skill recebe um contexto (processo + sociedade + tarefas), executa,
 * e devolve SkillResult que é gravado em processoTarefas.autoExecutionResult
 * + lastAutoExecutionAt para auditoria.
 */
import { db } from "../../db";
import {
  processosSocietarios,
  processoTarefas,
  processoMovimentacoes,
  pipelineConfigs,
  sociedades,
  socios,
  documentosSocietarios,
} from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { sendNotification } from "../../notificationService";
import { runWithOrchestration, callChatLLM } from "../../agentService";
import { extractText } from "../../superAgentFiles";
import { ObjectStorageService } from "../../objectStorage";

// ─── Tipos públicos ──────────────────────────────────────────────────────────
export type SkillKey =
  | "verificar_dados_empresa"
  | "solicitar_documentos_cliente"
  | "validar_documentos_recebidos"
  | "gerar_minuta"
  | "lembrar_documentos_pendentes"
  | "atualizar_pipeline";

export type SkillSource = "hook" | "manual" | "cron";

export interface SkillCtx {
  tenantId: string;
  processoId: string;
  userId: string | null;
  source: SkillSource;
  // Contexto opcional carregado pelo dispatcher
  tarefaId?: string;
  triggerColuna?: string;
  triggerTarefa?: any;
}

export interface SkillResult {
  ok: boolean;
  summary: string;
  data?: Record<string, any>;
  closedTarefaIds?: string[];
  createdTarefaIds?: string[];
  notifiedRecipients?: string[];
  movedColumn?: { de: string; para: string };
  warning?: string;
}

type SkillHandler = (ctx: SkillCtx, scope: SkillScope) => Promise<SkillResult>;

interface SkillScope {
  processo: any;
  sociedade: any | null;
  config: any | null;
  tarefas: any[];
}

interface SkillDef {
  key: SkillKey;
  // Quando essa skill estiver associada a uma tarefa via tarefaKey, o botão
  // "Executar agente" aparece e o hook tenta fechá-la.
  tarefaKeys: string[];
  handler: SkillHandler;
}

// ─── Carregamento de escopo ──────────────────────────────────────────────────
async function loadScope(tenantId: string, processoId: string): Promise<SkillScope | null> {
  const [proc] = await db
    .select()
    .from(processosSocietarios)
    .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.id, processoId)))
    .limit(1);
  if (!proc) return null;

  const [soc] = await db
    .select()
    .from(sociedades)
    .where(and(eq(sociedades.tenantId, tenantId), eq(sociedades.id, proc.sociedadeId)))
    .limit(1);

  const [cfg] = await db
    .select()
    .from(pipelineConfigs)
    .where(eq(pipelineConfigs.id, proc.pipelineConfigId))
    .limit(1);

  const tarefas = await db
    .select()
    .from(processoTarefas)
    .where(and(eq(processoTarefas.tenantId, tenantId), eq(processoTarefas.processoId, processoId)));

  return { processo: proc, sociedade: soc ?? null, config: cfg ?? null, tarefas };
}

// ─── Auditoria ───────────────────────────────────────────────────────────────
async function recordExecution(
  tenantId: string,
  processoId: string,
  tarefaId: string | null,
  skill: SkillKey,
  source: SkillSource,
  result: SkillResult,
): Promise<void> {
  if (!tarefaId) return;
  await db
    .update(processoTarefas)
    .set({
      autoExecuted: true,
      lastAutoExecutionAt: new Date(),
      autoExecutionResult: {
        skill,
        source,
        at: new Date().toISOString(),
        ok: result.ok,
        summary: result.summary,
        warning: result.warning ?? null,
        data: result.data ?? null,
      },
    })
    .where(and(
      eq(processoTarefas.tenantId, tenantId),
      eq(processoTarefas.id, tarefaId),
    ));
}

// ─── Loop guard auto-advance: máx 5 movimentos auto/h por processo ──────────
async function autoAdvanceLoopGuard(tenantId: string, processoId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select({ id: processoMovimentacoes.id })
    .from(processoMovimentacoes)
    .where(and(
      eq(processoMovimentacoes.tenantId, tenantId),
      eq(processoMovimentacoes.processoId, processoId),
      eq(processoMovimentacoes.movidoPorAgente, true),
      gte(processoMovimentacoes.createdAt, since),
    ));
  return rows.length < 5;
}

// ─── SKILL 1: verificar_dados_empresa ────────────────────────────────────────
const verificarDadosEmpresa: SkillHandler = async (ctx, scope) => {
  const soc = scope.sociedade;
  if (!soc) return { ok: false, summary: "Sociedade não encontrada para o processo." };

  const sociosList = await db
    .select()
    .from(socios)
    .where(and(eq(socios.tenantId, ctx.tenantId), eq(socios.sociedadeId, soc.id)));

  const issues: string[] = [];
  if (!soc.razaoSocial) issues.push("Razão social ausente");
  if (!soc.cnpj) issues.push("CNPJ ausente");
  if (!soc.naturezaJuridica) issues.push("Natureza jurídica ausente");
  if (!soc.regimeTributario) issues.push("Regime tributário ausente");
  if (!soc.capitalSocial || Number(soc.capitalSocial) <= 0) issues.push("Capital social não informado");
  if (!soc.objetoSocial) issues.push("Objeto social ausente");
  if (sociosList.length === 0) {
    issues.push("Nenhum sócio cadastrado");
  } else {
    const ativos = sociosList.filter((s: any) => (s.isAtivo ?? 1) === 1);
    const total = ativos.reduce((acc: number, s: any) => acc + Number(s.percentualParticipacao || 0), 0);
    if (Math.round(total * 100) !== 10000) {
      issues.push(`Soma de participações = ${total.toFixed(2)}% (esperado 100%)`);
    }
  }

  const data = {
    cadastroOk: issues.length === 0,
    issues,
    sociosCount: sociosList.length,
    capitalSocial: soc.capitalSocial,
  };

  return {
    ok: issues.length === 0,
    summary: issues.length === 0
      ? `Dados da sociedade ${soc.razaoSocial} validados (${sociosList.length} sócios).`
      : `Cadastro com ${issues.length} pendência(s): ${issues.slice(0, 3).join("; ")}`,
    data,
    warning: issues.length > 0 ? "Cadastro incompleto — ajuste antes de prosseguir." : undefined,
  };
};

// ─── SKILL 2: solicitar_documentos_cliente ───────────────────────────────────
const solicitarDocumentosCliente: SkillHandler = async (ctx, scope) => {
  const proc = scope.processo;
  const pendentes = scope.tarefas.filter((t: any) =>
    t.tipo === "upload" &&
    t.status !== "concluido" &&
    t.aplicavel !== false,
  );
  if (pendentes.length === 0) {
    return { ok: true, summary: "Nenhum documento pendente para solicitar." };
  }

  const lista = pendentes.map((t: any) => `• ${t.titulo}`).join("\n");
  const recipients: string[] = [];
  if (proc.solicitanteId) recipients.push(proc.solicitanteId);
  if (proc.analistaResponsavelId && proc.analistaResponsavelId !== proc.solicitanteId) {
    recipients.push(proc.analistaResponsavelId);
  }

  const channel = (proc.clienteContatoPreferido as any) || "inapp";
  const safeChannel: "inapp" | "whatsapp" | "email" =
    channel === "ambos" ? "email" : (channel as any);

  const result = await sendNotification(ctx.tenantId, {
    channel: safeChannel,
    recipients,
    title: `Documentos pendentes — ${proc.titulo}`,
    message: `Olá! Para dar continuidade ao processo "${proc.titulo}" precisamos dos documentos:\n\n${lista}\n\nProcesso: ${proc.processNumber}`,
    type: "info",
    sourceType: "processo_societario",
    sourceId: proc.id,
  });

  return {
    ok: true,
    summary: `Solicitação enviada (${result.channel}${result.fallback ? " — fallback in-app" : ""}) para ${recipients.length} destinatário(s).`,
    data: { canal: result.channel, fallback: result.fallback ?? false, documentos: pendentes.map((t: any) => t.titulo) },
    notifiedRecipients: recipients,
  };
};

// ─── SKILL 3: validar_documentos_recebidos ───────────────────────────────────
const validarDocumentosRecebidos: SkillHandler = async (ctx, scope) => {
  const tarefa = ctx.triggerTarefa
    ?? scope.tarefas.find((t: any) => t.id === ctx.tarefaId)
    ?? scope.tarefas
      .filter((t: any) => t.tipo === "upload" && t.status === "concluido" && t.dadosColetadosJson?.path)
      .sort((a: any, b: any) => (b.concluidoAt?.getTime?.() ?? 0) - (a.concluidoAt?.getTime?.() ?? 0))[0];

  if (!tarefa) return { ok: false, summary: "Nenhum upload concluído para validar." };
  const path = tarefa.dadosColetadosJson?.path as string | undefined;
  if (!path) return { ok: false, summary: "Tarefa sem path de upload." };

  let texto = "";
  let erro: string | null = null;
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(path);
    const [meta] = await file.getMetadata();
    const mime = (meta?.contentType as string) || tarefa.dadosColetadosJson?.mime || "application/octet-stream";
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    const out = await extractText(buffer, mime, tarefa.dadosColetadosJson?.name || "upload", ctx.tenantId);
    texto = out.text || "";
    if (out.status === "failed") erro = out.errorMessage || "extract_failed";
  } catch (e: any) {
    erro = e?.message || String(e);
  }

  const valido = !erro && texto.trim().length >= 50;
  const summary = erro
    ? `Falha ao validar documento: ${erro}`
    : valido
      ? `Documento validado (${texto.length} chars extraídos).`
      : `Documento ilegível ou muito curto (${texto.length} chars).`;

  return {
    ok: valido,
    summary,
    data: {
      tarefaId: tarefa.id,
      titulo: tarefa.titulo,
      caracteresExtraidos: texto.length,
      erro,
    },
    warning: valido ? undefined : "Considere reanexar — extração ficou abaixo do mínimo.",
  };
};

// ─── SKILL 4: gerar_minuta ───────────────────────────────────────────────────
const gerarMinuta: SkillHandler = async (ctx, scope) => {
  const proc = scope.processo;
  const soc = scope.sociedade;
  if (!soc) return { ok: false, summary: "Sociedade não encontrada." };

  const sociosList = await db
    .select()
    .from(socios)
    .where(and(eq(socios.tenantId, ctx.tenantId), eq(socios.sociedadeId, soc.id)));

  const sociosTxt = sociosList
    .map((s: any) => `- ${s.nome} (${s.qualificacao ?? "sócio"}, ${s.cpfCnpj ?? "—"}): ${Number(s.percentualParticipacao || 0).toFixed(2)}%`)
    .join("\n");

  const prompt = `Você é um advogado societário. Gere uma MINUTA inicial em português jurídico formal para o processo abaixo. Use cláusulas numeradas. Retorne APENAS o texto da minuta em Markdown.

# Processo
- Número: ${proc.processNumber}
- Tipo: ${proc.tipoProcesso}${proc.subtipo ? ` / ${proc.subtipo}` : ""}
- Título: ${proc.titulo}
- Descrição: ${proc.descricao || "(sem descrição)"}

# Sociedade
- Razão social: ${soc.razaoSocial}
- CNPJ: ${soc.cnpj || "—"}
- Natureza jurídica: ${soc.naturezaJuridica || "—"}
- Capital social: R$ ${soc.capitalSocial || "0"}
- Objeto social: ${soc.objetoSocial || "—"}
- Sede: ${soc.enderecoCidade || "—"}/${soc.enderecoUf || "—"}

# Quadro societário
${sociosTxt || "(sem sócios cadastrados)"}

Retorne a minuta em Markdown, pronta para revisão por advogado.`;

  let conteudo = "";
  try {
    // Task #48 — orquestrador (`societario:gerar_minuta`). Cliente é dado
    // sensível (CNPJ/sócios), então `data_sensitive` força Ollama local.
    const orch = await runWithOrchestration(
      "societario:gerar_minuta",
      ctx.tenantId,
      { sensitivity: "data_sensitive" },
      (cb) => callChatLLM(cb, { systemPrompt: "", userPrompt: prompt, maxTokens: 4096, signal: cb.signal }),
    );
    conteudo = orch.data.trim();
  } catch (e: any) {
    return { ok: false, summary: `Falha ao chamar LLM: ${e?.message || e}` };
  }
  if (!conteudo) return { ok: false, summary: "LLM retornou conteúdo vazio." };

  const titulo = `Minuta — ${proc.titulo} (${proc.processNumber})`;
  const [doc] = await db
    .insert(documentosSocietarios)
    .values({
      tenantId: ctx.tenantId,
      sociedadeId: soc.id,
      tipo: "template",
      titulo,
      descricao: `Minuta gerada automaticamente pelo agente para o processo ${proc.processNumber}.`,
      conteudoMarkdown: conteudo,
      mimeType: "text/markdown",
      tamanhoBytes: Buffer.byteLength(conteudo, "utf8"),
      uploadedBy: ctx.userId,
      geradoPorAgente: true,
    })
    .returning();

  // Cria tarefa de revisão na etapa atual (em_elaboracao)
  const ordem = (scope.tarefas
    .filter((t: any) => t.etapa === proc.colunaAtual)
    .reduce((m: number, t: any) => Math.max(m, t.ordem), 0)) + 1;

  const [revisao] = await db
    .insert(processoTarefas)
    .values({
      tenantId: ctx.tenantId,
      processoId: proc.id,
      etapa: proc.colunaAtual,
      ordem,
      titulo: `Revisar minuta gerada pelo agente`,
      descricao: `Documento: ${titulo}. Revise, ajuste e aprove antes de avançar.`,
      executorType: "analista",
      isRequired: true,
      bloqueiaAvanco: true,
      tipo: "approval",
      tarefaKey: `revisar_minuta_${doc.id.slice(0, 8)}`,
      aplicavel: true,
    })
    .returning();

  return {
    ok: true,
    summary: `Minuta gerada (${conteudo.length} chars) e tarefa de revisão criada.`,
    data: { documentoId: doc.id, titulo, caracteres: conteudo.length, revisaoTarefaId: revisao.id },
    createdTarefaIds: [revisao.id],
  };
};

// ─── SKILL 5: lembrar_documentos_pendentes ──────────────────────────────────
const lembrarDocumentosPendentes: SkillHandler = async (ctx, scope) => {
  const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
  const agora = Date.now();
  const candidatos = scope.tarefas.filter((t: any) =>
    t.tipo === "upload" &&
    t.status !== "concluido" &&
    t.aplicavel !== false &&
    (!t.lastReminderAt || agora - new Date(t.lastReminderAt).getTime() >= TRES_DIAS_MS) &&
    new Date(t.createdAt).getTime() <= agora - TRES_DIAS_MS,
  );
  if (candidatos.length === 0) {
    return { ok: true, summary: "Nada a lembrar (nenhum upload >3 dias sem ação)." };
  }

  const proc = scope.processo;
  const recipients: string[] = [];
  if (proc.solicitanteId) recipients.push(proc.solicitanteId);
  if (proc.analistaResponsavelId && proc.analistaResponsavelId !== proc.solicitanteId) {
    recipients.push(proc.analistaResponsavelId);
  }
  const channel = (proc.clienteContatoPreferido as any) || "inapp";
  const safeChannel: "inapp" | "whatsapp" | "email" =
    channel === "ambos" ? "email" : (channel as any);

  const lista = candidatos.map((t: any) => `• ${t.titulo}`).join("\n");
  await sendNotification(ctx.tenantId, {
    channel: safeChannel,
    recipients,
    title: `Lembrete: documentos pendentes — ${proc.titulo}`,
    message: `Ainda aguardamos os documentos abaixo no processo ${proc.processNumber}:\n\n${lista}`,
    type: "warning",
    sourceType: "processo_societario",
    sourceId: proc.id,
  });

  await db
    .update(processoTarefas)
    .set({ lastReminderAt: new Date() })
    .where(and(
      eq(processoTarefas.tenantId, ctx.tenantId),
      eq(processoTarefas.processoId, proc.id),
      sql`${processoTarefas.id} = ANY(${candidatos.map((t: any) => t.id)})`,
    ));

  return {
    ok: true,
    summary: `Lembrete enviado para ${recipients.length} destinatário(s) sobre ${candidatos.length} documento(s).`,
    data: { documentos: candidatos.map((t: any) => t.titulo) },
    notifiedRecipients: recipients,
  };
};

// ─── SKILL 6: atualizar_pipeline (auto-advance com loop guard) ──────────────
const atualizarPipeline: SkillHandler = async (ctx, scope) => {
  const proc = scope.processo;
  const cfg = scope.config;
  if (!cfg) return { ok: false, summary: "Configuração de pipeline não encontrada." };

  const colunas: any[] = (cfg.colunas as any[]) || [];
  const idx = colunas.findIndex((c) => c.id === proc.colunaAtual);
  const next = idx >= 0 && idx < colunas.length - 1 ? colunas[idx + 1] : null;
  if (!next) return { ok: true, summary: "Processo já está na última coluna." };

  const restamObrig = scope.tarefas.filter((t: any) =>
    t.etapa === proc.colunaAtual &&
    t.isRequired === true &&
    t.bloqueiaAvanco === true &&
    t.aplicavel !== false &&
    t.status !== "concluido",
  );
  if (restamObrig.length > 0) {
    return { ok: false, summary: `Etapa atual ainda tem ${restamObrig.length} obrigatória(s) pendente(s).` };
  }

  const guardOk = await autoAdvanceLoopGuard(ctx.tenantId, proc.id);
  if (!guardOk) {
    return {
      ok: false,
      summary: "Loop guard: já houveram 5 auto-advances na última hora; pulando.",
      warning: "Verifique configuração — possível loop.",
    };
  }

  const colDe = proc.colunaAtual;
  const updates: any = { colunaAtual: next.id, updatedAt: new Date() };
  if (next.id === "concluido") {
    updates.status = "concluido";
    updates.dataConclusao = new Date();
  }

  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(processosSocietarios)
      .set(updates)
      .where(and(
        eq(processosSocietarios.tenantId, ctx.tenantId),
        eq(processosSocietarios.id, proc.id),
        eq(processosSocietarios.colunaAtual, colDe),
      ))
      .returning({ id: processosSocietarios.id });
    if (rows.length === 0) return false;
    await tx.insert(processoMovimentacoes).values({
      tenantId: ctx.tenantId,
      processoId: proc.id,
      colunaDe: colDe,
      colunaPara: next.id,
      movidoPor: ctx.userId,
      movidoPorAgente: true,
      motivo: `auto_advance via skill (source=${ctx.source})`,
    });
    return true;
  });

  if (!moved) return { ok: false, summary: "Coluna mudou durante a operação; nada a fazer." };

  return {
    ok: true,
    summary: `Processo avançado de '${colDe}' para '${next.id}'.`,
    movedColumn: { de: colDe, para: next.id },
  };
};

// ─── Registry ────────────────────────────────────────────────────────────────
export const SKILLS: Record<SkillKey, SkillDef> = {
  verificar_dados_empresa: {
    key: "verificar_dados_empresa",
    tarefaKeys: ["verificar_dados", "verificar_dados_empresa"],
    handler: verificarDadosEmpresa,
  },
  solicitar_documentos_cliente: {
    key: "solicitar_documentos_cliente",
    tarefaKeys: ["solicitar_documentos", "solicitar_documentos_cliente"],
    handler: solicitarDocumentosCliente,
  },
  validar_documentos_recebidos: {
    key: "validar_documentos_recebidos",
    tarefaKeys: [],
    handler: validarDocumentosRecebidos,
  },
  gerar_minuta: {
    key: "gerar_minuta",
    tarefaKeys: ["elaborar_minuta", "elaborar_contrato", "gerar_minuta"],
    handler: gerarMinuta,
  },
  lembrar_documentos_pendentes: {
    key: "lembrar_documentos_pendentes",
    tarefaKeys: [],
    handler: lembrarDocumentosPendentes,
  },
  atualizar_pipeline: {
    key: "atualizar_pipeline",
    tarefaKeys: [],
    handler: atualizarPipeline,
  },
};

export function skillForTarefaKey(tarefaKey?: string | null): SkillKey | null {
  if (!tarefaKey) return null;
  for (const def of Object.values(SKILLS)) {
    if (def.tarefaKeys.includes(tarefaKey)) return def.key;
  }
  return null;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────
/**
 * Executa uma skill respeitando o gate dual-mode:
 *   - source='manual': sempre executa (botão explícito).
 *   - source='hook' | 'cron': só executa se modoOperacao !== 'manual'.
 *
 * Persiste autoExecutionResult quando ctx.tarefaId estiver presente.
 * Erros são capturados e devolvidos como SkillResult { ok:false }.
 */
export async function dispatchSkill(skill: SkillKey, ctx: SkillCtx): Promise<SkillResult> {
  const def = SKILLS[skill];
  if (!def) return { ok: false, summary: `Skill desconhecida: ${skill}` };

  const scope = await loadScope(ctx.tenantId, ctx.processoId);
  if (!scope) return { ok: false, summary: "Processo não encontrado." };

  if (ctx.source !== "manual") {
    const modo = String(scope.processo.modoOperacao || "assistido");
    if (modo === "manual") {
      return { ok: false, summary: `Modo 'manual': skill '${skill}' só executa via botão explícito.` };
    }
  }

  let result: SkillResult;
  try {
    result = await def.handler(ctx, scope);
  } catch (e: any) {
    console.error(`[pipeline/skill] ${skill} falhou:`, e);
    result = { ok: false, summary: `Erro inesperado: ${e?.message || e}` };
  }

  await recordExecution(ctx.tenantId, ctx.processoId, ctx.tarefaId ?? null, skill, ctx.source, result);

  // Se a skill foi bem-sucedida E está vinculada a uma tarefaKey específica via hook/manual,
  // marcamos a tarefa como concluída automaticamente.
  if (result.ok && ctx.tarefaId) {
    await db
      .update(processoTarefas)
      .set({
        status: "concluido",
        concluidoAt: new Date(),
        concluidoBy: ctx.userId,
        concluidoNotes: `[agente] ${result.summary}`,
      })
      .where(and(
        eq(processoTarefas.tenantId, ctx.tenantId),
        eq(processoTarefas.id, ctx.tarefaId),
        sql`${processoTarefas.status} != 'concluido'`,
      ));
    result.closedTarefaIds = [...(result.closedTarefaIds ?? []), ctx.tarefaId];
  }

  return result;
}

// ─── Cron: lembretes diários ─────────────────────────────────────────────────
/**
 * Roda lembrar_documentos_pendentes em todos os processos não-manual com
 * uploads pendentes >3 dias.
 */
export async function runLembretesDiarios(opts?: { tenantId?: string }): Promise<{ scanned: number; sent: number }> {
  const conds = [
    eq(processosSocietarios.status, "ativo"),
    sql`${processosSocietarios.modoOperacao} != 'manual'`,
  ];
  if (opts?.tenantId) conds.push(eq(processosSocietarios.tenantId, opts.tenantId));
  const procs = await db
    .select({ id: processosSocietarios.id, tenantId: processosSocietarios.tenantId, modo: processosSocietarios.modoOperacao })
    .from(processosSocietarios)
    .where(and(...conds));

  let sent = 0;
  for (const p of procs) {
    const r = await dispatchSkill("lembrar_documentos_pendentes", {
      tenantId: p.tenantId,
      processoId: p.id,
      userId: null,
      source: "cron",
    });
    if (r.ok && (r.notifiedRecipients?.length ?? 0) > 0) sent++;
  }
  return { scanned: procs.length, sent };
}
