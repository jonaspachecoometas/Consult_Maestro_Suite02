import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInputBR, formatDateBR } from "@/components/ui/date-input-br";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, Plus, CheckCircle2, Clock, AlertTriangle, DollarSign,
  Banknote, ListTree, Building, FileSpreadsheet, Trash2, CheckSquare,
  BookOpen, Building2, Plug, Upload, Calculator, Activity, Lock, FileText, Repeat, BarChart3,
  TrendingUp, CalendarDays, Clock as ClockIcon,
  Wallet, Users, Calendar as CalendarIcon, Wand2,
} from "lucide-react";
import PlanoContasTab from "./control/ControlTabs/PlanoContasTab";
import GruposTab from "./control/ControlTabs/GruposTab";
import ConectoresTab from "./control/ControlTabs/ConectoresTab";
import ImportTab from "./control/ControlTabs/ImportTab";
import PainelFiscalTab from "./control/ControlTabs/PainelFiscalTab";
import FleurietTab from "./control/ControlTabs/FleurietTab";
import FechamentoTab from "./control/ControlTabs/FechamentoTab";
import NfeMonitorTab from "./control/ControlTabs/NfeMonitorTab";
import { ImportLancamentosDialog } from "./control/ImportLancamentosDialog";
import { EditLancamentoDialog } from "./control/EditLancamentoDialog";
import { ConciliarLancamentoDialog } from "./control/ConciliarLancamentoDialog";
import { ExtratoDialog } from "./control/ExtratoDialog";
import { ParcelarLancamentoDialog } from "./control/ParcelarLancamentoDialog";
import { TransferenciaDialog } from "./control/TransferenciaDialog";
import { SaldoInicialDialog } from "./control/SaldoInicialDialog";

interface Cliente { id: string; nome: string; cnpj?: string; }
interface Lancamento {
  id: string; tipo: "pagar" | "receber"; descricao: string; favorecido?: string; valor: string;
  dataVencimento: string; dataPagamento?: string; status: string; planoContaId?: string;
  centroCustoId?: string; contaBancariaId?: string; criadoPorIa?: boolean;
  // Sprint C7
  statusCalc?: string;
  numeroParcela?: number | null;
  totalParcelas?: number | null;
  origemRecorrencia?: boolean;
}
interface Overview {
  aPagarVencidos: number; aPagar7d: number; aPagar30d: number;
  aReceberVencidos: number; aReceber7d: number; aReceber30d: number;
  pagoMes: number; recebidoMes: number; pendentesAprovacao: number;
  totalLancamentos: number; saldoBancarioTotal: number; totalContasBancarias: number;
}
interface PlanoConta { id: string; codigo: string; descricao: string; permiteLancamento: boolean; nivel: number; }
interface CentroCusto { id: string; codigo: string; nome: string; ativo: boolean; }
interface ContaBancaria { id: string; banco: string; agencia?: string; conta?: string; tipo: string; saldoInicial: string; saldoAtual: string; ativo: boolean; }

const formatBRL = (v: number | string) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
};

const lancamentoFormSchema = z.object({
  tipo: z.enum(["pagar", "receber"]),
  descricao: z.string().min(1, "Obrigatório"),
  favorecido: z.string().optional(),
  documento: z.string().optional(),
  valor: z.string().min(1, "Obrigatório"),
  dataEmissao: z.string().optional(),
  dataVencimento: z.string().min(1, "Obrigatório"),
  status: z.enum(["previsto", "aprovado", "pago"]).default("previsto"),
  planoContaId: z.string().optional(),
  centroCustoId: z.string().optional(),
  contaBancariaId: z.string().min(1, "Conta bancária é obrigatória"),
  observacoes: z.string().optional(),
});

const statusBadge: Record<string, { label: string; variant: any; icon: any; className?: string }> = {
  previsto: { label: "Previsto", variant: "secondary", icon: Clock },
  aprovado: { label: "Aprovado", variant: "default", icon: CheckCircle2 },
  pago: { label: "Pago", variant: "outline", icon: CheckCircle2, className: "border-emerald-500 text-emerald-700 dark:text-emerald-400" },
  vencido: { label: "Vencido", variant: "destructive", icon: AlertTriangle },
  cancelado: { label: "Cancelado", variant: "outline", icon: Clock, className: "text-muted-foreground" },
  inadimplente: { label: "Inadimplente", variant: "destructive", icon: AlertTriangle },
  // Sprint C7 — G6 status calculados virtuais
  em_dia: { label: "Em dia", variant: "outline", icon: Clock, className: "border-blue-500 text-blue-700 dark:text-blue-400" },
  vence_hoje: { label: "Vence em breve", variant: "outline", icon: AlertTriangle, className: "border-amber-500 text-amber-700 dark:text-amber-400" },
  atrasado: { label: "Vencido", variant: "destructive", icon: AlertTriangle },
};

