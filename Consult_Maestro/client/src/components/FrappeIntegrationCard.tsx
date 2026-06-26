import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Server, Plug, CheckCircle2, AlertCircle, Trash2, Save, Loader2 } from "lucide-react";

interface FrappeStatus {
  configured: boolean;
  url?: string;
}

export function FrappeIntegrationCard({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const { data: status, isLoading } = useQuery<FrappeStatus>({
    queryKey: ["/api/tenants", tenantId, "frappe"],
    enabled: !!tenantId,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/tenants/${tenantId}/frappe`, {
        url: url.trim(),
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "frappe"] });
      setApiKey(""); setApiSecret(""); setWebhookSecret("");
      toast({ title: "Conexão Frappe salva" });
    },
    onError: (err: any) =>
      toast({ title: "Erro ao salvar", description: err?.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const body =
        url || apiKey || apiSecret
          ? { url: url.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }
          : {};
      const res = await fetch(`/api/tenants/${tenantId}/frappe/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => toast({ title: "Conexão OK" }),
    onError: (err: any) =>
      toast({ title: "Falha na conexão", description: err?.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/tenants/${tenantId}/frappe`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "frappe"] });
      toast({ title: "Conexão removida" });
    },
  });

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/frappe/${tenantId}`
      : "";

  return (
    <Card data-testid="card-frappe-integration">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            Backend Frappe / ERPNext
          </CardTitle>
          {!isLoading &&
            (status?.configured ? (
              <Badge variant="default" className="gap-1" data-testid="badge-frappe-configured">
                <CheckCircle2 className="h-3 w-3" /> Conectado
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Não conectado
              </Badge>
            ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Conecte um site Frappe/ERPNext para usar como motor de dados (DocTypes, automações,
          eventos). Credenciais são criptografadas e nunca exibidas após salvas.
        </p>

        {status?.configured && status.url && (
          <div className="text-sm">
            <span className="text-muted-foreground">URL atual: </span>
            <span className="font-mono" data-testid="text-frappe-url">{status.url}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          <div>
            <Label htmlFor="frappe-url" className="text-xs">URL do site Frappe</Label>
            <Input
              id="frappe-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={status?.url || "https://impacto.arcadia.app"}
              data-testid="input-frappe-url"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="frappe-key" className="text-xs">API Key</Label>
              <Input
                id="frappe-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={status?.configured ? "•••••• (deixe vazio para manter)" : "api key"}
                data-testid="input-frappe-key"
              />
            </div>
            <div>
              <Label htmlFor="frappe-secret" className="text-xs">API Secret</Label>
              <Input
                id="frappe-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={status?.configured ? "•••••• (deixe vazio para manter)" : "api secret"}
                data-testid="input-frappe-secret"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="frappe-webhook" className="text-xs">
              Webhook Secret (opcional, usado para validar assinatura HMAC)
            </Label>
            <Input
              id="frappe-webhook"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="segredo compartilhado"
              data-testid="input-frappe-webhook-secret"
            />
            {webhookUrl && (
              <p className="text-[11px] text-muted-foreground mt-1">
                URL para configurar no Frappe:{" "}
                <span className="font-mono">{webhookUrl}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            variant="outline"
            data-testid="button-frappe-test"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plug className="h-4 w-4 mr-2" />
            )}
            Testar conexão
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !url || !apiKey || !apiSecret}
            data-testid="button-frappe-save"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
          {status?.configured && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm("Remover a conexão Frappe deste tenant?")) removeMutation.mutate();
              }}
              disabled={removeMutation.isPending}
              data-testid="button-frappe-remove"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Remover
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
