import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LlmSourceBadge } from "@/components/LlmSourceBadge";
import { Activity, Coins, Zap } from "lucide-react";

interface AiUsageLog {
  id: string;
  provider?: string | null;
  model?: string | null;
  source?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  costBrl?: string | number | null;
  createdAt?: string | Date | null;
  userId?: string | null;
  agentId?: string | null;
}

interface Props {
  tenantId?: string;
  endpoint?: string;
}

export function LlmUsageDashboard({ tenantId, endpoint }: Props) {
  const url = endpoint ?? (tenantId ? `/api/superadmin/tenants/${tenantId}/ai-usage` : "/api/ia/usage");

  const { data: logs, isLoading } = useQuery<AiUsageLog[]>({
    queryKey: [url],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-llm-usage-loading">
        <CardHeader><CardTitle>Uso de IA</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const items = Array.isArray(logs) ? logs : [];
  const totalIn = items.reduce((s, l) => s + (l.tokensInput ?? 0), 0);
  const totalOut = items.reduce((s, l) => s + (l.tokensOutput ?? 0), 0);
  const totalCost = items.reduce((s, l) => s + Number(l.costBrl ?? 0), 0);

  return (
    <div className="space-y-4" data-testid="card-llm-usage">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Activity className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Chamadas</p>
              <p className="text-xl font-semibold" data-testid="text-llm-calls">{items.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Zap className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Tokens (in/out)</p>
              <p className="text-xl font-semibold" data-testid="text-llm-tokens">
                {totalIn.toLocaleString("pt-BR")} / {totalOut.toLocaleString("pt-BR")}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Coins className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Custo (BRL)</p>
              <p className="text-xl font-semibold" data-testid="text-llm-cost">
                R$ {totalCost.toFixed(4)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimas chamadas</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-llm-empty">Nenhum uso de IA registrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Fonte</TableHead>
                  <TableHead>Provider/Modelo</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Custo (BRL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 50).map((log) => (
                  <TableRow key={log.id} data-testid={`row-llm-log-${log.id}`}>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell>
                      <LlmSourceBadge source={log.source} provider={log.provider} model={log.model} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {log.provider ?? "?"}/{log.model ?? "?"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {(log.tokensInput ?? 0).toLocaleString("pt-BR")} / {(log.tokensOutput ?? 0).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      R$ {Number(log.costBrl ?? 0).toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
