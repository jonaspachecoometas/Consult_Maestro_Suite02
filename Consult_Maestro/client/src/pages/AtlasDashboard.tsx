import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, AlertCircle, Database, Pin, Loader2, BarChart3, LineChart as LineIcon, PieChart as PieIcon, Hash, Table as TableIcon, Activity, Table2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { WidgetConfig, BiDashboard, WidgetType } from "@shared/schema";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";

const COLORS = ["#5B4FD4", "#1D9E75", "#BA7517", "#D85A30", "#185FA5", "#9333ea", "#06b6d4"];

type MetricDef = {
  id: string;
  label: string;
  description: string;
  widget: "kpi_card" | "bar_chart" | "line_chart" | "pie_chart";
  group: string;
  format?: "currency" | "number" | "percent";
};

const METRICS: MetricDef[] = [
  { id: "atlas.receita_por_periodo", label: "Receita por mês", description: "Pedidos entregues por período", widget: "line_chart", group: "Vendas", format: "currency" },
  { id: "atlas.ticket_medio", label: "Ticket médio", description: "Valor médio por pedido", widget: "kpi_card", group: "Vendas", format: "currency" },
  { id: "atlas.top_clientes", label: "Top 15 clientes", description: "Por receita acumulada", widget: "bar_chart", group: "Vendas", format: "currency" },
  { id: "atlas.top_produtos_vendidos", label: "Top 20 produtos vendidos", description: "Por quantidade", widget: "bar_chart", group: "Produtos" },
  { id: "atlas.margem_por_produto", label: "Margem % por produto (Top 20)", description: "(valor_unitario − valor_custo) ÷ valor_unitario × 100", widget: "bar_chart", group: "Produtos", format: "percent" },
  { id: "atlas.curva_abc_produtos", label: "Curva ABC de produtos", description: "Concentração de receita", widget: "pie_chart", group: "Produtos" },
  { id: "atlas.estoque_por_grupo", label: "Estoque por grupo", description: "Quantidade em estoque", widget: "bar_chart", group: "Estoque" },
  { id: "atlas.inadimplencia_valor", label: "Inadimplência", description: "Valor total em atraso", widget: "kpi_card", group: "Financeiro", format: "currency" },
  { id: "atlas.contas_a_receber_por_vencimento", label: "Contas a receber por vencimento", description: "Aging de recebíveis", widget: "bar_chart", group: "Financeiro", format: "currency" },
];

