// Sprint 5 — Cliente Gitea para commit automático e visualização no Dev Center.
// Mesmo hardening do CoolifyClient: SSRF guard com resolução DNS + bloqueio de
// ranges privados, redirect:'manual', timeout 15s, Bearer token Gitea.
//
// Convenção de owner: por padrão usa env GITEA_OWNER (default 'arcadia'). Pode
// ser uma org Gitea ou um usuário; createRepo tenta criar como repo de org e
// faz fallback para repo de usuário se a org não existir.

import { db } from "../db";
import { infraServers } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { decryptConfig } from "../cryptoService";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { URL } from "node:url";

export class GiteaError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const GITEA_OWNER = process.env.GITEA_OWNER || "arcadia";

interface GiteaToken {
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
  try { parsed = new URL(rawUrl); }
  catch { throw new GiteaError("URL Gitea inválida", 400); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new GiteaError("Protocolo não permitido (use http/https)", 400);
  }
  const allowPrivate = process.env.ALLOW_PRIVATE_GITEA === "1";
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" && !allowPrivate) {
    throw new GiteaError("Endereço Gitea não permitido (privado/local)", 400);
  }
  const ip = isIP(host) ? host : (await dnsLookup(host).catch(() => null))?.address;
  if (!ip) throw new GiteaError("Host Gitea não resolvido", 400);
  if (isPrivateIp(ip) && !allowPrivate) {
    throw new GiteaError("Endereço Gitea não permitido (privado/local)", 400);
  }
  return parsed;
}

// ---------- Tipos exportados (resposta normalizada para o frontend) ----------

export interface GiteaCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string; // ISO
  htmlUrl?: string;
}

export interface GiteaCommitFile {
  filename: string;
  status: string; // 'added' | 'modified' | 'removed' | etc.
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GiteaCommitDetail {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  files: GiteaCommitFile[];
  parents: string[];
}

export interface GiteaBranch {
  name: string;
  commit: { sha: string };
}

// =============================================================================

export class GiteaClient {
  private baseUrl: string;
  private token: string;
  // Cache do nome do usuário autenticado (usado como fallback de owner em
  // createRepo se a org configurada não existir).
  private cachedAuthUser: string | null = null;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T = any>(
    path: string,
    opts: { method?: string; body?: any; query?: Record<string, any>; allow404?: boolean } = {},
  ): Promise<T | null> {
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
          Authorization: `token ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        throw new GiteaError("Gitea redirect bloqueado (SSRF guard)", 502);
      }
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      if (res.status === 404 && opts.allow404) return null;
      if (!res.ok) {
        throw new GiteaError(
          json?.message || `Gitea ${res.status}`,
          res.status,
          json,
        );
      }
      return json as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Sprint 6 fix (code-review #4): health check público chamável pelo
  // endpoint /api/infra/servers/:id/test quando service_type='gitea'.
  // Hits /api/v1/user — única chamada autenticada barata e estável.
  async pingHealth(): Promise<{ login: string }> {
    const u = await this.request<any>("/api/v1/user");
    if (!u?.login) throw new GiteaError("Resposta inesperada do Gitea", 502);
    return { login: u.login };
  }

  private async getAuthUser(): Promise<string> {
    if (this.cachedAuthUser) return this.cachedAuthUser;
    const u = await this.request<any>("/api/v1/user");
    if (!u?.login) throw new GiteaError("Não foi possível identificar usuário do token Gitea", 401);
    this.cachedAuthUser = u.login;
    return u.login;
  }

  // -------------------------------------------------------------------------
  // createRepo — POST /api/v1/orgs/{owner}/repos com fallback para /user/repos
  //   Idempotente: se já existe (status 409) devolve o repositório existente.
  // -------------------------------------------------------------------------
  async createRepo(name: string, description: string): Promise<{ html_url: string; full_name: string }> {
    const payload = {
      name,
      description: (description || "").slice(0, 250),
      private: true,
      auto_init: true,
      default_branch: "main",
    };
    // 1. Tenta como org
    try {
      const r = await this.request<any>(
        `/api/v1/orgs/${encodeURIComponent(GITEA_OWNER)}/repos`,
        { method: "POST", body: payload },
      );
      return r as any;
    } catch (e) {
      if (e instanceof GiteaError && e.status === 409) {
        // já existe — busca e retorna
        const existing = await this.request<any>(
          `/api/v1/repos/${encodeURIComponent(GITEA_OWNER)}/${encodeURIComponent(name)}`,
          { allow404: true },
        );
        if (existing) return existing;
      }
      if (!(e instanceof GiteaError) || (e.status !== 404 && e.status !== 422)) throw e;
      // 2. Fallback: cria como repo do usuário do token
    }
    try {
      const r = await this.request<any>(`/api/v1/user/repos`, { method: "POST", body: payload });
      return r as any;
    } catch (e) {
      if (e instanceof GiteaError && e.status === 409) {
        const owner = await this.getAuthUser();
        const existing = await this.request<any>(
          `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          { allow404: true },
        );
        if (existing) return existing;
      }
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // commitFile — verifica SHA existente e usa PUT (update) ou POST (create)
  //   content é texto bruto, encodamos em base64 internamente.
  // -------------------------------------------------------------------------
  async commitFile(
    owner: string,
    repo: string,
    filePath: string,
    content: string,
    message: string,
    branch: string = "main",
  ): Promise<{ commit: { sha: string } } | null> {
    const cleanPath = filePath.replace(/^\/+/, "");
    const contentB64 = Buffer.from(content, "utf-8").toString("base64");
    const existing = await this.request<any>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
      { query: { ref: branch }, allow404: true },
    );

