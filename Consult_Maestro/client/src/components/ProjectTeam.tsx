import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserPlus, Trash2, Users, Building2, Edit2, PlusCircle, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getRoleLabel } from "@/lib/authUtils";
import type { User, ProjectMember, Collaborator, ProjectCollaborator } from "@shared/schema";

interface ProjectTeamProps {
  projectId: string;
}

interface ProjectMemberWithUser extends ProjectMember {
  user: User;
}

interface ProjectCollaboratorWithData extends ProjectCollaborator {
  collaborator?: Collaborator;
}

export function ProjectTeam({ projectId }: ProjectTeamProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddCollaboratorDialogOpen, setIsAddCollaboratorDialogOpen] = useState(false);
  const [collaboratorDialogMode, setCollaboratorDialogMode] = useState<"link" | "create">("link");
  const [isEditPermissionDialogOpen, setIsEditPermissionDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("membro");
  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState<string>("");
  const [selectedPermission, setSelectedPermission] = useState<string>("view");
  const [editingCollaborator, setEditingCollaborator] = useState<ProjectCollaboratorWithData | null>(null);
  const [newCollabForm, setNewCollabForm] = useState({ name: "", position: "", department: "", email: "", phone: "" });
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data: members = [], isLoading: membersLoading } = useQuery<ProjectMemberWithUser[]>({
    queryKey: ["/api/projects", projectId, "members"],
    enabled: !!projectId,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: projectCollaborators = [], isLoading: collaboratorsLoading } = useQuery<ProjectCollaboratorWithData[]>({
    queryKey: ["/api/projects", projectId, "collaborators"],
    enabled: !!projectId,
  });

  const { data: availableCollaborators = [] } = useQuery<Collaborator[]>({
    queryKey: ["/api/projects", projectId, "available-collaborators"],
    enabled: !!projectId,
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await apiRequest("POST", `/api/projects/${projectId}/members`, { userId, role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "members"] });
      toast({
        title: "Membro adicionado",
        description: "O membro foi adicionado ao projeto com sucesso.",
      });
      setIsAddDialogOpen(false);
      setSelectedUserId("");
      setSelectedRole("membro");
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar o membro.",
        variant: "destructive",
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/members/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "members"] });
      toast({
        title: "Membro removido",
        description: "O membro foi removido do projeto.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível remover o membro.",
        variant: "destructive",
      });
    },
  });

  const addCollaboratorMutation = useMutation({
    mutationFn: async ({ collaboratorId, permission }: { collaboratorId: string; permission: string }) => {
      await apiRequest("POST", `/api/projects/${projectId}/collaborators`, { collaboratorId, permission });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "available-collaborators"] });
      toast({ title: "Colaborador vinculado", description: "O colaborador foi adicionado ao projeto com sucesso." });
      setIsAddCollaboratorDialogOpen(false);
      setSelectedCollaboratorId("");
      setSelectedPermission("view");
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message || "Não foi possível adicionar o colaborador.", variant: "destructive" });
    },
  });

  const createAndAddCollaboratorMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/collaborators/create-and-add`, {
        ...newCollabForm,
        permission: selectedPermission,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "available-collaborators"] });
      toast({ title: "Colaborador cadastrado", description: "O colaborador foi criado e adicionado ao projeto." });
      setIsAddCollaboratorDialogOpen(false);
      setNewCollabForm({ name: "", position: "", department: "", email: "", phone: "" });
      setSelectedPermission("view");
      setCollaboratorDialogMode("link");
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message || "Não foi possível cadastrar o colaborador.", variant: "destructive" });
    },
  });

  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaboratorId, permission }: { collaboratorId: string; permission: string }) => {
      await apiRequest("PATCH", `/api/projects/${projectId}/collaborators/${collaboratorId}`, { permission });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "collaborators"] });
      toast({
        title: "Permissão atualizada",
        description: "A permissão do colaborador foi atualizada com sucesso.",
      });
      setIsEditPermissionDialogOpen(false);
      setEditingCollaborator(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar a permissão.",
        variant: "destructive",
      });
    },
  });

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaboratorId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/collaborators/${collaboratorId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "collaborators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "available-collaborators"] });
      toast({
        title: "Colaborador removido",
        description: "O colaborador foi removido do projeto.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível remover o colaborador.",
        variant: "destructive",
      });
    },
  });

  const handleAddMember = () => {
    if (!selectedUserId) return;
    addMemberMutation.mutate({ userId: selectedUserId, role: selectedRole });
  };

  const handleAddCollaborator = () => {
    if (!selectedCollaboratorId) return;
    addCollaboratorMutation.mutate({ collaboratorId: selectedCollaboratorId, permission: selectedPermission });
  };

  const handleEditPermission = () => {
    if (!editingCollaborator) return;
    updatePermissionMutation.mutate({ 
      collaboratorId: editingCollaborator.collaboratorId, 
      permission: selectedPermission 
    });
  };

  const openEditPermissionDialog = (pc: ProjectCollaboratorWithData) => {
    setEditingCollaborator(pc);
    setSelectedPermission(pc.permission || 'view');
    setIsEditPermissionDialogOpen(true);
  };

  const getInitials = (firstName?: string | null, lastName?: string | null, name?: string | null) => {
    if (name) {
      const parts = name.split(' ');
      const first = parts[0]?.charAt(0) || '';
      const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) || '' : '';
      return (first + last).toUpperCase() || 'C';
    }
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  };

  const canManageTeam = 
    currentUser?.systemRole === 'superadmin' ||
    currentUser?.systemRole === 'tenant_admin' ||
    currentUser?.systemRole === 'partner' ||
    currentUser?.role === 'admin' || 
    currentUser?.role === 'gerente';
  
  const memberUserIds = members.map(m => m.userId);
  const availableUsers = users.filter(u => !memberUserIds.includes(u.id));

  const permissionLabels: Record<string, string> = {
    view: "Visualizar",
    edit: "Editar",
  };

  if (membersLoading || collaboratorsLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="members" className="w-full">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="members" data-testid="tab-members">
              <Users className="h-4 w-4 mr-2" />
              Equipe ({members.length})
            </TabsTrigger>
            <TabsTrigger value="collaborators" data-testid="tab-collaborators">
              <Building2 className="h-4 w-4 mr-2" />
              Colaboradores ({projectCollaborators.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="members" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Equipe do Projeto</h3>
              <p className="text-sm text-muted-foreground">
                {members.length} membro{members.length !== 1 ? 's' : ''} atribuído{members.length !== 1 ? 's' : ''}
              </p>
            </div>
            {canManageTeam && (
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-team-member">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Adicionar Membro
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Membro ao Projeto</DialogTitle>
                    <DialogDescription>
                      Selecione um membro da equipe para adicionar a este projeto.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Membro</Label>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger data-testid="select-team-member">
                          <SelectValue placeholder="Selecione um membro" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableUsers.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground text-center">
                              Todos os membros já estão no projeto
                            </div>
                          ) : (
                            availableUsers.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5">
                                    <AvatarImage src={user.profileImageUrl || undefined} />
                                    <AvatarFallback className="text-[10px]">
                                      {getInitials(user.firstName, user.lastName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span>{user.firstName || 'Usuário'} {user.lastName || ''}</span>
                                  <Badge variant="outline" size="sm" className="ml-auto">
                                    {getRoleLabel(user.role)}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Função no Projeto</Label>
                      <Select value={selectedRole} onValueChange={setSelectedRole}>
                        <SelectTrigger data-testid="select-team-role">
                          <SelectValue placeholder="Selecione a função" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lider">Líder</SelectItem>
                          <SelectItem value="consultor">Consultor</SelectItem>
                          <SelectItem value="membro">Membro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button 
                      variant="outline" 
                      onClick={() => setIsAddDialogOpen(false)}
                      data-testid="button-cancel-add-team-member"
                    >
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleAddMember}
                      disabled={!selectedUserId || addMemberMutation.isPending}
                      data-testid="button-confirm-add-team-member"
                    >
                      {addMemberMutation.isPending ? "Adicionando..." : "Adicionar"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {members.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Nenhum Membro</h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  Este projeto ainda não possui membros atribuídos.
                  {canManageTeam && " Clique em Adicionar Membro para começar."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {members.map((member) => {
                const roleLabels: Record<string, string> = {
                  lider: "Líder",
                  consultor: "Consultor",
                  membro: "Membro",
                };
                return (
                  <Card key={member.id} className="border-card-border" data-testid={`card-team-member-${member.userId}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={member.user?.profileImageUrl || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary font-medium">
                              {getInitials(member.user?.firstName, member.user?.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-sm" data-testid={`text-member-name-${member.userId}`}>
                              {member.user?.firstName || 'Usuário'} {member.user?.lastName || ''}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant="secondary" size="sm">
                                {roleLabels[member.role || 'membro'] || member.role}
                              </Badge>
                              <Badge variant="outline" size="sm">
                                {getRoleLabel(member.user?.role)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        {canManageTeam && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMemberMutation.mutate(member.userId)}
                            disabled={removeMemberMutation.isPending}
                            className="visibility-visible"
                            data-testid={`button-remove-member-${member.userId}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="collaborators" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Colaboradores do Cliente</h3>
              <p className="text-sm text-muted-foreground">
                {projectCollaborators.length} colaborador{projectCollaborators.length !== 1 ? 'es' : ''} no projeto
              </p>
            </div>
            {canManageTeam && (
              <Dialog open={isAddCollaboratorDialogOpen} onOpenChange={(open) => {
                setIsAddCollaboratorDialogOpen(open);
                if (!open) { setCollaboratorDialogMode("link"); setNewCollabForm({ name: "", position: "", department: "", email: "", phone: "" }); }
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-collaborator">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Colaborador
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Colaboradores do Projeto</DialogTitle>
                    <DialogDescription>
                      Vincule um colaborador já cadastrado ou cadastre um novo.
                    </DialogDescription>
                  </DialogHeader>

                  {/* Mode toggle */}
                  <div className="flex gap-2 border rounded-lg p-1 bg-muted/40">
                    <button
                      onClick={() => setCollaboratorDialogMode("link")}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${collaboratorDialogMode === "link" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="toggle-link-collaborator"
                    >
                      <Link className="h-4 w-4" />
                      Vincular Existente
                    </button>
                    <button
                      onClick={() => setCollaboratorDialogMode("create")}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${collaboratorDialogMode === "create" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid="toggle-create-collaborator"
                    >
                      <PlusCircle className="h-4 w-4" />
                      Cadastrar Novo
                    </button>
                  </div>

                  {collaboratorDialogMode === "link" ? (
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label>Colaborador</Label>
                        <Select value={selectedCollaboratorId} onValueChange={setSelectedCollaboratorId}>
                          <SelectTrigger data-testid="select-collaborator">
                            <SelectValue placeholder="Selecione um colaborador" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableCollaborators.length === 0 ? (
                              <div className="p-2 text-sm text-muted-foreground text-center">
                                Nenhum colaborador disponível — todos já estão no projeto ou nenhum foi cadastrado.
                              </div>
                            ) : (
                              availableCollaborators.map((collab) => (
                                <SelectItem key={collab.id} value={collab.id}>
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={collab.photoUrl || undefined} />
                                      <AvatarFallback className="text-[10px]">{getInitials(null, null, collab.name)}</AvatarFallback>
                                    </Avatar>
                                    <span>{collab.name}</span>
                                    {collab.position && <span className="text-muted-foreground text-xs">· {collab.position}</span>}
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nível de Permissão</Label>
                        <Select value={selectedPermission} onValueChange={setSelectedPermission}>
                          <SelectTrigger data-testid="select-permission">
                            <SelectValue placeholder="Selecione a permissão" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view">Visualizar</SelectItem>
                            <SelectItem value="edit">Editar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setIsAddCollaboratorDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleAddCollaborator} disabled={!selectedCollaboratorId || addCollaboratorMutation.isPending} data-testid="button-confirm-add-collaborator">
                          {addCollaboratorMutation.isPending ? "Vinculando..." : "Vincular"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 py-2">
                      <div className="space-y-2">
                        <Label>Nome <span className="text-destructive">*</span></Label>
                        <Input value={newCollabForm.name} onChange={e => setNewCollabForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome completo" data-testid="input-new-collab-name" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Cargo</Label>
                          <Input value={newCollabForm.position} onChange={e => setNewCollabForm(f => ({ ...f, position: e.target.value }))} placeholder="Ex: Gerente" data-testid="input-new-collab-position" />
                        </div>
                        <div className="space-y-2">
                          <Label>Departamento</Label>
                          <Input value={newCollabForm.department} onChange={e => setNewCollabForm(f => ({ ...f, department: e.target.value }))} placeholder="Ex: Financeiro" data-testid="input-new-collab-department" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>E-mail</Label>
                          <Input type="email" value={newCollabForm.email} onChange={e => setNewCollabForm(f => ({ ...f, email: e.target.value }))} placeholder="email@empresa.com" data-testid="input-new-collab-email" />
                        </div>
                        <div className="space-y-2">
                          <Label>Telefone</Label>
                          <Input value={newCollabForm.phone} onChange={e => setNewCollabForm(f => ({ ...f, phone: e.target.value }))} placeholder="(00) 00000-0000" data-testid="input-new-collab-phone" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Nível de Permissão</Label>
                        <Select value={selectedPermission} onValueChange={setSelectedPermission}>
                          <SelectTrigger data-testid="select-permission-new">
                            <SelectValue placeholder="Selecione a permissão" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view">Visualizar</SelectItem>
                            <SelectItem value="edit">Editar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setIsAddCollaboratorDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={() => createAndAddCollaboratorMutation.mutate()} disabled={!newCollabForm.name.trim() || createAndAddCollaboratorMutation.isPending} data-testid="button-confirm-create-collaborator">
                          {createAndAddCollaboratorMutation.isPending ? "Cadastrando..." : "Cadastrar e Adicionar"}
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>

          {projectCollaborators.length === 0 ? (
            <Card className="border-card-border">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Nenhum Colaborador</h3>
                <p className="text-muted-foreground text-center max-w-sm mb-4">
                  Este projeto ainda não possui colaboradores do cliente.
                  {canManageTeam && " Clique em Adicionar Colaborador para começar."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {projectCollaborators.map((pc) => (
                <Card key={pc.id} className="border-card-border" data-testid={`card-collaborator-${pc.collaboratorId}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={pc.collaborator?.photoUrl || undefined} />
                          <AvatarFallback className="bg-accent text-accent-foreground font-medium">
                            {getInitials(null, null, pc.collaborator?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-collaborator-name-${pc.collaboratorId}`}>
                            {pc.collaborator?.name || 'Colaborador'}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge 
                              variant={pc.permission === 'edit' ? 'default' : 'secondary'} 
                              size="sm"
                            >
                              {permissionLabels[pc.permission || 'view']}
                            </Badge>
                            {pc.collaborator?.position && (
                              <Badge variant="outline" size="sm">
                                {pc.collaborator.position}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {canManageTeam && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditPermissionDialog(pc)}
                            data-testid={`button-edit-permission-${pc.collaboratorId}`}
                          >
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCollaboratorMutation.mutate(pc.collaboratorId)}
                            disabled={removeCollaboratorMutation.isPending}
                            data-testid={`button-remove-collaborator-${pc.collaboratorId}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isEditPermissionDialogOpen} onOpenChange={setIsEditPermissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Permissão</DialogTitle>
            <DialogDescription>
              Altere o nível de permissão do colaborador {editingCollaborator?.collaborator?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nível de Permissão</Label>
              <Select value={selectedPermission} onValueChange={setSelectedPermission}>
                <SelectTrigger data-testid="select-edit-permission">
                  <SelectValue placeholder="Selecione a permissão" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">Visualizar</SelectItem>
                  <SelectItem value="edit">Editar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              variant="outline" 
              onClick={() => setIsEditPermissionDialogOpen(false)}
              data-testid="button-cancel-edit-permission"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleEditPermission}
              disabled={updatePermissionMutation.isPending}
              data-testid="button-confirm-edit-permission"
            >
              {updatePermissionMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