function fmtValue(v: number, format?: string) {
  if (format === "currency") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
  }
  if (format === "percent") {
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v)}%`;
  }
  return new Intl.NumberFormat("pt-BR").format(v);
}

function MetricCard({ metric, tenantId }: { metric: MetricDef; tenantId?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pinning, setPinning] = useState(false);

  const { data, isLoading, error } = useQuery<{ rows: { name: string; value: number }[] }>({
    queryKey: ["/api/bi/semantic/run", metric.id, tenantId ?? "auto"],
    queryFn: async () => {
      const r = await apiRequest("POST", "/api/bi/semantic/run", {
        metricId: metric.id,
        ...(tenantId ? { arcadiaTenantId: tenantId } : {}),
      });
      return r.json();
    },
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const isEmpty = !isLoading && rows.length === 0;

  async function pinToBi(widgetType: WidgetType = metric.widget) {
    setPinning(true);
    try {
      // 1. Pega dashboards do tenant; pega default ou cria
      const listRes = await apiRequest("GET", "/api/bi/dashboards");
      const dashboards: BiDashboard[] = await listRes.json();
      let target = dashboards.find(d => d.isDefault === 1) || dashboards[0];
      if (!target) {
        const createRes = await apiRequest("POST", "/api/bi/dashboards", {
          name: "Meu Dashboard",
          layout: [],
          isDefault: 1,
          filters: { enabledFilters: [] },
          ...(tenantId ? { arcadiaTenantId: tenantId } : {}),
        });
        target = await createRes.json();
      }
      // 2. Calcula próxima linha disponível
      const layout: WidgetConfig[] = (target.layout as WidgetConfig[]) || [];
      const nextY = layout.length === 0 ? 0 : Math.max(...layout.map(w => w.gridPos.y + w.gridPos.h));
      const isKpi = widgetType === "kpi_card" || widgetType === "big_number" || widgetType === "gauge_chart";
      const isPie = widgetType === "pie_chart" || widgetType === "donut_chart";
      const w = isKpi ? 3 : isPie ? 4 : 6;
      const h = isKpi ? 2 : 4;
      const newWidget: WidgetConfig = {
        id: `atlas-${metric.id.replace(/\./g, "-")}-${Date.now()}`,
        type: widgetType,
        title: metric.label,
        gridPos: { x: 0, y: nextY, w, h },
        dataSource: { type: "semantic", metricId: metric.id },
      };
      // 3. PATCH com layout atualizado
      await apiRequest("PATCH", `/api/bi/dashboards/${target.id}`, {
        layout: [...layout, newWidget],
      });
      qc.invalidateQueries({ queryKey: ["/api/bi/dashboards"] });
      toast({
        title: "Painel fixado!",
        description: `"${metric.label}" foi adicionado ao BI Consultivo (${target.name}).`,
      });
    } catch (e: any) {
      toast({
        title: "Erro ao fixar painel",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setPinning(false);
    }
  }

  return (
    <Card data-testid={`card-metric-${metric.id}`} className="group relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            disabled={pinning}
            title="Fixar no BI Consultivo"
            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            data-testid={`button-pin-${metric.id}`}
          >
            {pinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Fixar no BI como…</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => pinToBi("kpi_card")} data-testid={`pin-as-kpi-${metric.id}`}>
            <Hash className="h-3.5 w-3.5 mr-2" /> KPI / Número
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("bar_chart")} data-testid={`pin-as-bar-${metric.id}`}>
            <BarChart3 className="h-3.5 w-3.5 mr-2" /> Gráfico de barras
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("line_chart")} data-testid={`pin-as-line-${metric.id}`}>
            <LineIcon className="h-3.5 w-3.5 mr-2" /> Linha / Tendência
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("area_chart")} data-testid={`pin-as-area-${metric.id}`}>
            <Activity className="h-3.5 w-3.5 mr-2" /> Área
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("pie_chart")} data-testid={`pin-as-pie-${metric.id}`}>
            <PieIcon className="h-3.5 w-3.5 mr-2" /> Pizza
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("donut_chart")} data-testid={`pin-as-donut-${metric.id}`}>
            <PieIcon className="h-3.5 w-3.5 mr-2" /> Rosca (donut)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pinToBi("data_table")} data-testid={`pin-as-table-${metric.id}`}>
            <TableIcon className="h-3.5 w-3.5 mr-2" /> Tabela de dados
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => pinToBi(metric.widget)} data-testid={`pin-as-default-${metric.id}`}>
            <Pin className="h-3.5 w-3.5 mr-2" /> Sugerido ({metric.widget.replace("_", " ")})
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium pr-8">{metric.label}</CardTitle>
        <p className="text-xs text-muted-foreground">{metric.description}</p>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-[180px] w-full" />}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{(error as any).message ?? "Erro ao carregar"}</span>
          </div>
        )}
        {!isLoading && !error && isEmpty && (
          <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground text-center px-4">
            Sem dados. Importe o dump do Atlas para popular esta métrica.
          </div>
        )}
        {!isLoading && !error && !isEmpty && (
          <>
            {metric.widget === "kpi_card" && (
              <div className="text-2xl font-semibold" data-testid={`kpi-${metric.id}`}>
                {fmtValue(rows[0]?.value ?? 0, metric.format)}
              </div>
            )}
            {metric.widget === "bar_chart" && (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtValue(v, metric.format)} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any) => fmtValue(Number(v), metric.format)} />
                  <Bar dataKey="value" fill={COLORS[0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            {metric.widget === "line_chart" && (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtValue(v, metric.format)} />
                  <Tooltip formatter={(v: any) => fmtValue(Number(v), metric.format)} />
                  <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {metric.widget === "pie_chart" && (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e: any) => e.name}>
                    {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtValue(Number(v), metric.format)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AtlasDashboard() {
  const groups = Array.from(new Set(METRICS.map(m => m.group)));
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [openingBuilder, setOpeningBuilder] = useState(false);
  // Lê tenantId da URL (?tenantId=xxx); persiste em localStorage para refresh
  const urlParams = new URLSearchParams(window.location.search);
  const initialTenant = urlParams.get("tenantId") || localStorage.getItem("atlas:tenantId") || "";
  const [tenantId, setTenantId] = useState(initialTenant);

  // Cria (ou reutiliza) dashboard "Atlas ERP" com todos os painéis pré-carregados,
  // e abre direto no BI Builder para edição.
  async function openInBuilder() {
    setOpeningBuilder(true);
    try {
      const listRes = await apiRequest("GET", "/api/bi/dashboards");
      const dashboards: BiDashboard[] = await listRes.json();
      let target = dashboards.find(d => d.name === "Atlas ERP");
      if (!target) {
        // Layout grid 12-col: 3 cards por linha (w=4) para charts, kpi=3
        let y = 0;
        const layout: WidgetConfig[] = [];
        for (let i = 0; i < METRICS.length; i++) {
          const m = METRICS[i];
          const isKpi = m.widget === "kpi_card";
          const w = isKpi ? 3 : m.widget === "pie_chart" ? 4 : 6;
          const h = isKpi ? 2 : 4;
          const xPositions = layout.filter(it => it.gridPos.y === y).reduce((acc, it) => acc + it.gridPos.w, 0);
          if (xPositions + w > 12) { y = Math.max(...layout.map(it => it.gridPos.y + it.gridPos.h), 0); }
          const xNow = layout.filter(it => it.gridPos.y === y).reduce((acc, it) => acc + it.gridPos.w, 0);
          layout.push({
            id: `atlas-${m.id.replace(/\./g, "-")}-${i}`,
            type: m.widget,
            title: m.label,
            gridPos: { x: xNow, y, w, h },
            dataSource: { type: "semantic", metricId: m.id },
          });
        }
        const createRes = await apiRequest("POST", "/api/bi/dashboards", {
          name: "Atlas ERP",
          layout,
          isDefault: 0,
          filters: { enabledFilters: [] },
          ...(tenantId ? { arcadiaTenantId: tenantId } : {}),
        });
        target = await createRes.json();
        toast({ title: "Dashboard 'Atlas ERP' criado!", description: `${layout.length} painéis carregados no BI.` });
      }
      setLocation(`/bi?dashboardId=${target!.id}`);
    } catch (e: any) {
      toast({ title: "Erro ao abrir no BI Builder", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setOpeningBuilder(false);
    }
  }

  const { data: tenants = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/tenants"],
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!tenantId && tenants.length === 1) setTenantId(tenants[0].id);
  }, [tenants, tenantId]);

  useEffect(() => {
    if (tenantId) localStorage.setItem("atlas:tenantId", tenantId);
  }, [tenantId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/datasets">
              <Button variant="ghost" size="sm" className="gap-1.5" data-testid="link-back-datasets">
                <ArrowLeft className="h-3.5 w-3.5" /> Datasets
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-medium" data-testid="text-page-title">Dashboard Atlas ERP</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Vendas, produtos, estoque e financeiro — dados ao vivo das tabelas analíticas do Atlas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tenants.length > 1 && (
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="w-[220px]" data-testid="select-dashboard-tenant">
                  <SelectValue placeholder="Cliente Arcádia" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Link href="/datasets/atlas/explorer">
              <Button
                variant="outline" size="sm" className="gap-2"
                data-testid="button-atlas-explorer"
              >
                <Table2 className="h-4 w-4" />
                Explorar dados
              </Button>
            </Link>
            <Button
              variant="outline" size="sm" className="gap-2"
              onClick={openInBuilder}
              disabled={openingBuilder}
              data-testid="button-bi-builder"
            >
              {openingBuilder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Personalizar no BI Builder
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
        {groups.map(group => (
          <section key={group}>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{group}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {METRICS.filter(m => m.group === group).map(m => (
                <MetricCard key={m.id} metric={m} tenantId={tenantId || undefined} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
