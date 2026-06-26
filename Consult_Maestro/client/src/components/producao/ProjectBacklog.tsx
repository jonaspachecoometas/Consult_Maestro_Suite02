import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Target, Zap, Bug, FileText, Wrench, GraduationCap, Users, HelpCircle, Calendar,
  Plus, ExternalLink, Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PBI {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  storyPoints: number | null;
  estimatedHours: number | null;
  subprojectId: string | null;
  sprintId: string | null;
  dueDate: string | null;
}

interface Sprint { id: string; name: string; }

const TYPE_ICONS: Record<string, any> = {
  feature: Zap, bug: Bug, task: Target, analysis: HelpCircle,
  documentation: FileText, training: GraduationCap, support: Users, improvement: Wrench, meeting: Calendar,
};

const STATUS_COLUMNS = [
  { key: "backlog", label: "Backlog", color: "bg-slate-500" },
  { key: "selecionado", label: "Selecionado", color: "bg-blue-500" },
  { key: "em_execucao", label: "Em Execução", color: "bg-amber-500" },
  { key: "em_revisao", label: "Em Revisão", color: "bg-violet-500" },
  { key: "aguardando_validacao", label: "Aguardando Validação", color: "bg-cyan-500" },
  { key: "concluido", label: "Concluído", color: "bg-green-500" },
  { key: "bloqueado", label: "Bloqueado", color: "bg-red-500" },
] as const;

const PRIORITY_COLOR: Record<string, string> = {
  critical: "border-red-500 text-red-600",
  high: "border-orange-500 text-orange-600",
  medium: "border-blue-500 text-blue-600",
  low: "border-slate-400 text-slate-500",
};

interface Props { projectId: string; }

export function ProjectBacklog({ projectId }: Props) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: pbis = [], isLoading } = useQuery<PBI[]>({
    queryKey: ["/api/projects", projectId, "pbis"],
  });

  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/projects", projectId, "sprints"],
  });

  const sprintMap = sprints.reduce<Record<string, string>>((acc, s) => {
    acc[s.id] = s.name; return acc;
  }, {});

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/scrum/backlog/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pbis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({ title: "Status atualizado" });
    },
    onError: (err: any) => toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" }),
  });

  const filtered = statusFilter === "all" ? pbis : pbis.filter(p => p.status === statusFilter);

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (pbis.length === 0) {
    return (
      <Card className="border-card-border border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Target className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <h3 className="font-semibold mb-2">Backlog vazio</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            Use o <strong>Agente Scrum</strong> na aba Drive para gerar PBIs a partir de um documento,
            ou crie manualmente no módulo de Backlog global.
          </p>
          <Button asChild variant="outline" size="sm" data-testid="link-global-backlog">
            <Link href="/producao/backlog">
              <ExternalLink className="h-3 w-3 mr-1" />
              Abrir Backlog Global
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Agrupa por status
  const grouped = STATUS_COLUMNS.reduce<Record<string, PBI[]>>((acc, col) => {
    acc[col.key] = filtered.filter(p => p.status === col.key);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Backlog do Projeto</h3>
          <Badge variant="outline" data-testid="badge-pbi-count">
            {pbis.length} PBI{pbis.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filtrar status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {STATUS_COLUMNS.map(c => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm" data-testid="link-global-backlog-top">
            <Link href="/producao/backlog">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Gerenciar
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {STATUS_COLUMNS.filter(c => grouped[c.key].length > 0 || statusFilter === c.key).map(col => (
          <div key={col.key} className="space-y-2" data-testid={`column-${col.key}`}>
            <div className="flex items-center justify-between sticky top-0 bg-background py-1">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <h4 className="font-medium text-sm">{col.label}</h4>
              </div>
              <Badge variant="secondary" size="sm">{grouped[col.key].length}</Badge>
            </div>
            {grouped[col.key].map(pbi => {
              const Icon = TYPE_ICONS[pbi.type] || Target;
              return (
                <Card key={pbi.id} className="border-card-border" data-testid={`pbi-card-${pbi.id}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="text-sm font-medium line-clamp-2 flex-1">{pbi.title}</p>
                    </div>
                    {pbi.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{pbi.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="outline" size="sm"
                        className={`${PRIORITY_COLOR[pbi.priority] || ""} text-[10px]`}
                      >
                        {pbi.priority}
                      </Badge>
                      {pbi.storyPoints != null && (
                        <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                          {pbi.storyPoints} pt
                        </Badge>
                      )}
                      {pbi.sprintId && sprintMap[pbi.sprintId] && (
                        <Badge variant="secondary" size="sm" className="text-[10px]">
                          {sprintMap[pbi.sprintId]}
                        </Badge>
                      )}
                    </div>
                    <Select
                      value={pbi.status}
                      onValueChange={(v) => updateStatusMutation.mutate({ id: pbi.id, status: v })}
                      disabled={updateStatusMutation.isPending}
                    >
                      <SelectTrigger className="h-7 text-xs" data-testid={`select-pbi-status-${pbi.id}`}>
                        {updateStatusMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : <SelectValue />}
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_COLUMNS.map(c => (
                          <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
