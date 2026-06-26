import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  TrendingUp, AlertTriangle, CheckCircle2, ListTodo, FileText,
  Calendar as CalIcon, Folder, Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface Subproject { id: string; name: string; color: string | null; status: string; }
interface Task {
  id: string; title: string; status: string;
  subprojectId: string | null;
  dueDate: string | null;
}
interface ProjectFile {
  id: string; originalName: string | null; fileName: string;
  fileType: string; createdAt: string;
}
interface CalEvent {
  id: string; titulo: string; tipo: string;
  dataInicio: string; horaInicio: string | null;
}

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const { data: subprojects = [] } = useQuery<Subproject[]>({
    queryKey: ["/api/projects", projectId, "subprojects"],
  });
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/projects", projectId, "tasks"],
  });
  const { data: files = [] } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "drive"],
  });
  const { data: events = [] } = useQuery<CalEvent[]>({
    queryKey: ["/api/projects", projectId, "calendar"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/calendar`, { credentials: "include" });
      return res.json();
    },
  });

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === "done" || t.status === "concluido").length;
    const inProg = tasks.filter(t => t.status === "in_progress" || t.status === "em_execucao").length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = tasks.filter(t =>
      t.dueDate &&
      new Date(t.dueDate) < today &&
      t.status !== "done" && t.status !== "concluido"
    ).length;
    const next7 = events.filter(e => {
      const d = new Date(e.dataInicio);
      const diff = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 7;
    });
    return { total, done, inProg, overdue, pct: total ? Math.round((done / total) * 100) : 0, upcoming: next7 };
  }, [tasks, events]);

  const subStats = subprojects.map(sp => {
    const sub = tasks.filter(t => t.subprojectId === sp.id);
    const subDone = sub.filter(t => t.status === "done" || t.status === "concluido").length;
    return { ...sp, total: sub.length, done: subDone, pct: sub.length ? Math.round((subDone / sub.length) * 100) : 0 };
  });

  const recentFiles = [...files]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard icon={ListTodo} label="Tarefas Totais" value={stats.total} testId="kpi-total-tasks" />
        <KpiCard icon={CheckCircle2} label="Concluídas" value={`${stats.done} (${stats.pct}%)`} testId="kpi-done-tasks" tone="success" />
        <KpiCard icon={TrendingUp} label="Em andamento" value={stats.inProg} testId="kpi-progress-tasks" tone="primary" />
        <KpiCard icon={AlertTriangle} label="Atrasadas" value={stats.overdue} testId="kpi-overdue-tasks"
          tone={stats.overdue > 0 ? "destructive" : "muted"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-card-border">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Folder className="h-4 w-4" /> Progresso por Subprojeto
            </h3>
            {subStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum subprojeto criado.</p>
            ) : (
              <div className="space-y-3">
                {subStats.map(s => (
                  <div key={s.id} data-testid={`progress-sub-${s.id}`}>
                    <div className="flex justify-between items-center mb-1 text-sm">
                      <span className="font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: s.color || "#3b82f6" }} />
                        {s.name}
                      </span>
                      <span className="text-muted-foreground">{s.done}/{s.total} · {s.pct}%</span>
                    </div>
                    <Progress value={s.pct} className="h-2" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <CalIcon className="h-4 w-4" /> Próximos 7 dias
            </h3>
            {stats.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento programado.</p>
            ) : (
              <ul className="space-y-2">
                {stats.upcoming.slice(0, 6).map(e => (
                  <li key={e.id} className="text-sm flex justify-between items-start gap-2"
                    data-testid={`upcoming-${e.id}`}>
                    <span className="font-medium truncate">{e.titulo}</span>
                    <Badge variant="outline" size="sm" className="shrink-0">
                      {new Date(e.dataInicio).toLocaleDateString("pt-BR")}
                      {e.horaInicio && ` ${e.horaInicio}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-card-border">
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4" /> Arquivos recentes
          </h3>
          {recentFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum arquivo no Drive.</p>
          ) : (
            <ul className="space-y-1.5">
              {recentFiles.map(f => (
                <li key={f.id} className="text-sm flex justify-between items-center"
                  data-testid={`recent-file-${f.id}`}>
                  <span className="truncate flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {f.originalName || f.fileName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, tone, testId,
}: { icon: any; label: string; value: any; tone?: string; testId: string }) {
  const toneClass: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="border-card-border" data-testid={testId}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center ${toneClass[tone || "muted"]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
