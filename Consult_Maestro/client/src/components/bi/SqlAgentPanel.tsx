import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { WidgetConfig, SqlQuery } from "@shared/schema";

interface AgentResponse {
  query: SqlQuery;
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  truncated: boolean;
  suggestedWidgetType: WidgetConfig["type"];
}

interface SqlAgentPanelProps {
  onAddWidget: (w: WidgetConfig) => void;
}

export function SqlAgentPanel({ onAddWidget }: SqlAgentPanelProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AgentResponse | null>(null);

  const runMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/sql/agent", { prompt: p });
      return (await res.json()) as AgentResponse;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sql"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro do agente SQL",
        description: err?.message || "Não foi possível gerar a consulta.",
        variant: "destructive",
      });
    },
  });

  const handleAddToDashboard = () => {
    if (!result) return;
    const widget: WidgetConfig = {
      id: crypto.randomUUID(),
      type: result.suggestedWidgetType,
      title: result.query.name || "Análise SQL",
      gridPos: { x: 0, y: 99, w: 6, h: 4 },
      dataSource: {
        type: "sql_agent",
        sqlQueryId: result.query.id,
        agentPrompt: result.query.agentPrompt || undefined,
        xAxisColumn: result.query.xAxisColumn || undefined,
        yAxisColumns: result.query.yAxisColumns || [],
      },
    };
    onAddWidget(widget);
    toast({ title: "Widget adicionado", description: "Confira no grid." });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Pergunte em linguagem natural
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex.: Quantos projetos foram concluídos por mês nos últimos 6 meses?"
          rows={3}
          className="mt-1"
          data-testid="input-sql-agent-prompt"
        />
      </div>
      <Button
        onClick={() => runMutation.mutate(prompt.trim())}
        disabled={runMutation.isPending || !prompt.trim()}
        className="w-full"
        data-testid="button-run-sql-agent"
      >
        {runMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        Gerar consulta
      </Button>

      {result && (
        <Card data-testid="card-sql-agent-result">
          <CardContent className="p-3 space-y-2">
            <div className="text-xs font-medium">{result.query.name}</div>
            {result.query.description && (
              <div className="text-[11px] text-muted-foreground">
                {result.query.description}
              </div>
            )}
            <pre className="text-[10px] bg-muted p-2 rounded overflow-auto max-h-32 font-mono">
              {result.query.querySql}
            </pre>
            <div className="text-[11px] text-muted-foreground">
              {result.rowCount} linha(s){result.truncated ? " (truncado)" : ""} ·
              {" "}eixo X: {result.query.xAxisColumn || "—"} ·
              {" "}sugestão: {result.suggestedWidgetType.replace("_", " ")}
            </div>
            {result.rows.length > 0 && (
              <div className="overflow-auto max-h-32 border rounded text-[10px]">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} className="text-left px-2 py-1 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {result.columns.map((c) => (
                          <td key={c} className="px-2 py-1">{String(r[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button
              size="sm"
              onClick={handleAddToDashboard}
              className="w-full"
              data-testid="button-add-sql-widget"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Adicionar ao dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
