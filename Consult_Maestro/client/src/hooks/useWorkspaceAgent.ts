// Sprint IDE-3 — Hook do agente IA para o Workspace IDE.
//
// Diferente de useModuleAgent (que dispara INIT_MODULE 1× por sessão), este
// hook expõe APIs de baixo nível p/ o AIPanel:
//   - ensureSession(): garante uma sessão global ativa
//   - sendQuickAction(prompt, ctx): envia uma quick action ao SuperAgent
//   - fireInitOnce(filePath?): dispara __INIT_MODULE__:workspace 1× por sessão
//   - getSessionId(): id da sessão atual (p/ embedar em SuperAgentChat)
//
// O AIPanel re-renderiza um SuperAgentChat com a sessão criada, então
// quick actions caem no histórico real e podem ser continuadas no chat.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface SuperAgentSessionLite {
  id: string;
  title?: string | null;
  projectId?: string | null;
}

const STORAGE_PREFIX = "workspace-agent-init";

async function ensureGlobalSession(): Promise<string> {
  const list = await fetch("/api/super-agent/sessions", { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<SuperAgentSessionLite[]>) : Promise.resolve([])))
    .catch(() => [] as SuperAgentSessionLite[]);
  const existing = list.find((s) => !s.projectId);
  if (existing?.id) return existing.id;
  const created: SuperAgentSessionLite = await (
    await apiRequest("POST", "/api/super-agent/sessions", { projectId: null })
  ).json();
  return created.id;
}

export interface WorkspaceAgentApi {
  sessionId: string | null;
  status: "idle" | "loading" | "sending" | "error";
  error: string | null;
  ensureSession: () => Promise<string>;
  fireInitOnce: (filePath?: string | null) => Promise<void>;
  sendQuickAction: (prompt: string, opts?: { filePath?: string | null; selection?: string }) => Promise<void>;
}

export function useWorkspaceAgent(): WorkspaceAgentApi {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkspaceAgentApi["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    setStatus("loading");
    try {
      const sid = await ensureGlobalSession();
      setSessionId(sid);
      setStatus("idle");
      return sid;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus("error");
      throw e;
    }
  }, [sessionId]);

  // Auto-cria sessão na montagem (p/ que SuperAgentChat embed renderize já).
  useEffect(() => {
    ensureSession().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fireInitOnce = useCallback(async (filePath?: string | null) => {
    if (inFlightRef.current) return;
    const sid = await ensureSession();
    const key = `${STORAGE_PREFIX}:${sid}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(key)) return;
    inFlightRef.current = true;
    try {
      const ctx = filePath ? { filePath } : undefined;
      const ctxStr = ctx ? ` ${JSON.stringify(ctx)}` : "";
      await apiRequest("POST", `/api/super-agent/sessions/${sid}/messages`, {
        message: `__INIT_MODULE__:workspace${ctxStr}`,
      });
      if (typeof window !== "undefined") sessionStorage.setItem(key, "1");
      // Invalida cache do chat embedded p/ ele rebuscar mensagens.
      queryClient.invalidateQueries({ queryKey: ["/api/super-agent/sessions", sid, "messages"] });
    } finally {
      inFlightRef.current = false;
    }
  }, [ensureSession]);

  const sendQuickAction = useCallback(async (
    prompt: string,
    opts?: { filePath?: string | null; selection?: string },
  ) => {
    const sid = await ensureSession();
    setStatus("sending");
    try {
      const parts: string[] = [prompt];
      if (opts?.filePath) parts.push(`\n\n_Arquivo: \`${opts.filePath}\`_`);
      if (opts?.selection && opts.selection.trim().length > 0) {
        const trimmed = opts.selection.length > 4000
          ? opts.selection.slice(0, 4000) + "\n…(truncado)"
          : opts.selection;
        parts.push(`\n\nTrecho:\n\`\`\`\n${trimmed}\n\`\`\``);
      }
      await apiRequest("POST", `/api/super-agent/sessions/${sid}/messages`, {
        message: parts.join(""),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/super-agent/sessions", sid, "messages"] });
      setStatus("idle");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus("error");
    }
  }, [ensureSession]);

  return { sessionId, status, error, ensureSession, fireInitOnce, sendQuickAction };
}
