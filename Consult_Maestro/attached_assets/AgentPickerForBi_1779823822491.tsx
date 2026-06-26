import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Search, Sparkles, ChevronRight, BarChart3,
  Calculator, FileText, Users, TrendingUp, Landmark, Zap,
} from "lucide-react";
import type { AgentDefinition } from "@shared/schema";

// Agents relevant for each BI widget type
const WIDGET_AGENT_MAP: Record<string, string[]> = {
  waterfall_chart:  ["dre-gerencial", "balancete-analise", "fechamento-mensal", "valuation-pme"],
  area_chart:       ["fluxo-caixa-projetado", "dre-gerencial", "relatorio-mensal"],
  bar_chart:        ["analise-tributaria-regime", "folha-pagamento-mensal", "reforma-tributaria-cbs-ibs"],
  pie_chart:        ["analise-tributaria-regime", "apuracao-simples-nacional", "apuracao-pis-cofins"],
  kpi_card:         ["dre-gerencial", "valuation-pme", "due-diligence-contabil", "fluxo-caixa-projetado"],
  data_table:       ["conciliacao-bancaria", "fechamento-mensal", "documentos-pendentes", "lembrete-prazo"],
  mixed_timeseries: ["dre-gerencial", "relatorio-mensal", "balancete-analise"],
  big_number:       ["dre-gerencial", "valuation-pme"],
};

const CATEGORY_ICONS: Record<string, any> = {
  "Tributário": Calculator,
  "Obrigações Acessórias": FileText,
  "Departamento Pessoal": Users,
  "Financeiro": TrendingUp,
  "Atendimento": Bot,
  "Operacional": Zap,
  "Análise Estratégica": Landmark,
  "Especializado": Sparkles,
  "Societário": FileText,
  "Consultoria": TrendingUp,
  "Contabilidade": BarChart3,
};

interface AgentPickerForBiProps {
  activeWidgetType?: string;
  onAgentSelected?: (agentSlug: string, agentName: string) => void;
  compact?: boolean;
}

export function AgentPickerForBi({
  activeWidgetType,
  onAgentSelected,
  compact = false,
}: AgentPickerForBiProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"sugeridos" | "todos">("sugeridos");

  const { data: agents = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["/api/agent-definitions"],
  });

  // Filter accounting agents (pack = contabilidade or atlas)
  const contabilAgents = agents.filter(a =>
    (a as any).pack === "contabilidade" || (a as any).pack === "atlas"
  );

  // Suggested: match widget type
  const suggestedSlugs = activeWidgetType
    ? (WIDGET_AGENT_MAP[activeWidgetType] ?? [])
    : [];
  const suggested = contabilAgents.filter(a => suggestedSlugs.includes(a.slug));

  // All filtered
  const filtered = contabilAgents.filter(a =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a as any).category?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
  const grouped = filtered.reduce((acc, agent) => {
    const cat = (agent as any).category ?? "Outros";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(agent);
    return acc;
  }, {} as Record<string, AgentDefinition[]>);

  function handleSelect(agent: AgentDefinition) {
    onAgentSelected?.(agent.slug, agent.name);
    setOpen(false);
    toast({ title: `Agente ${agent.name} selecionado`, description: "Use o chat para gerar análises." });
  }

  if (compact) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
            <Bot className="h-3.5 w-3.5" />
            Agente BI
            {suggested.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">
                {suggested.length}
              </Badge>
            )}
          </Button>
        </DialogTrigger>
        <AgentPickerContent
          search={search}
          setSearch={setSearch}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          suggested={suggested}
          grouped={grouped}
          activeWidgetType={activeWidgetType}
          onSelect={handleSelect}
        />
      </Dialog>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">Agentes para este dashboard</span>
        {activeWidgetType && (
          <Badge variant="outline" className="text-[10px]">{activeWidgetType.replace("_", " ")}</Badge>
        )}
      </div>

      {/* Suggested agents for current widget */}
      {suggested.length > 0 && (
        <div className="p-3 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
            Sugeridos para {activeWidgetType?.replace(/_/g, " ")}
          </p>
          {suggested.slice(0, 3).map(agent => (
            <AgentRow key={agent.id} agent={agent} onSelect={handleSelect} />
          ))}
        </div>
      )}

      {/* Show all via dialog */}
      <div className="p-3 pt-0">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground">
              Ver todos os {contabilAgents.length} agentes contábeis
              <ChevronRight className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <AgentPickerContent
            search={search}
            setSearch={setSearch}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            suggested={suggested}
            grouped={grouped}
            activeWidgetType={activeWidgetType}
            onSelect={handleSelect}
          />
        </Dialog>
      </div>
    </div>
  );
}

