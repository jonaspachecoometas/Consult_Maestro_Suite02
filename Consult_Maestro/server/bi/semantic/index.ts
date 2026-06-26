import { db } from "../../db";
import { sql } from "drizzle-orm";
import type {
  SemanticContext, SemanticMetric, SemanticDimension, MetricRow,
} from "./types";
import * as control from "./control";
import * as migration from "./migration";
import * as dq from "./dataquality";
import * as crm from "./crm";
import * as hr from "./hr";
import * as scrum from "./scrum";
import * as societario from "./societario";
import * as recovery from "./recovery";
import * as fiscal from "./fiscal";
import * as atlas from "./atlas";
import * as contabil from "./contabil";
import * as estoque from "./estoque";
import * as custos from "./custos";
import { biCache, biCacheKey } from "../cache";

/**
 * Loader central da Semantic Layer.
 *
 * Ao adicionar um novo módulo, importe-o aqui e inclua no `MODULES`.
 */

interface SemanticModule {
  metrics?: SemanticMetric[];
  dimensions?: SemanticDimension[];
}

const MODULES: SemanticModule[] = [
  control, migration, dq,
  crm, hr, scrum, societario, recovery, fiscal, atlas, contabil,
  estoque, custos,
];

const METRICS: SemanticMetric[] = MODULES.flatMap((m) => m.metrics ?? []);
const DIMENSIONS: SemanticDimension[] = MODULES.flatMap(
  (m) => m.dimensions ?? [],
);

const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export interface SemanticCatalogEntry {
  id: string;
  module: string;
  label: string;
  description: string;
  defaultWidget: SemanticMetric["defaultWidget"];
  cacheTtlSeconds: number;
}

export function listSemanticMetrics(): SemanticCatalogEntry[] {
  return METRICS.map(({ buildQuery, ...rest }) => rest);
}

export function listSemanticDimensions(): SemanticDimension[] {
  return DIMENSIONS.slice();
}

export function getSemanticMetric(id: string): SemanticMetric | undefined {
  return METRIC_BY_ID.get(id);
}

const UUID_LIKE = /^[a-zA-Z0-9_-]{8,64}$/;

export async function runSemanticMetric(
  metricId: string,
  ctx: SemanticContext,
): Promise<{ rows: MetricRow[]; cached: boolean; ttlSeconds: number }> {
  const metric = METRIC_BY_ID.get(metricId);
  if (!metric) throw new Error(`Métrica semântica desconhecida: ${metricId}`);
  if (!ctx.tenantId || !UUID_LIKE.test(ctx.tenantId)) {
    throw new Error("tenantId inválido");
  }

  const key = biCacheKey(ctx.tenantId, "semantic", { metricId, ctx });
  const cached = await biCache.get<MetricRow[]>(key);
  if (cached) return { rows: cached, cached: true, ttlSeconds: metric.cacheTtlSeconds };

  const q = metric.buildQuery(ctx);
  const start = Date.now();
  let rows: MetricRow[] = [];
  try {
    const res = await db.execute(sql.raw(q.sql));
    const raw = (res.rows ?? []) as Array<Record<string, unknown>>;
    rows = raw.map((r) => ({
      name: String(r.name ?? "—"),
      value: Number(r.value ?? 0),
      ...(r.series !== undefined ? { series: String(r.series) } : {}),
    }));
  } catch (err: unknown) {
    // Quando as tabelas analytics ainda não foram populadas, não derrubar
    // o dashboard — devolve vazio. ETL não rodou ou tenant é novo.
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      rows = [];
    } else {
      throw err;
    }
  }
  const elapsed = Date.now() - start;
  // Só cacheia consultas custosas para evitar inflar memória com queries
  // triviais; ainda assim respeitamos cacheTtlSeconds=0 como "não cachear".
  if (metric.cacheTtlSeconds > 0 && elapsed > 50) {
    await biCache.set(key, rows, metric.cacheTtlSeconds);
  }
  return { rows, cached: false, ttlSeconds: metric.cacheTtlSeconds };
}

/**
 * Catálogo agrupado por módulo, formato consumido pelo BiBuilder.
 */
export function listSemanticCatalogGrouped() {
  const groups = new Map<string, SemanticCatalogEntry[]>();
  for (const m of listSemanticMetrics()) {
    if (!groups.has(m.module)) groups.set(m.module, []);
    groups.get(m.module)!.push(m);
  }
  return Array.from(groups.entries()).map(([module, items]) => ({ module, items }));
}
