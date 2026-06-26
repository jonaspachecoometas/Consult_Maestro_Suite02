// Sprint 8 — Rotas REST do Prompt Engineering Studio.
// Padrão: chain auth [isAuthenticated, tenantContext, requireTenant].
// Operações que escrevem em prompt_versions exigem requireTenantAdmin —
// alterar prompts impacta todo o pipeline IDE do tenant.

import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { promptVersions } from "@shared/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant, requireTenantAdmin } from "../tenantContext";
import { runWithOrchestration, callChatLLM } from "../agentService";
import Anthropic from "@anthropic-ai/sdk";
import {
  ensureSeedAllForTenant,
  defaultPromptFor,
  KNOWN_AGENT_TYPES,
} from "./activePrompts";

const auth = [isAuthenticated, tenantContext, requireTenant];

// Lista de modelos permitidos no testador. Espelha o catálogo do Dev Center
// (server/ide/models.ts). Mantemos curto para não acoplar demais — o
// orquestrador real continua usando o modelo do tenant/política.
const TEST_MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "claude-opus-4",
  "claude-opus-4-1",
] as const;

type AnthropicMessage = { role: "user"; content: string };

/**
 * Task #48 — chamada via orquestrador. taskType `prompt_studio:test` /
 * `prompt_studio:optimize` cai em REASONING_CHAIN (anthropic→gemini→ollama),
 * com auditoria em `llm_decisions`. O override de modelo do UI ainda é
 * respeitado quando válido (allowlist TEST_MODELS).
 */
async function callPromptLLM(
  taskType: "prompt_studio:test" | "prompt_studio:optimize",
  tenantId: string,
  systemPrompt: string,
  messages: AnthropicMessage[],
  modelOverride?: string,
  maxTokens = 4096,
): Promise<{ output: string; tokensUsed: number; durationMs: number; model: string }> {
  const t0 = Date.now();
  const userPrompt = messages.map((m) => m.content).join("\n\n");
  const overrideOk = !!(modelOverride && (TEST_MODELS as readonly string[]).includes(modelOverride));
  const orch = await runWithOrchestration(
    taskType,
    tenantId,
    { sensitivity: "internal" },
    async (cb) => {
      // Override real: quando provider é Anthropic e o usuário escolheu um
      // modelo válido no UI, instanciamos o SDK direto para enviar esse
      // modelo (callChatLLM usaria sempre cb.model do orquestrador).
      if (overrideOk && cb.provider === "anthropic") {
        const client = new Anthropic({ apiKey: cb.apiKey ?? undefined, baseURL: cb.baseUrl ?? undefined });
        const result = await client.messages.create(
          { model: modelOverride!, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] },
          { signal: cb.signal as any },
        );
        const text = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        return { data: text, tokensIn: result.usage?.input_tokens ?? 0, tokensOut: result.usage?.output_tokens ?? 0 };
      }
      return callChatLLM(cb, { systemPrompt, userPrompt, maxTokens, signal: cb.signal });
    },
  );
  const useModel = (overrideOk && orch.providerUsed === "anthropic") ? modelOverride! : orch.modelUsed;
  return {
    output: orch.data,
    tokensUsed: orch.tokensIn + orch.tokensOut,
    durationMs: Date.now() - t0,
    model: useModel,
  };
}

