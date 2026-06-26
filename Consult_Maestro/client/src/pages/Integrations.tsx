import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Database, Globe, FileSpreadsheet, RefreshCcw, Trash2, Plus, Play, Bell, Upload, CheckCircle2, XCircle, Eye, BarChart3, Leaf, FileArchive, Pencil,
} from "lucide-react";
import { format } from "date-fns";

type DataSource = {
  id: string;
  name: string;
  type: string;
  configPublic?: any;
  scheduleCron?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  isActive?: number;
  createdAt?: string;
};

type AutomationRule = {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: any;
  actionType: string;
  actionConfig: any;
  isActive: number;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunMessage?: string | null;
};

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: number;
  createdAt: string;
};

const typeIcon = (t: string) => {
  if (t === "rest_api") return <Globe className="h-4 w-4" />;
  if (t === "postgres") return <Database className="h-4 w-4" />;
  if (t === "mongodb") return <Leaf className="h-4 w-4" />;
  if (t === "excel_upload") return <FileSpreadsheet className="h-4 w-4" />;
  if (t === "zip_upload") return <FileArchive className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
};

const typeLabel = (t: string) =>
  ({
    rest_api: "REST API",
    postgres: "PostgreSQL",
    mongodb: "MongoDB",
    excel_upload: "Excel/CSV",
    zip_upload: "ZIP (Excel/CSV/JSON)",
    mysql: "MySQL (em breve)",
    sqlserver: "SQL Server (em breve)",
    google_sheets: "Google Sheets (em breve)",
    totvs: "TOTVS (em breve)",
  } as Record<string, string>)[t] || t;

