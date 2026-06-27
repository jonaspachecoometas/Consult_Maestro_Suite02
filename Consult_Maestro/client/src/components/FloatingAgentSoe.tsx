import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Minus, X, Bot } from "lucide-react";
import { SuperAgentChat } from "./SuperAgentChat";
import { useAgentContext } from "@/contexts/AgentContext";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface SoeAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
}

export function FloatingAgentSoe() {
  const { user } = useAuth();
  const { panelState, openPanel, closePanel, minimizePanel, openWithMessage } = useAgentContext();

  const { data: agents = [] } = useQuery<SoeAgent[]>({
    queryKey: ["/api/soe/agents"],
    queryFn: () => apiRequest("GET", "/api/soe/agents").then((r) => r.json()),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  if (!user) return null;

  const isOpen = panelState === "open";
  const isMinimized = panelState === "minimized";

  return (
    <>
      {/* Botão flutuante — aparece sempre (exceto quando painel aberto em Sheet) */}
      {!isOpen && (
        <button
          onClick={openPanel}
          className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg z-40 bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform"
          title="Abrir Agente SOE"
          data-testid="button-floating-agent-soe"
        >
          {isMinimized ? (
            <span className="text-xs font-bold">SOE</span>
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </button>
      )}

      {/* Painel lateral */}
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closePanel(); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl md:max-w-2xl flex flex-col p-0"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="p-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Sistema Operacional de Escritório
              </SheetTitle>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={minimizePanel} title="Minimizar">
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closePanel} title="Fechar">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Agentes SOE rápidos */}
            {agents.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {agents.map((ag) => (
                  <button
                    key={ag.id}
                    onClick={() => openWithMessage(`@${ag.slug} `)}
                    title={ag.description}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs hover:bg-muted transition-colors"
                  >
                    <Bot className="h-3 w-3 text-primary" />
                    {ag.name.replace("Arcádia ", "")}
                  </button>
                ))}
              </div>
            )}
          </SheetHeader>

          <div className="flex-1 min-h-0">
            <SuperAgentChat heightClass="h-full" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
