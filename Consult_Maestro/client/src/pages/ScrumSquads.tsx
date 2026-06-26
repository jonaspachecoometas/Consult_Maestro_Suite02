import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users2,
  Plus,
  Edit,
  Trash2,
  UserPlus,
  UserMinus,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Crown,
  Briefcase,
  Code,
  TestTube,
  Headphones,
  FileSearch,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ScrumTeam, ScrumTeamMember, User } from "@shared/schema";

type TeamWithRelations = ScrumTeam & {
  leader?: User;
  members?: (ScrumTeamMember & { user?: User })[];
};

const roleIcons: Record<string, { icon: React.ElementType; label: string }> = {
  developer: { icon: Code, label: "Desenvolvedor" },
  analyst: { icon: FileSearch, label: "Analista" },
  consultant: { icon: Briefcase, label: "Consultor" },
  support: { icon: Headphones, label: "Suporte" },
  tester: { icon: TestTube, label: "Testador" },
};

const teamFormSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  description: z.string().optional(),
  leaderId: z.string().optional(),
  capacity: z.coerce.number().min(0).default(40),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

const memberFormSchema = z.object({
  userId: z.string().min(1, "Selecione um membro"),
  role: z.string().default("developer"),
  costPerHour: z.coerce.number().min(0).default(0),
  weeklyCapacity: z.coerce.number().min(0).default(40),
});

type MemberFormValues = z.infer<typeof memberFormSchema>;

