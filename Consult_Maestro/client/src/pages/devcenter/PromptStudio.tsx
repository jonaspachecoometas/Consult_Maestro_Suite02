// Sprint 8 — Prompt Engineering Studio
// 3 painéis lado a lado:
//  ┌────────────┬────────────┬────────────┐
//  │  Editor    │  Testador  │  Análise   │
//  │  (esq)     │  (centro)  │  IA (dir)  │
//  └────────────┴────────────┴────────────┘
// Header com seletor de agente + lista de versões + botão "Comparar A/B"
// que abre modal com lado-a-lado dos outputs.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PromptVersion } from "@shared/schema";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2, Sparkles, Save, Play, Wand2, GitCompare, Loader2, AlertTriangle,
} from "lucide-react";

const AGENTS = [
  { value: "architect", label: "Arquiteto" },
  { value: "developer", label: "Desenvolvedor" },
  { value: "qa",        label: "QA" },
  { value: "devops",    label: "DevOps" },
] as const;

const TEST_MODELS = [
  { value: "claude-sonnet-4-5",        label: "Claude Sonnet 4.5 (padrão)" },
  { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-haiku-latest",  label: "Claude 3.5 Haiku (rápido)" },
  { value: "claude-opus-4",            label: "Claude Opus 4" },
  { value: "claude-opus-4-1",          label: "Claude Opus 4.1" },
] as const;

interface OptimizeIssue {
  category: string;
  severity: "critico" | "alto" | "medio" | "baixo" | string;
  problem: string;
  fix: string;
}
interface OptimizeResult {
  score: number;
  strengths: string[];
  issues: OptimizeIssue[];
  optimized_prompt: string;
  change_summary: string;
  meta?: { tokensUsed: number; durationMs: number; model: string };
}

interface CompareResult {
  outputA: string; tokensA: number; durationA: number; modelA: string;
  outputB: string; tokensB: number; durationB: number; modelB: string;
}

function severityColor(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critico" || s === "critical") return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
  if (s === "alto"    || s === "high")     return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
  if (s === "medio"   || s === "medium")   return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30";
  return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
}

export default function PromptStudio() {
  const { toast } = useToast();
  const [agentType, setAgentType] = useState<string>("architect");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Editor (esq)
  const [editorText, setEditorText] = useState<string>("");
  const [versionName, setVersionName] = useState<string>("");
  const [changeNotes, setChangeNotes] = useState<string>("");

  // Testador (centro)
  const [testInput, setTestInput] = useState<string>("");
  const [testModel, setTestModel] = useState<string>("claude-sonnet-4-5");
  const [testOutput, setTestOutput] = useState<string>("");
  const [testMeta, setTestMeta] = useState<{ tokens: number; ms: number; model: string } | null>(null);

  // Análise IA (dir)
  const [analysis, setAnalysis] = useState<OptimizeResult | null>(null);

  // Modal A/B
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareB, setCompareB] = useState<string>("");
  const [compareInput, setCompareInput] = useState<string>("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  // ─── Queries ─────────────────────────────────────────────────────────────
  // Buscamos TODAS as versões (default queryFn faz queryKey.join("/")) e
  // filtramos por agentType no client. Isso evita serializar objetos na URL
  // e mantém a invalidação simples (uma única chave).
  const versionsQ = useQuery<PromptVersion[]>({
    queryKey: ["/api/ide/prompts"],
  });

  const versions = (versionsQ.data ?? []).filter((v) => v.agentType === agentType);
  const activeVersion = versions.find((v) => v.isActive === 1);
  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? activeVersion ?? versions[0] ?? null,
    [versions, selectedId, activeVersion],
  );

  // Quando muda agente/lista, recarrega o editor com o ativo.
  useEffect(() => {
    if (!selected) {
      setEditorText("");
      return;
    }
    setEditorText(selected.systemPrompt);
    setVersionName("");
    setChangeNotes("");
    setTestOutput("");
    setTestMeta(null);
    setAnalysis(null);
  }, [selected?.id]);

  useEffect(() => {
    setSelectedId(null);
    setAnalysis(null);
  }, [agentType]);

  // ─── Mutations ───────────────────────────────────────────────────────────
  const saveM = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ide/prompts", {
        agentType,
        versionName: versionName.trim() || undefined,
        systemPrompt: editorText,
        changeNotes: changeNotes.trim() || undefined,
      });
    },
    onSuccess: async (res: any) => {
      const created = await res.json();
      toast({ title: "Versão salva", description: `Nova versão criada (não ativa).` });
      await queryClient.invalidateQueries({ queryKey: ["/api/ide/prompts"] });
      setSelectedId(created?.id ?? null);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err?.message ?? "Falhou", variant: "destructive" });
    },
  });

  const activateM = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/ide/prompts/${id}/activate`, {}),
    onSuccess: async () => {
      toast({ title: "Versão ativada", description: "O pipeline IDE passará a usar esta versão." });
      await queryClient.invalidateQueries({ queryKey: ["/api/ide/prompts"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao ativar", description: err?.message ?? "Falhou", variant: "destructive" });
    },
  });

  const testM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione uma versão");
      const res = await apiRequest("POST", `/api/ide/prompts/${selected.id}/test`, {
        testInput,
        model: testModel,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setTestOutput(String(data.output ?? ""));
      setTestMeta({ tokens: data.tokensUsed ?? 0, ms: data.durationMs ?? 0, model: data.model ?? "" });
    },
    onError: (err: any) => {
      toast({ title: "Erro no teste", description: err?.message ?? "Falhou", variant: "destructive" });
    },
  });

  const optimizeM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione uma versão");
      const res = await apiRequest("POST", `/api/ide/prompts/optimize`, { promptId: selected.id });
      return res.json();
    },
    onSuccess: (data: OptimizeResult) => {
      setAnalysis(data);
      queryClient.invalidateQueries({ queryKey: ["/api/ide/prompts"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao otimizar", description: err?.message ?? "Falhou", variant: "destructive" });
    },
  });

  const compareM = useMutation({
    mutationFn: async () => {
      if (!selected || !compareB) throw new Error("Selecione duas versões");
      const res = await apiRequest("POST", `/api/ide/prompts/compare`, {
        promptIdA: selected.id,
        promptIdB: compareB,
        testInput: compareInput,
        model: testModel,
      });
      return res.json();
    },
    onSuccess: (data: CompareResult) => setCompareResult(data),
    onError: (err: any) => {
      toast({ title: "Erro na comparação", description: err?.message ?? "Falhou", variant: "destructive" });
    },
  });

  function applyOptimized() {
    if (!analysis) return;
    setEditorText(analysis.optimized_prompt);
    toast({ title: "Sugestão aplicada no editor", description: "Salve para criar uma nova versão." });
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden p-4 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap" data-testid="prompt-studio-header">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold">Prompt Engineering Studio</h1>
        <Badge variant="outline">Sprint 8</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Agente</Label>
          <Select value={agentType} onValueChange={setAgentType}>
            <SelectTrigger className="w-44" data-testid="select-agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENTS.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="text-xs text-muted-foreground ml-2">Versão</Label>
          <Select
            value={selected?.id ?? ""}
            onValueChange={(v) => setSelectedId(v)}
            disabled={versions.length === 0}
          >
            <SelectTrigger className="w-72" data-testid="select-version">
              <SelectValue placeholder={versionsQ.isLoading ? "Carregando..." : "Selecione"} />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {(v.versionName || v.id.slice(0, 8))} {v.isActive === 1 ? " ✓ ativa" : ""}
                  {typeof v.testScore === "number" ? `  · ${v.testScore}/100` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={versions.length < 2 || !selected}
            onClick={() => { setCompareB(""); setCompareInput(testInput); setCompareResult(null); setCompareOpen(true); }}
            data-testid="button-open-compare"
          >
            <GitCompare className="h-4 w-4 mr-1" /> Comparar A/B
          </Button>
        </div>
      </div>

      <Separator />

      {/* 3 painéis */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Painel 1 — Editor */}
        <Card className="flex flex-col min-h-0" data-testid="panel-editor">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Save className="h-4 w-4" /> Editor
              </CardTitle>
              {selected?.isActive === 1 && (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Ativa
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Nome da nova versão</Label>
                <Input
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="ex: v2-mais-detalhado"
                  data-testid="input-version-name"
                />
              </div>
              <div>
                <Label className="text-xs">Notas de mudança</Label>
                <Input
                  value={changeNotes}
                  onChange={(e) => setChangeNotes(e.target.value)}
                  placeholder="ex: reforçada validação de input"
                  data-testid="input-change-notes"
                />
              </div>
            </div>
            <Textarea
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              className="font-mono text-xs flex-1 min-h-[200px] resize-none"
              placeholder="System prompt..."
              data-testid="textarea-prompt"
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => saveM.mutate()}
                disabled={saveM.isPending || editorText.trim().length < 10}
                data-testid="button-save"
              >
                {saveM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Salvar nova versão
              </Button>
              <Button
                variant="secondary"
                disabled={!selected || selected.isActive === 1 || activateM.isPending}
                onClick={() => selected && activateM.mutate(selected.id)}
                data-testid="button-activate"
              >
                {activateM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Tornar ativa
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {versions.length} versão(ões) deste agente neste tenant.
              {selected?.changeNotes && (
                <div className="mt-1 italic">Notas: {selected.changeNotes}</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Painel 2 — Testador */}
        <Card className="flex flex-col min-h-0" data-testid="panel-tester">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4" /> Testador
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
            <div>
              <Label className="text-xs">Modelo</Label>
              <Select value={testModel} onValueChange={setTestModel}>
                <SelectTrigger data-testid="select-test-model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEST_MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <Label className="text-xs">Input de teste (será o user message)</Label>
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Cole aqui o input do agente. Para o Arquiteto, um requisito de cliente; para Dev, um design doc; etc."
                className="font-mono text-xs flex-1 min-h-[120px] resize-none"
                data-testid="textarea-test-input"
              />
              <Button
                onClick={() => testM.mutate()}
                disabled={!selected || testInput.trim().length === 0 || testM.isPending}
                data-testid="button-run-test"
              >
                {testM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                Rodar teste
              </Button>
              <Label className="text-xs">Resposta</Label>
              <ScrollArea className="border rounded p-2 flex-1 min-h-[120px] bg-muted/30">
                <pre className="font-mono text-xs whitespace-pre-wrap" data-testid="text-test-output">
                  {testOutput || (testM.isPending ? "Aguardando resposta..." : "—")}
                </pre>
              </ScrollArea>
              {testMeta && (
                <div className="text-xs text-muted-foreground" data-testid="text-test-meta">
                  {testMeta.tokens} tokens · {testMeta.ms} ms · {testMeta.model}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Painel 3 — Análise IA */}
        <Card className="flex flex-col min-h-0" data-testid="panel-analysis">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> Assistente de Otimização
              </CardTitle>
              {analysis && (
                <Badge variant="outline" data-testid="badge-score">
                  Score: {analysis.score}/100
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
            <Button
              onClick={() => optimizeM.mutate()}
              disabled={!selected || optimizeM.isPending}
              data-testid="button-optimize"
            >
              {optimizeM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Analisar prompt selecionado
            </Button>
            <ScrollArea className="border rounded p-2 flex-1 min-h-[120px] bg-muted/30">
              {!analysis && (
                <div className="text-xs text-muted-foreground">
                  Clique em <b>Analisar</b> para receber pontos fortes, problemas com severidade e
                  uma versão otimizada deste prompt. O score (0-100) é persistido na versão.
                </div>
              )}
              {analysis && (
                <div className="space-y-3 text-xs" data-testid="analysis-content">
                  {analysis.strengths?.length > 0 && (
                    <div>
                      <div className="font-semibold mb-1">Pontos fortes</div>
                      <ul className="list-disc pl-4 space-y-1">
                        {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.issues?.length > 0 && (
                    <div>
                      <div className="font-semibold mb-1">Problemas detectados</div>
                      <div className="space-y-2">
                        {analysis.issues.map((it, i) => (
                          <div key={i} className="border rounded p-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={severityColor(it.severity)}>
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {it.severity}
                              </Badge>
                              <span className="text-muted-foreground">{it.category}</span>
                            </div>
                            <div><b>Problema:</b> {it.problem}</div>
                            <div className="mt-1"><b>Sugestão:</b> {it.fix}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysis.change_summary && (
                    <div>
                      <div className="font-semibold mb-1">Resumo da otimização</div>
                      <div>{analysis.change_summary}</div>
                    </div>
                  )}
                  <Button size="sm" variant="secondary" onClick={applyOptimized} data-testid="button-apply-optimized">
                    Aplicar versão otimizada no editor
                  </Button>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Modal A/B */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Comparar versões A/B</DialogTitle>
            <DialogDescription>
              Roda o mesmo input em duas versões deste agente em paralelo, com o modelo selecionado no Testador.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Versão A (selecionada)</Label>
                <Input
                  readOnly
                  value={selected ? (selected.versionName || selected.id.slice(0, 8)) : ""}
                  data-testid="input-version-a"
                />
              </div>
              <div>
                <Label className="text-xs">Versão B</Label>
                <Select value={compareB} onValueChange={setCompareB}>
                  <SelectTrigger data-testid="select-version-b"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {versions.filter((v) => v.id !== selected?.id).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {(v.versionName || v.id.slice(0, 8))} {v.isActive === 1 ? " ✓ ativa" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Input de teste</Label>
              <Textarea
                value={compareInput}
                onChange={(e) => setCompareInput(e.target.value)}
                className="font-mono text-xs min-h-[120px]"
                data-testid="textarea-compare-input"
              />
            </div>
            <Button
              onClick={() => compareM.mutate()}
              disabled={!selected || !compareB || compareInput.trim().length === 0 || compareM.isPending}
              data-testid="button-run-compare"
            >
              {compareM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <GitCompare className="h-4 w-4 mr-1" />}
              Rodar comparação
            </Button>
            {compareResult && (
              <div className="grid grid-cols-2 gap-3" data-testid="compare-result">
                <div className="border rounded p-2">
                  <div className="text-xs text-muted-foreground mb-1">
                    A · {compareResult.tokensA} tk · {compareResult.durationA} ms · {compareResult.modelA}
                  </div>
                  <ScrollArea className="max-h-72">
                    <pre className="font-mono text-xs whitespace-pre-wrap" data-testid="text-output-a">{compareResult.outputA}</pre>
                  </ScrollArea>
                </div>
                <div className="border rounded p-2">
                  <div className="text-xs text-muted-foreground mb-1">
                    B · {compareResult.tokensB} tk · {compareResult.durationB} ms · {compareResult.modelB}
                  </div>
                  <ScrollArea className="max-h-72">
                    <pre className="font-mono text-xs whitespace-pre-wrap" data-testid="text-output-b">{compareResult.outputB}</pre>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompareOpen(false)} data-testid="button-close-compare">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
