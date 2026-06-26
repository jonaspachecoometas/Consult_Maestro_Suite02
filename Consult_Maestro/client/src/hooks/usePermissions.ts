import { useQuery } from "@tanstack/react-query";
import { useSystemRole } from "./useSystemRole";

type PermLevel = {
  canView: number;
  canCreate: number;
  canEdit: number;
  canDelete: number;
};

export type Permissions = Record<string, PermLevel>;

export function usePermissions() {
  const { isSuperadmin, isPartner, isTenantAdmin } = useSystemRole();

  const { data: permissions, isLoading } = useQuery<Permissions>({
    queryKey: ["/api/my-permissions"],
    staleTime: 5 * 60 * 1000,
  });

  const bypass = isSuperadmin || isPartner || isTenantAdmin;

  const canView = (module: string): boolean => {
    if (bypass) return true;
    if (!permissions) return true;
    return (permissions[module]?.canView ?? 0) === 1;
  };

  const canCreate = (module: string): boolean => {
    if (bypass) return true;
    if (!permissions) return false;
    return (permissions[module]?.canCreate ?? 0) === 1;
  };

  const canEdit = (module: string): boolean => {
    if (bypass) return true;
    if (!permissions) return false;
    return (permissions[module]?.canEdit ?? 0) === 1;
  };

  const canDelete = (module: string): boolean => {
    if (bypass) return true;
    if (!permissions) return false;
    return (permissions[module]?.canDelete ?? 0) === 1;
  };

  return { canView, canCreate, canEdit, canDelete, isLoading, permissions };
}
