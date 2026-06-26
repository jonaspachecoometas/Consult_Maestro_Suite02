// Dev Center — Fase 2: rotas REST do Module Planner.
// Padrão de proteção:
//   - Leitura  (GET): isAuthenticated + tenantContext + requireTenant
//   - Escrita (POST/DELETE): + requireTenantAdmin (acionar LLM/pipeline é
//     ação privilegiada — evita que qualquer usuário do tenant gere custo
//     ou dispare deploy).
//
// Concorrência:
//   - approve usa SELECT ... FOR UPDATE dentro de uma transação para garantir
//     idempotência (uma única run criada mesmo com cliques duplos).
//   - analyze/save/revert usam compare-and-set em current_version (UPDATE
//     ... WHERE current_version = :expectedVersion). Conflito → 409.
//   - module_plan_versions tem uniqueIndex (plan_id, version_number) como
//     rede de segurança no banco.

import type { Express } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import {
  modulePlans,
  modulePlanVersions,
  idePipelineRuns,
  users,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant, requireTenantAdminOrPartner } from "../tenantContext";
import {
  analyzeModule,
  modulePlanContractSchema,
  planToRequirement,
  type ModulePlanContract,
} from "./planner";
import { createRun, startPipelineAsync } from "../ide/orchestrator";

// Module Planner é uma feature privilegiada (dispara LLM e pipeline de deploy):
// TODOS os endpoints exigem role admin: superadmin, partner ou tenant_admin
// (mesma regra do guard frontend em /planejador e do filtro adminOnly do menu).
const authRead = [isAuthenticated, tenantContext, requireTenant, requireTenantAdminOrPartner];
const authWrite = [isAuthenticated, tenantContext, requireTenant, requireTenantAdminOrPartner];

const analyzeBodySchema = z.object({
  // planId opcional: re-analisar sobre um plano existente (cria nova versão).
  planId: z.string().uuid().optional(),
  title: z.string().min(3).max(300),
  description: z.string().min(10).max(8000),
  // Quando re-analisando, o cliente envia a versão que está vendo na tela
  // para detectar conflito de edição concorrente.
  expectedVersion: z.number().int().positive().optional(),
});

const saveBodySchema = z.object({
  title: z.string().min(3).max(300).optional(),
  description: z.string().min(10).max(8000).optional(),
  plan: modulePlanContractSchema,
  expectedVersion: z.number().int().positive().optional(),
});

const revertBodySchema = z.object({
  versionId: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
});

