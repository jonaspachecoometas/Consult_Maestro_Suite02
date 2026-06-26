import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { WidgetRenderer } from "@/components/bi/WidgetRenderer";
import { DashboardFilterBar } from "@/components/bi/DashboardFilterBar";
import { DashboardFilterProvider } from "@/components/bi/DashboardFilterContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Loader2, BarChart3 } from "lucide-react";
import type { WidgetConfig, DashboardFilter } from "@shared/schema";
import { GRID_ROW_HEIGHT_PX, GRID_COLUMNS } from "@/components/bi/dnd-types";

interface PublicDash {
  dashboard: {
    name: string;
    layout: WidgetConfig[];
    filters: DashboardFilter;
  };
  tenantId: string;
}

export default function BiPublic() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [submittedPass, setSubmittedPass] = useState("");
  const [requiresPwd, setRequiresPwd] = useState(false);

  const { data, error, isLoading } = useQuery<PublicDash>({
    queryKey: ["bi-public", token, submittedPass],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (submittedPass) headers["x-share-password"] = submittedPass;
      const res = await fetch(`/api/bi/public/${token}`, { headers });
      if (res.status === 401) {
        setRequiresPwd(true);
        throw new Error("requiresPassword");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erro ao carregar");
      }
      return await res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground text-sm">Carregando…</p>
      </div>
    );
  }

  if (requiresPwd && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 max-w-xs mx-auto p-4">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          Este dashboard é protegido por senha.
        </p>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSubmittedPass(password)}
          placeholder="Senha"
          className="text-sm"
          data-testid="input-public-password"
        />
        <Button onClick={() => setSubmittedPass(password)} className="w-full" data-testid="button-submit-public-password">
          Acessar
        </Button>
        {error && error.message !== "requiresPassword" && (
          <p className="text-xs text-destructive">{error.message}</p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2">
        <p className="text-sm text-destructive">{(error as any).message || "Erro"}</p>
      </div>
    );
  }

  if (!data) return null;

  const { dashboard } = data;
  const widgets = Array.isArray(dashboard.layout) ? dashboard.layout : [];
  const enabledFilters = dashboard.filters?.enabledFilters || [];

  return (
    <DashboardFilterProvider enabledFilters={enabledFilters} isPublic publicPassword={submittedPass || undefined}>
      <div className="min-h-screen bg-background flex flex-col" data-testid="bi-public-page">
        <header className="border-b px-6 py-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{dashboard.name}</h1>
          <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide">
            Visão pública
          </span>
        </header>

        <DashboardFilterBar />

        <main className="flex-1 p-4">
          <div className="flex flex-wrap gap-3">
            {widgets.length === 0 && (
              <p className="w-full text-center text-sm text-muted-foreground py-12">
                Nenhum widget configurado.
              </p>
            )}
            {widgets.map((w) => (
              <PublicWidget key={w.id} widget={w} token={token!} />
            ))}
          </div>
        </main>
      </div>
    </DashboardFilterProvider>
  );
}

function PublicWidget({ widget, token }: { widget: WidgetConfig; token: string }) {
  const widthPct = (widget.gridPos.w / GRID_COLUMNS) * 100;
  return (
    <div
      style={{
        width: `calc(${widthPct}% - 0.75rem)`,
        height: `${GRID_ROW_HEIGHT_PX * widget.gridPos.h}px`,
      }}
      data-testid={`public-widget-${widget.id}`}
    >
      <WidgetRenderer widget={widget} isEditMode={false} publicToken={token} />
    </div>
  );
}
