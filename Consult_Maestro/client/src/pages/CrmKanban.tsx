import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, DollarSign, User, ArrowRight, FileText, Kanban } from "lucide-react";
import { Link } from "wouter";

interface Stage {
  id: string;
  name: string;
  color?: string;
  order?: number;
}

interface Opportunity {
  id: string;
  title: string;
  value?: number;
  probability?: number;
  stageId: string;
  status: string;
  assignedToId?: string;
  expectedCloseDate?: string;
  pessoaId?: string;
  clientId?: string;
}

const fmt = (v?: number) =>
  v != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100)
    : "—";

const STAGE_COLORS: Record<string, string> = {
  prospeccao: "bg-slate-100 border-slate-300",
  qualificacao: "bg-blue-50 border-blue-300",
  proposta: "bg-yellow-50 border-yellow-300",
  negociacao: "bg-orange-50 border-orange-300",
  ganho: "bg-green-50 border-green-300",
  perdido: "bg-red-50 border-red-300",
};

function OpportunityCard({
  opp,
  onMove,
  stages,
}: {
  opp: Opportunity;
  onMove: (id: string, stageId: string) => void;
  stages: Stage[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const convertMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      const r = await apiRequest("POST", `/api/crm/proposals/${proposalId}/converter-em-pedido`);
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Pedido criado!", description: `Nº ${data.numero}` });
      qc.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const currentIdx = stages.findIndex((s) => s.id === opp.stageId);

  return (
    <Card className="mb-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-3">
        <p className="font-medium text-sm leading-tight mb-1">{opp.title}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <DollarSign className="h-3 w-3" />
          <span>{fmt(opp.value)}</span>
          {opp.probability != null && (
            <span className="ml-1 text-green-600">{opp.probability}%</span>
          )}
        </div>
        {opp.expectedCloseDate && (
          <p className="text-xs text-muted-foreground mb-2">
            Previsão: {new Date(opp.expectedCloseDate).toLocaleDateString("pt-BR")}
          </p>
        )}
        <div className="flex gap-1 flex-wrap">
          {currentIdx > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              onClick={() => onMove(opp.id, stages[currentIdx - 1].id)}
            >
              ←
            </Button>
          )}
          {currentIdx < stages.length - 1 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              onClick={() => onMove(opp.id, stages[currentIdx + 1].id)}
            >
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {opp.status === "won" || stages[currentIdx]?.name?.toLowerCase().includes("ganho") ? (
            <Button
              size="sm"
              variant="default"
              className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700"
              onClick={() => {
                // Precisaria do proposalId — busca separada se necessário
                toast({ title: "Abra a proposta para converter em pedido", variant: "default" });
              }}
            >
              <FileText className="h-3 w-3 mr-1" />
              Pedido
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CrmKanban() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stages = [], isLoading: loadingStages } = useQuery<Stage[]>({
    queryKey: ["/api/crm/pipeline-stages"],
    queryFn: () => apiRequest("GET", "/api/crm/pipeline-stages").then((r) => r.json()),
  });

  const { data: opportunities = [], isLoading: loadingOpps } = useQuery<Opportunity[]>({
    queryKey: ["/api/crm/opportunities"],
    queryFn: () => apiRequest("GET", "/api/crm/opportunities").then((r) => r.json()),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, stageId }: { id: string; stageId: string }) => {
      const r = await apiRequest("PATCH", `/api/crm/opportunities/${id}`, { stageId });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao mover", description: err.message, variant: "destructive" });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/crm/pipeline-stages/seed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Estágios padrão criados!" });
      qc.invalidateQueries({ queryKey: ["/api/crm/pipeline-stages"] });
    },
  });

  const sorted = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const oppsByStage = (stageId: string) =>
    opportunities.filter((o) => o.stageId === stageId && o.status !== "lost");

  const totalByStage = (stageId: string) =>
    oppsByStage(stageId).reduce((s, o) => s + (o.value ?? 0), 0);

  if (loadingStages || loadingOpps) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Kanban className="h-6 w-6" />
            Pipeline Kanban
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {opportunities.length} oportunidades · Total:{" "}
            {fmt(opportunities.reduce((s, o) => s + (o.value ?? 0), 0))}
          </p>
        </div>
        <div className="flex gap-2">
          {sorted.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar estágios padrão
            </Button>
          )}
          <Link href="/crm">
            <Button variant="outline" size="sm">
              ← Voltar ao CRM
            </Button>
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Kanban className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Nenhum estágio de pipeline configurado</p>
          <p className="text-sm mt-1">Clique em "Criar estágios padrão" para começar.</p>
        </div>
      ) : (
        <div
          className="grid gap-4 overflow-x-auto pb-4"
          style={{ gridTemplateColumns: `repeat(${sorted.length}, minmax(240px, 1fr))` }}
        >
          {sorted.map((stage) => {
            const opps = oppsByStage(stage.id);
            const colorClass = STAGE_COLORS[stage.name?.toLowerCase().replace(/\s/g, "")] ?? "bg-gray-50 border-gray-200";
            return (
              <div
                key={stage.id}
                className={`rounded-lg border-2 p-3 min-h-[200px] ${colorClass}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm">{stage.name}</h3>
                    <p className="text-xs text-muted-foreground">{fmt(totalByStage(stage.id))}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {opps.length}
                  </Badge>
                </div>

                <div>
                  {opps.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4 opacity-60">
                      Nenhuma oportunidade
                    </p>
                  )}
                  {opps.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      stages={sorted}
                      onMove={(id, stageId) => moveMutation.mutate({ id, stageId })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
