import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { Building2, Settings, Save } from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { FrappeIntegrationCard } from "@/components/FrappeIntegrationCard";
import { TenantAiConfigsCard } from "@/components/TenantAiConfigsCard";

const settingsSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  sector: z.string().optional(),
  adminEmail: z.string().email("Email inválido").optional(),
  logoUrl: z.string().url("URL inválida").optional().or(z.literal("")),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export default function TenantSettings() {
  const { isTenantAdmin, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const hasAccess = isTenantAdmin || isSuperadmin;

  const { data: myTenantData, isLoading } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: hasAccess,
  });

  const tenant = myTenantData?.tenant;

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: tenant?.name || "",
      sector: tenant?.sector || "",
      adminEmail: tenant?.adminEmail || "",
      logoUrl: tenant?.logoUrl || "",
    },
    values: {
      name: tenant?.name || "",
      sector: tenant?.sector || "",
      adminEmail: tenant?.adminEmail || "",
      logoUrl: tenant?.logoUrl || "",
    },
  });

  const updateTenantMutation = useMutation({
    mutationFn: (data: SettingsForm) => apiRequest("PATCH", `/api/tenants/${tenant?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-tenant"] });
      toast({ title: "Configurações salvas com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    },
  });

  if (!hasAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Acesso restrito a Administradores de Tenant.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold font-heading" data-testid="text-settings-title">Minha Empresa</h1>
          <p className="text-muted-foreground">Configurações do seu tenant</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              {tenant?.logoUrl ? (
                <img src={tenant.logoUrl} alt={tenant.name} className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <Building2 className="h-7 w-7 text-primary" />
              )}
            </div>
            <div>
              <p className="font-semibold text-lg" data-testid="text-tenant-name">{tenant?.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={tenant?.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                  {getStatusLabel(tenant?.status || 'trial')}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {getPlanLabel(tenant?.plan || 'free')}
                </Badge>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editar Informações</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => updateTenantMutation.mutate(data))} className="space-y-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da Empresa</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome da empresa" {...field} data-testid="input-tenant-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="sector" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
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

                  <FormField control={form.control} name="adminEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email de Contato</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="admin@empresa.com" {...field} data-testid="input-tenant-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="logoUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>URL do Logo</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} data-testid="input-tenant-logo" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <Button type="submit" disabled={updateTenantMutation.isPending} data-testid="button-save-settings">
                    <Save className="h-4 w-4 mr-2" />
                    {updateTenantMutation.isPending ? "Salvando..." : "Salvar Configurações"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {tenant?.id && <FrappeIntegrationCard tenantId={tenant.id} />}

          <TenantAiConfigsCard />
        </>
      )}
    </div>
  );
}
