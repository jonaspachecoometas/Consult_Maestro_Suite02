import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runHub06Migration } from "./migration06";
import { calcularKpis, persistirSnapshot, runDailyKpiJob } from "./kpiEngine";

const auth = [isAuthenticated, requireTenant] as const;

const allocationRuleSchema = z.object({
  userId:       z.string(),
  userName:     z.string().optional().nullable(),
  userEmail:    z.string().optional().nullable(),
  role:         z.string().optional().nullable(),
  allocationPct: z.number().min(0).max(100).optional(),
  costRate:     z.number().optional().nullable(),
  billingRate:  z.number().optional().nullable(),
  startDate:    z.string().optional().nullable(),
  endDate:      z.string().optional().nullable(),
  active:       z.boolean().optional(),
  notes:        z.string().optional().nullable(),
});

export function registerHub06Routes(app: Express) {

  app.post("/api/hub/migrate06", ...auth, async (req, res) => {
    const result = await runHub06Migration();
    res.json(result);
  });

  app.get("/api/hub/projects/:id/allocation-rules", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT r.*,
           COALESCE(SUM(t.hours), 0) AS actual_hours,
           COALESCE(SUM(t.cost_total), 0) AS actual_cost
         FROM project_allocation_rules r
         LEFT JOIN project_timesheets t ON t.user_id = r.user_id AND t.project_id = r.project_id
         WHERE r.project_id = $1 AND r.tenant_id = $2
         GROUP BY r.id ORDER BY r.user_name`,
        [req.params.id, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/allocation-rules", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = allocationRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_allocation_rules (
          project_id, tenant_id, user_id, user_name, user_email, role,
          allocation_pct, cost_rate, billing_rate, start_date, end_date, active, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (project_id, user_id) DO UPDATE
        SET user_name = EXCLUDED.user_name, user_email = EXCLUDED.user_email,
            role = EXCLUDED.role, allocation_pct = EXCLUDED.allocation_pct,
            cost_rate = EXCLUDED.cost_rate, billing_rate = EXCLUDED.billing_rate,
            start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
            active = EXCLUDED.active, notes = EXCLUDED.notes, updated_at = NOW()
        RETURNING *`,
        [
          req.params.id, tenantId, d.userId, d.userName ?? null, d.userEmail ?? null,
          d.role ?? null, d.allocationPct ?? 100,
          d.costRate ?? null, d.billingRate ?? null,
          d.startDate ?? null, d.endDate ?? null, d.active ?? true, d.notes ?? null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/allocation-rules/:ruleId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = allocationRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      user_name: d.userName, user_email: d.userEmail, role: d.role,
      allocation_pct: d.allocationPct, cost_rate: d.costRate, billing_rate: d.billingRate,
      start_date: d.startDate, end_date: d.endDate, active: d.active, notes: d.notes,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.ruleId, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE project_allocation_rules SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Regra não encontrada" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/allocation-rules/simulate", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: rules } = await pool.query(
        `SELECT r.*, COALESCE(SUM(t.hours), 0) AS actual_hours
         FROM project_allocation_rules r
         LEFT JOIN project_timesheets t ON t.user_id = r.user_id AND t.project_id = r.project_id AND t.status = 'aprovado'
         WHERE r.project_id = $1 AND r.tenant_id = $2 AND r.active = TRUE
         GROUP BY r.id`,
        [req.params.id, tenantId]
      );
      const { rows: [proj] } = await pool.query(
        `SELECT planned_start, planned_end FROM projects WHERE id = $1`, [req.params.id]
      );
      const simulate = rules.map(r => {
        const rate     = parseFloat(r.cost_rate ?? "0");
        const bilRate  = parseFloat(r.billing_rate ?? "0");
        const horasPlanejadas = r.planned_hours ?? 0;
        return {
          userId:   r.user_id,
          userName: r.user_name,
          role:     r.role,
          costRate: rate, billingRate: bilRate,
          actualHours: parseFloat(r.actual_hours),
          projectedCost:    parseFloat(r.actual_hours) * rate,
          projectedBilling: parseFloat(r.actual_hours) * bilRate,
        };
      });
      res.json({ rules: simulate });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/dre", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const kpi = await calcularKpis(req.params.id, tenantId);
      const { rows: detalhe } = await pool.query(
        `SELECT cost_category, SUM(amount) AS total, COUNT(*) AS events
         FROM project_cost_events
         WHERE project_id = $1 AND tenant_id = $2
         GROUP BY cost_category ORDER BY total DESC`,
        [req.params.id, tenantId]
      );
      const { rows: historico } = await pool.query(
        `SELECT DATE_TRUNC('month', event_date) AS mes, cost_category, SUM(amount) AS total
         FROM project_cost_events
         WHERE project_id = $1 AND tenant_id = $2
         GROUP BY mes, cost_category ORDER BY mes, cost_category`,
        [req.params.id, tenantId]
      );
      res.json({ kpi, detalhe, historico });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/snapshots", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { limit = "30" } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM project_kpi_snapshots
         WHERE project_id = $1 AND tenant_id = $2
         ORDER BY snapshot_date DESC LIMIT $3`,
        [req.params.id, tenantId, parseInt(limit as string)]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/snapshots", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const kpi = await persistirSnapshot(req.params.id, tenantId);
      res.json(kpi);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/kpi-job", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const result = await runDailyKpiJob(tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/portfolio", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { status, ownerId, type } = req.query;
    const conditions = ["p.tenant_id = $1"];
    const params: any[] = [tenantId];
    let i = 2;
    if (status)  { conditions.push(`p.status = $${i}`);        params.push(status);  i++; }
    if (ownerId) { conditions.push(`p.owner_id = $${i}`);      params.push(ownerId); i++; }
    if (type)    { conditions.push(`p.project_type = $${i}`);  params.push(type);    i++; }
    try {
      const { rows } = await pool.query(
        `SELECT p.*,
           COALESCE((SELECT SUM(amount) FROM project_cost_events ce WHERE ce.project_id = p.id), 0) AS actual_cost,
           COALESCE((SELECT total_budget FROM project_budget_versions bv
                     WHERE bv.project_id = p.id AND bv.status = 'aprovado'
                     ORDER BY bv.version DESC LIMIT 1), 0) AS planned_budget,
           (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status != 'done') AS open_tasks,
           (SELECT s.health_score FROM project_kpi_snapshots s
            WHERE s.project_id = p.id ORDER BY s.snapshot_date DESC LIMIT 1) AS last_health_score,
           COALESCE((SELECT SUM(m.amount)
            FROM project_billing_milestones m
            WHERE m.project_id = p.id AND m.status = 'pago'), 0) AS revenue_received
         FROM projects p
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.updated_at DESC`,
        params
      );
      const summary = {
        total:      rows.length,
        ativo:      rows.filter(r => r.status === "ativo").length,
        em_pausa:   rows.filter(r => r.status === "em_pausa").length,
        concluido:  rows.filter(r => r.status === "concluido").length,
        cancelado:  rows.filter(r => r.status === "cancelado").length,
        totalContract: rows.reduce((s, r) => s + parseFloat(r.contract_value ?? "0"), 0),
        totalActual:   rows.reduce((s, r) => s + parseFloat(r.actual_cost ?? "0"), 0),
        totalReceived: rows.reduce((s, r) => s + parseFloat(r.revenue_received ?? "0"), 0),
        vermelho: rows.filter(r => r.health_score === "vermelho" || r.last_health_score === "vermelho").length,
        amarelo:  rows.filter(r => r.health_score === "amarelo"  || r.last_health_score === "amarelo").length,
      };
      res.json({ projects: rows, summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
