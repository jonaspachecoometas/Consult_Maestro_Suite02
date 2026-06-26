import { useQuery } from "@tanstack/react-query";
import { 
  Users, 
  FolderKanban, 
  FileCheck, 
  TrendingUp,
  ArrowRight,
  Plus,
  Calendar
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { PROJECT_STATUSES } from "@/lib/constants";
import type { Project, Client } from "@shared/schema";

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend,
  isLoading,
  href,
  testId
}: { 
  title: string; 
  value: number; 
  icon: React.ElementType;
  trend?: string;
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
          {trend && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3" />
              {trend}
            </p>
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

function ProjectStatusBadge({ status }: { status: string }) {
  const statusConfig = PROJECT_STATUSES.find(s => s.value === status);
  return (
    <Badge variant="outline" size="sm" className="text-xs">
      <span className={`w-2 h-2 rounded-full mr-1.5 ${statusConfig?.color || 'bg-gray-500'}`} />
      {statusConfig?.label || status}
    </Badge>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  
  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?scope=production"],
  });

  const activeProjects = projects.filter(p => p.status !== 'concluido');
  const completedProjects = projects.filter(p => p.status === 'concluido');

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
          <h1 className="font-heading text-3xl font-bold" data-testid="text-greeting">
            {getGreeting()}, {user?.firstName || 'Usuário'}
          </h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe seus projetos e diagnósticos de consultoria.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild data-testid="button-new-client">
            <Link href="/clientes/novo">
              <Plus className="h-4 w-4 mr-2" />
              Novo Cliente
            </Link>
          </Button>
          <Button variant="outline" asChild data-testid="button-new-project">
            <Link href="/projetos/novo">
              <Plus className="h-4 w-4 mr-2" />
              Novo Projeto
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total de Clientes"
          value={clients.length}
          icon={Users}
          isLoading={clientsLoading}
          href="/clientes"
          testId="stat-card-clients"
        />
        <StatCard
          title="Projetos Ativos"
          value={activeProjects.length}
          icon={FolderKanban}
          isLoading={projectsLoading}
          href="/projetos"
          testId="stat-card-active-projects"
        />
        <StatCard
          title="Projetos Concluídos"
          value={completedProjects.length}
          icon={FileCheck}
          isLoading={projectsLoading}
          href="/projetos"
          testId="stat-card-completed-projects"
        />
        <StatCard
          title="Total de Projetos"
          value={projects.length}
          icon={TrendingUp}
          isLoading={projectsLoading}
          href="/projetos"
          testId="stat-card-total-projects"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <CardTitle className="text-lg font-semibold">Projetos Recentes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/projetos" data-testid="link-view-all-projects">
                Ver todos
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectsLoading ? (
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
            ) : projects.length === 0 ? (
              <div className="text-center py-8">
                <FolderKanban className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Nenhum projeto encontrado</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/projetos/novo">Criar primeiro projeto</Link>
                </Button>
              </div>
            ) : (
              projects.slice(0, 5).map((project) => (
                <Link 
                  key={project.id} 
                  href={`/projetos/${project.id}`}
                  className="flex items-center gap-4 p-3 rounded-md hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`card-project-${project.id}`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
                    {project.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{project.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {project.dueDate ? new Date(project.dueDate).toLocaleDateString('pt-BR') : 'Sem prazo'}
                    </div>
                  </div>
                  <ProjectStatusBadge status={project.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <CardTitle className="text-lg font-semibold">Clientes Recentes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/clientes" data-testid="link-view-all-clients">
                Ver todos
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {clientsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))
            ) : clients.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Nenhum cliente encontrado</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link href="/clientes/novo">Cadastrar primeiro cliente</Link>
                </Button>
              </div>
            ) : (
              clients.slice(0, 5).map((client) => (
                <Link 
                  key={client.id} 
                  href={`/clientes/${client.id}`}
                  className="flex items-center gap-4 p-3 rounded-md hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`card-client-${client.id}`}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={client.logoUrl || undefined} alt={client.name} />
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {client.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {client.company || client.email || 'Sem empresa'}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
