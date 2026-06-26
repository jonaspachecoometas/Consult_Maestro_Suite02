// Sprint 7 — Wizard de Onboarding (zero-terminal).
// Guia o parceiro do cadastro do Coolify até o primeiro Frappe provisionado.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Server,
  GitBranch,
  Boxes,
  Rocket,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Copy,
  PartyPopper,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Step = 0 | 1 | 2 | 3 | 4;

type ServerRow = {
  id: string;
  name: string;
  coolifyUrl: string;
  serviceType: "coolify" | "gitea";
  status: string;
};

type ServiceRow = {
  uuid: string;
  name: string;
  type?: string;
  fqdn?: string | null;
  url?: string | null;
  status?: string;
};

type ProvKind = "frappe" | "consult" | "suite" | "custom";

type WizardState = {
  step: Step;
  coolifyServerId?: string;
  giteaServerId?: string;
  provKind?: ProvKind;
  // dados do passo 4
  frappe: {
    clienteName: string;
    subdomain: string;
    adminEmail: string;
    adminPassword: string;
    domain: string;
  };
  generic: {
    name: string;
    dockerImage: string;
    port: string;
    domain: string;
    envText: string;
  };
};

const LS_KEY = "arcadia.onboarding.v1";

function loadState(): WizardState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {/* ignore */}
  return defaultState();
}
function defaultState(): WizardState {
  return {
    step: 0,
    frappe: {
      clienteName: "",
      subdomain: "",
      adminEmail: "",
      adminPassword: "",
      domain: "arcadia.app",
    },
    generic: {
      name: "",
      dockerImage: "",
      port: "",
      domain: "",
      envText: "",
    },
  };
}

const STEP_LABELS = [
  "Conectar Coolify",
  "Conectar Gitea",
  "Tipo de provisionamento",
  "Configurar",
  "Provisionar",
];

