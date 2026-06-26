import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Button } from "@/components/ui/button";
import { Shield, X } from "lucide-react";
import { getActiveTenantId, setActiveTenantId } from "@/lib/queryClient";

/**
 * Banner fixo no topo quando superadmin está operando em um tenant específico.
 * Lê o tenant ativo do queryClient (localStorage) que também injeta o header x-tenant-id.
 */
export function ImpersonationBanner() {
  const { isSuperadmin } = useSystemRole();
  const qc = useQueryClient();
  const activeTenantId = getActiveTenantId();

  const { data: tenant } = useQuery<{ name: string; slug: string } | null>({
    queryKey: ["/api/tenants", activeTenantId],
    enabled: isSuperadmin && !!activeTenantId,
  });

  if (!isSuperadmin || !activeTenantId || !tenant) return null;

  function exitImpersonation() {
    setActiveTenantId(null);
    qc.invalidateQueries();
    window.location.href = "/superadmin";
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" />
        <span>
          Você está operando como <strong>{tenant.name}</strong> (superadmin)
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-white hover:text-white hover:bg-amber-600 h-7 px-2"
        onClick={exitImpersonation}
      >
        <X className="h-3 w-3 mr-1" />
        Sair do modo tenant
      </Button>
    </div>
  );
}
