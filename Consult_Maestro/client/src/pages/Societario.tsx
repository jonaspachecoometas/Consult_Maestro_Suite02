import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Search, Building2, AlertTriangle, CheckCircle2, FileText, Bot, History, Clock, KanbanSquare, Activity, Settings2 } from "lucide-react";
import { SocietarioAgentChat } from "@/components/societario/SocietarioAgentChat";
import { ModuleAgentBanner } from "@/components/agent/ModuleAgentBanner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PipelineSocietario from "@/pages/societario/Pipeline";
import PipelineSocietarioDashboard from "@/pages/societario/Dashboard";
import PipelineSocietarioConfigs from "@/pages/societario/PipelineConfigs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Sociedade } from "@shared/schema";

interface AlteracaoControle {
  id: string;
  sociedadeId: string;
  tipo: string;
  descricao: string;
  dataEvento: string;
  dataRegistro: string | null;
  orgaoRegistro: string | null;
  numeroRegistro: string | null;
  status: string;
  createdAt: string | null;
  sociedadeRazaoSocial: string;
  sociedadeNomeFantasia: string | null;
  sociedadeStatus: string;
  diasDecorridos: number;
}

interface PendentePorSociedade {
  sociedadeId: string;
  total: number;
}

const TIPO_ALTERACAO_LABEL: Record<string, string> = {
  constituicao: "Constituição",
  alteracao_contratual: "Alteração contratual",
  cessao_cotas: "Cessão de cotas",
  mudanca_regime: "Mudança de regime",
  mudanca_endereco: "Mudança de endereço",
  entrada_socio: "Entrada de sócio",
  saida_socio: "Saída de sócio",
  aumento_capital: "Aumento de capital",
  reducao_capital: "Redução de capital",
  mudanca_objeto: "Mudança de objeto",
  distrato: "Distrato",
};

const ALT_STATUS_BADGE: Record<string, { label: string; variant: any }> = {
  pendente: { label: "Pendente", variant: "secondary" },
  registrada: { label: "Registrada", variant: "outline" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("pt-BR");
  } catch {
    return value;
  }
}

interface DashboardData {
  counts: {
    sociedades_ativas: number;
    sociedades_total: number;
    obrigacoes_proximas: number;
    obrigacoes_atrasadas: number;
    certificados_vencendo: number;
    alteracoes_mes: number;
  };
  porRegime: Array<{ name: string; value: number }>;
}

const REGIMES = [
  { value: "simples", label: "Simples Nacional" },
  { value: "mei", label: "MEI" },
  { value: "lucro_presumido", label: "Lucro Presumido" },
  { value: "lucro_real", label: "Lucro Real" },
  { value: "imune", label: "Imune" },
];

const NATUREZAS = [
  { value: "ltda", label: "Sociedade Limitada (LTDA)" },
  { value: "sa", label: "Sociedade Anônima (S/A)" },
  { value: "eireli", label: "EIRELI" },
  { value: "mei", label: "MEI" },
  { value: "slu", label: "Sociedade Limitada Unipessoal" },
  { value: "sociedade_simples", label: "Sociedade Simples" },
];

const STATUS_BADGE: Record<string, { label: string; variant: any }> = {
  ativa: { label: "Ativa", variant: "default" },
  inativa: { label: "Inativa", variant: "secondary" },
  em_constituicao: { label: "Em Constituição", variant: "outline" },
  em_baixa: { label: "Em Baixa", variant: "destructive" },
  baixada: { label: "Baixada", variant: "secondary" },
};

