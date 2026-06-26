import { db } from "./db";
import { tenants } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decryptConfig } from "./cryptoService";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { URL } from "node:url";

export class FrappeError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface FrappeCreds {
  apiKey: string;
  apiSecret: string;
}

const PRIVATE_RANGES_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.toLowerCase();
  // IPv4-mapped IPv6 → strip ::ffff: prefix and recheck as v4
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (isIP(ip) === 4) return PRIVATE_RANGES_V4.some((r) => r.test(ip));
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (/^fc/.test(ip) || /^fd/.test(ip)) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(ip)) return true;             // fe80::/10 link-local
    return false;
  }
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FrappeError("URL Frappe inválida", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new FrappeError("Protocolo não permitido (use http/https)", 400);
  }
  const allowPrivate = process.env.ALLOW_PRIVATE_FRAPPE === "1";
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" && !allowPrivate) {
    throw new FrappeError("Endereço Frappe não permitido (privado/local)", 400);
  }
  const ip = isIP(host) ? host : (await dnsLookup(host).catch(() => null))?.address;
  if (!ip) throw new FrappeError("Host Frappe não resolvido", 400);
  if (isPrivateIp(ip) && !allowPrivate) {
    throw new FrappeError("Endereço Frappe não permitido (privado/local)", 400);
  }
  return parsed;
}

export class FrappeClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(siteUrl: string, apiKey: string, apiSecret: string) {
    this.baseUrl = siteUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private get authHeader() {
    return `token ${this.apiKey}:${this.apiSecret}`;
  }

  private async request<T = any>(
    path: string,
    opts: { method?: string; query?: Record<string, any>; body?: any } = {},
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
      // redirect: 'manual' → block redirect-based SSRF that would land on internal hosts.
      const res = await fetch(url.toString(), {
        method: opts.method || "GET",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        throw new FrappeError("Frappe redirect bloqueado (SSRF guard)", 502);
      }
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      if (!res.ok) {
        throw new FrappeError(
          json?.exception || json?._server_messages || json?.message || `Frappe ${res.status}`,
          res.status,
          json,
        );
      }
      return (json?.data ?? json?.message ?? json) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async ping(): Promise<{ ok: true; version?: string }> {
    const data = await this.request<any>("/api/method/frappe.client.get_list", {
      query: { doctype: "DocType", limit_page_length: 1 },
    });
    return { ok: true, version: Array.isArray(data) ? "ok" : "ok" };
  }

  async listDocTypes(): Promise<{ name: string }[]> {
    return await this.request("/api/method/frappe.client.get_list", {
      query: { doctype: "DocType", fields: ["name"], limit_page_length: 200 },
    });
  }

  async getList<T = any>(
    doctype: string,
    opts: { fields?: string[]; filters?: any; limit?: number; orderBy?: string } = {},
  ): Promise<T[]> {
    return await this.request(`/api/resource/${encodeURIComponent(doctype)}`, {
      query: {
        fields: opts.fields,
        filters: opts.filters,
        limit_page_length: opts.limit ?? 50,
        order_by: opts.orderBy,
      },
    });
  }

  async getDoc<T = any>(doctype: string, name: string): Promise<T> {
    return await this.request(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
  }

  async insert<T = any>(doctype: string, doc: Record<string, any>): Promise<T> {
    return await this.request(`/api/resource/${encodeURIComponent(doctype)}`, {
      method: "POST",
      body: doc,
    });
  }

  async update<T = any>(doctype: string, name: string, doc: Record<string, any>): Promise<T> {
    return await this.request(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: doc,
    });
  }

  async remove(doctype: string, name: string): Promise<void> {
    await this.request(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async rpc<T = any>(method: string, args: Record<string, any> = {}): Promise<T> {
    return await this.request(`/api/method/${method}`, { method: "POST", body: args });
  }
}

export interface FrappeStatus {
  configured: boolean;
  url?: string;
}

export async function getFrappeStatus(tenantId: string): Promise<FrappeStatus> {
  const [t] = await db.select({
    frappeUrl: tenants.frappeUrl,
    frappeCredentials: tenants.frappeCredentials,
  }).from(tenants).where(eq(tenants.id, tenantId));
  const configured = !!(t?.frappeUrl && t?.frappeCredentials);
  return { configured, url: t?.frappeUrl ?? undefined };
}

export async function getFrappeClientForTenant(tenantId: string): Promise<FrappeClient> {
  const [t] = await db.select({
    frappeUrl: tenants.frappeUrl,
    frappeCredentials: tenants.frappeCredentials,
  }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t?.frappeUrl || !t?.frappeCredentials) {
    throw new FrappeError("Frappe não configurado para este tenant", 412);
  }
  let creds: FrappeCreds;
  try {
    creds = decryptConfig<FrappeCreds>(t.frappeCredentials);
  } catch {
    throw new FrappeError("Credenciais Frappe inválidas (re-cadastre)", 500);
  }
  if (!creds.apiKey || !creds.apiSecret) {
    throw new FrappeError("API Key/Secret Frappe ausentes", 412);
  }
  return new FrappeClient(t.frappeUrl, creds.apiKey, creds.apiSecret);
}
