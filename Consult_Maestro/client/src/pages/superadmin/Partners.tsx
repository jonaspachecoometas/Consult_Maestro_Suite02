import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { z } from "zod";
import { Plus, Shield, Building2, Pencil, KeyRound, Eye, EyeOff } from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { Link } from "wouter";
import type { PartnerWithStats } from "@shared/schema";

const partnerCreateSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  phone: z.string().optional(),
  plan: z.enum(["free", "starter", "professional", "enterprise"]).default("starter"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  notes: z.string().optional(),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

const partnerEditSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  phone: z.string().optional(),
  plan: z.enum(["free", "starter", "professional", "enterprise"]).default("starter"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  notes: z.string().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  confirmPassword: z.string().min(1, "Confirmação é obrigatória"),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

type PartnerCreateForm = z.infer<typeof partnerCreateSchema>;
type PartnerEditForm = z.infer<typeof partnerEditSchema>;
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

function PartnerBaseFields({ form }: { form: any }) {
  return (
    <div className="space-y-4">
      <FormField control={form.control} name="name" render={({ field }) => (
        <FormItem>
          <FormLabel>Nome / Empresa</FormLabel>
          <FormControl>
            <Input placeholder="Ex: Contabilidade Silva & Associados" {...field} data-testid="input-partner-name" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="email" render={({ field }) => (
        <FormItem>
          <FormLabel>Email Principal</FormLabel>
          <FormControl>
            <Input type="email" placeholder="contato@parceiro.com" {...field} data-testid="input-partner-email" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="phone" render={({ field }) => (
        <FormItem>
          <FormLabel>Telefone (opcional)</FormLabel>
          <FormControl>
            <Input placeholder="(11) 99999-9999" {...field} data-testid="input-partner-phone" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <div className="grid grid-cols-2 gap-4">
        <FormField control={form.control} name="plan" render={({ field }) => (
          <FormItem>
            <FormLabel>Plano</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger data-testid="select-partner-plan">
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="free">Gratuito</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem>
            <FormLabel>Status</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger data-testid="select-partner-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
                <SelectItem value="suspended">Suspenso</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
      </div>
      <FormField control={form.control} name="notes" render={({ field }) => (
        <FormItem>
          <FormLabel>Observações (opcional)</FormLabel>
          <FormControl>
            <Input placeholder="Notas internas sobre este parceiro" {...field} data-testid="input-partner-notes" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  );
}

function PasswordField({ form, name, label, placeholder, testId }: {
  form: any; name: string; label: string; placeholder?: string; testId: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              placeholder={placeholder || "Mínimo 6 caracteres"}
              {...field}
              data-testid={testId}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
}

export default function SuperadminPartners() {
  const { isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerWithStats | null>(null);
  const [resetPasswordPartner, setResetPasswordPartner] = useState<PartnerWithStats | null>(null);

  const { data: partners, isLoading } = useQuery<PartnerWithStats[]>({
    queryKey: ["/api/partners"],
    enabled: isSuperadmin,
  });

  const createForm = useForm<PartnerCreateForm>({
    resolver: zodResolver(partnerCreateSchema),
    defaultValues: { name: "", email: "", phone: "", plan: "starter", status: "active", notes: "", password: "" },
  });

  const editForm = useForm<PartnerEditForm>({
    resolver: zodResolver(partnerEditSchema),
    defaultValues: { name: "", email: "", phone: "", plan: "starter", status: "active", notes: "" },
  });

  const resetPassForm = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const createMutation = useMutation({
    mutationFn: (data: PartnerCreateForm) => apiRequest("POST", "/api/partners", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partners"] });
      queryClient.invalidateQueries({ queryKey: ["/api/superadmin/metrics"] });
      toast({ title: "Agência registrada com sucesso!", description: "A agência já pode fazer login com as credenciais cadastradas." });
      createForm.reset();
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao registrar agência", description: err.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PartnerEditForm }) =>
      apiRequest("PATCH", `/api/partners/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partners"] });
      toast({ title: "Agência atualizada com sucesso!" });
      setEditingPartner(null);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar agência", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ partnerId, newPassword }: { partnerId: string; newPassword: string }) => {
      const partner = partners?.find((p) => p.id === partnerId);
      if (!partner?.email) throw new Error("Email do parceiro não encontrado");
      const res = await apiRequest("POST", "/api/auth/admin-reset-password-by-email", {
        email: partner.email,
        newPassword,
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Senha redefinida!", description: "O parceiro já pode entrar com a nova senha." });
      resetPassForm.reset();
      setResetPasswordPartner(null);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao redefinir senha", description: err.message, variant: "destructive" });
    },
  });

  function openEdit(partner: PartnerWithStats) {
    setEditingPartner(partner);
    editForm.reset({
      name: partner.name,
      email: partner.email || "",
      phone: partner.phone || "",
      plan: (partner.plan as any) || "starter",
      status: (partner.status as any) || "active",
      notes: (partner as any).notes || "",
    });
  }

  function openResetPassword(partner: PartnerWithStats) {
    setResetPasswordPartner(partner);
    resetPassForm.reset();
  }

  if (!isSuperadmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
        <p className="ml-4 text-muted-foreground">Acesso restrito a Superadmin.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading" data-testid="text-partners-title">Agências</h1>
          <p className="text-muted-foreground">Gerencie todas as agências e consultores licenciados na plataforma</p>
        </div>

        {/* Create dialog */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-partner">
              <Plus className="h-4 w-4 mr-2" /> Nova Agência
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Registrar Nova Agência</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <PartnerBaseFields form={createForm} />
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3 text-muted-foreground">Acesso ao sistema</p>
                  <PasswordField
                    form={createForm}
                    name="password"
                    label="Senha de Acesso"
                    placeholder="Mínimo 6 caracteres"
                    testId="input-partner-password"
                  />
                  <FormDescription className="text-xs mt-1 text-muted-foreground">
                    A agência usará este email e senha para fazer login na plataforma.
                  </FormDescription>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-partner">
                    {createMutation.isPending ? "Registrando..." : "Registrar Agência"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingPartner} onOpenChange={(open) => !open && setEditingPartner(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Agência</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) =>
                editMutation.mutate({ id: editingPartner!.id, data })
              )}
              className="space-y-4"
            >
              <PartnerBaseFields form={editForm} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingPartner(null)}>Cancelar</Button>
                <Button type="submit" disabled={editMutation.isPending} data-testid="button-save-partner">
                  {editMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetPasswordPartner} onOpenChange={(open) => !open && setResetPasswordPartner(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Redefinir Senha — {resetPasswordPartner?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Define uma nova senha para <strong>{resetPasswordPartner?.email}</strong>. A agência poderá alterá-la depois no próprio perfil.
          </p>
          <Form {...resetPassForm}>
            <form
              onSubmit={resetPassForm.handleSubmit((data) =>
                resetPasswordMutation.mutate({ partnerId: resetPasswordPartner!.id, newPassword: data.newPassword })
              )}
              className="space-y-4"
            >
              <PasswordField
                form={resetPassForm}
                name="newPassword"
                label="Nova Senha"
                testId="input-reset-new-password"
              />
              <PasswordField
                form={resetPassForm}
                name="confirmPassword"
                label="Confirmar Senha"
                placeholder="Repita a senha"
                testId="input-reset-confirm-password"
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setResetPasswordPartner(null)}>Cancelar</Button>
                <Button type="submit" disabled={resetPasswordMutation.isPending} data-testid="button-submit-reset-password">
                  {resetPasswordMutation.isPending ? "Salvando..." : "Redefinir Senha"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <div className="divide-y" data-testid="list-partners">
              {(partners || []).map((partner) => (
                <div key={partner.id} className="flex items-center justify-between p-4 hover:bg-muted/30" data-testid={`row-partner-${partner.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{partner.name}</p>
                      <p className="text-sm text-muted-foreground">{partner.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mr-1">
                      <Building2 className="h-3 w-3" />
                      <span>{partner.tenantCount} tenants</span>
                    </div>
                    <Badge variant="outline">{getPlanLabel(partner.plan)}</Badge>
                    <Badge variant={partner.status === 'active' ? 'default' : 'secondary'}>
                      {getStatusLabel(partner.status)}
                    </Badge>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/superadmin/tenants?partnerId=${partner.id}`} data-testid={`link-partner-tenants-${partner.id}`}>
                        Ver Tenants
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openResetPassword(partner)}
                      data-testid={`button-reset-password-partner-${partner.id}`}
                    >
                      <KeyRound className="h-3.5 w-3.5 mr-1" /> Senha
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(partner)}
                      data-testid={`button-edit-partner-${partner.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                  </div>
                </div>
              ))}
              {(!partners || partners.length === 0) && (
                <div className="text-center py-12">
                  <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">Nenhuma agência registrada ainda</p>
                  <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Registrar Primeira Agência
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
