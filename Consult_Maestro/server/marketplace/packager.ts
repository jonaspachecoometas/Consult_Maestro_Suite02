// Fase 4 — App Store interna: packager.
// Recebe um pipelineRunId (Dev Center) ou modulePlanId (Module Planner) e
// constrói um snapshot { manifest, filesSnapshot } pronto para virar uma
// versão de marketplace_app.
//
// Decisão arquitetural:
// - Empacotamos `filesSnapshot` (map fileName→content) em vez de só `filesRef`
//   para garantir imutabilidade pós-publicação. Mesmo que o owner apague a
//   run depois, a versão publicada continua instalável.
// - O manifest descreve o que o instalador precisa fazer: tabelas (com DDL
//   já parametrizado para `tenant_id`), rotas declarativas, menu e deps.

import { db } from "../db";
import { and, eq } from "drizzle-orm";
import {
  ideArtifacts,
  idePipelineRuns,
  modulePlans,
} from "@shared/schema";

const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof ALLOWED_HTTP_METHODS)[number];
function asMethod(v: unknown): HttpMethod {
  return (typeof v === "string" && (ALLOWED_HTTP_METHODS as readonly string[]).includes(v)
    ? (v as HttpMethod)
    : "GET");
}

export interface MarketplaceManifestTable {
  // Nome lógico (ex.: "honorarios"). O instalador prefixa com `mkt_<slug>_`
  // para evitar colisão entre módulos publicados.
  name: string;
  description?: string;
  columns: Array<{ name: string; type: string; notes?: string }>;
  // DDL bruto opcional. Se ausente, instalador gera automaticamente a partir
  // de columns. SEMPRE deve incluir tenant_id varchar NOT NULL.
  ddl?: string;
  tenantScoped: true;
}

export interface MarketplaceManifestRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;     // ex: "/api/honorarios"
  description?: string;
}

export interface MarketplaceManifestMenuItem {
  title: string;
  url: string;       // ex: "/m/honorarios"
  icon?: string;     // lucide name
}

export interface MarketplaceManifest {
  version: string;
  source: "pipeline_run" | "module_plan" | "manual";
  sourceId?: string;
  tables: MarketplaceManifestTable[];
  routes: MarketplaceManifestRoute[];
  menu: MarketplaceManifestMenuItem[];
  dependencies: Array<{ module: string; reason?: string }>;
  notes?: string;
}

export interface PackagerOutput {
  manifest: MarketplaceManifest;
  filesSnapshot: Record<string, string>; // fileName → content
  filesRef?: string;                     // referência opcional ao git interno
}

/**
 * Empacota uma pipeline run do Dev Center em payload pronto para o
 * marketplace. tenantId aqui é o owner; valida que a run pertence ao tenant.
 */
export async function packageFromRun(
  tenantId: string,
  runId: string,
  version: string,
): Promise<PackagerOutput> {
  const [run] = await db
    .select()
    .from(idePipelineRuns)
    .where(and(eq(idePipelineRuns.id, runId), eq(idePipelineRuns.tenantId, tenantId)))
    .limit(1);
  if (!run) throw new Error("Pipeline run não encontrada para esse tenant");

  const artifacts = await db
    .select()
    .from(ideArtifacts)
    .where(and(eq(ideArtifacts.runId, runId), eq(ideArtifacts.tenantId, tenantId)));

  const filesSnapshot: Record<string, string> = {};
  for (const a of artifacts) {
    filesSnapshot[a.fileName] = a.content;
  }

  // designDoc do Arquiteto contém um plano de tabelas/rotas; usamos como
  // hint para o manifest. Estrutura conhecida via modulePlanner/planner.ts.
  const designDoc: any = run.designDoc ?? {};
  const tables: MarketplaceManifestTable[] = Array.isArray(designDoc.tables)
    ? designDoc.tables.map((t: any) => ({
        name: String(t.name || "").slice(0, 80),
        description: t.description,
        columns: Array.isArray(t.columns) ? t.columns : [],
        tenantScoped: true,
      })).filter((t: MarketplaceManifestTable) => !!t.name)
    : [];

  const routes: MarketplaceManifestRoute[] = Array.isArray(designDoc.endpoints)
    ? designDoc.endpoints.map((e: any): MarketplaceManifestRoute => ({
        method: asMethod(e?.method),
        path: String(e?.path || "").slice(0, 200),
        description: e?.description,
      })).filter((r: MarketplaceManifestRoute) => !!r.path)
    : [];

  const menu: MarketplaceManifestMenuItem[] = Array.isArray(designDoc.pages)
    ? designDoc.pages.map((p: any) => ({
        title: String(p.name || p.route || "Módulo").slice(0, 120),
        url: String(p.route || "").slice(0, 200),
      })).filter((m: MarketplaceManifestMenuItem) => !!m.url)
    : [];

  const dependencies = Array.isArray(designDoc.dependencies)
    ? designDoc.dependencies.map((d: any) => ({
        module: String(d.module || "").slice(0, 80),
        reason: d.reason ? String(d.reason).slice(0, 300) : undefined,
      })).filter((d: any) => !!d.module)
    : [];

  return {
    manifest: {
      version,
      source: "pipeline_run",
      sourceId: runId,
      tables,
      routes,
      menu,
      dependencies,
    },
    filesSnapshot,
    filesRef: `project-${runId}`,
  };
}

