/**
 * skillsLibrary — biblioteca de "skills" de browser reutilizáveis.
 *
 * Uma skill é uma sequência nomeada de passos (cada passo chama uma tool do
 * toolRegistry, ex.: browser_navigate → browser_login → browser_click). O agente
 * salva uma skill ao final de uma tarefa bem-sucedida e pode reexecutá-la depois
 * (manual, via tool browser_run_skill, ou agendada pelo AutomationEngine).
 *
 * Sem dependência de IStorage — acessa `db` direto (mesmo padrão dos outros
 * serviços de browserAgent).
 */
import { db } from "../db";
import { browserSkills, type BrowserSkill } from "@shared/schema";
import { and, eq, desc, ilike, or } from "drizzle-orm";
import { toolRegistry, type ToolContext } from "../mcp/toolRegistry";

export interface SaveSkillOpts {
  name: string;
  title: string;
  description?: string;
  systemSlug?: string;
  steps: Array<Record<string, any>>;
  scope?: string;
  source?: string;
}

/** Cria (ou atualiza, se já existir mesmo name no tenant) uma skill. */
export async function saveSkill(tenantId: string, opts: SaveSkillOpts): Promise<BrowserSkill> {
  const existing = await db
    .select()
    .from(browserSkills)
    .where(and(eq(browserSkills.tenantId, tenantId), eq(browserSkills.name, opts.name)))
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(browserSkills)
      .set({
        title: opts.title,
        description: opts.description ?? existing[0].description,
        systemSlug: opts.systemSlug ?? existing[0].systemSlug,
        steps: opts.steps,
        scope: opts.scope ?? existing[0].scope ?? "tenant",
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(browserSkills.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(browserSkills)
    .values({
      tenantId,
      name: opts.name,
      title: opts.title,
      description: opts.description ?? null,
      systemSlug: opts.systemSlug ?? null,
      steps: opts.steps,
      scope: opts.scope ?? "tenant",
      source: opts.source ?? "agent",
    })
    .returning();
  return row;
}

/**
 * Procura uma skill ativa pelo nome (match exato primeiro, depois aproximado).
 * Considera skills do próprio tenant e skills com scope 'system' (compartilhadas).
 */
export async function findSkill(tenantId: string, query: string): Promise<BrowserSkill | null> {
  const visible = or(eq(browserSkills.tenantId, tenantId), eq(browserSkills.scope, "system"));

  const exact = await db
    .select()
    .from(browserSkills)
    .where(and(visible, eq(browserSkills.status, "active"), eq(browserSkills.name, query)))
    .orderBy(desc(browserSkills.useCount))
    .limit(1);
  if (exact[0]) return exact[0];

  const fuzzy = await db
    .select()
    .from(browserSkills)
    .where(and(visible, eq(browserSkills.status, "active"), ilike(browserSkills.name, `%${query}%`)))
    .orderBy(desc(browserSkills.useCount))
    .limit(1);
  return fuzzy[0] ?? null;
}

/** Lista skills (ativas e arquivadas) do tenant + as de scope 'system'. */
export async function listSkills(tenantId: string): Promise<BrowserSkill[]> {
  return db
    .select()
    .from(browserSkills)
    .where(or(eq(browserSkills.tenantId, tenantId), eq(browserSkills.scope, "system")))
    .orderBy(desc(browserSkills.useCount), desc(browserSkills.updatedAt));
}

export interface SkillRunResult {
  skillId: string;
  name: string;
  ok: boolean;
  steps: Array<{ index: number; tool: string; label?: string; ok: boolean; result: any }>;
}

/**
 * Tools que uma skill de browser pode invocar. Restringir o universo de tools
 * impede que uma skill (salva ou agendada) acione qualquer ferramenta registrada
 * no toolRegistry (ex.: ferramentas de societário/control) — limita a superfície
 * de abuso ao escopo esperado do módulo de browser + aprovação HITL.
 */
export function isAllowedSkillTool(toolName: string): boolean {
  return toolName.startsWith("browser_") || toolName === "request_approval";
}

/**
 * Executa cada passo da skill chamando a tool correspondente no toolRegistry.
 * Todos os passos compartilham o mesmo taskId (mesma sessão de browser/cookies).
 * Atualiza use_count, success_rate e last_used_at ao final.
 *
 * Isolamento: só executa skill visível ao tenant do ctx (próprio tenant ou
 * scope='system') e com status 'active'. Evita IDOR cross-tenant via skillId.
 */
export async function executeSkill(
  skillId: string,
  taskId: string,
  ctx: ToolContext,
): Promise<SkillRunResult> {
  const tenantId = ctx.tenantId;
  const visible = tenantId
    ? or(eq(browserSkills.tenantId, tenantId), eq(browserSkills.scope, "system"))
    : eq(browserSkills.scope, "system");

  const [skill] = await db
    .select()
    .from(browserSkills)
    .where(and(eq(browserSkills.id, skillId), visible, eq(browserSkills.status, "active")))
    .limit(1);
  if (!skill) {
    return { skillId, name: skillId, ok: false, steps: [] };
  }

  const stepCtx: ToolContext = { ...ctx, meta: { ...(ctx.meta ?? {}), taskId } };
  const steps = (skill.steps ?? []) as Array<Record<string, any>>;
  const results: SkillRunResult["steps"] = [];
  let allOk = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const toolName = step.tool as string;
    const input = (step.input ?? {}) as Record<string, any>;
    const label = step.label as string | undefined;
    if (!toolName) {
      allOk = false;
      results.push({ index: i, tool: "(ausente)", label, ok: false, result: { error: "step sem 'tool'" } });
      break;
    }
    if (!isAllowedSkillTool(toolName)) {
      allOk = false;
      results.push({ index: i, tool: toolName, label, ok: false, result: { error: `tool '${toolName}' não permitida em skills de browser` } });
      break;
    }
    const result = await toolRegistry.execute(toolName, input, stepCtx);
    const ok = !(result && typeof result === "object" && "error" in result);
    results.push({ index: i, tool: toolName, label, ok, result });
    if (!ok) {
      allOk = false;
      break;
    }
  }

  // Métricas: média móvel simples do success_rate (peso 1 por execução).
  const prevRate = Number(skill.successRate ?? 0);
  const prevCount = skill.useCount ?? 0;
  const newCount = prevCount + 1;
  const newRate = (prevRate * prevCount + (allOk ? 1 : 0)) / newCount;

  await db
    .update(browserSkills)
    .set({
      useCount: newCount,
      successRate: String(Number(newRate.toFixed(4))),
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(browserSkills.id, skill.id));

  return { skillId: skill.id, name: skill.name, ok: allOk, steps: results };
}

/** Atualiza os passos de uma skill (escopo do tenant). */
export async function updateSkillSteps(
  tenantId: string,
  skillId: string,
  steps: Array<Record<string, any>>,
): Promise<BrowserSkill | null> {
  const [row] = await db
    .update(browserSkills)
    .set({ steps, updatedAt: new Date() })
    .where(and(eq(browserSkills.id, skillId), eq(browserSkills.tenantId, tenantId)))
    .returning();
  return row ?? null;
}

/** Arquiva (soft-delete) uma skill do tenant. */
export async function archiveSkill(tenantId: string, skillId: string): Promise<BrowserSkill | null> {
  const [row] = await db
    .update(browserSkills)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(browserSkills.id, skillId), eq(browserSkills.tenantId, tenantId)))
    .returning();
  return row ?? null;
}
