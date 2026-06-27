import type { Express } from "express";
import { pool } from "../db";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";

const auth = [isAuthenticated, requireTenant] as const;

export function registerReport01Routes(app: Express) {

  app.get("/api/hub/projects/:id/reports/delayed-tasks", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT t.*,
           w.title AS wbs_title, w.code AS wbs_code,
           CURRENT_DATE - t.due_date AS days_overdue,
           CASE t.priority
             WHEN 'critica' THEN 1
             WHEN 'alta'    THEN 2
             WHEN 'media'   THEN 3
             ELSE 4
           END AS priority_order
         FROM project_tasks t
         LEFT JOIN project_wbs_nodes w ON w.id = t.wbs_node_id
         WHERE t.project_id = $1 AND t.tenant_id = $2
           AND t.due_date < CURRENT_DATE
           AND t.status NOT IN ('done','blocked','cancelado')
         ORDER BY priority_order, days_overdue DESC`,
        [req.params.id, tenantId]
      );
      const summary = {
        total:       rows.length,
        critica:     rows.filter(r => r.priority === "critica").length,
        alta:        rows.filter(r => r.priority === "alta").length,
        media:       rows.filter(r => r.priority === "media").length,
        baixa:       rows.filter(r => r.priority === "baixa").length,
        maxDaysLate: rows.length > 0 ? Math.max(...rows.map(r => r.days_overdue)) : 0,
        avgDaysLate: rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + r.days_overdue, 0) / rows.length)
          : 0,
      };
      res.json({ tasks: rows, summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/reports/billing-summary", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: contracts } = await pool.query(
        `SELECT c.*,
           json_agg(m ORDER BY m.due_date NULLS LAST) AS milestones
         FROM project_contracts c
         LEFT JOIN project_billing_milestones m ON m.contract_id = c.id
         WHERE c.project_id = $1 AND c.tenant_id = $2
         GROUP BY c.id ORDER BY c.created_at`,
        [req.params.id, tenantId]
      );

      const { rows: [totals] } = await pool.query(
        `SELECT
           COALESCE(SUM(m.amount), 0) AS total_contratado,
           COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'atingido'), 0)  AS atingido,
           COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'faturado'), 0)  AS faturado,
           COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'pago'), 0)      AS recebido,
           COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'pendente'), 0)  AS pendente,
           COUNT(*) FILTER (WHERE m.status = 'pendente' AND m.due_date < CURRENT_DATE) AS vencidos
         FROM project_billing_milestones m
         WHERE m.project_id = $1 AND m.tenant_id = $2`,
        [req.params.id, tenantId]
      );

      const { rows: fiscal } = await pool.query(
        `SELECT
           status,
           COALESCE(SUM(gross_amount), 0) AS gross,
           COALESCE(SUM(net_amount), 0)   AS net,
           COUNT(*) AS qtd
         FROM project_fiscal_events
         WHERE project_id = $1 AND tenant_id = $2
         GROUP BY status`,
        [req.params.id, tenantId]
      );

      const { rows: timeline } = await pool.query(
        `SELECT
           DATE_TRUNC('month', due_date) AS mes,
           SUM(amount) AS valor,
           COUNT(*) AS marcos,
           STRING_AGG(DISTINCT status, ',') AS statuses
         FROM project_billing_milestones
         WHERE project_id = $1 AND tenant_id = $2 AND due_date IS NOT NULL
         GROUP BY mes ORDER BY mes`,
        [req.params.id, tenantId]
      );

      res.json({ contracts, totals, fiscal, timeline });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/reports/portfolio", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { from, to } = req.query;
    const since = from ?? new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
    const until = to   ?? new Date().toISOString().split("T")[0];
    try {
      const { rows: projects } = await pool.query(
        `SELECT p.id, p.project_code, p.title, p.status, p.project_type,
           p.contract_value, p.progress_pct, p.health_score, p.owner_id,
           COALESCE((SELECT total_budget FROM project_budget_versions bv
                     WHERE bv.project_id = p.id AND bv.status = 'aprovado'
                     ORDER BY bv.version DESC LIMIT 1), 0) AS planned_budget,
           COALESCE((SELECT SUM(amount) FROM project_cost_events ce WHERE ce.project_id = p.id), 0) AS actual_cost,
           COALESCE((SELECT SUM(amount) FROM project_billing_milestones m WHERE m.project_id = p.id AND m.status = 'pago'), 0) AS received,
           COALESCE((SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.due_date < CURRENT_DATE AND t.status NOT IN ('done','blocked')), 0) AS delayed_tasks,
           COALESCE((SELECT hours FROM project_kpi_snapshots s WHERE s.project_id = p.id ORDER BY s.snapshot_date DESC LIMIT 1), 0) AS total_hours
         FROM projects p
         WHERE p.tenant_id = $1 AND p.status NOT IN ('cancelado')
         ORDER BY p.contract_value DESC NULLS LAST`,
        [tenantId]
      );

      const { rows: [summary] } = await pool.query(
        `SELECT
           COUNT(*) AS total_projetos,
           COUNT(*) FILTER (WHERE status = 'ativo')     AS ativos,
           COUNT(*) FILTER (WHERE status = 'concluido') AS concluidos,
           COALESCE(SUM(contract_value), 0)             AS carteira_total,
           COUNT(*) FILTER (WHERE health_score = 'vermelho') AS criticos,
           COUNT(*) FILTER (WHERE health_score = 'amarelo')  AS em_atencao,
           ROUND(AVG(progress_pct), 1)                  AS progresso_medio
         FROM projects WHERE tenant_id = $1 AND status NOT IN ('cancelado')`,
        [tenantId]
      );

      const { rows: costByMonth } = await pool.query(
        `SELECT DATE_TRUNC('month', event_date) AS mes,
           SUM(amount) AS custo, COUNT(DISTINCT project_id) AS projetos
         FROM project_cost_events
         WHERE tenant_id = $1 AND event_date BETWEEN $2 AND $3
         GROUP BY mes ORDER BY mes`,
        [tenantId, since, until]
      );

      const { rows: billingByMonth } = await pool.query(
        `SELECT DATE_TRUNC('month', received_at) AS mes,
           SUM(amount) AS recebido, COUNT(*) AS marcos
         FROM project_billing_milestones
         WHERE tenant_id = $1 AND received_at BETWEEN $2 AND $3 AND status = 'pago'
         GROUP BY mes ORDER BY mes`,
        [tenantId, since, until]
      );

      res.json({ projects, summary, costByMonth, billingByMonth, period: { from: since, to: until } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
