import { db } from "../../db";
import { sql } from "drizzle-orm";
import { dataSources } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { readAnalytical, readMapping, type AnalyticsMapping } from "../adapters/analyticalReader";
import { invalidateTenantCache } from "../cache";

/**
 * ETL incremental — Fase 3 BI Multi-Fonte.
 *
 * Para cada `data_sources` ativo do tenant que tenha
 * `configPublic.analyticsMapping`, lê o último snapshot, transforma e
 * faz UPSERT em `analytics.fact_revenue` ou aplica SCD Type 2 em
 * `analytics.dim_client`.
 *
 * Idempotente: o cursor `since` é o `cursor_until` do último ETL run
 * SUCCESS daquela combinação (tenant, source, kind). Linhas sem
 * `cursorColumn` são consideradas "fato novo" e processadas sempre
 * (tipicamente fontes Excel/CSV que não têm timestamp).
 */

export interface EtlResult {
  tenantId: string;
  perSource: Array<{
    dataSourceId: string;
    sourceName: string;
    kind: AnalyticsMapping["kind"] | "none";
    rowsIn: number;
    rowsUpserted: number;
    rowsSkipped: number;
    cursorMax: string | null;
    status: "success" | "error" | "skipped";
    error?: string;
  }>;
  totalUpserted: number;
}

const QUOTE_IDENT = /^[a-zA-Z0-9_-]{8,64}$/;
function ident(v: string): string {
  if (!QUOTE_IDENT.test(v)) throw new Error(`ETL: identifier inválido: ${v}`);
  return `'${v}'`;
}
function lit(v: string | number | null): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''").slice(0, 4000)}'`;
}
type RowValue = string | number | boolean | Date | null | undefined;

function toIsoDate(v: RowValue): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function toNumber(v: RowValue): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const cleaned = String(v ?? "0").replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

async function lastCursor(tenantId: string, dataSourceId: string, kind: string): Promise<Date | null> {
  const r = await db.execute(sql.raw(`
    SELECT cursor_until
      FROM analytics.etl_runs
     WHERE tenant_id = ${ident(tenantId)}
       AND data_source_id = ${ident(dataSourceId)}
       AND mapping_kind = ${lit(kind)}
       AND status = 'success'
     ORDER BY started_at DESC
     LIMIT 1
  `));
  const rows = (r.rows ?? []) as Array<{ cursor_until: string | Date | null }>;
  const cursor = rows[0]?.cursor_until;
  return cursor ? new Date(cursor) : null;
}

async function recordRun(
  tenantId: string, dataSourceId: string, kind: string,
  rowsIn: number, rowsUpserted: number, rowsSkipped: number,
  cursorSince: Date | null, cursorUntil: Date | null,
  status: "success" | "error", error?: string,
): Promise<string> {
  const r = await db.execute(sql.raw(`
    INSERT INTO analytics.etl_runs
      (tenant_id, data_source_id, mapping_kind, status,
       rows_in, rows_upserted, rows_skipped,
       cursor_since, cursor_until, error_message, finished_at)
    VALUES
      (${ident(tenantId)}, ${ident(dataSourceId)}, ${lit(kind)}, ${lit(status)},
       ${rowsIn}, ${rowsUpserted}, ${rowsSkipped},
       ${cursorSince ? `'${cursorSince.toISOString()}'::timestamp` : "NULL"},
       ${cursorUntil ? `'${cursorUntil.toISOString()}'::timestamp` : "NULL"},
       ${lit(error ?? null)}, now())
    RETURNING id
  `));
  const rows = (r.rows ?? []) as Array<{ id: string }>;
  return rows[0]?.id ?? "";
}

