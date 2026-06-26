import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Clock,
  Plus,
  Edit,
  Trash2,
  Calendar,
  DollarSign,
  Timer,
  Filter,
  Code,
  FileSearch,
  TestTube,
  Users,
  Headphones,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ScrumTimesheet, ScrumBacklogItem, User } from "@shared/schema";

type TimesheetWithRelations = ScrumTimesheet & {
  pbi?: ScrumBacklogItem;
  user?: User;
};

const activityIcons: Record<string, { icon: React.ElementType; label: string }> = {
  development: { icon: Code, label: "Desenvolvimento" },
  analysis: { icon: FileSearch, label: "Analise" },
  testing: { icon: TestTube, label: "Testes" },
  meeting: { icon: Users, label: "Reuniao" },
  support: { icon: Headphones, label: "Suporte" },
};

const timesheetFormSchema = z.object({
  pbiId: z.string().min(1, "Selecione um item"),
  date: z.string().min(1, "Data obrigatoria"),
  hoursWorked: z.coerce.number().min(1, "Minimo 1 minuto").max(1440, "Maximo 24 horas"),
  description: z.string().optional(),
  activityType: z.string().default("development"),
  isBillable: z.coerce.number().default(1),
});

type TimesheetFormValues = z.infer<typeof timesheetFormSchema>;

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

