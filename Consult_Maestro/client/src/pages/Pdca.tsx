import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { 
  RefreshCcw, 
  Plus, 
  CheckCircle2,
  Circle,
  Clock,
  PlayCircle,
  Eye,
  ArrowRight,
  Edit2,
  Trash2,
  Calendar,
  User,
  Target,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AgentPanel } from "@/components/AgentPanel";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CANVAS_BLOCK_TYPES } from "@/lib/constants";
import type { Project, CanvasPdcaItem, CanvasBlock, ProcessStepPdca, SwotItem, ErpRequirement, Process, ProcessStep, SwotAnalysis } from "@shared/schema";
import { Link } from "wouter";
import { Cog, ExternalLink, TrendingUp, ClipboardList } from "lucide-react";

const SWOT_TYPES = [
  { value: 'strength', label: 'Forca' },
  { value: 'weakness', label: 'Fraqueza' },
  { value: 'opportunity', label: 'Oportunidade' },
  { value: 'threat', label: 'Ameaca' },
] as const;

const ADHERENCE_STATUSES = [
  { value: 'native', label: 'Nativo' },
  { value: 'customization', label: 'Customizacao' },
  { value: 'development', label: 'Desenvolvimento' },
  { value: 'third_party', label: 'Terceiro' },
  { value: 'pending', label: 'Pendente' },
] as const;

type ProcessPdcaWithContext = ProcessStepPdca & {
  processName: string;
  stepName: string;
  processId: string;
};

type SwotItemWithAnalysis = SwotItem & { analysisName: string };

const PDCA_STATUSES = [
  { value: 'plan', label: 'Plan', description: 'Planejamento', icon: Target, color: 'bg-blue-500' },
  { value: 'do', label: 'Do', description: 'Execucao', icon: PlayCircle, color: 'bg-yellow-500' },
  { value: 'check', label: 'Check', description: 'Verificacao', icon: Eye, color: 'bg-purple-500' },
  { value: 'act', label: 'Act', description: 'Acao Corretiva', icon: ArrowRight, color: 'bg-orange-500' },
  { value: 'done', label: 'Done', description: 'Concluido', icon: CheckCircle2, color: 'bg-green-500' },
] as const;

function StatusBadge({ status }: { status: string }) {
  const statusInfo = PDCA_STATUSES.find(s => s.value === status) || PDCA_STATUSES[0];
  const Icon = statusInfo.icon;
  return (
    <Badge className={`${statusInfo.color} text-white`} size="sm">
      <Icon className="h-3 w-3 mr-1" />
      {statusInfo.label}
    </Badge>
  );
}

