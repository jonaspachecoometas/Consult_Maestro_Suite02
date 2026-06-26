import { useState } from "react";
import {
  Brain,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgent, AgentType, AgentResult } from "@/hooks/useAgent";
import { useAgentDefinitions } from "@/hooks/useAgentDefinitions";

interface AgentPanelProps {
  projectId: string | null;
  agentType: AgentType;
  label: string;
  description?: string;
  visibleIn?: string;
  defaultPrompt?: string;
}

export function AgentPanel({
  projectId,
  agentType,
  label,
  description,
  visibleIn,
  defaultPrompt,
}: AgentPanelProps) {
  const { isRunning, result, run, reset } = useAgent(projectId);
  const [expanded, setExpanded] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(defaultPrompt || "");
  const [usePrompt, setUsePrompt] = useState(false);

  const fallbackPrompt = `Analise o projeto atual e produza recomendações estruturadas. Foque em insights acionáveis.`;
  const effectiveDefault = defaultPrompt?.trim() || fallbackPrompt;

  // Optional: load custom agents visible in this screen
  const { data: customAgents = [] } = useAgentDefinitions(visibleIn);
  const [selectedCustomAgentId, setSelectedCustomAgentId] = useState<string>("__default__");

  async function handleRun() {
    const isCustom = selectedCustomAgentId && selectedCustomAgentId !== "__default__";
    const prompt = usePrompt ? customPrompt : effectiveDefault;
    try {
      await run({
        agentType: isCustom ? "custom" : agentType,
        prompt,
        customAgentId: isCustom ? selectedCustomAgentId : undefined,
      });
    } catch {
      /* toast already shown */
    }
  }

  if (!projectId) {
    return (
      <Card className="border-dashed" data-testid="card-agent-panel-empty">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <Brain className="mx-auto h-6 w-6 mb-2 opacity-50" />
          Selecione um projeto para usar o agente de IA
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent" data-testid="card-agent-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {label}
                <Badge variant="outline" className="text-[10px] font-normal">IA</Badge>
              </CardTitle>
              {description && (
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
              )}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setExpanded((e) => !e)}
            data-testid="button-agent-toggle"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {customAgents.length > 0 && (
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedCustomAgentId} onValueChange={setSelectedCustomAgentId}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-custom-agent">
                  <SelectValue placeholder="Agente padrão da tela" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Agente padrão da tela</SelectItem>
                  {customAgents.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} {a.tenantId === null && "(Global)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setUsePrompt((u) => !u)}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              data-testid="button-toggle-custom-prompt"
            >
              {usePrompt ? "Usar pergunta padrão" : "Personalizar pergunta"}
            </button>
          </div>

          {usePrompt && (
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Digite sua pergunta ou solicitação para o agente..."
              rows={3}
              className="text-sm"
              data-testid="input-agent-prompt"
            />
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRun}
              disabled={isRunning || (usePrompt && !customPrompt.trim())}
              size="sm"
              data-testid="button-run-agent"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <Brain className="h-4 w-4 mr-2" />
                  {result ? "Executar novamente" : "Executar análise"}
                </>
              )}
            </Button>
            {result && (
              <Button variant="ghost" size="sm" onClick={reset} data-testid="button-clear-agent">
                Limpar
              </Button>
            )}
          </div>

          {result && <ResultBlock result={result} showSources={showSources} setShowSources={setShowSources} />}
        </CardContent>
      )}
    </Card>
  );
}

function ResultBlock({
  result,
  showSources,
  setShowSources,
}: {
  result: AgentResult;
  showSources: boolean;
  setShowSources: (v: boolean) => void;
}) {
  return (
    <>
      <Separator />
      <div className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-agent-response">
        {result.response}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="text-agent-meta">
          {result.tokensInput + result.tokensOutput} tokens · {(result.durationMs / 1000).toFixed(1)}s
        </span>
        {result.sources.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSources(!showSources)}
            className="flex items-center gap-1 hover:text-foreground"
            data-testid="button-toggle-sources"
          >
            <BookOpen className="h-3 w-3" />
            {result.sources.length} fonte(s)
            {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {showSources && result.sources.length > 0 && (
        <div className="space-y-2 mt-2">
          {result.sources.map((s, i) => (
            <div
              key={s.id}
              className="rounded-md border bg-muted/30 p-2 text-xs"
              data-testid={`card-source-${i}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">[#{i + 1}]</Badge>
                  <span className="font-medium">{s.title}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">{s.type}</Badge>
              </div>
              {s.content && (
                <p className="text-muted-foreground line-clamp-2">{s.content.slice(0, 200)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
