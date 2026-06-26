import { getActiveTenantId, setActiveTenantId } from "@/lib/queryClient";

/**
 * Hook para superadmin impersonar um tenant.
 * Usa o sistema existente do queryClient (localStorage + header x-tenant-id).
 */
export function useTenantImpersonation() {
  function impersonate(tenantId: string) {
    setActiveTenantId(tenantId);
    window.location.href = "/";
  }

  function exit() {
    setActiveTenantId(null);
    window.location.href = "/superadmin";
  }

  const current = getActiveTenantId();

  return { impersonate, exit, current };
}