function PdcaItemCard({ 
  item, 
  blocks,
  onEdit, 
  onDelete,
  onStatusChange 
}: { 
  item: CanvasPdcaItem;
  blocks: CanvasBlock[];
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
}) {
  const linkedBlock = blocks.find(b => b.id === item.blockId);
  const blockTypeInfo = linkedBlock 
    ? CANVAS_BLOCK_TYPES.find(bt => bt.value === linkedBlock.blockType)
    : null;

  const currentStatusIndex = PDCA_STATUSES.findIndex(s => s.value === item.status);
  const nextStatus = currentStatusIndex < PDCA_STATUSES.length - 1 
    ? PDCA_STATUSES[currentStatusIndex + 1] 
    : null;

  return (
    <Card className="border-card-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{item.title}</h3>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" onClick={onEdit}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <StatusBadge status={item.status as string} />
          {blockTypeInfo && (
            <Badge variant="outline" size="sm" className="text-xs">
              {blockTypeInfo.label}
            </Badge>
          )}
          {item.priority && item.priority > 0 && (
            <Badge variant="secondary" size="sm" className="text-xs">
              P{item.priority}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {item.responsible && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{item.responsible}</span>
            </div>
          )}
          {item.dueDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>{new Date(item.dueDate).toLocaleDateString('pt-BR')}</span>
            </div>
          )}
        </div>

        {nextStatus && (
          <div className="pt-2 border-t border-border">
            <Button 
              size="sm" 
              variant="outline" 
              className="w-full"
              onClick={() => onStatusChange(nextStatus.value)}
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              Avancar para {nextStatus.label}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessPdcaItemCard({ 
  item, 
  onDelete,
  onStatusChange 
}: { 
  item: ProcessPdcaWithContext;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
}) {
  const currentStatusIndex = PDCA_STATUSES.findIndex(s => s.value === item.status);
  const nextStatus = currentStatusIndex < PDCA_STATUSES.length - 1 
    ? PDCA_STATUSES[currentStatusIndex + 1] 
    : null;

  return (
    <Card className="border-card-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{item.title}</h3>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" onClick={onDelete} data-testid={`button-delete-process-pdca-${item.id}`}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <StatusBadge status={item.status as string} />
          <Badge variant="outline" size="sm" className="text-xs">
            <Cog className="h-3 w-3 mr-1" />
            Processo
          </Badge>
          {item.priority && item.priority > 0 && (
            <Badge variant="secondary" size="sm" className="text-xs">
              P{item.priority}
            </Badge>
          )}
        </div>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          <div className="flex items-center gap-1">
            <span className="font-medium">Processo:</span>
            <span className="truncate">{item.processName}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-medium">Etapa:</span>
            <span className="truncate">{item.stepName}</span>
          </div>
          <Link href={`/processos/${item.processId}`}>
            <Button variant="ghost" size="sm" className="h-6 text-xs mt-1 p-0" data-testid={`link-process-${item.processId}`}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Ver Processo
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {item.responsible && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{item.responsible}</span>
            </div>
          )}
          {item.dueDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>{new Date(item.dueDate).toLocaleDateString('pt-BR')}</span>
            </div>
          )}
        </div>

        {nextStatus && (
          <div className="pt-2 border-t border-border">
            <Button 
              size="sm" 
              variant="outline" 
              className="w-full"
              onClick={() => onStatusChange(nextStatus.value)}
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              Avancar para {nextStatus.label}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PdcaFormData {
  title: string;
  description: string;
  blockId: string;
  priority: number;
  responsible: string;
  dueDate: string;
  planNotes: string;
  doNotes: string;
  checkNotes: string;
  actNotes: string;
}

function PdcaFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  blocks,
  isSubmitting
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: PdcaFormData) => void;
  initialData?: Partial<PdcaFormData>;
  blocks: CanvasBlock[];
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState<PdcaFormData>({
    title: initialData?.title || "",
    description: initialData?.description || "",
    blockId: initialData?.blockId || "",
    priority: initialData?.priority || 0,
    responsible: initialData?.responsible || "",
    dueDate: initialData?.dueDate || "",
    planNotes: initialData?.planNotes || "",
    doNotes: initialData?.doNotes || "",
    checkNotes: initialData?.checkNotes || "",
    actNotes: initialData?.actNotes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initialData ? "Editar Item PDCA" : "Novo Item PDCA"}</DialogTitle>
          <DialogDescription>
            Crie um item de melhoria continua vinculado ao Canvas
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Titulo *</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Melhorar processo de vendas"
              required
              data-testid="input-pdca-title"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Descricao</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Descreva o item de melhoria..."
              rows={2}
              className="resize-none"
              data-testid="input-pdca-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bloco Canvas</label>
              <Select 
                value={formData.blockId} 
                onValueChange={(val) => setFormData({ ...formData, blockId: val })}
              >
                <SelectTrigger data-testid="select-pdca-block">
                  <SelectValue placeholder="Selecione um bloco" />
                </SelectTrigger>
                <SelectContent>
                  {blocks.map((block) => {
                    const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
                    return (
                      <SelectItem key={block.id} value={block.id}>
                        {blockType?.label || block.blockType}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade</label>
              <Select 
                value={String(formData.priority)} 
                onValueChange={(val) => setFormData({ ...formData, priority: parseInt(val) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sem prioridade</SelectItem>
                  <SelectItem value="1">P1 - Critica</SelectItem>
                  <SelectItem value="2">P2 - Alta</SelectItem>
                  <SelectItem value="3">P3 - Media</SelectItem>
                  <SelectItem value="4">P4 - Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Responsavel</label>
              <Input
                value={formData.responsible}
                onChange={(e) => setFormData({ ...formData, responsible: e.target.value })}
                placeholder="Nome do responsavel"
                data-testid="input-pdca-responsible"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Data Limite</label>
              <Input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                data-testid="input-pdca-due-date"
              />
            </div>
          </div>

          <Tabs defaultValue="plan" className="w-full">
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="do">Do</TabsTrigger>
              <TabsTrigger value="check">Check</TabsTrigger>
              <TabsTrigger value="act">Act</TabsTrigger>
            </TabsList>
            <TabsContent value="plan" className="mt-2">
              <Textarea
                value={formData.planNotes}
                onChange={(e) => setFormData({ ...formData, planNotes: e.target.value })}
                placeholder="O que sera feito? Por que? Como?"
                rows={3}
                className="resize-none"
              />
            </TabsContent>
            <TabsContent value="do" className="mt-2">
              <Textarea
                value={formData.doNotes}
                onChange={(e) => setFormData({ ...formData, doNotes: e.target.value })}
                placeholder="Registre a execucao das acoes..."
                rows={3}
                className="resize-none"
              />
            </TabsContent>
            <TabsContent value="check" className="mt-2">
              <Textarea
                value={formData.checkNotes}
                onChange={(e) => setFormData({ ...formData, checkNotes: e.target.value })}
                placeholder="Resultados obtidos vs esperados..."
                rows={3}
                className="resize-none"
              />
            </TabsContent>
            <TabsContent value="act" className="mt-2">
              <Textarea
                value={formData.actNotes}
                onChange={(e) => setFormData({ ...formData, actNotes: e.target.value })}
                placeholder="Acoes corretivas e padronizacao..."
                rows={3}
                className="resize-none"
              />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!formData.title.trim() || isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {initialData ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Pdca() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const projectIdFromUrl = params.get("projectId");
  
  const [selectedProjectId, setSelectedProjectId] = useState(projectIdFromUrl || "");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [sourceTab, setSourceTab] = useState<"canvas" | "processos" | "swot" | "requisitos">("canvas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CanvasPdcaItem | null>(null);
  const [editingSwotItem, setEditingSwotItem] = useState<SwotItemWithAnalysis | null>(null);
  const [editingErpItem, setEditingErpItem] = useState<ErpRequirement | null>(null);
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [swotDialogOpen, setSwotDialogOpen] = useState(false);
  const [erpDialogOpen, setErpDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?scope=production"],
  });

  const { data: pdcaItems = [], isLoading: itemsLoading } = useQuery<CanvasPdcaItem[]>({
    queryKey: ["/api/projects", selectedProjectId, "pdca"],
    enabled: !!selectedProjectId,
  });

  const { data: processPdcaItems = [], isLoading: processItemsLoading } = useQuery<ProcessPdcaWithContext[]>({
    queryKey: ["/api/projects", selectedProjectId, "process-pdca"],
    enabled: !!selectedProjectId,
  });

  const { data: swotItems = [], isLoading: swotItemsLoading } = useQuery<SwotItemWithAnalysis[]>({
    queryKey: ["/api/projects", selectedProjectId, "swot-pdca"],
    enabled: !!selectedProjectId,
  });

  const { data: erpRequirements = [], isLoading: erpRequirementsLoading } = useQuery<ErpRequirement[]>({
    queryKey: ["/api/projects", selectedProjectId, "erp-requirements"],
    enabled: !!selectedProjectId,
  });

  const { data: canvasBlocks = [] } = useQuery<CanvasBlock[]>({
    queryKey: ["/api/projects", selectedProjectId, "canvas"],
    enabled: !!selectedProjectId,
  });

  const { data: processes = [] } = useQuery<Process[]>({
    queryKey: ["/api/projects", selectedProjectId, "processes"],
    enabled: !!selectedProjectId,
  });

  const { data: swotAnalyses = [] } = useQuery<SwotAnalysis[]>({
    queryKey: ["/api/projects", selectedProjectId, "swot"],
    enabled: !!selectedProjectId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: PdcaFormData) => {
      await apiRequest("POST", `/api/projects/${selectedProjectId}/pdca`, {
        title: data.title,
        description: data.description || null,
        blockId: data.blockId || null,
        priority: data.priority,
        responsible: data.responsible || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        planNotes: data.planNotes || null,
        doNotes: data.doNotes || null,
        checkNotes: data.checkNotes || null,
        actNotes: data.actNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "pdca"] });
      setDialogOpen(false);
      toast({ title: "Item criado", description: "Item PDCA criado com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel criar o item.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PdcaFormData> }) => {
      await apiRequest("PATCH", `/api/pdca/${id}`, {
        title: data.title,
        description: data.description || null,
        blockId: data.blockId || null,
        priority: data.priority,
        responsible: data.responsible || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        planNotes: data.planNotes || null,
        doNotes: data.doNotes || null,
        checkNotes: data.checkNotes || null,
        actNotes: data.actNotes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "pdca"] });
      setEditingItem(null);
      toast({ title: "Item atualizado" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel atualizar o item.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pdca/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "pdca"] });
      toast({ title: "Item removido" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel remover o item.", variant: "destructive" });
    },
  });

  const statusChangeMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/pdca/${id}`, { 
        status,
        completedAt: status === 'done' ? new Date() : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "pdca"] });
    },
  });

  // Process PDCA mutations
  const processDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/process-step-pdca/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "process-pdca"] });
      toast({ title: "Item removido" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel remover o item.", variant: "destructive" });
    },
  });

  const processStatusChangeMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/process-step-pdca/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "process-pdca"] });
    },
  });

  // SWOT PDCA mutations
  const swotUpdateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { pdcaStatus?: string; actionPlan?: string; actionDueDate?: Date | null; actionResult?: string } }) => {
      await apiRequest("PATCH", `/api/swot-items/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "swot-pdca"] });
      setEditingSwotItem(null);
      toast({ title: "Item SWOT atualizado" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel atualizar o item SWOT.", variant: "destructive" });
    },
  });

  // ERP Requirements PDCA mutations
  const erpUpdateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { pdcaStatus?: string; recommendation?: string; actionDueDate?: Date | null; actionResult?: string } }) => {
      await apiRequest("PATCH", `/api/erp-requirements/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "erp-requirements"] });
      setEditingErpItem(null);
      toast({ title: "Requisito ERP atualizado" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel atualizar o requisito ERP.", variant: "destructive" });
    },
  });

  // Create Process PDCA mutation
  const createProcessPdcaMutation = useMutation({
    mutationFn: async (data: { stepId: string; title: string; description: string; priority: number; responsible: string; dueDate: string }) => {
      await apiRequest("POST", `/api/process-steps/${data.stepId}/pdca`, {
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        responsible: data.responsible || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "process-pdca"] });
      setProcessDialogOpen(false);
      toast({ title: "Item criado", description: "Item PDCA de processo criado com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel criar o item.", variant: "destructive" });
    },
  });

  // Create SWOT Item mutation
  const createSwotItemMutation = useMutation({
    mutationFn: async (data: { analysisId: string; type: string; title: string; description: string; priority: string; impact: number; pdcaStatus: string; actionPlan: string }) => {
      await apiRequest("POST", `/api/swot/${data.analysisId}/items`, {
        type: data.type,
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        impact: data.impact,
        pdcaStatus: data.pdcaStatus,
        actionPlan: data.actionPlan || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "swot-pdca"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "swot"] });
      setSwotDialogOpen(false);
      toast({ title: "Item criado", description: "Item SWOT criado com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel criar o item SWOT.", variant: "destructive" });
    },
  });

  // Create ERP Requirement mutation
  const createErpRequirementMutation = useMutation({
    mutationFn: async (data: { module: string; requirement: string; adherenceStatus: string; priority: number; recommendation: string; pdcaStatus: string }) => {
      await apiRequest("POST", `/api/projects/${selectedProjectId}/erp-requirements`, {
        erpModule: data.module,
        requirement: data.requirement,
        adherenceStatus: data.adherenceStatus,
        priority: data.priority,
        recommendation: data.recommendation || null,
        pdcaStatus: data.pdcaStatus,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "erp-requirements"] });
      setErpDialogOpen(false);
      toast({ title: "Requisito criado", description: "Requisito ERP criado com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Nao foi possivel criar o requisito.", variant: "destructive" });
    },
  });

  // Canvas PDCA filtering
  const filteredItems = selectedStatus === "all" 
    ? pdcaItems 
    : pdcaItems.filter(item => item.status === selectedStatus);

  const statusCounts = PDCA_STATUSES.reduce((acc, status) => {
    acc[status.value] = pdcaItems.filter(item => item.status === status.value).length;
    return acc;
  }, {} as Record<string, number>);

  const completedCount = statusCounts['done'] || 0;
  const totalCount = pdcaItems.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Process PDCA filtering
  const filteredProcessItems = selectedStatus === "all"
    ? processPdcaItems
    : processPdcaItems.filter(item => item.status === selectedStatus);

  const processStatusCounts = PDCA_STATUSES.reduce((acc, status) => {
    acc[status.value] = processPdcaItems.filter(item => item.status === status.value).length;
    return acc;
  }, {} as Record<string, number>);

  const processCompletedCount = processStatusCounts['done'] || 0;
  const processTotalCount = processPdcaItems.length;
  const processProgressPercent = processTotalCount > 0 ? Math.round((processCompletedCount / processTotalCount) * 100) : 0;

  // SWOT PDCA filtering (items with action plans)
  const swotWithActions = swotItems.filter(item => item.actionPlan || item.pdcaStatus);
  const filteredSwotItems = selectedStatus === "all"
    ? swotWithActions
    : swotWithActions.filter(item => item.pdcaStatus === selectedStatus);

  const swotStatusCounts = PDCA_STATUSES.reduce((acc, status) => {
    acc[status.value] = swotWithActions.filter(item => item.pdcaStatus === status.value).length;
    return acc;
  }, {} as Record<string, number>);

  const swotCompletedCount = swotStatusCounts['done'] || 0;
  const swotTotalCount = swotWithActions.length;
  const swotProgressPercent = swotTotalCount > 0 ? Math.round((swotCompletedCount / swotTotalCount) * 100) : 0;

  // ERP Requirements PDCA filtering (requirements with recommendations)
  const erpWithPdca = erpRequirements.filter(req => req.recommendation || req.pdcaStatus);
  const filteredErpItems = selectedStatus === "all"
    ? erpWithPdca
    : erpWithPdca.filter(item => item.pdcaStatus === selectedStatus);

  const erpStatusCounts = PDCA_STATUSES.reduce((acc, status) => {
    acc[status.value] = erpWithPdca.filter(item => item.pdcaStatus === status.value).length;
    return acc;
  }, {} as Record<string, number>);

  const erpCompletedCount = erpStatusCounts['done'] || 0;
  const erpTotalCount = erpWithPdca.length;
  const erpProgressPercent = erpTotalCount > 0 ? Math.round((erpCompletedCount / erpTotalCount) * 100) : 0;

  // Get current tab counts
  const getCurrentTabCounts = () => {
    switch (sourceTab) {
      case "canvas": return { total: totalCount, counts: statusCounts };
      case "processos": return { total: processTotalCount, counts: processStatusCounts };
      case "swot": return { total: swotTotalCount, counts: swotStatusCounts };
      case "requisitos": return { total: erpTotalCount, counts: erpStatusCounts };
    }
  };
  const currentCounts = getCurrentTabCounts();

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
            <RefreshCcw className="h-8 w-8 text-primary" />
            PDCA - Melhoria Continua
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie ciclos de melhoria continua vinculados ao Canvas e Processos
          </p>
        </div>
        {selectedProjectId && (
          <>
            {sourceTab === "canvas" && (
              <Button onClick={() => setDialogOpen(true)} data-testid="button-new-pdca">
                <Plus className="h-4 w-4 mr-2" />
                Novo Item
              </Button>
            )}
            {sourceTab === "processos" && (
              <Button onClick={() => setProcessDialogOpen(true)} data-testid="button-new-process-pdca">
                <Plus className="h-4 w-4 mr-2" />
                Novo Item
              </Button>
            )}
            {sourceTab === "swot" && (
              <Button onClick={() => setSwotDialogOpen(true)} data-testid="button-new-swot-pdca">
                <Plus className="h-4 w-4 mr-2" />
                Novo Item
              </Button>
            )}
            {sourceTab === "requisitos" && (
              <Button onClick={() => setErpDialogOpen(true)} data-testid="button-new-erp-pdca">
                <Plus className="h-4 w-4 mr-2" />
                Novo Item
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1 max-w-xs">
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger data-testid="select-pdca-project">
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

          <div className="flex gap-1 p-1 bg-muted rounded-md flex-wrap">
            <Button
              variant={selectedStatus === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSelectedStatus("all")}
              className="text-xs"
            >
              Todos ({currentCounts.total})
            </Button>
            {PDCA_STATUSES.map((status) => (
              <Button
                key={status.value}
                variant={selectedStatus === status.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedStatus(status.value)}
                className="text-xs"
              >
                {status.label} ({currentCounts.counts[status.value] || 0})
              </Button>
            ))}
          </div>
        </div>

        {selectedProjectId && (
          <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as "canvas" | "processos" | "swot" | "requisitos")} className="w-full">
            <TabsList>
              <TabsTrigger value="canvas" data-testid="tab-pdca-canvas">
                Canvas ({totalCount})
              </TabsTrigger>
              <TabsTrigger value="processos" data-testid="tab-pdca-processos">
                Processos ({processTotalCount})
              </TabsTrigger>
              <TabsTrigger value="swot" data-testid="tab-pdca-swot">
                SWOT ({swotTotalCount})
              </TabsTrigger>
              <TabsTrigger value="requisitos" data-testid="tab-pdca-requisitos">
                Requisitos ({erpTotalCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {selectedProjectId && (
        <AgentPanel
          projectId={selectedProjectId}
          agentType="swot_analysis"
          label="Gerar plano PDCA com IA"
          description="Sugere ciclos PDCA priorizados com base no diagnóstico do projeto"
          visibleIn="pdca"
        />
      )}

      {!selectedProjectId ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <RefreshCcw className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Selecione um Projeto</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Escolha um projeto acima para visualizar e gerenciar itens PDCA.
            </p>
          </CardContent>
        </Card>
      ) : (itemsLoading || processItemsLoading || swotItemsLoading || erpRequirementsLoading) ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : sourceTab === "canvas" ? (
        <>
          {totalCount > 0 && (
            <Card className="border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Progresso Canvas</span>
                  <span className="text-sm text-muted-foreground">
                    {completedCount}/{totalCount} concluidos ({progressPercent}%)
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          {filteredItems.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Circle className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold text-lg mb-2">
                  {selectedStatus === "all" ? "Nenhum item PDCA de Canvas" : `Nenhum item em "${PDCA_STATUSES.find(s => s.value === selectedStatus)?.label}"`}
                </h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  {selectedStatus === "all" 
                    ? "Crie o primeiro item de melhoria continua vinculado ao Canvas."
                    : "Nao ha itens neste status no momento."}
                </p>
                {selectedStatus === "all" && (
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Item
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <PdcaItemCard
                  key={item.id}
                  item={item}
                  blocks={canvasBlocks}
                  onEdit={() => setEditingItem(item)}
                  onDelete={() => deleteMutation.mutate(item.id)}
                  onStatusChange={(status) => statusChangeMutation.mutate({ id: item.id, status })}
                />
              ))}
            </div>
          )}
        </>
      ) : sourceTab === "processos" ? (
        <>
          {processTotalCount > 0 && (
            <Card className="border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Progresso Processos</span>
                  <span className="text-sm text-muted-foreground">
                    {processCompletedCount}/{processTotalCount} concluidos ({processProgressPercent}%)
                  </span>
                </div>
                <Progress value={processProgressPercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          {filteredProcessItems.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Cog className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold text-lg mb-2">
                  {selectedStatus === "all" ? "Nenhum item PDCA de Processos" : `Nenhum item em "${PDCA_STATUSES.find(s => s.value === selectedStatus)?.label}"`}
                </h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  {selectedStatus === "all" 
                    ? "Crie itens PDCA nas etapas de processos TO-BE para ve-los aqui."
                    : "Nao ha itens neste status no momento."}
                </p>
                <Link href="/processos">
                  <Button variant="outline">
                    <Cog className="h-4 w-4 mr-2" />
                    Ir para Processos
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredProcessItems.map((item) => (
                <ProcessPdcaItemCard
                  key={item.id}
                  item={item}
                  onDelete={() => processDeleteMutation.mutate(item.id)}
                  onStatusChange={(status) => processStatusChangeMutation.mutate({ id: item.id, status })}
                />
              ))}
            </div>
          )}
        </>
      ) : sourceTab === "swot" ? (
        <>
          {swotTotalCount > 0 && (
            <Card className="border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Progresso SWOT</span>
                  <span className="text-sm text-muted-foreground">
                    {swotCompletedCount}/{swotTotalCount} concluidos ({swotProgressPercent}%)
                  </span>
                </div>
                <Progress value={swotProgressPercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          {filteredSwotItems.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <TrendingUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold text-lg mb-2">
                  {selectedStatus === "all" ? "Nenhum item PDCA de SWOT" : `Nenhum item em "${PDCA_STATUSES.find(s => s.value === selectedStatus)?.label}"`}
                </h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  {selectedStatus === "all" 
                    ? "Adicione planos de acao nos itens SWOT para ve-los aqui."
                    : "Nao ha itens neste status no momento."}
                </p>
                <Link href={`/swot/${selectedProjectId}`}>
                  <Button variant="outline">
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Ir para SWOT
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredSwotItems.map((item) => (
                <Card key={item.id} className="border-card-border">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="mb-2">
                          {item.type === 'strength' ? 'Forca' : item.type === 'weakness' ? 'Fraqueza' : item.type === 'opportunity' ? 'Oportunidade' : 'Ameaca'}
                        </Badge>
                        <CardTitle className="text-base line-clamp-2">{item.content}</CardTitle>
                      </div>
                      <Badge className={`shrink-0 ${PDCA_STATUSES.find(s => s.value === item.pdcaStatus)?.color || 'bg-muted'}`}>
                        {PDCA_STATUSES.find(s => s.value === item.pdcaStatus)?.label || 'Planejar'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground mb-2">Analise: {item.analysisName}</p>
                    {item.actionPlan && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{item.actionPlan}</p>
                    )}
                    {item.actionDueDate && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Prazo: {new Date(item.actionDueDate).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                    <div className="flex justify-end gap-1 mt-3">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setEditingSwotItem(item)}
                        data-testid={`button-edit-swot-${item.id}`}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Editar PDCA
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {erpTotalCount > 0 && (
            <Card className="border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Progresso Requisitos ERP</span>
                  <span className="text-sm text-muted-foreground">
                    {erpCompletedCount}/{erpTotalCount} concluidos ({erpProgressPercent}%)
                  </span>
                </div>
                <Progress value={erpProgressPercent} className="h-2" />
              </CardContent>
            </Card>
          )}

          {filteredErpItems.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <ClipboardList className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold text-lg mb-2">
                  {selectedStatus === "all" ? "Nenhum item PDCA de Requisitos" : `Nenhum item em "${PDCA_STATUSES.find(s => s.value === selectedStatus)?.label}"`}
                </h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  {selectedStatus === "all" 
                    ? "Adicione recomendacoes nos requisitos ERP para ve-los aqui."
                    : "Nao ha itens neste status no momento."}
                </p>
                <Link href={`/requisitos/${selectedProjectId}`}>
                  <Button variant="outline">
                    <ClipboardList className="h-4 w-4 mr-2" />
                    Ir para Requisitos
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredErpItems.map((item) => (
                <Card key={item.id} className="border-card-border">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="mb-2">{item.module}</Badge>
                        <CardTitle className="text-base line-clamp-2">{item.requirement}</CardTitle>
                      </div>
                      <Badge className={`shrink-0 ${PDCA_STATUSES.find(s => s.value === item.pdcaStatus)?.color || 'bg-muted'}`}>
                        {PDCA_STATUSES.find(s => s.value === item.pdcaStatus)?.label || 'Planejar'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Badge variant="secondary" className="mb-2">{item.adherenceStatus || 'Pendente'}</Badge>
                    {item.recommendation && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{item.recommendation}</p>
                    )}
                    <div className="flex justify-end gap-1 mt-3">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setEditingErpItem(item)}
                        data-testid={`button-edit-erp-${item.id}`}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Editar PDCA
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <PdcaFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={(data) => createMutation.mutate(data)}
        blocks={canvasBlocks}
        isSubmitting={createMutation.isPending}
      />

      {editingItem && (
        <PdcaFormDialog
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
          initialData={{
            title: editingItem.title,
            description: editingItem.description || "",
            blockId: editingItem.blockId || "",
            priority: editingItem.priority || 0,
            responsible: editingItem.responsible || "",
            dueDate: editingItem.dueDate ? new Date(editingItem.dueDate).toISOString().split('T')[0] : "",
            planNotes: editingItem.planNotes || "",
            doNotes: editingItem.doNotes || "",
            checkNotes: editingItem.checkNotes || "",
            actNotes: editingItem.actNotes || "",
          }}
          blocks={canvasBlocks}
          isSubmitting={updateMutation.isPending}
        />
      )}

      {/* SWOT PDCA Edit Dialog */}
      {editingSwotItem && (
        <SwotPdcaDialog
          item={editingSwotItem}
          open={!!editingSwotItem}
          onClose={() => setEditingSwotItem(null)}
          onSubmit={(data) => swotUpdateMutation.mutate({ id: editingSwotItem.id, data })}
          isSubmitting={swotUpdateMutation.isPending}
        />
      )}

      {/* ERP PDCA Edit Dialog */}
      {editingErpItem && (
        <ErpPdcaDialog
          item={editingErpItem}
          open={!!editingErpItem}
          onClose={() => setEditingErpItem(null)}
          onSubmit={(data) => erpUpdateMutation.mutate({ id: editingErpItem.id, data })}
          isSubmitting={erpUpdateMutation.isPending}
        />
      )}

      {/* Process PDCA Create Dialog */}
      <CreateProcessPdcaDialog
        open={processDialogOpen}
        onClose={() => setProcessDialogOpen(false)}
        onSubmit={(data) => createProcessPdcaMutation.mutate(data)}
        processes={processes}
        isSubmitting={createProcessPdcaMutation.isPending}
      />

      {/* SWOT Item Create Dialog */}
      <CreateSwotItemDialog
        open={swotDialogOpen}
        onClose={() => setSwotDialogOpen(false)}
        onSubmit={(data) => createSwotItemMutation.mutate(data)}
        analyses={swotAnalyses}
        isSubmitting={createSwotItemMutation.isPending}
      />

      {/* ERP Requirement Create Dialog */}
      <CreateErpRequirementDialog
        open={erpDialogOpen}
        onClose={() => setErpDialogOpen(false)}
        onSubmit={(data) => createErpRequirementMutation.mutate(data)}
        isSubmitting={createErpRequirementMutation.isPending}
      />
    </div>
  );
}

// SWOT PDCA Edit Dialog Component
function SwotPdcaDialog({
  item,
  open,
  onClose,
  onSubmit,
  isSubmitting
}: {
  item: SwotItemWithAnalysis;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { pdcaStatus: string; actionPlan: string; actionDueDate: Date | null; actionResult: string }) => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    pdcaStatus: item.pdcaStatus || 'plan',
    actionPlan: item.actionPlan || '',
    actionDueDate: item.actionDueDate ? new Date(item.actionDueDate).toISOString().split('T')[0] : '',
    actionResult: item.actionResult || '',
  });

  // Reset form when item changes
  useEffect(() => {
    setFormData({
      pdcaStatus: item.pdcaStatus || 'plan',
      actionPlan: item.actionPlan || '',
      actionDueDate: item.actionDueDate ? new Date(item.actionDueDate).toISOString().split('T')[0] : '',
      actionResult: item.actionResult || '',
    });
  }, [item.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      pdcaStatus: formData.pdcaStatus,
      actionPlan: formData.actionPlan.trim() || '',
      actionDueDate: formData.actionDueDate ? new Date(formData.actionDueDate) : null,
      actionResult: formData.actionResult.trim() || '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar PDCA - SWOT</DialogTitle>
          <DialogDescription>
            <Badge variant="outline" className="mr-2">
              {item.type === 'strength' ? 'Forca' : item.type === 'weakness' ? 'Fraqueza' : item.type === 'opportunity' ? 'Oportunidade' : 'Ameaca'}
            </Badge>
            {item.content}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status PDCA</label>
            <Select value={formData.pdcaStatus} onValueChange={(v) => setFormData({ ...formData, pdcaStatus: v })}>
              <SelectTrigger data-testid="select-swot-pdca-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PDCA_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label} - {status.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Plano de Acao</label>
            <Textarea
              value={formData.actionPlan}
              onChange={(e) => setFormData({ ...formData, actionPlan: e.target.value })}
              placeholder="Descreva o plano de acao..."
              rows={3}
              className="resize-none"
              data-testid="input-swot-action-plan"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data Prazo</label>
            <Input
              type="date"
              value={formData.actionDueDate}
              onChange={(e) => setFormData({ ...formData, actionDueDate: e.target.value })}
              data-testid="input-swot-due-date"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Resultado da Acao</label>
            <Textarea
              value={formData.actionResult}
              onChange={(e) => setFormData({ ...formData, actionResult: e.target.value })}
              placeholder="Descreva o resultado obtido..."
              rows={3}
              className="resize-none"
              data-testid="input-swot-action-result"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} data-testid="button-save-swot-pdca">
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ERP PDCA Edit Dialog Component
function ErpPdcaDialog({
  item,
  open,
  onClose,
  onSubmit,
  isSubmitting
}: {
  item: ErpRequirement;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { pdcaStatus: string; recommendation: string; actionDueDate: Date | null; actionResult: string }) => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    pdcaStatus: item.pdcaStatus || 'plan',
    recommendation: item.recommendation || '',
    actionDueDate: item.actionDueDate ? new Date(item.actionDueDate).toISOString().split('T')[0] : '',
    actionResult: item.actionResult || '',
  });

  // Reset form when item changes
  useEffect(() => {
    setFormData({
      pdcaStatus: item.pdcaStatus || 'plan',
      recommendation: item.recommendation || '',
      actionDueDate: item.actionDueDate ? new Date(item.actionDueDate).toISOString().split('T')[0] : '',
      actionResult: item.actionResult || '',
    });
  }, [item.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      pdcaStatus: formData.pdcaStatus,
      recommendation: formData.recommendation.trim() || '',
      actionDueDate: formData.actionDueDate ? new Date(formData.actionDueDate) : null,
      actionResult: formData.actionResult.trim() || '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar PDCA - Requisito ERP</DialogTitle>
          <DialogDescription>
            <Badge variant="outline" className="mr-2">{item.erpModule}</Badge>
            {item.requirement}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status PDCA</label>
            <Select value={formData.pdcaStatus} onValueChange={(v) => setFormData({ ...formData, pdcaStatus: v })}>
              <SelectTrigger data-testid="select-erp-pdca-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PDCA_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label} - {status.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Recomendacao / Plano de Acao</label>
            <Textarea
              value={formData.recommendation}
              onChange={(e) => setFormData({ ...formData, recommendation: e.target.value })}
              placeholder="Descreva a recomendacao ou plano de acao..."
              rows={3}
              className="resize-none"
              data-testid="input-erp-recommendation"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data Prazo</label>
            <Input
              type="date"
              value={formData.actionDueDate}
              onChange={(e) => setFormData({ ...formData, actionDueDate: e.target.value })}
              data-testid="input-erp-due-date"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Resultado da Acao</label>
            <Textarea
              value={formData.actionResult}
              onChange={(e) => setFormData({ ...formData, actionResult: e.target.value })}
              placeholder="Descreva o resultado obtido..."
              rows={3}
              className="resize-none"
              data-testid="input-erp-action-result"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} data-testid="button-save-erp-pdca">
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Create Process PDCA Dialog Component
function CreateProcessPdcaDialog({
  open,
  onClose,
  onSubmit,
  processes,
  isSubmitting
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { stepId: string; title: string; description: string; priority: number; responsible: string; dueDate: string }) => void;
  processes: Process[];
  isSubmitting: boolean;
}) {
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [formData, setFormData] = useState({
    stepId: '',
    title: '',
    description: '',
    priority: 0,
    responsible: '',
    dueDate: '',
  });

  const { data: steps = [] } = useQuery<ProcessStep[]>({
    queryKey: ["/api/processes", selectedProcessId, "steps"],
    enabled: !!selectedProcessId,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.stepId || !formData.title.trim()) return;
    onSubmit(formData);
  };

  const resetForm = () => {
    setSelectedProcessId('');
    setFormData({ stepId: '', title: '', description: '', priority: 0, responsible: '', dueDate: '' });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Item PDCA - Processo</DialogTitle>
          <DialogDescription>
            Crie um item de melhoria continua vinculado a uma etapa de processo
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Processo *</label>
              <Select value={selectedProcessId} onValueChange={(v) => { setSelectedProcessId(v); setFormData({ ...formData, stepId: '' }); }}>
                <SelectTrigger data-testid="select-process">
                  <SelectValue placeholder="Selecione um processo" />
                </SelectTrigger>
                <SelectContent>
                  {processes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Etapa *</label>
              <Select value={formData.stepId} onValueChange={(v) => setFormData({ ...formData, stepId: v })} disabled={!selectedProcessId}>
                <SelectTrigger data-testid="select-process-step">
                  <SelectValue placeholder="Selecione uma etapa" />
                </SelectTrigger>
                <SelectContent>
                  {steps.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Titulo *</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Automatizar aprovacao"
              required
              data-testid="input-process-pdca-title"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Descricao</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Descreva a melhoria..."
              rows={2}
              className="resize-none"
              data-testid="input-process-pdca-description"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade</label>
              <Select value={String(formData.priority)} onValueChange={(v) => setFormData({ ...formData, priority: parseInt(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sem prioridade</SelectItem>
                  <SelectItem value="1">P1 - Critica</SelectItem>
                  <SelectItem value="2">P2 - Alta</SelectItem>
                  <SelectItem value="3">P3 - Media</SelectItem>
                  <SelectItem value="4">P4 - Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Responsavel</label>
              <Input
                value={formData.responsible}
                onChange={(e) => setFormData({ ...formData, responsible: e.target.value })}
                placeholder="Nome"
                data-testid="input-process-pdca-responsible"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Prazo</label>
              <Input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                data-testid="input-process-pdca-due-date"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onClose(); resetForm(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!formData.stepId || !formData.title.trim() || isSubmitting} data-testid="button-create-process-pdca">
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SWOT_PRIORITIES = [
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baixa' },
] as const;

// Create SWOT Item Dialog Component
function CreateSwotItemDialog({
  open,
  onClose,
  onSubmit,
  analyses,
  isSubmitting
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { analysisId: string; type: string; title: string; description: string; priority: string; impact: number; pdcaStatus: string; actionPlan: string }) => void;
  analyses: SwotAnalysis[];
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    analysisId: '',
    type: 'strength',
    title: '',
    description: '',
    priority: 'medium',
    impact: 3,
    pdcaStatus: 'plan',
    actionPlan: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.analysisId || !formData.title.trim()) return;
    onSubmit(formData);
  };

  const resetForm = () => {
    setFormData({ analysisId: '', type: 'strength', title: '', description: '', priority: 'medium', impact: 3, pdcaStatus: 'plan', actionPlan: '' });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Item SWOT com PDCA</DialogTitle>
          <DialogDescription>
            Crie um item SWOT com plano de acao integrado
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Analise SWOT *</label>
              <Select value={formData.analysisId} onValueChange={(v) => setFormData({ ...formData, analysisId: v })}>
                <SelectTrigger data-testid="select-swot-analysis">
                  <SelectValue placeholder="Selecione uma analise" />
                </SelectTrigger>
                <SelectContent>
                  {analyses.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo *</label>
              <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                <SelectTrigger data-testid="select-swot-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SWOT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Titulo *</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Titulo do item SWOT..."
              required
              data-testid="input-swot-title"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Descricao</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Descreva o item SWOT..."
              rows={2}
              className="resize-none"
              data-testid="input-swot-description"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade</label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                <SelectTrigger data-testid="select-swot-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SWOT_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Impacto (1-5)</label>
              <Select value={String(formData.impact)} onValueChange={(v) => setFormData({ ...formData, impact: parseInt(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status PDCA</label>
              <Select value={formData.pdcaStatus} onValueChange={(v) => setFormData({ ...formData, pdcaStatus: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PDCA_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Plano de Acao</label>
            <Textarea
              value={formData.actionPlan}
              onChange={(e) => setFormData({ ...formData, actionPlan: e.target.value })}
              placeholder="Descreva o plano de acao..."
              rows={2}
              className="resize-none"
              data-testid="input-swot-action-plan"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onClose(); resetForm(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!formData.analysisId || !formData.title.trim() || isSubmitting} data-testid="button-create-swot-item">
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Create ERP Requirement Dialog Component
function CreateErpRequirementDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { module: string; requirement: string; adherenceStatus: string; priority: number; recommendation: string; pdcaStatus: string }) => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    module: '',
    requirement: '',
    adherenceStatus: 'pending',
    priority: 3,
    recommendation: '',
    pdcaStatus: 'plan',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.module.trim() || !formData.requirement.trim()) return;
    onSubmit(formData);
  };

  const resetForm = () => {
    setFormData({ module: '', requirement: '', adherenceStatus: 'pending', priority: 3, recommendation: '', pdcaStatus: 'plan' });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Requisito ERP com PDCA</DialogTitle>
          <DialogDescription>
            Crie um requisito ERP com acompanhamento PDCA
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Modulo ERP *</label>
              <Input
                value={formData.module}
                onChange={(e) => setFormData({ ...formData, module: e.target.value })}
                placeholder="Ex: Financeiro, Vendas..."
                required
                data-testid="input-erp-module"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status Aderencia</label>
              <Select value={formData.adherenceStatus} onValueChange={(v) => setFormData({ ...formData, adherenceStatus: v })}>
                <SelectTrigger data-testid="select-erp-adherence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADHERENCE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Requisito *</label>
            <Textarea
              value={formData.requirement}
              onChange={(e) => setFormData({ ...formData, requirement: e.target.value })}
              placeholder="Descreva o requisito..."
              rows={2}
              className="resize-none"
              required
              data-testid="input-erp-requirement"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade (1-5)</label>
              <Select value={String(formData.priority)} onValueChange={(v) => setFormData({ ...formData, priority: parseInt(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status PDCA</label>
              <Select value={formData.pdcaStatus} onValueChange={(v) => setFormData({ ...formData, pdcaStatus: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PDCA_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Recomendacao / Plano de Acao</label>
            <Textarea
              value={formData.recommendation}
              onChange={(e) => setFormData({ ...formData, recommendation: e.target.value })}
              placeholder="Descreva a recomendacao ou plano de acao..."
              rows={2}
              className="resize-none"
              data-testid="input-erp-create-recommendation"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onClose(); resetForm(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!formData.module.trim() || !formData.requirement.trim() || isSubmitting} data-testid="button-create-erp-requirement">
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
