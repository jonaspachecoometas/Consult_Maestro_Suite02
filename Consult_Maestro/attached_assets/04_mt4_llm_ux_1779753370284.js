#!/usr/bin/env node
/**
 * Patch 04 — MT-4: LLM UX por tenant
 * Executa na raiz do projeto: node patches/04_mt4_llm_ux.js
 *
 * O que faz:
 *  - Cria LlmSourceBadge.tsx — badge "Sua LLM / LLM Arcádia" para respostas de agente
 *  - Cria LlmUsageDashboard.tsx — consumo por empresa-cliente com gráfico
 *  - Adiciona rota backend GET /api/tenant/ai-usage-by-client
 *  - Integra badge no SuperAgentChat.tsx se existir
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function write(relPath, content) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`  ✅ ${relPath}`);
}

function patch(relPath, find, replace) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) { console.log(`  ⚠️  ${relPath} não encontrado — pulando`); return; }
  let c = fs.readFileSync(full, 'utf8');
  if (!c.includes(find)) { console.log(`  ⚠️  patch em ${relPath}: trecho não encontrado`); return; }
  fs.writeFileSync(full, c.replace(find, replace), 'utf8');
  console.log(`  ✅ patched ${relPath}`);
}

// ─────────────────────────────────────────────────────────────
// 1. LlmSourceBadge.tsx
// ─────────────────────────────────────────────────────────────
write('client/src/components/LlmSourceBadge.tsx', `
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Cpu, Building2 } from "lucide-react";

type Source = "tenant" | "platform" | string | null | undefined;
type Provider = "anthropic" | "gemini" | "kimi" | "ollama" | string | null | undefined;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  kimi: "Kimi",
  ollama: "Ollama",
};

interface Props {
  source?: Source;
  provider?: Provider;
  model?: string | null;
  className?: string;
}

/**
 * Badge discreto que mostra de onde veio a resposta do agente.
 * - Tenant: "Sua LLM · Claude" (verde)
 * - Platform: "LLM Arcádia · Claude" (âmbar)
 */
export function LlmSourceBadge({ source, provider, model, className }: Props) {
  if (!source && !provider) return null;

  const isTenant = source === "tenant";
  const providerLabel = provider ? (PROVIDER_LABELS[provider] ?? provider) : null;
  const shortModel = model?.replace(/^claude-/, "").replace(/-\\d{8}$/, "") ?? null;

  const label = isTenant ? "Sua LLM" : "LLM Arcádia";
  const tooltip = isTenant
    ? \`Usando sua chave de API (\${providerLabel ?? "?"})\`
    : \`Usando o pool da plataforma Arcádia (\${providerLabel ?? "?"}) — tokens contabilizados na plataforma\`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={\`text-[10px] h-5 gap-1 cursor-default select-none \${
            isTenant ? "border-green-500/40 text-green-700" : "border-amber-500/40 text-amber-700"
          } \${className ?? ""}\`}
        >
          {isTenant ? <Building2 className="h-2.5 w-2.5" /> : <Cpu className="h-2.5 w-2.5" />}
          {label}
          {providerLabel && <span className="opacity-70">· {shortModel ?? providerLabel}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[240px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 2. LlmUsageDashboard.tsx — consumo por empresa-cliente
// ─────────────────────────────────────────────────────────────
write('client/src/components/LlmUsageDashboard.tsx', `
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, Cell } from "recharts";

interface UsageByClient {
  clientId: string;
  clientName: string;
  tokensTotal: number;
  tokensInput: number;
  tokensOutput: number;
  callCount: number;
  source: string; // 'tenant' | 'platform' | 'mixed'
}

