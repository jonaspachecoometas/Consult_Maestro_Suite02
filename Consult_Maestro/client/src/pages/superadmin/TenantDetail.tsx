import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, Users, Cpu, LogIn, Globe, Mail } from "lucide-react";
import { Link } from "wouter";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useTenantImpersonation } from "@/hooks/useTenantImpersonation";
import type { Tenant, TenantUser } from "@shared/schema";

export default function SuperadminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { isSuperadmin } = useSystemRole();
  const { impersonate } = useTenantImpersonation();

  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenants", id],
    enabled: !!id && isSuperadmin,
  });

  const { data: tenantUsers, isLoading: usersLoading } = useQuery<(TenantUser & { user?: any })[]>({
    queryKey: [`/api/tenants/${id}/users`],
    enabled: !!id && isSuperadmin,
  });

  const { data: clients, isLoading: clientsLoading } = useQuery<any[]>({
    queryKey: [`/api/superadmin/tenants/${id}/clients`],
    enabled: !!id && isSuperadmin,
  });

  const { data: aiUsage, isLoading: aiLoading } = useQuery<any[]>({
    queryKey: [`/api/superadmin/tenants/${id}/ai-usage`],
    enabled: !!id && isSuperadmin,
  });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  }
  if (!tenant) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Tenant não encontrado</p>
        <Button variant="outline" asChild className="mt-4"><Link href="/superadmin">Voltar</Link></Button>
      </div>
    );
  }

  const totalTokens = (aiUsage || []).reduce((s: number, r: any) => s + (r.tokensInput || 0) + (r.tokensOutput || 0), 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/superadmin"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold font-heading">{tenant.name}</h1>
          <p className="text-muted-foreground text-sm">Visão detalhada · modo superadmin</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>{getStatusLabel(tenant.status)}</Badge>
          <Badge variant="outline">{getPlanLabel(tenant.plan)}</Badge>
          <Button size="sm" onClick={() => impersonate(tenant.id)} className="gap-1.5">
            <LogIn className="h-3.5 w-3.5" /> Entrar como tenant
          </Button>
        </div>
      </div>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Usuários", value: tenantUsers?.length ?? 0, icon: Users },
          { label: "Empresas-cliente", value: clients?.length ?? 0, icon: Building2 },
          { label: "Tokens (total)", value: totalTokens.toLocaleString('pt-BR'), icon: Cpu },
          { label: "Admin email", value: tenant.adminEmail || "—", icon: Mail },
        ].map(c => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-sm font-semibold">{c.value}</p></CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="empresas">Empresas-cliente</TabsTrigger>
          <TabsTrigger value="ia">Uso de IA</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios">
          <Card>
            <CardContent className="pt-4 space-y-1">
              {usersLoading ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />) : (
                (tenantUsers || []).map(tu => (
                  <div key={tu.id} className="flex items-center justify-between p-2 rounded border">
                    <div>
                      <p className="text-sm font-medium">{tu.user?.firstName} {tu.user?.lastName}</p>
                      <p className="text-xs text-muted-foreground">{tu.user?.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{tu.role}</Badge>
                  </div>
                ))
              )}
              {!usersLoading && (!tenantUsers || tenantUsers.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum usuário</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="empresas">
          <Card>
            <CardContent className="pt-4 space-y-1">
              {clientsLoading ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />) : (
                (clients || []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-2 rounded border">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.industry || c.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{c.status || 'ativo'}</Badge>
                  </div>
                ))
              )}
              {!clientsLoading && (!clients || clients.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma empresa cadastrada</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ia">
          <Card>
            <CardContent className="pt-4">
              {aiLoading ? [...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full mb-1" />) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground font-medium pb-1 border-b">
                    <span>Provider</span><span>Modelo</span><span>Tokens entrada</span><span>Tokens saída</span><span>Fonte</span>
                  </div>
                  {(aiUsage || []).slice(0, 20).map((r: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-1 border-b border-muted/40">
                      <span className="capitalize">{r.provider}</span>
                      <span className="text-muted-foreground truncate max-w-[120px]">{r.model}</span>
                      <span>{(r.tokensInput || 0).toLocaleString('pt-BR')}</span>
                      <span>{(r.tokensOutput || 0).toLocaleString('pt-BR')}</span>
                      <Badge variant={r.source === 'tenant' ? 'default' : 'secondary'} className="text-[10px] h-4">
                        {r.source === 'tenant' ? 'Tenant' : 'Plataforma'}
                      </Badge>
                    </div>
                  ))}
                  {(!aiUsage || aiUsage.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sem uso de IA registrado</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ["Setor", tenant.sector || "—"],
                ["Slug", tenant.slug],
                ["Admin Email", tenant.adminEmail || "—"],
                ["Criado em", tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('pt-BR') : "—"],
                ["Frappe URL", (tenant as any).frappeUrl || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