// ── Dialog content ─────────────────────────────────────────────────────────

function AgentPickerContent({
  search, setSearch, activeTab, setActiveTab,
  suggested, grouped, activeWidgetType, onSelect,
}: {
  search: string;
  setSearch: (v: string) => void;
  activeTab: "sugeridos" | "todos";
  setActiveTab: (v: "sugeridos" | "todos") => void;
  suggested: AgentDefinition[];
  grouped: Record<string, AgentDefinition[]>;
  activeWidgetType?: string;
  onSelect: (agent: AgentDefinition) => void;
}) {
  return (
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          Agentes Contábeis — Pacote Contabilidade
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          57 especialistas para análise, apuração e relatórios. Selecione um para gerar insights no BI Builder.
        </p>
      </DialogHeader>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar agente (ex: DRE, IRPJ, folha, simples...)"
          className="pl-9"
        />
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)} className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="flex-shrink-0">
          <TabsTrigger value="sugeridos">
            Sugeridos para widget
            {suggested.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{suggested.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="todos">Todos ({Object.values(grouped).flat().length})</TabsTrigger>
        </TabsList>

        <TabsContent value="sugeridos" className="flex-1 overflow-y-auto mt-3">
          {suggested.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {activeWidgetType
                ? `Nenhum agente específico para "${activeWidgetType.replace(/_/g, " ")}"`
                : "Selecione um widget no dashboard para ver sugestões"}
            </div>
          ) : (
            <div className="space-y-1.5">
              {suggested.map(agent => (
                <AgentRow key={agent.id} agent={agent} onSelect={onSelect} showDesc />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="todos" className="flex-1 overflow-y-auto mt-3">
          <div className="space-y-4">
            {Object.entries(grouped).sort().map(([category, categoryAgents]) => {
              const Icon = CATEGORY_ICONS[category] ?? Bot;
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {category} ({categoryAgents.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {categoryAgents.map(agent => (
                      <AgentRow key={agent.id} agent={agent} onSelect={onSelect} showDesc />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

// ── Agent row ──────────────────────────────────────────────────────────────

function AgentRow({
  agent, onSelect, showDesc = false,
}: {
  agent: AgentDefinition;
  onSelect: (a: AgentDefinition) => void;
  showDesc?: boolean;
}) {
  const biWidget = (agent as any).biWidget;
  const hasBi = !!(agent as any).biMetricIds?.length || biWidget;

  return (
    <div
      onClick={() => onSelect(agent)}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-border hover:bg-muted/40 cursor-pointer transition-all group"
    >
      <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{agent.name}</span>
          {biWidget && (
            <Badge variant="outline" className="text-[10px] h-4 gap-1 border-primary/30 text-primary">
              <BarChart3 className="h-2.5 w-2.5" />
              {biWidget.replace(/_/g, " ")}
            </Badge>
          )}
          {hasBi && (
            <Badge className="text-[10px] h-4 bg-primary/10 text-primary hover:bg-primary/10">BI</Badge>
          )}
        </div>
        {showDesc && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
            {agent.description}
          </p>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
    </div>
  );
}
