import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  History,
  Loader2,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  FileText,
  User,
  Lock,
  Upload as UploadIcon,
  Calendar as CalendarIcon,
  ListChecks,
  ShieldCheck,
  EyeOff,
  Sparkles,
  Download,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, parseApiError } from "@/lib/queryClient";

interface FormField {
  name: string;
  label?: string;
  type?: "text" | "textarea" | "number" | "date";
  required?: boolean;
  placeholder?: string;
}

interface Tarefa {
  id: string;
  etapa: string;
  ordem: number;
  titulo: string;
  descricao: string | null;
  executorType: string;
  status: string;
  isRequired: boolean;
  bloqueiaAvanco: boolean;
  concluidoAt: string | null;
  concluidoBy: string | null;
  concluidoNotes: string | null;
  autoExecuted?: boolean;
  // Sprint 1 — refinamento (motor dinâmico):
  tipo?: string;                       // 'checkbox' | 'upload' | 'date' | 'form' | 'approval'
  tarefaKey?: string | null;
  dependsOnKeys?: string[] | null;
  formSchemaJson?: FormField[] | null;
  dadosColetadosJson?: any;
  aplicavel?: boolean;
  bloqueadaPorDependencia?: string[];  // keys das deps ainda não concluídas
  // Sprint 3 — audit de skill:
  lastAutoExecutionAt?: string | null;
  autoExecutionResult?: {
    skill?: string;
    source?: string;
    at?: string;
    ok?: boolean;
    summary?: string;
  } | null;
}

interface SkillInfo {
  key: string;
  tarefaKeys: string[];
}

interface Movimentacao {
  id: string;
  colunaDe: string | null;
  colunaPara: string;
  movidoPor: string | null;
  movidoPorAgente: boolean;
  motivo: string | null;
  createdAt: string;
}

interface ProcessoDetailData {
  processo: {
    id: string;
    processNumber: string;
    titulo: string;
    descricao: string | null;
    colunaAtual: string;
    tipoProcesso: string;
    status: string;
    prioridade: string;
    modoOperacao: string;
    sociedadeId: string;
    dataPrevistaConclusao: string | null;
    dataConclusao: string | null;
    createdAt: string;
    notasInternas: string | null;
  };
  config: {
    id: string;
    nome: string;
    colunas: Array<{ id: string; nome: string; ordem: number; cor?: string; autoAdvance?: boolean }>;
  } | null;
  sociedade: { id: string; razaoSocial: string; cnpj?: string | null } | null;
  tarefas: Tarefa[];
  movimentacoes: Movimentacao[];
}

