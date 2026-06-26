import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { 
  Plus, 
  Trash2, 
  Users, 
  Edit,
  User,
  Printer
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertCollaboratorSchema, type Collaborator, type InsertCollaborator } from "@shared/schema";

interface ClientOrgChartProps {
  clientId: string;
  onPrint?: () => void;
}

interface OrgNodeData {
  label: string;
  position: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  nodeId: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (managerId: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function CollaboratorComponent({ data }: { data: OrgNodeData }) {
  return (
    <div 
      className="bg-card border border-card-border rounded-md shadow-sm min-w-[180px] max-w-[220px] cursor-pointer hover-elevate"
      onClick={() => data.onEdit(data.nodeId)}
      data-testid={`card-collaborator-${data.nodeId}`}
    >
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <Avatar className="h-8 w-8">
            {data.photoUrl ? (
              <AvatarImage src={data.photoUrl} alt={data.label} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {data.label ? getInitials(data.label) : <User className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{data.label}</div>
            {data.position && (
              <div className="text-xs text-muted-foreground truncate">
                {data.position}
              </div>
            )}
          </div>
        </div>
        {data.department && (
          <div className="text-xs text-muted-foreground truncate mt-1">
            {data.department}
          </div>
        )}
      </div>
      <div className="p-2 flex items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddChild(data.nodeId);
          }}
          data-testid={`button-add-child-${data.nodeId}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit(data.nodeId);
          }}
          data-testid={`button-edit-node-${data.nodeId}`}
        >
          <Edit className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete(data.nodeId);
          }}
          data-testid={`button-delete-node-${data.nodeId}`}
        >
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

const nodeTypes = {
  orgNode: CollaboratorComponent,
};

const formSchema = insertCollaboratorSchema.omit({ clientId: true }).extend({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  photoUrl: z.string().url("URL inválida").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export function ClientOrgChart({ clientId, onPrint }: ClientOrgChartProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<Collaborator | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: orgNodes = [], isLoading } = useQuery<Collaborator[]>({
    queryKey: ["/api/clients", clientId, "collaborators"],
    enabled: !!clientId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertCollaborator) => {
      await apiRequest("POST", `/api/clients/${clientId}/collaborators`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "collaborators"] });
      toast({
        title: "Membro adicionado",
        description: "O membro foi adicionado ao organograma.",
      });
      setIsAddDialogOpen(false);
      setSelectedParentId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar o membro.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCollaborator> }) => {
      await apiRequest("PATCH", `/api/collaborators/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "collaborators"] });
      toast({
        title: "Membro atualizado",
        description: "O membro foi atualizado com sucesso.",
      });
      setEditingNode(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o membro.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/collaborators/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "collaborators"] });
      toast({
        title: "Membro removido",
        description: "O membro foi removido do organograma.",
      });
      setDeletingNodeId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível remover o membro.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = useCallback((id: string) => {
    const node = orgNodes.find(n => n.id === id);
    if (node) setEditingNode(node);
  }, [orgNodes]);

  const handleDelete = useCallback((id: string) => {
    setDeletingNodeId(id);
  }, []);

