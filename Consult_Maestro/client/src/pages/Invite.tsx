import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: inviteData, isLoading, error } = useQuery<{
    invite: any;
    tenant: any;
  }>({
    queryKey: [`/api/invites/${token}`],
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invites/${token}/accept`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Convite aceito! Bem-vindo à equipe." });
      navigate("/");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao aceitar convite", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Skeleton className="h-12 w-64 mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
      </div>
    );
  }

  if (error || !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardHeader className="text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
            <CardTitle>Convite Inválido</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground">
              Este convite não existe, expirou ou já foi utilizado.
            </p>
            <Button className="mt-4" onClick={() => navigate("/")} variant="outline">
              Ir para o início
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invite, tenant } = inviteData;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full" data-testid="card-invite">
        <CardHeader className="text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-3">
            {tenant?.logoUrl ? (
              <img src={tenant.logoUrl} alt={tenant.name} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <Building2 className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle data-testid="text-invite-tenant">{tenant?.name}</CardTitle>
          <p className="text-muted-foreground text-sm">
            Você foi convidado para fazer parte desta equipe
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Convite para</span>
              <span className="text-sm font-medium" data-testid="text-invite-email">{invite.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Perfil</span>
              <Badge variant="outline" className="text-xs">
                {invite.role === 'admin' ? 'Administrador' : invite.role === 'gerente' ? 'Gerente' : 'Técnico'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Válido até</span>
              <div className="flex items-center gap-1 text-sm">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span>{new Date(invite.expiresAt).toLocaleDateString('pt-BR')}</span>
              </div>
            </div>
          </div>

          {!user ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Para aceitar este convite, você precisa fazer login ou criar uma conta.
              </p>
              <Button className="w-full" asChild data-testid="button-invite-login">
                <a href={`/api/login?redirect=/convite/${token}`}>
                  Entrar / Criar Conta
                </a>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Você está logado como <strong>{user.email}</strong>. Clique abaixo para aceitar o convite.
              </p>
              <Button
                className="w-full"
                onClick={() => acceptMutation.mutate()}
                disabled={acceptMutation.isPending}
                data-testid="button-accept-invite"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {acceptMutation.isPending ? "Aceitando convite..." : "Aceitar Convite"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