export function LlmUsageDashboard() {
  const { data, isLoading } = useQuery<UsageByClient[]>({
    queryKey: ["/api/tenant/ai-usage-by-client"],
  });

  const totalTokens = (data || []).reduce((s, r) => s + r.tokensTotal, 0);
  const platformTokens = (data || []).filter(r => r.source !== 'tenant').reduce((s, r) => s + r.tokensTotal, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Uso de IA por empresa-cliente</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Uso de IA por empresa-cliente</span>
          <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>Total: <strong>{totalTokens.toLocaleString('pt-BR')}</strong> tokens</span>
            {platformTokens > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500/40">
                {platformTokens.toLocaleString('pt-BR')} via plataforma
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!data || data.length === 0) ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Nenhum uso de IA registrado ainda
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="clientName" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={v => v.length > 12 ? v.slice(0, 10) + '…' : v} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1000 ? \`\${(v/1000).toFixed(0)}k\` : v} />
                <ChartTooltip
                  formatter={(v: number, name: string) => [v.toLocaleString('pt-BR'), name === 'tokensTotal' ? 'Tokens' : name]}
                  labelFormatter={(l) => l}
                />
                <Bar dataKey="tokensTotal" radius={[3, 3, 0, 0]}>
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.source === 'tenant' ? '#1D9E75' : entry.source === 'platform' ? '#BA7517' : '#7F77DD'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-3 space-y-1">
              {data.map(r => (
                <div key={r.clientId} className="flex items-center justify-between text-xs py-1 border-b border-muted/40 last:border-0">
                  <span className="font-medium truncate max-w-[160px]">{r.clientName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{r.callCount} chamadas</span>
                    <span className="font-medium">{r.tokensTotal.toLocaleString('pt-BR')}</span>
                    <Badge
                      variant="outline"
                      className={\`text-[9px] h-4 \${
                        r.source === 'tenant' ? 'border-green-500/40 text-green-700' :
                        r.source === 'platform' ? 'border-amber-500/40 text-amber-700' :
                        'border-purple-500/40 text-purple-700'
                      }\`}
                    >
                      {r.source === 'tenant' ? 'Sua LLM' : r.source === 'platform' ? 'Plataforma' : 'Misto'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 3. Backend route: GET /api/tenant/ai-usage-by-client
// ─────────────────────────────────────────────────────────────
const routesPath = path.join(ROOT, 'server/routes.ts');
if (fs.existsSync(routesPath)) {
  let routes = fs.readFileSync(routesPath, 'utf8');
  const newRoute = `
  // ── LLM usage by client (for tenant dashboard)
  app.get("/api/tenant/ai-usage-by-client", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { aiUsageLogs, projects, clients } = await import("../shared/schema");
      const { eq, sql, and } = await import("drizzle-orm");

      // Aggregate tokens per project, then join to client
      const rows = await db
        .select({
          clientId: clients.id,
          clientName: clients.name,
          tokensInput: sql<number>\`COALESCE(SUM(\${aiUsageLogs.tokensInput}), 0)\`,
          tokensOutput: sql<number>\`COALESCE(SUM(\${aiUsageLogs.tokensOutput}), 0)\`,
          tokensTotal: sql<number>\`COALESCE(SUM(\${aiUsageLogs.tokensInput}) + SUM(\${aiUsageLogs.tokensOutput}), 0)\`,
          callCount: sql<number>\`COUNT(*)\`,
          // source: if all platform → 'platform', all tenant → 'tenant', else 'mixed'
          source: sql<string>\`
            CASE
              WHEN COUNT(*) FILTER (WHERE \${aiUsageLogs.source} = 'tenant') = COUNT(*) THEN 'tenant'
              WHEN COUNT(*) FILTER (WHERE \${aiUsageLogs.source} = 'platform') = COUNT(*) THEN 'platform'
              ELSE 'mixed'
            END
          \`,
        })
        .from(aiUsageLogs)
        .innerJoin(projects, eq(aiUsageLogs.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(eq(aiUsageLogs.tenantId, req.tenantId!))
        .groupBy(clients.id, clients.name)
        .orderBy(sql\`tokensTotal DESC\`);

      res.json(rows);
    } catch (error) {
      console.error("Error fetching AI usage by client:", error);
      res.status(500).json({ message: "Failed to fetch AI usage" });
    }
  });
`;

  if (!routes.includes('/api/tenant/ai-usage-by-client')) {
    // Append before end of registerRoutes
    const marker = '} // end registerRoutes';
    if (routes.includes(marker)) {
      routes = routes.replace(marker, newRoute + '\n' + marker);
    } else {
      // Append at the very end of the function body
      routes = routes.trimEnd() + '\n' + newRoute + '\n';
    }
    fs.writeFileSync(routesPath, routes, 'utf8');
    console.log('  ✅ server/routes.ts: rota /api/tenant/ai-usage-by-client');
  } else {
    console.log('  ℹ️  /api/tenant/ai-usage-by-client já existe');
  }
}

console.log('\n✅ Patch 04 (MT-4 LLM UX) aplicado.');
console.log('   Arquivos criados/modificados:');
console.log('   - client/src/components/LlmSourceBadge.tsx');
console.log('   - client/src/components/LlmUsageDashboard.tsx');
console.log('   - server/routes.ts: GET /api/tenant/ai-usage-by-client');
console.log('\n   Para usar:');
console.log('   1. <LlmSourceBadge source={msg.llmSource} provider={msg.llmProvider} /> no chat de agente');
console.log('   2. <LlmUsageDashboard /> na página de configurações de IA');
console.log('   3. No agentService.ts, incluir source/provider nos dados da mensagem SSE');
