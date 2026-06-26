import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Database, 
  Plus, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  AlertCircle, 
  Settings, 
  Code,
  XCircle,
  Filter,
  BarChart3,
  Paperclip,
  X,
  Eye,
  FileText,
  ListPlus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ERP_MODULES, ERP_ADHERENCE_STATUS, ERP_PRIORITY } from "@/lib/constants";
import { ErpAttachmentViewer } from "@/components/ErpAttachmentViewer";
import { ErpParameterizationChecklist } from "@/components/ErpParameterizationChecklist";
import { ErpReportsEditor } from "@/components/ErpReportsEditor";
import { GenerateScrumItemDialog, mapPriorityToScrum } from "@/components/GenerateScrumItemDialog";
import type { Project, Process, ErpRequirement, Client } from "@shared/schema";

function AdherenceStatusBadge({ status }: { status: string }) {
  const config = ERP_ADHERENCE_STATUS.find(s => s.value === status);
  const Icon = status === 'nativo' ? CheckCircle2 : 
               status === 'configuravel' ? Settings : 
               status === 'customizavel' ? Code : XCircle;
  return (
    <Badge variant="outline" size="sm" className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${config?.color || 'bg-gray-500'}`} />
      {config?.label || status}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const config = ERP_PRIORITY.find(p => p.value === priority);
  return (
    <span className={`text-xs font-medium ${config?.color || 'text-muted-foreground'}`}>
      {config?.label || priority}
    </span>
  );
}

interface RequirementFormData {
  requirement: string;
  description: string;
  erpModule: string;
  adherenceStatus: string;
  priority: string;
  customizationNotes: string;
  estimatedEffort: string;
  processRedesignRequired: number;
  processId?: string;
}

export default function ErpAdherence() {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<ErpRequirement | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<ErpRequirement | null>(null);
  const [filterModule, setFilterModule] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("requisitos");
  const [scrumDialogOpen, setScrumDialogOpen] = useState(false);
  const [scrumDialogReq, setScrumDialogReq] = useState<ErpRequirement | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState<RequirementFormData>({
    requirement: "",
    description: "",
    erpModule: "",
    adherenceStatus: "nao_atendido",
    priority: "media",
    customizationNotes: "",
    estimatedEffort: "",
    processRedesignRequired: 0,
    processId: "",
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?excludeType=compass"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: requirements = [], isLoading: requirementsLoading } = useQuery<ErpRequirement[]>({
    queryKey: ["/api/projects", selectedProjectId, "erp-requirements"],
    enabled: !!selectedProjectId,
  });

  const { data: processes = [] } = useQuery<Process[]>({
    queryKey: ["/api/projects", selectedProjectId, "processes"],
    enabled: !!selectedProjectId,
  });

  // Get selected project and client
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedClient = clients.find(c => c.id === selectedProject?.clientId);

  const createMutation = useMutation({
    mutationFn: async (data: RequirementFormData) => {
      return apiRequest("POST", `/api/projects/${selectedProjectId}/erp-requirements`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "erp-requirements"] });
      toast({ title: "Requisito criado com sucesso" });
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao criar requisito", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: RequirementFormData & { id: string }) => {
      const { id, ...rest } = data;
      return apiRequest("PATCH", `/api/erp-requirements/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "erp-requirements"] });
      toast({ title: "Requisito atualizado" });
      setDialogOpen(false);
      setEditingRequirement(null);
      resetForm();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar requisito", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/erp-requirements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "erp-requirements"] });
      toast({ title: "Requisito removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover requisito", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      requirement: "",
      description: "",
      erpModule: "",
      adherenceStatus: "nao_atendido",
      priority: "media",
      customizationNotes: "",
      estimatedEffort: "",
      processRedesignRequired: 0,
      processId: "",
    });
  };

  const handleEdit = (req: ErpRequirement) => {
    setEditingRequirement(req);
    setFormData({
      requirement: req.requirement,
      description: req.description || "",
      erpModule: req.erpModule || "",
      adherenceStatus: req.adherenceStatus || "nao_atendido",
      priority: req.priority || "media",
      customizationNotes: req.customizationNotes || "",
      estimatedEffort: req.estimatedEffort || "",
      processRedesignRequired: req.processRedesignRequired || 0,
      processId: req.processId || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRequirement) {
      updateMutation.mutate({ ...formData, id: editingRequirement.id });
    } else {
      createMutation.mutate(formData);
    }
  };

  // Filter requirements
  const filteredRequirements = requirements.filter(req => {
    if (filterModule !== "all" && req.erpModule !== filterModule) return false;
    if (filterStatus !== "all" && req.adherenceStatus !== filterStatus) return false;
    return true;
  });

  // Calculate adherence statistics
  const stats = {
    total: requirements.length,
    nativo: requirements.filter(r => r.adherenceStatus === 'nativo').length,
    configuravel: requirements.filter(r => r.adherenceStatus === 'configuravel').length,
    customizavel: requirements.filter(r => r.adherenceStatus === 'customizavel').length,
    naoAtendido: requirements.filter(r => r.adherenceStatus === 'nao_atendido').length,
  };

  const adherencePercent = stats.total > 0 
    ? Math.round(((stats.nativo + stats.configuravel) / stats.total) * 100)
    : 0;

  // Group by module for matrix view
  const moduleStats = ERP_MODULES.map(mod => ({
    ...mod,
    total: requirements.filter(r => r.erpModule === mod.value).length,
    nativo: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'nativo').length,
    configuravel: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'configuravel').length,
    customizavel: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'customizavel').length,
    naoAtendido: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'nao_atendido').length,
  })).filter(m => m.total > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
            <Database className="h-8 w-8 text-primary" />
            Requisitos ERP
          </h1>
          <p className="text-muted-foreground mt-1">
            Avaliacao de prontidao para implantacao de ERP
          </p>
        </div>
        {selectedProjectId && (
          <Button onClick={() => { resetForm(); setEditingRequirement(null); setDialogOpen(true); }} data-testid="button-add-requirement">
            <Plus className="h-4 w-4 mr-2" />
            Novo Requisito
          </Button>
        )}
      </div>

      <div className="flex-1 max-w-xs">
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger data-testid="select-erp-project">
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

      {!selectedProjectId ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Database className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Selecione um Projeto</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Escolha um projeto para avaliar a aderencia ao ERP.
            </p>
          </CardContent>
        </Card>
      ) : requirementsLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {/* Statistics Cards */}
          <div className="grid gap-4 md:grid-cols-5">
            <Card className="border-card-border">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total de Requisitos</div>
              </CardContent>
            </Card>
            <Card className="border-card-border">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-600">{stats.nativo}</div>
                <div className="text-xs text-muted-foreground">Nativos</div>
              </CardContent>
            </Card>
            <Card className="border-card-border">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-blue-600">{stats.configuravel}</div>
                <div className="text-xs text-muted-foreground">Configuraveis</div>
              </CardContent>
            </Card>
            <Card className="border-card-border">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-yellow-600">{stats.customizavel}</div>
                <div className="text-xs text-muted-foreground">Customizaveis</div>
              </CardContent>
            </Card>
            <Card className="border-card-border">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-red-600">{stats.naoAtendido}</div>
                <div className="text-xs text-muted-foreground">Nao Atendidos</div>
              </CardContent>
            </Card>
          </div>

          {/* Adherence Progress */}
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Indice de Aderencia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Progress value={adherencePercent} className="flex-1" />
                <span className="font-bold text-lg">{adherencePercent}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Requisitos atendidos nativamente ou por configuracao
              </p>
            </CardContent>
          </Card>

          {/* Module Matrix */}
          {moduleStats.length > 0 && (
            <Card className="border-card-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Matriz de Aderencia por Modulo</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modulo</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">Nativo</TableHead>
                      <TableHead className="text-center">Config.</TableHead>
                      <TableHead className="text-center">Custom.</TableHead>
                      <TableHead className="text-center">Nao Atend.</TableHead>
                      <TableHead className="text-center">Aderencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moduleStats.map(mod => {
                      const modAdherence = mod.total > 0 
                        ? Math.round(((mod.nativo + mod.configuravel) / mod.total) * 100)
                        : 0;
                      return (
                        <TableRow key={mod.value}>
                          <TableCell className="font-medium">{mod.label}</TableCell>
                          <TableCell className="text-center">{mod.total}</TableCell>
                          <TableCell className="text-center text-green-600">{mod.nativo}</TableCell>
                          <TableCell className="text-center text-blue-600">{mod.configuravel}</TableCell>
                          <TableCell className="text-center text-yellow-600">{mod.customizavel}</TableCell>
                          <TableCell className="text-center text-red-600">{mod.naoAtendido}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={modAdherence >= 70 ? "default" : modAdherence >= 40 ? "secondary" : "destructive"}>
                              {modAdherence}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtros:</span>
            </div>
            <Select value={filterModule} onValueChange={setFilterModule}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Modulo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Modulos</SelectItem>
                {ERP_MODULES.map(mod => (
                  <SelectItem key={mod.value} value={mod.value}>{mod.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Status</SelectItem>
                {ERP_ADHERENCE_STATUS.map(status => (
                  <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tabs for Requirements and Parameterization */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="requisitos" data-testid="tab-requisitos">
                <Database className="h-4 w-4 mr-2" />
                Requisitos
              </TabsTrigger>
              <TabsTrigger value="parametrizacao" data-testid="tab-parametrizacao">
                <Settings className="h-4 w-4 mr-2" />
                Parametrizacao
              </TabsTrigger>
              <TabsTrigger value="relatorios" data-testid="tab-relatorios">
                <FileText className="h-4 w-4 mr-2" />
                Relatorios
              </TabsTrigger>
            </TabsList>

            <TabsContent value="requisitos" className="space-y-4">
              {/* Requirements Table */}
              <Card className="border-card-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Lista de Requisitos ({filteredRequirements.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredRequirements.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {requirements.length === 0 
                        ? "Nenhum requisito cadastrado. Clique em 'Novo Requisito' para comecar."
                        : "Nenhum requisito encontrado com os filtros selecionados."}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Requisito</TableHead>
                          <TableHead>Modulo</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Prioridade</TableHead>
                          <TableHead>Esforco</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRequirements.map(req => (
                          <TableRow 
                            key={req.id}
                            className={`cursor-pointer ${selectedRequirement?.id === req.id ? 'bg-muted' : ''}`}
                            onClick={() => setSelectedRequirement(selectedRequirement?.id === req.id ? null : req)}
                          >
                            <TableCell>
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {req.requirement}
                                  {selectedRequirement?.id === req.id && (
                                    <Badge variant="secondary" size="sm">
                                      <Eye className="h-3 w-3 mr-1" />
                                      Detalhes
                                    </Badge>
                                  )}
                                </div>
                                {req.description && (
                                  <div className="text-xs text-muted-foreground line-clamp-1">{req.description}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" size="sm">
                                {ERP_MODULES.find(m => m.value === req.erpModule)?.label || req.erpModule || '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <AdherenceStatusBadge status={req.adherenceStatus || 'nao_atendido'} />
                            </TableCell>
                            <TableCell>
                              <PriorityBadge priority={req.priority || 'media'} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {req.estimatedEffort || '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={(e) => { e.stopPropagation(); handleEdit(req); }} 
                                  data-testid={`button-edit-${req.id}`}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setScrumDialogReq(req);
                                    setScrumDialogOpen(true);
                                  }}
                                  data-testid={`button-scrum-${req.id}`}
                                  title="Gerar Item Scrum"
                                >
                                  <ListPlus className="h-4 w-4" />
                                </Button>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(req.id); }}
                                  data-testid={`button-delete-${req.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Requirement Detail with Attachments */}
              {selectedRequirement && (
                <Card className="border-card-border border-primary/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Paperclip className="h-5 w-5 text-primary" />
                        Detalhes: {selectedRequirement.requirement}
                      </CardTitle>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setSelectedRequirement(null)}
                        data-testid="button-close-detail"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Descricao</div>
                        <div className="text-sm mt-1">{selectedRequirement.description || '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Notas de Customizacao</div>
                        <div className="text-sm mt-1">{selectedRequirement.customizationNotes || '-'}</div>
                      </div>
                    </div>
                    
                    <ErpAttachmentViewer 
                      requirementId={selectedRequirement.id} 
                      requirementName={selectedRequirement.requirement}
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="parametrizacao">
              <ErpParameterizationChecklist projectId={selectedProjectId} />
            </TabsContent>

            <TabsContent value="relatorios">
              <ErpReportsEditor 
                projectId={selectedProjectId}
                project={selectedProject}
                client={selectedClient}
                requirements={requirements}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRequirement ? "Editar Requisito" : "Novo Requisito ERP"}</DialogTitle>
            <DialogDescription>
              Cadastre um requisito de negocio e avalie sua aderencia ao ERP.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Requisito *</label>
              <Input
                value={formData.requirement}
                onChange={(e) => setFormData({ ...formData, requirement: e.target.value })}
                placeholder="Ex: Emissao de NF-e automatica"
                required
                data-testid="input-requirement"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Descricao</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descreva o requisito em detalhes..."
                rows={2}
                className="resize-none"
                data-testid="input-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Modulo ERP</label>
                <Select value={formData.erpModule} onValueChange={(val) => setFormData({ ...formData, erpModule: val })}>
                  <SelectTrigger data-testid="select-module">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ERP_MODULES.map(mod => (
                      <SelectItem key={mod.value} value={mod.value}>{mod.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Status de Aderencia</label>
                <Select value={formData.adherenceStatus} onValueChange={(val) => setFormData({ ...formData, adherenceStatus: val })}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ERP_ADHERENCE_STATUS.map(status => (
                      <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Prioridade</label>
                <Select value={formData.priority} onValueChange={(val) => setFormData({ ...formData, priority: val })}>
                  <SelectTrigger data-testid="select-priority">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ERP_PRIORITY.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Esforco Estimado</label>
                <Input
                  value={formData.estimatedEffort}
                  onChange={(e) => setFormData({ ...formData, estimatedEffort: e.target.value })}
                  placeholder="Ex: 40 horas"
                  data-testid="input-effort"
                />
              </div>
            </div>

            {(formData.adherenceStatus === 'customizavel' || formData.adherenceStatus === 'nao_atendido') && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Notas de Customizacao</label>
                <Textarea
                  value={formData.customizationNotes}
                  onChange={(e) => setFormData({ ...formData, customizationNotes: e.target.value })}
                  placeholder="Descreva os requisitos de customizacao..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-customization-notes"
                />
              </div>
            )}

            {processes.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Processo Relacionado</label>
                <Select 
                  value={formData.processId || "__none__"} 
                  onValueChange={(val) => setFormData({ ...formData, processId: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-process">
                    <SelectValue placeholder="Selecione um processo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum</SelectItem>
                    {processes.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit">
                {editingRequirement ? "Salvar" : "Criar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {scrumDialogReq && (
        <GenerateScrumItemDialog
          open={scrumDialogOpen}
          onOpenChange={setScrumDialogOpen}
          originType="erp_requirement"
          originId={scrumDialogReq.id}
          originProjectId={scrumDialogReq.projectId}
          defaultTitle={scrumDialogReq.requirement}
          defaultDescription={scrumDialogReq.description || ""}
          defaultType="feature"
          defaultPriority={mapPriorityToScrum(scrumDialogReq.priority)}
        />
      )}
    </div>
  );
}
