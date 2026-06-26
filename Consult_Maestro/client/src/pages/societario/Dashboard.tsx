import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, Users, Layers, ListChecks, Timer, UserCheck } from "lucide-react";

interface DashboardData {
  totais: {
    total: number;
    ativos: number;
    concluidos: number;
    pausados: number;
    cancelados: number;
    vencidos: number;
    proximoVencimento: number;
  };
  porColuna: Record<string, number>;
  porAnalista: Array<{ analistaId: string | null; nome: string; total: number }>;
  porTipo: Array<{ tipo: string; total: number }>;
  tempoMedio: Array<{ coluna: string; mediaDias: number; n: number }>;
  gargalos: Array<{ processoId: string; processNumber: string; titulo: string; coluna: string; dias: number }>;
  tarefasPorExecutor: Array<{ executor: string; total: number }>;
  tiposDisponiveis: Array<{ tipoProcesso: string; nome: string }>;
  analistasDisponiveis: Array<{ id: string; nome: string }>;
  agente: { processosAutomaticos: number; tarefasExecutadasAgente: number };
  meusProcessos: { ativos: number; vencidos: number; proximoVencimento: number } | null;
  viewerId: string | null;
}

interface DashboardProps {
  embedded?: boolean;
}

export default function PipelineDashboard({ embedded = false }: DashboardProps) {
  const [tipoFiltro, setTipoFiltro] = useState<string>("__all__");
  const [analistaFiltro, setAnalistaFiltro] = useState<string>("__all__");
  const [meusOnly, setMeusOnly] = useState<boolean>(false);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/societario/pipeline/dashboard", tipoFiltro, analistaFiltro, meusOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tipoFiltro !== "__all__") params.set("tipo", tipoFiltro);
      const effectiveAnalista = meusOnly ? "__me__" : analistaFiltro;
      if (effectiveAnalista && effectiveAnalista !== "__all__" && effectiveAnalista !== "__me__") {
        params.set("analista", effectiveAnalista);
      }
      // For "__me__", we'll first fetch without filter to get viewerId, then refetch.
      // Simplest: send marker; backend resolves to viewerId.
      if (meusOnly) params.set("analista", "__me__");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/societario/pipeline/dashboard${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar dashboard");
      return res.json();
    },
  });

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Dashboard Pipeline Societário
          </h1>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Tipo:</span>
        <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
          <SelectTrigger className="w-[240px]" data-testid="select-dashboard-tipo">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            {(data?.tiposDisponiveis ?? []).map((t) => (
              <SelectItem key={t.tipoProcesso} value={t.tipoProcesso}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground ml-2">Analista:</span>
        <Select
          value={meusOnly ? "__me__" : analistaFiltro}
          onValueChange={(v) => {
            if (v === "__me__") {
              setMeusOnly(true);
              setAnalistaFiltro("__all__");
            } else {
              setMeusOnly(false);
              setAnalistaFiltro(v);
            }
          }}
        >
          <SelectTrigger className="w-[240px]" data-testid="select-dashboard-analista">
            <SelectValue placeholder="Todos os analistas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os analistas</SelectItem>
            <SelectItem value="__me__">Meus processos (eu)</SelectItem>
            {(data?.analistasDisponiveis ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="grid-totais">
            <KpiCard icon={<Layers className="h-5 w-5 text-blue-500" />} label="Total" value={data?.totais.total ?? 0} testid="kpi-total" />
            <KpiCard icon={<Activity className="h-5 w-5 text-emerald-500" />} label="Ativos" value={data?.totais.ativos ?? 0} testid="kpi-ativos" />
            <KpiCard icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} label="Concluídos" value={data?.totais.concluidos ?? 0} testid="kpi-concluidos" />
            <KpiCard icon={<Clock className="h-5 w-5 text-slate-500" />} label="Pausados" value={data?.totais.pausados ?? 0} testid="kpi-pausados" />
            <KpiCard icon={<AlertTriangle className="h-5 w-5 text-red-500" />} label="Vencidos" value={data?.totais.vencidos ?? 0} testid="kpi-vencidos" highlight={(data?.totais.vencidos ?? 0) > 0 ? "red" : undefined} />
            <KpiCard icon={<Clock className="h-5 w-5 text-amber-500" />} label="Vencem em ≤7d" value={data?.totais.proximoVencimento ?? 0} testid="kpi-proximo" />
            <KpiCard icon={<Timer className="h-5 w-5 text-violet-500" />} label="Cancelados" value={data?.totais.cancelados ?? 0} testid="kpi-cancelados" />
            <KpiCard icon={<ListChecks className="h-5 w-5 text-indigo-500" />} label="Tipos ativos" value={data?.tiposDisponiveis.length ?? 0} testid="kpi-tipos" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="grid-extras">
            <KpiCard
              icon={<Bot className="h-5 w-5 text-fuchsia-500" />}
              label="Processos com agente"
              value={data?.agente.processosAutomaticos ?? 0}
              testid="kpi-agente-processos"
            />
            <KpiCard
              icon={<Bot className="h-5 w-5 text-fuchsia-500" />}
              label="Tarefas executadas pelo agente"
              value={data?.agente.tarefasExecutadasAgente ?? 0}
              testid="kpi-agente-tarefas"
            />
            <KpiCard
              icon={<UserCheck className="h-5 w-5 text-sky-500" />}
              label="Meus processos ativos"
              value={data?.meusProcessos?.ativos ?? 0}
              testid="kpi-meus-ativos"
            />
            <KpiCard
              icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
              label="Meus vencidos"
              value={data?.meusProcessos?.vencidos ?? 0}
              testid="kpi-meus-vencidos"
              highlight={(data?.meusProcessos?.vencidos ?? 0) > 0 ? "red" : undefined}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card data-testid="card-por-coluna">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" /> Processos ativos por etapa</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {Object.entries(data?.porColuna ?? {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem processos ativos.</p>
                ) : (
                  Object.entries(data?.porColuna ?? {}).map(([col, n]) => (
                    <BarRow key={col} label={col} value={n} max={Math.max(...Object.values(data?.porColuna ?? { _: 1 }))} testid={`bar-coluna-${col}`} />
                  ))
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-por-analista">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Carga por analista</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(data?.porAnalista ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem analistas atribuídos.</p>
                ) : (
                  (data?.porAnalista ?? []).map((a) => (
                    <BarRow
                      key={a.analistaId ?? "__none__"}
                      label={a.nome}
                      value={a.total}
                      max={Math.max(...(data?.porAnalista ?? []).map((x) => x.total), 1)}
                      testid={`bar-analista-${a.analistaId ?? "none"}`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-por-tipo">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" /> Por tipo de processo</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(data?.porTipo ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados.</p>
                ) : (
                  (data?.porTipo ?? []).map((t) => (
                    <BarRow
                      key={t.tipo}
                      label={t.tipo}
                      value={t.total}
                      max={Math.max(...(data?.porTipo ?? []).map((x) => x.total), 1)}
                      testid={`bar-tipo-${t.tipo}`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-tempo-medio">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Timer className="h-4 w-4" /> Tempo médio na etapa atual (dias)</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(data?.tempoMedio ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados.</p>
                ) : (
                  (data?.tempoMedio ?? []).map((t) => (
                    <div key={t.coluna} className="flex items-center justify-between text-sm" data-testid={`tempo-${t.coluna}`}>
                      <span>{t.coluna}</span>
                      <Badge variant="outline">{t.mediaDias}d ({t.n})</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-tarefas-executor">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ListChecks className="h-4 w-4" /> Tarefas pendentes por executor</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(data?.tarefasPorExecutor ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tudo em dia.</p>
                ) : (
                  (data?.tarefasPorExecutor ?? []).map((e) => (
                    <div key={e.executor} className="flex items-center justify-between text-sm" data-testid={`exec-${e.executor}`}>
                      <span className="capitalize">{e.executor}</span>
                      <Badge variant="outline">{e.total}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-gargalos">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Top 10 gargalos (≥14d na etapa)</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(data?.gargalos ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum gargalo identificado.</p>
                ) : (
                  (data?.gargalos ?? []).map((g) => (
                    <Link key={g.processoId} href={`/societario/pipeline/${g.processoId}`}>
                      <a
                        className="flex items-center justify-between text-sm hover:bg-muted rounded px-1 py-0.5"
                        data-testid={`gargalo-${g.processoId}`}
                      >
                        <span className="truncate">
                          <span className="font-mono text-xs text-muted-foreground mr-1">{g.processNumber}</span>
                          {g.titulo}
                        </span>
                        <Badge variant="outline" className="ml-2 shrink-0">{g.dias}d em {g.coluna}</Badge>
                      </a>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon, label, value, testid, highlight,
}: { icon: React.ReactNode; label: string; value: number; testid: string; highlight?: "red" | "amber" }) {
  const border = highlight === "red" ? "border-red-300 dark:border-red-800" : highlight === "amber" ? "border-amber-300 dark:border-amber-800" : "";
  return (
    <Card className={border} data-testid={testid}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold flex items-center gap-2">{icon}{value}</div>
      </CardContent>
    </Card>
  );
}

function BarRow({ label, value, max, testid }: { label: string; value: number; max: number; testid?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="truncate">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
