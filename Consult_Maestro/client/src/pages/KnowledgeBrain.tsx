import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Brain, Plus, Trash2, RefreshCw, Sparkles, Loader2, Search, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type BrainItem = {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string | null;
  categoryId: string | null;
  usageCount: number | null;
  embeddingProvider: string | null;
  updatedAt: string;
};

type AgentSource = { id: string; title: string; type: string; score: number };
type AgentRunResult = {
  response: string;
  sources: AgentSource[];
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
};

const ITEM_TYPES = [
  { value: "metodologia", label: "Metodologia" },
  { value: "best_practice", label: "Best Practice" },
  { value: "caso_de_uso", label: "Caso de Uso" },
  { value: "legislacao", label: "Legislação" },
  { value: "template", label: "Template" },
  { value: "licao_aprendida", label: "Lição Aprendida" },
];

const AGENT_TYPES = [
  { value: "generic", label: "Geral" },
  { value: "diagnostic_canvas", label: "Diagnóstico Canvas" },
  { value: "process_recommendation", label: "Recomendação de Processo" },
  { value: "swot_analysis", label: "Análise SWOT" },
  { value: "erp_gap_analysis", label: "Gap Analysis ERP" },
];

export default function KnowledgeBrain() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<BrainItem | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentType, setAgentType] = useState("generic");
  const [agentResult, setAgentResult] = useState<AgentRunResult | null>(null);

  const itemsQuery = useQuery<BrainItem[]>({ queryKey: ["/api/brain/items"] });

  const createItem = useMutation({
    mutationFn: async (payload: any) => {
      const r = await apiRequest("POST", "/api/brain/items", payload);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brain/items"] });
      setCreateOpen(false);
      toast({ title: "Item adicionado", description: "Embedding gerado em segundo plano." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const r = await apiRequest("PATCH", `/api/brain/items/${id}`, payload);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brain/items"] });
      setEditItem(null);
      toast({ title: "Item atualizado", description: "Embedding será regenerado." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/brain/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brain/items"] });
      toast({ title: "Item removido" });
    },
  });

  const reindex = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/brain/reindex", {});
      return r.json();
    },
    onSuccess: (data: any) =>
      toast({
        title: "Reindexação concluída",
        description: `${data.ok}/${data.total} itens reindexados`,
      }),
  });

  const runAgent = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/agents/run", {
        agentType,
        prompt: agentPrompt,
      });
      return r.json();
    },
    onSuccess: (data: AgentRunResult) => setAgentResult(data),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="h-8 w-8 text-primary" />
            Cérebro de Inteligência
          </h1>
          <p className="text-muted-foreground mt-1">
            Base de conhecimento RAG + agentes de IA (Claude) para diagnóstico, processos, SWOT e ERP.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => reindex.mutate()}
            disabled={reindex.isPending}
            data-testid="button-reindex"
          >
            {reindex.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Reindexar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="agent">
        <TabsList>
          <TabsTrigger value="agent" data-testid="tab-agent">
            <Sparkles className="h-4 w-4 mr-2" /> Consultar Agente
          </TabsTrigger>
          <TabsTrigger value="items" data-testid="tab-items">
            Conhecimento ({itemsQuery.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* ── Agent Tab ── */}
        <TabsContent value="agent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Consultar IA com contexto</CardTitle>
              <CardDescription>
                A pergunta é enriquecida automaticamente com itens relevantes da base de conhecimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <Label>Tipo de agente</Label>
                  <Select value={agentType} onValueChange={setAgentType}>
                    <SelectTrigger data-testid="select-agent-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Pergunta / contexto</Label>
                <Textarea
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  rows={5}
                  placeholder="Ex: Diagnostique uma fábrica de móveis com 50 funcionários que não tem ERP e perde controle de estoque..."
                  data-testid="input-agent-prompt"
                />
              </div>
              <Button
                onClick={() => runAgent.mutate()}
                disabled={runAgent.isPending || !agentPrompt.trim()}
                data-testid="button-run-agent"
              >
                {runAgent.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Consultar IA
              </Button>
            </CardContent>
          </Card>

          {agentResult && (
            <Card data-testid="card-agent-result">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Resposta</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {agentResult.tokensInput}+{agentResult.tokensOutput} tokens ·{" "}
                    {(agentResult.durationMs / 1000).toFixed(1)}s
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-sm font-sans" data-testid="text-agent-response">
                  {agentResult.response}
                </pre>
                {agentResult.sources.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Fontes consultadas:
                    </p>
                    <div className="space-y-1">
                      {agentResult.sources.map((s, i) => (
                        <div key={s.id} className="text-xs flex items-center gap-2">
                          <Badge variant="outline">#{i + 1}</Badge>
                          <span className="font-medium">{s.title}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {s.type}
                          </Badge>
                          <span className="text-muted-foreground">
                            score: {s.score.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Items Tab ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-item">
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar conhecimento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Novo item</DialogTitle>
                  <DialogDescription>
                    Adicione metodologias, casos de uso, legislações ou lições aprendidas. O embedding será gerado automaticamente.
                  </DialogDescription>
                </DialogHeader>
                <CreateItemForm
                  onSubmit={(values) => createItem.mutate(values)}
                  pending={createItem.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          {itemsQuery.isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : itemsQuery.data && itemsQuery.data.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {itemsQuery.data.map((item) => (
                <Card key={item.id} data-testid={`card-item-${item.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{item.title}</CardTitle>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {item.type}
                          </Badge>
                          {item.embeddingProvider && (
                            <Badge variant="secondary" className="text-xs">
                              indexado
                            </Badge>
                          )}
                          {item.usageCount! > 0 && (
                            <Badge className="text-xs">usado {item.usageCount}×</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditItem(item)}
                          data-testid={`button-edit-${item.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteItem.mutate(item.id)}
                          data-testid={`button-delete-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-3">{item.content}</p>
                    {item.tags && (
                      <p className="text-xs text-muted-foreground mt-2">Tags: {item.tags}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum item ainda. Adicione conhecimento para que a IA possa usá-lo nas respostas.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar item</DialogTitle>
            <DialogDescription>
              Ajuste o conteúdo. O embedding será regenerado automaticamente.
            </DialogDescription>
          </DialogHeader>
          {editItem && (
            <CreateItemForm
              initial={editItem}
              onSubmit={(values) => updateItem.mutate({ id: editItem.id, payload: values })}
              pending={updateItem.isPending}
              submitLabel="Salvar"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateItemForm({
  onSubmit,
  pending,
  initial,
  submitLabel = "Adicionar",
}: {
  onSubmit: (values: any) => void;
  pending: boolean;
  initial?: BrainItem;
  submitLabel?: string;
}) {
  const [type, setType] = useState(initial?.type ?? "metodologia");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [tags, setTags] = useState(initial?.tags ?? "");

  return (
    <div className="space-y-3">
      <div>
        <Label>Tipo</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger data-testid="select-item-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITEM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Título</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="input-item-title"
        />
      </div>
      <div>
        <Label>Conteúdo</Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          data-testid="input-item-content"
        />
      </div>
      <div>
        <Label>Tags (separadas por vírgula)</Label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="lean, kaizen, manufatura"
          data-testid="input-item-tags"
        />
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ type, title, content, tags })}
          disabled={pending || !title.trim() || !content.trim()}
          data-testid="button-submit-item"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}
