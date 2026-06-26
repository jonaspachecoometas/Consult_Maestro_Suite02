import { db } from "./db";
import { tenantAiConfigs, platformAiConfigs } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { encryptConfig, decryptConfig } from "./cryptoService";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// === SSRF guard (mirrors frappeClient pattern) ===
const PRIVATE_RANGES_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (isIP(ip) === 4) return PRIVATE_RANGES_V4.some((r) => r.test(ip));
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (/^fc/.test(ip) || /^fd/.test(ip)) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    return false;
  }
  return false;
}
/**
 * Sidecar interno do Replit (Modelfarm) — proxy confiável para provedores
 * de IA (Anthropic/OpenAI/Gemini) instalados via Replit Integrations.
 * Mesmo padrão do `REPLIT_SIDECAR_ENDPOINT` em `server/objectStorage.ts`.
 * Aceitamos `localhost`/`127.0.0.1` apenas na porta 1106 e path /modelfarm/*.
 */
function isReplitModelfarmSidecar(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocalHost && port === "1106" && parsed.pathname.startsWith("/modelfarm/");
}

export async function assertSafeBaseUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("URL inválida"); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Protocolo não permitido (use http/https)");
  }
  // Replit Modelfarm sidecar é sempre permitido (proxy confiável da plataforma).
  if (isReplitModelfarmSidecar(parsed)) return;
  // ALLOW_PRIVATE_AI permite Ollama em LAN/localhost (dev). Por padrão bloqueamos.
  const allowPrivate = process.env.ALLOW_PRIVATE_AI === "1";
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" && !allowPrivate) {
    throw new Error("Endereço local bloqueado. Defina ALLOW_PRIVATE_AI=1 no servidor para liberar Ollama em rede privada.");
  }
  const ip = isIP(host) ? host : (await dnsLookup(host).catch(() => null))?.address;
  if (!ip) throw new Error("Host não resolvido");
  if (isPrivateIp(ip) && !allowPrivate) {
    throw new Error("Endereço privado bloqueado. Defina ALLOW_PRIVATE_AI=1 no servidor para liberar Ollama em rede privada.");
  }
}

export type AiProvider = "anthropic" | "gemini" | "kimi" | "ollama";

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "gemini", "kimi", "ollama"];

export const PROVIDER_DEFAULTS: Record<AiProvider, { defaultModel: string; needsApiKey: boolean; defaultBaseUrl?: string }> = {
  anthropic: { defaultModel: "claude-sonnet-4-5-20250929", needsApiKey: true },
  gemini: { defaultModel: "gemini-2.5-flash", needsApiKey: true },
  kimi: { defaultModel: "moonshot-v1-8k", needsApiKey: true, defaultBaseUrl: "https://api.moonshot.cn/v1" },
  ollama: { defaultModel: "llama3.1", needsApiKey: false, defaultBaseUrl: "http://localhost:11434" },
};

export interface AiConfigPublic {
  provider: AiProvider;
  configured: boolean;
  isActive: boolean;
  model: string | null;
  baseUrl: string | null;
  updatedAt: Date | null;
}

