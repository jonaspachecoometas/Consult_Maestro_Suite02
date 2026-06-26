// Code Explorer (Fase 5) — IDE web sobre o repo interno do tenant.
// Layout: árvore (esquerda, lazy) + editor Monaco (direita) com tabs:
//   Editor • Histórico (file) • Busca global • Auditoria.
// RBAC: leitura para tenantAdmin/partner/superadmin. Edição apenas se
// /api/explorer/capabilities devolver canWrite=true (developer).

import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  Save,
  RotateCcw,
  Search as SearchIcon,
  History as HistoryIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCcw,
  ShieldAlert,
  Lock,
  FileText as FileTextIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";

// Monaco lazy — pesado (~300KB). Só carrega quando seleciona arquivo.
const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default }))
);
// Diff editor lazy — usado apenas quando comparando duas versões.
const MonacoDiffEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor }))
);

interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  blocked?: boolean;
}

interface Capabilities {
  canWrite: boolean;
  isSuperadmin: boolean;
  systemRole: string;
  maxFileBytes: number;
}

interface FileReadResult {
  path: string;
  content: string | null;
  size: number;
  truncated: boolean;
  binary: boolean;
  blocked: boolean;
  ref?: string;
}

interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

interface HistoryCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
}

interface DiffPayload {
  path: string;
  ref1: string;
  ref2: string;
  left: string;
  right: string;
  binary: boolean;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  sql: "sql",
};

