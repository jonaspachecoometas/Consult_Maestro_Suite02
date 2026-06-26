import { db } from "./db";
import { dataSources, dataSnapshots, syncJobs } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { decryptConfig } from "./cryptoService";
import { Pool } from "pg";

export type ConnectorResult = {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  syncedAt: Date;
};

const MAX_PREVIEW_ROWS = 1000;
const QUERY_TIMEOUT_MS = 10_000;

class ConnectorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── PUBLIC ROUTER ──────────────────────────────────────────────────────
export async function fetchFromSource(
  dataSourceId: string,
  tenantId: string,
): Promise<ConnectorResult> {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.tenantId, tenantId)));
  if (!source) throw new ConnectorError("Fonte não encontrada", 404);

  const config = decryptConfig(source.configEncrypted);
  const publicCfg = (source.configPublic ?? {}) as Record<string, any>;
  const merged = { ...publicCfg, ...config };

  switch (source.type) {
    case "rest_api":
      return fetchRestApi(merged);
    case "postgres":
      return fetchPostgres(merged);
    case "excel_upload":
    case "zip_upload":
      return fetchExcelLatest(dataSourceId, tenantId);
    case "mongodb":
      return fetchMongo(merged);
    case "mysql":
    case "sqlserver":
    case "google_sheets":
    case "totvs":
      throw new ConnectorError(
        `Conector "${source.type}" estará disponível na Fase 4b`,
        501,
      );
    default:
      throw new ConnectorError(`Tipo de fonte desconhecido: ${source.type}`, 400);
  }
}

// ── MONGODB (NoSQL) ────────────────────────────────────────────────────
async function fetchMongo(cfg: Record<string, any>): Promise<ConnectorResult> {
  const { uri, database, collection, filter, projection, sort, limit, authSource } = cfg;
  if (!uri || !database || !collection) {
    throw new ConnectorError("uri, database e collection são obrigatórios");
  }
  let safeUri = String(uri).trim();
  if (!/^mongodb(\+srv)?:\/\//.test(safeUri)) {
    throw new ConnectorError("URI deve começar com mongodb:// ou mongodb+srv://");
  }
  if (authSource) {
    const authVal = encodeURIComponent(String(authSource));
    if (/[?&]authSource=/i.test(safeUri)) {
      safeUri = safeUri.replace(/([?&])authSource=[^&]*/i, `$1authSource=${authVal}`);
    } else {
      safeUri += (safeUri.includes("?") ? "&" : "?") + `authSource=${authVal}`;
    }
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(safeUri, {
    serverSelectionTimeoutMS: QUERY_TIMEOUT_MS,
    connectTimeoutMS: QUERY_TIMEOUT_MS,
  });
  try {
    await client.connect();
    const col = client.db(String(database)).collection(String(collection));
    const parsed = (v: any) => {
      if (!v) return undefined;
      if (typeof v === "object") return v;
      try { return JSON.parse(String(v)); } catch { return undefined; }
    };
    const f = parsed(filter) || {};
    const p = parsed(projection);
    const s = parsed(sort);
    let cursor = col.find(f, p ? { projection: p } : {});
    if (s) cursor = cursor.sort(s);
    cursor = cursor.limit(Math.min(Number(limit) || MAX_PREVIEW_ROWS, MAX_PREVIEW_ROWS));
    const docs = await cursor.toArray();
    const flat = docs.map((d: any) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(d)) {
        if (v === null || v === undefined) out[k] = v;
        else if (typeof v === "object" && (v as any)._bsontype) out[k] = String(v);
        else if (v instanceof Date) out[k] = (v as Date).toISOString();
        else if (typeof v === "object") out[k] = JSON.stringify(v);
        else out[k] = v;
      }
      return out;
    });
    const columns = flat[0] ? Object.keys(flat[0]) : [];
    return { rows: flat, columns, rowCount: flat.length, syncedAt: new Date() };
  } catch (err: any) {
    throw new ConnectorError(`MongoDB: ${err?.message || err}`, 502);
  } finally {
    await client.close().catch(() => {});
  }
}

