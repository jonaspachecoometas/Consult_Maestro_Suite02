import { db } from "./db";
import { sql } from "drizzle-orm";

// Phase 3b — Global filters that may be applied to a metric query.
export interface BiFilters {
  startDate?: string;   // 'YYYY-MM-DD'
  endDate?: string;
  clientId?: string;
  projectId?: string;
  status?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_LIKE = /^[a-zA-Z0-9_-]{8,64}$/;

function buildDateClause(table: string, column: string, f?: BiFilters): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.startDate && ISO_DATE.test(f.startDate)) {
    parts.push(`${table}.${column} >= '${f.startDate}'::date`);
  }
  if (f.endDate && ISO_DATE.test(f.endDate)) {
    parts.push(`${table}.${column} <= '${f.endDate}'::date`);
  }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

function buildClientClause(table: string, column: string, f?: BiFilters): string {
  if (!f?.clientId || !UUID_LIKE.test(f.clientId)) return "";
  return ` AND ${table}.${column} = '${f.clientId}'`;
}

function buildProjectClause(table: string, column: string, f?: BiFilters): string {
  if (!f?.projectId || !UUID_LIKE.test(f.projectId)) return "";
  return ` AND ${table}.${column} = '${f.projectId}'`;
}

function buildStatusClause(table: string, column: string, f?: BiFilters): string {
  if (!f?.status) return "";
  // status is a free-form enum string; only allow safe chars.
  if (!/^[a-z0-9_]+$/i.test(f.status)) return "";
  return ` AND ${table}.${column}::text = '${f.status}'`;
}

/**
 * Built-in catalog of internal BI metrics. Every metric is a function
 * (tenantId) -> Promise<{ name: string; value: number }[]>.
 * The route layer maps `/api/bi/<key-with-dashes>` to runMetric(key).
 */

export interface MetricDescriptor {
  key: string;            // snake_case
  label: string;          // user-facing
  description: string;
  defaultWidget: "bar_chart" | "line_chart" | "radar_chart" | "kpi_card";
  group: string;          // for sidebar grouping
}

export const METRIC_CATALOG: MetricDescriptor[] = [
  {
    key: "projects_by_status",
    label: "Projetos por status",
    description: "Distribuição de projetos no funil (backlog, diagnóstico, andamento, revisão, concluído).",
    defaultWidget: "bar_chart",
    group: "Projetos",
  },
  {
    key: "tasks_by_status",
    label: "Tarefas por status",
    description: "Quantas tarefas estão em cada estado.",
    defaultWidget: "bar_chart",
    group: "Projetos",
  },
  {
    key: "clients_by_status",
    label: "Clientes por status",
    description: "Clientes ativos vs prospect vs inativos.",
    defaultWidget: "bar_chart",
    group: "Comercial",
  },
  {
    key: "processes_by_status",
    label: "Processos por status",
    description: "Status dos processos mapeados.",
    defaultWidget: "bar_chart",
    group: "Diagnóstico",
  },
  {
    key: "swot_by_quadrant",
    label: "SWOT por quadrante",
    description: "Quantidade de itens em cada quadrante da SWOT (forças, fraquezas, oportunidades, ameaças).",
    defaultWidget: "radar_chart",
    group: "Diagnóstico",
  },
  {
    key: "erp_by_adherence",
    label: "ERP — aderência",
    description: "Distribuição de requisitos ERP por status de aderência.",
    defaultWidget: "bar_chart",
    group: "Diagnóstico",
  },
  {
    key: "pdca_by_status",
    label: "PDCA por status",
    description: "Itens de PDCA agrupados por etapa (Plan/Do/Check/Act).",
    defaultWidget: "bar_chart",
    group: "Diagnóstico",
  },
  {
    key: "agents_usage_by_type",
    label: "Uso de agentes por tipo",
    description: "Quantas execuções por tipo de agente nos últimos 90 dias.",
    defaultWidget: "bar_chart",
    group: "IA",
  },
  {
    key: "crm_opportunities_by_status",
    label: "Oportunidades por status",
    description: "Distribuição de oportunidades comerciais por status (open, won, lost...).",
    defaultWidget: "bar_chart",
    group: "Comercial",
  },
  {
    key: "scrum_sprints_by_status",
    label: "Sprints por status",
    description: "Quantas sprints estão em planejamento, ativas ou concluídas.",
    defaultWidget: "bar_chart",
    group: "Scrum",
  },
];

