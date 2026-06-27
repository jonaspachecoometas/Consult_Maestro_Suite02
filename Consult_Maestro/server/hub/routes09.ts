import type { Express } from "express";
import { pool } from "../db";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";

const auth = [isAuthenticated, requireTenant] as const;

export function registerHub09Routes(app: Express) {

  app.get("/api/hub/projects/:id/historico", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { from, to, limit = "50" } = req.query;
    const projectId = req.params.id;
    try {
      const since = from ?? new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
      const until = to ?? new Date().toISOString().split("T")[0];

      const [tasks, comments, timesheets, costEvents, snapshots, fieldRecords, milestones, fiscalEvents] =
        await Promise.all([
          pool.query(
            `SELECT id, title, status, assignee_name, due_date, updated_at,
               'task' AS tipo, CONCAT('Tarefa: ', title, ' → ', status) AS descricao
             FROM project_tasks
             WHERE project_id = $1 AND tenant_id = $2
               AND updated_at BETWEEN $3 AND $4
             ORDER BY updated_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT c.id, c.content, c.author_name, c.created_at AS updated_at, t.title AS task_title,
               'comment' AS tipo, CONCAT('Comentário em: ', t.title) AS descricao
             FROM project_task_comments c
             JOIN project_tasks t ON t.id = c.task_id
             WHERE t.project_id = $1 AND c.tenant_id = $2
               AND c.created_at BETWEEN $3 AND $4
             ORDER BY c.created_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, user_name, hours, work_date, description, status, updated_at,
               'timesheet' AS tipo, CONCAT('Horas: ', hours, 'h por ', user_name) AS descricao
             FROM project_timesheets
             WHERE project_id = $1 AND tenant_id = $2
               AND updated_at BETWEEN $3 AND $4
             ORDER BY updated_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, cost_category, description, amount, event_date, created_at AS updated_at,
               'cost_event' AS tipo,
               CONCAT('Custo: ', cost_category, ' R$ ', amount) AS descricao
             FROM project_cost_events
             WHERE project_id = $1 AND tenant_id = $2
               AND created_at BETWEEN $3 AND $4
             ORDER BY created_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, snapshot_date, health_score, progress_pct, cpi, spi,
               snapshot_date::timestamp AS updated_at,
               'kpi_snapshot' AS tipo,
               CONCAT('KPI: health=', health_score, ' CPI=', ROUND(cpi::numeric,2)) AS descricao
             FROM project_kpi_snapshots
             WHERE project_id = $1 AND tenant_id = $2
               AND snapshot_date BETWEEN $3 AND $4
             ORDER BY snapshot_date DESC LIMIT $5`,
            [projectId, tenantId, since, until, parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, form_type, point_id, collected_by_name, collected_at,
               status, collected_at AS updated_at,
               'field_record' AS tipo,
               CONCAT('Campo: ', form_type, ' ponto ', point_id) AS descricao
             FROM project_field_records
             WHERE project_id = $1 AND tenant_id = $2
               AND created_at BETWEEN $3 AND $4
             ORDER BY created_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, title, amount, due_date, status, updated_at,
               'milestone' AS tipo,
               CONCAT('Marco: ', title, ' → ', status) AS descricao
             FROM project_billing_milestones
             WHERE project_id = $1 AND tenant_id = $2
               AND updated_at BETWEEN $3 AND $4
             ORDER BY updated_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
          pool.query(
            `SELECT id, event_type, service_description, gross_amount, status, updated_at,
               'fiscal_event' AS tipo,
               CONCAT('Fiscal: ', event_type, ' R$ ', gross_amount, ' → ', status) AS descricao
             FROM project_fiscal_events
             WHERE project_id = $1 AND tenant_id = $2
               AND updated_at BETWEEN $3 AND $4
             ORDER BY updated_at DESC LIMIT $5`,
            [projectId, tenantId, since, until+"T23:59:59", parseInt(limit as string)]
          ),
        ]);

      const timeline = [
        ...tasks.rows, ...comments.rows, ...timesheets.rows, ...costEvents.rows,
        ...snapshots.rows, ...fieldRecords.rows, ...milestones.rows, ...fiscalEvents.rows,
      ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
       .slice(0, parseInt(limit as string));

      res.json({ timeline, from: since, to: until });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/project-types", ...auth, async (_req, res) => {
    res.json([
      { id: "geologia",    label: "Geologia",               icon: "Mountain",   phases: true },
      { id: "ambiental",   label: "Ambiental",              icon: "Leaf",       phases: false },
      { id: "engenharia",  label: "Engenharia",             icon: "HardHat",    phases: false },
      { id: "consultoria", label: "Consultoria",            icon: "Briefcase",  phases: false },
      { id: "hidrologia",  label: "Hidrologia",             icon: "Droplets",   phases: false },
      { id: "mineracao",   label: "Mineração",              icon: "Pickaxe",    phases: true  },
      { id: "outros",      label: "Outros",                 icon: "FolderOpen", phases: false },
    ]);
  });

  app.post("/api/hub/projects/:id/apply-template", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { projectType } = req.body;
    if (!projectType) return res.status(400).json({ error: "projectType obrigatório" });
    try {
      const { rows: [proj] } = await pool.query(
        `SELECT id, title, tenant_id FROM projects WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!proj) return res.status(404).json({ error: "Projeto não encontrado" });

      const { rows: existing } = await pool.query(
        `SELECT id FROM project_wbs_nodes WHERE project_id = $1 LIMIT 1`, [req.params.id]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: "Projeto já possui WBS. Limpe antes de aplicar template." });
      }

      const templates: Record<string, any[]> = {
        geologia: [
          { title: "1. Mobilização",          nodeType: "fase", code: "1", orderIndex: 0 },
          { title: "2. Execução de Campo",     nodeType: "fase", code: "2", orderIndex: 1 },
          { title: "3. Análises Laboratoriais",nodeType: "fase", code: "3", orderIndex: 2 },
          { title: "4. Relatórios",            nodeType: "fase", code: "4", orderIndex: 3 },
        ],
        ambiental: [
          { title: "1. Diagnóstico Ambiental", nodeType: "fase", code: "1", orderIndex: 0 },
          { title: "2. Monitoramento",          nodeType: "fase", code: "2", orderIndex: 1 },
          { title: "3. Licenciamento",          nodeType: "fase", code: "3", orderIndex: 2 },
        ],
        consultoria: [
          { title: "1. Diagnóstico",  nodeType: "fase", code: "1", orderIndex: 0 },
          { title: "2. Implementação",nodeType: "fase", code: "2", orderIndex: 1 },
          { title: "3. Encerramento", nodeType: "fase", code: "3", orderIndex: 2 },
        ],
      };

      const nodes = templates[projectType] ?? templates.consultoria;
      const inserted: any[] = [];
      for (const node of nodes) {
        const { rows } = await pool.query(`
          INSERT INTO project_wbs_nodes (project_id, tenant_id, node_type, title, code, order_index)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.params.id, tenantId, node.nodeType, node.title, node.code, node.orderIndex]
        );
        inserted.push(rows[0]);
      }
      res.json({ ok: true, nodes: inserted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/engineering/projects", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { status, type } = req.query;
    const conditions = ["p.tenant_id = $1", "p.project_type IN ('geologia','mineracao','engenharia','hidrologia')"];
    const params: any[] = [tenantId];
    let i = 2;
    if (status) { conditions.push(`p.status = $${i}`);       params.push(status); i++; }
    if (type)   { conditions.push(`p.project_type = $${i}`); params.push(type);   i++; }
    try {
      const { rows } = await pool.query(
        `SELECT p.*,
           p.codigo_externo, p.fase_atual, p.checklist_fases,
           COALESCE((SELECT COUNT(*) FROM project_field_records fr WHERE fr.project_id = p.id), 0) AS field_records,
           COALESCE((SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status != 'done'), 0) AS open_tasks
         FROM projects p
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.updated_at DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/engineering/projects/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [proj] } = await pool.query(
        `SELECT p.*, p.codigo_externo, p.fase_atual, p.checklist_fases
         FROM projects p WHERE p.id = $1 AND p.tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!proj) return res.status(404).json({ error: "Projeto não encontrado" });

      const [wbs, fieldRecords, billingBlockers] = await Promise.all([
        pool.query(
          `SELECT * FROM project_wbs_nodes WHERE project_id = $1 ORDER BY order_index, code`,
          [req.params.id]
        ),
        pool.query(
          `SELECT * FROM project_field_records WHERE project_id = $1 AND tenant_id = $2
           ORDER BY collected_at DESC LIMIT 20`,
          [req.params.id, tenantId]
        ),
        pool.query(
          `SELECT * FROM project_billing_blockers WHERE project_id = $1 AND status = 'aberto'
           ORDER BY data_evento DESC`,
          [req.params.id]
        ),
      ]);

      res.json({
        ...proj,
        wbs:             wbs.rows,
        recentFieldRecords: fieldRecords.rows,
        billingBlockers: billingBlockers.rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/engineering/stats", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [stats] } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ativo')     AS projetos_ativos,
          COUNT(*) FILTER (WHERE status = 'concluido') AS projetos_concluidos,
          COALESCE(SUM(contract_value), 0)             AS valor_total_contratos,
          COUNT(*) FILTER (WHERE health_score = 'vermelho') AS alertas_criticos,
          COUNT(*) FILTER (WHERE health_score = 'amarelo')  AS alertas_atencao
        FROM projects
        WHERE tenant_id = $1
          AND project_type IN ('geologia','mineracao','engenharia','hidrologia')`,
        [tenantId]
      );
      const { rows: [fieldStats] } = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'aprovado')  AS aprovados,
          COUNT(*) FILTER (WHERE status = 'rascunho')  AS pendentes
        FROM project_field_records
        WHERE tenant_id = $1`,
        [tenantId]
      );
      const { rows: [blockerStats] } = await pool.query(`
        SELECT COUNT(*) AS total, COALESCE(SUM(impacto_valor), 0) AS impacto
        FROM project_billing_blockers
        WHERE tenant_id = $1 AND status = 'aberto'`,
        [tenantId]
      );
      res.json({ projetos: stats, fichasCampo: fieldStats, billingBlockers: blockerStats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
