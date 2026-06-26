import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Mail, 
  Phone, 
  Smartphone,
  Building2,
  Trash2,
  Edit,
  Users,
  UserCircle,
  Network
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Collaborator, Client, InsertCollaborator } from "@shared/schema";
import { Link } from "wouter";

export default function Collaborators() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [deleteCollaborator, setDeleteCollaborator] = useState<Collaborator | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCollaborator, setEditingCollaborator] = useState<Collaborator | null>(null);
  const { toast } = useToast();

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allCollaborators = [], isLoading } = useQuery<Collaborator[]>({
    queryKey: ["/api/collaborators"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertCollaborator) => {
      return await apiRequest("POST", `/api/clients/${data.clientId}/collaborators`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collaborators"] });
      toast({
        title: "Colaborador criado",
        description: "O colaborador foi cadastrado com sucesso.",
      });
      setIsFormOpen(false);
      setEditingCollaborator(null);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível cadastrar o colaborador.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCollaborator> }) => {
      return await apiRequest("PATCH", `/api/collaborators/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collaborators"] });
      toast({
        title: "Colaborador atualizado",
        description: "As informações foram atualizadas com sucesso.",
      });
      setIsFormOpen(false);
      setEditingCollaborator(null);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o colaborador.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/collaborators/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collaborators"] });
      toast({
        title: "Colaborador excluído",
        description: "O colaborador foi removido com sucesso.",
      });
      setDeleteCollaborator(null);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível excluir o colaborador.",
        variant: "destructive",
      });
    },
  });

  const filteredCollaborators = allCollaborators.filter((collab) => {
    const matchesSearch = 
      collab.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      collab.position?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      collab.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      collab.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesClient = selectedClientId === "all" || collab.clientId === selectedClientId;
    
    return matchesSearch && matchesClient;
  });

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.name || "Cliente desconhecido";
  };

  const getManagerName = (managerId: string | null) => {
    if (!managerId) return null;
    const manager = allCollaborators.find(c => c.id === managerId);
    return manager?.name || null;
  };

  const handleOpenForm = (collaborator?: Collaborator) => {
    setEditingCollaborator(collaborator || null);
    setIsFormOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Colaboradores</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie os colaboradores das organizações cliente
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild data-testid="button-org-chart">
            <Link href="/organograma">
              <Network className="h-4 w-4 mr-2" />
              Organograma
            </Link>
          </Button>
          <Button onClick={() => handleOpenForm()} data-testid="button-new-collaborator">
            <Plus className="h-4 w-4 mr-2" />
            Novo Colaborador
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar colaboradores..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-collaborators"
          />
        </div>
        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-client-filter">
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

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredCollaborators.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum colaborador encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              {searchQuery || selectedClientId !== "all"
                ? "Tente ajustar sua busca ou filtros."
                : "Cadastre colaboradores para mapear a estrutura organizacional dos seus clientes."}
            </p>
            {!searchQuery && selectedClientId === "all" && (
              <Button onClick={() => handleOpenForm()}>
                <Plus className="h-4 w-4 mr-2" />
                Cadastrar Colaborador
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCollaborators.map((collaborator) => (
            <Card key={collaborator.id} className="border-card-border group">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={collaborator.photoUrl || undefined} alt={collaborator.name} />
                    <AvatarFallback className="bg-primary/10 text-primary font-medium">
                      {collaborator.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate" data-testid={`text-collaborator-name-${collaborator.id}`}>
                          {collaborator.name}
                        </h3>
                        {collaborator.position && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {collaborator.position}
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-collaborator-menu-${collaborator.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenForm(collaborator)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => setDeleteCollaborator(collaborator)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate">
                          {getClientName(collaborator.clientId)}
                        </span>
                      </div>
                      {collaborator.department && (
                        <div className="flex items-center gap-1.5">
                          <UserCircle className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground truncate">
                            {collaborator.department}
                          </span>
                        </div>
                      )}
                      {collaborator.managerId && (
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground truncate">
                            Gestor: {getManagerName(collaborator.managerId)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 space-y-1">
                      {collaborator.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{collaborator.email}</span>
                        </p>
                      )}
                      {collaborator.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{collaborator.phone}</span>
                        </p>
                      )}
                      {collaborator.mobile && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Smartphone className="h-3 w-3 shrink-0" />
                          <span>{collaborator.mobile}</span>
                        </p>
                      )}
                    </div>
                    {collaborator.isActive === 0 && (
                      <Badge variant="secondary" size="sm" className="mt-2">
                        Inativo
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CollaboratorFormDialog
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
          } else {
            createMutation.mutate(data as InsertCollaborator);
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog open={!!deleteCollaborator} onOpenChange={() => setDeleteCollaborator(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o colaborador "{deleteCollaborator?.name}"? 
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCollaborator && deleteMutation.mutate(deleteCollaborator.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface CollaboratorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaborator: Collaborator | null;
  clients: Client[];
  collaborators: Collaborator[];
  onSubmit: (data: Partial<InsertCollaborator>) => void;
  isPending: boolean;
}

function CollaboratorFormDialog({
  open,
  onOpenChange,
  collaborator,
  clients,
  collaborators,
  onSubmit,
  isPending,
}: CollaboratorFormDialogProps) {
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
        canParticipateInProjects: collaborator.canParticipateInProjects,
      });
    } else {
      setFormData({
        isActive: 1,
        canParticipateInProjects: 1,
      });
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
    
    // Clean up the data - convert empty strings to null for optional fields
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
          <DialogTitle>
            {collaborator ? "Editar Colaborador" : "Novo Colaborador"}
          </DialogTitle>
          <DialogDescription>
            {collaborator 
              ? "Atualize as informacoes do colaborador."
              : "Preencha os dados do novo colaborador."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clientId">Cliente *</Label>
            <Select 
              value={formData.clientId || ""} 
              onValueChange={(value) => setFormData({ ...formData, clientId: value, managerId: null })}
            >
              <SelectTrigger data-testid="select-collaborator-client">
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
              data-testid="input-collaborator-name"
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
                data-testid="input-collaborator-position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Departamento</Label>
              <Input
                id="department"
                value={formData.department || ""}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                placeholder="Ex: Comercial, TI"
                data-testid="input-collaborator-department"
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
              <SelectTrigger data-testid="select-collaborator-manager">
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
              data-testid="input-collaborator-email"
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
                data-testid="input-collaborator-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile">Celular</Label>
              <Input
                id="mobile"
                value={formData.mobile || ""}
                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                placeholder="(11) 91234-5678"
                data-testid="input-collaborator-mobile"
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
              data-testid="input-collaborator-photo"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observacoes</Label>
            <Textarea
              id="notes"
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas sobre o colaborador..."
              rows={3}
              data-testid="input-collaborator-notes"
            />
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="isActive">Status</Label>
              <Select 
                value={String(formData.isActive ?? 1)} 
                onValueChange={(value) => setFormData({ ...formData, isActive: Number(value) })}
              >
                <SelectTrigger className="w-32" data-testid="select-collaborator-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Ativo</SelectItem>
                  <SelectItem value="0">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox 
                id="canParticipateInProjects"
                checked={(formData.canParticipateInProjects ?? 1) === 1}
                onCheckedChange={(checked) => setFormData({ ...formData, canParticipateInProjects: checked ? 1 : 0 })}
                data-testid="checkbox-can-participate-projects"
              />
              <Label htmlFor="canParticipateInProjects" className="cursor-pointer">
                Pode participar de projetos
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={isPending || !formData.name || !formData.clientId}
              data-testid="button-save-collaborator"
            >
              {isPending ? "Salvando..." : collaborator ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
