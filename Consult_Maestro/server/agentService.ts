import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  agentLogs,
  canvasBlocks,
  processes as processesTable,
  swotAnalyses,
  swotItems,
  erpRequirements,
  scrumBacklogItems,
  canvasPdcaItems,
  sqlQueries,
  type AgentDefinition as CustomAgentDefRow,
  type SqlQuery,
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { searchKnowledge, type KnowledgeMatch } from "./embeddingService";
import { executeSandboxQuery, getSchemaForAgent, SandboxError } from "./sqlSandbox";
import { getTenantAiSecret, PROVIDER_DEFAULTS, assertSafeBaseUrl, type AiProvider } from "./aiConfigService";
import { recordAiUsage, type AiSource } from "./mcp/usageLogger";
import { runWithOrchestration } from "./mcp/llmOrchestrator";
import { callChatLLM } from "./mcp/llmClient";

// Re-export para que sites novos importem direto de "./agentService"
export { runWithOrchestration } from "./mcp/llmOrchestrator";
export { callChatLLM } from "./mcp/llmClient";

let platformAnthropic: Anthropic | null = null;
function getPlatformAnthropic(): Anthropic {
  if (!platformAnthropic) {
    platformAnthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return platformAnthropic;
}

/**
 * Resolve which Anthropic instance + model to use for a given tenant.
 * - If tenant has anthropic configured AND active AND has a key -> use tenant's
 * - Otherwise -> fall back to platform key (env)
 * Returns also which one was used, for logging/UI.
 */
export async function resolveAnthropicForTenant(
  tenantId: string | null | undefined,
): Promise<{ client: Anthropic; model: string; source: "tenant" | "platform" }> {
  if (tenantId) {
    try {
      const secret = await getTenantAiSecret(tenantId, "anthropic");
      if (secret?.isActive && secret.apiKey) {
        const client = new Anthropic({ apiKey: secret.apiKey });
        return { client, model: secret.model || DEFAULT_MODEL, source: "tenant" };
      }
    } catch (e) {
      console.warn("[agent] failed to load tenant anthropic config, falling back to platform:", e);
    }
  }
  return { client: getPlatformAnthropic(), model: DEFAULT_MODEL, source: "platform" };
}

// ============================================================================
// MCP Hub Sprint 1 — multi-provider resolver
// ============================================================================
/**
 * Resolved provider descriptor returned by `resolveProvider()`. Carries every
 * piece of state needed to actually invoke the LLM (apiKey, baseUrl, model)
 * plus where it came from (tenant config vs platform pool) for audit/logging.
 */
export interface ResolvedAiProvider {
  provider: AiProvider;
  model: string;
  source: AiSource;
  /** API key (null for ollama). Caller is responsible for instantiating the SDK. */
  apiKey: string | null;
  /** Base URL override (Ollama, Kimi). Null = SDK default. */
  baseUrl: string | null;
  /** True if this provider was *requested* but no usable config exists anywhere. */
  unavailable: boolean;
  /** Reason when `unavailable` is true. */
  reason?: string;
}

const PLATFORM_ENV_KEYS: Record<AiProvider, string[]> = {
  anthropic: ["PLATFORM_ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  gemini: ["PLATFORM_GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY", "GEMINI_API_KEY"],
  kimi: ["PLATFORM_KIMI_API_KEY", "AI_INTEGRATIONS_KIMI_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY"],
  // Ollama is local — no platform key concept; baseUrl can come from env
  ollama: [],
};

const PLATFORM_BASEURL_ENV_KEYS: Record<AiProvider, string[]> = {
  anthropic: ["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
  gemini: [],
  kimi: ["PLATFORM_KIMI_BASE_URL", "AI_INTEGRATIONS_KIMI_BASE_URL", "KIMI_BASE_URL"],
  ollama: ["PLATFORM_OLLAMA_BASE_URL", "AI_INTEGRATIONS_OLLAMA_BASE_URL", "OLLAMA_BASE_URL"],
};

function readPlatformKey(provider: AiProvider): string | null {
  for (const k of PLATFORM_ENV_KEYS[provider]) {
    const v = process.env[k];
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}

function readPlatformBaseUrl(provider: AiProvider): string | null {
  for (const k of PLATFORM_BASEURL_ENV_KEYS[provider]) {
    const v = process.env[k];
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Validate baseUrl against the SSRF policy. Returns true if safe, false if it
 * should be rejected. Anthropic, Gemini and Kimi defaults are public hosts on
 * the allowlist, so this only matters for Ollama (or tenant overrides).
 */
async function isBaseUrlSafe(baseUrl: string | null | undefined): Promise<boolean> {
  if (!baseUrl) return true;
  try {
    await assertSafeBaseUrl(baseUrl);
    return true;
  } catch (e) {
    console.warn(`[mcp/resolveProvider] baseUrl rejected by SSRF guard: ${baseUrl} — ${(e as Error).message}`);
    return false;
  }
}

/**
 * Resolve any of the 4 supported providers for a tenant, applying the standard
 * fallback chain:
 *
 *   1. tenant_ai_configs has provider active + usable secret  → source: "tenant"
 *   2. Platform env var, in precedence order:
 *        PLATFORM_<PROVIDER>_API_KEY                (canonical platform pool)
 *        › AI_INTEGRATIONS_<PROVIDER>_API_KEY       (Replit Integration; reused
 *                                                    canonically for Anthropic)
 *        › <PROVIDER>_API_KEY                       (legacy/bare)
 *      → source: "platform"
 *   3. Otherwise unavailable=true with a friendly reason — caller decides
 *      whether to error out or try a different provider.
 *
 * Every returned baseUrl passes through the same SSRF guard used by
 * `aiConfigService.assertSafeBaseUrl()` (private/local hosts blocked unless
 * `ALLOW_PRIVATE_AI=1`).
 *
 * Contract: NEVER throws. Always returns a descriptor — callers MUST check
 * `.unavailable` and decide whether to surface the `.reason` to the user, fall
 * back to another provider, or fail with their own error. This is intentional:
 * a non-throwing resolver lets multi-provider chains compose cleanly.
 *
 * Logging note: usage telemetry (`ai_usage_logs`) is recorded at the LLM
 * invocation site (where token counts are known), NOT inside this resolver.
 * Each new call site must invoke `recordAiUsage()` after the SDK call.
 */
export async function resolveProvider(
  tenantId: string | null | undefined,
  provider: AiProvider,
): Promise<ResolvedAiProvider> {
  const defaults = PROVIDER_DEFAULTS[provider];

  // 1. Tenant config
  if (tenantId) {
    try {
      const secret = await getTenantAiSecret(tenantId, provider);
      if (secret?.isActive) {
        const hasKey = !!secret.apiKey;
        const hasBase = !!secret.baseUrl;
        const usable = provider === "ollama" ? hasBase : hasKey;
        if (usable) {
          const baseUrl = secret.baseUrl ?? defaults.defaultBaseUrl ?? null;
          if (await isBaseUrlSafe(baseUrl)) {
            return {
              provider,
              model: secret.model || defaults.defaultModel,
              source: "tenant",
              apiKey: secret.apiKey,
              baseUrl,
              unavailable: false,
            };
          }
          // Tenant baseUrl unsafe → skip and try platform pool
        }
      }
    } catch (e) {
      console.warn(`[mcp/resolveProvider] tenant ${provider} config load failed, falling back:`, e);
    }
  }

  // 2. Platform pool — DB (platform_ai_configs) tem prioridade sobre env vars
  try {
    const { getPlatformAiSecret } = await import("./aiConfigService");
    const dbSecret = await getPlatformAiSecret(provider);
    if (dbSecret?.isActive) {
      const hasKey = !!dbSecret.apiKey;
      const hasBase = !!dbSecret.baseUrl;
      const usable = provider === "ollama" ? hasBase : hasKey;
      if (usable) {
        const baseUrl = dbSecret.baseUrl ?? defaults.defaultBaseUrl ?? null;
        if (await isBaseUrlSafe(baseUrl)) {
          return {
            provider,
            model: dbSecret.model || defaults.defaultModel,
            source: "platform",
            apiKey: dbSecret.apiKey,
            baseUrl,
            unavailable: false,
          };
        }
      }
    }
  } catch (e) {
    console.warn(`[mcp/resolveProvider] platform ${provider} DB config load failed, falling back to env:`, e);
  }

  // 2b. Platform pool — env vars (PLATFORM_*, AI_INTEGRATIONS_*, etc.)
  const platformKey = readPlatformKey(provider);
  const platformBase = readPlatformBaseUrl(provider) ?? defaults.defaultBaseUrl ?? null;
  const platformBaseSafe = await isBaseUrlSafe(platformBase);

  if (provider === "ollama") {
    // Ollama needs a baseUrl to be considered usable
    if (platformBase && platformBaseSafe) {
      return {
        provider,
        model: defaults.defaultModel,
        source: "platform",
        apiKey: null,
        baseUrl: platformBase,
        unavailable: false,
      };
    }
  } else if (platformKey && platformBaseSafe) {
    return {
      provider,
      model: defaults.defaultModel,
      source: "platform",
      apiKey: platformKey,
      baseUrl: platformBase,
      unavailable: false,
    };
  }

  // 3. Nothing usable
  return {
    provider,
    model: defaults.defaultModel,
    source: "platform",
    apiKey: null,
    baseUrl: platformBaseSafe ? platformBase : null,
    unavailable: true,
    reason: provider === "ollama"
      ? "Configure um endpoint Ollama em Configurações de IA do tenant (endereço local exige ALLOW_PRIVATE_AI=1 no servidor)."
      : `Sem credencial ${provider} usável no tenant nem no pool da plataforma. Configure em Configurações de IA.`,
  };
}

// Backwards-compat: agents that haven't been migrated still call getAnthropic()
function getAnthropic(): Anthropic {
  return getPlatformAnthropic();
}

// Use Claude 4 Sonnet (released May 2025); the user can change via env if desired.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 4096);

export interface AgentDefinition {
  type: string;
  systemPrompt: string;
}

export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  diagnostic_canvas: {
    type: "diagnostic_canvas",
    systemPrompt:
      "Você é um consultor sênior da Arcádia Consulting especializado em diagnóstico empresarial usando o Business Model Canvas expandido em 4 níveis (Intenção, Evidências, Sistêmico, Transformação). Analise as informações fornecidas e produza um diagnóstico estruturado, objetivo e acionável em português brasileiro. Use Markdown.",
  },
  process_recommendation: {
    type: "process_recommendation",
    systemPrompt:
      "Você é um especialista em melhoria de processos (BPM, Lean, Six Sigma). Dada uma descrição de processo e seus problemas, sugira recomendações práticas, KPIs para medir e um plano PDCA. Responda em português brasileiro com Markdown.",
  },
  swot_analysis: {
    type: "swot_analysis",
    systemPrompt:
      "Você é um analista estratégico. Produza uma análise SWOT estruturada (Forças, Fraquezas, Oportunidades, Ameaças) com priorização e cruzamentos (FO, FA, DO, DA). Responda em português brasileiro com Markdown.",
  },
  erp_gap_analysis: {
    type: "erp_gap_analysis",
    systemPrompt:
      "Você é um especialista em sistemas ERP e gap analysis. Avalie aderência de processos a capacidades do ERP, classifique gaps por criticidade e proponha estratégias (parametrização, customização, processo manual). Responda em português brasileiro com Markdown.",
  },
  generic: {
    type: "generic",
    systemPrompt:
      "Você é um consultor de negócios da Arcádia Consulting. Responda de forma clara, objetiva e acionável em português brasileiro. Use Markdown.",
  },
};

function buildContextBlock(matches: KnowledgeMatch[]): string {
  if (matches.length === 0) return "";
  const ctx = matches
    .map(
      (m, i) =>
        `[#${i + 1}] (${m.type}) ${m.title}\n${(m.content || "").slice(0, 1500)}`,
    )
    .join("\n\n---\n\n");
  return `\n\n## Conhecimento relevante recuperado da base\n${ctx}\n\n## Instruções\nUse o conhecimento acima quando apropriado. Cite as fontes como [#1], [#2] etc. quando usar. Se nada for relevante, responda apenas com base no seu conhecimento próprio.\n`;
}

export interface RunAgentParams {
  agentType: string;
  prompt: string;
  systemPromptOverride?: string;
  tenantId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  topK?: number;
  useKnowledge?: boolean;
}

export interface AgentRunResult {
  response: string;
  sources: KnowledgeMatch[];
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
  logId: string | null;
}

export async function runAgent(params: RunAgentParams): Promise<AgentRunResult> {
  const start = Date.now();
  const def = AGENT_REGISTRY[params.agentType] || AGENT_REGISTRY.generic;
  const systemPrompt = params.systemPromptOverride || def.systemPrompt;
  const useKnowledge = params.useKnowledge !== false;

  let sources: KnowledgeMatch[] = [];
  if (useKnowledge) {
    try {
      sources = await searchKnowledge(params.prompt, {
        tenantId: params.tenantId ?? null,
        topK: params.topK ?? 5,
      });
    } catch (err) {
      console.warn("[agent] knowledge search failed, continuing without context:", err);
    }
  }

  const fullSystem = systemPrompt + buildContextBlock(sources);

  let response = "";
  let tokensInput = 0;
  let tokensOutput = 0;
  let logId: string | null = null;
  let status: "success" | "error" = "success";
  let errorMessage: string | null = null;

  let usedSource: AiSource = "platform";
  let usedModel = DEFAULT_MODEL;
  let usedProvider: AiProvider = "anthropic";
  try {
    // Task #47 — Roteamento via orquestrador (cascata cloud→cloud→ollama).
    // Mantém compat: se a cascata escolher anthropic, o comportamento é o mesmo
    // de antes; se anthropic falhar, cai para gemini/ollama automaticamente.
    const orch = await runWithOrchestration(
      `agent:${params.agentType}`,
      params.tenantId ?? null,
      { sensitivity: "internal" },
      (cb) => callChatLLM(cb, { systemPrompt: fullSystem, userPrompt: params.prompt, maxTokens: MAX_TOKENS }),
    );
    response = orch.data;
    usedModel = orch.modelUsed;
    usedProvider = orch.providerUsed;
    usedSource = "platform"; // recorded inside orchestrator already
    // Tokens vêm do orquestrador (extraídos pelo callChatLLM) — preserva
    // a fidelidade do agent_logs sem duplicar o usage tracking.
    tokensInput = orch.tokensIn;
    tokensOutput = orch.tokensOut;
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message || String(err);
    response = `Erro ao consultar o agente: ${errorMessage}`;
    console.error("[agent] orchestrator error:", err);
  }

  // Nota: recordAiUsage agora é chamado dentro de runWithOrchestration. Não
  // duplicamos aqui para evitar contagem em dobro no ai_usage_logs.

  const durationMs = Date.now() - start;

  try {
    const [log] = await db
      .insert(agentLogs)
      .values({
        tenantId: params.tenantId ?? null,
        projectId: params.projectId ?? null,
        userId: params.userId ?? null,
        agentType: params.agentType,
        promptSent: params.prompt.slice(0, 8000),
        responseFull: response.slice(0, 16000),
        knowledgeSourceIds: sources.map((s) => s.id),
        tokensInput,
        tokensOutput,
        durationMs,
        status,
        errorMessage,
      })
      .returning();
    logId = log?.id ?? null;
  } catch (err) {
    console.warn("[agent] failed to persist log:", err);
  }

  return { response, sources, tokensInput, tokensOutput, durationMs, logId };
}

// ─────────────────────────────────────────────────────────────────
// Custom agent runner (uses agent_definitions row built by users)
// ─────────────────────────────────────────────────────────────────

interface CollectedContext {
  canvas?: Array<{ blockType: string; level: string; content: string }>;
  processes?: Array<{ name: string; description?: string | null; status?: string | null }>;
  swot?: Array<{ title: string; type?: string | null; description?: string | null }>;
  erp?: Array<{ requirement: string; description?: string | null; adherenceStatus?: string | null }>;
  scrum?: Array<{ title: string; status?: string | null }>;
  pdca?: Array<{ title: string; status?: string | null; description?: string | null }>;
}

async function collectProjectContext(projectId: string | null): Promise<CollectedContext> {
  if (!projectId) return {};
  const ctx: CollectedContext = {};
  try {
    const cb = await db.select().from(canvasBlocks).where(eq(canvasBlocks.projectId, projectId));
    ctx.canvas = cb.slice(0, 50).map((b: any) => ({
      blockType: b.blockType,
      level: b.level,
      content: (b.content || "").slice(0, 500),
    }));
  } catch {}
  try {
    const ps = await db.select().from(processesTable).where(eq(processesTable.projectId, projectId));
    ctx.processes = ps.slice(0, 30).map((p: any) => ({
      name: p.name,
      description: (p.description || "").slice(0, 400),
      status: p.status,
    }));
  } catch {}
  try {
    const analyses = await db.select().from(swotAnalyses).where(eq(swotAnalyses.projectId, projectId));
    if (analyses.length > 0) {
      const analysisIds = analyses.map((a: any) => a.id);
      const items = await db.select().from(swotItems).where(inArray(swotItems.analysisId, analysisIds));
      ctx.swot = items.slice(0, 30).map((s: any) => ({
        title: s.title,
        type: s.type,
        description: (s.description || "").slice(0, 300),
      }));
    }
  } catch {}
  try {
    const er = await db.select().from(erpRequirements).where(eq(erpRequirements.projectId, projectId));
    ctx.erp = er.slice(0, 30).map((r: any) => ({
      requirement: r.requirement,
      description: (r.description || "").slice(0, 300),
      adherenceStatus: r.adherenceStatus,
    }));
  } catch {}
  try {
    const sb = await db.select().from(scrumBacklogItems).where(eq(scrumBacklogItems.originProjectId, projectId));
    ctx.scrum = sb.slice(0, 30).map((b: any) => ({ title: b.title, status: b.status }));
  } catch {}
  try {
    const pdca = await db.select().from(canvasPdcaItems).where(eq(canvasPdcaItems.projectId, projectId));
    ctx.pdca = pdca.slice(0, 30).map((p: any) => ({
      title: p.title,
      status: p.status,
      description: (p.description || "").slice(0, 300),
    }));
  } catch {}
  return ctx;
}

function renderContextSection(modules: string[] | null, ctx: CollectedContext): string {
  if (!modules || modules.length === 0) return "";
  const parts: string[] = [];

  if (modules.includes("canvas") && ctx.canvas?.length) {
    parts.push(
      "## CANVAS BMC\n" +
        ctx.canvas
          .map((b) => `- [${b.blockType}/${b.level}] ${b.content}`)
          .join("\n"),
    );
  }
  if (modules.includes("processes") && ctx.processes?.length) {
    parts.push(
      "## PROCESSOS\n" +
        ctx.processes
          .map((p) => `- ${p.name} (${p.status || "—"}): ${p.description || ""}`)
          .join("\n"),
    );
  }
  if (modules.includes("swot") && ctx.swot?.length) {
    parts.push(
      "## SWOT\n" +
        ctx.swot.map((s) => `- [${s.type || "—"}] ${s.title}: ${s.description || ""}`).join("\n"),
    );
  }
  if (modules.includes("erp") && ctx.erp?.length) {
    parts.push(
      "## REQUISITOS ERP\n" +
        ctx.erp
          .map((r) => `- ${r.requirement} [${r.adherenceStatus || "?"}]: ${r.description || ""}`)
          .join("\n"),
    );
  }
  if (modules.includes("scrum") && ctx.scrum?.length) {
    parts.push("## BACKLOG/SCRUM\n" + ctx.scrum.map((b) => `- [${b.status || "?"}] ${b.title}`).join("\n"));
  }
  if (modules.includes("pdca") && ctx.pdca?.length) {
    parts.push(
      "## PDCA\n" +
        ctx.pdca.map((p) => `- [${p.status || "?"}] ${p.title}: ${p.description || ""}`).join("\n"),
    );
  }
  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n") + "\n\n";
}

export interface RunCustomAgentParams {
  def: CustomAgentDefRow;
  projectId: string | null;
  tenantId: string | null;
  userId: string | null;
  prompt: string;
  isTest?: boolean;
}

export async function runCustomAgent(params: RunCustomAgentParams): Promise<AgentRunResult> {
  const start = Date.now();
  const { def } = params;

  // 1. Collect project context if any module is configured
  const ctx = await collectProjectContext(params.projectId);
  const ctxSection = renderContextSection(def.contextModules ?? null, ctx);

  // 2. RAG search using prompt as query
  let sources: KnowledgeMatch[] = [];
  try {
    sources = await searchKnowledge(params.prompt, {
      tenantId: params.tenantId ?? null,
      topK: 5,
    });
  } catch (err) {
    console.warn("[custom-agent] knowledge search failed:", err);
  }

  // 3. Build full system prompt
  const fullSystem = def.systemPrompt + ctxSection + buildContextBlock(sources);

  let response = "";
  let tokensInput = 0;
  let tokensOutput = 0;
  let logId: string | null = null;
  let status: "success" | "error" = "success";
  let errorMessage: string | null = null;

  try {
    const result = await getAnthropic().messages.create({
      model: def.llmModelOverride || DEFAULT_MODEL,
      max_tokens: def.maxTokens || MAX_TOKENS,
      system: fullSystem,
      messages: [{ role: "user", content: params.prompt }],
    });
    response = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    tokensInput = result.usage?.input_tokens || 0;
    tokensOutput = result.usage?.output_tokens || 0;
  } catch (err: any) {
    status = "error";
    errorMessage = err?.message || String(err);
    response = `Erro ao consultar o agente: ${errorMessage}`;
    console.error("[custom-agent] anthropic error:", err);
  }

  const durationMs = Date.now() - start;

  try {
    const [log] = await db
      .insert(agentLogs)
      .values({
        tenantId: params.tenantId ?? null,
        projectId: params.projectId ?? null,
        userId: params.userId ?? null,
        agentType: params.isTest ? `custom_test:${def.slug}` : `custom:${def.slug}`,
        promptSent: params.prompt.slice(0, 8000),
        responseFull: response.slice(0, 16000),
        knowledgeSourceIds: sources.map((s) => s.id),
        tokensInput,
        tokensOutput,
        durationMs,
        status,
        errorMessage,
      })
      .returning();
    logId = log?.id ?? null;
  } catch (err) {
    console.warn("[custom-agent] failed to persist log:", err);
  }

  return { response, sources, tokensInput, tokensOutput, durationMs, logId };
}

// ════════════════════════════════════════════════════════════════════
// Phase 13 — SQL Agent (BI Builder)
// Generates a SELECT statement from a natural-language prompt, runs it
// in the sandbox with tenant isolation, persists it to sql_queries and
// returns the row sample + suggested widget shape.
// ════════════════════════════════════════════════════════════════════

const SQL_AGENT_SYSTEM = `Você é um analista de dados sênior da Arcádia Consulting.
Recebe uma pergunta em linguagem natural e o esquema do banco PostgreSQL multi-tenant
da plataforma. Sua tarefa: retornar UMA query SELECT pronta para um dashboard de BI.

REGRAS OBRIGATÓRIAS:
1. Apenas SELECT (ou WITH ... SELECT). Nunca INSERT/UPDATE/DELETE/DDL.
2. SEMPRE filtrar tabelas com tenant_id usando: tenant_id = '<TENANT_ID>'
   (use o valor literal informado em "Tenant ID" abaixo, sem placeholders).
3. Use LIMIT explícito (máximo 1000).
4. Resultado precisa ser tabular e fácil de plotar — geralmente uma coluna
   categórica (eixo X) e uma ou mais numéricas (eixo Y).
5. Apelide as colunas com alias claros em snake_case ou minúsculas.
6. NÃO consulte tabelas: sessions, users, invite_tokens, agent_logs, tenant_users.

FONTE PREFERIDA — schema "analytics" (Fase 3 BI Multi-Fonte):
- Quando a pergunta envolver MÚLTIPLAS FONTES de dados (ex.: "comparar receita
  ERPNext vs Domínio", "consolidar clientes de todos os ERPs", "migração entre
  sistemas"), prefira ler de "analytics.fact_revenue" e "analytics.dim_client"
  (SCD Type 2). O schema é alimentado pelo ETL e já cuida da unificação por
  tenant_id + source_data_source_id + natural_key.
- Quando o usuário pedir uma métrica que já existe na "Semantic Layer"
  (lista no contexto abaixo), você PODE responder com o SQL gerado a
  partir dela — mas indique no campo "description" qual métrica semântica
  foi usada como base.
- Para dados que ainda só existem nas fontes operacionais (CRM nativo,
  Scrum, Diagnóstico…), continue consultando o schema "public".

FORMATO DE RESPOSTA — RETORNE APENAS JSON VÁLIDO (sem markdown, sem comentários):
{
  "sql": "SELECT ...",
  "name": "Título curto da análise",
  "description": "1 frase explicando o que a query mostra",
  "x_axis_column": "nome_coluna_categorica",
  "y_axis_columns": ["nome_coluna_numerica"],
  "suggested_widget_type": "bar_chart" | "line_chart" | "kpi_card" | "radar_chart"
}`;

function extractJson(text: string): any {
  // Try fenced ```json blocks first.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  // Find the first { ... last }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Resposta do agente não contém JSON");
  const jsonStr = candidate.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

export interface RunSqlAgentParams {
  prompt: string;
  tenantId: string;
  userId?: string | null;
  allowCrossTenant?: boolean;
}

export interface RunSqlAgentResult {
  query: SqlQuery;
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  truncated: boolean;
  suggestedWidgetType: string;
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
}

export async function runSqlAgent(params: RunSqlAgentParams): Promise<RunSqlAgentResult> {
  const start = Date.now();
  if (!params.prompt || !params.prompt.trim()) {
    throw new Error("Prompt is required");
  }
  if (!params.tenantId) {
    throw new Error("Tenant ID is required");
  }

  const schema = await getSchemaForAgent();

  // Phase 3 — inject Semantic Layer catalog so the SQL Agent prefers
  // analytics.* when answering multi-source questions.
  let semanticSummary = "";
  try {
    const { listSemanticMetrics } = await import("./bi/semantic");
    const items = listSemanticMetrics();
    semanticSummary = items.length === 0
      ? ""
      : "\n\nSEMANTIC LAYER (Fase 3) — métricas declarativas disponíveis:\n" +
        items.map((m) => `- ${m.id} [${m.module}] (widget: ${m.defaultWidget}): ${m.label} — ${m.description}`).join("\n") +
        "\n\nSchema analytics: analytics.fact_revenue, analytics.dim_client (SCD2 com is_current=1), analytics.dim_source, analytics.migration_state, analytics.dq_findings.\n";
  } catch { /* Semantic Layer ainda não disponível: prossegue sem ele. */ }

  const userMessage =
    `Tenant ID: ${params.tenantId}\n\n` +
    `Esquema do banco (PostgreSQL):\n\`\`\`\n${schema}\n\`\`\`` +
    semanticSummary +
    `\n\nPergunta: ${params.prompt}\n\n` +
    `Retorne APENAS o JSON conforme especificado.`;

  let parsed: any;
  let tokensInput = 0;
  let tokensOutput = 0;
  let response = "";
  try {
    const result = await getAnthropic().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: SQL_AGENT_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    response = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    tokensInput = result.usage?.input_tokens || 0;
    tokensOutput = result.usage?.output_tokens || 0;
    parsed = extractJson(response);
  } catch (err: any) {
    // Persist a failed log for traceability.
    await db.insert(agentLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      agentType: "sql_agent",
      promptSent: params.prompt.slice(0, 8000),
      responseFull: (response || err?.message || "").slice(0, 16000),
      knowledgeSourceIds: [],
      tokensInput,
      tokensOutput,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: err?.message || String(err),
    }).catch(() => {});
    throw new Error(`SQL agent failed: ${err?.message || err}`);
  }

  const sqlText = String(parsed?.sql || "").trim();
  if (!sqlText) throw new Error("Agent returned no SQL");

  // Execute via sandbox — this validates tenant scoping and read-only.
  let execResult;
  try {
    execResult = await executeSandboxQuery(sqlText, {
      tenantId: params.tenantId,
      allowCrossTenant: params.allowCrossTenant,
    });
  } catch (err: any) {
    await db.insert(agentLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      agentType: "sql_agent",
      promptSent: params.prompt.slice(0, 8000),
      responseFull: response.slice(0, 16000),
      knowledgeSourceIds: [],
      tokensInput,
      tokensOutput,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: `Sandbox: ${err?.message || err}`,
    }).catch(() => {});
    if (err instanceof SandboxError) throw err;
    throw new Error(`Sandbox error: ${err?.message || err}`);
  }

  const xCol = parsed?.x_axis_column || execResult.columns[0] || null;
  const yCols: string[] = Array.isArray(parsed?.y_axis_columns) && parsed.y_axis_columns.length > 0
    ? parsed.y_axis_columns
    : execResult.columns.filter((c) => c !== xCol).slice(0, 1);
  const widgetType = ["bar_chart", "line_chart", "kpi_card", "radar_chart"].includes(parsed?.suggested_widget_type)
    ? parsed.suggested_widget_type
    : "bar_chart";

  const [saved] = await db.insert(sqlQueries).values({
    tenantId: params.tenantId,
    agentPrompt: params.prompt,
    querySql: sqlText,
    name: String(parsed?.name || "Análise SQL").slice(0, 200),
    description: parsed?.description ? String(parsed.description).slice(0, 1000) : null,
    resultSample: execResult.rows.slice(0, 3),
    columns: execResult.columns,
    xAxisColumn: xCol ? String(xCol).slice(0, 100) : null,
    yAxisColumns: yCols,
    createdById: params.userId ?? null,
  }).returning();

  // Persist a success log for traceability.
  await db.insert(agentLogs).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    agentType: "sql_agent",
    promptSent: params.prompt.slice(0, 8000),
    responseFull: response.slice(0, 16000),
    knowledgeSourceIds: [],
    tokensInput,
    tokensOutput,
    durationMs: Date.now() - start,
    status: "success",
    errorMessage: null,
  }).catch(() => {});

  return {
    query: saved,
    rows: execResult.rows,
    columns: execResult.columns,
    rowCount: execResult.rowCount,
    truncated: execResult.truncated,
    suggestedWidgetType: widgetType,
    durationMs: Date.now() - start,
    tokensInput,
    tokensOutput,
  };
}

// ───────────────────────── BI Agent (Phase 13.1) ─────────────────────────
// Generates a complete dashboard layout (multiple widgets) from a natural
// language description, using the internal METRIC_CATALOG as the only
// allowed data source. No SQL is generated here — every widget points to
// an existing internal metric, so the call is read-only and safe.

const BI_AGENT_SYSTEM = `Você é um especialista em BI da Arcádia Consulting.
Sua tarefa é montar a configuração de um dashboard a partir de uma descrição em linguagem natural.

REGRAS:
- Use APENAS as métricas listadas em "MÉTRICAS DISPONÍVEIS" — nunca invente keys.
- Cada widget deve referenciar uma metricKey válida.
- Tipos de widget e tamanhos sugeridos:
  * kpi_card: número único — gridPos w=3, h=2
  * bar_chart: barras — gridPos w=6, h=4
  * line_chart: tendência — gridPos w=6, h=4
  * radar_chart: radar — gridPos w=6, h=5
- Posicione os widgets em uma grade de 12 colunas (x: 0..11). Não sobreponha; preencha esquerda→direita, depois quebre linha.
- Crie entre 2 e 6 widgets, no máximo.
- Responda APENAS com JSON válido no formato:
{
  "title": "...",
  "widgets": [
    { "type": "bar_chart", "title": "...", "metricKey": "projects_by_status", "gridPos": {"x":0,"y":0,"w":6,"h":4} }
  ]
}`;

interface RunBiAgentParams {
  prompt: string;
  tenantId: string;
  userId?: string;
}

interface BiAgentWidgetSpec {
  id: string;
  type: "kpi_card" | "bar_chart" | "line_chart" | "radar_chart";
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  dataSource: { type: "internal"; metricKey: string; metricKeys: string[] };
}

export interface RunBiAgentResult {
  title: string;
  widgets: BiAgentWidgetSpec[];
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
}

export async function runBiAgent(params: RunBiAgentParams): Promise<RunBiAgentResult> {
  const start = Date.now();
  if (!params.prompt || !params.prompt.trim()) {
    throw new Error("Prompt is required");
  }
  if (!params.tenantId) {
    throw new Error("Tenant ID is required");
  }

  const { METRIC_CATALOG } = await import("./biMetrics");
  const { listSemanticMetrics } = await import("./bi/semantic/index");
  const semanticMetrics = listSemanticMetrics();
  const validKeys = new Set<string>([
    ...METRIC_CATALOG.map((m) => m.key),
    ...semanticMetrics.map((m) => m.id),
  ]);
  const validTypes = new Set([
    "kpi_card", "bar_chart", "line_chart", "radar_chart",
    "area_chart", "pie_chart", "donut_chart", "big_number",
    "waterfall_chart", "funnel_chart", "gauge_chart",
    "mixed_timeseries", "data_table", "scatter_plot",
  ]);
  const catalogStr = [
    ...METRIC_CATALOG.map((m) => `- ${m.key} (${m.defaultWidget}, grupo "${m.group}"): ${m.label} — ${m.description}`),
    ...semanticMetrics.map((m) => `- ${m.id} (${m.defaultWidget}, módulo "${m.module}"): ${m.label} — ${m.description}`),
  ].join("\n");

  const userMessage =
    `MÉTRICAS DISPONÍVEIS:\n${catalogStr}\n\n` +
    `Pedido do usuário: ${params.prompt}\n\n` +
    `Retorne APENAS o JSON conforme especificado.`;

  let parsed: any;
  let tokensInput = 0;
  let tokensOutput = 0;
  let response = "";
  try {
    const result = await getAnthropic().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: BI_AGENT_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    response = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    tokensInput = result.usage?.input_tokens || 0;
    tokensOutput = result.usage?.output_tokens || 0;
    parsed = extractJson(response);
  } catch (err: any) {
    await db.insert(agentLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      agentType: "bi_agent",
      promptSent: params.prompt.slice(0, 8000),
      responseFull: (response || err?.message || "").slice(0, 16000),
      knowledgeSourceIds: [],
      tokensInput,
      tokensOutput,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: err?.message || String(err),
    }).catch(() => {});
    throw new Error(`BI agent failed: ${err?.message || err}`);
  }

  const rawWidgets: any[] = Array.isArray(parsed?.widgets) ? parsed.widgets : [];
  if (rawWidgets.length === 0) throw new Error("Agent returned no widgets");

  // Validate + normalize. Drop anything that does not match an allowed
  // metricKey or widget type — the agent must only emit safe configs.
  const widgets: BiAgentWidgetSpec[] = [];
  for (const w of rawWidgets.slice(0, 6)) {
    const type = String(w?.type || "").toLowerCase();
    const metricKey = String(w?.metricKey || "");
    if (!validTypes.has(type)) continue;
    if (!validKeys.has(metricKey)) continue;
    const gp = w?.gridPos || {};
    const x = Number.isFinite(+gp.x) ? Math.max(0, Math.min(11, +gp.x)) : 0;
    const y = Number.isFinite(+gp.y) ? Math.max(0, +gp.y) : widgets.length * 4;
    const wDef = type === "kpi_card" ? 3 : 6;
    const hDef = type === "kpi_card" ? 2 : type === "radar_chart" ? 5 : 4;
    const ww = Number.isFinite(+gp.w) ? Math.max(2, Math.min(12, +gp.w)) : wDef;
    const hh = Number.isFinite(+gp.h) ? Math.max(2, Math.min(8, +gp.h)) : hDef;
    // Detect semantic vs internal: semantic metric IDs are registered in
    // server/bi/semantic and conventionally contain "." (e.g. "crm.pipeline_by_stage").
    const isSemantic = semanticMetrics.some((sm) => sm.id === metricKey);
    const dataSource: any = isSemantic
      ? { type: "semantic", metricId: metricKey }
      : { type: "internal", metricKey, metricKeys: [metricKey] };
    widgets.push({
      id: crypto.randomUUID(),
      type: type as BiAgentWidgetSpec["type"],
      title: String(w?.title || metricKey).slice(0, 120),
      gridPos: { x, y, w: ww, h: hh },
      dataSource,
    });
  }

  if (widgets.length === 0) {
    throw new Error("Agent returned widgets but none referenced a valid metric");
  }

  await db.insert(agentLogs).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    agentType: "bi_agent",
    promptSent: params.prompt.slice(0, 8000),
    responseFull: response.slice(0, 16000),
    knowledgeSourceIds: [],
    tokensInput,
    tokensOutput,
    durationMs: Date.now() - start,
    status: "success",
    errorMessage: null,
  }).catch(() => {});

  return {
    title: String(parsed?.title || "Dashboard gerado por IA").slice(0, 120),
    widgets,
    durationMs: Date.now() - start,
    tokensInput,
    tokensOutput,
  };
}

