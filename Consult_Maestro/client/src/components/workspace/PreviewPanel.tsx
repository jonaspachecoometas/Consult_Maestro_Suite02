// Sprint IDE-2 — Painel de preview ao vivo.
// Iframe da própria app (mesma origem) + mapping arquivo→rota + auto-reload via SSE.
// Atalhos: F5 manual reload (com foco no painel).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  RefreshCcw, ArrowLeft, ArrowRight, ExternalLink, Eye, Zap,
} from "lucide-react";
import { useFileWatcher } from "@/hooks/useFileWatcher";

// Heurística: caminho do arquivo no repo → rota da app.
// Mantida intencionalmente simples — usuário pode sobrescrever no input.
const FILE_TO_ROUTE: Array<[RegExp, string]> = [
  [/^server\/control\b/, "/control"],
  [/^client\/src\/pages\/Control/i, "/control"],
  [/^server\/societario\b/, "/societario"],
  [/^client\/src\/pages\/(Societario|societario)/i, "/societario"],
  [/^server\/recovery\b/, "/recovery"],
  [/^client\/src\/pages\/Recovery/i, "/recovery"],
  [/^server\/producao\b/, "/producao"],
  [/^client\/src\/pages\/(Producao|Production)/i, "/producao"],
  [/^server\/ide\b/, "/dev-center"],
  [/^client\/src\/pages\/DevCenter/i, "/dev-center"],
  [/^client\/src\/pages\/Workspace/i, "/workspace"],
];

function routeForFile(path: string | null): string {
  if (!path) return "/";
  for (const [re, route] of FILE_TO_ROUTE) {
    if (re.test(path)) return route;
  }
  return "/";
}

interface PreviewPanelProps {
  activeFile: string | null;
}

export function PreviewPanel({ activeFile }: PreviewPanelProps) {
  const [autoReload, setAutoReload] = useState(true);
  const [routeInput, setRouteInput] = useState("/");
  const [committedRoute, setCommittedRoute] = useState("/");
  const [iframeKey, setIframeKey] = useState(0);
  const [lastReloadAt, setLastReloadAt] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Quando o arquivo ativo muda, sugere uma nova rota (mas só commita se o
  // usuário ainda não digitou nada manualmente).
  const suggested = useMemo(() => routeForFile(activeFile), [activeFile]);
  const followFileRef = useRef(true);

  useEffect(() => {
    if (!followFileRef.current) return;
    setRouteInput(suggested);
    setCommittedRoute(suggested);
  }, [suggested]);

  // Auto reload via SSE
  const reload = useCallback(() => {
    setIframeKey((k) => k + 1);
    setLastReloadAt(Date.now());
  }, []);

  useFileWatcher(autoReload, () => { reload(); });

  const navigate = useCallback((to: string) => {
    followFileRef.current = false;
    let r = to.trim();
    if (!r.startsWith("/")) r = "/" + r;
    setRouteInput(r);
    setCommittedRoute(r);
    setIframeKey((k) => k + 1);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="mr-2 text-xs font-medium text-muted-foreground">PREVIEW</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={() => iframeRef.current?.contentWindow?.history.back()}
          data-testid="button-preview-back" title="Voltar">
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={() => iframeRef.current?.contentWindow?.history.forward()}
          data-testid="button-preview-forward" title="Avançar">
          <ArrowRight className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={reload} data-testid="button-preview-reload" title="Recarregar (F5)">
          <RefreshCcw className="h-3 w-3" />
        </Button>
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); navigate(routeInput); }}
        >
          <Input
            value={routeInput}
            onChange={(e) => setRouteInput(e.target.value)}
            className="h-6 text-xs font-mono"
            placeholder="/rota"
            data-testid="input-preview-route"
          />
        </form>
        <a
          href={committedRoute}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 hover:bg-muted"
          title="Abrir em nova aba"
          data-testid="link-preview-external"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
        <div className="ml-2 flex items-center gap-1.5">
          <Zap className={`h-3 w-3 ${autoReload ? "text-emerald-500" : "text-muted-foreground"}`} />
          <Switch
            checked={autoReload}
            onCheckedChange={setAutoReload}
            data-testid="switch-auto-reload"
            className="scale-75"
          />
          <span className="text-[10px] text-muted-foreground">auto</span>
        </div>
        {lastReloadAt && (
          <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px]"
            data-testid="badge-last-reload">
            {timeAgo(lastReloadAt)}
          </Badge>
        )}
      </div>

      {/* Iframe */}
      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={committedRoute}
          className="h-full w-full border-0"
          title="App preview"
          // sandbox intencionalmente sem allow-top-navigation para evitar que
          // a app aninhada force navegação da janela pai.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          data-testid="iframe-preview"
        />
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "agora";
  if (s < 60) return `${s}s atrás`;
  return `${Math.floor(s / 60)}m atrás`;
}
