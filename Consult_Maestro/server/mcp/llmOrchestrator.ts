/**
 * Task #47 — LLM Orchestrator
 *
 * Cascata de fallback cloud→cloud→ollama com:
 *   1. Resolução do provider primário via taskCascade(taskType, sensitivity)
 *   2. Health check em memória (providerHealthWorker) — pula tier unhealthy
 *   3. Budget check leve por tenant (SUM tokens últimos N dias em ai_usage_logs)
 *   4. Execução do callback fn(provider, model, apiKey, baseUrl) do site chamador
 *   5. Em caso de exceção: marca provider unhealthy e tenta o próximo tier
 *   6. Persiste 1 linha em llm_decisions com tier/reason/outcome
 *   7. Best-effort recordAiUsage com taskType para o budget tracking
 *
 * Contrato: NUNCA throw para o caller a menos que TODOS os tiers falhem
 * (`outcome=all_failed`). Caller passa fn que sabe instanciar o SDK certo.
 */
import { db } from "../db";
import { aiUsageLogs, llmDecisions } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AiProvider } from "../aiConfigService";
import { resolveProvider, type ResolvedAiProvider } from "../agentService";
import { getCascade, getDeclaredModel, type Sensitivity } from "./taskCascade";
import { getProviderHealth, markProviderUnhealthy, markProviderHealthy } from "./providerHealthWorker";
import { recordAiUsage, type AiSource } from "./usageLogger";

export interface OrchestrationOptions {
  sensitivity?: Sensitivity;
  /** Força um provider específico (ex: 'ollama' para 'force_local'). */
  forceProvider?: AiProvider;
  /** Limite de tokens por dia por tenant. Se ultrapassado, força ollama. */
  dailyTokenBudget?: number;
  /** Janela em dias para somar tokens do tenant (default 1 = hoje). */
  budgetWindowDays?: number;
  /** Quality score (0-100) opcional, registrado no log. */
  qualityScore?: number;
  /**
   * Timeout máximo (ms) por tier. Se ultrapassado, o tier é tratado como
   * falha e o orquestrador cai para o próximo provider da cascata. Default
   * 60s (configurável por env LLM_TIER_TIMEOUT_MS). Use 0 para desabilitar.
   */
  tierTimeoutMs?: number;
}

export interface OrchestrationCallbackArgs {
  provider: AiProvider;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  source: AiSource; // 'tenant' | 'platform'
  /** AbortSignal vinculado ao timeout do tier. Callbacks devem propagar. */
  signal: AbortSignal;
}

export interface OrchestrationCallbackResult<T> {
  data: T;
  tokensIn?: number;
  tokensOut?: number;
}

export interface OrchestrationResult<T> {
  data: T;
  providerUsed: AiProvider;
  modelUsed: string;
  tier: number;
  reason: string;
  outcome: "success" | "fallback_used" | "all_failed";
  latencyMs: number;
  decisionId: string | null;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Budget diário de tokens por tenant. Configurável por env
 * (LLM_DEFAULT_DAILY_TOKEN_BUDGET). Default 500k tokens/dia ≈ ~50 chats grandes
 * com Anthropic. Acima disso, o orquestrador prioriza Ollama (custo zero) e
 * mantém clouds só como fallback se Ollama falhar.
 */
const DEFAULT_DAILY_TOKEN_BUDGET: number = (() => {
  const v = Number(process.env.LLM_DEFAULT_DAILY_TOKEN_BUDGET);
  return Number.isFinite(v) && v > 0 ? v : 500_000;
})();

/**
 * Timeout por tier (ms). Default 60s — suficiente para a maioria das chamadas
 * de chat; LLMs travados são tratados como falha e o tier seguinte é tentado.
 * Configurável via env LLM_TIER_TIMEOUT_MS (0 desabilita).
 */
const DEFAULT_TIER_TIMEOUT_MS: number = (() => {
  const v = Number(process.env.LLM_TIER_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 0 ? v : 60_000;
})();

/** Erro produzido pelo timeout do tier (catch trata como falha de provider). */
class TierTimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} timeout após ${ms}ms`);
    this.name = "TierTimeoutError";
  }
}

/**
 * Classifica se o erro é falha de INFRAESTRUTURA do provider (digno de marcar
 * unhealthy global) ou erro tenant-específico (4xx, auth, modelo inválido,
 * payload ruim — NÃO deve envenenar o healthMap global).
 *
 * Critério:
 *  - TierTimeoutError → infra (provider travou)
 *  - Mensagem contendo "HTTP 5xx" → infra (provider com problema)
 *  - "fetch failed" / "ECONN" / "ENOTFOUND" / "ETIMEDOUT" / "socket hang up" / "network" → infra
 *  - Mensagem contendo "HTTP 4xx" (400-499) → tenant (auth/payload/modelo)
 *  - Demais erros (sem padrão claro) → tenant (conservador, evita falso unhealthy)
 */
function isInfrastructureFailure(err: unknown): boolean {
  if (err instanceof TierTimeoutError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/http\s*5\d{2}/.test(msg)) return true;
  if (/fetch failed|econn|enotfound|etimedout|socket hang up|network error|connection (refused|reset|closed)/i.test(msg)) return true;
  if (/aborted/i.test(msg) && !/^anthropicerror/i.test(msg)) return true;
  if (/http\s*4\d{2}/.test(msg)) return false;
  return false;
}

const COST_PER_1K_TOKENS: Record<AiProvider, { in: number; out: number }> = {
  // Estimativas atuais em USD por 1k tokens. Manter aproximado, não financeiro.
  anthropic: { in: 0.003, out: 0.015 },
  gemini: { in: 0.000125, out: 0.000375 },
  kimi: { in: 0.0012, out: 0.0024 },
  ollama: { in: 0, out: 0 },
};

function estimateCostUsd(provider: AiProvider, tokensIn: number, tokensOut: number): string {
  const c = COST_PER_1K_TOKENS[provider];
  const usd = (tokensIn / 1000) * c.in + (tokensOut / 1000) * c.out;
  return usd.toFixed(6);
}

async function getTenantDailyTokenSum(tenantId: string, windowDays: number): Promise<number> {
  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${aiUsageLogs.tokensInput} + ${aiUsageLogs.tokensOutput}), 0)`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, since)));
    return Number(row?.total ?? 0);
  } catch (e: any) {
    console.warn("[orchestrator] budget query failed:", e?.message ?? e);
    return 0;
  }
}

