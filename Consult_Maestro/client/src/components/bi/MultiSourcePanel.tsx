import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Layers, Sparkles, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import type { WidgetConfig, WidgetType } from "@shared/schema";
import { DEFAULT_GRID_POS } from "./dnd-types";

interface SemanticMetric {
  id: string;
  module: string;
  label: string;
  description: string;
  defaultWidget: "kpi_card" | "bar_chart" | "line_chart" | "radar_chart";
  cacheTtlSeconds: number;
}

interface DataSource {
  id: string;
  name: string;
  type: string;
  configPublic: Record<string, any> | null;
}

interface EtlResult {
  totalUpserted: number;
  perSource: Array<{
    dataSourceId: string;
    sourceName: string;
    kind: string;
    rowsIn: number;
    rowsUpserted: number;
    status: string;
    error?: string;
  }>;
}

const SPECIAL_WIDGETS: { value: WidgetType; label: string; description: string }[] = [
  { value: "migration_monitor", label: "Migration Monitor", description: "Painel SCD2 mostrando o avanço da migração entre 2+ conectores." },
  { value: "data_quality_panel", label: "Data Quality", description: "Discrepâncias entre fontes (ex.: receita ERPNext vs Domínio)." },
];

export function MultiSourcePanel({
  onAddWidget,
}: {
  onAddWidget: (widget: WidgetConfig) => void;
}) {
  const { toast } = useToast();
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");

  const { data: metrics = [], isLoading: loadingMetrics } = useQuery<SemanticMetric[]>({
    queryKey: ["/api/bi/semantic/catalog"],
  });
  const { data: sources = [], isLoading: loadingSources } = useQuery<DataSource[]>({
    queryKey: ["/api/datasources"],
  });

  const etlMutation = useMutation<EtlResult, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bi/etl/run", {});
      return await res.json();
    },
    onSuccess: (r) => {
      toast({
        title: "ETL concluído",
        description: `${r.totalUpserted} registros materializados em analytics.*`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bi/etl/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bi/migration-monitor"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bi/data-quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bi/semantic/run"] });
    },
    onError: (e) => toast({ title: "Erro no ETL", description: e.message, variant: "destructive" }),
  });

  const { data: etlRuns = [] } = useQuery<any[]>({
    queryKey: ["/api/bi/etl/runs"],
  });

  const metric = metrics.find((m) => m.id === selectedMetric);
  const mappedSources = sources.filter((s) => s.configPublic?.analyticsMapping);

  function toggleSource(id: string) {
    setSelectedSources((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  }

  function addSemanticWidget() {
    if (!metric) return;
    const widgetType = metric.defaultWidget;
    const grid = DEFAULT_GRID_POS[widgetType];
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: widgetType,
      title: customTitle.trim() || metric.label,
      gridPos: { x: 0, y: 999, w: grid.w, h: grid.h },
      dataSource: {
        type: "semantic",
        metricId: metric.id,
        sources: selectedSources.length ? selectedSources : undefined,
      },
    };
    onAddWidget(widget);
    setCustomTitle("");
    toast({
      title: "Widget adicionado",
      description: `${metric.label}${selectedSources.length ? ` · ${selectedSources.length} fonte(s)` : " (todas as fontes)"}`,
    });
  }

  function addSpecialWidget(t: WidgetType) {
    const grid = DEFAULT_GRID_POS[t];
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: t,
      title: t === "migration_monitor" ? "Migration Monitor" : "Data Quality",
      gridPos: { x: 0, y: 999, w: grid.w, h: grid.h },
      dataSource: { type: "semantic", metricId: t === "migration_monitor" ? "migration.client_progress" : "dq.findings_recent" },
    };
    onAddWidget(widget);
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground space-y-1">
        <p className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          Combine 2+ conectores via Semantic Layer + schema <code>analytics</code>.
        </p>
        <p>Mapeie as fontes em <a href="/integracoes" className="underline">/integracoes</a> usando <code>configPublic.analyticsMapping</code>.</p>
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => etlMutation.mutate()}
              disabled={etlMutation.isPending}
              className="flex-1 h-8 text-[11px]"
              data-testid="button-run-etl"
            >
              {etlMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Rodar ETL agora
            </Button>
          </div>
          {etlRuns.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              Último ETL:{" "}
              <strong>
                {new Date(etlRuns[0].started_at).toLocaleString("pt-BR")}
              </strong>{" "}
              · status <Badge variant="outline" className="text-[9px]">{etlRuns[0].status}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold">Fontes mapeadas</p>
        {loadingSources && <p className="text-[11px] text-muted-foreground">Carregando…</p>}
        {!loadingSources && mappedSources.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-3 text-[11px] text-muted-foreground space-y-1">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Nenhuma fonte com <code>analyticsMapping</code>. Edite a fonte na Central de Integração e adicione:
              <pre className="mt-1 bg-muted p-2 rounded text-[10px] overflow-auto">{`{
  "analyticsMapping": {
    "kind": "fact_revenue",
    "cursorColumn": "updated_at",
    "columnMap": {
      "natural_key": "id",
      "period": "data_emissao",
      "amount": "valor_total",
      "client_natural_key": "cliente_id"
    }
  }
}`}</pre>
            </CardContent>
          </Card>
        )}
        {mappedSources.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:border-primary"
            data-testid={`label-source-${s.id}`}
          >
            <Checkbox
              checked={selectedSources.includes(s.id)}
              onCheckedChange={() => toggleSource(s.id)}
              data-testid={`checkbox-source-${s.id}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {s.type} · {s.configPublic?.analyticsMapping?.kind}
              </div>
            </div>
          </label>
        ))}
        {selectedSources.length === 0 && mappedSources.length > 0 && (
          <p className="text-[10px] text-muted-foreground">Sem seleção = todas as fontes mapeadas serão combinadas.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold">Métrica semântica</p>
        {loadingMetrics && <p className="text-[11px] text-muted-foreground">Carregando catálogo…</p>}
        {!loadingMetrics && (
          <Select value={selectedMetric} onValueChange={setSelectedMetric}>
            <SelectTrigger className="h-8 text-[11px]" data-testid="select-semantic-metric">
              <SelectValue placeholder="Escolha uma métrica" />
            </SelectTrigger>
            <SelectContent>
              {metrics.map((m) => (
                <SelectItem key={m.id} value={m.id} data-testid={`option-metric-${m.id}`}>
                  <span className="font-medium">{m.label}</span>{" "}
                  <span className="text-muted-foreground text-[10px]">({m.module})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {metric && (
          <p className="text-[10px] text-muted-foreground">{metric.description}</p>
        )}
        <Input
          placeholder="Título do widget (opcional)"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          className="h-7 text-[11px]"
          data-testid="input-widget-title"
        />
        <Button
          size="sm"
          className="w-full h-8 text-[11px]"
          onClick={addSemanticWidget}
          disabled={!metric}
          data-testid="button-add-semantic-widget"
        >
          <Sparkles className="h-3 w-3 mr-1" /> Adicionar widget
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold">Painéis especiais</p>
        {SPECIAL_WIDGETS.map((sw) => (
          <Card key={sw.value} className="hover:border-primary cursor-pointer" onClick={() => addSpecialWidget(sw.value)} data-testid={`card-special-${sw.value}`}>
            <CardContent className="p-2 space-y-0.5">
              <div className="text-xs font-medium">{sw.label}</div>
              <div className="text-[10px] text-muted-foreground">{sw.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
