import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  LayoutPanelTop,
  Zap,
  ListTodo,
  Users2,
  Clock,
  ArrowRight,
  Plus,
  PlayCircle,
  CheckCircle2,
  AlertCircle,
  TrendingUp
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { ModuleAgentBanner } from "@/components/agent/ModuleAgentBanner";
import type { 
  ScrumInternalProject, 
  ScrumSprint, 
  ScrumBacklogItem,
  ScrumTeam 
} from "@shared/schema";

interface SprintStats {
  total: number;
  active: number;
  completed: number;
}

interface BacklogStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  subtitle,
  isLoading,
  href,
  testId
}: { 
  title: string; 
  value: number | string; 
  icon: React.ElementType;
  subtitle?: string;
  isLoading: boolean;
  href?: string;
  testId?: string;
}) {
  const content = (
    <CardContent className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-3xl font-bold">{value}</p>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </CardContent>
  );

  if (href) {
    return (
      <Link href={href} data-testid={testId}>
        <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer">
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card className="border-card-border" data-testid={testId}>
      {content}
    </Card>
  );
}

function SprintStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    planning: { label: "Planejamento", variant: "outline" },
    active: { label: "Ativo", variant: "default" },
    completed: { label: "Concluido", variant: "secondary" },
    cancelled: { label: "Cancelado", variant: "destructive" },
    review: { label: "Revisao", variant: "outline" },
  };
  
  const { label, variant } = config[status] || { label: status, variant: "outline" };
  
  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  );
}

function PbiStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    backlog: { label: "Backlog", color: "bg-gray-500" },
    selecionado: { label: "Selecionado", color: "bg-blue-500" },
    em_execucao: { label: "Em Execucao", color: "bg-yellow-500" },
    em_revisao: { label: "Em Revisao", color: "bg-purple-500" },
    aguardando_validacao: { label: "Aguardando Validacao", color: "bg-orange-500" },
    concluido: { label: "Concluido", color: "bg-green-500" },
    cancelado: { label: "Cancelado", color: "bg-gray-400" },
    bloqueado: { label: "Bloqueado", color: "bg-red-500" },
  };
  
  const { label, color } = config[status] || { label: status, color: "bg-gray-500" };
  
  return (
    <Badge variant="outline" size="sm" className="text-xs">
      <span className={`w-2 h-2 rounded-full mr-1.5 ${color}`} />
      {label}
    </Badge>
  );
}

