import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, FileText, FileSpreadsheet, RefreshCw, AlertTriangle,
  AlertCircle, Info, TrendingUp, Calendar, CheckCircle2, Clock, XCircle,
  Target, DollarSign,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Alerta { nivel: "critico" | "atencao" | "info"; mensagem: string; }
interface SprintHist { id: string; numero: number; titulo: string; periodo: string; totalTarefas: number; concluidas: number; percentual: number; status: string; }
interface ReuniaoProx { id: string; numero: number; data: string; tipo: string; sprint: string | null; temPauta: boolean; }
interface RelatorioData {
  visaoGeral: {
    projetoId: string; nome: string; clienteNome: string | null; faseAtual: string;
    percentualConclusao: number; dataInicio: string | null; previsaoFim: string | null;
    diasRestantes: number | null; orcamentoTotal: number; valorPago: number;
    proximoMarco: { label: string; data: string; diasRestantes: number } | null;
  };
  sprintAtual: {
    sprintId: string | null; nome: string | null; goal: string | null;
    totalTarefas: number; concluidas: number; emAndamento: number; atrasadas: number;
    percentual: number; velocidadeSemanal: number;
    impedimentos: { id: string; titulo: string; motivo: string | null }[];
  };
  historicoSprints: SprintHist[];
  proximasReunioes: ReuniaoProx[];
  alertasAgente: Alerta[];
  geradoEm: string;
}

const statusBadgeMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  concluido: { label: "Concluído", variant: "secondary", icon: CheckCircle2 },
  em_andamento: { label: "Em andamento", variant: "default", icon: Clock },
  atrasado: { label: "Atrasado", variant: "destructive", icon: XCircle },
  futuro: { label: "Planejado", variant: "outline", icon: Calendar },
};

const alertaIcon = { critico: AlertTriangle, atencao: AlertCircle, info: Info } as const;
const alertaCls: Record<string, string> = {
  critico: "border-l-4 border-destructive bg-destructive/5",
  atencao: "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30",
  info: "border-l-4 border-sky-500 bg-sky-50 dark:bg-sky-950/30",
};

