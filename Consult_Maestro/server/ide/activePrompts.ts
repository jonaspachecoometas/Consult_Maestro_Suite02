// Sprint 8 — Resolução do system prompt ATIVO por (tenant, agentType).
//
// Estratégia:
//   - getActivePromptOrDefault(tenantId, agentType, fallback) é PURA leitura:
//     devolve a versão isActive=1 se existir, senão `fallback`. Sem side-effect.
//     Isso é essencial para o orquestrador, cujo `fallback` do Architect é
//     dinâmico por target (suite/consult/standalone/clone) — preservamos
//     Sprint 6 quando o Studio ainda não materializou prompt para o tenant.
//
//   - O seed só acontece via Studio: GET /api/ide/prompts chama
//     ensureSeedAllForTenant, que copia os defaults de prompts.ts para o
//     tenant como linhas isActive=1 editáveis. Esse é o ponto onde o usuário
//     "puxa" os prompts para o banco e ganha controle de versão.
//
// Race-safety: índice parcial UNIQUE uq_pv_tenant_agent_active garante que
// (tenant, agent) tenha no máximo UMA isActive=1. Seeds e activates
// concorrentes nunca produzem 2 ativos.

import { db } from "../db";
import { promptVersions } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import {
  ARCHITECT_SYSTEM,
  DEVELOPER_SYSTEM,
  QA_SYSTEM,
} from "./prompts";

// Devops ainda não tem prompt dedicado em prompts.ts; usamos um padrão curto
// que descreve o papel do agente de deploy do pipeline.
export const DEVOPS_SYSTEM_DEFAULT = `<System>
Você é o Agente DevOps do Dev Center da Arcádia.
Responsável por executar o deploy de artefatos aprovados (DocTypes, Server
Scripts, Hooks) no ambiente Frappe alvo do tenant. Não modifique DocTypes
core do ERPNext. Apenas execute o plano aprovado e reporte sucesso/falha por
artefato.
</System>

<Output>
JSON estrito: { "deployed": [ { "path": string, "status": "ok"|"failed", "message": string } ], "summary": string }
</Output>`;

export const KNOWN_AGENT_TYPES = ["architect", "developer", "qa", "devops"] as const;
export type AgentType = (typeof KNOWN_AGENT_TYPES)[number];

export function defaultPromptFor(agentType: string): string {
  switch (agentType) {
    case "architect": return ARCHITECT_SYSTEM;
    case "developer": return DEVELOPER_SYSTEM;
    case "qa":        return QA_SYSTEM;
    case "devops":    return DEVOPS_SYSTEM_DEFAULT;
    default:          return "";
  }
}

/**
 * Garante que exista pelo menos uma versão (isActive=1) para o par
 * (tenantId, agentType). Idempotente — race-safe via unique partial index
 * `uq_pv_tenant_agent_active` (tenant, agent) WHERE is_active=1: dois seeds
 * concorrentes nunca produzem duas linhas ativas; a perdedora é descartada
 * silenciosamente via ON CONFLICT DO NOTHING.
 */
export async function ensureSeedPrompt(tenantId: string, agentType: string): Promise<void> {
  const fallback = defaultPromptFor(agentType);
  if (!fallback) return; // agentType custom sem default — não seedamos
  const existing = await db
    .select({ id: promptVersions.id })
    .from(promptVersions)
    .where(and(eq(promptVersions.tenantId, tenantId), eq(promptVersions.agentType, agentType)))
    .limit(1);
  if (existing.length > 0) return;
  // ON CONFLICT DO NOTHING (sem target) — captura violação do unique partial
  // index uq_pv_tenant_agent_active. Race-safe.
  await db
    .insert(promptVersions)
    .values({
      tenantId,
      agentType,
      versionName: "default",
      systemPrompt: fallback,
      changeNotes: "Seed automático: cópia do prompt padrão de prompts.ts.",
      isActive: 1,
    })
    .onConflictDoNothing();
}

/**
 * Garante o seed de TODOS os agentes conhecidos para o tenant. Útil ao
 * primeiro acesso ao Studio.
 */
export async function ensureSeedAllForTenant(tenantId: string): Promise<void> {
  await Promise.all(KNOWN_AGENT_TYPES.map((a) => ensureSeedPrompt(tenantId, a)));
}

/**
 * Retorna o system prompt ativo para o (tenant, agentType). NÃO faz seed —
 * se não houver nenhuma versão isActive=1, devolve o fallback informado pelo
 * chamador. Isso é importante para o orquestrador: o fallback do Architect
 * pode ser dinâmico por target (ARCHITECT_SUITE_PROMPT, ARCHITECT_CONSULT_PROMPT
 * etc.), e precisamos preservar essa semântica até que o Studio explicitamente
 * crie uma versão para o tenant.
 *
 * O seed é feito apenas pelo Studio quando o usuário abre a página
 * (ensureSeedAllForTenant em GET /api/ide/prompts), o que materializa um
 * prompt editável a partir do default genérico do agente.
 */
export async function getActivePromptOrDefault(
  tenantId: string | null | undefined,
  agentType: string,
  fallback: string,
): Promise<string> {
  if (!tenantId) return fallback;
  try {
    const [row] = await db
      .select({ systemPrompt: promptVersions.systemPrompt })
      .from(promptVersions)
      .where(and(
        eq(promptVersions.tenantId, tenantId),
        eq(promptVersions.agentType, agentType),
        eq(promptVersions.isActive, 1),
      ))
      .orderBy(desc(promptVersions.createdAt))
      .limit(1);
    if (row?.systemPrompt) return row.systemPrompt;
  } catch (e) {
    console.warn("[activePrompts] falha ao resolver prompt ativo, usando fallback:", e);
  }
  return fallback;
}
