import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Folder, Calendar, ChevronRight, ChevronDown,
  Target, Zap, Bug, FileText, Wrench, GraduationCap, Users, HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Subproject {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  ordem: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  color: string | null;
}

interface Task {
  id: string;
  title: string;
  status: string;
  subprojectId: string | null;
}

interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  subprojectId: string | null;
}

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
}

const PBI_TYPE_ICONS: Record<string, any> = {
  feature: Zap, bug: Bug, task: Target, analysis: HelpCircle,
  documentation: FileText, training: GraduationCap, support: Users, improvement: Wrench, meeting: Calendar,
};
const PBI_STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog", selecionado: "Selecionado", em_andamento: "Em andamento",
  em_revisao: "Em revisão", concluido: "Concluído", cancelado: "Cancelado",
};
const PBI_STATUS_COLOR: Record<string, string> = {
  backlog: "bg-slate-500", selecionado: "bg-blue-500", em_andamento: "bg-amber-500",
  em_revisao: "bg-violet-500", concluido: "bg-green-500", cancelado: "bg-red-500",
};
const PBI_PRIORITY_COLOR: Record<string, string> = {
  critical: "border-red-500 text-red-600",
  high: "border-orange-500 text-orange-600",
  medium: "border-blue-500 text-blue-600",
  low: "border-slate-400 text-slate-500",
};

const STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  concluido: "Concluído",
  pausado: "Pausado",
};

const STATUS_COLORS: Record<string, string> = {
  ativo: "bg-blue-500",
  concluido: "bg-green-500",
  pausado: "bg-yellow-500",
};

const COLOR_PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

