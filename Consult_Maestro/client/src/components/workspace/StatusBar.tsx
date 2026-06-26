// Sprint IDE-1 — Status bar inferior do Workspace IDE.
// Mostra: caminho/linguagem · linha:col (placeholder) · branch · contagem dirty.

import { GitBranch, FileEdit, Cpu } from "lucide-react";
import { langForPath } from "./ExplorerPanel";

interface StatusBarProps {
  activeFile: string | null;
  dirtyCount: number;
  branch?: string;
  model?: string;
}

export function StatusBar({ activeFile, dirtyCount, branch = "main", model }: StatusBarProps) {
  const lang = activeFile ? langForPath(activeFile) : null;
  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1" data-testid="status-branch">
          <GitBranch className="h-3 w-3" />
          <span>{branch}</span>
        </div>
        {lang && (
          <div data-testid="status-language">
            <span className="uppercase">{lang}</span>
          </div>
        )}
        {dirtyCount > 0 && (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-500" data-testid="status-dirty">
            <FileEdit className="h-3 w-3" />
            <span>{dirtyCount} sem salvar</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {model && (
          <div className="flex items-center gap-1" data-testid="status-model">
            <Cpu className="h-3 w-3" />
            <span>{model}</span>
          </div>
        )}
        <div className="font-mono text-[10px] opacity-70" data-testid="status-path">
          {activeFile ?? "—"}
        </div>
      </div>
    </div>
  );
}
