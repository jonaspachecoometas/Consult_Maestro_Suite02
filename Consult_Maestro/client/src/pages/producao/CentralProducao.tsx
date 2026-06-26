import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Activity, Users, Bot, Clock, TrendingUp, Plus, Play, X, Filter,
  Loader2, CheckCircle2, AlertCircle, FileText, Sparkles, Calendar as CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DemandaCentral } from "@shared/schema";

interface Kpis { projetosAtivos: number; demandasHoje: number; taxaEntregasPrazo: number; demandasAgente: number; tempoMedioResolucaoH: number; }
interface Timeline { id: string; nome: string; sprints: { id: string; nome: string; startDate: string | null; endDate: string | null; status: string }[]; }

const TIPOS = ["projeto", "modulo", "documento", "analise", "bug"] as const;
const PRIORIDADES = ["critico", "alto", "medio", "baixo"] as const;
const TASK_TYPES = ["gerar_documento", "analise_projeto", "init_module_proativo", "planejar_modulo"];

const formSchema = z.object({
  titulo: z.string().min(3, "Mínimo 3 caracteres").max(300),
  tipo: z.enum(TIPOS),
  prioridade: z.enum(PRIORIDADES),
  projetoId: z.string().optional(),
  assigneeType: z.enum(["human", "agent"]),
  agenteTask: z.string().optional(),
  descricao: z.string().optional(),
});
type FormVals = z.infer<typeof formSchema>;

const prioridadeBadge: Record<string, { label: string; cls: string }> = {
  critico: { label: "Crítico", cls: "bg-red-600 text-white" },
  alto: { label: "Alto", cls: "bg-orange-500 text-white" },
  medio: { label: "Médio", cls: "bg-yellow-500 text-black" },
  baixo: { label: "Baixo", cls: "bg-slate-400 text-white" },
};
const statusBadge: Record<string, { label: string; variant: any }> = {
  fila: { label: "Na fila", variant: "outline" },
  em_analise: { label: "Em análise", variant: "secondary" },
  em_execucao: { label: "Executando", variant: "default" },
  revisao: { label: "Revisão", variant: "secondary" },
  concluido: { label: "Concluído", variant: "secondary" },
  cancelado: { label: "Cancelado", variant: "outline" },
};

