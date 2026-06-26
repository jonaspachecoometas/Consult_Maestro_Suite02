import { useAuth } from "@/hooks/useAuth";

export type SystemRole = "superadmin" | "partner" | "tenant_admin" | "user";

export function useSystemRole() {
  const { user, isLoading, isAuthenticated } = useAuth();

  const systemRole = (user?.systemRole || "user") as SystemRole;

  return {
    user,
    isLoading,
    isAuthenticated,
    systemRole,
    isSuperadmin: systemRole === "superadmin",
    isPartner: systemRole === "partner",
    isTenantAdmin: systemRole === "tenant_admin",
    isRegularUser: systemRole === "user",
  };
}

export function useSuperadmin() {
  const { isSuperadmin, ...rest } = useSystemRole();
  return { isSuperadmin, ...rest };
}

export function usePartner() {
  const { isPartner, ...rest } = useSystemRole();
  return { isPartner, ...rest };
}

export function useTenantAdmin() {
  const { isTenantAdmin, ...rest } = useSystemRole();
  return { isTenantAdmin, ...rest };
}
