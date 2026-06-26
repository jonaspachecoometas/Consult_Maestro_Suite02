/**
 * Task #47 — Admin routes para o orquestrador LLM (superadmin only).
 *
 *   GET  /api/admin/llm/health        → estado em memória dos 4 providers
 *   GET  /api/admin/llm/decisions     → agregados de llm_decisions (default 1d)
 *   GET  /api/admin/llm/budget        → tokens e custo do tenant na janela
 *   POST /api/admin/llm/health/probe  → força um probe imediato (cron normal é 5min)
 */
import type { Express } from "express";
import { db } from "../db";
import { llmDecisions, aiUsageLogs } from "@shared/schema";
import { sql, and, gte, eq } from "drizzle-orm";
import { isAuthenticated } from "../portableAuth";
import { requireSuperadmin } from "../tenantContext";
import {
  getAllProviderHealth,
  checkAllProviders,
} from "./providerHealthWorker";
import { listKnownTaskTypes } from "./taskCascade";
import {
  AI_PROVIDERS,
  type AiProvider,
  listPlatformAiConfigs,
  upsertPlatformAiConfig,
  deletePlatformAiConfig,
  testPlatformProviderConnection,
} from "../aiConfigService";

export function registerAdminLlmRoutes(app: Express): void {
  // ── Health (Map em memória) ──
  app.get("/api/admin/llm/health", isAuthenticated, requireSuperadmin, async (_req, res) => {
    const map = getAllProviderHealth();
    const out = Object.entries(map).map(([provider, h]) => ({
      provider,
      isHealthy: h?.isHealthy ?? null,
      latencyMs: h?.latencyMs ?? null,
      lastCheckedAt: h?.lastCheckedAt ? new Date(h.lastCheckedAt).toISOString() : null,
      lastErrorMsg: h?.lastErrorMsg ?? null,
      stale: h === null,
    }));
    res.json({ providers: out, knownTaskTypes: listKnownTaskTypes() });
  });

  app.post("/api/admin/llm/health/probe", isAuthenticated, requireSuperadmin, async (_req, res) => {
    await checkAllProviders();
    res.json({ ok: true, providers: getAllProviderHealth() });
  });

  // ── Decisions agregadas ──
  app.get("/api/admin/llm/decisions", isAuthenticated, requireSuperadmin, async (req, res) => {
    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 1)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Agregado por provider
    const byProvider = await db
      .select({
        provider: llmDecisions.providerUsed,
        outcome: llmDecisions.outcome,
        count: sql<string>`COUNT(*)`,
        tokens: sql<string>`COALESCE(SUM(${llmDecisions.tokensIn} + ${llmDecisions.tokensOut}), 0)`,
        cost: sql<string>`COALESCE(SUM(${llmDecisions.costUsd}), 0)`,
        avgLatency: sql<string>`COALESCE(AVG(${llmDecisions.latencyMs}), 0)`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .groupBy(llmDecisions.providerUsed, llmDecisions.outcome);

    // Agregado por taskType + tier
    const byTaskTier = await db
      .select({
        taskType: llmDecisions.taskType,
        tier: llmDecisions.tier,
        count: sql<string>`COUNT(*)`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .groupBy(llmDecisions.taskType, llmDecisions.tier);

    // Modelo ativo por taskType (último modelo bem-sucedido)
    type ActiveModelRow = { task_type: string; provider_used: string; model_used: string; last_used: Date } & Record<string, unknown>;
    const activeModelResult = await db.execute<ActiveModelRow>(sql`
      SELECT DISTINCT ON (task_type)
        task_type, provider_used, model_used, created_at AS last_used
      FROM llm_decisions
      WHERE created_at >= ${since} AND outcome IN ('success', 'fallback_used')
      ORDER BY task_type, created_at DESC
    `);
    // neondb-serverless retorna { rows }; node-postgres pode retornar Array.
    const activeModelByTask: ActiveModelRow[] = Array.isArray(activeModelResult)
      ? (activeModelResult as ActiveModelRow[])
      : ((activeModelResult as { rows?: ActiveModelRow[] }).rows ?? []);

    // Custo por taskType
    const costByTask = await db
      .select({
        taskType: llmDecisions.taskType,
        cost: sql<string>`COALESCE(SUM(${llmDecisions.costUsd}), 0)`,
        tokens: sql<string>`COALESCE(SUM(${llmDecisions.tokensIn} + ${llmDecisions.tokensOut}), 0)`,
        calls: sql<string>`COUNT(*)`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .groupBy(llmDecisions.taskType)
      .orderBy(sql`SUM(${llmDecisions.costUsd}) DESC NULLS LAST`)
      .limit(20);

    // Latência por modelo × taskType
    const latencyByModelTask = await db
      .select({
        taskType: llmDecisions.taskType,
        provider: llmDecisions.providerUsed,
        model: llmDecisions.modelUsed,
        avgLatency: sql<string>`COALESCE(AVG(${llmDecisions.latencyMs}), 0)`,
        p95Latency: sql<string>`COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ${llmDecisions.latencyMs}), 0)`,
        calls: sql<string>`COUNT(*)`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .groupBy(llmDecisions.taskType, llmDecisions.providerUsed, llmDecisions.modelUsed)
      .orderBy(sql`AVG(${llmDecisions.latencyMs}) DESC NULLS LAST`)
      .limit(30);

    // Qualidade média por provider × modelo (apenas onde quality_score foi enviado)
    const qualityByModel = await db
      .select({
        provider: llmDecisions.providerUsed,
        model: llmDecisions.modelUsed,
        avgQuality: sql<string>`COALESCE(AVG(${llmDecisions.qualityScore}), 0)`,
        samples: sql<string>`COUNT(${llmDecisions.qualityScore})`,
      })
      .from(llmDecisions)
      .where(and(gte(llmDecisions.createdAt, since), sql`${llmDecisions.qualityScore} IS NOT NULL`))
      .groupBy(llmDecisions.providerUsed, llmDecisions.modelUsed)
      .orderBy(sql`AVG(${llmDecisions.qualityScore}) DESC NULLS LAST`);

    // Frequência de fallback (tier >= 2) na janela
    const fallbackFreq = await db
      .select({
        total: sql<string>`COUNT(*)`,
        fallbacks: sql<string>`COUNT(*) FILTER (WHERE ${llmDecisions.tier} >= 2 OR ${llmDecisions.outcome} = 'fallback_used')`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since));

    // Top 10 reasons
    const byReason = await db
      .select({
        reason: llmDecisions.reason,
        count: sql<string>`COUNT(*)`,
      })
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .groupBy(llmDecisions.reason)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    // Últimas 50
    const recent = await db
      .select()
      .from(llmDecisions)
      .where(gte(llmDecisions.createdAt, since))
      .orderBy(sql`${llmDecisions.createdAt} DESC`)
      .limit(50);

    const fbRow = fallbackFreq[0];
    const fbTotal = fbRow ? Number(fbRow.total) : 0;
    const fbCount = fbRow ? Number(fbRow.fallbacks) : 0;

    res.json({
      windowDays: days,
      since: since.toISOString(),
      byProvider: byProvider.map((r) => ({ ...r, count: Number(r.count), tokens: Number(r.tokens), cost: Number(r.cost), avgLatency: Number(r.avgLatency) })),
      byTaskTier: byTaskTier.map((r) => ({ ...r, count: Number(r.count) })),
      byReason: byReason.map((r) => ({ ...r, count: Number(r.count) })),
      // Novos painéis (architect Task #47): observabilidade requerida
      activeModelByTask,
      costByTask: costByTask.map((r) => ({ ...r, cost: Number(r.cost), tokens: Number(r.tokens), calls: Number(r.calls) })),
      latencyByModelTask: latencyByModelTask.map((r) => ({ ...r, avgLatency: Number(r.avgLatency), p95Latency: Number(r.p95Latency), calls: Number(r.calls) })),
      qualityByModel: qualityByModel.map((r) => ({ ...r, avgQuality: Number(r.avgQuality), samples: Number(r.samples) })),
      fallbackFrequency: {
        total: fbTotal,
        fallbackCount: fbCount,
        fallbackRate: fbTotal > 0 ? fbCount / fbTotal : 0,
      },
      recent,
    });
  });

  // ── Status das chaves de provedores LLM na plataforma (env-based) ──
  app.get("/api/admin/llm/platform-keys", isAuthenticated, requireSuperadmin, async (_req, res) => {
    const env = process.env;
    const detect = (vars: string[]): { configured: boolean; source: string | null } => {
      for (const v of vars) {
        if (env[v] && String(env[v]).length > 0) return { configured: true, source: v };
      }
      return { configured: false, source: null };
    };
    const providers = [
      { provider: "anthropic", label: "Claude (Anthropic)", ...detect(["ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY"]) },
      { provider: "openai",    label: "OpenAI",             ...detect(["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"]) },
      { provider: "gemini",    label: "Gemini (Google)",    ...detect(["GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY"]) },
      { provider: "kimi",      label: "Kimi (Moonshot)",    ...detect(["KIMI_API_KEY", "MOONSHOT_API_KEY"]) },
      { provider: "ollama",    label: "Ollama (privado)",   ...detect(["OLLAMA_BASE_URL"]) },
    ];
    res.json({ providers, note: "Chaves de plataforma também podem ser cadastradas no banco via 'Chaves de plataforma' abaixo (sobrepõe as env vars)." });
  });

  // ── Platform AI configs (CRUD — superadmin) ──
  app.get("/api/admin/llm/config", isAuthenticated, requireSuperadmin, async (_req, res) => {
    const configs = await listPlatformAiConfigs();
    res.json(configs);
  });

  app.post("/api/admin/llm/config", isAuthenticated, requireSuperadmin, async (req, res) => {
    const { provider, apiKey, model, baseUrl, isActive } = req.body ?? {};
    if (!provider || !AI_PROVIDERS.includes(provider as AiProvider)) {
      return res.status(400).json({ error: "provider inválido" });
    }
    try {
      await upsertPlatformAiConfig(provider as AiProvider, { apiKey, model, baseUrl, isActive });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "erro" });
    }
  });

  app.delete("/api/admin/llm/config/:provider", isAuthenticated, requireSuperadmin, async (req, res) => {
    const provider = req.params.provider as AiProvider;
    if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ error: "provider inválido" });
    await deletePlatformAiConfig(provider);
    res.json({ ok: true });
  });

  app.post("/api/admin/llm/config/test", isAuthenticated, requireSuperadmin, async (req, res) => {
    const { provider, apiKey, baseUrl } = req.body ?? {};
    if (!provider || !AI_PROVIDERS.includes(provider as AiProvider)) {
      return res.status(400).json({ error: "provider inválido" });
    }
    const result = await testPlatformProviderConnection(provider as AiProvider, { apiKey, baseUrl });
    res.json(result);
  });

  // ── Budget de um tenant (tokens + custo aproximado) ──
  app.get("/api/admin/llm/budget", isAuthenticated, requireSuperadmin, async (req, res) => {
    const tenantId = String(req.query.tenantId ?? "").trim();
    if (!tenantId) return res.status(400).json({ error: "tenantId é obrigatório" });
    const days = Math.max(1, Math.min(31, Number(req.query.days ?? 1)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [usage] = await db
      .select({
        tokens: sql<string>`COALESCE(SUM(${aiUsageLogs.tokensInput} + ${aiUsageLogs.tokensOutput}), 0)`,
        calls: sql<string>`COUNT(*)`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, since)));

    const [decisions] = await db
      .select({
        cost: sql<string>`COALESCE(SUM(${llmDecisions.costUsd}), 0)`,
        fallbacks: sql<string>`COUNT(*) FILTER (WHERE ${llmDecisions.outcome} = 'fallback_used')`,
        failed: sql<string>`COUNT(*) FILTER (WHERE ${llmDecisions.outcome} = 'all_failed')`,
      })
      .from(llmDecisions)
      .where(and(eq(llmDecisions.tenantId, tenantId), gte(llmDecisions.createdAt, since)));

    res.json({
      tenantId,
      windowDays: days,
      tokens: Number(usage?.tokens ?? 0),
      calls: Number(usage?.calls ?? 0),
      estimatedCostUsd: Number(decisions?.cost ?? 0),
      fallbackCount: Number(decisions?.fallbacks ?? 0),
      failedCount: Number(decisions?.failed ?? 0),
    });
  });
}
