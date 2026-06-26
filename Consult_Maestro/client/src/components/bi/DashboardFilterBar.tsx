import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, X } from "lucide-react";
import { useDashboardFilter } from "./DashboardFilterContext";

export function DashboardFilterBar() {
  const ctx = useDashboardFilter();

  const isPublic = !!ctx?.isPublic;
  const { data: clients } = useQuery<any[]>({
    queryKey: ["/api/clients"],
    enabled: !!ctx?.enabledFilters.includes("client") && !isPublic,
  });
  const { data: projects } = useQuery<any[]>({
    queryKey: ["/api/projects", "?scope=production"],
    enabled: !!ctx?.enabledFilters.includes("project") && !isPublic,
  });

  if (!ctx || ctx.enabledFilters.length === 0) return null;

  const hasAny = Object.values(ctx.values).some((v) => v && String(v).length > 0);

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b bg-muted/20" data-testid="dashboard-filter-bar">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Filter className="h-3.5 w-3.5" /> Filtros
      </div>

      {ctx.enabledFilters.includes("daterange") && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">De</Label>
            <Input
              type="date"
              value={ctx.values.startDate || ""}
              onChange={(e) => ctx.setValue("startDate", e.target.value)}
              className="h-8 w-36 text-sm"
              data-testid="input-filter-start-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Até</Label>
            <Input
              type="date"
              value={ctx.values.endDate || ""}
              onChange={(e) => ctx.setValue("endDate", e.target.value)}
              className="h-8 w-36 text-sm"
              data-testid="input-filter-end-date"
            />
          </div>
        </>
      )}

      {ctx.enabledFilters.includes("client") && (
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cliente</Label>
          <Select
            value={ctx.values.clientId || "__all__"}
            onValueChange={(v) => ctx.setValue("clientId", v === "__all__" ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-48 text-sm" data-testid="select-filter-client">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {(clients || []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name || c.razaoSocial || c.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {ctx.enabledFilters.includes("project") && (
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Projeto</Label>
          <Select
            value={ctx.values.projectId || "__all__"}
            onValueChange={(v) => ctx.setValue("projectId", v === "__all__" ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-48 text-sm" data-testid="select-filter-project">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {(projects || []).map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name || p.title || p.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {ctx.enabledFilters.includes("status") && (
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</Label>
          <Input
            value={ctx.values.status || ""}
            onChange={(e) => ctx.setValue("status", e.target.value)}
            placeholder="ex.: andamento"
            className="h-8 w-36 text-sm"
            data-testid="input-filter-status"
          />
        </div>
      )}

      {hasAny && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={ctx.reset}
          data-testid="button-clear-filters"
        >
          <X className="h-3 w-3" /> Limpar
        </Button>
      )}
    </div>
  );
}
