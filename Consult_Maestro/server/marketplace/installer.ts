// Fase 4 — App Store interna: installer.
// Aplica um pacote (marketplace_app_versions) a um tenant alvo. Roda em
// transação por tenant: se qualquer DDL falhar, todo o estado é revertido.
//
// Restrições de segurança:
// - Só cria tabelas com prefixo `mkt_<slug>_<table>` no schema public.
// - Toda tabela criada DEVE incluir tenant_id varchar NOT NULL com índice.
// - Nomes de tabela/coluna validados por regex (defesa contra DDL injection).
// - Só tipos primitivos permitidos: varchar/text/integer/numeric/jsonb/
//   timestamp/boolean/date/uuid.
// - install é idempotente: tabelas usam CREATE TABLE IF NOT EXISTS.
// - update aplica schemaDiff (CREATE TABLE IF NOT EXISTS / ALTER TABLE
//   ADD COLUMN IF NOT EXISTS) — nunca DROPa nada (preserva dados do tenant).

import { db, pool } from "../db";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  marketplaceApps,
  marketplaceAppVersions,
  marketplaceInstallations,
  marketplaceCharges,
} from "@shared/schema";
import type { MarketplaceManifest, MarketplaceManifestTable } from "./packager";

// Diretório raiz onde os arquivos do pacote ficam materializados por
// instalação (`<base>/<tenantId>/<slug>/<version>/<file>`). O dynamicRouter
// lê tabelas DDL; já os filesSnapshot vivem no disco para auditoria,
// inspeção e futuro hot-reload de páginas/agentes do pacote.
const INSTALLS_BASE_PATH =
  process.env.MARKETPLACE_INSTALLS_BASE_PATH ||
  path.join(process.cwd(), ".local", "marketplace-installs");

export function installedFilesPath(tenantId: string, slug: string, version: string): string {
  // `safeIdent` cobre tenantId? Tenants são UUID v4; sanitizamos abaixo para
  // garantir que não há `..` ou separador no path.
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(
    INSTALLS_BASE_PATH,
    sanitize(tenantId),
    sanitize(slug),
    sanitize(version),
  );
}

