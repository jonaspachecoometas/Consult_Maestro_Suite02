import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

const RELOAD_FLAG = "app.chunkReloadAt";
const RELOAD_COUNT = "app.chunkReloadCount";
const MAX_RELOADS = 2;

function safeStorageGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* noop */ }
}
function safeStorageRemove(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* noop */ }
}

function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  const name = String((err as any)?.name ?? "");
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    if (isChunkLoadError(error)) {
      const last = Number(safeStorageGet(RELOAD_FLAG) || "0");
      const count = Number(safeStorageGet(RELOAD_COUNT) || "0");
      const now = Date.now();
      if (count < MAX_RELOADS && now - last > 10000) {
        safeStorageSet(RELOAD_FLAG, String(now));
        safeStorageSet(RELOAD_COUNT, String(count + 1));
        window.location.reload();
      } else {
        console.error("[ErrorBoundary] chunk reload limit reached:", error);
      }
    } else {
      console.error("[ErrorBoundary] caught error:", error);
      console.error("[ErrorBoundary] stack:", error?.stack);
      console.error("[ErrorBoundary] componentStack:", info.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ error: null, componentStack: null });
  };

  handleReload = () => {
    safeStorageRemove(RELOAD_FLAG);
    safeStorageRemove(RELOAD_COUNT);
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const chunk = isChunkLoadError(this.state.error);
    return (
      <div
        className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 gap-4 text-center"
        data-testid="error-boundary"
      >
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">
          {chunk ? "Atualizando para a nova versão…" : "Algo deu errado nesta tela"}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {chunk
            ? "Detectamos uma nova versão da aplicação. Recarregando automaticamente…"
            : this.state.error.message || "Ocorreu um erro inesperado ao renderizar esta página."}
        </p>
        {!chunk && (this.state.error.stack || this.state.componentStack) && (
          <details className="max-w-2xl w-full text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              Detalhes técnicos (para suporte)
            </summary>
            <pre className="mt-2 p-3 bg-muted text-xs rounded-md overflow-auto max-h-64 whitespace-pre-wrap break-all">
              {this.state.error.stack || this.state.error.message}
              {this.state.componentStack && `\n\nComponent stack:${this.state.componentStack}`}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          <Button onClick={this.handleReload} data-testid="button-error-reload">
            <RefreshCcw className="h-4 w-4 mr-2" />
            Recarregar página
          </Button>
          {!chunk && (
            <Button variant="outline" onClick={this.handleReset} data-testid="button-error-retry">
              Tentar novamente
            </Button>
          )}
        </div>
      </div>
    );
  }
}
