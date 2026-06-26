export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrador',
    gerente: 'Gerente',
    tecnico: 'Técnico',
  };
  return labels[role] || role;
}

export function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    admin: 'default',
    gerente: 'secondary',
    tecnico: 'outline',
  };
  return variants[role] || 'outline';
}

export function getSystemRoleLabel(systemRole: string): string {
  const labels: Record<string, string> = {
    superadmin: 'Superadmin',
    partner: 'Parceiro',
    tenant_admin: 'Admin Empresa',
    user: 'Usuário',
  };
  return labels[systemRole] || systemRole;
}

export function getSystemRoleBadgeVariant(systemRole: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    superadmin: 'destructive',
    partner: 'default',
    tenant_admin: 'secondary',
    user: 'outline',
  };
  return variants[systemRole] || 'outline';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Ativo',
    inactive: 'Inativo',
    pending: 'Pendente',
    trial: 'Trial',
  };
  return labels[status] || status;
}

export function getPlanLabel(plan: string): string {
  const labels: Record<string, string> = {
    free: 'Gratuito',
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise',
  };
  return labels[plan] || plan;
}

export function getSectorLabel(sector: string): string {
  const labels: Record<string, string> = {
    technology: 'Tecnologia',
    healthcare: 'Saúde',
    education: 'Educação',
    finance: 'Finanças',
    retail: 'Varejo',
    manufacturing: 'Manufatura',
    consulting: 'Consultoria',
    other: 'Outro',
  };
  return labels[sector] || sector;
}
