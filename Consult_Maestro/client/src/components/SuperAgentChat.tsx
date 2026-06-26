import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getActiveTenantId } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot,
  Send,
  Loader2,
  User as UserIcon,
  Wrench,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  Folder,
  FileText,
  ListTodo,
  Sparkles,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  CheckCircle2,
  XCircle,
  Circle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SuperAgentSession {
  id: string;
  title: string;
  projectId: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}
interface SuperAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; input: any }> | null;
  toolResults?: Array<{ name: string; result: any }> | null;
  createdAt: string;
}
interface ProjectLite {
  id: string;
  name: string;
  clientId: string | null;
}
interface ClientLite {
  id: string;
  name: string;
  company?: string | null;
}
interface AgentDefinitionLite {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  tenantId: string | null;
  isActive: number;
}

type StreamStep =
  | { kind: "iteration"; iteration: number }
  | { kind: "tool_call"; name: string; input: any; ts: number }
  | { kind: "tool_result"; name: string; ok: boolean; summary: string; ts: number }
  | { kind: "final"; text: string }
  | { kind: "done"; assistantContent: string }
  | { kind: "error"; message: string };

export interface SuperAgentChatProps {
  /** If set, scopes the agent to this project (contextual mode). If null/undefined, global mode. */
  projectId?: string | null;
  /** Optional fixed height for the message area (e.g. "h-[60vh]" or "h-96"). */
  heightClass?: string;
  /** Hide the session sidebar (used in floating/embed compact modes). */
  compact?: boolean;
  /** When set (ex.: vindo do BI Builder), abre nova sessão já com o agente selecionado. */
  preselectAgentSlug?: string;
  /** Tipo de widget que originou a navegação (ex.: "waterfall_chart"), usado para sugerir prompt. */
  widgetContext?: string;
}

const LS_SIDEBAR = "super-agent.sidebar.collapsed";
const LS_TASKPANE = "super-agent.taskpane.expanded";