function TeamCard({
  team,
  users,
  onEdit,
  onDelete,
  onAddMember,
  onRemoveMember,
}: {
  team: TeamWithRelations;
  users: User[];
  onEdit: (team: ScrumTeam) => void;
  onDelete: (teamId: string) => void;
  onAddMember: (teamId: string, data: MemberFormValues) => void;
  onRemoveMember: (memberId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const { toast } = useToast();

  const memberForm = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: {
      userId: "",
      role: "developer",
      costPerHour: 0,
      weeklyCapacity: 40,
    },
  });

  const existingMemberIds = new Set(team.members?.map(m => m.userId) || []);
  const availableUsers = users.filter(u => !existingMemberIds.has(u.id) && u.status !== "inactive");

  const totalCostPerHour = (team.members || []).reduce(
    (sum, m) => sum + (m.costPerHour || 0),
    0
  );
  const totalWeeklyCapacity = (team.members || []).reduce(
    (sum, m) => sum + (m.weeklyCapacity || 0),
    0
  );

  const handleAddMember = (data: MemberFormValues) => {
    onAddMember(team.id, data);
    memberForm.reset();
    setAddMemberOpen(false);
  };

  return (
    <Card className="border-card-border" data-testid={`card-team-${team.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-lg">{team.name}</CardTitle>
              {team.isActive ? (
                <Badge variant="outline" size="sm">Ativo</Badge>
              ) : (
                <Badge variant="secondary" size="sm">Inativo</Badge>
              )}
            </div>
            {team.description && (
              <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                {team.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(team)}
              data-testid={`button-edit-team-${team.id}`}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid={`button-delete-team-${team.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir equipe?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acao nao pode ser desfeita. Todos os membros serao removidos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(team.id)}>
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
              <Users2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Membros</p>
              <p className="font-medium text-sm">{team.members?.length || 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Capacidade</p>
              <p className="font-medium text-sm">{totalWeeklyCapacity}h/sem</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custo/h</p>
              <p className="font-medium text-sm">
                R$ {(totalCostPerHour / 100).toFixed(2)}
              </p>
            </div>
          </div>
          {team.leader && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                <Crown className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Lider</p>
                <p className="font-medium text-sm truncate max-w-[100px]">
                  {team.leader.firstName || team.leader.email?.split("@")[0]}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-expand-team-${team.id}`}
          >
            <span>Membros da equipe</span>
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>

          {expanded && (
            <div className="mt-3 space-y-2">
              {(team.members || []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum membro na equipe
                </p>
              ) : (
                (team.members || []).map((member) => {
                  const roleInfo = roleIcons[member.role || "developer"] || roleIcons.developer;
                  const RoleIcon = roleInfo.icon;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/50"
                      data-testid={`row-member-${member.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={member.user?.profileImageUrl || undefined} />
                          <AvatarFallback>
                            {(member.user?.firstName?.[0] || member.user?.email?.[0] || "?").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {member.user?.firstName
                              ? `${member.user.firstName} ${member.user.lastName || ""}`
                              : member.user?.email?.split("@")[0]}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <RoleIcon className="h-3 w-3" />
                            <span>{roleInfo.label}</span>
                            <span>|</span>
                            <span>{member.weeklyCapacity}h/sem</span>
                            <span>|</span>
                            <span>R$ {((member.costPerHour || 0) / 100).toFixed(2)}/h</span>
                          </div>
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-remove-member-${member.id}`}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O membro sera removido da equipe.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onRemoveMember(member.id)}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })
              )}

              <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    data-testid={`button-add-member-${team.id}`}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Adicionar membro
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar membro</DialogTitle>
                    <DialogDescription>
                      Adicione um membro a equipe {team.name}.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...memberForm}>
                    <form
                      onSubmit={memberForm.handleSubmit(handleAddMember)}
                      className="space-y-4"
                    >
                      <FormField
                        control={memberForm.control}
                        name="userId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Usuario</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-member-user">
                                  <SelectValue placeholder="Selecione um usuario" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {availableUsers.length === 0 ? (
                                  <SelectItem value="none" disabled>
                                    Nenhum usuario disponivel
                                  </SelectItem>
                                ) : (
                                  availableUsers.map((user) => (
                                    <SelectItem key={user.id} value={user.id}>
                                      {user.firstName
                                        ? `${user.firstName} ${user.lastName || ""}`
                                        : user.email}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={memberForm.control}
                        name="role"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Funcao</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-member-role">
                                  <SelectValue placeholder="Selecione a funcao" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="developer">Desenvolvedor</SelectItem>
                                <SelectItem value="analyst">Analista</SelectItem>
                                <SelectItem value="consultant">Consultor</SelectItem>
                                <SelectItem value="support">Suporte</SelectItem>
                                <SelectItem value="tester">Testador</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={memberForm.control}
                          name="weeklyCapacity"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Capacidade (h/sem)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  {...field}
                                  data-testid="input-member-capacity"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={memberForm.control}
                          name="costPerHour"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Custo/hora (centavos)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  {...field}
                                  data-testid="input-member-cost"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <DialogFooter>
                        <Button type="submit" data-testid="button-submit-add-member">
                          Adicionar
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScrumSquads() {
  const { toast } = useToast();
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<ScrumTeam | null>(null);

  const { data: teams = [], isLoading: teamsLoading } = useQuery<TeamWithRelations[]>({
    queryKey: ["/api/scrum/teams"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const teamForm = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: "",
      description: "",
      leaderId: "",
      capacity: 40,
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: async (data: TeamFormValues) => {
      const payload = {
        ...data,
        leaderId: data.leaderId && data.leaderId !== "none" ? data.leaderId : null,
      };
      return apiRequest("POST", "/api/scrum/teams", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/teams"] });
      setTeamDialogOpen(false);
      teamForm.reset();
      toast({ title: "Equipe criada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar equipe", variant: "destructive" });
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TeamFormValues }) => {
      const payload = {
        ...data,
        leaderId: data.leaderId && data.leaderId !== "none" ? data.leaderId : null,
      };
      return apiRequest("PATCH", `/api/scrum/teams/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/teams"] });
      setTeamDialogOpen(false);
      setEditingTeam(null);
      teamForm.reset();
      toast({ title: "Equipe atualizada com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar equipe", variant: "destructive" });
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: async (teamId: string) => {
      return apiRequest("DELETE", `/api/scrum/teams/${teamId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/teams"] });
      toast({ title: "Equipe excluida com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir equipe", variant: "destructive" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ teamId, data }: { teamId: string; data: MemberFormValues }) => {
      return apiRequest("POST", `/api/scrum/teams/${teamId}/members`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/teams"] });
      toast({ title: "Membro adicionado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao adicionar membro", variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return apiRequest("DELETE", `/api/scrum/team-members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/teams"] });
      toast({ title: "Membro removido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover membro", variant: "destructive" });
    },
  });

  const handleEditTeam = (team: ScrumTeam) => {
    setEditingTeam(team);
    teamForm.reset({
      name: team.name,
      description: team.description || "",
      leaderId: team.leaderId || "",
      capacity: team.capacity || 40,
    });
    setTeamDialogOpen(true);
  };

  const handleSubmitTeam = (data: TeamFormValues) => {
    if (editingTeam) {
      updateTeamMutation.mutate({ id: editingTeam.id, data });
    } else {
      createTeamMutation.mutate(data);
    }
  };

  const handleDeleteTeam = (teamId: string) => {
    deleteTeamMutation.mutate(teamId);
  };

  const handleAddMember = (teamId: string, data: MemberFormValues) => {
    addMemberMutation.mutate({ teamId, data });
  };

  const handleRemoveMember = (memberId: string) => {
    removeMemberMutation.mutate(memberId);
  };

  const handleDialogClose = () => {
    setTeamDialogOpen(false);
    setEditingTeam(null);
    teamForm.reset();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-squads-title">
            Squads
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie as equipes e alocacao de membros.
          </p>
        </div>
        <Dialog open={teamDialogOpen} onOpenChange={(open) => {
          if (!open) handleDialogClose();
          else setTeamDialogOpen(true);
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-team">
              <Plus className="h-4 w-4 mr-2" />
              Nova Equipe
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTeam ? "Editar equipe" : "Nova equipe"}</DialogTitle>
              <DialogDescription>
                {editingTeam
                  ? "Atualize as informacoes da equipe."
                  : "Crie uma nova equipe para gerenciar os projetos."}
              </DialogDescription>
            </DialogHeader>
            <Form {...teamForm}>
              <form
                onSubmit={teamForm.handleSubmit(handleSubmitTeam)}
                className="space-y-4"
              >
                <FormField
                  control={teamForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-team-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={teamForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descricao</FormLabel>
                      <FormControl>
                        <Textarea {...field} data-testid="input-team-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={teamForm.control}
                  name="leaderId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lider</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-team-leader">
                            <SelectValue placeholder="Selecione o lider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName
                                ? `${user.firstName} ${user.lastName || ""}`
                                : user.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={teamForm.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacidade semanal (horas)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          data-testid="input-team-capacity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createTeamMutation.isPending || updateTeamMutation.isPending}
                    data-testid="button-submit-team"
                  >
                    {editingTeam ? "Salvar" : "Criar"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {teamsLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[300px]" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhuma equipe cadastrada</p>
            <p className="text-sm text-muted-foreground mt-1">
              Clique em "Nova Equipe" para comecar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              users={users}
              onEdit={handleEditTeam}
              onDelete={handleDeleteTeam}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
            />
          ))}
        </div>
      )}
    </div>
  );
}
