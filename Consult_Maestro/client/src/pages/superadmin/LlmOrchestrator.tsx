import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Activity, AlertCircle, CheckCircle2, Cpu, Shield, Key, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { TenantAiConfigsCard } from "@/components/TenantAiConfigsCard";

interface PlatformKey {
  provider: string;
  label: string;
  configured: boolean;
  source: string | null;
}
interface PlatformKeysResponse {
  providers: PlatformKey[];
  note: string;
}

function PlatformKeysPanel() {
  const { data, isLoading } = useQuery<PlatformKeysResponse>({
    queryKey: ["/api/admin/llm/platform-keys"],
  });

  return (
    <div className="space-y-4">
      <Card data-testid="card-platform-env">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4 text-primary" /> Chaves via Secrets (env vars)
          </CardTitle>
          <CardDescription>
            Status das chaves carregadas a partir das variáveis de ambiente do Replit. As configurações cadastradas abaixo no banco têm prioridade sobre estas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando providers…
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {data?.providers.map((p) => (
                <div
                  key={p.provider}
                  className="flex items-center justify-between border rounded-md p-2 text-sm"
                  data-testid={`card-platform-key-${p.provider}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.label}</div>
                      {p.source && (
                        <div className="text-[10px] text-muted-foreground font-mono truncate" data-testid={`text-source-${p.provider}`}>
                          {p.source}
                        </div>
                      )}
                    </div>
                  </div>
                  {p.configured ? (
                    <Badge variant="outline" className="text-emerald-700 border-emerald-300 shrink-0" data-testid={`badge-status-${p.provider}`}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Configurado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground shrink-0" data-testid={`badge-status-${p.provider}`}>
                      <AlertCircle className="h-3 w-3 mr-1" /> Sem chave
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TenantAiConfigsCard
        endpoint="/api/admin/llm/config"
        title="Chaves de plataforma (banco)"
        description="Configure aqui as chaves padrão da plataforma, usadas como pool quando o tenant não tem chave própria. Sobrepõem as env vars."
      />
    </div>
  );
}

interface ProviderHealth {
  provider: string;
  isHealthy: boolean | null;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastErrorMsg: string | null;
  stale: boolean;
}

interface HealthResponse {
  providers: ProviderHealth[];
  knownTaskTypes: string[];
}

interface DecisionsResponse {
  windowDays: number;
  since: string;
  byProvider: Array<{ provider: string; outcome: string; count: number; tokens: number; cost: number; avgLatency: number }>;
  byTaskTier: Array<{ taskType: string; tier: number; count: number }>;
  byReason: Array<{ reason: string; count: number }>;
  activeModelByTask: Array<{ task_type: string; provider_used: string; model_used: string; last_used: string }>;
  costByTask: Array<{ taskType: string; cost: number; tokens: number; calls: number }>;
  latencyByModelTask: Array<{ taskType: string; provider: string; model: string; avgLatency: number; p95Latency: number; calls: number }>;
  qualityByModel: Array<{ provider: string; model: string; avgQuality: number; samples: number }>;
  fallbackFrequency: { total: number; fallbackCount: number; fallbackRate: number };
  recent: Array<{
    id: string;
    tenantId: string;
    taskType: string;
    providerUsed: string;
    modelUsed: string;
    tier: number;
    reason: string;
    outcome: string;
    latencyMs: number | null;
    costUsd: string | null;
    createdAt: string;
  }>;
}

interface BudgetResponse {
  tenantId: string;
  windowDays: number;
  tokens: number;
  calls: number;
  estimatedCostUsd: number;
  fallbackCount: number;
  failedCount: number;
}

function StatusBadge({ outcome }: { outcome: string }) {
  if (outcome === "success") return <Badge variant="outline" className="text-green-600">success</Badge>;
  if (outcome === "fallback_used") return <Badge variant="outline" className="text-amber-600">fallback</Badge>;
  return <Badge variant="outline" className="text-red-600">{outcome}</Badge>;
}

export default function LlmOrchestrator() {
  const { toast } = useToast();
  const { isSuperadmin } = useSystemRole();
  const [days, setDays] = useState(1);
  const [budgetTenantId, setBudgetTenantId] = useState("");
  const [budgetDays, setBudgetDays] = useState(1);

  // Backend já restringe via requireSuperadmin; aqui usamos `enabled` para
  // não disparar fetches 403 quando não-superadmin acessa a URL diretamente.
  const healthQ = useQuery<HealthResponse>({
    queryKey: ["/api/admin/llm/health"],
    refetchInterval: 30000,
    enabled: isSuperadmin,
  });

  const decisionsQ = useQuery<DecisionsResponse>({
    queryKey: ["/api/admin/llm/decisions", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/llm/decisions?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: isSuperadmin,
  });

  const probeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/llm/health/probe");
    },
    onSuccess: () => {
      toast({ title: "Probe executado", description: "Health dos providers atualizado." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/llm/health"] });
    },
    onError: (e: any) => toast({ title: "Falha no probe", description: e?.message ?? "erro", variant: "destructive" }),
  });

  const budgetQ = useQuery<BudgetResponse>({
    queryKey: ["/api/admin/llm/budget", budgetTenantId, budgetDays],
    queryFn: async () => {
      const r = await fetch(`/api/admin/llm/budget?tenantId=${encodeURIComponent(budgetTenantId)}&days=${budgetDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: isSuperadmin && budgetTenantId.length > 0,
  });

  // Frontend role guard: bloqueia renderização para tenant_admin/partner/user.
  // Backend já restringe via requireSuperadmin (defesa em profundidade).
  if (!isSuperadmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="container-forbidden">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> Acesso restrito
            </CardTitle>
            <CardDescription>Esta página é exclusiva para superadministradores da plataforma.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Se você precisa acessar o painel do orquestrador LLM, peça permissão a um superadmin da Arcádia.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-title">
            <Cpu className="h-6 w-6" /> Orquestrador LLM
          </h1>
          <p className="text-sm text-muted-foreground">Cascata cloud → cloud → Ollama, health em memória (TTL 5min), auditoria em <code>llm_decisions</code>.</p>
        </div>
        <Button
          onClick={() => probeMutation.mutate()}
          disabled={probeMutation.isPending}
          data-testid="button-probe"
        >
          {probeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Probe agora
        </Button>
      </div>

      {/* Painel 1: Health dos providers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Saúde dos Providers</CardTitle>
          <CardDescription>Map em memória, atualizado a cada 5min pelo cron de health.</CardDescription>
        </CardHeader>
        <CardContent>
          {healthQ.isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="grid-providers">
              {healthQ.data?.providers.map((p) => (
                <div key={p.provider} className="border rounded-lg p-4 space-y-2" data-testid={`card-provider-${p.provider}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{p.provider}</span>
                    {p.stale ? (
                      <Badge variant="outline">desconhecido</Badge>
                    ) : p.isHealthy ? (
                      <Badge variant="outline" className="text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />healthy</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-600"><AlertCircle className="h-3 w-3 mr-1" />unhealthy</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.latencyMs !== null ? <div>Latência: <span data-testid={`text-latency-${p.provider}`}>{p.latencyMs}ms</span></div> : <div>Latência: —</div>}
                    {p.lastCheckedAt && <div>Checado: {new Date(p.lastCheckedAt).toLocaleTimeString("pt-BR")}</div>}
                    {p.lastErrorMsg && <div className="text-red-600 truncate" title={p.lastErrorMsg}>Erro: {p.lastErrorMsg}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="integracoes">
        <TabsList>
          <TabsTrigger value="integracoes" data-testid="tab-integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="decisions" data-testid="tab-decisions">Decisões</TabsTrigger>
          <TabsTrigger value="taskTypes" data-testid="tab-tasktypes">TaskTypes</TabsTrigger>
          <TabsTrigger value="budget" data-testid="tab-budget">Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="integracoes" className="space-y-4">
          <PlatformKeysPanel />
        </TabsContent>

        <TabsContent value="decisions" className="space-y-4">
          <div className="flex items-center gap-3">
            <Label>Janela:</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-32" data-testid="select-days"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 dia</SelectItem>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Painel 2: Por provider/outcome */}
          <Card>
            <CardHeader><CardTitle>Por Provider × Outcome</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Custo (USD)</TableHead>
                    <TableHead className="text-right">Latência média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.byProvider.map((r, i) => (
                    <TableRow key={i} data-testid={`row-provider-${r.provider}-${r.outcome}`}>
                      <TableCell className="font-medium">{r.provider}</TableCell>
                      <TableCell><StatusBadge outcome={r.outcome} /></TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{r.tokens.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">${r.cost.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{Math.round(r.avgLatency)}ms</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.byProvider || decisionsQ.data.byProvider.length === 0) && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem decisões na janela</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Painel 3: Top reasons */}
          <Card>
            <CardHeader><CardTitle>Top Motivos de Roteamento</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {decisionsQ.data?.byReason.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between border-b pb-2" data-testid={`row-reason-${r.reason}`}>
                    <code className="text-sm">{r.reason}</code>
                    <Badge variant="secondary">{r.count}</Badge>
                  </div>
                ))}
                {(!decisionsQ.data?.byReason || decisionsQ.data.byReason.length === 0) && (
                  <div className="text-muted-foreground text-sm">Sem dados</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Painel 3.1: Frequência de fallback (tier ≥ 2) */}
          {decisionsQ.data?.fallbackFrequency && (
            <Card>
              <CardHeader><CardTitle>Frequência de Fallback (tier ≥ 2)</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4" data-testid="grid-fallback-freq">
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Total de chamadas</div>
                    <div className="text-2xl font-bold">{decisionsQ.data.fallbackFrequency.total}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Caíram em fallback</div>
                    <div className="text-2xl font-bold text-amber-600">{decisionsQ.data.fallbackFrequency.fallbackCount}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Taxa de fallback</div>
                    <div className="text-2xl font-bold">{(decisionsQ.data.fallbackFrequency.fallbackRate * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Painel 3.2: Modelo ativo por taskType */}
          <Card>
            <CardHeader><CardTitle>Modelo Ativo por TaskType</CardTitle><CardDescription>Última escolha bem-sucedida do orquestrador para cada tipo de tarefa.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TaskType</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.activeModelByTask?.map((r) => (
                    <TableRow key={r.task_type} data-testid={`row-active-${r.task_type}`}>
                      <TableCell className="text-xs">{r.task_type}</TableCell>
                      <TableCell>{r.provider_used}</TableCell>
                      <TableCell className="text-xs">{r.model_used}</TableCell>
                      <TableCell className="text-xs">{new Date(r.last_used).toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.activeModelByTask || decisionsQ.data.activeModelByTask.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem decisões na janela</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Painel 3.3: Custo por taskType */}
          <Card>
            <CardHeader><CardTitle>Custo por TaskType</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TaskType</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Custo (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.costByTask?.map((r) => (
                    <TableRow key={r.taskType} data-testid={`row-cost-${r.taskType}`}>
                      <TableCell className="text-xs">{r.taskType}</TableCell>
                      <TableCell className="text-right">{r.calls}</TableCell>
                      <TableCell className="text-right">{r.tokens.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">${r.cost.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.costByTask || decisionsQ.data.costByTask.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem dados</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Painel 3.4: Latência por modelo × taskType */}
          <Card>
            <CardHeader><CardTitle>Latência por Modelo × TaskType</CardTitle><CardDescription>Média e p95 (ms) na janela.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TaskType</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.latencyByModelTask?.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{r.taskType}</TableCell>
                      <TableCell>{r.provider}</TableCell>
                      <TableCell className="text-xs">{r.model}</TableCell>
                      <TableCell className="text-right">{r.calls}</TableCell>
                      <TableCell className="text-right">{Math.round(r.avgLatency)}ms</TableCell>
                      <TableCell className="text-right">{Math.round(r.p95Latency)}ms</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.latencyByModelTask || decisionsQ.data.latencyByModelTask.length === 0) && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem dados</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Painel 3.5: Qualidade média por provider × modelo */}
          <Card>
            <CardHeader><CardTitle>Qualidade Média por Provider × Modelo</CardTitle><CardDescription>Apenas chamadas com <code>qualityScore</code> registrado.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Amostras</TableHead>
                    <TableHead className="text-right">Qualidade média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.qualityByModel?.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.provider}</TableCell>
                      <TableCell className="text-xs">{r.model}</TableCell>
                      <TableCell className="text-right">{r.samples}</TableCell>
                      <TableCell className="text-right">{r.avgQuality.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.qualityByModel || decisionsQ.data.qualityByModel.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum qualityScore registrado ainda</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Painel 4: Decisões recentes */}
          <Card>
            <CardHeader><CardTitle>Últimas 50 Decisões</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Latência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decisionsQ.data?.recent.map((d) => (
                      <TableRow key={d.id} data-testid={`row-decision-${d.id}`}>
                        <TableCell className="text-xs">{new Date(d.createdAt).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-xs font-mono">{d.tenantId.slice(0, 8)}…</TableCell>
                        <TableCell className="text-xs">{d.taskType}</TableCell>
                        <TableCell>{d.providerUsed}</TableCell>
                        <TableCell>T{d.tier}</TableCell>
                        <TableCell className="text-xs"><code>{d.reason}</code></TableCell>
                        <TableCell><StatusBadge outcome={d.outcome} /></TableCell>
                        <TableCell className="text-right text-xs">{d.latencyMs ?? "—"}ms</TableCell>
                      </TableRow>
                    ))}
                    {(!decisionsQ.data?.recent || decisionsQ.data.recent.length === 0) && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Sem decisões na janela</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taskTypes">
          {/* Painel 5: TaskTypes conhecidos + tier distribution */}
          <Card>
            <CardHeader>
              <CardTitle>TaskTypes Registrados na Cascata</CardTitle>
              <CardDescription>Cada taskType tem uma cascata configurada em <code>server/mcp/taskCascade.ts</code>.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {healthQ.data?.knownTaskTypes.map((t) => (
                  <Badge key={t} variant="outline" data-testid={`badge-tasktype-${t}`}>{t}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Painel 6: distribuição por tier */}
          <Card className="mt-4">
            <CardHeader><CardTitle>Distribuição de Tier por TaskType</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TaskType</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsQ.data?.byTaskTier.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{r.taskType}</TableCell>
                      <TableCell>T{r.tier}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                    </TableRow>
                  ))}
                  {(!decisionsQ.data?.byTaskTier || decisionsQ.data.byTaskTier.length === 0) && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Sem dados</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget">
          {/* Painel 7: Budget por tenant */}
          <Card>
            <CardHeader>
              <CardTitle>Budget por Tenant</CardTitle>
              <CardDescription>Tokens, custo aproximado, fallbacks e falhas na janela.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="budget-tenant">Tenant ID</Label>
                  <Input id="budget-tenant" value={budgetTenantId} onChange={(e) => setBudgetTenantId(e.target.value)} placeholder="uuid do tenant" data-testid="input-budget-tenant" />
                </div>
                <div>
                  <Label>Janela</Label>
                  <Select value={String(budgetDays)} onValueChange={(v) => setBudgetDays(Number(v))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 dia</SelectItem>
                      <SelectItem value="7">7 dias</SelectItem>
                      <SelectItem value="30">30 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {budgetQ.data && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4" data-testid="grid-budget">
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Calls</div>
                    <div className="text-2xl font-bold" data-testid="text-budget-calls">{budgetQ.data.calls}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Tokens</div>
                    <div className="text-2xl font-bold" data-testid="text-budget-tokens">{budgetQ.data.tokens.toLocaleString("pt-BR")}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Custo (USD)</div>
                    <div className="text-2xl font-bold">${budgetQ.data.estimatedCostUsd.toFixed(4)}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Fallbacks</div>
                    <div className="text-2xl font-bold text-amber-600">{budgetQ.data.fallbackCount}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Falhas totais</div>
                    <div className="text-2xl font-bold text-red-600">{budgetQ.data.failedCount}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
