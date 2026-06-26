import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HardDrive,
  Plus,
  Play,
  Square,
  RefreshCcw,
  Trash2,
  Settings2,
  FileText,
  Rocket,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server as ServerIcon,
  ExternalLink,
  GitBranch,
} from "lucide-react";

// =============================================================================
// Tipos espelhando o backend (server/infra/routes.ts)
// =============================================================================
interface InfraServer {
  id: string;
  name: string;
  coolifyUrl: string;
  serverIp: string | null;
  status: "online" | "offline" | "unknown";
  lastPingAt: string | null;
  createdAt: string;
  serviceCount: number;
  serviceType?: "coolify" | "gitea";
}

interface InfraService {
  id: string;
  serverId: string;
  coolifyId: string;
  name: string;
  serviceType: string;
  publicUrl: string | null;
  status: string;
  envVars: Record<string, string> | null;
  updatedAt: string;
}

// =============================================================================
// Página principal
// =============================================================================
export default function InfraManager() {
  const { toast } = useToast();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [logsServiceId, setLogsServiceId] = useState<string | null>(null);
  const [envServiceId, setEnvServiceId] = useState<string | null>(null);

  const serversQuery = useQuery<InfraServer[]>({
    queryKey: ["/api/infra/servers"],
  });

  // Auto-seleciona primeiro servidor quando carrega
  useEffect(() => {
    if (!selectedServerId && serversQuery.data && serversQuery.data.length > 0) {
      setSelectedServerId(serversQuery.data[0].id);
    }
  }, [serversQuery.data, selectedServerId]);

  const servicesQuery = useQuery<InfraService[]>({
    queryKey: ["/api/infra/servers", selectedServerId, "services"],
    enabled: !!selectedServerId,
  });

  const testServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      return await apiRequest("POST", `/api/infra/servers/${serverId}/test`);
    },
    onSuccess: () => {
      toast({ title: "Conexão OK", description: "Servidor respondeu corretamente." });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
    },
    onError: (e: any) => {
      toast({
        title: "Falha na conexão",
        description: e?.message ?? "Verifique URL/token",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
    },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      return await apiRequest("DELETE", `/api/infra/servers/${serverId}`);
    },
    onSuccess: () => {
      toast({ title: "Servidor removido" });
      setSelectedServerId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
    },
    onError: (e: any) =>
      toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" }),
  });

  const refreshServicesMutation = useMutation({
    mutationFn: async (serverId: string) => {
      // Re-pede lista (que sincroniza com Coolify no backend)
      return await queryClient.invalidateQueries({
        queryKey: ["/api/infra/servers", serverId, "services"],
      });
    },
    onSuccess: () => toast({ title: "Lista atualizada" }),
  });

  const startMutation = useMutation({
    mutationFn: async (coolifyId: string) =>
      await apiRequest("POST", `/api/infra/services/${coolifyId}/start`),
    onSuccess: () => {
      toast({ title: "Serviço iniciado" });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers", selectedServerId, "services"] });
    },
    onError: (e: any) =>
      toast({ title: "Falha ao iniciar", description: e?.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: async (coolifyId: string) =>
      await apiRequest("POST", `/api/infra/services/${coolifyId}/stop`),
    onSuccess: () => {
      toast({ title: "Serviço parado" });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers", selectedServerId, "services"] });
    },
    onError: (e: any) =>
      toast({ title: "Falha ao parar", description: e?.message, variant: "destructive" }),
  });

  const deployMutation = useMutation({
    mutationFn: async (coolifyId: string) =>
      await apiRequest("POST", `/api/infra/services/${coolifyId}/deploy`),
    onSuccess: () => {
      toast({ title: "Deploy iniciado", description: "Acompanhe pelos logs." });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers", selectedServerId, "services"] });
    },
    onError: (e: any) =>
      toast({ title: "Falha no deploy", description: e?.message, variant: "destructive" }),
  });

  const selectedServer = useMemo(
    () => serversQuery.data?.find((s) => s.id === selectedServerId) ?? null,
    [serversQuery.data, selectedServerId],
  );

  const logsService = useMemo(
    () => servicesQuery.data?.find((s) => s.coolifyId === logsServiceId) ?? null,
    [servicesQuery.data, logsServiceId],
  );

  const envService = useMemo(
    () => servicesQuery.data?.find((s) => s.coolifyId === envServiceId) ?? null,
    [servicesQuery.data, envServiceId],
  );

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6" data-testid="page-infra-manager">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <HardDrive className="h-7 w-7" /> Infraestrutura
          </h1>
          <p className="text-muted-foreground mt-1">
            Conecte servidores Coolify e gerencie serviços, deploys e variáveis de ambiente.
          </p>
        </div>
        <Button
          onClick={() => setShowAddServer(true)}
          data-testid="button-add-server"
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> Adicionar servidor
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Coluna esquerda — servidores */}
        <Card data-testid="card-servers-list">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ServerIcon className="h-4 w-4" /> Servidores
            </CardTitle>
            <CardDescription>
              {serversQuery.data?.length ?? 0} servidor(es)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {serversQuery.isLoading && (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            )}
            {!serversQuery.isLoading && (serversQuery.data?.length ?? 0) === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                Nenhum servidor cadastrado.
                <br />
                Clique em <strong>Adicionar servidor</strong> para começar.
              </div>
            )}
            {serversQuery.data?.map((srv) => (
              <ServerCard
                key={srv.id}
                server={srv}
                selected={srv.id === selectedServerId}
                onSelect={() => setSelectedServerId(srv.id)}
                onTest={() => testServerMutation.mutate(srv.id)}
                onDelete={() => {
                  if (confirm(`Remover servidor "${srv.name}"? Os serviços ficarão sem vínculo.`)) {
                    deleteServerMutation.mutate(srv.id);
                  }
                }}
                testing={testServerMutation.isPending && testServerMutation.variables === srv.id}
              />
            ))}
          </CardContent>
        </Card>

        {/* Coluna direita — serviços do servidor selecionado */}
        <Card data-testid="card-services-list">
          <CardHeader className="pb-3 flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-base">
                {selectedServer ? `Serviços de ${selectedServer.name}` : "Serviços"}
              </CardTitle>
              <CardDescription>
                {selectedServer
                  ? `${servicesQuery.data?.length ?? 0} serviço(s)`
                  : "Selecione um servidor à esquerda."}
              </CardDescription>
            </div>
            {selectedServerId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshServicesMutation.mutate(selectedServerId)}
                disabled={servicesQuery.isFetching}
                data-testid="button-refresh-services"
                className="gap-2"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${servicesQuery.isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedServerId && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Selecione um servidor para ver os serviços.
              </div>
            )}
            {selectedServerId && servicesQuery.isLoading && (
              <>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            )}
            {selectedServerId && servicesQuery.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex gap-2 items-start">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <div>
                  <div className="font-medium">Erro ao listar serviços</div>
                  <div className="opacity-80">{(servicesQuery.error as any)?.message}</div>
                </div>
              </div>
            )}
            {servicesQuery.data?.length === 0 && !servicesQuery.isLoading && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Nenhum serviço encontrado neste servidor.
              </div>
            )}
            {servicesQuery.data?.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                onStart={() => startMutation.mutate(svc.coolifyId)}
                onStop={() => stopMutation.mutate(svc.coolifyId)}
                onDeploy={() => deployMutation.mutate(svc.coolifyId)}
                onLogs={() => setLogsServiceId(svc.coolifyId)}
                onEnv={() => setEnvServiceId(svc.coolifyId)}
                actionPending={
                  (startMutation.isPending && startMutation.variables === svc.coolifyId) ||
                  (stopMutation.isPending && stopMutation.variables === svc.coolifyId) ||
                  (deployMutation.isPending && deployMutation.variables === svc.coolifyId)
                }
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <AddServerModal open={showAddServer} onOpenChange={setShowAddServer} />

      {logsService && (
        <ServiceLogsDialog
          coolifyId={logsService.coolifyId}
          serviceName={logsService.name}
          open={true}
          onClose={() => setLogsServiceId(null)}
        />
      )}

      {envService && (
        <EnvEditorDialog
          coolifyId={envService.coolifyId}
          serviceName={envService.name}
          initialEnv={envService.envVars ?? {}}
          serverId={envService.serverId}
          open={true}
          onClose={() => setEnvServiceId(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// ServerCard — item da lista de servidores
// =============================================================================
function ServerCard(props: {
  server: InfraServer;
  selected: boolean;
  onSelect: () => void;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}) {
  const { server, selected, onSelect, onTest, onDelete, testing } = props;
  const statusVariant =
    server.status === "online" ? "default" : server.status === "offline" ? "destructive" : "secondary";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`button-server-${server.id}`}
      className={`w-full text-left rounded-md border p-3 transition hover-elevate active-elevate-2 ${
        selected ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="font-medium truncate" data-testid={`text-server-name-${server.id}`}>
              {server.name}
            </div>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 gap-1"
              data-testid={`badge-server-type-${server.id}`}
            >
              {server.serviceType === "gitea" ? (
                <><GitBranch className="h-3 w-3" /> Gitea</>
              ) : (
                <><HardDrive className="h-3 w-3" /> Coolify</>
              )}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground truncate">{server.coolifyUrl}</div>
          {server.serverIp && (
            <div className="text-xs text-muted-foreground">IP: {server.serverIp}</div>
          )}
        </div>
        <Badge variant={statusVariant as any} data-testid={`badge-server-status-${server.id}`}>
          {server.status}
        </Badge>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-muted-foreground">{server.serviceCount} serviço(s)</span>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={onTest}
                  disabled={testing}
                  data-testid={`button-test-server-${server.id}`}
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Testar conexão</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={onDelete}
                  data-testid={`button-delete-server-${server.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remover</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// ServiceCard — item da lista de serviços
// =============================================================================
function ServiceCard(props: {
  service: InfraService;
  onStart: () => void;
  onStop: () => void;
  onDeploy: () => void;
  onLogs: () => void;
  onEnv: () => void;
  actionPending: boolean;
}) {
  const { service, onStart, onStop, onDeploy, onLogs, onEnv, actionPending } = props;
  const statusVariant =
    service.status === "running"
      ? "default"
      : service.status === "stopped"
      ? "secondary"
      : service.status === "failed"
      ? "destructive"
      : "outline";

  return (
    <div
      className="rounded-md border p-3 hover-elevate"
      data-testid={`card-service-${service.coolifyId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate" data-testid={`text-service-name-${service.coolifyId}`}>
              {service.name}
            </span>
            <Badge variant="outline" className="text-xs">{service.serviceType}</Badge>
            <Badge variant={statusVariant as any} className="text-xs">{service.status}</Badge>
          </div>
          {service.publicUrl && (
            <a
              href={service.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
              data-testid={`link-service-url-${service.coolifyId}`}
            >
              {service.publicUrl} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onStart}
                  disabled={actionPending || service.status === "running"}
                  data-testid={`button-start-${service.coolifyId}`}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Iniciar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onStop}
                  disabled={actionPending || service.status === "stopped"}
                  data-testid={`button-stop-${service.coolifyId}`}
                >
                  <Square className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Parar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onDeploy}
                  disabled={actionPending}
                  data-testid={`button-deploy-${service.coolifyId}`}
                >
                  {actionPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Deploy</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onLogs}
                  data-testid={`button-logs-${service.coolifyId}`}
                >
                  <FileText className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ver logs</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onEnv}
                  data-testid={`button-env-${service.coolifyId}`}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Variáveis de ambiente</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AddServerModal — cadastro de servidor com botão "Testar conexão"
// =============================================================================
function AddServerModal(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { open, onOpenChange } = props;
  const { toast } = useToast();
  const [serviceType, setServiceType] = useState<"coolify" | "gitea">("coolify");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [testResult, setTestResult] = useState<"idle" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  const isGitea = serviceType === "gitea";

  const reset = () => {
    setServiceType("coolify");
    setName(""); setUrl(""); setToken(""); setServerIp("");
    setTestResult("idle"); setTestMessage("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/infra/servers", {
        name, coolifyUrl: url, apiToken: token, serverIp: serverIp || null,
        serviceType,
      });
    },
    onSuccess: async (resp: any) => {
      const data = await resp.json().catch(() => ({}));
      toast({ title: "Servidor cadastrado" });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
      // Dispara teste de conexão automaticamente
      if (data?.id) {
        try {
          await apiRequest("POST", `/api/infra/servers/${data.id}/test`);
          queryClient.invalidateQueries({ queryKey: ["/api/infra/servers"] });
        } catch { /* tester silencioso — usuário vê status na lista */ }
      }
      reset();
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({ title: "Erro ao salvar", description: e?.message, variant: "destructive" }),
  });

  // Teste sem persistir: criamos temporário? Não — aproveita rota /test só para
  // servidor já salvo. Para teste pré-salvar fazemos um fetch direto a partir
  // do backend via uma chamada simulada. Para manter escopo, validamos formato
  // no front e deixamos o teste real acontecer pós-cadastro (botão Testar na lista).
  const previewTest = () => {
    setTestResult("idle"); setTestMessage("");
    if (!url.match(/^https?:\/\//)) {
      setTestResult("fail");
      setTestMessage("URL deve começar com http:// ou https://");
      return;
    }
    if (token.length < 10) {
      setTestResult("fail");
      setTestMessage("Token muito curto");
      return;
    }
    setTestResult("ok");
    setTestMessage("Formato OK. Conexão real será testada após salvar.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent data-testid="dialog-add-server">
        <DialogHeader>
          <DialogTitle>
            Adicionar servidor {isGitea ? "Gitea" : "Coolify"}
          </DialogTitle>
          <DialogDescription>
            {isGitea
              ? "Conecte uma instância Gitea para versionamento automático dos artefatos do Dev Center. O token é armazenado criptografado."
              : "Conecte uma instância Coolify para gerenciar serviços a partir daqui. O token é armazenado criptografado."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="srv-type">Tipo</Label>
            <Select
              value={serviceType}
              onValueChange={(v) => setServiceType(v as "coolify" | "gitea")}
            >
              <SelectTrigger id="srv-type" data-testid="select-server-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="coolify" data-testid="option-server-type-coolify">
                  Coolify (deploy / serviços)
                </SelectItem>
                <SelectItem value="gitea" data-testid="option-server-type-gitea">
                  Gitea (versionamento Dev Center)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="srv-name">Nome</Label>
            <Input
              id="srv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isGitea ? "Gitea interno" : "VPS Hetzner Produção"}
              data-testid="input-server-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="srv-url">
              URL {isGitea ? "Gitea" : "Coolify"}
            </Label>
            <Input
              id="srv-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={isGitea ? "https://gitea.empresa.com" : "https://coolify.empresa.com"}
              data-testid="input-server-url"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="srv-token">
              {isGitea ? "Personal Access Token" : "API Token"}
            </Label>
            <Input
              id="srv-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={isGitea ? "ghp_... ou personal access token" : "cool_..."}
              data-testid="input-server-token"
            />
          </div>
          {!isGitea && (
            <div className="space-y-1.5">
              <Label htmlFor="srv-ip">IP do servidor (opcional)</Label>
              <Input
                id="srv-ip"
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                placeholder="123.45.67.89"
                data-testid="input-server-ip"
              />
            </div>
          )}
          {testResult !== "idle" && (
            <div
              className={`text-sm flex items-center gap-2 rounded-md border px-3 py-2 ${
                testResult === "ok"
                  ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
              data-testid="status-test-result"
            >
              {testResult === "ok" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {testMessage}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={previewTest} data-testid="button-preview-test">
            Validar formato
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name || !url || !token || createMutation.isPending}
            data-testid="button-save-server"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar e testar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// ServiceLogsDialog — SSE com auto-scroll, últimas 200 linhas
// =============================================================================
function ServiceLogsDialog(props: {
  coolifyId: string;
  serviceName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { coolifyId, serviceName, open, onClose } = props;
  const [logs, setLogs] = useState<string>("Conectando ao stream de logs...\n");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLogs("Conectando ao stream de logs...\n");
    setErrorMsg(null);
    setConnected(false);
    const url = `/api/infra/services/${encodeURIComponent(coolifyId)}/logs`;
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener("snapshot", (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        setLogs(payload.logs || "");
        setConnected(true);
      } catch { /* ignore */ }
    });
    es.addEventListener("error", (e: any) => {
      try {
        const data = JSON.parse((e as any).data || "{}");
        if (data?.message) setErrorMsg(data.message);
      } catch { /* fallback */ }
    });
    es.onerror = () => {
      // EventSource fecha sozinho em erro; mostra estado
      if (!connected) setErrorMsg((prev) => prev || "Conexão de logs interrompida");
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coolifyId, open]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl" data-testid="dialog-service-logs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Logs · {serviceName}
          </DialogTitle>
          <DialogDescription>
            Últimas 200 linhas — atualiza automaticamente a cada 3s.
            {connected && <Badge variant="default" className="ml-2 text-xs">stream ativo</Badge>}
          </DialogDescription>
        </DialogHeader>
        {errorMsg && (
          <div className="text-sm text-destructive flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertCircle className="h-4 w-4" /> {errorMsg}
          </div>
        )}
        <div
          ref={scrollRef}
          className="h-[60vh] overflow-auto rounded-md border bg-zinc-950 text-zinc-100 p-3 font-mono text-xs whitespace-pre-wrap"
          data-testid="text-service-logs"
        >
          {logs}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// EnvEditorDialog — edição de variáveis de ambiente (key=value)
// =============================================================================
function EnvEditorDialog(props: {
  coolifyId: string;
  serviceName: string;
  initialEnv: Record<string, string>;
  serverId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { coolifyId, serviceName, initialEnv, serverId, open, onClose } = props;
  const { toast } = useToast();

  const initialText = useMemo(
    () => Object.entries(initialEnv).map(([k, v]) => `${k}=${v}`).join("\n"),
    [initialEnv],
  );
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  const parseEnv = (raw: string): { ok: true; env: Record<string, string> } | { ok: false; line: number } => {
    const out: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) return { ok: false, line: i + 1 };
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key.match(/^[A-Z_][A-Z0-9_]*$/i)) return { ok: false, line: i + 1 };
      out[key] = value;
    }
    return { ok: true, env: out };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseEnv(text);
      if (!parsed.ok) {
        throw new Error(`Linha ${parsed.line} inválida (use FORMATO=valor)`);
      }
      return await apiRequest("PATCH", `/api/infra/services/${coolifyId}/env`, {
        envVars: parsed.env,
      });
    },
    onSuccess: () => {
      toast({ title: "Variáveis salvas" });
      queryClient.invalidateQueries({ queryKey: ["/api/infra/servers", serverId, "services"] });
      onClose();
    },
    onError: (e: any) =>
      toast({ title: "Falha ao salvar", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="dialog-env-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" /> Variáveis de ambiente · {serviceName}
          </DialogTitle>
          <DialogDescription>
            Uma linha por variável no formato <code className="text-xs">CHAVE=valor</code>.
            Linhas iniciadas com <code className="text-xs">#</code> são ignoradas.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          className="font-mono text-xs"
          placeholder={"DATABASE_URL=postgres://...\nNODE_ENV=production"}
          data-testid="input-env-vars"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-env"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
