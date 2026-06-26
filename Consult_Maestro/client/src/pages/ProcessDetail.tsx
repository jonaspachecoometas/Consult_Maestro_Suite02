import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { 
  ArrowLeft, 
  Plus, 
  Edit,
  Trash2,
  ArrowDown,
  Circle,
  Square,
  Diamond,
  ChevronUp,
  ChevronDown,
  Cog,
  Clock,
  User,
  Wrench,
  GitBranch,
  List,
  Paperclip,
  FileText,
  Download,
  Upload,
  X,
  ExternalLink,
  ArrowRightLeft,
  AlertTriangle,
  Lightbulb,
  Target,
  ClipboardCheck,
  RefreshCcw,
  CheckSquare,
  Copy,
  Users
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PROCESS_CATEGORIES } from "@/lib/constants";
import ProcessDiagramEditor from "@/components/ProcessDiagramEditor";
import { AgentPanel } from "@/components/AgentPanel";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { Process, ProcessStep, ProcessDiagram, ProcessStepFile, Collaborator, Project, ProcessStepDiagnostic, ProcessRecommendation, ProcessKpi, ProcessStepPdca } from "@shared/schema";

const STEP_TYPES = [
  { value: 'start', label: 'Início', icon: Circle, color: 'bg-green-500' },
  { value: 'action', label: 'Ação', icon: Square, color: 'bg-blue-500' },
  { value: 'decision', label: 'Decisão', icon: Diamond, color: 'bg-yellow-500' },
  { value: 'end', label: 'Fim', icon: Circle, color: 'bg-red-500' },
];