async function upsertSource(tenantId: string, dataSourceId: string, name: string, type: string): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO analytics.dim_source (data_source_id, tenant_id, name, type, last_sync_at, updated_at)
    VALUES (${ident(dataSourceId)}, ${ident(tenantId)}, ${lit(name)}, ${lit(type)}, now(), now())
    ON CONFLICT (data_source_id) DO UPDATE
      SET name = EXCLUDED.name,
          type = EXCLUDED.type,
          last_sync_at = now(),
          updated_at = now()
  `));
}

async function upsertFactRevenue(
  tenantId: string, dataSourceId: string, mapping: AnalyticsMapping, rows: Array<{ raw: Record<string, unknown> }>,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0, skipped = 0;
  const cm = mapping.columnMap;
  for (const { raw } of rows) {
    const naturalKey = String(raw[cm.natural_key] ?? raw.id ?? "").trim();
    const period = toIsoDate(raw[cm.period] as RowValue);
    const amount = toNumber(raw[cm.amount] as RowValue);
    if (!naturalKey || !period) { skipped++; continue; }
    const clientNk = cm.client_natural_key ? String(raw[cm.client_natural_key] ?? "") || null : null;
    const category = cm.category ? String(raw[cm.category] ?? "") || null : null;
    await db.execute(sql.raw(`
      INSERT INTO analytics.fact_revenue
        (tenant_id, source_data_source_id, natural_key, client_natural_key, period, amount, category, payload)
      VALUES
        (${ident(tenantId)}, ${ident(dataSourceId)}, ${lit(naturalKey)},
         ${lit(clientNk)}, '${period}'::date, ${amount}, ${lit(category)}, '{}'::jsonb)
      ON CONFLICT (tenant_id, source_data_source_id, natural_key)
      WHERE natural_key IS NOT NULL
      DO UPDATE SET
        period = EXCLUDED.period,
        amount = EXCLUDED.amount,
        client_natural_key = EXCLUDED.client_natural_key,
        category = EXCLUDED.category,
        ingested_at = now()
    `));
    upserted++;
  }
  return { upserted, skipped };
}

/**
 * SCD Type 2: ao detectar mudança em (name, document, status), expira o
 * registro corrente (`valid_to=now`, `is_current=0`) e insere uma nova
 * versão (`is_current=1`).
 */
async function upsertDimClient(
  tenantId: string, dataSourceId: string, mapping: AnalyticsMapping, rows: Array<{ raw: Record<string, unknown> }>,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0, skipped = 0;
  const cm = mapping.columnMap;
  for (const { raw } of rows) {
    const naturalKey = String(raw[cm.natural_key] ?? raw.id ?? "").trim();
    if (!naturalKey) { skipped++; continue; }
    const name = cm.name ? String(raw[cm.name] ?? "") : "";
    const doc = cm.document ? String(raw[cm.document] ?? "") : null;
    const status = cm.status ? String(raw[cm.status] ?? "") : null;

    const cur = await db.execute(sql.raw(`
      SELECT sk, name, document, status FROM analytics.dim_client
       WHERE tenant_id = ${ident(tenantId)}
         AND source_data_source_id = ${ident(dataSourceId)}
         AND natural_key = ${lit(naturalKey)}
         AND is_current = 1
       LIMIT 1
    `));
    const curRows = (cur.rows ?? []) as Array<{ sk: string; name: string | null; document: string | null; status: string | null }>;
    const cr = curRows[0];
    if (cr) {
      const same = (cr.name ?? "") === name && (cr.document ?? "") === (doc ?? "") && (cr.status ?? "") === (status ?? "");
      if (same) continue;
      await db.execute(sql.raw(`
        UPDATE analytics.dim_client
           SET valid_to = now(), is_current = 0
         WHERE sk = ${lit(cr.sk)}
      `));
    }
    await db.execute(sql.raw(`
      INSERT INTO analytics.dim_client
        (tenant_id, source_data_source_id, natural_key, name, document, status, valid_from, is_current)
      VALUES
        (${ident(tenantId)}, ${ident(dataSourceId)}, ${lit(naturalKey)},
         ${lit(name)}, ${lit(doc)}, ${lit(status)}, now(), 1)
    `));
    upserted++;
  }
  return { upserted, skipped };
}

/**
 * Computa Migration Monitor + Data Quality findings após o ETL.
 * Olha pares de fontes que materializam o mesmo `kind` para o tenant.
 */
async function refreshMigrationAndQuality(tenantId: string): Promise<void> {
  // Idempotência: limpa snapshots anteriores deste tenant antes de recomputar.
  // (Tabelas são "estado mais recente"; histórico fica em analytics.etl_runs.)
  await db.execute(sql.raw(`DELETE FROM analytics.migration_state WHERE tenant_id = ${ident(tenantId)}`));
  await db.execute(sql.raw(`DELETE FROM analytics.dq_findings WHERE tenant_id = ${ident(tenantId)}`));

  // Migration: dim_client matched by natural_key entre cada par de sources.
  const sourcesRes = await db.execute(sql.raw(`
    SELECT DISTINCT source_data_source_id AS id
      FROM analytics.dim_client
     WHERE tenant_id = ${ident(tenantId)}
  `));
  const idRows = (sourcesRes.rows ?? []) as Array<{ id: string | null }>;
  const ids = idRows.map((r) => r.id).filter((x): x is string => Boolean(x));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const stat = await db.execute(sql.raw(`
        WITH a AS (SELECT natural_key FROM analytics.dim_client
                    WHERE tenant_id = ${ident(tenantId)} AND source_data_source_id = ${ident(a)} AND is_current=1),
             b AS (SELECT natural_key FROM analytics.dim_client
                    WHERE tenant_id = ${ident(tenantId)} AND source_data_source_id = ${ident(b)} AND is_current=1)
        SELECT
          (SELECT COUNT(*) FROM a)::int AS count_a,
          (SELECT COUNT(*) FROM b)::int AS count_b,
          (SELECT COUNT(*) FROM a JOIN b USING (natural_key))::int AS matched,
          (SELECT COUNT(*) FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.natural_key = a.natural_key))::int AS missing_in_b,
          (SELECT COUNT(*) FROM b WHERE NOT EXISTS (SELECT 1 FROM a WHERE a.natural_key = b.natural_key))::int AS missing_in_a
      `));
      const statRows = (stat.rows ?? []) as Array<{
        count_a: number; count_b: number; matched: number;
        missing_in_b: number; missing_in_a: number;
      }>;
      const s = statRows[0];
      if (!s) continue;
      await db.execute(sql.raw(`
        INSERT INTO analytics.migration_state
          (tenant_id, source_a, source_b, dimension, count_a, count_b, matched, missing_in_b, missing_in_a, observed_at)
        VALUES
          (${ident(tenantId)}, ${ident(a)}, ${ident(b)}, 'dim_client',
           ${s.count_a}, ${s.count_b}, ${s.matched}, ${s.missing_in_b}, ${s.missing_in_a}, now())
      `));
    }
  }

  // Data Quality: comparar receita total por fonte no mês corrente.
  const dq = await db.execute(sql.raw(`
    SELECT source_data_source_id AS sid, SUM(amount)::numeric AS total
      FROM analytics.fact_revenue
     WHERE tenant_id = ${ident(tenantId)}
       AND period >= date_trunc('month', now())::date
     GROUP BY 1
  `));
  const totals = (dq.rows ?? []) as Array<{ sid: string; total: string | number | null }>;
  for (let i = 0; i < totals.length; i++) {
    for (let j = i + 1; j < totals.length; j++) {
      const a = totals[i], b = totals[j];
      const va = Number(a.total ?? 0), vb = Number(b.total ?? 0);
      const diff = va - vb;
      const denom = Math.max(Math.abs(va), Math.abs(vb), 1);
      const diffPct = (diff / denom) * 100;
      if (Math.abs(diffPct) < 1) continue; // <1% ignora ruído
      const sev = Math.abs(diffPct) > 25 ? "critical" : Math.abs(diffPct) > 10 ? "warning" : "info";
      await db.execute(sql.raw(`
        INSERT INTO analytics.dq_findings
          (tenant_id, metric_id, source_a, value_a, source_b, value_b, diff, diff_pct, severity, explanation, observed_at)
        VALUES
          (${ident(tenantId)}, 'control.revenue_total',
           ${ident(a.sid)}, ${va}, ${ident(b.sid)}, ${vb},
           ${diff}, ${diffPct.toFixed(4)}, ${lit(sev)},
           'Receita do mês difere entre as duas fontes selecionadas.', now())
      `));
    }
  }
}

export async function runEtl(tenantId: string): Promise<EtlResult> {
  if (!QUOTE_IDENT.test(tenantId)) throw new Error("tenantId inválido");
  const sources = await db.select().from(dataSources)
    .where(and(eq(dataSources.tenantId, tenantId), eq(dataSources.isActive, 1)));
  const result: EtlResult = { tenantId, perSource: [], totalUpserted: 0 };
  for (const s of sources) {
    const cfg = (s.configPublic ?? null) as Record<string, unknown> | null;
    const mapping = readMapping(cfg);
    if (!mapping) {
      result.perSource.push({
        dataSourceId: s.id, sourceName: s.name, kind: "none",
        rowsIn: 0, rowsUpserted: 0, rowsSkipped: 0, cursorMax: null,
        status: "skipped",
      });
      continue;
    }
    try {
      await upsertSource(tenantId, s.id, s.name, s.type);
      const since = await lastCursor(tenantId, s.id, mapping.kind);
      const read = await readAnalytical({
        tenantId, dataSourceId: s.id,
        cursorColumn: mapping.cursorColumn,
        since,
      });
      const out = mapping.kind === "fact_revenue"
        ? await upsertFactRevenue(tenantId, s.id, mapping, read.rows)
        : await upsertDimClient(tenantId, s.id, mapping, read.rows);
      const cursorMax = read.cursorMax ?? since;
      await recordRun(tenantId, s.id, mapping.kind, read.fetchedRows, out.upserted, out.skipped,
        since, cursorMax, "success");
      result.totalUpserted += out.upserted;
      result.perSource.push({
        dataSourceId: s.id, sourceName: s.name, kind: mapping.kind,
        rowsIn: read.fetchedRows, rowsUpserted: out.upserted, rowsSkipped: out.skipped,
        cursorMax: cursorMax ? cursorMax.toISOString() : null,
        status: "success",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordRun(tenantId, s.id, mapping.kind, 0, 0, 0, null, null, "error", msg);
      result.perSource.push({
        dataSourceId: s.id, sourceName: s.name, kind: mapping.kind,
        rowsIn: 0, rowsUpserted: 0, rowsSkipped: 0, cursorMax: null,
        status: "error", error: msg,
      });
    }
  }
  await refreshMigrationAndQuality(tenantId);
  await invalidateTenantCache(tenantId);
  return result;
}

export async function listEtlRuns(tenantId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  if (!QUOTE_IDENT.test(tenantId)) throw new Error("tenantId inválido");
  const r = await db.execute(sql.raw(`
    SELECT r.id, r.data_source_id, r.mapping_kind, r.status,
           r.rows_in, r.rows_upserted, r.rows_skipped,
           r.cursor_since, r.cursor_until, r.error_message,
           r.started_at, r.finished_at,
           s.name AS source_name
      FROM analytics.etl_runs r
      LEFT JOIN analytics.dim_source s
        ON s.data_source_id = r.data_source_id
       AND s.tenant_id = r.tenant_id
     WHERE r.tenant_id = ${ident(tenantId)}
     ORDER BY r.started_at DESC
     LIMIT ${Math.min(Math.max(1, limit), 200)}
  `));
  return (r.rows ?? []) as Array<Record<string, unknown>>;
}

export async function listMigrationState(tenantId: string): Promise<Array<Record<string, unknown>>> {
  if (!QUOTE_IDENT.test(tenantId)) throw new Error("tenantId inválido");
  const r = await db.execute(sql.raw(`
    SELECT m.*, sa.name AS source_a_name, sb.name AS source_b_name
      FROM analytics.migration_state m
      LEFT JOIN analytics.dim_source sa
        ON sa.data_source_id = m.source_a AND sa.tenant_id = m.tenant_id
      LEFT JOIN analytics.dim_source sb
        ON sb.data_source_id = m.source_b AND sb.tenant_id = m.tenant_id
     WHERE m.tenant_id = ${ident(tenantId)}
     ORDER BY m.observed_at DESC
     LIMIT 50
  `));
  return (r.rows ?? []) as Array<Record<string, unknown>>;
}

export async function listDqFindings(tenantId: string): Promise<Array<Record<string, unknown>>> {
  if (!QUOTE_IDENT.test(tenantId)) throw new Error("tenantId inválido");
  const r = await db.execute(sql.raw(`
    SELECT f.*, sa.name AS source_a_name, sb.name AS source_b_name
      FROM analytics.dq_findings f
      LEFT JOIN analytics.dim_source sa
        ON sa.data_source_id = f.source_a AND sa.tenant_id = f.tenant_id
      LEFT JOIN analytics.dim_source sb
        ON sb.data_source_id = f.source_b AND sb.tenant_id = f.tenant_id
     WHERE f.tenant_id = ${ident(tenantId)}
     ORDER BY f.observed_at DESC
     LIMIT 100
  `));
  return (r.rows ?? []) as Array<Record<string, unknown>>;
}
