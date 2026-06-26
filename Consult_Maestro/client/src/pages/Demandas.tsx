import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  KanbanSquare,
  Calendar,
  Building2,
  ExternalLink,
  Loader2,
  Plus,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Project, Client } from "@shared/schema";

type DemandaStatus =
  | "backlog"
  | "diagnostico"
  | "proposta_enviada"
  | "aprovada"
  | "entregue";

interface Demanda extends Project {
  client?: { id: string; name: string } | null;
}

const COLUMNS: { id: DemandaStatus; title: string; description: string; color: string }[] = [
  { id: "backlog", title: "Nova", description: "Demandas recém-criadas", color: "bg-slate-500" },
  { id: "diagnostico", title: "Em Análise", description: "Diagnóstico em andamento", color: "bg-blue-500" },
  { id: "proposta_enviada", title: "Proposta Enviada", description: "Aguardando resposta do cliente", color: "bg-amber-500" },
  { id: "aprovada", title: "Aprovada", description: "Pronta para virar projeto", color: "bg-emerald-500" },
  { id: "entregue", title: "Entregue", description: "Concluída e arquivada", color: "bg-zinc-500" },
];

// Map every existing project_status to one of the 5 columns
function mapStatusToColumn(status: string): DemandaStatus {
  switch (status) {
    case "backlog":
      return "backlog";
    case "diagnostico":
      return "diagnostico";
    case "proposta_enviada":
      return "proposta_enviada";
    case "andamento":
    case "revisao":
    case "aprovada":
      return "aprovada";
    case "concluido":
    case "entregue":
      return "entregue";
    default:
      return "backlog";
  }
}

function DemandaCard({ demanda, isDragging }: { demanda: Demanda; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: demanda.id,
    data: { demanda },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : undefined;

  const dueDate = demanda.dueDate ? new Date(demanda.dueDate) : null;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing hover-elevate ${isDragging ? "opacity-50" : ""}`}
      data-testid={`card-demanda-${demanda.id}`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium leading-snug line-clamp-2" data-testid={`text-demanda-name-${demanda.id}`}>
            {demanda.name}
          </h4>
          {demanda.linkedProjectId && (
            <Badge variant="secondary" className="text-[10px] shrink-0" title="Projeto Scrum vinculado">
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
              Scrum
            </Badge>
          )}
        </div>

        {demanda.client && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span className="truncate">{demanda.client.name}</span>
          </div>
        )}

        {dueDate && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{dueDate.toLocaleDateString("pt-BR")}</span>
          </div>
        )}

        <div className="flex gap-1 pt-1">
          <Link href={`/canvas/${demanda.id}`}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onPointerDown={(e) => e.stopPropagation()}
              data-testid={`button-canvas-${demanda.id}`}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Canvas
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Column({
  column,
  demandas,
}: {
  column: typeof COLUMNS[number];
  demandas: Demanda[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-muted/30 min-w-[280px] flex-1 ${
        isOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
      data-testid={`column-${column.id}`}
    >
      <div className="p-3 border-b">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${column.color}`} />
          <h3 className="text-sm font-semibold" data-testid={`text-column-title-${column.id}`}>
            {column.title}
          </h3>
          <Badge variant="secondary" className="ml-auto text-xs" data-testid={`badge-count-${column.id}`}>
            {demandas.length}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">{column.description}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
        {demandas.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">Nenhuma demanda</div>
        ) : (
          demandas.map((d) => <DemandaCard key={d.id} demanda={d} />)
        )}
      </div>
    </div>
  );
}