function StepNode({ 
  step, 
  onEdit, 
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  files,
  onDeleteFile,
  onGetUploadParameters,
  onFileUploaded,
  isDeleting,
  linkedProcessName
}: { 
  step: ProcessStep;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  files: ProcessStepFile[];
  onDeleteFile: (fileId: string) => void;
  onGetUploadParameters: () => Promise<{ method: "PUT"; url: string; storageKey: string }>;
  onFileUploaded: (file: { fileName: string; fileType: string | null; fileSize: number; storageKey: string }) => Promise<void>;
  isDeleting: boolean;
  linkedProcessName?: string;
}) {
  const stepType = STEP_TYPES.find(t => t.value === step.stepType) || STEP_TYPES[1];
  const Icon = stepType.icon;

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col items-center">
      <Card className="border-card-border w-full max-w-md group">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-md ${stepType.color} text-white shrink-0`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{step.name}</h3>
                  <Badge variant="outline" size="sm" className="text-xs mt-1">
                    {stepType.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst} className="h-7 w-7" title="Mover para cima">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast} className="h-7 w-7" title="Mover para baixo">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onDuplicate} className="h-7 w-7" title="Duplicar etapa" data-testid={`button-duplicate-step-${step.id}`}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onEdit} className="h-7 w-7" title="Editar">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onDelete} className="h-7 w-7 text-destructive" title="Excluir">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {step.description && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {step.description}
                </p>
              )}
              <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
                {step.responsible && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {step.responsible}
                  </span>
                )}
                {step.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {step.duration}
                  </span>
                )}
                {step.tools && (
                  <span className="flex items-center gap-1">
                    <Wrench className="h-3 w-3" />
                    {step.tools}
                  </span>
                )}
                {linkedProcessName && (
                  <Link 
                    href={`/processos/${step.linkedProcessId}`}
                    className="flex items-center gap-1 text-primary hover:underline"
                    data-testid={`link-process-${step.linkedProcessId}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {linkedProcessName}
                  </Link>
                )}
              </div>
              {files.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                    <Paperclip className="h-3 w-3" />
                    <span>{files.length} anexo(s)</span>
                  </div>
                  <div className="space-y-1">
                    {files.map((file) => (
                      <div 
                        key={file.id} 
                        className="flex items-center justify-between gap-2 text-xs p-1.5 rounded bg-muted/50 group/file"
                        data-testid={`file-item-${file.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{file.fileName}</span>
                          <span className="text-muted-foreground shrink-0">
                            {formatFileSize(file.fileSize)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/file:opacity-100 transition-opacity">
                          <a 
                            href={`/objects/${file.storageKey}`}
                            download={file.fileName}
                            className="p-1 rounded hover:bg-muted"
                            data-testid={`button-download-file-${file.id}`}
                          >
                            <Download className="h-3 w-3" />
                          </a>
                          <button
                            onClick={() => onDeleteFile(file.id)}
                            disabled={isDeleting}
                            className="p-1 rounded hover:bg-destructive/10 text-destructive"
                            data-testid={`button-delete-file-${file.id}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3">
                <ObjectUploader
                  maxNumberOfFiles={5}
                  maxFileSize={52428800}
                  onGetUploadParameters={onGetUploadParameters}
                  onFileUploaded={onFileUploaded}
                  variant="ghost"
                  size="sm"
                >
                  <Upload className="h-3 w-3 mr-1" />
                  Anexar
                </ObjectUploader>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FlowConnector() {
  return (
    <div className="flex flex-col items-center py-2">
      <div className="w-0.5 h-6 bg-border" />
      <ArrowDown className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

const PDCA_STATUSES = ['plan', 'do', 'check', 'act', 'done'] as const;

function getPdcaStatusIcon(status: string) {
  switch (status) {
    case "plan": return <Target className="h-3.5 w-3.5 text-blue-500" />;
    case "do": return <Wrench className="h-3.5 w-3.5 text-yellow-500" />;
    case "check": return <ClipboardCheck className="h-3.5 w-3.5 text-purple-500" />;
    case "act": return <RefreshCcw className="h-3.5 w-3.5 text-orange-500" />;
    case "done": return <CheckSquare className="h-3.5 w-3.5 text-green-500" />;
    default: return <Circle className="h-3.5 w-3.5" />;
  }
}

function StepNodeWithFiles({ 
  step, 
  onEdit, 
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  availableProcesses,
  isToBeProcess,
}: { 
  step: ProcessStep;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  availableProcesses: Process[];
  isToBeProcess: boolean;
}) {
  const { toast } = useToast();
  const [showPdcaForm, setShowPdcaForm] = useState(false);
  const [newPdcaTitle, setNewPdcaTitle] = useState("");
  
  const { data: files = [] } = useQuery<ProcessStepFile[]>({
    queryKey: ['/api/process-steps', step.id, 'files'],
  });

  // Fetch PDCA items for this step (only for TO-BE processes)
  const { data: pdcaItems = [] } = useQuery<ProcessStepPdca[]>({
    queryKey: ['/api/process-steps', step.id, 'pdca'],
    enabled: isToBeProcess,
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest("DELETE", `/api/process-step-files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/process-steps', step.id, 'files'] });
      toast({ title: "Arquivo excluído" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir arquivo", variant: "destructive" });
    },
  });

  // PDCA mutations
  const createPdcaMutation = useMutation({
    mutationFn: async () => {
      if (!newPdcaTitle.trim()) return;
      await apiRequest("POST", `/api/process-steps/${step.id}/pdca`, {
        title: newPdcaTitle.trim(),
        status: "plan"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/process-steps', step.id, 'pdca'] });
      setNewPdcaTitle("");
      setShowPdcaForm(false);
      toast({ title: "Item PDCA criado" });
    },
    onError: () => {
      toast({ title: "Erro ao criar item PDCA", variant: "destructive" });
    },
  });

  const updatePdcaStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/process-step-pdca/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/process-steps', step.id, 'pdca'] });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar status PDCA", variant: "destructive" });
    },
  });

  const deletePdcaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/process-step-pdca/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/process-steps', step.id, 'pdca'] });
      toast({ title: "Item PDCA removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover item PDCA", variant: "destructive" });
    },
  });

  const handleGetUploadParameters = async () => {
    const response = await fetch('/api/objects/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    
    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }
    
    const data = await response.json();
    
    return {
      method: "PUT" as const,
      url: data.url,
      storageKey: data.storageKey,
    };
  };

  const handleFileUploaded = async (file: { fileName: string; fileType: string | null; fileSize: number; storageKey: string }) => {
    await apiRequest("POST", `/api/process-steps/${step.id}/files`, {
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      storageKey: file.storageKey,
    });
    queryClient.invalidateQueries({ queryKey: ['/api/process-steps', step.id, 'files'] });
    toast({ title: "Arquivo enviado" });
  };

  const linkedProcess = step.linkedProcessId 
    ? availableProcesses.find(p => p.id === step.linkedProcessId) 
    : null;

  return (
    <div className="w-full flex flex-col items-center">
      <StepNode
        step={step}
        onEdit={onEdit}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        isFirst={isFirst}
        isLast={isLast}
        files={files}
        onDeleteFile={(fileId) => deleteFileMutation.mutate(fileId)}
        onGetUploadParameters={handleGetUploadParameters}
        onFileUploaded={handleFileUploaded}
        isDeleting={deleteFileMutation.isPending}
        linkedProcessName={linkedProcess?.name}
      />
      
      {/* PDCA Section - Only for TO-BE processes */}
      {isToBeProcess && (
        <Card className="border-primary/30 w-full max-w-md mt-3 bg-primary/5">
          <CardContent className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary">
                    <RefreshCcw className="h-3.5 w-3.5" />
                    <span className="text-xs font-semibold">PDCA</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {pdcaItems.length} {pdcaItems.length === 1 ? 'item' : 'itens'}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPdcaForm(!showPdcaForm)}
                  className="text-xs h-7"
                  data-testid={`button-add-pdca-step-${step.id}`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Novo
                </Button>
              </div>

              {showPdcaForm && (
                <div className="flex gap-2 p-2 bg-background rounded border border-border">
                  <Input
                    placeholder="Título do item PDCA..."
                    value={newPdcaTitle}
                    onChange={(e) => setNewPdcaTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createPdcaMutation.mutate()}
                    className="flex-1 text-sm"
                    data-testid={`input-pdca-title-step-${step.id}`}
                  />
                  <Button
                    size="sm"
                    onClick={() => createPdcaMutation.mutate()}
                    disabled={!newPdcaTitle.trim() || createPdcaMutation.isPending}
                    data-testid={`button-create-pdca-step-${step.id}`}
                  >
                    Criar
                  </Button>
                </div>
              )}

              {pdcaItems.length > 0 && (
                <div className="space-y-2">
                  {pdcaItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 p-2 bg-background rounded border border-border" data-testid={`pdca-item-${item.id}`}>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {getPdcaStatusIcon(item.status || "plan")}
                        <span className="text-sm truncate">{item.title}</span>
                      </div>
                      <Select
                        value={item.status || "plan"}
                        onValueChange={(value) => updatePdcaStatusMutation.mutate({ id: item.id, status: value })}
                      >
                        <SelectTrigger className="w-24 h-7 text-xs" data-testid={`select-pdca-status-${item.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PDCA_STATUSES.map((status) => (
                            <SelectItem key={status} value={status} className="text-xs">
                              {status.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deletePdcaMutation.mutate(item.id)}
                        className="h-7 w-7"
                        data-testid={`button-delete-pdca-${item.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {pdcaItems.length === 0 && !showPdcaForm && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Adicione itens PDCA para acompanhar melhorias nesta etapa.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ProcessDetail() {
  const params = useParams<{ id: string }>();
  const processId = params.id;
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<ProcessStep | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    stepType: "action",
    responsible: "",
    responsibleCollaboratorId: "",
    duration: "",
    tools: "",
    notes: "",
    linkedProcessId: "",
  });

  const { data: process, isLoading: processLoading } = useQuery<Process>({
    queryKey: [`/api/processes/${processId}`],
    enabled: !!processId,
  });

  const { data: steps = [], isLoading: stepsLoading } = useQuery<ProcessStep[]>({
    queryKey: [`/api/processes/${processId}/steps`],
    enabled: !!processId,
  });

  const { data: diagram, isLoading: diagramLoading } = useQuery<ProcessDiagram>({
    queryKey: ['/api/processes', processId, 'diagram'],
    enabled: !!processId,
  });

  // Fetch all processes from the same project for linking
  const { data: availableProcesses = [] } = useQuery<Process[]>({
    queryKey: ['/api/projects', process?.projectId, 'processes'],
    enabled: !!process?.projectId,
  });

  // Fetch project to get clientId for collaborators
  const { data: project } = useQuery<Project>({
    queryKey: ['/api/projects', process?.projectId],
    enabled: !!process?.projectId,
  });

  // Fetch collaborators for the project's client (for step assignment)
  const { data: collaborators = [] } = useQuery<Collaborator[]>({
    queryKey: ['/api/clients', project?.clientId, 'collaborators'],
    enabled: !!project?.clientId,
  });

  // Fetch project collaborators with process participation flags
  const { data: processCollaborators = [], isLoading: processCollabsLoading } = useQuery<(Collaborator & { participates: boolean; processCollaboratorId?: string })[]>({
    queryKey: ['/api/processes', processId, 'collaborators'],
    enabled: !!processId,
  });

  // Fetch linked variant (AS-IS <-> TO-BE)
  const { data: linkedVariant } = useQuery<Process | null>({
    queryKey: ['/api/processes', processId, 'linked-variant'],
    enabled: !!processId && !!process?.linkedVariantId,
  });

  // Fetch diagnostics (pain points & opportunities)
  const { data: diagnostics = [], isLoading: diagnosticsLoading } = useQuery<ProcessStepDiagnostic[]>({
    queryKey: ['/api/processes', processId, 'diagnostics'],
    enabled: !!processId,
  });

  // Fetch recommendations
  const { data: recommendations = [], isLoading: recommendationsLoading } = useQuery<ProcessRecommendation[]>({
    queryKey: ['/api/processes', processId, 'recommendations'],
    enabled: !!processId,
  });

  // Fetch KPIs
  const { data: kpis = [], isLoading: kpisLoading } = useQuery<ProcessKpi[]>({
    queryKey: ['/api/processes', processId, 'kpis'],
    enabled: !!processId,
  });

  // Mutation to create TO-BE variant from AS-IS
  const createToBeVariantMutation = useMutation({
    mutationFn: async (): Promise<Process> => {
      const response = await apiRequest("POST", `/api/processes/${processId}/create-to-be`);
      return await response.json();
    },
    onSuccess: (newProcess: Process) => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', process?.projectId, 'processes'] });
      toast({ title: "Variante TO-BE criada", description: "Agora você pode modelar o estado futuro do processo." });
      // Navigate to the new TO-BE process
      window.location.href = `/processos/${newProcess.id}`;
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível criar a variante TO-BE.", variant: "destructive" });
    },
  });

  const toggleProcessCollaboratorMutation = useMutation({
    mutationFn: async ({ collaboratorId, participates }: { collaboratorId: string; participates: boolean }) => {
      await apiRequest("POST", `/api/processes/${processId}/collaborators`, { collaboratorId, participates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/processes', processId, 'collaborators'] });
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível atualizar a participação.", variant: "destructive" });
    },
  });

  const saveDiagramMutation = useMutation({
    mutationFn: async (data: { nodes: any[]; edges: any[] }) => {
      await apiRequest("PUT", `/api/processes/${processId}/diagram`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/processes', processId, 'diagram'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.order || 0)) : -1;
      const { linkedProcessId, responsibleCollaboratorId, ...restFormData } = formData;
      await apiRequest("POST", `/api/processes/${processId}/steps`, {
        ...restFormData,
        linkedProcessId: linkedProcessId || null,
        responsibleCollaboratorId: responsibleCollaboratorId || null,
        order: maxOrder + 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}/steps`] });
      toast({ title: "Etapa criada" });
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { linkedProcessId, responsibleCollaboratorId, ...restFormData } = formData;
      await apiRequest("PATCH", `/api/process-steps/${editingStep?.id}`, {
        ...restFormData,
        linkedProcessId: linkedProcessId || null,
        responsibleCollaboratorId: responsibleCollaboratorId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}/steps`] });
      toast({ title: "Etapa atualizada" });
      setIsDialogOpen(false);
      setEditingStep(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (stepId: string) => {
      await apiRequest("DELETE", `/api/process-steps/${stepId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}/steps`] });
      toast({ title: "Etapa excluída" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ stepId, newOrder }: { stepId: string; newOrder: number }) => {
      await apiRequest("PATCH", `/api/process-steps/${stepId}`, { order: newOrder });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}/steps`] });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (step: ProcessStep) => {
      const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.order || 0)) : -1;
      await apiRequest("POST", `/api/processes/${processId}/steps`, {
        name: `${step.name} (copia)`,
        description: step.description || "",
        stepType: step.stepType || "action",
        responsible: step.responsible || "",
        responsibleCollaboratorId: step.responsibleCollaboratorId || null,
        duration: step.duration || "",
        tools: step.tools || "",
        notes: step.notes || "",
        linkedProcessId: step.linkedProcessId || null,
        order: maxOrder + 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/processes/${processId}/steps`] });
      toast({ title: "Etapa duplicada" });
    },
    onError: () => {
      toast({ title: "Erro ao duplicar etapa", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      stepType: "action",
      responsible: "",
      responsibleCollaboratorId: "",
      duration: "",
      tools: "",
      notes: "",
      linkedProcessId: "",
    });
  };

  const openEditDialog = (step: ProcessStep) => {
    setEditingStep(step);
    setFormData({
      name: step.name,
      description: step.description || "",
      stepType: step.stepType || "action",
      responsible: step.responsible || "",
      responsibleCollaboratorId: step.responsibleCollaboratorId || "",
      duration: step.duration || "",
      tools: step.tools || "",
      notes: step.notes || "",
      linkedProcessId: step.linkedProcessId || "",
    });
    setIsDialogOpen(true);
  };

  const handleMoveStep = (step: ProcessStep, direction: 'up' | 'down') => {
    const sortedSteps = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
    const currentIndex = sortedSteps.findIndex(s => s.id === step.id);
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (swapIndex < 0 || swapIndex >= sortedSteps.length) return;
    
    const otherStep = sortedSteps[swapIndex];
    const currentOrder = step.order || 0;
    const otherOrder = otherStep.order || 0;

    reorderMutation.mutate({ stepId: step.id, newOrder: otherOrder });
    reorderMutation.mutate({ stepId: otherStep.id, newOrder: currentOrder });
  };

  const category = process ? PROCESS_CATEGORIES.find(c => c.value === process.category) : null;
  const sortedSteps = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (processLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="p-6">
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="font-semibold text-lg mb-2">Processo não encontrado</h3>
            <p className="text-muted-foreground mb-4">O processo solicitado não existe.</p>
            <Button asChild>
              <Link href="/processos">Voltar aos Processos</Link>
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
            <Link href="/processos" data-testid="button-back-processes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-heading text-2xl font-bold flex items-center gap-3" data-testid="text-process-name">
              <Cog className="h-6 w-6 text-primary" />
              {process.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {/* Variant Type Badge */}
              {process.variantType === 'as_is' && (
                <Badge variant="secondary" size="sm" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" data-testid="badge-variant-as-is">
                  AS-IS (Atual)
                </Badge>
              )}
              {process.variantType === 'to_be' && (
                <Badge variant="secondary" size="sm" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-variant-to-be">
                  TO-BE (Futuro)
                </Badge>
              )}
              {category && (
                <Badge variant="outline" size="sm">
                  {category.label}
                </Badge>
              )}
              {process.description && (
                <span className="text-sm text-muted-foreground">{process.description}</span>
              )}
            </div>
            {/* Linked Variant Navigation */}
            {linkedVariant && (
              <div className="flex items-center gap-2 mt-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Variante vinculada:</span>
                <Button variant="ghost" size="sm" className="text-primary underline-offset-4 hover:underline" asChild>
                  <Link href={`/processos/${linkedVariant.id}`} data-testid="link-linked-variant">
                    {linkedVariant.name}
                    {linkedVariant.variantType === 'as_is' && (
                      <Badge variant="outline" size="sm" className="ml-2">AS-IS</Badge>
                    )}
                    {linkedVariant.variantType === 'to_be' && (
                      <Badge variant="outline" size="sm" className="ml-2">TO-BE</Badge>
                    )}
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
        {/* Create TO-BE variant button */}
        {process.variantType === 'as_is' && !process.linkedVariantId && (
          <Button 
            onClick={() => createToBeVariantMutation.mutate()}
            disabled={createToBeVariantMutation.isPending}
            data-testid="button-create-tobe"
          >
            <Plus className="h-4 w-4 mr-2" />
            {createToBeVariantMutation.isPending ? "Criando..." : "Criar Variante TO-BE"}
          </Button>
        )}
      </div>

      {process.projectId && (
        <AgentPanel
          projectId={process.projectId}
          agentType="process_recommendation"
          label="Sugestões de melhoria com IA"
          description="Analisa este processo e sugere otimizações, automações e indicadores"
          visibleIn="processes"
        />
      )}

      <Tabs defaultValue="steps" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="steps" data-testid="tab-steps">
            <List className="h-4 w-4 mr-2" />
            Etapas
          </TabsTrigger>
          <TabsTrigger value="diagram" data-testid="tab-diagram">
            <GitBranch className="h-4 w-4 mr-2" />
            Diagrama
          </TabsTrigger>
          <TabsTrigger value="diagnostics" data-testid="tab-diagnostics">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="collaborators" data-testid="tab-collaborators">
            <Users className="h-4 w-4 mr-2" />
            Colaboradores
            {processCollaborators.filter(c => c.participates).length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium">
                {processCollaborators.filter(c => c.participates).length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="steps">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-step">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Etapa
            </Button>
          </div>
          <Card className="border-card-border">
            <CardHeader>
              <CardTitle className="text-base">Fluxo do Processo</CardTitle>
            </CardHeader>
            <CardContent>
              {stepsLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full max-w-md mx-auto" />
                  ))}
                </div>
              ) : sortedSteps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Cog className="h-16 w-16 text-muted-foreground/50 mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Nenhuma etapa definida</h3>
                  <p className="text-muted-foreground text-center max-w-sm mb-6">
                    Comece adicionando as etapas do processo para desenhar o fluxo.
                  </p>
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Primeira Etapa
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  {sortedSteps.map((step, index) => (
                    <div key={step.id} className="w-full flex flex-col items-center">
                      {index > 0 && <FlowConnector />}
                      <StepNodeWithFiles
                        step={step}
                        onEdit={() => openEditDialog(step)}
                        onDelete={() => deleteMutation.mutate(step.id)}
                        onDuplicate={() => duplicateMutation.mutate(step)}
                        onMoveUp={() => handleMoveStep(step, 'up')}
                        onMoveDown={() => handleMoveStep(step, 'down')}
                        isFirst={index === 0}
                        isLast={index === sortedSteps.length - 1}
                        availableProcesses={availableProcesses}
                        isToBeProcess={process?.variantType === 'to_be'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagram">
          <Card className="border-card-border">
            <CardContent className="p-0">
              {diagramLoading ? (
                <div className="flex items-center justify-center h-[600px]">
                  <Skeleton className="h-full w-full" />
                </div>
              ) : (
                <ProcessDiagramEditor
                  initialNodes={(diagram?.nodes as any[]) || []}
                  initialEdges={(diagram?.edges as any[]) || []}
                  onSave={(data) => saveDiagramMutation.mutate(data)}
                  isSaving={saveDiagramMutation.isPending}
                  processDescription={process?.description}
                  processSteps={steps}
                  onNodeDoubleClick={(stepId, nodeType) => {
                    if (stepId) {
                      const step = steps.find(s => s.id === stepId);
                      if (step) {
                        openEditDialog(step);
                      }
                    } else {
                      const stepTypeMap: Record<string, string> = {
                        'start': 'start',
                        'task': 'action',
                        'decision': 'decision',
                        'end': 'end',
                      };
                      setFormData(prev => ({ 
                        ...prev, 
                        name: "",
                        stepType: stepTypeMap[nodeType] || 'action' 
                      }));
                      setIsDialogOpen(true);
                    }
                  }}
                  onAddStepFromDiagram={(stepType) => {
                    const stepTypeMap: Record<string, string> = {
                      'start': 'start',
                      'task': 'action',
                      'decision': 'decision',
                      'end': 'end',
                    };
                    setFormData(prev => ({ 
                      ...prev, 
                      name: "",
                      stepType: stepTypeMap[stepType] || 'action' 
                    }));
                    setIsDialogOpen(true);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostics">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Pain Points & Opportunities */}
            <Card className="border-card-border">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Pontos de Dor
                </CardTitle>
                <Badge variant="secondary" size="sm">{diagnostics.filter(d => d.type === 'pain_point').length}</Badge>
              </CardHeader>
              <CardContent>
                {diagnosticsLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : diagnostics.filter(d => d.type === 'pain_point').length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum ponto de dor identificado ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {diagnostics.filter(d => d.type === 'pain_point').slice(0, 5).map((diag) => (
                      <div key={diag.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                        <Badge variant="outline" size="sm" className="shrink-0">
                          {diag.severity === 'high' ? 'Alto' : diag.severity === 'medium' ? 'Médio' : 'Baixo'}
                        </Badge>
                        <span className="text-sm">{diag.title}</span>
                      </div>
                    ))}
                    {diagnostics.filter(d => d.type === 'pain_point').length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        +{diagnostics.filter(d => d.type === 'pain_point').length - 5} mais
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card className="border-card-border">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Recomendações
                </CardTitle>
                <Badge variant="secondary" size="sm">{recommendations.length}</Badge>
              </CardHeader>
              <CardContent>
                {recommendationsLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma recomendação cadastrada ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recommendations.slice(0, 5).map((rec) => (
                      <div key={rec.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                        <Badge variant="outline" size="sm" className="shrink-0">
                          P{rec.priority}
                        </Badge>
                        <span className="text-sm">{rec.title}</span>
                      </div>
                    ))}
                    {recommendations.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        +{recommendations.length - 5} mais
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* KPIs */}
            <Card className="border-card-border">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-green-500" />
                  KPIs
                </CardTitle>
                <Badge variant="secondary" size="sm">{kpis.length}</Badge>
              </CardHeader>
              <CardContent>
                {kpisLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : kpis.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum KPI definido ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {kpis.slice(0, 5).map((kpi) => (
                      <div key={kpi.id} className="p-2 rounded-md bg-muted/50">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{kpi.name}</span>
                          {kpi.currentValue && (
                            <Badge variant="outline" size="sm">{kpi.currentValue} {kpi.unit}</Badge>
                          )}
                        </div>
                        {kpi.targetValue && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Meta: {kpi.targetValue} {kpi.unit}
                          </p>
                        )}
                      </div>
                    ))}
                    {kpis.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center">
                        +{kpis.length - 5} mais
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Diagnostic Score Card */}
          <Card className="border-card-border mt-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Score do Diagnostico
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const painPoints = diagnostics.filter(d => d.type === 'pain_point');
                const opportunities = diagnostics.filter(d => d.type === 'opportunity');
                
                // Calculate severity-weighted pain point score (max 30 points penalty)
                // Each pain point: high=5, medium=3, low=1
                const painPointScore = painPoints.reduce((acc, p) => {
                  const weight = p.severity === 'high' ? 5 : p.severity === 'medium' ? 3 : 1;
                  return acc + weight;
                }, 0);
                const maxPainPenalty = Math.min(painPointScore, 30);
                
                // Opportunity score (max 20 points bonus)
                const opportunityScore = Math.min(opportunities.length * 4, 20);
                
                // Recommendation score based on status (max 25 points)
                const recommendationScore = recommendations.reduce((acc, r) => {
                  if (r.status === 'implemented') return acc + 5;
                  if (r.status === 'approved') return acc + 3;
                  return acc + 1; // proposed
                }, 0);
                const maxRecScore = Math.min(recommendationScore, 25);
                
                // KPI score (max 25 points)
                const kpiScore = kpis.reduce((acc, k) => {
                  let points = 2; // Base for having a KPI
                  if (k.currentValue) points += 1;
                  if (k.targetValue) points += 2;
                  return acc + points;
                }, 0);
                const maxKpiScore = Math.min(kpiScore, 25);
                
                // Total score calculation (0-100 scale)
                const baseScore = 50; // Start at 50
                const totalScore = Math.max(0, Math.min(100,
                  baseScore - maxPainPenalty + opportunityScore + maxRecScore + maxKpiScore
                ));
                
                // Calculate maturity level
                const maturityLevel = totalScore >= 80 ? 'Excelente' :
                  totalScore >= 60 ? 'Bom' :
                  totalScore >= 40 ? 'Em Desenvolvimento' :
                  totalScore >= 20 ? 'Inicial' : 'Critico';
                
                const maturityColor = totalScore >= 80 ? 'text-green-500' :
                  totalScore >= 60 ? 'text-blue-500' :
                  totalScore >= 40 ? 'text-yellow-500' :
                  totalScore >= 20 ? 'text-orange-500' : 'text-red-500';

                const progressColor = totalScore >= 80 ? 'bg-green-500' :
                  totalScore >= 60 ? 'bg-blue-500' :
                  totalScore >= 40 ? 'bg-yellow-500' :
                  totalScore >= 20 ? 'bg-orange-500' : 'bg-red-500';
                
                return (
                  <div className="space-y-6">
                    {/* Main Score Display */}
                    <div className="flex flex-col items-center justify-center py-4">
                      <div className="relative w-32 h-32">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            className="text-muted/30"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            strokeDasharray={`${totalScore * 2.83} 283`}
                            strokeLinecap="round"
                            className={progressColor.replace('bg-', 'text-')}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className={`text-3xl font-bold ${maturityColor}`}>{totalScore}</span>
                          <span className="text-xs text-muted-foreground">pontos</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={`mt-3 ${maturityColor}`}>
                        {maturityLevel}
                      </Badge>
                    </div>

                    {/* Score Breakdown */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="p-3 rounded-md border border-border bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">Pontos de Dor</span>
                          <span className="text-sm font-medium text-orange-500">-{maxPainPenalty}</span>
                        </div>
                        <div className="text-lg font-semibold">{painPoints.length}</div>
                        <div className="mt-1 h-1 rounded-full bg-muted">
                          <div 
                            className="h-full rounded-full bg-orange-500" 
                            style={{ width: `${Math.min((maxPainPenalty / 30) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {painPoints.filter(p => p.severity === 'high').length} alto, {' '}
                          {painPoints.filter(p => p.severity === 'medium').length} medio, {' '}
                          {painPoints.filter(p => p.severity === 'low').length} baixo
                        </p>
                      </div>

                      <div className="p-3 rounded-md border border-border bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">Oportunidades</span>
                          <span className="text-sm font-medium text-blue-500">+{opportunityScore}</span>
                        </div>
                        <div className="text-lg font-semibold">{opportunities.length}</div>
                        <div className="mt-1 h-1 rounded-full bg-muted">
                          <div 
                            className="h-full rounded-full bg-blue-500" 
                            style={{ width: `${Math.min((opportunityScore / 20) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Maximo 20 pts (4 pts cada)
                        </p>
                      </div>

                      <div className="p-3 rounded-md border border-border bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">Recomendacoes</span>
                          <span className="text-sm font-medium text-yellow-500">+{maxRecScore}</span>
                        </div>
                        <div className="text-lg font-semibold">{recommendations.length}</div>
                        <div className="mt-1 h-1 rounded-full bg-muted">
                          <div 
                            className="h-full rounded-full bg-yellow-500" 
                            style={{ width: `${Math.min((maxRecScore / 25) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {recommendations.filter(r => r.status === 'implemented').length} impl, {' '}
                          {recommendations.filter(r => r.status === 'approved').length} aprov, {' '}
                          {recommendations.filter(r => r.status === 'proposed').length} prop
                        </p>
                      </div>

                      <div className="p-3 rounded-md border border-border bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">KPIs</span>
                          <span className="text-sm font-medium text-green-500">+{maxKpiScore}</span>
                        </div>
                        <div className="text-lg font-semibold">{kpis.length}</div>
                        <div className="mt-1 h-1 rounded-full bg-muted">
                          <div 
                            className="h-full rounded-full bg-green-500" 
                            style={{ width: `${Math.min((maxKpiScore / 25) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {kpis.filter(k => k.targetValue).length} com meta definida
                        </p>
                      </div>
                    </div>

                    {/* Score Legend */}
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs text-muted-foreground mb-2">Escala de Maturidade:</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" size="sm" className="text-red-500">0-19: Critico</Badge>
                        <Badge variant="outline" size="sm" className="text-orange-500">20-39: Inicial</Badge>
                        <Badge variant="outline" size="sm" className="text-yellow-500">40-59: Em Desenvolvimento</Badge>
                        <Badge variant="outline" size="sm" className="text-blue-500">60-79: Bom</Badge>
                        <Badge variant="outline" size="sm" className="text-green-500">80-100: Excelente</Badge>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collaborators">
          <Card className="border-card-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                Colaboradores neste Processo
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Marque os colaboradores que participam ou têm responsabilidade neste processo. Somente colaboradores vinculados ao projeto aparecem aqui.
              </p>
            </CardHeader>
            <CardContent>
              {processCollabsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-10 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : processCollaborators.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <h3 className="font-semibold mb-1">Nenhum colaborador no projeto</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Adicione colaboradores do cliente na aba <strong>Equipe</strong> do projeto para associá-los aos processos.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {processCollaborators.map((collab) => (
                    <div
                      key={collab.id}
                      className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${collab.participates ? "border-primary/30 bg-primary/5" : "border-border"}`}
                      data-testid={`collab-row-${collab.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium ${collab.participates ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {collab.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-collab-name-${collab.id}`}>{collab.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {collab.position && <span>{collab.position}</span>}
                            {collab.department && <><span>·</span><span>{collab.department}</span></>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{collab.participates ? "Participa" : "Não participa"}</span>
                        <Switch
                          checked={collab.participates}
                          onCheckedChange={(checked) => toggleProcessCollaboratorMutation.mutate({ collaboratorId: collab.id, participates: checked })}
                          data-testid={`switch-collab-${collab.id}`}
                          disabled={toggleProcessCollaboratorMutation.isPending}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-2">
                    {processCollaborators.filter(c => c.participates).length} de {processCollaborators.length} colaboradores participam deste processo.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) {
          setEditingStep(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingStep ? "Editar Etapa" : "Nova Etapa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto flex-1">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nome da etapa"
                data-testid="input-step-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select 
                value={formData.stepType} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, stepType: value }))}
              >
                <SelectTrigger data-testid="select-step-type">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {STEP_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
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
                placeholder="Descreva a etapa..."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Colaborador Responsável</Label>
              <Select 
                value={formData.responsibleCollaboratorId || "none"} 
                onValueChange={(value) => {
                  const selectedCollab = collaborators.find(c => c.id === value);
                  setFormData(prev => ({ 
                    ...prev, 
                    responsibleCollaboratorId: value === "none" ? "" : value,
                    responsible: selectedCollab?.name || prev.responsible
                  }));
                }}
              >
                <SelectTrigger data-testid="select-responsible-collaborator">
                  <SelectValue placeholder="Selecione o responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (informar manualmente)</SelectItem>
                  {collaborators.filter(c => c.isActive === 1).map((collab) => (
                    <SelectItem key={collab.id} value={collab.id}>
                      {collab.name} {collab.position ? `- ${collab.position}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selecione um colaborador do cliente ou informe manualmente abaixo
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Responsável (texto)</Label>
                <Input
                  value={formData.responsible}
                  onChange={(e) => setFormData(prev => ({ ...prev, responsible: e.target.value }))}
                  placeholder="Quem executa"
                  data-testid="input-step-responsible"
                />
              </div>
              <div className="space-y-2">
                <Label>Duração</Label>
                <Input
                  value={formData.duration}
                  onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                  placeholder="Ex: 2 horas"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ferramentas/Sistemas</Label>
              <Input
                value={formData.tools}
                onChange={(e) => setFormData(prev => ({ ...prev, tools: e.target.value }))}
                placeholder="Ferramentas utilizadas"
              />
            </div>
            <div className="space-y-2">
              <Label>Processo Vinculado</Label>
              <Select 
                value={formData.linkedProcessId || "none"} 
                onValueChange={(value) => setFormData(prev => ({ 
                  ...prev, 
                  linkedProcessId: value === "none" ? "" : value 
                }))}
              >
                <SelectTrigger data-testid="select-linked-process">
                  <SelectValue placeholder="Selecione um processo (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {availableProcesses
                    .filter(p => p.id !== processId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vincule esta etapa a outro processo do projeto
              </p>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Observações adicionais..."
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => editingStep ? updateMutation.mutate() : createMutation.mutate()}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-step"
            >
              {editingStep ? "Salvar" : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
