import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
  NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, Users, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Collaborator, Client, InsertCollaborator } from "@shared/schema";
import { useState, useEffect } from "react";

interface CollaboratorNodeData {
  collaborator: Collaborator;
}

function CollaboratorNode({ data }: { data: CollaboratorNodeData }) {
  const { collaborator } = data;
  
  return (
    <div className="bg-card border border-card-border rounded-lg shadow-sm min-w-[180px] max-w-[220px] cursor-pointer hover-elevate">
      <Handle type="target" position={Position.Top} className="!bg-primary !w-3 !h-3" />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <Avatar className="h-10 w-10">
            <AvatarImage src={collaborator.photoUrl || undefined} alt={collaborator.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {collaborator.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-sm truncate" data-testid={`orgchart-node-${collaborator.id}`}>
              {collaborator.name}
            </h4>
            {collaborator.position && (
              <p className="text-xs text-muted-foreground truncate">
                {collaborator.position}
              </p>
            )}
          </div>
        </div>
        {collaborator.department && (
          <Badge variant="secondary" size="sm" className="text-xs">
            {collaborator.department}
          </Badge>
        )}
        {collaborator.isActive === 0 && (
          <Badge variant="outline" size="sm" className="text-xs ml-1">
            Inativo
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-3 !h-3" />
    </div>
  );
}

const nodeTypes = {
  collaborator: CollaboratorNode,
};

export default function OrgChart() {
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [editingCollaborator, setEditingCollaborator] = useState<Collaborator | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { toast } = useToast();

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allCollaborators = [], isLoading } = useQuery<Collaborator[]>({
    queryKey: ["/api/collaborators"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCollaborator> }) => {
      return await apiRequest("PATCH", `/api/collaborators/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collaborators"] });
      toast({
        title: "Colaborador atualizado",
        description: "As informacoes foram atualizadas com sucesso.",
      });
      setIsFormOpen(false);
      setEditingCollaborator(null);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Nao foi possivel atualizar o colaborador.",
        variant: "destructive",
      });
    },
  });

  const filteredCollaborators = useMemo(() => {
    if (selectedClientId === "all") return allCollaborators;
    return allCollaborators.filter(c => c.clientId === selectedClientId);
  }, [allCollaborators, selectedClientId]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node<CollaboratorNodeData>[] = [];
    const edges: Edge[] = [];
    
    const rootCollaborators = filteredCollaborators.filter(c => !c.managerId);
    const childrenMap = new Map<string, Collaborator[]>();
    
    filteredCollaborators.forEach(c => {
      if (c.managerId) {
        const children = childrenMap.get(c.managerId) || [];
        children.push(c);
        childrenMap.set(c.managerId, children);
      }
    });

    const HORIZONTAL_SPACING = 250;
    const VERTICAL_SPACING = 150;

    const calculateSubtreeWidth = (collaborator: Collaborator): number => {
      const children = childrenMap.get(collaborator.id) || [];
      if (children.length === 0) return HORIZONTAL_SPACING;
      return children.reduce((sum, child) => sum + calculateSubtreeWidth(child), 0);
    };

    const positionNode = (
      collaborator: Collaborator,
      x: number,
      y: number
    ): void => {
      nodes.push({
        id: collaborator.id,
        type: "collaborator",
        position: { x, y },
        data: { collaborator },
      });

      if (collaborator.managerId) {
        edges.push({
          id: `edge-${collaborator.managerId}-${collaborator.id}`,
          source: collaborator.managerId,
          target: collaborator.id,
          type: "smoothstep",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
          },
          style: { strokeWidth: 2 },
        });
      }

      const children = childrenMap.get(collaborator.id) || [];
      if (children.length > 0) {
        const totalWidth = children.reduce((sum, child) => sum + calculateSubtreeWidth(child), 0);
        let currentX = x - totalWidth / 2;

        children.forEach((child) => {
          const childWidth = calculateSubtreeWidth(child);
          positionNode(child, currentX + childWidth / 2, y + VERTICAL_SPACING);
          currentX += childWidth;
        });
      }
    };

    let totalRootsWidth = rootCollaborators.reduce(
      (sum, root) => sum + calculateSubtreeWidth(root),
      0
    );
    let currentRootX = -totalRootsWidth / 2;

    rootCollaborators.forEach((root) => {
      const rootWidth = calculateSubtreeWidth(root);
      positionNode(root, currentRootX + rootWidth / 2, 0);
      currentRootX += rootWidth;
    });

    return { nodes, edges };
  }, [filteredCollaborators]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback((event, node) => {
    const collaborator = allCollaborators.find(c => c.id === node.id);
    if (collaborator) {
      setEditingCollaborator(collaborator);
      setIsFormOpen(true);
    }
  }, [allCollaborators]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/colaboradores" data-testid="button-back-collaborators">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-heading text-3xl font-bold">Organograma</h1>
            <p className="text-muted-foreground mt-1">
              Visualize a estrutura hierarquica dos colaboradores. Clique em um colaborador para editar.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-[200px]" data-testid="select-orgchart-client">
              <SelectValue placeholder="Filtrar por cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" size="sm">
            {filteredCollaborators.length} colaborador{filteredCollaborators.length !== 1 ? 'es' : ''}
          </Badge>
        </div>
      </div>

      {filteredCollaborators.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum colaborador encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              Cadastre colaboradores para visualizar o organograma.
            </p>
            <Button asChild>
              <Link href="/colaboradores">
                Ir para Colaboradores
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <div className="h-[600px] w-full" data-testid="orgchart-container">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.2}
                maxZoom={2}
                attributionPosition="bottom-left"
              >
                <Background color="hsl(var(--muted-foreground))" gap={20} size={1} />
                <Controls 
                  showInteractive={false}
                  className="bg-card border border-card-border rounded-md"
                />
                <MiniMap 
                  nodeColor="hsl(var(--primary))"
                  maskColor="hsl(var(--background) / 0.8)"
                  className="bg-card border border-card-border rounded-md"
                />
              </ReactFlow>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedClientId === "all" && clients.length > 1 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const clientCollaborators = allCollaborators.filter(c => c.clientId === client.id);
            const rootCount = clientCollaborators.filter(c => !c.managerId).length;
            
            return (
              <Card 
                key={client.id} 
                className="border-card-border hover-elevate cursor-pointer"
                onClick={() => setSelectedClientId(client.id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4" />
                    {client.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{clientCollaborators.length} colaborador{clientCollaborators.length !== 1 ? 'es' : ''}</span>
                    <span>{rootCount} lideranca{rootCount !== 1 ? 's' : ''}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CollaboratorEditDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingCollaborator(null);
        }}
        collaborator={editingCollaborator}
        clients={clients}
        collaborators={allCollaborators}
        onSubmit={(data) => {
          if (editingCollaborator) {
            updateMutation.mutate({ id: editingCollaborator.id, data });
          }
        }}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}

interface CollaboratorEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaborator: Collaborator | null;
  clients: Client[];
  collaborators: Collaborator[];
  onSubmit: (data: Partial<InsertCollaborator>) => void;
  isPending: boolean;
}

function CollaboratorEditDialog({
  open,
  onOpenChange,
  collaborator,
  clients,
  collaborators,
  onSubmit,
  isPending,
}: CollaboratorEditDialogProps) {
  const [formData, setFormData] = useState<Partial<InsertCollaborator>>({});

  const resetForm = () => {
    if (collaborator) {
      setFormData({
        clientId: collaborator.clientId,
        managerId: collaborator.managerId,
        name: collaborator.name,
        position: collaborator.position,
        department: collaborator.department,
        email: collaborator.email,
        phone: collaborator.phone,
        mobile: collaborator.mobile,
        photoUrl: collaborator.photoUrl,
        notes: collaborator.notes,
        isActive: collaborator.isActive,
      });
    } else {
      setFormData({});
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const availableManagers = collaborators.filter(c => 
    c.clientId === formData.clientId && c.id !== collaborator?.id
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.clientId) return;
    
    const cleanedData: Partial<InsertCollaborator> = {
      ...formData,
      name: formData.name?.trim(),
      position: formData.position?.trim() || null,
      department: formData.department?.trim() || null,
      email: formData.email?.trim() || null,
      phone: formData.phone?.trim() || null,
      mobile: formData.mobile?.trim() || null,
      photoUrl: formData.photoUrl?.trim() || null,
      notes: formData.notes?.trim() || null,
      managerId: formData.managerId || null,
    };
    
    onSubmit(cleanedData);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Colaborador</DialogTitle>
          <DialogDescription>
            Atualize as informacoes do colaborador.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clientId">Cliente *</Label>
            <Select 
              value={formData.clientId || ""} 
              onValueChange={(value) => setFormData({ ...formData, clientId: value, managerId: null })}
            >
              <SelectTrigger data-testid="select-orgchart-edit-client">
                <SelectValue placeholder="Selecione o cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nome completo"
              data-testid="input-orgchart-edit-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="position">Cargo</Label>
              <Input
                id="position"
                value={formData.position || ""}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                placeholder="Ex: Diretor, Gerente"
                data-testid="input-orgchart-edit-position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Departamento</Label>
              <Input
                id="department"
                value={formData.department || ""}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                placeholder="Ex: Comercial, TI"
                data-testid="input-orgchart-edit-department"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="managerId">Gestor Direto</Label>
            <Select 
              value={formData.managerId || "none"} 
              onValueChange={(value) => setFormData({ ...formData, managerId: value === "none" ? null : value })}
              disabled={!formData.clientId}
            >
              <SelectTrigger data-testid="select-orgchart-edit-manager">
                <SelectValue placeholder="Selecione o gestor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (nivel mais alto)</SelectItem>
                {availableManagers.map((manager) => (
                  <SelectItem key={manager.id} value={manager.id}>
                    {manager.name} {manager.position ? `- ${manager.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email || ""}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="email@empresa.com"
              data-testid="input-orgchart-edit-email"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(11) 1234-5678"
                data-testid="input-orgchart-edit-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile">Celular</Label>
              <Input
                id="mobile"
                value={formData.mobile || ""}
                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                placeholder="(11) 91234-5678"
                data-testid="input-orgchart-edit-mobile"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="photoUrl">URL da Foto</Label>
            <Input
              id="photoUrl"
              value={formData.photoUrl || ""}
              onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
              placeholder="https://..."
              data-testid="input-orgchart-edit-photo"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observacoes</Label>
            <Textarea
              id="notes"
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Informacoes adicionais..."
              rows={3}
              data-testid="textarea-orgchart-edit-notes"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="isActive">Status</Label>
            <Select 
              value={String(formData.isActive ?? 1)} 
              onValueChange={(value) => setFormData({ ...formData, isActive: parseInt(value) })}
            >
              <SelectTrigger data-testid="select-orgchart-edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Ativo</SelectItem>
                <SelectItem value="0">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={isPending || !formData.name || !formData.clientId}
              data-testid="button-orgchart-save"
            >
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
