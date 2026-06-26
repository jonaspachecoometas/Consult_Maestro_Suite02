// Code Explorer (Fase 5) — REST endpoints da IDE web.
// RBAC:
//   - reads (tree, file GET, search, history, vscode-link, audit) → tenantAdmin/partner/superadmin
//   - writes (file POST, revert) → developer = superadmin OU role='admin' do tenant
//
// Todas as rotas tenant-isoladas via tenantContext + InternalGit por tenantId.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant, requireTenantAdminOrPartner } from "../tenantContext";
import {
  listDir,
  readFile,
  writeFile,
  fileHistory,
  diffFile,
  isPathBlocked,
} from "./fileService";
import { searchRepo } from "./search";
import { recordAudit } from "./audit";
import { subscribe as subscribeFileWatcher } from "./fileWatcher";
import { getInternalGitForTenant } from "../devCenter/internalGit";
import { db } from "../db";
import { explorerAuditLog, users } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

// Superadmin sem tenant ativo cai em um repo dedicado (`_superadmin`) ou
// usa `?tenantId=` (sanitizado pelo mesmo regex do InternalGit) para inspecionar
// o repo de um tenant específico. Tenants normais sempre têm req.tenantId
// preenchido pelo `tenantContext` e este middleware é no-op.
const TENANT_ID_RE = /^[A-Za-z0-9_.-]+$/;
const ensureTenantForExplorer: RequestHandler = (req: any, _res, next) => {
  if (req.tenantId) return next();
  if (req.isSuperadmin) {
    const q = (req.query?.tenantId as string | undefined) ?? "";
    if (q && TENANT_ID_RE.test(q)) {
      req.tenantId = q;
    } else {
      req.tenantId = "_superadmin";
    }
  }
  next();
};

// Read gate — qualquer admin do tenant + partner + superadmin
const readGate = [
  isAuthenticated,
  tenantContext,
  requireTenant,
  ensureTenantForExplorer,
  requireTenantAdminOrPartner,
];

// Write gate — superadmin OU developer (tenant_admin do MVP).
// Identidade segue a mesma ordem usada por tenantContext.getAuthUserId:
// 1) auth local (user.id), 2) dbUserId (OIDC após upsertOidcUser),
// 3) claims.sub (legacy providerSub).
function resolveUserId(req: any): string | null {
  const u = req.user;
  if (u?.isLocalAuth && u?.id) return u.id;
  if (u?.dbUserId) return u.dbUserId;
  if (u?.claims?.sub) return u.claims.sub;
  if (u?.id) return u.id;
  return null;
}

const requireDeveloper: RequestHandler = async (req: any, res, next) => {
  // Política Fase 5 (least privilege, escopo do tenant ativo):
  // escrita SOMENTE para:
  //   - superadmin, OU
  //   - usuário cuja MEMBERSHIP no tenant ativo é admin
  //     (req.tenantRole resolvido por tenantContext a partir de
  //     tenant_users.role, com x-tenant-id ou tenant_users.is_active).
  //
  // O global users.role e o global users.systemRole NÃO autorizam
  // escrita — isso evita escalonamento entre tenants quando um
  // tenant_admin global troca de tenant via x-tenant-id e ali é apenas
  // membro comum.
  if (req.isSuperadmin) return next();
  if (req.tenantRole === "admin" || req.tenantRole === "superadmin") return next();
  return res.status(403).json({ message: "Apenas administradores do tenant podem editar arquivos" });
};

const writeGate = [
  isAuthenticated,
  tenantContext,
  requireTenant,
  ensureTenantForExplorer,
  requireDeveloper,
];

const treeQuerySchema = z.object({
  path: z.string().max(1000).optional().default(""),
});

const fileQuerySchema = z.object({
  path: z.string().min(1).max(1000),
  ref: z.string().max(80).optional(),
});

const fileWriteSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(1_000_000),
  message: z.string().min(1).max(500).optional(),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  regex: z.union([z.literal("1"), z.literal("true")]).optional(),
  caseSensitive: z.union([z.literal("1"), z.literal("true")]).optional(),
  pathGlob: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const revertSchema = z.object({
  path: z.string().min(1).max(1000),
  ref: z.string().min(4).max(80),
  message: z.string().min(1).max(500).optional(),
});

function getUserId(req: any): string | null {
  return resolveUserId(req);
}

