import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { 
  ArrowLeft,
  Mail, 
  Phone, 
  Building2,
  Globe,
  MapPin,
  FileText,
  Edit,
  FolderKanban,
  Calendar,
  Plus,
  Users,
  Network
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientContacts } from "@/components/ClientContacts";
import { ClientOrgChart } from "@/components/ClientOrgChart";
import type { Client, Project } from "@shared/schema";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const projectStatusLabels: Record<string, string> = {
  backlog: "Backlog",
  diagnostico: "Diagnóstico",
  andamento: "Em Andamento",
  revisao: "Revisão",
  concluido: "Concluído",
};

const projectStatusColors: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  diagnostico: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  andamento: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  revisao: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  concluido: "bg-green-500/10 text-green-600 dark:text-green-400",
};

export default function ClientDetail() {
  const [, params] = useRoute("/clientes/:id");
  const clientId = params?.id;
  const [activeTab, setActiveTab] = useState("info");
  const printRef = useRef<HTMLDivElement>(null);

  const { data: client, isLoading: isLoadingClient } = useQuery<Client>({
    queryKey: [`/api/clients/${clientId}`],
    enabled: !!clientId,
  });

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/projects", { clientId }],
    enabled: !!clientId,
  });

  const clientProjects = projects.filter(p => p.clientId === clientId);

  const handlePrintOrgChart = () => {
    window.print();
  };

  if (isLoadingClient) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-6">
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Cliente não encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              O cliente solicitado não existe ou foi removido.
            </p>
            <Button asChild>
              <Link href="/clientes">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar para Clientes
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/clientes" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={client.logoUrl || undefined} alt={client.name} />
              <AvatarFallback className="bg-primary/10 text-primary font-medium text-lg">
                {client.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-heading text-2xl font-bold" data-testid="text-client-name">
                {client.name}
              </h1>
              {client.company && (
                <p className="text-muted-foreground">{client.company}</p>
              )}
            </div>
          </div>
        </div>
        <Button asChild data-testid="button-edit-client">
          <Link href={`/clientes/${client.id}/editar`}>
            <Edit className="h-4 w-4 mr-2" />
            Editar Cliente
          </Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList data-testid="tabs-client-detail">
          <TabsTrigger value="info" data-testid="tab-info">
            <Building2 className="h-4 w-4 mr-2" />
            Informações
          </TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-projects">
            <FolderKanban className="h-4 w-4 mr-2" />
            Projetos
          </TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">
            <Users className="h-4 w-4 mr-2" />
            Contatos
          </TabsTrigger>
          <TabsTrigger value="orgchart" data-testid="tab-orgchart">
            <Network className="h-4 w-4 mr-2" />
            Organograma
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-card-border">
              <CardHeader>
                <CardTitle className="text-base">Informações de Contato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {client.email && (
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <a 
                        href={`mailto:${client.email}`}
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        data-testid="link-client-email"
                      >
                        {client.email}
                      </a>
                    </div>
                  </div>
                )}
                
                {client.phone && (
                  <div className="flex items-start gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Telefone</p>
                      <a 
                        href={`tel:${client.phone}`}
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        data-testid="link-client-phone"
                      >
                        {client.phone}
                      </a>
                    </div>
                  </div>
                )}

                {client.website && (
                  <div className="flex items-start gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Website</p>
                      <a 
                        href={client.website.startsWith('http') ? client.website : `https://${client.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        data-testid="link-client-website"
                      >
                        {client.website}
                      </a>
                    </div>
                  </div>
                )}

                {client.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Endereço</p>
                      <p className="text-sm text-muted-foreground">{client.address}</p>
                    </div>
                  </div>
                )}

                {client.industry && (
                  <div className="flex items-start gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Setor</p>
                      <p className="text-sm text-muted-foreground">{client.industry}</p>
                    </div>
                  </div>
                )}

                {!client.email && !client.phone && !client.website && !client.address && !client.industry && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma informação de contato cadastrada
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              {client.notes && (
                <Card className="border-card-border">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Observações
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {client.notes}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card className="border-card-border">
                <CardHeader>
                  <CardTitle className="text-base">Informações do Sistema</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Criado em</span>
                    <span>
                      {client.createdAt 
                        ? format(new Date(client.createdAt), "dd MMM yyyy", { locale: ptBR })
                        : 'N/A'
                      }
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Projetos</span>
                    <Badge variant="secondary" size="sm">{clientProjects.length}</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="projects">
          <Card className="border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Projetos
                </CardTitle>
                <CardDescription>
                  Projetos de consultoria deste cliente
                </CardDescription>
              </div>
              <Button size="sm" asChild data-testid="button-new-project">
                <Link href={`/projetos/novo?clientId=${client.id}`}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Projeto
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingProjects ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-border">
                      <Skeleton className="h-12 w-12 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : clientProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <FolderKanban className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="font-semibold mb-2">Nenhum projeto</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
                    Este cliente ainda não possui projetos cadastrados.
                  </p>
                  <Button size="sm" asChild>
                    <Link href={`/projetos/novo?clientId=${client.id}`}>
                      <Plus className="h-4 w-4 mr-2" />
                      Criar Primeiro Projeto
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {clientProjects.map((project) => (
                    <Link 
                      key={project.id} 
                      href={`/projetos/${project.id}`}
                      className="flex items-center gap-4 p-4 rounded-lg border border-border hover-elevate cursor-pointer"
                      data-testid={`link-project-${project.id}`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <FolderKanban className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium truncate">{project.name}</h4>
                          <Badge 
                            variant="secondary" 
                            size="sm"
                            className={projectStatusColors[project.status] || ''}
                          >
                            {projectStatusLabels[project.status] || project.status}
                          </Badge>
                        </div>
                        {project.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {project.description}
                          </p>
                        )}
                        {(project.startDate || project.dueDate) && (
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            {project.startDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Início: {format(new Date(project.startDate), "dd/MM/yyyy")}
                              </span>
                            )}
                            {project.dueDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Prazo: {format(new Date(project.dueDate), "dd/MM/yyyy")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <ClientContacts clientId={client.id} />
        </TabsContent>

        <TabsContent value="orgchart">
          <div ref={printRef}>
            <ClientOrgChart clientId={client.id} onPrint={handlePrintOrgChart} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