// ── REST API ────────────────────────────────────────────────────────────
async function fetchRestApi(cfg: Record<string, any>): Promise<ConnectorResult> {
  const url = cfg.url;
  if (!url) throw new ConnectorError("URL da API é obrigatória");
  await assertSafeExternalUrl(url);

  const headers: Record<string, string> = { Accept: "application/json" };
  const authType = cfg.authType || "none";
  if (authType === "api_key" && cfg.apiKey) {
    const headerName = cfg.headerName || "Authorization";
    const prefix = cfg.prefix ? `${cfg.prefix} ` : "";
    headers[headerName] = `${prefix}${cfg.apiKey}`;
  } else if (authType === "basic" && cfg.username) {
    const token = Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64");
    headers["Authorization"] = `Basic ${token}`;
  }
  if (cfg.extraHeaders && typeof cfg.extraHeaders === "object") {
    for (const [k, v] of Object.entries(cfg.extraHeaders)) headers[k] = String(v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: cfg.method || "GET", headers, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new ConnectorError("Timeout ao chamar API externa", 408);
    throw new ConnectorError(`Falha de rede: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ConnectorError(`API respondeu ${res.status}`, 502);

  const json = await res.json().catch(() => null);
  if (json == null) throw new ConnectorError("Resposta da API não é JSON válido");

  // Try to find an array of records — at the root or inside common wrapper keys.
  let rows: any[] | null = null;
  if (Array.isArray(json)) rows = json;
  else if (json && typeof json === "object") {
    const path = cfg.dataPath as string | undefined;
    if (path) {
      let cur: any = json;
      for (const seg of path.split(".")) cur = cur?.[seg];
      if (Array.isArray(cur)) rows = cur;
    } else {
      for (const key of ["data", "items", "results", "records", "rows"]) {
        if (Array.isArray((json as any)[key])) {
          rows = (json as any)[key];
          break;
        }
      }
    }
    if (!rows) rows = [json];
  } else {
    throw new ConnectorError("Resposta inesperada da API");
  }

  const sliced = rows.slice(0, MAX_PREVIEW_ROWS);
  const columns = sliced[0] && typeof sliced[0] === "object" ? Object.keys(sliced[0]) : [];
  return { rows: sliced, columns, rowCount: sliced.length, syncedAt: new Date() };
}

// ── EXTERNAL POSTGRES ──────────────────────────────────────────────────
async function fetchPostgres(cfg: Record<string, any>): Promise<ConnectorResult> {
  const { host, port, database, user, password, ssl, query } = cfg;
  if (!host || !database || !user) {
    throw new ConnectorError("host, database e user são obrigatórios");
  }
  const pool = new Pool({
    host,
    port: Number(port) || 5432,
    database,
    user,
    password,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    max: 1,
  });

  const sqlText = (query && typeof query === "string" ? query : "SELECT 1 AS ok").trim();
  const upper = sqlText.toUpperCase().replace(/--.*$/gm, "");
  if (!/^\s*(SELECT|WITH)\b/.test(upper)) {
    await pool.end().catch(() => {});
    throw new ConnectorError("Apenas SELECT/WITH é permitido em fontes Postgres");
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/.test(upper)) {
    await pool.end().catch(() => {});
    throw new ConnectorError("Operações de escrita não são permitidas");
  }

  try {
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
      const limited = /\bLIMIT\s+\d+/i.test(sqlText)
        ? sqlText
        : `${sqlText.replace(/;\s*$/, "")} LIMIT ${MAX_PREVIEW_ROWS}`;
      const result = await client.query(limited);
      const rows = result.rows || [];
      const columns = result.fields?.map((f: any) => f.name) || (rows[0] ? Object.keys(rows[0]) : []);
      return { rows, columns, rowCount: rows.length, syncedAt: new Date() };
    } finally {
      client.release();
    }
  } catch (err: any) {
    throw new ConnectorError(`Postgres: ${err?.message || err}`, 502);
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── EXCEL UPLOAD (returns last saved snapshot) ─────────────────────────
async function fetchExcelLatest(
  dataSourceId: string,
  tenantId: string,
): Promise<ConnectorResult> {
  const [snap] = await db
    .select()
    .from(dataSnapshots)
    .where(and(eq(dataSnapshots.dataSourceId, dataSourceId), eq(dataSnapshots.tenantId, tenantId)))
    .orderBy(desc(dataSnapshots.syncedAt))
    .limit(1);
  if (!snap) {
    throw new ConnectorError(
      "Nenhum upload encontrado — envie um arquivo .xlsx/.csv primeiro",
      404,
    );
  }
  return {
    rows: (snap.data ?? []) as Record<string, any>[],
    columns: (snap.columns ?? []) as string[],
    rowCount: snap.rowCount ?? 0,
    syncedAt: snap.syncedAt ?? new Date(),
  };
}

// ── PERSIST SNAPSHOT ────────────────────────────────────────────────────
export async function saveSnapshot(
  dataSourceId: string,
  tenantId: string,
  result: ConnectorResult,
  snapshotKey = "default",
) {
  await db.insert(dataSnapshots).values({
    tenantId,
    dataSourceId,
    snapshotKey,
    data: result.rows,
    columns: result.columns,
    rowCount: result.rowCount,
  });
}

// ── ORCHESTRATED SYNC (creates a sync_jobs row, runs, updates) ─────────
export async function runSync(
  dataSourceId: string,
  tenantId: string,
  triggeredBy: "manual" | "cron" | "automation" = "manual",
): Promise<{ jobId: string; rowsSynced: number; status: "success" | "error"; error?: string }> {
  const [job] = await db
    .insert(syncJobs)
    .values({
      tenantId,
      dataSourceId,
      status: "running",
      startedAt: new Date(),
      triggeredBy,
    })
    .returning();

  try {
    const result = await fetchFromSource(dataSourceId, tenantId);
    await saveSnapshot(dataSourceId, tenantId, result);
    await db
      .update(syncJobs)
      .set({
        status: "success",
        finishedAt: new Date(),
        rowsSynced: result.rowCount,
      })
      .where(eq(syncJobs.id, job.id));
    await db
      .update(dataSources)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "success", updatedAt: new Date() })
      .where(eq(dataSources.id, dataSourceId));
    return { jobId: job.id, rowsSynced: result.rowCount, status: "success" };
  } catch (err: any) {
    const message = err?.message || String(err);
    await db
      .update(syncJobs)
      .set({ status: "error", finishedAt: new Date(), errorMessage: message })
      .where(eq(syncJobs.id, job.id));
    await db
      .update(dataSources)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "error", updatedAt: new Date() })
      .where(eq(dataSources.id, dataSourceId));
    return { jobId: job.id, rowsSynced: 0, status: "error", error: message };
  }
}

export { ConnectorError };

// ── SSRF protection ────────────────────────────────────────────────
async function assertSafeExternalUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConnectorError("URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConnectorError("Apenas http(s) é permitido");
  }
  const host = parsed.hostname.toLowerCase();
  // block obvious private/loopback names
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new ConnectorError("Host privado/loopback bloqueado");
  }
  const dns = await import("dns/promises");
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new ConnectorError("Não foi possível resolver o host");
  }
  for (const { address, family } of addrs) {
    if (family === 4 && isPrivateIPv4(address))
      throw new ConnectorError(`IP privado bloqueado: ${address}`);
    if (family === 6 && isPrivateIPv6(address))
      throw new ConnectorError(`IP privado bloqueado: ${address}`);
  }
}
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    a >= 224 // multicast / reserved
  );
}
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("::ffff:") // IPv4-mapped — re-check the v4 part
  );
}