export function registerExplorerRoutes(app: Express): void {
  // ── Tree (lazy load — 1 nível por chamada) ─────────────────────────────
  app.get("/api/explorer/tree", ...readGate, async (req: any, res) => {
    try {
      const { path: relPath } = treeQuerySchema.parse(req.query);
      if (relPath && isPathBlocked(relPath)) {
        return res.status(403).json({ message: "Caminho bloqueado" });
      }
      const entries = await listDir(req.tenantId, relPath);
      // Audit só na raiz para não inundar (ações de read em diretório são frequentes).
      if (!relPath) {
        await recordAudit({
          tenantId: req.tenantId,
          userId: getUserId(req),
          action: "tree",
          filePath: null,
        });
      }
      res.json({ path: relPath, entries });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /tree:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao listar diretório" });
    }
  });

  // ── File read ──────────────────────────────────────────────────────────
  app.get("/api/explorer/file", ...readGate, async (req: any, res) => {
    try {
      const { path: relPath, ref } = fileQuerySchema.parse(req.query);
      const result = await readFile(req.tenantId, relPath, ref);
      if (result.blocked) return res.status(403).json({ message: "Caminho bloqueado", ...result });
      await recordAudit({
        tenantId: req.tenantId,
        userId: getUserId(req),
        action: "read",
        filePath: relPath,
        meta: ref ? { ref } : null,
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /file:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao ler arquivo" });
    }
  });

  // ── File write + commit ────────────────────────────────────────────────
  app.post("/api/explorer/file", ...writeGate, async (req: any, res) => {
    try {
      const data = fileWriteSchema.parse(req.body);
      const userId = getUserId(req);
      const u = userId
        ? (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
        : null;
      const author = u
        ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || userId!
        : "explorer";
      const message = data.message?.trim() || `explorer: edita ${data.path} (por ${author})`;
      const result = await writeFile(req.tenantId, data.path, data.content, message);
      await recordAudit({
        tenantId: req.tenantId,
        userId,
        action: "write",
        filePath: data.path,
        sha: result.sha,
        meta: { noop: result.noop, bytes: Buffer.byteLength(data.content, "utf8") },
      });
      res.json({ ok: true, sha: result.sha, noop: result.noop });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      console.error("[explorer] POST /file:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao salvar arquivo" });
    }
  });

  // ── Search ─────────────────────────────────────────────────────────────
  app.get("/api/explorer/search", ...readGate, async (req: any, res) => {
    try {
      const data = searchQuerySchema.parse(req.query);
      const result = await searchRepo(req.tenantId, {
        query: data.q,
        regex: data.regex === "1" || data.regex === "true",
        caseSensitive: data.caseSensitive === "1" || data.caseSensitive === "true",
        pathGlob: data.pathGlob,
        maxResults: data.limit,
      });
      await recordAudit({
        tenantId: req.tenantId,
        userId: getUserId(req),
        action: "search",
        filePath: null,
        meta: {
          q: data.q.slice(0, 200),
          regex: !!data.regex,
          hits: result.hits.length,
          durationMs: result.durationMs,
        },
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /search:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro na busca" });
    }
  });

  // ── History de um arquivo ─────────────────────────────────────────────
  app.get("/api/explorer/history", ...readGate, async (req: any, res) => {
    try {
      const { path: relPath } = fileQuerySchema.pick({ path: true }).parse(req.query);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const commits = await fileHistory(req.tenantId, relPath, limit);
      await recordAudit({
        tenantId: req.tenantId,
        userId: getUserId(req),
        action: "history",
        filePath: relPath,
        meta: { count: commits.length },
      });
      res.json({ path: relPath, commits });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /history:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao buscar histórico" });
    }
  });

  // ── Diff: compara conteúdo de um arquivo entre dois refs ──────────────
  // Se ref2 omitido, compara ref1 com HEAD.
  app.get("/api/explorer/diff", ...readGate, async (req: any, res) => {
    try {
      const { path: relPath, ref1, ref2 } = z
        .object({
          path: z.string().min(1).max(1000),
          ref1: z.string().min(1).max(200),
          ref2: z.string().max(200).optional(),
        })
        .parse(req.query);
      const result = await diffFile(req.tenantId, relPath, ref1, ref2);
      await recordAudit({
        tenantId: req.tenantId,
        userId: getUserId(req),
        action: "diff",
        filePath: relPath,
        meta: { ref1, ref2: result.ref2, binary: result.binary },
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /diff:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao gerar diff" });
    }
  });

  // ── Revert: restaura conteúdo de um SHA antigo e commita ──────────────
  app.post("/api/explorer/revert", ...writeGate, async (req: any, res) => {
    try {
      const data = revertSchema.parse(req.body);
      // Lê conteúdo no ref alvo
      const t = await getInternalGitForTenant(req.tenantId);
      const safeRef = data.ref.replace(/[^A-Za-z0-9]/g, "");
      if (!safeRef) return res.status(400).json({ message: "SHA inválido" });
      const original = await t.client.getFileContent("", "", data.path, safeRef);
      if (original == null) return res.status(404).json({ message: "Arquivo não encontrado nesse commit" });
      const userId = getUserId(req);
      const message = data.message?.trim() || `explorer: revert ${data.path} → ${safeRef.slice(0, 8)}`;
      const result = await writeFile(req.tenantId, data.path, original, message);
      await recordAudit({
        tenantId: req.tenantId,
        userId,
        action: "revert",
        filePath: data.path,
        sha: result.sha,
        meta: { fromRef: safeRef, noop: result.noop },
      });
      res.json({ ok: true, sha: result.sha, noop: result.noop });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      console.error("[explorer] POST /revert:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro ao reverter" });
    }
  });

  // ── VSCode local deep link ─────────────────────────────────────────────
  // Retorna deep links para abrir caminho/clone no VSCode local.
  // Se EXPLORER_REMOTE_BASE_URL estiver configurado (ex.: Gitea público), gera
  // link de clone do tenant; caso contrário, oferece apenas o link de path
  // (assume que o usuário já tem o workspace aberto no VSCode).
  app.get("/api/explorer/vscode-link", ...readGate, async (req: any, res) => {
    try {
      const { path: filePath, line } = z
        .object({ path: z.string().max(1000).optional(), line: z.coerce.number().int().min(1).optional() })
        .parse(req.query);
      const baseRemote = process.env.EXPLORER_REMOTE_BASE_URL?.trim();
      const links: { label: string; url: string }[] = [];
      if (baseRemote) {
        const safeTenant = req.tenantId.replace(/[^A-Za-z0-9_.-]/g, "");
        const cloneUrl = `${baseRemote.replace(/\/$/, "")}/${safeTenant}.git`;
        links.push({
          label: "Clonar repo no VSCode",
          url: `vscode://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}`,
        });
      }
      if (filePath) {
        // vscode://file/<path>:<line> — funciona quando o usuário já clonou
        // localmente. Ele cola/clica e o VSCode abre se o path bate.
        const safe = filePath.replace(/[^A-Za-z0-9_./-]/g, "");
        const target = line ? `${safe}:${line}` : safe;
        links.push({ label: "Abrir caminho no VSCode local", url: `vscode://file/${target}` });
      }
      res.json({ links, hasRemote: !!baseRemote });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Parâmetros inválidos", errors: err.errors });
      console.error("[explorer] GET /vscode-link:", err?.message ?? err);
      res.status(400).json({ message: err?.message ?? "Erro" });
    }
  });

  // ── Audit log read (apenas tenant admin/partner/superadmin) ────────────
  app.get("/api/explorer/audit", ...readGate, async (req: any, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const rows = await db
        .select()
        .from(explorerAuditLog)
        .where(eq(explorerAuditLog.tenantId, req.tenantId))
        .orderBy(desc(explorerAuditLog.createdAt))
        .limit(limit);
      res.json({ items: rows });
    } catch (err: any) {
      console.error("[explorer] GET /audit:", err?.message ?? err);
      res.status(500).json({ message: err?.message ?? "Erro ao listar audit" });
    }
  });

  // ── SSE: file watcher (Sprint IDE-2 — hot reload) ────────────────────
  // Cliente: const es = new EventSource('/api/explorer/watch')
  // Eventos: { type: 'change', paths: string[], ts: number }
  // O watcher é por tenant e compartilhado entre múltiplas conexões.
  app.get("/api/explorer/watch", ...readGate, async (req: any, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`event: hello\ndata: {"tenantId":"${req.tenantId}"}\n\n`);

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = await subscribeFileWatcher(req.tenantId, res);
    } catch (err: any) {
      console.error("[explorer] watch subscribe:", err?.message ?? err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? "watch error" })}\n\n`);
      res.end();
      return;
    }

    // Heartbeat a cada 25s (intermediate proxies costumam matar conexões idle a 30s).
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 25_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  // ── Capability info para o frontend ────────────────────────────────────
  // MESMA política de requireDeveloper: superadmin OU tenantRole=admin
  // (membership no tenant ATIVO). systemRole global não conta.
  app.get("/api/explorer/capabilities", ...readGate, async (req: any, res) => {
    const canWrite =
      !!req.isSuperadmin ||
      req.tenantRole === "admin" ||
      req.tenantRole === "superadmin";
    res.json({
      canWrite,
      isSuperadmin: !!req.isSuperadmin,
      systemRole: req.systemRole ?? "user",
      tenantRole: req.tenantRole ?? null,
      maxFileBytes: 1_000_000,
    });
  });
}
