import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { Users, UserPlus, MoreHorizontal, Eye, EyeOff, KeyRound, Pencil, Trash2, Search, ShieldCheck } from "lucide-react";
import { getRoleLabel } from "@/lib/authUtils";

const createUserSchema = z.object({
  firstName: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  lastName: z.string().optional(),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  role: z.enum(["admin", "gerente", "tecnico"]).default("tecnico"),
  subTenantId: z.string().optional(),
});

const editUserSchema = z.object({
  role: z.enum(["admin", "gerente", "tecnico"]),
  subTenantId: z.string().optional(),
  isActive: z.number(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  confirm: z.string().min(6, "Confirmação é obrigatória"),
}).refine(d => d.password === d.confirm, {
  message: "As senhas não coincidem",
  path: ["confirm"],
});

type CreateUserForm = z.infer<typeof createUserSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  gerente: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  tecnico: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function TenantTeam() {
  const { isTenantAdmin, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const hasAccess = isTenantAdmin || isSuperadmin;

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any>(null);

  const { data: myTenantData } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: hasAccess,
  });

  const tenantId = myTenantData?.tenant?.id;

  const { data: tenantUsers, isLoading } = useQuery<(any & { user?: any })[]>({
    queryKey: [`/api/tenants/${tenantId}/users`],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/${tenantId}/users`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!tenantId,
  });

  const { data: subTenants } = useQuery<any[]>({
    queryKey: [`/api/tenants/${tenantId}/sub-tenants`],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/${tenantId}/sub-tenants`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!tenantId,
  });

  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "", role: "tecnico", subTenantId: "" },
  });

  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { role: "tecnico", subTenantId: "", isActive: 1 },
  });

  const resetForm = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateUserForm) => {
      const payload = { ...data, subTenantId: data.subTenantId || null };
      const res = await apiRequest("POST", `/api/tenants/${tenantId}/members`, payload);
      if (!res.ok) throw new Error("Erro ao criar usuário");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/users`] });
      toast({ title: "Usuário criado com sucesso!" });
      createForm.reset();
      setIsCreateOpen(false);
    },
    onError: (e: any) => {
      toast({ title: "Erro ao criar usuário", description: e.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (data: EditUserForm) => {
      const payload = { ...data, subTenantId: data.subTenantId || null };
      const res = await apiRequest("PATCH", `/api/tenant-users/${editTarget.id}`, payload);
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/users`] });
      toast({ title: "Usuário atualizado!" });
      setEditTarget(null);
    },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ResetPasswordForm) => {
      const res = await apiRequest("POST", `/api/tenant-users/${resetTarget.id}/reset-password`, { password: data.password });
      if (!res.ok) throw new Error("Erro");
    },
    onSuccess: () => {
      toast({ title: "Senha redefinida com sucesso!" });
      resetForm.reset();
      setResetTarget(null);
    },
    onError: () => toast({ title: "Erro ao redefinir senha", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: number }) =>
      apiRequest("PATCH", `/api/tenant-users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/users`] });
    },
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tenant-users/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/users`] });
      toast({ title: "Usuário removido!" });
      setRemoveTarget(null);
    },
    onError: () => toast({ title: "Erro ao remover usuário", variant: "destructive" }),
  });

  const openEdit = (tu: any) => {
    setEditTarget(tu);
    editForm.reset({
      role: tu.role,
      subTenantId: tu.subTenantId || "",
      isActive: tu.isActive ?? 1,
    });
  };

  const getInitials = (firstName?: string, lastName?: string) =>
    ((firstName?.charAt(0) || "") + (lastName?.charAt(0) || "")).toUpperCase() || "U";

  const getSubTenantName = (id?: string) =>
    subTenants?.find((s) => s.id === id)?.name || null;

  const filtered = (tenantUsers || []).filter((tu) => {
    const name = `${tu.user?.firstName || ""} ${tu.user?.lastName || ""} ${tu.user?.email || ""}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || tu.role === roleFilter;
    return matchSearch && matchRole;
  });

  if (!hasAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Acesso restrito a Administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-heading" data-testid="text-users-title">Usuários</h1>
            <p className="text-muted-foreground text-sm">Gerencie os usuários e permissões do seu tenant</p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-add-user">
          <UserPlus className="h-4 w-4 mr-2" /> Adicionar Usuário
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-users"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40" data-testid="select-filter-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os perfis</SelectItem>
            <SelectItem value="admin">Administrador</SelectItem>
            <SelectItem value="gerente">Gerente</SelectItem>
            <SelectItem value="tecnico">Técnico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "usuário" : "usuários"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                {search || roleFilter !== "all" ? "Nenhum usuário encontrado com esse filtro" : "Nenhum usuário cadastrado ainda"}
              </p>
              {!search && roleFilter === "all" && (
                <Button className="mt-3" size="sm" onClick={() => setIsCreateOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-1" /> Adicionar Primeiro Usuário
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y" data-testid="list-users">
              {filtered.map((tu) => {
                const filialName = getSubTenantName(tu.subTenantId);
                return (
                  <div key={tu.id} className="flex items-center gap-4 px-4 py-3" data-testid={`row-user-${tu.id}`}>
                    <Avatar className="h-9 w-9 flex-shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {getInitials(tu.user?.firstName, tu.user?.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {[tu.user?.firstName, tu.user?.lastName].filter(Boolean).join(" ") || tu.user?.email}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{tu.user?.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[tu.role]}`}>
                        {getRoleLabel(tu.role)}
                      </span>
                      {filialName && (
                        <Badge variant="outline" className="text-xs">
                          {filialName}
                        </Badge>
                      )}
                      <Badge variant={tu.isActive ? "default" : "secondary"} className="text-xs">
                        {tu.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-user-menu-${tu.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(tu)} data-testid={`action-edit-${tu.id}`}>
                          <Pencil className="h-4 w-4 mr-2" /> Editar permissões
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setResetTarget(tu); resetForm.reset(); }} data-testid={`action-reset-${tu.id}`}>
                          <KeyRound className="h-4 w-4 mr-2" /> Redefinir senha
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: tu.id, isActive: tu.isActive ? 0 : 1 })}>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          {tu.isActive ? "Desativar acesso" : "Ativar acesso"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setRemoveTarget(tu)}
                          data-testid={`action-remove-${tu.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Remover do tenant
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── CREATE USER DIALOG ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Usuário</DialogTitle>
            <DialogDescription>Crie um novo usuário com acesso direto ao sistema.</DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
                    <FormControl>
                      <Input placeholder="João" {...field} data-testid="input-create-firstname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sobrenome</FormLabel>
                    <FormControl>
                      <Input placeholder="Silva" {...field} data-testid="input-create-lastname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={createForm.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email *</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="usuario@empresa.com" {...field} data-testid="input-create-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={createForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha *</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={showPassword ? "text" : "password"} placeholder="Mínimo 6 caracteres" {...field} data-testid="input-create-password" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-create-role">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="gerente">Gerente</SelectItem>
                        <SelectItem value="tecnico">Técnico</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {subTenants && subTenants.length > 0 && (
                  <FormField control={createForm.control} name="subTenantId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Filial</FormLabel>
                      <Select onValueChange={(v) => field.onChange(v === "_all" ? "" : v)} value={field.value || "_all"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-create-filial">
                            <SelectValue placeholder="Todas" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="_all">Todas as filiais</SelectItem>
                          {subTenants.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => { setIsCreateOpen(false); createForm.reset(); }}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-create-user">
                  {createMutation.isPending ? "Criando..." : "Criar Usuário"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── EDIT USER DIALOG ── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Permissões</DialogTitle>
            <DialogDescription>
              {editTarget?.user?.firstName} {editTarget?.user?.lastName || ""} — {editTarget?.user?.email}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => editMutation.mutate(d))} className="space-y-4">
              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Perfil</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-role">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="gerente">Gerente</SelectItem>
                      <SelectItem value="tecnico">Técnico</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {subTenants && subTenants.length > 0 && (
                <FormField control={editForm.control} name="subTenantId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Filial</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v === "_all" ? "" : v)} value={field.value || "_all"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-filial">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="_all">Todas as filiais</SelectItem>
                        {subTenants.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <FormField control={editForm.control} name="isActive" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">Ativo</SelectItem>
                      <SelectItem value="0">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
                <Button type="submit" disabled={editMutation.isPending} data-testid="button-submit-edit">
                  {editMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── RESET PASSWORD DIALOG ── */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Redefinir Senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha para {resetTarget?.user?.firstName || resetTarget?.user?.email}.
            </DialogDescription>
          </DialogHeader>
          <Form {...resetForm}>
            <form onSubmit={resetForm.handleSubmit((d) => resetPasswordMutation.mutate(d))} className="space-y-4">
              <FormField control={resetForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova Senha</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={showNewPassword ? "text" : "password"} placeholder="Mínimo 6 caracteres" {...field} data-testid="input-new-password" />
                      <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={resetForm.control} name="confirm" render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar Senha</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={showConfirmPassword ? "text" : "password"} placeholder="Repita a senha" {...field} data-testid="input-confirm-password" />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancelar</Button>
                <Button type="submit" disabled={resetPasswordMutation.isPending} data-testid="button-submit-reset-password">
                  {resetPasswordMutation.isPending ? "Salvando..." : "Redefinir Senha"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── REMOVE CONFIRMATION DIALOG ── */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover Usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{removeTarget?.user?.firstName || removeTarget?.user?.email}</strong> do tenant? O usuário perderá o acesso imediatamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate(removeTarget.id)}
              disabled={removeMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removendo..." : "Remover"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
