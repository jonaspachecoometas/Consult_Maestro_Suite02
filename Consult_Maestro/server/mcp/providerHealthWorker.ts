/**
 * Task #47 — Provider Health Worker (in-memory only)
 *
 * Mantém um Map<AiProvider, HealthEntry> escopado ao processo Node. Sem Redis,
 * sem Postgres — o usuário insistiu que health não é dado durável.
 * - Cron a cada 5 min faz uma chamada barata em cada provider para medir
 *   latência + sucesso. Ollama via GET /api/tags; cloud via 1 chamada ≤5
 *   tokens com timeout curto.
 * - getProviderHealth(provider) retorna a entrada atual; se mais velha que
 *   STALE_TTL_MS (5 min), considera "stale" → o orquestrador trata como
 *   desconhecida (otimista, deixa tentar). Se a checagem deu erro, marca
 *   isHealthy=false e o orquestrador pula esse tier.
 *
 * Failures sempre best-effort: NUNCA throw. Se uma checagem quebrar, log
 * warn e segue para o próximo provider.
 */
import { resolveProvider } from "../agentService";
import { assertSafeBaseUrl, type AiProvider, AI_PROVIDERS, PROVIDER_DEFAULTS } from "../aiConfigService";

export interface HealthEntry {
  isHealthy: boolean;
  latencyMs: number;
  lastCheckedAt: number; // Date.now()
  lastErrorMsg: string | null;
}

const STALE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cron a cada 5 min
const PROBE_TIMEOUT_MS = 8000;

// Map em memória — ÚNICA fonte de verdade para health. Vive enquanto o
// processo viver. Em deploy multi-instância cada réplica mantém o seu.
const healthMap = new Map<AiProvider, HealthEntry>();

export function getProviderHealth(provider: AiProvider): HealthEntry | null {
  const entry = healthMap.get(provider);
  if (!entry) return null;
  if (Date.now() - entry.lastCheckedAt > STALE_TTL_MS) {
    return null; // stale → desconhecido
  }
  return entry;
}

export function getAllProviderHealth(): Record<AiProvider, HealthEntry | null> {
  const out = {} as Record<AiProvider, HealthEntry | null>;
  for (const p of AI_PROVIDERS) out[p] = getProviderHealth(p);
  return out;
}

/** Marca um provider como unhealthy (usado quando o orquestrador detecta
 *  falha em runtime, para acelerar o fallback subsequente sem esperar o cron). */
export function markProviderUnhealthy(provider: AiProvider, errorMsg: string): void {
  const prev = healthMap.get(provider);
  healthMap.set(provider, {
    isHealthy: false,
    latencyMs: prev?.latencyMs ?? 0,
    lastCheckedAt: Date.now(),
    lastErrorMsg: errorMsg.slice(0, 200),
  });
}

export function markProviderHealthy(provider: AiProvider, latencyMs: number): void {
  healthMap.set(provider, {
    isHealthy: true,
    latencyMs,
    lastCheckedAt: Date.now(),
    lastErrorMsg: null,
  });
}

