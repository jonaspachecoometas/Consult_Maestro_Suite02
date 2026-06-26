import { db } from "./db";
import {
  superAgentSessions,
  superAgentMessages,
  projects,
  agentDefinitions,
  type SuperAgentMessage,
} from "@shared/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { runWithOrchestration } from "./agentService";
import { toolRegistry, type ToolContext as RegistryToolContext } from "./mcp/toolRegistry";

const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 2048;

// MCP Hub Sprint 1 — tools moved to server/mcp/registerCoreTools.ts.
// Local alias kept for readability; the actual context type lives in the registry.
type ToolContext = RegistryToolContext;

export type StepEvent =
  | { kind: "iteration"; iteration: number }
  | { kind: "tool_call"; name: string; input: any }
  | { kind: "tool_result"; name: string; ok: boolean; summary: string }
  | { kind: "final"; text: string }
  | { kind: "done"; assistantContent: string; toolsUsed: Array<{ name: string }>; tokensInput: number; tokensOutput: number; aiSource: "tenant" | "platform" }
  | { kind: "error"; message: string };

function summarizeResult(name: string, result: any): { ok: boolean; summary: string } {
  if (result?.error) return { ok: false, summary: String(result.error).slice(0, 200) };
  if (name === "list_projects" || name === "list_clients") {
    return { ok: true, summary: `${result?.count ?? 0} resultado(s)` };
  }
  if (name === "get_project_detail") {
    return { ok: true, summary: result?.project?.name ? `Projeto: ${result.project.name}` : "Detalhe carregado" };
  }
  if (name === "read_frappe_doc") {
    return { ok: true, summary: `${result?.doctype}: ${result?.count ?? 0} registro(s)` };
  }
  if (name === "search_brain") {
    return { ok: true, summary: `Cérebro: ${result?.count ?? 0} item(ns) relevante(s)` };
  }
  return { ok: true, summary: "ok" };
}

