// Sprint 4 — Cliente HTTP da API REST do Coolify v4.
// Mesmo padrão do FrappeClient: SSRF guard, redirect manual, timeout 15s,
// erros tipados. Token Bearer é descriptografado via cryptoService a partir
// de infra_servers.coolifyTokenEnc.

import { db } from "../db";
import { infraServers } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { decryptConfig } from "../cryptoService";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { URL } from "node:url";

export class CoolifyError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface CoolifyToken {
  token: string;
}

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

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CoolifyError("URL Coolify inválida", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new CoolifyError("Protocolo não permitido (use http/https)", 400);
  }
  // Coolify roda em VPS pública. Permitimos privado só se ALLOW_PRIVATE_COOLIFY=1.
  const allowPrivate = process.env.ALLOW_PRIVATE_COOLIFY === "1";
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" && !allowPrivate) {
    throw new CoolifyError("Endereço Coolify não permitido (privado/local)", 400);
  }
  const ip = isIP(host) ? host : (await dnsLookup(host).catch(() => null))?.address;
  if (!ip) throw new CoolifyError("Host Coolify não resolvido", 400);
  if (isPrivateIp(ip) && !allowPrivate) {
    throw new CoolifyError("Endereço Coolify não permitido (privado/local)", 400);
  }
  return parsed;
}

export interface CoolifyService {
  uuid: string;
  name: string;
  type?: string;
  status?: string;
  fqdn?: string | null;
  url?: string | null;
}

export interface CoolifyApplication {
  uuid: string;
  name: string;
  status?: string;
  fqdn?: string | null;
  git_repository?: string;
}

export class CoolifyClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T = any>(
    path: string,
    opts: { method?: string; query?: Record<string, any>; body?: any; rawText?: boolean } = {},
  ): Promise<T> {
    await assertSafeUrl(this.baseUrl);
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url.toString(), {
        method: opts.method || "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        throw new CoolifyError("Coolify redirect bloqueado (SSRF guard)", 502);
      }
      const text = await res.text();
      if (opts.rawText) {
        if (!res.ok) {
          throw new CoolifyError(`Coolify ${res.status}: ${text.slice(0, 200)}`, res.status, text);
        }
        return text as unknown as T;
      }
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      if (!res.ok) {
        throw new CoolifyError(
          json?.message || json?.error || `Coolify ${res.status}`,
          res.status,
          json,
        );
      }
      return (json?.data ?? json) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ----- Métodos públicos -----

  async getHealth(): Promise<{ ok: true; raw?: any }> {
    // Coolify v4 expõe /api/v1/health (texto "OK") OU /api/v1/teams como ping autenticado.
    // Usamos /api/v1/teams pois exige token válido (verifica auth + conectividade).
    const data = await this.request<any>("/api/v1/teams");
    return { ok: true, raw: Array.isArray(data) ? { count: data.length } : data };
  }

  async listServices(): Promise<CoolifyService[]> {
    const data = await this.request<any[]>("/api/v1/services");
    return Array.isArray(data) ? data.map(normalizeService) : [];
  }

  async listApplications(): Promise<CoolifyApplication[]> {
    const data = await this.request<any[]>("/api/v1/applications");
    return Array.isArray(data) ? data.map(normalizeApplication) : [];
  }

  // Cria uma "service" genérica no Coolify. O payload exato depende do tipo
  // (one-click vs custom) — repassamos como veio da UI/admin.
  async createService(payload: Record<string, any>): Promise<{ uuid: string; name?: string }> {
    return await this.request("/api/v1/services", { method: "POST", body: payload });
  }

  async startService(coolifyId: string): Promise<{ message?: string }> {
    return await this.request(`/api/v1/services/${encodeURIComponent(coolifyId)}/start`, {
      method: "GET",
    });
  }

  async stopService(coolifyId: string): Promise<{ message?: string }> {
    return await this.request(`/api/v1/services/${encodeURIComponent(coolifyId)}/stop`, {
      method: "GET",
    });
  }

  // Coolify retorna logs em texto plano. Usamos rawText:true para preservar.
  // O parâmetro `lines` controla quantas linhas trazer (default 200).
  async getServiceLogs(coolifyId: string, lines = 200): Promise<string> {
    // Tenta rota de application primeiro (mais comum); se 404, tenta service.
    try {
      return await this.request<string>(
        `/api/v1/applications/${encodeURIComponent(coolifyId)}/logs`,
        { query: { lines }, rawText: true },
      );
    } catch (e) {
      if (e instanceof CoolifyError && e.status === 404) {
        return await this.request<string>(
          `/api/v1/services/${encodeURIComponent(coolifyId)}/logs`,
          { query: { lines }, rawText: true },
        );
      }
      throw e;
    }
  }

  // PATCH /api/v1/services/:uuid/envs com payload {data: [{key, value}]}.
  // Coolify aceita também application/envs — fazemos fallback.
  async updateEnvVars(coolifyId: string, envVars: Record<string, string>): Promise<{ message?: string }> {
    const arr = Object.entries(envVars).map(([key, value]) => ({ key, value }));
    try {
      return await this.request(
        `/api/v1/services/${encodeURIComponent(coolifyId)}/envs`,
        { method: "PATCH", body: { data: arr } },
      );
    } catch (e) {
      if (e instanceof CoolifyError && e.status === 404) {
        return await this.request(
          `/api/v1/applications/${encodeURIComponent(coolifyId)}/envs`,
          { method: "PATCH", body: { data: arr } },
        );
      }
      throw e;
    }
  }

  async deployApplication(coolifyId: string): Promise<{ message?: string; deployment_uuid?: string }> {
    return await this.request(
      `/api/v1/deploy`,
      { method: "POST", body: { uuid: coolifyId, force: false } },
    );
  }

  // Coolify v4: GET /api/v1/deployments/{uuid} — devolve estado do deployment.
  // Usado pelo poller do deployToConsult para confirmar redeploy bem-sucedido
  // antes de indexar no Cérebro e atualizar docs.
  async getDeployment(deploymentUuid: string): Promise<{
    uuid: string;
    status?: string;
    finished_at?: string | null;
    raw: any;
  }> {
    const data = await this.request<any>(
      `/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`,
    );
    return {
      uuid: String(data?.uuid ?? deploymentUuid),
      status: data?.status,
      finished_at: data?.finished_at ?? null,
      raw: data,
    };
  }
}

