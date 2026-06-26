import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Search, 
  UserCog,
  Shield,
  ShieldCheck,
  User as UserIcon,
  Mail,
  Calendar,
  UserPlus,
  MoreHorizontal,
  Edit,
  Power,
  KeyRound,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getRoleLabel } from "@/lib/authUtils";
import type { User } from "@shared/schema";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const createUserSchema = z.object({
  email: z.string().email("Email inválido"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(["admin", "gerente", "tecnico"]).default("tecnico"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

const editUserSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email("Email inválido"),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Senhas não coincidem",
  path: ["confirmPassword"],
});

const roleIcons = {
  admin: ShieldCheck,
  gerente: Shield,
  tecnico: UserIcon,
};

const roleBadgeVariants = {
  admin: "default" as const,
  gerente: "secondary" as const,
  tecnico: "outline" as const,
};

export default function Usuarios() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const [showNewUserPassword, setShowNewUserPassword] = useState(false);

  const form = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      role: "tecnico",
      password: "",
    },
  });

  const editForm = useForm<z.infer<typeof editUserSchema>>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
    },
  });

  const passwordForm = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await apiRequest("PATCH", `/api/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Perfil atualizado",
        description: "O perfil do usuário foi atualizado com sucesso.",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o perfil do usuário.",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createUserSchema>) => {
      await apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Membro adicionado",
        description: "O novo membro foi adicionado à equipe com sucesso.",
      });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar o membro.",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: z.infer<typeof editUserSchema> }) => {
      await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Usuário atualizado",
        description: "Os dados do usuário foram atualizados com sucesso.",
      });
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      editForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o usuário.",
        variant: "destructive",
      });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: number }) => {
      await apiRequest("PATCH", `/api/users/${userId}/status`, { isActive });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: variables.isActive ? "Usuário ativado" : "Usuário desativado",
        description: variables.isActive 
          ? "O usuário agora pode acessar o sistema." 
          : "O usuário não poderá mais acessar o sistema.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível alterar o status do usuário.",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      await apiRequest("POST", `/api/users/${userId}/reset-password`, { newPassword });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Senha redefinida",
        description: "A nova senha foi definida com sucesso.",
      });
      setIsPasswordDialogOpen(false);
      setSelectedUser(null);
      passwordForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível redefinir a senha.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof createUserSchema>) => {
    createUserMutation.mutate(data);
  };

  const onEditSubmit = (data: z.infer<typeof editUserSchema>) => {
    if (selectedUser) {
      updateUserMutation.mutate({ userId: selectedUser.id, data });
    }
  };

  const onPasswordSubmit = (data: z.infer<typeof resetPasswordSchema>) => {
    if (selectedUser) {
      resetPasswordMutation.mutate({ userId: selectedUser.id, newPassword: data.newPassword });
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    const formValues = {
      email: user.email ?? "",
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    };
    editForm.reset(formValues);
    setTimeout(() => {
      editForm.setValue("email", formValues.email);
      editForm.setValue("firstName", formValues.firstName);
      editForm.setValue("lastName", formValues.lastName);
    }, 0);
    setIsEditDialogOpen(true);
  };

  const openPasswordDialog = (user: User) => {
    setSelectedUser(user);
    passwordForm.reset({
      newPassword: "",
      confirmPassword: "",
    });
    setIsPasswordDialogOpen(true);
  };

  const filteredUsers = users.filter((user) =>
    (user.firstName?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
    (user.lastName?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
    (user.email?.toLowerCase() || "").includes(searchQuery.toLowerCase())
  );

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  };

  const isAdmin = currentUser?.role === 'admin';
  const canManageUsers = currentUser?.role === 'admin' || currentUser?.role === 'gerente';

  const stats = {
    total: users.length,
    active: users.filter(u => u.isActive === 1).length,
    inactive: users.filter(u => u.isActive !== 1).length,
    localAuth: users.filter(u => u.isLocalAuth === 1).length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Equipe</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie os membros da equipe e seus perfis de acesso
          </p>
        </div>
        {canManageUsers && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-member">
                <UserPlus className="h-4 w-4 mr-2" />
                Adicionar Membro
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Novo Membro</DialogTitle>
                <DialogDescription>
                  Cadastre um novo membro da equipe. Quando esta pessoa fizer login, ela terá o perfil atribuído.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="email@empresa.com" 
                            {...field} 
                            data-testid="input-new-user-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nome</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Nome" 
                              {...field} 
                              data-testid="input-new-user-firstname"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sobrenome</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Sobrenome" 
                              {...field} 
                              data-testid="input-new-user-lastname"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {isAdmin && (
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Perfil de Acesso</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-new-user-role">
                                <SelectValue placeholder="Selecione um perfil" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="tecnico">
                                <div className="flex items-center gap-2">
                                  <UserIcon className="h-3.5 w-3.5" />
                                  Técnico
                                </div>
                              </SelectItem>
                              <SelectItem value="gerente">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-3.5 w-3.5" />
                                  Gerente
                                </div>
                              </SelectItem>
                              <SelectItem value="admin">
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  Administrador
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <div className="border-t pt-4">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha de Acesso</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showNewUserPassword ? "text" : "password"}
                                placeholder="Mínimo 6 caracteres"
                                {...field}
                                data-testid="input-new-user-password"
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                {showNewUserPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setIsCreateDialogOpen(false)}
                      data-testid="button-cancel-add-member"
                    >
                      Cancelar
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={createUserMutation.isPending}
                      data-testid="button-submit-add-member"
                    >
                      {createUserMutation.isPending ? "Adicionando..." : "Adicionar Membro"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Usuários</CardTitle>
            <UserIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ativos</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-active">{stats.active}</div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inativos</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-inactive">{stats.inactive}</div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Login Local</CardTitle>
            <KeyRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-local">{stats.localAuth}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar usuários..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-users"
          />
        </div>
        <Badge variant="secondary" size="sm">
          {filteredUsers.length} usuário{filteredUsers.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {isLoading ? (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Usuário</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Cadastro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : filteredUsers.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <UserIcon className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum usuário encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              {searchQuery 
                ? "Tente ajustar sua busca ou limpe os filtros."
                : "Os usuários aparecerão aqui quando fizerem login no sistema."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Usuário</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead>Alterar Perfil</TableHead>}
                  <TableHead>Cadastro</TableHead>
                  {isAdmin && <TableHead className="w-[60px]">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => {
                  const RoleIcon = roleIcons[user.role as keyof typeof roleIcons] || UserIcon;
                  return (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || 'Usuário'} />
                            <AvatarFallback className="bg-primary/10 text-primary font-medium">
                              {getInitials(user.firstName, user.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium" data-testid={`text-user-name-${user.id}`}>
                              {user.firstName || 'Usuário'} {user.lastName || ''}
                              {user.id === currentUser?.id && (
                                <Badge variant="outline" size="sm" className="ml-2">Você</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span className="text-sm" data-testid={`text-user-email-${user.id}`}>
                            {user.email || 'Não informado'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={roleBadgeVariants[user.role as keyof typeof roleBadgeVariants] || 'outline'}>
                          <RoleIcon className="h-3 w-3 mr-1" />
                          {getRoleLabel(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={user.isActive === 1 ? "default" : "secondary"}
                          className={user.isActive === 1 ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" : ""}
                          data-testid={`status-user-${user.id}`}
                        >
                          {user.isActive === 1 ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Ativo
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 mr-1" />
                              Inativo
                            </>
                          )}
                        </Badge>
                        {user.isLocalAuth === 1 && (
                          <Badge variant="outline" size="sm" className="ml-1">
                            <KeyRound className="h-2.5 w-2.5 mr-1" />
                            Local
                          </Badge>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {user.id !== currentUser?.id ? (
                            <Select
                              value={user.role}
                              onValueChange={(value) => updateRoleMutation.mutate({ userId: user.id, role: value })}
                              disabled={updateRoleMutation.isPending}
                            >
                              <SelectTrigger 
                                className="w-[140px]" 
                                data-testid={`select-role-${user.id}`}
                              >
                                <SelectValue placeholder="Alterar perfil" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">
                                  <div className="flex items-center gap-2">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Administrador
                                  </div>
                                </SelectItem>
                                <SelectItem value="gerente">
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-3.5 w-3.5" />
                                    Gerente
                                  </div>
                                </SelectItem>
                                <SelectItem value="tecnico">
                                  <div className="flex items-center gap-2">
                                    <UserIcon className="h-3.5 w-3.5" />
                                    Técnico
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          <span className="text-sm">
                            {user.createdAt 
                              ? format(new Date(user.createdAt), "dd MMM yyyy", { locale: ptBR })
                              : 'N/A'
                            }
                          </span>
                        </div>
                      </TableCell>
                      {isAdmin && user.id !== currentUser?.id && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                data-testid={`button-actions-${user.id}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem 
                                onClick={() => openEditDialog(user)}
                                data-testid={`action-edit-${user.id}`}
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Editar dados
                              </DropdownMenuItem>
                              {user.isLocalAuth === 1 && (
                                <DropdownMenuItem 
                                  onClick={() => openPasswordDialog(user)}
                                  data-testid={`action-password-${user.id}`}
                                >
                                  <KeyRound className="h-4 w-4 mr-2" />
                                  Redefinir senha
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => toggleStatusMutation.mutate({ 
                                  userId: user.id, 
                                  isActive: user.isActive === 1 ? 0 : 1 
                                })}
                                data-testid={`action-toggle-${user.id}`}
                              >
                                <Power className="h-4 w-4 mr-2" />
                                {user.isActive === 1 ? 'Desativar' : 'Ativar'} usuário
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                      {isAdmin && user.id === currentUser?.id && (
                        <TableCell>
                          <span className="text-xs text-muted-foreground">-</span>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>
              Atualize os dados do usuário {selectedUser?.firstName} {selectedUser?.lastName}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={editForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Nome" 
                          {...field} 
                          data-testid="input-edit-firstName"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sobrenome</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Sobrenome" 
                          {...field} 
                          data-testid="input-edit-lastName"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="email@empresa.com" 
                        {...field} 
                        data-testid="input-edit-email"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsEditDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={updateUserMutation.isPending}
                  data-testid="button-save-edit"
                >
                  {updateUserMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para {selectedUser?.firstName} {selectedUser?.lastName}
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              <FormField
                control={passwordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova Senha</FormLabel>
                    <FormControl>
                      <Input 
                        type="password"
                        placeholder="Nova senha" 
                        {...field} 
                        data-testid="input-new-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar Senha</FormLabel>
                    <FormControl>
                      <Input 
                        type="password"
                        placeholder="Confirme a senha" 
                        {...field} 
                        data-testid="input-confirm-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsPasswordDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Redefinindo..." : "Redefinir Senha"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