interface Row { name: string; value: number }

async function runRaw(query: string, params: any[] = []): Promise<Row[]> {
  const res = await db.execute(sql.raw(formatWithParams(query, params)));
  return ((res.rows || []) as any[]).map((r) => ({
    name: String(r.name ?? "—"),
    value: Number(r.value ?? 0),
  }));
}

function formatWithParams(query: string, params: any[]): string {
  // We do not have a parameterised raw escape on db.execute; for these
  // built-in queries we only ever pass the tenantId, which is a uuid
  // we control. Validate it as uuid-shaped to be safe.
  let i = 0;
  return query.replace(/\$1/g, () => {
    const v = params[i++];
    if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(v)) {
      throw new Error("Invalid metric parameter");
    }
    return `'${v}'`;
  });
}

const RUNNERS: Record<string, (tenantId: string, f?: BiFilters) => Promise<Row[]>> = {
  projects_by_status: (t, f) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM projects WHERE tenant_id = $1
         ${buildDateClause("projects", "created_at", f)}
         ${buildClientClause("projects", "client_id", f)}
         ${buildStatusClause("projects", "status", f)}
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  tasks_by_status: (t, f) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM tasks WHERE tenant_id = $1
         ${buildDateClause("tasks", "created_at", f)}
         ${buildProjectClause("tasks", "project_id", f)}
         ${buildStatusClause("tasks", "status", f)}
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  clients_by_status: (t, f) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM clients WHERE tenant_id = $1
         ${buildDateClause("clients", "created_at", f)}
         ${buildStatusClause("clients", "status", f)}
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  processes_by_status: (t) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM processes WHERE tenant_id = $1
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  swot_by_quadrant: (t) =>
    runRaw(
      `SELECT COALESCE(si.type::text,'sem tipo') AS name, COUNT(*)::int AS value
         FROM swot_items si
         JOIN swot_analyses sa ON sa.id = si.analysis_id
         WHERE sa.tenant_id = $1
         GROUP BY si.type ORDER BY value DESC`,
      [t],
    ),
  erp_by_adherence: (t) =>
    runRaw(
      `SELECT COALESCE(adherence_status::text,'não avaliado') AS name, COUNT(*)::int AS value
         FROM erp_requirements WHERE tenant_id = $1
         GROUP BY adherence_status ORDER BY value DESC`,
      [t],
    ),
  pdca_by_status: (t) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM canvas_pdca_items WHERE tenant_id = $1
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  agents_usage_by_type: (t) =>
    runRaw(
      `SELECT COALESCE(agent_type::text,'desconhecido') AS name, COUNT(*)::int AS value
         FROM agent_logs
         WHERE tenant_id = $1 AND created_at > now() - interval '90 days'
         GROUP BY agent_type ORDER BY value DESC LIMIT 12`,
      [t],
    ),
  crm_opportunities_by_status: (t) =>
    runRaw(
      `SELECT COALESCE(status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM crm_opportunities WHERE tenant_id = $1
         GROUP BY status ORDER BY value DESC`,
      [t],
    ),
  scrum_sprints_by_status: (t) =>
    runRaw(
      `SELECT COALESCE(s.status::text,'sem status') AS name, COUNT(*)::int AS value
         FROM scrum_sprints s
         JOIN scrum_internal_projects p ON p.id = s.project_id
         WHERE p.tenant_id = $1
         GROUP BY s.status ORDER BY value DESC`,
      [t],
    ),
};

export async function runMetric(key: string, tenantId: string, filters?: BiFilters): Promise<Row[]> {
  const runner = RUNNERS[key];
  if (!runner) throw new Error(`Unknown metric: ${key}`);
  try {
    return await runner(tenantId, filters);
  } catch (err: any) {
    // Tables may not exist yet on a fresh DB — return empty.
    if (/does not exist|relation .* does not exist/i.test(err?.message || "")) {
      return [];
    }
    throw err;
  }
}

export function getMetricCatalog(): MetricDescriptor[] {
  return METRIC_CATALOG;
}