    const body: any = {
      message,
      content: contentB64,
      branch,
    };
    if (existing?.sha) {
      // Se conteúdo idêntico, evita commit vazio
      if (existing.content && existing.content.replace(/\n/g, "") === contentB64) {
        return null;
      }
      body.sha = existing.sha;
      const r = await this.request<any>(
        `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
        { method: "PUT", body },
      );
      return r;
    } else {
      const r = await this.request<any>(
        `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
        { method: "POST", body },
      );
      return r;
    }
  }

  // -------------------------------------------------------------------------
  // listCommits — GET /api/v1/repos/{owner}/{repo}/commits
  // -------------------------------------------------------------------------
  async listCommits(owner: string, repo: string, branch?: string): Promise<GiteaCommit[]> {
    const data = await this.request<any[]>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
      { query: { sha: branch ?? undefined, limit: 50 } },
    );
    if (!Array.isArray(data)) return [];
    return data.map(normalizeCommit);
  }

  // -------------------------------------------------------------------------
  // getCommitDiff — GET /api/v1/repos/{owner}/{repo}/git/commits/{sha}
  // Gitea retorna files[] com patch. Endpoint exato pode variar — tentamos
  // /git/commits primeiro e fallback /commits/{sha}.
  // -------------------------------------------------------------------------
  async getCommitDiff(owner: string, repo: string, sha: string): Promise<GiteaCommitDetail> {
    const tryPaths = [
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(sha)}`,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
    ];
    let data: any = null;
    let lastErr: any = null;
    for (const p of tryPaths) {
      try {
        data = await this.request<any>(p);
        if (data) break;
      } catch (e) {
        lastErr = e;
        if (e instanceof GiteaError && e.status === 404) continue;
        throw e;
      }
    }
    if (!data) throw lastErr ?? new GiteaError("Commit não encontrado", 404);
    return normalizeCommitDetail(data, sha);
  }

  // -------------------------------------------------------------------------
  // createBranch — POST /api/v1/repos/{owner}/{repo}/branches
  //   Gitea aceita { new_branch_name, old_branch_name }
  // -------------------------------------------------------------------------
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromBranch: string = "main",
  ): Promise<GiteaBranch> {
    const r = await this.request<any>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
      {
        method: "POST",
        body: { new_branch_name: branchName, old_branch_name: fromBranch },
      },
    );
    return r as GiteaBranch;
  }

  // Lista branches existentes (usado pela UI para alimentar o seletor).
  async listBranches(owner: string, repo: string): Promise<GiteaBranch[]> {
    const data = await this.request<any[]>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    );
    return Array.isArray(data) ? data : [];
  }

  // -------------------------------------------------------------------------
  // deleteFile — remove arquivo na branch (Sprint 5: usado pelo revert quando
  // o commit revertido era 'added'). Idempotente: se já não existir devolve null.
  // -------------------------------------------------------------------------
  async deleteFile(
    owner: string,
    repo: string,
    filePath: string,
    message: string,
    branch: string = "main",
  ): Promise<{ commit: { sha: string } } | null> {
    const cleanPath = filePath.replace(/^\/+/, "");
    const existing = await this.request<any>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
      { query: { ref: branch }, allow404: true },
    );
    if (!existing?.sha) return null;
    return await this.request<any>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
      { method: "DELETE", body: { message, branch, sha: existing.sha } },
    );
  }

  // -------------------------------------------------------------------------
  // getFileContent — retorna conteúdo decodificado de base64
  // -------------------------------------------------------------------------
  async getFileContent(owner: string, repo: string, path: string, branch?: string): Promise<string | null> {
    const cleanPath = path.replace(/^\/+/, "");
    const r = await this.request<any>(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`,
      { query: { ref: branch ?? undefined }, allow404: true },
    );
    if (!r) return null;
    if (r.encoding === "base64" && typeof r.content === "string") {
      return Buffer.from(r.content, "base64").toString("utf-8");
    }
    return r.content ?? null;
  }
}

