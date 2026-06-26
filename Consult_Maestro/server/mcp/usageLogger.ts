/**
 * MCP Hub — AI usage logger (Sprint 1)
 *
 * Single wrapper used by every LLM call site to record consumption into
 * `ai_usage_logs`. Powers the per-tenant usage dashboard (Sprint 4) and the
 * tenant-vs-platform fallback audit trail.
 *
 * Failures here NEVER bubble up — logging an LLM call must never break the
 * agent response. We log failures via console.warn and move on.
 */

import { db } from "../db";
import { aiUsageLogs } from "@shared/schema";

export type AiSource = "tenant" | "platform" | "partner_api";
export type AiProviderName = "anthropic" | "gemini" | "kimi" | "ollama" | "mcp_public";

export interface RecordAiUsageInput {
  tenantId: string | null | undefined;
  userId?: string | null;
  provider: AiProviderName;
  model: string;
  source: AiSource;
  tokensInput?: number;
  tokensOutput?: number;
  taskType?: string | null;
}

export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  if (!input.tenantId) {
    // Platform-level calls without tenant context (rare) are not auditable yet.
    return;
  }
  try {
    await db.insert(aiUsageLogs).values({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      provider: input.provider,
      model: input.model,
      source: input.source,
      tokensInput: Math.max(0, Math.floor(input.tokensInput ?? 0)),
      tokensOutput: Math.max(0, Math.floor(input.tokensOutput ?? 0)),
      taskType: input.taskType ?? null,
    });
  } catch (err: any) {
    console.warn("[mcp/usageLogger] failed to record AI usage:", err?.message ?? err);
  }
}
