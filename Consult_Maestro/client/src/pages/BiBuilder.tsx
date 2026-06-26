import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { AgentPickerForBi } from "@/components/AgentPickerForBi";
import {
  DndContext, useDroppable, type DragEndEvent, PointerSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Eye, Pencil, Trash2, BarChart3, Filter, Share2 } from "lucide-react";
import { CatalogItem } from "@/components/bi/CatalogItem";
import { SortableWidget } from "@/components/bi/SortableWidget";
import { SqlAgentPanel } from "@/components/bi/SqlAgentPanel";
import { BiAgentPanel } from "@/components/bi/BiAgentPanel";
import { ConnectorsPanel } from "@/components/bi/ConnectorsPanel";
import { MultiSourcePanel } from "@/components/bi/MultiSourcePanel";
import { WidgetEditor } from "@/components/bi/WidgetEditor";
import { ShareDialog } from "@/components/bi/ShareDialog";
import {
  DashboardFilterProvider,
} from "@/components/bi/DashboardFilterContext";
import { DashboardFilterBar } from "@/components/bi/DashboardFilterBar";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DND_TYPE, DEFAULT_GRID_POS, GRID_COLUMNS,
} from "@/components/bi/dnd-types";
import type {
  WidgetConfig, BiDashboard, SqlQuery, DataSourceRef, DashboardFilter,
} from "@shared/schema";

type EnabledFilter = DashboardFilter["enabledFilters"][number];
const FILTER_OPTIONS: { v: EnabledFilter; label: string }[] = [
  { v: "daterange", label: "Período" },
  { v: "client", label: "Cliente" },
  { v: "project", label: "Projeto" },
  { v: "status", label: "Status" },
];

interface MetricDescriptor {
  key: string;
  label: string;
  description: string;
  defaultWidget: WidgetConfig["type"];
  group: string;
}

function getNextRow(widgets: WidgetConfig[]): number {
  if (widgets.length === 0) return 0;
  return Math.max(...widgets.map((w) => w.gridPos.y + w.gridPos.h));
}

const GridDropZone = ({ children }: { children: React.ReactNode }) => {
  const { setNodeRef, isOver } = useDroppable({ id: "bi-grid" });
  return (
    <div
      ref={setNodeRef}
      data-testid="bi-grid"
      className={`flex flex-wrap gap-3 min-h-[300px] p-4 rounded-lg border-2 border-dashed transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
      }`}
    >
      {children}
    </div>
  );
};

