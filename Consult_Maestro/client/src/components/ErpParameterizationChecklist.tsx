import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  ClipboardList, 
  Plus, 
  Trash2, 
  Edit2, 
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  GripVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ErpParameterizationTopic, ErpParameterizationItem } from "@shared/schema";

interface ErpParameterizationChecklistProps {
  projectId: string;
}

interface TopicWithItems extends ErpParameterizationTopic {
  items?: ErpParameterizationItem[];
  isOpen?: boolean;
}

function TopicItemRow({ 
  item, 
  onToggle, 
  onDelete 
}: { 
  item: ErpParameterizationItem; 
  onToggle: (id: string, isCompleted: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 hover-elevate rounded-md border border-transparent hover:border-border">
      <Checkbox
        checked={item.isCompleted === 1}
        onCheckedChange={(checked) => onToggle(item.id, !!checked)}
        data-testid={`checkbox-item-${item.id}`}
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${item.isCompleted === 1 ? 'line-through text-muted-foreground' : ''}`}>
          {item.name}
        </div>
        {item.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
        )}
      </div>
      {item.isCompleted === 1 && (
        <Badge variant="outline" size="sm" className="text-green-600 border-green-600">
          <Check className="h-3 w-3 mr-1" />
          Concluido
        </Badge>
      )}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => onDelete(item.id)}
        data-testid={`button-delete-item-${item.id}`}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export function ErpParameterizationChecklist({ projectId }: ErpParameterizationChecklistProps) {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");
  const [topicForm, setTopicForm] = useState({ name: "", description: "" });
  const [itemForm, setItemForm] = useState({ name: "", description: "" });
  const { toast } = useToast();

  const { data: topics = [], isLoading: topicsLoading } = useQuery<ErpParameterizationTopic[]>({
    queryKey: ["/api/projects", projectId, "erp-topics"],
    enabled: !!projectId,
  });

  const topicsWithItems = topics.map(topic => ({
    ...topic,
    isOpen: expandedTopics.has(topic.id)
  }));

  const createTopicMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", `/api/projects/${projectId}/erp-topics`, {
        ...data,
        order: topics.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "erp-topics"] });
      toast({ title: "Topico criado" });
      setTopicDialogOpen(false);
      setTopicForm({ name: "", description: "" });
    },
    onError: () => {
      toast({ title: "Erro ao criar topico", variant: "destructive" });
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/erp-topics/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "erp-topics"] });
      toast({ title: "Topico removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover topico", variant: "destructive" });
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: { topicId: string; name: string; description: string }) => {
      return apiRequest("POST", `/api/erp-topics/${data.topicId}/items`, {
        name: data.name,
        description: data.description,
        order: 0,
        isCompleted: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-topics", selectedTopicId, "items"] });
      toast({ title: "Item adicionado" });
      setItemDialogOpen(false);
      setItemForm({ name: "", description: "" });
    },
    onError: () => {
      toast({ title: "Erro ao criar item", variant: "destructive" });
    },
  });

  const toggleItemMutation = useMutation({
    mutationFn: async ({ id, isCompleted }: { id: string; isCompleted: boolean }) => {
      return apiRequest("PATCH", `/api/erp-items/${id}`, {
        isCompleted: isCompleted ? 1 : 0,
      });
    },
    onSuccess: (_, variables) => {
      topics.forEach(topic => {
        queryClient.invalidateQueries({ queryKey: ["/api/erp-topics", topic.id, "items"] });
      });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/erp-items/${id}`);
    },
    onSuccess: () => {
      topics.forEach(topic => {
        queryClient.invalidateQueries({ queryKey: ["/api/erp-topics", topic.id, "items"] });
      });
      toast({ title: "Item removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover item", variant: "destructive" });
    },
  });

  const toggleTopic = (topicId: string) => {
    const newExpanded = new Set(expandedTopics);
    if (newExpanded.has(topicId)) {
      newExpanded.delete(topicId);
    } else {
      newExpanded.add(topicId);
    }
    setExpandedTopics(newExpanded);
  };

  const openAddItemDialog = (topicId: string) => {
    setSelectedTopicId(topicId);
    setItemForm({ name: "", description: "" });
    setItemDialogOpen(true);
  };

  return (
    <Card className="border-card-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Checklist de Parametrizacao
          </CardTitle>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => {
              setTopicForm({ name: "", description: "" });
              setTopicDialogOpen(true);
            }}
            data-testid="button-add-topic"
          >
            <Plus className="h-4 w-4 mr-1" />
            Novo Topico
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {topicsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : topics.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Nenhum topico de parametrizacao. Clique em "Novo Topico" para comecar.
          </div>
        ) : (
          <div className="space-y-2">
            {topicsWithItems.map((topic) => (
              <TopicSection
                key={topic.id}
                topic={topic}
                isOpen={topic.isOpen || false}
                onToggle={() => toggleTopic(topic.id)}
                onAddItem={() => openAddItemDialog(topic.id)}
                onDeleteTopic={() => deleteTopicMutation.mutate(topic.id)}
                onToggleItem={(id, isCompleted) => toggleItemMutation.mutate({ id, isCompleted })}
                onDeleteItem={(id) => deleteItemMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Topico de Parametrizacao</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              createTopicMutation.mutate(topicForm);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Topico *</label>
              <Input
                value={topicForm.name}
                onChange={(e) => setTopicForm({ ...topicForm, name: e.target.value })}
                placeholder="Ex: Configuracao de Impostos"
                required
                data-testid="input-topic-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descricao</label>
              <Textarea
                value={topicForm.description}
                onChange={(e) => setTopicForm({ ...topicForm, description: e.target.value })}
                placeholder="Descreva o escopo deste topico..."
                rows={2}
                className="resize-none"
                data-testid="input-topic-description"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTopicDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createTopicMutation.isPending} data-testid="button-submit-topic">
                Criar Topico
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Item do Checklist</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              createItemMutation.mutate({
                topicId: selectedTopicId,
                ...itemForm,
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium">Item *</label>
              <Input
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                placeholder="Ex: Definir aliquotas de ICMS por estado"
                required
                data-testid="input-item-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Detalhes</label>
              <Textarea
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                placeholder="Detalhes adicionais..."
                rows={2}
                className="resize-none"
                data-testid="input-item-description"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setItemDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createItemMutation.isPending} data-testid="button-submit-item">
                Adicionar Item
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TopicSection({
  topic,
  isOpen,
  onToggle,
  onAddItem,
  onDeleteTopic,
  onToggleItem,
  onDeleteItem,
}: {
  topic: ErpParameterizationTopic;
  isOpen: boolean;
  onToggle: () => void;
  onAddItem: () => void;
  onDeleteTopic: () => void;
  onToggleItem: (id: string, isCompleted: boolean) => void;
  onDeleteItem: (id: string) => void;
}) {
  const { data: items = [], isLoading } = useQuery<ErpParameterizationItem[]>({
    queryKey: ["/api/erp-topics", topic.id, "items"],
    enabled: isOpen,
  });

  const completedCount = items.filter(i => i.isCompleted === 1).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="border border-border rounded-md">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 p-3 cursor-pointer hover-elevate">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div className="flex-1">
              <div className="font-medium text-sm">{topic.name}</div>
              {topic.description && (
                <div className="text-xs text-muted-foreground">{topic.description}</div>
              )}
            </div>
            {totalCount > 0 && (
              <div className="flex items-center gap-2 mr-2">
                <Progress value={progressPercent} className="w-20 h-2" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {completedCount}/{totalCount}
                </span>
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onAddItem();
              }}
              data-testid={`button-add-item-${topic.id}`}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTopic();
              }}
              data-testid={`button-delete-topic-${topic.id}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border px-3 py-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando itens...
              </div>
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3 text-center">
                Nenhum item. Clique em + para adicionar.
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <TopicItemRow
                    key={item.id}
                    item={item}
                    onToggle={onToggleItem}
                    onDelete={onDeleteItem}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