export function SubprojectsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subproject | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: list = [], isLoading } = useQuery<Subproject[]>({
    queryKey: ["/api/projects", projectId, "subprojects"],
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/projects", projectId, "tasks"],
  });

  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/projects", projectId, "sprints"],
  });

  const { data: pbis = [] } = useQuery<PBI[]>({
    queryKey: ["/api/projects", projectId, "pbis"],
  });

  const tasksBySub = tasks.reduce<Record<string, Task[]>>((acc, t) => {
    const k = t.subprojectId || "_none";
    (acc[k] ||= []).push(t);
    return acc;
  }, {});

  const sprintsBySub = sprints.reduce<Record<string, Sprint[]>>((acc, s) => {
    const k = s.subprojectId || "_none";
    (acc[k] ||= []).push(s);
    return acc;
  }, {});

  const pbisBySprint = pbis.reduce<Record<string, PBI[]>>((acc, p) => {
    const k = p.sprintId || "_none";
    (acc[k] ||= []).push(p);
    return acc;
  }, {});

  const pbisBySub = pbis.reduce<Record<string, PBI[]>>((acc, p) => {
    const k = p.subprojectId || "_none";
    (acc[k] ||= []).push(p);
    return acc;
  }, {});

  const upsertMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = editing
        ? `/api/projects/${projectId}/subprojects/${editing.id}`
        : `/api/projects/${projectId}/subprojects`;
      const res = await apiRequest(editing ? "PATCH" : "POST", url, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "subprojects"] });
      setDialogOpen(false);
      setEditing(null);
      toast({ title: editing ? "Subprojeto atualizado" : "Subprojeto criado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/subprojects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "subprojects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "tasks"] });
      toast({ title: "Subprojeto removido" });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim() || null,
      startDate: String(fd.get("startDate") || "") || null,
      endDate: String(fd.get("endDate") || "") || null,
      color: String(fd.get("color") || "") || null,
      status: String(fd.get("status") || "ativo"),
    };
    if (!data.name) return;
    upsertMutation.mutate(data);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Subprojetos</h3>
          <p className="text-sm text-muted-foreground">Organize fases ou módulos do projeto.</p>
        </div>
        <Button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          data-testid="button-new-subproject"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Subprojeto
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : list.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Folder className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2">Nenhum subprojeto</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Crie subprojetos para organizar fases (ex: Diagnóstico, Implementação, Go Live).
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((sp) => {
            const subSprints = sprintsBySub[sp.id] || [];
            const subPbis = pbisBySub[sp.id] || [];
            const done = subPbis.filter(p => p.status === "concluido").length;
            const pct = subPbis.length ? Math.round((done / subPbis.length) * 100) : 0;
            const totalPoints = subPbis.reduce((sum, p) => sum + (p.storyPoints || 0), 0);
            const isOpen = expanded[sp.id] !== false; // default open

            return (
              <Card
                key={sp.id}
                className="border-card-border"
                data-testid={`card-subproject-${sp.id}`}
                style={sp.color ? { borderLeftColor: sp.color, borderLeftWidth: 4 } : undefined}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(s => ({ ...s, [sp.id]: !isOpen }))}
                      className="flex-1 flex items-start gap-2 min-w-0 text-left hover-elevate rounded p-1 -m-1"
                      data-testid={`button-toggle-subproject-${sp.id}`}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                      <Folder className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold truncate" data-testid={`text-subproject-name-${sp.id}`}>{sp.name}</h4>
                        {sp.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{sp.description}</p>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" size="sm">
                        <span className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_COLORS[sp.status] || 'bg-gray-500'}`} />
                        {STATUS_LABELS[sp.status] || sp.status}
                      </Badge>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setEditing(sp); setDialogOpen(true); }}
                        data-testid={`button-edit-subproject-${sp.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => {
                          if (confirm(`Remover "${sp.name}"? Sprints e PBIs vinculados ficarão sem subprojeto.`)) {
                            deleteMutation.mutate(sp.id);
                          }
                        }}
                        data-testid={`button-delete-subproject-${sp.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {sp.startDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(sp.startDate).toLocaleDateString('pt-BR')}
                        {sp.endDate && <> → {new Date(sp.endDate).toLocaleDateString('pt-BR')}</>}
                      </span>
                    )}
                    <span>{subSprints.length} sprint{subSprints.length !== 1 ? 's' : ''}</span>
                    <span>· {subPbis.length} PBI{subPbis.length !== 1 ? 's' : ''}</span>
                    {totalPoints > 0 && <span>· {totalPoints} pts</span>}
                    <span>· {pct}% concluído</span>
                  </div>

                  {isOpen && subSprints.length > 0 && (
                    <div className="space-y-2 pl-6 border-l-2 border-muted ml-2 mt-2">
                      {subSprints.map((spr) => {
                        const sprintPbis = pbisBySprint[spr.id] || [];
                        const sprDone = sprintPbis.filter(p => p.status === "concluido").length;
                        return (
                          <div key={spr.id} className="rounded-md border bg-muted/30 p-3" data-testid={`sprint-${spr.id}`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Target className="h-3.5 w-3.5 text-blue-600" />
                                  <span className="font-medium text-sm truncate">{spr.name}</span>
                                </div>
                                {spr.goal && (
                                  <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">"{spr.goal}"</p>
                                )}
                              </div>
                              <Badge variant="secondary" size="sm">
                                {sprintPbis.length} PBI · {sprDone}/{sprintPbis.length}
                              </Badge>
                            </div>

                            {sprintPbis.length > 0 ? (
                              <div className="space-y-1.5">
                                {sprintPbis.map((pbi) => {
                                  const Icon = PBI_TYPE_ICONS[pbi.type] || Target;
                                  return (
                                    <div
                                      key={pbi.id}
                                      className="flex items-center gap-2 text-xs bg-background rounded px-2 py-1.5 border"
                                      data-testid={`pbi-${pbi.id}`}
                                    >
                                      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span className="flex-1 truncate" data-testid={`text-pbi-title-${pbi.id}`}>
                                        {pbi.title}
                                      </span>
                                      {pbi.storyPoints != null && (
                                        <Badge variant="outline" size="sm" className="font-mono">{pbi.storyPoints}</Badge>
                                      )}
                                      <Badge
                                        variant="outline"
                                        size="sm"
                                        className={`${PBI_PRIORITY_COLOR[pbi.priority] || ""} text-[10px]`}
                                      >
                                        {pbi.priority}
                                      </Badge>
                                      <span
                                        className={`w-2 h-2 rounded-full ${PBI_STATUS_COLOR[pbi.status] || "bg-gray-500"}`}
                                        title={PBI_STATUS_LABEL[pbi.status] || pbi.status}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Sprint sem PBIs.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isOpen && subSprints.length === 0 && (
                    <p className="text-xs text-muted-foreground italic pl-6">
                      Nenhum sprint ainda. Use o Agente Scrum no Drive para gerar a estrutura, ou crie manualmente.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Subprojeto" : "Novo Subprojeto"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="sub-name">Nome *</Label>
              <Input id="sub-name" name="name" required defaultValue={editing?.name || ""}
                data-testid="input-subproject-name" />
            </div>
            <div>
              <Label htmlFor="sub-desc">Descrição</Label>
              <Textarea id="sub-desc" name="description" rows={2} defaultValue={editing?.description || ""} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sub-start">Início</Label>
                <Input id="sub-start" name="startDate" type="date" defaultValue={editing?.startDate || ""} />
              </div>
              <div>
                <Label htmlFor="sub-end">Fim</Label>
                <Input id="sub-end" name="endDate" type="date" defaultValue={editing?.endDate || ""} />
              </div>
            </div>
            <div>
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLOR_PALETTE.map((c) => (
                  <label key={c} className="cursor-pointer">
                    <input
                      type="radio" name="color" value={c}
                      defaultChecked={editing?.color === c}
                      className="sr-only peer"
                    />
                    <span
                      className="block w-7 h-7 rounded-full border-2 border-transparent peer-checked:border-foreground"
                      style={{ background: c }}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="sub-status">Status</Label>
              <select
                id="sub-status" name="status"
                defaultValue={editing?.status || "ativo"}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="ativo">Ativo</option>
                <option value="concluido">Concluído</option>
                <option value="pausado">Pausado</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={upsertMutation.isPending} data-testid="button-save-subproject">
                {upsertMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
