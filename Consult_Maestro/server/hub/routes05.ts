import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runHub05Migration } from "./migration05";

const auth = [isAuthenticated, requireTenant] as const;

const timesheetSchema = z.object({
  taskId:       z.string().optional().nullable(),
  wbsNodeId:    z.string().optional().nullable(),
  userId:       z.string(),
  userName:     z.string().optional().nullable(),
  workDate:     z.string(),
  hours:        z.number().positive(),
  description:  z.string().optional().nullable(),
  billable:     z.boolean().optional(),
  activityType: z.string().optional().nullable(),
  costRate:     z.number().optional().nullable(),
  billingRate:  z.number().optional().nullable(),
  status:       z.enum(["rascunho","submetido","aprovado","rejeitado"]).optional(),
  externalRef:  z.string().optional().nullable(),
});

async function resolveRates(userId: string, projectId: string, tenantId: string, overrideCost?: number, overrideBilling?: number) {
  if (overrideCost != null && overrideBilling != null) {
    return { costRate: overrideCost, billingRate: overrideBilling };
  }
  const { rows: rule } = await pool.query(
    `SELECT cost_rate, billing_rate FROM project_allocation_rules
     WHERE project_id = $1 AND tenant_id = $2 AND user_id = $3 AND active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, tenantId, userId]
  );
  if (rule[0]) {
    return {
      costRate:    overrideCost    ?? parseFloat(rule[0].cost_rate    ?? "0"),
      billingRate: overrideBilling ?? parseFloat(rule[0].billing_rate ?? "0"),
    };
  }
  return {
    costRate:    overrideCost    ?? 0,
    billingRate: overrideBilling ?? 0,
  };
}

export function registerHub05Routes(app: Express) {

  app.post("/api/hub/migrate05", ...auth, async (req, res) => {
    const result = await runHub05Migration();
    res.json(result);
  });

  app.get("/api/hub/projects/:id/timesheets", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { userId, from, to, status, billable } = req.query;
    const conditions = ["t.project_id = $1", "t.tenant_id = $2"];
    const params: any[] = [req.params.id, tenantId];
    let i = 3;
    if (userId)  { conditions.push(`t.user_id = $${i}`);    params.push(userId);  i++; }
    if (from)    { conditions.push(`t.work_date >= $${i}`);  params.push(from);    i++; }
    if (to)      { conditions.push(`t.work_date <= $${i}`);  params.push(to);      i++; }
    if (status)  { conditions.push(`t.status = $${i}`);      params.push(status);  i++; }
    if (billable !== undefined) {
      conditions.push(`t.billable = $${i}`); params.push(billable === "true"); i++;
    }
    try {
      const { rows } = await pool.query(
        `SELECT t.*,
           tk.title AS task_title, w.title AS wbs_title, w.code AS wbs_code
         FROM project_timesheets t
         LEFT JOIN project_tasks tk ON tk.id = t.task_id
         LEFT JOIN project_wbs_nodes w ON w.id = t.wbs_node_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.work_date DESC, t.created_at DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/timesheets/summary", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { from, to } = req.query;
    const conditions = ["project_id = $1", "tenant_id = $2"];
    const params: any[] = [req.params.id, tenantId];
    let i = 3;
    if (from) { conditions.push(`work_date >= $${i}`); params.push(from); i++; }
    if (to)   { conditions.push(`work_date <= $${i}`); params.push(to);   i++; }
    try {
      const { rows: daily } = await pool.query(
        `SELECT work_date, SUM(hours) AS hours,
           SUM(CASE WHEN billable THEN hours ELSE 0 END) AS billable_hours,
           SUM(cost_total) AS cost, COUNT(*) AS entries
         FROM project_timesheets
         WHERE ${conditions.join(" AND ")}
         GROUP BY work_date ORDER BY work_date`,
        params
      );
      const { rows: byUser } = await pool.query(
        `SELECT user_id, user_name, SUM(hours) AS hours,
           SUM(CASE WHEN billable THEN hours ELSE 0 END) AS billable_hours,
           SUM(cost_total) AS cost, SUM(billing_total) AS billing
         FROM project_timesheets
         WHERE ${conditions.join(" AND ")}
         GROUP BY user_id, user_name ORDER BY hours DESC`,
        params
      );
      const { rows: byTask } = await pool.query(
        `SELECT task_id, wbs_node_id,
           SUM(hours) AS hours, SUM(cost_total) AS cost
         FROM project_timesheets
         WHERE ${conditions.join(" AND ")}
         GROUP BY task_id, wbs_node_id`,
        params
      );
      const { rows: [totals] } = await pool.query(
        `SELECT COALESCE(SUM(hours),0) AS total_hours,
           COALESCE(SUM(CASE WHEN billable THEN hours ELSE 0 END),0) AS billable_hours,
           COALESCE(SUM(cost_total),0) AS total_cost,
           COALESCE(SUM(billing_total),0) AS total_billing,
           COUNT(*) AS entries,
           COUNT(DISTINCT user_id) AS contributors
         FROM project_timesheets
         WHERE ${conditions.join(" AND ")}`,
        params
      );
      res.json({ totals, daily, byUser, byTask });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/timesheets", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = timesheetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const { costRate, billingRate } = await resolveRates(
      d.userId, req.params.id, tenantId, d.costRate ?? undefined, d.billingRate ?? undefined
    );
    const costTotal    = d.hours * costRate;
    const billingTotal = d.hours * billingRate;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_timesheets (
          project_id, task_id, wbs_node_id, tenant_id,
          user_id, user_name, work_date, hours,
          description, billable, activity_type,
          cost_rate, billing_rate, cost_total, billing_total,
          status, external_ref
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          req.params.id, d.taskId ?? null, d.wbsNodeId ?? null, tenantId,
          d.userId, d.userName ?? null, d.workDate, d.hours,
          d.description ?? null, d.billable ?? true, d.activityType ?? null,
          costRate, billingRate, costTotal, billingTotal,
          d.status ?? "rascunho", d.externalRef ?? null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/timesheets/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = timesheetSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      task_id: d.taskId, wbs_node_id: d.wbsNodeId,
      work_date: d.workDate, hours: d.hours, description: d.description,
      billable: d.billable, activity_type: d.activityType, status: d.status,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (d.hours !== undefined || d.costRate !== undefined || d.billingRate !== undefined) {
      const { rows: cur } = await pool.query(
        `SELECT hours, cost_rate, billing_rate FROM project_timesheets WHERE id = $1`, [req.params.id]
      );
      if (cur[0]) {
        const hrs    = d.hours ?? cur[0].hours;
        const cr     = d.costRate    ?? cur[0].cost_rate;
        const br     = d.billingRate ?? cur[0].billing_rate;
        fields.push(`cost_total = $${i}`, `billing_total = $${i+1}`);
        params.push(hrs * cr, hrs * br); i += 2;
        if (d.costRate    !== undefined) { fields.push(`cost_rate = $${i}`);    params.push(d.costRate);    i++; }
        if (d.billingRate !== undefined) { fields.push(`billing_rate = $${i}`); params.push(d.billingRate); i++; }
      }
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE project_timesheets SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Timesheet não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hub/timesheets/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      await pool.query(
        `DELETE FROM project_timesheets WHERE id = $1 AND tenant_id = $2 AND status = 'rascunho'`,
        [req.params.id, tenantId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/timesheets/timer/start", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { taskId, wbsNodeId, description, billable } = req.body;
    try {
      const { rows: active } = await pool.query(
        `SELECT id FROM project_timesheets
         WHERE user_id = $1 AND tenant_id = $2 AND started_at IS NOT NULL AND ended_at IS NULL`,
        [userId, tenantId]
      );
      if (active.length > 0) {
        return res.status(409).json({ error: "Timer já ativo", activeId: active[0].id });
      }
      const now = new Date();
      const { rows } = await pool.query(`
        INSERT INTO project_timesheets (
          project_id, task_id, wbs_node_id, tenant_id,
          user_id, work_date, hours, description, billable,
          status, started_at
        ) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'rascunho',$9) RETURNING *`,
        [
          req.params.id, taskId ?? null, wbsNodeId ?? null, tenantId,
          userId, now.toISOString().split("T")[0],
          description ?? null, billable ?? true, now,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/timesheets/:id/timer/stop", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [ts] } = await pool.query(
        `SELECT * FROM project_timesheets WHERE id = $1 AND tenant_id = $2 AND started_at IS NOT NULL AND ended_at IS NULL`,
        [req.params.id, tenantId]
      );
      if (!ts) return res.status(404).json({ error: "Timer não encontrado ou já encerrado" });
      const now   = new Date();
      const hours = Math.max(0.01, (now.getTime() - new Date(ts.started_at).getTime()) / 3600000);
      const { rows } = await pool.query(`
        UPDATE project_timesheets
        SET ended_at = $1, hours = $2, cost_total = $2 * cost_rate, billing_total = $2 * billing_rate, updated_at = NOW()
        WHERE id = $3 RETURNING *`,
        [now, parseFloat(hours.toFixed(2)), req.params.id]
      );
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/timesheets/timer/active", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows } = await pool.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - started_at))/3600 AS elapsed_hours
         FROM project_timesheets
         WHERE project_id = $1 AND tenant_id = $2 AND user_id = $3
           AND started_at IS NOT NULL AND ended_at IS NULL`,
        [req.params.id, tenantId, userId]
      );
      res.json(rows[0] ?? null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/timesheets/approve-batch", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids deve ser array" });
    const client = await pool.connect();
    const costEvents: any[] = [];
    try {
      await client.query("BEGIN");
      for (const id of ids) {
        const { rows: [ts] } = await client.query(
          `UPDATE project_timesheets SET status = 'aprovado', approved_by = $1, approved_at = NOW(), updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3 AND status = 'submetido' RETURNING *`,
          [userId, id, tenantId]
        );
        if (!ts) continue;
        const { rows: [ce] } = await client.query(`
          INSERT INTO project_cost_events (
            project_id, tenant_id, wbs_node_id, source_type, source_id,
            cost_category, description, amount, event_date
          ) VALUES ($1,$2,$3,'timesheet',$4,'mao_obra',$5,$6,$7) RETURNING *`,
          [
            ts.project_id, tenantId, ts.wbs_node_id,
            ts.id, `Horas — ${ts.user_name ?? ts.user_id} — ${ts.work_date}`,
            ts.cost_total, ts.work_date,
          ]
        );
        costEvents.push(ce);
      }
      await client.query("COMMIT");
      res.json({ ok: true, approved: ids.length, costEvents });
    } catch (err: any) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
}