export default function Demandas() {
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ demanda: Demanda; previousStatus: DemandaStatus } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data: demandas = [], isLoading } = useQuery<Demanda[]>({
    queryKey: ["/api/demandas"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  // Enrich with client data
  const enriched: Demanda[] = useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    return demandas.map((d) => ({
      ...d,
      client: d.clientId ? { id: d.clientId, name: clientMap.get(d.clientId)?.name ?? "—" } : null,
    }));
  }, [demandas, clients]);

  const grouped = useMemo(() => {
    const map: Record<DemandaStatus, Demanda[]> = {
      backlog: [],
      diagnostico: [],
      proposta_enviada: [],
      aprovada: [],
      entregue: [],
    };
    for (const d of enriched) {
      map[mapStatusToColumn(d.status)].push(d);
    }
    return map;
  }, [enriched]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DemandaStatus }) => {
      const res = await apiRequest("PATCH", `/api/demandas/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demandas"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao atualizar status", description: err.message ?? String(err), variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/demandas"] });
    },
  });

  const approveAndCreate = useMutation({
    mutationFn: async ({ id, createScrum }: { id: string; createScrum: boolean }) => {
      const res = await apiRequest("POST", `/api/demandas/${id}/aprovar`, { createScrum });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/demandas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/projects"] });
      toast({
        title: "Demanda aprovada",
        description: data.scrumProject
          ? `Projeto Scrum "${data.scrumProject.name}" criado.`
          : "Status atualizado para Aprovada.",
      });
      setPendingApproval(null);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao aprovar", description: err.message ?? String(err), variant: "destructive" });
      setPendingApproval(null);
    },
  });

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const demanda = enriched.find((d) => d.id === active.id);
    if (!demanda) return;

    const targetColumn = over.id as DemandaStatus;
    const currentColumn = mapStatusToColumn(demanda.status);
    if (targetColumn === currentColumn) return;

    if (targetColumn === "aprovada") {
      setPendingApproval({ demanda, previousStatus: currentColumn });
      return;
    }

    updateStatus.mutate({ id: demanda.id, status: targetColumn });
  };

  const activeDemanda = activeId ? enriched.find((d) => d.id === activeId) : null;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-background">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <KanbanSquare className="h-6 w-6 text-primary" />
            Demandas
          </h1>
          <p className="text-sm text-muted-foreground">
            Pipeline de demandas Canvas — arraste para mover entre etapas
          </p>
        </div>
        <Link href="/canvas">
          <Button data-testid="button-nova-demanda">
            <Plus className="h-4 w-4 mr-1" />
            Nova Demanda
          </Button>
        </Link>
      </header>

      <div className="flex-1 overflow-x-auto p-4">
        {isLoading ? (
          <div className="flex gap-4">
            {COLUMNS.map((c) => (
              <div key={c.id} className="min-w-[280px] flex-1 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 h-full">
              {COLUMNS.map((col) => (
                <Column key={col.id} column={col} demandas={grouped[col.id]} />
              ))}
            </div>
            <DragOverlay>
              {activeDemanda ? <DemandaCard demanda={activeDemanda} isDragging /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <Dialog open={!!pendingApproval} onOpenChange={(o) => !o && setPendingApproval(null)}>
        <DialogContent data-testid="dialog-aprovar">
          <DialogHeader>
            <DialogTitle>Aprovar demanda</DialogTitle>
            <DialogDescription>
              A demanda <strong>{pendingApproval?.demanda.name}</strong> será marcada como aprovada.
              Deseja também criar um projeto Scrum vinculado para começar a execução?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingApproval(null)}
              disabled={approveAndCreate.isPending}
              data-testid="button-aprovar-cancel"
            >
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                pendingApproval &&
                approveAndCreate.mutate({ id: pendingApproval.demanda.id, createScrum: false })
              }
              disabled={approveAndCreate.isPending}
              data-testid="button-aprovar-sem-scrum"
            >
              Só aprovar
            </Button>
            <Button
              onClick={() =>
                pendingApproval &&
                approveAndCreate.mutate({ id: pendingApproval.demanda.id, createScrum: true })
              }
              disabled={approveAndCreate.isPending}
              data-testid="button-aprovar-com-scrum"
            >
              {approveAndCreate.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-1" />
              )}
              Aprovar e criar projeto Scrum
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