function langForPath(p: string): string {
  const ext = p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ─── Tree node (recursivo) ─────────────────────────────────────────────────
function TreeNode({
  entry,
  selectedPath,
  expanded,
  childrenByPath,
  loadingByPath,
  onToggle,
  onSelect,
  depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  expanded: Set<string>;
  childrenByPath: Map<string, TreeEntry[]>;
  loadingByPath: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (entry: TreeEntry) => void;
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
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        } ${entry.blocked ? "opacity-60" : ""}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (entry.blocked) return;
          if (isDir) onToggle(entry.path);
          else onSelect(entry);
        }}
        data-testid={`tree-${entry.type}-${entry.path}`}
      >
        {isDir ? (
          isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {isDir ? (
          isOpen ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          )
        ) : (
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{entry.name}</span>
        {entry.blocked && <Lock className="ml-auto h-3 w-3 text-muted-foreground" />}
      </button>
      {isDir && isOpen && (
        <div>
          {isLoading && (
            <div
              className="flex items-center gap-1 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Carregando…
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              selectedPath={selectedPath}
              expanded={expanded}
              childrenByPath={childrenByPath}
              loadingByPath={loadingByPath}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CodeExplorer() {
  const { toast } = useToast();
  const { isSuperadmin, isPartner, isTenantAdmin, isLoading: roleLoading } = useSystemRole();
  const allowed = isSuperadmin || isPartner || isTenantAdmin;

  // ── Capabilities (canWrite) ───────────────────────────────────────────
  const capsQuery = useQuery<Capabilities>({
    queryKey: ["/api/explorer/capabilities"],
    enabled: allowed,
  });
  const canWrite = capsQuery.data?.canWrite ?? false;

  // ── Tree state ────────────────────────────────────────────────────────
  const [rootEntries, setRootEntries] = useState<TreeEntry[] | null>(null);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, TreeEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingByPath, setLoadingByPath] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);

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
    if (!allowed) return;
    setTreeError(null);
    try {
      const entries = await loadDir("");
      setRootEntries(entries);
    } catch (err: any) {
      setTreeError(err?.message || "Erro ao listar raiz");
    }
  }, [allowed, loadDir]);

  useEffect(() => {
    if (allowed && rootEntries === null) loadRoot();
  }, [allowed, rootEntries, loadRoot]);

  const handleToggleDir = useCallback(
    async (relPath: string) => {
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
          setChildrenByPath((prev) => {
            const m = new Map(prev);
            m.set(relPath, entries);
            return m;
          });
        } catch (err: any) {
          toast({
            variant: "destructive",
            title: "Erro ao listar diretório",
            description: err?.message ?? "",
          });
        } finally {
          setLoadingByPath((prev) => {
            const s = new Set(prev);
            s.delete(relPath);
            return s;
          });
        }
      }
    },
    [expanded, childrenByPath, loadDir, toast],
  );

  // ── Selected file / editor ─────────────────────────────────────────────
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileResult, setFileResult] = useState<FileReadResult | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [originalValue, setOriginalValue] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("editor");
  type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monaco editor instance — usado para revealLine quando o usuário
  // clica num resultado da busca global ("abrir no arquivo na linha N").
  const editorRef = useRef<any>(null);
  // Reveal pendente (linha/coluna) a ser aplicado assim que o editor montar
  // ou o arquivo terminar de carregar. Limpo após uso.
  const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null);

  const applyPendingReveal = useCallback((expectedPath?: string) => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    if (expectedPath && pending.path !== expectedPath) return;
    const ed = editorRef.current;
    if (!ed) return; // editor ainda não montado — onMount tentará de novo
    try {
      ed.revealLineInCenter(pending.line);
      ed.setPosition({ lineNumber: pending.line, column: Math.max(1, pending.column) });
      ed.focus();
      pendingRevealRef.current = null;
    } catch {
      pendingRevealRef.current = null;
    }
  }, []);
  // Versionamento de saves para descartar respostas obsoletas (race condition).
  // Cada `mutate` incrementa o counter; só o `onSuccess` da MAIS recente atualiza
  // o `originalValue`, evitando marcar como persistido um conteúdo que o
  // usuário já alterou.
  const saveSeqRef = useRef(0);
  const lastFinishedSeqRef = useRef(0);

  const loadFile = useCallback(async (relPath: string, ref?: string) => {
    // Cancela debounce pendente para o arquivo anterior — evita commit
    // inesperado quando o usuário troca de arquivo/ref no meio de uma edição.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Invalida saves em voo do arquivo anterior.
    saveSeqRef.current = saveSeqRef.current + 1;
    lastFinishedSeqRef.current = saveSeqRef.current;
    setFileLoading(true);
    setFileError(null);
    try {
      const params = new URLSearchParams({ path: relPath });
      if (ref) params.set("ref", ref);
      const res = await fetch(`/api/explorer/file?${params}`, { credentials: "include" });
      const body = (await res.json()) as FileReadResult & { message?: string };
      if (!res.ok) throw new Error(body?.message ?? "Erro ao ler arquivo");
      setFileResult(body);
      const content = body.content ?? "";
      setEditorValue(content);
      setOriginalValue(content);
      setSaveState("idle");
      // Aplica reveal pendente (vindo de um clique em resultado de busca).
      // Usa rAF para esperar o Monaco terminar de renderizar o conteúdo novo.
      if (pendingRevealRef.current && pendingRevealRef.current.path === relPath) {
        requestAnimationFrame(() => applyPendingReveal(relPath));
      }
    } catch (err: any) {
      setFileError(err?.message ?? "Erro ao ler arquivo");
      setFileResult(null);
      setEditorValue("");
      setOriginalValue("");
    } finally {
      setFileLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    (entry: TreeEntry) => {
      if (entry.type !== "file" || entry.blocked) return;
      setSelectedPath(entry.path);
      loadFile(entry.path);
    },
    [loadFile],
  );

  // ── Save (debounce 2s) ────────────────────────────────────────────────
  // Race-safe: usamos `saveSeqRef` como token monotônico. Apenas o callback
  // da request mais recente atualiza `originalValue` — respostas tardias de
  // saves anteriores são ignoradas. `vars.content` (conteúdo enviado de fato)
  // é usado em vez do `editorValue` atual, evitando marcar como persistido
  // o que o usuário já alterou.
  const saveMutation = useMutation({
    mutationFn: async (vars: { path: string; content: string; seq: number }) => {
      const res = await apiRequest("POST", "/api/explorer/file", {
        path: vars.path,
        content: vars.content,
      });
      const body = (await res.json()) as { ok: boolean; sha: string | null; noop: boolean };
      return { ...body, seq: vars.seq, sentContent: vars.content, sentPath: vars.path };
    },
    onMutate: () => setSaveState("saving"),
    onSuccess: (data) => {
      // Descarta resposta obsoleta (outro save mais novo já saiu).
      if (data.seq < lastFinishedSeqRef.current) return;
      lastFinishedSeqRef.current = data.seq;
      // Só atualiza UI se ainda estamos no mesmo arquivo.
      if (data.sentPath !== selectedPath) return;
      setOriginalValue(data.sentContent);
      // Se o usuário não editou desde o disparo, podemos voltar ao estado limpo.
      setSaveState((prev) => (prev === "saving" ? "saved" : prev));
      if (selectedPath) {
        queryClient.invalidateQueries({ queryKey: ["/api/explorer/history", selectedPath] });
      }
      if (data?.noop) {
        toast({ title: "Sem alterações", description: "Conteúdo idêntico ao último commit." });
      }
    },
    onError: (err: any) => {
      setSaveState("error");
      toast({
        variant: "destructive",
        title: "Falha ao salvar",
        description: err?.message ?? "Erro desconhecido",
      });
    },
  });

  const triggerAutosave = useCallback(
    (next: string) => {
      if (!selectedPath || !canWrite) return;
      // Edição de ref histórica nunca dispara autosave (defensive — editor
      // já é readOnly nesse caso).
      if (fileResult?.ref) return;
      if (fileResult?.truncated || fileResult?.binary) return;
      if (next === originalValue) {
        setSaveState("idle");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        return;
      }
      setSaveState("dirty");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const seq = ++saveSeqRef.current;
        saveMutation.mutate({ path: selectedPath, content: next, seq });
      }, 2000);
    },
    [selectedPath, canWrite, originalValue, saveMutation, fileResult?.ref, fileResult?.truncated, fileResult?.binary],
  );

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // ── Search ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCase, setSearchCase] = useState(false);
  const [searchPathGlob, setSearchPathGlob] = useState("");
  const [searchResult, setSearchResult] = useState<{
    hits: SearchHit[];
    truncated: boolean;
    durationMs: number;
  } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: searchQuery });
      if (searchRegex) params.set("regex", "1");
      if (searchCase) params.set("caseSensitive", "1");
      if (searchPathGlob.trim()) params.set("pathGlob", searchPathGlob.trim());
      const res = await fetch(`/api/explorer/search?${params}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Erro na busca");
      setSearchResult(body);
    } catch (err: any) {
      setSearchError(err?.message ?? "Erro na busca");
      setSearchResult(null);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, searchRegex, searchCase, searchPathGlob]);

  // ── History (per file) ────────────────────────────────────────────────
  const historyQuery = useQuery<{ path: string; commits: HistoryCommit[] }>({
    queryKey: ["/api/explorer/history", selectedPath],
    enabled: !!selectedPath,
    queryFn: async () => {
      const res = await fetch(
        `/api/explorer/history?path=${encodeURIComponent(selectedPath!)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error((await res.json()).message ?? "Erro");
      return res.json();
    },
  });

  const revertMutation = useMutation({
    mutationFn: async (vars: { path: string; ref: string }) => {
      const res = await apiRequest("POST", "/api/explorer/revert", vars);
      return (await res.json()) as { ok: boolean; sha: string | null; noop: boolean };
    },
    onSuccess: () => {
      toast({ title: "Revertido", description: "Arquivo restaurado ao commit selecionado." });
      if (selectedPath) {
        loadFile(selectedPath);
        queryClient.invalidateQueries({ queryKey: ["/api/explorer/history", selectedPath] });
      }
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Erro ao reverter", description: err?.message ?? "" });
    },
  });

  // ── VSCode deep links ─────────────────────────────────────────────────
  // Sempre buscamos o link de clone (a nível de repo) e — quando há arquivo
  // selecionado — também o link de arquivo. Render no header (clone) e
  // ao lado do path bar (arquivo).
  type VscodeLinkPayload = { links: { label: string; url: string }[]; hasRemote: boolean };
  const vscodeRepoQuery = useQuery<VscodeLinkPayload>({
    queryKey: ["/api/explorer/vscode-link", "repo"],
    enabled: allowed,
    queryFn: async () => {
      const res = await fetch(`/api/explorer/vscode-link`, { credentials: "include" });
      return res.json();
    },
  });
  const vscodeLinkQuery = useQuery<VscodeLinkPayload>({
    queryKey: ["/api/explorer/vscode-link", selectedPath],
    enabled: !!selectedPath,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPath) params.set("path", selectedPath);
      const res = await fetch(`/api/explorer/vscode-link?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  // ── Compare / diff ────────────────────────────────────────────────────
  // Permite selecionar 2 SHAs no Histórico e visualizar o diff inline com
  // o Monaco DiffEditor. `compareA`/`compareB` aceitam um SHA do histórico,
  // ou a string especial "HEAD" para comparar contra a versão atual.
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<DiffPayload | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const runCompare = useCallback(async () => {
    if (!selectedPath || !compareA) return;
    setDiffLoading(true);
    setDiffError(null);
    setDiffData(null);
    try {
      const params = new URLSearchParams({ path: selectedPath, ref1: compareA });
      if (compareB) params.set("ref2", compareB);
      const res = await fetch(`/api/explorer/diff?${params}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Falha ao comparar");
      setDiffData(body as DiffPayload);
    } catch (err: any) {
      setDiffError(err?.message ?? "Erro ao comparar");
    } finally {
      setDiffLoading(false);
    }
  }, [selectedPath, compareA, compareB]);

  // Limpa seleção de compare quando troca de arquivo.
  useEffect(() => {
    setCompareA(null);
    setCompareB(null);
    setDiffData(null);
    setDiffError(null);
  }, [selectedPath]);

  // ── Audit ─────────────────────────────────────────────────────────────
  const auditQuery = useQuery<{ items: any[] }>({
    queryKey: ["/api/explorer/audit"],
    enabled: allowed,
  });

  const editorLanguage = useMemo(() => (selectedPath ? langForPath(selectedPath) : "plaintext"), [selectedPath]);
  // Read-only quando: sem permissão, arquivo truncado, binário ou estamos
  // visualizando uma ref histórica (o "Ver" do histórico carrega ref).
  const isReadOnlyEditor =
    !canWrite || !!fileResult?.truncated || !!fileResult?.binary || !!fileResult?.ref;

  if (roleLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-2 text-lg font-semibold">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">
            O Code Explorer está disponível apenas para administradores do tenant,
            parceiros e superadmins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <FileTextIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold" data-testid="text-page-title">
            Explorador de Código
          </h1>
          <Badge variant="outline" className="text-xs">
            Repositório interno do tenant
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {!canWrite && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-read-only">
              <Lock className="mr-1 h-3 w-3" /> Somente leitura
            </Badge>
          )}
          {/* Clone do repo no VSCode local — disponível sempre que houver
              EXPLORER_REMOTE_BASE_URL configurado (independente de arquivo). */}
          {vscodeRepoQuery.data?.hasRemote &&
            vscodeRepoQuery.data.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                className="inline-flex items-center gap-1 text-xs text-primary underline"
                data-testid={`link-vscode-repo-${l.label.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {l.label}
              </a>
            ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRootEntries(null);
              setChildrenByPath(new Map());
              setExpanded(new Set());
              loadRoot();
            }}
            data-testid="button-refresh-tree"
          >
            <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Atualizar árvore
          </Button>
        </div>
      </div>

      {/* Body: tree + main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tree */}
        <div className="flex w-72 shrink-0 flex-col border-r">
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Arquivos
          </div>
          <ScrollArea className="flex-1 p-2">
            {treeError && (
              <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{treeError}</span>
              </div>
            )}
            {rootEntries === null && !treeError && (
              <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando…
              </div>
            )}
            {rootEntries?.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground">
                Repositório vazio. Gere código pelo Dev Center para popular.
              </div>
            )}
            {rootEntries?.map((e) => (
              <TreeNode
                key={e.path}
                entry={e}
                selectedPath={selectedPath}
                expanded={expanded}
                childrenByPath={childrenByPath}
                loadingByPath={loadingByPath}
                onToggle={handleToggleDir}
                onSelect={handleSelect}
                depth={0}
              />
            ))}
          </ScrollArea>
        </div>

        {/* Main panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-1">
              <TabsList className="h-8">
                <TabsTrigger value="editor" data-testid="tab-editor">
                  Editor
                </TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-history" disabled={!selectedPath}>
                  Histórico
                </TabsTrigger>
                <TabsTrigger value="search" data-testid="tab-search">
                  Busca
                </TabsTrigger>
                <TabsTrigger value="audit" data-testid="tab-audit">
                  Auditoria
                </TabsTrigger>
              </TabsList>
              {selectedPath && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground" data-testid="text-current-path">
                    {selectedPath}
                  </span>
                  {fileResult && (
                    <Badge variant="outline" className="text-xs">
                      {formatBytes(fileResult.size)}
                    </Badge>
                  )}
                  {fileResult?.truncated && (
                    <Badge variant="destructive" className="text-xs">
                      Truncado
                    </Badge>
                  )}
                  {fileResult?.binary && (
                    <Badge variant="secondary" className="text-xs">
                      Binário
                    </Badge>
                  )}
                  {fileResult?.ref && (
                    <Badge variant="outline" className="text-xs" data-testid="badge-history-ref">
                      <HistoryIcon className="mr-1 h-3 w-3" /> {fileResult.ref.slice(0, 8)}
                    </Badge>
                  )}
                  {saveState === "dirty" && (
                    <Badge variant="outline" className="text-xs">
                      Editando…
                    </Badge>
                  )}
                  {saveState === "saving" && (
                    <Badge variant="outline" className="text-xs">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Salvando
                    </Badge>
                  )}
                  {saveState === "saved" && (
                    <Badge variant="outline" className="text-xs">
                      <CheckCircle2 className="mr-1 h-3 w-3 text-green-600" /> Salvo
                    </Badge>
                  )}
                  {saveState === "error" && (
                    <Badge variant="destructive" className="text-xs">
                      Erro
                    </Badge>
                  )}
                  {vscodeLinkQuery.data?.links?.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      className="inline-flex items-center gap-1 text-primary underline"
                      data-testid={`link-vscode-${l.label.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Editor tab */}
            <TabsContent value="editor" className="m-0 flex-1 overflow-hidden">
              {!selectedPath && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Selecione um arquivo na árvore para começar.
                </div>
              )}
              {fileLoading && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {fileError && (
                <div className="m-4 flex items-start gap-2 rounded bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}
              {!fileLoading && !fileError && selectedPath && fileResult?.binary && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Arquivo binário não pode ser exibido ({formatBytes(fileResult.size)}).
                </div>
              )}
              {!fileLoading && !fileError && selectedPath && !fileResult?.binary && (
                <div className="h-full">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <MonacoEditor
                      height="100%"
                      language={editorLanguage}
                      value={editorValue}
                      theme="vs-dark"
                      options={{
                        readOnly: isReadOnlyEditor,
                        minimap: { enabled: false },
                        fontSize: 13,
                        wordWrap: "on",
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                      }}
                      onMount={(editor) => {
                        editorRef.current = editor;
                        // Se já há reveal pendente (caso o editor montou
                        // depois do file ter carregado), aplica imediatamente.
                        applyPendingReveal(selectedPath ?? undefined);
                      }}
                      onChange={(v) => {
                        const next = v ?? "";
                        setEditorValue(next);
                        triggerAutosave(next);
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </TabsContent>

            {/* History tab */}
            <TabsContent value="history" className="m-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">
                  <h3 className="mb-2 text-sm font-medium">Histórico de {selectedPath}</h3>
                  {historyQuery.isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                    </div>
                  )}
                  {historyQuery.data?.commits.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                      Nenhum commit toca este arquivo ainda.
                    </div>
                  )}
                  {/* Barra de comparação — exibe A/B selecionados e dispara o
                      diff. Aceita "HEAD" como atalho contra a versão atual. */}
                  {(historyQuery.data?.commits.length ?? 0) > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded border bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">Comparar:</span>
                      <span data-testid="text-compare-a">
                        A:{" "}
                        <span className="font-mono">
                          {compareA ? compareA.slice(0, 10) : "—"}
                        </span>
                      </span>
                      <span data-testid="text-compare-b">
                        B:{" "}
                        <span className="font-mono">
                          {compareB ? compareB.slice(0, 10) : "HEAD"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={!compareA || diffLoading}
                        onClick={runCompare}
                        data-testid="button-compare-go"
                      >
                        {diffLoading ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : null}
                        Comparar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCompareA(null);
                          setCompareB(null);
                          setDiffData(null);
                          setDiffError(null);
                        }}
                        data-testid="button-compare-clear"
                      >
                        Limpar
                      </Button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {historyQuery.data?.commits.map((c) => (
                      <div
                        key={c.sha}
                        className="rounded border p-3 text-sm"
                        data-testid={`history-${c.sha}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-mono text-xs text-muted-foreground">
                              {c.sha.slice(0, 10)} · {new Date(c.date).toLocaleString("pt-BR")}
                            </div>
                            <div className="mt-1">{c.message}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.authorName} &lt;{c.authorEmail}&gt;
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => loadFile(selectedPath!, c.sha)}
                              data-testid={`button-view-${c.sha}`}
                            >
                              <HistoryIcon className="mr-1 h-3 w-3" /> Ver
                            </Button>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant={compareA === c.sha ? "default" : "outline"}
                                onClick={() => setCompareA(c.sha)}
                                data-testid={`button-compare-a-${c.sha}`}
                                title="Marcar como versão A (base)"
                              >
                                A
                              </Button>
                              <Button
                                size="sm"
                                variant={compareB === c.sha ? "default" : "outline"}
                                onClick={() => setCompareB(c.sha)}
                                data-testid={`button-compare-b-${c.sha}`}
                                title="Marcar como versão B (alvo)"
                              >
                                B
                              </Button>
                            </div>
                            {canWrite && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  revertMutation.mutate({ path: selectedPath!, ref: c.sha })
                                }
                                disabled={revertMutation.isPending}
                                data-testid={`button-revert-${c.sha}`}
                              >
                                <RotateCcw className="mr-1 h-3 w-3" /> Reverter
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Painel de diff — renderiza o Monaco DiffEditor lado-a-lado
                      quando há resultado. Read-only por construção. */}
                  {diffError && (
                    <div className="mt-4 flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive" data-testid="text-diff-error">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{diffError}</span>
                    </div>
                  )}
                  {diffData && (
                    <div className="mt-4 rounded border" data-testid="panel-diff">
                      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
                        <span className="font-mono">
                          {diffData.path}
                        </span>
                        <span className="text-muted-foreground">
                          A:{" "}
                          <span className="font-mono">{diffData.ref1.slice(0, 10)}</span>
                          {"  →  "}
                          B:{" "}
                          <span className="font-mono">
                            {diffData.ref2 === "HEAD" ? "HEAD" : diffData.ref2.slice(0, 10)}
                          </span>
                        </span>
                      </div>
                      {diffData.binary ? (
                        <div className="p-4 text-sm text-muted-foreground">
                          Diff de arquivo binário não suportado.
                        </div>
                      ) : (
                        <div className="h-[400px]">
                          <Suspense
                            fallback={
                              <div className="flex h-full items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                              </div>
                            }
                          >
                            <MonacoDiffEditor
                              height="100%"
                              language={langForPath(diffData.path)}
                              original={diffData.left}
                              modified={diffData.right}
                              theme="vs-dark"
                              options={{
                                readOnly: true,
                                renderSideBySide: true,
                                minimap: { enabled: false },
                                fontSize: 13,
                                automaticLayout: true,
                                scrollBeyondLastLine: false,
                              }}
                            />
                          </Suspense>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Search tab */}
            <TabsContent value="search" className="m-0 flex-1 overflow-hidden">
              <div className="flex h-full flex-col">
                <div className="border-b p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label htmlFor="search-q" className="text-xs">
                        Buscar no repositório
                      </Label>
                      <Input
                        id="search-q"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && runSearch()}
                        placeholder="Termo ou padrão regex"
                        data-testid="input-search-query"
                      />
                    </div>
                    <div className="w-48">
                      <Label htmlFor="search-glob" className="text-xs">
                        Glob de path (opcional)
                      </Label>
                      <Input
                        id="search-glob"
                        value={searchPathGlob}
                        onChange={(e) => setSearchPathGlob(e.target.value)}
                        placeholder="**/*.ts"
                        data-testid="input-search-glob"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-1 text-xs">
                        <Checkbox
                          checked={searchRegex}
                          onCheckedChange={(v) => setSearchRegex(v === true)}
                          data-testid="checkbox-search-regex"
                        />
                        Regex
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <Checkbox
                          checked={searchCase}
                          onCheckedChange={(v) => setSearchCase(v === true)}
                          data-testid="checkbox-search-case"
                        />
                        Case
                      </label>
                    </div>
                    <Button
                      onClick={runSearch}
                      disabled={searchLoading || !searchQuery.trim()}
                      data-testid="button-search-go"
                    >
                      {searchLoading ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <SearchIcon className="mr-1 h-4 w-4" />
                      )}
                      Buscar
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-3">
                    {searchError && (
                      <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{searchError}</span>
                      </div>
                    )}
                    {searchResult && (
                      <div className="mb-3 text-xs text-muted-foreground" data-testid="text-search-meta">
                        {searchResult.hits.length} resultado(s)
                        {searchResult.truncated ? " (truncado)" : ""} em {searchResult.durationMs}ms
                      </div>
                    )}
                    {searchResult?.hits.map((h, i) => (
                      <button
                        key={`${h.path}:${h.line}:${i}`}
                        type="button"
                        className="block w-full rounded p-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          // Marca o reveal antes de trocar de arquivo: tanto
                          // o load (rAF) quanto o onMount do Monaco aplicam o
                          // que estiver pendente. Se já estamos no arquivo,
                          // só re-revela direto.
                          pendingRevealRef.current = {
                            path: h.path,
                            line: h.line,
                            column: h.column ?? 1,
                          };
                          setActiveTab("editor");
                          if (selectedPath === h.path) {
                            applyPendingReveal(h.path);
                          } else {
                            setSelectedPath(h.path);
                            loadFile(h.path);
                          }
                        }}
                        data-testid={`hit-${i}`}
                      >
                        <div className="font-mono text-xs text-primary">
                          {h.path}:{h.line}
                        </div>
                        <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                          {h.preview}
                        </pre>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>

            {/* Audit tab */}
            <TabsContent value="audit" className="m-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium">Últimas 50 ações no Code Explorer</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => auditQuery.refetch()}
                      data-testid="button-refresh-audit"
                    >
                      <RefreshCcw className="mr-1 h-3 w-3" /> Atualizar
                    </Button>
                  </div>
                  {auditQuery.isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                    </div>
                  )}
                  <div className="space-y-1">
                    {auditQuery.data?.items.map((item: any) => (
                      <div
                        key={item.id}
                        className="rounded border p-2 text-xs"
                        data-testid={`audit-${item.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {item.action}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(item.createdAt).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        {item.filePath && (
                          <div className="mt-1 font-mono text-xs">{item.filePath}</div>
                        )}
                        {item.sha && (
                          <div className="font-mono text-xs text-muted-foreground">
                            sha: {String(item.sha).slice(0, 10)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Save manual + reset bar (sempre visível p/ canWrite) */}
          {selectedPath && canWrite && !fileResult?.binary && (
            <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">
                {fileResult?.ref
                  ? "Visualizando commit histórico — edição desabilitada. Use 'Reverter' para restaurar."
                  : fileResult?.truncated
                    ? "Arquivo truncado — edição desabilitada."
                    : "Auto-save: 2s após parar de digitar."}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditorValue(originalValue);
                    setSaveState("idle");
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                  }}
                  disabled={editorValue === originalValue || isReadOnlyEditor}
                  data-testid="button-discard-changes"
                >
                  <RotateCcw className="mr-1 h-3 w-3" /> Descartar
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const seq = ++saveSeqRef.current;
                    saveMutation.mutate({ path: selectedPath, content: editorValue, seq });
                  }}
                  disabled={saveMutation.isPending || editorValue === originalValue || isReadOnlyEditor}
                  data-testid="button-save-now"
                >
                  <Save className="mr-1 h-3 w-3" /> Salvar agora
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