async function buildSystemPrompt(ctx: ToolContext, projectName: string | null, agentDef: typeof agentDefinitions.$inferSelect | null): Promise<string> {
  const baseLines: string[] = [];

  if (agentDef) {
    baseLines.push(`# Persona: ${agentDef.name}`);
    if (agentDef.description) baseLines.push(agentDef.description);
    baseLines.push("");
    baseLines.push(agentDef.systemPrompt);
    baseLines.push("");
    baseLines.push("---");
    baseLines.push("Você também tem acesso às ferramentas padrão do Super Agente da Arcádia (list_projects, list_clients, get_project_detail, read_frappe_doc, search_brain). Use-as quando precisar de dados do tenant.");
  } else {
    baseLines.push(
      "Você é o Super Agente da Arcádia Consulting — copiloto de consultoria.",
      "Responda em português brasileiro, usando Markdown, de forma direta e acionável.",
      "Sempre que precisar de dados (projetos, demandas, clientes, ERP), USE as ferramentas — não invente.",
      "Se uma ferramenta retornar erro ou o tenant não tiver Frappe, informe isso honestamente ao usuário.",
      "Cite IDs de projetos/clientes quando relevante. Para datas, use formato DD/MM/YYYY.",
    );
  }

  baseLines.push(
    "",
    "## Cérebro de Conhecimento",
    "Você tem acesso ao Cérebro de Conhecimento deste tenant via tool `search_brain` — ele indexa documentação interna, requisitos, metodologia e histórico de projetos do tenant.",
    "ANTES de responder perguntas sobre o projeto, cliente, requisitos, processos ou metodologia, chame `search_brain` com a pergunta do usuário (ou termos-chave) para recuperar contexto relevante. Use o resultado para enriquecer e fundamentar sua resposta. Se a busca retornar 0 itens, informe brevemente e siga com seu melhor conhecimento.",
    "O escopo da busca é restrito ao tenant atual — nunca exponha dados de outros tenants.",
  );

  // T005: injetar contexto de credenciais, skills e aprovações configuradas no agente.
  if (agentDef) {
    const capabilityLines: string[] = [];

    // Credenciais vinculadas — buscar nomes no banco (sem senha), com isolamento por tenant.
    if (agentDef.linkedCredentialIds && agentDef.linkedCredentialIds.length > 0 && ctx.tenantId) {
      try {
        const { webCredentials } = await import("@shared/schema");
        const { inArray, and } = await import("drizzle-orm");
        const creds = await db
          .select({ id: webCredentials.id, name: webCredentials.name, system: webCredentials.system })
          .from(webCredentials)
          .where(and(
            inArray(webCredentials.id, agentDef.linkedCredentialIds),
            eq(webCredentials.tenantId, ctx.tenantId),
          ));
        if (creds.length > 0) {
          capabilityLines.push("## Credenciais de sistemas externos disponíveis");
          capabilityLines.push("Você pode fazer login nos seguintes sistemas usando a tool browser_login:");
          creds.forEach((c) => capabilityLines.push(`- ${c.system}: ${c.name} (use browser_login com credentialId='${c.id}')`));
          capabilityLines.push("");
        }
      } catch (e: any) {
        console.warn("[super-agent] failed to load credential names:", e?.message);
      }
    }

    // Browser skills habilitadas.
    if (agentDef.enabledSkillNames && agentDef.enabledSkillNames.length > 0) {
      capabilityLines.push("## Browser skills disponíveis para execução direta");
      capabilityLines.push("Use browser_run_skill para executar qualquer uma dessas skills gravadas:");
      agentDef.enabledSkillNames.forEach((name) => capabilityLines.push(`- ${name}`));
      capabilityLines.push("");
    }

    // Ações que requerem aprovação humana.
    if (agentDef.requiredApprovals && agentDef.requiredApprovals.length > 0) {
      const approvalLabels: Record<string, string> = {
        emit_fiscal_doc: "emissão de documentos fiscais",
        send_email: "envio de e-mails",
        submit_form: "submissão de formulários",
        browser_click_confirm: "cliques de confirmação em sistemas externos",
      };
      const labels = agentDef.requiredApprovals.map((a) => approvalLabels[a] || a).join(", ");
      capabilityLines.push("## Aprovação humana obrigatória");
      capabilityLines.push(`ANTES de executar as seguintes ações, você DEVE usar request_approval: ${labels}.`);
      capabilityLines.push("Aguarde a aprovação antes de prosseguir. Se rejeitado, informe ao usuário.");
      capabilityLines.push("");
    }

    if (capabilityLines.length > 0) {
      baseLines.push("", ...capabilityLines);
    }
  }

  if (ctx.projectId) {
    baseLines.push(
      "",
      `## Contexto do projeto atual`,
      `Você está atuando NO CONTEXTO do projeto ID=${ctx.projectId}${projectName ? ` ("${projectName}")` : ""}.`,
      "Quando o usuário disser 'esse projeto', 'essa demanda' ou similar, refere-se a este. Use get_project_detail para puxar mais dados se precisar.",
      "",
      "### Proposta de estrutura completa (modo Plano Scrum)",
      "Quando o usuário pedir para você PROPOR / DESENHAR / CRIAR uma estrutura completa de projeto (subprojetos, sprints, PBIs, reuniões), você DEVE encerrar sua resposta com um bloco fenced no formato exato abaixo, contendo APENAS JSON válido (sem comentários, sem texto dentro do bloco além do JSON):",
      "",
      "```scrum-plan",
      "{",
      "  \"subprojetos\": [",
      "    {",
      "      \"nome\": \"string (fase do projeto, ex: 'Diagnóstico', 'Implementação', 'Go Live')\",",
      "      \"descricao\": \"string\",",
      "      \"dataInicio\": \"YYYY-MM-DD\",",
      "      \"dataFim\": \"YYYY-MM-DD\",",
      "      \"cor\": \"#3B82F6\",",
      "      \"ordem\": 0,",
      "      \"sprints\": [",
      "        {",
      "          \"nome\": \"Sprint 1 — ...\",",
      "          \"dataInicio\": \"YYYY-MM-DD\",",
      "          \"dataFim\": \"YYYY-MM-DD\",",
      "          \"objetivo\": \"Sprint Goal\",",
      "          \"pbis\": [",
      "            {",
      "              \"titulo\": \"string\",",
      "              \"descricao\": \"string\",",
      "              \"criterioAceitacao\": \"string\",",
      "              \"tipo\": \"feature|bug|improvement|task|support|analysis|documentation|training|meeting\",",
      "              \"prioridade\": \"critical|high|medium|low\",",
      "              \"storyPoints\": 5,",
      "              \"status\": \"backlog\",",
      "              \"entregavel\": \"string\",",
      "              \"responsavel\": null",
      "            }",
      "          ]",
      "        }",
      "      ]",
      "    }",
      "  ],",
      "  \"reunioes\": [",
      "    { \"titulo\": \"Sprint Planning — Sprint 1\", \"data\": \"YYYY-MM-DD\", \"horaInicio\": \"09:00\", \"participantes\": \"Time\", \"pauta\": \"...\" }",
      "  ],",
      "  \"resumo\": { \"totalSubprojetos\": 0, \"totalSprints\": 0, \"totalPbis\": 0, \"prazoTotal\": \"DD/MM → DD/MM/AAAA\" }",
      "}",
      "```",
      "",
      "REGRAS PARA O BLOCO scrum-plan:",
      "1. Cada sprint DEVE ter pelo menos 3 PBIs realistas (nunca vazio).",
      "2. Story points em escala Fibonacci: 1, 2, 3, 5, 8, 13, 21.",
      "3. Datas SEMPRE no formato YYYY-MM-DD; sprints de ~2 semanas em sequência cronológica.",
      "4. Status inicial dos PBIs sempre `backlog`.",
      "5. `tipo` e `prioridade` DEVEM usar exatamente um dos valores enumerados acima.",
      "6. Você pode (e deve) escrever ANTES do bloco uma explicação curta em texto/Markdown contextualizando a proposta. Mas o bloco ```scrum-plan``` deve vir POR ÚLTIMO e conter SÓ o JSON.",
      "7. Só inclua o bloco quando o usuário pedir uma estrutura completa. Para perguntas comuns (status, dúvidas, ajustes pontuais), responda normalmente sem o bloco.",
    );
  } else if (!agentDef) {
    baseLines.push("", "Você está em modo GLOBAL: pode consultar qualquer projeto/cliente do tenant.");
  }
  return baseLines.join("\n");
}

