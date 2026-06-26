import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, Link, useLocation } from "wouter";
import { 
  GitBranch, 
  Plus, 
  Search,
  Cog,
  Zap,
  MoreVertical,
  Edit,
  Trash2,
  Workflow
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PROCESS_CATEGORIES } from "@/lib/constants";
import type { Project, Process } from "@shared/schema";

function ProcessCard({ 
  process, 
  projectId,
  onEdit 
}: { 
  process: Process;
  projectId: string;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const category = PROCESS_CATEGORIES.find(c => c.value === process.category);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/processes/${process.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "processes"] });
      toast({ title: "Processo excluído" });
    },
  });

  return (
    <Card className="border-card-border group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Cog className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{process.name}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {process.variantType === 'as_is' && (
                    <Badge variant="outline" size="sm" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
                      AS-IS
                    </Badge>
                  )}
                  {process.variantType === 'to_be' && (
                    <Badge variant="outline" size="sm" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                      TO-BE
                    </Badge>
                  )}
                  {category && (
                    <Badge variant="outline" size="sm" className="text-xs">
                      {category.label}
                    </Badge>
                  )}
                  {process.isAutomatable === 1 && (
                    <Badge variant="secondary" size="sm" className="text-xs">
                      <Zap className="h-3 w-3 mr-1" />
                      Automatizável
                    </Badge>
                  )}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit className="h-4 w-4 mr-2" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="text-destructive"
                    onClick={() => deleteMutation.mutate()}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {process.description && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                {process.description}
              </p>
            )}
            <div className="mt-3 pt-3 border-t border-border">
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                asChild
              >
                <Link 
                  href={`/processo/${process.id}`}
                  data-testid={`link-flow-${process.id}`}
                >
                  <Workflow className="h-4 w-4 mr-2" />
                  Desenhar Fluxo
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Processes() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const projectIdFromUrl = params.get("projectId");
  
  const [selectedProjectId, setSelectedProjectId] = useState(projectIdFromUrl || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProcess, setEditingProcess] = useState<Process | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    isAutomatable: false,
  });
  const { toast } = useToast();

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?scope=production"],
  });

  const { data: processes = [], isLoading: processesLoading } = useQuery<Process[]>({
    queryKey: ["/api/projects", selectedProjectId, "processes"],
    enabled: !!selectedProjectId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${selectedProjectId}/processes`, {
        name: formData.name,
        description: formData.description,
        category: formData.category || null,
        isAutomatable: formData.isAutomatable ? 1 : 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "processes"] });
      toast({ title: "Processo criado" });
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/processes/${editingProcess?.id}`, {
        name: formData.name,
        description: formData.description,
        category: formData.category || null,
        isAutomatable: formData.isAutomatable ? 1 : 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "processes"] });
      toast({ title: "Processo atualizado" });
      setIsDialogOpen(false);
      setEditingProcess(null);
      resetForm();
    },
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", category: "", isAutomatable: false });
  };

  const openEditDialog = (process: Process) => {
    setEditingProcess(process);
    setFormData({
      name: process.name,
      description: process.description || "",
      category: process.category || "",
      isAutomatable: process.isAutomatable === 1,
    });
    setIsDialogOpen(true);
  };

  const filteredProcesses = processes.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const asIsProcesses = filteredProcesses.filter(p => p.variantType === 'as_is');
  const toBeProcesses = filteredProcesses.filter(p => p.variantType === 'to_be');

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
            <GitBranch className="h-8 w-8 text-primary" />
            Mapeamento de Processos
          </h1>
          <p className="text-muted-foreground mt-1">
            Identifique e documente os processos críticos
          </p>
        </div>
        {selectedProjectId && (
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setEditingProcess(null);
              resetForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-process">
                <Plus className="h-4 w-4 mr-2" />
                Novo Processo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingProcess ? "Editar Processo" : "Novo Processo"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Nome do processo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select 
                    value={formData.category} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESS_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Descreva o processo..."
                    rows={3}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Automatizável</Label>
                    <p className="text-xs text-muted-foreground">
                      Este processo pode ser automatizado?
                    </p>
                  </div>
                  <Switch
                    checked={formData.isAutomatable}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isAutomatable: checked }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button 
                  onClick={() => editingProcess ? updateMutation.mutate() : createMutation.mutate()}
                  disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
                >
                  {editingProcess ? "Salvar" : "Criar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex-1 max-w-xs">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger data-testid="select-process-project">
              <SelectValue placeholder="Selecione um projeto" />
            </SelectTrigger>
            <SelectContent>
              {projectsLoading ? (
                <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
              ) : projects.length === 0 ? (
                <SelectItem value="__empty__" disabled>Nenhum projeto</SelectItem>
              ) : (
                projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        {selectedProjectId && (
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar processos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
      </div>

      {!selectedProjectId ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <GitBranch className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Selecione um Projeto</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Escolha um projeto acima para mapear os processos.
            </p>
          </CardContent>
        </Card>
      ) : processesLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredProcesses.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Cog className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum processo mapeado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              Comece mapeando os processos criticos do projeto.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Mapear Processo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* AS-IS Section */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <h2 className="text-lg font-semibold">AS-IS</h2>
              </div>
              <Badge variant="outline" size="sm" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
                {asIsProcesses.length} processos
              </Badge>
              <span className="text-sm text-muted-foreground">Estado atual dos processos</span>
            </div>
            {asIsProcesses.length === 0 ? (
              <Card className="border-card-border border-dashed">
                <CardContent className="flex items-center justify-center py-8">
                  <p className="text-sm text-muted-foreground">
                    Nenhum processo AS-IS mapeado
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {asIsProcesses.map((process) => (
                  <ProcessCard
                    key={process.id}
                    process={process}
                    projectId={selectedProjectId}
                    onEdit={() => openEditDialog(process)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* TO-BE Section */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <h2 className="text-lg font-semibold">TO-BE</h2>
              </div>
              <Badge variant="outline" size="sm" className="bg-green-500/10 text-green-600 border-green-500/30">
                {toBeProcesses.length} processos
              </Badge>
              <span className="text-sm text-muted-foreground">Estado futuro desejado</span>
            </div>
            {toBeProcesses.length === 0 ? (
              <Card className="border-card-border border-dashed">
                <CardContent className="flex items-center justify-center py-8">
                  <p className="text-sm text-muted-foreground">
                    Nenhum processo TO-BE mapeado. Crie variantes TO-BE a partir dos processos AS-IS.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {toBeProcesses.map((process) => (
                  <ProcessCard
                    key={process.id}
                    process={process}
                    projectId={selectedProjectId}
                    onEdit={() => openEditDialog(process)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