function normalizeCommit(c: any): GiteaCommit {
  const commit = c?.commit ?? {};
  const author = commit?.author ?? c?.author ?? {};
  return {
    sha: String(c?.sha ?? ""),
    message: String(commit?.message ?? c?.message ?? ""),
    authorName: String(author?.name ?? c?.author?.login ?? "desconhecido"),
    authorEmail: String(author?.email ?? ""),
    date: String(author?.date ?? commit?.committer?.date ?? new Date().toISOString()),
    htmlUrl: c?.html_url,
  };
}

function normalizeCommitDetail(c: any, sha: string): GiteaCommitDetail {
  const base = normalizeCommit(c);
  const filesRaw: any[] = Array.isArray(c?.files) ? c.files : [];
  const files: GiteaCommitFile[] = filesRaw.map((f) => ({
    filename: String(f.filename ?? f.name ?? ""),
    status: String(f.status ?? "modified"),
    additions: Number(f.additions ?? 0),
    deletions: Number(f.deletions ?? 0),
    patch: typeof f.patch === "string" ? f.patch : null,
  }));
  // Gitea retorna parents como [{sha, url, ...}]. Capturamos só os SHAs reais —
  // usado pelo revert para ler o estado anterior do arquivo (não confiar em "<sha>~1"
  // que nem todo backend Gitea aceita como ref válida).
  const parentsRaw: any[] = Array.isArray(c?.parents) ? c.parents : [];
  const parents: string[] = parentsRaw
    .map((p) => String(p?.sha ?? p ?? ""))
    .filter((s) => !!s);
  return { ...base, sha: base.sha || sha, files, parents };
}

// ---------------------------------------------------------------------------
// Factory: lê infra_servers WHERE service_type='gitea' do tenant.
// Retorna null se não houver Gitea configurado (caller decide silenciar).
// ---------------------------------------------------------------------------
export async function getGiteaClient(tenantId: string): Promise<{
  client: GiteaClient;
  baseUrl: string;
  owner: string;
} | null> {
  const rows = await db
    .select()
    .from(infraServers)
    .where(and(eq(infraServers.tenantId, tenantId), eq(infraServers.serviceType, "gitea")))
    .orderBy(asc(infraServers.createdAt))
    .limit(1);
  const s = rows[0];
  if (!s) return null;
  let creds: GiteaToken;
  try {
    creds = decryptConfig<GiteaToken>(s.coolifyTokenEnc);
  } catch {
    throw new GiteaError("Token Gitea inválido (re-cadastre)", 500);
  }
  if (!creds.token) throw new GiteaError("Token Gitea ausente", 412);
  return {
    client: new GiteaClient(s.coolifyUrl, creds.token),
    baseUrl: s.coolifyUrl.replace(/\/+$/, ""),
    owner: GITEA_OWNER,
  };
}
