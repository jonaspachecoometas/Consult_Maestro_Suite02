import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  KanbanSquare,
  Building2,
  Plus,
  CalendarDays,
  AlertCircle,
  Loader2,
  Check,
  ChevronsUpDown,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, parseApiError } from "@/lib/queryClient";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { KanbanCard } from "@/components/kanban/KanbanCard";

interface PipelineConfig {
  id: string;
  nome: string;
  tipoProcesso: string;
  colunas: Array<{ id: string; nome: string; ordem: number; cor?: string }>;
}

interface Sociedade {
  id: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
}

interface ProcessoCard {
  id: string;
  processNumber: string;
  titulo: string;
  sociedadeId: string;
  sociedadeRazao?: string | null;
  colunaAtual: string;
  tipoProcesso: string;
  prioridade?: string | null;
  status?: string | null;
  modoOperacao?: string | null;
  dataPrevistaConclusao?: string | null;
  tarefasPendentes?: number;
  obrigatoriasPendentes?: number;
  createdAt?: string | null;
}

const PRIORIDADE_COLORS: Record<string, string> = {
  baixa: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  media: "bg-blue-200 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  alta: "bg-amber-200 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  urgente: "bg-red-200 text-red-700 dark:bg-red-900 dark:text-red-300",
};

interface PipelineSocietarioProps {
  /** Quando true, esconde o título principal — usado dentro do Hub Societário (já tem h1). */
  embedded?: boolean;
  /** Pré-seleciona uma sociedade no modal "Novo processo" (usado na aba Processos da sociedade). */
  sociedadeIdFixa?: string;
}

