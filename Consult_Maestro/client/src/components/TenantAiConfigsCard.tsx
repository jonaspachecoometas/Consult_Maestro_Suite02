import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Loader2,
  CheckCircle2,
  Save,
  Trash2,
  Plug,
  Sparkles,
  Moon,
  HardDrive,
  AlertCircle,
} from "lucide-react";

type Provider = "anthropic" | "gemini" | "kimi" | "ollama";

interface AiConfigPublic {
  provider: Provider;
  configured: boolean;
  isActive: boolean;
  model: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
}

const PROVIDER_META: Record<Provider, { label: string; icon: any; defaultModel: string; needsKey: boolean; needsBaseUrl: boolean; placeholderKey: string; helpUrl: string; note?: string }> = {
  anthropic: {
    label: "Anthropic Claude",
    icon: Bot,
    defaultModel: "claude-sonnet-4-5-20250929",
    needsKey: true,
    needsBaseUrl: false,
    placeholderKey: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    label: "Google Gemini",
    icon: Sparkles,
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    needsBaseUrl: false,
    placeholderKey: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
  },
  kimi: {
    label: "Kimi (Moonshot)",
    icon: Moon,
    defaultModel: "moonshot-v1-8k",
    needsKey: true,
    needsBaseUrl: true,
    placeholderKey: "sk-...",
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  ollama: {
    label: "Ollama (local)",
    icon: HardDrive,
    defaultModel: "llama3.1",
    needsKey: false,
    needsBaseUrl: true,
    placeholderKey: "",
    helpUrl: "https://ollama.com/download",
    note: "Servidor Ollama deve estar acessível pelo backend. Os dados ficam no servidor configurado.",
  },
};

function ProviderCard({ config, endpoint }: { config: AiConfigPublic; endpoint: string }) {
  const { toast } = useToast();
  const meta = PROVIDER_META[config.provider];
  const Icon = meta.icon;

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config.model ?? meta.defaultModel);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? "");
  const [isActive, setIsActive] = useState(config.isActive);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { provider: config.provider, model, isActive };
      if (apiKey.length > 0) body.apiKey = apiKey;
      if (meta.needsBaseUrl) body.baseUrl = baseUrl;
      const r = await apiRequest("POST", endpoint, body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      setApiKey("");
      toast({ title: `${meta.label} salvo` });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao salvar", description: e?.message ?? String(e), variant: "destructive" });
    },
  });

  const test = useMutation({
    mutationFn: async () => {
      const body: any = { provider: config.provider };
      if (apiKey.length > 0) body.apiKey = apiKey;
      if (meta.needsBaseUrl && baseUrl.length > 0) body.baseUrl = baseUrl;
      const r = await apiRequest("POST", `${endpoint}/test`, body);
      return r.json();
    },
    onSuccess: (result: any) => {
      setTestResult({ ok: !!result.ok, message: result.message ?? "" });
      toast({
        title: result.ok ? "Conexão OK" : "Falha na conexão",
        description: result.message,
        variant: result.ok ? "default" : "destructive",
      });
    },
    onError: (e: any) => {
      setTestResult({ ok: false, message: e?.message ?? String(e) });
      toast({ title: "Erro ao testar", description: e?.message ?? String(e), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", `${endpoint}/${config.provider}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      setApiKey("");
      setTestResult(null);
      toast({ title: `${meta.label} removido` });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao remover", description: e?.message ?? String(e), variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-ai-${config.provider}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{meta.label}</CardTitle>
          </div>
          {config.configured ? (
            <Badge variant="default" className="gap-1" data-testid={`badge-status-${config.provider}`}>
              <CheckCircle2 className="h-3 w-3" />
              Conectado
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid={`badge-status-${config.provider}`}>Usando padrão da plataforma</Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {meta.note ?? (
            <a href={meta.helpUrl} target="_blank" rel="noreferrer" className="underline hover:text-primary">
              Onde obter a chave?
            </a>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {meta.needsKey && (
          <div className="space-y-1">
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.configured ? "•••••••••••••••• (deixe vazio para manter)" : meta.placeholderKey}
              data-testid={`input-key-${config.provider}`}
              autoComplete="new-password"
            />
          </div>
        )}

        {meta.needsBaseUrl && (
          <div className="space-y-1">
            <Label className="text-xs">{config.provider === "ollama" ? "Base URL do servidor Ollama" : "Base URL (opcional)"}</Label>
            <Input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={config.provider === "ollama" ? "http://localhost:11434" : "https://api.moonshot.cn/v1"}
              data-testid={`input-baseurl-${config.provider}`}
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Modelo</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={meta.defaultModel}
            data-testid={`input-model-${config.provider}`}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              data-testid={`switch-active-${config.provider}`}
            />
            <Label className="text-xs cursor-pointer">Ativo</Label>
          </div>
          {testResult && (
            <span className={`text-xs flex items-center gap-1 ${testResult.ok ? "text-emerald-600" : "text-destructive"}`}>
              {testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {testResult.message}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            data-testid={`button-save-${config.provider}`}
          >
            {save.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
            Salvar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            data-testid={`button-test-${config.provider}`}
          >
            {test.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plug className="h-3 w-3 mr-1" />}
            Testar
          </Button>
          {config.configured && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="text-destructive hover:text-destructive"
              data-testid={`button-remove-${config.provider}`}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remover
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface AiConfigsCardProps {
  endpoint?: string;
  title?: string;
  description?: string;
}

export function TenantAiConfigsCard({
  endpoint = "/api/ai/config",
  title = "IA & Modelos",
  description = "Configure as chaves dos provedores de IA usados pelos agentes deste tenant. Sem chave = usa o provider padrão da plataforma.",
}: AiConfigsCardProps = {}) {
  const { data: configs = [], isLoading } = useQuery<AiConfigPublic[]>({
    queryKey: [endpoint],
  });

  return (
    <Card data-testid="card-ai-configs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {configs.map((c) => (
              <ProviderCard key={c.provider} config={c} endpoint={endpoint} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
