// Sprint IDE-1 — Página /workspace: IDE unificado.
// Layout: Explorer | Editor (+ Preview na Sprint IDE-2) | AI (Sprint IDE-3).
// react-resizable-panels já instalado. Painéis colapsáveis.

import { useCallback, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import {
  Code2, PanelRight, PanelBottom, Play, Package, Rocket, ExternalLink, Sparkles,
} from "lucide-react";
import { ExplorerPanel } from "@/components/workspace/ExplorerPanel";
import { EditorPanel } from "@/components/workspace/EditorPanel";
import { StatusBar } from "@/components/workspace/StatusBar";
import { PreviewPanel } from "@/components/workspace/PreviewPanel";
import { AIPanel } from "@/components/workspace/AIPanel";
import { useLocation, Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useSystemRole } from "@/hooks/useSystemRole";

export default function WorkspaceIDE() {
  const [, setLocation] = useLocation();
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const { isSuperadmin, isPartner, isTenantAdmin } = useSystemRole();

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground" data-testid="workspace-ide-loading">
        Carregando workspace...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }
  if (!(isSuperadmin || isPartner || isTenantAdmin)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 p-6 text-center" data-testid="workspace-ide-forbidden">
        <h2 className="text-lg font-semibold">Acesso restrito</h2>
        <p className="text-sm text-muted-foreground">O Workspace IDE está disponível apenas para administradores.</p>
      </div>
    );
  }
  return <WorkspaceIDEInner />;
}

function WorkspaceIDEInner() {
  const [, setLocation] = useLocation();
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(true);
  const [showPreview, setShowPreview] = useState(false); // habilitado na Sprint IDE-2
  const [dirtyCount, setDirtyCount] = useState(0);
  // contentByPath é mantido no EditorPanel; só guardamos referência via callback
  // para AIPanel (Sprint IDE-3) injetar contexto.
  const [activeContent, setActiveContent] = useState("");

  const handleFileSelect = useCallback((path: string) => {
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      if (path === activeFile) {
        setActiveFile(next[next.length - 1] ?? null);
      }
      return next;
    });
  }, [activeFile]);

  const handleContentChange = useCallback((path: string, content: string) => {
    if (path === activeFile) setActiveContent(content);
  }, [activeFile]);

  // Atalhos globais do IDE: Ctrl+` (preview), Ctrl+Shift+A (AI), Ctrl+B (sidebar reservado).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "`") {
        e.preventDefault();
        setShowPreview((p) => !p);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setShowAI((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col" data-testid="workspace-ide">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b bg-background px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Dev Center IDE</span>
          {activeFile && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-xs text-muted-foreground" data-testid="title-active-file">
                {activeFile}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setShowPreview((p) => !p)} data-testid="button-toggle-preview"
            title="Mostrar/ocultar preview (Sprint IDE-2)">
            <PanelBottom className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setShowAI((p) => !p)} data-testid="button-toggle-ai"
            title="Mostrar/ocultar painel IA">
            <Sparkles className="h-3.5 w-3.5" />
            IA
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b bg-muted/20 px-3 py-1">
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"
          onClick={() => setLocation("/dev-center")} data-testid="button-pipeline">
          <Play className="h-3 w-3" /> Pipeline
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"
          onClick={() => setLocation("/planejador")} data-testid="button-planner">
          <Code2 className="h-3 w-3" /> Module Planner
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"
          onClick={() => setLocation("/app-store")} data-testid="button-appstore">
          <Package className="h-3 w-3" /> App Store
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"
          onClick={() => setLocation("/dev-center/infra")} data-testid="button-deploy">
          <Rocket className="h-3 w-3" /> Deploy
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"
            onClick={() => setLocation("/explorador-codigo")} data-testid="link-classic-explorer">
            <ExternalLink className="h-3 w-3" /> Explorer clássico
          </Button>
        </div>
      </div>

      {/* Painéis */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="workspace-h">
          <Panel defaultSize={20} minSize={15} maxSize={35} id="explorer">
            <ExplorerPanel selectedPath={activeFile} onFileSelect={handleFileSelect} />
          </Panel>

          <PanelResizeHandle className="w-px bg-border hover:bg-primary/30 transition-colors" />

          <Panel defaultSize={showAI ? 55 : 80} id="center">
            {showPreview ? (
              <PanelGroup direction="vertical" autoSaveId="workspace-v">
                <Panel defaultSize={60} minSize={20}>
                  <EditorPanel
                    activeFile={activeFile} openFiles={openFiles}
                    onFileSelect={setActiveFile} onFileClose={handleFileClose}
                    onContentChange={handleContentChange} onDirtyCountChange={setDirtyCount}
                  />
                </Panel>
                <PanelResizeHandle className="h-px bg-border hover:bg-primary/30 transition-colors" />
                <Panel defaultSize={40} minSize={20}>
                  <PreviewPanel activeFile={activeFile} />
                </Panel>
              </PanelGroup>
            ) : (
              <EditorPanel
                activeFile={activeFile} openFiles={openFiles}
                onFileSelect={setActiveFile} onFileClose={handleFileClose}
                onContentChange={handleContentChange} onDirtyCountChange={setDirtyCount}
              />
            )}
          </Panel>

          {showAI && (
            <>
              <PanelResizeHandle className="w-px bg-border hover:bg-primary/30 transition-colors" />
              <Panel defaultSize={25} minSize={20} maxSize={40} id="ai">
                <AIPanel activeFile={activeFile} activeContent={activeContent} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <StatusBar activeFile={activeFile} dirtyCount={dirtyCount} />
    </div>
  );
}

