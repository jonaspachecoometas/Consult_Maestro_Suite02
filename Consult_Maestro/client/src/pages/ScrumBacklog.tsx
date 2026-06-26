import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ListTodo,
  Plus,
  Search,
  Filter,
  Bug,
  Wrench,
  FileText,
  Lightbulb,
  HelpCircle,
  BookOpen,
  CheckSquare,
  Zap,
  ChevronDown,
  Clock,
  User,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  MoreHorizontal,
  Edit2,
  Trash2,
  Eye,
  AlertTriangle,
  X,
  Paperclip,
  Upload,
  Download,
  File,
  Image,
  FileVideo,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import type {
  ScrumBacklogItem,
  ScrumBacklogAttachment,
  ScrumInternalProject,
  ScrumSprint,
  User as UserType,
} from "@shared/schema";

const pbiFormSchema = z.object({
  title: z.string().min(1, "Titulo e obrigatorio"),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  type: z.enum(["feature", "bug", "technical_debt", "improvement", "documentation", "support", "requirement", "task"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  storyPoints: z.string().optional(),
  estimatedHours: z.string().optional(),
  internalProjectId: z.string().optional(),
  sprintId: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
});

type PbiFormValues = z.infer<typeof pbiFormSchema>;

function PbiTypeIcon({ type }: { type: string }) {
  const iconMap: Record<string, { icon: React.ElementType; color: string }> = {
    feature: { icon: Zap, color: "text-blue-500" },
    bug: { icon: Bug, color: "text-red-500" },
    technical_debt: { icon: Wrench, color: "text-orange-500" },
    improvement: { icon: Lightbulb, color: "text-yellow-500" },
    documentation: { icon: FileText, color: "text-gray-500" },
    support: { icon: HelpCircle, color: "text-purple-500" },
    requirement: { icon: BookOpen, color: "text-green-500" },
    task: { icon: CheckSquare, color: "text-teal-500" },
  };

  const { icon: Icon, color } = iconMap[type] || { icon: ListTodo, color: "text-muted-foreground" };
  return <Icon className={`h-4 w-4 ${color}`} />;
}

function PbiTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    feature: { label: "Feature", variant: "default" },
    bug: { label: "Bug", variant: "destructive" },
    technical_debt: { label: "Debito Tecnico", variant: "secondary" },
    improvement: { label: "Melhoria", variant: "outline" },
    documentation: { label: "Documentacao", variant: "outline" },
    support: { label: "Suporte", variant: "outline" },
    requirement: { label: "Requisito", variant: "secondary" },
    task: { label: "Tarefa", variant: "outline" },
  };

  const { label, variant } = config[type] || { label: type, variant: "outline" };
  return <Badge variant={variant} size="sm">{label}</Badge>;
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

function PbiPriorityBadge({ priority }: { priority: string }) {
  const config: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    critical: { label: "Critico", icon: ArrowUp, color: "text-red-500" },
    high: { label: "Alta", icon: ArrowUp, color: "text-orange-500" },
    medium: { label: "Media", icon: ArrowRight, color: "text-yellow-500" },
    low: { label: "Baixa", icon: ArrowDown, color: "text-green-500" },
  };

  const { label, icon: Icon, color } = config[priority] || { label: priority, icon: ArrowRight, color: "text-muted-foreground" };
  return (
    <div className={`flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {label}
    </div>
  );
}

function PbiCard({
  item,
  onEdit,
  onDelete,
  onView,
}: {
  item: ScrumBacklogItem;
  onEdit: (item: ScrumBacklogItem) => void;
  onDelete: (item: ScrumBacklogItem) => void;
  onView: (item: ScrumBacklogItem) => void;
}) {
  return (
    <Card
      className="border-card-border hover-elevate cursor-pointer"
      data-testid={`card-pbi-${item.id}`}
      onClick={() => onView(item)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted shrink-0">
            <PbiTypeIcon type={item.type} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium line-clamp-2">{item.title}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-pbi-menu-${item.id}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(item); }} data-testid={`button-view-pbi-${item.id}`}>
                    <Eye className="h-4 w-4 mr-2" />
                    Ver Detalhes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(item); }} data-testid={`button-edit-pbi-${item.id}`}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                    className="text-destructive"
                    data-testid={`button-delete-pbi-${item.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PbiTypeBadge type={item.type} />
              <PbiStatusBadge status={item.status} />
              <PbiPriorityBadge priority={item.priority} />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {item.storyPoints && (
                <div className="flex items-center gap-1">
                  <span className="font-medium">{item.storyPoints}</span> pts
                </div>
              )}
              {item.estimatedHours && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {item.estimatedHours}h
                </div>
              )}
              {item.dueDate && (
                <div className="flex items-center gap-1">
                  <span>{new Date(item.dueDate).toLocaleDateString('pt-BR')}</span>
                </div>
              )}
            </div>

            {item.isBlocked === 1 && (
              <div className="flex items-center gap-1 text-xs text-red-500">
                <AlertTriangle className="h-3 w-3" />
                Bloqueado
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PbiFormDialog({
  open,
  onOpenChange,
  editItem,
  projects,
  sprints,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editItem?: ScrumBacklogItem | null;
  projects: ScrumInternalProject[];
  sprints: ScrumSprint[];
  users: UserType[];
}) {
  const { toast } = useToast();
  const isEdit = !!editItem;

  const form = useForm<PbiFormValues>({
    resolver: zodResolver(pbiFormSchema),
    defaultValues: {
      title: "",
      description: "",
      acceptanceCriteria: "",
      type: "feature",
      priority: "medium",
      storyPoints: "",
      estimatedHours: "",
      internalProjectId: "",
      sprintId: "",
      assigneeId: "",
      dueDate: "",
    },
  });

  useEffect(() => {
    if (editItem) {
      form.reset({
        title: editItem.title,
        description: editItem.description || "",
        acceptanceCriteria: editItem.acceptanceCriteria || "",
        type: editItem.type as PbiFormValues["type"],
        priority: editItem.priority as PbiFormValues["priority"],
        storyPoints: editItem.storyPoints?.toString() || "",
        estimatedHours: editItem.estimatedHours?.toString() || "",
        internalProjectId: editItem.internalProjectId || "",
        sprintId: editItem.sprintId || "",
        assigneeId: editItem.assigneeId || "",
        dueDate: editItem.dueDate ? new Date(editItem.dueDate).toISOString().split('T')[0] : "",
      });
    } else {
      form.reset({
        title: "",
        description: "",
        acceptanceCriteria: "",
        type: "feature",
        priority: "medium",
        storyPoints: "",
        estimatedHours: "",
        internalProjectId: "",
        sprintId: "",
        assigneeId: "",
        dueDate: "",
      });
    }
  }, [editItem, form]);

  const createMutation = useMutation({
    mutationFn: async (data: PbiFormValues) => {
      const payload = {
        title: data.title,
        description: data.description || null,
        acceptanceCriteria: data.acceptanceCriteria || null,
        type: data.type,
        priority: data.priority,
        storyPoints: data.storyPoints ? parseInt(data.storyPoints) : null,
        estimatedHours: data.estimatedHours ? parseInt(data.estimatedHours) : null,
        internalProjectId: data.internalProjectId && data.internalProjectId !== "none" ? data.internalProjectId : null,
        sprintId: data.sprintId && data.sprintId !== "none" ? data.sprintId : null,
        assigneeId: data.assigneeId && data.assigneeId !== "none" ? data.assigneeId : null,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
        status: "backlog",
      };
      return apiRequest("POST", "/api/scrum/backlog", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({ title: "Item criado com sucesso" });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao criar item", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: PbiFormValues) => {
      const payload = {
        title: data.title,
        description: data.description || null,
        acceptanceCriteria: data.acceptanceCriteria || null,
        type: data.type,
        priority: data.priority,
        storyPoints: data.storyPoints ? parseInt(data.storyPoints) : null,
        estimatedHours: data.estimatedHours ? parseInt(data.estimatedHours) : null,
        internalProjectId: data.internalProjectId && data.internalProjectId !== "none" ? data.internalProjectId : null,
        sprintId: data.sprintId && data.sprintId !== "none" ? data.sprintId : null,
        assigneeId: data.assigneeId && data.assigneeId !== "none" ? data.assigneeId : null,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      };
      return apiRequest("PATCH", `/api/scrum/backlog/${editItem!.id}`, payload);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      if (variables.sprintId && variables.sprintId !== "none") {
        queryClient.invalidateQueries({ queryKey: [`/api/scrum/backlog?sprintId=${variables.sprintId}`] });
      }
      if (editItem?.sprintId) {
        queryClient.invalidateQueries({ queryKey: [`/api/scrum/backlog?sprintId=${editItem.sprintId}`] });
      }
      toast({ title: "Item atualizado com sucesso" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
    },
  });

  const onSubmit = (data: PbiFormValues) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Item" : "Novo Item do Backlog"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize as informacoes do item." : "Preencha as informacoes para criar um novo item."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titulo *</FormLabel>
                  <FormControl>
                    <Input placeholder="Titulo do item" {...field} data-testid="input-pbi-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-type">
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="feature">Feature</SelectItem>
                        <SelectItem value="bug">Bug</SelectItem>
                        <SelectItem value="technical_debt">Debito Tecnico</SelectItem>
                        <SelectItem value="improvement">Melhoria</SelectItem>
                        <SelectItem value="documentation">Documentacao</SelectItem>
                        <SelectItem value="support">Suporte</SelectItem>
                        <SelectItem value="requirement">Requisito</SelectItem>
                        <SelectItem value="task">Tarefa</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridade</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-priority">
                          <SelectValue placeholder="Selecione a prioridade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="critical">Critico</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="medium">Media</SelectItem>
                        <SelectItem value="low">Baixa</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descricao</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o item..."
                      className="min-h-[100px]"
                      {...field}
                      data-testid="input-pbi-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="acceptanceCriteria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Criterios de Aceitacao</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Criterios para considerar o item concluido..."
                      className="min-h-[80px]"
                      {...field}
                      data-testid="input-pbi-acceptance"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="storyPoints"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Story Points</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-points">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="8">8</SelectItem>
                        <SelectItem value="13">13</SelectItem>
                        <SelectItem value="21">21</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="estimatedHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Horas Estimadas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Ex: 8"
                        {...field}
                        data-testid="input-pbi-hours"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="internalProjectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Projeto Interno</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-project">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
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
                name="sprintId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sprint</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-sprint">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Backlog</SelectItem>
                        {sprints.map((sprint) => (
                          <SelectItem key={sprint.id} value={sprint.id}>
                            {sprint.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsavel</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-pbi-assignee">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.firstName} {user.lastName}
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
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data Limite</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        data-testid="input-pbi-duedate"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-pbi">
                {isPending ? "Salvando..." : isEdit ? "Atualizar" : "Criar Item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function PbiDetailDialog({
  open,
  onOpenChange,
  item,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ScrumBacklogItem | null;
  onEdit: () => void;
}) {
  const { toast } = useToast();

  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<ScrumBacklogAttachment[]>({
    queryKey: ['/api/scrum/backlog', item?.id, 'attachments'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/scrum/backlog/${item?.id}/attachments`);
      return res.json();
    },
    enabled: !!item?.id && open,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      await apiRequest('DELETE', `/api/scrum/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scrum/backlog', item?.id, 'attachments'] });
      toast({ title: "Anexo removido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover anexo", variant: "destructive" });
    },
  });

  const getUploadParameters = async () => {
    const res = await apiRequest('POST', '/api/object-storage/presigned-url', {
      prefix: `.private/scrum-attachments/${item?.id}`
    });
    const data = await res.json();
    return { method: 'PUT' as const, url: data.url, storageKey: data.key };
  };

  const handleFileUploaded = async (file: { fileName: string; fileType: string | null; fileSize: number; storageKey: string }) => {
    await apiRequest('POST', `/api/scrum/backlog/${item?.id}/attachments`, {
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      storageKey: file.storageKey,
    });
  };

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/scrum/backlog', item?.id, 'attachments'] });
    toast({ title: "Arquivo anexado com sucesso" });
  };

  const getFileIcon = (fileType: string | null) => {
    if (!fileType) return <File className="h-4 w-4" />;
    if (fileType.startsWith('image/')) return <Image className="h-4 w-4" />;
    if (fileType.startsWith('video/')) return <FileVideo className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (attachment: ScrumBacklogAttachment) => {
    try {
      const res = await apiRequest('GET', `/api/object-storage/download-url?key=${encodeURIComponent(attachment.storageKey)}`);
      const data = await res.json();
      window.open(data.url, '_blank');
    } catch (error) {
      toast({ title: "Erro ao baixar arquivo", variant: "destructive" });
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <PbiTypeIcon type={item.type} />
              </div>
              <div>
                <DialogTitle className="text-left">{item.title}</DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <PbiTypeBadge type={item.type} />
                  <PbiStatusBadge status={item.status} />
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Prioridade</p>
              <PbiPriorityBadge priority={item.priority} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Story Points</p>
              <p className="font-medium">{item.storyPoints || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Horas Estimadas</p>
              <p className="font-medium">{item.estimatedHours ? `${item.estimatedHours}h` : "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Horas Realizadas</p>
              <p className="font-medium">{item.actualHours ? `${item.actualHours}h` : "-"}</p>
            </div>
          </div>

          {item.description && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Descricao</p>
              <p className="text-sm whitespace-pre-wrap">{item.description}</p>
            </div>
          )}

          {item.acceptanceCriteria && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Criterios de Aceitacao</p>
              <p className="text-sm whitespace-pre-wrap">{item.acceptanceCriteria}</p>
            </div>
          )}

          {item.isBlocked === 1 && item.blockedReason && (
            <div className="p-3 bg-red-50 dark:bg-red-950 rounded-md">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Bloqueado</span>
              </div>
              <p className="text-sm text-red-600 dark:text-red-400">{item.blockedReason}</p>
            </div>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {item.dueDate && (
              <div>
                <span className="font-medium">Data Limite:</span> {new Date(item.dueDate).toLocaleDateString('pt-BR')}
              </div>
            )}
            {item.createdAt && (
              <div>
                <span className="font-medium">Criado em:</span> {new Date(item.createdAt).toLocaleDateString('pt-BR')}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Anexos</p>
                {attachments.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{attachments.length}</Badge>
                )}
              </div>
              <ObjectUploader
                maxNumberOfFiles={5}
                onGetUploadParameters={getUploadParameters}
                onFileUploaded={handleFileUploaded}
                onComplete={handleUploadComplete}
                variant="outline"
                size="sm"
              >
                <Upload className="h-4 w-4 mr-2" />
                Anexar Arquivo
              </ObjectUploader>
            </div>

            {attachmentsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum anexo adicionado
              </p>
            ) : (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    data-testid={`attachment-item-${attachment.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getFileIcon(attachment.fileType)}
                      <span className="text-sm truncate">{attachment.fileName}</span>
                      <span className="text-xs text-muted-foreground">
                        ({formatFileSize(attachment.fileSize)})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(attachment)}
                        data-testid={`button-download-${attachment.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAttachmentMutation.mutate(attachment.id)}
                        disabled={deleteAttachmentMutation.isPending}
                        data-testid={`button-delete-attachment-${attachment.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={onEdit} data-testid="button-edit-from-view">
            <Edit2 className="h-4 w-4 mr-2" />
            Editar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScrumBacklog() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const showNewDialog = searchParams.get("new") === "true";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sprintFilter, setSprintFilter] = useState<string>("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<ScrumBacklogItem | null>(null);
  const [viewItem, setViewItem] = useState<ScrumBacklogItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<ScrumBacklogItem | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (showNewDialog) {
      setFormDialogOpen(true);
      setLocation("/producao/backlog", { replace: true });
    }
  }, [showNewDialog, setLocation]);

  const { data: backlogItems = [], isLoading: itemsLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: ["/api/scrum/backlog"],
  });

  const { data: projects = [] } = useQuery<ScrumInternalProject[]>({
    queryKey: ["/api/scrum/projects"],
  });

  const { data: sprints = [] } = useQuery<any[]>({
    queryKey: ["/api/scrum/sprints"],
  });

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ["/api/users"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scrum/backlog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({ title: "Item excluido com sucesso" });
      setDeleteDialogOpen(false);
      setDeleteItem(null);
    },
    onError: () => {
      toast({ title: "Erro ao excluir item", variant: "destructive" });
    },
  });

  const filteredItems = useMemo(() => {
    return backlogItems.filter((item) => {
      if (search && !item.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      if (priorityFilter !== "all" && item.priority !== priorityFilter) {
        return false;
      }
      if (projectFilter !== "all" && item.internalProjectId !== projectFilter) {
        return false;
      }
      if (sprintFilter === "backlog" && item.sprintId) {
        return false;
      }
      if (sprintFilter !== "all" && sprintFilter !== "backlog" && item.sprintId !== sprintFilter) {
        return false;
      }
      return true;
    }).sort((a, b) => (a.backlogOrder || 0) - (b.backlogOrder || 0));
  }, [backlogItems, search, statusFilter, typeFilter, priorityFilter, projectFilter, sprintFilter]);

  const stats = useMemo(() => {
    return {
      total: backlogItems.length,
      backlog: backlogItems.filter(i => !i.sprintId).length,
      inSprint: backlogItems.filter(i => i.sprintId).length,
      inProgress: backlogItems.filter(i => i.status === 'em_execucao').length,
      blocked: backlogItems.filter(i => i.isBlocked === 1).length,
    };
  }, [backlogItems]);

  const handleEdit = (item: ScrumBacklogItem) => {
    setEditItem(item);
    setDetailDialogOpen(false);
    setFormDialogOpen(true);
  };

  const handleView = (item: ScrumBacklogItem) => {
    setViewItem(item);
    setDetailDialogOpen(true);
  };

  const handleDelete = (item: ScrumBacklogItem) => {
    setDeleteItem(item);
    setDeleteDialogOpen(true);
  };

  const handleNewItem = () => {
    setEditItem(null);
    setFormDialogOpen(true);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
    setProjectFilter("all");
    setSprintFilter("all");
  };

  const hasFilters = search || statusFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all" || projectFilter !== "all" || sprintFilter !== "all";

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-backlog-title">
            Backlog
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie e priorize os itens do backlog.
          </p>
        </div>
        <Button onClick={handleNewItem} data-testid="button-new-pbi">
          <Plus className="h-4 w-4 mr-2" />
          Novo Item
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-card-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.backlog}</p>
            <p className="text-xs text-muted-foreground">No Backlog</p>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.inSprint}</p>
            <p className="text-xs text-muted-foreground">Em Sprint</p>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.inProgress}</p>
            <p className="text-xs text-muted-foreground">Em Execucao</p>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{stats.blocked}</p>
            <p className="text-xs text-muted-foreground">Bloqueados</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-card-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar itens..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-backlog"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value="backlog">Backlog</SelectItem>
                <SelectItem value="selecionado">Selecionado</SelectItem>
                <SelectItem value="em_execucao">Em Execucao</SelectItem>
                <SelectItem value="em_revisao">Em Revisao</SelectItem>
                <SelectItem value="aguardando_validacao">Aguardando Validacao</SelectItem>
                <SelectItem value="concluido">Concluido</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-type">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Tipos</SelectItem>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="technical_debt">Debito Tecnico</SelectItem>
                <SelectItem value="improvement">Melhoria</SelectItem>
                <SelectItem value="documentation">Documentacao</SelectItem>
                <SelectItem value="support">Suporte</SelectItem>
                <SelectItem value="requirement">Requisito</SelectItem>
                <SelectItem value="task">Tarefa</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[130px]" data-testid="select-filter-priority">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="critical">Critico</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Media</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sprintFilter} onValueChange={setSprintFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-filter-sprint">
                <SelectValue placeholder="Sprint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Sprints</SelectItem>
                <SelectItem value="backlog">Apenas Backlog</SelectItem>
                {sprints.map((sprint: any) => (
                  <SelectItem key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {itemsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="py-16 text-center">
            <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">
              {hasFilters ? "Nenhum item encontrado" : "Backlog vazio"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {hasFilters
                ? "Tente ajustar os filtros para encontrar os itens."
                : "Comece adicionando itens ao backlog."}
            </p>
            {!hasFilters && (
              <Button onClick={handleNewItem} data-testid="button-empty-new-pbi">
                <Plus className="h-4 w-4 mr-2" />
                Novo Item
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <PbiCard
              key={item.id}
              item={item}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onView={handleView}
            />
          ))}
        </div>
      )}

      <PbiFormDialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open);
          if (!open) setEditItem(null);
        }}
        editItem={editItem}
        projects={projects}
        sprints={sprints}
        users={users}
      />

      <PbiDetailDialog
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open);
          if (!open) setViewItem(null);
        }}
        item={viewItem}
        onEdit={() => {
          if (viewItem) handleEdit(viewItem);
        }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Item</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteItem?.title}"? Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
