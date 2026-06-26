import { useState, useEffect } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { WidgetRenderer } from "./WidgetRenderer";
import type { WidgetConfig, WidgetType } from "@shared/schema";

interface Props {
  widget: WidgetConfig | null;
  open: boolean;
  onClose: () => void;
  onSave: (updated: WidgetConfig) => void;
}

const TYPES: { v: WidgetType; label: string }[] = [
  { v: "kpi_card", label: "KPI" },
  { v: "big_number", label: "Big Number" },
  { v: "bar_chart", label: "Barras" },
  { v: "line_chart", label: "Linha" },
  { v: "area_chart", label: "Área" },
  { v: "pie_chart", label: "Pizza" },
  { v: "donut_chart", label: "Donut" },
  { v: "radar_chart", label: "Radar" },
  { v: "waterfall_chart", label: "Cascata" },
  { v: "funnel_chart", label: "Funil" },
  { v: "gauge_chart", label: "Medidor" },
  { v: "mixed_timeseries", label: "Misto (Barra+Linha)" },
  { v: "scatter_plot", label: "Dispersão" },
  { v: "data_table", label: "Tabela" },
];

export function WidgetEditor({ widget, open, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<WidgetConfig | null>(null);

  useEffect(() => {
    if (widget) setDraft({ ...widget, options: { ...(widget.options ?? {}) } });
    else setDraft(null);
  }, [widget]);

  if (!draft) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent />
      </Sheet>
    );
  }

  const update = (p: Partial<WidgetConfig>) =>
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
  const updateOpt = (key: string, val: any) =>
    setDraft((prev) =>
      prev ? { ...prev, options: { ...(prev.options ?? {}), [key]: val } } : prev,
    );
  const updateGrid = (key: "w" | "h", val: number) =>
    setDraft((prev) =>
      prev ? { ...prev, gridPos: { ...prev.gridPos, [key]: val } } : prev,
    );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto" data-testid="widget-editor">
        <SheetHeader>
          <SheetTitle>Editar widget</SheetTitle>
        </SheetHeader>

        {/* Live preview */}
        <div className="my-4 h-[220px] border rounded-xl overflow-hidden bg-muted/20 pointer-events-none">
          <WidgetRenderer widget={draft} isEditMode={false} />
        </div>

        <div className="space-y-5 pb-6">
          <div className="space-y-1.5">
            <Label className="text-xs">Título</Label>
            <Input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="h-8 text-sm"
              data-testid="input-widget-title"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tipo</Label>
            <Select value={draft.type} onValueChange={(v) => update({ type: v as WidgetType })}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-widget-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Largura ({draft.gridPos.w})</Label>
              <Slider
                min={2} max={12} step={1}
                value={[draft.gridPos.w]}
                onValueChange={(vs) => updateGrid("w", vs[0])}
                data-testid="slider-widget-w"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Altura ({draft.gridPos.h})</Label>
              <Slider
                min={2} max={8} step={1}
                value={[draft.gridPos.h]}
                onValueChange={(vs) => updateGrid("h", vs[0])}
                data-testid="slider-widget-h"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Cor principal</Label>
            <Input
              type="color"
              value={draft.options?.color || "#5B4FD4"}
              onChange={(e) => updateOpt("color", e.target.value)}
              className="h-8 w-16 p-1"
              data-testid="input-widget-color"
            />
          </div>

          {draft.type === "kpi_card" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Prefixo</Label>
                <Input
                  value={draft.options?.valuePrefix || ""}
                  onChange={(e) => updateOpt("valuePrefix", e.target.value)}
                  placeholder="R$"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sufixo</Label>
                <Input
                  value={draft.options?.valueSuffix || ""}
                  onChange={(e) => updateOpt("valueSuffix", e.target.value)}
                  placeholder="%"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <div>
              <Label className="text-xs">Ignorar filtros globais</Label>
              <p className="text-[11px] text-muted-foreground">
                Widget não reage à barra de filtros do dashboard.
              </p>
            </div>
            <Switch
              checked={!!draft.ignoreGlobalFilters}
              onCheckedChange={(v) => update({ ignoreGlobalFilters: v })}
              data-testid="switch-ignore-filters"
            />
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit-widget">
            Cancelar
          </Button>
          <Button onClick={() => { onSave(draft); onClose(); }} data-testid="button-save-edit-widget">
            Aplicar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