export default function PipelineSocietario(props: PipelineSocietarioProps = {}) {
  const { embedded = false, sociedadeIdFixa } = props;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tipoSelecionado, setTipoSelecionado] = useState<string | null>(null);
  const [openNovo, setOpenNovo] = useState(false);

  const { data: configs = [], isLoading: loadingCfgs } = useQuery<PipelineConfig[]>({
    queryKey: ["/api/societario/pipeline/configs"],
  });

  // Quando embarcado em uma sociedade, busca apenas os processos daquela sociedade
  // (endpoint dedicado, server-side filtered). Caso contrário, lista geral do tenant.
  const processosKey = sociedadeIdFixa
    ? ["/api/societario/sociedades", sociedadeIdFixa, "processos"]
    : ["/api/societario/pipeline/processos"];
  const { data: processos = [], isLoading: loadingProcs } = useQuery<ProcessoCard[]>({
    queryKey: processosKey,
  });

  const { data: sociedades = [] } = useQuery<Sociedade[]>({
    queryKey: ["/api/societario/sociedades"],
  });

  // Determina tipo ativo: prioriza seleção do usuário, senão primeiro config
  const tipoAtivo = tipoSelecionado ?? configs[0]?.tipoProcesso ?? null;
  const configAtivo = useMemo(
    () => configs.find((c) => c.tipoProcesso === tipoAtivo) ?? null,
    [configs, tipoAtivo],
  );

  const colunas = (configAtivo?.colunas ?? [])
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((c) => ({ id: c.id, title: c.nome, color: c.cor }));

  // Filtra por tipo selecionado. O recorte por sociedade já vem do endpoint quando embedded.
  const itens = useMemo(
    () => processos.filter((p) => (tipoAtivo ? p.tipoProcesso === tipoAtivo : true)),
    [processos, tipoAtivo],
  );

  // Invalida ambas as visões (geral e mini-board por sociedade) após mutações,
  // pois um mesmo processo aparece em ambas quando o usuário alterna de tela.
  const invalidarProcessos = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/processos"] });
    if (sociedadeIdFixa) {
      queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades", sociedadeIdFixa, "processos"] });
    }
  };

  const mover = useMutation({
    mutationFn: async (vars: { id: string; colunaPara: string }) => {
      const res = await apiRequest("PATCH", `/api/societario/pipeline/processos/${vars.id}/coluna`, {
        colunaPara: vars.colunaPara,
      });
      return res.json();
    },
    onSuccess: invalidarProcessos,
    onError: (err: any) => {
      const { message, body } = parseApiError(err);
      const pendentes: string[] = Array.isArray(body?.pendentes) ? body.pendentes : [];
      toast({
        title: "Avanço bloqueado",
        description: pendentes.length > 0 ? `${message}\n• ${pendentes.join("\n• ")}` : message,
        variant: "destructive",
      });
      invalidarProcessos();
    },
  });

  return (
    <div className={embedded ? "flex flex-col" : "flex flex-col h-full"}>
      <header className={`flex flex-wrap items-center justify-between gap-4 ${embedded ? "pb-3" : "p-4 border-b bg-background"}`}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2" data-testid="text-pipeline-title">
              <KanbanSquare className="h-6 w-6 text-primary" />
              Pipeline Societário
            </h1>
            <p className="text-sm text-muted-foreground">
              Acompanhe processos societários em tempo real — arraste cards para mover entre etapas
            </p>
          </div>
        )}
        <div className={`flex items-center gap-2 ${embedded ? "ml-auto" : ""}`}>
          {configs.length > 0 && (
            <Select value={tipoAtivo ?? ""} onValueChange={(v) => setTipoSelecionado(v)}>
              <SelectTrigger className="w-[220px]" data-testid="select-tipo-pipeline">
                <SelectValue placeholder="Tipo de processo" />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.tipoProcesso} data-testid={`option-tipo-${c.tipoProcesso}`}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => setOpenNovo(true)} data-testid="button-novo-processo">
            <Plus className="h-4 w-4 mr-1" />
            Novo processo
          </Button>
        </div>
      </header>

      <div className={embedded ? "overflow-x-auto" : "flex-1 overflow-x-auto p-4"}>
        {!configAtivo && !loadingCfgs ? (
          <div className="flex items-center justify-center h-full text-muted-foreground" data-testid="empty-no-config">
            Nenhuma configuração de pipeline disponível.
          </div>
        ) : (
          <KanbanBoard
            columns={colunas}
            items={itens}
            getColumnId={(p: ProcessoCard) => p.colunaAtual}
            isLoading={loadingCfgs || loadingProcs}
            emptyText="Nenhum processo nesta etapa"
            onMove={(item: ProcessoCard, _from: string, to: string) =>
              mover.mutate({ id: item.id, colunaPara: to })
            }
            renderCard={(p: ProcessoCard, { isDragging }: { isDragging?: boolean }) => (
              <KanbanCard
                key={p.id}
                id={p.id}
                isDragging={isDragging}
                testId={`card-processo-${p.id}`}
                onClick={() => setLocation(`/societario/pipeline/${p.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono text-muted-foreground" data-testid={`text-processo-number-${p.id}`}>
                      {p.processNumber}
                    </div>
                    <h4 className="text-sm font-medium leading-snug line-clamp-2" data-testid={`text-processo-titulo-${p.id}`}>
                      {p.titulo}
                    </h4>
                  </div>
                  {p.prioridade && (
                    <Badge
                      variant="secondary"
                      className={`text-[10px] shrink-0 ${PRIORIDADE_COLORS[p.prioridade] ?? ""}`}
                    >
                      {p.prioridade}
                    </Badge>
                  )}
                </div>

                {p.sociedadeRazao && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    <span className="truncate">{p.sociedadeRazao}</span>
                  </div>
                )}

                {p.dataPrevistaConclusao && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    <span>
                      Prazo: {new Date(p.dataPrevistaConclusao).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {(p.obrigatoriasPendentes ?? 0) > 0 ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400">
                      <AlertCircle className="h-3 w-3 mr-0.5" />
                      {p.obrigatoriasPendentes} obrig.
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700 dark:text-emerald-400">
                      Pronto p/ avançar
                    </Badge>
                  )}
                  {p.modoOperacao && p.modoOperacao !== "assistido" && (
                    <Badge variant="outline" className="text-[10px]">{p.modoOperacao}</Badge>
                  )}
                </div>
              </KanbanCard>
            )}
          />
        )}
      </div>

      <NovoProcessoDialog
        open={openNovo}
        onOpenChange={setOpenNovo}
        configs={configs}
        sociedades={sociedades}
        sociedadeIdFixa={sociedadeIdFixa}
        onCreated={(id) => setLocation(`/societario/pipeline/${id}`)}
      />
    </div>
  );
}

// ─────────────────────────── Modal Novo Processo ───────────────────────────
function NovoProcessoDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  configs: PipelineConfig[];
  sociedades: Sociedade[];
  sociedadeIdFixa?: string;
  onCreated: (id: string) => void;
}) {
  const { open, onOpenChange, configs, sociedades, sociedadeIdFixa, onCreated } = props;
  const { toast } = useToast();
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [sociedadeId, setSociedadeId] = useState(sociedadeIdFixa ?? "");
  const [pipelineConfigId, setPipelineConfigId] = useState("");
  const [prioridade, setPrioridade] = useState("media");
  const [modoOperacao, setModoOperacao] = useState("assistido");
  const [clientePessoaId, setClientePessoaId] = useState<string>("");
  const [clienteContatoPreferido, setClienteContatoPreferido] = useState<string>("inapp");
  const [pessoaPickerOpen, setPessoaPickerOpen] = useState(false);
  const [pessoaSearch, setPessoaSearch] = useState("");
  const [pessoaSearchDebounced, setPessoaSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setPessoaSearchDebounced(pessoaSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [pessoaSearch]);

  // Sincroniza com a prop quando ela muda (ex.: navegar entre sociedades sem desmontar o dialog).
  useEffect(() => {
    if (sociedadeIdFixa) setSociedadeId(sociedadeIdFixa);
  }, [sociedadeIdFixa]);

  const { data: pessoasCliente = [], isFetching: pessoasFetching } = useQuery<
    Array<{ id: string; nomeFantasia: string; razaoSocial?: string | null; cnpjCpf: string }>
  >({
    queryKey: ["/api/pessoas", { papel: "cliente", search: pessoaSearchDebounced }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("papel", "cliente");
      params.set("limit", "100");
      if (pessoaSearchDebounced) params.set("search", pessoaSearchDebounced);
      const r = await fetch(`/api/pessoas?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar pessoas");
      return r.json();
    },
    enabled: open,
  });

  const pessoaSelecionada = useMemo(
    () => pessoasCliente.find((p) => p.id === clientePessoaId) ?? null,
    [pessoasCliente, clientePessoaId],
  );

  const cfgEscolhido = configs.find((c) => c.id === pipelineConfigId);

  const reset = () => {
    setTitulo(""); setDescricao(""); setSociedadeId(sociedadeIdFixa ?? "");
    setPipelineConfigId(""); setPrioridade("media"); setModoOperacao("assistido");
    setClientePessoaId(""); setClienteContatoPreferido("inapp");
  };

  const criar = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/societario/pipeline/processos", {
        titulo,
        descricao: descricao || null,
        sociedadeId,
        pipelineConfigId,
        tipoProcesso: cfgEscolhido?.tipoProcesso ?? "alteracao_contratual",
        prioridade,
        modoOperacao,
        clientePessoaId: clientePessoaId || null,
        clienteContatoPreferido: clientePessoaId ? clienteContatoPreferido : undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/processos"] });
      if (sociedadeIdFixa) {
        queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades", sociedadeIdFixa, "processos"] });
      }
      toast({ title: "Processo criado", description: `${data.processNumber} — checklist com ${data.tarefasCriadas ?? 0} tarefas` });
      reset();
      onOpenChange(false);
      if (data?.id) onCreated(data.id);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar", description: err?.message ?? String(err), variant: "destructive" });
    },
  });

  const podeSubmeter = titulo.trim().length >= 3 && sociedadeId && pipelineConfigId;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-novo-processo">
        <DialogHeader>
          <DialogTitle>Novo processo societário</DialogTitle>
          <DialogDescription>
            Cria um processo manual no pipeline. O checklist é materializado automaticamente
            a partir do template do tipo selecionado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="titulo">Título *</Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Alteração de capital social — Acme Ltda"
              data-testid="input-titulo-processo"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Sociedade *</Label>
              <Select value={sociedadeId} onValueChange={setSociedadeId} disabled={!!sociedadeIdFixa}>
                <SelectTrigger data-testid="select-sociedade-processo">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {sociedades.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-testid={`option-sociedade-${s.id}`}>
                      {s.razaoSocial}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sociedadeIdFixa && (
                <p className="text-xs text-muted-foreground">Sociedade pré-selecionada (fixada na aba)</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label>Tipo *</Label>
              <Select value={pipelineConfigId} onValueChange={setPipelineConfigId}>
                <SelectTrigger data-testid="select-tipo-processo">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id} data-testid={`option-config-${c.id}`}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={setPrioridade}>
                <SelectTrigger data-testid="select-prioridade-processo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Modo de operação</Label>
              <Select value={modoOperacao} onValueChange={setModoOperacao}>
                <SelectTrigger data-testid="select-modo-processo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (sem agente)</SelectItem>
                  <SelectItem value="assistido">Assistido</SelectItem>
                  <SelectItem value="auto">Automático</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Pessoa cliente</Label>
              <Popover open={pessoaPickerOpen} onOpenChange={setPessoaPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={pessoaPickerOpen}
                    className={cn("justify-between font-normal", !pessoaSelecionada && "text-muted-foreground")}
                    data-testid="select-cliente-pessoa"
                  >
                    <span className="truncate">
                      {pessoaSelecionada
                        ? `${pessoaSelecionada.razaoSocial || pessoaSelecionada.nomeFantasia}${
                            pessoaSelecionada.cnpjCpf ? ` · ${pessoaSelecionada.cnpjCpf}` : ""
                          }`
                        : "(Opcional) — buscar por nome ou CNPJ/CPF"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <div className="flex items-center border-b px-2">
                      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                      <CommandInput
                        placeholder="Buscar pessoa…"
                        value={pessoaSearch}
                        onValueChange={setPessoaSearch}
                        className="h-9 border-0 focus:ring-0"
                        data-testid="input-pessoa-search"
                      />
                    </div>
                    <CommandList>
                      {pessoasFetching ? (
                        <div className="p-2 text-xs text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
                        </div>
                      ) : (
                        <CommandEmpty>Nenhuma pessoa encontrada.</CommandEmpty>
                      )}
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            setClientePessoaId("");
                            setPessoaPickerOpen(false);
                          }}
                          data-testid="option-cliente-pessoa-none"
                        >
                          <Check className={cn("mr-2 h-4 w-4", !clientePessoaId ? "opacity-100" : "opacity-0")} />
                          — Sem vínculo —
                        </CommandItem>
                        {pessoasCliente.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.razaoSocial ?? ""} ${p.nomeFantasia ?? ""} ${p.cnpjCpf ?? ""} ${p.id}`}
                            onSelect={() => {
                              setClientePessoaId(p.id);
                              setPessoaPickerOpen(false);
                            }}
                            data-testid={`option-cliente-pessoa-${p.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                clientePessoaId === p.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="text-sm">{p.razaoSocial || p.nomeFantasia}</span>
                              {p.cnpjCpf && (
                                <span className="text-[11px] text-muted-foreground font-mono">{p.cnpjCpf}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-[11px] text-muted-foreground">
                Pessoa cadastrada com papel "cliente" (CRM 2.0).
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label>Canal preferido</Label>
              <Select
                value={clienteContatoPreferido}
                onValueChange={setClienteContatoPreferido}
                disabled={!clientePessoaId}
              >
                <SelectTrigger data-testid="select-canal-preferido">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inapp">In-app</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="ambos">Ambos (e-mail + WhatsApp)</SelectItem>
                </SelectContent>
              </Select>
              {pessoaSelecionada && (
                <p className="text-[11px] text-muted-foreground" data-testid="text-canal-preview">
                  Notificações ao cliente serão enviadas via{" "}
                  <span className="font-medium">
                    {clienteContatoPreferido === "inapp" && "in-app"}
                    {clienteContatoPreferido === "email" && "e-mail"}
                    {clienteContatoPreferido === "whatsapp" && "WhatsApp"}
                    {clienteContatoPreferido === "ambos" && "e-mail + WhatsApp"}
                  </span>
                  .
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="descricao">Descrição</Label>
            <Textarea
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder="Contexto, observações, prazo desejado…"
              data-testid="input-descricao-processo"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancelar-processo">
            Cancelar
          </Button>
          <Button
            onClick={() => criar.mutate()}
            disabled={!podeSubmeter || criar.isPending}
            data-testid="button-confirmar-processo"
          >
            {criar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Criar processo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