/**
 * Empacota a partir de um module_plan (sem run associada). Útil para
 * publicar planos que não passaram pela pipeline ainda.
 */
export async function packageFromPlan(
  tenantId: string,
  planId: string,
  version: string,
): Promise<PackagerOutput> {
  const [plan] = await db
    .select()
    .from(modulePlans)
    .where(and(eq(modulePlans.id, planId), eq(modulePlans.tenantId, tenantId)))
    .limit(1);
  if (!plan) throw new Error("Plano não encontrado para esse tenant");

  const planJson: any = plan.planJson ?? {};
  const tables: MarketplaceManifestTable[] = Array.isArray(planJson.tables)
    ? planJson.tables.map((t: any) => ({
        name: String(t.name || "").slice(0, 80),
        description: t.description,
        columns: Array.isArray(t.columns) ? t.columns : [],
        tenantScoped: true,
      })).filter((t: MarketplaceManifestTable) => !!t.name)
    : [];

  const routes: MarketplaceManifestRoute[] = Array.isArray(planJson.endpoints)
    ? planJson.endpoints.map((e: any): MarketplaceManifestRoute => ({
        method: asMethod(e?.method),
        path: String(e?.path || "").slice(0, 200),
        description: e?.description,
      })).filter((r: MarketplaceManifestRoute) => !!r.path)
    : [];

  const menu: MarketplaceManifestMenuItem[] = Array.isArray(planJson.pages)
    ? planJson.pages.map((p: any) => ({
        title: String(p.name || p.route || "Módulo").slice(0, 120),
        url: String(p.route || "").slice(0, 200),
      })).filter((m: MarketplaceManifestMenuItem) => !!m.url)
    : [];

  const dependencies = Array.isArray(planJson.dependencies)
    ? planJson.dependencies.map((d: any) => ({
        module: String(d.module || "").slice(0, 80),
        reason: d.reason ? String(d.reason).slice(0, 300) : undefined,
      })).filter((d: any) => !!d.module)
    : [];

  return {
    manifest: {
      version,
      source: "module_plan",
      sourceId: planId,
      tables,
      routes,
      menu,
      dependencies,
      notes: "Pacote gerado a partir de plano sem pipeline run.",
    },
    filesSnapshot: {},
  };
}

/**
 * Calcula schemaDiff (DDL adicional/removido) entre 2 manifests para gerar
 * `schema_diff` e permitir upgrade de versão sem recriar tabelas.
 */
export function computeSchemaDiff(
  prev: MarketplaceManifest | null,
  next: MarketplaceManifest,
): { added: MarketplaceManifestTable[]; removed: string[]; columnsAdded: Array<{ table: string; column: { name: string; type: string } }> } {
  if (!prev) {
    return { added: next.tables, removed: [], columnsAdded: [] };
  }
  const prevByName = new Map(prev.tables.map((t) => [t.name, t]));
  const nextByName = new Map(next.tables.map((t) => [t.name, t]));

  const added = next.tables.filter((t) => !prevByName.has(t.name));
  const removed = prev.tables.map((t) => t.name).filter((n) => !nextByName.has(n));

  const columnsAdded: Array<{ table: string; column: { name: string; type: string } }> = [];
  for (const t of next.tables) {
    const old = prevByName.get(t.name);
    if (!old) continue;
    const oldCols = new Set(old.columns.map((c) => c.name));
    for (const c of t.columns) {
      if (!oldCols.has(c.name)) {
        columnsAdded.push({ table: t.name, column: { name: c.name, type: c.type } });
      }
    }
  }
  return { added, removed, columnsAdded };
}
