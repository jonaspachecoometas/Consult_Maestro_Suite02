// Sprint IDE-2 — File watcher por tenant para hot-reload do PreviewPanel.
//
// Usa chokidar em um único watcher por tenant (compartilhado entre múltiplas
// conexões SSE). Eventos são debounced 300ms para não inundar o cliente
// quando vários arquivos são salvos juntos (ex.: format-on-save em múltiplos
// arquivos).
//
// O watcher observa o repoDir do InternalGit do tenant — assim, todo write
// feito via writeFile() (POST /api/explorer/file ou ferramenta MCP) dispara
// notificação para os clientes interessados.
//
// Ignora arquivos do .git/, node_modules/, dist/, build/.

import path from "node:path";
import type { Response } from "express";
import { repoDirForTenant } from "../devCenter/internalGit";

interface TenantWatchEntry {
  watcher: any; // chokidar FSWatcher
  subscribers: Set<Response>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  pendingPaths: Set<string>;
}

const tenants = new Map<string, TenantWatchEntry>();
const IGNORED = /(^|[/\\])(\.git|node_modules|dist|build|\.next|\.cache|coverage)([/\\]|$)/;

async function ensureWatcher(tenantId: string): Promise<TenantWatchEntry> {
  const existing = tenants.get(tenantId);
  if (existing) return existing;

  const chokidar = (await import("chokidar")).default;
  const repoDir = repoDirForTenant(tenantId);
  const watcher = chokidar.watch(repoDir, {
    ignored: (p: string) => IGNORED.test(p),
    ignoreInitial: true,
    persistent: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const entry: TenantWatchEntry = {
    watcher,
    subscribers: new Set(),
    debounceTimer: null,
    pendingPaths: new Set(),
  };
  tenants.set(tenantId, entry);

  function flush() {
    entry.debounceTimer = null;
    if (entry.pendingPaths.size === 0) return;
    const paths = Array.from(entry.pendingPaths);
    entry.pendingPaths.clear();
    const payload = JSON.stringify({ type: "change", paths, ts: Date.now() });
    for (const sub of entry.subscribers) {
      try { sub.write(`event: change\ndata: ${payload}\n\n`); } catch {}
    }
  }

  function onFsEvent(eventType: string, fullPath: string) {
    const rel = path.relative(repoDir, fullPath).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) return;
    entry.pendingPaths.add(rel);
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(flush, 300);
  }

  watcher.on("add", (p: string) => onFsEvent("add", p));
  watcher.on("change", (p: string) => onFsEvent("change", p));
  watcher.on("unlink", (p: string) => onFsEvent("unlink", p));
  watcher.on("error", (err: any) => {
    console.error(`[explorer/watcher] tenant=${tenantId}:`, err?.message ?? err);
  });

  return entry;
}

// TTL de inatividade — fecha watcher quando não há subscribers há > IDLE_MS.
// Evita acúmulo de FDs / handles ativos em ambientes com muitos tenants.
const IDLE_MS = 5 * 60 * 1000; // 5 min
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIdleClose(tenantId: string) {
  const existing = idleTimers.get(tenantId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    idleTimers.delete(tenantId);
    const entry = tenants.get(tenantId);
    if (!entry) return;
    if (entry.subscribers.size > 0) return; // alguém reconectou
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { await entry.watcher.close(); } catch {}
    tenants.delete(tenantId);
  }, IDLE_MS);
  idleTimers.set(tenantId, t);
}

export async function subscribe(tenantId: string, res: Response): Promise<() => void> {
  const existingTimer = idleTimers.get(tenantId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    idleTimers.delete(tenantId);
  }
  const entry = await ensureWatcher(tenantId);
  entry.subscribers.add(res);
  return () => {
    entry.subscribers.delete(res);
    if (entry.subscribers.size === 0) scheduleIdleClose(tenantId);
  };
}

// Helper para testes / shutdown gracioso.
export async function _shutdownAll(): Promise<void> {
  for (const [, entry] of tenants) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { await entry.watcher.close(); } catch {}
  }
  tenants.clear();
  for (const [, t] of idleTimers) clearTimeout(t);
  idleTimers.clear();
}
