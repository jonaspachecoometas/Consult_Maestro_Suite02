import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Settings2, Save, X, ListChecks, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, parseApiError } from "@/lib/queryClient";

interface Coluna {
  id: string;
  nome: string;
  ordem: number;
  cor?: string;
  autoAdvance?: boolean;
}

interface PipelineConfig {
  id: string;
  nome: string;
  tipoProcesso: string;
  colunas: Coluna[];
  isDefault?: boolean;
  isActive?: boolean;
}

interface ChecklistItem {
  id: string;
  pipelineConfigId: string;
  etapa: string;
  ordem: number;
  titulo: string;
  descricao: string | null;
  executorType: string;
  isRequired: boolean;
  bloqueiaAvanco: boolean;
  tipo: string | null;
  tarefaKey: string | null;
  dependsOnKeys: string[] | null;
  acaoAutomatica?: { skill?: string; params?: Record<string, unknown> } | null;
}

const SKILL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "verificar_dados_empresa", label: "Verificar dados da empresa" },
  { value: "solicitar_documentos_cliente", label: "Solicitar documentos ao cliente" },
  { value: "validar_documentos_recebidos", label: "Validar documentos recebidos" },
  { value: "gerar_minuta", label: "Gerar minuta" },
  { value: "lembrar_documentos_pendentes", label: "Lembrar documentos pendentes" },
  { value: "atualizar_pipeline", label: "Atualizar pipeline" },
];

interface PipelineConfigsProps { embedded?: boolean }