async function writeInstalledFiles(
  tenantId: string,
  slug: string,
  version: string,
  filesSnapshot: Record<string, string> | null | undefined,
): Promise<string[]> {
  if (!filesSnapshot || typeof filesSnapshot !== "object") return [];
  const dir = installedFilesPath(tenantId, slug, version);
  await fs.mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [rawName, content] of Object.entries(filesSnapshot)) {
    // Normaliza o nome para impedir path traversal (ex.: "../../etc/passwd").
    const safeName = rawName.replace(/^[\/\\]+/, "").replace(/\.\.[\/\\]/g, "");
    const target = path.resolve(dir, safeName);
    if (!target.startsWith(path.resolve(dir))) {
      throw new Error(`[installer] path traversal bloqueado em ${rawName}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    written.push(safeName);
  }
  return written;
}

const SAFE_IDENT = /^[a-z][a-z0-9_]{0,60}$/;
const SAFE_TYPES = new Set([
  "varchar", "text", "integer", "numeric", "jsonb",
  "timestamp", "boolean", "date", "uuid",
]);

function safeIdent(label: string, value: string): string {
  const v = (value || "").toLowerCase().trim();
  if (!SAFE_IDENT.test(v)) {
    throw new Error(`[installer] identificador inválido em ${label}: ${value}`);
  }
  return v;
}

function safeType(raw: string): string {
  const t = (raw || "").toLowerCase().trim().replace(/\(.*\)/, "");
  // Aceita "varchar(255)", "numeric(18,2)", etc. mas só whitelisted base type.
  const base = t.replace(/\(.*\)/, "");
  if (!SAFE_TYPES.has(base)) {
    throw new Error(`[installer] tipo de coluna não suportado: ${raw}`);
  }
  // Volta o raw com parênteses se for válido.
  return raw.match(/^[a-z]+(\([0-9, ]+\))?$/i) ? raw : base;
}

// Postgres tem limite de 63 chars em identificadores. Slug pode ter até 80 e
// table até 60 — sem o controle abaixo o Postgres trunca silenciosamente,
// causando colisão entre apps. Quando excede, usamos prefixo deterministico
// + hash sha1[:8] para garantir unicidade dentro do limite.
const PG_MAX_IDENT = 63;
export function tablePhysicalName(slug: string, name: string): string {
  const slugSafe = safeIdent("app slug", slug.replace(/-/g, "_"));
  const tableSafe = safeIdent("table", name);
  const full = `mkt_${slugSafe}_${tableSafe}`;
  if (full.length <= PG_MAX_IDENT) return full;
  const hash = createHash("sha1").update(full).digest("hex").slice(0, 8);
  // 4 (mkt_) + slug(<=24) + 1 (_) + table(<=24) + 1 (_) + 8 (hash) = 62
  const slugPart = slugSafe.slice(0, 24);
  const tablePart = tableSafe.slice(0, 24);
  return `mkt_${slugPart}_${tablePart}_${hash}`;
}

function buildCreateTableDdl(physicalName: string, table: MarketplaceManifestTable): string {
  const cols: string[] = [
    `id varchar PRIMARY KEY DEFAULT gen_random_uuid()`,
    `tenant_id varchar NOT NULL`,
  ];
  for (const c of table.columns) {
    const cname = safeIdent("column", c.name);
    if (cname === "id" || cname === "tenant_id") continue;
    const ctype = safeType(c.type);
    cols.push(`${cname} ${ctype}`);
  }
  cols.push(`created_at timestamp DEFAULT NOW()`);
  cols.push(`updated_at timestamp DEFAULT NOW()`);
  return `CREATE TABLE IF NOT EXISTS ${physicalName} (\n  ${cols.join(",\n  ")}\n);`;
}

function buildIndexDdl(physicalName: string): string {
  const idxName = `idx_${physicalName}_tenant`;
  return `CREATE INDEX IF NOT EXISTS ${idxName} ON ${physicalName}(tenant_id);`;
}

export interface InstallResult {
  installationId: string;
  tablesCreated: string[];
  filesWritten: string[];
}

// Manifest resolvido pelo installer (já com nomes físicos calculados).
// Exposto para o dynamicRouter consumir sem recalcular.
export interface ResolvedManifest {
  manifest: MarketplaceManifest;
  tablesByName: Map<string, { physical: string }>;
}

/**
 * Instala uma versão do app no tenant. Idempotente:
 * - Se já existe installation (mesmo app+tenant), reseta para versão alvo
 *   (caminho usado pelo update/rollback).
 * - DDL é IF NOT EXISTS para suportar reinstalação.
 */
export async function installApp(params: {
  tenantId: string;
  userId: string | null;
  appId: string;
  versionId: string;
}): Promise<InstallResult> {
  const { tenantId, userId, appId, versionId } = params;

  const [app] = await db
    .select()
    .from(marketplaceApps)
    .where(eq(marketplaceApps.id, appId))
    .limit(1);
  if (!app) throw new Error("App não encontrado");
  if (app.status !== "published") {
    throw new Error("Só apps publicados podem ser instalados");
  }
  // Owner não precisa instalar no próprio tenant (já tem acesso ao código).
  if (app.ownerTenantId === tenantId) {
    throw new Error("Owner do app não precisa instalá-lo no próprio tenant");
  }

  const [version] = await db
    .select()
    .from(marketplaceAppVersions)
    .where(and(eq(marketplaceAppVersions.id, versionId), eq(marketplaceAppVersions.appId, appId)))
    .limit(1);
  if (!version) throw new Error("Versão não encontrada");
  // Bypass de revisão: só permitimos instalar versões aprovadas pelo
  // superadmin (publishedAt setado). Ver routes /review.
  if (!version.publishedAt) {
    throw new Error("Esta versão ainda não foi aprovada — escolha uma versão publicada");
  }

  const manifest = version.manifestJson as MarketplaceManifest;
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];

  // Pré-valida todos os DDLs ANTES de tocar o banco — falha cedo se manifest
  // tem nome/tipo inválido.
  const planned: Array<{ physical: string; createSql: string; indexSql: string }> = [];
  for (const t of tables) {
    const physical = tablePhysicalName(app.slug, t.name);
    planned.push({
      physical,
      createSql: buildCreateTableDdl(physical, t),
      indexSql: buildIndexDdl(physical),
    });
  }

  // Transação: cria tabelas + upsert installation + incrementa contador +
  // registra cobrança. Se qualquer step falhar, tudo reverte.
  // Concorrência: usamos INSERT ... ON CONFLICT (app_id, tenant_id) e
  // incremento atômico em install_count para evitar lost-update e unique
  // violations sob requisições simultâneas.
  const result = await db.transaction(async (tx) => {
    for (const p of planned) {
      await tx.execute(drizzleSql.raw(p.createSql));
      await tx.execute(drizzleSql.raw(p.indexSql));
    }

    // ON CONFLICT exige índice UNIQUE — definido em schema.ts via
    // unique("ux_marketplace_installations_app_tenant").
    const upserted = await tx
      .insert(marketplaceInstallations)
      .values({
        appId,
        tenantId,
        installedVersionId: versionId,
        status: "installed",
        installedById: userId,
      })
      .onConflictDoUpdate({
        target: [marketplaceInstallations.appId, marketplaceInstallations.tenantId],
        set: {
          installedVersionId: versionId,
          status: "installed",
          errorMessage: null,
          installedById: userId,
          updatedAt: new Date(),
          uninstalledAt: null,
        },
      })
      .returning();
    const installId = upserted[0].id;

    // Conta como nova instalação se inserted_at == updated_at (linha nova) ou
    // se voltou de uninstalled. Verificamos via select pós-upsert.
    const [post] = await tx
      .select()
      .from(marketplaceInstallations)
      .where(eq(marketplaceInstallations.id, installId))
      .limit(1);
    const isNew =
      !!post &&
      post.installedAt &&
      post.updatedAt &&
      Math.abs(post.installedAt.getTime() - post.updatedAt.getTime()) < 1000;

    if (isNew) {
      // Incremento atômico: evita lost-update sob concorrência.
      await tx
        .update(marketplaceApps)
        .set({
          installCount: drizzleSql`${marketplaceApps.installCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(marketplaceApps.id, appId));

      // Registro de cobrança (placeholder — Stripe real fora do escopo).
      if (app.billingModel === "per_install" && (app.priceCents ?? 0) > 0) {
        await tx.insert(marketplaceCharges).values({
          appId,
          installationId: installId,
          tenantId,
          ownerTenantId: app.ownerTenantId,
          amountCents: app.priceCents,
          kind: "install",
          status: "pending",
        });
      }
    }
    return installId;
  });
  const installationId = result;

  // Materializa os arquivos do pacote no FS (fora da TX — falha aqui não
  // reverte DDL, mas o tenant pode reinstalar idempotentemente).
  let filesWritten: string[] = [];
  try {
    filesWritten = await writeInstalledFiles(
      tenantId, app.slug, version.version, version.filesSnapshot as Record<string, string> | null,
    );
  } catch (err) {
    console.error("[installer] writeInstalledFiles failed:", err);
  }

  return { installationId, tablesCreated: planned.map((p) => p.physical), filesWritten };
}

