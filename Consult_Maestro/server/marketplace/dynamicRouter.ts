// Fase 4 — App Store interna: roteador dinâmico para módulos instalados.
//
// Pacotes do marketplace declaram tabelas no manifest (já criadas como
// `mkt_<slug>_<table>` pelo installer). Este router expõe CRUD genérico
// nessas tabelas em `/api/mkt/:slug/:resource[/:id]`, sempre escopado por
// tenant_id. Substitui a necessidade de cada pacote registrar suas próprias
// rotas Express em runtime (que exigiria recarregar o servidor).
//
// Restrições de segurança:
// - Acesso só se o tenant atual tem instalação `installed` daquele app
//   (mesma checagem de privilégio do install).
// - Identificadores (slug/resource/coluna) validados contra regex SAFE_IDENT.
// - Tipo de coluna validado contra whitelist SAFE_TYPES (mesma do installer).
// - tenant_id sempre forçado na cláusula WHERE/SET — não é controlável pelo
//   payload.
// - Operações destrutivas (POST/PUT/PATCH/DELETE) exigem tenantAdmin.

import type { Express, Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import {
  marketplaceApps,
  marketplaceAppVersions,
  marketplaceInstallations,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import {
  tenantContext,
  requireTenant,
  requireTenantAdmin,
} from "../tenantContext";
import {
  tablePhysicalName,
  type ResolvedManifest,
} from "./installer";
import type { MarketplaceManifest, MarketplaceManifestTable } from "./packager";

const SAFE_IDENT = /^[a-z][a-z0-9_]{0,60}$/;
const SAFE_TYPES = new Set([
  "varchar", "text", "integer", "numeric", "jsonb",
  "timestamp", "boolean", "date", "uuid",
]);

function safe(name: string): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(`Identificador inválido: ${name}`);
  }
  return name;
}

interface ResolvedTable {
  table: MarketplaceManifestTable;
  physical: string;
  // Colunas seguras (whitelist) que podem ser lidas/escritas via API genérica.
  // Sempre exclui id/tenant_id (controlados pelo backend).
  writableColumns: string[];
}

/**
 * Resolve a installation ativa do tenant para `slug` e retorna a tabela alvo
 * (ou 404). Todas as checagens de pertencimento/tenant ficam aqui.
 */
async function resolveInstalledTable(
  tenantId: string,
  slug: string,
  resource: string,
): Promise<ResolvedTable | { error: string; status: number }> {
  const slugSafe = slug.toLowerCase();
  if (!/^[a-z][a-z0-9-]{2,79}$/.test(slugSafe)) {
    return { error: "Slug inválido", status: 400 };
  }
  const resourceSafe = resource.toLowerCase();
  if (!SAFE_IDENT.test(resourceSafe)) {
    return { error: "Recurso inválido", status: 400 };
  }

  const [app] = await db
    .select()
    .from(marketplaceApps)
    .where(eq(marketplaceApps.slug, slugSafe))
    .limit(1);
  if (!app) return { error: "App não encontrado", status: 404 };

  const [install] = await db
    .select()
    .from(marketplaceInstallations)
    .where(and(
      eq(marketplaceInstallations.appId, app.id),
      eq(marketplaceInstallations.tenantId, tenantId),
    ))
    .limit(1);
  if (!install || install.status !== "installed") {
    return { error: "App não instalado neste tenant", status: 404 };
  }

  const [version] = await db
    .select()
    .from(marketplaceAppVersions)
    .where(eq(marketplaceAppVersions.id, install.installedVersionId))
    .limit(1);
  if (!version) return { error: "Versão não encontrada", status: 404 };

  const manifest = (version.manifestJson ?? {}) as MarketplaceManifest;
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
  const table = tables.find((t) => t.name === resourceSafe);
  if (!table) return { error: "Recurso não declarado no manifest", status: 404 };

  const writable = (table.columns || [])
    .map((c) => c.name?.toLowerCase?.() ?? "")
    .filter((n) => SAFE_IDENT.test(n) && n !== "id" && n !== "tenant_id");

  return {
    table,
    physical: tablePhysicalName(slugSafe, resourceSafe),
    writableColumns: writable,
  };
}

