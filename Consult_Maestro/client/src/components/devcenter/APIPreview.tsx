import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, AlertCircle, Globe, Loader2 } from "lucide-react";

interface Props {
  // Dica de payload: o consultor pode editar livre.
  defaultPayload?: string;
  // Endpoint a "simular" (apenas exibido no header — Sprint 2 não chama servidor real)
  endpointHint?: string;
}

interface SimulatedResponse {
  status: number;
  ok: boolean;
  body: any;
  ms: number;
}

// Sprint 2: simulação local. O backend real será chamado quando o deploy
// em homologação estiver disponível (Sprint 3+).
function simulate(payloadStr: string): SimulatedResponse {
  const start = performance.now();
  let parsed: any;
  try {
    parsed = payloadStr.trim() === "" ? {} : JSON.parse(payloadStr);
  } catch (e: any) {
    return {
      status: 400,
      ok: false,
      body: { error: "invalid_json", message: e?.message || "Payload não é JSON válido" },
      ms: Math.round(performance.now() - start),
    };
  }
  // Heurística simples: ecoa o payload com um id e timestamp.
  const echo = {
    success: true,
    received: parsed,
    generated_id: `mock_${Date.now().toString(36)}`,
    server_time: new Date().toISOString(),
    note: "Resposta simulada localmente — endpoint real disponível após deploy em homologação.",
  };
  // Pequeno delay artificial para parecer real
  const ms = Math.round(performance.now() - start) + Math.floor(Math.random() * 60) + 20;
  return { status: 200, ok: true, body: echo, ms };
}

export default function APIPreview({ defaultPayload, endpointHint }: Props) {
  const [payload, setPayload] = useState<string>(
    defaultPayload ||
      JSON.stringify({ name: "Cliente Exemplo", valor_mensal: 1500, data_inicio: "2026-01-01" }, null, 2),
  );
  const [endpoint, setEndpoint] = useState<string>(endpointHint || "/api/method/meu_modulo.api.processar");
  const [response, setResponse] = useState<SimulatedResponse | null>(null);
  const [running, setRunning] = useState(false);

  const handleTest = () => {
    setRunning(true);
    // pequeno timeout para feedback visual
    setTimeout(() => {
      setResponse(simulate(payload));
      setRunning(false);
    }, 250);
  };

  return (
    <div className="space-y-3" data-testid="preview-api">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Teste de endpoint</h3>
          <Badge variant="outline" className="text-[10px]">simulado</Badge>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground">Endpoint</label>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">POST</Badge>
          <Input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="text-xs font-mono h-8"
            data-testid="input-endpoint"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-medium text-foreground">Payload de teste (JSON)</label>
        <Textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className="text-xs font-mono min-h-[140px]"
          data-testid="textarea-payload"
        />
      </div>

      <Button
        onClick={handleTest}
        disabled={running}
        className="gap-2"
        data-testid="button-test-endpoint"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Testar endpoint
      </Button>

      {response && (
        <div className="space-y-2 pt-2 border-t" data-testid="api-response">
          <div className="flex items-center gap-2 text-xs">
            <Badge className={response.ok ? "bg-emerald-600 text-white" : "bg-destructive text-destructive-foreground"}>
              {response.status} {response.ok ? "OK" : "ERR"}
            </Badge>
            <span className="text-muted-foreground">{response.ms}ms</span>
          </div>
          <ScrollArea className="max-h-[300px] border rounded-md bg-zinc-950 dark:bg-zinc-900">
            <pre className="text-xs font-mono p-3 text-zinc-100 whitespace-pre-wrap" data-testid="response-body">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </ScrollArea>
        </div>
      )}

      <div className="flex items-start gap-2 text-[10px] text-muted-foreground italic pt-2 border-t">
        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
        <p>
          Esta é uma <strong>simulação client-side</strong> apenas para validar o formato do payload.
          A execução real do código gerado acontecerá após o deploy em homologação (Sprint 3+).
        </p>
      </div>
    </div>
  );
}
