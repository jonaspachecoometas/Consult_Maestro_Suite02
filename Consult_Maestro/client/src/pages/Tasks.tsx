import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { 
  CheckSquare, 
  Plus, 
  Calendar, 
  Clock, 
  Filter,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  ChevronDown,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  CalendarDays,
  ListPlus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  format, 
  isAfter, 
  isBefore, 
  isToday, 
  addDays, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay,
  addMonths,
  subMonths
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Task, Project, User } from "@shared/schema";
import { GenerateScrumItemDialog, mapPriorityToScrum } from "@/components/GenerateScrumItemDialog";

const TASK_STATUSES = [
  { value: "todo", label: "A Fazer", color: "bg-slate-500" },
  { value: "in_progress", label: "Em Andamento", color: "bg-blue-500" },
  { value: "review", label: "Revisão", color: "bg-yellow-500" },
  { value: "done", label: "Concluído", color: "bg-green-500" },
];

const TASK_PRIORITIES = [
  { value: -1, label: "Baixa" },
  { value: 0, label: "Normal" },
  { value: 1, label: "Alta" },
  { value: 2, label: "Urgente" },
];

const taskFormSchema = z.object({
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  projectId: z.string().min(1, "Projeto é obrigatório"),
  status: z.string().default("todo"),
  priority: z.coerce.number().default(0),
  dueDate: z.string().optional(),
  assigneeId: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

function TaskStatusBadge({ status }: { status: string }) {
  const statusConfig = TASK_STATUSES.find(s => s.value === status);
  return (
    <Badge variant="outline" size="sm">
      <span className={`w-2 h-2 rounded-full mr-2 ${statusConfig?.color || 'bg-gray-500'}`} />
      {statusConfig?.label || status}
    </Badge>
  );
}

function TaskPriorityBadge({ priority }: { priority: number }) {
  const config = TASK_PRIORITIES.find(p => p.value === priority);
  const colorClass = priority >= 2 ? "text-red-500" : priority >= 1 ? "text-orange-500" : "text-muted-foreground";
  return (
    <span className={`text-xs ${colorClass}`}>
      {config?.label || "Normal"}
    </span>
  );
}

function DueDateBadge({ dueDate }: { dueDate: Date | string | null }) {
  if (!dueDate) return null;
  
  const date = new Date(dueDate);
  const now = new Date();
  const isOverdue = isBefore(date, now) && !isToday(date);
  const isDueSoon = isAfter(date, now) && isBefore(date, addDays(now, 3));
  
  let colorClass = "text-muted-foreground";
  if (isOverdue) colorClass = "text-red-500";
  else if (isDueSoon) colorClass = "text-yellow-600";
  
  return (
    <span className={`text-xs flex items-center gap-1 ${colorClass}`}>
      <Calendar className="h-3 w-3" />
      {format(date, "dd/MM/yyyy", { locale: ptBR })}
      {isOverdue && <AlertCircle className="h-3 w-3" />}
    </span>
  );
}

interface CalendarViewProps {
  tasks: Task[];
  calendarMonth: Date;
  setCalendarMonth: (date: Date) => void;
  selectedDate: Date | null;
  setSelectedDate: (date: Date | null) => void;
  getProjectName: (projectId: string) => string;
  getAssigneeName: (assigneeId: string | null) => string | null;
  openEditDialog: (task: Task) => void;
  deleteTaskMutation: { mutate: (id: string) => void };
  setScrumDialogTask: (task: Task) => void;
  setScrumDialogOpen: (open: boolean) => void;
}

function CalendarView({
  tasks,
  calendarMonth,
  setCalendarMonth,
  selectedDate,
  setSelectedDate,
  getProjectName,
  getAssigneeName,
  openEditDialog,
  deleteTaskMutation,
  setScrumDialogTask,
  setScrumDialogOpen,
}: CalendarViewProps) {
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  
  const getTasksForDate = (date: Date) => {
    return tasks.filter(task => {
      if (!task.dueDate) return false;
      return isSameDay(new Date(task.dueDate), date);
    });
  };

  const tasksWithoutDueDate = tasks.filter(task => !task.dueDate);
  
  const selectedDateTasks = selectedDate ? getTasksForDate(selectedDate) : [];
  
  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="border-card-border lg:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
              data-testid="button-prev-month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-lg font-medium">
              {format(calendarMonth, "MMMM yyyy", { locale: ptBR })}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
              data-testid="button-next-month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dayTasks = getTasksForDate(day);
              const isCurrentMonth = isSameMonth(day, calendarMonth);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);
              const hasOverdue = dayTasks.some(t => 
                t.status !== "done" && isBefore(new Date(t.dueDate!), new Date()) && !isToday(new Date(t.dueDate!))
              );
              
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(isSameDay(day, selectedDate || new Date(0)) ? null : day)}
                  className={`
                    min-h-[60px] p-1 rounded-md text-left transition-colors
                    ${!isCurrentMonth ? "text-muted-foreground/50" : ""}
                    ${isSelected ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-accent/50"}
                    ${isTodayDate ? "font-bold" : ""}
                  `}
                  data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                >
                  <div className="flex flex-col h-full">
                    <span className={`text-xs ${isTodayDate ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center" : ""}`}>
                      {format(day, "d")}
                    </span>
                    {dayTasks.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {dayTasks.slice(0, 3).map((task) => {
                          const statusConfig = TASK_STATUSES.find(s => s.value === task.status);
                          return (
                            <span
                              key={task.id}
                              className={`w-2 h-2 rounded-full ${statusConfig?.color || "bg-gray-500"}`}
                              title={task.title}
                            />
                          );
                        })}
                        {dayTasks.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{dayTasks.length - 3}</span>
                        )}
                      </div>
                    )}
                    {hasOverdue && (
                      <AlertCircle className="h-3 w-3 text-red-500 mt-auto" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            {selectedDate 
              ? format(selectedDate, "dd 'de' MMMM", { locale: ptBR })
              : "Tarefas sem data"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {selectedDate 
              ? `${selectedDateTasks.length} tarefa(s)`
              : `${tasksWithoutDueDate.length} tarefa(s)`}
          </p>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
          {(selectedDate ? selectedDateTasks : tasksWithoutDueDate).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {selectedDate 
                ? "Nenhuma tarefa para este dia"
                : "Todas as tarefas têm data definida"}
            </p>
          ) : (
            (selectedDate ? selectedDateTasks : tasksWithoutDueDate).map((task) => (
              <Card 
                key={task.id} 
                className="border-card-border hover-elevate cursor-pointer"
                data-testid={`calendar-task-${task.id}`}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium line-clamp-2">{task.title}</h4>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(task)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => {
                            setScrumDialogTask(task);
                            setScrumDialogOpen(true);
                          }}
                        >
                          <ListPlus className="h-4 w-4 mr-2" />
                          Gerar Item Scrum
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => deleteTaskMutation.mutate(task.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <TaskStatusBadge status={task.status} />
                    <TaskPriorityBadge priority={task.priority || 0} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" size="sm" className="text-[10px]">
                      {getProjectName(task.projectId)}
                    </Badge>
                    {task.assigneeId && (
                      <span className="text-xs text-muted-foreground">
                        {getAssigneeName(task.assigneeId)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Tasks() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "calendar">("kanban");
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [scrumDialogOpen, setScrumDialogOpen] = useState(false);
  const [scrumDialogTask, setScrumDialogTask] = useState<Task | null>(null);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?excludeType=compass"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      description: "",
      projectId: "",
      status: "todo",
      priority: 0,
      dueDate: "",
      assigneeId: "",
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormValues) => {
      const payload = {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
        assigneeId: data.assigneeId || null,
      };
      return apiRequest("POST", `/api/projects/${data.projectId}/tasks`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Tarefa criada com sucesso" });
      setDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao criar tarefa", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (data: TaskFormValues & { id: string }) => {
      const { id, ...rest } = data;
      const payload = {
        ...rest,
        dueDate: rest.dueDate ? new Date(rest.dueDate).toISOString() : null,
        assigneeId: rest.assigneeId || null,
      };
      return apiRequest("PATCH", `/api/tasks/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Tarefa atualizada" });
      setDialogOpen(false);
      setEditingTask(null);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar tarefa", variant: "destructive" });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Tarefa removida" });
    },
    onError: () => {
      toast({ title: "Erro ao remover tarefa", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/tasks/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const openCreateDialog = () => {
    setEditingTask(null);
    form.reset({
      title: "",
      description: "",
      projectId: "",
      status: "todo",
      priority: 0,
      dueDate: "",
      assigneeId: "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    form.reset({
      title: task.title,
      description: task.description || "",
      projectId: task.projectId,
      status: task.status,
      priority: task.priority || 0,
      dueDate: task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : "",
      assigneeId: task.assigneeId || "",
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: TaskFormValues) => {
    if (editingTask) {
      updateTaskMutation.mutate({ ...data, id: editingTask.id });
    } else {
      createTaskMutation.mutate(data);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === "all" || task.status === statusFilter;
    const matchesProject = projectFilter === "all" || task.projectId === projectFilter;
    return matchesSearch && matchesStatus && matchesProject;
  });

  const getProjectName = (projectId: string) => {
    return projects.find(p => p.id === projectId)?.name || "Projeto";
  };

  const getAssigneeName = (assigneeId: string | null) => {
    if (!assigneeId) return null;
    const user = users.find(u => u.id === assigneeId);
    return user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null;
  };

  const tasksByStatus = TASK_STATUSES.map(status => ({
    ...status,
    tasks: filteredTasks.filter(t => t.status === status.value),
  }));

  const stats = {
    total: tasks.length,
    todo: tasks.filter(t => t.status === "todo").length,
    inProgress: tasks.filter(t => t.status === "in_progress").length,
    done: tasks.filter(t => t.status === "done").length,
    overdue: tasks.filter(t => t.dueDate && isBefore(new Date(t.dueDate), new Date()) && t.status !== "done").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold flex items-center gap-3">
            <CheckSquare className="h-8 w-8 text-primary" />
            Tarefas
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie as tarefas de todos os projetos
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="button-create-task">
          <Plus className="h-4 w-4 mr-2" />
          Nova Tarefa
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <CheckSquare className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">A Fazer</p>
                <p className="text-2xl font-bold">{stats.todo}</p>
              </div>
              <div className="h-8 w-8 rounded-full bg-slate-500/20 flex items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-slate-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Em Andamento</p>
                <p className="text-2xl font-bold">{stats.inProgress}</p>
              </div>
              <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-card-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Atrasadas</p>
                <p className="text-2xl font-bold text-red-500">{stats.overdue}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tarefas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-tasks"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-status-all">Todos</SelectItem>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value} data-testid={`select-item-status-${status.value}`}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-48" data-testid="select-project-filter">
            <SelectValue placeholder="Projeto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="select-item-project-all">Todos os Projetos</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id} data-testid={`select-item-project-${project.id}`}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant={viewMode === "kanban" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("kanban")}
            className="toggle-elevate"
            data-testid="button-view-kanban"
          >
            <LayoutGrid className="h-4 w-4 mr-1" />
            Kanban
          </Button>
          <Button
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("calendar")}
            className="toggle-elevate"
            data-testid="button-view-calendar"
          >
            <CalendarDays className="h-4 w-4 mr-1" />
            Agenda
          </Button>
        </div>
      </div>

      {tasksLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-20 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : viewMode === "calendar" ? (
        <CalendarView
          tasks={filteredTasks}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          getProjectName={getProjectName}
          getAssigneeName={getAssigneeName}
          openEditDialog={openEditDialog}
          deleteTaskMutation={deleteTaskMutation}
          setScrumDialogTask={setScrumDialogTask}
          setScrumDialogOpen={setScrumDialogOpen}
        />
      ) : filteredTasks.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckSquare className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhuma tarefa encontrada</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              {searchQuery || statusFilter !== "all" || projectFilter !== "all"
                ? "Tente ajustar os filtros de busca."
                : "Crie sua primeira tarefa para começar."}
            </p>
            {!searchQuery && statusFilter === "all" && projectFilter === "all" && (
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Nova Tarefa
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {tasksByStatus.map((column) => (
            <Card key={column.value} className="border-card-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${column.color}`} />
                    <CardTitle className="text-sm font-medium">{column.label}</CardTitle>
                  </div>
                  <Badge variant="secondary" size="sm">
                    {column.tasks.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {column.tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Nenhuma tarefa
                  </p>
                ) : (
                  column.tasks.map((task) => (
                    <Card 
                      key={task.id} 
                      className="border-card-border hover-elevate cursor-pointer"
                      data-testid={`card-task-${task.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-medium line-clamp-2">{task.title}</h4>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                                <MoreHorizontal className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(task)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => {
                                  setScrumDialogTask(task);
                                  setScrumDialogOpen(true);
                                }}
                              >
                                <ListPlus className="h-4 w-4 mr-2" />
                                Gerar Item Scrum
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => deleteTaskMutation.mutate(task.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {task.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {task.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Badge variant="outline" size="sm" className="text-[10px]">
                            {getProjectName(task.projectId)}
                          </Badge>
                          <TaskPriorityBadge priority={task.priority || 0} />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <DueDateBadge dueDate={task.dueDate} />
                          {task.assigneeId && (
                            <span className="text-xs text-muted-foreground">
                              {getAssigneeName(task.assigneeId)}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingTask ? "Editar Tarefa" : "Nova Tarefa"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Digite o título da tarefa" 
                        {...field} 
                        data-testid="input-task-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Descrição opcional" 
                        {...field}
                        data-testid="input-task-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Projeto</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-task-project">
                          <SelectValue placeholder="Selecione um projeto" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id} data-testid={`select-item-form-project-${project.id}`}>
                            {project.name}
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
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-task-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TASK_STATUSES.map((status) => (
                            <SelectItem key={status.value} value={status.value} data-testid={`select-item-form-status-${status.value}`}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioridade</FormLabel>
                      <Select 
                        onValueChange={(v) => field.onChange(parseInt(v))} 
                        value={field.value.toString()}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-task-priority">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TASK_PRIORITIES.map((priority) => (
                            <SelectItem key={priority.value} value={priority.value.toString()} data-testid={`select-item-priority-${priority.value}`}>
                              {priority.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Vencimento</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field} 
                        data-testid="input-task-due-date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsável</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-task-assignee">
                          <SelectValue placeholder="Selecione (opcional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none" data-testid="select-item-assignee-none">Nenhum</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id} data-testid={`select-item-assignee-${user.id}`}>
                            {user.firstName} {user.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  disabled={createTaskMutation.isPending || updateTaskMutation.isPending}
                  data-testid="button-submit-task"
                >
                  {createTaskMutation.isPending || updateTaskMutation.isPending
                    ? "Salvando..."
                    : editingTask ? "Atualizar" : "Criar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {scrumDialogTask && (
        <GenerateScrumItemDialog
          open={scrumDialogOpen}
          onOpenChange={setScrumDialogOpen}
          originType="task"
          originId={scrumDialogTask.id}
          originProjectId={scrumDialogTask.projectId}
          defaultTitle={scrumDialogTask.title}
          defaultDescription={scrumDialogTask.description || ""}
          defaultType="feature"
          defaultPriority={mapPriorityToScrum(scrumDialogTask.priority)}
        />
      )}
    </div>
  );
}
