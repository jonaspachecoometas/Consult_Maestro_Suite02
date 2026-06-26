// Fase 4 — App Store interna: rotas REST.
//
// Padrão de proteção:
// - Leitura listagem published: isAuthenticated + tenantContext + requireTenant
//   (qualquer usuário autenticado pode navegar a App Store; tenantId vem do
//    contexto para marcar `installed: bool` no card).
// - Publicação/submissão: requireTenantAdminOrPartner (só admins do tenant
//   podem publicar — ação privilegiada que toca código gerado).
// - Revisão (approve/reject): requireSuperadmin (gate humano da Arcádia).
// - Install/uninstall/update: requireTenantAdminOrPartner (instalar muta
//   schema do tenant, é privilegiado).

import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db";
import {
  marketplaceApps,
  marketplaceAppVersions,
  marketplaceInstallations,
  marketplaceReviews,
  marketplaceCharges,
  users,
  tenants,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import {
  tenantContext,
  requireTenant,
  requireSuperadmin,
  requireTenantAdmin,
  requireTenantAdminOrPartner,
} from "../tenantContext";
import {
  packageFromRun,
  packageFromPlan,
  computeSchemaDiff,
  type MarketplaceManifest,
  type MarketplaceManifestMenuItem,
} from "./packager";
import { installApp, updateInstallation, uninstallApp } from "./installer";

const authRead    = [isAuthenticated, tenantContext, requireTenant];
// Publicação/submissão: parceiros e admins (gerenciam tenants em nome do
// cliente). Mais amplo que install porque é uma ação sobre o próprio código
// do owner — não muta schema de outro tenant.
const authPublish = [isAuthenticated, tenantContext, requireTenant, requireTenantAdminOrPartner];
// Install/update/uninstall: APENAS tenant admin do tenant alvo. Operação
// muta schema do tenant — superadmin pode (via guard interna), partner não.
const authInstall = [isAuthenticated, tenantContext, requireTenant, requireTenantAdmin];
const authReview  = [isAuthenticated, tenantContext, requireSuperadmin];

function userIdOf(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

const SLUG_RE = /^[a-z][a-z0-9-]{2,79}$/;

const createAppBodySchema = z.object({
  slug: z.string().regex(SLUG_RE, "slug deve ser kebab-case (ex: honorarios-consultor)"),
  title: z.string().min(3).max(200),
  shortDescription: z.string().min(10).max(280),
  longDescription: z.string().max(5000).optional(),
  category: z.string().max(50).optional(),
  billingModel: z.enum(["free", "per_install", "monthly"]).default("free"),
  priceCents: z.number().int().min(0).max(10_000_000).default(0),
  sourceRunId: z.string().uuid().optional(),
  sourcePlanId: z.string().uuid().optional(),
  iconUrl: z.string().url().max(500).optional(),
  screenshots: z.array(z.string().url().max(500)).max(10).optional(),
  initialVersion: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/).default("1.0.0"),
  changelog: z.string().max(5000).optional(),
}).refine((d) => !!d.sourceRunId || !!d.sourcePlanId, {
  message: "Informe sourceRunId ou sourcePlanId",
});

const publishVersionBodySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/),
  sourceRunId: z.string().uuid().optional(),
  sourcePlanId: z.string().uuid().optional(),
  changelog: z.string().max(5000).optional(),
}).refine((d) => !!d.sourceRunId || !!d.sourcePlanId, {
  message: "Informe sourceRunId ou sourcePlanId",
});

const reviewBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().max(2000).optional(),
});

const installBodySchema = z.object({
  versionId: z.string().uuid().optional(),
});

const updateBodySchema = z.object({
  versionId: z.string().uuid(),
});

const reviewerBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export function registerMarketplaceRoutes(app: Express) {
  // ────────────────────────────────────────────────────────────────────────
  // PUBLIC LISTING (apps published)
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/apps", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const search = String(req.query.search || "").trim().toLowerCase();
      const category = String(req.query.category || "").trim();

      // Inclui nome do tenant owner via JOIN — necessário para o card.
      const rows = await db
        .select({ app: marketplaceApps, owner: tenants })
        .from(marketplaceApps)
        .leftJoin(tenants, eq(marketplaceApps.ownerTenantId, tenants.id))
        .where(eq(marketplaceApps.status, "published"))
        .orderBy(desc(marketplaceApps.installCount));

      // Marca quais o tenant atual já instalou.
      const installs = await db
        .select()
        .from(marketplaceInstallations)
        .where(eq(marketplaceInstallations.tenantId, tenantId));
      const installedByApp = new Map(installs.map((i) => [i.appId, i]));

      const filtered = rows.filter((r) => {
        if (category && r.app.category !== category) return false;
        if (search) {
          const hay = `${r.app.title} ${r.app.shortDescription}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

      res.json(filtered.map((r) => ({
        ...r.app,
        ownerName: r.owner?.name ?? null,
        installation: installedByApp.get(r.app.id) ?? null,
        isOwner: r.app.ownerTenantId === tenantId,
      })));
    } catch (err: any) {
      console.error("[marketplace] list apps failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao listar apps" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // OWNER LISTING (own apps — including drafts/in_review/rejected)
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/my-apps", ...authPublish, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const rows = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.ownerTenantId, tenantId))
        .orderBy(desc(marketplaceApps.updatedAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[marketplace] my-apps failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INSTALLED LIST (apps installed by the current tenant)
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/installations", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const rows = await db
        .select({
          install: marketplaceInstallations,
          app: marketplaceApps,
          version: marketplaceAppVersions,
        })
        .from(marketplaceInstallations)
        .leftJoin(marketplaceApps, eq(marketplaceInstallations.appId, marketplaceApps.id))
        .leftJoin(marketplaceAppVersions, eq(marketplaceInstallations.installedVersionId, marketplaceAppVersions.id))
        .where(eq(marketplaceInstallations.tenantId, tenantId))
        .orderBy(desc(marketplaceInstallations.installedAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[marketplace] installations failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // APP DETAIL (by slug — published apps visible to all; drafts only to owner/superadmin)
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/apps/:slug", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const isSuperadmin = req.systemRole === "superadmin";
      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.slug, req.params.slug))
        .limit(1);
      if (!appRow) return res.status(404).json({ message: "App não encontrado" });

      const isOwner = appRow.ownerTenantId === tenantId;
      const isPublished = appRow.status === "published";
      if (!isPublished && !isOwner && !isSuperadmin) {
        return res.status(404).json({ message: "App não encontrado" });
      }

      // Para owner/superadmin: todas versões com payload completo (precisam
      // ver schemaDiff/files para gerenciar). Para consumidores: só versões
      // já publicadas (publishedAt setado) e sem `filesSnapshot/filesRef/
      // schemaDiff` (são código proprietário do owner).
      const allVersions = await db
        .select()
        .from(marketplaceAppVersions)
        .where(eq(marketplaceAppVersions.appId, appRow.id))
        .orderBy(desc(marketplaceAppVersions.createdAt));
      const canSeeAll = isOwner || isSuperadmin;
      const versions = canSeeAll
        ? allVersions
        : allVersions
            .filter((v) => !!v.publishedAt)
            .map((v) => ({
              ...v,
              filesSnapshot: undefined,
              filesRef: undefined,
              schemaDiff: undefined,
            }));

      const reviews = await db
        .select({
          review: marketplaceReviews,
          tenant: tenants,
        })
        .from(marketplaceReviews)
        .leftJoin(tenants, eq(marketplaceReviews.tenantId, tenants.id))
        .where(eq(marketplaceReviews.appId, appRow.id))
        .orderBy(desc(marketplaceReviews.createdAt))
        .limit(50);

      const [installation] = await db
        .select()
        .from(marketplaceInstallations)
        .where(and(
          eq(marketplaceInstallations.appId, appRow.id),
          eq(marketplaceInstallations.tenantId, tenantId),
        ))
        .limit(1);

      res.json({
        app: appRow,
        versions,
        reviews,
        installation: installation ?? null,
        isOwner,
      });
    } catch (err: any) {
      console.error("[marketplace] app detail failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CREATE DRAFT APP (owner)
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps", ...authPublish, async (req: any, res) => {
    try {
      const data = createAppBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      // Empacota a versão inicial.
      const pack = data.sourceRunId
        ? await packageFromRun(tenantId, data.sourceRunId, data.initialVersion)
        : await packageFromPlan(tenantId, data.sourcePlanId!, data.initialVersion);

      // Cria app draft + 1ª versão em transação.
      const result = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(marketplaceApps)
          .values({
            tenantId: tenantId,
            ownerTenantId: tenantId,
            slug: data.slug,
            title: data.title,
            shortDescription: data.shortDescription,
            longDescription: data.longDescription,
            category: data.category || "geral",
            billingModel: data.billingModel,
            priceCents: data.priceCents,
            sourceRunId: data.sourceRunId,
            sourcePlanId: data.sourcePlanId,
            iconUrl: data.iconUrl,
            screenshots: (data.screenshots ?? []) satisfies string[],
            createdById: userId,
            status: "draft",
          })
          .returning();

        const [version] = await tx
          .insert(marketplaceAppVersions)
          .values({
            appId: created.id,
            tenantId: tenantId,
            ownerTenantId: tenantId,
            version: data.initialVersion,
            manifestJson: pack.manifest satisfies MarketplaceManifest,
            filesRef: pack.filesRef,
            filesSnapshot: pack.filesSnapshot satisfies Record<string, string>,
            schemaDiff: computeSchemaDiff(null, pack.manifest),
            changelog: data.changelog,
          })
          .returning();

        return { app: created, version };
      });

      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      // Slug duplicado
      if (String(err?.message || "").includes("duplicate") || err?.code === "23505") {
        return res.status(409).json({ message: "Slug já em uso. Escolha outro." });
      }
      console.error("[marketplace] create app failed:", err);
      res.status(500).json({ message: err?.message || "Erro ao criar app" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // ADD NEW VERSION TO EXISTING APP (owner)
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps/:id/versions", ...authPublish, async (req: any, res) => {
    try {
      const data = publishVersionBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;

      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(and(eq(marketplaceApps.id, req.params.id), eq(marketplaceApps.ownerTenantId, tenantId)))
        .limit(1);
      if (!appRow) return res.status(404).json({ message: "App não encontrado" });

      // Pega versão anterior para diff
      const [prevVersion] = await db
        .select()
        .from(marketplaceAppVersions)
        .where(eq(marketplaceAppVersions.appId, appRow.id))
        .orderBy(desc(marketplaceAppVersions.createdAt))
        .limit(1);

      const pack = data.sourceRunId
        ? await packageFromRun(tenantId, data.sourceRunId, data.version)
        : await packageFromPlan(tenantId, data.sourcePlanId!, data.version);

      const diff = computeSchemaDiff(
        prevVersion ? (prevVersion.manifestJson as MarketplaceManifest) : null,
        pack.manifest,
      );

      const [version] = await db
        .insert(marketplaceAppVersions)
        .values({
          appId: appRow.id,
          tenantId: tenantId,
          ownerTenantId: tenantId,
          version: data.version,
          manifestJson: pack.manifest satisfies MarketplaceManifest,
          filesRef: pack.filesRef,
          filesSnapshot: pack.filesSnapshot satisfies Record<string, string>,
          schemaDiff: diff,
          changelog: data.changelog,
        })
        .returning();

      res.status(201).json(version);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      if (err?.code === "23505") {
        return res.status(409).json({ message: "Esta versão já existe para o app" });
      }
      console.error("[marketplace] add version failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // SUBMIT APP FOR REVIEW (owner)
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps/:id/submit", ...authPublish, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(and(eq(marketplaceApps.id, req.params.id), eq(marketplaceApps.ownerTenantId, tenantId)))
        .limit(1);
      if (!appRow) return res.status(404).json({ message: "App não encontrado" });
      if (appRow.status === "in_review") {
        return res.status(409).json({ message: "App já está em revisão" });
      }

      // Para apps já published: NÃO flipamos app.status — a versão publicada
      // anterior continua instalável durante o review da nova versão. A
      // pendência fica marcada via `submittedAt` no app + `publishedAt IS NULL`
      // + `rejectedAt IS NULL` na versão. A queue de revisão filtra por isso.
      if (appRow.status === "published") {
        // Ordem determinística (mais recente por createdAt) para evitar
        // ambiguidade quando há múltiplos rascunhos não submetidos.
        const [pending] = await db
          .select()
          .from(marketplaceAppVersions)
          .where(and(
            eq(marketplaceAppVersions.appId, appRow.id),
            drizzleSql`${marketplaceAppVersions.publishedAt} IS NULL`,
            drizzleSql`${marketplaceAppVersions.rejectedAt} IS NULL`,
          ))
          .orderBy(desc(marketplaceAppVersions.createdAt))
          .limit(1);
        if (!pending) {
          return res.status(409).json({ message: "Nenhuma versão pendente para revisar" });
        }
        // Marca submittedAt na versão (sinaliza intenção explícita do owner →
        // queue só inclui versões com submittedAt IS NOT NULL).
        const result = await db.transaction(async (tx) => {
          await tx
            .update(marketplaceAppVersions)
            .set({ submittedAt: new Date() })
            .where(eq(marketplaceAppVersions.id, pending.id));
          const [u] = await tx
            .update(marketplaceApps)
            .set({ submittedAt: new Date(), updatedAt: new Date() })
            .where(eq(marketplaceApps.id, appRow.id))
            .returning();
          return u;
        });
        return res.json(result);
      }

      // Apps em draft/rejected viram in_review. Pré-condição: precisa existir
      // ao menos uma versão pendente elegível (não publicada/rejeitada),
      // senão o app entraria em in_review mas a fila do superadmin estaria
      // vazia (dead-end operacional).
      const [eligibleVersion] = await db
        .select()
        .from(marketplaceAppVersions)
        .where(and(
          eq(marketplaceAppVersions.appId, appRow.id),
          drizzleSql`${marketplaceAppVersions.publishedAt} IS NULL`,
          drizzleSql`${marketplaceAppVersions.rejectedAt} IS NULL`,
        ))
        .orderBy(desc(marketplaceAppVersions.createdAt))
        .limit(1);
      if (!eligibleVersion) {
        return res.status(409).json({
          message: "Nenhuma versão pendente para revisar. Crie uma nova versão antes de submeter.",
        });
      }
      // Marca submittedAt também na 1ª versão (criada junto com o draft)
      // para o queue ver.
      const result = await db.transaction(async (tx) => {
        await tx
          .update(marketplaceAppVersions)
          .set({ submittedAt: new Date() })
          .where(and(
            eq(marketplaceAppVersions.appId, appRow.id),
            drizzleSql`${marketplaceAppVersions.publishedAt} IS NULL`,
            drizzleSql`${marketplaceAppVersions.rejectedAt} IS NULL`,
            drizzleSql`${marketplaceAppVersions.submittedAt} IS NULL`,
          ));
        const [u] = await tx
          .update(marketplaceApps)
          .set({ status: "in_review", submittedAt: new Date(), updatedAt: new Date() })
          .where(eq(marketplaceApps.id, appRow.id))
          .returning();
        return u;
      });
      res.json(result);
    } catch (err: any) {
      console.error("[marketplace] submit failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // SUPERADMIN REVIEW QUEUE
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/admin/queue", ...authReview, async (_req: any, res) => {
    try {
      // Inclui:
      //  (a) apps com status='in_review' (drafts/rejected submetidos)
      //  (b) apps published com versão pendente (publishedAt IS NULL)
      // Em (b), a versão anterior continua viva enquanto a nova é revisada.
      const rows = await db
        .select({ app: marketplaceApps, owner: tenants })
        .from(marketplaceApps)
        .leftJoin(tenants, eq(marketplaceApps.ownerTenantId, tenants.id))
        // Queue mostra apenas versões com submittedAt IS NOT NULL — owner
        // precisou clicar explicitamente em "Enviar versão p/ revisão".
        // Versões criadas via /versions sem submit ficam como rascunho.
        .where(drizzleSql`EXISTS (
          SELECT 1 FROM marketplace_app_versions v
          WHERE v.app_id = ${marketplaceApps.id}
            AND v.submitted_at IS NOT NULL
            AND v.published_at IS NULL
            AND v.rejected_at IS NULL
        ) AND (${marketplaceApps.status} = 'in_review' OR ${marketplaceApps.status} = 'published')`)
        .orderBy(desc(marketplaceApps.submittedAt));

      // Para cada app, anexa a versão mais recente (com manifest, schemaDiff,
      // arquivos) para permitir review-diff antes de aprovar/rejeitar.
      const enriched = await Promise.all(rows.map(async (r) => {
        // Single source of truth com o review endpoint: pega a versão
        // SUBMETIDA pendente mais recente. Rascunhos (submitted_at NULL)
        // criados depois NUNCA aparecem na fila — owner precisa submeter.
        const [latest] = await db
          .select()
          .from(marketplaceAppVersions)
          .where(and(
            eq(marketplaceAppVersions.appId, r.app.id),
            drizzleSql`${marketplaceAppVersions.submittedAt} IS NOT NULL`,
            drizzleSql`${marketplaceAppVersions.publishedAt} IS NULL`,
            drizzleSql`${marketplaceAppVersions.rejectedAt} IS NULL`,
          ))
          .orderBy(desc(marketplaceAppVersions.submittedAt))
          .limit(1);
        // "previous" = versão atualmente publicada (para diff schemaDiff).
        const [previous] = await db
          .select()
          .from(marketplaceAppVersions)
          .where(and(
            eq(marketplaceAppVersions.appId, r.app.id),
            drizzleSql`${marketplaceAppVersions.publishedAt} IS NOT NULL`,
          ))
          .orderBy(desc(marketplaceAppVersions.publishedAt))
          .limit(1);
        const filesCount = latest?.filesSnapshot
          ? Object.keys(latest.filesSnapshot as Record<string, string>).length
          : 0;
        return {
          app: r.app,
          owner: r.owner,
          latestVersion: latest ?? null,
          previousVersion: previous ?? null,
          filesCount,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      console.error("[marketplace] queue failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // SUPERADMIN APPROVE/REJECT
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps/:id/review", ...authReview, async (req: any, res) => {
    try {
      const data = reviewBodySchema.parse(req.body);
      const userId = userIdOf(req);

      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.id, req.params.id))
        .limit(1);
      if (!appRow) return res.status(404).json({ message: "App não encontrado" });

      // Pega a versão SUBMETIDA pendente mais recente. Mesma source-of-truth
      // do queue enrichment — garante que o superadmin sempre revisa o
      // artefato exato que o owner submeteu, nunca um rascunho posterior.
      const [pending] = await db
        .select()
        .from(marketplaceAppVersions)
        .where(and(
          eq(marketplaceAppVersions.appId, appRow.id),
          drizzleSql`${marketplaceAppVersions.submittedAt} IS NOT NULL`,
          drizzleSql`${marketplaceAppVersions.publishedAt} IS NULL`,
          drizzleSql`${marketplaceAppVersions.rejectedAt} IS NULL`,
        ))
        .orderBy(desc(marketplaceAppVersions.submittedAt))
        .limit(1);

      const isFirstReview = appRow.status === "in_review";
      const isPublishedWithPending = appRow.status === "published" && !!pending;
      if (!isFirstReview && !isPublishedWithPending) {
        return res.status(409).json({ message: "App não está em revisão" });
      }

      if (data.decision === "approve") {
        if (!pending) {
          return res.status(409).json({ message: "App sem versão pendente para publicar" });
        }
        await db.transaction(async (tx) => {
          await tx
            .update(marketplaceAppVersions)
            .set({ publishedAt: new Date() })
            .where(eq(marketplaceAppVersions.id, pending.id));
          await tx
            .update(marketplaceApps)
            .set({
              // Para apps já published, mantém status; para novos, promove.
              status: "published",
              currentVersionId: pending.id,
              reviewNotes: data.notes,
              reviewedById: userId,
              reviewedAt: new Date(),
              publishedAt: appRow.publishedAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(marketplaceApps.id, appRow.id));
        });
      } else {
        // Reject: marca a VERSÃO pendente como rejeitada (sai da fila), e
        // para apps publicados mantemos status='published'. Para drafts em
        // primeira revisão, marca o app como 'rejected'.
        await db.transaction(async (tx) => {
          if (pending) {
            await tx
              .update(marketplaceAppVersions)
              .set({ rejectedAt: new Date(), reviewNotes: data.notes })
              .where(eq(marketplaceAppVersions.id, pending.id));
          }
          await tx
            .update(marketplaceApps)
            .set({
              status: isPublishedWithPending ? appRow.status : "rejected",
              reviewNotes: data.notes,
              reviewedById: userId,
              reviewedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(marketplaceApps.id, appRow.id));
        });
      }

      const [updated] = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.id, appRow.id))
        .limit(1);
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[marketplace] review failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INSTALL (tenant admin) — só aceita versionId pertencente ao app E já
  // publicada. Default usa currentVersionId (sempre published).
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps/:id/install", ...authInstall, async (req: any, res) => {
    try {
      const data = installBodySchema.parse(req.body || {});
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.id, req.params.id))
        .limit(1);
      if (!appRow) return res.status(404).json({ message: "App não encontrado" });
      if (appRow.status !== "published") {
        return res.status(409).json({ message: "App não está publicado" });
      }

      const versionId = data.versionId ?? appRow.currentVersionId;
      if (!versionId) {
        return res.status(409).json({ message: "App sem versão publicada" });
      }
      // installer.ts faz a checagem final de publishedAt — duplicamos aqui
      // para falhar cedo com mensagem clara antes de iniciar a transação.

      try {
        const result = await installApp({
          tenantId,
          userId,
          appId: appRow.id,
          versionId,
        });
        res.status(201).json(result);
      } catch (installErr: unknown) {
        // Persiste estado 'failed' na installation existente (se houver) para
        // observabilidade/retry. Ignora se ainda não existe (1ª install).
        const errorMessage = installErr instanceof Error ? installErr.message : String(installErr);
        try {
          await db
            .update(marketplaceInstallations)
            .set({ status: "failed", errorMessage, updatedAt: new Date() })
            .where(and(
              eq(marketplaceInstallations.appId, appRow.id),
              eq(marketplaceInstallations.tenantId, tenantId),
            ));
        } catch (bookkeepingErr) {
          console.error("[marketplace] install failed-state bookkeeping failed:", bookkeepingErr);
        }
        throw installErr;
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[marketplace] install failed:", err);
      res.status(400).json({ message: err?.message || "Erro ao instalar" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // UPDATE INSTALLATION (tenant admin)
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/installations/:id/update", ...authInstall, async (req: any, res) => {
    try {
      const data = updateBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);
      try {
        await updateInstallation({
          tenantId,
          userId,
          installationId: req.params.id,
          toVersionId: data.versionId,
        });
        res.json({ ok: true });
      } catch (updateErr: unknown) {
        const errorMessage = updateErr instanceof Error ? updateErr.message : String(updateErr);
        try {
          await db
            .update(marketplaceInstallations)
            .set({ status: "failed", errorMessage, updatedAt: new Date() })
            .where(and(
              eq(marketplaceInstallations.id, req.params.id),
              eq(marketplaceInstallations.tenantId, tenantId),
            ));
        } catch (bookkeepingErr) {
          console.error("[marketplace] update failed-state bookkeeping failed:", bookkeepingErr);
        }
        throw updateErr;
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[marketplace] update install failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // ROLLBACK (tenant admin) — reusa update apontando para versão anterior.
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/installations/:id/rollback", ...authInstall, async (req: any, res) => {
    try {
      const data = updateBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);
      await updateInstallation({
        tenantId,
        userId,
        installationId: req.params.id,
        toVersionId: data.versionId,
      });
      res.json({ ok: true, rolledBack: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[marketplace] rollback failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // UNINSTALL (tenant admin) — soft-uninstall (preserva tabelas físicas)
  // ────────────────────────────────────────────────────────────────────────
  app.delete("/api/marketplace/installations/:id", ...authInstall, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      await uninstallApp({ tenantId, installationId: req.params.id });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[marketplace] uninstall failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST REVIEW (rating + comment)
  // ────────────────────────────────────────────────────────────────────────
  app.post("/api/marketplace/apps/:id/reviews", ...authRead, async (req: any, res) => {
    try {
      const data = reviewerBodySchema.parse(req.body);
      const tenantId: string = req.tenantId;
      const userId = userIdOf(req);

      // Só quem instalou pode avaliar.
      const [install] = await db
        .select()
        .from(marketplaceInstallations)
        .where(and(
          eq(marketplaceInstallations.appId, req.params.id),
          eq(marketplaceInstallations.tenantId, tenantId),
        ))
        .limit(1);
      if (!install) {
        return res.status(403).json({ message: "Instale o app antes de avaliar" });
      }

      // Owner não avalia o próprio app.
      const [appRow] = await db
        .select()
        .from(marketplaceApps)
        .where(eq(marketplaceApps.id, req.params.id))
        .limit(1);
      if (appRow?.ownerTenantId === tenantId) {
        return res.status(403).json({ message: "Owner não pode avaliar próprio app" });
      }

      // Upsert review (UNIQUE app+tenant).
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(marketplaceReviews)
          .where(and(
            eq(marketplaceReviews.appId, req.params.id),
            eq(marketplaceReviews.tenantId, tenantId),
          ))
          .limit(1);
        if (existing) {
          await tx
            .update(marketplaceReviews)
            .set({ rating: data.rating, comment: data.comment, userId })
            .where(eq(marketplaceReviews.id, existing.id));
        } else {
          await tx.insert(marketplaceReviews).values({
            appId: req.params.id,
            tenantId,
            userId,
            rating: data.rating,
            comment: data.comment,
          });
        }

        // Recalcula média e count.
        const [agg] = await tx
          .select({
            avg: drizzleSql<string>`AVG(${marketplaceReviews.rating})::numeric(3,2)`,
            cnt: drizzleSql<number>`COUNT(*)::integer`,
          })
          .from(marketplaceReviews)
          .where(eq(marketplaceReviews.appId, req.params.id));
        await tx
          .update(marketplaceApps)
          .set({
            ratingAvg: agg?.avg ?? null,
            ratingCount: Number(agg?.cnt ?? 0),
            updatedAt: new Date(),
          })
          .where(eq(marketplaceApps.id, req.params.id));
      });

      res.json({ ok: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      console.error("[marketplace] review post failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CHARGES REPORT (owner)
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/charges/report", ...authPublish, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const rows = await db
        .select({ charge: marketplaceCharges, app: marketplaceApps })
        .from(marketplaceCharges)
        .leftJoin(marketplaceApps, eq(marketplaceCharges.appId, marketplaceApps.id))
        .where(eq(marketplaceCharges.ownerTenantId, tenantId))
        .orderBy(desc(marketplaceCharges.createdAt))
        .limit(500);

      const totals = rows.reduce(
        (acc, r) => {
          const c = r.charge!;
          acc.total += c.amountCents;
          if (c.status === "paid") acc.paid += c.amountCents;
          if (c.status === "pending") acc.pending += c.amountCents;
          return acc;
        },
        { total: 0, paid: 0, pending: 0 },
      );

      res.json({ charges: rows, totals });
    } catch (err: any) {
      console.error("[marketplace] charges failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INSTALLED MENU — itens de menu agregados de TODOS os apps instalados no
  // tenant atual. Consumido pelo AppSidebar para exibir os módulos do
  // marketplace junto dos módulos nativos. Cada item leva ao roteador
  // dinâmico /api/mkt/<slug>/<resource> via página da SPA.
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/installed-menu", ...authRead, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const rows = await db
        .select({
          install: marketplaceInstallations,
          app: marketplaceApps,
          version: marketplaceAppVersions,
        })
        .from(marketplaceInstallations)
        .leftJoin(marketplaceApps, eq(marketplaceInstallations.appId, marketplaceApps.id))
        .leftJoin(marketplaceAppVersions, eq(marketplaceInstallations.installedVersionId, marketplaceAppVersions.id))
        .where(and(
          eq(marketplaceInstallations.tenantId, tenantId),
          eq(marketplaceInstallations.status, "installed"),
        ));
      const items: Array<{ appSlug: string; appTitle: string; title: string; url: string; icon?: string }> = [];
      for (const r of rows) {
        if (!r.app || !r.version) continue;
        const manifest = (r.version.manifestJson ?? {}) as MarketplaceManifest;
        const menu: MarketplaceManifestMenuItem[] = Array.isArray(manifest.menu) ? manifest.menu : [];
        for (const m of menu) {
          if (!m.url) continue;
          items.push({
            appSlug: r.app.slug,
            appTitle: r.app.title,
            title: m.title,
            url: m.url,
            icon: m.icon,
          });
        }
      }
      res.json({ items });
    } catch (err: any) {
      console.error("[marketplace] installed-menu failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CATALOG SOURCES — ajuda o form de publicação a listar runs/plans elegíveis.
  // ────────────────────────────────────────────────────────────────────────
  app.get("/api/marketplace/sources", ...authPublish, async (req: any, res) => {
    try {
      const tenantId: string = req.tenantId;
      const { idePipelineRuns, modulePlans } = await import("@shared/schema");
      const runs = await db
        .select()
        .from(idePipelineRuns)
        .where(and(
          eq(idePipelineRuns.tenantId, tenantId),
          // qualquer run com designDoc é elegível como pacote (mesmo que ainda
          // não tenha sido deployada — owner sabe o que está publicando).
        ))
        .orderBy(desc(idePipelineRuns.createdAt))
        .limit(100);
      const plans = await db
        .select()
        .from(modulePlans)
        .where(eq(modulePlans.tenantId, tenantId))
        .orderBy(desc(modulePlans.updatedAt))
        .limit(100);
      res.json({
        runs: runs.filter((r) => !!r.designDoc),
        plans,
      });
    } catch (err: any) {
      console.error("[marketplace] sources failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });
}