export default function ControlDetalhe() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const { toast } = useToast();
  const [tab, setTab] = useState("dashboard");
  const [openLanc, setOpenLanc] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroCampoData, setFiltroCampoData] = useState<"vencimento" | "emissao" | "pagamento">("vencimento");
  const [filtroDataIni, setFiltroDataIni] = useState<string>("");
  const [filtroDataFim, setFiltroDataFim] = useState<string>("");
  const [filtroBusca, setFiltroBusca] = useState<string>("");

  const { data: clientes = [] } = useQuery<Cliente[]>({ queryKey: ["/api/clients"] });
  const cliente = clientes.find((c) => c.id === clienteId);

  const { data: overview, isLoading: loadingOv } = useQuery<Overview>({
    queryKey: ["/api/control/clientes", clienteId, "overview"],
    enabled: !!clienteId,
  });
  const { data: lancamentos = [], isLoading: loadingLanc } = useQuery<Lancamento[]>({
    queryKey: ["/api/control/clientes", clienteId, "lancamentos", filtroTipo, filtroStatus, filtroCampoData, filtroDataIni, filtroDataFim, filtroBusca],
    enabled: !!clienteId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filtroTipo !== "todos") params.set("tipo", filtroTipo);
      if (filtroStatus !== "todos") params.set("status", filtroStatus);
      if (filtroDataIni) params.set("dataIni", filtroDataIni);
      if (filtroDataFim) params.set("dataFim", filtroDataFim);
      if (filtroCampoData) params.set("campoData", filtroCampoData);
      if (filtroBusca.trim()) params.set("q", filtroBusca.trim());
      const r = await fetch(`/api/control/clientes/${clienteId}/lancamentos?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar lançamentos");
      return r.json();
    },
  });

  // Totais consultados (do resultado da query atual)
  const totaisConsulta = (() => {
    let aPagar = 0, aReceber = 0;
    for (const l of lancamentos) {
      const v = parseFloat(l.valor) || 0;
      if (l.tipo === "pagar") aPagar += v; else aReceber += v;
    }
    return { aPagar, aReceber, saldo: aReceber - aPagar, qtd: lancamentos.length };
  })();

  const limparFiltros = () => {
    setFiltroTipo("todos");
    setFiltroStatus("todos");
    setFiltroCampoData("vencimento");
    setFiltroDataIni("");
    setFiltroDataFim("");
    setFiltroBusca("");
  };
  const { data: planosContas = [] } = useQuery<PlanoConta[]>({ queryKey: ["/api/control/planos-contas"] });
  const { data: centros = [] } = useQuery<CentroCusto[]>({
    queryKey: ["/api/control/clientes", clienteId, "centros-custo"], enabled: !!clienteId,
  });
  const { data: contas = [] } = useQuery<ContaBancaria[]>({
    queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"], enabled: !!clienteId,
  });
  const { data: relatorio } = useQuery<any>({
    queryKey: ["/api/control/clientes", clienteId, "relatorio-pagamentos"],
    enabled: !!clienteId && tab === "relatorio",
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId] });
  };

  // ───── Form lançamento
  const form = useForm<z.infer<typeof lancamentoFormSchema>>({
    resolver: zodResolver(lancamentoFormSchema),
    defaultValues: {
      tipo: "pagar", descricao: "", favorecido: "", documento: "", valor: "",
      dataEmissao: "", dataVencimento: new Date().toISOString().slice(0, 10),
      status: "previsto", observacoes: "",
    },
  });
  const createLanc = useMutation({
    mutationFn: async (vals: any) => apiRequest("POST", `/api/control/clientes/${clienteId}/lancamentos`, vals),
    onSuccess: () => {
      toast({ title: "Lançamento criado" });
      setOpenLanc(false);
      form.reset();
      invalidateAll();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
  const aprovarLanc = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/control/lancamentos/${id}/aprovar`),
    onSuccess: () => { toast({ title: "Aprovado" }); invalidateAll(); },
  });
  const pagarLanc = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/control/lancamentos/${id}/pagar`),
    onSuccess: () => { toast({ title: "Pagamento registrado" }); invalidateAll(); },
  });
  const deleteLanc = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/control/lancamentos/${id}`),
    onSuccess: () => { toast({ title: "Excluído" }); invalidateAll(); },
  });

  if (!cliente) {
    return (
      <div className="container mx-auto p-6">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-control-detalhe">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/control">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1" /> Workspaces
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="text-cliente-nome">{cliente.nome}</h1>
          {cliente.cnpj && <p className="text-sm text-muted-foreground">CNPJ {cliente.cnpj}</p>}
        </div>
        <Link href={`/control/${clienteId}/centros-custo`}>
          <Button variant="outline" size="sm" data-testid="button-control-centros-custo">
            <Building className="h-4 w-4 mr-1" /> Centros de Custo
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/recorrencias`}>
          <Button variant="outline" size="sm" data-testid="button-control-recorrencias">
            <Repeat className="h-4 w-4 mr-1" /> Recorrências
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/orcamento`}>
          <Button variant="outline" size="sm" data-testid="button-control-orcamento">
            <BarChart3 className="h-4 w-4 mr-1" /> Orçamento
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/fluxo-caixa-mensal`}>
          <Button variant="outline" size="sm" data-testid="button-control-fc-mensal">
            <TrendingUp className="h-4 w-4 mr-1" /> FC Mensal
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/fluxo-caixa-diario`}>
          <Button variant="outline" size="sm" data-testid="button-control-fc-diario">
            <CalendarDays className="h-4 w-4 mr-1" /> FC Diário
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/dre`}>
          <Button variant="outline" size="sm" data-testid="button-control-dre">
            <BarChart3 className="h-4 w-4 mr-1" /> DRE
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/pivot`}>
          <Button variant="outline" size="sm" data-testid="button-control-pivot">
            <Users className="h-4 w-4 mr-1" /> Pivot
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/carteiras`}>
          <Button variant="outline" size="sm" data-testid="button-control-carteiras">
            <Wallet className="h-4 w-4 mr-1" /> Carteiras
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/calendario`}>
          <Button variant="outline" size="sm" data-testid="button-control-calendario">
            <CalendarIcon className="h-4 w-4 mr-1" /> Calendário
          </Button>
        </Link>
        <Link href={`/control/${clienteId}/setup`}>
          <Button variant="outline" size="sm" data-testid="button-control-setup">
            <Wand2 className="h-4 w-4 mr-1" /> Setup
          </Button>
        </Link>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard"><DollarSign className="h-4 w-4 mr-1" />Dashboard</TabsTrigger>
          <TabsTrigger value="lancamentos" data-testid="tab-lancamentos"><ListTree className="h-4 w-4 mr-1" />Lançamentos</TabsTrigger>
          <TabsTrigger value="contas" data-testid="tab-contas"><Banknote className="h-4 w-4 mr-1" />Contas Bancárias</TabsTrigger>
          <TabsTrigger value="centros" data-testid="tab-centros"><Building className="h-4 w-4 mr-1" />Centros de Custo</TabsTrigger>
          <TabsTrigger value="relatorio" data-testid="tab-relatorio"><FileSpreadsheet className="h-4 w-4 mr-1" />Relatório</TabsTrigger>
          <TabsTrigger value="plano-contas" data-testid="tab-plano-contas"><BookOpen className="h-4 w-4 mr-1" />Plano de Contas</TabsTrigger>
          <TabsTrigger value="grupos" data-testid="tab-grupos"><Building2 className="h-4 w-4 mr-1" />Grupos</TabsTrigger>
          <TabsTrigger value="conectores" data-testid="tab-conectores"><Plug className="h-4 w-4 mr-1" />Conectores</TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-import"><Upload className="h-4 w-4 mr-1" />Import</TabsTrigger>
          <TabsTrigger value="painel-fiscal" data-testid="tab-painel-fiscal"><Calculator className="h-4 w-4 mr-1" />Painel Fiscal</TabsTrigger>
          <TabsTrigger value="fleuriet" data-testid="tab-fleuriet"><Activity className="h-4 w-4 mr-1" />Fleuriet</TabsTrigger>
          <TabsTrigger value="fechamento" data-testid="tab-fechamento"><Lock className="h-4 w-4 mr-1" />Fechamento</TabsTrigger>
          <TabsTrigger value="nfe-monitor" data-testid="tab-nfe-monitor"><FileText className="h-4 w-4 mr-1" />NF-e</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-4">
          {loadingOv ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card data-testid="card-pagar-vencidos">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <AlertTriangle className="h-3 w-3 text-destructive" /> A pagar vencidos
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold text-destructive">{formatBRL(overview?.aPagarVencidos || 0)}</div>
                  </CardContent>
                </Card>
                <Card data-testid="card-pagar-7d">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <ArrowDownCircle className="h-3 w-3 text-orange-500" /> A pagar 7 dias
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{formatBRL(overview?.aPagar7d || 0)}</div>
                  </CardContent>
                </Card>
                <Card data-testid="card-receber-vencidos">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <AlertTriangle className="h-3 w-3 text-amber-500" /> A receber vencidos
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400">{formatBRL(overview?.aReceberVencidos || 0)}</div>
                  </CardContent>
                </Card>
                <Card data-testid="card-receber-7d">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <ArrowUpCircle className="h-3 w-3 text-emerald-500" /> A receber 7 dias
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{formatBRL(overview?.aReceber7d || 0)}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card data-testid="card-pago-mes">
                  <CardHeader className="pb-2"><CardDescription className="text-xs">Pago no mês</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-medium">{formatBRL(overview?.pagoMes || 0)}</div></CardContent>
                </Card>
                <Card data-testid="card-recebido-mes">
                  <CardHeader className="pb-2"><CardDescription className="text-xs">Recebido no mês</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-medium">{formatBRL(overview?.recebidoMes || 0)}</div></CardContent>
                </Card>
                <Card data-testid="card-saldo-bancario">
                  <CardHeader className="pb-2"><CardDescription className="text-xs">Saldo bancário ({overview?.totalContasBancarias || 0} contas)</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-medium">{formatBRL(overview?.saldoBancarioTotal || 0)}</div></CardContent>
                </Card>
                <Card data-testid="card-pendentes">
                  <CardHeader className="pb-2"><CardDescription className="text-xs">Pendentes de aprovação</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-medium">{overview?.pendentesAprovacao || 0}</div></CardContent>
                </Card>
              </div>

              <PmpPmrCards clienteId={clienteId} />
            </>
          )}
        </TabsContent>

        {/* LANÇAMENTOS */}
        <TabsContent value="lancamentos" className="space-y-4">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tipo</span>
              <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                <SelectTrigger className="w-36" data-testid="select-filtro-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pagar">A pagar</SelectItem>
                  <SelectItem value="receber">A receber</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Status</span>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="w-36" data-testid="select-filtro-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="previsto">Previsto</SelectItem>
                  <SelectItem value="aprovado">Aprovado</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Período por</span>
              <Select value={filtroCampoData} onValueChange={(v) => setFiltroCampoData(v as "vencimento" | "emissao" | "pagamento")}>
                <SelectTrigger className="w-36" data-testid="select-filtro-campo-data"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vencimento">Vencimento</SelectItem>
                  <SelectItem value="emissao">Emissão</SelectItem>
                  <SelectItem value="pagamento">Pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">De</span>
              <DateInputBR value={filtroDataIni} onChange={(v) => setFiltroDataIni(v)}
                className="w-40" data-testid="input-filtro-data-ini" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Até</span>
              <DateInputBR value={filtroDataFim} onChange={(v) => setFiltroDataFim(v)}
                className="w-40" data-testid="input-filtro-data-fim" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <span className="text-xs text-muted-foreground">Buscar</span>
              <Input placeholder="Descrição, favorecido ou documento..."
                value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)}
                data-testid="input-filtro-busca" />
            </div>
            <Button variant="outline" size="sm" onClick={limparFiltros} data-testid="button-limpar-filtros">Limpar</Button>
            <div className="ml-auto flex gap-2">
              <ImportLancamentosDialog clienteId={clienteId!} />
              <ParcelarLancamentoDialog clienteId={clienteId!} />
              <Dialog open={openLanc} onOpenChange={setOpenLanc}>
                <DialogTrigger asChild>
                  <Button data-testid="button-novo-lancamento"><Plus className="h-4 w-4 mr-1" />Novo Lançamento</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit((v) => createLanc.mutate(v))} className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={form.control} name="tipo" render={({ field }) => (
                          <FormItem><FormLabel>Tipo</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-tipo"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="pagar">A pagar</SelectItem>
                                <SelectItem value="receber">A receber</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="status" render={({ field }) => (
                          <FormItem><FormLabel>Status inicial</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="previsto">Previsto</SelectItem>
                                <SelectItem value="aprovado">Aprovado</SelectItem>
                                <SelectItem value="pago">Pago</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage /></FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="descricao" render={({ field }) => (
                        <FormItem><FormLabel>Descrição</FormLabel>
                          <FormControl><Input {...field} data-testid="input-descricao" /></FormControl>
                          <FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-3 gap-3">
                        <FormField control={form.control} name="favorecido" render={({ field }) => (
                          <FormItem><FormLabel>Favorecido / Pagador</FormLabel>
                            <FormControl><Input {...field} data-testid="input-favorecido" /></FormControl>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="documento" render={({ field }) => (
                          <FormItem><FormLabel>Documento</FormLabel>
                            <FormControl><Input {...field} placeholder="NF, boleto..." data-testid="input-documento" /></FormControl>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="valor" render={({ field }) => (
                          <FormItem><FormLabel>Valor (R$)</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} data-testid="input-valor" /></FormControl>
                            <FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={form.control} name="dataEmissao" render={({ field }) => (
                          <FormItem><FormLabel>Emissão</FormLabel>
                            <FormControl>
                              <DateInputBR
                                value={field.value ?? ""}
                                onChange={(v) => field.onChange(v)}
                                data-testid="input-data-emissao"
                              />
                            </FormControl>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="dataVencimento" render={({ field }) => (
                          <FormItem><FormLabel>Vencimento *</FormLabel>
                            <FormControl>
                              <DateInputBR
                                value={field.value ?? ""}
                                onChange={(v) => field.onChange(v)}
                                data-testid="input-data-vencimento"
                              />
                            </FormControl>
                            <FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <FormField control={form.control} name="planoContaId" render={({ field }) => (
                          <FormItem><FormLabel>Plano de Conta</FormLabel>
                            <Select value={field.value || ""} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-plano-conta"><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                              <SelectContent className="max-h-60">
                                {planosContas.filter((p) => p.permiteLancamento).map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="centroCustoId" render={({ field }) => (
                          <FormItem><FormLabel>Centro de Custo</FormLabel>
                            <Select value={field.value || ""} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger data-testid="select-centro-custo"><SelectValue placeholder="(opcional)" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {centros.map((c) => (<SelectItem key={c.id} value={c.id}>{c.codigo} - {c.nome}</SelectItem>))}
                              </SelectContent>
                            </Select>
                            <FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="contaBancariaId" render={({ field }) => {
                          const contasAtivas = contas.filter((c) => c.ativo);
                          const semContas = contasAtivas.length === 0;
                          return (
                            <FormItem><FormLabel>Conta Bancária *</FormLabel>
                              <Select value={field.value || ""} onValueChange={field.onChange} disabled={semContas}>
                                <FormControl><SelectTrigger data-testid="select-conta-bancaria"><SelectValue placeholder={semContas ? "Cadastre uma conta na aba Contas Bancárias" : "Selecione..."} /></SelectTrigger></FormControl>
                                <SelectContent>
                                  {contasAtivas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.banco} {c.conta || ""}</SelectItem>))}
                                </SelectContent>
                              </Select>
                              {semContas && <p className="text-xs text-destructive mt-1">Sem contas ativas — cadastre uma na aba Contas Bancárias antes de lançar.</p>}
                              <FormMessage />
                            </FormItem>
                          );
                        }} />
                      </div>
                      <FormField control={form.control} name="observacoes" render={({ field }) => (
                        <FormItem><FormLabel>Observações</FormLabel>
                          <FormControl><Textarea {...field} rows={2} data-testid="input-observacoes" /></FormControl>
                          <FormMessage /></FormItem>
                      )} />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpenLanc(false)}>Cancelar</Button>
                        <Button type="submit" disabled={createLanc.isPending} data-testid="button-salvar-lancamento">
                          {createLanc.isPending ? "Salvando..." : "Salvar"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingLanc ? (
                <div className="p-6 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : lancamentos.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  Nenhum lançamento. Use "Novo Lançamento" para começar.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lancamentos.map((l) => {
                      // Sprint C7 — G6: prioriza status calculado virtual sobre o persistido
                      const effectiveStatus = l.statusCalc || l.status;
                      const sb = statusBadge[effectiveStatus] || statusBadge.previsto;
                      const Icon = sb.icon;
                      return (
                        <TableRow key={l.id} data-testid={`row-lanc-${l.id}`}>
                          <TableCell className="text-sm whitespace-nowrap">{formatDateBR(l.dataVencimento)}</TableCell>
                          <TableCell>
                            {l.tipo === "pagar"
                              ? <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 text-sm"><ArrowDownCircle className="h-3 w-3" />Pagar</span>
                              : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm"><ArrowUpCircle className="h-3 w-3" />Receber</span>}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{l.descricao}</div>
                            {l.favorecido && <div className="text-xs text-muted-foreground">{l.favorecido}</div>}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {l.criadoPorIa && <Badge variant="outline" className="text-xs">IA</Badge>}
                              {l.numeroParcela && l.totalParcelas && (
                                <Badge variant="outline" className="text-xs" data-testid={`badge-parcela-${l.id}`}>
                                  Parcela {l.numeroParcela}/{l.totalParcelas}
                                </Badge>
                              )}
                              {l.origemRecorrencia && (
                                <Badge variant="outline" className="text-xs gap-1" data-testid={`badge-recorrencia-${l.id}`}>
                                  <Repeat className="h-3 w-3" /> Recorrente
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatBRL(l.valor)}</TableCell>
                          <TableCell>
                            <Badge variant={sb.variant} className={`gap-1 ${sb.className ?? ""}`} data-testid={`badge-status-${l.id}`}>
                              <Icon className="h-3 w-3" />{sb.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <EditLancamentoDialog lancamento={l as any} clienteId={clienteId!} />
                              {l.status !== "cancelado" && (
                                <ConciliarLancamentoDialog lancamento={l as any} clienteId={clienteId!} />
                              )}
                              {l.status === "previsto" && (
                                <Button size="sm" variant="ghost" title="Aprovar" onClick={() => aprovarLanc.mutate(l.id)} data-testid={`button-aprovar-${l.id}`}>
                                  <CheckSquare className="h-4 w-4" />
                                </Button>
                              )}
                              {l.status !== "pago" && l.status !== "cancelado" && (
                                <Button size="sm" variant="ghost" title="Marcar como pago/recebido (rápido)" onClick={() => pagarLanc.mutate(l.id)} data-testid={`button-pagar-${l.id}`}>
                                  <DollarSign className="h-4 w-4" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" title="Excluir" onClick={() => deleteLanc.mutate(l.id)} data-testid={`button-deletar-${l.id}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {lancamentos.length > 0 && (
              <div className="border-t px-4 py-3 bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-testid="footer-totais-consulta">
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{totaisConsulta.qtd}</strong> lançamento{totaisConsulta.qtd !== 1 ? "s" : ""} consultado{totaisConsulta.qtd !== 1 ? "s" : ""}
                </span>
                <span className="text-muted-foreground">Total a pagar: <strong className="text-orange-600 dark:text-orange-400" data-testid="text-total-pagar">{formatBRL(totaisConsulta.aPagar)}</strong></span>
                <span className="text-muted-foreground">Total a receber: <strong className="text-emerald-600 dark:text-emerald-400" data-testid="text-total-receber">{formatBRL(totaisConsulta.aReceber)}</strong></span>
                <span className="ml-auto text-muted-foreground">Saldo: <strong className={totaisConsulta.saldo >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"} data-testid="text-total-saldo">{formatBRL(totaisConsulta.saldo)}</strong></span>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* CONTAS BANCÁRIAS */}
        <TabsContent value="contas">
          <ContasBancariasTab clienteId={clienteId!} contas={contas} />
        </TabsContent>

        {/* CENTROS DE CUSTO */}
        <TabsContent value="centros">
          <CentrosCustoTab clienteId={clienteId!} centros={centros} />
        </TabsContent>

        {/* RELATÓRIO */}
        <TabsContent value="relatorio" className="space-y-4">
          {!relatorio ? <Skeleton className="h-32" /> : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Card><CardHeader className="pb-2"><CardDescription>Total a pagar</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-semibold text-orange-600 dark:text-orange-400">{formatBRL(relatorio.totalPagar)}</div></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Total a receber</CardDescription></CardHeader>
                  <CardContent><div className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">{formatBRL(relatorio.totalReceber)}</div></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Saldo líquido projetado</CardDescription></CardHeader>
                  <CardContent><div className={`text-xl font-semibold ${relatorio.saldoLiquido >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{formatBRL(relatorio.saldoLiquido)}</div></CardContent></Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Próximos 7 dias — pagamentos e recebimentos</CardTitle>
                  <CardDescription>De {relatorio.dataIni} até {relatorio.dataFim}</CardDescription>
                </CardHeader>
                <CardContent>
                  {relatorio.lancamentos.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">Sem lançamentos no período.</div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Vencimento</TableHead><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Valor</TableHead><TableHead>Status</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {relatorio.lancamentos.map((l: any) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-sm">{formatDateBR(l.dataVencimento)}</TableCell>
                            <TableCell><Badge variant="outline">{l.tipo}</Badge></TableCell>
                            <TableCell className="text-sm">{l.descricao}</TableCell>
                            <TableCell className="text-right">{formatBRL(l.valor)}</TableCell>
                            <TableCell><Badge variant="secondary">{l.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* SPRINTS 4 + 5 — Tabs novas */}
        <TabsContent value="plano-contas">
          <PlanoContasTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="grupos">
          <GruposTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="conectores">
          <ConectoresTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="import">
          <ImportTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="painel-fiscal">
          <PainelFiscalTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="fleuriet">
          <FleurietTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="fechamento">
          <FechamentoTab clienteId={clienteId!} />
        </TabsContent>
        <TabsContent value="nfe-monitor">
          <NfeMonitorTab clienteId={clienteId!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────── Sub-componentes
// Sprint C7: ContasBancariasTab agora expõe TransferenciaDialog (nova) e
// SaldoInicialDialog (em cada linha).
function ContasBancariasTab({ clienteId, contas }: { clienteId: string; contas: ContaBancaria[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: { banco: "", agencia: "", conta: "", tipo: "cc", saldoInicial: "0" },
  });
  const create = useMutation({
    mutationFn: async (v: any) => apiRequest("POST", `/api/control/clientes/${clienteId}/contas-bancarias`, v),
    onSuccess: () => {
      toast({ title: "Conta criada" });
      setOpen(false); form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"] });
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "overview"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/control/contas-bancarias/${id}`),
    onSuccess: () => {
      toast({ title: "Conta removida" });
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"] });
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "overview"] });
    },
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle className="text-base">Contas Bancárias</CardTitle></div>
        <div className="flex gap-2">
        {contas.filter((c) => c.ativo).length >= 2 && (
          <TransferenciaDialog clienteId={clienteId} />
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" data-testid="button-nova-conta-bancaria"><Plus className="h-4 w-4 mr-1" />Nova</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Conta Bancária</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3">
                <FormField control={form.control} name="banco" render={({ field }) => (
                  <FormItem><FormLabel>Banco *</FormLabel><FormControl><Input {...field} required data-testid="input-banco" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="agencia" render={({ field }) => (
                    <FormItem><FormLabel>Agência</FormLabel><FormControl><Input {...field} data-testid="input-agencia" /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="conta" render={({ field }) => (
                    <FormItem><FormLabel>Conta</FormLabel><FormControl><Input {...field} data-testid="input-conta" /></FormControl></FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="tipo" render={({ field }) => (
                    <FormItem><FormLabel>Tipo</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger data-testid="select-tipo-conta"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="cc">Conta Corrente</SelectItem>
                          <SelectItem value="poupanca">Poupança</SelectItem>
                          <SelectItem value="caixa">Caixa</SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="saldoInicial" render={({ field }) => (
                    <FormItem><FormLabel>Saldo inicial (R$)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-saldo-inicial" /></FormControl></FormItem>
                  )} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending} data-testid="button-salvar-conta-bancaria">{create.isPending ? "Salvando..." : "Salvar"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {contas.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma conta bancária cadastrada.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Banco</TableHead><TableHead>Ag/Cc</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Saldo Atual</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {contas.map((c) => (
                <TableRow key={c.id} data-testid={`row-conta-${c.id}`}>
                  <TableCell className="font-medium">{c.banco}</TableCell>
                  <TableCell className="text-sm">{c.agencia || "-"} / {c.conta || "-"}</TableCell>
                  <TableCell><Badge variant="outline">{c.tipo}</Badge></TableCell>
                  <TableCell className="text-right" data-testid={`text-saldo-conta-${c.id}`}>{formatBRL(c.saldoAtual)}</TableCell>
                  <TableCell className="text-right">
                    <SaldoInicialDialog contaId={c.id} banco={c.banco} saldoAtual={(c as any).saldoInicial} clienteId={clienteId} />
                    <ExtratoDialog contaId={c.id} banco={c.banco} />
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)} data-testid={`button-remover-conta-${c.id}`}><Trash2 className="h-4 w-4" /></Button>
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

function CentrosCustoTab({ clienteId, centros }: { clienteId: string; centros: CentroCusto[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { codigo: "", nome: "", descricao: "" } });
  const create = useMutation({
    mutationFn: async (v: any) => apiRequest("POST", `/api/control/clientes/${clienteId}/centros-custo`, v),
    onSuccess: () => {
      toast({ title: "Centro de custo criado" });
      setOpen(false); form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "centros-custo"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/control/centros-custo/${id}`),
    onSuccess: () => {
      toast({ title: "Centro removido" });
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "centros-custo"] });
    },
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle className="text-base">Centros de Custo</CardTitle></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" data-testid="button-novo-centro"><Plus className="h-4 w-4 mr-1" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Centro de Custo</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <FormField control={form.control} name="codigo" render={({ field }) => (
                    <FormItem><FormLabel>Código *</FormLabel><FormControl><Input {...field} required data-testid="input-codigo-centro" /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>Nome *</FormLabel><FormControl><Input {...field} required data-testid="input-nome-centro" /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="descricao" render={({ field }) => (
                  <FormItem><FormLabel>Descrição</FormLabel><FormControl><Textarea {...field} rows={2} data-testid="input-descricao-centro" /></FormControl></FormItem>
                )} />
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending} data-testid="button-salvar-centro">{create.isPending ? "Salvando..." : "Salvar"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {centros.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Nenhum centro de custo cadastrado.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {centros.map((c) => (
                <TableRow key={c.id} data-testid={`row-centro-${c.id}`}>
                  <TableCell className="font-medium">{c.codigo}</TableCell>
                  <TableCell>{c.nome}</TableCell>
                  <TableCell>{c.ativo ? <Badge variant="outline">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ────────── Sprint C9 — G10: cards PMP/PMR no Dashboard
function PmpPmrCards({ clienteId }: { clienteId: string }) {
  const [openModal, setOpenModal] = useState(false);
  const { data } = useQuery<{ pmp: number | null; pmr: number | null; status: string; countPagar: number; countReceber: number }>({
    queryKey: ["/api/control/clientes", clienteId, "pmp-pmr"],
    enabled: !!clienteId,
  });
  const { data: hist } = useQuery<{ historico: Array<{ label: string; pmp: number | null; pmr: number | null }> }>({
    queryKey: ["/api/control/clientes", clienteId, "pmp-pmr", "historico"],
    queryFn: async () => {
      const r = await fetch(`/api/control/clientes/${clienteId}/pmp-pmr/historico?meses=6`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha");
      return r.json();
    },
    enabled: openModal,
  });

  const fmt = (v: number | null) => v === null ? "—" : `${v.toFixed(0)} dias`;
  const statusBadge = data?.status === "saudavel"
    ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Saudável</Badge>
    : data?.status === "pressao"
    ? <Badge variant="destructive">Pressão de caixa</Badge>
    : data?.status === "neutro"
    ? <Badge variant="outline">Neutro</Badge>
    : <Badge variant="outline">Sem dados</Badge>;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-pmp" className="cursor-pointer hover:bg-muted/30" onClick={() => setOpenModal(true)}>
          <CardHeader className="pb-2"><CardDescription className="text-xs flex items-center gap-1"><ClockIcon className="h-3 w-3" />PMP — Prazo Médio Pagamento</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmt(data?.pmp ?? null)}</div>
            <div className="text-xs text-muted-foreground">{data?.countPagar ?? 0} CP no mês</div>
          </CardContent>
        </Card>
        <Card data-testid="card-pmr" className="cursor-pointer hover:bg-muted/30" onClick={() => setOpenModal(true)}>
          <CardHeader className="pb-2"><CardDescription className="text-xs flex items-center gap-1"><ClockIcon className="h-3 w-3" />PMR — Prazo Médio Recebimento</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmt(data?.pmr ?? null)}</div>
            <div className="text-xs text-muted-foreground">{data?.countReceber ?? 0} CR no mês</div>
          </CardContent>
        </Card>
        <Card data-testid="card-pmp-pmr-status">
          <CardHeader className="pb-2"><CardDescription className="text-xs">Status PMP × PMR</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <div>{statusBadge}</div>
            <div className="text-xs text-muted-foreground">
              {data?.status === "saudavel" && "Recebe antes de pagar."}
              {data?.status === "pressao" && "Paga antes de receber — risco de caixa."}
              {data?.status === "neutro" && "Equilíbrio entre prazos."}
              {(!data || data.status === "indisponivel") && "Sem lançamentos com data de emissão e pagamento no período."}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>PMP × PMR — últimos 6 meses</DialogTitle></DialogHeader>
          {!hist ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="text-right">PMP</TableHead><TableHead className="text-right">PMR</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
              <TableBody>
                {hist.historico.map((h) => {
                  const delta = (h.pmp !== null && h.pmr !== null) ? h.pmp - h.pmr : null;
                  return (
                    <TableRow key={h.label} data-testid={`row-hist-${h.label}`}>
                      <TableCell className="font-medium">{h.label}</TableCell>
                      <TableCell className="text-right">{h.pmp === null ? "—" : `${h.pmp.toFixed(0)}d`}</TableCell>
                      <TableCell className="text-right">{h.pmr === null ? "—" : `${h.pmr.toFixed(0)}d`}</TableCell>
                      <TableCell className={`text-right ${delta !== null && delta > 0 ? "text-emerald-600 dark:text-emerald-400" : delta !== null && delta < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}d`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
