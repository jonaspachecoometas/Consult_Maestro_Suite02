/**
 * useModuleAgent — MCP Hub Sprint 2
 *
 * When a module page mounts (Control, Societário, Recovery, Production…)
 * this hook ensures there is an active Super Agent session for the user
 * and fires a one-shot proactive `__INIT_MODULE__:<module>` message.
 *
 * Behaviour:
 *   - Creates or reuses the most recent global super-agent session
 *     (projectId=null) for this user.
 *   - The INIT_MODULE message is sent at most ONCE per (module, session.id)
 *     pair within the lifetime of the page tab — we cache the marker in
 *     `sessionStorage` so re-mounts (route changes, HMR) don't re-fire it.
 *     **Context changes do NOT re-fire** the auto-INIT (architectural rule
 *     "INIT_MODULE só dispara 1× por sessão"). To re-run the analysis with
 *     a different context, the caller must invoke `run(true)` explicitly
 *     (e.g. wired to a "Reanalisar" button).
 *   - The proactive analysis arrives back as a normal assistant message
 *     persisted server-side, so any open SuperAgentChat will pick it up
 *     via its existing query invalidation.
 *
 * Exposes `{ sessionId, status, error, run, reset }` so a page can also
 * trigger the analysis on demand (e.g. a "Reanalisar" button).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export type ModuleAgentStatus = "idle" | "creating-session" | "running" | "done" | "error";

interface SuperAgentSessionLite {
  id: string;
  title?: string | null;
  projectId?: string | null;
}

const STORAGE_PREFIX = "module-agent-init";
function storageKey(module: string, sessionId: string): string {
  return `${STORAGE_PREFIX}:${module}:${sessionId}`;
}

async function ensureGlobalSession(): Promise<string> {
  // Try latest global session first.
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

export interface UseModuleAgentOptions {
  /** When false, the hook does nothing (e.g. if the user disabled the agent). Default: true. */
  enabled?: boolean;
  /** Optional callback invoked with the assistant final text when the analysis completes. */
  onResponse?: (text: string) => void;
}

/**
 * Free-form context that pages can pipe into the proactive analysis
 * (e.g. selected client, current filter, pipeline stage). It is appended to
 * the `__INIT_MODULE__:<module>` payload as a JSON suffix so the Super Agent
 * gets it inside the user message and can reference it in its first turn.
 */
export type ModuleAgentContext = Record<string, unknown> | undefined;

function serializeContext(ctx: ModuleAgentContext): string {
  if (!ctx) return "";
  try {
    const json = JSON.stringify(ctx);
    if (!json || json === "{}" || json === "null") return "";
    return ` ${json}`;
  } catch {
    return "";
  }
}

export function useModuleAgent(
  module: string,
  context?: ModuleAgentContext,
  opts: UseModuleAgentOptions = {},
) {
  const enabled = opts.enabled !== false;
  const onResponseRef = useRef(opts.onResponse);
  onResponseRef.current = opts.onResponse;

  // Context is captured by ref so callers can invoke `run(true)` and pick up
  // the latest filter/selection — but it deliberately does NOT participate
  // in the auto-INIT effect's dependency array, because the spec requires
  // INIT_MODULE to fire at most once per (module, sessionId).
  const contextRef = useRef<ModuleAgentContext>(context);
  contextRef.current = context;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ModuleAgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  // Guards to avoid double-fire from React StrictMode / re-mounts.
  const inFlightRef = useRef(false);
  const firedForKeyRef = useRef<string | null>(null);

  const run = useCallback(
    async (force = false) => {
      if (!enabled) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setError(null);
      try {
        setStatus("creating-session");
        const sid = await ensureGlobalSession();
        setSessionId(sid);

        // One-shot key is strictly (module, sessionId). `force=true` (e.g.
        // wired to a "Reanalisar" button) bypasses the cache so the user can
        // request a fresh analysis with the current page context, but the
        // auto-effect never re-fires on context changes.
        const key = storageKey(module, sid);
        if (firedForKeyRef.current === key && !force) {
          inFlightRef.current = false;
          setStatus("idle");
          return;
        }
        if (!force && typeof window !== "undefined" && sessionStorage.getItem(key)) {
          firedForKeyRef.current = key;
          inFlightRef.current = false;
          setStatus("idle");
          return;
        }

        setStatus("running");
        const message = `__INIT_MODULE__:${module}${serializeContext(contextRef.current)}`;
        const r = await apiRequest("POST", `/api/super-agent/sessions/${sid}/messages`, {
          message,
        });
        const data = (await r.json()) as { assistantContent?: string };
        const text = data?.assistantContent ?? "";
        setResponse(text);
        if (typeof window !== "undefined") sessionStorage.setItem(key, "1");
        firedForKeyRef.current = key;
        setStatus("done");
        onResponseRef.current?.(text);
      } catch (e: any) {
        setError(e?.message ?? String(e));
        setStatus("error");
      } finally {
        inFlightRef.current = false;
      }
    },
    [enabled, module],
  );

  useEffect(() => {
    if (!enabled) return;
    void run(false);
    // Intentionally NOT depending on context: INIT fires only once per
    // (module, sessionId). Context changes are picked up by `run(true)`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, module]);

  const reset = useCallback(() => {
    if (sessionId && typeof window !== "undefined") {
      sessionStorage.removeItem(storageKey(module, sessionId));
    }
    firedForKeyRef.current = null;
    setStatus("idle");
    setResponse(null);
    setError(null);
  }, [module, sessionId]);

  return { sessionId, status, error, response, run, reset };
}
