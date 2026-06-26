import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, Link } from "wouter";
import { 
  Grid3X3, 
  Plus, 
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  AlertCircle,
  Save,
  Loader2,
  HelpCircle,
  Lightbulb,
  Trash2,
  RefreshCcw,
  Target,
  ClipboardCheck,
  Wrench,
  CheckSquare,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CANVAS_BLOCK_TYPES, CANVAS_LEVELS } from "@/lib/constants";
import { MaturityRadarChart, getMaturityLevel } from "@/components/MaturityRadarChart";
import { AgentPanel } from "@/components/AgentPanel";
import type { Project, CanvasBlock, CanvasBlockQuestion, CanvasPdcaItem, SwotItem, SwotAnalysis } from "@shared/schema";

function CompletenessIndicator({ value }: { value: number }) {
  if (value === 0) return <Circle className="h-4 w-4 text-muted-foreground" />;
  if (value < 50) return <AlertCircle className="h-4 w-4 text-yellow-500" />;
  if (value < 100) return <AlertCircle className="h-4 w-4 text-blue-500" />;
  return <CheckCircle2 className="h-4 w-4 text-green-500" />;
}

function RatingBadge({ rating }: { rating: number | null | undefined }) {
  if (rating === null || rating === undefined) {
    return <Badge variant="outline" size="sm" className="text-xs">-</Badge>;
  }
  const color = rating >= 7 ? "bg-green-500" : rating >= 4 ? "bg-yellow-500" : "bg-red-500";
  return (
    <Badge size="sm" className={`text-xs text-white ${color}`}>
      {rating}/10
    </Badge>
  );
}

interface QuestionItemProps {
  question: CanvasBlockQuestion;
  onUpdate: (updates: Partial<CanvasBlockQuestion>) => void;
  onDelete: () => void;
  isCustom: boolean;
}

