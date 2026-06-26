# Atlas Explorer — Plano completo para o Replit
**Data:** 26/05/2026  
**Escopo:** Explorador de tabelas + Query builder visual + SQL ad-hoc no BI

---

## Diagnóstico do que precisa mudar

| Componente | Estado | O que falta |
|---|---|---|
| `sqlSandbox.ts` linha 194 | ❌ Bloqueia qualquer schema não-public | Permitir `analytics.atlas_*` para o tenant dono |
| `getSchemaForAgent()` | ❌ Só lê `public.*` | Incluir `analytics.atlas_*` com isolamento |
| `READABLE_TABLES` | ❌ Só tabelas public | Adicionar atlas_* com prefixo `analytics.` |
| Backend `/api/atlas/catalog` | ❌ Não existe | Criar: lista tabelas, colunas, row counts |
| Backend `/api/atlas/query` | ❌ Não existe | Criar: executa SELECT com sandbox read-only |
| Frontend `AtlasExplorer` | ❌ Não existe | Criar página em `/datasets/atlas/explorer` |

---

## PATCH 1 — `server/sqlSandbox.ts`

### 1a. Remover bloqueio hard do schema analytics (linha 194)

**Substituir:**
```typescript
  // Reject any non-public schema reference (information_schema, pg_catalog,
  for (const t of tables) {
    if (t.schema && t.schema !== "public") {
      throw new SandboxError(
        `Access to schema "${t.schema}" is not allowed`,
```

**Por:**
```typescript
  // Allow analytics.atlas_* for atlas data. Block everything else outside public.
  for (const t of tables) {
    if (t.schema && t.schema !== "public") {
      // analytics schema: only atlas_* tables are allowed (tenant-isolated by arcadia_tenant_id)
      const isAtlasTable = t.schema === "analytics" && t.name.startsWith("atlas_");
      const isSafeAnalytics = t.schema === "analytics" && (
        t.name.startsWith("atlas_") ||
        ["fact_revenue","fact_crm","fact_atlas_products","dim_client","dim_source",
         "etl_runs","dq_findings","migration_state"].includes(t.name)
      );
      if (!isSafeAnalytics) {
        throw new SandboxError(
          `Access to schema "${t.schema}" is not allowed`,
```

### 1b. Adicionar `analytics.atlas_*` ao READABLE_TABLES

**Adicionar no READABLE_TABLES Set (após o último item):**
```typescript
  // Analytics schema — atlas staging tables (read-only, tenant-isolated)
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
```

### 1c. Adicionar verificação de tenant para analytics.atlas_*

**No bloco de tenant scoping, após a verificação `touchesTenantScoped`, adicionar:**
```typescript
  // Atlas tables use arcadia_tenant_id instead of tenant_id
  const touchesAtlas = tables.some(t =>
    t.schema === "analytics" && t.name.startsWith("atlas_")
  );
  if (touchesAtlas && !opts.allowCrossTenant) {
    if (!opts.tenantId) throw new SandboxError("Tenant context required", 403);
    const expected = opts.tenantId.toLowerCase();
    // Must have arcadia_tenant_id = '<tenantId>' in the query
    const arcadiaLiterals = (sql.match(/arcadia_tenant_id\s*=\s*'([^']+)'/gi) ?? [])
      .map(m => m.match(/'([^']+)'/)?.[1]?.toLowerCase() ?? "");
    if (arcadiaLiterals.length === 0) {
      throw new SandboxError(
        "Queries to atlas tables must include: arcadia_tenant_id = '<tenantId>'",
        403,
      );
    }
    if (!arcadiaLiterals.every(v => v === expected)) {
      throw new SandboxError("Atlas query references wrong tenant", 403);
    }
  }
```

### 1d. Expandir `getSchemaForAgent()` para incluir atlas_*

