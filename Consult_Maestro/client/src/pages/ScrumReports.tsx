import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Target,
  Zap,
  Calendar,
  Users2,
  ListTodo,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentPanel } from "@/components/AgentPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  AreaChart,
  Area,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type {
  ScrumBacklogItem,
  ScrumSprint,
  ScrumTeam,
  ScrumTimesheet,
  ScrumInternalProject,
  Client,
  Project,
} from "@shared/schema";

interface SprintMetrics {
  sprintName: string;
  sprintId: string;
  planned: number;
  completed: number;
  velocity: number;
  startDate: string;
  endDate: string;
}

interface BurndownDataPoint {
  day: string;
  ideal: number;
  actual: number;
  date: string;
}

interface CostMetrics {
  totalHours: number;
  totalCost: number;
  byType: { type: string; hours: number; cost: number }[];
  byTeam: { team: string; hours: number; cost: number }[];
}

interface LeadTimeMetrics {
  avgLeadTime: number;
  avgCycleTime: number;
  throughput: number;
  byType: { type: string; avgDays: number }[];
}

const velocityChartConfig: ChartConfig = {
  planned: {
    label: "Planejado",
    color: "hsl(var(--muted-foreground))",
  },
  completed: {
    label: "Concluido",
    color: "hsl(var(--primary))",
  },
};

const burndownChartConfig: ChartConfig = {
  ideal: {
    label: "Ideal",
    color: "hsl(var(--muted-foreground))",
  },
  actual: {
    label: "Realizado",
    color: "hsl(var(--primary))",
  },
};

const costChartConfig: ChartConfig = {
  hours: {
    label: "Horas",
    color: "hsl(var(--primary))",
  },
  cost: {
    label: "Custo",
    color: "hsl(var(--chart-2))",
  },
};

const typeColors = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--muted-foreground))",
];

