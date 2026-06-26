/**
 * ModuleAgentBanner — exibe a análise proativa do agente do módulo.
 *
 * Renderiza um cartão compacto que aparece quando `useModuleAgent` está
 * rodando ou termina com texto. Pensado para ser colocado no topo das
 * páginas Control, Societário, Recovery, Production sem brigar com o
 * layout existente — quem usa decide o `module`.
 */

import { Bot, Loader2, RefreshCcw, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useModuleAgent, type ModuleAgentContext } from "@/hooks/useModuleAgent";

interface ModuleAgentBannerProps {
  module: string;
  /** Nome amigável exibido no header (ex: "Arcádia Control"). */
  label?: string;
  /**
   * Contexto opcional repassado ao Super Agente (cliente selecionado, filtro,
   * etapa atual…). Trocar o contexto refaz a análise automaticamente.
   */
  context?: ModuleAgentContext;
}

export function ModuleAgentBanner({ module, label, context }: ModuleAgentBannerProps) {
  const { status, error, response, run } = useModuleAgent(module, context);
  const [collapsed, setCollapsed] = useState(false);
  const isLoading = status === "creating-session" || status === "running";

  // Esconde silenciosamente quando não há nada para mostrar (idle e sem cache).
  if (status === "idle" && !response && !error) return null;

  const moduleLabel = label || module;
  const displayedText = error ? `Não consegui rodar o diagnóstico inicial: ${error}` : response;

  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid={`module-agent-banner-${module}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/15 p-2 shrink-0">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-sm font-medium">
                Diagnóstico do agente — {moduleLabel}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => run(true)}
                  disabled={isLoading}
                  data-testid={`button-rerun-agent-${module}`}
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setCollapsed((v) => !v)}
                  data-testid={`button-toggle-agent-${module}`}
                >
                  {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            {!collapsed && (
              <div
                className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed"
                data-testid={`text-agent-response-${module}`}
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analisando o estado atual…
                  </span>
                ) : (
                  displayedText || "Sem resposta."
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
