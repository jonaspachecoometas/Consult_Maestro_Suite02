import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Loader2, Copy, KeyRound, ShieldAlert, Trash2, CheckCircle2 } from "lucide-react";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
};

type ListResponse = {
  count: number;
  keys: ApiKey[];
  allowedScopes: string[];
};

export default function ConfiguracoesApiKeys() {
  const { toast } = useToast();
  const listQuery = useQuery<ListResponse>({ queryKey: ["/api/api-keys"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState("60");
  const [plainKey, setPlainKey] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/api-keys", {
        name: name.trim(),
        scopes,
        rateLimit: Number(rateLimit) || 60,
      });
      return res.json() as Promise<{ plainKey: string; key: ApiKey }>;
    },
    onSuccess: (data) => {
      setPlainKey(data.plainKey);
      setName(""); setScopes([]); setRateLimit("60");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
    },
    onError: (e: any) => toast({ title: "Erro ao gerar key", description: e?.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/api-keys/${id}/revoke`); },
    onSuccess: () => {
      toast({ title: "API key revogada" });
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
    },
    onError: (e: any) => toast({ title: "Erro ao revogar", description: e?.message, variant: "destructive" }),
  });

  function toggleScope(s: string) {
    setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function copyKey(value: string) {
    navigator.clipboard.writeText(value).then(() => toast({ title: "Copiado!" }));
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    setPlainKey(null);
    setName(""); setScopes([]); setRateLimit("60");
  }

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6" data-testid="page-api-keys">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys (MCP Hub)</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Chaves de acesso ao endpoint público <code className="text-xs">/mcp/v1</code>. Cada chave é vinculada a este tenant e a um conjunto de escopos (módulos) que ela pode invocar.
            A chave em texto puro só é exibida <strong>uma vez</strong> no momento da geração — guarde em local seguro.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreateDialog(); else setCreateOpen(true); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-api-key"><Plus className="h-4 w-4 mr-1" /> Gerar nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md" data-testid="dialog-new-api-key">
            {!plainKey ? (
              <>
                <DialogHeader>
                  <DialogTitle>Nova API key</DialogTitle>
                  <DialogDescription>Defina nome, escopos e rate limit. A chave em texto puro será exibida 1× ao salvar.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1">
                    <Label htmlFor="key-name">Nome</Label>
                    <Input id="key-name" data-testid="input-key-name"
                      placeholder="Ex: integração CRM externo" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Escopos (módulos permitidos)</Label>
                    <div className="grid grid-cols-2 gap-2 rounded-md border p-3 bg-muted/30">
                      {(listQuery.data?.allowedScopes || []).map((s) => (
                        <label key={s} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`checkbox-scope-${s}`}>
                          <Checkbox checked={scopes.includes(s)} onCheckedChange={() => toggleScope(s)} />
                          <span className="font-mono text-xs">{s}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <code>*</code> concede acesso a todos os módulos. Granular é melhor.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="key-rate">Rate limit (req/min)</Label>
                    <Input id="key-rate" type="number" min="1" max="6000" data-testid="input-key-rate"
                      value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeCreateDialog}>Cancelar</Button>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
                    data-testid="button-create-key-confirm"
                  >
                    {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Gerar key
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" /> Key gerada
                  </DialogTitle>
                  <DialogDescription>
                    Copie agora — esta é a única vez que mostraremos a chave em texto puro.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm break-all" data-testid="text-plain-key">
                  {plainKey}
                </div>
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs flex gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>Guarde no seu cofre de segredos. Ao fechar este diálogo a chave não poderá ser recuperada.</span>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => copyKey(plainKey)} data-testid="button-copy-key">
                    <Copy className="h-4 w-4 mr-1" /> Copiar
                  </Button>
                  <Button onClick={closeCreateDialog} data-testid="button-close-key-dialog">Fechar</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Chaves ativas</CardTitle>
          <CardDescription>{listQuery.data?.count ?? 0} chaves no total (incluindo revogadas).</CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          )}
          {listQuery.data && listQuery.data.keys.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center" data-testid="empty-api-keys">
              Nenhuma API key ainda. Clique em "Gerar nova" para criar a primeira.
            </div>
          )}
          {listQuery.data && listQuery.data.keys.length > 0 && (
            <Table data-testid="table-api-keys">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Prefixo</TableHead>
                  <TableHead>Escopos</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.data.keys.map((k) => (
                  <TableRow key={k.id} data-testid={`row-api-key-${k.id}`}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="text-xs">{k.keyPrefix}…</code></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => <Badge key={s} variant="outline" className="text-xs font-mono">{s}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell><span className="text-xs">{k.rateLimit}/min</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="destructive">Revogada</Badge>
                      ) : (
                        <Badge className="bg-green-600 hover:bg-green-700">Ativa</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-revoke-${k.id}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revogar "{k.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Qualquer integração usando esta chave deixará de funcionar imediatamente. Não há como reverter.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revokeMutation.mutate(k.id)}
                                data-testid={`button-revoke-confirm-${k.id}`}
                              >
                                Revogar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como usar</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>Envie a chave no header <code className="text-xs">X-MCP-Key</code>:</p>
          <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/mcp/v1/tools/list_clients \\
  -H "X-MCP-Key: arc_…" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {}}'`}
          </pre>
          <p>Documentação OpenAPI: <a href="/api-docs" target="_blank" rel="noreferrer" className="text-primary underline" data-testid="link-api-docs">/api-docs</a></p>
        </CardContent>
      </Card>
    </div>
  );
}