**Substituir o método inteiro:**
```typescript
export async function getSchemaForAgent(tenantId?: string): Promise<string> {
  const client = await pool.connect();
  try {
    // Public schema (original tables)
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

    // Analytics schema — only atlas_* and fact_* tables
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

    // Public tables
    for (const [table, cols] of Array.from(byTable.entries()).sort()) {
      const isTenantScoped = TENANT_SCOPED_TABLES.has(table);
      lines.push(`TABLE ${table}${isTenantScoped ? "  -- filter: tenant_id = '<tenantId>'" : ""}`);
      for (const c of cols) lines.push(`  ${c.name} ${c.type}`);
      lines.push("");
    }

    // Analytics tables
    if (atlasMap.size > 0) {
      lines.push("-- ATLAS ERP (analytics schema) — filter: arcadia_tenant_id = '<tenantId>'");
      for (const [table, cols] of Array.from(atlasMap.entries()).sort()) {
        lines.push(`TABLE ${table}  -- filter: arcadia_tenant_id`);
        for (const c of cols) lines.push(`  ${c.name} ${c.type}`);
        lines.push("");
      }
    }

    return lines.join("\n");
  } finally {
    client.release();
  }
}
```

---

## PATCH 2 — Novas rotas em `server/routes.ts`

```typescript
// ── Atlas Explorer — catálogo de tabelas ──────────────────────────────────
app.get("/api/atlas/catalog", isAuthenticated, requireTenant, async (req: any, res) => {
  try {
    const client = await pool.connect();
    try {
      // List atlas tables with column info and row counts
      const tablesRes = await client.query(`
        SELECT
          c.table_name,
          COUNT(c.column_name) AS column_count,
          COALESCE(s.n_live_tup, 0) AS row_estimate
        FROM information_schema.columns c
        LEFT JOIN pg_stat_user_tables s
               ON s.schemaname = 'analytics' AND s.relname = c.table_name
        WHERE c.table_schema = 'analytics'
          AND c.table_name LIKE 'atlas_%'
        GROUP BY c.table_name, s.n_live_tup
        ORDER BY s.n_live_tup DESC NULLS LAST, c.table_name
      `);

      // Get columns for each table
      const colsRes = await client.query(`
        SELECT table_name, column_name, data_type, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'analytics'
          AND table_name LIKE 'atlas_%'
        ORDER BY table_name, ordinal_position
      `);

      const colsByTable = new Map<string, any[]>();
      for (const r of colsRes.rows) {
        if (!colsByTable.has(r.table_name)) colsByTable.set(r.table_name, []);
        colsByTable.get(r.table_name)!.push({
          name: r.column_name,
          type: r.data_type,
          position: r.ordinal_position,
        });
      }

      const tables = tablesRes.rows.map(t => ({
        name: `analytics.${t.table_name}`,
        displayName: t.table_name.replace("atlas_", "").replace(/_/g, " "),
        rowEstimate: parseInt(t.row_estimate) || 0,
        columnCount: parseInt(t.column_count) || 0,
        columns: colsByTable.get(t.table_name) ?? [],
      }));

      res.json({ tables, tenantId: req.tenantId });
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Atlas Explorer — preview de tabela ───────────────────────────────────
app.get("/api/atlas/table/:tableName", isAuthenticated, requireTenant, async (req: any, res) => {
  try {
    const raw = req.params.tableName; // e.g. "atlas_pedidos"
    // Safety: only atlas_ tables
    if (!raw.match(/^atlas_[a-z_]+$/)) {
      return res.status(400).json({ message: "Tabela inválida" });
    }
    const fullTable = `analytics.${raw}`;
    const tenantId = req.tenantId!;

    // Column check
    const { pool } = await import("./db");
    const client = await pool.connect();
    try {
      const { rows: cols } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'analytics' AND table_name = $1
        ORDER BY ordinal_position
      `, [raw]);

      const colNames = cols.map((c: any) => c.column_name);
      const hasArcadiaId = colNames.includes("arcadia_tenant_id");

      // Build safe SELECT
      const whereClause = hasArcadiaId ? `WHERE arcadia_tenant_id = $1` : "";
      const params = hasArcadiaId ? [tenantId] : [];

      // Filters from query params
      const filters = req.query.filters ? JSON.parse(req.query.filters as string) : {};
      const search = req.query.search as string | undefined;
      const sortBy = colNames.includes(req.query.sortBy as string) ? req.query.sortBy as string : "id";
      const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";
      const page = Math.max(0, parseInt(req.query.page as string) || 0);
      const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize as string) || 50));

      // Count
      const countRes = await client.query(
        `SELECT COUNT(*) FROM ${fullTable} ${whereClause}`,
        params,
      );
      const totalRows = parseInt(countRes.rows[0].count);

      // Data
      const dataRes = await client.query(
        `SELECT * FROM ${fullTable} ${whereClause}
         ORDER BY "${sortBy}" ${sortDir}
         LIMIT ${pageSize} OFFSET ${page * pageSize}`,
        params,
      );

      res.json({
        table: fullTable,
        columns: colNames,
        rows: dataRes.rows,
        totalRows,
        page,
        pageSize,
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Atlas Explorer — SQL ad-hoc (sandbox) ────────────────────────────────
app.post("/api/atlas/query", isAuthenticated, requireTenant, async (req: any, res) => {
  try {
    const { sql: querySql } = req.body;
    if (!querySql || typeof querySql !== "string") {
      return res.status(400).json({ message: "sql required" });
    }

    const role = req.tenantRole;
    if (!req.isSuperadmin && role !== "admin" && role !== "gerente") {
      return res.status(403).json({ message: "Requer perfil admin ou gerente" });
    }

    const { executeSandboxQuery, SandboxError } = await import("./sqlSandbox");
    const result = await executeSandboxQuery(querySql, {
      tenantId: req.tenantId!,
      allowCrossTenant: req.isSuperadmin,
    });

    res.json({
      rows: result.rows.slice(0, 1000),
      columns: result.columns,
      rowCount: result.rowCount,
      truncated: result.rowCount > 1000,
      executionMs: result.executionMs,
    });
  } catch (err: any) {
    const status = err instanceof SandboxError ? err.status : 500;
    res.status(status).json({ message: err.message });
  }
});

// ── Atlas Explorer — SQL via NL (agente) ─────────────────────────────────
app.post("/api/atlas/sql-agent", isAuthenticated, requireTenant, async (req: any, res) => {
  try {
    const role = req.tenantRole;
    if (!req.isSuperadmin && role !== "admin" && role !== "gerente") {
      return res.status(403).json({ message: "Requer perfil admin ou gerente" });
    }
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ message: "prompt required" });

    const { runSqlAgent } = await import("./agentService");
    const result = await runSqlAgent({
      prompt: `[Atlas ERP context] ${prompt}`,
      tenantId: req.tenantId!,
      userId: getAuthUserId(req),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

---

## PATCH 3 — Frontend `client/src/pages/AtlasExplorer.tsx` (criar)

```tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import {
  Database, Table2, Search, Play, Download, ChevronRight,
  ChevronLeft, Loader2, Sparkles, BarChart3, Code2, ArrowUpDown,
  RefreshCcw,
} from "lucide-react";

type CatalogTable = {
  name: string;         // "analytics.atlas_pedidos"
  displayName: string;  // "pedidos"
  rowEstimate: number;
  columnCount: number;
  columns: { name: string; type: string }[];
};

type TableData = {
  table: string;
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
  page: number;
  pageSize: number;
};

type QueryResult = {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  truncated: boolean;
  executionMs?: number;
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AtlasExplorer() {
  const [activeTable, setActiveTable] = useState<CatalogTable | null>(null);
  const [mode, setMode] = useState<"browse" | "sql" | "ai">("browse");

  const { data: catalog, isLoading: catalogLoading } = useQuery<{ tables: CatalogTable[] }>({
    queryKey: ["/api/atlas/catalog"],
  });

  const tables = catalog?.tables ?? [];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border/50 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Atlas Explorer</span>
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["browse", "sql", "ai"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {m === "browse" ? "Explorar" : m === "sql" ? "SQL" : "Perguntar"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{tables.length} tabelas</span>
          <span>·</span>
          <a href="/bi" className="flex items-center gap-1 hover:text-foreground">
            <BarChart3 className="h-3 w-3" /> BI Builder
          </a>
        </div>
      </div>

      {mode === "browse" && (
        <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          {/* Left: table list */}
          <ResizablePanel defaultSize={22} minSize={16} maxSize={35}>
            <TableList
              tables={tables}
              loading={catalogLoading}
              active={activeTable?.name ?? null}
              onSelect={setActiveTable}
            />
          </ResizablePanel>
          <ResizableHandle />
          {/* Right: table data */}
          <ResizablePanel defaultSize={78}>
            {activeTable
              ? <TableViewer table={activeTable} />
              : <EmptyState onSelectFirst={() => tables[0] && setActiveTable(tables[0])} />
            }
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {mode === "sql" && <SqlEditor />}
      {mode === "ai" && <AiQueryBuilder onSwitchToSql={() => setMode("sql")} />}
    </div>
  );
}

// ── Table List ────────────────────────────────────────────────────────────────
function TableList({
  tables, loading, active, onSelect,
}: {
  tables: CatalogTable[];
  loading: boolean;
  active: string | null;
  onSelect: (t: CatalogTable) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = tables.filter(t =>
    !search || t.displayName.includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col border-r border-border/50">
      <div className="p-2 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filtrar tabelas…"
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground text-center">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            Nenhuma tabela. Importe dados do Atlas primeiro.
          </div>
        ) : (
          filtered.map(t => (
            <button
              key={t.name}
              onClick={() => onSelect(t)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-border/30 transition-colors hover:bg-muted/50 ${
                active === t.name ? "bg-primary/10 border-l-2 border-l-primary" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Table2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="font-medium truncate">{t.displayName}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-muted-foreground">
                <span>{t.rowEstimate > 0 ? t.rowEstimate.toLocaleString("pt-BR") : "—"} linhas</span>
                <span>{t.columnCount} colunas</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Table Viewer ──────────────────────────────────────────────────────────────
function TableViewer({ table }: { table: CatalogTable }) {
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  // Reset page on table change
  useEffect(() => { setPage(0); setSortBy("id"); }, [table.name]);

  const tableName = table.name.replace("analytics.", ""); // strip prefix for route

  const { data, isLoading, refetch } = useQuery<TableData>({
    queryKey: ["/api/atlas/table", tableName, page, pageSize, sortBy, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(pageSize),
        sortBy, sortDir,
      });
      const res = await fetch(`/api/atlas/table/${tableName}?${params}`, {
        credentials: "include",
      });
      return res.json();
    },
  });

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
    setPage(0);
  }

  function exportCsv() {
    if (!data?.rows.length) return;
    const cols = data.columns;
    const csv = [cols.join(","),
      ...data.rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(","))
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${tableName}.csv`;
    a.click();
  }

  const rows = data?.rows ?? [];
  const cols = data?.columns ?? table.columns.map(c => c.name);
  const totalRows = data?.totalRows ?? table.rowEstimate;
  const totalPages = Math.ceil(totalRows / pageSize);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{table.displayName}</span>
          <Badge variant="secondary" className="text-[10px]">
            {totalRows.toLocaleString("pt-BR")} linhas
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {cols.length} colunas
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCcw className="h-3 w-3" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={exportCsv}>
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      {/* Schema quick view */}
      <div className="px-3 py-1.5 border-b border-border/30 flex gap-2 overflow-x-auto scrollbar-thin">
        {table.columns.map(c => (
          <span key={c.name} className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {c.name} <span className="opacity-60">{c.type.replace("character varying", "varchar").replace("timestamp with time zone", "timestamptz")}</span>
          </span>
        ))}
      </div>

      {/* Data grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando…
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {cols.map(col => (
                  <TableHead
                    key={col}
                    className="cursor-pointer hover:bg-muted/50 select-none text-xs h-8 whitespace-nowrap"
                    onClick={() => toggleSort(col)}
                  >
                    <div className="flex items-center gap-1">
                      {col}
                      {sortBy === col && (
                        <ArrowUpDown className={`h-3 w-3 ${sortDir === "desc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i} className="hover:bg-muted/30">
                  {cols.map(col => (
                    <TableCell key={col} className="text-xs py-1.5 max-w-[200px] truncate">
                      {row[col] === null || row[col] === undefined
                        ? <span className="text-muted-foreground/50 italic">null</span>
                        : typeof row[col] === "boolean"
                          ? <Badge variant={row[col] ? "default" : "secondary"} className="text-[10px] h-4">{row[col] ? "true" : "false"}</Badge>
                          : String(row[col]).length > 60
                            ? <span title={String(row[col])}>{String(row[col]).slice(0, 60)}…</span>
                            : String(row[col])
                      }
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      <div className="border-t border-border/50 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalRows)} de {totalRows.toLocaleString("pt-BR")}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="px-2">Pág. {page + 1}/{Math.max(1, totalPages)}</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── SQL Editor ────────────────────────────────────────────────────────────────
function SqlEditor() {
  const { toast } = useToast();
  const [sql, setSql] = useState(
    `-- Exemplo: top 10 clientes por receita\nSELECT\n  p.nome_fantasia AS cliente,\n  SUM(ped.valor_total) AS receita_total\nFROM analytics.atlas_pedidos ped\nJOIN analytics.atlas_pessoas p\n  ON p.id = ped.cliente_id\n  AND p.arcadia_tenant_id = ped.arcadia_tenant_id\nWHERE ped.arcadia_tenant_id = 'SEU_TENANT_ID'\n  AND ped.status_id = 14\nGROUP BY p.nome_fantasia\nORDER BY receita_total DESC\nLIMIT 10`
  );
  const [result, setResult] = useState<QueryResult | null>(null);

  const runMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/atlas/query", { sql: q });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json() as Promise<QueryResult>;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: any) => toast({ title: "Erro SQL", description: err.message, variant: "destructive" }),
  });

  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ResizablePanelGroup direction="vertical">
        {/* Editor */}
        <ResizablePanel defaultSize={40} minSize={20}>
          <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">SQL Editor</span>
                <Badge variant="secondary" className="text-[10px]">read-only sandbox</Badge>
              </div>
              <Button
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => runMutation.mutate(sql)}
                disabled={runMutation.isPending || !sql.trim()}
              >
                {runMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Executando…</>
                  : <><Play className="h-3.5 w-3.5" /> Executar</>
                }
              </Button>
            </div>
            <Textarea
              value={sql}
              onChange={e => setSql(e.target.value)}
              className="flex-1 font-mono text-xs rounded-none border-0 resize-none focus-visible:ring-0 bg-muted/20"
              placeholder="SELECT * FROM analytics.atlas_pedidos WHERE arcadia_tenant_id = '...' LIMIT 100"
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  runMutation.mutate(sql);
                }
              }}
            />
            <div className="px-3 py-1 border-t border-border/30 text-[10px] text-muted-foreground">
              Ctrl+Enter para executar · Tabelas disponíveis: analytics.atlas_* · Máx. 1000 linhas
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Results */}
        <ResizablePanel defaultSize={60}>
          <div className="h-full flex flex-col">
            <div className="px-3 py-1.5 border-b border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              {result ? (
                <span>
                  {result.rowCount.toLocaleString("pt-BR")} linhas
                  {result.truncated ? " (truncado em 1000)" : ""}
                  {result.executionMs ? ` · ${result.executionMs}ms` : ""}
                </span>
              ) : <span>Resultados aparecerão aqui</span>}
              {result && rows.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px]" onClick={() => {
                  const csv = [cols.join(","), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
                  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                  a.download = "atlas_query.csv"; a.click();
                }}>
                  <Download className="h-3 w-3" /> CSV
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {!result ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  Execute uma query para ver os resultados
                </div>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      {cols.map(c => <TableHead key={c} className="text-xs h-7 whitespace-nowrap">{c}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={i}>
                        {cols.map(c => (
                          <TableCell key={c} className="text-xs py-1 max-w-[300px] truncate">
                            {row[c] === null ? <span className="text-muted-foreground/50 italic">null</span> : String(row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ── AI Query Builder ──────────────────────────────────────────────────────────
function AiQueryBuilder({ onSwitchToSql }: { onSwitchToSql: () => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);

  const askMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/atlas/sql-agent", { prompt: p });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => setResult(data),
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const EXAMPLES = [
    "Quais são os 10 clientes com maior receita nos últimos 3 meses?",
    "Mostre a evolução mensal de vendas por vendedor",
    "Quais produtos têm margem abaixo de 15%?",
    "Liste fornecedores com mais de R$ 10.000 em compras este ano",
    "Quais clientes têm inadimplência?",
  ];

  return (
    <div className="flex-1 p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-medium">Perguntar sobre os dados do Atlas</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Descreva o que quer ver em português. O agente gera o SQL e executa automaticamente.
        </p>
      </div>

      <div className="space-y-2">
        <Textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Ex.: Quais produtos vendemos mais em janeiro?"
          rows={3}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              if (prompt.trim()) askMutation.mutate(prompt.trim());
            }
          }}
        />
        <div className="flex gap-2">
          <Button
            onClick={() => askMutation.mutate(prompt.trim())}
            disabled={askMutation.isPending || !prompt.trim()}
            className="gap-2"
          >
            {askMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando…</>
              : <><Sparkles className="h-4 w-4" /> Perguntar</>
            }
          </Button>
        </div>
      </div>

      {/* Examples */}
      {!result && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Exemplos:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {result.query?.querySql && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5" /> SQL gerado
                </span>
                <Button
                  variant="ghost" size="sm" className="h-6 text-[10px]"
                  onClick={onSwitchToSql}
                >
                  Editar no SQL Editor →
                </Button>
              </div>
              <pre className="text-xs p-3 overflow-x-auto text-muted-foreground">
                {result.query.querySql}
              </pre>
            </div>
          )}

          {result.rows?.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.columns?.map((c: string) => (
                        <TableHead key={c} className="text-xs h-8">{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.slice(0, 20).map((row: any, i: number) => (
                      <TableRow key={i}>
                        {result.columns?.map((c: string) => (
                          <TableCell key={c} className="text-xs py-1.5">
                            {row[c] === null ? <span className="text-muted-foreground/50 italic">null</span> : String(row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.rowCount > 20 && (
                <div className="px-3 py-2 border-t border-border/50 text-xs text-muted-foreground">
                  Mostrando 20 de {result.rowCount} linhas
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onSelectFirst }: { onSelectFirst: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <Table2 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">Selecione uma tabela</p>
        <p className="text-sm text-muted-foreground mt-1">
          Escolha uma tabela do Atlas na lista à esquerda para explorar os dados
        </p>
      </div>
      <Button variant="outline" onClick={onSelectFirst}>
        Abrir primeira tabela
      </Button>
    </div>
  );
}
```

---

## PATCH 4 — Registrar rota em `client/src/App.tsx`

```typescript
const AtlasExplorer = lazy(() => import("@/pages/AtlasExplorer"));

// Dentro das rotas autenticadas:
<Route path="/datasets/atlas/explorer" component={AtlasExplorer} />
```

---

## PATCH 5 — Adicionar link no `DatasetHub.tsx`

No `SystemDetail`, dentro da aba "Conexões", após o botão "Ver BI":
```tsx
<Button size="sm" variant="outline" asChild className="gap-1.5">
  <a href="/datasets/atlas/explorer">
    <Table2 className="h-3.5 w-3.5" />
    Explorar dados
  </a>
</Button>
```

---

## Ordem de execução no Replit

```
1. server/sqlSandbox.ts    — 4 patches (1a, 1b, 1c, 1d)
2. server/routes.ts        — 4 rotas novas (/api/atlas/catalog, /table/:name, /query, /sql-agent)
3. client/src/pages/AtlasExplorer.tsx  — criar arquivo
4. client/src/App.tsx      — registrar rota lazy
5. client/src/pages/DatasetHub.tsx — botão "Explorar dados"
6. Restart
7. GET /api/atlas/catalog  → lista tabelas atlas_*
8. GET /api/atlas/table/atlas_pedidos?pageSize=10 → primeiras linhas
9. POST /api/atlas/query { sql: "SELECT COUNT(*) FROM analytics.atlas_pedidos WHERE arcadia_tenant_id='...'" } → número real
```
