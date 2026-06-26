import { useMemo } from "react";
import { useSearch } from "wouter";
import { SuperAgentChat } from "@/components/SuperAgentChat";

export default function SuperAgent() {
  const search = useSearch();
  const { agentSlug, widgetContext } = useMemo(() => {
    const p = new URLSearchParams(search);
    return {
      agentSlug: p.get("agent") ?? undefined,
      widgetContext: p.get("widget") ?? undefined,
    };
  }, [search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <h1 className="sr-only" data-testid="text-super-agent-title">
        Super Agente
      </h1>
      <SuperAgentChat
        heightClass="flex-1 min-h-0"
        preselectAgentSlug={agentSlug}
        widgetContext={widgetContext}
      />
    </div>
  );
}
