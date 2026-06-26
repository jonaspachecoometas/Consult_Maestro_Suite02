import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FolderKanban,
  Plus,
  Edit,
  Trash2,
  Calendar,
  Play,
  Pause,
  CheckCircle2,
  Archive,
  Search,
  Filter,
  Download,
  Building2,
  Wrench,
  LayoutDashboard,
  Sparkles,
  FileSpreadsheet,
  Upload,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ScrumInternalProject, Project } from "@shared/schema";

type ProjectWithRelations = ScrumInternalProject & {
  clientProject?: Project;
};

const statusConfig: Record<string, { label: string; icon: React.ElementType; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "Ativo", icon: Play, variant: "default" },
  paused: { label: "Pausado", icon: Pause, variant: "secondary" },
  completed: { label: "Concluido", icon: CheckCircle2, variant: "outline" },
  archived: { label: "Arquivado", icon: Archive, variant: "secondary" },
};

const projectFormSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  description: z.string().optional(),
  clientProjectId: z.string().optional(),
  status: z.string().default("active"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  color: z.string().default("#3b82f6"),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

const colorOptions = [
  { value: "#3b82f6", label: "Azul" },
  { value: "#10b981", label: "Verde" },
  { value: "#f59e0b", label: "Amarelo" },
  { value: "#ef4444", label: "Vermelho" },
  { value: "#8b5cf6", label: "Roxo" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#6b7280", label: "Cinza" },
];

export default function ScrumProjects() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ScrumInternalProject | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: projects = [], isLoading } = useQuery<ProjectWithRelations[]>({
    queryKey: ["/api/scrum/projects"],
  });

  const { data: clientProjects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?excludeType=compass"],
  });

  const alreadyImportedClientProjectIds = new Set(
    projects.filter(p => p.clientProjectId).map(p => p.clientProjectId)
  );

  const availableClientProjects = clientProjects.filter(
    p => !alreadyImportedClientProjectIds.has(p.id)
  );

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: "",
      description: "",
      clientProjectId: "",
      status: "active",
      startDate: "",
      endDate: "",
      color: "#3b82f6",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const payload = {
        ...data,
        clientProjectId: data.clientProjectId && data.clientProjectId !== "none" ? data.clientProjectId : null,
        startDate: data.startDate ? new Date(data.startDate).toISOString() : null,
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
        isInternal: data.clientProjectId && data.clientProjectId !== "none" ? 0 : 1,
      };
      return apiRequest("POST", "/api/scrum/projects", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Projeto criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar projeto", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ProjectFormValues }) => {
      const payload = {
        ...data,
        clientProjectId: data.clientProjectId && data.clientProjectId !== "none" ? data.clientProjectId : null,
        startDate: data.startDate ? new Date(data.startDate).toISOString() : null,
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
        isInternal: data.clientProjectId && data.clientProjectId !== "none" ? 0 : 1,
      };
      return apiRequest("PATCH", `/api/scrum/projects/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      setDialogOpen(false);
      setEditingProject(null);
      form.reset();
      toast({ title: "Projeto atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar projeto", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scrum/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      toast({ title: "Projeto excluido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir projeto", variant: "destructive" });
    },
  });

  // PROD-1 — Importar cronograma .xlsx
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importTargetId, setImportTargetId] = useState<string | null>(null);

  const importCronogramaMutation = useMutation({
    mutationFn: async ({ projetoId, file }: { projetoId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`/api/producao/projetos/${projetoId}/importar-cronograma`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: resp.statusText }));
        throw new Error(err.message || "Falha ao importar cronograma");
      }
      return resp.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({
        title: "Cronograma importado",
        description: result?.resumo || "Sprints, tarefas e reuniões processadas.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao importar cronograma", description: err?.message, variant: "destructive" });
    },
  });

  const handleDownloadTemplate = (projetoNome?: string, clienteNome?: string) => {
    const params = new URLSearchParams();
    if (projetoNome) params.set("projeto", projetoNome);
    if (clienteNome) params.set("cliente", clienteNome);
    params.set("dataInicio", format(new Date(), "yyyy-MM-dd"));
    window.open(`/api/producao/templates/cronograma?${params.toString()}`, "_blank");
  };

  const handleImportClick = (projetoId: string) => {
    setImportTargetId(projetoId);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && importTargetId) {
      importCronogramaMutation.mutate({ projetoId: importTargetId, file });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setImportTargetId(null);
  };

  const importMutation = useMutation({
    mutationFn: async (clientProject: Project) => {
      const payload = {
        name: clientProject.name,
        description: clientProject.description || "",
        clientProjectId: clientProject.id,
        isInternal: 0,
        status: "active",
        startDate: clientProject.startDate ? new Date(clientProject.startDate).toISOString() : null,
        endDate: clientProject.dueDate ? new Date(clientProject.dueDate).toISOString() : null,
        color: "#3b82f6",
      };
      return apiRequest("POST", "/api/scrum/projects", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      toast({ title: "Projeto importado para producao" });
    },
    onError: () => {
      toast({ title: "Erro ao importar projeto", variant: "destructive" });
    },
  });

  const handleEdit = (project: ScrumInternalProject) => {
    setEditingProject(project);
    form.reset({
      name: project.name,
      description: project.description || "",
      clientProjectId: project.clientProjectId || "",
      status: project.status || "active",
      startDate: project.startDate ? format(new Date(project.startDate), "yyyy-MM-dd") : "",
      endDate: project.endDate ? format(new Date(project.endDate), "yyyy-MM-dd") : "",
      color: project.color || "#3b82f6",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: ProjectFormValues) => {
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingProject(null);
    form.reset();
  };

  const filteredProjects = projects.filter((project) => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    const matchesType = typeFilter === "all" || 
      (typeFilter === "internal" && project.isInternal === 1) ||
      (typeFilter === "client" && project.isInternal === 0);
    return matchesSearch && matchesStatus && matchesType;
  });

  const getStatusCounts = () => {
    const counts: Record<string, number> = { all: projects.length };
    projects.forEach((p) => {
      const status = p.status || "active";
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  };

  const getTypeCounts = () => {
    let internal = 0;
    let client = 0;
    projects.forEach((p) => {
      if (p.isInternal === 1) internal++;
      else client++;
    });
    return { all: projects.length, internal, client };
  };

  const statusCounts = getStatusCounts();
  const typeCounts = getTypeCounts();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileSelected}
        data-testid="input-cronograma-file"
      />
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-projects-title">
            Projetos em Producao
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie projetos internos e de clientes para sprints e backlog.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => handleDownloadTemplate()}
            data-testid="button-download-cronograma-template"
            title="Baixar planilha modelo do cronograma (16 sprints + calendário de reuniões)"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Template Cronograma
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-project"
          >
            <Download className="h-4 w-4 mr-2" />
            Importar Cliente
          </Button>
          <Button
            onClick={() => {
              setEditingProject(null);
              form.reset();
              setDialogOpen(true);
            }}
            data-testid="button-create-project"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo Projeto
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos ({statusCounts.all})</SelectItem>
            <SelectItem value="active">Ativos ({statusCounts.active || 0})</SelectItem>
            <SelectItem value="paused">Pausados ({statusCounts.paused || 0})</SelectItem>
            <SelectItem value="completed">Concluidos ({statusCounts.completed || 0})</SelectItem>
            <SelectItem value="archived">Arquivados ({statusCounts.archived || 0})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos ({typeCounts.all})</SelectItem>
            <SelectItem value="internal">Internos ({typeCounts.internal})</SelectItem>
            <SelectItem value="client">Clientes ({typeCounts.client})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredProjects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhum projeto encontrado</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || statusFilter !== "all" || typeFilter !== "all"
                ? "Tente ajustar os filtros de busca."
                : "Crie seu primeiro projeto interno para organizar sprints e backlog."}
            </p>
            {!searchQuery && statusFilter === "all" && typeFilter === "all" && (
              <Button
                onClick={() => {
                  form.reset();
                  setDialogOpen(true);
                }}
                data-testid="button-create-first-project"
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar Projeto
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => {
            const statusInfo = statusConfig[project.status || "active"] || statusConfig.active;
            const StatusIcon = statusInfo.icon;
            return (
              <Card
                key={project.id}
                className="border-card-border"
                data-testid={`card-project-${project.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: project.color || "#3b82f6" }}
                      />
                      <CardTitle className="text-lg truncate">{project.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(project)}
                        data-testid={`button-edit-project-${project.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-delete-project-${project.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acao nao pode ser desfeita. Sprints e itens de backlog
                              associados podem ficar orfaos.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(project.id)}>
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {project.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusInfo.variant} size="sm">
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusInfo.label}
                    </Badge>
                    {project.isInternal === 1 ? (
                      <Badge variant="secondary" size="sm">
                        <Wrench className="h-3 w-3 mr-1" />
                        Interno
                      </Badge>
                    ) : (
                      <Badge variant="outline" size="sm">
                        <Building2 className="h-3 w-3 mr-1" />
                        Cliente
                      </Badge>
                    )}
                    {project.isInternal === 0 && project.clientProject && (
                      <Badge variant="outline" size="sm">
                        {project.clientProject.name}
                      </Badge>
                    )}
                  </div>

                  {(project.startDate || project.endDate) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {project.startDate
                          ? format(new Date(project.startDate), "dd MMM yyyy", { locale: ptBR })
                          : "Sem inicio"}
                        {" - "}
                        {project.endDate
                          ? format(new Date(project.endDate), "dd MMM yyyy", { locale: ptBR })
                          : "Sem fim"}
                      </span>
                    </div>
                  )}

                  {project.clientProjectId ? (
                    <div className="flex flex-col gap-2 pt-2 border-t">
                      <Button
                        asChild
                        size="sm"
                        className="w-full"
                        data-testid={`button-open-dashboard-${project.id}`}
                      >
                        <Link href={`/projetos/${project.clientProjectId}`}>
                          <LayoutDashboard className="h-4 w-4 mr-2" />
                          Abrir Dashboard
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="w-full"
                        data-testid={`button-open-agent-${project.id}`}
                      >
                        <Link href={`/projetos/${project.clientProjectId}`}>
                          <Sparkles className="h-4 w-4 mr-2 text-primary" />
                          Drive + Agente Scrum
                        </Link>
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadTemplate(project.name, project.clientProject?.name)}
                          data-testid={`button-download-template-${project.id}`}
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Template
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleImportClick(project.id)}
                          disabled={importCronogramaMutation.isPending && importTargetId === project.id}
                          data-testid={`button-import-cronograma-${project.id}`}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {importCronogramaMutation.isPending && importTargetId === project.id ? "Importando..." : "Cronograma"}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          asChild variant="outline" size="sm"
                          data-testid={`button-reunioes-${project.id}`}
                        >
                          <Link href={`/producao/projetos/${project.id}/reunioes`}>
                            <Calendar className="h-4 w-4 mr-2 text-primary" />
                            Reuniões
                          </Link>
                        </Button>
                        <Button
                          asChild variant="outline" size="sm"
                          data-testid={`button-relatorio-${project.id}`}
                        >
                          <Link href={`/producao/projetos/${project.id}/relatorio`}>
                            <TrendingUp className="h-4 w-4 mr-2 text-primary" />
                            Relatório
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground italic">
                        Vincule este projeto a um projeto cliente (ao editar) para abrir Dashboard e Agente Scrum.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && handleDialogClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? "Editar Projeto" : "Novo Projeto"}
            </DialogTitle>
            <DialogDescription>
              {editingProject
                ? "Atualize as informacoes do projeto."
                : "Preencha os dados para criar um novo projeto interno."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Nome do projeto"
                        {...field}
                        data-testid="input-project-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descricao</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descricao do projeto"
                        {...field}
                        data-testid="input-project-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientProjectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Projeto Cliente (opcional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-client-project">
                          <SelectValue placeholder="Vincular a projeto cliente" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhum (Projeto Interno)</SelectItem>
                        {clientProjects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-project-status">
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="paused">Pausado</SelectItem>
                        <SelectItem value="completed">Concluido</SelectItem>
                        <SelectItem value="archived">Arquivado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data Inicio</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-project-start-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data Fim</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-project-end-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cor</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-project-color">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-4 w-4 rounded-full"
                              style={{ backgroundColor: field.value }}
                            />
                            <SelectValue placeholder="Selecione uma cor" />
                          </div>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {colorOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-4 w-4 rounded-full"
                                style={{ backgroundColor: option.value }}
                              />
                              {option.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDialogClose}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-project"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Salvando..."
                    : editingProject
                    ? "Salvar"
                    : "Criar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar Projeto de Cliente</DialogTitle>
            <DialogDescription>
              Selecione um projeto de cliente para adicionar a producao.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {availableClientProjects.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                Todos os projetos de clientes ja foram importados.
              </p>
            ) : (
              availableClientProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg border hover-elevate"
                  data-testid={`import-project-${project.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{project.name}</p>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => importMutation.mutate(project)}
                    disabled={importMutation.isPending}
                    data-testid={`button-import-${project.id}`}
                  >
                    Importar
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
