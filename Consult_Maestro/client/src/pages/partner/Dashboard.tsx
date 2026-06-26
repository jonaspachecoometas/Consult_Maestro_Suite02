import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Link } from "wouter";
import {
  Building2, Users, FolderKanban, ArrowRight, Plus, Briefcase,
  TrendingUp, CheckCircle2, Clock
} from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import type { TenantWithRelations } from "@shared/schema";

export default function PartnerDashboard() {
  const { isPartner, isSuperadmin, user } = useSystemRole();

  const { data: partnerData, isLoading } = useQuery<{
    partner: any;
    tenants: TenantWithRelations[];
  }>({
    queryKey: ["/api/my-partner"],
    enabled: isPartner,
  });

  if (!isPartner && !isSuperadmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Acesso Restrito</h2>
          <p className="text-muted-foreground mt-2">Esta área é exclusiva para Parceiros Retaguar.</p>
        </div>
      </div>
    );
  }

  const tenants = partnerData?.tenants || [];
  const totalUsers = tenants.reduce((sum, t) => sum + (t.userCount || 0), 0);
  const activeTenants = tenants.filter(t => t.status === 'active').length;
  const partner = partnerData?.partner;

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg">
                RT
              </div>
              <div>
                <h1 className="text-2xl font-bold font-heading" data-testid="text-partner-title">
                  Retaguar
                </h1>
                <p className="text-sm text-muted-foreground">
                  Bem-vindo, {user?.firstName || 'Parceiro'} — {partner?.name || 'Portal do Parceiro'}
                </p>
              </div>
            </div>
            <Button asChild data-testid="button-new-tenant">
              <Link href="/partner/novo-tenant">
                <Plus className="h-4 w-4 mr-2" /> Novo Tenant
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-total-tenants">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Tenants</CardTitle>
              <Building2 className="h-5 w-5 text-blue-600" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : (
                <>
                  <div className="text-3xl font-bold">{tenants.length}</div>
                  <p className="text-xs text-muted-foreground mt-1">{activeTenants} ativos</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-total-users">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Usuários nos Tenants</CardTitle>
              <Users className="h-5 w-5 text-emerald-600" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : (
                <>
                  <div className="text-3xl font-bold">{totalUsers}</div>
                  <p className="text-xs text-muted-foreground mt-1">em {tenants.length} empresas</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-active-tenants">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Plano Atual</CardTitle>
              <TrendingUp className="h-5 w-5 text-purple-600" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : (
                <>
                  <div className="text-2xl font-bold capitalize">{getPlanLabel(partner?.plan || 'starter')}</div>
                  <p className="text-xs text-muted-foreground mt-1">{getStatusLabel(partner?.status || 'active')}</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tenants List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Tenants Recentes</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/partner/tenants" data-testid="link-all-tenants">
                Ver todos <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : tenants.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground font-medium mb-1">Nenhum tenant cadastrado ainda</p>
                <p className="text-sm text-muted-foreground mb-4">Cadastre o primeiro tenant para começar</p>
                <Button asChild>
                  <Link href="/partner/novo-tenant">
                    <Plus className="h-4 w-4 mr-2" /> Cadastrar Primeiro Tenant
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="list-partner-tenants">
              {tenants.slice(0, 6).map((tenant) => (
                <Card key={tenant.id} className="hover:shadow-sm transition-shadow" data-testid={`row-tenant-${tenant.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                        {tenant.logoUrl ? (
                          <img src={tenant.logoUrl} alt={tenant.name} className="h-10 w-10 rounded-lg object-cover" />
                        ) : (
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{tenant.name}</p>
                          <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-4 px-1.5 flex-shrink-0">
                            {getStatusLabel(tenant.status)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />{tenant.userCount} usuários
                          </span>
                          <span>{tenant.sector || "Sem setor"}</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild className="flex-shrink-0">
                        <Link href={`/partner/tenant/${tenant.id}`} data-testid={`link-tenant-${tenant.id}`}>
                          Gerenciar
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Ações Rápidas</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
              <Link href="/partner/novo-tenant" data-testid="quick-action-new-tenant">
                <Plus className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium">Cadastrar Tenant</span>
                <span className="text-xs text-muted-foreground">Criar novo workspace</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
              <Link href="/partner/tenants" data-testid="quick-action-list-tenants">
                <FolderKanban className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium">Ver Todos Tenants</span>
                <span className="text-xs text-muted-foreground">Lista completa</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" asChild>
              <Link href="/mapa-sistema" data-testid="quick-action-system-map">
                <CheckCircle2 className="h-5 w-5 text-purple-600" />
                <span className="text-sm font-medium">Mapa do Sistema</span>
                <span className="text-xs text-muted-foreground">Ver arquitetura</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