function brl(v: number) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function RelatorioProjeto() {
  const { id: projetoId } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<RelatorioData>({
    queryKey: ["/api/producao/projetos", projetoId, "relatorio"],
    enabled: !!projetoId,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/producao/projetos/${projetoId}/relatorio?refresh=1`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", projetoId, "relatorio"] });
      toast({ title: "Relatório atualizado", description: "Alertas recalculados pelo agente." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleExport = async (formato: "xlsx" | "pdf") => {
    try {
      const r = await fetch(`/api/producao/projetos/${projetoId}/relatorio/export/${formato}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (formato === "pdf") {
        const html = await r.text();
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); }
        else toast({ title: "Pop-up bloqueado", description: "Permita pop-ups para ver o relatório.", variant: "destructive" });
      } else {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const cd = r.headers.get("Content-Disposition") || "";
        const m = cd.match(/filename="(.+?)"/);
        a.href = url; a.download = m?.[1] || `relatorio.${formato}`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      toast({ title: "Erro no export", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card><CardContent className="py-12 text-center text-destructive">
          {(error as any)?.message || "Erro ao carregar relatório"}
        </CardContent></Card>
      </div>
    );
  }
  const v = data.visaoGeral;
  const sa = data.sprintAtual;

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-relatorio-projeto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2" data-testid="link-voltar-projetos">
            <Link href="/producao/projetos"><ChevronLeft className="h-4 w-4 mr-1" />Voltar para projetos</Link>
          </Button>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" /> Relatório — {v.nome}
          </h1>
          <p className="text-muted-foreground mt-1">
            {v.clienteNome ? `Cliente: ${v.clienteNome} · ` : ""}Fase: {v.faseAtual} · Atualizado {format(new Date(data.geradoEm), "dd/MM/yyyy HH:mm")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-refresh-relatorio">
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Recalcular
          </Button>
          <Button variant="outline" onClick={() => handleExport("xlsx")} data-testid="button-export-xlsx">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> XLSX
          </Button>
          <Button onClick={() => handleExport("pdf")} data-testid="button-export-pdf">
            <FileText className="h-4 w-4 mr-2" /> PDF
          </Button>
        </div>
      </div>

      {/* Alertas — full width no topo se houver críticos */}
      {data.alertasAgente.length > 0 && (
        <Card data-testid="card-alertas">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Alertas do Agente ({data.alertasAgente.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.alertasAgente.map((a, i) => {
              const Icon = alertaIcon[a.nivel];
              return (
                <div key={i} className={`p-3 rounded ${alertaCls[a.nivel]} flex items-start gap-2`} data-testid={`alerta-${i}`}>
                  <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{a.mensagem}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Visão Geral */}
        <Card className="lg:col-span-2" data-testid="card-visao-geral">
          <CardHeader><CardTitle className="text-base">1. Visão Geral</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm text-muted-foreground">Conclusão geral</span>
                <span className="text-2xl font-bold" data-testid="text-percentual-geral">{v.percentualConclusao}%</span>
              </div>
              <Progress value={v.percentualConclusao} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Início</p><p className="font-medium">{v.dataInicio ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Previsão fim</p><p className="font-medium">{v.previsaoFim ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Dias restantes</p><p className="font-medium" data-testid="text-dias-restantes">{v.diasRestantes ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Orçamento total</p><p className="font-medium">{brl(v.orcamentoTotal)}</p></div>
              <div><p className="text-xs text-muted-foreground">Valor pago (estim.)</p><p className="font-medium">{brl(v.valorPago)}</p></div>
              <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" />Próximo marco</p>
                <p className="font-medium text-xs" data-testid="text-proximo-marco">
                  {v.proximoMarco ? `${v.proximoMarco.label} (em ${v.proximoMarco.diasRestantes}d)` : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sprint Atual */}
        <Card data-testid="card-sprint-atual">
          <CardHeader><CardTitle className="text-base">2. Sprint Atual</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sa.sprintId ? (
              <>
                <div>
                  <p className="font-medium text-sm" data-testid="text-sprint-nome">{sa.nome}</p>
                  {sa.goal && <p className="text-xs text-muted-foreground italic">{sa.goal}</p>}
                </div>
                <div>
                  <div className="flex justify-between mb-1 text-xs">
                    <span>{sa.concluidas}/{sa.totalTarefas} tarefas</span>
                    <span className="font-medium">{sa.percentual}%</span>
                  </div>
                  <Progress value={sa.percentual} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted p-2 rounded"><p className="text-muted-foreground">Em andamento</p><p className="font-bold text-sm">{sa.emAndamento}</p></div>
                  <div className={`p-2 rounded ${sa.atrasadas > 0 ? "bg-destructive/10" : "bg-muted"}`}>
                    <p className="text-muted-foreground">Atrasadas</p><p className={`font-bold text-sm ${sa.atrasadas > 0 ? "text-destructive" : ""}`} data-testid="text-atrasadas">{sa.atrasadas}</p>
                  </div>
                  <div className="bg-muted p-2 rounded col-span-2"><p className="text-muted-foreground">Velocidade (7 dias)</p><p className="font-bold text-sm">{sa.velocidadeSemanal} concl.</p></div>
                </div>
                {sa.impedimentos.length > 0 && (
                  <div className="border-t pt-2">
                    <p className="text-xs font-medium text-destructive mb-1">{sa.impedimentos.length} impedimento(s):</p>
                    <ul className="text-xs space-y-1">
                      {sa.impedimentos.slice(0, 3).map(i => (
                        <li key={i.id} data-testid={`impedimento-${i.id}`}>• <b>{i.titulo}</b>{i.motivo ? `: ${i.motivo}` : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">Nenhuma sprint ativa.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Histórico */}
        <Card className="lg:col-span-2" data-testid="card-historico">
          <CardHeader><CardTitle className="text-base">3. Histórico de Sprints ({data.historicoSprints.length})</CardTitle></CardHeader>
          <CardContent>
            {data.historicoSprints.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhuma sprint cadastrada.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.historicoSprints.map((h) => {
                  const cfg = statusBadgeMap[h.status] || statusBadgeMap.futuro;
                  const Icon = cfg.icon;
                  return (
                    <div key={h.id} className="flex items-center justify-between p-2 border rounded gap-2" data-testid={`sprint-historico-${h.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={cfg.variant} className="gap-1 text-xs"><Icon className="h-3 w-3" />{cfg.label}</Badge>
                          <p className="font-medium text-sm truncate">{h.titulo}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{h.periodo} · {h.concluidas}/{h.totalTarefas} tarefas</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-lg font-bold">{h.percentual}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Próximas Reuniões */}
        <Card data-testid="card-proximas-reunioes">
          <CardHeader><CardTitle className="text-base">4. Próximas Reuniões</CardTitle></CardHeader>
          <CardContent>
            {data.proximasReunioes.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhuma reunião agendada.</p>
            ) : (
              <div className="space-y-2">
                {data.proximasReunioes.map((r) => (
                  <Link key={r.id} href={`/producao/reunioes/${r.id}`} className="block p-2 border rounded hover-elevate" data-testid={`reuniao-prox-${r.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">#{String(r.numero).padStart(3, "0")} — {r.tipo}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(r.data), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          {r.sprint && ` · ${r.sprint}`}
                        </p>
                      </div>
                      {r.temPauta
                        ? <Badge variant="secondary" className="text-xs">pauta ✓</Badge>
                        : <Badge variant="outline" className="text-xs">sem pauta</Badge>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