export default function Societario() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["/api/societario/dashboard"],
  });

  const { data: sociedades = [], isLoading } = useQuery<Sociedade[]>({
    queryKey: ["/api/societario/sociedades", { status: statusFilter, q: search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "todas") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      const url = `/api/societario/sociedades${params.toString() ? `?${params.toString()}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  // Painel "Alterações em andamento" — pendentes do tenant em sociedades ATIVAS.
  const { data: alteracoesPendentes = [], isLoading: loadingAlteracoes } = useQuery<AlteracaoControle[]>({
    queryKey: ["/api/societario/alteracoes", { status: "pendente", sociedadeStatus: "ativa" }],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "pendente", sociedadeStatus: "ativa", limit: "100" });
      const r = await fetch(`/api/societario/alteracoes?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  // Contadores por sociedade para o badge na lista de empresas ativas.
  const { data: pendentesPorSociedade = [] } = useQuery<PendentePorSociedade[]>({
    queryKey: ["/api/societario/alteracoes/pendentes-por-sociedade"],
  });
  const pendentesMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pendentesPorSociedade) m.set(p.sociedadeId, p.total);
    return m;
  }, [pendentesPorSociedade]);

  const [form, setForm] = useState({
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    regimeTributario: "simples",
    naturezaJuridica: "ltda",
    capitalSocial: "0",
    objetoSocial: "",
  });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/societario/sociedades", form),
    onSuccess: () => {
      toast({ title: "Sociedade criada com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/dashboard"] });
      setOpen(false);
      setForm({ razaoSocial: "", nomeFantasia: "", cnpj: "", regimeTributario: "simples", naturezaJuridica: "ltda", capitalSocial: "0", objetoSocial: "" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message || "Falha ao criar sociedade", variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-societario">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Societário
          </h1>
          <p className="text-sm text-muted-foreground">Gestão jurídica e compliance das empresas da carteira.</p>
        </div>
        <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setChatOpen(true)} data-testid="button-open-agent">
          <Bot className="h-4 w-4 mr-2" /> Agente Societário
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-sociedade">
              <Plus className="h-4 w-4 mr-2" /> Nova sociedade
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Nova sociedade</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Razão social *</Label>
                <Input value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} data-testid="input-razao-social" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Nome fantasia</Label>
                  <Input value={form.nomeFantasia} onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })} data-testid="input-nome-fantasia" />
                </div>
                <div className="grid gap-1.5">
                  <Label>CNPJ</Label>
                  <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" data-testid="input-cnpj" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Natureza</Label>
                  <Select value={form.naturezaJuridica} onValueChange={(v) => setForm({ ...form, naturezaJuridica: v })}>
                    <SelectTrigger data-testid="select-natureza"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NATUREZAS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Regime tributário</Label>
                  <Select value={form.regimeTributario} onValueChange={(v) => setForm({ ...form, regimeTributario: v })}>
                    <SelectTrigger data-testid="select-regime"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REGIMES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Capital social (R$)</Label>
                  <Input type="number" step="0.01" value={form.capitalSocial} onChange={(e) => setForm({ ...form, capitalSocial: e.target.value })} data-testid="input-capital" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Objeto social</Label>
                <Textarea rows={3} value={form.objetoSocial} onChange={(e) => setForm({ ...form, objetoSocial: e.target.value })} data-testid="input-objeto" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => create.mutate()} disabled={!form.razaoSocial || create.isPending} data-testid="button-save-sociedade">
                {create.isPending ? "Salvando..." : "Criar sociedade"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <ModuleAgentBanner module="societario" label="Societário" />

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Sociedades ativas</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />{dashboard?.counts.sociedades_ativas ?? "—"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Obrigações próximas (30d)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-amber-500" />{dashboard?.counts.obrigacoes_proximas ?? "—"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Atrasadas</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />{dashboard?.counts.obrigacoes_atrasadas ?? "—"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Certificados vencendo</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold flex items-center gap-2"><FileText className="h-5 w-5 text-orange-500" />{dashboard?.counts.certificados_vencendo ?? "—"}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="sociedades" className="w-full">
        <TabsList data-testid="tabs-societario-hub">
          <TabsTrigger value="sociedades" data-testid="tab-sociedades">
            <Building2 className="h-4 w-4 mr-1" /> Sociedades
          </TabsTrigger>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline">
            <KanbanSquare className="h-4 w-4 mr-1" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <Activity className="h-4 w-4 mr-1" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="configs" data-testid="tab-configs">
            <Settings2 className="h-4 w-4 mr-1" /> Configurações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sociedades" className="mt-4 space-y-6">
      {/* Painel: Alterações em andamento (sociedades ATIVAS) */}
      <Card data-testid="card-alteracoes-controle">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-4 w-4 text-amber-500" />
              Alterações em andamento
              {alteracoesPendentes.length > 0 && (
                <Badge variant="secondary" className="ml-1" data-testid="badge-alteracoes-total">
                  {alteracoesPendentes.length}
                </Badge>
              )}
            </CardTitle>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Pendentes em sociedades ativas — controle de prazos
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingAlteracoes ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : alteracoesPendentes.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-alteracoes-empty">
              Nenhuma alteração pendente em sociedades ativas no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sociedade</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data início</TableHead>
                    <TableHead>Dias decorridos</TableHead>
                    <TableHead>Órgão / Nº</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alteracoesPendentes.map((a) => {
                    const stBadge = ALT_STATUS_BADGE[a.status] || ALT_STATUS_BADGE.pendente;
                    const dias = Number(a.diasDecorridos ?? 0);
                    const diasClass = dias > 60 ? "text-destructive font-medium"
                      : dias > 30 ? "text-amber-600 font-medium"
                      : "";
                    return (
                      <TableRow key={a.id} data-testid={`row-alteracao-${a.id}`}>
                        <TableCell className="max-w-[260px]">
                          <Link
                            href={`/societario/${a.sociedadeId}`}
                            className="font-medium hover:underline truncate block"
                            data-testid={`link-sociedade-${a.sociedadeId}`}
                          >
                            {a.sociedadeRazaoSocial}
                          </Link>
                          {a.descricao && (
                            <div className="text-xs text-muted-foreground truncate">{a.descricao}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {TIPO_ALTERACAO_LABEL[a.tipo] || a.tipo}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap" data-testid={`text-data-evento-${a.id}`}>
                          {formatDate(a.dataEvento)}
                        </TableCell>
                        <TableCell className={`text-sm whitespace-nowrap ${diasClass}`} data-testid={`text-dias-${a.id}`}>
                          <Clock className="h-3 w-3 inline mr-1" />
                          {dias} dia{dias === 1 ? "" : "s"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {a.orgaoRegistro ? a.orgaoRegistro.toUpperCase() : "—"}
                          {a.numeroRegistro && <span className="ml-1">· {a.numeroRegistro}</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={stBadge.variant} className="text-xs">{stBadge.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por razão social, fantasia ou CNPJ..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" data-testid="input-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os status</SelectItem>
            <SelectItem value="ativa">Ativas</SelectItem>
            <SelectItem value="em_constituicao">Em constituição</SelectItem>
            <SelectItem value="inativa">Inativas</SelectItem>
            <SelectItem value="baixada">Baixadas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : sociedades.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty">
          Nenhuma sociedade cadastrada. Clique em "Nova sociedade" para começar.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {sociedades.map((s) => {
            const badge = STATUS_BADGE[s.status || "ativa"] || STATUS_BADGE.ativa;
            const pendentes = s.status === "ativa" ? (pendentesMap.get(s.id) || 0) : 0;
            return (
              <Link key={s.id} href={`/societario/${s.id}`}>
                <Card className="hover-elevate active-elevate-2 cursor-pointer" data-testid={`card-sociedade-${s.id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.razaoSocial}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                        {s.cnpj && <span>{s.cnpj}</span>}
                        {s.nomeFantasia && <span>·</span>}
                        {s.nomeFantasia && <span className="truncate">{s.nomeFantasia}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {pendentes > 0 && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900"
                          data-testid={`badge-alteracoes-pendentes-${s.id}`}
                        >
                          <History className="h-3 w-3 mr-1" />
                          {pendentes} alteração{pendentes === 1 ? "" : "ões"} em andamento
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">{REGIMES.find((r) => r.value === s.regimeTributario)?.label || s.regimeTributario}</Badge>
                      <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4">
          <PipelineSocietario embedded />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-4">
          <PipelineSocietarioDashboard embedded />
        </TabsContent>

        <TabsContent value="configs" className="mt-4">
          <PipelineSocietarioConfigs embedded />
        </TabsContent>
      </Tabs>

      <SocietarioAgentChat
        open={chatOpen}
        onOpenChange={setChatOpen}
        sociedadeId={null}
        sociedadeName={null}
      />
    </div>
  );
}
