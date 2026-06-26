import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Zap,
  Plus,
  Calendar,
  Target,
  Clock,
  MoreHorizontal,
  Edit2,
  Trash2,
  Eye,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Bug,
  Wrench,
  FileText,
  Lightbulb,
  HelpCircle,
  BookOpen,
  CheckSquare,
  ListTodo,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  GripVertical,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type {
  ScrumBacklogItem,
  ScrumInternalProject,
  ScrumSprint,
  ScrumTeam,
} from "@shared/schema";
import { Link } from "wouter";

const sprintFormSchema = z.object({
  name: z.string().min(1, "Nome e obrigatorio"),
  goal: z.string().optional(),
  startDate: z.string().min(1, "Data de inicio e obrigatoria"),
  endDate: z.string().min(1, "Data de fim e obrigatoria"),
  internalProjectId: z.string().optional(),
  teamId: z.string().optional(),
  capacity: z.string().optional(),
});

type SprintFormValues = z.infer<typeof sprintFormSchema>;

const KANBAN_COLUMNS = [
  { id: "selecionado", label: "Selecionado", color: "bg-blue-500" },
  { id: "em_execucao", label: "Em Execucao", color: "bg-yellow-500" },
  { id: "em_revisao", label: "Em Revisao", color: "bg-purple-500" },
  { id: "aguardando_validacao", label: "Aguardando", color: "bg-orange-500" },
  { id: "concluido", label: "Concluido", color: "bg-green-500" },
];

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
    technical_debt: { label: "Debito Tec.", variant: "secondary" },
    improvement: { label: "Melhoria", variant: "outline" },
    documentation: { label: "Doc", variant: "outline" },
    support: { label: "Suporte", variant: "outline" },
    requirement: { label: "Requisito", variant: "secondary" },
    task: { label: "Tarefa", variant: "outline" },
  };

  const { label, variant } = config[type] || { label: type, variant: "outline" };
  return <Badge variant={variant} size="sm">{label}</Badge>;
}

function PbiPriorityIcon({ priority }: { priority: string }) {
  const config: Record<string, { icon: React.ElementType; color: string }> = {
    critical: { icon: ArrowUp, color: "text-red-500" },
    high: { icon: ArrowUp, color: "text-orange-500" },
    medium: { icon: ArrowRight, color: "text-yellow-500" },
    low: { icon: ArrowDown, color: "text-green-500" },
  };

  const { icon: Icon, color } = config[priority] || { icon: ArrowRight, color: "text-muted-foreground" };
  return <Icon className={`h-3 w-3 ${color}`} />;
}

function SprintStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    planning: { label: "Planejamento", variant: "secondary" },
    active: { label: "Ativa", variant: "default" },
    completed: { label: "Concluida", variant: "outline" },
    cancelled: { label: "Cancelada", variant: "destructive" },
    review: { label: "Revisao", variant: "secondary" },
  };

  const { label, variant } = config[status] || { label: status, variant: "outline" };
  return <Badge variant={variant} size="sm">{label}</Badge>;
}