async function loadAgentDef(agentId: string | null, tenantId: string) {
  if (!agentId) return null;
  const [row] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentId));
  if (!row) return null;
  // Validate scope: must be global (tenantId null) or belong to this tenant
  if (row.tenantId && row.tenantId !== tenantId) return null;
  if (!row.isActive) return null;
  return row;
}

export async function listSessions(tenantId: string, userId: string, projectId?: string | null) {
  const conds: any[] = [eq(superAgentSessions.tenantId, tenantId), eq(superAgentSessions.userId, userId)];
  if (projectId !== undefined) {
    if (projectId === null) conds.push(isNull(superAgentSessions.projectId));
    else conds.push(eq(superAgentSessions.projectId, projectId));
  }
  return await db.select().from(superAgentSessions).where(and(...conds)).orderBy(desc(superAgentSessions.updatedAt)).limit(50);
}

export async function createSession(tenantId: string, userId: string, projectId: string | null, title?: string, agentId?: string | null) {
  const [row] = await db.insert(superAgentSessions).values({
    tenantId, userId, projectId,
    agentId: agentId ?? null,
    title: title || (projectId ? "Conversa do projeto" : "Nova conversa"),
  }).returning();
  return row;
}

export async function getSession(sessionId: string, tenantId: string, userId: string) {
  const [row] = await db.select().from(superAgentSessions)
    .where(and(eq(superAgentSessions.id, sessionId), eq(superAgentSessions.tenantId, tenantId), eq(superAgentSessions.userId, userId)));
  return row;
}