// ─────────────────── Connector BI Agent (Phase 4a.1) ───────────────────
// Analyzes a real data source (Excel/REST/Postgres snapshot) and proposes
// 2–6 widgets that point back to the SAME connector with valid x/y columns.
// The widget output is structurally validated: only existing columns are
// accepted as x/y axes, only allowed widget types pass through.

const CONNECTOR_AGENT_SYSTEM = `Você é um analista de dados sênior.
Receberá uma amostra de uma planilha/API e deve propor entre 2 e 6 gráficos úteis para visualizá-la em um dashboard.

REGRAS ESTRITAS:
- Use APENAS os nomes de colunas listados em "COLUNAS DISPONÍVEIS".
- Tipos permitidos: "kpi_card" (1 número agregado), "bar_chart", "line_chart", "radar_chart".
- Para kpi_card: forneça apenas yAxisColumn (a coluna numérica a somar/contar).
- Para bar_chart/line_chart/radar_chart: forneça xAxisColumn (categoria) E yAxisColumn (valor numérico).
- Posicione widgets em uma grade de 12 colunas (x: 0..11). Sem sobreposição. Esquerda→direita, depois quebre linha.
- Tamanhos: kpi_card w=3 h=2; bar/line w=6 h=4; radar w=6 h=5.
- Títulos curtos e claros em português.
- Responda APENAS com JSON no formato:
{
  "title": "Análise de <nome>",
  "widgets": [
    { "type": "bar_chart", "title": "...", "xAxisColumn": "categoria", "yAxisColumn": "valor", "gridPos": {"x":0,"y":0,"w":6,"h":4} }
  ]
}`;

