import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type AgentType =
  | "diagnostic_canvas"
  | "process_recommendation"
  | "swot_analysis"
  | "erp_gap_analysis"
  | "generic"
  | string;

export interface AgentSource {
  id: string;
  title: string;
  type: string;
  content?: string;
  score: number;
}

export interface AgentResult {
  response: string;
  sources: AgentSource[];
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
  logId: string | null;
}

export function useAgent(projectId: string | null) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);

  async function run(opts: {
    agentType: AgentType;
    prompt: string;
    customAgentId?: string;
    useKnowledge?: boolean;
  }) {
    setIsRunning(true);
    try {
      const body: any = {
        agentType: opts.agentType,
        prompt: opts.prompt,
        projectId: projectId ?? undefined,
        useKnowledge: opts.useKnowledge !== false,
      };
      if (opts.customAgentId) body.customAgentId = opts.customAgentId;

      const res = await apiRequest("POST", "/api/agents/run", body);
      const data = (await res.json()) as AgentResult;
      setResult(data);
      return data;
    } catch (err: any) {
      const message = err?.message || "Erro desconhecido";
      toast({
        title: "Falha ao consultar agente",
        description: message,
        variant: "destructive",
      });
      throw err;
    } finally {
      setIsRunning(false);
    }
  }

  function reset() {
    setResult(null);
  }

  return {
    isRunning,
    result,
    sources: result?.sources ?? [],
    logId: result?.logId ?? null,
    run,
    reset,
  };
}
