// Sprint IDE-1 — Painel de explorador (árvore lazy + busca rápida).
// Reutiliza endpoints /api/explorer/* do CodeExplorer existente.
// Não reimplementa lógica: extrai apenas o necessário para o IDE unificado.

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen,
  Loader2, Lock, Search as SearchIcon, RefreshCcw, FileTextIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModulePlannerTab } from "./ModulePlannerTab";

export interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  blocked?: boolean;
}

interface ExplorerPanelProps {
  selectedPath: string | null;
  onFileSelect: (path: string) => void;
}

// Mapeia extensão → linguagem Monaco. Compartilhado com EditorPanel via export.
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", html: "html",
  py: "python", yml: "yaml", yaml: "yaml", sh: "shell", sql: "sql",
};

export function langForPath(p: string): string {
  const ext = p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

// Heurística simples para destacar diretórios "módulo" no topo do explorer.
const MODULE_DIRS = [
  "server/control", "server/societario", "server/recovery",
  "server/producao", "server/ide", "client/src/pages",
];

function TreeNode({
  entry, selectedPath, expanded, childrenByPath, loadingByPath,
  onToggle, onSelect, depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  expanded: Set<string>;
  childrenByPath: Map<string, TreeEntry[]>;
  loadingByPath: Set<string>;
  onToggle: (p: string) => void;
  onSelect: (e: TreeEntry) => void;
  depth: number;
}) {
  const isOpen = expanded.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const isDir = entry.type === "dir";
  const children = isDir ? childrenByPath.get(entry.path) : undefined;
  const isLoading = loadingByPath.has(entry.path);
  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover-elevate ${
          isSelected ? "bg-accent" : ""
        } ${entry.blocked ? "opacity-60" : ""}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (entry.blocked) return;
          if (isDir) onToggle(entry.path);
          else onSelect(entry);
        }}
        data-testid={`workspace-tree-${entry.type}-${entry.path}`}
      >
        {isDir ? (
          isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : <span className="w-3.5" />}
        {isDir ? (
          isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        ) : <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="truncate">{entry.name}</span>
        {entry.blocked && <Lock className="ml-auto h-3 w-3 text-muted-foreground" />}
      </button>
      {isDir && isOpen && (
        <div>
          {isLoading && (
            <div className="flex items-center gap-1 py-1 text-xs text-muted-foreground"
                 style={{ paddingLeft: (depth + 1) * 12 + 4 }}>
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
            </div>
          )}
          {children?.map((child) => (
            <TreeNode key={child.path} entry={child} selectedPath={selectedPath}
              expanded={expanded} childrenByPath={childrenByPath} loadingByPath={loadingByPath}
              onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplorerPanel({ selectedPath, onFileSelect }: ExplorerPanelProps) {
  const [rootEntries, setRootEntries] = useState<TreeEntry[] | null>(null);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, TreeEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingByPath, setLoadingByPath] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadDir = useCallback(async (relPath: string): Promise<TreeEntry[]> => {
    const params = relPath ? `?path=${encodeURIComponent(relPath)}` : "";
    const res = await fetch(`/api/explorer/tree${params}`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || `Falha ao listar ${relPath || "raiz"}`);
    }
    const data = await res.json();
    return data.entries as TreeEntry[];
  }, []);

  const loadRoot = useCallback(async () => {
    setError(null);
    try { setRootEntries(await loadDir("")); }
    catch (err: any) { setError(err?.message || "Erro ao listar raiz"); }
  }, [loadDir]);

  useEffect(() => { if (rootEntries === null) loadRoot(); }, [rootEntries, loadRoot]);

  const handleToggle = useCallback(async (relPath: string) => {
    const next = new Set(expanded);
    if (next.has(relPath)) {
      next.delete(relPath);
      setExpanded(next);
      return;
    }
    next.add(relPath);
    setExpanded(next);
    if (!childrenByPath.has(relPath)) {
      setLoadingByPath((prev) => new Set(prev).add(relPath));
      try {
        const entries = await loadDir(relPath);
        setChildrenByPath((prev) => { const m = new Map(prev); m.set(relPath, entries); return m; });
      } catch (err: any) {
        setError(err?.message || "Erro ao listar diretório");
      } finally {
        setLoadingByPath((prev) => { const s = new Set(prev); s.delete(relPath); return s; });
      }
    }
  }, [expanded, childrenByPath, loadDir]);

  // Filtro: aplicado apenas em entries já carregados (não-recursivo no servidor).
  const visibleRoot = rootEntries
    ? (filter
        ? rootEntries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
        : rootEntries)
    : null;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileTextIcon className="h-3.5 w-3.5" />
          <span>EXPLORER</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadRoot} className="h-6 w-6 p-0"
          data-testid="button-reload-tree" title="Recarregar árvore">
          <RefreshCcw className="h-3 w-3" />
        </Button>
      </div>

      <div className="border-b px-2 py-1.5">
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar raiz..."
            className="h-7 pl-7 text-xs"
            data-testid="input-tree-filter"
          />
        </div>
      </div>

      {/* Atalho módulos: cards de acesso rápido */}
      {rootEntries && (
        <div className="border-b p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Módulos
          </div>
          <div className="flex flex-col gap-0.5">
            {MODULE_DIRS.map((dir) => {
              const exists = rootEntries.some((e) => e.type === "dir" && dir.startsWith(`${e.name}/`)) ||
                rootEntries.some((e) => e.path === dir);
              if (!exists) return null;
              const label = dir.split("/").pop() ?? dir;
              return (
                <button
                  key={dir}
                  type="button"
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover-elevate"
                  onClick={async () => {
                    // Expande recursivamente até o diretório alvo
                    const parts = dir.split("/");
                    let acc = "";
                    for (const p of parts) {
                      acc = acc ? `${acc}/${p}` : p;
                      if (!expanded.has(acc)) await handleToggle(acc);
                    }
                  }}
                  data-testid={`module-shortcut-${label}`}
                >
                  <Folder className="h-3 w-3 text-amber-500" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-1">
          {error && (
            <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {!rootEntries && !error && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {visibleRoot?.map((entry) => (
            <TreeNode
              key={entry.path} entry={entry} selectedPath={selectedPath}
              expanded={expanded} childrenByPath={childrenByPath} loadingByPath={loadingByPath}
              onToggle={handleToggle} onSelect={(e) => onFileSelect(e.path)} depth={0}
            />
          ))}
        </div>
      </ScrollArea>

      <ModulePlannerTab />
    </div>
  );
}
