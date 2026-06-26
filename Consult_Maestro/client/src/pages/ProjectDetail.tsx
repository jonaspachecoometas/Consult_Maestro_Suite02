import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import { 
  ArrowLeft, 
  Edit, 
  Calendar, 
  Grid3X3, 
  GitBranch, 
  FileText,
  Users,
  Clock,
  BookOpen,
  Save,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuperAgentEmbed } from "@/components/SuperAgentEmbed";
import { PROJECT_STATUSES, CANVAS_BLOCK_TYPES, CANVAS_LEVELS } from "@/lib/constants";
import { Progress } from "@/components/ui/progress";
import { ProjectTeam } from "@/components/ProjectTeam";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ProjectFileManager } from "@/components/ProjectFileManager";
import { SubprojectsTab } from "@/components/producao/SubprojectsTab";
import { ProjectDrive } from "@/components/producao/ProjectDrive";
import { ProjectCalendar } from "@/components/producao/ProjectCalendar";
import { ProjectDashboard } from "@/components/producao/ProjectDashboard";
import { TaskAgentChat } from "@/components/producao/TaskAgentChat";
import { ProjectBacklog } from "@/components/producao/ProjectBacklog";
import { ProjectSprints } from "@/components/producao/ProjectSprints";
import { ProjectSquads } from "@/components/producao/ProjectSquads";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, Client, CanvasBlock, Process, Task } from "@shared/schema";

