import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarEvent {
  id: string;
  titulo: string;
  descricao: string | null;
  dataInicio: string;
  dataFim: string | null;
  horaInicio: string | null;
  horaFim: string | null;
  tipo: string;
  participantes: string | null;
  local: string | null;
}

const TIPOS = [
  { value: "reuniao_sprint", label: "Reunião Sprint", color: "bg-blue-500" },
  { value: "marco_go_live", label: "Marco / Go Live", color: "bg-purple-500" },
  { value: "entrega", label: "Entrega", color: "bg-green-500" },
  { value: "tarefa", label: "Tarefa", color: "bg-amber-500" },
  { value: "bloqueio", label: "Bloqueio", color: "bg-red-500" },
  { value: "outro", label: "Outro", color: "bg-gray-500" },
];

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ProjectCalendar({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [refDate, setRefDate] = useState(new Date());
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetDate, setPresetDate] = useState<string>("");

  const ano = refDate.getFullYear();
  const mes = refDate.getMonth();
  const firstDay = new Date(ano, mes, 1);
  const lastDay = new Date(ano, mes + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const fromStr = ymd(new Date(ano, mes, 1));
  const toStr = ymd(new Date(ano, mes, daysInMonth));

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/projects", projectId, "calendar", fromStr, toStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/calendar?from=${fromStr}&to=${toStr}`,
        { credentials: "include" }
      );
      return res.json();
    },
  });

  const eventsByDay = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    const k = e.dataInicio.slice(0, 10);
    (acc[k] ||= []).push(e);
    return acc;
  }, {});

  const upsert = useMutation({
    mutationFn: async (data: any) => {
      const url = editing
        ? `/api/projects/${projectId}/calendar/${editing.id}`
        : `/api/projects/${projectId}/calendar`;
      const res = await apiRequest(editing ? "PATCH" : "POST", url, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      setDialogOpen(false);
      setEditing(null);
      toast({ title: editing ? "Evento atualizado" : "Evento criado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/calendar/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      setDialogOpen(false);
      setEditing(null);
    },
  });

  function openNew(date: string) {
    setEditing(null);
    setPresetDate(date);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      titulo: String(fd.get("titulo") || "").trim(),
      descricao: String(fd.get("descricao") || "").trim() || null,
      dataInicio: String(fd.get("dataInicio") || ""),
      horaInicio: String(fd.get("horaInicio") || "") || null,
      horaFim: String(fd.get("horaFim") || "") || null,
      tipo: String(fd.get("tipo") || "outro"),
      participantes: String(fd.get("participantes") || "").trim() || null,
      local: String(fd.get("local") || "").trim() || null,
    };
    if (!data.titulo || !data.dataInicio) return;
    upsert.mutate(data);
  }

  // Build calendar grid: 6 rows x 7 days
  const cells: Array<{ date: Date | null; key: string }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null, key: `pre-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(ano, mes, d), key: `d-${d}` });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, key: `post-${cells.length}` });

  const today = ymd(new Date());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setRefDate(new Date(ano, mes - 1, 1))}
            data-testid="button-prev-month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="font-semibold text-lg min-w-[180px] text-center" data-testid="text-month">
            {MESES[mes]} {ano}
          </h3>
          <Button variant="outline" size="icon" onClick={() => setRefDate(new Date(ano, mes + 1, 1))}
            data-testid="button-next-month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRefDate(new Date())}
            data-testid="button-today">
            Hoje
          </Button>
        </div>
        <Button onClick={() => openNew(today)} data-testid="button-new-event">
          <Plus className="h-4 w-4 mr-2" />
          Novo Evento
        </Button>
      </div>

      <Card className="border-card-border">
        <CardContent className="p-2">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DIAS.map((d) => (
              <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c) => {
              if (!c.date) return <div key={c.key} className="min-h-[80px]" />;
              const ds = ymd(c.date);
              const dayEvents = eventsByDay[ds] || [];
              const isToday = ds === today;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`min-h-[80px] p-1 border rounded text-left hover:bg-muted/50 transition-colors ${
                    isToday ? "bg-primary/10 border-primary" : "border-border"
                  }`}
                  onClick={() => openNew(ds)}
                  data-testid={`day-${ds}`}
                >
                  <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : ""}`}>
                    {c.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const tipo = TIPOS.find(t => t.value === ev.tipo) || TIPOS[5];
                      return (
                        <div
                          key={ev.id}
                          className={`text-[10px] px-1 py-0.5 rounded text-white truncate ${tipo.color}`}
                          title={ev.titulo}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(ev);
                            setPresetDate(ev.dataInicio.slice(0, 10));
                            setDialogOpen(true);
                          }}
                          data-testid={`event-${ev.id}`}
                        >
                          {ev.horaInicio && <span className="font-mono">{ev.horaInicio} </span>}
                          {ev.titulo}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} mais</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {TIPOS.map((t) => (
          <Badge key={t.value} variant="outline" size="sm">
            <span className={`w-2 h-2 rounded-full mr-1.5 ${t.color}`} />
            {t.label}
          </Badge>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Evento" : "Novo Evento"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="ev-title">Título *</Label>
              <Input id="ev-title" name="titulo" required defaultValue={editing?.titulo || ""}
                data-testid="input-event-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ev-date">Data *</Label>
                <Input id="ev-date" name="dataInicio" type="date" required
                  defaultValue={editing?.dataInicio?.slice(0, 10) || presetDate} />
              </div>
              <div>
                <Label htmlFor="ev-tipo">Tipo</Label>
                <select
                  id="ev-tipo" name="tipo"
                  defaultValue={editing?.tipo || "reuniao_sprint"}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ev-h1">Início</Label>
                <Input id="ev-h1" name="horaInicio" type="time" defaultValue={editing?.horaInicio || ""} />
              </div>
              <div>
                <Label htmlFor="ev-h2">Fim</Label>
                <Input id="ev-h2" name="horaFim" type="time" defaultValue={editing?.horaFim || ""} />
              </div>
            </div>
            <div>
              <Label htmlFor="ev-part">Participantes</Label>
              <Input id="ev-part" name="participantes" defaultValue={editing?.participantes || ""} />
            </div>
            <div>
              <Label htmlFor="ev-local">Local</Label>
              <Input id="ev-local" name="local" defaultValue={editing?.local || ""} />
            </div>
            <div>
              <Label htmlFor="ev-desc">Descrição</Label>
              <Textarea id="ev-desc" name="descricao" rows={2} defaultValue={editing?.descricao || ""} />
            </div>
            <DialogFooter className="gap-2">
              {editing && (
                <Button
                  type="button" variant="destructive"
                  onClick={() => { if (confirm("Excluir evento?")) remove.mutate(editing.id); }}
                  data-testid="button-delete-event"
                >
                  <X className="h-4 w-4 mr-1" /> Excluir
                </Button>
              )}
              <Button type="submit" disabled={upsert.isPending} data-testid="button-save-event">
                {upsert.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