export async function updateSession(sessionId: string, tenantId: string, userId: string, patch: { title?: string; agentId?: string | null }) {
  const session = await getSession(sessionId, tenantId, userId);
  if (!session) return null;
  const updates: any = { updatedAt: new Date() };
  if (typeof patch.title === "string" && patch.title.trim().length > 0) updates.title = patch.title.trim().slice(0, 200);
  if (patch.agentId !== undefined) {
    if (patch.agentId === null) {
      updates.agentId = null;
    } else {
      const def = await loadAgentDef(patch.agentId, tenantId);
      if (!def) throw new Error("Agente inválido para este tenant");
      updates.agentId = def.id;
    }
  }
  const [row] = await db.update(superAgentSessions).set(updates).where(eq(superAgentSessions.id, sessionId)).returning();
  return row;
}

export async function getMessages(sessionId: string): Promise<SuperAgentMessage[]> {
  return await db.select().from(superAgentMessages)
    .where(eq(superAgentMessages.sessionId, sessionId))
    .orderBy(asc(superAgentMessages.createdAt));
}

export async function deleteSession(sessionId: string, tenantId: string, userId: string) {
  await db.delete(superAgentSessions)
    .where(and(eq(superAgentSessions.id, sessionId), eq(superAgentSessions.tenantId, tenantId), eq(superAgentSessions.userId, userId)));
}

/**
 * Send a user message to a session. Runs the tool-calling loop and persists messages.
 * Optional `onStep` callback receives live events during execution (used by SSE endpoint).
 */
// MCP Hub Sprint 2 — proactive module-init mode.
// When the frontend hook `useModuleAgent(module, context?)` fires the very
// first message of a session, it sends a sentinel of the form:
//   `__INIT_MODULE__:<module>`                       (no context)
//   `__INIT_MODULE__:<module> {"clienteId":"abc"}`    (with JSON context)
// We detect it here, persist a friendly user-facing prompt instead of the
// sentinel, and add a one-shot system instruction asking the agent to run
// a proactive analysis using whatever tools it has — passing along the
// contextual hints from the page when present.
const INIT_MODULE_RE = /^__INIT_MODULE__(?::([\w-]+))?(?:\s+(\{.*\}))?$/s;

const MODULE_LABELS: Record<string, string> = {
  control: "Arcádia Control (financeiro)",
  societario: "Societário",
  recovery: "Recovery (recuperação de empresas)",
  production: "Central de Produção",
  producao: "Central de Produção",
  pipeline: "Pipeline Societário",
  workspace: "Workspace IDE (Dev Center)",
};

// Diretivas específicas por módulo. Permite que o INIT_MODULE injete um
// "Step 0" customizado em vez do diagnóstico genérico (que pede tools de
// análise tabular). Para o workspace, o agente atua como copiloto de código:
// não inventar dados, focar em revisar/sugerir mudanças no arquivo aberto.
const MODULE_INIT_DIRECTIVES: Record<string, string> = {
  workspace: `
## Step 0 — Maestro do Workspace IDE
O usuário acabou de abrir o IDE unificado. Você é o copiloto de código deste tenant. NÃO precisa puxar números de tools de análise — em vez disso:
1. Se houver \`filePath\` no contexto, faça uma leitura curta do propósito do arquivo (1-2 frases) e ofereça 2-3 ações úteis (refatorar, gerar testes, explicar fluxo, sugerir melhoria).
2. Se NÃO houver arquivo aberto, sugira por onde começar (ex.: módulo recém-modificado, TODO recente, etc.).
3. Resposta final: máx. 4 bullets curtos. Português, tom de pair-programming.
`.trim(),
};

