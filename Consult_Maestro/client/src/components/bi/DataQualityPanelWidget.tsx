import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Pencil } from "lucide-react";
import type { WidgetConfig } from "@shared/schema";

interface Finding {
  id: string;
  metric_id: string;
  source_a: string;
  source_b: string;
  source_a_name?: string | null;
  source_b_name?: string | null;
  value_a: string | number | null;
  value_b: string | number | null;
  diff: string | number | null;
  diff_pct: string | number | null;
  severity: string;
  explanation: string | null;
  observed_at: string;
}

const SEV_CLASS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  warning:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  info:     "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

function fmt(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function DataQualityPanelWidget({
  widget, isEditMode, onRemove, onEdit,
}: {
  widget: WidgetConfig;
  isEditMode?: boolean;
  onRemove?: (id: string) => void;
  onEdit?: (widget: WidgetConfig) => void;
}) {
  const { data, isLoading } = useQuery<Finding[]>({
    queryKey: ["/api/bi/data-quality"],
  });

  return (
    <Card className="h-full relative group overflow-hidden" data-testid={`widget-${widget.id}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <span data-testid={`text-widget-title-${widget.id}`}>{widget.title}</span>
          <Badge variant="outline" className="text-[10px]">cross-source</Badge>
          {isEditMode && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {onEdit && (
                <button onClick={() => onEdit(widget)} className="opacity-60 hover:opacity-100 text-muted-foreground" title="Editar widget" data-testid={`button-edit-widget-${widget.id}`}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              <button onClick={() => onRemove?.(widget.id)} className="opacity-60 hover:opacity-100 text-destructive text-xs" data-testid={`button-remove-widget-${widget.id}`}>✕</button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 overflow-auto max-h-[calc(100%-3rem)]">
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && (data ?? []).length === 0 && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Sem discrepâncias detectadas. Rode o ETL após cadastrar fontes com receita.
          </div>
        )}
        {!isLoading && (data ?? []).length > 0 && (
          <div className="space-y-2">
            {data!.map((f) => (
              <div key={f.id} className="border rounded p-3 space-y-1" data-testid={`row-finding-${f.id}`}>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={`text-[10px] ${SEV_CLASS[f.severity] || ""}`}>
                    {f.severity}
                  </Badge>
                  <code className="text-[11px]">{f.metric_id}</code>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(f.observed_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="text-xs">
                  <strong>{f.source_a_name || f.source_a.slice(0, 8)}</strong>: {fmt(f.value_a)}
                  {" "}vs{" "}
                  <strong>{f.source_b_name || f.source_b.slice(0, 8)}</strong>: {fmt(f.value_b)}
                  <span className="ml-2 text-muted-foreground">
                    Δ {fmt(f.diff)} ({fmt(f.diff_pct)}%)
                  </span>
                </div>
                {f.explanation && (
                  <div className="text-[11px] text-muted-foreground italic">{f.explanation}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
