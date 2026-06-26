import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Shield, Save, RotateCcw } from "lucide-react";

const ALL_MODULES = [
  { key: 'dashboard',    label: 'Dashboard' },
  { key: 'crm',         label: 'CRM' },
  { key: 'clientes',    label: 'Clientes' },
  { key: 'projetos',    label: 'Projetos' },
  { key: 'colaboradores', label: 'Colaboradores' },
  { key: 'canvas',      label: 'Canvas BMC' },
  { key: 'swot',        label: 'Análise SWOT' },
  { key: 'pdca',        label: 'PDCA' },
  { key: 'processos',   label: 'Processos' },
  { key: 'erp',         label: 'Requisitos ERP' },
  { key: 'tarefas',     label: 'Tarefas' },
  { key: 'relatorios',  label: 'Relatórios' },
  { key: 'producao',    label: 'Produção' },
  { key: 'suporte',     label: 'Atendimento' },
];

const ROLES = [
  { key: 'admin',   label: 'Administrador', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  { key: 'gerente', label: 'Gerente',        color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  { key: 'tecnico', label: 'Técnico',        color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' },
];

const PERM_TYPES = [
  { key: 'canView',   label: 'Ver' },
  { key: 'canCreate', label: 'Criar' },
  { key: 'canEdit',   label: 'Editar' },
  { key: 'canDelete', label: 'Excluir' },
];

type PermMap = Record<string, Record<string, Record<string, boolean>>>;

export default function TenantPermissions() {
  const { isTenantAdmin, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const hasAccess = isTenantAdmin || isSuperadmin;

  const { data: myTenantData } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: hasAccess,
  });

  const tenantId = myTenantData?.tenant?.id;

  const { data: permsData, isLoading } = useQuery<Record<string, Record<string, any>>>({
    queryKey: [`/api/tenants/${tenantId}/permissions`],
    enabled: !!tenantId,
  });

  const [localPerms, setLocalPerms] = useState<PermMap | null>(null);

  const effectivePerms: PermMap = localPerms || (permsData
    ? Object.fromEntries(
        ROLES.map(r => [
          r.key,
          Object.fromEntries(
            ALL_MODULES.map(m => [
              m.key,
              Object.fromEntries(
                PERM_TYPES.map(p => [p.key, (permsData[r.key]?.[m.key]?.[p.key] ?? 0) === 1])
              )
            ])
          )
        ])
      )
    : {});

  const toggle = (role: string, module: string, perm: string) => {
    const current = localPerms || effectivePerms;
    setLocalPerms({
      ...current,
      [role]: {
        ...current[role],
        [module]: {
          ...current[role]?.[module],
          [perm]: !current[role]?.[module]?.[perm],
        }
      }
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {};
      for (const role of ROLES) {
        payload[role.key] = {};
        for (const mod of ALL_MODULES) {
          payload[role.key][mod.key] = {
            canView: effectivePerms[role.key]?.[mod.key]?.canView ? 1 : 0,
            canCreate: effectivePerms[role.key]?.[mod.key]?.canCreate ? 1 : 0,
            canEdit: effectivePerms[role.key]?.[mod.key]?.canEdit ? 1 : 0,
            canDelete: effectivePerms[role.key]?.[mod.key]?.canDelete ? 1 : 0,
          };
        }
      }
      const res = await apiRequest("PUT", `/api/tenants/${tenantId}/permissions`, { permissions: payload });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${tenantId}/permissions`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-permissions"] });
      toast({ title: "Permissões salvas com sucesso!" });
    },
    onError: () => toast({ title: "Erro ao salvar permissões", variant: "destructive" }),
  });

  if (!hasAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Acesso restrito a Administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-heading">Perfis de Acesso</h1>
            <p className="text-muted-foreground text-sm">Configure o que cada perfil pode ver e fazer no sistema</p>
          </div>
        </div>
        <div className="flex gap-2">
          {localPerms && (
            <Button variant="outline" size="sm" onClick={() => setLocalPerms(null)} data-testid="button-reset-perms">
              <RotateCcw className="h-4 w-4 mr-1" /> Descartar
            </Button>
          )}
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !tenantId} data-testid="button-save-perms">
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium min-w-[160px]">Módulo</th>
                {ROLES.map(role => (
                  <th key={role.key} colSpan={4} className="px-2 py-3 text-center border-l">
                    <Badge className={role.color + " font-medium"}>{role.label}</Badge>
                  </th>
                ))}
              </tr>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left"></th>
                {ROLES.map(role => PERM_TYPES.map(pt => (
                  <th key={`${role.key}-${pt.key}`} className="px-2 py-2 text-center font-normal">{pt.label}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {ALL_MODULES.map((mod, idx) => (
                <tr key={mod.key} className={`border-b hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                  <td className="px-4 py-3 font-medium">{mod.label}</td>
                  {ROLES.map((role, ri) => PERM_TYPES.map((pt, pi) => (
                    <td key={`${role.key}-${pt.key}`} className={`px-2 py-3 text-center ${ri > 0 && pi === 0 ? 'border-l' : ''}`}>
                      <Switch
                        checked={effectivePerms[role.key]?.[mod.key]?.[pt.key] ?? false}
                        onCheckedChange={() => toggle(role.key, mod.key, pt.key)}
                        className="scale-75"
                        data-testid={`switch-${role.key}-${mod.key}-${pt.key}`}
                      />
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        As permissões são aplicadas automaticamente à navegação e às ações disponíveis para cada perfil.
        Alterações entram em vigor no próximo login do usuário.
      </p>
    </div>
  );
}