async function probeOllama(baseUrl: string): Promise<{ ok: boolean; latency: number; err?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const root = baseUrl.replace(/\/$/, "");
    const r = await fetch(`${root}/api/tags`, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, latency: Date.now() - start, err: `HTTP ${r.status}` };
    return { ok: true, latency: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency: Date.now() - start, err: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function probeAnthropic(apiKey: string, baseUrl: string | null): Promise<{ ok: boolean; latency: number; err?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // Modelfarm proxy (Replit Integration) não suporta GET /v1/models.
    // Fazemos um POST minúsculo para validar credencial+conectividade.
    if (baseUrl && baseUrl.includes("/modelfarm/")) {
      const root = baseUrl.replace(/\/$/, "");
      const r = await fetch(`${root}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) return { ok: false, latency: Date.now() - start, err: `HTTP ${r.status}` };
      return { ok: true, latency: Date.now() - start };
    }
    const root = (baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    const r = await fetch(`${root}/v1/models`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, latency: Date.now() - start, err: `HTTP ${r.status}` };
    return { ok: true, latency: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency: Date.now() - start, err: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function probeGemini(apiKey: string): Promise<{ ok: boolean; latency: number; err?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: ctrl.signal },
    );
    if (!r.ok) return { ok: false, latency: Date.now() - start, err: `HTTP ${r.status}` };
    return { ok: true, latency: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency: Date.now() - start, err: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function probeKimi(apiKey: string, baseUrl: string): Promise<{ ok: boolean; latency: number; err?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const root = baseUrl.replace(/\/$/, "");
    const r = await fetch(`${root}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, latency: Date.now() - start, err: `HTTP ${r.status}` };
    return { ok: true, latency: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency: Date.now() - start, err: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Probe um único provider usando credenciais do pool da plataforma
 *  (resolveProvider com tenantId=null). Atualiza o Map com o resultado. */
export async function checkProvider(provider: AiProvider): Promise<void> {
  try {
    const r = await resolveProvider(null, provider);
    // IMPORTANTE (architect Task #47): se o pool da plataforma não tem
    // credenciais para esse provider, NÃO marcamos unhealthy globalmente —
    // tenants podem ter as próprias credenciais e o orquestrador vai
    // resolvê-las por requisição. Deixamos o estado como "stale/unknown"
    // (limpando qualquer entrada anterior do Map) para que o gate de health
    // no orquestrador (que só pula em isHealthy=false explícito) deixe a
    // tentativa por tenant prosseguir.
    if (r.unavailable) {
      healthMap.delete(provider);
      return;
    }
    let result: { ok: boolean; latency: number; err?: string };
    if (provider === "ollama") {
      if (!r.baseUrl) { healthMap.delete(provider); return; }
      try { await assertSafeBaseUrl(r.baseUrl); }
      catch (e: any) { markProviderUnhealthy(provider, `baseUrl bloqueada: ${e?.message ?? e}`); return; }
      result = await probeOllama(r.baseUrl);
    } else if (provider === "anthropic") {
      if (!r.apiKey) { healthMap.delete(provider); return; }
      result = await probeAnthropic(r.apiKey, r.baseUrl);
    } else if (provider === "gemini") {
      if (!r.apiKey) { healthMap.delete(provider); return; }
      result = await probeGemini(r.apiKey);
    } else if (provider === "kimi") {
      if (!r.apiKey) { healthMap.delete(provider); return; }
      const baseUrl = r.baseUrl ?? PROVIDER_DEFAULTS.kimi.defaultBaseUrl!;
      result = await probeKimi(r.apiKey, baseUrl);
    } else {
      return;
    }
    if (result.ok) markProviderHealthy(provider, result.latency);
    else markProviderUnhealthy(provider, result.err ?? "probe failed");
  } catch (e: any) {
    console.warn(`[mcp/healthWorker] checkProvider(${provider}) inesperado:`, e?.message ?? e);
    markProviderUnhealthy(provider, e?.message ?? String(e));
  }
}

export async function checkAllProviders(): Promise<void> {
  await Promise.all(AI_PROVIDERS.map((p) => checkProvider(p)));
}

let started = false;
let intervalHandle: NodeJS.Timeout | null = null;

export function startProviderHealthCron(): void {
  if (started) return;
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_LLM_HEALTH_CRON === "1") {
    console.log("[mcp/healthWorker] cron disabled (test/disabled)");
    return;
  }
  started = true;
  // Primeira passada imediata (não bloqueia o boot).
  void checkAllProviders().catch((e) => console.warn("[mcp/healthWorker] initial check failed:", e));
  intervalHandle = setInterval(() => {
    void checkAllProviders().catch((e) => console.warn("[mcp/healthWorker] interval check failed:", e));
  }, CHECK_INTERVAL_MS);
  // setInterval não impede o processo de fechar quando precisar
  intervalHandle.unref?.();
  console.log(`[mcp/healthWorker] cron iniciado (probe every ${CHECK_INTERVAL_MS / 1000}s, TTL ${STALE_TTL_MS / 1000}s)`);
}

export function stopProviderHealthCron(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}
