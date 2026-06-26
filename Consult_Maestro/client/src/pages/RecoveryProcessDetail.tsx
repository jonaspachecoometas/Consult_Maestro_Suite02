import { useState, useRef } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  LifeBuoy,
  Building2,
  Plus,
  Upload,
  Loader2,
  Trash2,
  Pencil,
  CheckCircle2,
  Circle,
  AlertCircle,
  CalendarClock,
  Activity,
  ListChecks,
  Users,
  History,
  FileText,
  Calculator,
  Banknote,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  Filter,
  Download,
  Paperclip,
  FileDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { RecoveryProcess, RecoveryCreditor, RecoveryAction, RecoveryTimeline, Pessoa, RecoveryScenario } from "@shared/schema";

type ProcessSummary = {
  process: RecoveryProcess;
  porTipoCredor: Array<{ tipoCredor: string; total: string; quantidade: number }>;
  porStatusNegociacao: Array<{ statusNegociacao: string; total: string; quantidade: number }>;
  acoes: { total: number; pendentes: number; emAndamento: number; concluidas: number };
};

type ProcessFull = RecoveryProcess & { cliente?: Pessoa | null };

const STATUS_PROCESSO: Record<string, { label: string; cor: string }> = {
  diagnostico: { label: "Diagnóstico", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
  negociacao: { label: "Negociação", cor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
  acordo_homologado: { label: "Acordo homologado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  em_cumprimento: { label: "Em cumprimento", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  concluido: { label: "Concluído", cor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  inadimplente: { label: "Inadimplente", cor: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100" },
  arquivado: { label: "Arquivado", cor: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

const TIPO_CREDOR = [
  { value: "banco", label: "Banco/Financeira" },
  { value: "fornecedor", label: "Fornecedor" },
  { value: "tributos", label: "Tributos" },
  { value: "trabalhista", label: "Trabalhista" },
  { value: "utility", label: "Utilidades" },
  { value: "judicial", label: "Judicial" },
  { value: "outro", label: "Outro" },
];

const TIPO_CREDOR_LABEL = Object.fromEntries(TIPO_CREDOR.map((t) => [t.value, t.label]));

const STATUS_NEGOCIACAO = [
  { value: "pendente", label: "Pendente", cor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  { value: "em_negociacao", label: "Em negociação", cor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
  { value: "acordo_proposto", label: "Acordo proposto", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
  { value: "acordo_aceito", label: "Acordo aceito", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  { value: "acordo_homologado", label: "Homologado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  { value: "recusado", label: "Recusado", cor: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100" },
  { value: "judicializado", label: "Judicializado", cor: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100" },
];
const STATUS_NEGOCIACAO_MAP = Object.fromEntries(STATUS_NEGOCIACAO.map((s) => [s.value, s]));

const PRIORIDADES = [
  { value: "critica", label: "Crítica", cor: "bg-rose-600 text-white" },
  { value: "alta", label: "Alta", cor: "bg-orange-500 text-white" },
  { value: "media", label: "Média", cor: "bg-blue-500 text-white" },
  { value: "baixa", label: "Baixa", cor: "bg-slate-400 text-white" },
];
const PRIORIDADE_MAP = Object.fromEntries(PRIORIDADES.map((p) => [p.value, p]));

const TIPO_ACAO = [
  { value: "reuniao", label: "Reunião" },
  { value: "proposta", label: "Proposta" },
  { value: "contraproposta", label: "Contraproposta" },
  { value: "documento", label: "Documento" },
  { value: "email", label: "E-mail" },
  { value: "ligacao", label: "Ligação" },
  { value: "audiencia", label: "Audiência" },
  { value: "decisao_judicial", label: "Decisão judicial" },
  { value: "pagamento", label: "Pagamento" },
  { value: "outro", label: "Outro" },
];

const STATUS_ACAO = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

function formatBRL(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function RecoveryProcessDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id!;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState("visao");

  const processQuery = useQuery<ProcessFull>({
    queryKey: ["/api/recovery/processes", id],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Processo não encontrado");
      return r.json();
    },
  });

  const summaryQuery = useQuery<ProcessSummary>({
    queryKey: ["/api/recovery/processes", id, "summary"],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${id}/summary`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar resumo");
      return r.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const r = await apiRequest("PATCH", `/api/recovery/processes/${id}`, { status });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", id, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", id, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/dashboard"] });
      toast({ title: "Status atualizado" });
    },
  });

  const deleteProcess = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `/api/recovery/processes/${id}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/dashboard"] });
      toast({ title: "Processo excluído" });
      navigate("/recovery");
    },
    onError: (err: any) => toast({ title: "Erro", description: err?.message, variant: "destructive" }),
  });

  if (processQuery.isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!processQuery.data) {
    return (
      <div className="container mx-auto p-6">
        <p>Processo não encontrado.</p>
        <Link href="/recovery"><Button variant="ghost">Voltar para Recovery</Button></Link>
      </div>
    );
  }

  const proc = processQuery.data;
  const summary = summaryQuery.data;

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-recovery-detail">
      <div className="flex items-center gap-2">
        <Link href="/recovery">
          <Button variant="ghost" size="sm" data-testid="button-voltar">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </Link>
      </div>

      {/* Header com status, cliente e ações */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-heading font-bold" data-testid="text-nome-processo">{proc.nomeProcesso}</h1>
              </div>
              {proc.cliente && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  Cliente: <strong className="text-foreground">{proc.cliente.nomeFantasia ?? proc.cliente.razaoSocial}</strong>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={STATUS_PROCESSO[proc.status]?.cor}>
                  {STATUS_PROCESSO[proc.status]?.label ?? proc.status}
                </Badge>
                <Badge variant="outline">{proc.tipoRecuperacao}</Badge>
                {proc.numeroProcessoJudicial && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {proc.numeroProcessoJudicial}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  Início: {formatDate(proc.dataInicio)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={proc.status} onValueChange={(v) => updateStatus.mutate(v)}>
                <SelectTrigger className="w-44" data-testid="select-status-processo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_PROCESSO).map(([v, info]) => (
                    <SelectItem key={v} value={v} data-testid={`option-status-${v}`}>{info.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" data-testid="button-excluir-processo">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir processo?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação remove o processo e todos os seus credores, ações e timeline. Não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteProcess.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirmar-excluir-processo"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* KPIs do processo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <MiniKPI label="Total dívidas" value={formatBRL(proc.valorTotalDividas)} testId="mini-kpi-dividas" />
            <MiniKPI label="Acordos fechados" value={formatBRL(proc.valorAcordosFechados)} testId="mini-kpi-acordos" />
            <MiniKPI label="Pago" value={formatBRL(proc.valorPago)} testId="mini-kpi-pago" />
            <MiniKPI
              label="Buffer caixa"
              value={`${(Number(proc.bufferCaixa ?? 0) * 100).toFixed(1)}%`}
              testId="mini-kpi-buffer"
            />
          </div>
        </CardContent>
      </Card>

      {/* Composição por tipo (visão geral) */}
      {summary && summary.porTipoCredor.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="card-por-tipo">
            <CardHeader>
              <CardTitle className="text-base">Dívidas por tipo de credor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.porTipoCredor.map((t) => (
                  <div key={t.tipoCredor} className="flex items-center justify-between border-b pb-2 last:border-0" data-testid={`tipo-${t.tipoCredor}`}>
                    <div>
                      <div className="font-medium">{TIPO_CREDOR_LABEL[t.tipoCredor] ?? t.tipoCredor}</div>
                      <div className="text-xs text-muted-foreground">{t.quantidade} credor(es)</div>
                    </div>
                    <div className="font-semibold">{formatBRL(t.total)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-por-status">
            <CardHeader>
              <CardTitle className="text-base">Dívidas por status de negociação</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.porStatusNegociacao.map((s) => (
                  <div key={s.statusNegociacao} className="flex items-center justify-between border-b pb-2 last:border-0" data-testid={`status-${s.statusNegociacao}`}>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={STATUS_NEGOCIACAO_MAP[s.statusNegociacao]?.cor}>
                        {STATUS_NEGOCIACAO_MAP[s.statusNegociacao]?.label ?? s.statusNegociacao}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{s.quantidade} credor(es)</span>
                    </div>
                    <div className="font-semibold">{formatBRL(s.total)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList data-testid="tabs-recovery">
          <TabsTrigger value="visao" data-testid="tab-visao"><Activity className="h-4 w-4 mr-1" /> Visão geral</TabsTrigger>
          <TabsTrigger value="credores" data-testid="tab-credores"><Users className="h-4 w-4 mr-1" /> Credores</TabsTrigger>
          <TabsTrigger value="acoes" data-testid="tab-acoes"><ListChecks className="h-4 w-4 mr-1" /> Ações</TabsTrigger>
          <TabsTrigger value="cenarios" data-testid="tab-cenarios"><Calculator className="h-4 w-4 mr-1" /> Cenários</TabsTrigger>
          <TabsTrigger value="parcelas" data-testid="tab-parcelas"><Banknote className="h-4 w-4 mr-1" /> Parcelas</TabsTrigger>
          <TabsTrigger value="timeline" data-testid="tab-timeline"><History className="h-4 w-4 mr-1" /> Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="visao">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo do processo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <Item label="Tipo" value={proc.tipoRecuperacao} />
                <Item label="Status" value={STATUS_PROCESSO[proc.status]?.label ?? proc.status} />
                <Item label="Início" value={formatDate(proc.dataInicio)} />
                <Item label="Limite homologação" value={formatDate(proc.dataLimiteHomologacao)} />
                <Item label="Vara judicial" value={proc.varaJudicial ?? "—"} />
                <Item label="Comarca" value={proc.comarca ?? "—"} />
              </div>
              {summary && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                  <MiniKPI label="Ações totais" value={String(summary.acoes.total)} testId="acoes-total" />
                  <MiniKPI label="Pendentes" value={String(summary.acoes.pendentes)} testId="acoes-pendentes" />
                  <MiniKPI label="Em andamento" value={String(summary.acoes.emAndamento)} testId="acoes-em-andamento" />
                  <MiniKPI label="Concluídas" value={String(summary.acoes.concluidas)} testId="acoes-concluidas" />
                </div>
              )}
              {proc.observacoes && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Observações</Label>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{proc.observacoes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credores">
          <CredoresTab processId={id} />
        </TabsContent>

        <TabsContent value="acoes">
          <AcoesTab processId={id} />
        </TabsContent>

        <TabsContent value="cenarios">
          <CenariosTab processId={id} />
        </TabsContent>

        <TabsContent value="parcelas">
          <ParcelasTab processId={id} clientePessoaId={proc.clientePessoaId} />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineTab processId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function MiniKPI({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md border p-3 bg-muted/30" data-testid={testId}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

// =============================================================================
// CREDORES TAB
// =============================================================================
function CredoresTab({ processId }: { processId: string }) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { toast } = useToast();

  const credoresQuery = useQuery<RecoveryCreditor[]>({
    queryKey: ["/api/recovery/processes", processId, "creditors"],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${processId}/creditors`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar credores");
      return r.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, statusNegociacao }: { id: string; statusNegociacao: string }) => {
      const r = await apiRequest("PATCH", `/api/recovery/creditors/${id}`, { statusNegociacao });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "creditors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId] });
    },
  });

  const deleteCreditor = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/recovery/creditors/${id}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "creditors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId] });
      toast({ title: "Credor removido" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Credores</CardTitle>
            <CardDescription>{credoresQuery.data?.length ?? 0} credor(es) cadastrado(s)</CardDescription>
          </div>
          <div className="flex gap-2">
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-importar-credores">
                  <Upload className="h-4 w-4 mr-2" />
                  Importar planilha
                </Button>
              </DialogTrigger>
              <ImportCredoresDialog processId={processId} onClose={() => setImportOpen(false)} />
            </Dialog>
            <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-novo-credor">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo credor
                </Button>
              </DialogTrigger>
              <NovoCredorDialog processId={processId} onClose={() => setNovoOpen(false)} />
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {credoresQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (credoresQuery.data?.length ?? 0) === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-credores">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Nenhum credor cadastrado.</p>
            <p className="text-sm">Use "Novo credor" ou "Importar planilha".</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead className="text-right">Valor original</TableHead>
                <TableHead className="text-right">Valor atualizado</TableHead>
                <TableHead>Status negociação</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credoresQuery.data!.map((c) => (
                <TableRow key={c.id} data-testid={`row-credor-${c.id}`}>
                  <TableCell>
                    <div className="font-medium">{c.credorNome}</div>
                    {c.credorDocumento && <div className="text-xs text-muted-foreground">{c.credorDocumento}</div>}
                    {c.tipoDebito && <div className="text-xs text-muted-foreground">{c.tipoDebito}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{TIPO_CREDOR_LABEL[c.tipoCredor] ?? c.tipoCredor}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={PRIORIDADE_MAP[c.prioridade]?.cor}>
                      {PRIORIDADE_MAP[c.prioridade]?.label ?? c.prioridade}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{formatBRL(c.valorOriginal)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatBRL(c.valorAtualizado)}</TableCell>
                  <TableCell>
                    <Select
                      value={c.statusNegociacao}
                      onValueChange={(v) => updateStatus.mutate({ id: c.id, statusNegociacao: v })}
                    >
                      <SelectTrigger className="h-8 w-44" data-testid={`select-status-credor-${c.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_NEGOCIACAO.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-excluir-credor-${c.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover credor?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação remove o credor do processo. As ações vinculadas a ele
                            serão preservadas (ficarão sem vínculo direto).
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteCreditor.mutate(c.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remover
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function NovoCredorDialog({ processId, onClose }: { processId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [credorNome, setCredorNome] = useState("");
  const [credorDocumento, setCredorDocumento] = useState("");
  const [tipoCredor, setTipoCredor] = useState("fornecedor");
  const [tipoDebito, setTipoDebito] = useState("");
  const [valorOriginal, setValorOriginal] = useState("");
  const [valorAtualizado, setValorAtualizado] = useState("");
  const [dataVencimentoOriginal, setDataVencimentoOriginal] = useState("");
  const [prioridade, setPrioridade] = useState("media");
  const [observacoes, setObservacoes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        credorNome: credorNome.trim(),
        tipoCredor,
        prioridade,
        valorOriginal: valorOriginal || "0",
        valorAtualizado: valorAtualizado || valorOriginal || "0",
      };
      if (credorDocumento.trim()) body.credorDocumento = credorDocumento.trim();
      if (tipoDebito.trim()) body.tipoDebito = tipoDebito.trim();
      if (dataVencimentoOriginal) body.dataVencimentoOriginal = dataVencimentoOriginal;
      if (observacoes.trim()) body.observacoes = observacoes.trim();
      const r = await apiRequest("POST", `/api/recovery/processes/${processId}/creditors`, body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "creditors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId] });
      toast({ title: "Credor adicionado" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Erro", description: err?.message, variant: "destructive" }),
  });

  return (
    <DialogContent data-testid="dialog-novo-credor">
      <DialogHeader>
        <DialogTitle>Adicionar credor</DialogTitle>
        <DialogDescription>Cadastre uma dívida individual no processo.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Nome do credor *</Label>
          <Input data-testid="input-credor-nome" value={credorNome} onChange={(e) => setCredorNome(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>CNPJ/CPF</Label>
            <Input data-testid="input-credor-doc" value={credorDocumento} onChange={(e) => setCredorDocumento(e.target.value)} />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipoCredor} onValueChange={setTipoCredor}>
              <SelectTrigger data-testid="select-credor-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPO_CREDOR.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Tipo do débito</Label>
          <Input
            data-testid="input-credor-debito"
            value={tipoDebito}
            onChange={(e) => setTipoDebito(e.target.value)}
            placeholder="Ex.: NF 1234, Empréstimo Banco X, ICMS-ST out/24"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Valor original</Label>
            <Input
              data-testid="input-valor-original"
              type="number"
              step="0.01"
              value={valorOriginal}
              onChange={(e) => setValorOriginal(e.target.value)}
            />
          </div>
          <div>
            <Label>Valor atualizado</Label>
            <Input
              data-testid="input-valor-atualizado"
              type="number"
              step="0.01"
              value={valorAtualizado}
              onChange={(e) => setValorAtualizado(e.target.value)}
              placeholder="(igual ao original se vazio)"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Vencimento original</Label>
            <Input
              data-testid="input-vencimento"
              type="date"
              value={dataVencimentoOriginal}
              onChange={(e) => setDataVencimentoOriginal(e.target.value)}
            />
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={prioridade} onValueChange={setPrioridade}>
              <SelectTrigger data-testid="select-prioridade"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORIDADES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Observações</Label>
          <Textarea data-testid="input-credor-obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button
          data-testid="button-confirmar-credor"
          disabled={!credorNome.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Adicionar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ImportCredoresDialog({ processId, onClose }: { processId: string; onClose: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ total: number; criados: number; erros: any[] } | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/recovery/processes/${processId}/creditors/import`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? "Falha no upload");
      }
      return r.json();
    },
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "creditors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId] });
      toast({
        title: "Importação concluída",
        description: `${res.criados} credor(es) criado(s) — ${res.erros?.length ?? 0} erro(s).`,
        variant: res.erros?.length ? "destructive" : "default",
      });
    },
    onError: (err: any) => toast({ title: "Erro", description: err?.message, variant: "destructive" }),
  });

  return (
    <DialogContent data-testid="dialog-import-credores">
      <DialogHeader>
        <DialogTitle>Importar credores em massa</DialogTitle>
        <DialogDescription>
          Envie .xlsx, .xls ou .csv. Cabeçalhos aceitos: <code>credor_nome</code> (ou <code>nome</code>),
          <code> credor_documento</code> (ou <code>cnpj</code>), <code>tipo_credor</code>,
          <code> tipo_debito</code>, <code>valor_original</code> (ou <code>valor</code>), <code>valor_atualizado</code>,
          <code> data_vencimento_original</code> (ou <code>vencimento</code>), <code>prioridade</code>, <code>observacoes</code>.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          data-testid="input-file-credores"
          disabled={upload.isPending}
        />
        {result && (
          <div className="rounded-md border p-3 bg-muted/40 text-sm" data-testid="result-import">
            <div><strong>Total no arquivo:</strong> {result.total}</div>
            <div><strong>Criados:</strong> {result.criados}</div>
            {result.erros?.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer">Erros: {result.erros.length}</summary>
                <ul className="mt-2 text-xs space-y-1 max-h-40 overflow-auto">
                  {result.erros.map((e: any, i: number) => (
                    <li key={i}>Linha {e.linha} — {e.identificacao}: {e.erro}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button
          data-testid="button-confirmar-import"
          disabled={upload.isPending}
          onClick={() => {
            const f = fileRef.current?.files?.[0];
            if (!f) {
              toast({ title: "Selecione um arquivo", variant: "destructive" });
              return;
            }
            upload.mutate(f);
          }}
        >
          {upload.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Enviar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =============================================================================
// AÇÕES TAB
// =============================================================================
function AcoesTab({ processId }: { processId: string }) {
  const [novoOpen, setNovoOpen] = useState(false);
  const { toast } = useToast();

  const acoesQuery = useQuery<RecoveryAction[]>({
    queryKey: ["/api/recovery/processes", processId, "actions"],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${processId}/actions`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar ações");
      return r.json();
    },
  });

  const updateAction = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiRequest("PATCH", `/api/recovery/actions/${id}`, { status });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
    },
  });

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/recovery/actions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      toast({ title: "Ação removida" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Ações do processo</CardTitle>
            <CardDescription>{acoesQuery.data?.length ?? 0} ação(ões) registrada(s)</CardDescription>
          </div>
          <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-nova-acao">
                <Plus className="h-4 w-4 mr-2" />
                Nova ação
              </Button>
            </DialogTrigger>
            <NovaAcaoDialog processId={processId} onClose={() => setNovoOpen(false)} />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {acoesQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (acoesQuery.data?.length ?? 0) === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-acoes">
            <ListChecks className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Nenhuma ação registrada.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {acoesQuery.data!.map((a) => (
              <div
                key={a.id}
                className="border rounded-md p-3 flex items-start gap-3 hover-elevate"
                data-testid={`row-acao-${a.id}`}
              >
                <div className="mt-1">
                  {a.status === "concluida" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : a.status === "em_andamento" ? (
                    <Loader2 className="h-5 w-5 text-blue-600" />
                  ) : a.status === "cancelada" ? (
                    <Circle className="h-5 w-5 text-slate-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{a.titulo}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{a.tipoAcao}</Badge>
                        {a.dataPrevista && <span>Previsto: {formatDate(a.dataPrevista)}</span>}
                        {a.dataConcluida && <span>Concluído: {formatDate(a.dataConcluida)}</span>}
                      </div>
                      {a.descricao && <p className="text-sm mt-2 whitespace-pre-wrap">{a.descricao}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={a.status}
                        onValueChange={(v) => updateAction.mutate({ id: a.id, status: v })}
                      >
                        <SelectTrigger className="h-8 w-36" data-testid={`select-status-acao-${a.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_ACAO.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-excluir-acao-${a.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir ação?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita. A ação "{a.titulo}" será
                              removida permanentemente do processo.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteAction.mutate(a.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirmar-excluir-acao-${a.id}`}
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NovaAcaoDialog({ processId, onClose }: { processId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [titulo, setTitulo] = useState("");
  const [tipoAcao, setTipoAcao] = useState("reuniao");
  const [descricao, setDescricao] = useState("");
  const [dataPrevista, setDataPrevista] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        titulo: titulo.trim(),
        tipoAcao,
        status: "pendente",
      };
      if (descricao.trim()) body.descricao = descricao.trim();
      if (dataPrevista) body.dataPrevista = new Date(dataPrevista).toISOString();
      const r = await apiRequest("POST", `/api/recovery/processes/${processId}/actions`, body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      toast({ title: "Ação criada" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Erro", description: err?.message, variant: "destructive" }),
  });

  return (
    <DialogContent data-testid="dialog-nova-acao">
      <DialogHeader>
        <DialogTitle>Nova ação</DialogTitle>
        <DialogDescription>Registre uma reunião, proposta, documento, etc.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Título *</Label>
          <Input data-testid="input-acao-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <Select value={tipoAcao} onValueChange={setTipoAcao}>
              <SelectTrigger data-testid="select-acao-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPO_ACAO.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data prevista</Label>
            <Input
              data-testid="input-acao-data"
              type="datetime-local"
              value={dataPrevista}
              onChange={(e) => setDataPrevista(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea data-testid="input-acao-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button
          data-testid="button-confirmar-acao"
          disabled={!titulo.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Criar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =============================================================================
// TIMELINE TAB (Sprint 4 — Toneraud: filtros + PDF + anexos)
// =============================================================================

const TIMELINE_EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "__todos__", label: "Todos os tipos" },
  { value: "process_created", label: "Processo criado" },
  { value: "status_changed", label: "Status alterado" },
  { value: "creditor_added", label: "Credor adicionado" },
  { value: "creditor_imported", label: "Credores importados" },
  { value: "creditor_status_changed", label: "Status do credor" },
  { value: "action_created", label: "Ação criada" },
  { value: "action_completed", label: "Ação concluída" },
  { value: "acao_vencida", label: "Ação vencida" },
  { value: "note", label: "Anotações" },
  { value: "scenario_created", label: "Cenário criado" },
  { value: "scenario_homologated", label: "Cenário homologado" },
  { value: "proposal_sent", label: "Proposta enviada" },
  { value: "installment_released", label: "Parcela liberada" },
  { value: "installment_paid", label: "Parcela paga" },
  { value: "inadimplencia_detectada", label: "Inadimplência" },
];

const TIMELINE_TYPE_LABELS: Record<string, string> = TIMELINE_EVENT_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.value]: t.label }),
  {} as Record<string, string>,
);

function formatBytes(b: number): string {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

type TimelineAttachment = { path: string; name: string; size?: number; mime?: string; uploadedAt?: string };

function TimelineTab({ processId }: { processId: string }) {
  const { toast } = useToast();
  const [novaNotaTexto, setNovaNotaTexto] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("__todos__");
  const [creditorFilter, setCreditorFilter] = useState<string>("__todos__");
  const [searchFilter, setSearchFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const params = new URLSearchParams();
  if (eventTypeFilter !== "__todos__") params.set("eventType", eventTypeFilter);
  if (creditorFilter !== "__todos__") params.set("creditorId", creditorFilter);
  if (searchFilter.trim()) params.set("search", searchFilter.trim());
  if (fromFilter) params.set("from", fromFilter);
  if (toFilter) params.set("to", `${toFilter}T23:59:59`);
  params.set("limit", "200");
  const queryStr = params.toString();

  const timelineQuery = useQuery<{ items: RecoveryTimeline[]; total: number }>({
    queryKey: ["/api/recovery/processes", processId, "timeline", queryStr],
    queryFn: async () => {
      const r = await fetch(
        `/api/recovery/processes/${processId}/timeline?${queryStr}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Falha ao carregar timeline");
      return r.json();
    },
  });

  const creditorsQuery = useQuery<RecoveryCreditor[]>({
    queryKey: ["/api/recovery/processes", processId, "creditors"],
    queryFn: async () => {
      const r = await fetch(
        `/api/recovery/processes/${processId}/creditors`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Falha ao carregar credores");
      return r.json();
    },
  });

  const addNota = useMutation({
    mutationFn: async (texto: string) => {
      const r = await apiRequest("POST", `/api/recovery/processes/${processId}/timeline`, {
        eventType: "note",
        title: texto.split("\n")[0].slice(0, 100) || "Nota",
        description: texto,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      setNovaNotaTexto("");
      toast({ title: "Nota adicionada" });
    },
  });

  const attachMutation = useMutation({
    mutationFn: async ({ eventId, file }: { eventId: string; file: File }) => {
      const r1 = await apiRequest(
        "POST",
        `/api/recovery/processes/${processId}/timeline/upload-url`,
        {},
      );
      const { uploadURL } = await r1.json();
      const r2 = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!r2.ok) throw new Error(`Upload falhou (HTTP ${r2.status})`);
      const r3 = await apiRequest(
        "POST",
        `/api/recovery/timeline/${eventId}/attachments`,
        {
          uploadURL,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
        },
      );
      return r3.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      toast({ title: "Anexo enviado" });
    },
    onError: (e: any) =>
      toast({ title: "Erro ao anexar", description: e?.message, variant: "destructive" }),
  });

  const deleteAttachment = useMutation({
    mutationFn: async ({ eventId, idx }: { eventId: string; idx: number }) => {
      const r = await apiRequest("DELETE", `/api/recovery/timeline/${eventId}/attachments/${idx}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "timeline"] });
      toast({ title: "Anexo removido" });
    },
    onError: (e: any) =>
      toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" }),
  });

  function exportPdf() {
    const url = `/api/recovery/processes/${processId}/timeline/export.pdf?${queryStr}`;
    window.open(url, "_blank");
  }

  function clearFilters() {
    setEventTypeFilter("__todos__");
    setCreditorFilter("__todos__");
    setSearchFilter("");
    setFromFilter("");
    setToFilter("");
  }

  function pickFileFor(eventId: string) {
    const el = fileInputs.current[eventId];
    if (el) el.click();
  }

  const eventIcon = (type: string) => {
    if (type.includes("created")) return <Plus className="h-4 w-4" />;
    if (type === "creditor_imported") return <Upload className="h-4 w-4" />;
    if (type === "action_completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (type === "acao_vencida" || type === "inadimplencia_detectada") return <AlertCircle className="h-4 w-4 text-amber-600" />;
    if (type === "status_changed" || type === "creditor_status_changed") return <Activity className="h-4 w-4" />;
    if (type === "scenario_homologated") return <CheckCircle className="h-4 w-4 text-emerald-600" />;
    if (type === "installment_released") return <Send className="h-4 w-4 text-blue-600" />;
    if (type === "installment_paid") return <Banknote className="h-4 w-4 text-emerald-600" />;
    if (type === "note") return <FileText className="h-4 w-4" />;
    return <History className="h-4 w-4" />;
  };

  const events = timelineQuery.data?.items ?? [];
  const total = timelineQuery.data?.total ?? 0;
  const hasFilters =
    eventTypeFilter !== "__todos__" ||
    creditorFilter !== "__todos__" ||
    !!searchFilter.trim() ||
    !!fromFilter ||
    !!toFilter;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Toneraud — Timeline do processo
            </CardTitle>
            <CardDescription>
              {events.length} evento(s) {hasFilters ? `(de ${total} total — filtro ativo)` : `no total`}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="button-exportar-timeline-pdf"
            onClick={exportPdf}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Exportar PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filtros */}
        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <Label className="text-xs uppercase flex items-center gap-1">
            <Filter className="h-3 w-3" /> Filtros
          </Label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
              <SelectTrigger data-testid="select-tipo-evento"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMELINE_EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} data-testid={`option-evento-${t.value}`}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={creditorFilter} onValueChange={setCreditorFilter}>
              <SelectTrigger data-testid="select-credor-filtro"><SelectValue placeholder="Credor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos__">Todos os credores</SelectItem>
                {(creditorsQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`option-credor-${c.id}`}>
                    {c.credorNome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              data-testid="input-from-filtro"
              placeholder="De"
            />
            <Input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              data-testid="input-to-filtro"
              placeholder="Até"
            />
            <Input
              placeholder="Buscar no texto..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              data-testid="input-search-filtro"
            />
          </div>
          {hasFilters && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={clearFilters} data-testid="button-limpar-filtros">
                <X className="h-3 w-3 mr-1" /> Limpar filtros
              </Button>
            </div>
          )}
        </div>

        {/* Adicionar nota */}
        <div className="border rounded-md p-3 space-y-2">
          <Label className="text-xs uppercase">Adicionar nota</Label>
          <Textarea
            data-testid="input-nota-timeline"
            value={novaNotaTexto}
            onChange={(e) => setNovaNotaTexto(e.target.value)}
            placeholder="Ex.: Reunião com Banco X — proposta de 24x com 30% de desconto."
            rows={2}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              data-testid="button-adicionar-nota"
              disabled={!novaNotaTexto.trim() || addNota.isPending}
              onClick={() => addNota.mutate(novaNotaTexto.trim())}
            >
              {addNota.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </div>
        </div>

        {/* Lista de eventos */}
        {timelineQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="empty-timeline">
            <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>{hasFilters ? "Nenhum evento corresponde aos filtros." : "Nenhum evento registrado ainda."}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((e) => {
              const attachments = ((e.payload as any)?.attachments as TimelineAttachment[] | undefined) ?? [];
              const label = TIMELINE_TYPE_LABELS[e.eventType] ?? e.eventType;
              return (
                <div key={e.id} className="border-l-2 border-primary/30 pl-4 py-2" data-testid={`event-${e.id}`}>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 text-muted-foreground">{eventIcon(e.eventType)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{e.title}</div>
                      {e.description && (
                        <div className="text-sm text-muted-foreground whitespace-pre-wrap">{e.description}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDateTime(e.createdAt)} · <span className="font-mono">{label}</span>
                      </div>
                      {attachments.length > 0 && (
                        <div className="mt-2 space-y-1" data-testid={`attachments-${e.id}`}>
                          {attachments.map((att, idx) => (
                            <div
                              key={`${att.path}-${idx}`}
                              className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1"
                              data-testid={`attachment-${e.id}-${idx}`}
                            >
                              <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="flex-1 truncate" title={att.name}>{att.name}</span>
                              {att.size ? (
                                <span className="text-muted-foreground">{formatBytes(att.size)}</span>
                              ) : null}
                              <a
                                href={`/api/recovery/timeline/${e.id}/attachments/${idx}/download`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline inline-flex items-center"
                                data-testid={`button-baixar-anexo-${e.id}-${idx}`}
                              >
                                <Download className="h-3 w-3" />
                              </a>
                              <button
                                type="button"
                                className="text-rose-600 hover:underline"
                                data-testid={`button-excluir-anexo-${e.id}-${idx}`}
                                onClick={() => deleteAttachment.mutate({ eventId: e.id, idx })}
                                disabled={deleteAttachment.isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2">
                        <input
                          ref={(el) => { fileInputs.current[e.id] = el; }}
                          type="file"
                          className="hidden"
                          data-testid={`file-input-${e.id}`}
                          onChange={(ev) => {
                            const f = ev.target.files?.[0];
                            if (f) attachMutation.mutate({ eventId: e.id, file: f });
                            ev.target.value = "";
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7"
                          data-testid={`button-anexar-${e.id}`}
                          onClick={() => pickFileFor(e.id)}
                          disabled={attachMutation.isPending}
                        >
                          {attachMutation.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Paperclip className="h-3 w-3 mr-1" />
                          )}
                          Anexar arquivo
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// CENÁRIOS TAB (Sprint 2)
// =============================================================================
function CenariosTab({ processId }: { processId: string }) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, navigate] = useLocation();

  const cenariosQuery = useQuery<RecoveryScenario[]>({
    queryKey: ["/api/recovery/processes", processId, "scenarios"],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${processId}/scenarios`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar cenários");
      return r.json();
    },
  });

  const STATUS_CENARIO_MINI: Record<string, { label: string; cor: string }> = {
    rascunho: { label: "Rascunho", cor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
    em_analise: { label: "Em análise", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
    aprovado_interno: { label: "Aprovado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
    enviado_credores: { label: "Enviado", cor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
    aceito_credores: { label: "Aceito", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
    homologado: { label: "Homologado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
    rejeitado: { label: "Rejeitado", cor: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100" },
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < 4) next.add(id);
    setSelected(next);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Cenários de negociação</CardTitle>
            <CardDescription>{cenariosQuery.data?.length ?? 0} cenário(s) — selecione 2 ou mais para comparar</CardDescription>
          </div>
          <div className="flex gap-2">
            {selected.size >= 2 && (
              <Button variant="outline" onClick={() => setCompareOpen(true)} data-testid="button-comparar-cenarios">
                Comparar ({selected.size})
              </Button>
            )}
            <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-novo-cenario"><Plus className="h-4 w-4 mr-2" />Novo cenário</Button>
              </DialogTrigger>
              <NovoCenarioDialog processId={processId} onClose={() => setNovoOpen(false)} onCreated={(id) => navigate(`/recovery/scenarios/${id}`)} />
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {cenariosQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (cenariosQuery.data?.length ?? 0) === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="empty-cenarios">
            <Calculator className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Nenhum cenário criado ainda.</p>
            <p className="text-sm">Crie um cenário para simular CET, parcelas e impacto no fluxo de caixa.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Cenário</TableHead>
                <TableHead className="text-right">Dívida</TableHead>
                <TableHead className="text-right">Proposto</TableHead>
                <TableHead className="text-right">Parcelas</TableHead>
                <TableHead className="text-right">CET a.m.</TableHead>
                <TableHead className="text-right">Viabilidade</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cenariosQuery.data!.map((c) => (
                <TableRow key={c.id} data-testid={`row-cenario-${c.id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/recovery/scenarios/${c.id}`)}>
                  <TableCell onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => {}} data-testid={`check-cenario-${c.id}`} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{c.nome}</div>
                    {c.descricao && <div className="text-xs text-muted-foreground line-clamp-1">{c.descricao}</div>}
                  </TableCell>
                  <TableCell className="text-right">{formatBRL(c.valorTotalDivida)}</TableCell>
                  <TableCell className="text-right">{formatBRL(c.valorTotalProposto)}</TableCell>
                  <TableCell className="text-right">{c.numParcelas}x</TableCell>
                  <TableCell className="text-right font-medium">
                    {c.cetMensal != null ? `${(Number(c.cetMensal) * 100).toFixed(4)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.viabilityScore != null ? `${(Number(c.viabilityScore) * 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS_CENARIO_MINI[c.status]?.cor}>
                      {STATUS_CENARIO_MINI[c.status]?.label ?? c.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
          <ComparePanelDialog ids={Array.from(selected)} onClose={() => setCompareOpen(false)} />
        </Dialog>
      </CardContent>
    </Card>
  );
}

function NovoCenarioDialog({ processId, onClose, onCreated }: { processId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipoCenario, setTipoCenario] = useState("parcelamento");
  const [valorTotalDivida, setValorTotalDivida] = useState("");
  const [valorTotalProposto, setValorTotalProposto] = useState("");
  const [numParcelas, setNumParcelas] = useState("12");
  const [primeiraParcelaData, setPrimeiraParcelaData] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        nome: nome.trim(), descricao: descricao.trim() || undefined, tipoCenario,
        valorTotalDivida: Number(valorTotalDivida || 0),
        valorTotalProposto: Number(valorTotalProposto || 0),
        numParcelas: Number(numParcelas || 1),
        intervaloDias: 30, carenciaMeses: 0,
        primeiraParcelaData: primeiraParcelaData || undefined,
      };
      return (await apiRequest("POST", `/api/recovery/processes/${processId}/scenarios`, body)).json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "scenarios"] });
      toast({ title: "Cenário criado" });
      onClose();
      onCreated(data.id);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <DialogContent data-testid="dialog-novo-cenario">
      <DialogHeader>
        <DialogTitle>Novo cenário</DialogTitle>
        <DialogDescription>Crie e ajuste depois no simulador CET.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Nome *</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Parcelamento 78x Santander" data-testid="input-cenario-nome" />
        </div>
        <div>
          <Label>Descrição</Label>
          <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} data-testid="input-cenario-descricao" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <Select value={tipoCenario} onValueChange={setTipoCenario}>
              <SelectTrigger data-testid="select-cenario-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="parcelamento">Parcelamento</SelectItem>
                <SelectItem value="desconto_a_vista">Desconto à vista</SelectItem>
                <SelectItem value="entrada_reduzida">Entrada reduzida</SelectItem>
                <SelectItem value="hibrido">Híbrido</SelectItem>
                <SelectItem value="conversao_cotas">Conversão em cotas</SelectItem>
                <SelectItem value="cessao_ativos">Cessão de ativos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nº parcelas</Label>
            <Input type="number" min="1" value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} data-testid="input-cenario-parcelas" />
          </div>
          <div>
            <Label>Valor total dívida *</Label>
            <Input type="number" step="0.01" value={valorTotalDivida} onChange={(e) => setValorTotalDivida(e.target.value)} data-testid="input-cenario-divida" />
          </div>
          <div>
            <Label>Valor total proposto</Label>
            <Input type="number" step="0.01" value={valorTotalProposto} onChange={(e) => setValorTotalProposto(e.target.value)} data-testid="input-cenario-proposto" />
          </div>
          <div className="col-span-2">
            <Label>1ª parcela</Label>
            <Input type="date" value={primeiraParcelaData} onChange={(e) => setPrimeiraParcelaData(e.target.value)} data-testid="input-cenario-primeira" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => create.mutate()} disabled={!nome.trim() || !valorTotalDivida || create.isPending} data-testid="button-criar-cenario">
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar e abrir
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ComparePanelDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const cmp = useQuery<{ scenarios: RecoveryScenario[]; winner: string | null }>({
    queryKey: ["/api/recovery/scenarios/compare", ids.join(",")],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/scenarios/compare?ids=${ids.join(",")}`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao comparar");
      return r.json();
    },
    enabled: ids.length >= 2,
  });

  return (
    <DialogContent className="max-w-5xl" data-testid="dialog-compare">
      <DialogHeader>
        <DialogTitle>Comparativo de cenários</DialogTitle>
        <DialogDescription>Ordenado por viabilidade (maior primeiro). Vencedor destacado.</DialogDescription>
      </DialogHeader>
      {cmp.isLoading ? <Skeleton className="h-40 w-full" /> : !cmp.data ? <p>Sem dados.</p> : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cmp.data.scenarios.length}, minmax(0, 1fr))` }}>
          {cmp.data.scenarios.map((s) => {
            const winner = s.id === cmp.data!.winner;
            return (
              <div key={s.id} className={`border rounded-md p-3 space-y-2 ${winner ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30" : ""}`} data-testid={`compare-${s.id}`}>
                {winner && <Badge className="bg-emerald-500 text-white">Recomendado</Badge>}
                <div className="font-semibold">{s.nome}</div>
                <div className="text-xs text-muted-foreground">{s.tipoCenario}</div>
                <div className="text-sm space-y-1 pt-2 border-t">
                  <div className="flex justify-between"><span>Dívida</span><strong>{formatBRL(s.valorTotalDivida)}</strong></div>
                  <div className="flex justify-between"><span>Proposto</span><strong>{formatBRL(s.valorTotalProposto)}</strong></div>
                  <div className="flex justify-between"><span>Parcelas</span><strong>{s.numParcelas}x</strong></div>
                  <div className="flex justify-between"><span>CET a.m.</span><strong>{s.cetMensal != null ? `${(Number(s.cetMensal) * 100).toFixed(4)}%` : "—"}</strong></div>
                  <div className="flex justify-between"><span>CET a.a.</span><strong>{s.cetAnual != null ? `${(Number(s.cetAnual) * 100).toFixed(2)}%` : "—"}</strong></div>
                  <div className="flex justify-between"><span>Total nominal</span><strong>{formatBRL(s.totalPagoNominal)}</strong></div>
                  <div className="flex justify-between"><span>Viabilidade</span><strong>{s.viabilityScore != null ? `${(Number(s.viabilityScore) * 100).toFixed(0)}%` : "—"}</strong></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-fechar-compare">Fechar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 3 — ParcelasTab + ReleaseInstallmentDialog
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_PARCELA: Record<string, { label: string; cor: string; icon: any }> = {
  pendente: { label: "Pendente", cor: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100", icon: Circle },
  agendado: { label: "Agendada", cor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100", icon: CalendarClock },
  pago: { label: "Paga", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100", icon: CheckCircle },
  atrasado: { label: "Atrasada", cor: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100", icon: AlertCircle },
  renegociado: { label: "Renegociada", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100", icon: Clock },
  cancelado: { label: "Cancelada", cor: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200", icon: XCircle },
};

interface Installment {
  id: string;
  numero: number;
  dueDate: string;
  valor: string;
  status: string;
  paidAmount: string | null;
  paidDate: string | null;
  paymentMethod: string | null;
  controlApId: string | null;
  isReleasedToControl: boolean;
  creditorId: string;
  scenarioId: string;
}

function ParcelasTab({ processId, clientePessoaId }: { processId: string; clientePessoaId: string | null }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creditorFilter, setCreditorFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: "500" });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (creditorFilter !== "all") params.set("creditorId", creditorFilter);

  const { data, isLoading } = useQuery<{ items: Installment[]; total: number }>({
    queryKey: ["/api/recovery/processes", processId, "installments", statusFilter, creditorFilter],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/processes/${processId}/installments?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao carregar parcelas");
      return res.json();
    },
  });

  const { data: credoresData } = useQuery<any[]>({
    queryKey: ["/api/recovery/processes", processId, "creditors"],
    queryFn: async () => {
      const res = await fetch(`/api/recovery/processes/${processId}/creditors`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.items || []);
    },
  });

  const items = data?.items ?? [];
  const credoresMap = new Map((credoresData ?? []).map((c: any) => [c.id, c.credorNome || c.nome || "—"]));
  const creditorsList = (credoresData ?? []).map((c: any) => ({ id: c.id, nome: c.credorNome || c.nome || "—" }));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleSelectAll() {
    const eligible = items.filter((i) => !i.isReleasedToControl && i.status !== "cancelado").map((i) => i.id);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible));
  }

  const batchRelease = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/recovery/processes/${processId}/installments/batch-release`, {
        installmentIds: Array.from(selected),
      });
      return await res.json();
    },
    onSuccess: (r: { releasedCount: number; failedCount: number }) => {
      toast({
        title: `${r.releasedCount ?? 0} liberada(s)`,
        description: (r.failedCount ?? 0) > 0
          ? `${r.failedCount} falharam (caixa insuficiente ou outro motivo)`
          : undefined,
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "installments"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message || "Falha ao liberar lote", variant: "destructive" }),
  });

  const markPaid = useMutation({
    mutationFn: async ({ id, paidAmount, paymentMethod }: { id: string; paidAmount: number; paymentMethod: string }) => {
      return await apiRequest("POST", `/api/recovery/installments/${id}/mark-paid`, { paidAmount, paymentMethod });
    },
    onSuccess: () => {
      toast({ title: "Parcela marcada como paga" });
      setMarkingPaidId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "installments"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const eligibleSelectableCount = items.filter((i) => !i.isReleasedToControl && i.status !== "cancelado").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Parcelas do acordo</CardTitle>
          <CardDescription>Gerencie liberação para o Control e baixa de pagamentos</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_PARCELA).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={creditorFilter} onValueChange={setCreditorFilter}>
            <SelectTrigger className="w-48 h-9" data-testid="select-filter-creditor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos credores</SelectItem>
              {creditorsList.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={selected.size === 0 || batchRelease.isPending}
            onClick={() => batchRelease.mutate()}
            data-testid="button-batch-release"
          >
            {batchRelease.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Liberar selecionadas ({selected.size})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <Banknote className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>Nenhuma parcela. Homologue um cenário aprovado para gerar parcelas.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === eligibleSelectableCount}
                    onChange={toggleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead>#</TableHead>
                <TableHead>Credor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Control</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => {
                const stMeta = STATUS_PARCELA[p.status] || { label: p.status, cor: "bg-slate-100 text-slate-800", icon: Circle };
                const StIcon = stMeta.icon;
                const canSelect = !p.isReleasedToControl && p.status !== "cancelado" && p.status !== "pago";
                return (
                  <TableRow key={p.id} data-testid={`row-installment-${p.id}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        disabled={!canSelect}
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        data-testid={`checkbox-installment-${p.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.numero}</TableCell>
                    <TableCell className="text-sm">{credoresMap.get(p.creditorId) || "—"}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.dueDate)}</TableCell>
                    <TableCell className="text-right font-medium" data-testid={`text-valor-${p.id}`}>{formatBRL(p.valor)}</TableCell>
                    <TableCell>
                      <Badge className={stMeta.cor + " gap-1"} data-testid={`badge-status-${p.id}`}>
                        <StIcon className="h-3 w-3" />
                        {stMeta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.isReleasedToControl ? (
                        <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" /> AP {p.controlApId?.slice(0, 8)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!p.isReleasedToControl && p.status !== "cancelado" && p.status !== "pago" && (
                          <Button size="sm" variant="outline" onClick={() => setReleasingId(p.id)} data-testid={`button-release-${p.id}`}>
                            <Send className="h-3.5 w-3.5 mr-1" /> Liberar
                          </Button>
                        )}
                        {p.status !== "pago" && p.status !== "cancelado" && (
                          <Button size="sm" variant="outline" onClick={() => setMarkingPaidId(p.id)} data-testid={`button-mark-paid-${p.id}`}>
                            <CheckCircle className="h-3.5 w-3.5 mr-1" /> Pagar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {releasingId && (
        <ReleaseInstallmentDialog
          installment={items.find((i) => i.id === releasingId)!}
          clientePessoaId={clientePessoaId}
          processId={processId}
          onClose={() => setReleasingId(null)}
        />
      )}

      {markingPaidId && (() => {
        const inst = items.find((i) => i.id === markingPaidId)!;
        return <MarkPaidDialog installment={inst} onClose={() => setMarkingPaidId(null)} onConfirm={(amount, method) => markPaid.mutate({ id: inst.id, paidAmount: amount, paymentMethod: method })} loading={markPaid.isPending} />;
      })()}
    </Card>
  );
}

function MarkPaidDialog({ installment, onClose, onConfirm, loading }: { installment: Installment; onClose: () => void; onConfirm: (amount: number, method: string) => void; loading: boolean }) {
  const [amount, setAmount] = useState<string>(installment.valor);
  const [method, setMethod] = useState<string>("PIX");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar parcela como paga</DialogTitle>
          <DialogDescription>Parcela #{installment.numero} — vencimento {formatDate(installment.dueDate)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Valor pago (R$)</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-paid-amount" />
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PIX">PIX</SelectItem>
                <SelectItem value="Boleto">Boleto</SelectItem>
                <SelectItem value="TED">TED</SelectItem>
                <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                <SelectItem value="Cartão">Cartão</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-mark-paid">Cancelar</Button>
          <Button disabled={loading} onClick={() => onConfirm(Number(amount), method)} data-testid="button-confirm-mark-paid">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseInstallmentDialog({ installment, clientePessoaId, processId, onClose }: { installment: Installment; clientePessoaId: string | null; processId: string; onClose: () => void }) {
  const { toast } = useToast();
  // Resolve clienteControlId via pessoa
  const { data: pessoa } = useQuery<any>({
    queryKey: ["/api/pessoas", clientePessoaId],
    queryFn: async () => {
      if (!clientePessoaId) return null;
      const res = await fetch(`/api/pessoas/${clientePessoaId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!clientePessoaId,
  });
  const clienteControlId: string | null = pessoa?.legacyClientId ?? null;

  const monthAlvo = installment.dueDate.slice(0, 7);
  const monthsAhead = Math.max(1, Math.ceil((new Date(installment.dueDate).getTime() - Date.now()) / (30 * 86400000)) + 1);

  const { data: projection, isLoading: projLoading } = useQuery<any>({
    queryKey: ["/api/control/clientes", clienteControlId, "cash-flow-projection", monthsAhead],
    queryFn: async () => {
      if (!clienteControlId) return null;
      const res = await fetch(`/api/control/clientes/${clienteControlId}/cash-flow-projection?months=${monthsAhead}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!clienteControlId,
  });

  const monthData = projection?.series?.find((s: any) => s.month === monthAlvo);
  const valor = Number(installment.valor);
  // Alinhado ao backend (cashFlowProjection.canReleaseToControl):
  // buffer = max(0, closingBalance) * 0.15 → quando saldo já é negativo, qualquer saída adicional bloqueia.
  const buffer = Math.max(0, monthData?.closingBalance || 0) * 0.15;
  const wouldStayPositive = monthData ? (monthData.closingBalance - valor) >= buffer : true;

  const release = useMutation({
    mutationFn: async (skipGuard: boolean) => {
      return await apiRequest("POST", `/api/recovery/installments/${installment.id}/release`, { skipGuard });
    },
    onSuccess: () => {
      toast({ title: "Parcela liberada", description: "AP criada no Control." });
      onClose();
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", processId, "installments"] });
    },
    onError: (e: any) => {
      toast({ title: "Bloqueada", description: e?.message || "Caixa insuficiente. Use 'Liberar mesmo assim' se aplicável.", variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Liberar parcela #{installment.numero} para o Control</DialogTitle>
          <DialogDescription>
            Valor {formatBRL(installment.valor)} · vencimento {formatDate(installment.dueDate)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!clienteControlId && (
            <Card className="bg-amber-50 dark:bg-amber-950 border-amber-300">
              <CardContent className="p-3 text-sm text-amber-900 dark:text-amber-100">
                <AlertCircle className="inline h-4 w-4 mr-1" />
                O cliente do processo não está vinculado a um cadastro do Control. Não é possível verificar caixa.
              </CardContent>
            </Card>
          )}
          {projLoading && <Skeleton className="h-20 w-full" />}
          {monthData && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Caixa projetado em {monthAlvo}</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1" data-testid="card-projection">
                <div className="flex justify-between"><span>Saldo inicial</span><strong>{formatBRL(monthData.openingBalance)}</strong></div>
                <div className="flex justify-between text-emerald-700"><span>Entradas</span><strong>+ {formatBRL(monthData.inflows)}</strong></div>
                <div className="flex justify-between text-red-700"><span>Saídas</span><strong>− {formatBRL(monthData.outflows)}</strong></div>
                <div className="flex justify-between border-t pt-1"><span>Saldo final projetado</span><strong>{formatBRL(monthData.closingBalance)}</strong></div>
                <div className="flex justify-between text-xs text-muted-foreground pt-2"><span>Após esta parcela</span><strong>{formatBRL(monthData.closingBalance - valor)}</strong></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>Buffer mínimo (15%)</span><strong>{formatBRL(buffer)}</strong></div>
              </CardContent>
            </Card>
          )}
          {monthData && !wouldStayPositive && (
            <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 p-2 rounded">
              <AlertCircle className="inline h-4 w-4 mr-1" />
              Liberação bloqueada pelo guard de caixa. Você ainda pode forçar com justificativa.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-release">Cancelar</Button>
          <Button
            disabled={release.isPending || !clienteControlId}
            onClick={() => release.mutate(false)}
            data-testid="button-confirm-release"
          >
            {release.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Liberar
          </Button>
          {monthData && !wouldStayPositive && (
            <Button
              variant="destructive"
              disabled={release.isPending || !clienteControlId}
              onClick={() => release.mutate(true)}
              data-testid="button-force-release"
            >
              Liberar mesmo assim
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
