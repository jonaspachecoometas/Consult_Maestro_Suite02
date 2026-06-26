import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Pencil } from "lucide-react";
import type { WidgetConfig } from "@shared/schema";

interface MigrationRow {
  id: string;
  source_a: string;
  source_b: string;
  source_a_name?: string | null;
  source_b_name?: string | null;
  dimension: string;
  count_a: number;
  count_b: number;
  matched: number;
  missing_in_b: number;
  missing_in_a: number;
  observed_at: string;
}

export function MigrationMonitorWidget({
  widget, isEditMode, onRemove, onEdit,
}: {
  widget: WidgetConfig;
  isEditMode?: boolean;
  onRemove?: (id: string) => void;
  onEdit?: (widget: WidgetConfig) => void;
}) {
  const { data, isLoading } = useQuery<MigrationRow[]>({
    queryKey: ["/api/bi/migration-monitor"],
  });

  return (
    <Card className="h-full relative group overflow-hidden" data-testid={`widget-${widget.id}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <span data-testid={`text-widget-title-${widget.id}`}>{widget.title}</span>
          <Badge variant="outline" className="text-[10px]">SCD2</Badge>
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
            Sem migrações detectadas. Rode o ETL após cadastrar 2+ fontes com mapping <code>kind=dim_client</code>.
          </div>
        )}
        {!isLoading && (data ?? []).length > 0 && (
          <div className="space-y-2">
            {data!.map((m) => {
              const total = Math.max(m.count_a, m.count_b, 1);
              const pct = Math.round((m.matched / total) * 100);
              return (
                <div key={m.id} className="border rounded p-3 space-y-1" data-testid={`row-migration-${m.id}`}>
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span>{m.source_a_name || m.source_a.slice(0, 8)}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{m.source_b_name || m.source_b.slice(0, 8)}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px]">{m.dimension}</Badge>
                    <span className="ml-auto text-[11px] tabular-nums">
                      <strong data-testid={`text-matched-${m.id}`}>{m.matched}</strong>/{total} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span>fonte A: {m.count_a}</span>
                    <span>fonte B: {m.count_b}</span>
                    {m.missing_in_b > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">faltam em B: {m.missing_in_b}</span>
                    )}
                    {m.missing_in_a > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">faltam em A: {m.missing_in_a}</span>
                    )}
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
