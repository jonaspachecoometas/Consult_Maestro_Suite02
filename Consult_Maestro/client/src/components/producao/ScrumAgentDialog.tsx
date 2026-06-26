import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Check, Loader2, AlertCircle, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/schema";

interface PlanSubproject {
  nome: string;
  descricao?: string;
  dataInicio?: string;
  dataFim?: string;
  cor?: string;
  sprints?: Array<{
    nome: string;
    dataInicio?: string;
    dataFim?: string;
    objetivo?: string;
    tasks?: Array<{ titulo: string; descricao?: string; entregavel?: string }>;
  }>;
}

interface Plan {
  subprojetos: PlanSubproject[];
  reunioes?: Array<{ titulo: string; data: string; horaInicio?: string }>;
  resumo?: { totalSubprojetos: number; totalSprints: number; totalTasks: number };
}

export function ScrumAgentDialog({
  open, onClose, projectId, fileId, fileName,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  fileId: string;
  fileName: string;
}) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: open && !!projectId,
  });
  const isCompass = project?.type === "compass";
  const canAnalyze = !projectLoading && !!project && !isCompass;

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!project) {
        throw new Error("Carregando informações do projeto. Tente novamente em instantes.");
      }
      if (project.type === "compass") {
        throw new Error("Este é uma demanda. Aprove a demanda primeiro para gerar um projeto Scrum.");
      }
      const res = await apiRequest("POST", `/api/projects/${projectId}/drive/${fileId}/analyze`, {});
      return res.json();
    },
    onSuccess: (data) => {
      setPlan(data.plan);
    },
    onError: (err: any) => toast({ title: "Falha na análise", description: err.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/drive/${fileId}/apply-plan`, { plan });
      return res.json();
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "subprojects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pbis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      const pbis = r.pbisCriados ?? r.tasksCriadas ?? 0;
      toast({
        title: "Plano Scrum aplicado!",
        description: `${r.subprojetosCriados} subprojetos · ${r.sprintsCriados} sprints · ${pbis} PBIs · ${r.eventosCriados} reuniões`,
      });
      onClose();
      setPlan(null);
    },
    onError: (err: any) => toast({ title: "Erro ao aplicar", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setPlan(null); } }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Agente Scrum — Análise de Documento
          </DialogTitle>
          <DialogDescription>
            Arquivo: <strong>{fileName}</strong>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          {isCompass && (
            <Card className="border-amber-500/30 bg-amber-500/10" data-testid="card-compass-warning">
              <CardContent className="py-6 text-center space-y-3">
                <Compass className="h-10 w-10 mx-auto text-amber-600" />
                <div>
                  <h4 className="font-semibold">Esta é uma demanda</h4>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                    Para gerar um projeto Scrum, aprove a demanda primeiro — isso cria um projeto de produção em que o Agente Scrum poderá atuar.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {projectLoading && !isCompass && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="ml-3 text-muted-foreground">Carregando projeto...</p>
            </div>
          )}

          {canAnalyze && !plan && !analyzeMutation.isPending && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center space-y-4">
                <Sparkles className="h-10 w-10 mx-auto text-primary" />
                <div>
                  <h4 className="font-semibold">Pronto para analisar</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    O agente lerá o conteúdo extraído e proporá uma estrutura completa de subprojetos, sprints e tarefas.
                  </p>
                </div>
                <Button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={!canAnalyze || analyzeMutation.isPending}
                  data-testid="button-analyze-doc"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analisar com Agente
                </Button>
              </CardContent>
            </Card>
          )}

          {analyzeMutation.isPending && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Analisando documento...</p>
            </div>
          )}

          {plan && (
            <div className="space-y-3">
              {plan.resumo && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="py-3">
                    <h4 className="font-semibold mb-2">Resumo</h4>
                    <div className="flex gap-2 flex-wrap text-sm">
                      <Badge variant="outline">{plan.resumo.totalSubprojetos || plan.subprojetos.length} subprojetos</Badge>
                      <Badge variant="outline">{plan.resumo.totalSprints} sprints</Badge>
                      <Badge variant="outline">{plan.resumo.totalTasks} tarefas</Badge>
                      {plan.reunioes && <Badge variant="outline">{plan.reunioes.length} reuniões</Badge>}
                    </div>
                  </CardContent>
                </Card>
              )}

              {plan.subprojetos.map((sp, i) => (
                <Card key={i} className="border-card-border">
                  <CardContent className="p-3">
                    <h4 className="font-semibold flex items-center gap-2" data-testid={`plan-sub-${i}`}>
                      <span className="w-2 h-2 rounded-full" style={{ background: sp.cor || "#3b82f6" }} />
                      {sp.nome}
                    </h4>
                    {sp.descricao && <p className="text-xs text-muted-foreground mt-1">{sp.descricao}</p>}
                    {sp.sprints && sp.sprints.length > 0 && (
                      <div className="mt-2 space-y-2 ml-4">
                        {sp.sprints.map((spr, si) => (
                          <div key={si} className="border-l-2 border-muted pl-3">
                            <p className="text-sm font-medium">{spr.nome}</p>
                            {spr.objetivo && <p className="text-xs text-muted-foreground">{spr.objetivo}</p>}
                            {spr.tasks && spr.tasks.length > 0 && (
                              <ul className="mt-1 text-xs space-y-0.5 text-muted-foreground">
                                {spr.tasks.slice(0, 8).map((t, ti) => (
                                  <li key={ti}>• {t.titulo}</li>
                                ))}
                                {spr.tasks.length > 8 && <li>... +{spr.tasks.length - 8} tarefas</li>}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {plan.reunioes && plan.reunioes.length > 0 && (
                <Card className="border-card-border">
                  <CardContent className="p-3">
                    <h4 className="font-semibold mb-2">Reuniões propostas</h4>
                    <ul className="text-sm space-y-1">
                      {plan.reunioes.map((r, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{r.titulo}</span>
                          <span className="text-muted-foreground">{r.data} {r.horaInicio || ""}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card className="bg-amber-500/10 border-amber-500/30">
                <CardContent className="py-2 flex items-start gap-2 text-xs">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>Ao aplicar, esta estrutura será criada no projeto. Tarefas existentes não serão alteradas.</span>
                </CardContent>
              </Card>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setPlan(null); }}>
            Cancelar
          </Button>
          {plan && (
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
              data-testid="button-apply-plan"
            >
              {applyMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aplicando...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" /> Aplicar Plano</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
