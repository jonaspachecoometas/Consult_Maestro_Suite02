import { pool } from "./db";

/**
 * Read-only SQL sandbox for the BI agent. Executes a single SELECT (or
 * CTE) statement inside a READ ONLY transaction with a strict statement
 * timeout, dangerous-keyword filtering, and a hard row cap.
 *
 * Tenant isolation: callers MUST pass the tenantId. The sandbox refuses
 * the query if it touches a tenant-scoped table without the literal
 * tenant value present in the SQL text. Superadmin callers may bypass
 * this check by passing { allowCrossTenant: true }.
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT",
  "DROP", "TRUNCATE", "ALTER", "CREATE", "REPLACE",
  "GRANT", "REVOKE", "COPY", "VACUUM", "ANALYZE",
  "REINDEX", "CLUSTER", "REFRESH", "LOCK",
  "CALL", "DO", "EXECUTE", "PREPARE", "DEALLOCATE",
  "LISTEN", "NOTIFY", "UNLISTEN", "SECURITY",
  "PG_SLEEP", "PG_TERMINATE", "PG_CANCEL", "PG_READ_FILE", "PG_LS_DIR",
];

// Tables that contain a tenant_id column — kept in sync manually with
// the schema. The sandbox forces every query to either touch only
// tenant-free tables, or to mention the tenant id explicitly.
const TENANT_SCOPED_TABLES = new Set([
  "clients", "projects", "canvas_blocks", "processes", "deliverables",
  "tasks", "swot_analyses", "swot_items", "erp_requirements",
  "report_configurations", "crm_leads", "crm_opportunities",
  "crm_activities", "crm_pipeline_stages", "crm_proposals",
  "crm_contracts", "crm_partners", "scrum_internal_projects",
  "scrum_backlog_items", "scrum_sprints", "scrum_timesheets",
  "support_tickets", "knowledge_articles", "training_content",
  "client_portal_access", "brain_categories", "brain_items",
  "agent_logs", "agent_definitions", "canvas_pdca_items",
  "tenant_users", "sub_tenants", "invite_tokens", "role_permissions",
  "sql_queries", "bi_dashboards",
  // Analytics fact/dim tables — usam coluna tenant_id (não arcadia_tenant_id)
  "fact_revenue", "fact_crm", "fact_atlas_products",
  "dim_client", "dim_source",
]);

// Tables we never want the agent to read (sessions, users with hashed
// passwords, secrets, etc).
const BLOCKED_TABLES = new Set([
  "sessions", "users", "invite_tokens", "tenant_users",
  "client_portal_access", "agent_logs",
]);

// Strict allowlist of every table the sandbox is allowed to read. Any
// table outside this list (including tenant-owned tables that lack a
// tenant_id column) is rejected so the agent cannot leak cross-tenant
// data through under-protected relations.
const READABLE_TABLES = new Set<string>([
  ...Array.from([
    "clients", "projects", "canvas_blocks", "processes", "deliverables",
    "tasks", "swot_analyses", "swot_items", "erp_requirements",
    "report_configurations", "crm_leads", "crm_opportunities",
    "crm_activities", "crm_pipeline_stages", "crm_proposals",
    "crm_contracts", "crm_partners", "scrum_internal_projects",
    "scrum_backlog_items", "scrum_sprints", "scrum_timesheets",
    "support_tickets", "knowledge_articles", "training_content",
    "brain_categories", "brain_items", "agent_definitions",
    "canvas_pdca_items", "sub_tenants", "role_permissions",
    "sql_queries", "bi_dashboards",
  ]),
  // Analytics schema — atlas staging tables (read-only, tenant-isolated por arcadia_tenant_id)
  "analytics.atlas_pessoas", "analytics.atlas_contatos", "analytics.atlas_enderecos",
  "analytics.atlas_produtos", "analytics.atlas_marcas", "analytics.atlas_grupos_produtos",
  "analytics.atlas_modelos", "analytics.atlas_produto_similares",
  "analytics.atlas_tabela_preco_produtos", "analytics.atlas_pedidos",
  "analytics.atlas_pedido_produtos", "analytics.atlas_contas",
  "analytics.atlas_forma_pagamentos", "analytics.atlas_categoria_conta",
  "analytics.atlas_dres", "analytics.atlas_pagar_recebers",
  "analytics.atlas_compras", "analytics.atlas_compra_produtos",
  "analytics.atlas_saida_estoques", "analytics.atlas_produto_saida_estoques",
  "analytics.atlas_entrada_estoques", "analytics.atlas_comissoes",
  "analytics.atlas_status", "analytics.atlas_transferencias_estoque",
  "analytics.atlas_data_sources",
  // Fact tables
  "analytics.fact_revenue", "analytics.fact_crm", "analytics.fact_atlas_products",
  "analytics.dim_client", "analytics.dim_source",
]);

const MAX_ROWS = 1000;
const STATEMENT_TIMEOUT_MS = 5000;

export class SandboxError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function stripCommentsAndStrings(sql: string): string {
  // Remove /* ... */ and -- comments, and the contents of string literals,
  // so keyword matching doesn't false-positive on commented words.
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  out = out.replace(/--[^\n]*/g, " ");
  // Replace single-quoted strings with empty quotes
  out = out.replace(/'(?:''|[^'])*'/g, "''");
  return out;
}

