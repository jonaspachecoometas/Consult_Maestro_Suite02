import { db } from "../../db";
import { dataSources, dataSnapshots } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

/**
 * Adapter de leitura analítica — Fase 3 BI Multi-Fonte.
 *
 * Estende, em runtime, a interface `IConnector` do Connector Hub para
 * suportar **leitura analítica somente leitura, com cursor `since`**.
 * Em vez de duplicar lógica de conexão (já feita pelos conectores REST,
 * PostgreSQL, Excel/CSV via `runSync`), este reader opera sobre o último
 * snapshot persistido em `data_snapshots` — o que já é o "warehouse
 * intermediário" do Hub. O ETL subsequente materializa em `analytics.*`.
 *
 * Esta abordagem mantém a interface `IConnector` original intacta
 * (test/sync/describeConfig) e adiciona o adapter analítico como um
 * leitor separado que reusa o snapshot já produzido.
 */

export interface AnalyticalRow {
  raw: Record<string, unknown>;
  /** Timestamp inferido a partir do `cursorColumn` informado. */
  cursorAt: Date | null;
}

export interface AnalyticalReadOptions {
  tenantId: string;
  dataSourceId: string;
  /** Lê apenas linhas onde `cursorColumn > since`. ISO string ou Date. */
  since?: string | Date | null;
  /** Coluna usada como cursor (ex.: "updated_at"). */
  cursorColumn?: string;
  /** Limite defensivo. */
  limit?: number;
}

export interface AnalyticalReadResult {
  source: { id: string; name: string; type: string };
  rows: AnalyticalRow[];
  columns: string[];
  totalRows: number;
  fetchedRows: number;
  cursorMax: Date | null;
  syncedAt: Date | null;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function readAnalytical(
  opts: AnalyticalReadOptions,
): Promise<AnalyticalReadResult> {
  const { tenantId, dataSourceId, cursorColumn, since, limit = 50_000 } = opts;
  const [src] = await db.select().from(dataSources).where(
    and(eq(dataSources.id, dataSourceId), eq(dataSources.tenantId, tenantId)),
  );
  if (!src) {
    throw new Error(`Fonte ${dataSourceId} não encontrada para tenant ${tenantId}`);
  }
  const [snap] = await db.select().from(dataSnapshots).where(
    and(
      eq(dataSnapshots.dataSourceId, dataSourceId),
      eq(dataSnapshots.tenantId, tenantId),
    ),
  ).orderBy(desc(dataSnapshots.syncedAt)).limit(1);

  const sinceDate = since ? toDate(since) : null;
  const allRows = Array.isArray(snap?.data) ? (snap!.data as Array<Record<string, unknown>>) : [];
  const columns = Array.isArray(snap?.columns) ? (snap!.columns as string[]) : [];

  const fetched: AnalyticalRow[] = [];
  let cursorMax: Date | null = null;

  for (const r of allRows) {
    const c = cursorColumn ? toDate(r[cursorColumn]) : null;
    if (sinceDate && c && c <= sinceDate) continue;
    fetched.push({ raw: r, cursorAt: c });
    if (c && (!cursorMax || c > cursorMax)) cursorMax = c;
    if (fetched.length >= limit) break;
  }

  return {
    source: { id: src.id, name: src.name, type: src.type },
    rows: fetched,
    columns,
    totalRows: allRows.length,
    fetchedRows: fetched.length,
    cursorMax,
    syncedAt: snap?.syncedAt ?? null,
  };
}

/**
 * Convenience: list all sources eligible for an ETL kind on a tenant.
 * The mapping convention is stored in `data_sources.configPublic.analyticsMapping`:
 *
 * configPublic.analyticsMapping = {
 *   kind: 'fact_revenue' | 'dim_client',
 *   cursorColumn?: 'updated_at',
 *   columnMap: {
 *     natural_key: 'id',
 *     period: 'data_emissao',     // for fact_revenue
 *     amount: 'valor_total',
 *     client_natural_key: 'cliente_id',
 *     // for dim_client:
 *     name: 'razao_social', document: 'cnpj', status: 'situacao'
 *   }
 * }
 */
export interface AnalyticsMapping {
  kind: "fact_revenue" | "dim_client";
  cursorColumn?: string;
  columnMap: Record<string, string>;
}

export function readMapping(
  configPublic: Record<string, unknown> | null | undefined,
): AnalyticsMapping | null {
  const raw = configPublic?.analyticsMapping;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { kind?: unknown; cursorColumn?: unknown; columnMap?: unknown };
  if (m.kind !== "fact_revenue" && m.kind !== "dim_client") return null;
  if (!m.columnMap || typeof m.columnMap !== "object") return null;
  return {
    kind: m.kind,
    cursorColumn: typeof m.cursorColumn === "string" ? m.cursorColumn : undefined,
    columnMap: m.columnMap as Record<string, string>,
  };
}