export default function CentralProducao() {
  const { toast } = useToast();
  const [filtroAssignee, setFiltroAssignee] = useState<string>("todos");
  const [filtroPrioridade, setFiltroPrioridade] = useState<string>("todas");

  const { data: kpis } = useQuery<Kpis>({ queryKey: ["/api/producao/central/kpis"], refetchInterval: 30000 });
  const { data: demandas, isLoading } = useQuery<DemandaCentral[]>({
    queryKey: ["/api/producao/central/demandas"],
    refetchInterval: 10000,
  });
  const { data: projetos } = useQuery<any[]>({ queryKey: ["/api/scrum/internal-projects"] });
  const { data: timeline } = useQuery<Timeline[]>({ queryKey: ["/api/producao/central/timeline"] });

  const form = useForm<FormVals>({
    resolver: zodResolver(formSchema),
    defaultValues: { titulo: "", tipo: "documento", prioridade: "medio", assigneeType: "human", descricao: "" },
  });
  const watchAssignee = form.watch("assigneeType");

  const criarMutation = useMutation({
    mutationFn: async (vals: FormVals) => {
      const payload: any = { ...vals };
      if (payload.assigneeType === "human") delete payload.agenteTask;
      if (!payload.projetoId) delete payload.projetoId;
      return apiRequest("POST", "/api/producao/central/demandas", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/central/demandas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/producao/central/kpis"] });
      toast({ title: "Demanda criada", description: "Adicionada à fila." });
      form.reset({ titulo: "", tipo: "documento", prioridade: "medio", assigneeType: "human", descricao: "" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const executarAgenteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/producao/central/demandas/${id}/executar-agente`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/producao/central/demandas"] }),
    onError: (e: any) => toast({ title: "Erro IA", description: e.message, variant: "destructive" }),
  });

  const iniciarMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/producao/central/demandas/${id}`, { status: "em_execucao" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/producao/central/demandas"] }),
  });
  const concluirMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/producao/central/demandas/${id}`, { status: "concluido" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/central/demandas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/producao/central/kpis"] });
    },
  });
  const cancelarMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/producao/central/demandas/${id}/cancelar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/producao/central/demandas"] }),
  });

  const filtradas = (demandas || []).filter(d => {
    if (filtroAssignee === "human" && d.assigneeType !== "human") return false;
    if (filtroAssignee === "agent" && d.assigneeType !== "agent") return false;
    if (filtroPrioridade !== "todas" && d.prioridade !== filtroPrioridade) return false;
    return true;
  });

  const projetoNome = (id?: string | null) => projetos?.find((p: any) => p.id === id)?.name ?? "—";

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-central-producao">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Activity className="h-7 w-7 text-primary" /> Central de Produção (PCP)
        </h1>
        <p className="text-muted-foreground mt-1">Demandas humanas e de agentes IA — orquestração unificada.</p>
      </div>

      {/* Painel 1 — KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card data-testid="kpi-projetos-ativos"><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Projetos Ativos</span><TrendingUp className="h-4 w-4 text-primary" /></div>
          <p className="text-2xl font-bold mt-1">{kpis?.projetosAtivos ?? "—"}</p>
        </CardContent></Card>
        <Card data-testid="kpi-demandas-hoje"><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Demandas Hoje</span><Plus className="h-4 w-4 text-primary" /></div>
          <p className="text-2xl font-bold mt-1">{kpis?.demandasHoje ?? "—"}</p>
        </CardContent></Card>
        <Card data-testid="kpi-taxa-prazo"><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">% Entrega no Prazo</span><CheckCircle2 className="h-4 w-4 text-green-600" /></div>
          <p className="text-2xl font-bold mt-1">{kpis ? `${kpis.taxaEntregasPrazo}%` : "—"}</p>
        </CardContent></Card>
        <Card data-testid="kpi-agente"><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Para Agentes</span><Bot className="h-4 w-4 text-purple-600" /></div>
          <p className="text-2xl font-bold mt-1">{kpis?.demandasAgente ?? "—"}</p>
        </CardContent></Card>
        <Card data-testid="kpi-tempo-medio"><CardContent className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Tempo Médio (h)</span><Clock className="h-4 w-4 text-amber-600" /></div>
          <p className="text-2xl font-bold mt-1">{kpis ? kpis.tempoMedioResolucaoH : "—"}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="fila" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fila" data-testid="tab-fila">Fila de Demandas</TabsTrigger>
          <TabsTrigger value="timeline" data-testid="tab-timeline">Linha do Tempo</TabsTrigger>
        </TabsList>

        <TabsContent value="fila" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Painel 2 — Fila */}
            <Card className="lg:col-span-3" data-testid="card-fila">
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Fila ({filtradas.length})</CardTitle>
                  <div className="flex gap-2 flex-wrap">
                    <Select value={filtroAssignee} onValueChange={setFiltroAssignee}>
                      <SelectTrigger className="h-8 w-36" data-testid="filter-assignee"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="human">Para Humano</SelectItem>
                        <SelectItem value="agent">Para Agente</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                      <SelectTrigger className="h-8 w-32" data-testid="filter-prioridade"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        {PRIORIDADES.map(p => <SelectItem key={p} value={p}>{prioridadeBadge[p].label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                {isLoading ? <Skeleton className="h-32 w-full" /> :
                 filtradas.length === 0 ? <p className="text-center text-sm text-muted-foreground py-8">Nenhuma demanda na fila.</p> :
                 filtradas.map(d => (
                  <div key={d.id} className="p-3 border rounded space-y-2" data-testid={`demanda-${d.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${prioridadeBadge[d.prioridade]?.cls || ""}`}>{prioridadeBadge[d.prioridade]?.label || d.prioridade}</span>
                          <Badge variant={statusBadge[d.status]?.variant || "outline"} className="text-xs gap-1">
                            {d.status === "em_execucao" && <Loader2 className="h-3 w-3 animate-spin" />}
                            {statusBadge[d.status]?.label || d.status}
                          </Badge>
                          <Badge variant="outline" className="text-xs">{d.tipo}</Badge>
                          {d.assigneeType === "agent" && <Badge variant="outline" className="text-xs gap-1"><Bot className="h-3 w-3" />Agente</Badge>}
                        </div>
                        <p className="text-sm font-medium truncate">{d.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {projetoNome(d.projetoId)} · {d.createdAt ? format(new Date(d.createdAt), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {d.status === "fila" && d.assigneeType === "human" && (
                          <Button size="sm" variant="outline" onClick={() => iniciarMutation.mutate(d.id)} data-testid={`button-iniciar-${d.id}`}>
                            <Play className="h-3 w-3 mr-1" /> Iniciar
                          </Button>
                        )}
                        {d.status === "fila" && d.assigneeType === "agent" && (
                          <Button size="sm" onClick={() => executarAgenteMutation.mutate(d.id)} disabled={executarAgenteMutation.isPending} data-testid={`button-executar-ia-${d.id}`}>
                            <Sparkles className="h-3 w-3 mr-1" /> Executar IA
                          </Button>
                        )}
                        {(d.status === "revisao" || d.status === "em_execucao") && d.status !== "em_execucao" && (
                          <Button size="sm" variant="outline" onClick={() => concluirMutation.mutate(d.id)} data-testid={`button-concluir-${d.id}`}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Concluir
                          </Button>
                        )}
                        {!["concluido", "cancelado"].includes(d.status) && (
                          <Button size="sm" variant="ghost" onClick={() => cancelarMutation.mutate(d.id)} data-testid={`button-cancelar-${d.id}`}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {d.resultadoJson && typeof d.resultadoJson === "object" && (d.resultadoJson as any).conteudo && (
                      <div className="text-xs bg-muted p-2 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">
                        <FileText className="h-3 w-3 inline mr-1" />
                        {(d.resultadoJson as any).conteudo.slice(0, 500)}{(d.resultadoJson as any).conteudo.length > 500 ? "..." : ""}
                      </div>
                    )}
                    {d.resultadoJson && typeof d.resultadoJson === "object" && (d.resultadoJson as any).erro && (
                      <div className="text-xs bg-destructive/10 text-destructive p-2 rounded flex items-start gap-1">
                        <AlertCircle className="h-3 w-3 mt-0.5" /> {(d.resultadoJson as any).erro}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Painel 3 — Criar Demanda */}
            <Card className="lg:col-span-2" data-testid="card-criar">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Nova Demanda</CardTitle></CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(v => criarMutation.mutate(v))} className="space-y-3">
                    <FormField control={form.control} name="titulo" render={({ field }) => (
                      <FormItem><FormLabel>Título *</FormLabel><FormControl><Input {...field} data-testid="input-titulo" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-2">
                      <FormField control={form.control} name="tipo" render={({ field }) => (
                        <FormItem><FormLabel>Tipo</FormLabel><Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="select-tipo"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="prioridade" render={({ field }) => (
                        <FormItem><FormLabel>Prioridade</FormLabel><Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="select-prioridade"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{PRIORIDADES.map(p => <SelectItem key={p} value={p}>{prioridadeBadge[p].label}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="projetoId" render={({ field }) => (
                      <FormItem><FormLabel>Projeto</FormLabel><Select value={field.value || "_none"} onValueChange={(v) => field.onChange(v === "_none" ? undefined : v)}>
                        <FormControl><SelectTrigger data-testid="select-projeto"><SelectValue placeholder="(sem projeto)" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="_none">(sem projeto)</SelectItem>
                          {(projetos || []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select></FormItem>
                    )} />
                    <FormField control={form.control} name="assigneeType" render={({ field }) => (
                      <FormItem><FormLabel>Responsável</FormLabel>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant={field.value === "human" ? "default" : "outline"} onClick={() => field.onChange("human")} data-testid="toggle-human" className="flex-1">
                            <Users className="h-3 w-3 mr-1" /> Humano
                          </Button>
                          <Button type="button" size="sm" variant={field.value === "agent" ? "default" : "outline"} onClick={() => field.onChange("agent")} data-testid="toggle-agent" className="flex-1">
                            <Bot className="h-3 w-3 mr-1" /> Agente IA
                          </Button>
                        </div>
                      </FormItem>
                    )} />
                    {watchAssignee === "agent" && (
                      <FormField control={form.control} name="agenteTask" render={({ field }) => (
                        <FormItem><FormLabel>Task IA</FormLabel><Select value={field.value || ""} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="select-task"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                          <SelectContent>{TASK_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select></FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="descricao" render={({ field }) => (
                      <FormItem><FormLabel>Descrição</FormLabel><FormControl><Textarea {...field} rows={3} data-testid="input-descricao" /></FormControl></FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={criarMutation.isPending} data-testid="button-criar-demanda">
                      {criarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                      Criar Demanda
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Painel 4 — Linha do Tempo */}
        <TabsContent value="timeline">
          <Card data-testid="card-timeline">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarIcon className="h-4 w-4" /> Linha do Tempo dos Projetos</CardTitle></CardHeader>
            <CardContent>
              {!timeline || timeline.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">Nenhum projeto com sprints datados.</p>
              ) : (
                <TimelineGantt timeline={timeline} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TimelineGantt({ timeline }: { timeline: Timeline[] }) {
  const allDates = timeline.flatMap(p => p.sprints.flatMap(s => [s.startDate, s.endDate])).filter(Boolean) as string[];
  if (allDates.length === 0) return <p className="text-sm text-muted-foreground">Sem datas.</p>;
  const min = new Date(Math.min(...allDates.map(d => new Date(d).getTime())));
  const max = new Date(Math.max(...allDates.map(d => new Date(d).getTime())));
  const totalDias = Math.max(1, Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24)));
  const semanas = Math.ceil(totalDias / 7);

  const statusCor: Record<string, string> = {
    completed: "bg-green-500", active: "bg-blue-500", planning: "bg-slate-400",
    review: "bg-amber-500", cancelled: "bg-red-300",
  };

  const pos = (d: string) => ((new Date(d).getTime() - min.getTime()) / (1000 * 60 * 60 * 24) / totalDias) * 100;

  return (
    <div className="space-y-3 overflow-x-auto">
      <div className="flex text-xs text-muted-foreground border-b pb-1">
        <div className="w-48 shrink-0">Projeto</div>
        <div className="flex-1 relative" style={{ minWidth: `${semanas * 30}px` }}>
          {Array.from({ length: semanas }).map((_, i) => (
            <div key={i} className="absolute top-0 text-[10px]" style={{ left: `${(i / semanas) * 100}%` }}>S{i + 1}</div>
          ))}
        </div>
      </div>
      {timeline.map(p => (
        <div key={p.id} className="flex items-center" data-testid={`gantt-projeto-${p.id}`}>
          <div className="w-48 shrink-0 text-sm font-medium truncate pr-2" title={p.nome}>{p.nome}</div>
          <div className="flex-1 relative h-8 bg-muted/30 rounded" style={{ minWidth: `${semanas * 30}px` }}>
            {p.sprints.map(s => {
              if (!s.startDate || !s.endDate) return null;
              const left = pos(s.startDate);
              const right = pos(s.endDate);
              const width = Math.max(1, right - left);
              return (
                <div key={s.id}
                  className={`absolute top-1 bottom-1 ${statusCor[s.status] || "bg-slate-300"} rounded text-[10px] text-white px-1 overflow-hidden flex items-center`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${s.nome} (${s.status})`}
                  data-testid={`gantt-sprint-${s.id}`}
                >
                  <span className="truncate">{s.nome}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex gap-3 text-xs text-muted-foreground pt-2 border-t flex-wrap">
        {Object.entries(statusCor).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded ${v}`} />{k}</span>
        ))}
      </div>
    </div>
  );
}
