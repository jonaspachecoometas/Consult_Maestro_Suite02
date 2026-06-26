// Sprint IDE-2 — Hook para o SSE /api/explorer/watch.
// Reconecta com backoff. Notifica via callback a cada evento `change`.

import { useEffect, useRef } from "react";

export interface FileWatchEvent {
  type: "change";
  paths: string[];
  ts: number;
}

export function useFileWatcher(
  enabled: boolean,
  onChange: (ev: FileWatchEvent) => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let alive = true;

    function connect() {
      if (!alive) return;
      es = new EventSource("/api/explorer/watch", { withCredentials: true });
      es.addEventListener("hello", () => { backoff = 1000; });
      es.addEventListener("change", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as FileWatchEvent;
          onChangeRef.current(data);
        } catch {}
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (!alive) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      };
    }

    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [enabled]);
}