export default function ScrumTimesheet() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScrumTimesheet | null>(null);
  const [dateFilter, setDateFilter] = useState<string>("week");
  const [activityFilter, setActivityFilter] = useState<string>("all");

  const { data: timesheets = [], isLoading: timesheetsLoading } = useQuery<TimesheetWithRelations[]>({
    queryKey: ["/api/scrum/timesheets"],
  });

  const { data: backlogItems = [] } = useQuery<ScrumBacklogItem[]>({
    queryKey: ["/api/scrum/backlog"],
  });

  const form = useForm<TimesheetFormValues>({
    resolver: zodResolver(timesheetFormSchema),
    defaultValues: {
      pbiId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      hoursWorked: 60,
      description: "",
      activityType: "development",
      isBillable: 1,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TimesheetFormValues) => {
      return apiRequest("POST", "/api/scrum/timesheets", {
        ...data,
        date: new Date(data.date).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Registro criado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao criar registro", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TimesheetFormValues }) => {
      return apiRequest("PATCH", `/api/scrum/timesheets/${id}`, {
        ...data,
        date: new Date(data.date).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      setDialogOpen(false);
      setEditingEntry(null);
      form.reset();
      toast({ title: "Registro atualizado com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao atualizar registro", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scrum/timesheets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scrum/backlog"] });
      toast({ title: "Registro excluido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao excluir registro", variant: "destructive" });
    },
  });

  const filteredTimesheets = useMemo(() => {
    const now = new Date();
    return timesheets.filter((entry) => {
      if (activityFilter !== "all" && entry.activityType !== activityFilter) {
        return false;
      }

      if (dateFilter !== "all" && entry.date) {
        const entryDate = typeof entry.date === "string" ? parseISO(entry.date) : new Date(entry.date);
        let start: Date, end: Date;

        switch (dateFilter) {
          case "week":
            start = startOfWeek(now, { weekStartsOn: 1 });
            end = endOfWeek(now, { weekStartsOn: 1 });
            break;
          case "month":
            start = startOfMonth(now);
            end = endOfMonth(now);
            break;
          default:
            return true;
        }

        if (!isWithinInterval(entryDate, { start, end })) {
          return false;
        }
      }

      return true;
    });
  }, [timesheets, dateFilter, activityFilter]);

  const totalMinutes = useMemo(() => {
    return filteredTimesheets.reduce((sum, entry) => sum + (entry.hoursWorked || 0), 0);
  }, [filteredTimesheets]);

  const totalCost = useMemo(() => {
    return filteredTimesheets.reduce((sum, entry) => sum + (entry.calculatedCost || 0), 0);
  }, [filteredTimesheets]);

  const billableMinutes = useMemo(() => {
    return filteredTimesheets
      .filter((e) => e.isBillable)
      .reduce((sum, entry) => sum + (entry.hoursWorked || 0), 0);
  }, [filteredTimesheets]);

  const handleEdit = (entry: ScrumTimesheet) => {
    setEditingEntry(entry);
    const entryDate = typeof entry.date === "string" ? entry.date : new Date(entry.date).toISOString();
    form.reset({
      pbiId: entry.pbiId,
      date: entryDate.split("T")[0],
      hoursWorked: entry.hoursWorked,
      description: entry.description || "",
      activityType: entry.activityType || "development",
      isBillable: Number(entry.isBillable ?? 1),
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: TimesheetFormValues) => {
    if (editingEntry) {
      updateMutation.mutate({ id: editingEntry.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingEntry(null);
    form.reset();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-bold" data-testid="text-timesheet-title">
            Timesheet
          </h1>
          <p className="text-muted-foreground mt-1">
            Registre e acompanhe as horas trabalhadas.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          if (!open) handleDialogClose();
          else setDialogOpen(true);
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-log-hours">
              <Plus className="h-4 w-4 mr-2" />
              Registrar Horas
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingEntry ? "Editar registro" : "Registrar horas"}</DialogTitle>
              <DialogDescription>
                {editingEntry
                  ? "Atualize as informacoes do registro."
                  : "Registre as horas trabalhadas em um item do backlog."}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="pbiId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Item do Backlog</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-pbi">
                            <SelectValue placeholder="Selecione um item" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {backlogItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hoursWorked"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duracao (minutos)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="60"
                            {...field}
                            data-testid="input-hours"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="activityType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Atividade</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-type">
                            <SelectValue placeholder="Selecione o tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="development">Desenvolvimento</SelectItem>
                          <SelectItem value="analysis">Analise</SelectItem>
                          <SelectItem value="testing">Testes</SelectItem>
                          <SelectItem value="meeting">Reuniao</SelectItem>
                          <SelectItem value="support">Suporte</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descricao</FormLabel>
                      <FormControl>
                        <Textarea {...field} data-testid="input-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isBillable"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Faturavel</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-billable">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">Sim</SelectItem>
                          <SelectItem value="0">Nao</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-submit-timesheet"
                  >
                    {editingEntry ? "Salvar" : "Registrar"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="border-card-border" data-testid="card-total-hours">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Timer className="h-4 w-4" />
              Total Horas
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-hours">{formatMinutes(totalMinutes)}</p>
          </CardContent>
        </Card>
        <Card className="border-card-border" data-testid="card-billable-hours">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="h-4 w-4" />
              Faturaveis
            </div>
            <p className="text-2xl font-bold" data-testid="text-billable-hours">{formatMinutes(billableMinutes)}</p>
          </CardContent>
        </Card>
        <Card className="border-card-border" data-testid="card-total-cost">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4" />
              Custo Total
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-cost">R$ {(totalCost / 100).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="border-card-border" data-testid="card-records-count">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Calendar className="h-4 w-4" />
              Registros
            </div>
            <p className="text-2xl font-bold" data-testid="text-records-count">{filteredTimesheets.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Registros
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-date-filter">
                  <SelectValue placeholder="Periodo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Esta semana</SelectItem>
                  <SelectItem value="month">Este mes</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={activityFilter} onValueChange={setActivityFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-activity-filter">
                  <SelectValue placeholder="Atividade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas atividades</SelectItem>
                  <SelectItem value="development">Desenvolvimento</SelectItem>
                  <SelectItem value="analysis">Analise</SelectItem>
                  <SelectItem value="testing">Testes</SelectItem>
                  <SelectItem value="meeting">Reuniao</SelectItem>
                  <SelectItem value="support">Suporte</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {timesheetsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : filteredTimesheets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Clock className="h-12 w-12 mb-4" />
              <p>Nenhum registro encontrado</p>
              <p className="text-sm mt-1">
                Clique em "Registrar Horas" para comecar.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Atividade</TableHead>
                  <TableHead>Duracao</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead className="w-[100px]">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTimesheets.map((entry) => {
                  const activityInfo = activityIcons[entry.activityType || "development"] || activityIcons.development;
                  const ActivityIcon = activityInfo.icon;
                  const entryDate = typeof entry.date === "string" ? parseISO(entry.date) : new Date(entry.date);
                  return (
                    <TableRow key={entry.id} data-testid={`row-timesheet-${entry.id}`}>
                      <TableCell>
                        {format(entryDate, "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="truncate font-medium">
                          {entry.pbi?.title || "Item removido"}
                        </p>
                        {entry.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {entry.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ActivityIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{activityInfo.label}</span>
                          {entry.isBillable ? (
                            <Badge variant="outline" size="sm">Faturavel</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{formatMinutes(entry.hoursWorked)}</TableCell>
                      <TableCell>R$ {((entry.calculatedCost || 0) / 100).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(entry)}
                            data-testid={`button-edit-timesheet-${entry.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-timesheet-${entry.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acao nao pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(entry.id)}>
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