function SprintCard({
  sprint,
  onSelect,
  onEdit,
  onDelete,
  onStart,
  onComplete,
}: {
  sprint: ScrumSprint;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onComplete: () => void;
}) {
  const startDate = sprint.startDate ? new Date(sprint.startDate) : null;
  const endDate = sprint.endDate ? new Date(sprint.endDate) : null;
  const today = new Date();

  let daysRemaining = 0;
  let totalDays = 0;
  let progress = 0;

  if (startDate && endDate) {
    totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const elapsed = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    progress = Math.min(100, Math.max(0, (elapsed / totalDays) * 100));
  }

  return (
    <Card
      className="border-card-border hover-elevate cursor-pointer"
      data-testid={`card-sprint-${sprint.id}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{sprint.name}</h3>
              <SprintStatusBadge status={sprint.status} />
            </div>
            {sprint.goal && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{sprint.goal}</p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" data-testid={`button-sprint-menu-${sprint.id}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(); }} data-testid={`button-view-sprint-${sprint.id}`}>
                <Eye className="h-4 w-4 mr-2" />
                Ver Board
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }} data-testid={`button-edit-sprint-${sprint.id}`}>
                <Edit2 className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem asChild onClick={(e) => e.stopPropagation()}>
                <Link href={`/producao/sprints/${sprint.id}/planning`} data-testid={`button-plan-sprint-${sprint.id}`}>
                  <Target className="h-4 w-4 mr-2" />
                  Planejar Sprint
                </Link>
              </DropdownMenuItem>
              {sprint.status === "planning" && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStart(); }} data-testid={`button-start-sprint-${sprint.id}`}>
                  <Play className="h-4 w-4 mr-2" />
                  Iniciar Sprint
                </DropdownMenuItem>
              )}
              {sprint.status === "active" && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onComplete(); }} data-testid={`button-complete-sprint-${sprint.id}`}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Finalizar Sprint
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-destructive"
                data-testid={`button-delete-sprint-${sprint.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
          {startDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {startDate.toLocaleDateString('pt-BR')}
            </div>
          )}
          {endDate && (
            <div className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {endDate.toLocaleDateString('pt-BR')}
            </div>
          )}
          {sprint.status === "active" && daysRemaining > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {daysRemaining} dias restantes
            </div>
          )}
        </div>

        {sprint.status === "active" && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso do tempo</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KanbanCard({
  item,
  onMoveStatus,
  onView,
  isDragging,
}: {
  item: ScrumBacklogItem;
  onMoveStatus: (newStatus: string) => void;
  onView: () => void;
  isDragging?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="border-card-border hover-elevate cursor-grab active:cursor-grabbing mb-2 touch-none"
      data-testid={`card-kanban-pbi-${item.id}`}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted shrink-0">
            <PbiTypeIcon type={item.type} />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium line-clamp-2">{item.title}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <PbiTypeBadge type={item.type} />
              <PbiPriorityIcon priority={item.priority} />
              {item.storyPoints && (
                <span className="text-xs text-muted-foreground">{item.storyPoints} pts</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => { e.stopPropagation(); onView(); }}
            onPointerDown={(e) => e.stopPropagation()}
            data-testid={`button-view-pbi-${item.id}`}
          >
            <Eye className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onPointerDown={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {KANBAN_COLUMNS.filter(col => col.id !== item.status).map(col => (
                <DropdownMenuItem
                  key={col.id}
                  onClick={(e) => { e.stopPropagation(); onMoveStatus(col.id); }}
                >
                  <span className={`w-2 h-2 rounded-full mr-2 ${col.color}`} />
                  Mover para {col.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {item.isBlocked === 1 && (
          <div className="flex items-center gap-1 mt-2 text-xs text-red-500">
            <AlertTriangle className="h-3 w-3" />
            Bloqueado
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KanbanColumn({
  column,
  items,
  onMoveStatus,
  onViewItem,
  activeId,
}: {
  column: { id: string; label: string; color: string };
  items: ScrumBacklogItem[];
  onMoveStatus: (itemId: string, newStatus: string) => void;
  onViewItem: (item: ScrumBacklogItem) => void;
  activeId?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const totalPoints = items.reduce((sum, item) => sum + (item.storyPoints || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] max-w-[320px] bg-muted/50 rounded-lg transition-colors ${
        isOver ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
    >
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${column.color}`} />
            <span className="font-medium text-sm">{column.label}</span>
            <Badge variant="secondary" size="sm">{items.length}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">{totalPoints} pts</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2">
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 min-h-[200px]">
            {items.length === 0 ? (
              <div className="flex items-center justify-center h-[100px] text-muted-foreground text-sm">
                {isOver ? "Soltar aqui" : "Nenhum item"}
              </div>
            ) : (
              items.map((item) => (
                <KanbanCard
                  key={item.id}
                  item={item}
                  onMoveStatus={(newStatus) => onMoveStatus(item.id, newStatus)}
                  onView={() => onViewItem(item)}
                  isDragging={activeId === item.id}
                />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}

function SprintBoard({
  sprint,
  onBack,
}: {
  sprint: ScrumSprint;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [viewItem, setViewItem] = useState<ScrumBacklogItem | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const { data: backlogItems = [], isLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: [`/api/scrum/backlog?sprintId=${sprint.id}`],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: string }) => {
      return apiRequest("PATCH", `/api/scrum/backlog/${itemId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/scrum/backlog?sprintId=${sprint.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({ title: "Status atualizado" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    },
  });

  const itemsByStatus = useMemo(() => {
    const grouped: Record<string, ScrumBacklogItem[]> = {};
    KANBAN_COLUMNS.forEach(col => {
      grouped[col.id] = [];
    });
    backlogItems.forEach(item => {
      if (grouped[item.status]) {
        grouped[item.status].push(item);
      }
    });
    return grouped;
  }, [backlogItems]);

  const completedPoints = useMemo(() => {
    return backlogItems
      .filter(item => item.status === "concluido")
      .reduce((sum, item) => sum + (item.storyPoints || 0), 0);
  }, [backlogItems]);

  const totalPoints = useMemo(() => {
    return backlogItems.reduce((sum, item) => sum + (item.storyPoints || 0), 0);
  }, [backlogItems]);

  const completionPercentage = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

  const handleMoveStatus = (itemId: string, newStatus: string) => {
    updateStatusMutation.mutate({ itemId, status: newStatus });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const itemId = active.id as string;
    const overId = over.id as string;

    const item = backlogItems.find(i => i.id === itemId);
    if (!item) return;

    let newStatus: string | null = null;

    if (KANBAN_COLUMNS.some(col => col.id === overId)) {
      newStatus = overId;
    } else {
      const overItem = backlogItems.find(i => i.id === overId);
      if (overItem) {
        newStatus = overItem.status;
      }
    }

    if (newStatus && item.status !== newStatus) {
      handleMoveStatus(itemId, newStatus);
    }
  };

  const activeItem = activeId ? backlogItems.find(item => item.id === activeId) : null;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[400px] w-[300px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4">
        <div className="flex items-center gap-4 mb-2">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-sprints">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-heading text-2xl font-bold">{sprint.name}</h1>
              <SprintStatusBadge status={sprint.status} />
            </div>
            {sprint.goal && (
              <p className="text-muted-foreground text-sm mt-1">{sprint.goal}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          {sprint.startDate && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {new Date(sprint.startDate).toLocaleDateString('pt-BR')} - {sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('pt-BR') : 'N/A'}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Progresso:</span>
            <Progress value={completionPercentage} className="w-24 h-2" />
            <span className="font-medium">{completedPoints}/{totalPoints} pts ({completionPercentage}%)</span>
          </div>
          <Badge variant="outline">
            {backlogItems.length} itens
          </Badge>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="flex-1">
          <div className="flex gap-4 pb-4">
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                items={itemsByStatus[column.id] || []}
                onMoveStatus={handleMoveStatus}
                onViewItem={setViewItem}
                activeId={activeId}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? (
            <Card className="border-card-border shadow-lg w-[280px]">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-muted shrink-0">
                    <PbiTypeIcon type={activeItem.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{activeItem.title}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <PbiTypeBadge type={activeItem.type} />
                      {activeItem.storyPoints && (
                        <span className="text-xs text-muted-foreground">{activeItem.storyPoints} pts</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PbiTypeIcon type={viewItem?.type || "feature"} />
              {viewItem?.title}
            </DialogTitle>
          </DialogHeader>
          {viewItem && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <PbiTypeBadge type={viewItem.type} />
                <Badge variant="outline" size="sm">
                  <span className={`w-2 h-2 rounded-full mr-1.5 ${KANBAN_COLUMNS.find(c => c.id === viewItem.status)?.color || 'bg-gray-500'}`} />
                  {KANBAN_COLUMNS.find(c => c.id === viewItem.status)?.label || viewItem.status}
                </Badge>
              </div>

              {viewItem.description && (
                <div>
                  <p className="text-sm font-medium mb-1">Descricao</p>
                  <p className="text-sm text-muted-foreground">{viewItem.description}</p>
                </div>
              )}

              {viewItem.acceptanceCriteria && (
                <div>
                  <p className="text-sm font-medium mb-1">Criterios de Aceitacao</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{viewItem.acceptanceCriteria}</p>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm">
                {viewItem.storyPoints && (
                  <div>
                    <span className="text-muted-foreground">Story Points: </span>
                    <span className="font-medium">{viewItem.storyPoints}</span>
                  </div>
                )}
                {viewItem.estimatedHours && (
                  <div>
                    <span className="text-muted-foreground">Estimativa: </span>
                    <span className="font-medium">{viewItem.estimatedHours}h</span>
                  </div>
                )}
              </div>

              {viewItem.isBlocked === 1 && viewItem.blockedReason && (
                <div className="p-3 bg-red-50 dark:bg-red-950 rounded-md">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">Bloqueado</span>
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-400">{viewItem.blockedReason}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Link href="/producao/backlog">
              <Button variant="outline" data-testid="button-view-backlog">
                Ver no Backlog
              </Button>
            </Link>
            <Button onClick={() => setViewItem(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SprintFormDialog({
  open,
  onOpenChange,
  editSprint,
  projects,
  teams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editSprint?: ScrumSprint | null;
  projects: ScrumInternalProject[];
  teams: ScrumTeam[];
}) {
  const { toast } = useToast();
  const isEdit = !!editSprint;

  const form = useForm<SprintFormValues>({
    resolver: zodResolver(sprintFormSchema),
    defaultValues: {
      name: editSprint?.name || "",
      goal: editSprint?.goal || "",
      startDate: editSprint?.startDate ? new Date(editSprint.startDate).toISOString().split('T')[0] : "",
      endDate: editSprint?.endDate ? new Date(editSprint.endDate).toISOString().split('T')[0] : "",
      internalProjectId: editSprint?.internalProjectId || "",
      teamId: editSprint?.teamId || "",
      capacity: editSprint?.capacity?.toString() || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SprintFormValues) => {
      const payload = {
        name: data.name,
        goal: data.goal || null,
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        internalProjectId: data.internalProjectId && data.internalProjectId !== "none" ? data.internalProjectId : null,
        teamId: data.teamId && data.teamId !== "none" ? data.teamId : null,
        capacity: data.capacity ? parseInt(data.capacity) : null,
        status: "planning",
      };
      return apiRequest("POST", "/api/scrum/sprints", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Sprint criada com sucesso" });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao criar sprint", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: SprintFormValues) => {
      const payload = {
        name: data.name,
        goal: data.goal || null,
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        internalProjectId: data.internalProjectId && data.internalProjectId !== "none" ? data.internalProjectId : null,
        teamId: data.teamId && data.teamId !== "none" ? data.teamId : null,
        capacity: data.capacity ? parseInt(data.capacity) : null,
      };
      return apiRequest("PATCH", `/api/scrum/sprints/${editSprint!.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Sprint atualizada com sucesso" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar sprint", variant: "destructive" });
    },
  });

  const onSubmit = (data: SprintFormValues) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Sprint" : "Nova Sprint"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize as informacoes da sprint." : "Preencha as informacoes para criar uma nova sprint."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input placeholder="Sprint 1" {...field} data-testid="input-sprint-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="goal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Objetivo</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Objetivo da sprint..."
                      className="min-h-[80px]"
                      {...field}
                      data-testid="input-sprint-goal"
                    />
                  </FormControl>
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
                    <FormLabel>Data Inicio *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-sprint-start" />
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
                    <FormLabel>Data Fim *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-sprint-end" />
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
                    <FormLabel>Projeto</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sprint-project">
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
                name="teamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipe</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sprint-team">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {teams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacidade (Story Points)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Ex: 30"
                      {...field}
                      data-testid="input-sprint-capacity"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-submit-sprint">
                {isPending ? "Salvando..." : isEdit ? "Atualizar" : "Criar Sprint"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function ScrumSprints() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/producao/sprints/:id");
  const { toast } = useToast();

  const [selectedSprint, setSelectedSprint] = useState<ScrumSprint | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editSprint, setEditSprint] = useState<ScrumSprint | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ScrumSprint | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery<ScrumSprint[]>({
    queryKey: ["/api/scrum/sprints"],
  });

  const { data: projects = [] } = useQuery<ScrumInternalProject[]>({
    queryKey: ["/api/scrum/projects"],
  });

  const { data: teams = [] } = useQuery<ScrumTeam[]>({
    queryKey: ["/api/scrum/teams"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scrum/sprints/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Sprint excluida" });
      setDeleteConfirm(null);
    },
    onError: () => {
      toast({ title: "Erro ao excluir sprint", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/scrum/sprints/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/sprints"] });
      toast({ title: "Status atualizado" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    },
  });

  const filteredSprints = useMemo(() => {
    if (statusFilter === "all") return sprints;
    return sprints.filter(s => s.status === statusFilter);
  }, [sprints, statusFilter]);

  const handleEditSprint = (sprint: ScrumSprint) => {
    setEditSprint(sprint);
    setFormOpen(true);
  };

  const handleStartSprint = (sprint: ScrumSprint) => {
    updateStatusMutation.mutate({ id: sprint.id, status: "active" });
  };

  const handleCompleteSprint = (sprint: ScrumSprint) => {
    updateStatusMutation.mutate({ id: sprint.id, status: "completed" });
  };

  if (selectedSprint || (match && params?.id)) {
    const sprintToShow = selectedSprint || sprints.find(s => s.id === params?.id);
    if (sprintToShow) {
      return (
        <SprintBoard
          sprint={sprintToShow}
          onBack={() => {
            setSelectedSprint(null);
            setLocation("/producao/sprints");
          }}
        />
      );
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-sprints-title">
            Sprints
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie as sprints e acompanhe o progresso.
          </p>
        </div>
        <Button onClick={() => { setEditSprint(null); setFormOpen(true); }} data-testid="button-new-sprint">
          <Plus className="h-4 w-4 mr-2" />
          Nova Sprint
        </Button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="planning">Planejamento</SelectItem>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="completed">Concluidas</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          {filteredSprints.length} sprint(s)
        </div>
      </div>

      {sprintsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[160px]" />
          ))}
        </div>
      ) : filteredSprints.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium text-lg mb-2">Nenhuma sprint encontrada</h3>
            <p className="text-muted-foreground text-center mb-4">
              {statusFilter === "all"
                ? "Crie sua primeira sprint para comecar."
                : "Nenhuma sprint com este status."}
            </p>
            <Button onClick={() => { setEditSprint(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Sprint
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSprints.map((sprint) => (
            <SprintCard
              key={sprint.id}
              sprint={sprint}
              onSelect={() => setSelectedSprint(sprint)}
              onEdit={() => handleEditSprint(sprint)}
              onDelete={() => setDeleteConfirm(sprint)}
              onStart={() => handleStartSprint(sprint)}
              onComplete={() => handleCompleteSprint(sprint)}
            />
          ))}
        </div>
      )}

      <SprintFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditSprint(null);
        }}
        editSprint={editSprint}
        projects={projects}
        teams={teams}
      />

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Sprint</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a sprint "{deleteConfirm?.name}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
