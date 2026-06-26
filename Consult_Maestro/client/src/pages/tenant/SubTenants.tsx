import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { Building2, Plus, Network, Users, UserCheck, UserX } from "lucide-react";
import { getStatusLabel, getPlanLabel, getRoleLabel } from "@/lib/authUtils";
import type { Tenant } from "@shared/schema";

const subTenantSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  sector: z.string().optional(),
  adminEmail: z.string().email("Email inválido").optional().or(z.literal("")),
});

type SubTenantForm = z.infer<typeof subTenantSchema>;

export default function TenantSubTenants() {
  const { isTenantAdmin, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [managingFilial, setManagingFilial] = useState<any | null>(null);
  const hasAccess = isTenantAdmin || isSuperadmin;

  const { data: myTenantData, isLoading: tenantLoading } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: hasAccess,
  });

  const tenantId = myTenantData?.tenant?.id;
  const subTenants = myTenantData?.subTenants || [];

  const { data: teamData } = useQuery<any[]>({
    queryKey: [`/api/tenants/${tenantId}/users`],
    enabled: !!tenantId,
  });

  const form = useForm<SubTenantForm>({
    resolver: zodResolver(subTenantSchema),
    defaultValues: { name: "", sector: "", adminEmail: "" },
  });

  const createSubTenantMutation = useMutation({
    mutationFn: async (data: SubTenantForm) => {
      const res = await apiRequest("POST", "/api/tenants", {
        ...data,
        adminEmail: data.adminEmail || undefined,
        parentTenantId: tenantId,
        status: "trial",
        plan: "free",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-tenant"] });
      toast({ title: "Filial criada com sucesso!" });
      form.reset();
      setIsOpen(false);
    },
    onError: () => {
      toast({ title: "Erro ao criar filial", variant: "destructive" });
    },
  });

  const assignUserMutation = useMutation({
    mutationFn: async ({ tuId, subTenantId }: { tuId: string; subTenantId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/tenant-users/${tuId}`, { subTenantId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/users`] });
      toast({ title: "Usuário atualizado com sucesso!" });
    },
    onError: () => toast({ title: "Erro ao atualizar usuário", variant: "destructive" }),
  });

  const getInitials = (u: any) => {
    const f = u?.firstName?.charAt(0) || '';
    const l = u?.lastName?.charAt(0) || '';
    return (f + l).toUpperCase() || 'U';
  };

  if (!hasAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Acesso restrito a Administradores de Tenant.</p>
      </div>
    );
  }

  const filialUsers = (filialId: string) =>
    (teamData || []).filter((tu: any) => tu.subTenantId === filialId || tu.sub_tenant_id === filialId);
  const unassignedUsers = (teamData || []).filter((tu: any) => !tu.subTenantId && !tu.sub_tenant_id);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-heading" data-testid="text-subtenants-title">Empresas do Grupo</h1>
            <p className="text-muted-foreground">Gerencie filiais e sub-tenants</p>
          </div>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-subtenant">
              <Plus className="h-4 w-4 mr-2" /> Nova Filial
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Nova Filial</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createSubTenantMutation.mutate(data))} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da Filial</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Filial São Paulo" {...field} data-testid="input-subtenant-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="sector" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Setor (opcional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-subtenant-sector">
                          <SelectValue placeholder="Selecione o setor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="technology">Tecnologia</SelectItem>
                        <SelectItem value="retail">Varejo</SelectItem>
                        <SelectItem value="manufacturing">Manufatura</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="adminEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email do Admin (opcional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="admin@filial.com" {...field} data-testid="input-subtenant-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createSubTenantMutation.isPending} data-testid="button-submit-subtenant">
                    {createSubTenantMutation.isPending ? "Criando..." : "Criar Filial"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Main tenant card */}
      {myTenantData?.tenant && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Empresa Principal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{myTenantData.tenant.name}</p>
                <p className="text-sm text-muted-foreground">{myTenantData.tenant.sector || "Sem setor"}</p>
              </div>
              <Badge variant="default">Principal</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sub-tenants grid */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Filiais ({subTenants.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="grid-subtenants">
          {tenantLoading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
          ) : (
            subTenants.map((sub: Tenant) => {
              const usersInFilial = filialUsers(sub.id);
              return (
                <Card key={sub.id} className="hover:shadow-md transition-shadow" data-testid={`card-subtenant-${sub.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm truncate">{sub.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{sub.sector || "Sem setor"}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={sub.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                        {getStatusLabel(sub.status)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{getPlanLabel(sub.plan)}</Badge>
                    </div>
                    {/* Users preview */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {usersInFilial.slice(0, 4).map((tu: any) => (
                          <Avatar key={tu.id} className="h-6 w-6 border-2 border-background -ml-1 first:ml-0">
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {getInitials(tu.user || tu)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {usersInFilial.length > 4 && (
                          <span className="text-xs text-muted-foreground ml-1">+{usersInFilial.length - 4}</span>
                        )}
                        {usersInFilial.length === 0 && (
                          <span className="text-xs text-muted-foreground">Sem usuários</span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setManagingFilial(sub)}
                        data-testid={`button-manage-users-${sub.id}`}
                      >
                        <Users className="h-3 w-3 mr-1" /> Usuários
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
          {!tenantLoading && subTenants.length === 0 && (
            <div className="col-span-full text-center py-10 border-2 border-dashed rounded-lg">
              <Network className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Nenhuma filial cadastrada ainda</p>
              <Button className="mt-3" size="sm" onClick={() => setIsOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Criar Primeira Filial
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Manage Users Dialog */}
      <Dialog open={!!managingFilial} onOpenChange={(open) => !open && setManagingFilial(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Usuários — {managingFilial?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Users in this filial */}
            <div>
              <p className="text-sm font-medium mb-2 text-muted-foreground">Usuários nesta filial</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {filialUsers(managingFilial?.id || "").length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3 text-center">Nenhum usuário associado</p>
                ) : (
                  filialUsers(managingFilial?.id || "").map((tu: any) => (
                    <div key={tu.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {getInitials(tu.user || tu)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium leading-none">
                            {tu.user?.firstName || tu.firstName || ''} {tu.user?.lastName || tu.lastName || ''}
                          </p>
                          <p className="text-xs text-muted-foreground">{getRoleLabel(tu.role)}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => assignUserMutation.mutate({ tuId: tu.id, subTenantId: null })}
                        disabled={assignUserMutation.isPending}
                        data-testid={`button-remove-user-filial-${tu.id}`}
                      >
                        <UserX className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Unassigned users */}
            {unassignedUsers.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2 text-muted-foreground">Adicionar usuário</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {unassignedUsers.map((tu: any) => (
                    <div key={tu.id} className="flex items-center justify-between p-2 rounded-md border">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-xs bg-muted">
                            {getInitials(tu.user || tu)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium leading-none">
                            {tu.user?.firstName || tu.firstName || ''} {tu.user?.lastName || tu.lastName || ''}
                          </p>
                          <p className="text-xs text-muted-foreground">{getRoleLabel(tu.role)}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => assignUserMutation.mutate({ tuId: tu.id, subTenantId: managingFilial?.id })}
                        disabled={assignUserMutation.isPending}
                        data-testid={`button-add-user-filial-${tu.id}`}
                      >
                        <UserCheck className="h-3.5 w-3.5 mr-1" /> Associar
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
