import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Calendar, Plus, Target, Loader2, ExternalLink, Play, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  subprojectId: string | null;
}

interface PBI { id: string; title: string; status: string; sprintId: string | null; storyPoints: number | null; }

const SPRINT_STATUS_LABEL: Record<string, string> = {
  planning: "Planejamento", active: "Ativa", review: "Em Revisão",
  completed: "Concluída", cancelled: "Cancelada",
};
const SPRINT_STATUS_COLOR: Record<string, string> = {
  planning: "bg-slate-500", active: "bg-green-500", review: "bg-amber-500",
  completed: "bg-blue-500", cancelled: "bg-red-500",
};

interface Props { projectId: string; }

export function ProjectSprints({ projectId }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", goal: "", startDate: "", endDate: "" });

  const { data: sprints = [], isLoading } = useQuery<Sprint[]>({
    queryKey: ["/api/projects", projectId, "sprints"],
  });

  const { data: pbis = [] } = useQuery<PBI[]>({
    queryKey: ["/api/projects", projectId, "pbis"],
  });

  const pbisBySprint = pbis.reduce<Record<string, PBI[]>>((acc, p) => {
    if (p.sprintId) (acc[p.sprintId] ||= []).push(p);
    return acc;
  }, {});

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      // 1) Garante o internal_project deste cliente (idempotente)
      const ctxRes = await apiRequest("POST", `/api/projects/${projectId}/scrum-context/ensure`, {});
      const ctx = await ctxRes.json();
      // 2) Cria sprint vinculada
      const res = await apiRequest("POST", "/api/scrum/sprints", {
        internalProjectId: ctx.internalProjectId,
        name: data.name,
        goal: data.goal || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        status: "planning",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Sprint criada" });
      setDialogOpen(false);
      setForm({ name: "", goal: "", startDate: "", endDate: "" });
    },
    onError: (err: any) => toast({ title: "Erro ao criar sprint", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/scrum/sprints/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Status da sprint atualizado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Sprints do Projeto</h3>
          <Badge variant="outline">{sprints.length} sprint{sprints.length !== 1 ? 's' : ''}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" data-testid="link-global-sprints">
            <Link href="/producao/sprints">
              <ExternalLink className="h-3 w-3 mr-1" />
              Gestão Global
            </Link>
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-new-sprint">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nova Sprint
          </Button>
        </div>
      </div>

      {sprints.length === 0 ? (
        <Card className="border-card-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Target className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="font-semibold mb-2">Nenhuma Sprint</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Crie a primeira sprint manualmente ou use o Agente Scrum no Drive para gerar a estrutura completa.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sprints.map((s) => {
            const sprintPbis = pbisBySprint[s.id] || [];
            const done = sprintPbis.filter(p => p.status === "concluido").length;
            const totalPts = sprintPbis.reduce((sum, p) => sum + (p.storyPoints || 0), 0);
            const pct = sprintPbis.length ? Math.round((done / sprintPbis.length) * 100) : 0;

            return (
              <Card key={s.id} className="border-card-border" data-testid={`sprint-card-${s.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold" data-testid={`text-sprint-name-${s.id}`}>{s.name}</h4>
                      {s.goal && <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">"{s.goal}"</p>}
                    </div>
                    <Badge variant="outline" size="sm">
                      <span className={`w-2 h-2 rounded-full mr-1.5 ${SPRINT_STATUS_COLOR[s.status] || 'bg-gray-500'}`} />
                      {SPRINT_STATUS_LABEL[s.status] || s.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {s.startDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(s.startDate).toLocaleDateString('pt-BR')}
                        {s.endDate && <> → {new Date(s.endDate).toLocaleDateString('pt-BR')}</>}
                      </span>
                    )}
                    <span>{sprintPbis.length} PBI</span>
                    {totalPts > 0 && <span>· {totalPts} pts</span>}
                    <span>· {pct}% concluído</span>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {s.status === "planning" && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => updateStatusMutation.mutate({ id: s.id, status: "active" })}
                        disabled={updateStatusMutation.isPending || sprintPbis.length === 0}
                        data-testid={`button-start-sprint-${s.id}`}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Iniciar
                      </Button>
                    )}
                    {s.status === "active" && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => updateStatusMutation.mutate({ id: s.id, status: "completed" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-complete-sprint-${s.id}`}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Encerrar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Sprint</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-name">Nome *</Label>
              <Input
                id="sprint-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Sprint 1 - Diagnóstico"
                data-testid="input-sprint-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sprint-goal">Objetivo</Label>
              <Textarea
                id="sprint-goal" rows={2}
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
                placeholder="Ex: Mapear processos atuais e identificar gaps"
                data-testid="input-sprint-goal"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="sprint-start">Início</Label>
                <Input
                  id="sprint-start" type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  data-testid="input-sprint-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sprint-end">Fim</Label>
                <Input
                  id="sprint-end" type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  data-testid="input-sprint-end"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-save-sprint"
            >
              {createMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Criar Sprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