function ProjectStatusBadge({ status }: { status: string }) {
  const statusConfig = PROJECT_STATUSES.find(s => s.value === status);
  return (
    <Badge variant="outline" className="text-sm">
      <span className={`w-2 h-2 rounded-full mr-2 ${statusConfig?.color || 'bg-gray-500'}`} />
      {statusConfig?.label || status}
    </Badge>
  );
}

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [historyContent, setHistoryContent] = useState<string>("");
  const [historyChanged, setHistoryChanged] = useState(false);
  const [agentTaskId, setAgentTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", params.id],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: canvasBlocks = [] } = useQuery<CanvasBlock[]>({
    queryKey: ["/api/projects", params.id, "canvas"],
    enabled: !!params.id,
  });

  const { data: processes = [] } = useQuery<Process[]>({
    queryKey: ["/api/projects", params.id, "processes"],
    enabled: !!params.id,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/projects", params.id, "tasks"],
    enabled: !!params.id,
  });

  // Initialize history content from project
  useEffect(() => {
    if (project?.history) {
      setHistoryContent(project.history);
    }
  }, [project?.history]);

  // Save history mutation
  const saveHistoryMutation = useMutation({
    mutationFn: async (history: string) => {
      const response = await apiRequest("PATCH", `/api/projects/${params.id}`, { history });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", params.id] });
      setHistoryChanged(false);
      toast({
        title: "História salva",
        description: "As alterações foram salvas com sucesso.",
      });
    },
    onError: () => {
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar a história. Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const handleHistoryChange = (content: string) => {
    setHistoryContent(content);
    setHistoryChanged(content !== (project?.history || ""));
  };

  const handleSaveHistory = () => {
    saveHistoryMutation.mutate(historyContent);
  };

  const client = project ? clients.find(c => c.id === project.clientId) : null;

  if (projectLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="font-semibold text-lg mb-2">Projeto não encontrado</h3>
            <p className="text-muted-foreground mb-4">O projeto solicitado não existe ou foi removido.</p>
            <Button asChild>
              <Link href="/projetos">Voltar aos Projetos</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild className="mt-1">
            <Link href="/projetos" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-heading text-3xl font-bold" data-testid="text-project-name">
                {project.name}
              </h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            {client && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={client.logoUrl || undefined} />
                  <AvatarFallback className="text-[10px] bg-muted">
                    {client.name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{client.name}</span>
                {client.company && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{client.company}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild data-testid="button-edit-project">
            <Link href={`/projetos/${project.id}/editar`}>
              <Edit className="h-4 w-4 mr-2" />
              Editar
            </Link>
          </Button>
          <Button
            variant="default"
            className="bg-primary hover:bg-primary/90"
            onClick={() => setActiveTab("drive")}
            data-testid="button-open-scrum-agent"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Agente Scrum
          </Button>
          <Button asChild data-testid="button-canvas" variant="outline">
            <Link href={`/canvas?projectId=${project.id}`}>
              <Grid3X3 className="h-4 w-4 mr-2" />
              Abrir Canvas
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Link href={`/canvas?projectId=${project.id}`} data-testid="stat-card-canvas">
          <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                  <Grid3X3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{canvasBlocks.length}</p>
                  <p className="text-xs text-muted-foreground">Blocos Canvas</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href={`/processos?projectId=${project.id}`} data-testid="stat-card-processes">
          <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-green-500/10 text-green-500">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{processes.length}</p>
                  <p className="text-xs text-muted-foreground">Processos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href={`/tarefas?projectId=${project.id}`} data-testid="stat-card-tasks">
          <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-purple-500/10 text-purple-500">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{tasks.length}</p>
                  <p className="text-xs text-muted-foreground">Tarefas</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-500/10 text-orange-500">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">
                  {project.dueDate 
                    ? new Date(project.dueDate).toLocaleDateString('pt-BR')
                    : 'Sem prazo'}
                </p>
                <p className="text-xs text-muted-foreground">Data limite</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="subprojects" data-testid="tab-subprojects">Subprojetos</TabsTrigger>
          <TabsTrigger value="backlog" data-testid="tab-backlog">Backlog</TabsTrigger>
          <TabsTrigger value="sprints" data-testid="tab-sprints">Sprints</TabsTrigger>
          <TabsTrigger value="squads" data-testid="tab-squads">Squads</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tarefas</TabsTrigger>
          <TabsTrigger value="drive" data-testid="tab-drive">
            <Sparkles className="h-3 w-3 mr-1 text-primary" />
            Drive + Agente
          </TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-calendar">Calendário</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">História</TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team">Equipe</TabsTrigger>
          <TabsTrigger value="canvas" data-testid="tab-canvas">Canvas</TabsTrigger>
          <TabsTrigger value="processes" data-testid="tab-processes">Processos</TabsTrigger>
          <TabsTrigger value="files" data-testid="tab-files">Arquivos (legado)</TabsTrigger>
          <TabsTrigger value="super-agent" data-testid="tab-super-agent">Super Agente</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <ProjectDashboard projectId={project.id} />
        </TabsContent>

        <TabsContent value="subprojects" className="space-y-4">
          <SubprojectsTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="backlog" className="space-y-4">
          <ProjectBacklog projectId={project.id} />
        </TabsContent>

        <TabsContent value="sprints" className="space-y-4">
          <ProjectSprints projectId={project.id} />
        </TabsContent>

        <TabsContent value="squads" className="space-y-4">
          <ProjectSquads projectId={project.id} />
        </TabsContent>

        <TabsContent value="drive" className="space-y-4">
          <ProjectDrive projectId={project.id} />
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <ProjectCalendar projectId={project.id} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-card-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Descrição</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {project.description || "Nenhuma descrição adicionada."}
                </p>
              </CardContent>
            </Card>

            <Card className="border-card-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Informações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Criado em
                  </span>
                  <span className="text-sm">
                    {project.createdAt 
                      ? new Date(project.createdAt).toLocaleDateString('pt-BR')
                      : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Início previsto
                  </span>
                  <span className="text-sm">
                    {project.startDate 
                      ? new Date(project.startDate).toLocaleDateString('pt-BR')
                      : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Prioridade
                  </span>
                  <Badge variant="outline" size="sm">
                    {(project.priority ?? 0) === 0 ? 'Normal' : (project.priority ?? 0) > 0 ? 'Alta' : 'Baixa'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card className="border-card-border">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  História do Projeto
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Documente a história, contexto e evolução do projeto com formatação rica e tabelas.
                </p>
              </div>
              <Button
                onClick={handleSaveHistory}
                disabled={!historyChanged || saveHistoryMutation.isPending}
                data-testid="button-save-history"
              >
                {saveHistoryMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar
              </Button>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                content={historyContent}
                onChange={handleHistoryChange}
                placeholder="Digite a história do projeto aqui... Use a barra de ferramentas para formatar o texto, adicionar títulos, listas e tabelas."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <ProjectTeam projectId={project.id} />
        </TabsContent>

        <TabsContent value="canvas" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Blocos Canvas</h3>
              <p className="text-sm text-muted-foreground">
                {canvasBlocks.length} bloco{canvasBlocks.length !== 1 ? 's' : ''} preenchido{canvasBlocks.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Button asChild data-testid="button-open-canvas">
              <Link href={`/canvas?projectId=${project.id}`}>
                <Grid3X3 className="h-4 w-4 mr-2" />
                Abrir Canvas
              </Link>
            </Button>
          </div>

          {canvasBlocks.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Grid3X3 className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Canvas BMC</h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  Nenhum bloco preenchido ainda. Acesse o Canvas para iniciar o diagnóstico.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {CANVAS_BLOCK_TYPES.map((blockType) => {
                const blocksOfType = canvasBlocks.filter(b => b.blockType === blockType.value);
                const avgCompleteness = blocksOfType.length > 0 
                  ? Math.round(blocksOfType.reduce((sum, b) => sum + (b.completeness || 0), 0) / blocksOfType.length)
                  : 0;
                
                return (
                  <Card key={blockType.value} className="border-card-border">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm font-medium">{blockType.label}</CardTitle>
                        <Badge variant="outline" size="sm">
                          {blocksOfType.length}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{blockType.arcadiaLabel}</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {blocksOfType.length > 0 ? (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Completude</span>
                              <span className="font-medium">{avgCompleteness}%</span>
                            </div>
                            <Progress value={avgCompleteness} className="h-1.5" />
                          </div>
                          <div className="space-y-2">
                            {blocksOfType.slice(0, 2).map((block) => {
                              const level = CANVAS_LEVELS.find(l => l.value === block.level);
                              return (
                                <div key={block.id} className="text-xs p-2 rounded-md bg-muted/50">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge variant="secondary" size="sm" className="text-[10px]">
                                      {level?.label || block.level}
                                    </Badge>
                                  </div>
                                  <p className="text-muted-foreground line-clamp-2">
                                    {block.content || "Sem conteúdo"}
                                  </p>
                                </div>
                              );
                            })}
                            {blocksOfType.length > 2 && (
                              <p className="text-xs text-muted-foreground text-center">
                                +{blocksOfType.length - 2} mais
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          Nenhum registro
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="processes">
          <Card className="border-card-border">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <GitBranch className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-semibold mb-2">Mapeamento de Processos</h3>
              <p className="text-muted-foreground text-center max-w-sm mb-4">
                Acesse o módulo de processos para mapear e documentar os fluxos operacionais.
              </p>
              <Button asChild>
                <Link href={`/processos?projectId=${project.id}`}>
                  Abrir Processos
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Tarefas do Projeto</h3>
              <p className="text-sm text-muted-foreground">
                {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''} registrada{tasks.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Button asChild data-testid="button-open-tasks">
              <Link href={`/tarefas?projectId=${project.id}`}>
                <FileText className="h-4 w-4 mr-2" />
                Ver Todas
              </Link>
            </Button>
          </div>

          {tasks.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Nenhuma Tarefa</h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  Este projeto ainda não possui tarefas. Acesse o módulo de tarefas para criar.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {tasks.slice(0, 6).map((task) => {
                const statusColors: Record<string, string> = {
                  todo: "bg-slate-500",
                  in_progress: "bg-blue-500",
                  review: "bg-yellow-500",
                  done: "bg-green-500",
                };
                const statusLabels: Record<string, string> = {
                  todo: "A Fazer",
                  in_progress: "Em Andamento",
                  review: "Revisão",
                  done: "Concluído",
                };
                return (
                  <Card key={task.id} className="border-card-border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="font-medium text-sm line-clamp-1">{task.title}</h4>
                        <Badge variant="outline" size="sm">
                          <span className={`w-2 h-2 rounded-full mr-2 ${statusColors[task.status] || 'bg-gray-500'}`} />
                          {statusLabels[task.status] || task.status}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-2 mt-2">
                        {task.dueDate ? (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                          </div>
                        ) : <span />}
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setAgentTaskId(task.id)}
                          data-testid={`button-task-agent-${task.id}`}
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          Agente
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {tasks.length > 6 && (
            <p className="text-sm text-muted-foreground text-center">
              +{tasks.length - 6} tarefa{tasks.length - 6 !== 1 ? 's' : ''} adicionai{tasks.length - 6 !== 1 ? 's' : ''}
            </p>
          )}
        </TabsContent>

        <TabsContent value="files" className="space-y-4">
          <ProjectFileManager projectId={project.id} />
        </TabsContent>

        <TabsContent value="super-agent" className="space-y-4">
          <SuperAgentEmbed projectId={project.id} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!agentTaskId} onOpenChange={(o) => { if (!o) setAgentTaskId(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Agente Scrum — Conversa sobre a tarefa
            </DialogTitle>
          </DialogHeader>
          {agentTaskId && <TaskAgentChat taskId={agentTaskId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
