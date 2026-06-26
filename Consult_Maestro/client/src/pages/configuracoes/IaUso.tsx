import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { TenantAiConfigsCard } from "@/components/TenantAiConfigsCard";

type AiSource = "tenant" | "platform" | "partner_api";

type DailyRow = {
  date: string;
  provider: string;
  source: AiSource;
  tokensInput: number;
  tokensOutput: number;
  requests: number;
};

const SOURCE_LABELS: Record<AiSource, string> = {
  tenant: "Suas keys",
  platform: "Pool plataforma",
  partner_api: "API pública (/mcp/v1)",
};
const SOURCE_BAR_CLASS: Record<AiSource, string> = {
  tenant: "bg-emerald-500",
  platform: "bg-amber-500",
  partner_api: "bg-sky-500",
};

type UsageResponse = {
  range: { from: string; to: string; days: number };
  totals: {
    current: { tokens: number; requests: number; byProvider: Record<string, number>; bySource: Record<string, number> };
    previous: { tokens: number; requests: number; byProvider: Record<string, number>; bySource: Record<string, number> };
    variation: { tokensPct: number | null };
  };
  daily: DailyRow[];
  platformPool: { used: number; limit: number; percent: number; nudge: boolean; month: string };
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#D97757",
  openai: "#10A37F",
  gemini: "#4285F4",
  kimi: "#7C3AED",
  ollama: "#6B7280",
};

function formatNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function UsoPanel() {
  const usage = useQuery<UsageResponse>({ queryKey: ["/api/ia/usage"] });

  const chartData = useMemo(() => {
    if (!usage.data) return [];
    const byDate = new Map<string, Record<string, any>>();
    const providers = new Set<string>();
    for (const row of usage.data.daily) {
      providers.add(row.provider);
      let bucket = byDate.get(row.date);
      if (!bucket) { bucket = { date: row.date }; byDate.set(row.date, bucket); }
      const tokens = (row.tokensInput || 0) + (row.tokensOutput || 0);
      bucket[row.provider] = (bucket[row.provider] || 0) + tokens;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [usage.data]);

  const providerKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of usage.data?.daily || []) set.add(row.provider);
    return Array.from(set);
  }, [usage.data]);

  if (usage.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const totals = usage.data?.totals;
  const pool = usage.data?.platformPool;
  const variation = totals?.variation.tokensPct;

  return (
    <div className="space-y-6">
      {pool?.nudge && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 flex gap-3 items-start" data-testid="banner-pool-nudge">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-sm">Você está consumindo {pool.percent}% do pool da plataforma este mês.</p>
            <p className="text-xs text-muted-foreground">
              Para evitar limitação, configure suas próprias API keys na aba <strong>Chaves</strong> e o consumo passa para a sua origem.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-kpi-current">
          <CardHeader className="pb-2"><CardDescription>Tokens últimos {usage.data?.range.days} dias</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold" data-testid="text-tokens-current">{formatNumber(totals?.current.tokens || 0)}</div>
            <div className="text-xs text-muted-foreground mt-1">{formatNumber(totals?.current.requests || 0)} requests</div>
            {variation !== null && variation !== undefined && (
              <div className="mt-2 flex items-center gap-1 text-xs">
                {variation >= 0 ? (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-200">
                    <TrendingUp className="h-3 w-3 mr-1" /> +{variation}% vs período anterior
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600 border-red-200">
                    <TrendingDown className="h-3 w-3 mr-1" /> {variation}% vs período anterior
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-platform-pool">
          <CardHeader className="pb-2"><CardDescription>Pool da plataforma — {pool?.month}</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold" data-testid="text-pool-percent">{pool?.percent || 0}%</div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumber(pool?.used || 0)} de {formatNumber(pool?.limit || 0)} tokens
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${(pool?.percent || 0) >= 80 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${Math.min(100, pool?.percent || 0)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-by-source">
          <CardHeader className="pb-2"><CardDescription>Origem do consumo</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(["tenant", "platform", "partner_api"] as AiSource[]).map((src) => {
              const v = totals?.current.bySource[src] || 0;
              const total = totals?.current.tokens || 1;
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return (
                <div key={src} className="flex items-center gap-2" data-testid={`row-source-${src}`}>
                  <span className={`h-2 w-2 rounded-full ${SOURCE_BAR_CLASS[src]}`} />
                  <span className="text-xs flex-1">{SOURCE_LABELS[src]}</span>
                  <span className="text-xs font-medium tabular-nums">{pct}%</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Consumo diário</CardTitle>
          <CardDescription>Tokens por provider nos últimos {usage.data?.range.days} dias</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-data">
              Sem consumo registrado no período.
            </div>
          ) : (
            <div className="h-72 w-full" data-testid="chart-usage-daily">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                  <Tooltip formatter={(v: number) => formatNumber(v)} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {providerKeys.map((p) => (
                    <Bar key={p} dataKey={p} stackId="a" fill={PROVIDER_COLORS[p] || "#94A3B8"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Por provider — total no período</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(totals?.current.byProvider || {}).map(([provider, tokens]) => (
              <div key={provider} className="rounded-md border p-3" data-testid={`provider-${provider}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[provider] || "#94A3B8" }} />
                  <span className="text-xs font-medium">{provider}</span>
                </div>
                <div className="text-lg font-semibold">{formatNumber(tokens)}</div>
                <div className="text-xs text-muted-foreground">tokens</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConfiguracoesIaUso() {
  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6" data-testid="page-ia-uso">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">IA — Integrações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure suas chaves de provedores de IA e acompanhe o consumo de tokens.
        </p>
      </div>

      <Tabs defaultValue="chaves" className="space-y-4">
        <TabsList>
          <TabsTrigger value="chaves" data-testid="tab-chaves">Chaves</TabsTrigger>
          <TabsTrigger value="uso" data-testid="tab-uso">Uso</TabsTrigger>
        </TabsList>

        <TabsContent value="chaves">
          <TenantAiConfigsCard />
        </TabsContent>

        <TabsContent value="uso">
          <UsoPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
