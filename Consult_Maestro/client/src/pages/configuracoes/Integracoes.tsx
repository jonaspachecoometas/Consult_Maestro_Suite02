import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, XCircle, Loader2, RefreshCcw, Trash2, ExternalLink, ShieldCheck, AlertTriangle, MessageSquare } from "lucide-react";
import { SiGoogle, SiWhatsapp } from "react-icons/si";
import { FaMicrosoft } from "react-icons/fa";

type ProviderName = "google" | "microsoft" | "whatsapp";

type PlatformStatus = {
  provider: ProviderName;
  configured: boolean;
  redirectUri?: string;
  enabled: boolean;
  updatedAt: string | null;
  clientIdMasked: string | null;
  tenantIdHint?: string | null;
};

type ProviderConnection = {
  provider: ProviderName;
  connected: boolean;
  accountEmail: string | null;
  scopes: string[];
  expiresAt: string | null;
  status: string | null;
  updatedAt: string | null;
  platformConfigured: boolean;
  phoneNumberId?: string | null;
  displayName?: string | null;
};

type ConnectionsResponse = {
  tenantId: string | null;
  providers: ProviderConnection[];
};

export default function ConfiguracoesIntegracoes() {
  const { toast } = useToast();
  const { isSuperadmin } = useSystemRole();

  // ─── Conexões do tenant ────────────────────────────────────────────────────
  const connQuery = useQuery<ConnectionsResponse>({
    queryKey: ["/api/oauth/connections"],
  });
  const tenantId = connQuery.data?.tenantId || null;
  const googleConn = connQuery.data?.providers.find((p) => p.provider === "google");
  const microsoftConn = connQuery.data?.providers.find((p) => p.provider === "microsoft");
  const whatsappConn = connQuery.data?.providers.find((p) => p.provider === "whatsapp");

  // ─── Listener para popup de OAuth (Google + Microsoft) ─────────────────────
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || typeof ev.data !== "object") return;
      const t = ev.data.type as string | undefined;
      const provider = (ev.data.provider as ProviderName | undefined) ||
        (t?.startsWith("arcadia:oauth:") ? (t.split(":")[2] as ProviderName) : undefined);
      if (provider === "google" || provider === "microsoft") {
        if (ev.data.ok) {
          toast({ title: `${provider === "google" ? "Google" : "Microsoft"} conectado!`, description: "Sua conta foi autorizada." });
        } else {
          toast({ title: "Conexão não concluída", description: "Tente novamente.", variant: "destructive" });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [toast]);

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6" data-testid="page-configuracoes-integracoes">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte serviços externos para que os agentes possam ler arquivos, enviar mensagens e criar registros em nome do seu tenant.
        </p>
      </div>

      {connQuery.data && !tenantId && (
        <div className="rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm flex gap-2 items-start" data-testid="warning-no-tenant">
          <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <strong>Sessão sem tenant ativo.</strong>{" "}
            Selecione um tenant no seletor superior para conectar contas. As configurações da plataforma podem ser feitas aqui mesmo.
          </div>
        </div>
      )}

      {/* ── Google ── */}
      {isSuperadmin && (
        <PlatformOAuthCard
          provider="google"
          providerLabel="Google"
          icon={<SiGoogle className="h-5 w-5" />}
          placeholderClientId="1234567890-abc.apps.googleusercontent.com"
          placeholderClientSecret="GOCSPX-…"
        />
      )}
      <ProviderConnectionCard
        provider="google"
        providerLabel="Google Workspace"
        description="Drive, Gmail, Calendar e Docs. Os tokens ficam criptografados; só esta organização vê os dados."
        icon={<SiGoogle className="h-5 w-5" />}
        connection={googleConn}
        tenantId={tenantId}
        isSuperadmin={isSuperadmin}
        loading={connQuery.isLoading}
        onRefresh={() => connQuery.refetch()}
      />

      {/* ── Microsoft 365 ── */}
      {isSuperadmin && (
        <PlatformOAuthCard
          provider="microsoft"
          providerLabel="Microsoft 365"
          icon={<FaMicrosoft className="h-5 w-5 text-[#0078D4]" />}
          placeholderClientId="00000000-0000-0000-0000-000000000000"
          placeholderClientSecret="••••••••••••"
        />
      )}
      <ProviderConnectionCard
        provider="microsoft"
        providerLabel="Microsoft 365"
        description="OneDrive, Outlook e Teams. Tokens criptografados; refresh automático via offline_access."
        icon={<FaMicrosoft className="h-5 w-5 text-[#0078D4]" />}
        connection={microsoftConn}
        tenantId={tenantId}
        isSuperadmin={isSuperadmin}
        loading={connQuery.isLoading}
        onRefresh={() => connQuery.refetch()}
      />

      {/* ── WhatsApp Business ── */}
      <WhatsappCard
        connection={whatsappConn}
        tenantId={tenantId}
        loading={connQuery.isLoading}
        onRefresh={() => connQuery.refetch()}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Platform OAuth card (superadmin) — reutilizado por google e microsoft
// ════════════════════════════════════════════════════════════════════════════
function PlatformOAuthCard({
  provider,
  providerLabel,
  icon,
  placeholderClientId,
  placeholderClientSecret,
  extraField,
}: {
  provider: "google" | "microsoft";
  providerLabel: string;
  icon: React.ReactNode;
  placeholderClientId: string;
  placeholderClientSecret: string;
  extraField?: { key: string; label: string; placeholder: string; help: string };
}) {
  const { toast } = useToast();
  const platformQuery = useQuery<PlatformStatus>({
    queryKey: [`/api/oauth/platform/${provider}`],
  });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUriOverride, setRedirectUriOverride] = useState("");
  const [extraValue, setExtraValue] = useState("");

  const savePlatform = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUri: redirectUriOverride.trim() || null,
      };
      if (extraField && extraValue.trim()) body[extraField.key] = extraValue.trim();
      const res = await apiRequest("PUT", `/api/oauth/platform/${provider}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configuração salva", description: `Credenciais ${providerLabel} armazenadas com segurança.` });
      setClientId(""); setClientSecret(""); setRedirectUriOverride(""); setExtraValue("");
      queryClient.invalidateQueries({ queryKey: [`/api/oauth/platform/${provider}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message || "Tente novamente.", variant: "destructive" }),
  });

  const removePlatform = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/oauth/platform/${provider}`); },
    onSuccess: () => {
      toast({ title: "Configuração removida" });
      queryClient.invalidateQueries({ queryKey: [`/api/oauth/platform/${provider}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card data-testid={`card-platform-${provider}`}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          <CardTitle>Configuração do app OAuth {providerLabel} (plataforma)</CardTitle>
        </div>
        <CardDescription>
          Visível só para superadmin. Cole aqui o Client ID e Client Secret. Ambos são criptografados (AES-256-GCM) antes de irem para o banco e nunca aparecem em logs ou no LLM.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {platformQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        )}
        {platformQuery.data && (
          <div className="rounded-md border p-3 bg-muted/30 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Status</span>
              {platformQuery.data.configured ? (
                <Badge className="bg-green-600 hover:bg-green-700" data-testid={`badge-platform-${provider}-status`}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Configurado
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid={`badge-platform-${provider}-status`}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Não configurado
                </Badge>
              )}
            </div>
            {platformQuery.data.configured && platformQuery.data.clientIdMasked && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Client ID</span>
                <code className="text-xs">{platformQuery.data.clientIdMasked}</code>
              </div>
            )}
            {platformQuery.data.redirectUri && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground">Redirect URI</span>
                <code className="text-xs break-all text-right">{platformQuery.data.redirectUri}</code>
              </div>
            )}
            <p className="text-xs text-muted-foreground pt-1">
              Adicione exatamente este URL em "Authorized redirect URIs" no console do {providerLabel}.
            </p>
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${provider}-client-id`}>Client ID</Label>
            <Input id={`${provider}-client-id`} data-testid={`input-platform-${provider}-client-id`}
              placeholder={placeholderClientId} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${provider}-client-secret`}>Client Secret</Label>
            <Input id={`${provider}-client-secret`} type="password" data-testid={`input-platform-${provider}-client-secret`}
              placeholder={placeholderClientSecret} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
            <p className="text-xs text-muted-foreground">Não exibimos o secret depois de salvar. Para trocar, basta colar um novo.</p>
          </div>
          {extraField && (
            <div className="space-y-1">
              <Label htmlFor={`${provider}-extra`}>{extraField.label}</Label>
              <Input id={`${provider}-extra`} data-testid={`input-platform-${provider}-extra`}
                placeholder={extraField.placeholder} value={extraValue} onChange={(e) => setExtraValue(e.target.value)} />
              <p className="text-xs text-muted-foreground">{extraField.help}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${provider}-redirect-uri`}>Redirect URI (opcional, override)</Label>
            <Input id={`${provider}-redirect-uri`} data-testid={`input-platform-${provider}-redirect-uri`}
              placeholder={platformQuery.data?.redirectUri || ""} value={redirectUriOverride} onChange={(e) => setRedirectUriOverride(e.target.value)} />
            <p className="text-xs text-muted-foreground">Deixe em branco para usar o padrão derivado do domínio atual.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          {platformQuery.data?.configured && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid={`button-platform-${provider}-remove`}>
                  <Trash2 className="h-4 w-4 mr-1" /> Remover
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover configuração da plataforma?</AlertDialogTitle>
                  <AlertDialogDescription>Todos os tenants conectados perderão acesso às tools {providerLabel} até que a configuração seja restaurada.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removePlatform.mutate()} data-testid={`button-platform-${provider}-remove-confirm`}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button onClick={() => savePlatform.mutate()}
            disabled={savePlatform.isPending || !clientId.trim() || !clientSecret.trim()}
            data-testid={`button-platform-${provider}-save`}>
            {savePlatform.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Salvar credenciais
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Provider connection card (tenant) — google + microsoft (mesma UX OAuth)
// ════════════════════════════════════════════════════════════════════════════
function ProviderConnectionCard({
  provider, providerLabel, description, icon, connection, tenantId, isSuperadmin, loading, onRefresh,
}: {
  provider: "google" | "microsoft";
  providerLabel: string;
  description: string;
  icon: React.ReactNode;
  connection: ProviderConnection | undefined;
  tenantId: string | null;
  isSuperadmin: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const disconnect = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/oauth/${provider}/disconnect`); },
    onSuccess: () => {
      toast({ title: `Conta ${providerLabel} desconectada` });
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
    },
    onError: (e: any) => toast({ title: "Erro ao desconectar", description: e?.message, variant: "destructive" }),
  });

  function handleConnect() {
    if (!tenantId) {
      toast({ title: "Tenant não identificado", description: "Recarregue a página e tente novamente.", variant: "destructive" });
      return;
    }
    const url = `/api/oauth/${provider}/connect?tenantId=${encodeURIComponent(tenantId)}`;
    const w = window.open(url, `arcadia-${provider}-oauth`, "width=520,height=680");
    if (!w) window.location.href = url;
  }

  return (
    <Card data-testid={`card-${provider}-connection`}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-white border flex items-center justify-center">{icon}</div>
          <div className="flex-1">
            <CardTitle>{providerLabel}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        )}

        {connection && !connection.platformConfigured && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex gap-2 items-start" data-testid={`warning-platform-missing-${provider}`}>
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <strong>Plataforma sem credenciais OAuth.</strong>{" "}
              {isSuperadmin ? "Configure o app OAuth no card acima antes de conectar." : `Peça ao superadmin para configurar o app OAuth ${providerLabel}.`}
            </div>
          </div>
        )}

        {connection && (
          <div className="rounded-md border p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Status</span>
              {connection.connected ? (
                <Badge className="bg-green-600 hover:bg-green-700" data-testid={`badge-${provider}-connected`}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Conectado
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid={`badge-${provider}-connected`}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Não conectado
                </Badge>
              )}
            </div>
            {connection.connected && connection.accountEmail && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Conta</span>
                <span data-testid={`text-${provider}-account-email`}>{connection.accountEmail}</span>
              </div>
            )}
            {connection.connected && connection.scopes.length > 0 && (
              <div>
                <span className="text-muted-foreground">Permissões</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {connection.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs font-normal">
                      {s.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^auth\//, "")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {connection.connected && connection.expiresAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Próxima renovação</span>
                <span className="text-xs">{new Date(connection.expiresAt).toLocaleString("pt-BR")}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {connection?.connected && (
            <>
              <Button variant="outline" size="sm" onClick={onRefresh} data-testid={`button-${provider}-refresh`}>
                <RefreshCcw className="h-4 w-4 mr-1" /> Atualizar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid={`button-${provider}-disconnect`}>
                    <Trash2 className="h-4 w-4 mr-1" /> Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar conta {providerLabel}?</AlertDialogTitle>
                    <AlertDialogDescription>Os agentes deixam de ter acesso a {providerLabel}. Você pode reconectar a qualquer momento.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnect.mutate()} data-testid={`button-${provider}-disconnect-confirm`}>Desconectar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Button onClick={handleConnect} disabled={!connection?.platformConfigured || !tenantId} data-testid={`button-${provider}-connect`}>
            <ExternalLink className="h-4 w-4 mr-1" />
            {connection?.connected ? "Reconectar" : `Conectar ${providerLabel}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WhatsApp card — config manual de access token + phoneNumberId
// ════════════════════════════════════════════════════════════════════════════
function WhatsappCard({
  connection, tenantId, loading, onRefresh,
}: {
  connection: ProviderConnection | undefined;
  tenantId: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/oauth/whatsapp", {
        accessToken: accessToken.trim(),
        phoneNumberId: phoneNumberId.trim(),
        businessAccountId: businessAccountId.trim() || undefined,
        displayName: displayName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "WhatsApp conectado", description: "Credenciais salvas com segurança." });
      setAccessToken(""); setPhoneNumberId(""); setBusinessAccountId(""); setDisplayName("");
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message || "Tente novamente.", variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/oauth/whatsapp"); },
    onSuccess: () => {
      toast({ title: "WhatsApp desconectado" });
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/connections"] });
    },
    onError: (e: any) => toast({ title: "Erro ao desconectar", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-whatsapp-connection">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-white border flex items-center justify-center">
            <SiWhatsapp className="h-5 w-5 text-[#25D366]" />
          </div>
          <div className="flex-1">
            <CardTitle>WhatsApp Business (Meta Cloud API)</CardTitle>
            <CardDescription>
              Envio de mensagens transacionais e templates aprovados. Não usa OAuth — credenciais geradas no Meta for Developers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        )}

        {connection && (
          <div className="rounded-md border p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Status</span>
              {connection.connected ? (
                <Badge className="bg-green-600 hover:bg-green-700" data-testid="badge-whatsapp-connected">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Conectado
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid="badge-whatsapp-connected">
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Não conectado
                </Badge>
              )}
            </div>
            {connection.connected && connection.phoneNumberId && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Phone Number ID</span>
                <code className="text-xs" data-testid="text-whatsapp-phone-id">{connection.phoneNumberId}</code>
              </div>
            )}
            {connection.connected && connection.displayName && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Display name</span>
                <span data-testid="text-whatsapp-display-name">{connection.displayName}</span>
              </div>
            )}
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wa-token">Permanent Access Token</Label>
            <Input id="wa-token" type="password" data-testid="input-whatsapp-token"
              placeholder="EAAG…" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            <p className="text-xs text-muted-foreground">Token nunca aparece em logs ou no LLM. Criptografado em repouso.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="wa-phone-id">Phone Number ID</Label>
              <Input id="wa-phone-id" data-testid="input-whatsapp-phone-id"
                placeholder="1234567890" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wa-business-id">Business Account ID</Label>
              <Input id="wa-business-id" data-testid="input-whatsapp-business-id"
                placeholder="9876543210" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-display-name">Nome de exibição (opcional)</Label>
            <Input id="wa-display-name" data-testid="input-whatsapp-display-name"
              placeholder="Arcádia Atendimento" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {connection?.connected && (
            <>
              <Button variant="outline" size="sm" onClick={onRefresh} data-testid="button-whatsapp-refresh">
                <RefreshCcw className="h-4 w-4 mr-1" /> Atualizar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid="button-whatsapp-disconnect">
                    <Trash2 className="h-4 w-4 mr-1" /> Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>Os agentes não conseguirão mais enviar mensagens via WhatsApp Business.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnect.mutate()} data-testid="button-whatsapp-disconnect-confirm">Desconectar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Button onClick={() => save.mutate()}
            disabled={save.isPending || !accessToken.trim() || !phoneNumberId.trim() || !tenantId}
            data-testid="button-whatsapp-save">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <MessageSquare className="h-4 w-4 mr-1" />}
            {connection?.connected ? "Atualizar" : "Conectar WhatsApp"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