const typeLabels: Record<string, string> = {
  feature: "Feature",
  bug: "Bug",
  technical_debt: "Debito Tecnico",
  improvement: "Melhoria",
  documentation: "Documentacao",
  support: "Suporte",
  requirement: "Requisito",
  task: "Tarefa",
};

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  isLoading,
  testId,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  isLoading: boolean;
  testId?: string;
}) {
  return (
    <Card className="border-card-border" data-testid={testId}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold">{value}</p>
                {trend && trendLabel && (
                  <span
                    className={`flex items-center text-xs ${
                      trend === "up"
                        ? "text-green-600 dark:text-green-400"
                        : trend === "down"
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {trend === "up" ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : trend === "down" ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : null}
                    {trendLabel}
                  </span>
                )}
              </div>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScrumReports() {
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("6");

  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: consultingProjects = [], isLoading: consultingProjectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "?scope=production"],
  });

  const { data: internalProjects = [], isLoading: projectsLoading } = useQuery<ScrumInternalProject[]>({
    queryKey: ["/api/scrum/internal-projects"],
  });

  const { data: sprints = [], isLoading: sprintsLoading } = useQuery<ScrumSprint[]>({
    queryKey: ["/api/scrum/sprints"],
  });

  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<ScrumBacklogItem[]>({
    queryKey: ["/api/scrum/backlog-items"],
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery<ScrumTeam[]>({
    queryKey: ["/api/scrum/teams"],
  });

  const { data: timesheets = [], isLoading: timesheetsLoading } = useQuery<ScrumTimesheet[]>({
    queryKey: ["/api/scrum/timesheets"],
  });

  const isLoading = clientsLoading || consultingProjectsLoading || projectsLoading || sprintsLoading || backlogLoading || teamsLoading || timesheetsLoading;

  const filteredProjectsByClient = useMemo(() => {
    if (selectedClientId === "all") return internalProjects;
    const clientConsultingProjectIds = new Set(
      consultingProjects.filter((p) => p.clientId === selectedClientId).map((p) => p.id)
    );
    return internalProjects.filter((p) => p.clientProjectId && clientConsultingProjectIds.has(p.clientProjectId));
  }, [internalProjects, consultingProjects, selectedClientId]);

  const availableSprintsForFilter = useMemo(() => {
    let result = sprints;
    if (selectedClientId !== "all") {
      const clientProjectIds = new Set(filteredProjectsByClient.map((p) => p.id));
      result = result.filter((s) => s.internalProjectId && clientProjectIds.has(s.internalProjectId));
    }
    if (selectedProjectId !== "all") {
      result = result.filter((s) => s.internalProjectId === selectedProjectId);
    }
    return result.sort((a, b) => {
      const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
      const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
      return dateB - dateA;
    });
  }, [sprints, selectedClientId, selectedProjectId, filteredProjectsByClient]);

  // Filter sprints by selected project and client
  const projectSprints = useMemo(() => {
    let result = sprints;
    if (selectedClientId !== "all") {
      const clientProjectIds = new Set(filteredProjectsByClient.map((p) => p.id));
      result = result.filter((s) => s.internalProjectId && clientProjectIds.has(s.internalProjectId));
    }
    if (selectedProjectId !== "all") {
      result = result.filter((s) => s.internalProjectId === selectedProjectId);
    }
    return result;
  }, [sprints, selectedClientId, selectedProjectId, filteredProjectsByClient]);

  // Filter backlog items by client, project, and optionally sprint
  const filteredBacklogItems = useMemo(() => {
    let result = backlogItems;
    if (selectedClientId !== "all") {
      const clientProjectIds = new Set(filteredProjectsByClient.map((p) => p.id));
      result = result.filter((item) => item.internalProjectId && clientProjectIds.has(item.internalProjectId));
    }
    if (selectedProjectId !== "all") {
      result = result.filter((item) => item.internalProjectId === selectedProjectId);
    }
    if (selectedSprintId !== "all") {
      result = result.filter((item) => item.sprintId === selectedSprintId);
    }
    return result;
  }, [backlogItems, selectedClientId, selectedProjectId, selectedSprintId, filteredProjectsByClient]);

  // Filter timesheets to only include entries for items matching the filters
  const filteredTimesheets = useMemo(() => {
    const filteredItemIds = new Set(filteredBacklogItems.map((b) => b.id));
    return timesheets.filter((t) => filteredItemIds.has(t.pbiId));
  }, [timesheets, filteredBacklogItems]);

  const filteredSprints = useMemo(() => {
    let result = projectSprints;
    if (selectedSprintId !== "all") {
      result = result.filter((s) => s.id === selectedSprintId);
    } else {
      const numSprints = parseInt(timeRange);
      result = result
        .filter((s) => s.status === "completed" || s.status === "active")
        .sort((a, b) => {
          const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
          const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, numSprints);
    }
    return result;
  }, [projectSprints, selectedSprintId, timeRange]);

  const velocityData: SprintMetrics[] = useMemo(() => {
    return filteredSprints
      .map((sprint) => {
        const sprintItems = backlogItems.filter((item) => item.sprintId === sprint.id);
        const plannedPoints = sprintItems.reduce((sum, item) => sum + (item.storyPoints || 0), 0);
        const completedPoints = sprintItems
          .filter((item) => item.status === "concluido")
          .reduce((sum, item) => sum + (item.storyPoints || 0), 0);

        return {
          sprintName: sprint.name.length > 15 ? sprint.name.substring(0, 15) + "..." : sprint.name,
          sprintId: sprint.id,
          planned: plannedPoints,
          completed: completedPoints,
          velocity: completedPoints,
          startDate: sprint.startDate ? new Date(sprint.startDate).toISOString() : "",
          endDate: sprint.endDate ? new Date(sprint.endDate).toISOString() : "",
        };
      })
      .reverse();
  }, [filteredSprints, backlogItems]);

  const avgVelocity = useMemo(() => {
    if (velocityData.length === 0) return 0;
    const totalVelocity = velocityData.reduce((sum, d) => sum + d.velocity, 0);
    return Math.round(totalVelocity / velocityData.length);
  }, [velocityData]);

  const velocityTrend = useMemo(() => {
    if (velocityData.length < 2) return { trend: "neutral" as const, label: "" };
    const recent = velocityData.slice(-3);
    const previous = velocityData.slice(-6, -3);
    if (recent.length === 0 || previous.length === 0) return { trend: "neutral" as const, label: "" };
    
    const recentAvg = recent.reduce((sum, d) => sum + d.velocity, 0) / recent.length;
    const previousAvg = previous.reduce((sum, d) => sum + d.velocity, 0) / previous.length;
    
    if (previousAvg === 0) return { trend: "neutral" as const, label: "" };
    
    const change = ((recentAvg - previousAvg) / previousAvg) * 100;
    if (change > 5) return { trend: "up" as const, label: `+${change.toFixed(0)}%` };
    if (change < -5) return { trend: "down" as const, label: `${change.toFixed(0)}%` };
    return { trend: "neutral" as const, label: "~0%" };
  }, [velocityData]);

  const activeSprint = useMemo(() => {
    // If a specific sprint is selected, use it for burndown
    if (selectedSprintId !== "all") {
      return projectSprints.find((s) => s.id === selectedSprintId);
    }
    // Otherwise find the active sprint within the filtered project sprints
    return projectSprints.find((s) => s.status === "active");
  }, [projectSprints, selectedSprintId]);

  const burndownData: BurndownDataPoint[] = useMemo(() => {
    if (!activeSprint || !activeSprint.startDate || !activeSprint.endDate) return [];

    const startDate = new Date(activeSprint.startDate);
    const endDate = new Date(activeSprint.endDate);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const sprintItems = backlogItems.filter((item) => item.sprintId === activeSprint.id);
    const totalPoints = sprintItems.reduce((sum, item) => sum + (item.storyPoints || 0), 0);
    const completedPoints = sprintItems
      .filter((item) => item.status === "concluido")
      .reduce((sum, item) => sum + (item.storyPoints || 0), 0);

    const today = new Date();
    const daysPassed = Math.min(
      Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
      totalDays
    );

    const data: BurndownDataPoint[] = [];
    for (let i = 0; i <= totalDays; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);
      const dayLabel = `D${i + 1}`;
      
      const idealRemaining = Math.max(0, totalPoints - (totalPoints / totalDays) * i);
      const actualRemaining = i <= daysPassed
        ? Math.max(0, totalPoints - (completedPoints * i) / Math.max(daysPassed, 1))
        : undefined;

      data.push({
        day: dayLabel,
        ideal: Math.round(idealRemaining * 10) / 10,
        actual: actualRemaining !== undefined ? Math.round(actualRemaining * 10) / 10 : 0,
        date: currentDate.toLocaleDateString("pt-BR"),
      });
    }

    return data;
  }, [activeSprint, backlogItems]);

  const costMetrics: CostMetrics = useMemo(() => {
    const totalHours = filteredTimesheets.reduce((sum, t) => sum + (t.hoursWorked || 0), 0);
    const avgHourlyRate = 150;
    const totalCost = totalHours * avgHourlyRate;

    const byTypeMap = new Map<string, { hours: number; cost: number }>();
    filteredTimesheets.forEach((t) => {
      const item = filteredBacklogItems.find((b) => b.id === t.pbiId);
      const type = item?.type || "other";
      const current = byTypeMap.get(type) || { hours: 0, cost: 0 };
      current.hours += t.hoursWorked || 0;
      current.cost += (t.hoursWorked || 0) * avgHourlyRate;
      byTypeMap.set(type, current);
    });

    const byType = Array.from(byTypeMap.entries())
      .map(([type, data]) => ({
        type: typeLabels[type] || type,
        hours: data.hours,
        cost: data.cost,
      }))
      .sort((a, b) => b.hours - a.hours);

    const byTeamMap = new Map<string, { hours: number; cost: number }>();
    filteredTimesheets.forEach((t) => {
      const item = filteredBacklogItems.find((b) => b.id === t.pbiId);
      const sprint = projectSprints.find((s) => s.id === item?.sprintId);
      const team = teams.find((tm) => tm.id === sprint?.teamId);
      const teamName = team?.name || "Sem Equipe";
      const current = byTeamMap.get(teamName) || { hours: 0, cost: 0 };
      current.hours += t.hoursWorked || 0;
      current.cost += (t.hoursWorked || 0) * avgHourlyRate;
      byTeamMap.set(teamName, current);
    });

    const byTeam = Array.from(byTeamMap.entries())
      .map(([team, data]) => ({
        team,
        hours: data.hours,
        cost: data.cost,
      }))
      .sort((a, b) => b.hours - a.hours);

    return { totalHours, totalCost, byType, byTeam };
  }, [filteredTimesheets, filteredBacklogItems, teams, projectSprints]);

  const leadTimeMetrics: LeadTimeMetrics = useMemo(() => {
    const completedItems = filteredBacklogItems.filter((item) => item.status === "concluido");
    
    const calculateDays = (start: Date | string | null, end: Date | string | null) => {
      if (!start || !end) return 0;
      const startDate = new Date(start);
      const endDate = new Date(end);
      return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    };

    let totalLeadTime = 0;
    let totalCycleTime = 0;
    let count = 0;

    const byTypeMap = new Map<string, { totalDays: number; count: number }>();

    completedItems.forEach((item) => {
      const sprint = projectSprints.find((s) => s.id === item.sprintId);
      if (sprint && sprint.startDate && sprint.endDate) {
        const cycleTime = calculateDays(sprint.startDate, sprint.endDate);
        const leadTime = cycleTime + 3;
        totalLeadTime += leadTime;
        totalCycleTime += cycleTime;
        count++;

        const current = byTypeMap.get(item.type) || { totalDays: 0, count: 0 };
        current.totalDays += cycleTime;
        current.count++;
        byTypeMap.set(item.type, current);
      }
    });

    const avgLeadTime = count > 0 ? Math.round(totalLeadTime / count) : 0;
    const avgCycleTime = count > 0 ? Math.round(totalCycleTime / count) : 0;

    const completedThisMonth = completedItems.filter((item) => {
      const sprint = projectSprints.find((s) => s.id === item.sprintId);
      if (!sprint?.endDate) return false;
      const endDate = new Date(sprint.endDate);
      const now = new Date();
      return endDate.getMonth() === now.getMonth() && endDate.getFullYear() === now.getFullYear();
    });

    const byType = Array.from(byTypeMap.entries())
      .map(([type, data]) => ({
        type: typeLabels[type] || type,
        avgDays: data.count > 0 ? Math.round(data.totalDays / data.count) : 0,
      }))
      .sort((a, b) => a.avgDays - b.avgDays);

    return {
      avgLeadTime,
      avgCycleTime,
      throughput: completedThisMonth.length,
      byType,
    };
  }, [filteredBacklogItems, projectSprints]);

  const itemsByStatus = useMemo(() => {
    const statusMap = new Map<string, number>();
    filteredBacklogItems.forEach((item) => {
      statusMap.set(item.status, (statusMap.get(item.status) || 0) + 1);
    });

    const statusLabels: Record<string, string> = {
      backlog: "Backlog",
      selecionado: "Selecionado",
      em_execucao: "Em Execucao",
      em_revisao: "Em Revisao",
      aguardando_validacao: "Aguardando",
      concluido: "Concluido",
      cancelado: "Cancelado",
      bloqueado: "Bloqueado",
    };

    return Array.from(statusMap.entries())
      .map(([status, count]) => ({
        name: statusLabels[status] || status,
        value: count,
      }))
      .filter((d) => d.value > 0);
  }, [filteredBacklogItems]);

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/producao" data-testid="button-back-to-scrum">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="font-heading text-3xl font-bold" data-testid="text-reports-title">
              Relatorios de Producao
            </h1>
            <p className="text-muted-foreground mt-1">
              Metricas de velocidade, burndown, custos e lead time
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedClientId} onValueChange={(value) => {
            setSelectedClientId(value);
            setSelectedProjectId("all");
            setSelectedSprintId("all");
          }}>
            <SelectTrigger className="w-[160px]" data-testid="select-client-filter">
              <SelectValue placeholder="Todos os Clientes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Clientes</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedProjectId} onValueChange={(value) => {
            setSelectedProjectId(value);
            setSelectedSprintId("all");
          }}>
            <SelectTrigger className="w-[160px]" data-testid="select-project-filter">
              <SelectValue placeholder="Todos os Projetos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Projetos</SelectItem>
              {filteredProjectsByClient.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
            <SelectTrigger className="w-[160px]" data-testid="select-sprint-filter">
              <SelectValue placeholder="Todas as Sprints" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Sprints</SelectItem>
              {availableSprintsForFilter.map((sprint) => (
                <SelectItem key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange} disabled={selectedSprintId !== "all"}>
            <SelectTrigger className="w-[130px]" data-testid="select-time-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Ultimas 3</SelectItem>
              <SelectItem value="6">Ultimas 6</SelectItem>
              <SelectItem value="12">Ultimas 12</SelectItem>
              <SelectItem value="24">Ultimas 24</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedProjectId !== "all" && (
        <AgentPanel
          projectId={selectedProjectId}
          agentType="generic"
          label="Análise de produção com IA"
          description="Identifica gargalos de velocidade, lead time e tendências do backlog"
          visibleIn="scrum_reports"
          defaultPrompt="Analise as métricas de produção (velocidade, lead time, throughput) e backlog do projeto. Aponte gargalos, tendências e recomendações para a próxima sprint."
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Velocidade Media"
          value={avgVelocity}
          subtitle="pontos por sprint"
          icon={Activity}
          trend={velocityTrend.trend}
          trendLabel={velocityTrend.label}
          isLoading={isLoading}
          testId="metric-avg-velocity"
        />
        <MetricCard
          title="Lead Time Medio"
          value={`${leadTimeMetrics.avgLeadTime}d`}
          subtitle="criacao ate entrega"
          icon={Clock}
          isLoading={isLoading}
          testId="metric-lead-time"
        />
        <MetricCard
          title="Throughput Mensal"
          value={leadTimeMetrics.throughput}
          subtitle="itens entregues este mes"
          icon={Target}
          isLoading={isLoading}
          testId="metric-throughput"
        />
        <MetricCard
          title="Custo Total"
          value={`R$ ${costMetrics.totalCost.toLocaleString("pt-BR")}`}
          subtitle={`${costMetrics.totalHours}h registradas`}
          icon={DollarSign}
          isLoading={isLoading}
          testId="metric-total-cost"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-card-border" data-testid="chart-velocity">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Grafico de Velocidade
            </CardTitle>
            <CardDescription>
              Pontos planejados vs. concluidos por sprint
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : velocityData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhuma sprint concluida encontrada</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={velocityChartConfig} className="h-[300px]">
                <BarChart data={velocityData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="sprintName" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="planned"
                    fill="var(--color-planned)"
                    radius={[4, 4, 0, 0]}
                    name="Planejado"
                  />
                  <Bar
                    dataKey="completed"
                    fill="var(--color-completed)"
                    radius={[4, 4, 0, 0]}
                    name="Concluido"
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border" data-testid="chart-burndown">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Burndown Chart
            </CardTitle>
            <CardDescription>
              {activeSprint ? `Sprint: ${activeSprint.name}` : "Nenhuma sprint ativa"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : burndownData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhuma sprint ativa para exibir burndown</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={burndownChartConfig} className="h-[300px]">
                <AreaChart data={burndownData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={<ChartTooltipContent labelKey="date" />}
                    labelFormatter={(_, payload) => {
                      if (payload && payload[0]) {
                        return payload[0].payload.date;
                      }
                      return "";
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="ideal"
                    stroke="var(--color-ideal)"
                    fill="var(--color-ideal)"
                    fillOpacity={0.1}
                    strokeDasharray="5 5"
                    name="Ideal"
                  />
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="var(--color-actual)"
                    fill="var(--color-actual)"
                    fillOpacity={0.3}
                    name="Realizado"
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-card-border" data-testid="chart-cost-by-type">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Custo por Tipo de Item
            </CardTitle>
            <CardDescription>
              Distribuicao de horas e custos por categoria
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : costMetrics.byType.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum registro de horas encontrado</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={costChartConfig} className="h-[300px]">
                <BarChart data={costMetrics.byType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="type"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value, name) => {
                      if (name === "cost") {
                        return [`R$ ${Number(value).toLocaleString("pt-BR")}`, "Custo"];
                      }
                      return [`${value}h`, "Horas"];
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="hours"
                    fill="var(--color-hours)"
                    radius={[0, 4, 4, 0]}
                    name="Horas"
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border" data-testid="chart-lead-time">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Lead Time por Tipo
            </CardTitle>
            <CardDescription>
              Tempo medio de entrega por categoria (dias)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : leadTimeMetrics.byType.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum item concluido encontrado</p>
                </div>
              </div>
            ) : (
              <ChartContainer config={costChartConfig} className="h-[300px]">
                <BarChart data={leadTimeMetrics.byType}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value) => [`${value} dias`, "Lead Time"]}
                  />
                  <Bar
                    dataKey="avgDays"
                    fill="var(--color-hours)"
                    radius={[4, 4, 0, 0]}
                    name="Dias"
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-card-border" data-testid="chart-items-by-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <ListTodo className="h-5 w-5 text-primary" />
              Itens por Status
            </CardTitle>
            <CardDescription>
              Distribuicao atual do backlog
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : itemsByStatus.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum item no backlog</p>
                </div>
              </div>
            ) : (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={itemsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {itemsByStatus.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={typeColors[index % typeColors.length]}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border col-span-2" data-testid="chart-cost-by-team">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Users2 className="h-5 w-5 text-primary" />
              Custo por Equipe
            </CardTitle>
            <CardDescription>
              Horas e custos por squad
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : costMetrics.byTeam.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Users2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum registro de horas por equipe</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {costMetrics.byTeam.slice(0, 5).map((team, index) => (
                  <div key={team.team} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{team.team}</span>
                      <div className="flex items-center gap-4 text-muted-foreground">
                        <span>{team.hours}h</span>
                        <span className="font-medium text-foreground">
                          R$ {team.cost.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(team.hours / Math.max(...costMetrics.byTeam.map((t) => t.hours))) * 100}%`,
                          backgroundColor: typeColors[index % typeColors.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-card-border" data-testid="card-metrics-summary">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Resumo de Metricas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Sprints Analisadas</p>
              <p className="text-2xl font-bold">{filteredSprints.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total de Itens</p>
              <p className="text-2xl font-bold">{backlogItems.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Cycle Time Medio</p>
              <p className="text-2xl font-bold">{leadTimeMetrics.avgCycleTime} dias</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Custo Medio por Item</p>
              <p className="text-2xl font-bold">
                R$ {backlogItems.filter((b) => b.status === "concluido").length > 0
                  ? Math.round(costMetrics.totalCost / backlogItems.filter((b) => b.status === "concluido").length).toLocaleString("pt-BR")
                  : "0"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