export function SuperAgentChat({ projectId, heightClass = "h-[60vh]", compact = false, preselectAgentSlug, widgetContext }: SuperAgentChatProps) {
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [streamSteps, setStreamSteps] = useState<StreamStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // UX preferences (full mode only)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LS_SIDEBAR) === "1";
  });
  const [taskPaneExpanded, setTaskPaneExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LS_TASKPANE) === "1";
  });
  useEffect(() => { localStorage.setItem(LS_SIDEBAR, sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem(LS_TASKPANE, taskPaneExpanded ? "1" : "0"); }, [taskPaneExpanded]);

  const sessionsKey = ["/api/super-agent/sessions", projectId ?? "global"] as const;
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<SuperAgentSession[]>({
    queryKey: sessionsKey,
    queryFn: async () => {
      const url = projectId
        ? `/api/super-agent/sessions?projectId=${encodeURIComponent(projectId)}`
        : "/api/super-agent/sessions";
      const r = await fetch(url, { credentials: "include" });
      return r.json();
    },
  });

  const { data: projects = [] } = useQuery<ProjectLite[]>({
    queryKey: ["/api/projects", "?scope=production"],
    enabled: !compact,
  });
  const { data: clientsList = [] } = useQuery<ClientLite[]>({
    queryKey: ["/api/clients"],
    enabled: !compact,
  });
  const { data: agentDefs = [] } = useQuery<AgentDefinitionLite[]>({
    queryKey: ["/api/agent-definitions"],
    enabled: !compact,
  });
  const activeAgents = useMemo(() => agentDefs.filter((a) => a.isActive === 1), [agentDefs]);

  // Pré-seleção de agente vindo do BI Builder (?agent=<slug>)
  const preselectDoneRef = useRef(false);
  useEffect(() => {
    if (!preselectAgentSlug || preselectDoneRef.current) return;
    if (!agentDefs.length) return;
    const target = agentDefs.find((a) => (a as any).slug === preselectAgentSlug);
    if (!target) return;
    preselectDoneRef.current = true;
    (async () => {
      try {
        const created: SuperAgentSession = await (
          await apiRequest("POST", "/api/super-agent/sessions", {
            projectId: projectId ?? null,
            title: `BI · ${target.name}`,
          })
        ).json();
        await apiRequest("PATCH", `/api/super-agent/sessions/${created.id}`, { agentId: target.id });
        setActiveSessionId(created.id);
        queryClient.invalidateQueries({ queryKey: sessionsKey });
        if (widgetContext) {
          setInput(
            `Contexto: estou analisando um widget do tipo "${widgetContext.replace(/_/g, " ")}" no BI Builder. ` +
            `Gere uma análise inicial usando suas competências.`,
          );
        }
        toast({ title: `Agente ${target.name} pronto`, description: "Sessão criada com o agente selecionado." });
      } catch (e: any) {
        preselectDoneRef.current = false;
        toast({ title: "Erro ao preparar agente", description: e?.message ?? String(e), variant: "destructive" });
      }
    })();
  }, [preselectAgentSlug, agentDefs, projectId, widgetContext]);

  const messagesKey = ["/api/super-agent/sessions", activeSessionId, "messages"] as const;
  const { data: messagesData, isLoading: messagesLoading } = useQuery<{ session: SuperAgentSession; messages: SuperAgentMessage[] }>({
    queryKey: messagesKey,
    queryFn: async () => {
      const r = await fetch(`/api/super-agent/sessions/${activeSessionId}/messages`, { credentials: "include" });
      return r.json();
    },
    enabled: !!activeSessionId,
  });
  const activeSession = messagesData?.session;

  useEffect(() => {
    if (activeSessionId) return;
    if (sessionsLoading) return;
    if (sessions.length > 0) setActiveSessionId(sessions[0].id);
  }, [sessions, sessionsLoading, activeSessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesData?.messages?.length, streamSteps.length]);

  // Reset stream when switching sessions
  useEffect(() => {
    abortRef.current?.abort();
    setStreamSteps([]);
    setStreaming(false);
  }, [activeSessionId]);

  const createSession = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/super-agent/sessions", { projectId: projectId ?? null });
      return r.json();
    },
    onSuccess: (s: SuperAgentSession) => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      setActiveSessionId(s.id);
    },
  });

  const patchSession = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<{ title: string; agentId: string | null }> }) => {
      const r = await apiRequest("PATCH", `/api/super-agent/sessions/${id}`, body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      queryClient.invalidateQueries({ queryKey: messagesKey });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const deleteSession = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/super-agent/sessions/${id}`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      if (activeSessionId === id) setActiveSessionId(null);
    },
  });

  // ──────────────── streaming send (SSE over POST) ────────────────
  async function runStream(text: string) {
    let sid = activeSessionId;
    if (!sid) {
      const created: SuperAgentSession = await (
        await apiRequest("POST", "/api/super-agent/sessions", { projectId: projectId ?? null })
      ).json();
      sid = created.id;
      setActiveSessionId(sid);
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreamSteps([]);
    setStreaming(true);
    setInput("");

    try {
      const streamHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const activeTid = getActiveTenantId();
      if (activeTid) streamHeaders["x-tenant-id"] = activeTid;
      const resp = await fetch(`/api/super-agent/sessions/${sid}/messages-stream`, {
        method: "POST",
        credentials: "include",
        headers: streamHeaders,
        body: JSON.stringify({ message: text }),
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = frame.split("\n");
          let event = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: any;
          try { data = JSON.parse(dataStr); } catch { continue; }
          if (event === "step") {
            const ts = Date.now();
            if (data.kind === "tool_call" || data.kind === "tool_result") {
              setStreamSteps((prev) => [...prev, { ...data, ts }]);
            } else {
              setStreamSteps((prev) => [...prev, data]);
            }
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast({ title: "Erro no streaming", description: e?.message ?? String(e), variant: "destructive" });
        setStreamSteps((prev) => [...prev, { kind: "error", message: e?.message ?? String(e) }]);
      }
    } finally {
      setStreaming(false);
      queryClient.invalidateQueries({ queryKey: ["/api/super-agent/sessions", sid, "messages"] });
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    }
  }

  function handleSend(textOverride?: string) {
    const txt = (textOverride ?? input).trim();
    if (!txt || streaming) return;
    runStream(txt);
  }

  // ────────────── COMPACT (Floating + Embed) — unchanged behavior ──────────────
  if (compact) {
    return (
      <div className="flex gap-3">
        <ChatPanel
          mode="compact"
          heightClass={heightClass}
          activeSessionId={activeSessionId}
          messagesData={messagesData}
          messagesLoading={messagesLoading}
          scrollRef={scrollRef}
          isPending={streaming}
          input={input}
          setInput={setInput}
          handleSend={handleSend}
          projectId={projectId}
          streamSteps={streamSteps}
        />
      </div>
    );
  }

  // ────────────── FULL (página /super-agente) ──────────────
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <SessionsSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        projects={projects}
        clients={clientsList}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        deleteSession={deleteSession}
        createSession={createSession}
        patchSession={patchSession}
        search={search}
        setSearch={setSearch}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {activeSession && (
          <ChatHeader
            session={activeSession}
            agents={activeAgents}
            onChangeAgent={(agentId) => patchSession.mutate({ id: activeSession.id, body: { agentId } })}
          />
        )}
        <ChatPanel
          heightClass="flex-1 min-h-0"
          activeSessionId={activeSessionId}
          messagesData={messagesData}
          messagesLoading={messagesLoading}
          scrollRef={scrollRef}
          isPending={streaming}
          input={input}
          setInput={setInput}
          handleSend={handleSend}
          projectId={projectId}
          streamSteps={streamSteps}
          agents={activeAgents}
          projects={projects}
        />
      </div>

      <TaskPane
        expanded={taskPaneExpanded}
        onToggleExpand={() => setTaskPaneExpanded((v) => !v)}
        steps={streamSteps}
        streaming={streaming}
        fallbackMessages={messagesData?.messages ?? []}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Sidebar (full mode) — supports collapsed (slim) mode
// ─────────────────────────────────────────────────────────────────────────────────────
function SessionsSidebar({
  collapsed,
  onToggleCollapse,
  sessions,
  sessionsLoading,
  projects,
  clients,
  activeSessionId,
  setActiveSessionId,
  deleteSession,
  createSession,
  patchSession,
  search,
  setSearch,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  sessions: SuperAgentSession[];
  sessionsLoading: boolean;
  projects: ProjectLite[];
  clients: ClientLite[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string) => void;
  deleteSession: { mutate: (id: string) => void };
  createSession: { mutate: () => void; isPending: boolean };
  patchSession: { mutate: (args: { id: string; body: { title: string } }) => void };
  search: string;
  setSearch: (v: string) => void;
}) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeClients = Array.isArray(clients) ? clients : [];
  const projectsById = useMemo(() => new Map(safeProjects.map((p) => [p.id, p])), [safeProjects]);
  const clientsById = useMemo(() => new Map(safeClients.map((c) => [c.id, c])), [safeClients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return safeSessions;
    return safeSessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [safeSessions, search]);

  const grouped = useMemo(() => {
    const general: SuperAgentSession[] = [];
    const byProject = new Map<string, SuperAgentSession[]>();
    for (const s of filtered) {
      if (!s.projectId) general.push(s);
      else {
        const arr = byProject.get(s.projectId) ?? [];
        arr.push(s);
        byProject.set(s.projectId, arr);
      }
    }
    const projectGroups = Array.from(byProject.entries()).map(([pid, list]) => {
      const proj = projectsById.get(pid);
      const cli = proj?.clientId ? clientsById.get(proj.clientId) : null;
      const projName = proj?.name ?? "Projeto removido";
      const cliLabel = cli ? cli.company || cli.name : null;
      return { pid, projName, cliLabel, list };
    });
    projectGroups.sort((a, b) => a.projName.localeCompare(b.projName));
    return { general, projectGroups };
  }, [filtered, projectsById, clientsById]);

  // Slim mode
  if (collapsed) {
    return (
      <div className="w-12 flex-shrink-0 border-r flex flex-col bg-muted/30">
        <div className="p-1 border-b flex flex-col items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onToggleCollapse}
            data-testid="button-sidebar-expand"
            title="Expandir sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            data-testid="button-new-session-slim"
            title="Nova conversa"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1 space-y-1">
            {safeSessions.slice(0, 30).map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={`w-10 h-10 rounded flex items-center justify-center hover:bg-accent ${activeSessionId === s.id ? "bg-accent" : ""}`}
                title={s.title}
                data-testid={`session-slim-${s.id}`}
              >
                <Bot className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="w-64 flex-shrink-0 border-r flex flex-col bg-muted/30">
      <div className="p-2 border-b space-y-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            data-testid="button-new-session"
          >
            <Sparkles className="h-3.5 w-3.5" /> Nova conversa
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0"
            onClick={onToggleCollapse}
            data-testid="button-sidebar-collapse"
            title="Recolher sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no histórico..."
            className="h-8 text-xs pl-7"
            data-testid="input-search-sessions"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {sessionsLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">{search ? "Nada encontrado." : "Sem conversas ainda."}</p>
          ) : (
            <>
              {grouped.general.length > 0 && (
                <SessionGroup
                  label="Geral"
                  subtitle="Conversas sem projeto"
                  icon={Sparkles}
                  sessions={grouped.general}
                  activeSessionId={activeSessionId}
                  setActiveSessionId={setActiveSessionId}
                  deleteSession={deleteSession}
                  patchSession={patchSession}
                  defaultOpen
                />
              )}
              {grouped.projectGroups.map((g) => (
                <SessionGroup
                  key={g.pid}
                  label={g.projName}
                  subtitle={g.cliLabel ?? undefined}
                  icon={FolderOpen}
                  sessions={g.list}
                  activeSessionId={activeSessionId}
                  setActiveSessionId={setActiveSessionId}
                  deleteSession={deleteSession}
                  patchSession={patchSession}
                  defaultOpen
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1">
            <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
            <Paperclip className="h-3 w-3" />
            Arquivos
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 pl-5 pr-1">
            <p className="text-[11px] text-muted-foreground italic">Upload de arquivos chega na próxima fase.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function SessionGroup({
  label,
  subtitle,
  icon: Icon,
  sessions,
  activeSessionId,
  setActiveSessionId,
  deleteSession,
  patchSession,
  defaultOpen = true,
}: {
  label: string;
  subtitle?: string;
  icon: typeof FolderOpen;
  sessions: SuperAgentSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string) => void;
  deleteSession: { mutate: (id: string) => void };
  patchSession: { mutate: (args: { id: string; body: { title: string } }) => void };
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startRename(e: React.MouseEvent, s: SuperAgentSession) {
    e.stopPropagation();
    setEditingId(s.id);
    setDraft(s.title);
  }
  function commitRename(id: string) {
    const title = draft.trim();
    if (title.length > 0) patchSession.mutate({ id, body: { title } });
    setEditingId(null);
    setDraft("");
  }
  function cancelRename() {
    setEditingId(null);
    setDraft("");
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-start gap-1.5 w-full text-left py-1 group" data-testid={`group-trigger-${label}`}>
        {open ? (
          <ChevronDown className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
        )}
        {open ? <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" /> : <Folder className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{label}</div>
          {subtitle && <div className="text-[10px] text-muted-foreground truncate">{subtitle}</div>}
        </div>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{sessions.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5 pt-1 space-y-0.5">
        {sessions.map((s) =>
          editingId === s.id ? (
            <div
              key={s.id}
              className="flex items-center gap-1 rounded px-2 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(s.id);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                className="h-6 text-xs px-1.5 flex-1"
                data-testid={`input-rename-session-${s.id}`}
              />
              <Check
                className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer text-green-600 hover:text-green-700"
                onClick={() => commitRename(s.id)}
                data-testid={`button-confirm-rename-${s.id}`}
              />
              <X
                className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={cancelRename}
                data-testid={`button-cancel-rename-${s.id}`}
              />
            </div>
          ) : (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded px-2 py-1 text-xs cursor-pointer hover:bg-accent ${activeSessionId === s.id ? "bg-background border-l-2 border-primary" : ""}`}
              onClick={() => setActiveSessionId(s.id)}
              data-testid={`session-item-${s.id}`}
            >
              <Bot className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{s.title}</span>
              <Pencil
                className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-primary flex-shrink-0"
                onClick={(e) => startRename(e, s)}
                data-testid={`button-rename-session-${s.id}`}
              />
              <Trash2
                className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Apagar conversa?")) deleteSession.mutate(s.id);
                }}
                data-testid={`button-delete-session-${s.id}`}
              />
            </div>
          ),
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Chat header (full mode) — agent picker
// ─────────────────────────────────────────────────────────────────────────────────────
function ChatHeader({
  session,
  agents,
  onChangeAgent,
}: {
  session: SuperAgentSession;
  agents: AgentDefinitionLite[];
  onChangeAgent: (agentId: string | null) => void;
}) {
  const value = session.agentId ?? "__general__";
  const current = agents.find((a) => a.id === session.agentId);
  return (
    <div className="flex items-center gap-3 border-b px-4 py-2.5 bg-background flex-shrink-0" data-testid="chat-header">
      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        {current ? <Bot className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{session.title}</div>
        {current && <div className="text-[11px] text-muted-foreground truncate">{current.name}</div>}
      </div>
      <Select value={value} onValueChange={(v) => onChangeAgent(v === "__general__" ? null : v)}>
        <SelectTrigger className="h-7 text-xs w-[180px] border-dashed" data-testid="select-agent">
          <SelectValue placeholder="Agente" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__general__">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Super Agente Geral
            </span>
          </SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id} data-testid={`option-agent-${a.id}`}>
              <span className="flex items-center gap-1.5">
                <Bot className="h-3 w-3" /> {a.name}
                {a.tenantId === null && <Badge variant="outline" className="text-[9px] h-3.5 px-1">global</Badge>}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Center: chat panel (shared compact + full)
// ─────────────────────────────────────────────────────────────────────────────────────
function ChatPanel({
  heightClass,
  activeSessionId,
  messagesData,
  messagesLoading,
  scrollRef,
  isPending,
  input,
  setInput,
  handleSend,
  projectId,
  streamSteps,
  agents,
  projects,
  mode = "full",
}: {
  heightClass: string;
  activeSessionId: string | null;
  messagesData?: { session: SuperAgentSession; messages: SuperAgentMessage[] };
  messagesLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  isPending: boolean;
  input: string;
  setInput: (v: string) => void;
  handleSend: (textOverride?: string) => void;
  projectId?: string | null;
  streamSteps: StreamStep[];
  agents?: AgentDefinitionLite[];
  projects?: ProjectLite[];
  mode?: "full" | "compact";
}) {
  // While streaming, show "thinking" with the latest step summary inline
  const lastStep = streamSteps[streamSteps.length - 1];
  let liveLine: string | null = null;
  if (isPending) {
    if (!lastStep) liveLine = "Pensando...";
    else if (lastStep.kind === "iteration") liveLine = `Pensando (iteração ${lastStep.iteration})...`;
    else if (lastStep.kind === "tool_call") liveLine = `Executando ${lastStep.name}...`;
    else if (lastStep.kind === "tool_result") liveLine = `${lastStep.name} → ${lastStep.summary}`;
    else if (lastStep.kind === "final") liveLine = "Finalizando resposta...";
    else liveLine = "Pensando...";
  }

  const containerClass =
    mode === "compact"
      ? `flex flex-col min-w-0 border rounded-md ${heightClass} bg-card`
      : `flex flex-col min-w-0 ${heightClass} bg-background`;

  // Welcome screen — full mode only, when there is no active session
  if (mode !== "compact" && !activeSessionId) {
    return (
      <div className={containerClass}>
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center gap-8 px-6 py-12">
            <div className="text-center space-y-2">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold">O que posso fazer por você?</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Consulte projetos, analise dados, execute tarefas em sistemas externos e muito mais.
              </p>
            </div>

            <div className="w-full max-w-2xl">
              <WelcomeInput
                input={input}
                setInput={setInput}
                handleSend={handleSend}
                isPending={isPending}
                agents={agents ?? []}
                projects={projects ?? []}
              />
            </div>

            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {[
                "Quais projetos estão com prazo vencido?",
                "Analise o pipeline de clientes",
                "Quais NF-e estão pendentes?",
                "Gere um relatório do mês",
              ].map((suggestion, i) => (
                <button
                  key={suggestion}
                  onClick={() => handleSend(suggestion)}
                  disabled={isPending}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed hover:border-primary hover:text-primary transition-colors text-muted-foreground disabled:opacity-50"
                  data-testid={`button-suggestion-${i}`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3" ref={scrollRef}>
        {!activeSessionId ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Comece uma conversa.</p>
            {projectId && <p className="text-xs mt-1">Escopo: este projeto.</p>}
          </div>
        ) : messagesLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (messagesData?.messages ?? []).length === 0 && !isPending ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Faça sua primeira pergunta.</p>
            <p className="text-xs mt-2">Ex: "Quais demandas estão em proposta enviada?"</p>
          </div>
        ) : (
          (messagesData?.messages ?? []).map((m) => <MessageBubble key={m.id} m={m} projectId={projectId ?? null} />)
        )}
        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-live-status">
            <Loader2 className="h-3 w-3 animate-spin" /> {liveLine}
          </div>
        )}
      </div>

      {activeSessionId && <SessionFiles sessionId={activeSessionId} />}

      {mode === "compact" ? (
        <div className="border-t p-2 flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={projectId ? "Pergunte sobre este projeto..." : "Pergunte sobre seus projetos, clientes, ERP..."}
            className="min-h-[44px] max-h-32 resize-none text-sm"
            disabled={isPending}
            data-testid="textarea-super-agent-input"
          />
          <Button onClick={() => handleSend()} disabled={isPending || !input.trim()} data-testid="button-super-agent-send">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        <div className="border-t p-3">
          <div className="border rounded-xl bg-background overflow-hidden">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={projectId ? "Pergunte sobre este projeto..." : "Pergunte sobre seus projetos, clientes, ERP..."}
              className="min-h-[52px] max-h-36 resize-none border-0 rounded-none focus-visible:ring-0 text-sm px-4 pt-3"
              disabled={isPending}
              data-testid="textarea-super-agent-input"
            />
            <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/20">
              <span className="text-[10px] text-muted-foreground">Enter para enviar · Shift+Enter para nova linha</span>
              <div className="flex-1" />
              <Button
                size="sm"
                className="h-7 w-7 rounded-full p-0"
                onClick={() => handleSend()}
                disabled={isPending || !input.trim()}
                data-testid="button-super-agent-send"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Welcome input (full mode) — large textarea + context shortcuts
// ─────────────────────────────────────────────────────────────────────────────────────
function WelcomeInput({
  input,
  setInput,
  handleSend,
  isPending,
  agents,
  projects,
}: {
  input: string;
  setInput: (v: string) => void;
  handleSend: (textOverride?: string) => void;
  isPending: boolean;
  agents: AgentDefinitionLite[];
  projects: ProjectLite[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [showProjects, setShowProjects] = useState(false);

  function appendContext(tag: string) {
    setInput(input + (input ? " " : "") + tag);
  }

  return (
    <div className="border rounded-2xl bg-background shadow-sm overflow-hidden">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Atribua uma tarefa ou pergunte qualquer coisa..."
        className="min-h-[80px] max-h-48 resize-none border-0 rounded-none focus-visible:ring-0 text-sm px-4 pt-4"
        disabled={isPending}
        data-testid="textarea-super-agent-input"
      />
      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivo"
          data-testid="button-welcome-attach"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.csv,.txt,.md" />

        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => {
              setShowAgents((v) => !v);
              setShowProjects(false);
            }}
            data-testid="button-welcome-agents"
          >
            <Bot className="h-3.5 w-3.5" />
            Agente
          </Button>
          {showAgents && agents.length > 0 && (
            <div className="absolute bottom-10 left-0 z-50 w-56 bg-background border rounded-lg shadow-lg p-1">
              <div className="text-[10px] text-muted-foreground px-2 py-1 font-medium uppercase tracking-wide">Selecionar agente</div>
              {agents.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    appendContext(`[Agente: ${a.name}]`);
                    setShowAgents(false);
                  }}
                  data-testid={`option-welcome-agent-${a.id}`}
                >
                  <Bot className="h-3 w-3 text-muted-foreground" /> {a.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => {
              setShowProjects((v) => !v);
              setShowAgents(false);
            }}
            data-testid="button-welcome-projects"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Projeto
          </Button>
          {showProjects && projects.length > 0 && (
            <div className="absolute bottom-10 left-0 z-50 w-64 bg-background border rounded-lg shadow-lg p-1">
              <div className="text-[10px] text-muted-foreground px-2 py-1 font-medium uppercase tracking-wide">Adicionar contexto</div>
              {projects.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    appendContext(`[Projeto: ${p.name}]`);
                    setShowProjects(false);
                  }}
                  data-testid={`option-welcome-project-${p.id}`}
                >
                  <FolderOpen className="h-3 w-3 text-muted-foreground" /> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        <Button
          size="sm"
          className="h-8 w-8 rounded-full p-0"
          onClick={() => handleSend()}
          disabled={isPending || !input.trim()}
          data-testid="button-super-agent-send"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Session files: upload + list (Fase 3)
// ─────────────────────────────────────────────────────────────────────────────────────
interface SessionFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: "ok" | "empty" | "failed" | "too_large";
  errorMessage: string | null;
  createdAt: string;
}

function formatBytes(n: number | null): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function SessionFiles({ sessionId }: { sessionId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesKey = ["/api/super-agent/sessions", sessionId, "files"];
  const { data: files = [], isLoading } = useQuery<SessionFile[]>({ queryKey: filesKey });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/super-agent/sessions/${sessionId}/files`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Upload falhou (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: filesKey });
      if (r?.warning) toast({ title: "Arquivo anexado", description: r.warning });
      else toast({ title: "Arquivo anexado", description: "Conteúdo será usado como contexto da conversa." });
    },
    onError: (e: any) => toast({ title: "Falha no upload", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/super-agent/files/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKey });
    },
    onError: (e: any) => toast({ title: "Falha ao remover", description: e.message, variant: "destructive" }),
  });

  const handlePick = () => fileInputRef.current?.click();
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    for (const f of Array.from(list)) {
      try { await upload.mutateAsync(f); } catch {}
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const list = e.dataTransfer?.files;
    if (!list) return;
    for (const f of Array.from(list)) {
      try { await upload.mutateAsync(f); } catch {}
    }
  };

  return (
    <div
      className="border-t bg-muted/30"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-testid="section-session-files"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json"
        onChange={handleChange}
        data-testid="input-file-upload"
      />
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          <span>
            {isLoading ? "Carregando..." : files.length === 0 ? "Anexe arquivos (PDF, DOCX, XLSX, CSV, TXT)" : `${files.length} arquivo(s) anexado(s)`}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={handlePick}
          disabled={upload.isPending}
          data-testid="button-attach-file"
        >
          {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
          Anexar
        </Button>
      </div>
      {files.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-1.5 bg-background border rounded-md pl-2 pr-1 py-0.5 text-xs"
              data-testid={`chip-file-${f.id}`}
              title={f.errorMessage || f.filename}
            >
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[160px] truncate" data-testid={`text-filename-${f.id}`}>{f.filename}</span>
              <span className="text-muted-foreground">· {formatBytes(f.sizeBytes)}</span>
              {f.status === "failed" && <Badge variant="destructive" className="h-4 px-1 text-[10px]">erro</Badge>}
              {f.status === "empty" && <Badge variant="secondary" className="h-4 px-1 text-[10px]">vazio</Badge>}
              <button
                type="button"
                className="ml-1 hover:bg-muted rounded p-0.5"
                onClick={() => remove.mutate(f.id)}
                disabled={remove.isPending}
                data-testid={`button-remove-file-${f.id}`}
              >
                <XCircle className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Right pane: live steps + artefact placeholder. Expandable.
// ─────────────────────────────────────────────────────────────────────────────────────
function TaskPane({
  expanded,
  onToggleExpand,
  steps,
  streaming,
  fallbackMessages,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  steps: StreamStep[];
  streaming: boolean;
  fallbackMessages: SuperAgentMessage[];
}) {
  // Live steps take priority during execution; otherwise fall back to last assistant's tool calls
  const liveStepEntries = steps.filter((s) => s.kind === "tool_call" || s.kind === "tool_result");
  const showLive = streaming || liveStepEntries.length > 0;

  const lastAssistant = [...fallbackMessages].reverse().find((m) => m.role === "assistant");
  const fallbackTools = (lastAssistant?.toolCalls ?? []).map((t) => t.name);

  const widthClass = expanded ? "w-[28rem]" : "w-72";
  const textBase = expanded ? "text-sm" : "text-xs";

  return (
    <div className={`hidden lg:flex ${widthClass} flex-shrink-0 border-l flex-col bg-muted/20 transition-[width] duration-200`}>
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-primary" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Execução ao vivo</h3>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 flex-shrink-0"
          onClick={onToggleExpand}
          data-testid="button-taskpane-toggle"
          title={expanded ? "Recolher painel" : "Expandir painel"}
        >
          {expanded ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Passos</h4>
            {showLive ? (
              <ul className="space-y-1.5" data-testid="list-live-steps">
                {renderLiveSteps(steps, streaming, textBase)}
              </ul>
            ) : fallbackTools.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                Nenhum passo ainda. Envie uma mensagem para ver a execução ao vivo.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {fallbackTools.map((name, i) => (
                  <li key={i} className={`flex items-center gap-2 ${textBase}`}>
                    <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                    <span className="font-mono">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Artefatos</h4>
            <p className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Cards de projetos/tasks/documentos criados aparecem aqui.
            </p>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function renderLiveSteps(steps: StreamStep[], streaming: boolean, textClass: string) {
  // Pair tool_call with subsequent tool_result of same name (best-effort sequential)
  const out: JSX.Element[] = [];
  const pendingByName = new Map<string, number>(); // name -> index in `out` of pending row
  let key = 0;
  for (const ev of steps) {
    if (ev.kind === "tool_call") {
      const idx = out.length;
      pendingByName.set(ev.name, idx);
      out.push(
        <li key={key++} className={`flex items-start gap-2 ${textClass}`}>
          <Loader2 className="h-3 w-3 animate-spin text-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-mono">{ev.name}</span>
            <span className="text-muted-foreground"> em execução...</span>
          </div>
        </li>,
      );
    } else if (ev.kind === "tool_result") {
      const idx = pendingByName.get(ev.name);
      const Icon = ev.ok ? CheckCircle2 : XCircle;
      const color = ev.ok ? "text-green-600" : "text-destructive";
      const node = (
        <li key={key++} className={`flex items-start gap-2 ${textClass}`}>
          <Icon className={`h-3 w-3 ${color} flex-shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <span className="font-mono">{ev.name}</span>
            <span className="text-muted-foreground"> → {ev.summary}</span>
          </div>
        </li>
      );
      if (idx !== undefined) {
        out[idx] = node;
        pendingByName.delete(ev.name);
      } else {
        out.push(node);
      }
    } else if (ev.kind === "error") {
      out.push(
        <li key={key++} className={`flex items-start gap-2 ${textClass}`}>
          <XCircle className="h-3 w-3 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-destructive">{ev.message}</span>
          </div>
        </li>,
      );
    }
  }
  if (streaming && out.length === 0) {
    out.push(
      <li key={key++} className={`flex items-start gap-2 ${textClass}`}>
        <Circle className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5 animate-pulse" />
        <span className="text-muted-foreground">Aguardando primeira ação...</span>
      </li>,
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────────────
// scrum-plan: parser do bloco ```scrum-plan``` e card de aprovação
// ─────────────────────────────────────────────────────────────────────────────────────

interface ScrumPlanData {
  subprojetos: Array<{
    nome?: string;
    dataInicio?: string | null;
    dataFim?: string | null;
    sprints?: Array<{
      nome?: string;
      dataInicio?: string | null;
      dataFim?: string | null;
      pbis?: any[];
      tasks?: any[];
    }>;
  }>;
  reunioes?: any[];
  resumo?: any;
}

interface ParsedScrumPlan {
  before: string;
  after: string;
  raw: string;
  plan: ScrumPlanData;
}

function parseScrumPlan(content: string): ParsedScrumPlan | null {
  const re = /```scrum-plan\s*\n([\s\S]*?)\n?```/i;
  const m = content.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  try {
    const plan = JSON.parse(raw) as ScrumPlanData;
    if (!plan || !Array.isArray(plan.subprojetos) || plan.subprojetos.length === 0) return null;
    const idx = m.index ?? 0;
    return {
      before: content.slice(0, idx).trim(),
      after: content.slice(idx + m[0].length).trim(),
      raw,
      plan,
    };
  } catch {
    return null;
  }
}

function summarizePlan(plan: ScrumPlanData) {
  let totalSprints = 0;
  let totalPbis = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const consider = (d: string | null | undefined) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  };
  for (const sp of plan.subprojetos || []) {
    consider(sp.dataInicio); consider(sp.dataFim);
    for (const sprint of sp.sprints || []) {
      totalSprints++;
      consider(sprint.dataInicio); consider(sprint.dataFim);
      const items = (sprint.pbis?.length ?? 0) + (sprint.tasks?.length ?? 0);
      totalPbis += items;
    }
  }
  const fmt = (d: string | null) => {
    if (!d) return null;
    const [y, mo, da] = d.split("-");
    return `${da}/${mo}/${y}`;
  };
  return {
    totalSubprojetos: plan.subprojetos?.length ?? 0,
    totalSprints,
    totalPbis,
    totalReunioes: plan.reunioes?.length ?? 0,
    periodo: minDate && maxDate ? `${fmt(minDate)} → ${fmt(maxDate)}` : null,
  };
}

function ScrumPlanCard({ plan, projectId }: { plan: ScrumPlanData; projectId: string }) {
  const { toast } = useToast();
  const [showDetails, setShowDetails] = useState(false);
  const [applied, setApplied] = useState<{ subprojetos: number; sprints: number; pbis: number; reunioes: number } | null>(null);
  const summary = useMemo(() => summarizePlan(plan), [plan]);

  const apply = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/projects/${projectId}/apply-plan`, { plan });
      return r.json();
    },
    onSuccess: (r: any) => {
      const c = r?.counts || r || {};
      setApplied({
        subprojetos: Number(c.subprojetosCriados ?? c.subprojetos ?? c.subprojects ?? 0),
        sprints: Number(c.sprintsCriados ?? c.sprints ?? 0),
        pbis: Number(c.pbisCriados ?? c.tasksCriadas ?? c.pbis ?? c.tasks ?? 0),
        reunioes: Number(c.eventosCriados ?? c.reunioes ?? c.events ?? 0),
      });
      toast({ title: "Projeto criado", description: "Estrutura aplicada com sucesso." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "subprojects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pbis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (e: any) => {
      toast({ title: "Falha ao criar projeto", description: e?.message || String(e), variant: "destructive" });
    },
  });

  if (applied) {
    return (
      <div className="mt-2 border rounded-lg p-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" data-testid={`scrum-plan-applied`}>
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          Projeto criado a partir do plano
        </div>
        <div className="text-xs mt-1 text-emerald-700 dark:text-emerald-300">
          {applied.subprojetos} subprojeto(s) · {applied.sprints} sprint(s) · {applied.pbis} PBI(s){applied.reunioes ? ` · ${applied.reunioes} reunião(ões)` : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 border rounded-lg p-3 bg-card" data-testid="scrum-plan-card">
      <div className="flex items-start gap-2">
        <ListTodo className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Estrutura proposta pelo agente</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {summary.totalSubprojetos} subprojeto(s) · {summary.totalSprints} sprint(s) · {summary.totalPbis} PBI(s)
            {summary.totalReunioes ? ` · ${summary.totalReunioes} reunião(ões)` : ""}
          </div>
          {summary.periodo && (
            <div className="text-xs text-muted-foreground mt-0.5">Período: {summary.periodo}</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowDetails((v) => !v)}
          data-testid="button-scrum-plan-details"
        >
          {showDetails ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
          Ver detalhes
        </Button>
        <Button
          size="sm"
          onClick={() => apply.mutate()}
          disabled={apply.isPending}
          data-testid="button-scrum-plan-apply"
        >
          {apply.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
          Criar projeto completo
        </Button>
      </div>
      {showDetails && (
        <div className="mt-3 border-t pt-2 space-y-2 text-xs">
          {plan.subprojetos.map((sp, i) => {
            const sprintCount = sp.sprints?.length ?? 0;
            const pbiCount = (sp.sprints || []).reduce(
              (n, s) => n + (s.pbis?.length ?? 0) + (s.tasks?.length ?? 0),
              0,
            );
            return (
              <div key={i} className="rounded border p-2 bg-background" data-testid={`scrum-plan-subproject-${i}`}>
                <div className="font-medium">{sp.nome || `Subprojeto ${i + 1}`}</div>
                <div className="text-muted-foreground">
                  {sprintCount} sprint(s) · {pbiCount} PBI(s)
                  {sp.dataInicio && sp.dataFim ? ` · ${sp.dataInicio} → ${sp.dataFim}` : ""}
                </div>
                {sp.sprints && sp.sprints.length > 0 && (
                  <ul className="mt-1 ml-3 list-disc space-y-0.5 text-muted-foreground">
                    {sp.sprints.map((s, si) => (
                      <li key={si}>
                        {s.nome || `Sprint ${si + 1}`} — {(s.pbis?.length ?? 0) + (s.tasks?.length ?? 0)} PBI(s)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ m, projectId }: { m: SuperAgentMessage; projectId: string | null }) {
  const isUser = m.role === "user";
  const parsed = !isUser && projectId ? parseScrumPlan(m.content) : null;
  const visibleText = parsed ? [parsed.before, parsed.after].filter(Boolean).join("\n\n") : m.content;

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.role}-${m.id}`}>
      {!isUser && (
        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
        {m.toolCalls && m.toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {m.toolCalls.map((t, i) => (
              <Badge key={i} variant="outline" className="text-[10px] gap-1">
                <Wrench className="h-2.5 w-2.5" />
                {t.name}
              </Badge>
            ))}
          </div>
        )}
        {visibleText && <div className="whitespace-pre-wrap leading-relaxed text-sm">{visibleText}</div>}
        {parsed && projectId && <ScrumPlanCard plan={parsed.plan} projectId={projectId} />}
      </div>
      {isUser && (
        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
