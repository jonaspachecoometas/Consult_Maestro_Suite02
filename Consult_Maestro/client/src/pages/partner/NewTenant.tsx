import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { ArrowLeft, Building2, User, Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";

const newTenantSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  adminEmail: z.string().email("Email inválido"),
  adminFirstName: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  adminPassword: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  sector: z.string().min(1, "Setor é obrigatório"),
  plan: z.enum(["free", "starter", "professional", "enterprise"]).default("free"),
});

type NewTenantForm = z.infer<typeof newTenantSchema>;

export default function PartnerNewTenant() {
  const { isPartner, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<NewTenantForm>({
    resolver: zodResolver(newTenantSchema),
    defaultValues: { name: "", adminEmail: "", adminFirstName: "", adminPassword: "", sector: "", plan: "free" },
  });

  const createTenantMutation = useMutation({
    mutationFn: async (data: NewTenantForm) => {
      const response = await apiRequest("POST", "/api/tenants", data);
      return response.json();
    },
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-partner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      toast({ title: "Tenant criado com sucesso!", description: `Usuário admin criado e vinculado ao tenant.` });
      navigate(`/partner/tenant/${tenant.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar tenant", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  if (!isPartner && !isSuperadmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Acesso restrito a Parceiros e Superadmins.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partner/tenants" data-testid="link-back-partner">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-heading" data-testid="text-new-tenant-title">Novo Tenant</h1>
          <p className="text-muted-foreground">Retaguar — cadastre um novo workspace para seu cliente</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => createTenantMutation.mutate(data))} className="space-y-5">
          {/* Empresa */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Informações da Empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Empresa</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Tech Solutions Ltda" {...field} data-testid="input-tenant-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="sector" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Setor</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tenant-sector">
                          <SelectValue placeholder="Selecione o setor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="technology">Tecnologia</SelectItem>
                        <SelectItem value="healthcare">Saúde</SelectItem>
                        <SelectItem value="education">Educação</SelectItem>
                        <SelectItem value="finance">Finanças</SelectItem>
                        <SelectItem value="retail">Varejo</SelectItem>
                        <SelectItem value="manufacturing">Manufatura</SelectItem>
                        <SelectItem value="consulting">Consultoria</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="plan" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tenant-plan">
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
              </div>
            </CardContent>
          </Card>

          {/* Admin */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" /> Usuário Administrador
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="adminFirstName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Responsável</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: João Silva" {...field} data-testid="input-admin-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="adminEmail" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email de Acesso</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="admin@empresa.com" {...field} data-testid="input-tenant-admin-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="adminPassword" render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha Inicial</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Mínimo 6 caracteres"
                        {...field}
                        data-testid="input-admin-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/partner/tenants")}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={createTenantMutation.isPending} data-testid="button-submit-new-tenant">
              {createTenantMutation.isPending ? "Criando..." : "Criar Tenant"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
