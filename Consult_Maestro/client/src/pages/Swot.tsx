import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Plus, Trash2, Edit, Target, TrendingUp, TrendingDown, AlertTriangle, Shield, Loader2, ArrowLeft, ClipboardList, Play, CheckCircle, RotateCcw, Calendar, BarChart3, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SwotAnalysis, SwotItem, Project } from "@shared/schema";

type SwotType = 'strength' | 'weakness' | 'opportunity' | 'threat';
type SwotPriority = 'high' | 'medium' | 'low';
type PdcaStatus = 'plan' | 'do' | 'check' | 'act' | 'done';

const pdcaConfig: Record<PdcaStatus, { label: string; icon: typeof ClipboardList; color: string }> = {
  plan: { label: 'Planejar', icon: ClipboardList, color: 'text-blue-600' },
  do: { label: 'Executar', icon: Play, color: 'text-amber-600' },
  check: { label: 'Verificar', icon: CheckCircle, color: 'text-purple-600' },
  act: { label: 'Agir', icon: RotateCcw, color: 'text-emerald-600' },
  done: { label: 'Concluído', icon: CheckCircle, color: 'text-green-600' },
};

const swotTypeConfig: Record<SwotType, { label: string; labelPT: string; color: string; bgColor: string; icon: typeof Target }> = {
  strength: { label: 'Strength', labelPT: 'Força', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950/50', icon: Shield },
  weakness: { label: 'Weakness', labelPT: 'Fraqueza', color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-50 dark:bg-rose-950/50', icon: AlertTriangle },
  opportunity: { label: 'Opportunity', labelPT: 'Oportunidade', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/50', icon: TrendingUp },
  threat: { label: 'Threat', labelPT: 'Ameaça', color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/50', icon: TrendingDown },
};

const priorityConfig: Record<SwotPriority, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  high: { label: 'Alta', variant: 'default' },
  medium: { label: 'Média', variant: 'secondary' },
  low: { label: 'Baixa', variant: 'outline' },
};

export default function Swot() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId || null);
  const [isNewAnalysisOpen, setIsNewAnalysisOpen] = useState(false);
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [isDeleteItemOpen, setIsDeleteItemOpen] = useState(false);
  const [selectedItemType, setSelectedItemType] = useState<SwotType>('strength');
  const [selectedItem, setSelectedItem] = useState<SwotItem | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);

  const [newAnalysisName, setNewAnalysisName] = useState('');
  const [newAnalysisDescription, setNewAnalysisDescription] = useState('');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemPriority, setNewItemPriority] = useState<SwotPriority>('medium');
  const [newItemImpact, setNewItemImpact] = useState(3);
  const [newItemPdcaStatus, setNewItemPdcaStatus] = useState<PdcaStatus>('plan');
  const [newItemActionPlan, setNewItemActionPlan] = useState('');
  const [newItemActionResult, setNewItemActionResult] = useState('');

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
  });

  const { data: analyses = [], isLoading: isLoadingAnalyses } = useQuery<SwotAnalysis[]>({
    queryKey: ['/api/projects', selectedProjectId, 'swot'],
    enabled: !!selectedProjectId,
  });

  const activeAnalysis = analyses[0];

  const { data: items = [], isLoading: isLoadingItems } = useQuery<SwotItem[]>({
    queryKey: ['/api/swot', activeAnalysis?.id, 'items'],
    enabled: !!activeAnalysis?.id,
  });

  const createAnalysisMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return apiRequest('POST', `/api/projects/${selectedProjectId}/swot`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProjectId, 'swot'] });
      toast({ title: 'Análise SWOT criada com sucesso' });
      setIsNewAnalysisOpen(false);
      setNewAnalysisName('');
      setNewAnalysisDescription('');
    },
    onError: () => {
      toast({ title: 'Erro ao criar análise', variant: 'destructive' });
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: { type: SwotType; title: string; description?: string; priority: SwotPriority; impact: number }) => {
      return apiRequest('POST', `/api/swot/${activeAnalysis?.id}/items`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/swot', activeAnalysis?.id, 'items'] });
      toast({ title: 'Item adicionado com sucesso' });
      setIsNewItemOpen(false);
      resetNewItemForm();
    },
    onError: () => {
      toast({ title: 'Erro ao adicionar item', variant: 'destructive' });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SwotItem> }) => {
      return apiRequest('PATCH', `/api/swot-items/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/swot', activeAnalysis?.id, 'items'] });
      toast({ title: 'Item atualizado com sucesso' });
      setIsEditItemOpen(false);
      setSelectedItem(null);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar item', variant: 'destructive' });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/swot-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/swot', activeAnalysis?.id, 'items'] });
      toast({ title: 'Item removido com sucesso' });
      setIsDeleteItemOpen(false);
      setSelectedItem(null);
    },
    onError: () => {
      toast({ title: 'Erro ao remover item', variant: 'destructive' });
    },
  });

  const resetNewItemForm = () => {
    setNewItemTitle('');
    setNewItemDescription('');
    setNewItemPriority('medium');
    setNewItemImpact(3);
    setNewItemPdcaStatus('plan');
    setNewItemActionPlan('');
    setNewItemActionResult('');
  };

  const openNewItemDialog = (type: SwotType) => {
    setSelectedItemType(type);
    resetNewItemForm();
    setIsNewItemOpen(true);
  };

  const openEditItemDialog = (item: SwotItem) => {
    setSelectedItem(item);
    setNewItemTitle(item.title);
    setNewItemDescription(item.description || '');
    setNewItemPriority(item.priority as SwotPriority || 'medium');
    setNewItemImpact(item.impact || 3);
    setNewItemPdcaStatus((item.pdcaStatus as PdcaStatus) || 'plan');
    setNewItemActionPlan(item.actionPlan || '');
    setNewItemActionResult(item.actionResult || '');
    setIsEditItemOpen(true);
  };

  const openDeleteItemDialog = (item: SwotItem) => {
    setSelectedItem(item);
    setIsDeleteItemOpen(true);
  };

  const handleCreateAnalysis = () => {
    if (!newAnalysisName.trim()) return;
    createAnalysisMutation.mutate({
      name: newAnalysisName,
      description: newAnalysisDescription || undefined,
    });
  };

  const handleCreateItem = () => {
    if (!newItemTitle.trim()) return;
    createItemMutation.mutate({
      type: selectedItemType,
      title: newItemTitle,
      description: newItemDescription || undefined,
      priority: newItemPriority,
      impact: newItemImpact,
    });
  };

  const handleUpdateItem = () => {
    if (!selectedItem || !newItemTitle.trim()) return;
    updateItemMutation.mutate({
      id: selectedItem.id,
      data: {
        title: newItemTitle,
        description: newItemDescription || undefined,
        priority: newItemPriority,
        impact: newItemImpact,
        pdcaStatus: newItemPdcaStatus,
        actionPlan: newItemActionPlan || undefined,
        actionResult: newItemActionResult || undefined,
      },
    });
  };

  const handleDeleteItem = () => {
    if (!selectedItem) return;
    deleteItemMutation.mutate(selectedItem.id);
  };

  const getItemsByType = (type: SwotType) => items.filter(item => item.type === type);

  const getSwotStats = () => {
    const stats = {
      strengths: items.filter(i => i.type === 'strength').length,
      weaknesses: items.filter(i => i.type === 'weakness').length,
      opportunities: items.filter(i => i.type === 'opportunity').length,
      threats: items.filter(i => i.type === 'threat').length,
      total: items.length,
      highPriority: items.filter(i => i.priority === 'high').length,
      pdcaPlan: items.filter(i => !i.pdcaStatus || i.pdcaStatus === 'plan').length,
      pdcaDo: items.filter(i => i.pdcaStatus === 'do').length,
      pdcaCheck: items.filter(i => i.pdcaStatus === 'check').length,
      pdcaAct: items.filter(i => i.pdcaStatus === 'act').length,
      pdcaDone: items.filter(i => i.pdcaStatus === 'done').length,
    };
    return stats;
  };

  const stats = activeAnalysis ? getSwotStats() : null;

  const renderQuadrant = (type: SwotType) => {
    const config = swotTypeConfig[type];
    const quadrantItems = getItemsByType(type);
    const Icon = config.icon;

    return (
      <Card className={`flex flex-col h-full ${config.bgColor}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon className={`h-5 w-5 ${config.color}`} />
              <CardTitle className={`text-base ${config.color}`}>{config.labelPT}</CardTitle>
              <Badge variant="outline" className="text-xs">{quadrantItems.length}</Badge>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => openNewItemDialog(type)}
              data-testid={`button-add-${type}`}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto space-y-2">
          {quadrantItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum item cadastrado
            </p>
          ) : (
            quadrantItems.map((item) => (
              <Card 
                key={item.id} 
                className="bg-background/80 hover-elevate cursor-pointer"
                onClick={() => openEditItemDialog(item)}
                data-testid={`card-swot-item-${item.id}`}
              >
                <CardContent className="p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.title}</p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <Badge 
                        variant={priorityConfig[item.priority as SwotPriority]?.variant || 'secondary'} 
                        className="text-xs shrink-0"
                      >
                        {priorityConfig[item.priority as SwotPriority]?.label || 'Média'}
                      </Badge>
                    </div>
                    {item.pdcaStatus && item.pdcaStatus !== 'plan' && (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={`text-xs ${pdcaConfig[item.pdcaStatus as PdcaStatus]?.color || ''}`}>
                          {pdcaConfig[item.pdcaStatus as PdcaStatus]?.label || item.pdcaStatus}
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoadingProjects) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {selectedProjectId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedProjectId(null);
                navigate('/swot');
              }}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-heading font-bold" data-testid="text-page-title">
              Análise SWOT
            </h1>
            <p className="text-muted-foreground text-sm">
              Analise forças, fraquezas, oportunidades e ameaças do negócio
            </p>
          </div>
        </div>
        {activeAnalysis && (
          <Button
            onClick={() => setIsNewAnalysisOpen(true)}
            data-testid="button-new-analysis"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova Análise
          </Button>
        )}
      </div>

      {!selectedProjectId ? (
        <div className="flex-1">
          <Card>
            <CardHeader>
              <CardTitle>Selecione um Projeto</CardTitle>
              <CardDescription>
                Escolha um projeto para visualizar ou criar uma análise SWOT
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      navigate(`/swot/${project.id}`);
                    }}
                    data-testid={`card-project-${project.id}`}
                  >
                    <CardContent className="p-4">
                      <h3 className="font-medium">{project.name}</h3>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {project.description}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : !activeAnalysis ? (
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <Target className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <CardTitle>Nenhuma Análise SWOT</CardTitle>
              <CardDescription>
                Este projeto ainda não possui uma análise SWOT. Crie uma agora para começar.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => setIsNewAnalysisOpen(true)} data-testid="button-create-first-analysis">
                <Plus className="h-4 w-4 mr-2" />
                Criar Análise SWOT
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {stats && items.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="swot-dashboard">
              <Card className="bg-emerald-50 dark:bg-emerald-950/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Shield className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs text-muted-foreground">Forcas</span>
                  </div>
                  <p className="text-2xl font-bold text-emerald-600" data-testid="stat-strengths">{stats.strengths}</p>
                </CardContent>
              </Card>
              <Card className="bg-rose-50 dark:bg-rose-950/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    <span className="text-xs text-muted-foreground">Fraquezas</span>
                  </div>
                  <p className="text-2xl font-bold text-rose-600" data-testid="stat-weaknesses">{stats.weaknesses}</p>
                </CardContent>
              </Card>
              <Card className="bg-blue-50 dark:bg-blue-950/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    <span className="text-xs text-muted-foreground">Oportunidades</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-600" data-testid="stat-opportunities">{stats.opportunities}</p>
                </CardContent>
              </Card>
              <Card className="bg-amber-50 dark:bg-amber-950/30">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingDown className="h-4 w-4 text-amber-600" />
                    <span className="text-xs text-muted-foreground">Ameacas</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-600" data-testid="stat-threats">{stats.threats}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Alta Prioridade</span>
                  </div>
                  <p className="text-2xl font-bold" data-testid="stat-high-priority">{stats.highPriority}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-xs text-muted-foreground">PDCA Concluido</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600" data-testid="stat-pdca-done">{stats.pdcaDone}</p>
                </CardContent>
              </Card>
            </div>
          )}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
            {renderQuadrant('strength')}
            {renderQuadrant('weakness')}
            {renderQuadrant('opportunity')}
            {renderQuadrant('threat')}
          </div>
        </div>
      )}

      <Dialog open={isNewAnalysisOpen} onOpenChange={setIsNewAnalysisOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Análise SWOT</DialogTitle>
            <DialogDescription>
              Crie uma nova análise SWOT para este projeto
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="analysis-name">Nome da Análise</Label>
              <Input
                id="analysis-name"
                value={newAnalysisName}
                onChange={(e) => setNewAnalysisName(e.target.value)}
                placeholder="Ex: Análise Q4 2024"
                data-testid="input-analysis-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis-description">Descrição (opcional)</Label>
              <Textarea
                id="analysis-description"
                value={newAnalysisDescription}
                onChange={(e) => setNewAnalysisDescription(e.target.value)}
                placeholder="Descreva o contexto desta análise..."
                data-testid="input-analysis-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewAnalysisOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateAnalysis}
              disabled={!newAnalysisName.trim() || createAnalysisMutation.isPending}
              data-testid="button-save-analysis"
            >
              {createAnalysisMutation.isPending ? 'Criando...' : 'Criar Análise'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewItemOpen} onOpenChange={setIsNewItemOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Adicionar {swotTypeConfig[selectedItemType].labelPT}
            </DialogTitle>
            <DialogDescription>
              Adicione um novo item à análise SWOT
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item-title">Título</Label>
              <Input
                id="item-title"
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                placeholder="Título do item"
                data-testid="input-item-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-description">Descrição</Label>
              <Textarea
                id="item-description"
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                placeholder="Descreva este item..."
                data-testid="input-item-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-priority">Prioridade</Label>
                <Select value={newItemPriority} onValueChange={(v) => setNewItemPriority(v as SwotPriority)}>
                  <SelectTrigger data-testid="select-item-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="low">Baixa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-impact">Impacto (1-5)</Label>
                <Select value={String(newItemImpact)} onValueChange={(v) => setNewItemImpact(Number(v))}>
                  <SelectTrigger data-testid="select-item-impact">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - Muito Baixo</SelectItem>
                    <SelectItem value="2">2 - Baixo</SelectItem>
                    <SelectItem value="3">3 - Médio</SelectItem>
                    <SelectItem value="4">4 - Alto</SelectItem>
                    <SelectItem value="5">5 - Muito Alto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewItemOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateItem}
              disabled={!newItemTitle.trim() || createItemMutation.isPending}
              data-testid="button-save-item"
            >
              {createItemMutation.isPending ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditItemOpen} onOpenChange={setIsEditItemOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Item SWOT</DialogTitle>
            <DialogDescription>
              Edite as informações e acompanhe o ciclo PDCA
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details" data-testid="tab-details">Detalhes</TabsTrigger>
              <TabsTrigger value="pdca" data-testid="tab-pdca">Ciclo PDCA</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="edit-item-title">Título</Label>
                <Input
                  id="edit-item-title"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  placeholder="Título do item"
                  data-testid="input-edit-item-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-item-description">Descrição</Label>
                <Textarea
                  id="edit-item-description"
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  placeholder="Descreva este item..."
                  data-testid="input-edit-item-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-item-priority">Prioridade</Label>
                  <Select value={newItemPriority} onValueChange={(v) => setNewItemPriority(v as SwotPriority)}>
                    <SelectTrigger data-testid="select-edit-item-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="low">Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-item-impact">Impacto (1-5)</Label>
                  <Select value={String(newItemImpact)} onValueChange={(v) => setNewItemImpact(Number(v))}>
                    <SelectTrigger data-testid="select-edit-item-impact">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 - Muito Baixo</SelectItem>
                      <SelectItem value="2">2 - Baixo</SelectItem>
                      <SelectItem value="3">3 - Médio</SelectItem>
                      <SelectItem value="4">4 - Alto</SelectItem>
                      <SelectItem value="5">5 - Muito Alto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="pdca" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Status do Ciclo PDCA</Label>
                <div className="flex gap-2 flex-wrap">
                  {(Object.entries(pdcaConfig) as [PdcaStatus, typeof pdcaConfig[PdcaStatus]][]).map(([status, config]) => {
                    const Icon = config.icon;
                    const isActive = newItemPdcaStatus === status;
                    return (
                      <Button
                        key={status}
                        type="button"
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNewItemPdcaStatus(status)}
                        className={isActive ? '' : config.color}
                        data-testid={`button-pdca-${status}`}
                      >
                        <Icon className="h-4 w-4 mr-1" />
                        {config.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="edit-action-plan">Plano de Ação</Label>
                <Textarea
                  id="edit-action-plan"
                  value={newItemActionPlan}
                  onChange={(e) => setNewItemActionPlan(e.target.value)}
                  placeholder="Descreva as ações planejadas para este item..."
                  className="min-h-[100px]"
                  data-testid="input-action-plan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-action-result">Resultado/Verificação</Label>
                <Textarea
                  id="edit-action-result"
                  value={newItemActionResult}
                  onChange={(e) => setNewItemActionResult(e.target.value)}
                  placeholder="Registre os resultados e verificações realizadas..."
                  className="min-h-[100px]"
                  data-testid="input-action-result"
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter className="flex justify-between gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                setIsEditItemOpen(false);
                openDeleteItemDialog(selectedItem!);
              }}
              data-testid="button-delete-item"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditItemOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleUpdateItem}
                disabled={!newItemTitle.trim() || updateItemMutation.isPending}
                data-testid="button-update-item"
              >
                {updateItemMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteItemOpen} onOpenChange={setIsDeleteItemOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Item</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o item "{selectedItem?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteItemMutation.isPending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