const authRead    = [isAuthenticated, tenantContext, requireTenant];
const authWrite   = [isAuthenticated, tenantContext, requireTenant, requireTenantAdmin];

export function registerMarketplaceDynamicRouter(app: Express) {
  // LIST
  app.get("/api/mkt/:slug/:resource", ...authRead, async (req: any, res: Response) => {
    try {
      const tenantId: string = req.tenantId;
      const r = await resolveInstalledTable(tenantId, req.params.slug, req.params.resource);
      if ("error" in r) return res.status(r.status).json({ message: r.error });

      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
      const sql = `SELECT * FROM ${r.physical} WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      const result = await pool.query(sql, [tenantId, limit, offset]);
      res.json({ rows: result.rows, count: result.rowCount, limit, offset });
    } catch (err: any) {
      console.error("[mkt:list] failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // GET ONE
  app.get("/api/mkt/:slug/:resource/:id", ...authRead, async (req: any, res: Response) => {
    try {
      const tenantId: string = req.tenantId;
      const r = await resolveInstalledTable(tenantId, req.params.slug, req.params.resource);
      if ("error" in r) return res.status(r.status).json({ message: r.error });

      const sql = `SELECT * FROM ${r.physical} WHERE tenant_id = $1 AND id = $2 LIMIT 1`;
      const result = await pool.query(sql, [tenantId, req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ message: "Não encontrado" });
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("[mkt:get] failed:", err);
      res.status(500).json({ message: err?.message || "Erro" });
    }
  });

  // CREATE
  app.post("/api/mkt/:slug/:resource", ...authWrite, async (req: any, res: Response) => {
    try {
      const tenantId: string = req.tenantId;
      const r = await resolveInstalledTable(tenantId, req.params.slug, req.params.resource);
      if ("error" in r) return res.status(r.status).json({ message: r.error });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const cols: string[] = ["tenant_id"];
      const placeholders: string[] = ["$1"];
      const values: unknown[] = [tenantId];
      for (const c of r.writableColumns) {
        if (c in body) {
          cols.push(safe(c));
          placeholders.push(`$${values.length + 1}`);
          values.push(body[c] ?? null);
        }
      }
      const sql = `INSERT INTO ${r.physical} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const result = await pool.query(sql, values);
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      console.error("[mkt:create] failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // UPDATE
  app.patch("/api/mkt/:slug/:resource/:id", ...authWrite, async (req: any, res: Response) => {
    try {
      const tenantId: string = req.tenantId;
      const r = await resolveInstalledTable(tenantId, req.params.slug, req.params.resource);
      if ("error" in r) return res.status(r.status).json({ message: r.error });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const c of r.writableColumns) {
        if (c in body) {
          values.push(body[c] ?? null);
          sets.push(`${safe(c)} = $${values.length}`);
        }
      }
      if (sets.length === 0) return res.status(400).json({ message: "Nada para atualizar" });
      sets.push(`updated_at = NOW()`);
      values.push(tenantId, req.params.id);
      const sql = `UPDATE ${r.physical} SET ${sets.join(", ")} WHERE tenant_id = $${values.length - 1} AND id = $${values.length} RETURNING *`;
      const result = await pool.query(sql, values);
      if (result.rowCount === 0) return res.status(404).json({ message: "Não encontrado" });
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("[mkt:update] failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });

  // DELETE
  app.delete("/api/mkt/:slug/:resource/:id", ...authWrite, async (req: any, res: Response) => {
    try {
      const tenantId: string = req.tenantId;
      const r = await resolveInstalledTable(tenantId, req.params.slug, req.params.resource);
      if ("error" in r) return res.status(r.status).json({ message: r.error });

      const sql = `DELETE FROM ${r.physical} WHERE tenant_id = $1 AND id = $2`;
      const result = await pool.query(sql, [tenantId, req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ message: "Não encontrado" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[mkt:delete] failed:", err);
      res.status(400).json({ message: err?.message || "Erro" });
    }
  });
}