const EXECUTOR_LABELS: Record<string, { label: string; color: string }> = {
  analista: { label: "Analista", color: "bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  cliente:  { label: "Cliente",  color: "bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  agente:   { label: "Agente",   color: "bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200" },
  sistema:  { label: "Sistema",  color: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200" },
};

const TIPO_TAREFA_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  checkbox: { label: "Checklist", icon: ListChecks },
  upload:   { label: "Upload",    icon: UploadIcon },
  date:     { label: "Data",      icon: CalendarIcon },
  form:     { label: "Formulário", icon: FileText },
  approval: { label: "Aprovação", icon: ShieldCheck },
};

export default function ProcessoDetail() {
  const [, params] = useRoute("/societario/pipeline/:id");
  const id = params?.id as string;
  const { toast } = useToast();

  const [concluirAlvo, setConcluirAlvo] = useState<Tarefa | null>(null);
  const [notas, setNotas] = useState("");
  // Estados dinâmicos por tipo:
  const [uploading, setUploading] = useState(false);
  const [arquivoSelecionado, setArquivoSelecionado] = useState<File | null>(null);
  const [dataValor, setDataValor] = useState("");
  const [formValores, setFormValores] = useState<Record<string, any>>({});
  // Mostrar tarefas marcadas como N/A (aplicavel=false) — escondidas por padrão.
  const [mostrarNA, setMostrarNA] = useState(false);

  const resetConcluir = () => {
    setConcluirAlvo(null);
    setNotas("");
    setArquivoSelecionado(null);
    setDataValor("");
    setFormValores({});
  };

  const abrirConcluir = (t: Tarefa) => {
    setConcluirAlvo(t);
    setNotas("");
    setArquivoSelecionado(null);
    setDataValor("");
    setFormValores({});
  };

  const { data, isLoading, error } = useQuery<ProcessoDetailData>({
    queryKey: ["/api/societario/pipeline/processos", id],
    enabled: !!id,
  });

  // Invalida o detalhe + a lista geral + o mini-board da sociedade dona deste processo,
  // para que o usuário ao voltar pelo mini-board veja contagem/coluna atualizadas.
  const invalidarTudo = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/processos", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/processos"] });
    const sid = data?.processo.sociedadeId;
    if (sid) {
      queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades", sid, "processos"] });
    }
  };

  const mover = useMutation({
    mutationFn: async (colunaPara: string) => {
      const res = await apiRequest("PATCH", `/api/societario/pipeline/processos/${id}/coluna`, { colunaPara });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coluna avançada com sucesso" });
      invalidarTudo();
    },
    onError: (err: any) => {
      const { message, body } = parseApiError(err);
      const pendentes: string[] = Array.isArray(body?.pendentes) ? body.pendentes : [];
      toast({
        title: "Avanço bloqueado",
        description: pendentes.length > 0 ? `${message}\n• ${pendentes.join("\n• ")}` : message,
        variant: "destructive",
      });
    },
  });

  const concluir = useMutation({
    mutationFn: async (vars: { tid: string; notes?: string; dadosColetados?: any; uploadToken?: string }) => {
      const res = await apiRequest("POST", `/api/societario/pipeline/processos/${id}/tarefas/${vars.tid}/concluir`, {
        notes: vars.notes,
        dadosColetados: vars.dadosColetados,
        uploadToken: vars.uploadToken,
      });
      return res.json();
    },
    onSuccess: (json: any) => {
      const auto = json?.autoAdvanced;
      if (auto?.para) {
        toast({ title: "Tarefa concluída", description: `Etapa avançou automaticamente para "${auto.para}".` });
      } else {
        toast({ title: "Tarefa concluída" });
      }
      invalidarTudo();
      resetConcluir();
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Erro ao concluir", description: message, variant: "destructive" });
    },
    onSettled: () => setUploading(false),
  });

  const reabrir = useMutation({
    mutationFn: async (tid: string) => {
      const res = await apiRequest("POST", `/api/societario/pipeline/processos/${id}/tarefas/${tid}/reabrir`, {});
      return res.json();
    },
    onSuccess: invalidarTudo,
  });

  // Sprint 3 — skills disponíveis e execução manual
  const { data: skillsData } = useQuery<SkillInfo[]>({
    queryKey: ["/api/societario/pipeline/skills"],
  });
  const skillForKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of skillsData ?? []) {
      for (const k of s.tarefaKeys) m.set(k, s.key);
    }
    return m;
  }, [skillsData]);

  const executarSkill = useMutation({
    mutationFn: async (vars: { tid: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/societario/pipeline/processos/${id}/tarefas/${vars.tid}/executar-agente`,
        {},
      );
      return res.json();
    },
    onSuccess: (json: any) => {
      toast({
        title: json?.ok ? "Agente executou a tarefa" : "Agente reportou aviso",
        description: json?.summary ?? "",
        variant: json?.ok ? "default" : "destructive",
      });
      invalidarTudo();
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha ao executar agente", description: message, variant: "destructive" });
    },
  });

  const isReadonly = data?.processo.status === "concluido";

  const reabrirProcesso = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/societario/pipeline/processos/${id}`, { status: "ativo" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Processo reaberto", description: "Você pode editar e mover novamente." });
      invalidarTudo();
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha ao reabrir", description: message, variant: "destructive" });
    },
  });

  const baixarPdf = async () => {
    try {
      const res = await fetch(`/api/societario/pipeline/processos/${id}/relatorio.pdf`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const num = data?.processo.processNumber ?? "processo";
      a.download = `relatorio-${num.replace(/[^A-Za-z0-9_\-]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Falha ao baixar PDF", description: err?.message ?? String(err), variant: "destructive" });
    }
  };

  const colunaAtual = data?.processo.colunaAtual;
  const colunaAtualDef = useMemo(
    () => data?.config?.colunas.find((c) => c.id === colunaAtual) ?? null,
    [data, colunaAtual],
  );
  const proximaColuna = useMemo(() => {
    const ordenadas = (data?.config?.colunas ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    const idx = ordenadas.findIndex((c) => c.id === colunaAtual);
    return idx >= 0 && idx < ordenadas.length - 1 ? ordenadas[idx + 1] : null;
  }, [data, colunaAtual]);

  // Considera apenas APLICÁVEIS (aplicavel !== false) ao computar pendências de avanço.
  const obrigatoriasPendentes = useMemo(() => {
    if (!data || !colunaAtual) return [];
    return data.tarefas.filter(
      (t) =>
        t.etapa === colunaAtual &&
        t.isRequired &&
        t.bloqueiaAvanco &&
        t.aplicavel !== false &&
        t.status !== "concluido",
    );
  }, [data, colunaAtual]);

  // Mapa keys → tarefa, p/ resolver labels das deps faltando.
  const tarefaPorKey = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const t of data?.tarefas ?? []) {
      if (t.tarefaKey) m.set(t.tarefaKey, t);
    }
    return m;
  }, [data]);

  // Agrupa tarefas por etapa (separa N/A em sub-bucket renderizado opcionalmente).
  const tarefasPorEtapa = useMemo(() => {
    const grupos: Record<string, { aplicaveis: Tarefa[]; naoAplicaveis: Tarefa[] }> = {};
    for (const t of data?.tarefas ?? []) {
      grupos[t.etapa] ??= { aplicaveis: [], naoAplicaveis: [] };
      if (t.aplicavel === false) grupos[t.etapa].naoAplicaveis.push(t);
      else grupos[t.etapa].aplicaveis.push(t);
    }
    for (const k of Object.keys(grupos)) {
      grupos[k].aplicaveis.sort((a, b) => a.ordem - b.ordem);
      grupos[k].naoAplicaveis.sort((a, b) => a.ordem - b.ordem);
    }
    return grupos;
  }, [data]);

  const totalNA = useMemo(() => {
    let n = 0;
    for (const k of Object.keys(tarefasPorEtapa)) n += tarefasPorEtapa[k].naoAplicaveis.length;
    return n;
  }, [tarefasPorEtapa]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-destructive">Erro ao carregar processo.</p>
        <Link href="/societario">
          <Button variant="outline" className="mt-4" data-testid="button-voltar-erro">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar ao Societário
          </Button>
        </Link>
      </div>
    );
  }

  const { processo, config, sociedade, movimentacoes } = data;

  // Handler do botão "Marcar como concluída". Retorna {dadosColetados, uploadToken}
  // explicitamente — o token NUNCA entra em dadosColetados, que é persistido e exposto na UI.
  const submitConcluir = async () => {
    if (!concluirAlvo) return;
    const tipo = concluirAlvo.tipo ?? "checkbox";
    let dadosColetados: Record<string, unknown> | undefined;
    let uploadToken: string | undefined;

    if (tipo === "upload") {
      if (!arquivoSelecionado) {
        toast({ title: "Selecione um arquivo", variant: "destructive" });
        return;
      }
      try {
        setUploading(true);
        const urlRes = await apiRequest(
          "POST",
          `/api/societario/pipeline/processos/${id}/tarefas/${concluirAlvo.id}/upload-url`,
          {},
        );
        const { uploadURL, uploadToken: tok, path } = await urlRes.json();
        if (!uploadURL || !tok || !path) throw new Error("Falha ao obter URL de upload");

        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: arquivoSelecionado,
          headers: { "Content-Type": arquivoSelecionado.type || "application/octet-stream" },
        });
        if (!putRes.ok) throw new Error(`Upload falhou (${putRes.status})`);

        dadosColetados = {
          path,
          name: arquivoSelecionado.name,
          mime: arquivoSelecionado.type || "application/octet-stream",
          size: arquivoSelecionado.size,
        };
        uploadToken = tok;
      } catch (err: any) {
        setUploading(false);
        toast({ title: "Erro no upload", description: err?.message || String(err), variant: "destructive" });
        return;
      }
    } else if (tipo === "date") {
      if (!dataValor) {
        toast({ title: "Informe a data", variant: "destructive" });
        return;
      }
      dadosColetados = { data: dataValor };
    } else if (tipo === "form") {
      const schema = (concluirAlvo.formSchemaJson ?? []) as FormField[];
      for (const f of schema) {
        if (f.required) {
          const v = formValores[f.name];
          if (v === undefined || v === null || String(v).trim() === "") {
            toast({ title: "Preencha os obrigatórios", description: f.label || f.name, variant: "destructive" });
            return;
          }
        }
      }
      dadosColetados = { values: formValores };
    }
    // checkbox/approval não exigem dadosColetados.

    concluir.mutate({ tid: concluirAlvo.id, notes: notas || undefined, dadosColetados, uploadToken });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="border-b bg-background p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href={sociedade ? `/societario/${sociedade.id}` : "/societario"}>
              <Button variant="ghost" size="sm" data-testid="button-voltar-pipeline">
                <ArrowLeft className="h-4 w-4 mr-1" />
                {sociedade ? "Sociedade" : "Societário"}
              </Button>
            </Link>
            <div>
              <div className="text-xs font-mono text-muted-foreground" data-testid="text-detalhe-number">
                {processo.processNumber}
              </div>
              <h1 className="text-xl font-heading font-bold leading-tight" data-testid="text-detalhe-titulo">
                {processo.titulo}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" data-testid="badge-coluna-atual">
              {colunaAtualDef?.nome ?? processo.colunaAtual}
            </Badge>
            <Badge variant="outline">{processo.prioridade}</Badge>
            <Badge variant="outline">{processo.status}</Badge>
            <Badge variant="outline" className="capitalize">modo: {processo.modoOperacao}</Badge>
            {colunaAtualDef?.autoAdvance && (
              <Badge variant="outline" className="text-[10px]" title="Esta etapa avança automaticamente quando todas as tarefas obrigatórias estão concluídas">
                auto-advance
              </Badge>
            )}
            {proximaColuna && processo.status === "ativo" && (
              <Button
                size="sm"
                onClick={() => mover.mutate(proximaColuna.id)}
                disabled={obrigatoriasPendentes.length > 0 || mover.isPending}
                data-testid="button-avancar-coluna"
                title={
                  obrigatoriasPendentes.length > 0
                    ? `Conclua as ${obrigatoriasPendentes.length} tarefas obrigatórias primeiro`
                    : `Avançar para ${proximaColuna.nome}`
                }
              >
                {mover.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                Avançar para {proximaColuna.nome}
              </Button>
            )}
            {isReadonly && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => reabrirProcesso.mutate()}
                disabled={reabrirProcesso.isPending}
                data-testid="button-reabrir-processo"
                title="Volta o processo para a coluna anterior à conclusão e libera edição"
              >
                {reabrirProcesso.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1" />
                )}
                Reabrir processo
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={baixarPdf}
              data-testid="button-baixar-pdf"
              title="Baixar relatório PDF do processo"
            >
              <Download className="h-4 w-4 mr-1" />
              Baixar PDF
            </Button>
          </div>
        </div>

        {isReadonly && (
          <div
            className="flex items-center gap-2 text-sm rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-3 py-2"
            data-testid="banner-readonly"
          >
            <Lock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <span>
              Processo concluído — somente leitura. Use <strong>Reabrir processo</strong> para voltar a editar tarefas e movimentar entre colunas.
            </span>
          </div>
        )}

        {sociedade && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="text-detalhe-sociedade">
            <Building2 className="h-4 w-4" />
            <Link
              href={`/societario/${sociedade.id}`}
              className="hover:underline"
              data-testid="link-sociedade"
            >
              {sociedade.razaoSocial}
            </Link>
            {sociedade.cnpj && <span className="font-mono">· {sociedade.cnpj}</span>}
          </div>
        )}
      </header>

      <Tabs defaultValue="resumo" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="resumo" data-testid="tab-resumo">
            <FileText className="h-4 w-4 mr-1" />
            Resumo
          </TabsTrigger>
          <TabsTrigger value="checklist" data-testid="tab-checklist">
            <ClipboardList className="h-4 w-4 mr-1" />
            Checklist ({data.tarefas.filter((t) => t.aplicavel !== false).length})
          </TabsTrigger>
          <TabsTrigger value="historico" data-testid="tab-historico">
            <History className="h-4 w-4 mr-1" />
            Histórico ({movimentacoes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="flex-1 overflow-y-auto p-4">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Tipo</CardTitle></CardHeader>
              <CardContent className="text-sm capitalize" data-testid="text-resumo-tipo">
                {processo.tipoProcesso.replaceAll("_", " ")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline</CardTitle></CardHeader>
              <CardContent className="text-sm" data-testid="text-resumo-pipeline">
                {config?.nome ?? "—"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                <CardTitle className="text-sm">Prazo</CardTitle>
              </CardHeader>
              <CardContent className="text-sm" data-testid="text-resumo-prazo">
                {processo.dataPrevistaConclusao
                  ? new Date(processo.dataPrevistaConclusao).toLocaleDateString("pt-BR")
                  : "Não definido"}
              </CardContent>
            </Card>
          </div>

          {processo.descricao && (
            <Card className="mt-4">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Descrição</CardTitle></CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap" data-testid="text-resumo-descricao">
                {processo.descricao}
              </CardContent>
            </Card>
          )}

          {processo.notasInternas && (
            <Card className="mt-4">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Notas internas</CardTitle></CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap" data-testid="text-resumo-notas">
                {processo.notasInternas}
              </CardContent>
            </Card>
          )}

          {obrigatoriasPendentes.length > 0 && (
            <Card className="mt-4 border-amber-500">
              <CardHeader className="pb-2 flex-row items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <CardTitle className="text-sm">Pendências bloqueando avanço</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1" data-testid="list-pendencias-resumo">
                {obrigatoriasPendentes.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <Circle className="h-3 w-3 text-amber-600" />
                    <span>{t.titulo}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {EXECUTOR_LABELS[t.executorType]?.label ?? t.executorType}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="checklist" className="flex-1 overflow-y-auto p-4 space-y-4">
          {totalNA > 0 && (
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMostrarNA((v) => !v)}
                data-testid="button-toggle-na"
              >
                <EyeOff className="h-3.5 w-3.5 mr-1" />
                {mostrarNA ? "Ocultar" : "Mostrar"} {totalNA} N/A
              </Button>
            </div>
          )}
          {(config?.colunas ?? [])
            .slice()
            .sort((a, b) => a.ordem - b.ordem)
            .map((col) => {
              const grupo = tarefasPorEtapa[col.id] ?? { aplicaveis: [], naoAplicaveis: [] };
              if (grupo.aplicaveis.length === 0 && (!mostrarNA || grupo.naoAplicaveis.length === 0)) {
                return null;
              }
              const isAtual = col.id === colunaAtual;
              return (
                <Card key={col.id} className={isAtual ? "border-primary" : ""} data-testid={`checklist-etapa-${col.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${col.cor ?? "bg-slate-500"}`} />
                      {col.nome}
                      {isAtual && <Badge variant="secondary" className="text-[10px]">etapa atual</Badge>}
                      {col.autoAdvance && <Badge variant="outline" className="text-[10px]">auto-advance</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {grupo.aplicaveis.map((t, idx) => (
                      <TarefaRow
                        key={t.id}
                        tarefa={t}
                        showSeparator={idx > 0}
                        tarefaPorKey={tarefaPorKey}
                        onConcluir={() => abrirConcluir(t)}
                        onReabrir={() => reabrir.mutate(t.id)}
                        reabrirPending={reabrir.isPending}
                        skillKey={skillForKey.get(t.tarefaKey ?? "") ?? null}
                        onExecutarAgente={() => executarSkill.mutate({ tid: t.id })}
                        executarPending={executarSkill.isPending && executarSkill.variables?.tid === t.id}
                        readonly={isReadonly}
                      />
                    ))}
                    {mostrarNA && grupo.naoAplicaveis.length > 0 && (
                      <>
                        <Separator className="my-2" />
                        <div className="text-[11px] uppercase text-muted-foreground tracking-wide">Não aplicáveis</div>
                        {grupo.naoAplicaveis.map((t, idx) => (
                          <TarefaRow
                            key={t.id}
                            tarefa={t}
                            showSeparator={idx > 0}
                            tarefaPorKey={tarefaPorKey}
                            onConcluir={() => {}}
                            onReabrir={() => {}}
                            reabrirPending={false}
                            naoAplicavel
                          />
                        ))}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </TabsContent>

        <TabsContent value="historico" className="flex-1 overflow-y-auto p-4">
          {movimentacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {movimentacoes.map((m) => {
                const colDeNome = config?.colunas.find((c) => c.id === m.colunaDe)?.nome ?? m.colunaDe;
                const colParaNome = config?.colunas.find((c) => c.id === m.colunaPara)?.nome ?? m.colunaPara;
                const isAuto = typeof m.motivo === "string" && m.motivo.startsWith("auto_advance");
                return (
                  <Card key={m.id} data-testid={`movimentacao-${m.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 text-sm">
                        {m.colunaDe ? (
                          <>
                            <Badge variant="outline">{colDeNome}</Badge>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </>
                        ) : (
                          <Badge variant="outline">Criação</Badge>
                        )}
                        <Badge variant="secondary">{colParaNome}</Badge>
                        {m.movidoPorAgente && (
                          <Badge variant="outline" className="text-[10px]">por agente</Badge>
                        )}
                        {isAuto && (
                          <Badge variant="outline" className="text-[10px]">auto-advance</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <User className="h-3 w-3" />
                        <span>{new Date(m.createdAt).toLocaleString("pt-BR")}</span>
                      </div>
                      {m.motivo && !isAuto && <p className="text-xs mt-1">{m.motivo}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de conclusão dinâmico por tipo */}
      <Dialog open={!!concluirAlvo} onOpenChange={(o) => { if (!o) resetConcluir(); }}>
        <DialogContent data-testid="dialog-concluir-tarefa">
          <DialogHeader>
            <DialogTitle>Concluir tarefa</DialogTitle>
            <DialogDescription className="break-words">
              {concluirAlvo?.titulo}
              {concluirAlvo?.tipo && concluirAlvo.tipo !== "checkbox" && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {TIPO_TAREFA_META[concluirAlvo.tipo]?.label ?? concluirAlvo.tipo}
                </Badge>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {/* === campos por tipo === */}
            {concluirAlvo?.tipo === "upload" && (
              <div className="grid gap-1.5" data-testid="field-upload">
                <Label htmlFor="arquivo">Arquivo *</Label>
                <Input
                  id="arquivo"
                  type="file"
                  onChange={(e) => setArquivoSelecionado(e.target.files?.[0] ?? null)}
                  data-testid="input-arquivo-tarefa"
                />
                {arquivoSelecionado && (
                  <p className="text-xs text-muted-foreground">
                    {arquivoSelecionado.name} · {(arquivoSelecionado.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            )}

            {concluirAlvo?.tipo === "date" && (
              <div className="grid gap-1.5" data-testid="field-date">
                <Label htmlFor="data-tarefa">Data *</Label>
                <Input
                  id="data-tarefa"
                  type="date"
                  value={dataValor}
                  onChange={(e) => setDataValor(e.target.value)}
                  data-testid="input-data-tarefa"
                />
              </div>
            )}

            {concluirAlvo?.tipo === "form" && (
              <div className="grid gap-2" data-testid="field-form">
                {(concluirAlvo.formSchemaJson ?? []).map((f) => {
                  const value = formValores[f.name] ?? "";
                  const setValue = (v: any) => setFormValores((prev) => ({ ...prev, [f.name]: v }));
                  return (
                    <div className="grid gap-1.5" key={f.name}>
                      <Label htmlFor={`form-${f.name}`}>
                        {f.label || f.name}{f.required && <span className="text-destructive"> *</span>}
                      </Label>
                      {f.type === "textarea" ? (
                        <Textarea
                          id={`form-${f.name}`}
                          rows={2}
                          value={value}
                          placeholder={f.placeholder}
                          onChange={(e) => setValue(e.target.value)}
                          data-testid={`input-form-${f.name}`}
                        />
                      ) : (
                        <Input
                          id={`form-${f.name}`}
                          type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                          value={value}
                          placeholder={f.placeholder}
                          onChange={(e) => setValue(e.target.value)}
                          data-testid={`input-form-${f.name}`}
                        />
                      )}
                    </div>
                  );
                })}
                {(concluirAlvo.formSchemaJson ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">Esta tarefa não tem campos definidos.</p>
                )}
              </div>
            )}

            {concluirAlvo?.tipo === "approval" && (
              <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30" data-testid="field-approval">
                <ShieldCheck className="h-4 w-4 inline mr-1" />
                Ao confirmar, sua identidade será carimbada como aprovador desta tarefa.
              </div>
            )}

            {/* Notas comuns a todos os tipos */}
            <div className="grid gap-1.5">
              <Label htmlFor="notas">Notas (opcional)</Label>
              <Textarea
                id="notas"
                rows={2}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Observações…"
                data-testid="input-notas-concluir"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetConcluir} data-testid="button-cancelar-concluir">
              Cancelar
            </Button>
            <Button
              onClick={submitConcluir}
              disabled={concluir.isPending || uploading}
              data-testid="button-confirmar-concluir"
            >
              {(concluir.isPending || uploading) ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              {concluirAlvo?.tipo === "approval" ? "Aprovar" : "Marcar como concluída"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Linha individual de tarefa ─────────────────────────
function TarefaRow(props: {
  skillKey?: string | null;
  onExecutarAgente?: () => void;
  executarPending?: boolean;
  tarefa: Tarefa;
  showSeparator: boolean;
  tarefaPorKey: Map<string, Tarefa>;
  onConcluir: () => void;
  onReabrir: () => void;
  reabrirPending: boolean;
  naoAplicavel?: boolean;
  readonly?: boolean;
}) {
  const {
    tarefa: t, showSeparator, tarefaPorKey, onConcluir, onReabrir, reabrirPending, naoAplicavel,
    skillKey, onExecutarAgente, executarPending, readonly,
  } = props;
  const tipo = (t.tipo ?? "checkbox") as keyof typeof TIPO_TAREFA_META;
  const tipoMeta = TIPO_TAREFA_META[tipo] ?? TIPO_TAREFA_META.checkbox;
  const TipoIcon = tipoMeta.icon;
  const bloqueada = (t.bloqueadaPorDependencia?.length ?? 0) > 0;
  const concluida = t.status === "concluido";

  // Resolve labels das deps faltando.
  const depsLabels = (t.bloqueadaPorDependencia ?? []).map((k) => tarefaPorKey.get(k)?.titulo ?? k);

  return (
    <div>
      {showSeparator && <Separator />}
      <div
        className={`flex items-start justify-between gap-3 py-2 ${naoAplicavel ? "opacity-50" : ""}`}
        data-testid={`tarefa-${t.id}`}
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {naoAplicavel ? (
            <EyeOff className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          ) : bloqueada ? (
            <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          ) : concluida ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight flex items-center gap-2 flex-wrap">
              <span className={concluida ? "line-through text-muted-foreground" : ""}>
                {t.titulo}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${EXECUTOR_LABELS[t.executorType]?.color ?? ""}`}
              >
                {EXECUTOR_LABELS[t.executorType]?.label ?? t.executorType}
              </Badge>
              {tipo !== "checkbox" && (
                <Badge variant="outline" className="text-[10px] inline-flex items-center gap-0.5">
                  <TipoIcon className="h-2.5 w-2.5" />
                  {tipoMeta.label}
                </Badge>
              )}
              {t.isRequired && t.bloqueiaAvanco && !naoAplicavel && (
                <Badge variant="outline" className="text-[10px]">obrigatória</Badge>
              )}
              {t.autoExecuted && <Badge variant="outline" className="text-[10px]">auto</Badge>}
              {naoAplicavel && (
                <Badge variant="outline" className="text-[10px]">N/A</Badge>
              )}
            </div>
            {t.descricao && (
              <p className="text-xs text-muted-foreground mt-0.5">{t.descricao}</p>
            )}
            {bloqueada && !naoAplicavel && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-start gap-1" data-testid={`deps-${t.id}`}>
                <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Bloqueada por: {depsLabels.join(", ")}
                </span>
              </p>
            )}
            {/* Mostra dados coletados quando concluída */}
            {concluida && t.dadosColetadosJson && (
              <DadosColetadosPreview tipo={tipo as string} dados={t.dadosColetadosJson} />
            )}
            {t.concluidoNotes && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Nota: {t.concluidoNotes}
              </p>
            )}
            {t.lastAutoExecutionAt && (
              <p
                className={`text-xs mt-1 flex items-center gap-1 ${t.autoExecutionResult?.ok === false ? "text-amber-700 dark:text-amber-300" : "text-violet-700 dark:text-violet-300"}`}
                data-testid={`text-skill-last-${t.id}`}
              >
                <Sparkles className="h-3 w-3 shrink-0" />
                <span>
                  {t.autoExecutionResult?.skill ?? "agente"} ·{" "}
                  {new Date(t.lastAutoExecutionAt).toLocaleString("pt-BR")}
                  {t.autoExecutionResult?.summary ? ` — ${t.autoExecutionResult.summary}` : ""}
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!naoAplicavel && !concluida && skillKey && onExecutarAgente && !readonly && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExecutarAgente}
              disabled={!!executarPending}
              data-testid={`button-executar-agente-${t.id}`}
              title={`Executar agente: ${skillKey}`}
            >
              {executarPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              Executar agente
            </Button>
          )}
          {naoAplicavel || readonly ? null : concluida ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReabrir}
              disabled={reabrirPending}
              data-testid={`button-reabrir-${t.id}`}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Reabrir
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onConcluir}
              disabled={bloqueada}
              title={bloqueada ? `Conclua antes: ${depsLabels.join(", ")}` : undefined}
              data-testid={`button-concluir-${t.id}`}
            >
              {bloqueada ? <Lock className="h-3.5 w-3.5 mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
              {tipo === "approval" ? "Aprovar" : "Concluir"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DadosColetadosPreview({ tipo, dados }: { tipo: string; dados: any }) {
  if (!dados) return null;
  if (tipo === "upload" && dados.name) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        <UploadIcon className="h-3 w-3 inline mr-0.5" />
        {dados.name}{dados.size ? ` · ${(Number(dados.size) / 1024).toFixed(1)} KB` : ""}
      </p>
    );
  }
  if (tipo === "date" && dados.data) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        <CalendarIcon className="h-3 w-3 inline mr-0.5" />
        {new Date(dados.data).toLocaleDateString("pt-BR")}
      </p>
    );
  }
  if (tipo === "form" && dados.values) {
    const entries = Object.entries(dados.values).filter(([, v]) => v !== "" && v !== null && v !== undefined);
    if (entries.length === 0) return null;
    return (
      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
        {entries.slice(0, 4).map(([k, v]) => (
          <div key={k}><span className="font-medium">{k}:</span> {String(v)}</div>
        ))}
      </div>
    );
  }
  return null;
}