function QuestionItem({ question, onUpdate, onDelete, isCustom }: QuestionItemProps) {
  const [localAnswer, setLocalAnswer] = useState(question.answer || "");
  const [localRating, setLocalRating] = useState<number>(question.rating ?? 5);
  const [localNotes, setLocalNotes] = useState(question.notes || "");
  const [showNotes, setShowNotes] = useState(!!question.notes);

  useEffect(() => {
    setLocalAnswer(question.answer || "");
    setLocalRating(question.rating ?? 5);
    setLocalNotes(question.notes || "");
    setShowNotes(!!question.notes);
  }, [question.id, question.answer, question.rating, question.notes]);

  const handleBlur = (overrideRating?: number) => {
    const ratingToUse = overrideRating !== undefined ? overrideRating : localRating;
    if (localAnswer !== (question.answer || "") || 
        ratingToUse !== (question.rating ?? 5) ||
        localNotes !== (question.notes || "")) {
      onUpdate({ answer: localAnswer, rating: ratingToUse, notes: localNotes });
    }
  };

  return (
    <div className="border border-border rounded-md p-3 space-y-3 bg-background">
      <div className="flex items-start gap-2">
        <span className="text-primary font-medium shrink-0 mt-0.5">?</span>
        <div className="flex-1">
          <p className="text-sm font-medium">{question.questionText}</p>
        </div>
        {isCustom && (
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={onDelete}
            className="h-6 w-6"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          placeholder="Digite sua resposta..."
          value={localAnswer}
          onChange={(e) => setLocalAnswer(e.target.value)}
          onBlur={() => handleBlur()}
          rows={2}
          className="resize-none text-sm"
          data-testid={`textarea-question-${question.id}`}
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Nota:</span>
          <Slider
            value={[localRating]}
            onValueChange={([val]) => setLocalRating(val)}
            onValueCommit={([val]) => {
              setLocalRating(val);
              handleBlur(val);
            }}
            max={10}
            min={0}
            step={1}
            className="flex-1"
            data-testid={`slider-rating-${question.id}`}
          />
          <RatingBadge rating={localRating} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNotes(!showNotes)}
          className="text-xs"
        >
          {showNotes ? "Ocultar notas" : "Adicionar notas"}
        </Button>
      </div>

      {showNotes && (
        <div className="space-y-1">
          <Input
            placeholder="Notas adicionais..."
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            onBlur={() => handleBlur()}
            className="text-sm"
            data-testid={`input-notes-${question.id}`}
          />
        </div>
      )}
    </div>
  );
}

function CanvasBlockCard({ 
  blockType, 
  blocks, 
  projectId,
  selectedLevel 
}: { 
  blockType: typeof CANVAS_BLOCK_TYPES[number];
  blocks: CanvasBlock[];
  projectId: string;
  selectedLevel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState("");
  const { toast } = useToast();

  const block = blocks.find(b => b.blockType === blockType.value && b.level === selectedLevel);
  const allBlocksForType = blocks.filter(b => b.blockType === blockType.value);

  const { data: questions = [], isLoading: questionsLoading } = useQuery<CanvasBlockQuestion[]>({
    queryKey: ["/api/canvas", block?.id, "questions"],
    enabled: !!block?.id && isOpen,
  });

  const averageRating = questions.length > 0
    ? questions.filter(q => q.rating !== null).reduce((acc, q) => acc + (q.rating || 0), 0) / 
      (questions.filter(q => q.rating !== null).length || 1)
    : 0;

  const answeredCount = questions.filter(q => q.answer && q.answer.trim().length > 0).length;
  const completeness = block?.completeness || (questions.length > 0 ? Math.floor((answeredCount / questions.length) * 100) : 0);

  useEffect(() => {
    setContent(block?.content || "");
  }, [block?.id, selectedLevel]);

  const createBlockMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/canvas`, {
        blockType: blockType.value,
        level: selectedLevel,
        title: blockType.label,
        content: "",
        completeness: 0
      });
      return response.json();
    },
    onSuccess: async (newBlock) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "canvas"] });
      for (let i = 0; i < blockType.questions.length; i++) {
        await apiRequest("POST", `/api/canvas/${newBlock.id}/questions`, {
          questionText: blockType.questions[i],
          order: i,
          isDefault: 1
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/canvas", newBlock.id, "questions"] });
    },
  });

  useEffect(() => {
    if (isOpen && !block && !createBlockMutation.isPending) {
      createBlockMutation.mutate();
    }
  }, [isOpen, block]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setIsSaving(true);
      if (block) {
        const newCompleteness = questions.length > 0 
          ? Math.floor((answeredCount / questions.length) * 100) 
          : (content.length > 0 ? Math.floor(Math.min(100, content.length / 5)) : 0);
        await apiRequest("PATCH", `/api/canvas/${block.id}`, { 
          content,
          completeness: newCompleteness
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "canvas"] });
      toast({ title: "Salvo", description: "Bloco atualizado com sucesso." });
      setIsSaving(false);
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível salvar.", variant: "destructive" });
      setIsSaving(false);
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<CanvasBlockQuestion> }) => {
      await apiRequest("PATCH", `/api/canvas/questions/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas", block?.id, "questions"] });
    },
  });

  const addQuestionMutation = useMutation({
    mutationFn: async () => {
      if (!block || !newQuestionText.trim()) return;
      await apiRequest("POST", `/api/canvas/${block.id}/questions`, {
        questionText: newQuestionText.trim(),
        order: questions.length,
        isDefault: 0
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas", block?.id, "questions"] });
      setNewQuestionText("");
      toast({ title: "Pergunta adicionada" });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/canvas/questions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas", block?.id, "questions"] });
      toast({ title: "Pergunta removida" });
    },
  });

  // PDCA Query and Mutations
  const { data: pdcaItems = [] } = useQuery<CanvasPdcaItem[]>({
    queryKey: ["/api/projects", projectId, "pdca"],
    enabled: !!projectId && isOpen,
  });

  const blockPdcaItems = pdcaItems.filter(item => item.blockId === block?.id);

  const [showPdcaForm, setShowPdcaForm] = useState(false);
  const [newPdcaTitle, setNewPdcaTitle] = useState("");

  // SWOT state
  const [showSwotForm, setShowSwotForm] = useState(false);
  const [newSwotTitle, setNewSwotTitle] = useState("");
  const [newSwotType, setNewSwotType] = useState<string>("strength");

  // SWOT Query
  const { data: swotAnalyses = [] } = useQuery<SwotAnalysis[]>({
    queryKey: ["/api/projects", projectId, "swot"],
    enabled: !!projectId && isOpen,
  });

  const { data: swotItems = [] } = useQuery<SwotItem[]>({
    queryKey: ["/api/projects", projectId, "swot-pdca"],
    enabled: !!projectId && isOpen,
  });

  const blockSwotItems = swotItems.filter(item => item.linkedCanvasBlockId === block?.id);

  const createPdcaMutation = useMutation({
    mutationFn: async () => {
      if (!block || !newPdcaTitle.trim()) return;
      await apiRequest("POST", `/api/projects/${projectId}/pdca`, {
        blockId: block.id,
        title: newPdcaTitle.trim(),
        status: "plan"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pdca"] });
      setNewPdcaTitle("");
      setShowPdcaForm(false);
      toast({ title: "Item PDCA criado" });
    },
  });

  const updatePdcaStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/pdca/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pdca"] });
    },
  });

  const deletePdcaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pdca/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "pdca"] });
      toast({ title: "Item PDCA removido" });
    },
  });

  // SWOT Mutations
  const createSwotItemMutation = useMutation({
    mutationFn: async () => {
      if (!block || !newSwotTitle.trim()) return;
      let analysisId = swotAnalyses[0]?.id;
      if (!analysisId) {
        const response = await apiRequest("POST", `/api/projects/${projectId}/swot`, {
          name: "Análise Canvas",
          description: "Análise SWOT gerada a partir do Canvas BMC"
        });
        const newAnalysis = await response.json();
        analysisId = newAnalysis.id;
      }
      await apiRequest("POST", `/api/swot/${analysisId}/items`, {
        type: newSwotType,
        title: newSwotTitle.trim(),
        priority: "medium",
        linkedCanvasBlockId: block.id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "swot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "swot-pdca"] });
      setNewSwotTitle("");
      setShowSwotForm(false);
      toast({ title: "Item SWOT criado" });
    },
  });

  const deleteSwotItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/swot-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "swot-pdca"] });
      toast({ title: "Item SWOT removido" });
    },
  });

  const getPdcaStatusIcon = (status: string) => {
    switch (status) {
      case "plan": return <Target className="h-3.5 w-3.5 text-blue-500" />;
      case "do": return <Wrench className="h-3.5 w-3.5 text-yellow-500" />;
      case "check": return <ClipboardCheck className="h-3.5 w-3.5 text-purple-500" />;
      case "act": return <RefreshCcw className="h-3.5 w-3.5 text-orange-500" />;
      case "done": return <CheckSquare className="h-3.5 w-3.5 text-green-500" />;
      default: return <Circle className="h-3.5 w-3.5" />;
    }
  };

  const pdcaStatuses = ["plan", "do", "check", "act", "done"];

  const getSwotTypeIcon = (type: string) => {
    switch (type) {
      case "strength": return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
      case "weakness": return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
      case "opportunity": return <Zap className="h-3.5 w-3.5 text-blue-500" />;
      case "threat": return <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />;
      default: return <Circle className="h-3.5 w-3.5" />;
    }
  };

  const swotTypes = [
    { value: "strength", label: "Força" },
    { value: "weakness", label: "Fraqueza" },
    { value: "opportunity", label: "Oportunidade" },
    { value: "threat", label: "Ameaça" }
  ];

  return (
    <Card className="border-card-border">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover-elevate p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CompletenessIndicator value={completeness} />
                  <CardTitle className="text-sm font-semibold">{blockType.label}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">{blockType.arcadiaLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                {questions.length > 0 && (
                  <RatingBadge rating={Math.round(averageRating * 10) / 10} />
                )}
                <Badge variant="outline" size="sm" className="text-xs">
                  {allBlocksForType.length}/2
                </Badge>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
            <Progress value={completeness} className="h-1 mt-2" />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4 space-y-4">
            <div className="bg-muted/50 rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Perguntas de Diagn&oacute;stico ({questions.length})
                </div>
                {questions.length > 0 && (
                  <Badge variant="secondary" size="sm" className="text-xs">
                    M&eacute;dia: {averageRating.toFixed(1)}/10
                  </Badge>
                )}
              </div>

              {questionsLoading || createBlockMutation.isPending ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map((question) => (
                    <QuestionItem
                      key={question.id}
                      question={question}
                      onUpdate={(updates) => updateQuestionMutation.mutate({ id: question.id, updates })}
                      onDelete={() => deleteQuestionMutation.mutate(question.id)}
                      isCustom={question.isDefault === 0}
                    />
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-border">
                <Input
                  placeholder="Adicionar nova pergunta..."
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addQuestionMutation.mutate()}
                  className="flex-1 text-sm"
                  data-testid={`input-new-question-${blockType.value}`}
                />
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => addQuestionMutation.mutate()}
                  disabled={!newQuestionText.trim() || addQuestionMutation.isPending}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Síntese ({selectedLevel === 'intencao' ? 'Atual' : 'Sistêmico'})
              </label>
              <Textarea
                placeholder={`Descreva ${blockType.label.toLowerCase()} do neg&oacute;cio...`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                className="resize-none text-sm"
                data-testid={`textarea-block-${blockType.value}`}
              />
            </div>

            <div className="bg-primary/5 rounded-md p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <Lightbulb className="h-3.5 w-3.5" />
                Saídas Esperadas
              </div>
              <div className="flex flex-wrap gap-1.5">
                {blockType.outputs.map((output, idx) => (
                  <Badge key={idx} variant="secondary" size="sm" className="text-xs">
                    {output}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="bg-muted/50 rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Ciclo PDCA ({blockPdcaItems.length})
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPdcaForm(!showPdcaForm)}
                  className="text-xs h-7"
                  data-testid={`button-add-pdca-${blockType.value}`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Novo
                </Button>
              </div>

              {showPdcaForm && (
                <div className="flex gap-2 p-2 bg-background rounded border border-border">
                  <Input
                    placeholder="Título do item PDCA..."
                    value={newPdcaTitle}
                    onChange={(e) => setNewPdcaTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createPdcaMutation.mutate()}
                    className="flex-1 text-sm"
                    data-testid={`input-pdca-title-${blockType.value}`}
                  />
                  <Button
                    size="sm"
                    onClick={() => createPdcaMutation.mutate()}
                    disabled={!newPdcaTitle.trim() || createPdcaMutation.isPending}
                  >
                    Criar
                  </Button>
                </div>
              )}

              {blockPdcaItems.length > 0 && (
                <div className="space-y-2">
                  {blockPdcaItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 p-2 bg-background rounded border border-border">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {getPdcaStatusIcon(item.status || "plan")}
                        <span className="text-sm truncate">{item.title}</span>
                      </div>
                      <Select
                        value={item.status || "plan"}
                        onValueChange={(value) => updatePdcaStatusMutation.mutate({ id: item.id, status: value })}
                      >
                        <SelectTrigger className="w-24 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pdcaStatuses.map((status) => (
                            <SelectItem key={status} value={status} className="text-xs">
                              {status.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deletePdcaMutation.mutate(item.id)}
                        className="h-7 w-7"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-muted/50 rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Análise SWOT ({blockSwotItems.length})
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSwotForm(!showSwotForm)}
                  className="text-xs h-7"
                  data-testid={`button-add-swot-${blockType.value}`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Novo
                </Button>
              </div>

              {showSwotForm && (
                <div className="space-y-2 p-2 bg-background rounded border border-border">
                  <div className="flex gap-2">
                    <Select value={newSwotType} onValueChange={setNewSwotType}>
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {swotTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value} className="text-xs">
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Título do item..."
                      value={newSwotTitle}
                      onChange={(e) => setNewSwotTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createSwotItemMutation.mutate()}
                      className="flex-1 text-sm"
                      data-testid={`input-swot-title-${blockType.value}`}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => createSwotItemMutation.mutate()}
                    disabled={!newSwotTitle.trim() || createSwotItemMutation.isPending}
                    className="w-full"
                  >
                    Criar Item SWOT
                  </Button>
                </div>
              )}

              {blockSwotItems.length > 0 && (
                <div className="space-y-2">
                  {blockSwotItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 p-2 bg-background rounded border border-border">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {getSwotTypeIcon(item.type)}
                        <span className="text-sm truncate">{item.title}</span>
                      </div>
                      <Badge variant="outline" size="sm" className="text-xs">
                        {swotTypes.find(t => t.value === item.type)?.label || item.type}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteSwotItemMutation.mutate(item.id)}
                        className="h-7 w-7"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button 
                size="sm" 
                onClick={() => saveMutation.mutate()}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Salvar
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function Canvas() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const projectIdFromUrl = params.get("projectId");
  
  const [selectedProjectId, setSelectedProjectId] = useState(projectIdFromUrl || "");
  const [selectedLevel, setSelectedLevel] = useState<string>("intencao");
  const [showRadar, setShowRadar] = useState(false);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: canvasBlocks = [], isLoading: blocksLoading } = useQuery<CanvasBlock[]>({
    queryKey: ["/api/projects", selectedProjectId, "canvas"],
    enabled: !!selectedProjectId,
  });

  // Fetch all questions for all blocks to calculate maturity
  const { data: allBlockQuestions = {} } = useQuery<Record<string, CanvasBlockQuestion[]>>({
    queryKey: ["/api/projects", selectedProjectId, "canvas-questions"],
    enabled: !!selectedProjectId && canvasBlocks.length > 0,
    queryFn: async () => {
      const questionsMap: Record<string, CanvasBlockQuestion[]> = {};
      for (const block of canvasBlocks) {
        const response = await fetch(`/api/canvas/${block.id}/questions`, {
          credentials: 'include'
        });
        if (response.ok) {
          questionsMap[block.id] = await response.json();
        }
      }
      return questionsMap;
    }
  });

  // Calculate maturity data for radar chart
  const maturityData = useMemo(() => {
    if (!canvasBlocks.length) return [];
    
    return CANVAS_BLOCK_TYPES.map(blockType => {
      const atualBlock = canvasBlocks.find(b => b.blockType === blockType.value && b.level === 'intencao');
      const sistemicoBlock = canvasBlocks.find(b => b.blockType === blockType.value && b.level === 'sistemico');
      
      // Calculate average rating from questions
      const getBlockRating = (block: CanvasBlock | undefined): number => {
        if (!block) return 0;
        const questions = allBlockQuestions[block.id] || [];
        const ratedQuestions = questions.filter(q => q.rating !== null && q.rating !== undefined);
        if (ratedQuestions.length === 0) return 0;
        return ratedQuestions.reduce((acc, q) => acc + (q.rating || 0), 0) / ratedQuestions.length;
      };
      
      return {
        subject: blockType.label.substring(0, 10),
        fullName: blockType.label,
        atual: getBlockRating(atualBlock),
        sistemico: getBlockRating(sistemicoBlock),
        fullMark: 10,
      };
    });
  }, [canvasBlocks, allBlockQuestions]);

  // Calculate overall maturity score
  const overallMaturity = useMemo(() => {
    if (!maturityData.length) return 0;
    const validScores = maturityData.filter(d => d.atual > 0);
    if (validScores.length === 0) return 0;
    return (validScores.reduce((acc, d) => acc + d.atual, 0) / validScores.length) * 10;
  }, [maturityData]);

  const maturityLevel = getMaturityLevel(overallMaturity);
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
            <Grid3X3 className="h-8 w-8 text-primary" />
            Canvas BMC Expandido
          </h1>
          <p className="text-muted-foreground mt-1">
            Diagnostico estrategico em 2 niveis evolutivos
          </p>
        </div>
        {selectedProjectId && canvasBlocks.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Maturidade Geral</div>
              <div className={`font-bold ${maturityLevel.color}`}>
                {overallMaturity.toFixed(0)}% - {maturityLevel.label}
              </div>
            </div>
            <Button
              variant={showRadar ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowRadar(!showRadar)}
              data-testid="button-toggle-radar"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              {showRadar ? "Ocultar Radar" : "Ver Radar"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex-1 max-w-xs">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger data-testid="select-canvas-project">
              <SelectValue placeholder="Selecione um projeto" />
            </SelectTrigger>
            <SelectContent>
              {projectsLoading ? (
                <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
              ) : projects.length === 0 ? (
                <SelectItem value="__empty__" disabled>Nenhum projeto</SelectItem>
              ) : (
                projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-1 p-1 bg-muted rounded-md">
          {CANVAS_LEVELS.map((level) => (
            <Button
              key={level.value}
              variant={selectedLevel === level.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSelectedLevel(level.value)}
              className="text-xs"
              data-testid={`button-level-${level.value}`}
            >
              {level.label}
            </Button>
          ))}
        </div>
      </div>

      {selectedProjectId && (
        <AgentPanel
          projectId={selectedProjectId}
          agentType="diagnostic_canvas"
          label="Analisar Canvas com IA"
          description="Identifica pontos cegos, forças e gera ações PDCA prioritárias"
          visibleIn="canvas"
        />
      )}

      {!selectedProjectId ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Grid3X3 className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Selecione um Projeto</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              Escolha um projeto acima para visualizar e editar o Canvas BMC.
            </p>
            {projects.length === 0 && !projectsLoading && (
              <Button asChild>
                <Link href="/projetos/novo">
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Projeto
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : blocksLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {showRadar && (
            <div className="grid gap-4 md:grid-cols-2 mb-4">
              <MaturityRadarChart 
                data={maturityData}
                title="Mapa de Maturidade - Canvas"
                showComparison={true}
                height={350}
              />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    Resumo por Bloco
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {maturityData.map((item, i) => {
                      const level = getMaturityLevel(item.atual * 10);
                      return (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                          <span className="text-sm">{item.fullName}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${level.color}`}>
                              {item.atual > 0 ? `${(item.atual).toFixed(1)}/10` : '-'}
                            </span>
                            <Badge variant="outline" size="sm" className="text-xs">
                              {item.atual > 0 ? level.label : 'Sem dados'}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="bg-muted/50 rounded-lg p-4 mb-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Nivel atual:</span>
              <Badge variant="secondary">
                {CANVAS_LEVELS.find(l => l.value === selectedLevel)?.label}
              </Badge>
              <span className="text-muted-foreground">
                - {CANVAS_LEVELS.find(l => l.value === selectedLevel)?.description}
              </span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {CANVAS_BLOCK_TYPES.map((blockType) => (
              <CanvasBlockCard
                key={blockType.value}
                blockType={blockType}
                blocks={canvasBlocks}
                projectId={selectedProjectId}
                selectedLevel={selectedLevel}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