interface DecisionRow {
  tenantId: string;
  taskType: string;
  providerUsed: AiProvider;
  modelUsed: string;
  tier: number;
  wasLocal: number;
  reason: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: string;
  qualityScore: number | null;
  outcome: "success" | "fallback_used" | "all_failed";
}

async function persistDecision(row: DecisionRow): Promise<string | null> {
  try {
    const [r] = await db
      .insert(llmDecisions)
      .values({
        tenantId: row.tenantId,
        taskType: row.taskType,
        providerUsed: row.providerUsed,
        modelUsed: row.modelUsed,
        tier: row.tier,
        wasLocal: row.wasLocal,
        reason: row.reason.slice(0, 200),
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        latencyMs: row.latencyMs,
        costUsd: row.costUsd,
        qualityScore: row.qualityScore,
        outcome: row.outcome,
      })
      .returning({ id: llmDecisions.id });
    return r?.id ?? null;
  } catch (e: any) {
    console.warn("[orchestrator] persistDecision failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Executa fn dentro da cascata. tenantId pode ser null/anônimo (platform-level)
 * — nesse caso a auditoria llm_decisions é pulada (require tenant_id NOT NULL),
 * mas a cascata funciona normalmente.
 */
export async function runWithOrchestration<T>(
  taskType: string,
  tenantId: string | null,
  options: OrchestrationOptions,
  fn: (args: OrchestrationCallbackArgs) => Promise<OrchestrationCallbackResult<T>>,
): Promise<OrchestrationResult<T>> {
  const sensitivity = options.sensitivity ?? "internal";

  // Resolve cascata base
  let chain = options.forceProvider ? [options.forceProvider] : getCascade(taskType, sensitivity);
  let initialReason: string;
  if (options.forceProvider === "ollama") {
    initialReason = "force_local";
  } else if (sensitivity === "secret") {
    initialReason = "force_local";
  } else if (sensitivity === "data_sensitive") {
    initialReason = "data_sensitive";
  } else {
    initialReason = "primary_healthy";
  }

  // Budget check (sempre ativo para tenants identificados; default vem de
  // LLM_DEFAULT_DAILY_TOKEN_BUDGET ou DEFAULT_DAILY_TOKEN_BUDGET).
  // Sensitivity 'secret' já é Ollama-only, então pulamos a checagem.
  const effectiveBudget = options.dailyTokenBudget ?? DEFAULT_DAILY_TOKEN_BUDGET;
  if (tenantId && effectiveBudget > 0 && sensitivity !== "secret" && sensitivity !== "data_sensitive") {
    const sum = await getTenantDailyTokenSum(tenantId, options.budgetWindowDays ?? 1);
    if (sum >= effectiveBudget) {
      // Força ollama no topo (mantém clouds como fallback de emergência)
      chain = ["ollama", ...chain.filter((p) => p !== "ollama")];
      initialReason = "tenant_budget_low";
    }
  }

  let lastError: string = "no provider attempted";
  let triedAny = false;
  // Atribuição precisa de reason em fallbacks: registramos o motivo do skip
  // de CADA tier que pulamos, na ordem, para que tiers >=2 mostrem o motivo
  // real do skip do tier anterior (não apenas "${chain[0]}_unhealthy").
  const skipTrail: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const tier = i + 1;

    // Health gate (apenas pula se EXPLICITAMENTE unhealthy; stale=null deixa tentar)
    const health = getProviderHealth(provider);
    if (health && !health.isHealthy) {
      const sr = `${provider}_unhealthy`;
      skipTrail.push(sr);
      lastError = health.lastErrorMsg ?? sr;
      continue;
    }

    // Resolver credenciais (tenant > pool). Falha aqui é tenant-específica
    // (config faltando, formato inválido) — NÃO marca unhealthy global.
    let resolved: ResolvedAiProvider;
    try {
      resolved = await resolveProvider(tenantId, provider);
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      skipTrail.push(`${provider}_resolve_failed`);
      continue;
    }
    if (resolved.unavailable) {
      lastError = resolved.reason ?? `${provider} sem credencial`;
      // Não marca unhealthy global aqui — pode ser apenas falta de config tenant
      skipTrail.push(`${provider}_no_creds`);
      continue;
    }

    triedAny = true;
    // Reason: tier 1 usa o initialReason calculado acima; tiers >=2 carregam
    // o motivo REAL do skip do tier anterior (encadeado se houver mais skips).
    const reason = i === 0 ? initialReason : skipTrail.slice(-3).join("→");
    const start = Date.now();

    // Override declarativo de modelo por (taskType, provider).
    const declaredModel = getDeclaredModel(taskType, provider);
    const effectiveModel = declaredModel ?? resolved.model;

    // Timeout envelope: AbortController para abortar fetch/SDK + Promise.race
    // para garantir que o orquestrador não fique pendurado se o callback ignorar
    // o signal. Tratado como falha de provider → cai para próximo tier.
    const tierTimeoutMs = options.tierTimeoutMs ?? DEFAULT_TIER_TIMEOUT_MS;
    const ac = new AbortController();
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutP = tierTimeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            ac.abort();
            reject(new TierTimeoutError(provider, tierTimeoutMs));
          }, tierTimeoutMs);
        })
      : null;

    try {
      const callP = fn({
        provider: resolved.provider,
        model: effectiveModel,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        source: resolved.source,
        signal: ac.signal,
      });
      const cbResult = timeoutP ? await Promise.race([callP, timeoutP]) : await callP;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const latencyMs = Date.now() - start;
      const tokensIn = Math.max(0, Math.floor(cbResult.tokensIn ?? 0));
      const tokensOut = Math.max(0, Math.floor(cbResult.tokensOut ?? 0));

      // Sucesso: marca healthy (atualiza latência) e persiste decisão.
      markProviderHealthy(provider, latencyMs);

      const outcome: "success" | "fallback_used" = i === 0 ? "success" : "fallback_used";

      let decisionId: string | null = null;
      if (tenantId) {
        decisionId = await persistDecision({
          tenantId,
          taskType,
          providerUsed: resolved.provider,
          modelUsed: effectiveModel,
          tier,
          wasLocal: provider === "ollama" ? 1 : 0,
          reason,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd: estimateCostUsd(provider, tokensIn, tokensOut),
          qualityScore: options.qualityScore ?? null,
          outcome,
        });
        // Best-effort usage logging para budget tracking subsequente.
        // AiProvider é subconjunto de AiProviderName (ambos: anthropic|gemini|kimi|ollama).
        void recordAiUsage({
          tenantId,
          provider: resolved.provider,
          model: effectiveModel,
          source: resolved.source,
          tokensInput: tokensIn,
          tokensOutput: tokensOut,
          taskType,
        });
      }

      return {
        data: cbResult.data,
        providerUsed: resolved.provider,
        modelUsed: effectiveModel,
        tier,
        reason,
        outcome,
        latencyMs,
        decisionId,
        tokensIn,
        tokensOut,
      };
    } catch (e: any) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      // Aborta o callback se ainda estiver rodando (caso de erro não-timeout)
      if (!ac.signal.aborted) ac.abort();
      lastError = e?.message ?? String(e);
      const isTimeout = e instanceof TierTimeoutError;
      const isInfra = isInfrastructureFailure(e);
      // Só marca unhealthy GLOBAL para falhas de infra (timeout/5xx/network).
      // Erros tenant-específicos (4xx, auth, modelo inválido) NÃO contaminam
      // o healthMap — outros tenants podem ter creds válidas e devem tentar.
      if (isInfra) {
        markProviderUnhealthy(provider, lastError);
      }
      const tag = isTimeout ? "timeout" : isInfra ? "failed" : "tenant_error";
      skipTrail.push(`${provider}_${tag}`);
      console.warn(`[orchestrator] tier ${tier} (${provider}) ${tag.toUpperCase()}: ${lastError}`);
      // segue para próximo tier (independente do tipo: este tenant não consegue usar este provider agora)
    }
  }

  // Todos falharam — registra all_failed se houver tenantId
  const lastProvider = chain[chain.length - 1] ?? "anthropic";
  if (tenantId) {
    await persistDecision({
      tenantId,
      taskType,
      providerUsed: lastProvider,
      modelUsed: "n/a",
      tier: chain.length,
      wasLocal: lastProvider === "ollama" ? 1 : 0,
      reason: triedAny ? "emergency_local" : "no_provider_available",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      costUsd: "0.000000",
      qualityScore: null,
      outcome: "all_failed",
    });
  }
  throw new Error(`LLM orchestrator: todos os providers falharam (${chain.join(",")}). Último erro: ${lastError}`);
}