function userIdOf(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function appendVersion(
  planId: string,
  tenantId: string,
  versionNumber: number,
  source: "analyze" | "edit" | "approve" | "revert",
  plan: ModulePlanContract,
  userId: string | null,
) {
  await db.insert(modulePlanVersions).values({
    planId,
    tenantId,
    versionNumber,
    source,
    planJson: plan as any,
    createdById: userId,
  });
}

export function registerModulePlannerRoutes(app: Express) {
  // POST /api/module-planner/analyze
  // Cria um novo plano (ou re-analisa sobre planId existente) chamando o agente.
  app.post("/api/module-planner/analyze", ...authWrite, async (req: any, res) => {
    try {
      const data = analyzeBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      // Roda LLM ANTES de tocar o banco — falha de LLM não vira lixo.
      const result = await analyzeModule({
        description: data.description,
        title: data.title,
        tenantId,
        userId,
      });

      if (data.planId) {
        // Re-análise: incrementa versão sobre plano existente (mesmo tenant).
        const [existing] = await db
          .select()
          .from(modulePlans)
          .where(and(eq(modulePlans.id, data.planId), eq(modulePlans.tenantId, tenantId)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Plano não encontrado" });
        if (existing.status === "generated") {
          return res.status(409).json({ message: "Plano já foi gerado e não pode ser re-analisado." });
        }
        if (data.expectedVersion && data.expectedVersion !== existing.currentVersion) {
          return res.status(409).json({
            message: "Plano foi modificado por outra sessão. Recarregue antes de re-analisar.",
            currentVersion: existing.currentVersion,
          });
        }

        const expectedVersion = existing.currentVersion ?? 1;
        const nextVersion = expectedVersion + 1;
        // Compare-and-set: só atualiza se ninguém mais incrementou nesse meio tempo.
        const updated = await db
          .update(modulePlans)
          .set({
            title: data.title,
            descriptionInput: data.description,
            planJson: result.plan as any,
            currentVersion: nextVersion,
            updatedById: userId,
            updatedAt: new Date(),
            status: existing.status === "approved" ? "approved" : "proposed",
          })
          .where(and(
            eq(modulePlans.id, data.planId),
            eq(modulePlans.tenantId, tenantId),
            eq(modulePlans.currentVersion, expectedVersion),
          ))
          .returning();
        if (updated.length === 0) {
          return res.status(409).json({
            message: "Conflito de versão. Recarregue o plano e tente novamente.",
          });
        }

        await appendVersion(data.planId, tenantId, nextVersion, "analyze", result.plan, userId);
        return res.json({
          plan: updated[0],
          source: result.source,
          model: result.model,
        });
      }

      // Novo plano
      const [created] = await db
        .insert(modulePlans)
        .values({
          tenantId,
          title: data.title,
          descriptionInput: data.description,
          planJson: result.plan as any,
          status: "proposed",
          currentVersion: 1,
          createdById: userId,
          updatedById: userId,
        })
        .returning();

      await appendVersion(created.id, tenantId, 1, "analyze", result.plan, userId);
      res.status(201).json({
        plan: created,
        source: result.source,
        model: result.model,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[module-planner] analyze failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao analisar módulo" });
    }
  });

  // POST /api/module-planner/:id/save — salva edições manuais (gera versão 'edit')
  app.post("/api/module-planner/:id/save", ...authWrite, async (req: any, res) => {
    try {
      const data = saveBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      const [existing] = await db
        .select()
        .from(modulePlans)
        .where(and(eq(modulePlans.id, req.params.id), eq(modulePlans.tenantId, tenantId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Plano não encontrado" });
      if (existing.status === "generated") {
        return res.status(409).json({ message: "Plano já foi gerado e não pode ser editado." });
      }
      if (data.expectedVersion && data.expectedVersion !== existing.currentVersion) {
        return res.status(409).json({
          message: "Plano foi modificado por outra sessão. Recarregue antes de salvar.",
          currentVersion: existing.currentVersion,
        });
      }

      const expectedVersion = existing.currentVersion ?? 1;
      const nextVersion = expectedVersion + 1;
      const updated = await db
        .update(modulePlans)
        .set({
          title: data.title ?? existing.title,
          descriptionInput: data.description ?? existing.descriptionInput,
          planJson: data.plan as any,
          currentVersion: nextVersion,
          updatedById: userId,
          updatedAt: new Date(),
          // Quem edita após análise volta a status proposed (a menos que já aprovado).
          status: existing.status === "approved" ? "approved" : "proposed",
        })
        .where(and(
          eq(modulePlans.id, req.params.id),
          eq(modulePlans.tenantId, tenantId),
          eq(modulePlans.currentVersion, expectedVersion),
        ))
        .returning();
      if (updated.length === 0) {
        return res.status(409).json({
          message: "Conflito de versão. Recarregue o plano e tente novamente.",
        });
      }

      await appendVersion(req.params.id, tenantId, nextVersion, "edit", data.plan, userId);
      res.json(updated[0]);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[module-planner] save failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao salvar plano" });
    }
  });

  // POST /api/module-planner/:id/approve — aprova e dispara pipeline run no Dev Center.
  // IDEMPOTENTE: usa transação com SELECT FOR UPDATE para garantir que cliques duplos
  // ou retries não criem duas runs. Se já foi gerado, retorna o pipelineRunId existente.
  app.post("/api/module-planner/:id/approve", ...authWrite, async (req: any, res) => {
    const tenantId: string = req.tenantId;
    const userId = userIdOf(req);
    const planId = req.params.id;

    try {
      // Step 1 — atomic claim. Dentro da transação, lock row, valida e marca como
      // 'generated' antes de criar a run. Se já está gerado, retorna o runId.
      const claim = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(modulePlans)
          .where(and(eq(modulePlans.id, planId), eq(modulePlans.tenantId, tenantId)))
          .for("update")
          .limit(1);
        if (!existing) return { kind: "not_found" as const };

        if (existing.status === "generated") {
          if (existing.pipelineRunId) {
            // Idempotência: retorna a run existente em vez de criar nova.
            return { kind: "already" as const, runId: existing.pipelineRunId, plan: existing };
          }
          // status='generated' mas pipelineRunId ainda NULL ⇒ outra requisição
          // já reservou o slot e está criando a run. Recuperação de estado órfão:
          // se a reserva tem mais de 5 minutos, assumimos que o request anterior
          // crashou (o createRun + update levam segundos), então re-permitimos
          // o claim. Se for recente, devolvemos 'in_progress' para evitar duas runs.
          const updatedAt = existing.updatedAt instanceof Date
            ? existing.updatedAt.getTime()
            : 0;
          const ageMs = Date.now() - updatedAt;
          const ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;
          if (ageMs < ORPHAN_TIMEOUT_MS) {
            return { kind: "in_progress" as const };
          }
          // Estado órfão: trata como retomada — o claim novo abaixo bumpará
          // currentVersion e tentará createRun de novo. Logamos para auditoria.
          console.warn(
            `[module-planner] approve: estado órfão recuperado (plan=${planId}, idade=${Math.round(ageMs / 1000)}s)`,
          );
        }

        const planParsed = modulePlanContractSchema.safeParse(existing.planJson);
        if (!planParsed.success) {
          return { kind: "bad_contract" as const };
        }

        // Reserva o slot — marca como 'generated' SEM o runId ainda. Próximas
        // chamadas concorrentes verão status='generated' (mas pipelineRunId NULL),
        // o que sinaliza que a run está sendo criada por outro processo.
        // Importante: updatedAt é renovado no claim para ancorar o ORPHAN_TIMEOUT.
        const expectedVersion = existing.currentVersion ?? 1;
        const nextVersion = expectedVersion + 1;
        const claimed = await tx
          .update(modulePlans)
          .set({
            status: "generated",
            currentVersion: nextVersion,
            pipelineRunId: null,
            updatedById: userId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(modulePlans.id, planId),
            eq(modulePlans.tenantId, tenantId),
            eq(modulePlans.currentVersion, expectedVersion),
          ))
          .returning();
        if (claimed.length === 0) {
          // Outra transação ganhou o lock e mudou a versão — devolve conflito.
          return { kind: "conflict" as const };
        }
        return {
          kind: "claimed" as const,
          plan: claimed[0],
          planContract: planParsed.data,
          nextVersion,
          // Status anterior do plano (proposed | approved | error). Usado para
          // restaurar fielmente caso createRun falhe — evita "promover" um
          // plano 'proposed' a 'approved' por efeito colateral do rollback.
          previousStatus: existing.status as "proposed" | "approved" | "error",
        };
      });

      if (claim.kind === "not_found") {
        return res.status(404).json({ message: "Plano não encontrado" });
      }
      if (claim.kind === "bad_contract") {
        return res.status(400).json({
          message: "Plano armazenado fora do contrato — re-analise antes de aprovar.",
        });
      }
      if (claim.kind === "conflict") {
        return res.status(409).json({
          message: "Plano em modificação concorrente. Recarregue e tente novamente.",
        });
      }
      if (claim.kind === "already") {
        return res.json({ plan: claim.plan, runId: claim.runId, idempotent: true });
      }
      if (claim.kind === "in_progress") {
        // 409 — outra requisição está terminando de gerar a run. Cliente deve
        // recarregar (GET /:id) para descobrir o pipelineRunId quando ele aparecer.
        return res.status(409).json({
          message: "Aprovação em andamento por outra requisição. Aguarde alguns segundos e recarregue.",
          retry: true,
        });
      }

      // Step 2 — fora da transação (createRun pode ser pesado): cria run no Dev Center.
      let runId: string;
      try {
        const requirement = planToRequirement(claim.plan.title, claim.planContract);
        runId = await createRun({
          tenantId,
          userId,
          projectId: null,
          title: `[Planejador] ${claim.plan.title}`,
          requirement,
          target: "consult",
        });
      } catch (createErr: any) {
        // Rollback completo do claim — restaura status ANTERIOR e desfaz o bump
        // de currentVersion, evitando gaps na sequência de versões. Como nenhuma
        // version row foi escrita ainda (appendVersion só roda no sucesso),
        // voltar para expectedVersion preserva a integridade do histórico.
        await db
          .update(modulePlans)
          .set({
            status: claim.previousStatus,
            currentVersion: claim.nextVersion - 1,
            updatedAt: new Date(),
          })
          .where(and(
            eq(modulePlans.id, planId),
            eq(modulePlans.tenantId, tenantId),
            // Defensivo: só faz rollback se ainda estamos no slot que reservamos
            // (ninguém mais bumpou current_version no meio).
            eq(modulePlans.currentVersion, claim.nextVersion),
          ));
        throw createErr;
      }

      // Step 3 — vincula a run ao plano + grava versão de aprovação.
      const [final] = await db
        .update(modulePlans)
        .set({
          pipelineRunId: runId,
          updatedAt: new Date(),
        })
        .where(and(eq(modulePlans.id, planId), eq(modulePlans.tenantId, tenantId)))
        .returning();

      await appendVersion(planId, tenantId, claim.nextVersion, "approve", claim.planContract, userId);

      // Dispara pipeline em background (mesmo padrão da rota POST /api/ide/runs)
      startPipelineAsync(runId, tenantId);

      res.json({ plan: final, runId });
    } catch (err: any) {
      console.error("[module-planner] approve failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao aprovar plano" });
    }
  });

  // POST /api/module-planner/:id/revert — restaura uma versão anterior
  app.post("/api/module-planner/:id/revert", ...authWrite, async (req: any, res) => {
    try {
      const data = revertBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      const [existing] = await db
        .select()
        .from(modulePlans)
        .where(and(eq(modulePlans.id, req.params.id), eq(modulePlans.tenantId, tenantId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Plano não encontrado" });
      if (existing.status === "generated") {
        return res.status(409).json({ message: "Plano já foi gerado e não pode ser revertido." });
      }
      if (data.expectedVersion && data.expectedVersion !== existing.currentVersion) {
        return res.status(409).json({
          message: "Plano foi modificado por outra sessão. Recarregue antes de reverter.",
          currentVersion: existing.currentVersion,
        });
      }

      const [version] = await db
        .select()
        .from(modulePlanVersions)
        .where(and(
          eq(modulePlanVersions.id, data.versionId),
          eq(modulePlanVersions.planId, req.params.id),
          eq(modulePlanVersions.tenantId, tenantId),
        ))
        .limit(1);
      if (!version) return res.status(404).json({ message: "Versão não encontrada" });

      // Validação defensiva — uma versão antiga pode ter sido escrita antes de
      // mudanças de contrato. Se não bater, falha explicitamente.
      const planParsed = modulePlanContractSchema.safeParse(version.planJson);
      if (!planParsed.success) {
        return res.status(400).json({
          message: "Versão selecionada está em formato incompatível com o contrato atual.",
        });
      }

      const expectedVersion = existing.currentVersion ?? 1;
      const nextVersion = expectedVersion + 1;
      const updated = await db
        .update(modulePlans)
        .set({
          planJson: planParsed.data as any,
          currentVersion: nextVersion,
          updatedById: userId,
          updatedAt: new Date(),
          status: existing.status === "approved" ? "approved" : "proposed",
        })
        .where(and(
          eq(modulePlans.id, req.params.id),
          eq(modulePlans.tenantId, tenantId),
          eq(modulePlans.currentVersion, expectedVersion),
        ))
        .returning();
      if (updated.length === 0) {
        return res.status(409).json({
          message: "Conflito de versão. Recarregue o plano e tente novamente.",
        });
      }

      await appendVersion(req.params.id, tenantId, nextVersion, "revert", planParsed.data, userId);
      res.json(updated[0]);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[module-planner] revert failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao reverter plano" });
    }
  });

  // GET /api/module-planner — lista planos do tenant (leitura: requireTenant basta)
  app.get("/api/module-planner", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const rows = await db
        .select({
          id: modulePlans.id,
          title: modulePlans.title,
          status: modulePlans.status,
          currentVersion: modulePlans.currentVersion,
          pipelineRunId: modulePlans.pipelineRunId,
          createdAt: modulePlans.createdAt,
          updatedAt: modulePlans.updatedAt,
        })
        .from(modulePlans)
        .where(eq(modulePlans.tenantId, tenantId))
        .orderBy(desc(modulePlans.updatedAt))
        .limit(200);
      res.json(rows);
    } catch (err: any) {
      console.error("[module-planner] list failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao listar planos" });
    }
  });

  // GET /api/module-planner/:id — detalhe + versões + run vinculada (se houver)
  app.get("/api/module-planner/:id", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const [plan] = await db
        .select()
        .from(modulePlans)
        .where(and(eq(modulePlans.id, req.params.id), eq(modulePlans.tenantId, tenantId)))
        .limit(1);
      if (!plan) return res.status(404).json({ message: "Plano não encontrado" });

      // LEFT JOIN em users para devolver o nome/email do autor de cada versão
      // (history UI mostra "v2 — Edição manual por Thiago").
      const versionRows = await db
        .select({
          id: modulePlanVersions.id,
          versionNumber: modulePlanVersions.versionNumber,
          source: modulePlanVersions.source,
          createdById: modulePlanVersions.createdById,
          createdAt: modulePlanVersions.createdAt,
          planJson: modulePlanVersions.planJson,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
          authorEmail: users.email,
        })
        .from(modulePlanVersions)
        .leftJoin(users, eq(users.id, modulePlanVersions.createdById))
        .where(and(
          eq(modulePlanVersions.planId, req.params.id),
          eq(modulePlanVersions.tenantId, tenantId),
        ))
        .orderBy(desc(modulePlanVersions.versionNumber))
        .limit(100);
      const versions = versionRows.map((v) => {
        const fullName = [v.authorFirstName, v.authorLastName].filter(Boolean).join(" ").trim();
        return {
          id: v.id,
          versionNumber: v.versionNumber,
          source: v.source,
          createdById: v.createdById,
          createdAt: v.createdAt,
          planJson: v.planJson,
          authorName: fullName || v.authorEmail || null,
        };
      });

      let run: { id: string; status: string; title: string } | null = null;
      if (plan.pipelineRunId) {
        const [r] = await db
          .select({ id: idePipelineRuns.id, status: idePipelineRuns.status, title: idePipelineRuns.title })
          .from(idePipelineRuns)
          .where(and(
            eq(idePipelineRuns.id, plan.pipelineRunId),
            eq(idePipelineRuns.tenantId, tenantId),
          ))
          .limit(1);
        if (r) run = r;
      }

      res.json({ plan, versions, run });
    } catch (err: any) {
      console.error("[module-planner] detail failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao carregar plano" });
    }
  });

  // DELETE /api/module-planner/:id — apenas planos não-gerados
  app.delete("/api/module-planner/:id", ...authWrite, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const [existing] = await db
        .select()
        .from(modulePlans)
        .where(and(eq(modulePlans.id, req.params.id), eq(modulePlans.tenantId, tenantId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Plano não encontrado" });
      if (existing.status === "generated") {
        return res.status(409).json({ message: "Plano gerado não pode ser apagado (preserva auditoria)." });
      }
      await db
        .delete(modulePlans)
        .where(and(eq(modulePlans.id, req.params.id), eq(modulePlans.tenantId, tenantId)));
      res.status(204).end();
    } catch (err: any) {
      console.error("[module-planner] delete failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao remover plano" });
    }
  });
}
