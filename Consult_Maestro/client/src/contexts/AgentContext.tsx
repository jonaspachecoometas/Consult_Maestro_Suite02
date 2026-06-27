import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { apiRequest } from "@/lib/queryClient";

export type AgentPanelState = "closed" | "open" | "minimized";

interface AgentContextValue {
  /** ID da sessão global ativa (null enquanto não criada) */
  sessionId: string | null;
  /** Controla o painel flutuante */
  panelState: AgentPanelState;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  minimizePanel: () => void;
  /** Mensagem pré-carregada para abrir o painel com contexto */
  preloadedMessage: string | null;
  openWithMessage: (msg: string) => void;
  clearPreloaded: () => void;
  /** Inicializa (ou reutiliza) a sessão global */
  ensureSession: () => Promise<string>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentContextProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [panelState, setPanelState] = useState<AgentPanelState>("closed");
  const [preloadedMessage, setPreloadedMessage] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    if (creatingRef.current) {
      // Aguarda até que outra chamada simultânea termine
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!creatingRef.current) { clearInterval(interval); resolve(); }
        }, 100);
      });
      if (sessionId) return sessionId!;
    }
    creatingRef.current = true;
    try {
      const list = await fetch("/api/super-agent/sessions", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      const existing = (list as any[]).find((s: any) => !s.projectId);
      if (existing?.id) {
        setSessionId(existing.id);
        return existing.id;
      }
      const created = await apiRequest("POST", "/api/super-agent/sessions", { projectId: null }).then((r) => r.json());
      setSessionId(created.id);
      return created.id;
    } finally {
      creatingRef.current = false;
    }
  }, [sessionId]);

  const openPanel = useCallback(() => setPanelState("open"), []);
  const closePanel = useCallback(() => setPanelState("closed"), []);
  const togglePanel = useCallback(() =>
    setPanelState((s) => (s === "open" ? "closed" : "open")), []);
  const minimizePanel = useCallback(() => setPanelState("minimized"), []);

  const openWithMessage = useCallback((msg: string) => {
    setPreloadedMessage(msg);
    setPanelState("open");
  }, []);

  const clearPreloaded = useCallback(() => setPreloadedMessage(null), []);

  return (
    <AgentContext.Provider
      value={{
        sessionId,
        panelState,
        openPanel,
        closePanel,
        togglePanel,
        minimizePanel,
        preloadedMessage,
        openWithMessage,
        clearPreloaded,
        ensureSession,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentContext deve ser usado dentro de AgentContextProvider");
  return ctx;
}
