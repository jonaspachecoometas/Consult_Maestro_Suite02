import type { Express, Response } from "express";
import { db } from "../../db";
import {
  pipelineConfigs,
  pipelineChecklistItems,
  processosSocietarios,
  processoTarefas,
} from "@shared/schema";
import { isAuthenticated } from "../../portableAuth";
import { requireTenant, requireTenantAdmin } from "../../tenantContext";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

const colunaSchema = z.object({
  id: z.string().min(1).max(50),
  nome: z.string().min(1).max(80),
  ordem: z.number().int().min(0),
  cor: z.string().max(40).optional(),
  autoAdvance: z.boolean().optional(),
});

const upsertConfigSchema = z.object({
  nome: z.string().min(2).max(120),
  tipoProcesso: z.string().min(2).max(50),
  colunas: z.array(colunaSchema).min(2),
  regrasTransicao: z.record(z.any()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const SKILL_KEYS = [
  "verificar_dados_empresa",
  "solicitar_documentos_cliente",
  "validar_documentos_recebidos",
  "gerar_minuta",
  "lembrar_documentos_pendentes",
  "atualizar_pipeline",
] as const;

const acaoAutomaticaSchema = z
  .object({
    skill: z.enum(SKILL_KEYS),
    params: z.record(z.any()).optional(),
  })
  .nullable()
  .optional();

const upsertItemSchema = z.object({
  etapa: z.string().min(1).max(50),
  ordem: z.number().int().min(0),
  titulo: z.string().min(2).max(255),
  descricao: z.string().nullable().optional(),
  executorType: z.enum(["analista", "cliente", "agente", "sistema"]),
  isRequired: z.boolean().optional(),
  bloqueiaAvanco: z.boolean().optional(),
  tipo: z.enum(["checkbox", "upload", "date", "form", "approval"]).optional(),
  tarefaKey: z.string().max(80).nullable().optional(),
  dependsOnKeys: z.array(z.string()).nullable().optional(),
  condicaoJson: z.record(z.any()).nullable().optional(),
  formSchemaJson: z.array(z.record(z.any())).nullable().optional(),
  acaoAutomatica: acaoAutomaticaSchema,
});

function getUserId(req: any): string | null {
  return req?.user?.claims?.sub || req?.user?.id || null;
}

function validarColunasUnicas(colunas: Array<{ id: string }>): string | null {
  const seen = new Set<string>();
  for (const c of colunas) {
    if (seen.has(c.id)) return `Coluna duplicada: ${c.id}`;
    seen.add(c.id);
  }
  return null;
}

export function registerPipelineConfigsCrudRoutes(app: Express) {
  // POST /api/societario/pipeline/configs — cria template
  app.post(
    "/api/societario/pipeline/configs",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const userId = getUserId(req);
        const parsed = upsertConfigSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
        }
        const dup = validarColunasUnicas(parsed.data.colunas);
        if (dup) return res.status(400).json({ message: dup });

        const [row] = await db
          .insert(pipelineConfigs)
          .values({
            tenantId,
            nome: parsed.data.nome,
            tipoProcesso: parsed.data.tipoProcesso,
            colunas: parsed.data.colunas,
            regrasTransicao: parsed.data.regrasTransicao ?? {},
            isDefault: parsed.data.isDefault ?? false,
            isActive: parsed.data.isActive ?? true,
            createdBy: userId,
          })
          .returning();
        res.status(201).json(row);
      } catch (e: any) {
        console.error("[societario/pipeline] create config:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // PATCH /api/societario/pipeline/configs/:id — edita
  app.patch(
    "/api/societario/pipeline/configs/:id",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const id = req.params.id;
        const parsed = upsertConfigSchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
        }
        const [existing] = await db
          .select()
          .from(pipelineConfigs)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Pipeline não encontrado" });

        const updates: any = {};
        if (parsed.data.nome !== undefined) updates.nome = parsed.data.nome;
        if (parsed.data.tipoProcesso !== undefined) updates.tipoProcesso = parsed.data.tipoProcesso;
        if (parsed.data.colunas !== undefined) {
          const dup = validarColunasUnicas(parsed.data.colunas);
          if (dup) return res.status(400).json({ message: dup });
          updates.colunas = parsed.data.colunas;
        }
        if (parsed.data.regrasTransicao !== undefined) updates.regrasTransicao = parsed.data.regrasTransicao;
        if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault;
        if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

        const [row] = await db
          .update(pipelineConfigs)
          .set(updates)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .returning();
        res.json(row);
      } catch (e: any) {
        console.error("[societario/pipeline] patch config:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // DELETE /api/societario/pipeline/configs/:id — soft delete (isActive=false)
  // Bloqueia delete se há processos vinculados.
  app.delete(
    "/api/societario/pipeline/configs/:id",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const id = req.params.id;
        const [existing] = await db
          .select()
          .from(pipelineConfigs)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Pipeline não encontrado" });

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(processosSocietarios)
          .where(and(eq(processosSocietarios.tenantId, tenantId), eq(processosSocietarios.pipelineConfigId, id)));
        if (Number(count) > 0) {
          // Soft-delete: desativa para não aparecer no Kanban, mas mantém integridade dos processos.
          await db
            .update(pipelineConfigs)
            .set({ isActive: false })
            .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)));
          return res.json({ ok: true, mode: "soft", reason: `${count} processo(s) vinculado(s)` });
        }
        await db.delete(pipelineChecklistItems).where(eq(pipelineChecklistItems.pipelineConfigId, id));
        await db.delete(pipelineConfigs).where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)));
        res.json({ ok: true, mode: "hard" });
      } catch (e: any) {
        console.error("[societario/pipeline] delete config:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // GET /api/societario/pipeline/configs/:id/items — lista items do template
  app.get(
    "/api/societario/pipeline/configs/:id/items",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const id = req.params.id;
        const [cfg] = await db
          .select({ id: pipelineConfigs.id })
          .from(pipelineConfigs)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .limit(1);
        if (!cfg) return res.status(404).json({ message: "Pipeline não encontrado" });

        const items = await db
          .select()
          .from(pipelineChecklistItems)
          .where(eq(pipelineChecklistItems.pipelineConfigId, id))
          .orderBy(asc(pipelineChecklistItems.etapa), asc(pipelineChecklistItems.ordem));
        res.json(items);
      } catch (e: any) {
        console.error("[societario/pipeline] list items:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // POST /api/societario/pipeline/configs/:id/items — adiciona item
  app.post(
    "/api/societario/pipeline/configs/:id/items",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const id = req.params.id;
        const parsed = upsertItemSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
        }
        const [cfg] = await db
          .select()
          .from(pipelineConfigs)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .limit(1);
        if (!cfg) return res.status(404).json({ message: "Pipeline não encontrado" });

        const colunasIds = new Set((cfg.colunas ?? []).map((c) => c.id));
        if (!colunasIds.has(parsed.data.etapa)) {
          return res.status(400).json({ message: `Etapa '${parsed.data.etapa}' não existe nas colunas do pipeline.` });
        }
        const [row] = await db
          .insert(pipelineChecklistItems)
          .values({
            tenantId,
            pipelineConfigId: id,
            etapa: parsed.data.etapa,
            ordem: parsed.data.ordem,
            titulo: parsed.data.titulo,
            descricao: parsed.data.descricao ?? null,
            executorType: parsed.data.executorType,
            isRequired: parsed.data.isRequired ?? true,
            bloqueiaAvanco: parsed.data.bloqueiaAvanco ?? true,
            tipo: parsed.data.tipo ?? "checkbox",
            tarefaKey: parsed.data.tarefaKey ?? null,
            dependsOnKeys: parsed.data.dependsOnKeys ?? null,
            condicaoJson: parsed.data.condicaoJson ?? null,
            formSchemaJson: parsed.data.formSchemaJson ?? null,
            acaoAutomatica: parsed.data.acaoAutomatica ?? null,
          })
          .returning();
        res.status(201).json(row);
      } catch (e: any) {
        console.error("[societario/pipeline] create item:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // PATCH /api/societario/pipeline/configs/:id/items/:iid — edita
  app.patch(
    "/api/societario/pipeline/configs/:id/items/:iid",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const { id, iid } = req.params;
        const parsed = upsertItemSchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
        }
        const [cfg] = await db
          .select()
          .from(pipelineConfigs)
          .where(and(eq(pipelineConfigs.tenantId, tenantId), eq(pipelineConfigs.id, id)))
          .limit(1);
        if (!cfg) return res.status(404).json({ message: "Pipeline não encontrado" });
        if (parsed.data.etapa !== undefined) {
          const colunasIds = new Set((cfg.colunas ?? []).map((c) => c.id));
          if (!colunasIds.has(parsed.data.etapa)) {
            return res.status(400).json({ message: `Etapa '${parsed.data.etapa}' não existe nas colunas do pipeline.` });
          }
        }
        const updates: any = { ...parsed.data };
        const [row] = await db
          .update(pipelineChecklistItems)
          .set(updates)
          .where(and(
            eq(pipelineChecklistItems.tenantId, tenantId),
            eq(pipelineChecklistItems.pipelineConfigId, id),
            eq(pipelineChecklistItems.id, iid),
          ))
          .returning();
        if (!row) return res.status(404).json({ message: "Item não encontrado" });
        res.json(row);
      } catch (e: any) {
        console.error("[societario/pipeline] patch item:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // DELETE /api/societario/pipeline/configs/:id/items/:iid
  app.delete(
    "/api/societario/pipeline/configs/:id/items/:iid",
    isAuthenticated,
    requireTenant,
    requireTenantAdmin,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const { id, iid } = req.params;

        // Bloqueia delete se existem tarefas materializadas vinculadas a este item.
        // Caso contrário, cair em ON DELETE causaria perda do histórico, e sem
        // FK iria deixar processoTarefas.checklistItemId apontando para vazio.
        const linked = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(processoTarefas)
          .where(and(
            eq(processoTarefas.tenantId, tenantId),
            eq(processoTarefas.checklistItemId, iid),
          ));
        const linkedCount = Number(linked[0]?.count ?? 0);
        if (linkedCount > 0) {
          return res.status(409).json({
            message: `Não é possível excluir: ${linkedCount} tarefa(s) de processo(s) ainda referenciam este item.`,
            tarefasVinculadas: linkedCount,
          });
        }

        const result = await db
          .delete(pipelineChecklistItems)
          .where(and(
            eq(pipelineChecklistItems.tenantId, tenantId),
            eq(pipelineChecklistItems.pipelineConfigId, id),
            eq(pipelineChecklistItems.id, iid),
          ))
          .returning({ id: pipelineChecklistItems.id });
        if (result.length === 0) return res.status(404).json({ message: "Item não encontrado" });
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[societario/pipeline] delete item:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );
}

// Schemas + tipos exportados para reuso (frontend/testes).
export { upsertConfigSchema, upsertItemSchema };
export type ConfigPayload = z.infer<typeof upsertConfigSchema>;
export type ItemPayload = z.infer<typeof upsertItemSchema>;
