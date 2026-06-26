import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useSystemRole } from "@/hooks/useSystemRole";
import {
  getActiveTenantId,
  queryClient,
  setActiveTenantId,
} from "@/lib/queryClient";

interface TenantSwitcherProps {
  activeTenantId?: string;
  onSwitch?: (tenantId: string) => void;
}

export function TenantSwitcher({ activeTenantId, onSwitch }: TenantSwitcherProps) {
  const { isTenantAdmin, isSuperadmin } = useSystemRole();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    activeTenantId || getActiveTenantId(),
  );

  const { data: myTenantData } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: isTenantAdmin || isSuperadmin,
  });

  const tenant = myTenantData?.tenant;
  const subTenants = myTenantData?.subTenants || [];

  // Sincroniza localStorage com /api/my-tenant:
  //  - sem valor armazenado → grava o tenant principal.
  //  - valor stale (não pertence mais a [tenant, ...subTenants]) → corrige p/ principal
  //    e invalida queries para evitar enviar x-tenant-id inválido em requests subsequentes.
  // Isso fecha o caso de sessão trocada de usuário ou tenant removido/desativado.
  useEffect(() => {
    if (!tenant) return;
    const validIds = new Set<string>([tenant.id, ...subTenants.map((t: any) => t.id)]);
    const current = getActiveTenantId();
    if (!current || !validIds.has(current)) {
      setActiveTenantId(tenant.id);
      setSelectedTenantId(tenant.id);
      if (current && current !== tenant.id) {
        queryClient.invalidateQueries();
      }
    } else if (current !== selectedTenantId) {
      setSelectedTenantId(current);
    }
  }, [tenant?.id, subTenants.map((t: any) => t.id).join(",")]);

  if (!tenant) return null;

  const allTenants = [tenant, ...subTenants];
  const currentTenant = allTenants.find(t => t.id === (selectedTenantId || tenant.id)) || tenant;

  const handleSwitch = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setActiveTenantId(tenantId);
    queryClient.invalidateQueries();
    onSwitch?.(tenantId);
  };

  if (allTenants.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm" data-testid="tenant-switcher-single">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
          {tenant.logoUrl ? (
            <img src={tenant.logoUrl} alt={tenant.name} className="h-6 w-6 rounded object-cover" />
          ) : (
            <Building2 className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
        <span className="font-medium text-sm truncate">{tenant.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sidebar-accent text-sm"
          data-testid="button-tenant-switcher"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 shrink-0">
            {currentTenant.logoUrl ? (
              <img src={currentTenant.logoUrl} alt={currentTenant.name} className="h-6 w-6 rounded object-cover" />
            ) : (
              <Building2 className="h-3.5 w-3.5 text-primary" />
            )}
          </div>
          <span className="flex-1 text-left font-medium truncate">{currentTenant.name}</span>
          {currentTenant.id !== tenant.id && (
            <Badge variant="outline" className="text-xs shrink-0">Filial</Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Alternar Empresa</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allTenants.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => handleSwitch(t.id)}
            className="flex items-center gap-2"
            data-testid={`option-tenant-${t.id}`}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
              {t.logoUrl ? (
                <img src={t.logoUrl} alt={t.name} className="h-5 w-5 rounded object-cover" />
              ) : (
                <Building2 className="h-3 w-3 text-primary" />
              )}
            </div>
            <span className="flex-1 truncate text-sm">{t.name}</span>
            {t.id === tenant.id && <Badge variant="secondary" className="text-xs">Principal</Badge>}
            {t.id === (selectedTenantId || tenant.id) && <Check className="h-3.5 w-3.5 ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