export default function PipelineConfigs({ embedded = false }: PipelineConfigsProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<PipelineConfig | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PipelineConfig | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: configs = [], isLoading } = useQuery<PipelineConfig[]>({
    queryKey: ["/api/societario/pipeline/configs"],
  });

  const deleteCfg = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/societario/pipeline/configs/${id}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      const msg = data?.mode === "soft"
        ? `Pipeline desativado (${data.reason}).`
        : "Pipeline removido.";
      toast({ title: "Sucesso", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/configs"] });
      setConfirmDelete(null);
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha", description: message, variant: "destructive" });
    },
  });

  return (
    <div className={embedded ? "space-y-4" : "p-6 space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-primary" /> Configuração de Pipelines
          </h1>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-novo-pipeline">
            <Plus className="h-4 w-4 mr-1" /> Novo pipeline
          </Button>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setCreateOpen(true)} data-testid="button-novo-pipeline">
            <Plus className="h-4 w-4 mr-1" /> Novo pipeline
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-10 text-sm text-muted-foreground" data-testid="text-no-configs">
            Nenhum pipeline cadastrado. Clique em <strong>Novo pipeline</strong> para criar.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {configs.map((c) => (
            <Card key={c.id} data-testid={`card-config-${c.id}`} className={c.isActive === false ? "opacity-60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {c.nome}
                      {c.isDefault && <Badge variant="secondary" className="text-[10px]">padrão</Badge>}
                      {c.isActive === false && <Badge variant="outline" className="text-[10px]">inativo</Badge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <code>{c.tipoProcesso}</code> · {c.colunas.length} coluna(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)} data-testid={`button-editar-${c.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(c)} data-testid={`button-excluir-${c.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {c.colunas
                    .slice()
                    .sort((a, b) => a.ordem - b.ordem)
                    .map((col) => (
                      <Badge key={col.id} variant="outline" className="text-[10px]" data-testid={`coluna-${c.id}-${col.id}`}>
                        {col.nome}
                      </Badge>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(editing || createOpen) && (
        <ConfigEditor
          config={editing}
          open
          onOpenChange={(o) => { if (!o) { setEditing(null); setCreateOpen(false); } }}
          onSaved={() => { setEditing(null); setCreateOpen(false); }}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent data-testid="dialog-confirmar-excluir-config">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Excluir pipeline?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se houver processos vinculados, o pipeline será apenas <strong>desativado</strong>.
              Caso contrário, ele será removido permanentemente. Confirmar exclusão de <strong>{confirmDelete?.nome}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancelar-excluir-config">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteCfg.mutate(confirmDelete.id)}
              data-testid="button-confirmar-excluir-config"
            >
              {deleteCfg.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConfigEditor({
  config, open, onOpenChange, onSaved,
}: { config: PipelineConfig | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = !!config;
  const [nome, setNome] = useState(config?.nome ?? "");
  const [tipoProcesso, setTipoProcesso] = useState(config?.tipoProcesso ?? "");
  const [isDefault, setIsDefault] = useState(config?.isDefault ?? false);
  const [isActive, setIsActive] = useState(config?.isActive ?? true);
  const [colunas, setColunas] = useState<Coluna[]>(
    config?.colunas?.slice().sort((a, b) => a.ordem - b.ordem) ?? [
      { id: "todo", nome: "A fazer", ordem: 0 },
      { id: "doing", nome: "Em andamento", ordem: 1 },
      { id: "concluido", nome: "Concluído", ordem: 2 },
    ],
  );

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        nome,
        tipoProcesso,
        isDefault,
        isActive,
        colunas: colunas.map((c, i) => ({ ...c, ordem: i })),
      };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/societario/pipeline/configs/${config!.id}`, payload)
        : await apiRequest("POST", `/api/societario/pipeline/configs`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sucesso", description: isEdit ? "Pipeline atualizado." : "Pipeline criado." });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/configs"] });
      onSaved();
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha", description: message, variant: "destructive" });
    },
  });

  function addColuna() {
    const idx = colunas.length;
    setColunas([...colunas, { id: `col_${idx + 1}`, nome: `Coluna ${idx + 1}`, ordem: idx }]);
  }
  function rmColuna(i: number) {
    setColunas(colunas.filter((_, j) => j !== i));
  }
  function updColuna(i: number, patch: Partial<Coluna>) {
    setColunas(colunas.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="dialog-editor-pipeline">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pipeline" : "Novo pipeline"}</DialogTitle>
          <DialogDescription>
            Defina o nome, o tipo de processo (chave única) e as colunas do Kanban.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cfg-nome">Nome</Label>
              <Input id="cfg-nome" value={nome} onChange={(e) => setNome(e.target.value)} data-testid="input-cfg-nome" />
            </div>
            <div>
              <Label htmlFor="cfg-tipo">Tipo de processo</Label>
              <Input
                id="cfg-tipo"
                value={tipoProcesso}
                onChange={(e) => setTipoProcesso(e.target.value)}
                placeholder="ex: constituicao, alteracao_contratual"
                disabled={isEdit}
                data-testid="input-cfg-tipo"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} data-testid="switch-cfg-default" />
              Padrão
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-cfg-active" />
              Ativo
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-medium">Colunas</h3>
              <Button variant="outline" size="sm" onClick={addColuna} data-testid="button-add-coluna">
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar coluna
              </Button>
            </div>
            <div className="space-y-1.5">
              {colunas.map((c, i) => (
                <div key={i} className="flex items-center gap-2 border rounded p-2" data-testid={`row-coluna-${i}`}>
                  <Input
                    placeholder="id (snake_case)"
                    value={c.id}
                    onChange={(e) => updColuna(i, { id: e.target.value })}
                    className="w-40"
                    data-testid={`input-coluna-id-${i}`}
                  />
                  <Input
                    placeholder="Nome"
                    value={c.nome}
                    onChange={(e) => updColuna(i, { nome: e.target.value })}
                    data-testid={`input-coluna-nome-${i}`}
                  />
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                    <Switch
                      checked={!!c.autoAdvance}
                      onCheckedChange={(v) => updColuna(i, { autoAdvance: v })}
                      data-testid={`switch-coluna-auto-${i}`}
                    />
                    Auto
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => rmColuna(i)}
                    data-testid={`button-rm-coluna-${i}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {colunas.length < 2 && (
                <p className="text-xs text-amber-600">É necessário ao menos 2 colunas.</p>
              )}
            </div>
          </div>

          {isEdit && config && <ItemsPanel configId={config.id} colunas={colunas} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancelar-cfg">
            Cancelar
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !nome || !tipoProcesso || colunas.length < 2}
            data-testid="button-salvar-cfg"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemsPanel({ configId, colunas }: { configId: string; colunas: Coluna[] }) {
  const { toast } = useToast();
  const [novoOpen, setNovoOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ChecklistItem | null>(null);

  const { data: items = [], isLoading } = useQuery<ChecklistItem[]>({
    queryKey: ["/api/societario/pipeline/configs", configId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/societario/pipeline/configs/${configId}/items`, { credentials: "include" });
      if (!res.ok) throw new Error("Falha");
      return res.json();
    },
  });

  const remove = useMutation({
    mutationFn: async (iid: string) => {
      const res = await apiRequest("DELETE", `/api/societario/pipeline/configs/${configId}/items/${iid}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item removido" });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/configs", configId, "items"] });
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha", description: message, variant: "destructive" });
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const it of items) {
      if (!m.has(it.etapa)) m.set(it.etapa, []);
      m.get(it.etapa)!.push(it);
    }
    Array.from(m.values()).forEach((arr: ChecklistItem[]) => arr.sort((a, b) => a.ordem - b.ordem));
    return m;
  }, [items]);

  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium flex items-center gap-1"><ListChecks className="h-4 w-4" /> Itens do checklist</h3>
        <Button variant="outline" size="sm" onClick={() => setNovoOpen(true)} data-testid="button-novo-item">
          <Plus className="h-3.5 w-3.5 mr-1" /> Novo item
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum item cadastrado.</p>
      ) : (
        colunas.map((col) => {
          const arr = grouped.get(col.id) ?? [];
          if (arr.length === 0) return null;
          return (
            <div key={col.id} className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{col.nome}</div>
              <div className="space-y-1">
                {arr.map((it) => (
                  <div key={it.id} className="flex items-start justify-between gap-2 border rounded p-1.5" data-testid={`item-${it.id}`}>
                    <div className="text-sm">
                      <div>{it.titulo}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {it.executorType} · {it.tipo ?? "checkbox"}
                        {it.isRequired ? " · obrigatória" : ""}
                        {it.tarefaKey ? ` · key=${it.tarefaKey}` : ""}
                        {it.acaoAutomatica?.skill ? ` · agente=${it.acaoAutomatica.skill}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingItem(it)}
                        data-testid={`button-edit-item-${it.id}`}
                        title="Editar item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(it.id)}
                        data-testid={`button-rm-item-${it.id}`}
                        title="Excluir item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {novoOpen && (
        <ItemDialog
          configId={configId}
          colunas={colunas}
          mode="create"
          existingCount={items.length}
          open
          onOpenChange={(o) => !o && setNovoOpen(false)}
        />
      )}
      {editingItem && (
        <ItemDialog
          configId={configId}
          colunas={colunas}
          mode="edit"
          item={editingItem}
          existingCount={items.length}
          open
          onOpenChange={(o) => !o && setEditingItem(null)}
        />
      )}
    </div>
  );
}

function ItemDialog({
  configId,
  colunas,
  mode,
  item,
  existingCount,
  open,
  onOpenChange,
}: {
  configId: string;
  colunas: Coluna[];
  mode: "create" | "edit";
  item?: ChecklistItem;
  existingCount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const [etapa, setEtapa] = useState<string>(item?.etapa ?? colunas[0]?.id ?? "");
  const [ordem, setOrdem] = useState<number>(item?.ordem ?? existingCount);
  const [titulo, setTitulo] = useState(item?.titulo ?? "");
  const [descricao, setDescricao] = useState(item?.descricao ?? "");
  const [executorType, setExecutorType] = useState(item?.executorType ?? "analista");
  const [tipo, setTipo] = useState(item?.tipo ?? "checkbox");
  const [tarefaKey, setTarefaKey] = useState(item?.tarefaKey ?? "");
  const [isRequired, setIsRequired] = useState(item?.isRequired ?? true);
  const [bloqueiaAvanco, setBloqueiaAvanco] = useState(item?.bloqueiaAvanco ?? true);
  const [skill, setSkill] = useState<string>(item?.acaoAutomatica?.skill ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        etapa,
        ordem,
        titulo,
        descricao: descricao || null,
        executorType,
        tipo,
        tarefaKey: tarefaKey || null,
        isRequired,
        bloqueiaAvanco,
        acaoAutomatica: skill ? { skill } : null,
      };
      const url =
        mode === "create"
          ? `/api/societario/pipeline/configs/${configId}/items`
          : `/api/societario/pipeline/configs/${configId}/items/${item!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Item adicionado" : "Item atualizado" });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/pipeline/configs", configId, "items"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      const { message } = parseApiError(err);
      toast({ title: "Falha", description: message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={mode === "create" ? "dialog-novo-item" : "dialog-edit-item"}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo item de checklist" : "Editar item de checklist"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Alterações afetam apenas processos novos. Tarefas já materializadas mantêm o snapshot."
              : "Defina título, executor, tipo e (opcionalmente) a ação automática do agente."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label>Etapa (coluna)</Label>
              <Select value={etapa} onValueChange={setEtapa}>
                <SelectTrigger data-testid="select-item-etapa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {colunas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ordem</Label>
              <Input
                type="number"
                value={ordem}
                onChange={(e) => setOrdem(Number(e.target.value) || 0)}
                data-testid="input-item-ordem"
              />
            </div>
          </div>
          <div>
            <Label>Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} data-testid="input-item-titulo" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={descricao ?? ""} onChange={(e) => setDescricao(e.target.value)} data-testid="input-item-descricao" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Executor</Label>
              <Select value={executorType} onValueChange={setExecutorType}>
                <SelectTrigger data-testid="select-item-executor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analista">analista</SelectItem>
                  <SelectItem value="cliente">cliente</SelectItem>
                  <SelectItem value="agente">agente</SelectItem>
                  <SelectItem value="sistema">sistema</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={tipo ?? "checkbox"} onValueChange={setTipo}>
                <SelectTrigger data-testid="select-item-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkbox">checkbox</SelectItem>
                  <SelectItem value="upload">upload</SelectItem>
                  <SelectItem value="date">date</SelectItem>
                  <SelectItem value="form">form</SelectItem>
                  <SelectItem value="approval">approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Key (opcional)</Label>
              <Input value={tarefaKey ?? ""} onChange={(e) => setTarefaKey(e.target.value)} placeholder="ex: docs_pessoa" data-testid="input-item-key" />
            </div>
          </div>
          <div>
            <Label>Ação automática (skill do agente)</Label>
            <Select value={skill || "__none__"} onValueChange={(v) => setSkill(v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-item-skill"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhuma (sem ação automática)</SelectItem>
                {SKILL_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isRequired} onCheckedChange={setIsRequired} data-testid="switch-item-required" />
              Obrigatória
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={bloqueiaAvanco} onCheckedChange={setBloqueiaAvanco} data-testid="switch-item-bloqueia" />
              Bloqueia avanço
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancelar-item">Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!titulo || !etapa || save.isPending} data-testid="button-salvar-item">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
