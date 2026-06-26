// Sprint IDE-3 — Status do pipeline do Dev Center.
// Polling em /api/ide/runs com refetchInterval enquanto há runs em execução.

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Sparkles, Hammer, ShieldCheck, Rocket, CheckCircle2, XCircle, Play,
} from "lucide-react";
import { useLocation } from "wouter";

interface IdePipelineRun {
  id: string;
  status: string;
  description?: string | null;
  createdAt?: string;
}

const STATUS_META: Record<string, { label: string; color: string; running: boolean }> = {
  pending: { label: "Aguardando", color: "bg-muted text-muted-foreground", running: true },
  running_architect: { label: "Arquiteto", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300", running: true },
  awaiting_design_approval: { label: "Aprovação design", color: "bg-amber-500/10 text-amber-700 dark:text-amber-300", running: false },
  running_developer: { label: "Desenvolvedor", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300", running: true },
  running_qa: { label: "QA", color: "bg-purple-500/10 text-purple-700 dark:text-purple-300", running: true },
  awaiting_deploy: { label: "Pronto p/ deploy", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", running: false },
  deploying: { label: "Deploy", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300", running: true },
  deployed: { label: "Deployed", color: "bg-emerald-600 text-white", running: false },
  failed: { label: "Falhou", color: "bg-destructive text-destructive-foreground", running: false },
  cancelled: { label: "Cancelado", color: "bg-muted text-muted-foreground", running: false },
};

function statusIcon(s: string) {
  if (s === "deployed") return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
  if (s === "failed" || s === "cancelled") return <XCircle className="h-3 w-3 text-destructive" />;
  if (s === "running_architect") return <Sparkles className="h-3 w-3 animate-pulse text-blue-500" />;
  if (s === "running_developer") return <Hammer className="h-3 w-3 animate-pulse text-blue-500" />;
  if (s === "running_qa") return <ShieldCheck className="h-3 w-3 animate-pulse text-purple-500" />;
  if (s === "deploying") return <Rocket className="h-3 w-3 animate-pulse text-blue-500" />;
  return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
}

export function PipelineStatus() {
  const [, setLocation] = useLocation();
  const runsQuery = useQuery<IdePipelineRun[]>({
    queryKey: ["/api/ide/runs"],
    refetchInterval: (q) => {
      const data = q.state.data as IdePipelineRun[] | undefined;
      const anyRunning = data?.some((r) => STATUS_META[r.status]?.running);
      return anyRunning ? 3000 : 15000;
    },
  });

  const runs = runsQuery.data ?? [];
  const recent = runs.slice(0, 3);
  const activeCount = runs.filter((r) => STATUS_META[r.status]?.running).length;

  return (
    <div className="border-t bg-muted/20 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Play className="h-3 w-3" />
          <span>PIPELINE</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]" data-testid="badge-active-runs">
              {activeCount} ativo{activeCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]"
          onClick={() => setLocation("/dev-center")}
          data-testid="button-open-pipeline"
        >
          abrir
        </Button>
      </div>
      {runsQuery.isLoading ? (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> carregando runs…
        </div>
      ) : recent.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">Nenhum pipeline executado.</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {recent.map((r) => {
            const meta = STATUS_META[r.status] ?? { label: r.status, color: "bg-muted", running: false };
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setLocation(`/dev-center/${r.id}`)}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] hover-elevate"
                data-testid={`pipeline-run-${r.id}`}
              >
                {statusIcon(r.status)}
                <span className="truncate flex-1" title={r.description ?? r.id}>
                  {(r.description ?? r.id).slice(0, 40)}
                </span>
                <span className={`rounded px-1 ${meta.color}`}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
