// Sprint IDE-3 — Painel IA contextual do Workspace IDE.
// Layout: header + 5 quick actions + SuperAgentChat embedado + PipelineStatus na base.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, Bug, FileCode, ListChecks, MessageSquare, Loader2 } from "lucide-react";
import { useWorkspaceAgent } from "@/hooks/useWorkspaceAgent";
import { SuperAgentChat } from "@/components/SuperAgentChat";
import { PipelineStatus } from "./PipelineStatus";
import { Badge } from "@/components/ui/badge";

interface AIPanelProps {
  activeFile: string | null;
  activeContent: string;
}

const QUICK_ACTIONS: Array<{
  id: string;
  label: string;
  icon: typeof Sparkles;
  prompt: (file: string | null) => string;
  needsFile?: boolean;
}> = [
  {
    id: "explain",
    label: "Explicar",
    icon: FileCode,
    needsFile: true,
    prompt: (f) => `Explique de forma curta o que este arquivo \`${f}\` faz, suas responsabilidades principais, dependências e onde ele é usado no app. Máx. 4 bullets.`,
  },
  {
    id: "review",
    label: "Revisar",
    icon: Bug,
    needsFile: true,
    prompt: (f) => `Faça uma revisão crítica de \`${f}\`: aponte bugs potenciais, problemas de segurança, edge cases não tratados e oportunidades de simplificação. Liste por prioridade.`,
  },
  {
    id: "tests",
    label: "Testes",
    icon: ListChecks,
    needsFile: true,
    prompt: (f) => `Sugira casos de teste relevantes para \`${f}\`: liste cenários happy-path, edge cases e falhas que devem ser cobertos. NÃO escreva o código dos testes ainda — apenas a lista priorizada.`,
  },
  {
    id: "refactor",
    label: "Refatorar",
    icon: Wand2,
    needsFile: true,
    prompt: (f) => `Sugira uma refatoração concreta para \`${f}\` que melhore legibilidade ou manutenibilidade SEM alterar comportamento. Mostre apenas o trecho mais impactante (não reescreva o arquivo todo).`,
  },
  {
    id: "next",
    label: "Próximo passo",
    icon: MessageSquare,
    prompt: (f) =>
      f
        ? `Estou trabalhando em \`${f}\`. Qual seria o próximo passo lógico para mim no contexto deste tenant?`
        : `Não tenho arquivo aberto. Sugira por onde começar: arquivo recém-modificado relevante, TODO pendente, ou módulo que precisa de atenção.`,
  },
];

export function AIPanel({ activeFile, activeContent }: AIPanelProps) {
  const agent = useWorkspaceAgent();

  // Dispara INIT_MODULE 1× quando temos sessão.
  useEffect(() => {
    if (agent.sessionId) {
      agent.fireInitOnce(activeFile).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.sessionId]);

  function handleAction(actionId: string) {
    const action = QUICK_ACTIONS.find((a) => a.id === actionId);
    if (!action) return;
    if (action.needsFile && !activeFile) return;
    const prompt = action.prompt(activeFile);
    agent.sendQuickAction(prompt, {
      filePath: activeFile,
      selection: action.needsFile ? activeContent : undefined,
    });
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>MAESTRO IA</span>
        </div>
        {activeFile && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]" title={activeFile}>
            {activeFile.split("/").pop()}
          </Badge>
        )}
      </div>

      {/* Quick actions */}
      <div className="border-b p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Ações rápidas
        </div>
        <div className="grid grid-cols-2 gap-1">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            const disabled = (a.needsFile && !activeFile) || agent.status === "sending";
            return (
              <Button
                key={a.id}
                variant="outline"
                size="sm"
                className="h-7 justify-start gap-1.5 text-[11px]"
                disabled={disabled}
                onClick={() => handleAction(a.id)}
                data-testid={`button-quick-${a.id}`}
                title={disabled && a.needsFile ? "Abra um arquivo primeiro" : a.label}
              >
                {agent.status === "sending" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                {a.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {agent.sessionId ? (
          <SuperAgentChat
            key={agent.sessionId}
            projectId={null}
            heightClass="h-full"
            compact
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Pipeline status (footer) */}
      <PipelineStatus />
    </div>
  );
}
