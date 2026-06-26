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
  RefreshCcw, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

type CatalogTable = {
  name: string;
  displayName: string;
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

export default function AtlasExplorer() {
  const [activeTable, setActiveTable] = useState<CatalogTable | null>(null);
  const [mode, setMode] = useState<"browse" | "sql" | "ai">("browse");

  const { data: catalog, isLoading: catalogLoading } = useQuery<{ tables: CatalogTable[]; tenantId: string }>({
    queryKey: ["/api/atlas/catalog"],
  });

  const tables = catalog?.tables ?? [];
  const tenantId = catalog?.tenantId ?? "";

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col" data-testid="atlas-explorer">
      <div className="border-b border-border/50 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/datasets/atlas">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" data-testid="link-back-atlas">
              <ArrowLeft className="h-3.5 w-3.5" /> Atlas
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Atlas Explorer</span>
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(["browse", "sql", "ai"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                data-testid={`tab-${m}`}
                className={`px-3 py-1.5 transition-colors ${
                  mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {m === "browse" ? "Explorar" : m === "sql" ? "SQL" : "Perguntar"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="text-tables-count">{tables.length} tabelas</span>
          <span>·</span>
          <Link href="/bi" className="flex items-center gap-1 hover:text-foreground">
            <BarChart3 className="h-3 w-3" /> BI Builder
          </Link>
        </div>
      </div>

      {mode === "browse" && (
        <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          <ResizablePanel defaultSize={22} minSize={16} maxSize={35}>
            <TableList
              tables={tables}
              loading={catalogLoading}
              active={activeTable?.name ?? null}
              onSelect={setActiveTable}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={78}>
            {activeTable
              ? <TableViewer table={activeTable} />
              : <EmptyState onSelectFirst={() => tables[0] && setActiveTable(tables[0])} hasTables={tables.length > 0} />
            }
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {mode === "sql" && <SqlEditor tenantId={tenantId} />}
      {mode === "ai" && <AiQueryBuilder onSwitchToSql={() => setMode("sql")} />}
    </div>
  );
}

function TableList({
  tables, loading, active, onSelect,
}: {
  tables: CatalogTable[]; loading: boolean; active: string | null;
  onSelect: (t: CatalogTable) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = tables.filter(t =>
    !search || t.displayName.toLowerCase().includes(search.toLowerCase()),
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
            data-testid="input-search-tables"
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
              data-testid={`button-table-${t.displayName.replace(/\s+/g, "-")}`}
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

function TableViewer({ table }: { table: CatalogTable }) {
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const initialSort = table.columns.find(c => c.name === "id")?.name ?? table.columns[0]?.name ?? "id";
  const [sortBy, setSortBy] = useState(initialSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setPage(0);
    setSortBy(table.columns.find(c => c.name === "id")?.name ?? table.columns[0]?.name ?? "id");
  }, [table.name]);

  const tableName = table.name.replace("analytics.", "");
  const { data, isLoading, refetch } = useQuery<TableData>({
    queryKey: ["/api/atlas/table", tableName, page, pageSize, sortBy, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(pageSize), sortBy, sortDir,
      });
      const res = await fetch(`/api/atlas/table/${tableName}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
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
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" data-testid="text-table-title">{table.displayName}</span>
          <Badge variant="secondary" className="text-[10px]">{totalRows.toLocaleString("pt-BR")} linhas</Badge>
          <Badge variant="outline" className="text-[10px]">{cols.length} colunas</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCcw className="h-3 w-3" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={exportCsv} data-testid="button-export-csv">
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-border/30 flex gap-2 overflow-x-auto">
        {table.columns.map(c => (
          <span key={c.name} className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {c.name} <span className="opacity-60">{c.type.replace("character varying", "varchar").replace("timestamp with time zone", "timestamptz")}</span>
          </span>
        ))}
      </div>

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

      <div className="border-t border-border/50 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {totalRows === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalRows)} de {totalRows.toLocaleString("pt-BR")}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} data-testid="button-page-prev">
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="px-2">Pág. {page + 1}/{totalPages}</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} data-testid="button-page-next">
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SqlEditor({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [sql, setSql] = useState(
    `-- Exemplo: top 10 clientes por receita\nSELECT\n  p.nome_fantasia AS cliente,\n  SUM(ped.valor_total) AS receita_total\nFROM analytics.atlas_pedidos ped\nJOIN analytics.atlas_pessoas p\n  ON p.id = ped.cliente_id\n  AND p.arcadia_tenant_id = ped.arcadia_tenant_id\nWHERE ped.arcadia_tenant_id = '${tenantId}'\nGROUP BY p.nome_fantasia\nORDER BY receita_total DESC\nLIMIT 10`,
  );
  const [result, setResult] = useState<QueryResult | null>(null);

  const runMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/atlas/query", { sql: q });
      return await res.json() as QueryResult;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: any) => toast({ title: "Erro SQL", description: err.message, variant: "destructive" }),
  });

  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ResizablePanelGroup direction="vertical">
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
                data-testid="button-run-sql"
              >
                {runMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Executando…</>
                  : <><Play className="h-3.5 w-3.5" /> Executar</>}
              </Button>
            </div>
            <Textarea
              value={sql}
              onChange={e => setSql(e.target.value)}
              className="flex-1 font-mono text-xs rounded-none border-0 resize-none focus-visible:ring-0 bg-muted/20"
              placeholder="SELECT * FROM analytics.atlas_pedidos WHERE arcadia_tenant_id = '...' LIMIT 100"
              data-testid="textarea-sql"
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

        <ResizablePanel defaultSize={60}>
          <div className="h-full flex flex-col">
            <div className="px-3 py-1.5 border-b border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              {result ? (
                <span data-testid="text-result-summary">
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

function AiQueryBuilder({ onSwitchToSql }: { onSwitchToSql: () => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);

  const askMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/atlas/sql-agent", { prompt: p });
      return await res.json();
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
    <div className="flex-1 p-6 max-w-3xl mx-auto space-y-6 overflow-auto">
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
          data-testid="textarea-prompt"
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
            data-testid="button-ask"
          >
            {askMutation.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando…</>
              : <><Sparkles className="h-4 w-4" /> Perguntar</>}
          </Button>
        </div>
      </div>

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

      {result && (
        <div className="space-y-3">
          {result.query?.querySql && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5" /> SQL gerado
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onSwitchToSql}>
                  Editar no SQL Editor →
                </Button>
              </div>
              <pre className="text-xs p-3 overflow-x-auto text-muted-foreground">{result.query.querySql}</pre>
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

function EmptyState({ onSelectFirst, hasTables }: { onSelectFirst: () => void; hasTables: boolean }) {
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
      {hasTables && (
        <Button variant="outline" onClick={onSelectFirst} data-testid="button-open-first">
          Abrir primeira tabela
        </Button>
      )}
    </div>
  );
}