export async function listTenantAiConfigs(tenantId: string): Promise<AiConfigPublic[]> {
  const rows = await db.select().from(tenantAiConfigs).where(eq(tenantAiConfigs.tenantId, tenantId));
  const map = new Map(rows.map((r) => [r.provider as AiProvider, r]));
  return AI_PROVIDERS.map((provider) => {
    const row = map.get(provider);
    return {
      provider,
      configured: !!row && (provider === "ollama" ? !!row.baseUrl : !!row.apiKeyEnc),
      isActive: row?.isActive ?? false,
      model: row?.model ?? null,
      baseUrl: row?.baseUrl ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function getTenantAiSecret(
  tenantId: string,
  provider: AiProvider,
): Promise<{ apiKey: string | null; model: string | null; baseUrl: string | null; isActive: boolean } | null> {
  const [row] = await db
    .select()
    .from(tenantAiConfigs)
    .where(and(eq(tenantAiConfigs.tenantId, tenantId), eq(tenantAiConfigs.provider, provider)));
  if (!row) return null;
  let apiKey: string | null = null;
  if (row.apiKeyEnc) {
    try {
      const dec = decryptConfig<{ apiKey?: string }>(row.apiKeyEnc);
      apiKey = dec?.apiKey ?? null;
    } catch {
      apiKey = null;
    }
  }
  return { apiKey, model: row.model, baseUrl: row.baseUrl, isActive: row.isActive };
}

export async function upsertTenantAiConfig(
  tenantId: string,
  provider: AiProvider,
  data: { apiKey?: string | null; model?: string | null; baseUrl?: string | null; isActive?: boolean },
): Promise<void> {
  // SSRF: validate baseUrl whenever it is being set to a non-empty string
  if (typeof data.baseUrl === "string" && data.baseUrl.length > 0) {
    await assertSafeBaseUrl(data.baseUrl);
  }

  // apiKey: undefined => keep existing; null/'' => clear; string => encrypt new
  let apiKeyEnc: string | null | undefined;
  if (data.apiKey === undefined) {
    apiKeyEnc = undefined;
  } else if (data.apiKey === null || data.apiKey === "") {
    apiKeyEnc = null;
  } else {
    apiKeyEnc = encryptConfig({ apiKey: data.apiKey });
  }

  // Atomic upsert via INSERT ... ON CONFLICT (tenant_id, provider) DO UPDATE
  const insertValues = {
    tenantId,
    provider,
    apiKeyEnc: apiKeyEnc ?? null,
    model: data.model ?? PROVIDER_DEFAULTS[provider].defaultModel,
    baseUrl: data.baseUrl ?? PROVIDER_DEFAULTS[provider].defaultBaseUrl ?? null,
    isActive: data.isActive ?? true,
  };

  const updateSet: any = { updatedAt: new Date() };
  if (apiKeyEnc !== undefined) updateSet.apiKeyEnc = apiKeyEnc;
  if (data.model !== undefined) updateSet.model = data.model;
  if (data.baseUrl !== undefined) updateSet.baseUrl = data.baseUrl;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive;

  await db
    .insert(tenantAiConfigs)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [tenantAiConfigs.tenantId, tenantAiConfigs.provider],
      set: updateSet,
    });
}

export async function deleteTenantAiConfig(tenantId: string, provider: AiProvider): Promise<void> {
  await db
    .delete(tenantAiConfigs)
    .where(and(eq(tenantAiConfigs.tenantId, tenantId), eq(tenantAiConfigs.provider, provider)));
}

// ===== Platform-level config (chaves de plataforma, superadmin) =====

export async function listPlatformAiConfigs(): Promise<AiConfigPublic[]> {
  const rows = await db.select().from(platformAiConfigs);
  const map = new Map(rows.map((r) => [r.provider as AiProvider, r]));
  return AI_PROVIDERS.map((provider) => {
    const row = map.get(provider);
    return {
      provider,
      configured: !!row && (provider === "ollama" ? !!row.baseUrl : !!row.apiKeyEnc),
      isActive: row?.isActive ?? false,
      model: row?.model ?? null,
      baseUrl: row?.baseUrl ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function getPlatformAiSecret(
  provider: AiProvider,
): Promise<{ apiKey: string | null; model: string | null; baseUrl: string | null; isActive: boolean } | null> {
  const [row] = await db.select().from(platformAiConfigs).where(eq(platformAiConfigs.provider, provider));
  if (!row) return null;
  let apiKey: string | null = null;
  if (row.apiKeyEnc) {
    try {
      const dec = decryptConfig<{ apiKey?: string }>(row.apiKeyEnc);
      apiKey = dec?.apiKey ?? null;
    } catch {
      apiKey = null;
    }
  }
  return { apiKey, model: row.model, baseUrl: row.baseUrl, isActive: row.isActive };
}

export async function upsertPlatformAiConfig(
  provider: AiProvider,
  data: { apiKey?: string | null; model?: string | null; baseUrl?: string | null; isActive?: boolean },
): Promise<void> {
  if (typeof data.baseUrl === "string" && data.baseUrl.length > 0) {
    await assertSafeBaseUrl(data.baseUrl);
  }
  let apiKeyEnc: string | null | undefined;
  if (data.apiKey === undefined) apiKeyEnc = undefined;
  else if (data.apiKey === null || data.apiKey === "") apiKeyEnc = null;
  else apiKeyEnc = encryptConfig({ apiKey: data.apiKey });

  const insertValues = {
    provider,
    apiKeyEnc: apiKeyEnc ?? null,
    model: data.model ?? PROVIDER_DEFAULTS[provider].defaultModel,
    baseUrl: data.baseUrl ?? PROVIDER_DEFAULTS[provider].defaultBaseUrl ?? null,
    isActive: data.isActive ?? true,
  };
  const updateSet: any = { updatedAt: new Date() };
  if (apiKeyEnc !== undefined) updateSet.apiKeyEnc = apiKeyEnc;
  if (data.model !== undefined) updateSet.model = data.model;
  if (data.baseUrl !== undefined) updateSet.baseUrl = data.baseUrl;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive;

  await db
    .insert(platformAiConfigs)
    .values(insertValues)
    .onConflictDoUpdate({ target: platformAiConfigs.provider, set: updateSet });
}

export async function deletePlatformAiConfig(provider: AiProvider): Promise<void> {
  await db.delete(platformAiConfigs).where(eq(platformAiConfigs.provider, provider));
}

export async function testPlatformProviderConnection(
  provider: AiProvider,
  override: { apiKey?: string; baseUrl?: string },
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  let apiKey = override.apiKey;
  let baseUrl = override.baseUrl;
  if (!apiKey || (provider === "ollama" && !baseUrl)) {
    const saved = await getPlatformAiSecret(provider);
    if (!apiKey) apiKey = saved?.apiKey ?? undefined;
    if (!baseUrl) baseUrl = saved?.baseUrl ?? undefined;
  }
  // Reaproveita o motor de teste do tenant (não usa tenantId, só override)
  return testProviderConnection("__platform__", provider, { apiKey, baseUrl });
}

/**
 * Tests a provider connection. If apiKey not given, falls back to the saved one.
 * Returns { ok: boolean, message: string, models?: string[] }
 */
export async function testProviderConnection(
  tenantId: string,
  provider: AiProvider,
  override: { apiKey?: string; baseUrl?: string },
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  let apiKey = override.apiKey;
  let baseUrl = override.baseUrl;

  if (!apiKey || (provider === "ollama" && !baseUrl)) {
    const saved = await getTenantAiSecret(tenantId, provider);
    if (!apiKey) apiKey = saved?.apiKey ?? undefined;
    if (!baseUrl) baseUrl = saved?.baseUrl ?? undefined;
  }

  baseUrl = baseUrl || PROVIDER_DEFAULTS[provider].defaultBaseUrl;

  // SSRF: any test that hits a custom baseUrl (Ollama, Kimi) must validate target host
  if (provider === "ollama" || provider === "kimi") {
    if (baseUrl) {
      try {
        await assertSafeBaseUrl(baseUrl);
      } catch (e: any) {
        return { ok: false, message: e?.message ?? "URL bloqueada por política SSRF" };
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    if (provider === "anthropic") {
      if (!apiKey) return { ok: false, message: "API key não informada" };
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: controller.signal,
      });
      if (!r.ok) return { ok: false, message: `Anthropic respondeu HTTP ${r.status}` };
      const body: any = await r.json().catch(() => ({}));
      return { ok: true, message: "Conexão OK", models: (body?.data ?? []).map((m: any) => m.id).slice(0, 20) };
    }

    if (provider === "gemini") {
      if (!apiKey) return { ok: false, message: "API key não informada" };
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { signal: controller.signal });
      if (!r.ok) return { ok: false, message: `Gemini respondeu HTTP ${r.status}` };
      const body: any = await r.json().catch(() => ({}));
      return { ok: true, message: "Conexão OK", models: (body?.models ?? []).map((m: any) => m.name).slice(0, 20) };
    }

    if (provider === "kimi") {
      if (!apiKey) return { ok: false, message: "API key não informada" };
      const root = (baseUrl ?? PROVIDER_DEFAULTS.kimi.defaultBaseUrl)!.replace(/\/$/, "");
      const r = await fetch(`${root}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!r.ok) return { ok: false, message: `Kimi respondeu HTTP ${r.status}` };
      const body: any = await r.json().catch(() => ({}));
      return { ok: true, message: "Conexão OK", models: (body?.data ?? []).map((m: any) => m.id).slice(0, 20) };
    }

    if (provider === "ollama") {
      if (!baseUrl) return { ok: false, message: "Base URL não informada" };
      const root = baseUrl.replace(/\/$/, "");
      const r = await fetch(`${root}/api/tags`, { signal: controller.signal });
      if (!r.ok) return { ok: false, message: `Ollama respondeu HTTP ${r.status}` };
      const body: any = await r.json().catch(() => ({}));
      return { ok: true, message: "Conexão OK", models: (body?.models ?? []).map((m: any) => m.name).slice(0, 20) };
    }

    return { ok: false, message: "Provider não suportado" };
  } catch (e: any) {
    return { ok: false, message: e?.name === "AbortError" ? "Timeout (8s)" : (e?.message ?? "Erro desconhecido") };
  } finally {
    clearTimeout(timeout);
  }
}