export default function Scrum() {
  const { user } = useAuth();
  
  const { data: projects = [], isLoading: projectsLoading } = useQuery<ScrumInternalProject[]>({
    queryKey: ["/api/scrum/projects"],
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery<ScrumTeam[]>({
    queryKey: ["/api/scrum/teams"],
  });

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery<ScrumSprint[]>({
    queryKey: ["/api/scrum/sprints"],
  });

  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: ["/api/scrum/backlog"],
  });

  const sprintStats: SprintStats = {
    total: sprints.length,
    active: sprints.filter(s => s.status === 'active').length,
    completed: sprints.filter(s => s.status === 'completed').length,
  };

  const backlogStats: BacklogStats = {
    total: backlogItems.length,
    todo: backlogItems.filter(b => b.status === 'backlog' || b.status === 'selecionado').length,
    inProgress: backlogItems.filter(b => b.status === 'em_execucao' || b.status === 'em_revisao').length,
    done: backlogItems.filter(b => b.status === 'concluido').length,
  };

  const activeSprint = sprints.find(s => s.status === 'active');
  const activeSprintItems = activeSprint 
    ? backlogItems.filter(b => b.sprintId === activeSprint.id)
    : [];
  const activeSprintProgress = activeSprintItems.length > 0
    ? Math.round((activeSprintItems.filter(b => b.status === 'concluido').length / activeSprintItems.length) * 100)
    : 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-scrum-title">
            Central de Producao
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie sprints, backlog e acompanhe o progresso das equipes.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild data-testid="button-new-pbi">
            <Link href="/producao/backlog?new=true">
              <Plus className="h-4 w-4 mr-2" />
              Novo Item
            </Link>
          </Button>
          <Button variant="outline" asChild data-testid="button-new-sprint">
            <Link href="/producao/sprints?new=true">
              <Zap className="h-4 w-4 mr-2" />
              Nova Sprint
            </Link>
          </Button>
        </div>
      </div>

      <ModuleAgentBanner module="production" label="Central de Produção" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Projetos Internos"
          value={projects.length}
          icon={LayoutPanelTop}
          isLoading={projectsLoading}
          testId="stat-card-projects"
        />
        <StatCard
          title="Sprints Ativas"
          value={sprintStats.active}
          subtitle={`${sprintStats.completed} concluidas`}
          icon={Zap}
          isLoading={sprintsLoading}
          href="/producao/sprints"
          testId="stat-card-sprints"
        />
        <StatCard
          title="Itens no Backlog"
          value={backlogStats.total}
          subtitle={`${backlogStats.inProgress} em andamento`}
          icon={ListTodo}
          isLoading={backlogLoading}
          href="/producao/backlog"
          testId="stat-card-backlog"
        />
        <StatCard
          title="Squads"
          value={teams.length}
          icon={Users2}
          isLoading={teamsLoading}
          href="/producao/squads"
          testId="stat-card-teams"
        />
      </div>

      {activeSprint && (
        <Card className="border-card-border" data-testid="card-active-sprint">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold">{activeSprint.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Sprint Ativa - {activeSprint.startDate && activeSprint.endDate 
                    ? `${new Date(activeSprint.startDate).toLocaleDateString('pt-BR')} - ${new Date(activeSprint.endDate).toLocaleDateString('pt-BR')}`
                    : 'Datas nao definidas'}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/producao/sprints/${activeSprint.id}`}>
                Ver Detalhes
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progresso</span>
                <span className="font-medium">{activeSprintProgress}%</span>
              </div>
              <Progress value={activeSprintProgress} className="h-2" />
              <div className="grid grid-cols-4 gap-4 pt-2">
                <div className="text-center">
                  <p className="text-2xl font-bold">{activeSprintItems.filter(b => b.status === 'backlog' || b.status === 'selecionado').length}</p>
                  <p className="text-xs text-muted-foreground">A Fazer</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{activeSprintItems.filter(b => b.status === 'em_execucao').length}</p>
                  <p className="text-xs text-muted-foreground">Em Andamento</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{activeSprintItems.filter(b => b.status === 'em_revisao' || b.status === 'aguardando_validacao').length}</p>
                  <p className="text-xs text-muted-foreground">Revisao</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{activeSprintItems.filter(b => b.status === 'concluido').length}</p>
                  <p className="text-xs text-muted-foreground">Concluido</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <CardTitle className="text-lg font-semibold">Sprints Recentes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/producao/sprints" data-testid="link-view-all-sprints">
                Ver todas
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {sprintsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))
            ) : sprints.length === 0 ? (
              <div className="text-center py-8">
                <Zap className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Nenhuma sprint encontrada</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/producao/sprints?new=true">Criar primeira sprint</Link>
                </Button>
              </div>
            ) : (
              sprints.slice(0, 5).map((sprint) => (
                <Link 
                  key={sprint.id} 
                  href={`/producao/sprints/${sprint.id}`}
                  className="flex items-center gap-4 p-3 rounded-md hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`card-sprint-${sprint.id}`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {sprint.status === 'active' ? (
                      <PlayCircle className="h-5 w-5" />
                    ) : sprint.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <Zap className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{sprint.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sprint.startDate 
                        ? new Date(sprint.startDate).toLocaleDateString('pt-BR')
                        : 'Data nao definida'}
                    </p>
                  </div>
                  <SprintStatusBadge status={sprint.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <CardTitle className="text-lg font-semibold">Itens Recentes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/producao/backlog" data-testid="link-view-all-backlog">
                Ver todos
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {backlogLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))
            ) : backlogItems.length === 0 ? (
              <div className="text-center py-8">
                <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Nenhum item encontrado</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/producao/backlog?new=true">Criar primeiro item</Link>
                </Button>
              </div>
            ) : (
              backlogItems.slice(0, 5).map((item) => (
                <div 
                  key={item.id}
                  className="flex items-center gap-4 p-3 rounded-md hover-elevate active-elevate-2"
                  data-testid={`card-pbi-${item.id}`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
                    {item.type === 'bug' ? (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <ListTodo className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" size="sm" className="text-xs capitalize">
                        {item.type}
                      </Badge>
                      {item.storyPoints && (
                        <span>{item.storyPoints} pts</span>
                      )}
                    </div>
                  </div>
                  <PbiStatusBadge status={item.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer" data-testid="card-quick-action-backlog">
          <Link href="/producao/backlog">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                <ListTodo className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Gerenciar Backlog</p>
                <p className="text-sm text-muted-foreground">Priorize e organize os itens</p>
              </div>
            </CardContent>
          </Link>
        </Card>

        <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer" data-testid="card-quick-action-squads">
          <Link href="/producao/squads">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-green-500/10 text-green-500">
                <Users2 className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Gerenciar Squads</p>
                <p className="text-sm text-muted-foreground">Equipes e alocacao</p>
              </div>
            </CardContent>
          </Link>
        </Card>

        <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer" data-testid="card-quick-action-timesheet">
          <Link href="/producao/timesheet">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-purple-500/10 text-purple-500">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Registrar Horas</p>
                <p className="text-sm text-muted-foreground">Timesheet e apontamentos</p>
              </div>
            </CardContent>
          </Link>
        </Card>
      </div>
    </div>
  );
}