function detectStatementCount(stripped: string): number {
  // Count semicolons that separate top-level statements (rough — enough
  // to reject obvious chaining).
  const trimmed = stripped.trim().replace(/;+\s*$/, "");
  return trimmed.split(/;/).filter((s) => s.trim().length > 0).length;
}

function findForbiddenKeyword(stripped: string): string | null {
  const upper = stripped.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) return kw;
  }
  return null;
}

interface TableRef { schema: string | null; name: string }

function extractReferencedTables(stripped: string): TableRef[] {
  const out: TableRef[] = [];
  const seen = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?(?:"?([a-zA-Z_][a-zA-Z0-9_]*)"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const schema = m[1] ? m[1].toLowerCase() : null;
    const name = m[2].toLowerCase();
    const key = `${schema ?? ""}.${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ schema, name });
  }
  return out;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function findTenantIdLiterals(rawSql: string): string[] {
  // Match `tenant_id = '<uuid>'` (with optional table/alias qualifier and
  // any whitespace). Returns lowercased uuid values found.
  const re = /\btenant_id\s*=\s*'([0-9a-fA-F-]{36})'/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawSql)) !== null) out.push(m[1].toLowerCase());
  return out;
}

function ensureLimit(sql: string): string {
  const upper = sql.toUpperCase();
  if (/\bLIMIT\s+\d+/.test(upper)) return sql;
  // Strip trailing semicolons before appending LIMIT.
  const trimmed = sql.replace(/;+\s*$/, "");
  return `${trimmed}\nLIMIT ${MAX_ROWS}`;
}

export interface SandboxResult {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  truncated: boolean;
}

export interface ExecuteOptions {
  tenantId: string | null;
  allowCrossTenant?: boolean;
}

export async function executeSandboxQuery(
  rawSql: string,
  opts: ExecuteOptions,
): Promise<SandboxResult> {
  if (!rawSql || typeof rawSql !== "string") {
    throw new SandboxError("Empty SQL", 400);
  }
  const sql = rawSql.trim();
  if (sql.length === 0) throw new SandboxError("Empty SQL", 400);
  if (sql.length > 8000) throw new SandboxError("SQL too long (max 8000 chars)", 400);

  const stripped = stripCommentsAndStrings(sql);

  // Must start with SELECT or WITH (read-only).
  const head = stripped.trim().replace(/^\(+/, "").toUpperCase();
  if (!/^\s*(SELECT|WITH)\b/.test(head)) {
    throw new SandboxError("Only SELECT or WITH queries are allowed", 400);
  }

  // No statement chaining.
  if (detectStatementCount(stripped) > 1) {
    throw new SandboxError("Only a single statement is allowed (no ';')", 400);
  }

  // No forbidden keywords.
  const bad = findForbiddenKeyword(stripped);
  if (bad) throw new SandboxError(`Forbidden keyword: ${bad}`, 400);

  // Disallow set operations (UNION/INTERSECT/EXCEPT) — they are an easy
  // vector for combining a tenant-filtered branch with an unfiltered one
  // and leaking data across tenants. The agent rarely needs them.
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(stripped)) {
    throw new SandboxError(
      "UNION/INTERSECT/EXCEPT are not allowed in the sandbox",
      400,
    );
  }

  const tables = extractReferencedTables(stripped);

  // Reject any non-public schema reference (information_schema, pg_catalog,
  // pg_*) — those expose system metadata and other tenants' rows.
  // Allow `analytics.*` apenas para tabelas atlas_/fact_/dim_ vetadas (isoladas por arcadia_tenant_id).
  const SAFE_ANALYTICS_PREFIXES = ["atlas_", "fact_", "dim_"];
  for (const t of tables) {
    if (t.schema && t.schema !== "public") {
      const isSafeAnalytics =
        t.schema === "analytics" &&
        SAFE_ANALYTICS_PREFIXES.some((p) => t.name.startsWith(p));
      if (!isSafeAnalytics) {
        throw new SandboxError(
          `Access to schema "${t.schema}" is not allowed`,
          403,
        );
      }
    }
    if (t.name.startsWith("pg_") || t.name.startsWith("information_")) {
      throw new SandboxError(
        `Access to system table "${t.name}" is not allowed`,
        403,
      );
    }
  }

  // Block sensitive tables (defense-in-depth).
  for (const t of tables) {
    if (BLOCKED_TABLES.has(t.name)) {
      throw new SandboxError(`Access to table "${t.name}" is not allowed`, 403);
    }
  }

  // Strict allowlist: every referenced relation must be either a known
  // tenant-scoped business table or a vetted global table. Anything else
  // (including tenant-owned relations without a tenant_id column) is
  // refused. Para tabelas em analytics, checamos o nome qualificado.
  for (const t of tables) {
    const lookupName = t.schema === "analytics" ? `analytics.${t.name}` : t.name;
    if (!READABLE_TABLES.has(lookupName)) {
      throw new SandboxError(
        `Table "${lookupName}" is not in the BI sandbox allowlist`,
        403,
      );
    }
  }

  // Atlas tables use arcadia_tenant_id instead of tenant_id — força filtro explícito.
  const touchesAtlas = tables.some(
    (t) => t.schema === "analytics" && t.name.startsWith("atlas_"),
  );
  if (touchesAtlas && !opts.allowCrossTenant) {
    if (!opts.tenantId) {
      throw new SandboxError("Tenant context required to query atlas tables", 403);
    }
    const expected = opts.tenantId.toLowerCase();
    const arcadiaLiterals = Array.from(
      sql.matchAll(/\barcadia_tenant_id\s*=\s*'([0-9a-fA-F-]{36})'/g),
    ).map((m) => m[1].toLowerCase());
    if (arcadiaLiterals.length === 0) {
      throw new SandboxError(
        `Queries to atlas tables must include: arcadia_tenant_id = '${opts.tenantId}'`,
        400,
      );
    }
    if (!arcadiaLiterals.every((v) => v === expected)) {
      throw new SandboxError(
        "Atlas query references a different tenant",
        403,
      );
    }
  }

  // Tenant scoping: when any tenant-scoped table is referenced, every
  // tenant_id literal in the query MUST equal the caller's tenant id,
  // and at least one such filter must exist. This blocks both omitting
  // the filter AND filtering for someone else's tenant via subqueries
  // or expressions that the substring check would have missed.
  const touchesTenantScoped = tables.some((t) => TENANT_SCOPED_TABLES.has(t.name));
  if (touchesTenantScoped && !opts.allowCrossTenant) {
    if (!opts.tenantId) {
      throw new SandboxError("Tenant context required to query tenant-scoped tables", 403);
    }
    const expected = opts.tenantId.toLowerCase();
    const literals = findTenantIdLiterals(sql);
    if (literals.length === 0) {
      throw new SandboxError(
        `Query must filter by tenant_id = '${opts.tenantId}' to ensure isolation`,
        400,
      );
    }
    for (const lit of literals) {
      if (lit !== expected) {
        throw new SandboxError(
          "Query references a tenant_id literal that does not match the current tenant",
          403,
        );
      }
    }
    // Also guard against UUIDs that look like tenant ids elsewhere in the
    // query (e.g. embedded in a literal that might be misinterpreted by a
    // join). Reject any UUID literal present in the query that isn't the
    // current tenant id when it appears outside the comment-stripped form.
    const allUuids = (sql.match(UUID_RE) || []).map((u) => u.toLowerCase());
    for (const u of allUuids) {
      // A non-tenant UUID is fine as long as it's not used in a tenant_id
      // filter; we only block other tenant ids that look identical to a
      // tenant. This keeps legitimate row-level UUIDs (project ids etc.)
      // working.
      if (u !== expected && literals.includes(u)) {
        throw new SandboxError(
          "Query mixes tenant ids — only the current tenant is allowed",
          403,
        );
      }
    }
  } else if (!opts.allowCrossTenant) {
    // Even when no tenant-scoped table is touched, refuse queries that
    // contain stray tenant_id literals different from the current one.
    if (opts.tenantId) {
      const expected = opts.tenantId.toLowerCase();
      for (const lit of findTenantIdLiterals(sql)) {
        if (lit !== expected) {
          throw new SandboxError(
            "Query references a tenant_id literal that does not match the current tenant",
            403,
          );
        }
      }
    }
  }

  const safeSql = ensureLimit(sql);

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(safeSql);
    await client.query("ROLLBACK");
    const rows = (result.rows || []).slice(0, MAX_ROWS);
    const columns = result.fields?.map((f: any) => f.name) || (rows[0] ? Object.keys(rows[0]) : []);
    return {
      rows,
      columns,
      rowCount: rows.length,
      truncated: (result.rows?.length || 0) > MAX_ROWS,
    };
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (err?.code === "57014") {
      throw new SandboxError(`Query timeout after ${STATEMENT_TIMEOUT_MS}ms`, 408);
    }
    throw new SandboxError(err?.message || "SQL error", 400);
  } finally {
    client.release();
  }
}

/**
 * Compact, agent-friendly description of the schema. Lists every
 * tenant-scoped business table with its columns and types so Claude can
 * write valid queries. Sensitive tables are omitted.
 */
export async function getSchemaForAgent(): Promise<string> {
  const client = await pool.connect();
  try {
    const pubRes = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    const byTable = new Map<string, Array<{ name: string; type: string }>>();
    for (const r of pubRes.rows) {
      if (BLOCKED_TABLES.has(r.table_name)) continue;
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
      byTable.get(r.table_name)!.push({ name: r.column_name, type: r.data_type });
    }

    // Analytics schema — atlas_*/fact_*/dim_*
    const anaRes = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'analytics'
        AND (table_name LIKE 'atlas_%' OR table_name LIKE 'fact_%' OR table_name LIKE 'dim_%')
      ORDER BY table_name, ordinal_position
    `);
    const atlasMap = new Map<string, Array<{ name: string; type: string }>>();
    for (const r of anaRes.rows) {
      const key = `analytics.${r.table_name}`;
      if (!atlasMap.has(key)) atlasMap.set(key, []);
      atlasMap.get(key)!.push({ name: r.column_name, type: r.data_type });
    }

    const lines: string[] = [];
    for (const [table, cols] of Array.from(byTable.entries()).sort()) {
      const isTenantScoped = TENANT_SCOPED_TABLES.has(table);
      lines.push(`TABLE ${table}${isTenantScoped ? "  -- tenant-scoped (must filter tenant_id)" : ""}`);
      for (const c of cols) lines.push(`  ${c.name} ${c.type}`);
      lines.push("");
    }
    if (atlasMap.size > 0) {
      lines.push("-- ATLAS ERP (analytics schema) — filter: arcadia_tenant_id = '<tenantId>'");
      for (const [table, cols] of Array.from(atlasMap.entries()).sort()) {
        lines.push(`TABLE ${table}  -- arcadia_tenant_id required`);
        for (const c of cols) lines.push(`  ${c.name} ${c.type}`);
        lines.push("");
      }
    }
    return lines.join("\n");
  } finally {
    client.release();
  }
}
