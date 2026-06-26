import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Database, Globe, FileSpreadsheet, Plus, Sparkles, Loader2 } from "lucide-react";
import type { WidgetConfig, WidgetType } from "@shared/schema";

type DataSource = {
  id: string;
  name: string;
  type: string;
  lastSyncStatus: string | null;
};

type SnapshotResp = { rows: any[]; rowCount: number; fetchedAt: string | null };

const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "bar_chart", label: "Gráfico de barras" },
  { value: "line_chart", label: "Gráfico de linha" },
  { value: "kpi_card", label: "KPI (1 número)" },
  { value: "radar_chart", label: "Radar" },
];

function typeIcon(t: string) {
  if (t === "rest_api") return <Globe className="h-4 w-4" />;
  if (t === "postgres") return <Database className="h-4 w-4" />;
  if (t === "excel_upload") return <FileSpreadsheet className="h-4 w-4" />;
  return <Database className="h-4 w-4" />;
}

export function ConnectorsPanel({
  onAddWidget,
  onAddWidgets,
}: {
  onAddWidget: (widget: WidgetConfig) => void;
  onAddWidgets?: (widgets: WidgetConfig[]) => void;
}) {
  const [selected, setSelected] = useState<DataSource | null>(null);
  const [aiSource, setAiSource] = useState<DataSource | null>(null);
  const { data: sources = [], isLoading } = useQuery<DataSource[]>({
    queryKey: ["/api/datasources"],
  });

  const usable = sources.filter((s) => s.lastSyncStatus === "success");

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-3">Carregando…</p>;
  }

  if (sources.length === 0) {
    return (
      <div className="text-xs text-muted-foreground space-y-2 p-2">
        <p>Nenhuma fonte cadastrada.</p>
        <a href="/integracoes" className="underline font-medium block">
          Ir para Central de Integração →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Fontes do tenant. Clique para criar widget com seus dados.
      </p>
      {usable.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Sincronize/faça upload em <a href="/integracoes" className="underline">/integracoes</a> primeiro.
        </p>
      )}
      {usable.map((s) => (
        <Card
          key={s.id}
          className="hover:border-primary transition-colors"
          data-testid={`connector-item-${s.id}`}
        >
          <CardContent className="p-2 space-y-2">
            <div className="flex items-center gap-2">
              {typeIcon(s.type)}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{s.name}</div>
                <Badge variant="outline" className="text-[10px] mt-0.5">{s.type}</Badge>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="default"
                className="flex-1 h-7 text-[11px]"
                onClick={() => setAiSource(s)}
                data-testid={`button-ai-analyze-${s.id}`}
              >
                <Sparkles className="h-3 w-3 mr-1" /> Analisar com IA
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setSelected(s)}
                data-testid={`button-manual-widget-${s.id}`}
              >
                <Plus className="h-3 w-3 mr-1" /> Manual
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {selected && (
        <ConfigureWidgetDialog
          source={selected}
          onClose={() => setSelected(null)}
          onAdd={(widget) => {
            onAddWidget(widget);
            setSelected(null);
          }}
        />
      )}

      {aiSource && (
        <AiAnalyzeDialog
          source={aiSource}
          onClose={() => setAiSource(null)}
          onAddWidgets={(ws) => {
            if (onAddWidgets) onAddWidgets(ws);
            else ws.forEach((w) => onAddWidget(w));
            setAiSource(null);
          }}
        />
      )}
    </div>
  );
}

function AiAnalyzeDialog({
  source,
  onClose,
  onAddWidgets,
}: {
  source: DataSource;
  onClose: () => void;
  onAddWidgets: (widgets: WidgetConfig[]) => void;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<{ title: string; widgets: WidgetConfig[] } | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bi/connector-agent", {
        dataSourceId: source.id,
        prompt: prompt.trim() || undefined,
      });
      return (await res.json()) as { title: string; widgets: WidgetConfig[] };
    },
    onSuccess: (data) => setResult(data),
    onError: (err: any) => {
      toast({
        title: "IA não conseguiu analisar",
        description: err?.message || "Erro desconhecido",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Analisar "{source.name}" com IA
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              A IA vai ler uma amostra dos seus dados e propor 2 a 6 gráficos. Você pode dar uma instrução opcional.
            </p>
            <div>
              <Label>Instrução (opcional)</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex.: Quero ver dívidas por cliente e por mês"
                rows={3}
                data-testid="input-ai-connector-prompt"
              />
            </div>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="w-full"
              data-testid="button-run-ai-connector"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Gerar gráficos
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold">{result.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {result.widgets.length} widget(s) propostos
              </div>
            </div>
            <div className="space-y-1 max-h-60 overflow-auto">
              {result.widgets.map((w) => (
                <div
                  key={w.id}
                  className="text-[11px] flex items-center justify-between border rounded px-2 py-1"
                >
                  <span className="truncate">{w.title}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">
                    {w.type.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResult(null)} className="flex-1">
                Refazer
              </Button>
              <Button
                onClick={() => {
                  onAddWidgets(result.widgets);
                  toast({ title: `${result.widgets.length} widget(s) adicionados` });
                }}
                className="flex-1"
                data-testid="button-add-ai-widgets"
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar todos
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfigureWidgetDialog({
  source,
  onClose,
  onAdd,
}: {
  source: DataSource;
  onClose: () => void;
  onAdd: (widget: WidgetConfig) => void;
}) {
  const { data, isLoading } = useQuery<SnapshotResp>({
    queryKey: ["/api/datasources", source.id, "data"],
    enabled: true,
  });

  const cols = data && data.rows.length > 0 ? Object.keys(data.rows[0]) : [];
  const numericCols = cols.filter((c) =>
    data?.rows.some((r) => typeof r[c] === "number" || (!isNaN(Number(r[c])) && r[c] !== "" && r[c] !== null))
  );

  const [title, setTitle] = useState(source.name);
  const [widgetType, setWidgetType] = useState<WidgetType>("bar_chart");
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");

  // Auto-pick defaults once data loads
  if (cols.length > 0 && !xCol) {
    setTimeout(() => {
      setXCol(cols[0]);
      setYCol(numericCols.find((c) => c !== cols[0]) || cols[1] || cols[0]);
    }, 0);
  }

  const submit = () => {
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: widgetType,
      title: title || source.name,
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataSource: {
        type: "connector",
        connectorId: source.id,
        xAxisColumn: xCol,
        yAxisColumns: yCol ? [yCol] : [],
      },
    };
    onAdd(widget);
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo widget — {source.name}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando colunas…</p>
        ) : cols.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados nesta fonte. Sincronize primeiro.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-widget-title" />
            </div>

            <div>
              <Label>Tipo</Label>
              <Select value={widgetType} onValueChange={(v) => setWidgetType(v as WidgetType)}>
                <SelectTrigger data-testid="select-widget-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WIDGET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {widgetType !== "kpi_card" && (
              <div>
                <Label>Coluna X (categorias)</Label>
                <Select value={xCol} onValueChange={setXCol}>
                  <SelectTrigger data-testid="select-x-col"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {cols.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Coluna Y (valor)</Label>
              <Select value={yCol} onValueChange={setYCol}>
                <SelectTrigger data-testid="select-y-col"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(numericCols.length > 0 ? numericCols : cols).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {data?.rowCount ?? 0} linhas disponíveis · {cols.length} colunas
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={cols.length === 0 || (widgetType !== "kpi_card" && !xCol) || !yCol} data-testid="button-add-connector-widget">
            Adicionar ao dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
