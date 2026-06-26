import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Upload, Link2, RefreshCcw, Clock, CheckCircle2, XCircle,
  Database, Package, Zap, AlertCircle, ChevronRight,
  Calendar, Play, Pause, Trash2, Settings, BarChart3,
  ArrowRight, Info,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────

type AtlasDataSource = {
  id: string;
  mode: "dump" | "live";
  pg_host?: string;
  pg_port?: number;
  pg_database?: string;
  pg_user?: string;
  atlas_tenant_id?: number;
  is_active: number;
  last_sync_at?: string;
  last_sync_status?: string;
  sync_rows_total?: number;
};

type ImportJob = {
  id: string;
  status: "pending" | "running" | "success" | "error";
  progress: number;
  message: string;
  startedAt: string;
  finishedAt?: string;
  tables?: Record<string, { rows: number; status: string }>;
  etl?: { revenue: number; crm: number; errors: string[] };
};

// ── Catálogo de sistemas homologados ─────────────────────────────────────────

const HOMOLOGATED_SYSTEMS = [
  {
    id: "atlas",
    name: "Atlas ERP",
    category: "ERP Autopeças",
    description: "ERP especializado em distribuidores e varejistas de autopeças. Sincroniza pedidos, estoque, financeiro, clientes e curva ABC.",
    status: "homologado" as const,
    version: "v2.x",
    tables: 176,
    modules: ["Vendas", "Compras", "Estoque", "Financeiro", "PDV", "Produção"],
    importModes: ["dump", "live"] as ("dump" | "live")[],
    docUrl: "#",
    color: "#1D9E75",
    logo: "⚙️",
  },
  {
    id: "totvs",
    name: "TOTVS Protheus",
    category: "ERP Enterprise",
    description: "Em homologação. Suporte a módulos financeiro e fiscal.",
    status: "em_homologacao" as const,
    version: "—",
    tables: 0,
    modules: ["Financeiro", "Fiscal"],
    importModes: [],
    docUrl: "#",
    color: "#888780",
    logo: "🏢",
  },
  {
    id: "omie",
    name: "Omie",
    category: "ERP PME",
    description: "Em homologação via API REST.",
    status: "em_homologacao" as const,
    version: "—",
    tables: 0,
    modules: ["Financeiro", "Fiscal", "Vendas"],
    importModes: [],
    docUrl: "#",
    color: "#888780",
    logo: "📦",
  },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DatasetHub() {
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectSystemId, setConnectSystemId] = useState<string>("atlas");

  const system = HOMOLOGATED_SYSTEMS.find(s => s.id === selectedSystem);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium">Datasets homologados</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              ERPs e sistemas parceiros com integração certificada para o BI do Arcádia
            </p>
          </div>
          <Button
            onClick={() => { setConnectSystemId("atlas"); setConnectOpen(true); }}
            className="gap-2"
          >
            <Database className="h-4 w-4" />
            Conectar sistema
          </Button>
        </div>
      </div>

      <div className="px-6 py-6 max-w-6xl mx-auto space-y-8">

        {/* Systems grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {HOMOLOGATED_SYSTEMS.map(sys => (
            <SystemCard
              key={sys.id}
              system={sys}
              isSelected={selectedSystem === sys.id}
              onSelect={() => setSelectedSystem(selectedSystem === sys.id ? null : sys.id)}
              onConnect={() => { setConnectSystemId(sys.id); setConnectOpen(true); }}
            />
          ))}
        </div>

        {/* Detail panel for selected system */}
        {system && (
          <SystemDetail
            system={system}
            onConnect={() => { setConnectSystemId(system.id); setConnectOpen(true); }}
          />
        )}
      </div>

      {/* Connect dialog */}
      <ConnectDialog
        open={connectOpen}
        systemId={connectSystemId}
        onClose={() => setConnectOpen(false)}
      />
    </div>
  );
}

// ── System Card ───────────────────────────────────────────────────────────────

