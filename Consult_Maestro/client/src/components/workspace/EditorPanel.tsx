// Sprint IDE-1 — Editor Monaco com abas múltiplas e auto-save.
// Reusa /api/explorer/file (GET/POST). Salva via debounce 2s + Ctrl+S.
// Capabilities lê /api/explorer/capabilities para ativar/desativar edição.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Save, CheckCircle2, AlertCircle, Lock, Circle } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { langForPath } from "./ExplorerPanel";
import { useToast } from "@/hooks/use-toast";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

interface FileReadResult {
  path: string;
  content: string | null;
  size: number;
  truncated: boolean;
  binary: boolean;
  blocked: boolean;
}

interface Capabilities {
  canWrite: boolean;
  isSuperadmin: boolean;
  systemRole: string;
  maxFileBytes: number;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  state: SaveState;
  loading: boolean;
  truncated: boolean;
  binary: boolean;
  error?: string | null;
}

interface EditorPanelProps {
  activeFile: string | null;
  openFiles: string[];
  onFileSelect: (path: string) => void;
  onFileClose: (path: string) => void;
  onContentChange: (path: string, content: string) => void;
  onDirtyCountChange: (count: number) => void;
}

export function EditorPanel({
  activeFile, openFiles, onFileSelect, onFileClose, onContentChange,
  onDirtyCountChange,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const { toast } = useToast();
  const [files, setFiles] = useState<Map<string, OpenFile>>(new Map());
  const debounceRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const capsQuery = useQuery<Capabilities>({ queryKey: ["/api/explorer/capabilities"] });
  const canWrite = capsQuery.data?.canWrite ?? false;

  // Carrega arquivo quando aparece em openFiles e ainda não está em cache local.
  useEffect(() => {
    openFiles.forEach((path) => {
      if (files.has(path)) return;
      // Marca loading
      setFiles((prev) => {
        const m = new Map(prev);
        m.set(path, {
          path, content: "", originalContent: "", state: "idle",
          loading: true, truncated: false, binary: false,
        });
        return m;
      });
      fetch(`/api/explorer/file?path=${encodeURIComponent(path)}`, { credentials: "include" })
        .then(async (r) => {
          const body = (await r.json()) as FileReadResult & { message?: string };
          if (!r.ok) throw new Error(body?.message ?? "Erro ao ler arquivo");
          const c = body.content ?? "";
          setFiles((prev) => {
            const m = new Map(prev);
            m.set(path, {
              path, content: c, originalContent: c, state: "idle",
              loading: false, truncated: !!body.truncated, binary: !!body.binary,
            });
            return m;
          });
        })
        .catch((err) => {
          setFiles((prev) => {
            const m = new Map(prev);
            m.set(path, {
              path, content: "", originalContent: "", state: "error",
              loading: false, truncated: false, binary: false, error: err?.message,
            });
            return m;
          });
        });
    });
    // Remove arquivos fechados do cache
    setFiles((prev) => {
      const m = new Map(prev);
      for (const k of Array.from(m.keys())) {
        if (!openFiles.includes(k)) m.delete(k);
      }
      return m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles.join("|")]);

  // Notifica contagem de dirties para o status bar
  useEffect(() => {
    let n = 0;
    files.forEach((f) => { if (f.state === "dirty" || f.state === "saving") n++; });
    onDirtyCountChange(n);
  }, [files, onDirtyCountChange]);

  const saveFile = useCallback(async (path: string, content: string) => {
    setFiles((prev) => {
      const m = new Map(prev);
      const f = m.get(path);
      if (f) m.set(path, { ...f, state: "saving" });
      return m;
    });
    try {
      const res = await apiRequest("POST", "/api/explorer/file", { path, content });
      const body = (await res.json()) as { ok: boolean; sha: string | null; noop: boolean };
      setFiles((prev) => {
        const m = new Map(prev);
        const f = m.get(path);
        if (!f) return m;
        // Só marca como salvo se conteúdo enviado bate com atual (evita
        // perder edições subsequentes durante in-flight).
        if (f.content === content) {
          m.set(path, { ...f, state: "saved", originalContent: content });
          setTimeout(() => {
            setFiles((p2) => {
              const m2 = new Map(p2);
              const f2 = m2.get(path);
              if (f2 && f2.state === "saved") m2.set(path, { ...f2, state: "idle" });
              return m2;
            });
          }, 1500);
        } else {
          m.set(path, { ...f, originalContent: content, state: "dirty" });
        }
        return m;
      });
      if (body.noop) return;
    } catch (err: any) {
      setFiles((prev) => {
        const m = new Map(prev);
        const f = m.get(path);
        if (f) m.set(path, { ...f, state: "error" });
        return m;
      });
      toast({ variant: "destructive", title: "Falha ao salvar", description: err?.message || "" });
    }
  }, [toast]);

  const handleChange = useCallback((path: string, next: string) => {
    setFiles((prev) => {
      const m = new Map(prev);
      const f = m.get(path);
      if (!f) return m;
      const isDirty = next !== f.originalContent;
      m.set(path, { ...f, content: next, state: isDirty ? "dirty" : "idle" });
      return m;
    });
    onContentChange(path, next);

    if (!canWrite) return;
    const f = files.get(path);
    if (f?.truncated || f?.binary) return;

    const prev = debounceRefs.current.get(path);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      const cur = files.get(path);
      if (cur && next !== cur.originalContent) saveFile(path, next);
      debounceRefs.current.delete(path);
    }, 2000);
    debounceRefs.current.set(path, t);
  }, [canWrite, files, onContentChange, saveFile]);

  // Ctrl+S — flush imediato do arquivo ativo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && activeFile && canWrite) {
        e.preventDefault();
        const t = debounceRefs.current.get(activeFile);
        if (t) { clearTimeout(t); debounceRefs.current.delete(activeFile); }
        const f = files.get(activeFile);
        if (f && f.content !== f.originalContent) saveFile(activeFile, f.content);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeFile, canWrite, files, saveFile]);

  // Limpa debounces no unmount
  useEffect(() => () => {
    debounceRefs.current.forEach((t) => clearTimeout(t));
    debounceRefs.current.clear();
  }, []);

  const active = activeFile ? files.get(activeFile) : null;
  const language = activeFile ? langForPath(activeFile) : "plaintext";
  const isReadOnly = !canWrite || !!active?.truncated || !!active?.binary;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b bg-muted/30 overflow-x-auto">
        {openFiles.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum arquivo aberto</div>
        ) : (
          openFiles.map((path) => {
            const f = files.get(path);
            const isActive = path === activeFile;
            const isDirty = f && (f.state === "dirty" || f.state === "saving");
            const name = path.split("/").pop() ?? path;
            return (
              <div
                key={path}
                className={`group flex items-center gap-1.5 border-r px-3 py-1.5 text-xs cursor-pointer ${
                  isActive ? "bg-background" : "bg-muted/30 hover-elevate"
                }`}
                onClick={() => onFileSelect(path)}
                data-testid={`tab-file-${path}`}
                title={path}
              >
                {isDirty ? (
                  <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
                ) : (
                  <Circle className="h-2 w-2 text-transparent" />
                )}
                <span className="truncate max-w-[180px]">{name}</span>
                <button
                  type="button"
                  className="rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); onFileClose(path); }}
                  data-testid={`button-close-tab-${path}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Breadcrumb + status do arquivo ativo */}
      {activeFile && (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{activeFile}</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{language}</Badge>
            {!canWrite && (
              <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                <Lock className="h-2.5 w-2.5" /> read-only
              </Badge>
            )}
            {active?.truncated && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">truncado</Badge>}
            {active?.binary && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">binário</Badge>}
            <SaveIndicator state={active?.state ?? "idle"} />
          </div>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 min-h-0">
        {!activeFile ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Selecione um arquivo na árvore à esquerda para começar.
          </div>
        ) : active?.loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : active?.error ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
            {active.error}
          </div>
        ) : active?.binary ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
            Arquivo binário — não pode ser editado.
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          }>
            <MonacoEditor
              key={activeFile}
              height="100%"
              language={language}
              value={active?.content ?? ""}
              theme={theme === "dark" ? "vs-dark" : "vs"}
              onChange={(v) => handleChange(activeFile, v ?? "")}
              options={{
                readOnly: isReadOnly,
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "off",
                tabSize: 2,
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "dirty") {
    return <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <Save className="h-2.5 w-2.5" /> não salvo
    </span>;
  }
  if (state === "saving") {
    return <span className="flex items-center gap-1 text-[10px] text-blue-600">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> salvando…
    </span>;
  }
  if (state === "saved") {
    return <span className="flex items-center gap-1 text-[10px] text-emerald-600">
      <CheckCircle2 className="h-2.5 w-2.5" /> salvo
    </span>;
  }
  return <span className="flex items-center gap-1 text-[10px] text-destructive">
    <AlertCircle className="h-2.5 w-2.5" /> erro
  </span>;
}
