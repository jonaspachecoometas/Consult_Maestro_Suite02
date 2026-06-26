// Sprint 3C — preferências de modelo Claude por fase, por tenant.
// Tabela: ide_preferences (UNIQUE(tenant_id)).

import { db } from "../db";
import { idePreferences } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isAllowedModel, getDefaultModelForPhase } from "./models";

export interface IdePreferencesView {
  modelArchitect: string;
  modelDeveloper: string;
  modelQa: string;
}

export async function getIdePreferences(tenantId: string): Promise<IdePreferencesView> {
  const [row] = await db
    .select()
    .from(idePreferences)
    .where(eq(idePreferences.tenantId, tenantId))
    .limit(1);
  return {
    modelArchitect: row?.modelArchitect || getDefaultModelForPhase("architect"),
    modelDeveloper: row?.modelDeveloper || getDefaultModelForPhase("developer"),
    modelQa:        row?.modelQa        || getDefaultModelForPhase("qa"),
  };
}

export async function upsertIdePreferences(
  tenantId: string,
  patch: Partial<IdePreferencesView>,
): Promise<IdePreferencesView> {
  // Validação: aceitar apenas modelos do catálogo (defesa contra injection
  // de strings arbitrárias que viriam a ser passadas para o SDK Anthropic).
  const sanitized: Partial<IdePreferencesView> = {};
  if (patch.modelArchitect !== undefined) {
    if (!isAllowedModel(patch.modelArchitect)) {
      throw new Error(`Modelo inválido para Architect: ${patch.modelArchitect}`);
    }
    sanitized.modelArchitect = patch.modelArchitect;
  }
  if (patch.modelDeveloper !== undefined) {
    if (!isAllowedModel(patch.modelDeveloper)) {
      throw new Error(`Modelo inválido para Developer: ${patch.modelDeveloper}`);
    }
    sanitized.modelDeveloper = patch.modelDeveloper;
  }
  if (patch.modelQa !== undefined) {
    if (!isAllowedModel(patch.modelQa)) {
      throw new Error(`Modelo inválido para QA: ${patch.modelQa}`);
    }
    sanitized.modelQa = patch.modelQa;
  }

  await db
    .insert(idePreferences)
    .values({
      tenantId,
      modelArchitect: sanitized.modelArchitect ?? null,
      modelDeveloper: sanitized.modelDeveloper ?? null,
      modelQa: sanitized.modelQa ?? null,
    })
    .onConflictDoUpdate({
      target: idePreferences.tenantId,
      set: {
        ...(sanitized.modelArchitect !== undefined && { modelArchitect: sanitized.modelArchitect }),
        ...(sanitized.modelDeveloper !== undefined && { modelDeveloper: sanitized.modelDeveloper }),
        ...(sanitized.modelQa !== undefined && { modelQa: sanitized.modelQa }),
        updatedAt: new Date(),
      },
    });

  return getIdePreferences(tenantId);
}
