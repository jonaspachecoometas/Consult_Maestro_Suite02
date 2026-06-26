import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Globe,
  KeyRound,
  ShieldCheck,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
} from "lucide-react";

type SafeCredential = {
  id: string;
  name: string;
  system: string;
  url: string | null;
  username: string | null;
  status: string;
  lastLoginAt: string | null;
  hasSecret: boolean;
};

type Approval = {
  id: string;
  actionDescription: string;
  actionPayload: Record<string, any>;
  status: string;
  requestedAt: string | null;
  resolvedAt: string | null;
};

type BrowserStatus = { ok: boolean; chromiumPath?: string; error?: string };

function emptyForm() {
  return { name: "", system: "", url: "", username: "", password: "", token: "" };
}

export default function EscritorioAgente() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [testUrl, setTestUrl] = useState("https://example.com");
  const [testResult, setTestResult] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<BrowserStatus>({
    queryKey: ["/api/browser/status"],
  });

  const { data: credentials = [], isLoading: credsLoading } = useQuery<SafeCredential[]>({
    queryKey: ["/api/agent/credentials"],
  });

  const { data: approvals = [], isLoading: approvalsLoading } = useQuery<Approval[]>({
    queryKey: ["/api/agent/approvals"],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        system: form.system,
        url: form.url || undefined,
        username: form.username || undefined,
        secret: {
          password: form.password || undefined,
          token: form.token || undefined,
        },
      };
      return apiRequest("POST", "/api/agent/credentials", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/credentials"] });
      setDialogOpen(false);
      setForm(emptyForm());
      toast({ title: "Credencial salva", description: "Senha criptografada no cofre." });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao salvar", description: e?.message ?? "Tente novamente", variant: "destructive" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/agent/credentials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/credentials"] });
      toast({ title: "Credencial removida" });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" });
    },
  });

  const resolveMut = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) =>
      apiRequest("POST", `/api/agent/approvals/${id}/resolve`, { approved }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/approvals"] });
      toast({ title: "Aprovação atualizada" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    },
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/browser/test", { url: testUrl });
      return res.json();
    },
    onSuccess: (data: any) => {
      setTestResult(
        `✅ ${data.title || "(sem título)"} — ${data.url}\n\n${(data.snapshot || "").slice(0, 1500)}`,
      );
    },
    onError: (e: any) => {
      setTestResult(`❌ ${e?.message ?? "Falha no teste"}`);
    },
  });

  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <div className="p-6 space-y-6" data-testid="page-escritorio-agente">
      <div className="flex items-center gap-3">
        <Globe className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Escritório Agente</h1>
          <p className="text-sm text-muted-foreground">
            Dê ao agente as mãos de um navegador: ele acessa sistemas web, faz login com
            credenciais guardadas em cofre e executa tarefas — pedindo sua aprovação antes de
            ações irreversíveis.
          </p>
        </div>
      </div>

      {/* Status do navegador */}
      <Card data-testid="card-browser-status">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Status do navegador
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
            </div>
          ) : status?.ok ? (
            <div className="flex items-center gap-2 text-sm" data-testid="status-browser-ok">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Chromium pronto.</span>
              <code className="text-xs text-muted-foreground truncate">{status.chromiumPath}</code>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-red-600" data-testid="status-browser-error">
              <XCircle className="h-4 w-4" />
              <span>{status?.error ?? "Navegador indisponível."}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials" data-testid="tab-credentials">
            <KeyRound className="h-4 w-4 mr-1" /> Credenciais
          </TabsTrigger>
          <TabsTrigger value="approvals" data-testid="tab-approvals">
            <ShieldCheck className="h-4 w-4 mr-1" /> Aprovações
            {pendingApprovals.length > 0 && (
              <Badge variant="destructive" className="ml-2">{pendingApprovals.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="test" data-testid="tab-test">
            <PlayCircle className="h-4 w-4 mr-1" /> Teste de navegação
          </TabsTrigger>
        </TabsList>

        {/* Credenciais */}
        <TabsContent value="credentials" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Senhas e tokens ficam criptografados e nunca são exibidos depois de salvos.
            </p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-credential">
                  <Plus className="h-4 w-4 mr-1" /> Nova credencial
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova credencial</DialogTitle>
                  <DialogDescription>
                    Dados de acesso a um sistema externo (ERP, SEFAZ, prefeitura, banco…).
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="cred-name">Nome</Label>
                    <Input id="cred-name" data-testid="input-cred-name" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ex.: ERP Cortiart" />
                  </div>
                  <div>
                    <Label htmlFor="cred-system">Identificador do sistema</Label>
                    <Input id="cred-system" data-testid="input-cred-system" value={form.system}
                      onChange={(e) => setForm({ ...form, system: e.target.value })}
                      placeholder="Ex.: totvs_protheus" />
                  </div>
                  <div>
                    <Label htmlFor="cred-url">URL de login</Label>
                    <Input id="cred-url" data-testid="input-cred-url" value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="https://..." />
                  </div>
                  <div>
                    <Label htmlFor="cred-username">Usuário</Label>
                    <Input id="cred-username" data-testid="input-cred-username" value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="cred-password">Senha</Label>
                    <Input id="cred-password" type="password" data-testid="input-cred-password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="cred-token">Token (opcional)</Label>
                    <Input id="cred-token" type="password" data-testid="input-cred-token"
                      value={form.token}
                      onChange={(e) => setForm({ ...form, token: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-credential">
                    Cancelar
                  </Button>
                  <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || !form.system}
                    data-testid="button-save-credential">
                    {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {credsLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : credentials.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-credentials">
              Nenhuma credencial cadastrada ainda.
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {credentials.map((c) => (
                <Card key={c.id} data-testid={`card-credential-${c.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{c.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{c.system}</CardDescription>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(c.id)}
                        disabled={deleteMut.isPending} data-testid={`button-delete-credential-${c.id}`}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {c.url && <div className="truncate text-muted-foreground">{c.url}</div>}
                    {c.username && <div>Usuário: <span className="font-medium">{c.username}</span></div>}
                    <div className="flex gap-2 pt-1">
                      <Badge variant={c.hasSecret ? "default" : "outline"}>
                        {c.hasSecret ? "Segredo no cofre" : "Sem segredo"}
                      </Badge>
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Aprovações */}
        <TabsContent value="approvals" className="space-y-3">
          {approvalsLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : approvals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-approvals">
              Nenhum pedido de aprovação. Quando o agente precisar confirmar uma ação irreversível,
              ela aparece aqui.
            </CardContent></Card>
          ) : (
            approvals.map((a) => (
              <Card key={a.id} data-testid={`card-approval-${a.id}`}>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium">{a.actionDescription}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.requestedAt ? new Date(a.requestedAt).toLocaleString("pt-BR") : ""}
                    </div>
                  </div>
                  {a.status === "pending" ? (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" onClick={() => resolveMut.mutate({ id: a.id, approved: true })}
                        disabled={resolveMut.isPending} data-testid={`button-approve-${a.id}`}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => resolveMut.mutate({ id: a.id, approved: false })}
                        disabled={resolveMut.isPending} data-testid={`button-reject-${a.id}`}>
                        <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={a.status === "approved" ? "default" : "destructive"}>
                      {a.status === "approved" ? "Aprovado" : "Rejeitado"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Teste */}
        <TabsContent value="test" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Teste rápido de navegação</CardTitle>
              <CardDescription>
                Abre a URL num navegador headless e mostra a árvore de acessibilidade — o mesmo que
                o agente "enxerga".
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={testUrl} onChange={(e) => setTestUrl(e.target.value)}
                  placeholder="https://example.com" data-testid="input-test-url" />
                <Button onClick={() => testMut.mutate()} disabled={testMut.isPending}
                  data-testid="button-run-test">
                  {testMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
                  Testar
                </Button>
              </div>
              {testResult && (
                <Textarea readOnly value={testResult} className="font-mono text-xs h-72"
                  data-testid="text-test-result" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