export default function BiBuilder() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditMode, setIsEditMode] = useState(true);
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const activeWidgetType = useMemo(
    () => widgets.find((w) => w.id === selectedWidgetId)?.type as string | undefined,
    [widgets, selectedWidgetId],
  );
  const handleAgentSelected = (slug: string, _name: string, widgetType?: string) => {
    // Prefer the widget that originated the picker click (compact mode on
    // a specific widget); fallback to the globally selected widget.
    const ctx = widgetType ?? activeWidgetType;
    setLocation(`/super-agente?agent=${encodeURIComponent(slug)}${ctx ? `&widget=${encodeURIComponent(ctx)}` : ""}`);
  };
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showFilterConfig, setShowFilterConfig] = useState(false);
  const [enabledFilters, setEnabledFilters] = useState<EnabledFilter[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Dashboards query (auto-creates default if none).
  const { data: dashboards } = useQuery<BiDashboard[]>({
    queryKey: ["/api/bi/dashboards"],
  });

  const { data: catalog } = useQuery<MetricDescriptor[]>({
    queryKey: ["/api/bi/metrics-catalog"],
  });

  const { data: savedQueries } = useQuery<SqlQuery[]>({
    queryKey: ["/api/sql"],
  });

  // Resolve active dashboard.
  useEffect(() => {
    if (!dashboards || dashboards.length === 0) return;
    // Permite abrir dashboard específico via ?dashboardId=xxx (ex: vindo do Atlas)
    const urlId = new URLSearchParams(window.location.search).get("dashboardId");
    const fromUrl = urlId ? dashboards.find((d) => d.id === urlId) : null;
    const def = fromUrl || dashboards.find((d) => d.isDefault === 1) || dashboards[0];
    if (def.id !== dashboardId) {
      setDashboardId(def.id);
      setWidgets(Array.isArray(def.layout) ? def.layout : []);
      const f = (def as any).filters as DashboardFilter | null;
      setEnabledFilters(f?.enabledFilters || []);
    }
  }, [dashboards, dashboardId]);

  // Auto-create default dashboard if list is empty.
  const createDashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bi/dashboards", {
        name: "Meu Dashboard",
        layout: [],
        isDefault: 1,
      });
      return (await res.json()) as BiDashboard;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bi/dashboards"] });
    },
  });

  useEffect(() => {
    if (dashboards && dashboards.length === 0 && !createDashboardMutation.isPending) {
      createDashboardMutation.mutate();
    }
  }, [dashboards]);

  // Track container width for responsive grid math.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setContainerWidth(el.clientWidth - 32); // minus padding
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-save (debounced 500ms) on widgets change. We mark the layout as
  // saved only after the PATCH succeeds, so a transient failure schedules
  // a fresh attempt the next time the user touches the layout.
  const lastSavedRef = useRef<string>("");
  const saveMutation = useMutation({
    mutationFn: async (payload: { layout: WidgetConfig[]; serialized: string; filters?: DashboardFilter }) => {
      if (!dashboardId) return payload;
      await apiRequest("PATCH", `/api/bi/dashboards/${dashboardId}`, {
        layout: payload.layout,
        ...(payload.filters ? { filters: payload.filters } : {}),
      });
      return payload;
    },
    onSuccess: (payload) => {
      if (payload?.serialized) lastSavedRef.current = payload.serialized;
    },
    onError: () => {
      toast({
        title: "Não foi possível salvar o layout",
        description: "Tentaremos novamente na próxima alteração.",
        variant: "destructive",
      });
    },
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dashboardId) return;
    const filters: DashboardFilter = { enabledFilters };
    const serialized = JSON.stringify({ widgets, filters });
    if (serialized === lastSavedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMutation.mutate({ layout: widgets, serialized, filters });
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, dashboardId, enabledFilters]);

  const handleSaveWidget = (updated: WidgetConfig) =>
    setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));

  const toggleFilter = (f: EnabledFilter) =>
    setEnabledFilters((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as any;
    const overData = over.data.current as any;

    // Function 3 — combine series (catalog item dropped on a chart).
    if (
      activeData?.type === DND_TYPE.CATALOG_ITEM &&
      overData?.type === DND_TYPE.WIDGET_COMBINE
    ) {
      const targetId = overData.widgetId;
      setWidgets((prev) =>
        prev.map((w) => {
          if (w.id !== targetId) return w;
          if (w.type !== "bar_chart" && w.type !== "line_chart") return w;
          const ds: DataSourceRef =
            w.dataSource ??
            ({ type: "internal", metricKey: w.metricKey || "", metricKeys: w.metricKeys || (w.metricKey ? [w.metricKey] : []) } as DataSourceRef);
          if (ds.type !== "internal") return w;
          const current = ds.metricKeys?.length ? ds.metricKeys : [ds.metricKey];
          if (current.includes(activeData.metricKey)) return w;
          if (current.length >= 4) {
            toast({ title: "Limite de 4 séries", description: "Combine no máximo 4 métricas." });
            return w;
          }
          return {
            ...w,
            dataSource: {
              type: "internal",
              metricKey: ds.metricKey,
              metricKeys: [...current, activeData.metricKey],
            },
          };
        }),
      );
      return;
    }

    // Function 1 — catalog → grid (new widget).
    if (activeData?.type === DND_TYPE.CATALOG_ITEM && over.id === "bi-grid") {
      const defaults = DEFAULT_GRID_POS[activeData.defaultWidget as keyof typeof DEFAULT_GRID_POS];
      const newWidget: WidgetConfig = {
        id: crypto.randomUUID(),
        type: activeData.defaultWidget,
        title: activeData.defaultTitle,
        gridPos: { x: 0, y: getNextRow(widgets), ...defaults },
        dataSource: {
          type: "internal",
          metricKey: activeData.metricKey,
          metricKeys: [activeData.metricKey],
        },
      };
      setWidgets((prev) => [...prev, newWidget]);
      return;
    }

    // Function 2 — reorder existing widgets.
    if (activeData?.type === DND_TYPE.WIDGET && active.id !== over.id) {
      const oldIndex = widgets.findIndex((w) => w.id === active.id);
      const newIndex = widgets.findIndex((w) => w.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        setWidgets((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const handleRemove = (id: string) =>
    setWidgets((prev) => prev.filter((w) => w.id !== id));

  const handleResize = (id: string, w: number, h: number) =>
    setWidgets((prev) => prev.map((x) => (x.id === id ? { ...x, gridPos: { ...x.gridPos, w, h } } : x)));

  const handleAddSqlWidget = (widget: WidgetConfig) =>
    setWidgets((prev) => [...prev, { ...widget, gridPos: { ...widget.gridPos, y: getNextRow(prev) } }]);

  const handleAddAgentWidgets = (incoming: WidgetConfig[]) =>
    setWidgets((prev) => {
      let baseY = getNextRow(prev);
      const placed = incoming.map((w) => {
        const next = { ...w, gridPos: { ...w.gridPos, y: baseY + (w.gridPos.y || 0) } };
        return next;
      });
      // Normalize so the pasted block sits right after current widgets.
      return [...prev, ...placed];
    });

  const groupedCatalog = useMemo(() => {
    if (!catalog) return [];
    const groups = new Map<string, MetricDescriptor[]>();
    for (const m of catalog) {
      if (!groups.has(m.group)) groups.set(m.group, []);
      groups.get(m.group)!.push(m);
    }
    return Array.from(groups.entries());
  }, [catalog]);

  return (
    <DashboardFilterProvider enabledFilters={enabledFilters}>
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full">
        {/* Sidebar */}
        <aside className="w-72 border-r bg-muted/20 overflow-y-auto" data-testid="bi-sidebar">
          <Tabs defaultValue="catalog" className="w-full">
            <TabsList className="grid w-full grid-cols-4 grid-rows-2 h-auto gap-1 p-1 rounded-none">
              <TabsTrigger value="catalog" className="text-xs px-1 py-1.5" data-testid="tab-catalog">Catálogo</TabsTrigger>
              <TabsTrigger value="connectors" className="text-xs px-1 py-1.5" data-testid="tab-connectors">Conectores</TabsTrigger>
              <TabsTrigger value="multi" className="text-xs px-1 py-1.5" data-testid="tab-multi">Multi</TabsTrigger>
              <TabsTrigger value="agentes" className="text-xs px-1 py-1.5" data-testid="tab-agentes">Agentes</TabsTrigger>
              <TabsTrigger value="ia" className="text-xs px-1 py-1.5" data-testid="tab-ia">IA</TabsTrigger>
              <TabsTrigger value="sql" className="text-xs px-1 py-1.5" data-testid="tab-sql">SQL</TabsTrigger>
              <TabsTrigger value="saved" className="text-xs px-1 py-1.5" data-testid="tab-saved">Salvas</TabsTrigger>
            </TabsList>

            <TabsContent value="catalog" className="p-3 space-y-4 mt-0">
              {groupedCatalog.map(([group, items]) => (
                <div key={group}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {group}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((m) => (
                      <CatalogItem
                        key={m.key}
                        metricKey={m.key}
                        label={m.label}
                        description={m.description}
                        defaultWidget={m.defaultWidget}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="connectors" className="p-3 mt-0">
              <ConnectorsPanel onAddWidget={handleAddSqlWidget} />
            </TabsContent>

            <TabsContent value="multi" className="p-3 mt-0">
              <MultiSourcePanel onAddWidget={handleAddSqlWidget} />
            </TabsContent>

            <TabsContent value="agentes" className="p-3 mt-0">
              <AgentPickerForBi
                activeWidgetType={activeWidgetType}
                onAgentSelected={handleAgentSelected}
              />
            </TabsContent>

            <TabsContent value="ia" className="p-3 mt-0">
              <BiAgentPanel onAddWidgets={handleAddAgentWidgets} />
            </TabsContent>

            <TabsContent value="sql" className="p-3 mt-0">
              <SqlAgentPanel onAddWidget={handleAddSqlWidget} />
            </TabsContent>

            <TabsContent value="saved" className="p-3 space-y-2 mt-0">
              {(!savedQueries || savedQueries.length === 0) && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  Nenhuma consulta salva. Use a aba SQL IA.
                </div>
              )}
              {savedQueries?.map((q) => (
                <Card key={q.id} data-testid={`saved-query-${q.id}`}>
                  <CardContent className="p-2 space-y-1">
                    <div className="text-xs font-medium truncate">{q.name}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {q.description || q.agentPrompt}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] flex-1"
                        onClick={() => {
                          const widget: WidgetConfig = {
                            id: crypto.randomUUID(),
                            type: "bar_chart",
                            title: q.name || "Análise SQL",
                            gridPos: { x: 0, y: getNextRow(widgets), w: 6, h: 4 },
                            dataSource: {
                              type: "sql_agent",
                              sqlQueryId: q.id,
                              xAxisColumn: q.xAxisColumn || undefined,
                              yAxisColumns: q.yAxisColumns || [],
                            },
                          };
                          handleAddSqlWidget(widget);
                        }}
                        data-testid={`button-add-saved-${q.id}`}
                      >
                        Usar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              <h1 className="text-lg font-semibold">BI Builder</h1>
              {saveMutation.isPending && (
                <Badge variant="outline" className="text-[10px]">salvando…</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShowFilterConfig(true)}
                data-testid="button-config-filters"
              >
                <Filter className="h-3.5 w-3.5" /> Filtros
                {enabledFilters.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">{enabledFilters.length}</Badge>
                )}
              </Button>
              {dashboardId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowShare(true)}
                  data-testid="button-share-dashboard"
                >
                  <Share2 className="h-3.5 w-3.5" /> Compartilhar
                </Button>
              )}
              <Button
                variant={isEditMode ? "default" : "outline"}
                size="sm"
                onClick={() => setIsEditMode((v) => !v)}
                data-testid="button-toggle-edit-mode"
              >
                {isEditMode ? <Eye className="h-4 w-4 mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
                {isEditMode ? "Modo visualização" : "Modo edição"}
              </Button>
            </div>
          </div>

          <DashboardFilterBar />

          <div ref={containerRef} className="flex-1 overflow-auto p-4">
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <GridDropZone>
                {widgets.length === 0 && (
                  <div className="w-full text-center py-12 text-sm text-muted-foreground">
                    Arraste métricas do painel à esquerda para começar.
                  </div>
                )}
                {widgets.map((w) => (
                  <SortableWidget
                    key={w.id}
                    widget={w}
                    isEditMode={isEditMode}
                    containerWidth={containerWidth}
                    onRemove={handleRemove}
                    onResize={handleResize}
                    onEdit={setEditingWidget}
                    isSelected={selectedWidgetId === w.id}
                    onSelect={() => setSelectedWidgetId(w.id)}
                    onAgentSelected={handleAgentSelected}
                  />
                ))}
              </GridDropZone>
            </SortableContext>
          </div>
        </div>
      </div>

      <WidgetEditor
        widget={editingWidget}
        open={!!editingWidget}
        onClose={() => setEditingWidget(null)}
        onSave={handleSaveWidget}
      />

      <ShareDialog
        dashboardId={dashboardId}
        open={showShare}
        onClose={() => setShowShare(false)}
      />

      <Sheet open={showFilterConfig} onOpenChange={(o) => !o && setShowFilterConfig(false)}>
        <SheetContent data-testid="filter-config-sheet">
          <SheetHeader>
            <SheetTitle>Filtros do dashboard</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-4">
            <p className="text-xs text-muted-foreground">
              Selecione quais filtros aparecem na barra superior. Widgets podem optar por ignorá-los individualmente.
            </p>
            {FILTER_OPTIONS.map((opt) => (
              <div
                key={opt.v}
                className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                data-testid={`row-filter-opt-${opt.v}`}
                onClick={() => toggleFilter(opt.v)}
              >
                <Checkbox
                  id={`filter-${opt.v}`}
                  checked={enabledFilters.includes(opt.v)}
                  onCheckedChange={() => toggleFilter(opt.v)}
                  onClick={(e) => e.stopPropagation()}
                />
                <Label htmlFor={`filter-${opt.v}`} className="text-sm cursor-pointer pointer-events-none">{opt.label}</Label>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </DndContext>
    </DashboardFilterProvider>
  );
}
