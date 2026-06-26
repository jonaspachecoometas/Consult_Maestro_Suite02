import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useTenantImpersonation } from "@/hooks/useTenantImpersonation";
import { Link } from "wouter";
import {
  Users, Building2, Briefcase, FolderKanban, Activity,
  ArrowRight, Shield, Search, LogIn, Cpu,
} from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import type { TenantWithRelations } from "@shared/schema";
import { useState } from "react";

export default function SuperadminDashboard() {
  const { isSuperadmin } = useSystemRole();
  const { impersonate } = useTenantImpersonation();
  const [search, setSearch] = useState("");

  const { data: metrics, isLoading: metricsLoading } = useQuery<{
    totalPartners: number; totalTenants: number; totalUsers: number; activeProjects: number;
    totalClients: number; tokensThisMonth: number;
  }>({ queryKey: ["/api/superadmin/metrics"], enabled: isSuperadmin });

  const { data: tenants, isLoading: tenantsLoading } = useQuery<TenantWithRelations[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperadmin,
  });

  const { data: activityUsers, isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["/api/superadmin/activity"],
    enabled: isSuperadmin,
  });

  if (!isSuperadmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Acesso Restrito</h2>
          <p className="text-muted-foreground mt-2">Esta área é exclusiva para Superadmin.</p>
        </div>
      </div>
    );
  }

  const metricCards = [
    { title: "Tenants Ativos", value: metrics?.totalTenants ?? 0, icon: Building2, color: "text-purple-600" },
    { title: "Empresas-cliente", value: metrics?.totalClients ?? 0, icon: Briefcase, color: "text-blue-600" },
    { title: "Usuários", value: metrics?.totalUsers ?? 0, icon: Users, color: "text-green-600" },
    { title: "Projetos Ativos", value: metrics?.activeProjects ?? 0, icon: FolderKanban, color: "text-orange-600" },
    { title: "Tokens este mês", value: metrics?.tokensThisMonth ?? 0, icon: Cpu, color: "text-red-500" },
  ];

  const filtered = (tenants || []).filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.adminEmail?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">Painel Superadmin</h1>
          <p className="text-muted-foreground">Visão global da plataforma Arcádia</p>
        </div>
        <Badge variant="destructive" className="text-sm">Arcádia HQ</Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {metricCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold">{card.value.toLocaleString('pt-BR')}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenants Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Todos os Tenants</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar tenant..."
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {tenantsLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((tenant) => (
                <div key={tenant.id} className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{tenant.name}</p>
                      <p className="text-xs text-muted-foreground">{tenant.adminEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{getPlanLabel(tenant.plan)}</Badge>
                    <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {getStatusLabel(tenant.status)}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Entrar como tenant"
                      onClick={() => impersonate(tenant.id)}>
                      <LogIn className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                      <Link href={`/superadmin/tenant/${tenant.id}`}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhum tenant encontrado</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Últimos usuários ativos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {(activityUsers || []).slice(0, 8).map((user: any) => (
                <div key={user.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{user.systemRole || 'user'}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
