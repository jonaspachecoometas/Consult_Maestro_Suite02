import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Plus, 
  Search, 
  LayoutGrid, 
  List,
  Calendar,
  FolderKanban
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_STATUSES } from "@/lib/constants";
import type { Project, Client } from "@shared/schema";

function ProjectStatusBadge({ status }: { status: string }) {
  const statusConfig = PROJECT_STATUSES.find(s => s.value === status);
  return (
    <Badge variant="outline" size="sm" className="text-xs">
      <span className={`w-2 h-2 rounded-full mr-1.5 ${statusConfig?.color || 'bg-gray-500'}`} />
      {statusConfig?.label || status}
    </Badge>
  );
}

export default function Projects() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?excludeType=compass"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const getClient = (clientId: string) => clients.find(c => c.id === clientId);

  const filteredProjects = projects.filter((project) => {
    if (project.type === 'compass') return false;
    const matchesSearch = 
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Projetos</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie seus projetos de consultoria e diagnóstico
          </p>
        </div>
        <Button asChild data-testid="button-new-project">
          <Link href="/projetos/novo">
            <Plus className="h-4 w-4 mr-2" />
            Novo Projeto
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar projetos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-projects"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {PROJECT_STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${status.color}`} />
                  {status.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("grid")}
            data-testid="button-view-grid"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("list")}
            data-testid="button-view-list"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="secondary" size="sm">
          {filteredProjects.length} projeto{filteredProjects.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {isLoading ? (
        <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3" : "space-y-3"}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderKanban className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum projeto encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              {searchQuery || statusFilter !== "all"
                ? "Tente ajustar sua busca ou filtros."
                : "Comece criando seu primeiro projeto de consultoria."}
            </p>
            {!searchQuery && statusFilter === "all" && (
              <Button asChild>
                <Link href="/projetos/novo">
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Projeto
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => {
            const client = getClient(project.clientId);
            return (
              <Link 
                key={project.id} 
                href={`/projetos/${project.id}`}
                className="block"
              >
                <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer h-full">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold shrink-0">
                        {project.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="font-semibold truncate" data-testid={`text-project-name-${project.id}`}>
                            {project.name}
                          </h3>
                          <ProjectStatusBadge status={project.status} />
                        </div>
                        {client && (
                          <div className="flex items-center gap-2 mb-2">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={client.logoUrl || undefined} />
                              <AvatarFallback className="text-[10px] bg-muted">
                                {client.name.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm text-muted-foreground truncate">
                              {client.name}
                            </span>
                          </div>
                        )}
                        {project.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {project.description}
                          </p>
                        )}
                        {project.dueDate && (
                          <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            Prazo: {new Date(project.dueDate).toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map((project) => {
            const client = getClient(project.clientId);
            return (
              <Link 
                key={project.id} 
                href={`/projetos/${project.id}`}
                className="block"
              >
                <Card className="border-card-border hover-elevate active-elevate-2 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold shrink-0">
                        {project.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{project.name}</h3>
                        {client && (
                          <span className="text-sm text-muted-foreground">
                            {client.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {project.dueDate && (
                          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(project.dueDate).toLocaleDateString('pt-BR')}
                          </div>
                        )}
                        <ProjectStatusBadge status={project.status} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