export function registerPromptRoutes(app: Express) {
  // ---------------------------------------------------------------------------
  // GET /api/ide/prompts?agentType=architect — lista versões do tenant
  //   - sem agentType: retorna todas
  //   - faz seed lazy de todos os agentes conhecidos na primeira chamada
  // ---------------------------------------------------------------------------
  app.get("/api/ide/prompts", ...auth, async (req: any, res) => {
    try {
      await ensureSeedAllForTenant(req.tenantId);
      const agentType = typeof req.query.agentType === "string" ? req.query.agentType : null;
      const where = agentType
        ? and(eq(promptVersions.tenantId, req.tenantId), eq(promptVersions.agentType, agentType))
        : eq(promptVersions.tenantId, req.tenantId);
      const rows = await db
        .select()
        .from(promptVersions)
        .where(where)
        .orderBy(desc(promptVersions.createdAt));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Erro ao listar versões" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ide/prompts — criar nova versão (não ativa)
  // ---------------------------------------------------------------------------
  app.post("/api/ide/prompts", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      agentType: z.string().min(2).max(50),
      versionName: z.string().max(100).optional(),
      systemPrompt: z.string().min(10).max(50000),
      changeNotes: z.string().max(2000).optional(),
    });
    try {
      const data = schema.parse(req.body);
      const [created] = await db
        .insert(promptVersions)
        .values({
          tenantId: req.tenantId,
          agentType: data.agentType,
          versionName: data.versionName ?? null,
          systemPrompt: data.systemPrompt,
          changeNotes: data.changeNotes ?? null,
          createdById: req.user?.id ?? null,
          isActive: 0,
        })
        .returning();
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      res.status(500).json({ message: err?.message ?? "Erro ao salvar versão" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ide/prompts/:id/activate — marca esta versão como ativa
  // (e desativa as demais do mesmo agentType, em transação atômica).
  // ---------------------------------------------------------------------------
  app.post("/api/ide/prompts/:id/activate", ...auth, requireTenantAdmin, async (req: any, res) => {
    try {
      const [target] = await db
        .select({ id: promptVersions.id, agentType: promptVersions.agentType })
        .from(promptVersions)
        .where(and(eq(promptVersions.id, req.params.id), eq(promptVersions.tenantId, req.tenantId)))
        .limit(1);
      if (!target) return res.status(404).json({ message: "Versão não encontrada" });

      await db.transaction(async (tx) => {
        // Desativa todas as outras do mesmo agentType.
        await tx
          .update(promptVersions)
          .set({ isActive: 0 })
          .where(and(
            eq(promptVersions.tenantId, req.tenantId),
            eq(promptVersions.agentType, target.agentType),
          ));
        await tx
          .update(promptVersions)
          .set({ isActive: 1 })
          .where(eq(promptVersions.id, target.id));
      });
      res.json({ ok: true, id: target.id, agentType: target.agentType });
    } catch (err: any) {
      // Postgres '23505' = unique_violation. Quando dois activates concorrem,
      // o índice parcial uq_pv_tenant_agent_active impede 2 ativos simultâneos
      // — devolvemos 409 para o cliente saber que deve reler e tentar de novo.
      if (err?.code === "23505") {
        return res.status(409).json({
          message: "Conflito: outra ativação concorrente para este agente. Recarregue e tente novamente.",
        });
      }
      res.status(500).json({ message: err?.message ?? "Erro ao ativar versão" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ide/prompts/:id/test — roda o agente com este prompt
  //   body: { testInput, model? }
  //   retorna: { output, tokensUsed, durationMs, model }
  // ---------------------------------------------------------------------------
  app.post("/api/ide/prompts/:id/test", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      testInput: z.string().min(1).max(20000),
      model: z.string().max(80).optional(),
    });
    try {
      const data = schema.parse(req.body);
      const [version] = await db
        .select()
        .from(promptVersions)
        .where(and(eq(promptVersions.id, req.params.id), eq(promptVersions.tenantId, req.tenantId)))
        .limit(1);
      if (!version) return res.status(404).json({ message: "Versão não encontrada" });

      const r = await callPromptLLM(
        "prompt_studio:test",
        req.tenantId,
        version.systemPrompt,
        [{ role: "user", content: data.testInput }],
        data.model,
        4096,
      );
      res.json(r);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      res.status(502).json({ message: err?.message ?? "Erro ao executar teste" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ide/prompts/optimize — Claude analisa o prompt e sugere melhoria
  //   body: { promptId }
  //   retorna JSON estrito (ver schema no system prompt do otimizador).
  // ---------------------------------------------------------------------------
  const OPTIMIZER_SYSTEM = `Você é especialista em Prompt Engineering para LLMs.
Analise o system prompt fornecido e retorne APENAS JSON válido sem markdown. Avalie:
1. Clareza de identidade do agente
2. Especificidade das instruções (evitar verbos vagos)
3. Formato de output definido explicitamente
4. Guardrails — o que NÃO fazer está claro?
5. Exemplos de input/output presentes?
Score 0-100 baseado nesses 5 critérios.

Schema do JSON de resposta:
{
  "score": 0-100,
  "strengths": ["string", ...],
  "issues": [
    {
      "category": "identidade" | "instrucoes" | "formato" | "guardrails" | "exemplos",
      "severity": "critico" | "alto" | "medio" | "baixo",
      "problem": "string",
      "fix": "string"
    }
  ],
  "optimized_prompt": "string (versão melhorada do prompt completo)",
  "change_summary": "string (3-5 frases descrevendo o que mudou)"
}

Responda SOMENTE com o JSON. Sem texto antes/depois, sem markdown, sem \`\`\`.`;

  app.post("/api/ide/prompts/optimize", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({ promptId: z.string().min(1) });
    try {
      const data = schema.parse(req.body);
      const [version] = await db
        .select()
        .from(promptVersions)
        .where(and(eq(promptVersions.id, data.promptId), eq(promptVersions.tenantId, req.tenantId)))
        .limit(1);
      if (!version) return res.status(404).json({ message: "Versão não encontrada" });

      const userMsg = `Analise o seguinte system prompt do agente "${version.agentType}":

\`\`\`
${version.systemPrompt}
\`\`\`

Devolva o JSON conforme o schema.`;
      const r = await callPromptLLM(
        "prompt_studio:optimize",
        req.tenantId,
        OPTIMIZER_SYSTEM,
        [{ role: "user", content: userMsg }],
        undefined,
        6000,
      );
      // Tenta parsear JSON. Se vier com cerca de markdown, removemos.
      let raw = r.output.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      }
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(raw);
      } catch {
        return res.status(502).json({
          message: "Otimizador retornou resposta inválida (não-JSON).",
          raw: raw.slice(0, 4000),
        });
      }
      // Valida o shape do retorno do otimizador. Falha rápido se Claude não
      // respeitou o schema, em vez de propagar um objeto malformado para o UI.
      const optimizeShape = z.object({
        score: z.number().min(0).max(100),
        strengths: z.array(z.string()).default([]),
        issues: z.array(z.object({
          category: z.string(),
          severity: z.string(),
          problem: z.string(),
          fix: z.string(),
        })).default([]),
        optimized_prompt: z.string().min(1),
        change_summary: z.string().default(""),
      });
      const parseResult = optimizeShape.safeParse(parsedRaw);
      if (!parseResult.success) {
        return res.status(502).json({
          message: "Otimizador retornou JSON fora do schema esperado.",
          errors: parseResult.error.errors,
          raw: raw.slice(0, 4000),
        });
      }
      const parsed = parseResult.data;
      await db
        .update(promptVersions)
        .set({ testScore: Math.round(parsed.score) })
        .where(eq(promptVersions.id, version.id));
      res.json({
        ...parsed,
        meta: { tokensUsed: r.tokensUsed, durationMs: r.durationMs, model: r.model },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      res.status(502).json({ message: err?.message ?? "Erro ao otimizar" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ide/prompts/compare — roda A e B em paralelo com mesmo input
  // ---------------------------------------------------------------------------
  app.post("/api/ide/prompts/compare", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      promptIdA: z.string().min(1),
      promptIdB: z.string().min(1),
      testInput: z.string().min(1).max(20000),
      model: z.string().max(80).optional(),
    });
    try {
      const data = schema.parse(req.body);
      const ids = [data.promptIdA, data.promptIdB];
      const versions = await db
        .select()
        .from(promptVersions)
        .where(and(eq(promptVersions.tenantId, req.tenantId), sql`${promptVersions.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
      const va = versions.find((v) => v.id === data.promptIdA);
      const vb = versions.find((v) => v.id === data.promptIdB);
      if (!va || !vb) return res.status(404).json({ message: "Uma das versões não foi encontrada" });

      const [ra, rb] = await Promise.all([
        callPromptLLM("prompt_studio:test", req.tenantId, va.systemPrompt, [{ role: "user", content: data.testInput }], data.model, 4096),
        callPromptLLM("prompt_studio:test", req.tenantId, vb.systemPrompt, [{ role: "user", content: data.testInput }], data.model, 4096),
      ]);
      res.json({
        outputA: ra.output, tokensA: ra.tokensUsed, durationA: ra.durationMs, modelA: ra.model,
        outputB: rb.output, tokensB: rb.tokensUsed, durationB: rb.durationMs, modelB: rb.model,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      res.status(502).json({ message: err?.message ?? "Erro na comparação" });
    }
  });
}
