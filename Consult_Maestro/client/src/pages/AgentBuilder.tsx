import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Play,
  Loader2,
  Sparkles,
  Globe,
  ChevronRight,
  GitFork,
  History,
  RotateCcw,
  CheckCircle2,
  Zap,
  Clock,
  Shield,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSystemRole } from "@/hooks/useSystemRole";
import type { AgentDefinitionRow, AgentDefinitionVersionRow } from "@/hooks/useAgentDefinitions";
import { ScrollArea } from "@/components/ui/scroll-area";

const CONTEXT_MODULES = [
  { id: "canvas", label: "Canvas BMC", color: "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100" },
  { id: "pdca", label: "PDCA", color: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" },
  { id: "processes", label: "Processos", color: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100" },
  { id: "swot", label: "SWOT", color: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100" },
  { id: "erp", label: "Requisitos ERP", color: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100" },
  { id: "scrum", label: "Scrum/Backlog", color: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" },
];

const VISIBLE_IN = [
  { id: "all", label: "Todas as telas" },
  { id: "canvas", label: "Canvas" },
  { id: "pdca", label: "PDCA" },
  { id: "processes", label: "Processos" },
  { id: "scrum_reports", label: "Relatórios Scrum" },
  { id: "reports", label: "Relatórios Finais" },
];

const PROMPT_PLACEHOLDER = `Você é um consultor especialista em [área].
Analise os dados do projeto e responda em português brasileiro.

Ao analisar, considere:
- [critério 1]
- [critério 2]

Responda em formato estruturado (Markdown), com seções claras.`;

interface AutomationTrigger {
  id: string;
  label: string;
  cron: string;
  skillName: string;
  active: boolean;
}

interface AgentForm {
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  contextModules: string[];
  visibleIn: string[];
  maxTokens: number;
  // Capacidades (Sprint Agent-Builder-V2)
  allowedTools: string[];
  linkedCredentialIds: string[];
  enabledSkillNames: string[];
  llmModelOverride: string;
  requiredApprovals: string[];
  allowedRoles: string[];
  automationTriggers: AutomationTrigger[];
}

const EMPTY_FORM: AgentForm = {
  name: "",
  slug: "",
  description: "",
  systemPrompt: "",
  contextModules: [],
  visibleIn: ["all"],
  maxTokens: 2000,
  allowedTools: [],
  linkedCredentialIds: [],
  enabledSkillNames: [],
  llmModelOverride: "",
  requiredApprovals: [],
  allowedRoles: [],
  automationTriggers: [],
};

interface AgentResource {
  credentials: Array<{ id: string; name: string; system: string; loginUrl: string | null }>;
  skills: Array<{ id: string; name: string; title: string; scope: string; systemSlug: string | null }>;
  mcpTools: Array<{ name: string; description: string; module: string }>;
}

const APPROVAL_ACTIONS = [
  { id: "emit_fiscal_doc", label: "Emissão de documentos fiscais" },
  { id: "send_email", label: "Envio de e-mails" },
  { id: "submit_form", label: "Submissão de formulários" },
  { id: "browser_click_confirm", label: "Cliques de confirmação" },
];

const ACCESS_ROLES = ["admin", "gerente", "tecnico", "visualizador"];

const LLM_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku (rápido / econômico)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet (equilibrado)" },
  { id: "claude-opus-4-6", label: "Claude Opus (máxima qualidade)" },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export default function AgentBuilder() {
  const { toast } = useToast();
  const { isSuperadmin } = useSystemRole();
  const [editingAgent, setEditingAgent] = useState<AgentDefinitionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [testingAgent, setTestingAgent] = useState<AgentDefinitionRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyAgent, setHistoryAgent] = useState<AgentDefinitionRow | null>(null);

  const { data: agents = [], isLoading } = useQuery<AgentDefinitionRow[]>({
    queryKey: ["/api/agent-definitions", "__all__"],
    queryFn: async () => {
      const res = await fetch("/api/agent-definitions", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AgentForm) => {
      const res = await apiRequest("POST", "/api/agent-definitions", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Agente criado" });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      setCreating(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AgentForm> }) => {
      const res = await apiRequest("PATCH", `/api/agent-definitions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Agente atualizado" });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      setEditingAgent(null);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/agent-definitions/${id}`),
    onSuccess: () => {
      toast({ title: "Agente excluído" });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      setDeletingId(null);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const forkMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/agent-definitions/${id}/fork`, {});
      return res.json() as Promise<AgentDefinitionRow>;
    },
    onSuccess: (forked) => {
      toast({ title: "Cópia criada", description: "Agente customizado disponível para edição." });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      setEditingAgent(forked);
    },
    onError: (e: any) => toast({ title: "Erro ao customizar", description: e.message, variant: "destructive" }),
  });

  function isReadonly(a: AgentDefinitionRow): boolean {
    return a.tenantId === null && !isSuperadmin;
  }

  function tenantForkOf(global: AgentDefinitionRow): AgentDefinitionRow | undefined {
    return agents.find((x) => x.parentDefinitionId === global.id && x.tenantId !== null);
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading" data-testid="text-page-title">Construtor de Agentes</h1>
            <p className="text-sm text-muted-foreground">Crie e configure agentes de IA personalizados para o seu negócio</p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-agent">
          <Plus className="h-4 w-4 mr-2" />
          Novo Agente
        </Button>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <Sparkles className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Nenhum agente personalizado ainda</p>
            <Button onClick={() => setCreating(true)} variant="outline" data-testid="button-create-first-agent">
              Criar primeiro agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <Card key={a.id} className="hover-elevate" data-testid={`card-agent-${a.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                      {a.name}
                      {a.tenantId === null && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Globe className="h-3 w-3" /> Global
                        </Badge>
                      )}
                      {a.tenantId !== null && a.parentDefinitionId && (
                        <Badge className="gap-1 text-[10px] bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" variant="secondary">
                          <CheckCircle2 className="h-3 w-3" /> Customizado
                        </Badge>
                      )}
                      {a.isActive === 0 && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                    </CardTitle>
                    {a.description && <p className="text-xs text-muted-foreground mt-1">{a.description}</p>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {a.contextModules && a.contextModules.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {a.contextModules.map((m) => {
                      const def = CONTEXT_MODULES.find((c) => c.id === m);
                      return (
                        <Badge key={m} className={`text-[10px] ${def?.color || ""}`} variant="secondary">
                          {def?.label || m}
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {a.visibleIn && a.visibleIn.length > 0 && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                    <span>Telas:</span>
                    {a.visibleIn.map((v) => {
                      const def = VISIBLE_IN.find((x) => x.id === v);
                      return <span key={v} className="rounded bg-muted px-1.5 py-0.5">{def?.label || v}</span>;
                    })}
                  </div>
                )}
                <Separator />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setTestingAgent(a)} data-testid={`button-test-${a.id}`}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Testar
                  </Button>
                  {/* Global agent without local fork: offer "Customizar" */}
                  {a.tenantId === null && !isSuperadmin && (() => {
                    const fork = tenantForkOf(a);
                    if (fork) {
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingAgent(fork)}
                          data-testid={`button-open-fork-${a.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1.5" />
                          Editar cópia
                        </Button>
                      );
                    }
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => forkMutation.mutate(a.id)}
                        disabled={forkMutation.isPending}
                        data-testid={`button-fork-${a.id}`}
                      >
                        {forkMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <GitFork className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Customizar
                      </Button>
                    );
                  })()}
                  {!isReadonly(a) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditingAgent(a)} data-testid={`button-edit-${a.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setHistoryAgent(a)}
                        data-testid={`button-history-${a.id}`}
                      >
                        <History className="h-3.5 w-3.5 mr-1.5" />
                        Histórico
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive ml-auto"
                        onClick={() => setDeletingId(a.id)}
                        data-testid={`button-delete-${a.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Sheet */}
      <AgentFormSheet
        open={creating || editingAgent !== null}
        onClose={() => { setCreating(false); setEditingAgent(null); }}
        initial={editingAgent || null}
        onSubmit={(data) => {
          if (editingAgent) {
            updateMutation.mutate({ id: editingAgent.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      {/* Test Dialog */}
      {testingAgent && (
        <TestAgentDialog
          agent={testingAgent}
          onClose={() => setTestingAgent(null)}
        />
      )}

      {/* Version History */}
      {historyAgent && (
        <VersionHistoryDialog
          agent={historyAgent}
          onClose={() => setHistoryAgent(null)}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir agente?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletingId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentFormSheet({
  open,
  onClose,
  initial,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  initial: AgentDefinitionRow | null;
  onSubmit: (data: AgentForm) => void;
  isSubmitting: boolean;
}) {
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [autoSlug, setAutoSlug] = useState(true);
  const [tab, setTab] = useState("identity");

  const { data: resources } = useQuery<AgentResource>({
    queryKey: ["/api/agent-definitions/resources"],
    enabled: open,
  });

  const toolsByModule = useMemo(() => {
    const map: Record<string, AgentResource["mcpTools"]> = {};
    for (const t of resources?.mcpTools || []) {
      (map[t.module] ||= []).push(t);
    }
    return map;
  }, [resources]);

  // Sync form state whenever the dialog opens or the `initial` row changes,
  // so editing different agents doesn't leak stale values.
  useEffect(() => {
    if (!open) return;
    setTab("identity");
    if (initial) {
      setForm({
        name: initial.name,
        slug: initial.slug,
        description: initial.description || "",
        systemPrompt: initial.systemPrompt,
        contextModules: initial.contextModules || [],
        visibleIn: initial.visibleIn || ["all"],
        maxTokens: initial.maxTokens || 2000,
        // campos novos (fallback seguro para agentes antigos)
        allowedTools: initial.allowedTools || [],
        linkedCredentialIds: initial.linkedCredentialIds || [],
        enabledSkillNames: initial.enabledSkillNames || [],
        llmModelOverride: initial.llmModelOverride || "",
        requiredApprovals: initial.requiredApprovals || [],
        allowedRoles: initial.allowedRoles || [],
        automationTriggers: (initial.automationTriggers || []).map((t) => ({
          id: t.id || crypto.randomUUID(),
          label: t.label,
          cron: t.cron,
          skillName: t.skillName,
          active: t.active,
        })),
      });
      setAutoSlug(false);
    } else {
      setForm(EMPTY_FORM);
      setAutoSlug(true);
    }
  }, [open, initial]);

  function handleOpen(o: boolean) {
    if (!o) onClose();
  }

  type ArrKey =
    | "contextModules"
    | "visibleIn"
    | "allowedTools"
    | "linkedCredentialIds"
    | "enabledSkillNames"
    | "requiredApprovals"
    | "allowedRoles";

  function toggleArr(key: ArrKey, value: string) {
    setForm((f) => {
      const arr = f[key];
      const has = arr.includes(value);
      return { ...f, [key]: has ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  }

  function addTrigger() {
    setForm((f) => ({
      ...f,
      automationTriggers: [
        ...f.automationTriggers,
        { id: crypto.randomUUID(), label: "", cron: "0 8 * * 1-5", skillName: "", active: true },
      ],
    }));
  }

  function updateTrigger(idx: number, field: keyof AutomationTrigger, value: any) {
    setForm((f) => ({
      ...f,
      automationTriggers: f.automationTriggers.map((t, i) => (i === idx ? { ...t, [field]: value } : t)),
    }));
  }

  function removeTrigger(idx: number) {
    setForm((f) => ({
      ...f,
      automationTriggers: f.automationTriggers.filter((_, i) => i !== idx),
    }));
  }

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name, slug: autoSlug ? slugify(name) : f.slug }));
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.slug.trim() || !form.systemPrompt.trim()) {
      return;
    }
    onSubmit(form);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-3xl p-0 gap-0 max-h-[88vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{initial ? "Editar Agente" : "Novo Agente"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-6 mb-2 grid grid-cols-4 shrink-0">
            <TabsTrigger value="identity" data-testid="tab-identity">
              <Bot className="h-3.5 w-3.5 mr-1.5" /> Identidade
            </TabsTrigger>
            <TabsTrigger value="capabilities" data-testid="tab-capabilities">
              <Zap className="h-3.5 w-3.5 mr-1.5" /> Capacidades
            </TabsTrigger>
            <TabsTrigger value="automation" data-testid="tab-automation">
              <Clock className="h-3.5 w-3.5 mr-1.5" /> Automação
            </TabsTrigger>
            <TabsTrigger value="access" data-testid="tab-access">
              <Shield className="h-3.5 w-3.5 mr-1.5" /> Acesso
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
            {/* ─────────────── Aba Identidade ─────────────── */}
            <TabsContent value="identity" className="mt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Ex: Diagnóstico Varejo"
                    data-testid="input-agent-name"
                  />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input
                    value={form.slug}
                    onChange={(e) => { setAutoSlug(false); setForm({ ...form, slug: slugify(e.target.value) }); }}
                    placeholder="varejo_diagnostico"
                    data-testid="input-agent-slug"
                  />
                </div>
              </div>

              <div>
                <Label>Descrição</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Como o agente aparece para os usuários"
                  data-testid="input-agent-description"
                />
              </div>

              <div>
                <Label>System Prompt * (instruções para o Claude)</Label>
                <Textarea
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                  placeholder={PROMPT_PLACEHOLDER}
                  rows={10}
                  className="font-mono text-xs"
                  data-testid="input-agent-system-prompt"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Defina a persona, área de expertise e formato esperado da resposta.
                </p>
              </div>

              <div>
                <Label>Contextos do projeto a injetar</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {CONTEXT_MODULES.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.contextModules.includes(m.id)}
                        onCheckedChange={() => toggleArr("contextModules", m.id)}
                        data-testid={`checkbox-context-${m.id}`}
                      />
                      <Badge className={`${m.color} text-[10px]`} variant="secondary">{m.label}</Badge>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label>Telas onde o agente aparece</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {VISIBLE_IN.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.visibleIn.includes(v.id)}
                        onCheckedChange={() => toggleArr("visibleIn", v.id)}
                        data-testid={`checkbox-visible-${v.id}`}
                      />
                      <span className="text-sm">{v.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label>Máximo de tokens: {form.maxTokens}</Label>
                <Slider
                  value={[form.maxTokens]}
                  min={500}
                  max={4000}
                  step={100}
                  onValueChange={(v) => setForm({ ...form, maxTokens: v[0] })}
                  className="mt-2"
                  data-testid="slider-max-tokens"
                />
              </div>
            </TabsContent>

            {/* ─────────────── Aba Capacidades ─────────────── */}
            <TabsContent value="capabilities" className="mt-0 space-y-5">
              {/* Tools MCP */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Ferramentas (MCP)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Selecione quais ferramentas este agente pode usar. Deixe vazio para permitir todas.
                  </p>
                </div>
                {Object.keys(toolsByModule).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhuma ferramenta registrada.</p>
                ) : (
                  Object.entries(toolsByModule).map(([module, tools]) => (
                    <div key={module}>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{module}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tools.map((tool) => {
                          const checked = form.allowedTools.includes(tool.name);
                          return (
                            <TooltipProvider key={tool.name}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant={checked ? "default" : "outline"}
                                    className="cursor-pointer text-xs py-1 px-2"
                                    onClick={() => toggleArr("allowedTools", tool.name)}
                                    data-testid={`badge-tool-${tool.name}`}
                                  >
                                    {tool.name}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent><p className="text-xs max-w-48">{tool.description}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                {form.allowedTools.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    Nenhuma tool selecionada = agente usa todas as disponíveis.
                  </p>
                )}
              </div>

              <Separator />

              {/* Credenciais vinculadas */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Credenciais de sistemas externos</Label>
                {(resources?.credentials.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma credencial cadastrada. Acesse Escritório Agente → Credenciais para adicionar.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {resources?.credentials.map((cred) => (
                      <div key={cred.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                        <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{cred.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{cred.system}{cred.loginUrl ? ` · ${cred.loginUrl}` : ""}</p>
                        </div>
                        <Switch
                          checked={form.linkedCredentialIds.includes(cred.id)}
                          onCheckedChange={() => toggleArr("linkedCredentialIds", cred.id)}
                          data-testid={`switch-cred-${cred.id}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Browser skills */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Browser skills disponíveis para este agente</Label>
                {(resources?.skills.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma skill gravada ainda. Execute tarefas no Escritório Agente para gravar skills.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {resources?.skills.map((skill) => (
                      <div key={skill.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                        <Play className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium font-mono truncate">{skill.name}</p>
                            <Badge variant="secondary" className="text-[10px]">{skill.scope}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{skill.title}</p>
                        </div>
                        <Switch
                          checked={form.enabledSkillNames.includes(skill.name)}
                          onCheckedChange={() => toggleArr("enabledSkillNames", skill.name)}
                          data-testid={`switch-skill-${skill.id}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ─────────────── Aba Automação ─────────────── */}
            <TabsContent value="automation" className="mt-0 space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Gatilhos de execução autônoma</Label>
                  <Button size="sm" variant="outline" onClick={addTrigger} data-testid="button-add-trigger">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Novo gatilho
                  </Button>
                </div>
                {form.automationTriggers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum gatilho. Gatilhos permitem que o agente execute browser skills automaticamente.
                  </p>
                ) : (
                  form.automationTriggers.map((trigger, idx) => (
                    <div key={trigger.id} className="p-3 border rounded-lg space-y-2 bg-muted/30" data-testid={`trigger-${idx}`}>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Rótulo ex: Verificar NF-e pendentes"
                          value={trigger.label}
                          onChange={(e) => updateTrigger(idx, "label", e.target.value)}
                          className="flex-1 h-8 text-sm"
                          data-testid={`input-trigger-label-${idx}`}
                        />
                        <Switch checked={trigger.active} onCheckedChange={(v) => updateTrigger(idx, "active", v)} />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeTrigger(idx)}
                          data-testid={`button-remove-trigger-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Cron expression</Label>
                          <Input
                            placeholder="0 8 * * 1-5"
                            value={trigger.cron}
                            onChange={(e) => updateTrigger(idx, "cron", e.target.value)}
                            className="h-8 text-sm font-mono mt-1"
                            data-testid={`input-trigger-cron-${idx}`}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Browser skill</Label>
                          <Select value={trigger.skillName || undefined} onValueChange={(v) => updateTrigger(idx, "skillName", v)}>
                            <SelectTrigger className="h-8 text-sm mt-1" data-testid={`select-trigger-skill-${idx}`}>
                              <SelectValue placeholder="Selecionar skill" />
                            </SelectTrigger>
                            <SelectContent>
                              {resources?.skills.map((s) => (
                                <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-medium">Aprovação humana obrigatória</Label>
                <p className="text-xs text-muted-foreground">
                  O agente pedirá confirmação antes de executar essas ações.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {APPROVAL_ACTIONS.map((action) => (
                    <label key={action.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.requiredApprovals.includes(action.id)}
                        onCheckedChange={() => toggleArr("requiredApprovals", action.id)}
                        data-testid={`checkbox-approval-${action.id}`}
                      />
                      <span className="text-sm">{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ─────────────── Aba Acesso ─────────────── */}
            <TabsContent value="access" className="mt-0 space-y-5">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Quem pode usar este agente</Label>
                <p className="text-xs text-muted-foreground">Deixe vazio para liberar para todos os usuários do tenant.</p>
                <div className="flex flex-wrap gap-2">
                  {ACCESS_ROLES.map((role) => (
                    <Badge
                      key={role}
                      variant={form.allowedRoles.includes(role) ? "default" : "outline"}
                      className="cursor-pointer text-xs py-1 px-3 capitalize"
                      onClick={() => toggleArr("allowedRoles", role)}
                      data-testid={`badge-role-${role}`}
                    >
                      {role}
                    </Badge>
                  ))}
                </div>
                {form.allowedRoles.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Todos os usuários do tenant podem usar.</p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-sm font-medium">Modelo de IA</Label>
                <Select
                  value={form.llmModelOverride || "__default__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, llmModelOverride: v === "__default__" ? "" : v }))}
                >
                  <SelectTrigger className="max-w-xs" data-testid="select-llm-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Padrão do tenant</SelectItem>
                    {LLM_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Override do modelo padrão apenas para este agente.</p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-save-agent">
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {initial ? "Salvar alterações" : "Criar agente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestAgentDialog({ agent, onClose }: { agent: AgentDefinitionRow; onClose: () => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const { data: projects = [] } = useQuery<any[]>({ queryKey: ["/api/projects", "?scope=production"] });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/agent-definitions/${agent.id}/test`, {
        prompt,
        projectId: projectId && projectId !== "__none__" ? projectId : null,
      });
      return res.json();
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Testar: {agent.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Projeto (opcional - injeta contexto)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="select-test-project">
                <SelectValue placeholder="Sem projeto / contexto vazio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem projeto</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Pergunta / instrução</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Ex: Quais são os 3 principais gargalos?"
              data-testid="input-test-prompt"
            />
          </div>

          <Button
            onClick={() => testMutation.mutate()}
            disabled={!prompt.trim() || testMutation.isPending}
            data-testid="button-run-test"
          >
            {testMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Executando...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" />Executar teste</>
            )}
          </Button>

          {result && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-test-response">
                  {result.response}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span>{result.tokensInput + result.tokensOutput} tokens</span>
                  <span>{(result.durationMs / 1000).toFixed(1)}s</span>
                  {result.sources?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      {result.sources.length} fonte(s) usada(s)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryDialog({ agent, onClose }: { agent: AgentDefinitionRow; onClose: () => void }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: versions = [], isLoading } = useQuery<AgentDefinitionVersionRow[]>({
    queryKey: ["/api/agent-definitions", agent.id, "versions"],
    queryFn: async () => {
      const res = await fetch(`/api/agent-definitions/${agent.id}/versions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/agent-definitions/${agent.id}/restore/${versionId}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Versão restaurada" });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-definitions", agent.id, "versions"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico — {agent.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma versão salva ainda. As versões são criadas automaticamente a cada edição.
          </div>
        ) : (
          <div className="grid md:grid-cols-[260px_1fr] gap-4 flex-1 min-h-0">
            <ScrollArea className="border rounded-md max-h-[55vh]">
              <div className="p-2 space-y-1">
                {versions.map((v) => {
                  const isActive = (selected?.id ?? versions[0].id) === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedId(v.id)}
                      className={`w-full text-left rounded p-2 text-xs hover-elevate ${isActive ? "bg-accent" : ""}`}
                      data-testid={`button-version-${v.versionNumber}`}
                    >
                      <div className="font-medium">v{v.versionNumber}</div>
                      <div className="text-muted-foreground">
                        {new Date(v.changedAt).toLocaleString("pt-BR")}
                      </div>
                      {v.changeNote && (
                        <div className="text-muted-foreground italic mt-1 line-clamp-2">{v.changeNote}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="flex flex-col min-h-0">
              {selected && (
                <>
                  <div className="text-xs text-muted-foreground mb-2">
                    <span className="font-medium">v{selected.versionNumber}</span>
                    {" · "}
                    {new Date(selected.changedAt).toLocaleString("pt-BR")}
                    {selected.snapshot?.maxTokens && (
                      <span className="ml-2">· {selected.snapshot.maxTokens} tokens</span>
                    )}
                  </div>
                  <ScrollArea className="border rounded-md flex-1 max-h-[45vh]">
                    <pre className="text-xs p-3 whitespace-pre-wrap font-mono leading-relaxed" data-testid="text-version-snapshot">
{selected.snapshot?.systemPrompt || "(sem system prompt)"}
                    </pre>
                  </ScrollArea>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => restoreMutation.mutate(selected.id)}
                      disabled={restoreMutation.isPending}
                      data-testid="button-restore-version"
                    >
                      {restoreMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Restaurar esta versão
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
