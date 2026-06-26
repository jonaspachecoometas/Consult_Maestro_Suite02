import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Link } from "wouter";
import { Building2, Plus, Search, Users } from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { useState } from "react";
import type { TenantWithRelations } from "@shared/schema";

export default function PartnerTenantsList() {
  const { isPartner } = useSystemRole();
  const [search, setSearch] = useState("");

  const { data: partnerData, isLoading } = useQuery<{
    partner: any;
    tenants: TenantWithRelations[];
  }>({
    queryKey: ["/api/my-partner"],
    enabled: isPartner,
  });

  const tenants = partnerData?.tenants || [];
  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.sector || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading" data-testid="text-tenants-list-title">Tenants</h1>
          <p className="text-muted-foreground">Retaguar — todos os workspaces sob sua gestão</p>
        </div>
        <Button asChild data-testid="button-new-tenant">
          <Link href="/partner/novo-tenant">
            <Plus className="h-4 w-4 mr-2" /> Novo Tenant
          </Link>
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-tenants"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="grid-tenants">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)
        ) : (
          filteredTenants.map((tenant) => (
            <Card key={tenant.id} className="hover:shadow-md transition-shadow" data-testid={`card-tenant-${tenant.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    {tenant.logoUrl ? (
                      <img src={tenant.logoUrl} alt={tenant.name} className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <Building2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{tenant.name}</CardTitle>
                    <p className="text-xs text-muted-foreground truncate">{tenant.sector || "Sem setor"}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                    {getStatusLabel(tenant.status)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{getPlanLabel(tenant.plan)}</Badge>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>{tenant.userCount} usuários</span>
                  {(tenant.subTenantCount || 0) > 0 && (
                    <span className="ml-2">• {tenant.subTenantCount} filiais</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/partner/tenant/${tenant.id}`} data-testid={`link-manage-tenant-${tenant.id}`}>
                      Gerenciar
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {!isLoading && filteredTenants.length === 0 && (
          <div className="col-span-full text-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {search ? "Nenhum tenant encontrado com essa busca" : "Nenhum tenant cadastrado ainda"}
            </p>
            {!search && (
              <Button className="mt-4" asChild>
                <Link href="/partner/novo-tenant">
                  <Plus className="h-4 w-4 mr-2" /> Adicionar Primeiro Tenant
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