function SystemCard({
  system, isSelected, onSelect, onConnect,
}: {
  system: typeof HOMOLOGATED_SYSTEMS[0];
  isSelected: boolean;
  onSelect: () => void;
  onConnect: () => void;
}) {
  const isHomologado = system.status === "homologado";

  return (
    <div
      onClick={isHomologado ? onSelect : undefined}
      className={`
        relative rounded-xl border p-5 transition-all duration-150
        ${isHomologado ? "cursor-pointer hover:shadow-md" : "opacity-60 cursor-default"}
        ${isSelected ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border"}
      `}
    >
      {/* Status badge */}
      <div className="absolute top-3 right-3">
        {isHomologado ? (
          <Badge className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/10">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Homologado
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            Em homologação
          </Badge>
        )}
      </div>

      {/* Logo + name */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
          style={{ background: `${system.color}15`, border: `1px solid ${system.color}30` }}
        >
          {system.logo}
        </div>
        <div>
          <div className="font-medium text-sm">{system.name}</div>
          <div className="text-xs text-muted-foreground">{system.category}</div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-4">
        {system.description}
      </p>

      {isHomologado && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {system.modules.slice(0, 4).map(m => (
              <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {m}
              </span>
            ))}
            {system.modules.length > 4 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                +{system.modules.length - 4}
              </span>
            )}
          </div>
          <div className="flex gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
            <span>{system.tables} tabelas</span>
            <span>{system.importModes.includes("dump") ? "Import SQL" : ""}</span>
            <span>{system.importModes.includes("live") ? "Live PG" : ""}</span>
          </div>
        </div>
      )}

      {isHomologado && (
        <div className="flex items-center gap-1.5 mt-3 text-xs font-medium text-primary">
          Ver detalhes <ChevronRight className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

// ── System Detail ─────────────────────────────────────────────────────────────

function SystemDetail({
  system, onConnect,
}: {
  system: typeof HOMOLOGATED_SYSTEMS[0];
  onConnect: () => void;
}) {
  const { data: sources = [] } = useQuery<AtlasDataSource[]>({
    queryKey: ["/api/atlas/data-sources"],
    enabled: system.id === "atlas",
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
            style={{ background: `${system.color}15` }}
          >
            {system.logo}
          </div>
          <div>
            <span className="font-medium">{system.name}</span>
            <span className="text-muted-foreground text-sm ml-2">— detalhes e conexões ativas</span>
          </div>
        </div>
        <Button onClick={onConnect} size="sm" className="gap-2">
          <Database className="h-3.5 w-3.5" />
          Nova conexão
        </Button>
      </div>

      <div className="p-6">
        <Tabs defaultValue="conexoes">
          <TabsList className="mb-4">
            <TabsTrigger value="conexoes">Conexões ({sources.length})</TabsTrigger>
            <TabsTrigger value="metricas">Métricas disponíveis</TabsTrigger>
            <TabsTrigger value="historico">Histórico de imports</TabsTrigger>
          </TabsList>

          <TabsContent value="conexoes">
            {sources.length === 0 ? (
              <EmptyConnections onConnect={onConnect} />
            ) : (
              <div className="space-y-3">
                {sources.map(src => (
                  <ConnectionCard key={src.id} source={src} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="metricas">
            <AtlasMetricsList />
          </TabsContent>

          <TabsContent value="historico">
            <ImportHistory sourceId={sources[0]?.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyConnections({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="text-center py-12 space-y-4">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
        <Database className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">Nenhuma conexão configurada</p>
        <p className="text-sm text-muted-foreground mt-1">
          Configure uma conexão para começar a importar dados do Atlas
        </p>
      </div>
      <Button onClick={onConnect} className="gap-2">
        <Database className="h-4 w-4" />
        Configurar primeira conexão
      </Button>
    </div>
  );
}

// ── Connection Card ───────────────────────────────────────────────────────────

function ConnectionCard({ source }: { source: AtlasDataSource }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const syncLive = useMutation({
    mutationFn: () => apiRequest("POST", `/api/atlas/sync/live/${source.id}`),
    onSuccess: async (res) => {
      const j = await res.json();
      toast({ title: "Sync concluído", description: `${j.etl?.revenue ?? 0} lançamentos, ${j.etl?.crm ?? 0} pedidos` });
      qc.invalidateQueries({ queryKey: ["/api/atlas/data-sources"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const modeLabel = source.mode === "dump" ? "Import SQL" : "PostgreSQL live";
  const modeIcon = source.mode === "dump"
    ? <Package className="h-3.5 w-3.5" />
    : <Database className="h-3.5 w-3.5" />;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
            {modeIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{modeLabel}</span>
              {source.atlas_tenant_id && (
                <span className="text-xs text-muted-foreground">tenant #{source.atlas_tenant_id}</span>
              )}
              {source.last_sync_status === "success" && (
                <Badge variant="outline" className="gap-1 text-[10px] text-emerald-700 border-emerald-500/30">
                  <CheckCircle2 className="h-2.5 w-2.5" /> OK
                </Badge>
              )}
              {source.last_sync_status === "error" && (
                <Badge variant="destructive" className="text-[10px]">Erro</Badge>
              )}
              {!source.last_sync_status && (
                <Badge variant="secondary" className="text-[10px]">Nunca sincronizado</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              {source.mode === "live" && source.pg_host && (
                <span className="truncate">{source.pg_host}/{source.pg_database}</span>
              )}
              {source.last_sync_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {format(new Date(source.last_sync_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </span>
              )}
              {source.sync_rows_total ? (
                <span>{source.sync_rows_total.toLocaleString("pt-BR")} linhas totais</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {source.mode === "dump" ? (
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Importar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncLive.mutate()}
              disabled={syncLive.isPending}
              className="gap-1.5"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${syncLive.isPending ? "animate-spin" : ""}`} />
              {syncLive.isPending ? "Sincronizando…" : "Sincronizar"}
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <a href="/bi" className="gap-1.5 flex items-center">
              <BarChart3 className="h-3.5 w-3.5" />
              Ver BI
            </a>
          </Button>
        </div>
      </div>

      {/* Import dialog for dump mode */}
      <ImportDialog
        open={importOpen}
        sourceId={source.id}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}

// ── Metrics list ──────────────────────────────────────────────────────────────

const ATLAS_METRICS = [
  { id: "atlas.receita_por_periodo", label: "Receita de vendas por mês", widget: "line_chart", group: "Vendas" },
  { id: "atlas.ticket_medio", label: "Ticket médio de pedidos", widget: "kpi_card", group: "Vendas" },
  { id: "atlas.top_clientes", label: "Top 15 clientes por receita", widget: "bar_chart", group: "Vendas" },
  { id: "atlas.top_produtos_vendidos", label: "Top 20 produtos mais vendidos", widget: "bar_chart", group: "Produtos" },
  { id: "atlas.margem_por_produto", label: "Margem por produto (Top 20)", widget: "bar_chart", group: "Produtos" },
  { id: "atlas.curva_abc_produtos", label: "Curva ABC de produtos", widget: "pie_chart", group: "Produtos" },
  { id: "atlas.estoque_por_grupo", label: "Estoque por grupo de produto", widget: "bar_chart", group: "Estoque" },
  { id: "atlas.inadimplencia_valor", label: "Inadimplência — valor em atraso", widget: "kpi_card", group: "Financeiro" },
  { id: "atlas.contas_a_receber_por_vencimento", label: "Contas a receber por vencimento", widget: "bar_chart", group: "Financeiro" },
];

function AtlasMetricsList() {
  const groups = Array.from(new Set(ATLAS_METRICS.map(m => m.group)));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground border border-border/50 rounded-lg p-3 bg-muted/30">
        <Info className="h-4 w-4 flex-shrink-0" />
        <span>
          Após importar dados do Atlas, estas métricas ficam disponíveis no{" "}
          <a href="/bi" className="underline font-medium text-foreground">BI Builder</a>{" "}
          e no Agente BI Consultivo.
        </span>
      </div>
      {groups.map(group => (
        <div key={group}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group}
          </div>
          <div className="space-y-1">
            {ATLAS_METRICS.filter(m => m.group === group).map(metric => (
              <div
                key={metric.id}
                className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm">{metric.label}</span>
                </div>
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                  {metric.widget.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Import History ────────────────────────────────────────────────────────────

function ImportHistory({ sourceId }: { sourceId?: string }) {
  if (!sourceId) {
    return <p className="text-sm text-muted-foreground text-center py-8">Configure uma conexão primeiro.</p>;
  }

  return (
    <p className="text-sm text-muted-foreground text-center py-8">
      Histórico de imports aparece aqui após a primeira sincronização.
    </p>
  );
}

// ── Connect Dialog ────────────────────────────────────────────────────────────

function ConnectDialog({
  open, systemId, onClose,
}: {
  open: boolean;
  systemId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"dump" | "live">("dump");
  // Live config
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDb, setPgDb] = useState("");
  const [pgUser, setPgUser] = useState("");
  const [pgPass, setPgPass] = useState("");
  const [pgSsl, setPgSsl] = useState(true);
  const [atlasTenantId, setAtlasTenantId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);

  const createDs = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/atlas/data-sources", {
        mode,
        atlasaTenantId: atlasTenantId ? parseInt(atlasTenantId) : undefined,
        ...(mode === "live" ? {
          pgHost, pgPort: parseInt(pgPort), pgDatabase: pgDb,
          pgUser, pgPassword: pgPass, pgSsl,
        } : {}),
      }),
    onSuccess: () => {
      toast({ title: "Conexão configurada!", description: "Agora faça seu primeiro import." });
      qc.invalidateQueries({ queryKey: ["/api/atlas/data-sources"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/atlas/test-connection", {
        pgHost, pgPort: parseInt(pgPort), pgDatabase: pgDb, pgUser, pgPassword: pgPass, pgSsl,
      });
      const j = await res.json();
      setTestResult(j);
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message });
    } finally {
      setTesting(false);
    }
  }

  const system = HOMOLOGATED_SYSTEMS.find(s => s.id === systemId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{system?.logo}</span>
            Conectar {system?.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Escolha como os dados chegam ao Arcádia.
          </p>
        </DialogHeader>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode("dump")}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              mode === "dump" ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Upload className="h-4 w-4" />
              <span className="font-medium text-sm">Import SQL</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload do arquivo .zip/.sql gerado pelo pg_dump do Atlas. Ideal para onboarding e histórico.
            </p>
          </button>
          <button
            onClick={() => setMode("live")}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              mode === "live" ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-4 w-4" />
              <span className="font-medium text-sm">PostgreSQL live</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Conexão direta ao banco do Atlas. Sincronização incremental agendável.
            </p>
          </button>
        </div>

        {/* Atlas Tenant ID (ambos os modos) */}
        <div>
          <Label className="text-xs text-muted-foreground">Tenant ID do Atlas (opcional)</Label>
          <Input
            value={atlasTenantId}
            onChange={e => setAtlasTenantId(e.target.value)}
            placeholder="ex: 1 — deixe vazio para importar todos"
            className="mt-1"
          />
        </div>

        {/* Live config */}
        {mode === "live" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Host</Label>
                <Input value={pgHost} onChange={e => setPgHost(e.target.value)} placeholder="db.atlas.com.br" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Porta</Label>
                <Input value={pgPort} onChange={e => setPgPort(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Database</Label>
                <Input value={pgDb} onChange={e => setPgDb(e.target.value)} placeholder="atlas_prod" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Usuário</Label>
                <Input value={pgUser} onChange={e => setPgUser(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Senha</Label>
              <Input type="password" value={pgPass} onChange={e => setPgPass(e.target.value)} className="mt-1" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={pgSsl} onChange={e => setPgSsl(e.target.checked)} className="rounded" />
              Usar SSL
            </label>

            {/* Test connection */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={testing || !pgHost}
                className="gap-1.5"
              >
                <Zap className={`h-3.5 w-3.5 ${testing ? "animate-pulse" : ""}`} />
                {testing ? "Testando…" : "Testar conexão"}
              </Button>
              {testResult && (
                <span className={`text-xs flex items-center gap-1 ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {testResult.ok
                    ? <><CheckCircle2 className="h-3 w-3" /> OK — {testResult.version?.split(" ")[1]}</>
                    : <><XCircle className="h-3 w-3" /> {testResult.error}</>
                  }
                </span>
              )}
            </div>
          </div>
        )}

        {mode === "dump" && (
          <div className="rounded-lg bg-muted/50 border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Como exportar do Atlas:</p>
            <p>1. No servidor do Atlas: <code className="bg-background px-1 rounded">pg_dump atlas_prod &gt; dump.sql</code></p>
            <p>2. Compacte: <code className="bg-background px-1 rounded">zip dump.zip dump.sql</code></p>
            <p>3. Após criar a conexão, use o botão <strong>Importar</strong> para enviar o arquivo.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => createDs.mutate()}
            disabled={createDs.isPending || (mode === "live" && (!pgHost || !pgDb || !pgUser))}
          >
            {createDs.isPending ? "Salvando…" : "Criar conexão"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Import Dialog (dump mode) ─────────────────────────────────────────────────

function ImportDialog({
  open, sourceId, onClose,
}: {
  open: boolean;
  sourceId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<ImportJob | null>(null);

  async function runImport() {
    setStep("uploading");
    setProgress(10);

    try {
      let body: any;
      const headers: Record<string, string> = {};

      if (tab === "upload" && file) {
        // Chunked upload for large files
        const fd = new FormData();
        fd.append("file", file);
        body = fd;
      } else if (tab === "url" && url) {
        body = JSON.stringify({ url });
        headers["Content-Type"] = "application/json";
      } else return;

      setProgress(30);
      setStep("processing");

      // Simulate progress while backend processes
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 800);

      const endpoint = tab === "url"
        ? `/api/atlas/sync/dump-url/${sourceId}`
        : `/api/atlas/sync/dump-upload/${sourceId}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        credentials: "include",
      });

      clearInterval(interval);

      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();

      setProgress(100);
      setStep("done");
      setResult({
        id: crypto.randomUUID(),
        status: "success",
        progress: 100,
        message: `${j.etl?.revenue ?? 0} lançamentos + ${j.etl?.crm ?? 0} pedidos importados`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        tables: j.import?.tables,
        etl: j.etl,
      });

      qc.invalidateQueries({ queryKey: ["/api/atlas/data-sources"] });
    } catch (e: any) {
      setStep("error");
      setProgress(0);
      toast({ title: "Import falhou", description: e?.message, variant: "destructive" });
    }
  }

  function reset() {
    setStep("idle");
    setProgress(0);
    setResult(null);
    setFile(null);
    setUrl("");
  }

  return (
    <Dialog open={open} onOpenChange={() => { onClose(); reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Importar dump do Atlas
          </DialogTitle>
        </DialogHeader>

        {step === "idle" && (
          <div className="space-y-4">
            {/* Tab selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTab("upload")}
                className={`rounded-lg border p-3 text-left text-sm transition-all ${
                  tab === "upload" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Upload className="h-4 w-4" /> Upload direto
                </div>
                <p className="text-xs text-muted-foreground mt-1">Enviar .zip ou .sql do computador</p>
              </button>
              <button
                onClick={() => setTab("url")}
                className={`rounded-lg border p-3 text-left text-sm transition-all ${
                  tab === "url" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Link2 className="h-4 w-4" /> Link externo
                </div>
                <p className="text-xs text-muted-foreground mt-1">Dropbox, S3, Google Drive</p>
              </button>
            </div>

            {tab === "upload" && (
              <div
                onClick={() => fileRef.current?.click()}
                className={`
                  rounded-xl border-2 border-dashed p-8 text-center cursor-pointer
                  transition-colors hover:border-primary/50 hover:bg-muted/30
                  ${file ? "border-primary/50 bg-primary/5" : "border-border"}
                `}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip,.sql,.gz"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="space-y-1">
                    <Package className="h-8 w-8 mx-auto text-primary" />
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Clique para selecionar ou arraste o arquivo
                    </p>
                    <p className="text-xs text-muted-foreground">.zip · .sql · .gz · até 500MB</p>
                  </div>
                )}
              </div>
            )}

            {tab === "url" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">URL do arquivo (link direto para download)</Label>
                <Input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.dropbox.com/...?dl=1"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Para Dropbox: substitua <code>?dl=0</code> por <code>?dl=1</code> no link.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Sobre o tempo de processamento
              </p>
              <p>Dumps grandes (como 336MB) levam 2–5 minutos para processar. A página pode ser fechada — o processo continua em background.</p>
            </div>
          </div>
        )}

        {(step === "uploading" || step === "processing") && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {step === "uploading" ? "Enviando arquivo…" : "Processando tabelas…"}
                </span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className={`flex items-center gap-2 ${progress >= 30 ? "text-foreground" : ""}`}>
                <CheckCircle2 className={`h-3.5 w-3.5 ${progress >= 30 ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                Arquivo recebido
              </div>
              <div className={`flex items-center gap-2 ${progress >= 60 ? "text-foreground" : ""}`}>
                <CheckCircle2 className={`h-3.5 w-3.5 ${progress >= 60 ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                Importando tabelas (pessoas, produtos, pedidos…)
              </div>
              <div className={`flex items-center gap-2 ${progress >= 85 ? "text-foreground" : ""}`}>
                <CheckCircle2 className={`h-3.5 w-3.5 ${progress >= 85 ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                ETL — populando métricas de BI
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Import concluído com sucesso!
              </div>
              <p className="text-sm text-muted-foreground">{result.message}</p>
            </div>

            {result.tables && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {Object.entries(result.tables)
                  .filter(([, v]) => v.rows > 0)
                  .sort(([, a], [, b]) => b.rows - a.rows)
                  .map(([table, info]) => (
                    <div key={table} className="flex justify-between text-xs px-2 py-1 rounded hover:bg-muted/50">
                      <span className="text-muted-foreground font-mono">{table}</span>
                      <span className="font-medium">{info.rows.toLocaleString("pt-BR")} linhas</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { onClose(); reset(); }} className="flex-1">
                Fechar
              </Button>
              <Button asChild className="flex-1 gap-2">
                <a href="/bi">
                  <BarChart3 className="h-4 w-4" />
                  Abrir BI Builder
                </a>
              </Button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4" />
                Import falhou
              </div>
              <p className="text-sm text-muted-foreground mt-1">Verifique o log de erros no console do servidor.</p>
            </div>
            <Button variant="outline" onClick={reset} className="w-full">Tentar novamente</Button>
          </div>
        )}

        {step === "idle" && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              onClick={runImport}
              disabled={tab === "upload" ? !file : !url}
              className="gap-2"
            >
              <Play className="h-3.5 w-3.5" />
              Iniciar import
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
