import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LifeBuoy,
  Plus,
  Search,
  Building2,
  Loader2,
  Eye,
  AlertCircle,
  CheckCircle2,
  Wallet,
  Bell,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ModuleAgentBanner } from "@/components/agent/ModuleAgentBanner";
import type { RecoveryProcess, Pessoa } from "@shared/schema";

type ProcessListItem = RecoveryProcess & {
  clienteNome?: string | null;
  credoresCount?: number;
};

type DashboardSummary = {
  total: number;
  ativos: number;
  concluidos: number;
  totalDividas: string;
  totalAcordos: string;
  totalPago: string;
  porTipoCredor: Array<{ tipoCredor: string; total: string; quantidade: number }>;
};

const STATUS_OPCOES = [
  { value: "todos", label: "Todos os status" },
  { value: "diagnostico", label: "Diagnóstico" },
  { value: "negociacao", label: "Negociação" },
  { value: "acordo_homologado", label: "Acordo homologado" },
  { value: "em_cumprimento", label: "Em cumprimento" },
  { value: "concluido", label: "Concluído" },
  { value: "inadimplente", label: "Inadimplente" },
  { value: "arquivado", label: "Arquivado" },
];

const STATUS_COLOR: Record<string, string> = {
  diagnostico: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  negociacao: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  acordo_homologado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  em_cumprimento: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  concluido: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  inadimplente: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100",
  arquivado: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const TIPO_OPCOES = [
  { value: "todos", label: "Todos os tipos" },
  { value: "extrajudicial", label: "Extrajudicial" },
  { value: "judicial", label: "Judicial" },
  { value: "preventiva", label: "Preventiva" },
  { value: "reestruturacao_amigavel", label: "Reestruturação amigável" },
];

const TIPO_CREDOR_LABEL: Record<string, string> = {
  banco: "Bancos",
  fornecedor: "Fornecedores",
  tributos: "Tributos",
  trabalhista: "Trabalhista",
  utility: "Utilidades",
  judicial: "Judicial",
  outro: "Outros",
};

function formatBRL(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(s: string): string {
  return STATUS_OPCOES.find((o) => o.value === s)?.label ?? s;
}

function tipoLabel(t: string): string {
  return TIPO_OPCOES.find((o) => o.value === t)?.label ?? t;
}

export default function Recovery() {
  const [search, setSearch] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [novoOpen, setNovoOpen] = useState(false);
  const { toast } = useToast();

  const dashboardQuery = useQuery<DashboardSummary>({
    queryKey: ["/api/recovery/dashboard"],
  });

  // Sprint 4: alertas (notificações Recovery não lidas) do tenant
  type RecoveryNotification = {
    id: string;
    title: string;
    body: string;
    type: string;
    sourceType: string;
    sourceId: string;
    isRead: number;
    createdAt: string;
  };
  const notificationsQuery = useQuery<{ items: RecoveryNotification[]; unreadCount: number }>({
    queryKey: ["/api/recovery/notifications", { unreadOnly: "true", limit: 5 }],
    queryFn: async () => {
      const r = await fetch("/api/recovery/notifications?unreadOnly=true&limit=5", {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Falha ao carregar alertas");
      return r.json();
    },
    refetchInterval: 60_000, // refresh a cada minuto
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/recovery/notifications/${id}/mark-read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/recovery/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/notifications"] });
      toast({ title: "Todas as notificações marcadas como lidas" });
    },
  });

  const processesQuery = useQuery<ProcessListItem[]>({
    queryKey: ["/api/recovery/processes", { status: statusFiltro, tipo: tipoFiltro, q: search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFiltro !== "todos") params.set("status", statusFiltro);
      if (tipoFiltro !== "todos") params.set("tipo", tipoFiltro);
      if (search.trim()) params.set("q", search.trim());
      const r = await fetch(`/api/recovery/processes?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar");
      return r.json();
    },
  });

  // Pessoas (PJ) para selecionar como cliente em recuperação
  const pessoasQuery = useQuery<Pessoa[]>({
    queryKey: ["/api/pessoas"],
    enabled: novoOpen,
  });

  type CriarPayload = {
    nomeProcesso: string;
    tipoRecuperacao: string;
    status: string;
    clientePessoaId: string | null;
    observacoes: string;
  };

  const criarProcesso = useMutation({
    mutationFn: async (payload: CriarPayload) => {
      const body: any = {
        nomeProcesso: payload.nomeProcesso,
        tipoRecuperacao: payload.tipoRecuperacao,
        status: payload.status,
        observacoes: payload.observacoes || undefined,
      };
      if (payload.clientePessoaId) body.clientePessoaId = payload.clientePessoaId;
      const r = await apiRequest("POST", "/api/recovery/processes", body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/dashboard"] });
      toast({ title: "Processo criado com sucesso" });
      setNovoOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar processo", description: err?.message, variant: "destructive" });
    },
  });

  const dash = dashboardQuery.data;

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-recovery">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <LifeBuoy className="h-6 w-6 text-primary" />
            Recovery — Recuperação de Empresas
          </h1>
          <p className="text-muted-foreground mt-1">
            Gestão isolada de processos, credores e negociações. Dívidas em negociação não viram conta a pagar
            até o acordo ser homologado.
          </p>
        </div>
        <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-novo-processo">
              <Plus className="h-4 w-4 mr-2" />
              Novo processo
            </Button>
          </DialogTrigger>
          <NovoProcessoDialog
            pessoas={pessoasQuery.data ?? []}
            isPending={criarProcesso.isPending}
            onCreate={(p) => criarProcesso.mutate(p)}
          />
        </Dialog>
      </div>

      <ModuleAgentBanner module="recovery" label="Recovery" />

      {/* Sprint 4: Alertas Recovery */}
      {notificationsQuery.data && notificationsQuery.data.items.length > 0 && (
        <Card data-testid="card-alertas-recovery" className="border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-600" />
                Alertas Recovery
                <Badge variant="secondary" data-testid="badge-unread-count">
                  {notificationsQuery.data.unreadCount} não lida(s)
                </Badge>
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                data-testid="button-marcar-todas-lidas"
              >
                {markAllRead.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                Marcar todas como lidas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {notificationsQuery.data.items.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-2 p-2 rounded-md bg-background border"
                data-testid={`notification-${n.id}`}
              >
                <div className="mt-0.5">
                  {n.type === "warning" || n.type === "error" ? (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  ) : n.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Bell className="h-4 w-4 text-blue-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm" data-testid={`notification-title-${n.id}`}>
                    {n.title}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => markRead.mutate(n.id)}
                  disabled={markRead.isPending}
                  data-testid={`button-marcar-lida-${n.id}`}
                  title="Marcar como lida"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<LifeBuoy className="h-4 w-4 text-blue-600" />}
          label="Processos ativos"
          value={dash ? `${dash.ativos}` : "—"}
          hint={dash ? `${dash.total} no total · ${dash.concluidos} concluídos` : ""}
          loading={dashboardQuery.isLoading}
          testId="kpi-processos-ativos"
        />
        <KPICard
          icon={<AlertCircle className="h-4 w-4 text-amber-600" />}
          label="Total em dívidas"
          value={dash ? formatBRL(dash.totalDividas) : "—"}
          hint="Valor consolidado de todos os processos"
          loading={dashboardQuery.isLoading}
          testId="kpi-total-dividas"
        />
        <KPICard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          label="Acordos fechados"
          value={dash ? formatBRL(dash.totalAcordos) : "—"}
          hint="Valor de credores em acordo aceito/homologado"
          loading={dashboardQuery.isLoading}
          testId="kpi-acordos"
        />
        <KPICard
          icon={<Wallet className="h-4 w-4 text-violet-600" />}
          label="Pago"
          value={dash ? formatBRL(dash.totalPago) : "—"}
          hint="Valor já liquidado em todos os processos"
          loading={dashboardQuery.isLoading}
          testId="kpi-total-pago"
        />
      </div>

      {/* Composição por tipo de credor (somente se houver dados) */}
      {dash && dash.porTipoCredor.length > 0 && (
        <Card data-testid="card-composicao-credores">
          <CardHeader>
            <CardTitle className="text-base">Composição por tipo de credor (todos os processos)</CardTitle>
            <CardDescription>Distribuição do passivo por natureza</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {dash.porTipoCredor.map((t) => (
              <div
                key={t.tipoCredor}
                className="rounded-md border p-3 bg-muted/40"
                data-testid={`tipo-${t.tipoCredor}`}
              >
                <div className="text-xs uppercase text-muted-foreground">{TIPO_CREDOR_LABEL[t.tipoCredor] ?? t.tipoCredor}</div>
                <div className="text-lg font-semibold mt-1">{formatBRL(t.total)}</div>
                <div className="text-xs text-muted-foreground">{t.quantidade} credor(es)</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Filtros + Lista */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <div>
              <CardTitle className="text-base">Processos</CardTitle>
              <CardDescription>
                {processesQuery.data?.length ?? 0} resultado(s)
              </CardDescription>
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-busca-processo"
                  placeholder="Buscar por nome ou nº judicial..."
                  className="pl-8 w-64"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger className="w-44" data-testid="select-status-filtro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPCOES.map((o) => (
                    <SelectItem key={o.value} value={o.value} data-testid={`option-status-${o.value}`}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
                <SelectTrigger className="w-44" data-testid="select-tipo-filtro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_OPCOES.map((o) => (
                    <SelectItem key={o.value} value={o.value} data-testid={`option-tipo-${o.value}`}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {processesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (processesQuery.data?.length ?? 0) === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="empty-state">
              <LifeBuoy className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>Nenhum processo encontrado.</p>
              <p className="text-sm">Clique em "Novo processo" para começar.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Processo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Dívidas</TableHead>
                  <TableHead className="text-right">Acordos</TableHead>
                  <TableHead className="text-right">Credores</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processesQuery.data!.map((p) => (
                  <TableRow key={p.id} data-testid={`row-processo-${p.id}`}>
                    <TableCell className="font-medium">{p.nomeProcesso}</TableCell>
                    <TableCell>
                      {p.clienteNome ? (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          {p.clienteNome}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{tipoLabel(p.tipoRecuperacao)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_COLOR[p.status] ?? ""}>
                        {statusLabel(p.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatBRL(p.valorTotalDividas)}</TableCell>
                    <TableCell className="text-right">{formatBRL(p.valorAcordosFechados)}</TableCell>
                    <TableCell className="text-right">{p.credoresCount ?? 0}</TableCell>
                    <TableCell>
                      <Link href={`/recovery/${p.id}`}>
                        <Button size="icon" variant="ghost" data-testid={`button-ver-processo-${p.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KPICard({
  icon, label, value, hint, loading, testId,
}: { icon: React.ReactNode; label: string; value: string; hint?: string; loading?: boolean; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24 mt-2" />
        ) : (
          <div className="text-2xl font-bold mt-1" data-testid={`${testId}-value`}>{value}</div>
        )}
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function NovoProcessoDialog({
  pessoas, isPending, onCreate,
}: {
  pessoas: Pessoa[];
  isPending: boolean;
  onCreate: (p: { nomeProcesso: string; tipoRecuperacao: string; status: string; clientePessoaId: string | null; observacoes: string }) => void;
}) {
  const [nomeProcesso, setNomeProcesso] = useState("");
  const [tipoRecuperacao, setTipoRecuperacao] = useState("extrajudicial");
  const [status, setStatus] = useState("diagnostico");
  const [clientePessoaId, setClientePessoaId] = useState<string>("__nenhum__");
  const [observacoes, setObservacoes] = useState("");

  const pessoasPj = pessoas.filter((p) => p.tipoPessoa === "pj" || !p.tipoPessoa);

  return (
    <DialogContent data-testid="dialog-novo-processo">
      <DialogHeader>
        <DialogTitle>Novo processo de recuperação</DialogTitle>
        <DialogDescription>
          Inicie um processo de Recuperação. Você poderá adicionar credores em seguida.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="nome-processo">Nome do processo *</Label>
          <Input
            id="nome-processo"
            data-testid="input-nome-processo"
            value={nomeProcesso}
            onChange={(e) => setNomeProcesso(e.target.value)}
            placeholder="Ex.: Recuperação Indústria XYZ Ltda"
          />
        </div>
        <div>
          <Label>Cliente em recuperação (opcional)</Label>
          <Select value={clientePessoaId} onValueChange={setClientePessoaId}>
            <SelectTrigger data-testid="select-cliente-pessoa">
              <SelectValue placeholder="Selecione uma pessoa cadastrada" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__nenhum__">— Nenhum (informar depois) —</SelectItem>
              {pessoasPj.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nomeFantasia ?? p.razaoSocial ?? "Pessoa sem nome"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <Select value={tipoRecuperacao} onValueChange={setTipoRecuperacao}>
              <SelectTrigger data-testid="select-tipo-recuperacao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPO_OPCOES.filter((o) => o.value !== "todos").map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status inicial</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-status-inicial">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPCOES.filter((o) => !["todos", "concluido", "arquivado"].includes(o.value)).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="observacoes">Observações</Label>
          <Textarea
            id="observacoes"
            data-testid="input-observacoes"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          data-testid="button-confirmar-novo-processo"
          disabled={!nomeProcesso.trim() || isPending}
          onClick={() =>
            onCreate({
              nomeProcesso: nomeProcesso.trim(),
              tipoRecuperacao,
              status,
              clientePessoaId: clientePessoaId === "__nenhum__" ? null : clientePessoaId,
              observacoes,
            })
          }
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Criar processo
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
