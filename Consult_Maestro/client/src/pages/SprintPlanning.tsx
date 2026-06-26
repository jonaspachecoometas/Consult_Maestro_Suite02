import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  Zap,
  ArrowLeft,
  ArrowRight,
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
  Target,
  Calendar,
  Users,
  BarChart3,
  Plus,
  Minus,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type {
  ScrumBacklogItem,
  ScrumSprint,
  ScrumTeam,
} from "@shared/schema";

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

function BacklogItemRow({
  item,
  isSelected,
  onToggle,
  showAddButton,
  onAdd,
  onRemove,
  disabled,
}: {
  item: ScrumBacklogItem;
  isSelected?: boolean;
  onToggle?: () => void;
  showAddButton?: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border border-border hover-elevate ${
        isSelected ? "bg-accent/50" : ""
      }`}
      data-testid={`row-pbi-${item.id}`}
    >
      {onToggle && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={disabled}
          data-testid={`checkbox-pbi-${item.id}`}
        />
      )}
      <div className="flex h-8 w-8 items-center justify-center rounded bg-muted shrink-0">
        <PbiTypeIcon type={item.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{item.title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <PbiTypeBadge type={item.type} />
          <PbiPriorityIcon priority={item.priority} />
          {item.storyPoints && (
            <Badge variant="outline" size="sm">{item.storyPoints} pts</Badge>
          )}
        </div>
      </div>
      {showAddButton && onAdd && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onAdd}
          disabled={disabled}
          data-testid={`button-add-pbi-${item.id}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
      {onRemove && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled}
          data-testid={`button-remove-pbi-${item.id}`}
        >
          <Minus className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default function SprintPlanning() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/producao/sprints/:id/planning");
  const { toast } = useToast();
  
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const sprintId = params?.id;

  const { data: sprint, isLoading: sprintLoading } = useQuery<ScrumSprint>({
    queryKey: ["/api/scrum/sprints", sprintId],
    enabled: !!sprintId,
  });

  const { data: team } = useQuery<ScrumTeam>({
    queryKey: ["/api/scrum/teams", sprint?.teamId],
    enabled: !!sprint?.teamId,
  });

  const { data: productBacklog = [], isLoading: backlogLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: ["/api/scrum/backlog"],
  });

  const { data: sprintItems = [], isLoading: sprintItemsLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: [`/api/scrum/backlog?sprintId=${sprintId}`],
    enabled: !!sprintId,
  });

  const addToSprintMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      await Promise.all(
        itemIds.map(id =>
          apiRequest("PATCH", `/api/scrum/backlog/${id}`, {
            sprintId,
            status: "selecionado",
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      queryClient.invalidateQueries({ queryKey: [`/api/scrum/backlog?sprintId=${sprintId}`] });
      setSelectedItems(new Set());
      toast({ title: "Itens adicionados a sprint" });
    },
    onError: () => {
      toast({ title: "Erro ao adicionar itens", variant: "destructive" });
    },
  });

  const removeFromSprintMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest("PATCH", `/api/scrum/backlog/${itemId}`, {
        sprintId: null,
        status: "backlog",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      queryClient.invalidateQueries({ queryKey: [`/api/scrum/backlog?sprintId=${sprintId}`] });
      toast({ title: "Item removido da sprint" });
    },
    onError: () => {
      toast({ title: "Erro ao remover item", variant: "destructive" });
    },
  });

  const filteredBacklog = useMemo(() => {
    return productBacklog.filter(item => {
      // Only show items that are NOT assigned to any sprint (available for planning)
      if (item.sprintId) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
      return true;
    });
  }, [productBacklog, typeFilter, priorityFilter]);

  const sprintCapacity = sprint?.capacity || 0;
  const committedPoints = useMemo(() => {
    return sprintItems.reduce((sum, item) => sum + (item.storyPoints || 0), 0);
  }, [sprintItems]);
  const selectedPoints = useMemo(() => {
    return Array.from(selectedItems).reduce((sum, id) => {
      const item = productBacklog.find(i => i.id === id);
      return sum + (item?.storyPoints || 0);
    }, 0);
  }, [selectedItems, productBacklog]);

  const capacityUsage = sprintCapacity > 0 ? Math.round((committedPoints / sprintCapacity) * 100) : 0;
  const projectedUsage = sprintCapacity > 0 ? Math.round(((committedPoints + selectedPoints) / sprintCapacity) * 100) : 0;
  const isOverCapacity = projectedUsage > 100;

  const toggleItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAddSelected = () => {
    if (selectedItems.size > 0) {
      addToSprintMutation.mutate(Array.from(selectedItems));
    }
  };

  const handleAddSingle = (itemId: string) => {
    addToSprintMutation.mutate([itemId]);
  };

  const handleRemove = (itemId: string) => {
    removeFromSprintMutation.mutate(itemId);
  };

  if (!sprintId || !match) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Sprint nao encontrada</p>
        <Button variant="link" onClick={() => setLocation("/producao/sprints")}>
          Voltar para Sprints
        </Button>
      </div>
    );
  }

  if (sprintLoading || backlogLoading || sprintItemsLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[500px]" />
          <Skeleton className="h-[500px]" />
        </div>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Sprint nao encontrada</p>
        <Button variant="link" onClick={() => setLocation("/producao/sprints")}>
          Voltar para Sprints
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/producao/sprints")}
            data-testid="button-back-sprints"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-heading text-2xl font-bold">Planejamento: {sprint.name}</h1>
              <SprintStatusBadge status={sprint.status} />
            </div>
            {sprint.goal && (
              <p className="text-muted-foreground text-sm mt-1">{sprint.goal}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Target className="h-4 w-4" />
                Capacidade
              </div>
              <p className="text-2xl font-bold">{sprintCapacity} pts</p>
            </CardContent>
          </Card>
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <BarChart3 className="h-4 w-4" />
                Comprometido
              </div>
              <p className="text-2xl font-bold">{committedPoints} pts</p>
              <Progress value={capacityUsage} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Calendar className="h-4 w-4" />
                Periodo
              </div>
              <p className="text-sm font-medium">
                {sprint.startDate ? new Date(sprint.startDate).toLocaleDateString('pt-BR') : 'N/A'} -{' '}
                {sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('pt-BR') : 'N/A'}
              </p>
            </CardContent>
          </Card>
          <Card className="border-card-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="h-4 w-4" />
                Equipe
              </div>
              <p className="text-sm font-medium">{team?.name || 'Nao definida'}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        <Card className="border-card-border flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">Product Backlog</CardTitle>
              <Badge variant="secondary">{filteredBacklog.length} itens</Badge>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-type-filter">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos tipos</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="technical_debt">Debito Tec.</SelectItem>
                  <SelectItem value="improvement">Melhoria</SelectItem>
                  <SelectItem value="task">Tarefa</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-priority-filter">
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="critical">Critica</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="low">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-6 pb-4">
              <div className="space-y-2">
                {filteredBacklog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ListTodo className="h-12 w-12 mb-4" />
                    <p>Nenhum item no backlog</p>
                  </div>
                ) : (
                  filteredBacklog.map(item => (
                    <BacklogItemRow
                      key={item.id}
                      item={item}
                      isSelected={selectedItems.has(item.id)}
                      onToggle={() => toggleItem(item.id)}
                      showAddButton
                      onAdd={() => handleAddSingle(item.id)}
                      disabled={addToSprintMutation.isPending}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
          {selectedItems.size > 0 && (
            <div className="p-4 border-t bg-muted/50">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-sm">
                  <span className="font-medium">{selectedItems.size}</span> selecionado(s) -{' '}
                  <span className="font-medium">{selectedPoints}</span> pts
                  {isOverCapacity && (
                    <span className="text-destructive ml-2 inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Excede capacidade
                    </span>
                  )}
                </div>
                <Button
                  onClick={handleAddSelected}
                  disabled={addToSprintMutation.isPending}
                  data-testid="button-add-selected"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar a Sprint
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="border-card-border flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">Sprint Backlog</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{sprintItems.length} itens</Badge>
                <Badge variant={isOverCapacity ? "destructive" : "outline"}>
                  {committedPoints}/{sprintCapacity} pts
                </Badge>
              </div>
            </div>
            {sprintCapacity > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Utilizacao da capacidade</span>
                  <span>{capacityUsage}%</span>
                </div>
                <Progress
                  value={Math.min(capacityUsage, 100)}
                  className={`h-2 ${capacityUsage > 100 ? '[&>div]:bg-destructive' : ''}`}
                />
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-6 pb-4">
              <div className="space-y-2">
                {sprintItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mb-4" />
                    <p>Nenhum item na sprint</p>
                    <p className="text-sm mt-1">Selecione itens do backlog</p>
                  </div>
                ) : (
                  sprintItems.map(item => (
                    <BacklogItemRow
                      key={item.id}
                      item={item}
                      onRemove={() => handleRemove(item.id)}
                      disabled={removeFromSprintMutation.isPending}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