function normalizeService(s: any): CoolifyService {
  return {
    uuid: String(s.uuid ?? s.id ?? s.uid ?? ""),
    name: String(s.name ?? s.application_name ?? "sem-nome"),
    type: s.type ?? s.service_type ?? "service",
    status: s.status ?? (s.last_online_at ? "running" : "unknown"),
    fqdn: s.fqdn ?? null,
    url: s.url ?? s.fqdn ?? null,
  };
}

function normalizeApplication(a: any): CoolifyApplication {
  return {
    uuid: String(a.uuid ?? a.id ?? ""),
    name: String(a.name ?? "sem-nome"),
    status: a.status ?? "unknown",
    fqdn: a.fqdn ?? null,
    git_repository: a.git_repository ?? a.repository ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Factory: lê infra_servers e retorna CoolifyClient pronto para uso.
// Se serverId omitido, escolhe o servidor mais antigo do tenant ("default").
// ---------------------------------------------------------------------------
export async function getCoolifyClient(tenantId: string, serverId?: string): Promise<{
  client: CoolifyClient;
  server: { id: string; name: string; coolifyUrl: string; serverIp: string | null };
}> {
  const where = serverId
    ? and(eq(infraServers.tenantId, tenantId), eq(infraServers.id, serverId))
    : eq(infraServers.tenantId, tenantId);
  const rows = await db
    .select()
    .from(infraServers)
    .where(where)
    .orderBy(asc(infraServers.createdAt))
    .limit(1);
  const s = rows[0];
  if (!s) {
    throw new CoolifyError(
      serverId ? "Servidor Coolify não encontrado para este tenant" : "Nenhum servidor Coolify cadastrado para este tenant",
      404,
    );
  }
  let creds: CoolifyToken;
  try {
    creds = decryptConfig<CoolifyToken>(s.coolifyTokenEnc);
  } catch {
    throw new CoolifyError("Token Coolify inválido (re-cadastre)", 500);
  }
  if (!creds.token) {
    throw new CoolifyError("Token Coolify ausente", 412);
  }
  return {
    client: new CoolifyClient(s.coolifyUrl, creds.token),
    server: { id: s.id, name: s.name, coolifyUrl: s.coolifyUrl, serverIp: s.serverIp },
  };
}