interface ConnectorWidgetSpec {
  id: string;
  type: "kpi_card" | "bar_chart" | "line_chart" | "radar_chart";
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  dataSource: {
    type: "connector";
    connectorId: string;
    xAxisColumn?: string;
    yAxisColumns?: string[];
  };
}

export interface RunConnectorAgentParams {
  dataSourceId: string;
  sourceName: string;
  rows: any[];
  prompt?: string;
  tenantId: string;
  userId?: string;
}

export interface RunConnectorAgentResult {
  title: string;
  widgets: ConnectorWidgetSpec[];
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
}

export async function runConnectorBiAgent(
  params: RunConnectorAgentParams,
): Promise<RunConnectorAgentResult> {
  const start = Date.now();
  if (!params.tenantId) throw new Error("Tenant ID is required");
  if (!params.rows || params.rows.length === 0) {
    throw new Error("A fonte não tem dados ainda. Sincronize/faça upload primeiro.");
  }

  const cols = Object.keys(params.rows[0] || {});
  if (cols.length === 0) throw new Error("Linhas sem colunas detectadas.");
  const validCols = new Set(cols);
  const validTypes = new Set([
    "kpi_card", "bar_chart", "line_chart", "radar_chart",
    "area_chart", "pie_chart", "donut_chart", "big_number",
    "waterfall_chart", "funnel_chart", "gauge_chart",
    "mixed_timeseries", "data_table", "scatter_plot",
  ]);

  const sample = params.rows.slice(0, 20);
  const userMessage =
    `FONTE: ${params.sourceName}\n` +
    `COLUNAS DISPONÍVEIS: ${cols.join(", ")}\n` +
    `AMOSTRA (${sample.length} linhas, total ${params.rows.length}):\n` +
    JSON.stringify(sample, null, 2).slice(0, 6000) +
    `\n\nPedido extra do usuário: ${params.prompt || "(nenhum — proponha o melhor dashboard automático)"}\n\n` +
    `Retorne APENAS o JSON.`;

  let parsed: any;
  let tokensInput = 0;
  let tokensOutput = 0;
  let response = "";
  try {
    const result = await getAnthropic().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1500,
      system: CONNECTOR_AGENT_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    response = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    tokensInput = result.usage?.input_tokens || 0;
    tokensOutput = result.usage?.output_tokens || 0;
    parsed = extractJson(response);
  } catch (err: any) {
    await db.insert(agentLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      agentType: "bi_agent",
      promptSent: `[connector ${params.dataSourceId}] ${params.prompt || ""}`.slice(0, 8000),
      responseFull: (response || err?.message || "").slice(0, 16000),
      knowledgeSourceIds: [],
      tokensInput,
      tokensOutput,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: err?.message || String(err),
    }).catch(() => {});
    throw new Error(`Connector BI agent failed: ${err?.message || err}`);
  }

  const rawWidgets: any[] = Array.isArray(parsed?.widgets) ? parsed.widgets : [];
  if (rawWidgets.length === 0) throw new Error("IA não retornou widgets");

  const widgets: ConnectorWidgetSpec[] = [];
  for (const w of rawWidgets.slice(0, 6)) {
    const type = String(w?.type || "").toLowerCase();
    if (!validTypes.has(type)) continue;
    const xCol = w?.xAxisColumn ? String(w.xAxisColumn) : undefined;
    const yCol = w?.yAxisColumn ? String(w.yAxisColumn) : (Array.isArray(w?.yAxisColumns) ? String(w.yAxisColumns[0] || "") : "");
    if (type !== "kpi_card" && (!xCol || !validCols.has(xCol))) continue;
    if (!yCol || !validCols.has(yCol)) continue;
    const gp = w?.gridPos || {};
    const x = Number.isFinite(+gp.x) ? Math.max(0, Math.min(11, +gp.x)) : 0;
    const y = Number.isFinite(+gp.y) ? Math.max(0, +gp.y) : widgets.length * 4;
    const wDef = type === "kpi_card" ? 3 : 6;
    const hDef = type === "kpi_card" ? 2 : type === "radar_chart" ? 5 : 4;
    const ww = Number.isFinite(+gp.w) ? Math.max(2, Math.min(12, +gp.w)) : wDef;
    const hh = Number.isFinite(+gp.h) ? Math.max(2, Math.min(8, +gp.h)) : hDef;
    widgets.push({
      id: crypto.randomUUID(),
      type: type as ConnectorWidgetSpec["type"],
      title: String(w?.title || `${params.sourceName} — ${yCol}`).slice(0, 120),
      gridPos: { x, y, w: ww, h: hh },
      dataSource: {
        type: "connector",
        connectorId: params.dataSourceId,
        xAxisColumn: xCol,
        yAxisColumns: [yCol],
      },
    });
  }

  if (widgets.length === 0) {
    throw new Error("IA retornou widgets, mas nenhum referencia colunas válidas da fonte.");
  }

  await db.insert(agentLogs).values({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    agentType: "bi_agent",
    promptSent: `[connector ${params.dataSourceId}] ${params.prompt || ""}`.slice(0, 8000),
    responseFull: response.slice(0, 16000),
    knowledgeSourceIds: [],
    tokensInput,
    tokensOutput,
    durationMs: Date.now() - start,
    status: "success",
    errorMessage: null,
  }).catch(() => {});

  return {
    title: String(parsed?.title || `Análise de ${params.sourceName}`).slice(0, 120),
    widgets,
    durationMs: Date.now() - start,
    tokensInput,
    tokensOutput,
  };
}
