import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, ListPlus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScrumInternalProject } from "@shared/schema";

type OriginType = 'task' | 'erp_requirement' | 'support_ticket';

interface GenerateScrumItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originType: OriginType;
  originId: string;
  originProjectId?: string;
  defaultTitle: string;
  defaultDescription?: string;
  defaultType?: 'feature' | 'bug' | 'improvement' | 'tech_debt';
  defaultPriority?: 'low' | 'medium' | 'high' | 'critical';
}

const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  'low': 'low',
  'medium': 'medium',
  'high': 'high',
  'urgent': 'critical',
  'critical': 'critical',
  'baixa': 'low',
  'media': 'medium',
  'alta': 'high',
  '-1': 'low',
  '0': 'medium',
  '1': 'high',
  '2': 'critical',
};

const originTypeLabels: Record<OriginType, string> = {
  task: 'Tarefa',
  erp_requirement: 'Requisito ERP',
  support_ticket: 'Ticket de Suporte',
};

export function GenerateScrumItemDialog({
  open,
  onOpenChange,
  originType,
  originId,
  originProjectId,
  defaultTitle,
  defaultDescription = "",
  defaultType = "feature",
  defaultPriority = "medium",
}: GenerateScrumItemDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [type, setType] = useState<'feature' | 'bug' | 'improvement' | 'tech_debt'>(defaultType);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>(defaultPriority);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setDescription(defaultDescription);
      setType(defaultType);
      setPriority(defaultPriority);
      setSelectedProjectId("");
    }
  }, [open, defaultTitle, defaultDescription, defaultType, defaultPriority]);

  const { data: scrumProjects = [], isLoading: projectsLoading } = useQuery<ScrumInternalProject[]>({
    queryKey: ["/api/scrum/projects"],
    enabled: open,
  });

  const activeProjects = scrumProjects.filter(p => p.status === 'active');

  const createBacklogItemMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/scrum/backlog", {
        internalProjectId: selectedProjectId,
        title,
        description,
        type,
        priority,
        originType,
        originId,
        originProjectId: originProjectId || null,
        status: 'backlog',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({
        title: "Item criado com sucesso",
        description: (
          <div className="flex items-center gap-2">
            <span>Item adicionado ao backlog.</span>
            <Button 
              variant="ghost" 
              size="sm" 
              className="p-0 h-auto underline"
              onClick={() => navigate("/producao/backlog")}
            >
              Ver Backlog
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </div>
        ),
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Erro ao criar item no backlog", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      toast({ title: "Selecione um projeto interno", variant: "destructive" });
      return;
    }
    createBacklogItemMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-primary" />
            Gerar Item Scrum
          </DialogTitle>
          <DialogDescription>
            Criar um item no backlog a partir de: {originTypeLabels[originType]}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scrum-project">Projeto Interno (Scrum)</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger data-testid="select-scrum-project">
                <SelectValue placeholder="Selecione o projeto" />
              </SelectTrigger>
              <SelectContent>
                {projectsLoading ? (
                  <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
                ) : activeProjects.length === 0 ? (
                  <SelectItem value="__empty__" disabled>Nenhum projeto ativo</SelectItem>
                ) : (
                  activeProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-title">Titulo</Label>
            <Input
              id="item-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titulo do item"
              required
              data-testid="input-scrum-item-title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-description">Descricao</Label>
            <Textarea
              id="item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descricao do item"
              rows={3}
              data-testid="input-scrum-item-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item-type">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger data-testid="select-scrum-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">Funcionalidade</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="improvement">Melhoria</SelectItem>
                  <SelectItem value="tech_debt">Debito Tecnico</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-priority">Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger data-testid="select-scrum-item-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="critical">Critica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-scrum-item"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createBacklogItemMutation.isPending || !selectedProjectId}
              data-testid="button-create-scrum-item"
            >
              {createBacklogItemMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <ListPlus className="h-4 w-4 mr-2" />
                  Criar Item
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function mapPriorityToScrum(priority: string | number | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  if (priority === null || priority === undefined) return 'medium';
  const key = String(priority).toLowerCase();
  return priorityMap[key] || 'medium';
}