function buildInitModulePrompt(module: string, context: Record<string, unknown> | null): string {
  const label = MODULE_LABELS[module] || module;
  const base = `Acabei de abrir o módulo ${label}. Me dê um diagnóstico proativo do estado atual: use as ferramentas disponíveis para puxar números reais (não invente), aponte 2–3 pontos de atenção e sugira a próxima ação. Resposta em português, curta e acionável.`;
  if (context && Object.keys(context).length > 0) {
    return `${base}\n\nContexto da página:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  }
  return base;
}

export async function sendMessage(opts: {
  sessionId: string;
  tenantId: string;
  userId: string;
  userMessage: string;
  onStep?: (ev: StepEvent) => void;
}): Promise<{ assistantContent: string; toolsUsed: Array<{ name: string; input: any; result: any }>; aiSource: "tenant" | "platform"; tokensInput: number; tokensOutput: number }> {
  const onStep = opts.onStep ?? (() => {});
  const session = await getSession(opts.sessionId, opts.tenantId, opts.userId);
  if (!session) throw new Error("Sessão não encontrada");

  // ── INIT_MODULE handling ──────────────────────────────────────────────
  // If the incoming message is the sentinel, swap it for a human-friendly
  // prompt so the chat history shows something useful, and remember the
  // module so we can append a one-shot directive to the system prompt.
  let initModule: string | null = null;
  let initContext: Record<string, unknown> | null = null;
  let effectiveUserMessage = opts.userMessage;
  const m = INIT_MODULE_RE.exec(opts.userMessage.trim());
  if (m) {
    initModule = (m[1] || "global").toLowerCase();
    if (m[2]) {
      try {
        const parsed = JSON.parse(m[2]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          initContext = parsed as Record<string, unknown>;
        }
      } catch {
        // contexto malformado: ignora silenciosamente — INIT continua valendo.
      }
    }
    effectiveUserMessage = buildInitModulePrompt(initModule, initContext);
  }

  // Persist user message (the friendly version, never the raw sentinel)
  await db.insert(superAgentMessages).values({
    sessionId: opts.sessionId, role: "user", content: effectiveUserMessage,
  });

  // Auto-título: na 1ª mensagem de uma sessão ainda com título padrão, gera um
  // título legível a partir do conteúdo (ou do rótulo do módulo, se for INIT).
  const DEFAULT_TITLES = new Set(["Nova conversa", "Conversa do projeto"]);
  if (DEFAULT_TITLES.has((session.title ?? "").trim())) {
    let autoTitle = initModule
      ? (MODULE_LABELS[initModule] || opts.userMessage)
      : opts.userMessage;
    autoTitle = autoTitle.replace(/\s+/g, " ").trim().slice(0, 60);
    if (autoTitle.length > 0) {
      await db.update(superAgentSessions)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(superAgentSessions.id, opts.sessionId));
    }
  }

  // Resolve project name for system prompt
  let projectName: string | null = null;
  if (session.projectId) {
    const [p] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, session.projectId));
    projectName = p?.name ?? null;
  }
  const agentDef = await loadAgentDef(session.agentId ?? null, opts.tenantId);
  const ctx: ToolContext = { tenantId: opts.tenantId, projectId: session.projectId };
  let system = await buildSystemPrompt(ctx, projectName, agentDef);

  // One-shot module-init directive (appended to system, doesn't change history).
  if (initModule) {
    const customDirective = MODULE_INIT_DIRECTIVES[initModule];
    if (customDirective) {
      system += `\n\n${customDirective}`;
    } else {
      system += `\n\n## Step 0 — Init proativo do módulo '${initModule}'\nO usuário acabou de abrir este módulo. ANTES de qualquer texto final, USE pelo menos uma tool relevante deste módulo para puxar dados reais (ex.: 'analisar_pipeline_societario' para Societário; 'list_projects' / 'list_clients' / 'calcular_fleuriet' para Control; cenários para Recovery). Se nenhuma tool for adequada, explique honestamente. NÃO invente números. Resposta final: máx. 6 bullets ou 4 frases.`;
    }
  }

  // Fase 3: injeta arquivos anexados à sessão como contexto
  try {
    const { loadSessionFilesContext } = await import("./superAgentFiles");
    const filesCtx = await loadSessionFilesContext(opts.sessionId, opts.tenantId);
    if (filesCtx) system += filesCtx;
  } catch (e: any) {
    console.error("[super-agent] failed to load files context:", e?.message);
  }

  // Build conversation history (Anthropic format)
  const prior = await getMessages(opts.sessionId);
  const anthropicMessages: any[] = [];
  for (const m of prior) {
    if (m.role === "user") {
      anthropicMessages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.content && m.content.trim().length > 0) {
        anthropicMessages.push({ role: "assistant", content: m.content });
      }
    }
  }

  const maxTokens = agentDef?.maxTokens || MAX_TOKENS;

  // MCP Hub Sprint 1 — tools resolved from the registry. Future modules can
  // add tools without touching this file.
  const allTools = toolRegistry.listForAnthropic(opts.tenantId);
  // T005: filtrar tools se o agente definiu allowedTools (array vazio/null = todas).
  const tools = (agentDef?.allowedTools && agentDef.allowedTools.length > 0)
    ? allTools.filter((t) => agentDef!.allowedTools!.includes(t.name))
    : allTools;
  // MCP Hub Sprint 2 — security: do NOT auto-confirm. Tools with
  // `requiresConfirmation:true` (mutating: send email, create doc, validate
  // documento, etc.) must be triggered by the user via the explicit
  // `/api/mcp/tools/:name` endpoint with `userConfirmed:true`. When the
  // autonomous Super Agent loop calls one of them, the registry returns the
  // ConfirmationRequired sentinel and we surface it back to the LLM as a
  // structured tool_result so the model knows to ask the user instead of
  // pretending the action ran.
  const registryCtx: RegistryToolContext = {
    tenantId: opts.tenantId,
    userId: opts.userId,
    projectId: ctx.projectId ?? null,
    userConfirmed: false,
    meta: { sessionId: opts.sessionId },
  };

  const toolsUsed: Array<{ name: string; input: any; result: any }> = [];

  // Task #48 — orquestrador (`super_agent:tools`, anthropic-only).
  // O loop INTEIRO (até MAX_TOOL_ITERATIONS) roda dentro do mesmo callback
  // para preservar continuidade da conversa de tools (mid-flight provider
  // switch quebraria a sequência de tool_use/tool_result do Anthropic).
  // A cascata real é anthropic-only porque a tools API é específica do SDK.
  // Mantemos o orquestrador apenas para AUDITORIA em llm_decisions e
  // tracking de health/budget.
  const orch = await runWithOrchestration(
    "super_agent:tools",
    opts.tenantId,
    // Quanto mais longo o loop, mais folga damos no timeout (5 iterações × 60s).
    // forceProvider: tools API é exclusiva do Anthropic; evita prepend de Ollama
    // por budget low (que tentaria + falharia antes de cair no Anthropic).
    { sensitivity: "internal", tierTimeoutMs: 300_000, forceProvider: "anthropic" },
    async (cb) => {
      if (cb.provider !== "anthropic") {
        throw new Error(`super_agent:tools exige Anthropic; orquestrador escolheu ${cb.provider}.`);
      }
      const client = new Anthropic({ apiKey: cb.apiKey ?? undefined, baseURL: cb.baseUrl ?? undefined });
      let totalIn = 0;
      let totalOut = 0;
      let finalText = "";

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        onStep({ kind: "iteration", iteration: iter + 1 });
        // T005: aplicar llmModelOverride do agente se configurado.
        const modelToUse = agentDef?.llmModelOverride || cb.model;
        const resp: any = await client.messages.create(
          {
            model: modelToUse,
            max_tokens: maxTokens,
            system,
            tools: tools as any,
            messages: anthropicMessages,
          },
          { signal: cb.signal as any },
        );
        totalIn += resp.usage?.input_tokens || 0;
        totalOut += resp.usage?.output_tokens || 0;

        const toolUses = (resp.content || []).filter((c: any) => c.type === "tool_use");
        const textParts = (resp.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text);

        if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
          finalText = textParts.join("\n").trim();
          onStep({ kind: "final", text: finalText });
          break;
        }

        anthropicMessages.push({ role: "assistant", content: resp.content });
        const toolResultBlocks: any[] = [];
        for (const tu of toolUses) {
          onStep({ kind: "tool_call", name: tu.name, input: tu.input });
          const rawResult = await toolRegistry.execute(tu.name, tu.input, registryCtx);

          // Sprint 2 — when a mutating tool returns the ConfirmationRequired
          // sentinel, reshape it into a clear instruction so the LLM asks the
          // user to confirm explicitly (the actual mutation is only ever
          // performed via /api/mcp/tools/:name with userConfirmed:true).
          let result = rawResult;
          if (rawResult && (rawResult as any).__requires_confirmation === true) {
            result = {
              requires_user_confirmation: true,
              tool: tu.name,
              message:
                `A ferramenta '${tu.name}' faz uma ação com efeito (modifica dados ou envia mensagem). ` +
                `Eu preciso da confirmação explícita do usuário antes de executá-la. ` +
                `Pergunte ao usuário se ele aprova rodar '${tu.name}' com os parâmetros mostrados; ` +
                `não diga que a ação foi feita.`,
              requested_input: tu.input,
            };
          }

          const { ok, summary } = summarizeResult(tu.name, result);
          onStep({ kind: "tool_result", name: tu.name, ok, summary });
          toolsUsed.push({ name: tu.name, input: tu.input, result });
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }
        anthropicMessages.push({ role: "user", content: toolResultBlocks });
      }

      if (!finalText) {
        finalText = "(O agente não conseguiu produzir uma resposta final dentro do limite de iterações de ferramentas.)";
        onStep({ kind: "final", text: finalText });
      }

      return { data: finalText, tokensIn: totalIn, tokensOut: totalOut };
    },
  );

  const finalText = orch.data;
  const totalIn = orch.tokensIn;
  const totalOut = orch.tokensOut;
  // `aiSource` para o evento `done` — orquestrador não expõe tenant vs platform,
  // tratamos como "platform" (o detalhamento real fica em llm_decisions).
  const aiSource: "tenant" | "platform" = "platform";

  await db.insert(superAgentMessages).values({
    sessionId: opts.sessionId,
    role: "assistant",
    content: finalText,
    toolCalls: toolsUsed.length ? toolsUsed.map((t) => ({ name: t.name, input: t.input })) : null,
    toolResults: toolsUsed.length ? toolsUsed.map((t) => ({ name: t.name, result: t.result })) : null,
    tokensInput: totalIn,
    tokensOutput: totalOut,
  });
  await db.update(superAgentSessions)
    .set({ updatedAt: new Date() })
    .where(eq(superAgentSessions.id, opts.sessionId));

  // Task #48 — recordAiUsage agora é feito dentro de runWithOrchestration.
  // Auditoria detalhada (decisão + provider + tier + reason) fica em
  // llm_decisions; ai_usage_logs continua sendo populado pelo orquestrador.

  onStep({
    kind: "done",
    assistantContent: finalText,
    toolsUsed: toolsUsed.map((t) => ({ name: t.name })),
    tokensInput: totalIn,
    tokensOutput: totalOut,
    aiSource,
  });

  return { assistantContent: finalText, toolsUsed, aiSource, tokensInput: totalIn, tokensOutput: totalOut };
}