export default function Integrations() {
  const { toast } = useToast();
  const [tab, setTab] = useState("fontes");

  return (
    <div className="p-6 space-y-6" data-testid="page-integrations">
      <div>
        <h1 className="text-2xl font-bold">Central de Integração</h1>
        <p className="text-muted-foreground">
          Conecte fontes externas, automatize sincronizações e receba notificações.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="fontes" data-testid="tab-fontes">Fontes</TabsTrigger>
          <TabsTrigger value="adicionar" data-testid="tab-adicionar">Adicionar</TabsTrigger>
          <TabsTrigger value="automacoes" data-testid="tab-automacoes">Automações</TabsTrigger>
          <TabsTrigger value="log" data-testid="tab-log">Notificações</TabsTrigger>
        </TabsList>

        <TabsContent value="fontes" className="mt-4">
          <SourcesTab onAdd={() => setTab("adicionar")} />
        </TabsContent>
        <TabsContent value="adicionar" className="mt-4">
          <AddSourceTab onCreated={() => setTab("fontes")} />
        </TabsContent>
        <TabsContent value="automacoes" className="mt-4">
          <AutomationsTab />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function SourcesTab({ onAdd }: { onAdd: () => void }) {
  const { toast } = useToast();
  const { data: sources = [], isLoading } = useQuery<DataSource[]>({
    queryKey: ["/api/datasources"],
  });

  const sync = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/datasources/${id}/sync`),
    onSuccess: async (res) => {
      const j = await res.json();
      toast({
        title: j.status === "success" ? "Sincronização OK" : "Falhou",
        description: j.status === "success" ? `${j.rowsSynced} linhas` : j.error,
        variant: j.status === "success" ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/datasources"] });
    },
  });

  const test = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/datasources/${id}/test`),
    onSuccess: async (res) => {
      const j = await res.json();
      toast({ title: "Conexão OK", description: `${j.rowCount} linhas, ${j.columns?.length || 0} colunas` });
    },
    onError: (e: any) => toast({ title: "Falhou", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/datasources/${id}`),
    onSuccess: () => {
      toast({ title: "Removido" });
      queryClient.invalidateQueries({ queryKey: ["/api/datasources"] });
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Carregando…</p>;
  if (!sources.length)
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-muted-foreground">Nenhuma fonte cadastrada ainda.</p>
          <Button onClick={onAdd} data-testid="button-add-first-source">
            <Plus className="h-4 w-4 mr-1" /> Adicionar fonte
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {sources.map((s) => (
        <Card key={s.id} data-testid={`card-source-${s.id}`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {typeIcon(s.type)} {s.name}
            </CardTitle>
            <CardDescription>{typeLabel(s.type)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              {s.lastSyncStatus === "success" ? (
                <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />OK</Badge>
              ) : s.lastSyncStatus === "error" ? (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Erro</Badge>
              ) : (
                <Badge variant="secondary">Nunca sincronizado</Badge>
              )}
              {s.lastSyncAt && (
                <span className="text-muted-foreground">
                  {format(new Date(s.lastSyncAt), "dd/MM HH:mm")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(s.type === "excel_upload" || s.type === "zip_upload") ? (
                <UploadButton sourceId={s.id} accept={s.type === "zip_upload" ? ".zip" : ".xlsx,.xls,.csv"} />
              ) : (
                <Button size="sm" variant="outline" onClick={() => test.mutate(s.id)} disabled={test.isPending} data-testid={`button-test-${s.id}`}>
                  Testar
                </Button>
              )}
              <Button size="sm" onClick={() => sync.mutate(s.id)} disabled={sync.isPending} data-testid={`button-sync-${s.id}`}>
                <RefreshCcw className="h-3 w-3 mr-1" />Sync
              </Button>
              <PreviewButton sourceId={s.id} sourceName={s.name} />
              <EditSourceButton source={s} />
              <Button size="sm" variant="ghost" onClick={() => { if (confirm("Remover fonte?")) remove.mutate(s.id); }} data-testid={`button-delete-${s.id}`}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {s.lastSyncStatus === "success" && (
              <p className="text-xs text-muted-foreground pt-1 border-t">
                Use esta fonte em <a href="/bi" className="underline font-medium">BI Builder</a> para criar gráficos e dashboards.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PreviewButton({ sourceId, sourceName }: { sourceId: string; sourceName: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ rows: any[]; rowCount: number; fetchedAt: string | null }>({
    queryKey: ["/api/datasources", sourceId, "data"],
    enabled: open,
  });
  const rows = data?.rows ?? [];
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-preview-${sourceId}`}>
          <Eye className="h-3 w-3 mr-1" /> Visualizar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{sourceName}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.rowCount} linhas` : ""}
            {data?.fetchedAt && ` · sincronizado em ${format(new Date(data.fetchedAt), "dd/MM HH:mm")}`}
          </p>
        </DialogHeader>
        <div className="overflow-auto max-h-[55vh] border rounded">
          {isLoading ? (
            <p className="p-6 text-center text-muted-foreground text-sm">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground text-sm">Sem dados. Clique em Sync ou faça novo upload.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-left font-medium border-b">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((row, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-1 truncate max-w-[200px]">
                        {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > 200 && (
          <p className="text-xs text-muted-foreground">Exibindo primeiras 200 de {rows.length} linhas.</p>
        )}
        <DialogFooter className="flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <p className="text-xs text-muted-foreground flex-1">
            <BarChart3 className="h-3 w-3 inline mr-1" />
            Para criar gráficos, vá em <a href="/bi" className="underline font-medium">BI Builder → Adicionar widget → Conector</a>.
          </p>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadButton({ sourceId, accept = ".xlsx,.xls,.csv" }: { sourceId: string; accept?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <label>
      <input
        type="file"
        accept={accept}
        className="hidden"
        data-testid={`input-upload-${sourceId}`}
        onChange={async (ev) => {
          const file = ev.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`/api/datasources/${sourceId}/upload`, {
              method: "POST", body: fd, credentials: "include",
            });
            if (!res.ok) throw new Error(await res.text());
            const j = await res.json();
            toast({ title: "Upload OK", description: `${j.rowCount} linhas` });
            queryClient.invalidateQueries({ queryKey: ["/api/datasources"] });
          } catch (e: any) {
            toast({ title: "Falhou", description: e?.message, variant: "destructive" });
          } finally { setBusy(false); ev.target.value = ""; }
        }}
      />
      <Button asChild size="sm" variant="outline" disabled={busy}>
        <span><Upload className="h-3 w-3 mr-1" />{busy ? "Enviando…" : "Upload"}</span>
      </Button>
    </label>
  );
}

function EditSourceButton({ source }: { source: DataSource }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const cfg = (source.configPublic ?? {}) as Record<string, any>;
  const [name, setName] = useState(source.name);
  // REST
  const [restUrl, setRestUrl] = useState(cfg.url || "");
  const [restAuthType, setRestAuthType] = useState(cfg.authType || "none");
  const [restApiKey, setRestApiKey] = useState("");
  // Postgres
  const [pgHost, setPgHost] = useState(cfg.host || "");
  const [pgPort, setPgPort] = useState(String(cfg.port || 5432));
  const [pgDb, setPgDb] = useState(cfg.database || "");
  const [pgUser, setPgUser] = useState(cfg.user || "");
  const [pgPass, setPgPass] = useState("");
  const [pgQuery, setPgQuery] = useState(cfg.query || "SELECT 1 AS ok");
  const [pgSsl, setPgSsl] = useState(!!cfg.ssl);
  // Mongo
  const [mongoUri, setMongoUri] = useState("");
  const [mongoDb, setMongoDb] = useState(cfg.database || "");
  const [mongoCol, setMongoCol] = useState(cfg.collection || "");
  const [mongoFilter, setMongoFilter] = useState(cfg.filter || "{}");
  const [mongoLimit, setMongoLimit] = useState(String(cfg.limit || 500));
  const [mongoAuthSource, setMongoAuthSource] = useState(cfg.authSource || "");

  const save = useMutation({
    mutationFn: async () => {
      const configPublic: any = {};
      const config: any = {};
      if (source.type === "rest_api") {
        configPublic.url = restUrl;
        configPublic.authType = restAuthType;
        if (restAuthType === "api_key" && restApiKey) config.apiKey = restApiKey;
      } else if (source.type === "postgres") {
        configPublic.host = pgHost;
        configPublic.port = Number(pgPort) || 5432;
        configPublic.database = pgDb;
        configPublic.user = pgUser;
        configPublic.ssl = pgSsl;
        configPublic.query = pgQuery;
        if (pgPass) config.password = pgPass;
      } else if (source.type === "mongodb") {
        configPublic.database = mongoDb;
        configPublic.collection = mongoCol;
        configPublic.filter = mongoFilter || "{}";
        configPublic.limit = Number(mongoLimit) || 500;
        if (mongoAuthSource) configPublic.authSource = mongoAuthSource;
        if (mongoUri) config.uri = mongoUri;
      }
      const body: any = { name, configPublic };
      if (Object.keys(config).length > 0) body.config = config;
      return apiRequest("PATCH", `/api/datasources/${source.id}`, body);
    },
    onSuccess: () => {
      toast({ title: "Fonte atualizada" });
      queryClient.invalidateQueries({ queryKey: ["/api/datasources"] });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Falhou", description: e?.message, variant: "destructive" }),
  });

  const isUpload = source.type === "excel_upload" || source.type === "zip_upload";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-edit-${source.id}`}>
          <Pencil className="h-3 w-3 mr-1" />Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar fonte: {source.name}</DialogTitle>
          <p className="text-xs text-muted-foreground">{typeLabel(source.type)} · Deixe campos de credencial vazios para manter os atuais.</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid={`input-edit-name-${source.id}`} />
          </div>

          {source.type === "rest_api" && (
            <div className="space-y-3">
              <div><Label>URL</Label><Input value={restUrl} onChange={(e) => setRestUrl(e.target.value)} /></div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Autenticação</Label>
                  <Select value={restAuthType} onValueChange={setRestAuthType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      <SelectItem value="api_key">API Key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {restAuthType === "api_key" && (
                  <div>
                    <Label>Nova API Key (vazio = manter)</Label>
                    <Input type="password" value={restApiKey} onChange={(e) => setRestApiKey(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          )}

          {source.type === "postgres" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Host</Label><Input value={pgHost} onChange={(e) => setPgHost(e.target.value)} /></div>
              <div><Label>Porta</Label><Input value={pgPort} onChange={(e) => setPgPort(e.target.value)} /></div>
              <div><Label>Database</Label><Input value={pgDb} onChange={(e) => setPgDb(e.target.value)} /></div>
              <div><Label>Usuário</Label><Input value={pgUser} onChange={(e) => setPgUser(e.target.value)} /></div>
              <div><Label>Nova senha (vazio = manter)</Label><Input type="password" value={pgPass} onChange={(e) => setPgPass(e.target.value)} /></div>
              <div className="md:col-span-2"><Label>Query SQL</Label><Textarea rows={3} value={pgQuery} onChange={(e) => setPgQuery(e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={pgSsl} onChange={(e) => setPgSsl(e.target.checked)} /> SSL
              </label>
            </div>
          )}

          {source.type === "mongodb" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Nova URI (vazio = manter atual)</Label>
                <Input
                  type="password"
                  value={mongoUri}
                  onChange={(e) => setMongoUri(e.target.value)}
                  placeholder="mongodb+srv://user:pass@cluster.mongodb.net"
                  data-testid={`input-edit-mongo-uri-${source.id}`}
                />
              </div>
              <div><Label>Database</Label><Input value={mongoDb} onChange={(e) => setMongoDb(e.target.value)} /></div>
              <div><Label>Collection</Label><Input value={mongoCol} onChange={(e) => setMongoCol(e.target.value)} /></div>
              <div className="md:col-span-2">
                <Label>Auth Source (opcional)</Label>
                <Input value={mongoAuthSource} onChange={(e) => setMongoAuthSource(e.target.value)} placeholder="ex.: admin ou ID do tenant" />
              </div>
              <div className="md:col-span-2">
                <Label>Filtro (JSON)</Label>
                <Textarea rows={2} value={mongoFilter} onChange={(e) => setMongoFilter(e.target.value)} />
              </div>
              <div><Label>Limite</Label><Input value={mongoLimit} onChange={(e) => setMongoLimit(e.target.value)} /></div>
            </div>
          )}

          {isUpload && (
            <p className="text-sm text-muted-foreground">
              Para trocar o arquivo desta fonte, feche este diálogo e use o botão <strong>Upload</strong> no card.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid={`button-save-edit-${source.id}`}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
function AddSourceTab({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("rest_api");
  const [restUrl, setRestUrl] = useState("");
  const [restAuthType, setRestAuthType] = useState("none");
  const [restApiKey, setRestApiKey] = useState("");
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDb, setPgDb] = useState("");
  const [pgUser, setPgUser] = useState("");
  const [pgPass, setPgPass] = useState("");
  const [pgQuery, setPgQuery] = useState("SELECT 1 AS ok");
  const [pgSsl, setPgSsl] = useState(false);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [mongoUri, setMongoUri] = useState("");
  const [mongoDb, setMongoDb] = useState("");
  const [mongoCol, setMongoCol] = useState("");
  const [mongoFilter, setMongoFilter] = useState("{}");
  const [mongoLimit, setMongoLimit] = useState("500");
  const [mongoAuthSource, setMongoAuthSource] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const config: any = {};
      const configPublic: any = {};
      if (type === "rest_api") {
        configPublic.url = restUrl;
        configPublic.authType = restAuthType;
        if (restAuthType === "api_key") config.apiKey = restApiKey;
      } else if (type === "postgres") {
        configPublic.host = pgHost;
        configPublic.port = Number(pgPort) || 5432;
        configPublic.database = pgDb;
        configPublic.user = pgUser;
        configPublic.ssl = pgSsl;
        configPublic.query = pgQuery;
        config.password = pgPass;
      } else if (type === "mongodb") {
        configPublic.database = mongoDb;
        configPublic.collection = mongoCol;
        configPublic.filter = mongoFilter || "{}";
        configPublic.limit = Number(mongoLimit) || 500;
        if (mongoAuthSource) configPublic.authSource = mongoAuthSource;
        config.uri = mongoUri;
      }
      const res = await apiRequest("POST", "/api/datasources", { name, type, config, configPublic });
      const created = await res.json();

      if ((type === "excel_upload" || type === "zip_upload") && excelFile) {
        const fd = new FormData();
        fd.append("file", excelFile);
        const up = await fetch(`/api/datasources/${created.id}/upload`, {
          method: "POST", body: fd, credentials: "include",
        });
        if (!up.ok) throw new Error(`Upload falhou: ${await up.text()}`);
        const j = await up.json();
        return { ...created, _upload: j };
      }
      return created;
    },
    onSuccess: (result: any) => {
      const desc = result?._upload ? `${result._upload.rowCount} linhas importadas` : undefined;
      toast({ title: "Fonte criada", description: desc });
      queryClient.invalidateQueries({ queryKey: ["/api/datasources"] });
      setExcelFile(null);
      onCreated();
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova fonte de dados</CardTitle>
        <CardDescription>Credenciais sensíveis são criptografadas antes de salvar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-source-name" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rest_api">REST API</SelectItem>
                <SelectItem value="postgres">PostgreSQL (SQL)</SelectItem>
                <SelectItem value="mongodb">MongoDB (NoSQL)</SelectItem>
                <SelectItem value="excel_upload">Excel/CSV</SelectItem>
                <SelectItem value="zip_upload">ZIP (Excel/CSV/JSON dentro)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {type === "rest_api" && (
          <div className="space-y-3">
            <div>
              <Label>URL</Label>
              <Input value={restUrl} onChange={(e) => setRestUrl(e.target.value)} placeholder="https://api.example.com/data" data-testid="input-rest-url" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Autenticação</Label>
                <Select value={restAuthType} onValueChange={setRestAuthType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    <SelectItem value="api_key">API Key (header)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {restAuthType === "api_key" && (
                <div>
                  <Label>API Key</Label>
                  <Input type="password" value={restApiKey} onChange={(e) => setRestApiKey(e.target.value)} data-testid="input-rest-key" />
                </div>
              )}
            </div>
          </div>
        )}

        {type === "postgres" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Host</Label><Input value={pgHost} onChange={(e) => setPgHost(e.target.value)} /></div>
            <div><Label>Porta</Label><Input value={pgPort} onChange={(e) => setPgPort(e.target.value)} /></div>
            <div><Label>Database</Label><Input value={pgDb} onChange={(e) => setPgDb(e.target.value)} /></div>
            <div><Label>Usuário</Label><Input value={pgUser} onChange={(e) => setPgUser(e.target.value)} /></div>
            <div><Label>Senha</Label><Input type="password" value={pgPass} onChange={(e) => setPgPass(e.target.value)} /></div>
            <div className="flex items-end gap-2">
              <input id="ssl" type="checkbox" checked={pgSsl} onChange={(e) => setPgSsl(e.target.checked)} />
              <Label htmlFor="ssl">SSL</Label>
            </div>
            <div className="md:col-span-2">
              <Label>Query (SELECT/WITH)</Label>
              <Textarea rows={3} value={pgQuery} onChange={(e) => setPgQuery(e.target.value)} />
            </div>
          </div>
        )}

        {type === "mongodb" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>URI de conexão</Label>
              <Input
                type="password"
                value={mongoUri}
                onChange={(e) => setMongoUri(e.target.value)}
                placeholder="mongodb+srv://user:pass@cluster.mongodb.net"
                data-testid="input-mongo-uri"
              />
              <p className="text-[11px] text-muted-foreground mt-1">A URI é criptografada antes de salvar.</p>
            </div>
            <div><Label>Database</Label><Input value={mongoDb} onChange={(e) => setMongoDb(e.target.value)} data-testid="input-mongo-db" /></div>
            <div><Label>Collection</Label><Input value={mongoCol} onChange={(e) => setMongoCol(e.target.value)} data-testid="input-mongo-col" /></div>
            <div className="md:col-span-2">
              <Label>Auth Source (opcional)</Label>
              <Input
                value={mongoAuthSource}
                onChange={(e) => setMongoAuthSource(e.target.value)}
                placeholder="ex.: admin ou ID do tenant"
                data-testid="input-mongo-authsource"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Use quando o banco de autenticação é diferente do banco de dados (alguns provedores exigem o ID do tenant aqui em vez de "admin").
              </p>
            </div>
            <div className="md:col-span-2">
              <Label>Filtro (JSON)</Label>
              <Textarea rows={2} value={mongoFilter} onChange={(e) => setMongoFilter(e.target.value)} placeholder='{"status":"active"}' />
            </div>
            <div><Label>Limite (máx 1000)</Label><Input value={mongoLimit} onChange={(e) => setMongoLimit(e.target.value)} /></div>
          </div>
        )}

        {(type === "excel_upload" || type === "zip_upload") && (
          <div className="space-y-2">
            <Label>{type === "zip_upload" ? "Arquivo .zip (com .xlsx/.csv/.json dentro)" : "Arquivo (.xlsx, .xls ou .csv)"}</Label>
            <Input
              type="file"
              accept={type === "zip_upload" ? ".zip" : ".xlsx,.xls,.csv"}
              onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
              data-testid="input-excel-file"
            />
            {excelFile && (
              <p className="text-xs text-muted-foreground">
                Selecionado: {excelFile.name} ({(excelFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Máx. 5000 linhas. Você também pode trocar o arquivo depois pela aba Fontes.
            </p>
          </div>
        )}

        <Button
          onClick={() => create.mutate()}
          disabled={!name || create.isPending || ((type === "excel_upload" || type === "zip_upload") && !excelFile)}
          data-testid="button-create-source"
        >
          {create.isPending ? "Salvando…" : (type === "excel_upload" || type === "zip_upload") && excelFile ? "Criar e enviar" : "Criar fonte"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
function AutomationsTab() {
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/automations"],
  });
  const { data: sources = [] } = useQuery<DataSource[]>({ queryKey: ["/api/datasources"] });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 8 * * 1");
  const [actionType, setActionType] = useState<"sync_datasource" | "send_notification">("sync_datasource");
  const [dsId, setDsId] = useState("");
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const actionConfig =
        actionType === "sync_datasource"
          ? { dataSourceId: dsId }
          : { channel: "inapp", title: notifTitle, message: notifMessage };
      const res = await apiRequest("POST", "/api/automations", {
        name,
        triggerType: "cron",
        triggerConfig: { cronExpression: cronExpr },
        actionType,
        actionConfig,
        isActive: 1,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regra criada" });
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
      setOpen(false);
      setName(""); setNotifTitle(""); setNotifMessage(""); setDsId("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/automations/${id}/run`),
    onSuccess: async (res) => {
      const j = await res.json();
      toast({
        title: j.status === "success" ? "Executou" : "Falhou",
        description: j.message,
        variant: j.status === "success" ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (r: AutomationRule) =>
      apiRequest("PATCH", `/api/automations/${r.id}`, { isActive: r.isActive ? 0 : 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/automations"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/automations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/automations"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground text-sm">Cron padrão: <code>min hora dia mês dia-semana</code> (ex: <code>0 8 * * 1</code> = toda segunda às 8h).</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-automation"><Plus className="h-4 w-4 mr-1" />Nova regra</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova automação</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rule-name" /></div>
              <div><Label>Cron</Label><Input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} data-testid="input-rule-cron" /></div>
              <div>
                <Label>Ação</Label>
                <Select value={actionType} onValueChange={(v: any) => setActionType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sync_datasource">Sincronizar fonte</SelectItem>
                    <SelectItem value="send_notification">Enviar notificação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {actionType === "sync_datasource" && (
                <div>
                  <Label>Fonte</Label>
                  <Select value={dsId} onValueChange={setDsId}>
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {actionType === "send_notification" && (
                <>
                  <div><Label>Título</Label><Input value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} /></div>
                  <div><Label>Mensagem</Label><Textarea value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} /></div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!name || create.isPending} data-testid="button-save-rule">
                Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p>Carregando…</p> : !rules.length ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhuma automação ainda.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <Card key={r.id} data-testid={`card-rule-${r.id}`}>
              <CardContent className="p-4 flex justify-between items-center gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.isActive ? <Badge variant="outline">Ativa</Badge> : <Badge variant="secondary">Pausada</Badge>}
                    {r.lastRunStatus === "success" && <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />OK</Badge>}
                    {r.lastRunStatus === "error" && <Badge variant="destructive">Erro</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.actionType} · cron: <code>{r.triggerConfig?.cronExpression}</code>
                    {r.lastRunAt && <> · última: {format(new Date(r.lastRunAt), "dd/MM HH:mm")}</>}
                  </div>
                  {r.lastRunMessage && <div className="text-xs text-muted-foreground">{r.lastRunMessage}</div>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => runNow.mutate(r.id)} disabled={runNow.isPending} data-testid={`button-run-${r.id}`}>
                    <Play className="h-3 w-3 mr-1" />Rodar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)} data-testid={`button-toggle-${r.id}`}>
                    {r.isActive ? "Pausar" : "Ativar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm("Remover regra?")) remove.mutate(r.id); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function NotificationsTab() {
  const { data: items = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });
  if (isLoading) return <p>Carregando…</p>;
  if (!items.length)
    return <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhuma notificação.</CardContent></Card>;
  return (
    <div className="space-y-2">
      {items.map((n) => (
        <Card key={n.id} className={n.isRead ? "opacity-60" : ""} data-testid={`card-notif-${n.id}`}>
          <CardContent className="p-3 flex justify-between items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                <span className="font-medium">{n.title}</span>
                <Badge variant={n.type === "error" ? "destructive" : "outline"}>{n.type}</Badge>
              </div>
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              <span className="text-xs text-muted-foreground">{format(new Date(n.createdAt), "dd/MM HH:mm")}</span>
            </div>
            {!n.isRead && (
              <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>Marcar lido</Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