  const handleAddChild = useCallback((managerId: string) => {
    setSelectedParentId(managerId);
    setIsAddDialogOpen(true);
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!orgNodes.length) return { nodes: [], edges: [] };

    const buildTree = (managerId: string | null, level: number, xOffset: number): { nodes: Node[]; width: number } => {
      const children = orgNodes
        .filter(n => n.managerId === managerId);
      
      if (children.length === 0) return { nodes: [], width: 0 };

      const nodeWidth = 220;
      const nodeGap = 40;
      const levelHeight = 150;
      
      let currentX = xOffset;
      const resultNodes: Node[] = [];
      
      children.forEach((child) => {
        const subtree = buildTree(child.id, level + 1, currentX);
        const childWidth = Math.max(subtree.width, nodeWidth);
        
        const nodeX = subtree.width > 0 
          ? currentX + subtree.width / 2 - nodeWidth / 2
          : currentX;
        
        resultNodes.push({
          id: child.id,
          type: "orgNode",
          position: { x: nodeX, y: level * levelHeight },
          data: {
            label: child.name,
            position: child.position,
            department: child.department,
            email: child.email,
            phone: child.phone,
            photoUrl: child.photoUrl,
            nodeId: child.id,
            onEdit: handleEdit,
            onDelete: handleDelete,
            onAddChild: handleAddChild,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        });
        
        resultNodes.push(...subtree.nodes);
        currentX += childWidth + nodeGap;
      });
      
      return { 
        nodes: resultNodes, 
        width: currentX - xOffset - nodeGap 
      };
    };

    const rootNodes = orgNodes.filter(n => !n.managerId);
    let allNodes: Node[] = [];
    let currentX = 0;
    const nodeWidth = 220;
    const nodeGap = 40;

    rootNodes.forEach((root) => {
      const subtree = buildTree(root.id, 1, currentX);
      const rootWidth = Math.max(subtree.width, nodeWidth);
      
      const rootX = subtree.width > 0 
        ? currentX + subtree.width / 2 - nodeWidth / 2
        : currentX;
      
      allNodes.push({
        id: root.id,
        type: "orgNode",
        position: { x: rootX, y: 0 },
        data: {
          label: root.name,
          position: root.position,
          department: root.department,
          email: root.email,
          phone: root.phone,
          photoUrl: root.photoUrl,
          nodeId: root.id,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onAddChild: handleAddChild,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      
      allNodes.push(...subtree.nodes);
      currentX += rootWidth + nodeGap;
    });

    const resultEdges: Edge[] = orgNodes
      .filter(n => n.managerId)
      .map(n => ({
        id: `edge-${n.managerId}-${n.id}`,
        source: n.managerId!,
        target: n.id,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
        },
        style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 },
      }));

    return { nodes: allNodes, edges: resultEdges };
  }, [orgNodes, handleEdit, handleDelete, handleAddChild]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(edges);

  useEffect(() => {
    setFlowNodes(nodes);
    setFlowEdges(edges);
  }, [nodes, edges, setFlowNodes, setFlowEdges]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Organograma</h3>
          <p className="text-sm text-muted-foreground">
            {orgNodes.length} membro{orgNodes.length !== 1 ? 's' : ''} na estrutura
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            if (!open) setSelectedParentId(null);
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-org-member">
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Membro
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar Membro ao Organograma</DialogTitle>
                <DialogDescription>
                  Adicione um novo membro à estrutura organizacional.
                </DialogDescription>
              </DialogHeader>
              <OrgNodeForm
                orgNodes={orgNodes}
                initialParentId={selectedParentId}
                onSubmit={(data) => createMutation.mutate({ ...data, clientId })}
                isPending={createMutation.isPending}
                onCancel={() => {
                  setIsAddDialogOpen(false);
                  setSelectedParentId(null);
                }}
              />
            </DialogContent>
          </Dialog>
          {onPrint && orgNodes.length > 0 && (
            <Button variant="outline" onClick={onPrint} data-testid="button-print-orgchart">
              <Printer className="h-4 w-4 mr-2" />
              Imprimir
            </Button>
          )}
        </div>
      </div>

      {orgNodes.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2">Organograma Vazio</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              Este cliente ainda não possui uma estrutura organizacional definida.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <div style={{ height: 500 }} data-testid="orgchart-canvas">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnScroll
                zoomOnScroll
                minZoom={0.3}
                maxZoom={1.5}
              >
                <Controls showInteractive={false} />
                <Background gap={16} size={1} />
              </ReactFlow>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editingNode} onOpenChange={(open) => !open && setEditingNode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Membro</DialogTitle>
            <DialogDescription>
              Atualize as informações do membro.
            </DialogDescription>
          </DialogHeader>
          {editingNode && (
            <OrgNodeForm
              initialData={editingNode}
              orgNodes={orgNodes.filter(n => n.id !== editingNode.id)}
              onSubmit={(data) => updateMutation.mutate({ id: editingNode.id, data })}
              isPending={updateMutation.isPending}
              onCancel={() => setEditingNode(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingNodeId} onOpenChange={(open) => !open && setDeletingNodeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Membro</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este membro do organograma? 
              Os subordinados diretos serão movidos para o nível superior.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-org">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingNodeId && deleteMutation.mutate(deletingNodeId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-org"
            >
              {deleteMutation.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface OrgNodeFormProps {
  initialData?: Partial<Collaborator>;
  initialParentId?: string | null;
  orgNodes: Collaborator[];
  onSubmit: (data: Omit<InsertCollaborator, "clientId">) => void;
  isPending: boolean;
  onCancel: () => void;
}

function OrgNodeForm({ initialData, initialParentId, orgNodes, onSubmit, isPending, onCancel }: OrgNodeFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || "",
      position: initialData?.position || "",
      department: initialData?.department || "",
      email: initialData?.email || "",
      phone: initialData?.phone || "",
      photoUrl: initialData?.photoUrl || "",
      managerId: initialData?.managerId || initialParentId || "",
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name || "",
        position: initialData.position || "",
        department: initialData.department || "",
        email: initialData.email || "",
        phone: initialData.phone || "",
        photoUrl: initialData.photoUrl || "",
        managerId: initialData.managerId || "",
      });
    }
  }, [initialData, form]);

  const handleFormSubmit = (values: FormValues) => {
    onSubmit({
      name: values.name.trim(),
      position: values.position?.trim() || null,
      department: values.department?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      photoUrl: values.photoUrl?.trim() || null,
      managerId: values.managerId || null,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Nome do membro"
                  data-testid="input-org-name"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="position"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cargo</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="Ex: CEO"
                    data-testid="input-org-position"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="department"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Departamento</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="Ex: Diretoria"
                    data-testid="input-org-department"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="managerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Superior Hierárquico</FormLabel>
              <Select 
                value={field.value || "none"} 
                onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-org-parent">
                    <SelectValue placeholder="Selecione o superior" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">Nenhum (Nível Superior)</SelectItem>
                  {orgNodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name} {node.position ? `- ${node.position}` : ''}
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  value={field.value || ""}
                  placeholder="email@exemplo.com"
                  data-testid="input-org-email"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telefone</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value || ""}
                  placeholder="(11) 99000-0000"
                  data-testid="input-org-phone"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button 
            type="button"
            variant="outline" 
            onClick={onCancel}
            data-testid="button-cancel-org-form"
          >
            Cancelar
          </Button>
          <Button 
            type="submit"
            disabled={isPending}
            data-testid="button-submit-org-form"
          >
            {isPending ? "Salvando..." : (initialData ? "Atualizar" : "Adicionar")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
