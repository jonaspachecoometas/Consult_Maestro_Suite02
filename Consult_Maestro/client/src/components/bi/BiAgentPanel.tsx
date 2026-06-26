import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { WidgetConfig } from "@shared/schema";

interface BiAgentResponse {
  title: string;
  widgets: WidgetConfig[];
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
}

interface BiAgentPanelProps {
  onAddWidgets: (widgets: WidgetConfig[]) => void;
}

const SUGGESTIONS = [
  "Crie um dashboard de saúde dos projetos",
  "Mostre o desempenho do funil comercial",
  "Visão geral do diagnóstico (Canvas, SWOT e ERP)",
  "Como está o time Scrum e a entrega de tarefas?",
];

export function BiAgentPanel({ onAddWidgets }: BiAgentPanelProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<BiAgentResponse | null>(null);

  const runMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/bi/agent", { prompt: p });
      return (await res.json()) as BiAgentResponse;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: any) => {
      toast({
        title: "Erro do agente de BI",
        description: err?.message || "Não foi possível gerar o dashboard.",
        variant: "destructive",
      });
    },
  });

  const handleAddAll = () => {
    if (!result || result.widgets.length === 0) return;
    onAddWidgets(result.widgets);
    toast({
      title: "Widgets adicionados",
      description: `${result.widgets.length} widget(s) inseridos no dashboard.`,
    });
    setResult(null);
    setPrompt("");
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Descreva o dashboard que você quer
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex.: Crie um dashboard de saúde dos projetos com SWOT e PDCA"
          rows={3}
          className="mt-1"
          data-testid="input-bi-agent-prompt"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPrompt(s)}
            className="text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-muted/70 text-muted-foreground"
            data-testid={`button-bi-suggestion-${s.slice(0, 12)}`}
          >
            {s}
          </button>
        ))}
      </div>

      <Button
        onClick={() => runMutation.mutate(prompt.trim())}
        disabled={runMutation.isPending || !prompt.trim()}
        className="w-full"
        data-testid="button-run-bi-agent"
      >
        {runMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        Gerar dashboard
      </Button>

      {result && (
        <Card data-testid="card-bi-agent-result">
          <CardContent className="p-3 space-y-2">
            <div className="text-xs font-semibold">{result.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {result.widgets.length} widget(s) propostos
            </div>
            <div className="space-y-1 max-h-48 overflow-auto">
              {result.widgets.map((w) => (
                <div
                  key={w.id}
                  className="text-[11px] flex items-center justify-between border rounded px-2 py-1"
                  data-testid={`bi-agent-widget-${w.id}`}
                >
                  <span className="truncate">{w.title}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">
                    {w.type.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              onClick={handleAddAll}
              className="w-full"
              data-testid="button-add-bi-widgets"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Adicionar todos ao dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
