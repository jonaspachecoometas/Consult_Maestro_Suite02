import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Sparkles, Loader2, Send, Save, CheckCircle2, Plus, Trash2, ExternalLink,
  History, RefreshCcw, AlertTriangle, FileCode2, Rows, Globe, Bot, GitMerge, Wand2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ───────────────────────────────────────────────────────────────────────────
// Tipos do contrato (espelhados de server/modulePlanner/planner.ts)
// ───────────────────────────────────────────────────────────────────────────
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface PlanColumn { name: string; type: string; notes?: string }
interface PlanTable { name: string; description: string; columns: PlanColumn[]; relations?: string[] }
interface PlanEndpoint { method: Method; path: string; description: string }
interface PlanPage { route: string; name: string; description: string }
interface PlanAgent { name: string; role: string; skills: string[] }
interface PlanDependency { module: string; reason: string }
interface SimilarModule { name: string; route: string; reason: string }

interface ModulePlanContract {
  summary: string;
  tables: PlanTable[];
  endpoints: PlanEndpoint[];
  pages: PlanPage[];
  agents: PlanAgent[];
  dependencies: PlanDependency[];
  similarModule: SimilarModule | null;
}

interface PlanRow {
  id: string;
  title: string;
  status: "draft" | "proposed" | "approved" | "generated";
  currentVersion: number;
  pipelineRunId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PlanDetailRow extends PlanRow {
  descriptionInput: string;
  planJson: ModulePlanContract;
  tenantId: string;
}

interface PlanVersion {
  id: string;
  versionNumber: number;
  source: "analyze" | "edit" | "approve" | "revert";
  createdById: string | null;
  createdAt: string | null;
  planJson: ModulePlanContract;
  // Devolvido pelo backend via LEFT JOIN em users (nome ou email do autor).
  authorName: string | null;
}

interface DetailResponse {
  plan: PlanDetailRow;
  versions: PlanVersion[];
  run: { id: string; status: string; title: string } | null;
}

const STATUS_LABEL: Record<PlanRow["status"], { label: string; className: string }> = {
  draft:     { label: "Rascunho",  className: "bg-muted text-muted-foreground" },
  proposed:  { label: "Proposto",  className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  approved:  { label: "Aprovado",  className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  generated: { label: "Gerado",    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
};

const SOURCE_LABEL: Record<PlanVersion["source"], string> = {
  analyze: "Análise do agente",
  edit:    "Edição manual",
  approve: "Aprovação",
  revert:  "Revertido",
};

const EMPTY_PLAN: ModulePlanContract = {
  summary: "",
  tables: [],
  endpoints: [],
  pages: [],
  agents: [],
  dependencies: [],
  similarModule: null,
};

function StatusBadge({ status }: { status: PlanRow["status"] }) {
  const meta = STATUS_LABEL[status];
  return <Badge className={meta.className} data-testid={`badge-status-${status}`}>{meta.label}</Badge>;
}

function methodColor(m: Method) {
  switch (m) {
    case "GET":    return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "POST":   return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "PUT":
    case "PATCH":  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "DELETE": return "bg-destructive/10 text-destructive";
  }
}

// Diff resumido entre duas versões do contrato (counts por seção).
// Não tenta diff textual fino — só a magnitude da mudança por categoria.
function summarizeDiff(prev: ModulePlanContract | undefined | null, curr: ModulePlanContract): string[] {
  if (!prev) return ["primeira versão"];
  const changes: string[] = [];
  const dt = curr.tables.length - prev.tables.length;
  const de = curr.endpoints.length - prev.endpoints.length;
  const dp = curr.pages.length - prev.pages.length;
  const da = curr.agents.length - prev.agents.length;
  const dd = curr.dependencies.length - prev.dependencies.length;
  const fmt = (n: number, label: string) =>
    n === 0 ? null : `${n > 0 ? "+" : ""}${n} ${label}`;
  for (const part of [
    fmt(dt, "tabelas"), fmt(de, "endpoints"), fmt(dp, "páginas"),
    fmt(da, "agentes"), fmt(dd, "dependências"),
  ]) {
    if (part) changes.push(part);
  }
  // Mudança de resumo (heurística textual)
  if (prev.summary !== curr.summary) changes.push("resumo alterado");
  // Renomeações em tabelas
  const prevTableNames = new Set(prev.tables.map((t) => t.name));
  const currTableNames = new Set(curr.tables.map((t) => t.name));
  const renamedTables = Array.from(currTableNames).filter(
    (n) => !prevTableNames.has(n) && prev.tables.length === curr.tables.length,
  );
  if (renamedTables.length > 0 && dt === 0) {
    changes.push(`renomeou: ${renamedTables.slice(0, 2).join(", ")}`);
  }
  return changes.length === 0 ? ["sem mudanças estruturais"] : changes;
}

export default function Planejador() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  // ATENÇÃO: a regra de role precisa bater com requireTenantAdminOrPartner no
  // backend (server/tenantContext.ts), que aceita superadmin, partner ou
  // tenant admin. Mesma lista do filtro adminOnly do AppSidebar.
  const { isSuperadmin, isPartner, isTenantAdmin, isLoading: roleLoading } = useSystemRole();
  const isAllowed = isSuperadmin || isPartner || isTenantAdmin;

  // ─── Estado: plano selecionado + edição inline ─────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [planDraft, setPlanDraft] = useState<ModulePlanContract>(EMPTY_PLAN);
  const [dirty, setDirty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────────
  const { data: list = [], isLoading: listLoading } = useQuery<PlanRow[]>({
    queryKey: ["/api/module-planner"],
  });

  const { data: detail, isLoading: detailLoading } = useQuery<DetailResponse>({
    queryKey: ["/api/module-planner", selectedId],
    enabled: !!selectedId,
    refetchInterval: (q) => {
      const d = q.state.data as DetailResponse | undefined;
      // Se a run vinculada está rodando, atualiza com mais frequência.
      if (d?.run && ["pending", "running_architect", "running_developer", "running_qa", "deploying"].includes(d.run.status)) {
        return 3000;
      }
      return false;
    },
  });

  // Sincroniza form local quando o detalhe carrega
  useEffect(() => {
    if (detail?.plan) {
      setTitleInput(detail.plan.title);
      setDescriptionInput(detail.plan.descriptionInput);
      setPlanDraft(detail.plan.planJson);
      setDirty(false);
    }
  }, [detail?.plan?.id, detail?.plan?.currentVersion]);

  // ─── Mutations ────────────────────────────────────────────────────────
  const analyzeMut = useMutation({
    mutationFn: async (input: { planId?: string; title: string; description: string; expectedVersion?: number }) => {
      const res = await apiRequest("POST", "/api/module-planner/analyze", input);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-planner"] });
      const id = data?.plan?.id as string | undefined;
      if (id) {
        queryClient.invalidateQueries({ queryKey: ["/api/module-planner", id] });
        setSelectedId(id);
      }
      toast({
        title: "Plano gerado",
        description: `Modelo: ${data?.model || "—"} · Origem: ${data?.source === "tenant" ? "config do tenant" : "pool da plataforma"}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao analisar", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Nenhum plano selecionado");
      const res = await apiRequest("POST", `/api/module-planner/${selectedId}/save`, {
        title: titleInput,
        description: descriptionInput,
        plan: planDraft,
        expectedVersion: detail?.plan?.currentVersion,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-planner"] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/module-planner", selectedId] });
      setDirty(false);
      toast({ title: "Rascunho salvo" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Nenhum plano selecionado");
      // Tratamento do 409 "in_progress" do backend: outra requisição está
      // criando a run; fazemos polling do detalhe (até 6× / 12s) procurando
      // o pipelineRunId. Em qualquer outra falha, propaga o erro.
      const tryOnce = async () => apiRequest("POST", `/api/module-planner/${selectedId}/approve`);
      try {
        const res = await tryOnce();
        return (await res.json()) as { runId: string; plan: PlanRow };
      } catch (err: any) {
        const msg = err?.message || "";
        const looksLikeInProgress = msg.includes("Aprovação em andamento") || msg.includes("retry");
        if (!looksLikeInProgress) throw err;
        // Polling do detalhe — quando pipelineRunId aparece, devolvemos como sucesso.
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const detailRes = await apiRequest("GET", `/api/module-planner/${selectedId}`);
          const detailData = (await detailRes.json()) as DetailResponse;
          if (detailData?.plan?.pipelineRunId && detailData?.run) {
            return { runId: detailData.run.id, plan: detailData.plan };
          }
        }
        throw new Error("Aprovação ainda em andamento. Recarregue a página em alguns segundos.");
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-planner"] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/module-planner", selectedId] });
      toast({
        title: "Plano aprovado",
        description: "Pipeline iniciado no Dev Center.",
      });
      // Abre o run em nova aba lateral (preserva o Planejador)
      window.open(`/dev-center/${data.runId}`, "_blank", "noopener");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao aprovar", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  const revertMut = useMutation({
    mutationFn: async (versionId: string) => {
      if (!selectedId) throw new Error("Nenhum plano selecionado");
      const res = await apiRequest("POST", `/api/module-planner/${selectedId}/revert`, {
        versionId,
        expectedVersion: detail?.plan?.currentVersion,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-planner"] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/module-planner", selectedId] });
      setHistoryOpen(false);
      toast({ title: "Plano restaurado" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao reverter", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/module-planner/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/module-planner"] });
      setSelectedId(null);
      toast({ title: "Plano removido" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  // ─── Helpers locais de edição inline ──────────────────────────────────
  const updatePlan = (mut: (p: ModulePlanContract) => ModulePlanContract) => {
    setPlanDraft((prev) => mut(prev));
    setDirty(true);
  };

  const isReadOnly = detail?.plan?.status === "generated";
  const canApprove = !!detail?.plan && !isReadOnly && !dirty && (detail.plan.status === "proposed" || detail.plan.status === "approved");

  const handleNew = () => {
    setSelectedId(null);
    setTitleInput("");
    setDescriptionInput("");
    setPlanDraft(EMPTY_PLAN);
    setDirty(false);
  };

  const handleAnalyze = () => {
    const t = titleInput.trim();
    const d = descriptionInput.trim();
    if (t.length < 3 || d.length < 10) {
      toast({
        title: "Preencha título e descrição",
        description: "Título mínimo 3, descrição mínima 10 caracteres.",
        variant: "destructive",
      });
      return;
    }
    analyzeMut.mutate({
      planId: selectedId ?? undefined,
      title: t,
      description: d,
      expectedVersion: selectedId ? detail?.plan?.currentVersion : undefined,
    });
  };

  // ─── Guard de role ────────────────────────────────────────────────────
  // Module Planner é privilegiado (LLM + pipeline). Backend já devolve 403,
  // mas exibimos uma tela amigável em vez de "Forbidden" do navegador.
  if (roleLoading) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="page-planejador-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-3 text-center" data-testid="page-planejador-denied">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          O Planejador de Módulo dispara LLM e pipeline de deploy. Apenas administradores (superadmin,
          parceiro ou tenant admin) podem acessar. Solicite a um administrador.
        </p>
      </div>
    );
  }

  // ─── Layout ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full p-4 gap-4" data-testid="page-planejador">
      <div className="flex items-center gap-3">
        <Wand2 className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Planejador de Módulo</h1>
          <p className="text-xs text-muted-foreground">
            Descreva em PT o que você precisa. O agente lê o código atual e devolve um plano técnico — você revisa item a item, aprova e o Dev Center gera o código.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleNew} data-testid="button-new-plan" className="gap-2">
          <Plus className="h-4 w-4" /> Novo plano
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        {/* ── ESQUERDO: lista de planos ─────────────────────────────── */}
        <Card className="col-span-3 flex flex-col min-h-0" data-testid="panel-plan-list">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCode2 className="h-4 w-4" /> Planos do tenant
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 flex-1 min-h-0">
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-2 pr-2">
                {listLoading && <Loader2 className="h-4 w-4 animate-spin mx-auto" />}
                {!listLoading && list.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4" data-testid="text-empty-plans">
                    Nenhum plano ainda. Comece descrevendo o que precisa.
                  </p>
                )}
                {list.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`button-plan-${p.id}`}
                    onClick={() => setSelectedId(p.id)}
                    className={`text-left p-2 rounded-md border hover:bg-accent text-xs transition ${selectedId === p.id ? "bg-accent border-primary" : ""}`}
                  >
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={p.status} />
                      <span className="text-[10px] text-muted-foreground">v{p.currentVersion}</span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ── DIREITO: editor do plano ──────────────────────────────── */}
        <Card className="col-span-9 flex flex-col min-h-0" data-testid="panel-plan-editor">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {selectedId ? "Editar plano" : "Novo plano"}
              {detail?.plan && (
                <span className="text-muted-foreground text-xs font-normal">
                  · v{detail.plan.currentVersion} · <StatusBadge status={detail.plan.status} />
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {detail?.versions && detail.versions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryOpen(true)}
                  data-testid="button-open-history"
                  className="gap-2"
                >
                  <History className="h-4 w-4" /> Histórico ({detail.versions.length})
                </Button>
              )}
              {selectedId && !isReadOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMut.mutate(selectedId)}
                  disabled={deleteMut.isPending}
                  data-testid="button-delete-plan"
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Remover
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col gap-3">
            {selectedId && detailLoading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {(!selectedId || (selectedId && detail)) && (
              <ScrollArea className="flex-1 pr-3">
                <div className="space-y-4">
                  {/* ─── INPUT: título + descrição ────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="planejador-title">Título do módulo</Label>
                    <Input
                      id="planejador-title"
                      data-testid="input-title"
                      value={titleInput}
                      onChange={(e) => { setTitleInput(e.target.value); setDirty(true); }}
                      disabled={isReadOnly}
                      placeholder="Ex: Honorários por consultor"
                      maxLength={300}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="planejador-desc">Descrição em português</Label>
                    <Textarea
                      id="planejador-desc"
                      data-testid="textarea-description"
                      value={descriptionInput}
                      onChange={(e) => { setDescriptionInput(e.target.value); setDirty(true); }}
                      disabled={isReadOnly}
                      placeholder="Ex: 'Preciso controlar honorários cobrados por consultor e por hora, com fechamento mensal e relatório por cliente.'"
                      rows={4}
                      maxLength={8000}
                      className="resize-none text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handleAnalyze}
                        disabled={analyzeMut.isPending || isReadOnly}
                        data-testid="button-analyze"
                        className="gap-2"
                      >
                        {analyzeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {selectedId ? "Re-analisar" : "Analisar"}
                      </Button>
                      {selectedId && !isReadOnly && (
                        <Button
                          variant="outline"
                          onClick={() => saveMut.mutate()}
                          disabled={saveMut.isPending || !dirty}
                          data-testid="button-save-draft"
                          className="gap-2"
                        >
                          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Salvar rascunho
                        </Button>
                      )}
                      {selectedId && (
                        <Button
                          onClick={() => approveMut.mutate()}
                          disabled={!canApprove || approveMut.isPending}
                          data-testid="button-approve"
                          className="gap-2 ml-auto"
                          title={!canApprove ? "Salve as edições antes de aprovar." : ""}
                        >
                          {approveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Aprovar e gerar
                        </Button>
                      )}
                    </div>
                    {dirty && selectedId && !isReadOnly && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-dirty">
                        <AlertTriangle className="h-3 w-3" /> Há alterações não salvas. Salve antes de aprovar.
                      </p>
                    )}
                  </div>

                  {/* ─── Run vinculada ────────────────────────────── */}
                  {detail?.run && (
                    <Card data-testid="card-pipeline-run" className="border-primary">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs flex items-center gap-2">
                          <GitMerge className="h-4 w-4" /> Pipeline gerada · {detail.run.status}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs flex items-center justify-between">
                        <span className="text-muted-foreground truncate">{detail.run.title}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/dev-center/${detail.run!.id}`)}
                          data-testid="button-open-run"
                          className="gap-2"
                        >
                          <ExternalLink className="h-3 w-3" /> Abrir no Dev Center
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* ─── Aviso de módulo similar ──────────────────── */}
                  {planDraft.similarModule && (
                    <Card data-testid="card-similar-module" className="border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs flex items-center gap-2 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-4 w-4" /> Módulo similar já existente
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs space-y-1">
                        <p>
                          <strong>{planDraft.similarModule.name}</strong> em{" "}
                          <a
                            href={planDraft.similarModule.route}
                            className="underline text-primary"
                            data-testid="link-similar-module"
                          >
                            {planDraft.similarModule.route}
                          </a>
                        </p>
                        <p className="text-muted-foreground">{planDraft.similarModule.reason}</p>
                        {!isReadOnly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updatePlan((p) => ({ ...p, similarModule: null }))}
                            data-testid="button-clear-similar"
                            className="text-xs h-7 mt-1"
                          >
                            Ignorar este aviso
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* ─── Resumo ──────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label htmlFor="plan-summary">Resumo do plano</Label>
                    <Textarea
                      id="plan-summary"
                      data-testid="textarea-summary"
                      value={planDraft.summary}
                      onChange={(e) => updatePlan((p) => ({ ...p, summary: e.target.value }))}
                      disabled={isReadOnly}
                      rows={3}
                      maxLength={2000}
                      placeholder="Aparecerá após a análise do agente."
                      className="resize-none text-sm"
                    />
                  </div>

                  <Separator />

                  {/* ─── Tabelas ─────────────────────────────────── */}
                  <SectionHeader
                    icon={Rows}
                    title="Tabelas novas"
                    count={planDraft.tables.length}
                    onAdd={isReadOnly ? undefined : () => updatePlan((p) => ({
                      ...p,
                      tables: [...p.tables, { name: "nova_tabela", description: "", columns: [{ name: "coluna_1", type: "varchar" }] }],
                    }))}
                  />
                  <div className="space-y-2">
                    {planDraft.tables.map((t, idx) => (
                      <TableEditor
                        key={idx}
                        index={idx}
                        table={t}
                        readonly={isReadOnly}
                        onChange={(next) => updatePlan((p) => {
                          const arr = [...p.tables];
                          arr[idx] = next;
                          return { ...p, tables: arr };
                        })}
                        onRemove={() => updatePlan((p) => ({ ...p, tables: p.tables.filter((_, i) => i !== idx) }))}
                      />
                    ))}
                  </div>

                  {/* ─── Endpoints ───────────────────────────────── */}
                  <SectionHeader
                    icon={Globe}
                    title="Endpoints REST"
                    count={planDraft.endpoints.length}
                    onAdd={isReadOnly ? undefined : () => updatePlan((p) => ({
                      ...p,
                      endpoints: [...p.endpoints, { method: "GET", path: "/api/", description: "" }],
                    }))}
                  />
                  <div className="space-y-2">
                    {planDraft.endpoints.map((e, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start" data-testid={`row-endpoint-${idx}`}>
                        <select
                          className="col-span-2 h-9 rounded-md border bg-background px-2 text-xs"
                          value={e.method}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.endpoints];
                            arr[idx] = { ...arr[idx], method: ev.target.value as Method };
                            return { ...p, endpoints: arr };
                          })}
                          data-testid={`select-endpoint-method-${idx}`}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                        <Input
                          className="col-span-4 h-9 text-xs font-mono"
                          value={e.path}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.endpoints];
                            arr[idx] = { ...arr[idx], path: ev.target.value };
                            return { ...p, endpoints: arr };
                          })}
                          data-testid={`input-endpoint-path-${idx}`}
                        />
                        <Input
                          className="col-span-5 h-9 text-xs"
                          value={e.description}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.endpoints];
                            arr[idx] = { ...arr[idx], description: ev.target.value };
                            return { ...p, endpoints: arr };
                          })}
                          data-testid={`input-endpoint-desc-${idx}`}
                          placeholder="Descrição"
                        />
                        {!isReadOnly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="col-span-1 h-9 w-9 text-destructive"
                            onClick={() => updatePlan((p) => ({ ...p, endpoints: p.endpoints.filter((_, i) => i !== idx) }))}
                            data-testid={`button-remove-endpoint-${idx}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Badge className={`col-span-12 sm:col-span-2 ${methodColor(e.method)} text-[10px] hidden sm:inline-flex`}>{e.method}</Badge>
                      </div>
                    ))}
                  </div>

                  {/* ─── Páginas ─────────────────────────────────── */}
                  <SectionHeader
                    icon={FileCode2}
                    title="Páginas React"
                    count={planDraft.pages.length}
                    onAdd={isReadOnly ? undefined : () => updatePlan((p) => ({
                      ...p,
                      pages: [...p.pages, { route: "/", name: "NovaPagina", description: "" }],
                    }))}
                  />
                  <div className="space-y-2">
                    {planDraft.pages.map((pg, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-page-${idx}`}>
                        <Input
                          className="col-span-3 h-9 text-xs font-mono"
                          value={pg.route}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.pages]; arr[idx] = { ...arr[idx], route: ev.target.value }; return { ...p, pages: arr };
                          })}
                          data-testid={`input-page-route-${idx}`}
                        />
                        <Input
                          className="col-span-3 h-9 text-xs"
                          value={pg.name}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.pages]; arr[idx] = { ...arr[idx], name: ev.target.value }; return { ...p, pages: arr };
                          })}
                          data-testid={`input-page-name-${idx}`}
                        />
                        <Input
                          className="col-span-5 h-9 text-xs"
                          value={pg.description}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.pages]; arr[idx] = { ...arr[idx], description: ev.target.value }; return { ...p, pages: arr };
                          })}
                          data-testid={`input-page-desc-${idx}`}
                          placeholder="Propósito"
                        />
                        {!isReadOnly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="col-span-1 h-9 w-9 text-destructive"
                            onClick={() => updatePlan((p) => ({ ...p, pages: p.pages.filter((_, i) => i !== idx) }))}
                            data-testid={`button-remove-page-${idx}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* ─── Agentes ─────────────────────────────────── */}
                  <SectionHeader
                    icon={Bot}
                    title="Agentes especializados"
                    count={planDraft.agents.length}
                    onAdd={isReadOnly ? undefined : () => updatePlan((p) => ({
                      ...p,
                      agents: [...p.agents, { name: "Novo agente", role: "", skills: [] }],
                    }))}
                  />
                  <div className="space-y-2">
                    {planDraft.agents.map((a, idx) => (
                      <Card key={idx} data-testid={`card-agent-${idx}`}>
                        <CardContent className="pt-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={a.name}
                              disabled={isReadOnly}
                              onChange={(ev) => updatePlan((p) => {
                                const arr = [...p.agents]; arr[idx] = { ...arr[idx], name: ev.target.value }; return { ...p, agents: arr };
                              })}
                              data-testid={`input-agent-name-${idx}`}
                              className="h-9 text-xs flex-1 font-medium"
                            />
                            {!isReadOnly && (
                              <Button
                                variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                                onClick={() => updatePlan((p) => ({ ...p, agents: p.agents.filter((_, i) => i !== idx) }))}
                                data-testid={`button-remove-agent-${idx}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <Input
                            value={a.role}
                            disabled={isReadOnly}
                            onChange={(ev) => updatePlan((p) => {
                              const arr = [...p.agents]; arr[idx] = { ...arr[idx], role: ev.target.value }; return { ...p, agents: arr };
                            })}
                            data-testid={`input-agent-role-${idx}`}
                            className="h-9 text-xs"
                            placeholder="Papel"
                          />
                          <Input
                            value={a.skills.join(", ")}
                            disabled={isReadOnly}
                            onChange={(ev) => updatePlan((p) => {
                              const skills = ev.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
                              const arr = [...p.agents]; arr[idx] = { ...arr[idx], skills }; return { ...p, agents: arr };
                            })}
                            data-testid={`input-agent-skills-${idx}`}
                            className="h-9 text-xs"
                            placeholder="Skills separadas por vírgula"
                          />
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* ─── Dependências ────────────────────────────── */}
                  <SectionHeader
                    icon={GitMerge}
                    title="Dependências com módulos existentes"
                    count={planDraft.dependencies.length}
                    onAdd={isReadOnly ? undefined : () => updatePlan((p) => ({
                      ...p,
                      dependencies: [...p.dependencies, { module: "", reason: "" }],
                    }))}
                  />
                  <div className="space-y-2">
                    {planDraft.dependencies.map((d, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-dep-${idx}`}>
                        <Input
                          className="col-span-3 h-9 text-xs"
                          value={d.module}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.dependencies]; arr[idx] = { ...arr[idx], module: ev.target.value }; return { ...p, dependencies: arr };
                          })}
                          data-testid={`input-dep-module-${idx}`}
                          placeholder="Módulo"
                        />
                        <Input
                          className="col-span-8 h-9 text-xs"
                          value={d.reason}
                          disabled={isReadOnly}
                          onChange={(ev) => updatePlan((p) => {
                            const arr = [...p.dependencies]; arr[idx] = { ...arr[idx], reason: ev.target.value }; return { ...p, dependencies: arr };
                          })}
                          data-testid={`input-dep-reason-${idx}`}
                          placeholder="Razão da dependência"
                        />
                        {!isReadOnly && (
                          <Button
                            variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-destructive"
                            onClick={() => updatePlan((p) => ({ ...p, dependencies: p.dependencies.filter((_, i) => i !== idx) }))}
                            data-testid={`button-remove-dep-${idx}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Histórico de versões ──────────────────────────────────────── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-history">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Histórico de versões
            </DialogTitle>
            <DialogDescription>
              Cada análise, edição ou aprovação gera uma versão. Reverta para uma anterior se necessário.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-3">
              {/* Versões vêm em ordem decrescente; calculamos diff vs. a versão
                  imediatamente anterior (que aparece logo abaixo no array). */}
              {detail?.versions?.map((v, idx) => {
                const previous = detail.versions[idx + 1]?.planJson;
                const diff = summarizeDiff(previous, v.planJson);
                const isCurrent = v.versionNumber === detail.plan.currentVersion;
                return (
                  <div
                    key={v.id}
                    className="border rounded-md p-3 text-xs space-y-2"
                    data-testid={`row-version-${v.versionNumber}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 space-y-0.5">
                        <div className="font-medium flex items-center gap-2">
                          v{v.versionNumber} — {SOURCE_LABEL[v.source]}
                          {isCurrent && <Badge variant="secondary" className="text-[10px]">Atual</Badge>}
                        </div>
                        <div className="text-muted-foreground" data-testid={`text-version-author-${v.versionNumber}`}>
                          por <span className="font-medium text-foreground">{v.authorName || "—"}</span>
                          {v.createdAt && (
                            <> · {new Date(v.createdAt).toLocaleString("pt-BR")}</>
                          )}
                        </div>
                      </div>
                      {!isReadOnly && !isCurrent && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => revertMut.mutate(v.id)}
                          disabled={revertMut.isPending}
                          data-testid={`button-revert-${v.versionNumber}`}
                          className="gap-2"
                        >
                          <RefreshCcw className="h-3 w-3" /> Reverter
                        </Button>
                      )}
                    </div>
                    {/* Diff visual — counts por seção comparando com a versão anterior */}
                    <div className="flex flex-wrap gap-1.5" data-testid={`diff-version-${v.versionNumber}`}>
                      {diff.map((d, i) => {
                        const isAdd = d.startsWith("+");
                        const isRem = d.startsWith("-");
                        const cls = isAdd
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : isRem
                          ? "bg-destructive/10 text-destructive border-destructive/30"
                          : "bg-muted text-muted-foreground border-muted-foreground/20";
                        return (
                          <Badge key={i} variant="outline" className={`${cls} text-[10px] font-mono`}>
                            {d}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)} data-testid="button-close-history">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ───────────────────────────────────────────────────────────────────────────
interface SectionHeaderProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  onAdd?: () => void;
}
function SectionHeader({ icon: Icon, title, count, onAdd }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span>{title}</span>
        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      </div>
      {onAdd && (
        <Button variant="ghost" size="sm" onClick={onAdd} data-testid={`button-add-${title.toLowerCase().replace(/\s+/g, "-")}`} className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      )}
    </div>
  );
}

interface TableEditorProps {
  index: number;
  table: PlanTable;
  readonly: boolean;
  onChange: (t: PlanTable) => void;
  onRemove: () => void;
}
function TableEditor({ index, table, readonly, onChange, onRemove }: TableEditorProps) {
  return (
    <Card data-testid={`card-table-${index}`}>
      <CardContent className="pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={table.name}
            disabled={readonly}
            onChange={(ev) => onChange({ ...table, name: ev.target.value })}
            data-testid={`input-table-name-${index}`}
            className="h-9 text-xs font-mono font-medium flex-1"
          />
          {!readonly && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={onRemove} data-testid={`button-remove-table-${index}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Input
          value={table.description}
          disabled={readonly}
          onChange={(ev) => onChange({ ...table, description: ev.target.value })}
          data-testid={`input-table-desc-${index}`}
          className="h-9 text-xs"
          placeholder="Descrição da tabela"
        />
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase text-muted-foreground tracking-wide">Colunas</p>
            {!readonly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...table, columns: [...table.columns, { name: "", type: "varchar" }] })}
                data-testid={`button-add-column-${index}`}
                className="h-6 gap-1 text-[11px]"
              >
                <Plus className="h-3 w-3" /> Coluna
              </Button>
            )}
          </div>
          {table.columns.map((c, ci) => (
            <div key={ci} className="grid grid-cols-12 gap-1 items-center" data-testid={`row-column-${index}-${ci}`}>
              <Input
                className="col-span-4 h-8 text-[11px] font-mono"
                value={c.name}
                disabled={readonly}
                onChange={(ev) => {
                  const cols = [...table.columns]; cols[ci] = { ...cols[ci], name: ev.target.value };
                  onChange({ ...table, columns: cols });
                }}
                data-testid={`input-column-name-${index}-${ci}`}
                placeholder="nome"
              />
              <Input
                className="col-span-3 h-8 text-[11px] font-mono"
                value={c.type}
                disabled={readonly}
                onChange={(ev) => {
                  const cols = [...table.columns]; cols[ci] = { ...cols[ci], type: ev.target.value };
                  onChange({ ...table, columns: cols });
                }}
                data-testid={`input-column-type-${index}-${ci}`}
                placeholder="tipo"
              />
              <Input
                className="col-span-4 h-8 text-[11px]"
                value={c.notes ?? ""}
                disabled={readonly}
                onChange={(ev) => {
                  const cols = [...table.columns]; cols[ci] = { ...cols[ci], notes: ev.target.value || undefined };
                  onChange({ ...table, columns: cols });
                }}
                data-testid={`input-column-notes-${index}-${ci}`}
                placeholder="Notas (opcional)"
              />
              {!readonly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="col-span-1 h-8 w-8 text-destructive"
                  onClick={() => onChange({ ...table, columns: table.columns.filter((_, i) => i !== ci) })}
                  data-testid={`button-remove-column-${index}-${ci}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
