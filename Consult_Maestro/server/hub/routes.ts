import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runHubMigration }         from "./migration";
import { runHub02Migration }        from "./migration02";
import { runHub03Migration }        from "./migration03";
import { runHub04Migration }        from "./migration04";
import { runHub05Migration }        from "./migration05";
import { runHub06Migration }        from "./migration06";
import { runHub07Migration }        from "./migration07";
import { runDep01Migration }        from "./migration_dep01";
import { runProjPriority }          from "./migration_proj01";
import { runTimer01Migration }      from "./migration_timer01";
import { runMigrationHubImp01, FASES_PROJETO } from "./migration_imp01";
import { registerHub02Routes }      from "./routes02";
import { registerHub03Routes }      from "./routes03";
import { registerHub04Routes }      from "./routes04";
import { registerHub05Routes }      from "./routes05";
import { registerHub06Routes }      from "./routes06";
import { registerHub07Routes }      from "./routes07";
import { initRoutes08, registerHub08Routes } from "./routes08";
import { registerHub09Routes }      from "./routes09";
import { registerReport01Routes }   from "./routes_report01";
import { runNotificationJob }       from "./notificationService";

const auth = [isAuthenticated, requireTenant] as const;

const projectSchema = z.object({
  projectCode:   z.string().optional().nullable(),
  title:         z.string().min(1),
  description:   z.string().optional().nullable(),
  projectType:   z.string().default("consultoria"),
  status:        z.enum(["rascunho","ativo","em_pausa","concluido","cancelado"]).optional(),
  priority:      z.enum(["baixa","media","alta","critica"]).optional(),
  ownerId:       z.string().optional().nullable(),
  ownerName:     z.string().optional().nullable(),
  clientId:      z.string().optional().nullable(),
  clientName:    z.string().optional().nullable(),
  contractValue: z.number().optional().nullable(),
  plannedStart:  z.string().optional().nullable(),
  plannedEnd:    z.string().optional().nullable(),
  actualStart:   z.string().optional().nullable(),
  actualEnd:     z.string().optional().nullable(),
  progressPct:   z.number().min(0).max(100).optional(),
  budgetSource:  z.string().optional().nullable(),
  tags:          z.array(z.string()).optional(),
  metadata:      z.record(z.any()).optional(),
  codigoExterno: z.string().optional().nullable(),
  faseAtual:     z.string().optional().nullable(),
});

const memberSchema = z.object({
  userId:   z.string(),
  userName: z.string().optional().nullable(),
  email:    z.string().optional().nullable(),
  role:     z.enum(["owner","manager","member","viewer"]).default("member"),
  active:   z.boolean().optional(),
});

