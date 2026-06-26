import { useState, useMemo, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Code2, Loader2, CheckCircle2, XCircle, Clock, Sparkles,
  FileCode2, Trash2, Send, ChevronRight, Hammer, ShieldCheck, Rocket,
  Eye, AlertCircle, RefreshCw, Wrench, Settings2, Cpu,
  ExternalLink, Target, MinusCircle, GitBranch, Upload,
} from "lucide-react";
import type { IdePipelineRun, IdeArtifact } from "@shared/schema";
import DocTypePreview from "@/components/devcenter/DocTypePreview";
import ServerScriptPreview from "@/components/devcenter/ServerScriptPreview";
import APIPreview from "@/components/devcenter/APIPreview";
import CodeEditor from "@/components/devcenter/CodeEditor";
import GitViewer from "@/components/devcenter/GitViewer";

interface ModelEntry {
  id: string;
  label: string;
  family: string;
  recommended_for?: string[];
}

interface PreferencesPayload {
  models: ModelEntry[];
  preferences: { modelArchitect: string; modelDeveloper: string; modelQa: string };
}

const PREVIEW_VISITED_KEY = "ide:previewVisitedRuns:v1";

function loadVisitedRuns(): Set<string> {
  try {
    const raw = localStorage.getItem(PREVIEW_VISITED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveVisitedRuns(set: Set<string>) {
  try {
    localStorage.setItem(PREVIEW_VISITED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignora quota
  }
}

interface RunDetail {
  run: IdePipelineRun;
  artifacts: IdeArtifact[];
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Aguardando", color: "bg-muted text-muted-foreground" },
  running_architect: { label: "Arquiteto trabalhando", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  awaiting_design_approval: { label: "Aguardando aprovação do design", color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  running_developer: { label: "Desenvolvedor codando", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  running_qa: { label: "QA revisando", color: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
  awaiting_deploy: { label: "Pronto p/ deploy", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  deploying: { label: "Deployando", color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  deployed: { label: "Deployed", color: "bg-emerald-600 text-white" },
  failed: { label: "Falhou", color: "bg-destructive text-destructive-foreground" },
  cancelled: { label: "Cancelado", color: "bg-muted text-muted-foreground" },
};

const PHASES = [
  { key: "architect", label: "Arquiteto", icon: Sparkles },
  { key: "developer", label: "Desenvolvedor", icon: Hammer },
  { key: "qa", label: "QA & Segurança", icon: ShieldCheck },
  { key: "devops", label: "Deploy", icon: Rocket },
];

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABEL[status] || { label: status, color: "bg-muted" };
  return <Badge className={meta.color} data-testid={`badge-status-${status}`}>{meta.label}</Badge>;
}

function isRunning(status: string) {
  return ["pending", "running_architect", "running_developer", "running_qa", "deploying"].includes(status);
}

export default function DevCenter() {
  const [, params] = useRoute<{ runId: string }>("/dev-center/:runId");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const selectedRunId = params?.runId ?? null;

  // Form state
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  // Sprint 6 — alvo do deploy (Frappe é o default histórico).
  const [target, setTarget] = useState<"frappe" | "suite" | "consult" | "consultoria" | "standalone" | "clone">("frappe");

  // Sprint 3C — preferências de modelo por fase
  const { data: prefsData } = useQuery<PreferencesPayload>({
    queryKey: ["/api/ide/preferences"],
  });

  const updatePrefs = useMutation({
    mutationFn: async (patch: Partial<PreferencesPayload["preferences"]>) => {
      const res = await apiRequest("PATCH", "/api/ide/preferences", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/preferences"] });
      toast({ title: "Preferência salva" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar preferência", description: err?.message, variant: "destructive" });
    },
  });

  // Set de runs cujo Preview já foi visitado (gating do Aprovar deploy).
  const [previewVisited, setPreviewVisited] = useState<Set<string>>(() => loadVisitedRuns());
  const markPreviewVisited = (runId: string) => {
    setPreviewVisited((prev) => {
      if (prev.has(runId)) return prev;
      const next = new Set(prev);
      next.add(runId);
      saveVisitedRuns(next);
      return next;
    });
  };

  // Lista de runs
  const { data: runs = [], isLoading: runsLoading } = useQuery<IdePipelineRun[]>({
    queryKey: ["/api/ide/runs"],
    refetchInterval: (q) => {
      const data = q.state.data as IdePipelineRun[] | undefined;
      return data?.some((r) => isRunning(r.status)) ? 2500 : false;
    },
  });

  // Detalhe da run selecionada
  const { data: detail, isLoading: detailLoading } = useQuery<RunDetail>({
    queryKey: ["/api/ide/runs", selectedRunId],
    enabled: !!selectedRunId,
    refetchInterval: (q) => {
      const d = q.state.data as RunDetail | undefined;
      return d?.run && isRunning(d.run.status) ? 2000 : false;
    },
  });

  // Híbrido: confia primeiro na verdade do servidor (run.previewVisitedAt),
  // e cai pro localStorage só como UX rápida durante a sessão.
  const canApprove = selectedRunId
    ? Boolean((detail?.run as any)?.previewVisitedAt) || previewVisited.has(selectedRunId)
    : false;

  const createRun = useMutation({
    mutationFn: async (input: { title: string; requirement: string; target: string }) => {
      const res = await apiRequest("POST", "/api/ide/runs", input);
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (out) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs"] });
      setTitle(""); setRequirement("");
      // mantém o target selecionado para próximas runs
      navigate(`/dev-center/${out.id}`);
      toast({ title: "Pipeline iniciado", description: "Os agentes começaram a trabalhar." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao iniciar pipeline", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  const deleteRun = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ide/runs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs"] });
      if (selectedRunId) navigate("/dev-center");
      toast({ title: "Run removida" });
    },
  });

  const approveDeploy = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/ide/runs/${id}/approve-deploy`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs", selectedRunId] });
      toast({ title: "Deploy aprovado", description: "Sprint 1: simbólico — execução real no Frappe será habilitada no Sprint 2." });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err?.message || "Falha", variant: "destructive" });
    },
  });

  // Marca visita ao Preview no servidor (gate de aprovação real fica server-side).
  // Idempotente — só grava na primeira chamada.
  const visitPreview = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("POST", `/api/ide/runs/${id}/preview-visit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs", selectedRunId] });
    },
    onError: (err: any) => {
      // Reverte o flag local para evitar UI mostrar "liberado" quando o backend
      // ainda não registrou a visita.
      if (selectedRunId) {
        setPreviewVisited((prev) => {
          if (!prev.has(selectedRunId)) return prev;
          const next = new Set(prev);
          next.delete(selectedRunId);
          saveVisitedRuns(next);
          return next;
        });
      }
      toast({
        title: "Não foi possível registrar visita ao Preview",
        description: err?.message || "Tente recarregar e abrir a aba Preview novamente.",
        variant: "destructive",
      });
    },
  });

  // Dedup por runId — evita disparos duplicados sem bloquear marcações
  // de outras runs em paralelo (handlePreviewVisit pode ser chamado em
  // sucessão pelo clique manual + efeito do auto-focus).
  const inFlightVisitRef = useRef<Set<string>>(new Set());
  const handlePreviewVisit = (runId: string) => {
    markPreviewVisited(runId);
    if ((detail?.run as any)?.previewVisitedAt) return;
    if (inFlightVisitRef.current.has(runId)) return;
    inFlightVisitRef.current.add(runId);
    visitPreview.mutate(runId, {
      onSettled: () => {
        inFlightVisitRef.current.delete(runId);
      },
    });
  };

  const handleSubmit = () => {
    if (title.trim().length < 3 || requirement.trim().length < 10) {
      toast({ title: "Preencha título e requisito", description: "Título mínimo 3, requisito mínimo 10 caracteres.", variant: "destructive" });
      return;
    }
    createRun.mutate({ title: title.trim(), requirement: requirement.trim(), target });
  };

  // Sprint 3A — Re-validação focada (só roda se houver edições)
  const revalidate = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/ide/runs/${id}/revalidate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs", selectedRunId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs"] });
      toast({ title: "Re-validação iniciada", description: "QA está revisando suas edições." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao re-validar", description: err?.message, variant: "destructive" });
    },
  });

  // Sprint 3B — Auto-correção a partir de erro de deploy
  const retryWithFix = useMutation({
    mutationFn: async ({ id, errorMessage }: { id: string; errorMessage: string }) => {
      const res = await apiRequest("POST", `/api/ide/runs/${id}/retry-with-fix`, { errorMessage });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs", selectedRunId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ide/runs"] });
      toast({
        title: data.recovered ? "Correção bem-sucedida" : "Correção aplicada — verifique QA",
        description: `Tentativa ${data.attempts}/2. Restantes: ${data.attemptsRemaining}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Erro na auto-correção", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full p-4 gap-4" data-testid="page-dev-center">
      <div className="flex items-center gap-3">
        <Code2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-title">Dev Center IDE Autônoma</h1>
          <p className="text-xs text-muted-foreground">
            Sprint 1 — Pipeline Arquiteto → Desenvolvedor → QA com aprovação humana antes do deploy.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        {/* ─── Painel ESQUERDO: Copilot ─────────────────────────────── */}
        <Card className="col-span-3 flex flex-col min-h-0" data-testid="panel-copilot">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Copilot
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wide">
                Alvo do deploy
              </label>
              <Select value={target} onValueChange={(v) => setTarget(v as any)}>
                <SelectTrigger data-testid="select-target" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frappe" data-testid="option-target-frappe">Frappe / ERPNext (deploy real)</SelectItem>
                  <SelectItem value="suite" data-testid="option-target-suite">Arcádia Suite (TS/React)</SelectItem>
                  <SelectItem value="consult" data-testid="option-target-consult">Arcádia Consult (self-deploy)</SelectItem>
                  <SelectItem value="consultoria" data-testid="option-target-consultoria">Consultoria (documental)</SelectItem>
                  <SelectItem value="standalone" data-testid="option-target-standalone">Standalone (microserviço)</SelectItem>
                  <SelectItem value="clone" data-testid="option-target-clone">Clone / Refactor (Gitea)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {target === "frappe" && "DocTypes/Server Scripts criados no Frappe via API. Guardrail bloqueia DocTypes core."}
                {target === "suite" && "Artefatos TypeScript/React; deploy real será adicionado em sprint futura."}
                {target === "consult" && "Auto-evolução do Arcádia Consult: TS/React/Drizzle commitado no Git interno + Coolify (opt-in)."}
                {target === "consultoria" && "Templates e documentos consultivos (markdown). Sem efeito em sistema."}
                {target === "standalone" && "Aplicação isolada Node/Python. Sem efeito em sistema."}
                {target === "clone" && "Inclua 'Repo: owner/nome' no requisito para o Arquiteto ler arquivos do repositório."}
              </p>
            </div>
            <Input
              data-testid="input-title"
              placeholder="Título da entrega"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
            />
            <Textarea
              data-testid="textarea-requirement"
              placeholder="Descreva o que precisa ser construído. Ex: 'Criar DocType Contrato Cliente com campos cliente, valor mensal, data início e workflow draft→ativo→encerrado.'"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              className="resize-none flex-1 text-xs"
              rows={8}
            />

            {prefsData && (
              <Accordion type="single" collapsible className="w-full" data-testid="accordion-advanced">
                <AccordionItem value="advanced" className="border-b-0">
                  <AccordionTrigger className="text-xs py-2" data-testid="accordion-advanced-trigger">
                    <span className="flex items-center gap-1.5">
                      <Settings2 className="h-3.5 w-3.5" /> Configurações avançadas
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pt-1">
                      <ModelSelect
                        label="Arquiteto"
                        testId="select-model-architect"
                        value={prefsData.preferences.modelArchitect}
                        models={prefsData.models}
                        onChange={(v) => updatePrefs.mutate({ modelArchitect: v })}
                      />
                      <ModelSelect
                        label="Desenvolvedor"
                        testId="select-model-developer"
                        value={prefsData.preferences.modelDeveloper}
                        models={prefsData.models}
                        onChange={(v) => updatePrefs.mutate({ modelDeveloper: v })}
                      />
                      <ModelSelect
                        label="QA"
                        testId="select-model-qa"
                        value={prefsData.preferences.modelQa}
                        models={prefsData.models}
                        onChange={(v) => updatePrefs.mutate({ modelQa: v })}
                      />
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        Aplica-se a partir da próxima run. Modelos validados contra catálogo Anthropic.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            <Button
              data-testid="button-submit"
              onClick={handleSubmit}
              disabled={createRun.isPending}
              className="gap-2"
            >
              {createRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Iniciar pipeline
            </Button>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">Histórico de runs</p>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-2 pr-2">
                {runsLoading && <Loader2 className="h-4 w-4 animate-spin mx-auto" />}
                {!runsLoading && runs.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4" data-testid="text-empty-runs">
                    Nenhuma run ainda.
                  </p>
                )}
                {runs.map((r) => (
                  <button
                    key={r.id}
                    data-testid={`button-run-${r.id}`}
                    onClick={() => navigate(`/dev-center/${r.id}`)}
                    className={`text-left p-2 rounded-md border hover:bg-accent text-xs transition ${selectedRunId === r.id ? "bg-accent border-primary" : ""}`}
                  >
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={r.status} />
                      {isRunning(r.status) && <Loader2 className="h-3 w-3 animate-spin" />}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ─── Painel CENTRAL: Editor (read-only Sprint 1) ──────────── */}
        <Card className="col-span-6 flex flex-col min-h-0" data-testid="panel-editor">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCode2 className="h-4 w-4" /> Editor
              {detail?.run.title && <span className="text-muted-foreground text-xs font-normal">— {detail.run.title}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {!selectedRunId && (
              <EmptyEditor />
            )}
            {selectedRunId && detailLoading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {selectedRunId && detail && (
              <EditorView
                detail={detail}
                onPreviewVisit={() => handlePreviewVisit(selectedRunId)}
                onRevalidate={() => revalidate.mutate(selectedRunId)}
                revalidating={revalidate.isPending}
              />
            )}
          </CardContent>
        </Card>

        {/* ─── Painel DIREITO: Pipeline ─────────────────────────────── */}
        <Card className="col-span-3 flex flex-col min-h-0" data-testid="panel-pipeline">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" /> Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 flex-1 min-h-0">
            {!selectedRunId && (
              <p className="text-xs text-muted-foreground text-center py-8">
                Selecione uma run para ver o status.
              </p>
            )}
            {selectedRunId && detail && (
              <PipelinePanel
                detail={detail}
                onApprove={() => approveDeploy.mutate(selectedRunId)}
                onDelete={() => deleteRun.mutate(selectedRunId)}
                onRetryWithFix={(errorMessage) =>
                  retryWithFix.mutate({ id: selectedRunId, errorMessage })
                }
                approving={approveDeploy.isPending}
                deleting={deleteRun.isPending}
                retrying={retryWithFix.isPending}
                canApprove={canApprove}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ModelSelect({
  label, testId, value, models, onChange,
}: {
  label: string;
  testId: string;
  value: string;
  models: ModelEntry[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId} className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs" data-testid={`${testId}-option-${m.id}`}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ModelsBanner({ run }: { run: IdePipelineRun }) {
  const a = run.modelArchitect;
  const d = run.modelDeveloper;
  const q = run.modelQa;
  if (!a && !d && !q) return null;
  // Encurta para legibilidade — última parte do id
  const short = (m: string | null | undefined) => {
    if (!m) return "—";
    return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  };
  return (
    <div
      className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/40 border rounded px-2 py-1"
      data-testid="banner-models"
    >
      <Cpu className="h-3 w-3" />
      <span>
        Modelos da run: Architect=<strong>{short(a)}</strong> · Dev=<strong>{short(d)}</strong> · QA=<strong>{short(q)}</strong>
      </span>
    </div>
  );
}

// Sprint 3B — Test harness: dialog para simular um erro de deploy.
// Usado SOMENTE durante Sprint 3 para validar o loop de auto-correção.
// No Sprint 6+, o erro virá automaticamente do executeDeploy() do Frappe.
function SimulateDeployErrorButton({
  onSubmit, retrying,
}: {
  onSubmit: (errorMessage: string) => void;
  retrying: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(
    "ImportError: cannot import name 'cstr' from 'frappe.utils' (linha 12 do server_script). Verifique imports.",
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
          data-testid="button-simulate-deploy-error"
        >
          <AlertCircle className="h-3 w-3" /> Simular erro de deploy (teste)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simular falha de deploy</DialogTitle>
          <DialogDescription>
            Apenas para validar o loop de auto-correção do Sprint 3. No Sprint 6 o erro virá automaticamente do Frappe.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={6}
          className="font-mono text-xs"
          data-testid="textarea-simulated-error"
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={retrying}
            data-testid="button-cancel-simulation"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSubmit(msg);
              setOpen(false);
            }}
            disabled={retrying || msg.trim().length < 3}
            data-testid="button-confirm-simulation"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            Disparar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoolifyStatusBadge({ status }: { status?: string }) {
  const s = (status || "").toLowerCase();
  let label = status || "—";
  let cls = "border-muted-foreground/30 text-muted-foreground";
  if (["finished", "success", "succeeded"].includes(s)) {
    label = "deployed";
    cls = "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";
  } else if (["failed", "error", "cancelled-by-user", "cancelled"].includes(s)) {
    label = s;
    cls = "border-destructive/40 text-destructive bg-destructive/10";
  } else if (["queued", "in_progress", "running", "deploying"].includes(s)) {
    label = s;
    cls = "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/10";
  } else if (s === "timeout") {
    label = "timeout";
    cls = "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10";
  }
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cls}`} data-testid="badge-coolify-status">
      {label}
    </Badge>
  );
}

function ExportToRemoteDialog({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("main");

  const exportMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { remoteUrl, branch: branch || "main" };
      if (token.trim()) body.token = token.trim();
      const res = await apiRequest("POST", `/api/ide/runs/${runId}/export-remote`, body);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Repositório exportado",
        description: `Push ok para ${data?.remote ?? "remote"} (branch ${data?.branch ?? "main"})${data?.sha ? ` @ ${String(data.sha).slice(0, 8)}` : ""}.`,
      });
      setOpen(false);
      setToken("");
    },
    onError: (err: any) => {
      toast({
        title: "Falha ao exportar",
        description: err?.message ?? "Erro desconhecido",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 w-full"
          data-testid="button-export-remote"
        >
          <Upload className="h-3 w-3" /> Exportar para GitHub/GitLab
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exportar repositório interno</DialogTitle>
          <DialogDescription>
            Empurra o histórico do repositório interno deste tenant para um remote externo
            (GitHub, GitLab, Bitbucket ou Codeberg). O remote é removido após o push — credenciais
            não ficam persistidas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="export-url" className="text-xs">URL HTTPS do remote</Label>
            <Input
              id="export-url"
              placeholder="https://github.com/usuario/repo.git"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              data-testid="input-remote-url"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="export-token" className="text-xs">Token de acesso (opcional)</Label>
            <Input
              id="export-token"
              type="password"
              placeholder="ghp_... / glpat-..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="input-remote-token"
            />
            <p className="text-[10px] text-muted-foreground">
              Use Personal Access Token com permissão de push. Repos públicos ainda exigem token.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="export-branch" className="text-xs">Branch (default: main)</Label>
            <Input
              id="export-branch"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              data-testid="input-remote-branch"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={exportMutation.isPending}
            data-testid="button-cancel-export"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || !remoteUrl.trim()}
            data-testid="button-confirm-export"
          >
            {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Push para remote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyEditor() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <Code2 className="h-12 w-12 opacity-40" />
      <p className="text-sm" data-testid="text-empty-editor">Descreva um requisito no Copilot para começar</p>
      <p className="text-xs text-center max-w-md opacity-70">
        O Arquiteto desenha a solução, o Desenvolvedor escreve o código,
        o QA revisa segurança e padrões Frappe. Você aprova o deploy.
      </p>
    </div>
  );
}

function EditorView({
  detail,
  onPreviewVisit,
  onRevalidate,
  revalidating,
}: {
  detail: RunDetail;
  onPreviewVisit: () => void;
  onRevalidate: () => void;
  revalidating: boolean;
}) {
  const { run, artifacts } = detail;
  const hasArtifacts = artifacts.length > 0;
  const designDoc = run.designDoc as any;
  const qaReport = run.qaReport as any;
  const qaPassed = qaReport?.verdict === "PASS";
  const editedCount = artifacts.filter((a) => a.isEdited).length;
  const editorReadOnly = ["deployed", "cancelled", "running_architect", "running_developer", "running_qa", "deploying"].includes(run.status);

  const docTypeArtifacts = useMemo(
    () => artifacts.filter((a) => a.kind === "doctype"),
    [artifacts],
  );
  const serverScriptArtifacts = useMemo(
    () => artifacts.filter((a) => a.kind === "server_script"),
    [artifacts],
  );

  const tabs = useMemo(() => {
    const list: Array<{ key: string; label: string }> = [];
    if (designDoc) list.push({ key: "__design", label: "Design Doc" });
    artifacts.forEach((a) => list.push({ key: a.id, label: a.fileName }));
    if (qaReport) list.push({ key: "__qa", label: "QA Report" });
    if (qaPassed) list.push({ key: "__preview", label: "👁 Preview" });
    // Sprint 5 — aba Git: sempre visível (mostra mensagem se ainda não foi
    // feito deploy, ou se o tenant não tem Gitea cadastrado).
    list.push({ key: "__git", label: "🔀 Git" });
    return list;
  }, [designDoc, artifacts, qaReport, qaPassed]);

  const defaultTab = hasArtifacts ? artifacts[0].id : tabs[0]?.key || "__design";
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  // Quando QA passa, focar Preview automaticamente (uma vez por run).
  const [autoFocused, setAutoFocused] = useState(false);
  useEffect(() => {
    if (qaPassed && !autoFocused) {
      setActiveTab("__preview");
      setAutoFocused(true);
    }
  }, [qaPassed, autoFocused]);

  // Reset autoFocus se mudar de run.
  useEffect(() => {
    setAutoFocused(false);
    setActiveTab((prev) => (tabs.find((t) => t.key === prev) ? prev : defaultTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // Quando user entra na aba Preview, marca como visitado.
  const handleTabChange = (next: string) => {
    setActiveTab(next);
    if (next === "__preview") onPreviewVisit();
  };

  // Garante que mudanças programáticas para "__preview" (ex.: auto-focus)
  // também marquem visita server-side, sem depender do clique do usuário.
  // Guard: só dispara quando a aba Preview EXISTE para esta run (qaPassed) e
  // a marcação ainda não foi feita para este run.id (ref dedupa entre renders).
  const visitedRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTab !== "__preview") return;
    if (!qaPassed) return;
    if (visitedRunRef.current === run.id) return;
    visitedRunRef.current = run.id;
    onPreviewVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, run.id, qaPassed]);

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Aguardando saída dos agentes…</p>
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col" data-testid="tabs-editor">
      <div className="flex items-center gap-2">
        <ScrollArea className="flex-1 whitespace-nowrap">
          <TabsList className="inline-flex h-9">
            {tabs.map((t) => {
              const art = artifacts.find((a) => a.id === t.key);
              const edited = art?.isEdited;
              return (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  data-testid={`tab-${t.key}`}
                  className={`text-xs ${t.key === "__preview" ? "data-[state=active]:bg-emerald-600 data-[state=active]:text-white" : ""}`}
                >
                  {edited && <span className="text-amber-600 mr-1" title="Editado">✏</span>}
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </ScrollArea>
        {editedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRevalidate}
            disabled={revalidating || ["running_architect", "running_developer", "running_qa", "deploying"].includes(run.status)}
            data-testid="button-revalidate"
            className="h-8 text-xs gap-1.5 shrink-0"
          >
            {revalidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-validar com QA ({editedCount})
          </Button>
        )}
      </div>
      <ModelsBanner run={run} />
      {designDoc && (
        <TabsContent value="__design" className="flex-1 mt-2 min-h-0">
          <ScrollArea className="h-full">
            <DesignDocView doc={designDoc} />
          </ScrollArea>
        </TabsContent>
      )}
      {artifacts.map((a) => (
        <TabsContent key={a.id} value={a.id} className="flex-1 mt-2 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground shrink-0">
            <Badge variant="outline" className="font-mono text-[10px]">{a.fileName}</Badge>
            <Badge variant="outline">{a.kind}</Badge>
            <Badge variant="outline">{a.phase}</Badge>
          </div>
          <div className="flex-1 min-h-0">
            <CodeEditor
              runId={run.id}
              artifactId={a.id}
              initialContent={a.content}
              language={a.language}
              isEdited={a.isEdited}
              originalContent={a.originalContent ?? null}
              readOnly={editorReadOnly}
            />
          </div>
        </TabsContent>
      ))}
      {qaReport && (
        <TabsContent value="__qa" className="flex-1 mt-2 min-h-0">
          <ScrollArea className="h-full">
            <QaReportView report={qaReport} />
          </ScrollArea>
        </TabsContent>
      )}
      {qaPassed && (
        <TabsContent value="__preview" className="flex-1 mt-2 min-h-0">
          <ScrollArea className="h-full">
            <PreviewView
              docTypes={docTypeArtifacts}
              serverScripts={serverScriptArtifacts}
            />
          </ScrollArea>
        </TabsContent>
      )}
      <TabsContent value="__git" className="flex-1 mt-2 min-h-0">
        <GitViewer projectId={run.id} gitRepoUrl={(run as any).gitRepoUrl ?? null} />
      </TabsContent>
    </Tabs>
  );
}

function PreviewView({
  docTypes,
  serverScripts,
}: {
  docTypes: IdeArtifact[];
  serverScripts: IdeArtifact[];
}) {
  // Sub-tabs do Preview: DocType(s) → Server Script(s) → API
  const subTabs = useMemo(() => {
    const list: Array<{ key: string; label: string }> = [];
    docTypes.forEach((d, i) => list.push({ key: `dt-${d.id}`, label: `📋 ${d.fileName.split("/").pop() || `DocType ${i + 1}`}` }));
    serverScripts.forEach((s, i) => list.push({ key: `ss-${s.id}`, label: `🐍 ${s.fileName.split("/").pop() || `Script ${i + 1}`}` }));
    list.push({ key: "api", label: "🌐 API" });
    return list;
  }, [docTypes, serverScripts]);

  const defaultSub = subTabs[0]?.key || "api";

  return (
    <div className="space-y-3" data-testid="view-preview">
      <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-500/5 border border-emerald-500/30 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Código aprovado pelo QA</p>
          <p className="text-muted-foreground mt-0.5">
            Revise o preview antes de aprovar o deploy. O botão <strong>Aprovar deploy</strong> só fica disponível após você visitar esta aba.
          </p>
        </div>
      </div>

      <Tabs defaultValue={defaultSub} className="w-full">
        <ScrollArea className="w-full whitespace-nowrap">
          <TabsList className="inline-flex h-8">
            {subTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`subtab-${t.key}`} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        {docTypes.map((d) => (
          <TabsContent key={`dt-${d.id}`} value={`dt-${d.id}`} className="mt-3">
            <DocTypePreview rawJson={d.content} fileName={d.fileName} />
          </TabsContent>
        ))}

        {serverScripts.map((s) => (
          <TabsContent key={`ss-${s.id}`} value={`ss-${s.id}`} className="mt-3">
            <ServerScriptPreview code={s.content} fileName={s.fileName} language={s.language} />
          </TabsContent>
        ))}

        <TabsContent value="api" className="mt-3">
          <APIPreview />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DesignDocView({ doc }: { doc: any }) {
  return (
    <div className="space-y-3 text-sm" data-testid="view-design-doc">
      <div>
        <h3 className="font-semibold">{doc.title}</h3>
        <p className="text-xs text-muted-foreground">{doc.summary}</p>
      </div>
      {doc.viability && (
        <div className="border rounded-md p-3 bg-muted/30">
          <p className="text-xs font-medium">Viabilidade · {doc.viability.decision}</p>
          {doc.viability.nativeAlternative && (
            <p className="text-xs text-muted-foreground mt-1">
              Alternativa nativa: {doc.viability.nativeAlternative}
            </p>
          )}
        </div>
      )}
      {Array.isArray(doc.files) && doc.files.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1">Arquivos planejados ({doc.files.length})</p>
          <ul className="text-xs space-y-1">
            {doc.files.map((f: any, i: number) => (
              <li key={i} className="border rounded p-2">
                <code className="text-[11px]">{f.path}</code>
                <span className="ml-2 text-muted-foreground">— {f.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(doc.permissions) && doc.permissions.length > 0 && (
        <Section title="Permissões" items={doc.permissions} />
      )}
      {Array.isArray(doc.risks) && doc.risks.length > 0 && (
        <Section title="Riscos" items={doc.risks} />
      )}
      {Array.isArray(doc.manualTests) && doc.manualTests.length > 0 && (
        <Section title="Testes manuais" items={doc.manualTests} />
      )}
      {Array.isArray(doc.assumptions) && doc.assumptions.length > 0 && (
        <Section title="Suposições" items={doc.assumptions} />
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium mb-1">{title}</p>
      <ul className="text-xs list-disc pl-4 space-y-0.5 text-muted-foreground">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function QaReportView({ report }: { report: any }) {
  const verdict = report.verdict as "PASS" | "FAIL";
  const stats = report.stats || {};
  return (
    <div className="space-y-3 text-sm" data-testid="view-qa-report">
      <div className={`border rounded-md p-3 flex items-center gap-3 ${verdict === "PASS" ? "bg-emerald-500/5 border-emerald-500/30" : "bg-destructive/5 border-destructive/30"}`}>
        {verdict === "PASS" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-destructive" />}
        <div>
          <p className="text-sm font-semibold">{verdict}</p>
          <p className="text-xs text-muted-foreground">{report.summary}</p>
        </div>
      </div>
      <div className="flex gap-2 text-xs">
        <Badge variant="destructive">{stats.critical || 0} críticos</Badge>
        <Badge className="bg-orange-500 text-white">{stats.high || 0} altos</Badge>
        <Badge variant="secondary">{stats.medium || 0} médios</Badge>
        <Badge variant="outline">{stats.low || 0} baixos</Badge>
      </div>
      {Array.isArray(report.findings) && report.findings.length > 0 && (
        <div className="space-y-2">
          {report.findings.map((f: any, i: number) => (
            <div key={i} className="border rounded p-2 text-xs" data-testid={`finding-${i}`}>
              <div className="flex items-center gap-2 mb-1">
                <SeverityBadge severity={f.severity} />
                <Badge variant="outline">{f.category}</Badge>
                <code className="text-[11px] truncate">{f.file}</code>
              </div>
              <p className="font-medium">{f.issue}</p>
              <p className="text-muted-foreground mt-1">→ {f.suggestion}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-destructive text-destructive-foreground",
    high: "bg-orange-500 text-white",
    medium: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
    low: "bg-muted text-muted-foreground",
  };
  return <Badge className={map[severity] || ""}>{severity}</Badge>;
}

function PipelinePanel({
  detail, onApprove, onDelete, onRetryWithFix, approving, deleting, retrying, canApprove,
}: {
  detail: RunDetail;
  onApprove: () => void;
  onDelete: () => void;
  onRetryWithFix: (errorMessage: string) => void;
  approving: boolean;
  deleting: boolean;
  retrying: boolean;
  canApprove: boolean;
}) {
  const { run } = detail;
  const autoFixAttempts = (run as any).autoFixAttempts ?? 0;
  const lastDeployError = (run as any).lastDeployError as string | null;
  const canAutoFix = lastDeployError && autoFixAttempts < 2;
  const target = ((run as any).target ?? "frappe") as string;
  const deployResult = (run as any).deployResult as
    | {
        steps?: Array<{ kind: string; name?: string; status: string; message?: string; doctypeUrl?: string }>;
        doctypeUrl?: string;
        target?: string;
        commitSha?: string;
        repoUrl?: string;
        coolify?: { appUuid?: string; deploymentUuid?: string | null; status?: string; error?: string } | null;
        consultUrl?: string | null;
        docs?: { applied?: boolean; reason?: string } | null;
      }
    | null
    | undefined;
  const TARGET_LABELS: Record<string, string> = {
    frappe: "Frappe",
    suite: "Suite",
    consult: "Consult",
    standalone: "Standalone",
    clone: "Clone",
  };
  const phaseIndex = (() => {
    if (run.status === "deployed") return 4;
    if (run.status === "deploying") return 3;
    if (run.status === "awaiting_deploy") return 3;
    if (run.currentPhase === "qa") return 2;
    if (run.currentPhase === "developer") return 1;
    if (run.currentPhase === "architect") return 0;
    return -1;
  })();
  return (
    <>
      <StatusBadge status={run.status} />
      <ScrollArea className="flex-1">
        <div className="space-y-2">
          {PHASES.map((p, i) => {
            const Done = phaseIndex > i || run.status === "deployed";
            const Active = phaseIndex === i && isRunning(run.status);
            return (
              <div
                key={p.key}
                data-testid={`phase-${p.key}`}
                className={`flex items-center gap-2 p-2 rounded border text-xs ${Done ? "bg-emerald-500/5 border-emerald-500/20" : Active ? "bg-blue-500/5 border-blue-500/30" : "bg-muted/20"}`}
              >
                <p.icon className={`h-4 w-4 ${Done ? "text-emerald-600" : Active ? "text-blue-600 animate-pulse" : "text-muted-foreground"}`} />
                <span className="flex-1">{p.label}</span>
                {Done && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                {Active && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {run.errorMessage && (
        <div className="text-xs p-2 rounded bg-destructive/10 text-destructive border border-destructive/20" data-testid="text-error">
          {run.errorMessage}
        </div>
      )}

      {lastDeployError && (
        <div className="text-xs p-2 rounded bg-orange-500/10 border border-orange-500/30 space-y-2" data-testid="panel-deploy-error">
          <div className="flex items-start gap-1.5 text-orange-700 dark:text-orange-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Erro de deploy ({autoFixAttempts}/2 tentativas)</p>
              <pre className="text-[10px] mt-1 whitespace-pre-wrap font-mono opacity-90 max-h-24 overflow-auto">{lastDeployError}</pre>
            </div>
          </div>
          {canAutoFix && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetryWithFix(lastDeployError)}
              disabled={retrying}
              className="w-full h-7 text-xs gap-1.5"
              data-testid="button-auto-fix"
            >
              {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Corrigir automaticamente
            </Button>
          )}
          {!canAutoFix && (
            <p className="text-[10px] text-muted-foreground">
              Limite de auto-correção atingido. Edite manualmente e use "Re-validar com QA".
            </p>
          )}
        </div>
      )}

      {/* Sprint 6 — Badge do alvo do deploy */}
      <div className="flex items-center gap-1.5" data-testid="badge-target">
        <Target className="h-3 w-3 text-muted-foreground" />
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {TARGET_LABELS[target] ?? target}
        </Badge>
      </div>

      {/* Fase 1 — Consult: SHA do commit interno, status do Coolify e export */}
      {target === "consult" && deployResult && (deployResult.commitSha || deployResult.coolify) && (
        <div className="space-y-1.5" data-testid="panel-consult-deploy">
          <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
            Self-deploy do Consult
          </div>
          {deployResult.commitSha && (
            <div className="flex items-center gap-2 text-[11px] p-1.5 rounded border bg-muted/10" data-testid="text-commit-sha">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">commit</span>
              <code className="font-mono text-[10px] text-foreground/80">{deployResult.commitSha.slice(0, 12)}</code>
            </div>
          )}
          {deployResult.coolify && (
            <div className="flex items-center gap-2 text-[11px] p-1.5 rounded border bg-muted/10" data-testid="text-coolify-status">
              <Rocket className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Coolify</span>
              <CoolifyStatusBadge status={deployResult.coolify.status} />
              {deployResult.coolify.error && (
                <span className="text-destructive text-[10px] truncate">{deployResult.coolify.error}</span>
              )}
            </div>
          )}
          {deployResult.docs?.applied !== undefined && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground" data-testid="text-docs-status">
              <FileCode2 className="h-3 w-3" />
              docs: {deployResult.docs.reason ?? (deployResult.docs.applied ? "atualizado" : "não atualizado")}
            </div>
          )}
          {(run.status === "deployed" || run.status === "failed") && (
            <ExportToRemoteDialog runId={run.id} />
          )}
        </div>
      )}

      {/* Sprint 6 — Steps do deploy real (Frappe) com ícones por status */}
      {deployResult?.steps && deployResult.steps.length > 0 && (
        <div className="space-y-1.5" data-testid="panel-deploy-steps">
          <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
            Resultado do deploy
          </div>
          {deployResult.steps.map((s, i) => {
            const Icon =
              s.status === "success" ? CheckCircle2 :
              s.status === "error" ? XCircle :
              MinusCircle;
            const color =
              s.status === "success" ? "text-emerald-600" :
              s.status === "error" ? "text-destructive" :
              "text-muted-foreground";
            return (
              <div
                key={`${s.kind}-${i}`}
                className="flex items-start gap-2 text-[11px] p-1.5 rounded border bg-muted/10"
                data-testid={`deploy-step-${i}`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${color}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {s.kind}{s.name ? ` · ${s.name}` : ""}
                  </div>
                  {s.message && (
                    <div className="text-foreground/80 break-words">{s.message}</div>
                  )}
                  {s.doctypeUrl && (
                    <a
                      href={s.doctypeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-0.5"
                      data-testid={`link-doctype-${i}`}
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir DocType no Frappe
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {deployResult.doctypeUrl && (
            <a
              href={deployResult.doctypeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid="link-deploy-doctype"
            >
              <ExternalLink className="h-3 w-3" /> Abrir DocType no Frappe
            </a>
          )}
        </div>
      )}

      {/* Sprint 3B — Test harness manual: simula falha de deploy para validar o loop */}
      {run.status === "awaiting_deploy" && autoFixAttempts < 2 && (
        <SimulateDeployErrorButton
          onSubmit={onRetryWithFix}
          retrying={retrying}
        />
      )}

      <Separator />

      <div className="flex flex-col gap-2">
        {run.status === "awaiting_deploy" && canApprove && (
          <Button
            data-testid="button-approve-deploy"
            onClick={onApprove}
            disabled={approving}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            size="sm"
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Aprovar deploy
          </Button>
        )}
        {run.status === "awaiting_deploy" && !canApprove && (
          <div
            className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-2"
            data-testid="text-preview-required"
          >
            <Eye className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Abra a aba <strong>👁 Preview</strong> no editor para liberar o botão de aprovação.</span>
          </div>
        )}
        <Button
          data-testid="button-delete-run"
          onClick={onDelete}
          disabled={deleting}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Remover run
        </Button>
        {run.status === "awaiting_deploy" && canApprove && (
          <p className="text-[10px] text-muted-foreground leading-tight">
            <ChevronRight className="h-3 w-3 inline" /> Sprint 1: aprovar é simbólico. Deploy real no Frappe será habilitado em sprints futuros.
          </p>
        )}
      </div>
    </>
  );
}