export default function OnboardingWizard() {
  const { toast } = useToast();
  const [state, setState] = useState<WizardState>(() => loadState());

  // Persiste a cada mudança.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {/* ignore */}
  }, [state]);

  const goTo = (step: Step) => setState((s) => ({ ...s, step }));
  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const resetWizard = () => {
    try { localStorage.removeItem(LS_KEY); } catch {/* ignore */}
    setState(defaultState());
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="page-onboarding">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurar novo servidor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Em 5 passos seu cliente fica com Frappe (ou outro app) rodando — sem terminal.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={resetWizard} data-testid="button-reset-wizard">
          Recomeçar
        </Button>
      </div>

      <Stepper current={state.step} />

      {state.step === 0 && (
        <Step1Coolify
          selectedId={state.coolifyServerId}
          onPick={(id) => patch({ coolifyServerId: id })}
          onNext={() => goTo(1)}
        />
      )}
      {state.step === 1 && (
        <Step2Gitea
          coolifyServerId={state.coolifyServerId!}
          selectedId={state.giteaServerId}
          onPick={(id) => patch({ giteaServerId: id })}
          onBack={() => goTo(0)}
          onNext={() => goTo(2)}
        />
      )}
      {state.step === 2 && (
        <Step3Type
          value={state.provKind}
          onPick={(k) => patch({ provKind: k })}
          onBack={() => goTo(1)}
          onNext={() => goTo(3)}
        />
      )}
      {state.step === 3 && (
        <Step4Configure
          state={state}
          onChange={patch}
          onBack={() => goTo(2)}
          onNext={() => goTo(4)}
        />
      )}
      {state.step === 4 && (
        <Step5Provision
          state={state}
          onBack={() => goTo(3)}
          onFinishedReset={resetWizard}
          onToast={(t) => toast(t)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Stepper
// ============================================================================
function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto" data-testid="stepper">
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-2 shrink-0">
            <div
              className={
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border " +
                (active
                  ? "bg-primary text-primary-foreground border-primary"
                  : done
                  ? "bg-muted text-foreground border-muted"
                  : "bg-background text-muted-foreground border-border")
              }
              data-testid={`step-indicator-${i}`}
            >
              <span className="font-medium">{i + 1}.</span>
              <span>{label}</span>
              {done && <CheckCircle2 className="h-4 w-4" />}
            </div>
            {i < STEP_LABELS.length - 1 && <div className="h-px w-6 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Passo 1 — Conectar Coolify
// ============================================================================
function Step1Coolify({
  selectedId, onPick, onNext,
}: {
  selectedId?: string;
  onPick: (id: string) => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const { data: servers = [], isLoading } = useQuery<ServerRow[]>({ queryKey: ["/api/infra/servers"] });
  const coolifyServers = useMemo(() => servers.filter((s) => s.serviceType === "coolify"), [servers]);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/infra/servers/test-connection", {
        coolifyUrl: url, token, serviceType: "coolify",
      });
      return await res.json();
    },
    onSuccess: (r) => {
      if (r.ok) setTestResult({ ok: true, message: "Conexão validada com sucesso." });
      else setTestResult({ ok: false, message: `${r.code ?? "erro"}: ${r.message ?? "Falha desconhecida"}` });
    },
    onError: (e: any) => setTestResult({ ok: false, message: e?.message ?? "Erro de rede" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/infra/servers", {
        name, coolifyUrl: url, apiToken: token, serviceType: "coolify",
      });
      return await res.json() as ServerRow;
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
      onPick(s.id);
      toast({ title: "Coolify conectado", description: s.name });
      onNext();
    },
    onError: (e: any) => toast({ title: "Falha ao salvar", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Card data-testid="step1-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> Conectar ao Coolify</CardTitle>
        <CardDescription>
          Cole a URL e o token de API do seu Coolify. Validamos a conexão antes de salvar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {coolifyServers.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm">Já existem servidores Coolify cadastrados:</Label>
            <div className="flex flex-wrap gap-2">
              {coolifyServers.map((s) => (
                <Button
                  key={s.id}
                  variant={selectedId === s.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => { onPick(s.id); }}
                  data-testid={`button-pick-server-${s.id}`}
                >
                  {s.name} <Badge variant="secondary" className="ml-2">{s.status}</Badge>
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione um existente para pular esta etapa, ou cadastre um novo abaixo.
            </p>
          </div>
        )}

        <Separator />

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="srv-name">Nome amigável</Label>
            <Input id="srv-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Coolify produção" data-testid="input-coolify-name" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="srv-url">URL do Coolify</Label>
            <Input id="srv-url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://coolify.suaempresa.com" data-testid="input-coolify-url" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="srv-token">Token de API</Label>
            <Input id="srv-token" type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="•••••••••••••" data-testid="input-coolify-token" />
            <p className="text-xs text-muted-foreground">
              Em Coolify: Settings → API → Create token (escopo Read &amp; Write).
            </p>
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? "default" : "destructive"} data-testid={testResult.ok ? "alert-test-ok" : "alert-test-error"}>
            {testResult.ok
              ? <CheckCircle2 className="h-4 w-4" />
              : <AlertCircle className="h-4 w-4" />}
            <AlertTitle>{testResult.ok ? "Conectado" : "Falha na conexão"}</AlertTitle>
            <AlertDescription className="break-all">{testResult.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline"
          disabled={!url || !token || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          data-testid="button-test-coolify"
        >
          {testMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Testar conexão
        </Button>
        <div className="flex gap-2">
          {selectedId && (
            <Button onClick={onNext} data-testid="button-next-existing">
              Usar selecionado <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
          <Button
            disabled={!name || !url || !token || saveMutation.isPending || !(testResult?.ok)}
            onClick={() => saveMutation.mutate()}
            data-testid="button-save-coolify"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar e avançar <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </CardFooter>
      {isLoading && <p className="text-xs text-muted-foreground px-6 pb-4">Carregando servidores…</p>}
    </Card>
  );
}

// ============================================================================
// Passo 2 — Conectar Gitea
// ============================================================================
function Step2Gitea({
  coolifyServerId, selectedId, onPick, onBack, onNext,
}: {
  coolifyServerId: string;
  selectedId?: string;
  onPick: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const { data: servers = [] } = useQuery<ServerRow[]>({ queryKey: ["/api/infra/servers"] });
  const giteaServers = useMemo(() => servers.filter((s) => s.serviceType === "gitea"), [servers]);

  // Sprint 7 — auto-detect Gitea entre os serviços do Coolify selecionado.
  const { data: coolifyServices = [], isLoading: loadingServices } = useQuery<ServiceRow[]>({
    queryKey: ["/api/infra/servers", coolifyServerId, "services"],
    queryFn: async () => {
      const res = await fetch(`/api/infra/servers/${coolifyServerId}/services`, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
    enabled: !!coolifyServerId,
  });
  const detectedGitea = useMemo(
    () => coolifyServices.find((s) => /gitea/i.test(s.name) || /gitea/i.test(s.type ?? "")),
    [coolifyServices],
  );

  // Auto-install Gitea via Coolify (POST /servers/:id/services).
  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/infra/servers/${coolifyServerId}/services`, {
        payload: {
          name: "gitea",
          type: "docker-image",
          docker_image: "gitea/gitea:latest",
          instant_deploy: true,
        },
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers", coolifyServerId, "services"] });
      toast({
        title: "Gitea sendo instalado",
        description: "Pode levar alguns minutos. Quando ele responder, volte aqui para conectar com um token.",
      });
    },
    onError: (e: any) => toast({ title: "Falha ao instalar", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const [name, setName] = useState("");
  const [url, setUrl] = useState(detectedGitea?.fqdn || detectedGitea?.url || "");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Quando detectamos um Gitea, pré-preenche a URL para o usuário só colar o token.
  useEffect(() => {
    if (detectedGitea && !url) {
      const u = detectedGitea.fqdn || detectedGitea.url;
      if (u) setUrl(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedGitea?.uuid]);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/infra/servers/test-connection", {
        coolifyUrl: url, token, serviceType: "gitea",
      });
      return await res.json();
    },
    onSuccess: (r) => {
      if (r.ok) setTestResult({ ok: true, message: "Gitea respondeu com sucesso." });
      else setTestResult({ ok: false, message: `${r.code ?? "erro"}: ${r.message ?? "Falha"}` });
    },
    onError: (e: any) => setTestResult({ ok: false, message: e?.message ?? "Erro de rede" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/infra/servers", {
        name, coolifyUrl: url, apiToken: token, serviceType: "gitea",
      });
      return await res.json() as ServerRow;
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
      onPick(s.id);
      toast({ title: "Gitea conectado", description: s.name });
      onNext();
    },
    onError: (e: any) => toast({ title: "Falha ao salvar", description: e?.message ?? String(e), variant: "destructive" }),
  });

  return (
    <Card data-testid="step2-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" /> Conectar ao Gitea</CardTitle>
        <CardDescription>
          O Gitea é onde o Dev Center grava os artefatos versionados. Você pode usar
          um Gitea existente ou pular esta etapa por enquanto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {giteaServers.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm">Gitea já cadastrados:</Label>
            <div className="flex flex-wrap gap-2">
              {giteaServers.map((s) => (
                <Button
                  key={s.id}
                  variant={selectedId === s.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPick(s.id)}
                  data-testid={`button-pick-gitea-${s.id}`}
                >
                  {s.name} <Badge variant="secondary" className="ml-2">{s.status}</Badge>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Auto-detecção / instalação no Coolify */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="gitea-detect-block">
          <div className="text-sm font-medium">Detectar Gitea no Coolify</div>
          {loadingServices ? (
            <p className="text-xs text-muted-foreground">Procurando…</p>
          ) : detectedGitea ? (
            <div className="text-sm flex items-center gap-2" data-testid="gitea-detected">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>
                Encontrado: <span className="font-mono">{detectedGitea.name}</span>
                {detectedGitea.fqdn && <> em <span className="font-mono">{detectedGitea.fqdn}</span></>}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Nenhum serviço Gitea encontrado neste Coolify. Você pode instalar com 1 clique
                (imagem oficial gitea/gitea:latest) ou configurar manualmente abaixo.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => installMutation.mutate()}
                disabled={installMutation.isPending}
                data-testid="button-install-gitea"
              >
                {installMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Instalar Gitea automaticamente
              </Button>
            </div>
          )}
        </div>

        <Separator />

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="git-name">Nome amigável</Label>
            <Input id="git-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Gitea cliente X" data-testid="input-gitea-name" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="git-url">URL do Gitea</Label>
            <Input id="git-url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://git.suaempresa.com" data-testid="input-gitea-url" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="git-token">Token de acesso</Label>
            <Input id="git-token" type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="•••••••••••••" data-testid="input-gitea-token" />
            <p className="text-xs text-muted-foreground">
              Em Gitea: Settings → Applications → Generate Token (escopos repo + write:repository).
            </p>
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? "default" : "destructive"}>
            {testResult.ok
              ? <CheckCircle2 className="h-4 w-4" />
              : <AlertCircle className="h-4 w-4" />}
            <AlertTitle>{testResult.ok ? "Conectado" : "Falha na conexão"}</AlertTitle>
            <AlertDescription className="break-all">{testResult.message}</AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sem Gitea? Sem problema.</AlertTitle>
          <AlertDescription>
            O Gitea só é exigido quando você for usar o versionamento do Dev Center.
            Você pode pular esta etapa e cadastrar depois em Infraestrutura.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <div className="flex gap-2">
          <Button variant="outline"
            disabled={!url || !token || testMutation.isPending}
            onClick={() => testMutation.mutate()}
            data-testid="button-test-gitea"
          >
            {testMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Testar
          </Button>
          {selectedId && (
            <Button onClick={onNext} data-testid="button-use-gitea-existing">
              Usar selecionado <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
          <Button variant="outline" onClick={onNext} data-testid="button-skip-gitea">
            Pular por enquanto
          </Button>
          <Button
            disabled={!name || !url || !token || saveMutation.isPending || !(testResult?.ok)}
            onClick={() => saveMutation.mutate()}
            data-testid="button-save-gitea"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar e avançar <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// Passo 3 — Tipo de provisionamento
// ============================================================================
function Step3Type({
  value, onPick, onBack, onNext,
}: {
  value?: ProvKind;
  onPick: (k: ProvKind) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const opts: Array<{ key: ProvKind; title: string; desc: string; icon: any; available: boolean }> = [
    { key: "frappe", title: "Frappe / ERPNext", desc: "ERP completo com módulos financeiro, vendas, RH e estoque.", icon: Boxes, available: true },
    { key: "consult", title: "Arcádia Consult", desc: "Aplicação consultiva pronta — em breve.", icon: Rocket, available: false },
    { key: "suite", title: "Arcádia Suite", desc: "Pacote completo de aplicações Arcádia — em breve.", icon: Rocket, available: false },
    { key: "custom", title: "Custom Docker", desc: "Qualquer imagem Docker pública (genérico).", icon: Server, available: true },
  ];
  return (
    <Card data-testid="step3-card">
      <CardHeader>
        <CardTitle>O que vamos provisionar?</CardTitle>
        <CardDescription>Escolha o tipo de aplicação que será criada no Coolify.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opts.map((o) => {
            const Icon = o.icon;
            const selected = value === o.key;
            return (
              <button
                key={o.key}
                disabled={!o.available}
                onClick={() => onPick(o.key)}
                className={
                  "text-left rounded-lg border p-4 transition-colors " +
                  (!o.available
                    ? "opacity-50 cursor-not-allowed border-border"
                    : selected
                    ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/40")
                }
                data-testid={`card-type-${o.key}`}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2"><Icon className="h-5 w-5 text-primary" /></div>
                  <div className="flex-1">
                    <div className="font-semibold flex items-center gap-2">
                      {o.title}
                      {!o.available && <Badge variant="outline" className="text-xs">em breve</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{o.desc}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step3">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <Button disabled={!value} onClick={onNext} data-testid="button-next-step3">
          Avançar <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// Passo 4 — Configurar
// ============================================================================
function Step4Configure({
  state, onChange, onBack, onNext,
}: {
  state: WizardState;
  onChange: (p: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const isFrappe = state.provKind === "frappe";
  const isCustom = state.provKind === "custom";

  const setFrappe = (k: keyof WizardState["frappe"], v: string) =>
    onChange({ frappe: { ...state.frappe, [k]: v } });
  const setGeneric = (k: keyof WizardState["generic"], v: string) =>
    onChange({ generic: { ...state.generic, [k]: v } });

  const valid = isFrappe
    ? !!(state.frappe.clienteName && state.frappe.subdomain && state.frappe.adminEmail && state.frappe.adminPassword.length >= 8)
    : isCustom
    ? !!(state.generic.name && state.generic.dockerImage)
    : false;

  return (
    <Card data-testid="step4-card">
      <CardHeader>
        <CardTitle>Configurar</CardTitle>
        <CardDescription>
          Preencha os dados específicos da aplicação a ser provisionada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isFrappe && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="cli-name">Nome do cliente</Label>
              <Input id="cli-name" value={state.frappe.clienteName}
                onChange={(e) => setFrappe("clienteName", e.target.value)}
                placeholder="Cliente Acme Ltda." data-testid="input-cliente-name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="sub">Subdomínio</Label>
                <Input id="sub" value={state.frappe.subdomain}
                  onChange={(e) => setFrappe("subdomain", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="acme" data-testid="input-subdomain" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dom">Domínio raiz</Label>
                <Input id="dom" value={state.frappe.domain}
                  onChange={(e) => setFrappe("domain", e.target.value)}
                  placeholder="arcadia.app" data-testid="input-domain" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              URL final: <span className="font-mono">https://{state.frappe.subdomain || "<sub>"}.{state.frappe.domain || "<dom>"}</span>
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="adm-email">E-mail do administrador</Label>
              <Input id="adm-email" type="email" value={state.frappe.adminEmail}
                onChange={(e) => setFrappe("adminEmail", e.target.value)}
                placeholder="admin@cliente.com" data-testid="input-admin-email" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adm-pwd">Senha do administrador (mín. 8)</Label>
              <Input id="adm-pwd" type="password" value={state.frappe.adminPassword}
                onChange={(e) => setFrappe("adminPassword", e.target.value)}
                placeholder="••••••••" data-testid="input-admin-password" />
            </div>
          </>
        )}

        {isCustom && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="g-name">Nome do serviço</Label>
              <Input id="g-name" value={state.generic.name}
                onChange={(e) => setGeneric("name", e.target.value)}
                placeholder="meu-app" data-testid="input-generic-name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-img">Imagem Docker</Label>
              <Input id="g-img" value={state.generic.dockerImage}
                onChange={(e) => setGeneric("dockerImage", e.target.value)}
                placeholder="nginx:latest" data-testid="input-docker-image" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="g-port">Porta exposta (opcional)</Label>
                <Input id="g-port" value={state.generic.port}
                  onChange={(e) => setGeneric("port", e.target.value)}
                  placeholder="80" data-testid="input-port" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="g-dom">Domínio (opcional)</Label>
                <Input id="g-dom" value={state.generic.domain}
                  onChange={(e) => setGeneric("domain", e.target.value)}
                  placeholder="meu-app.cliente.com" data-testid="input-generic-domain" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-env">Variáveis de ambiente (KEY=VALUE por linha, opcional)</Label>
              <Textarea id="g-env" rows={4} value={state.generic.envText}
                onChange={(e) => setGeneric("envText", e.target.value)}
                placeholder={"NODE_ENV=production\nLOG_LEVEL=info"}
                data-testid="textarea-env" />
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <Button disabled={!valid} onClick={onNext} data-testid="button-next-step4">
          Revisar e provisionar <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// Passo 5 — Provisionar com SSE
// ============================================================================
type SseStep = { label: string; status: "pending" | "running" | "ok" | "error"; message?: string };
type SseUpdate = {
  jobId: string;
  steps: SseStep[];
  coolifyId?: string;
  publicUrl?: string;
  credentials?: Record<string, string>;
  error?: string;
  done?: boolean;
};

function Step5Provision({
  state, onBack, onFinishedReset, onToast,
}: {
  state: WizardState;
  onBack: () => void;
  onFinishedReset: () => void;
  onToast: (t: { title: string; description?: string; variant?: any }) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [update, setUpdate] = useState<SseUpdate | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!state.coolifyServerId) throw new Error("Selecione um servidor Coolify (passo 1).");
      if (state.provKind === "frappe") {
        const res = await apiRequest("POST", "/api/infra/provision/frappe", {
          serverId: state.coolifyServerId,
          clienteName: state.frappe.clienteName,
          subdomain: state.frappe.subdomain,
          adminEmail: state.frappe.adminEmail,
          adminPassword: state.frappe.adminPassword,
          domain: state.frappe.domain,
        });
        return await res.json() as { jobId: string };
      }
      // generic
      const env: Record<string, string> = {};
      state.generic.envText.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) env[m[1]] = m[2];
      });
      const res = await apiRequest("POST", "/api/infra/provision/generic", {
        serverId: state.coolifyServerId,
        name: state.generic.name,
        dockerImage: state.generic.dockerImage,
        port: state.generic.port ? Number(state.generic.port) : undefined,
        env,
        domain: state.generic.domain || undefined,
      });
      return await res.json() as { jobId: string };
    },
    onSuccess: (r) => setJobId(r.jobId),
    onError: (e: any) => onToast({ title: "Não foi possível iniciar", description: e?.message ?? String(e), variant: "destructive" }),
  });

  // SSE
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/infra/provision/${jobId}/stream`, { withCredentials: true });
    sseRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as SseUpdate;
        setUpdate(data);
        if (data.done) es.close();
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      // Backend fecha após done=true; tratamos só erros antes do done.
      if (!update?.done) {
        setUpdate((u) => ({ ...(u ?? { jobId, steps: [] }), error: "Conexão de progresso perdida.", done: true }));
      }
      es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const totalSteps = update?.steps.length ?? 6;
  const okSteps = update?.steps.filter((s) => s.status === "ok").length ?? 0;
  const progress = Math.round((okSteps / totalSteps) * 100);
  const finished = !!update?.done;
  const successful = finished && !update?.error;

  // Resumo da configuração
  const summary = state.provKind === "frappe"
    ? [
        ["Cliente", state.frappe.clienteName],
        ["Subdomínio", `${state.frappe.subdomain}.${state.frappe.domain}`],
        ["Admin", state.frappe.adminEmail],
      ]
    : state.provKind === "custom"
    ? [
        ["Nome", state.generic.name],
        ["Imagem", state.generic.dockerImage],
        ["Porta", state.generic.port || "—"],
        ["Domínio", state.generic.domain || "—"],
      ]
    : [];

  return (
    <Card data-testid="step5-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" /> Provisionar</CardTitle>
        <CardDescription>
          Confira o resumo e clique em Provisionar agora. O processo é executado no Coolify
          em segundo plano e mostramos o progresso em tempo real.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-4">
          <div className="text-sm font-semibold mb-2">Resumo</div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {summary.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono break-all" data-testid={`summary-${k.toLowerCase().replace(/\s/g, "-")}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {!jobId && (
          <Button
            size="lg"
            className="w-full"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid="button-provision-now"
          >
            {startMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Provisionar agora
          </Button>
        )}

        {jobId && update && (
          <div className="space-y-3">
            <Progress value={progress} data-testid="provision-progress" />
            <ul className="space-y-2">
              {update.steps.map((st, i) => (
                <li key={i} className="flex items-start gap-3 text-sm" data-testid={`prov-step-${i}`}>
                  <StepIcon status={st.status} />
                  <div className="flex-1">
                    <div className={st.status === "error" ? "text-destructive font-medium" : "font-medium"}>{st.label}</div>
                    {st.message && <div className="text-muted-foreground text-xs">{st.message}</div>}
                  </div>
                </li>
              ))}
            </ul>

            {update.error && !successful && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Provisionamento falhou</AlertTitle>
                <AlertDescription className="break-all">{update.error}</AlertDescription>
              </Alert>
            )}

            {finished && successful && (
              <Alert data-testid="alert-success">
                <PartyPopper className="h-4 w-4" />
                <AlertTitle>Pronto!</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>Aplicação provisionada com sucesso.</p>
                  {update.publicUrl && (
                    <p className="text-sm">
                      URL: <a href={update.publicUrl} target="_blank" rel="noopener" className="underline font-mono"
                        data-testid="link-public-url">{update.publicUrl}</a>
                    </p>
                  )}
                  {update.credentials && (
                    <CredentialsBlock creds={update.credentials} onToast={onToast} />
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={!!jobId && !finished} data-testid="button-back-step5">
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <div className="flex gap-2">
          {finished && (
            <>
              <Link href="/dev-center/infra">
                <Button variant="outline" data-testid="button-go-infra">
                  Ver em Infraestrutura <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <Button onClick={onFinishedReset} data-testid="button-new-onboarding">
                Provisionar outro
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function StepIcon({ status }: { status: SseStep["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5" />;
  return <div className="h-4 w-4 rounded-full border border-muted-foreground/40 mt-0.5" />;
}

function CredentialsBlock({
  creds, onToast,
}: { creds: Record<string, string>; onToast: (t: any) => void }) {
  const copy = (v: string) => {
    navigator.clipboard.writeText(v).then(
      () => onToast({ title: "Copiado", description: "Valor copiado para a área de transferência." }),
      () => onToast({ title: "Falha ao copiar", variant: "destructive" }),
    );
  };
  return (
    <div className="rounded border bg-background p-3 mt-2 space-y-1">
      <div className="text-xs font-semibold mb-1">Credenciais</div>
      {Object.entries(creds).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 text-xs font-mono">
          <span className="text-muted-foreground">{k}:</span>
          <span className="flex-1 break-all">{v}</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => copy(v)}
            data-testid={`button-copy-${k}`}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