export function registerHubRoutes(app: Express) {

  registerHub02Routes(app);
  registerHub03Routes(app);
  registerHub04Routes(app);
  registerHub05Routes(app);
  registerHub06Routes(app);
  registerHub07Routes(app);
  initRoutes08(app);
  registerHub09Routes(app);
  registerReport01Routes(app);

  app.get("/api/hub/projects", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { status, projectType, ownerId, search } = req.query;
    const conditions = ["p.tenant_id = $1"];
    const params: any[] = [tenantId];
    let i = 2;
    if (status)      { conditions.push(`p.status = $${i}`);        params.push(status);      i++; }
    if (projectType) { conditions.push(`p.project_type = $${i}`);  params.push(projectType); i++; }
    if (ownerId)     { conditions.push(`p.owner_id = $${i}`);      params.push(ownerId);     i++; }
    if (search) {
      conditions.push(`(p.title ILIKE $${i} OR p.project_code ILIKE $${i} OR p.client_name ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    try {
      const { rows } = await pool.query(
        `SELECT p.*,
           (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status != 'done') AS open_tasks,
           (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id AND m.active = TRUE) AS member_count,
           (SELECT SUM(amount) FROM project_cost_events ce WHERE ce.project_id = p.id) AS actual_cost
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

  app.get("/api/hub/projects/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [proj] } = await pool.query(
        `SELECT p.*,
           (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status != 'done') AS open_tasks,
           (SELECT json_agg(m) FROM project_members m WHERE m.project_id = p.id AND m.active = TRUE) AS members,
           (SELECT SUM(amount) FROM project_cost_events ce WHERE ce.project_id = p.id) AS actual_cost,
           (SELECT total_budget FROM project_budget_versions bv
            WHERE bv.project_id = p.id AND bv.status = 'aprovado'
            ORDER BY bv.version DESC LIMIT 1) AS planned_budget,
           (SELECT json_agg(bb) FROM project_billing_blockers bb
            WHERE bb.project_id = p.id AND bb.status = 'aberto') AS billing_blockers
         FROM projects p WHERE p.id = $1 AND p.tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!proj) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(proj);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [codeRow] } = await client.query(
        `SELECT COUNT(*)+1 AS seq FROM projects WHERE tenant_id = $1`, [tenantId]
      );
      const projectCode = d.projectCode ?? `P${String(codeRow.seq).padStart(4, "0")}`;
      const { rows } = await client.query(`
        INSERT INTO projects (
          tenant_id, project_code, title, description, project_type,
          status, priority, owner_id, owner_name, client_id, client_name,
          contract_value, planned_start, planned_end, actual_start, actual_end,
          progress_pct, budget_source, tags, metadata,
          codigo_externo, fase_atual, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING *`,
        [
          tenantId, projectCode, d.title, d.description ?? null, d.projectType,
          d.status ?? "rascunho", d.priority ?? "media",
          d.ownerId ?? userId, d.ownerName ?? null, d.clientId ?? null, d.clientName ?? null,
          d.contractValue ?? null, d.plannedStart ?? null, d.plannedEnd ?? null,
          d.actualStart ?? null, d.actualEnd ?? null,
          d.progressPct ?? 0, d.budgetSource ?? null,
          JSON.stringify(d.tags ?? []), JSON.stringify(d.metadata ?? {}),
          d.codigoExterno ?? null, d.faseAtual ?? "pre_programacao", userId,
        ]
      );
      if (userId) {
        await client.query(`
          INSERT INTO project_members (project_id, tenant_id, user_id, role, active)
          VALUES ($1,$2,$3,'owner',true)
          ON CONFLICT (project_id, user_id) DO NOTHING`,
          [rows[0].id, tenantId, userId]
        );
      }
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (err: any) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.patch("/api/hub/projects/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      project_code: d.projectCode, title: d.title, description: d.description,
      project_type: d.projectType, status: d.status, priority: d.priority,
      owner_id: d.ownerId, owner_name: d.ownerName, client_id: d.clientId, client_name: d.clientName,
      contract_value: d.contractValue, planned_start: d.plannedStart, planned_end: d.plannedEnd,
      actual_start: d.actualStart, actual_end: d.actualEnd,
      progress_pct: d.progressPct, budget_source: d.budgetSource,
      codigo_externo: d.codigoExterno, fase_atual: d.faseAtual,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (d.tags !== undefined) {
      fields.push(`tags = $${i}`); params.push(JSON.stringify(d.tags)); i++;
    }
    if (d.metadata !== undefined) {
      fields.push(`metadata = $${i}`); params.push(JSON.stringify(d.metadata)); i++;
    }
    if ((req.body as any).checklistFases !== undefined) {
      fields.push(`checklist_fases = $${i}`);
      params.push(JSON.stringify((req.body as any).checklistFases)); i++;
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE projects SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hub/projects/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `UPDATE projects SET status = 'cancelado', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/members", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM project_members WHERE project_id = $1 AND tenant_id = $2 ORDER BY role, created_at`,
        [req.params.id, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/members", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_members (project_id, tenant_id, user_id, user_name, email, role, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (project_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, user_name = EXCLUDED.user_name,
            email = EXCLUDED.email, active = EXCLUDED.active, updated_at = NOW()
        RETURNING *`,
        [req.params.id, tenantId, d.userId, d.userName ?? null, d.email ?? null,
         d.role, d.active ?? true]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hub/projects/:id/members/:userId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      await pool.query(
        `UPDATE project_members SET active = FALSE, updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2 AND tenant_id = $3`,
        [req.params.id, req.params.userId, tenantId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/notifications", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { unreadOnly, limit = "30" } = req.query;
    const conditions = ["tenant_id = $1", "user_id = $2"];
    const params: any[] = [tenantId, userId];
    if (unreadOnly === "true") { conditions.push(`read = FALSE`); }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM hub_notifications WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT $3`,
        [...params, parseInt(limit as string)]
      );
      const { rows: [counts] } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE read = FALSE) AS unread, COUNT(*) AS total
         FROM hub_notifications WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      );
      res.json({ notifications: rows, unread: parseInt(counts.unread), total: parseInt(counts.total) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/notifications/:id/read", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows } = await pool.query(
        `UPDATE hub_notifications SET read = TRUE WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING *`,
        [req.params.id, tenantId, userId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Notificação não encontrada" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/notifications/read-all", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rowCount } = await pool.query(
        `UPDATE hub_notifications SET read = TRUE WHERE tenant_id = $1 AND user_id = $2 AND read = FALSE`,
        [tenantId, userId]
      );
      res.json({ ok: true, updated: rowCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/notifications/run-job", ...auth, async (_req, res) => {
    try {
      const result = await runNotificationJob();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/fase", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [p] } = await pool.query(
        `SELECT id, fase_atual, checklist_fases, codigo_externo FROM projects WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!p) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json({
        faseAtual:      p.fase_atual,
        checklistFases: p.checklist_fases ?? {},
        codigoExterno:  p.codigo_externo,
        todasFases:     FASES_PROJETO,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/projects/:id/fase", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { faseAtual, checklistFases } = req.body;
    if (!faseAtual || !(FASES_PROJETO as readonly string[]).includes(faseAtual)) {
      return res.status(400).json({ error: "faseAtual inválida", validas: FASES_PROJETO });
    }
    try {
      const { rows } = await pool.query(`
        UPDATE projects
        SET fase_atual = $1,
            checklist_fases = COALESCE($2::jsonb, checklist_fases),
            updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING id, fase_atual, checklist_fases`,
        [faseAtual, checklistFases ? JSON.stringify(checklistFases) : null, req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/codigo-externo", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [p] } = await pool.query(
        `SELECT id, codigo_externo FROM projects WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!p) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json({ codigoExterno: p.codigo_externo });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/projects/:id/codigo-externo", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { codigoExterno } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE projects SET codigo_externo = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 RETURNING id, codigo_externo`,
        [codigoExterno ?? null, req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Projeto não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/billing-blockers", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { status = "aberto" } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM project_billing_blockers WHERE project_id = $1 AND status = $2
         ORDER BY data_evento DESC`,
        [req.params.id, status]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/billing-blockers", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { tipo, descricao, impactoValor, dataEvento, observacoes } = req.body;
    if (!tipo || !descricao) return res.status(400).json({ error: "tipo e descricao obrigatórios" });
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_billing_blockers
          (project_id, tenant_id, tipo, descricao, impacto_valor, data_evento, observacoes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.params.id, tenantId, tipo, descricao, impactoValor ?? null,
         dataEvento ?? new Date().toISOString().split("T")[0], observacoes ?? null, userId]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/billing-blockers/:blockerId/resolve", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { observacoes } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE project_billing_blockers
        SET status = 'resolvido', resolvido_em = NOW(), resolvido_por = $1,
            observacoes = COALESCE($2, observacoes), updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [userId, observacoes ?? null, req.params.blockerId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Bloqueador não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/task-dependencies", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT d.*, t.title AS task_title, dep.title AS depends_on_title, dep.status AS depends_on_status
         FROM project_task_dependencies d
         JOIN project_tasks t   ON t.id = d.task_id
         JOIN project_tasks dep ON dep.id = d.depends_on_id
         WHERE t.project_id = $1 AND d.tenant_id = $2`,
        [req.params.id, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/tasks/:taskId/dependencies", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { dependsOnId } = req.body;
    if (!dependsOnId) return res.status(400).json({ error: "dependsOnId obrigatório" });
    if (dependsOnId === req.params.taskId) {
      return res.status(400).json({ error: "Tarefa não pode depender de si mesma" });
    }
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_task_dependencies (task_id, depends_on_id, tenant_id)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,
        [req.params.taskId, dependsOnId, tenantId]
      );
      res.status(201).json(rows[0] ?? { message: "Dependência já existe" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hub/tasks/:taskId/dependencies/:dependsOnId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      await pool.query(
        `DELETE FROM project_task_dependencies WHERE task_id = $1 AND depends_on_id = $2 AND tenant_id = $3`,
        [req.params.taskId, req.params.dependsOnId, tenantId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/migrate", ...auth, async (req, res) => {
    const results: any = {};
    const run = async (name: string, fn: () => Promise<any>) => {
      try { results[name] = await fn(); }
      catch (e: any) { results[name] = { ok: false, error: e.message }; }
    };
    await run("hub01",    runHubMigration);
    await run("hub02",    runHub02Migration);
    await run("hub03",    runHub03Migration);
    await run("hub04",    runHub04Migration);
    await run("hub05",    runHub05Migration);
    await run("hub06",    runHub06Migration);
    await run("hub07",    runHub07Migration);
    await run("dep01",    runDep01Migration);
    await run("proj01",   runProjPriority);
    await run("timer01",  runTimer01Migration);
    await run("imp01",    runMigrationHubImp01);
    res.json(results);
  });
}
