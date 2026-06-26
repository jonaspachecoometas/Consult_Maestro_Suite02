import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Building2, Users, Mail, Send, KeyRound } from "lucide-react";
import { Link } from "wouter";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tenant, TenantUser } from "@shared/schema";

export default function PartnerTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { isPartner, isSuperadmin } = useSystemRole();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const hasAccess = isPartner || isSuperadmin;

  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenants", id],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!id && hasAccess,
  });

  const { data: tenantUsers, isLoading: usersLoading } = useQuery<(TenantUser & { user?: any })[]>({
    queryKey: [`/api/tenants/${id}/users`],
    queryFn: async () => {
      const res = await fetch(`/api/tenants/${id}/users`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && hasAccess,
  });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", `/api/tenants/${id}/invites`, { email, role: "admin" });
      return res.json();
    },
    onSuccess: (invite) => {
      toast({
        title: "Convite enviado!",
        description: `Link: ${window.location.origin}${invite.inviteUrl}`,
      });
      setIsInviteOpen(false);
      setInviteEmail("");
    },
    onError: () => {
      toast({ title: "Erro ao enviar convite", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Tenant não encontrado</p>
        <Button variant="outline" asChild className="mt-4">
          <Link href="/partner/tenants">Voltar aos Tenants</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/partner/tenants">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {tenant.logoUrl ? (
              <img src={tenant.logoUrl} alt={tenant.name} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <Building2 className="h-6 w-6 text-primary" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading" data-testid="text-tenant-name">{tenant.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>{getStatusLabel(tenant.status)}</Badge>
              <Badge variant="outline">{getPlanLabel(tenant.plan)}</Badge>
              {tenant.sector && <span className="text-xs text-muted-foreground">{tenant.sector}</span>}
            </div>
          </div>
        </div>
        <Button onClick={() => setIsInviteOpen(true)} data-testid="button-invite-user">
          <Send className="h-4 w-4 mr-2" /> Convidar Usuário
        </Button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Email Admin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{tenant.adminEmail || "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usuários</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{tenantUsers?.length ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Criado em</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm">
              {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("pt-BR") : "—"}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Users list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Usuários do Tenant
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {usersLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : tenantUsers && tenantUsers.length > 0 ? (
            <div className="divide-y">
              {tenantUsers.map((tu) => (
                <div key={tu.id} className="flex items-center justify-between p-4" data-testid={`row-tenant-user-${tu.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {(tu.user?.firstName?.[0] || tu.user?.email?.[0] || "?").toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {[tu.user?.firstName, tu.user?.lastName].filter(Boolean).join(" ") || tu.user?.email || "Usuário"}
                      </p>
                      <p className="text-xs text-muted-foreground">{tu.user?.email}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{tu.role}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Nenhum usuário ainda. Convide alguém para começar.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setIsInviteOpen(true)}>
                <Send className="h-4 w-4 mr-2" /> Enviar Convite
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Convidar Usuário para {tenant.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Um link de acesso será gerado. Compartilhe com o usuário para que ele crie sua senha.
          </p>
          <div className="space-y-2">
            <Label>Email do usuário</Label>
            <Input
              type="email"
              placeholder="usuario@empresa.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              data-testid="input-invite-email"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsInviteOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => inviteEmail && inviteMutation.mutate(inviteEmail)}
              disabled={!inviteEmail || inviteMutation.isPending}
              data-testid="button-send-invite"
            >
              {inviteMutation.isPending ? "Enviando..." : "Enviar Convite"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
