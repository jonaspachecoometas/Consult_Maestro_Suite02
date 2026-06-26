import { db } from "./db";
import { agentDefinitions } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { SEED_AGENT_DEFINITIONS, type SeedAgentDefinition } from "./seedAgentDefinitionsData";
import { seedContabilAgentsIfNeeded } from "./seedContabilAgents";
import { seedMaestroB2cIfNeeded } from "./seedMaestroB2c";

function buildDescription(a: SeedAgentDefinition): string {
  const tools = a.tools.length ? a.tools.join(", ") : "—";
  return `Agente Arcádia · módulo: ${a.module} · tools previstas: ${tools}`;
}

export async function seedAgentDefinitionsIfNeeded(): Promise<void> {
  const inserted: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const a of SEED_AGENT_DEFINITIONS) {
    const existing = await db
      .select()
      .from(agentDefinitions)
      .where(and(isNull(agentDefinitions.tenantId), eq(agentDefinitions.slug, a.slug)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(agentDefinitions).values({
        tenantId: null,
        name: a.name,
        slug: a.slug,
        description: buildDescription(a),
        systemPrompt: a.systemPrompt,
        contextModules: a.contextModules,
        visibleIn: a.visibleIn,
        maxTokens: 4000,
        isActive: 1,
        createdBy: null,
      });
      inserted.push(a.slug);
      continue;
    }

    const cur = existing[0];
    const desc = buildDescription(a);
    const arrEq = (x: string[] | null, y: string[]) =>
      Array.isArray(x) && x.length === y.length && x.every((v, i) => v === y[i]);
    const differs =
      (cur.systemPrompt || "") !== a.systemPrompt ||
      (cur.name || "") !== a.name ||
      (cur.description || "") !== desc ||
      !arrEq(cur.visibleIn ?? null, a.visibleIn) ||
      !arrEq(cur.contextModules ?? null, a.contextModules) ||
      (cur.maxTokens ?? 0) !== 4000;

    if (differs) {
      await db
        .update(agentDefinitions)
        .set({
          name: a.name,
          description: desc,
          systemPrompt: a.systemPrompt,
          visibleIn: a.visibleIn,
          contextModules: a.contextModules,
          maxTokens: 4000,
          updatedAt: new Date(),
        })
        .where(eq(agentDefinitions.id, cur.id));
      updated.push(a.slug);
    } else {
      skipped.push(a.slug);
    }
  }

  console.log(
    `[seed] agent_definitions: inserted=${inserted.length} updated=${updated.length} unchanged=${skipped.length}` +
      (inserted.length ? ` | new: ${inserted.join(",")}` : "") +
      (updated.length ? ` | updated: ${updated.join(",")}` : ""),
  );

  // Pack Contabilidade — 60 agentes especializados (Task #54)
  await seedContabilAgentsIfNeeded();

  // Maestro IA (B2C) — consultor do cliente final, liberado via flag b2cAvailable
  await seedMaestroB2cIfNeeded();
}