/**
 * Atualiza uma installation existente para uma nova versão. Aplica
 * schemaDiff (idempotente — ADD COLUMN IF NOT EXISTS).
 */
export async function updateInstallation(params: {
  tenantId: string;
  userId: string | null;
  installationId: string;
  toVersionId: string;
}): Promise<void> {
  const { tenantId, userId, installationId, toVersionId } = params;

  const [install] = await db
    .select()
    .from(marketplaceInstallations)
    .where(and(eq(marketplaceInstallations.id, installationId), eq(marketplaceInstallations.tenantId, tenantId)))
    .limit(1);
  if (!install) throw new Error("Instalação não encontrada");
  if (install.status === "uninstalled") throw new Error("Instalação removida — reinstale o app");

  const [target] = await db
    .select()
    .from(marketplaceAppVersions)
    .where(and(eq(marketplaceAppVersions.id, toVersionId), eq(marketplaceAppVersions.appId, install.appId)))
    .limit(1);
  if (!target) throw new Error("Versão de destino não encontrada para esse app");
  // Bloqueia upgrade para versão não aprovada — fecha bypass de revisão.
  if (!target.publishedAt) {
    throw new Error("Versão de destino ainda não foi aprovada");
  }

  const [app] = await db
    .select()
    .from(marketplaceApps)
    .where(eq(marketplaceApps.id, install.appId))
    .limit(1);
  if (!app) throw new Error("App não encontrado");

  const manifest = target.manifestJson as MarketplaceManifest;
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];

  await db.transaction(async (tx) => {
    for (const t of tables) {
      const physical = tablePhysicalName(app.slug, t.name);
      // CREATE TABLE IF NOT EXISTS para tabelas novas adicionadas na versão.
      await tx.execute(drizzleSql.raw(buildCreateTableDdl(physical, t)));
      await tx.execute(drizzleSql.raw(buildIndexDdl(physical)));
      // ALTER TABLE ADD COLUMN IF NOT EXISTS para novas colunas.
      for (const c of t.columns) {
        const cname = safeIdent("column", c.name);
        if (cname === "id" || cname === "tenant_id") continue;
        const ctype = safeType(c.type);
        await tx.execute(drizzleSql.raw(
          `ALTER TABLE ${physical} ADD COLUMN IF NOT EXISTS ${cname} ${ctype};`,
        ));
      }
    }
    await tx
      .update(marketplaceInstallations)
      .set({
        installedVersionId: toVersionId,
        installedById: userId,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceInstallations.id, installationId));
  });

  // Materializa arquivos da nova versão (fora da TX).
  try {
    await writeInstalledFiles(
      tenantId, app.slug, target.version, target.filesSnapshot as Record<string, string> | null,
    );
  } catch (err) {
    console.error("[installer] writeInstalledFiles (update) failed:", err);
  }
}

/**
 * Marca uma installation como uninstalled. PRESERVA as tabelas físicas e
 * dados (tenant pode reinstalar e recuperar) — DROP físico exige fluxo
 * separado de "purge data" (fora do MVP).
 */
export async function uninstallApp(params: {
  tenantId: string;
  installationId: string;
}): Promise<void> {
  const { tenantId, installationId } = params;
  const [install] = await db
    .select()
    .from(marketplaceInstallations)
    .where(and(eq(marketplaceInstallations.id, installationId), eq(marketplaceInstallations.tenantId, tenantId)))
    .limit(1);
  if (!install) throw new Error("Instalação não encontrada");

  await db
    .update(marketplaceInstallations)
    .set({
      status: "uninstalled",
      uninstalledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(marketplaceInstallations.id, installationId));
}
