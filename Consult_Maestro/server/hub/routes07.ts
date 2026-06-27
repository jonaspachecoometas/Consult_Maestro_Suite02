import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runHub07Migration } from "./migration07";

const auth = [isAuthenticated, requireTenant] as const;

const templateSchema = z.object({
  projectType: z.string().optional().nullable(),
  formType:    z.string().min(1),
  label:       z.string().min(1),
  icon:        z.string().optional().nullable(),
  fields:      z.array(z.any()).default([]),
  active:      z.boolean().optional(),
});

const recordSchema = z.object({
  wbsNodeId:      z.string().optional().nullable(),
  taskId:         z.string().optional().nullable(),
  formType:       z.string().min(1),
  collectedBy:    z.string().optional().nullable(),
  collectedByName:z.string().optional().nullable(),
  collectedAt:    z.string().optional().nullable(),
  latitude:       z.number().optional().nullable(),
  longitude:      z.number().optional().nullable(),
  locationName:   z.string().optional().nullable(),
  fieldData:      z.record(z.any()).default({}),
  attachments:    z.array(z.any()).optional(),
  status:         z.enum(["rascunho","submetido","revisado","aprovado","rejeitado"]).optional(),
  pointId:        z.string().optional().nullable(),
  sequenceNumber: z.number().optional().nullable(),
  notes:          z.string().optional().nullable(),
});

export function registerHub07Routes(app: Express) {

  app.post("/api/hub/migrate07", ...auth, async (req, res) => {
    const result = await runHub07Migration();
    res.json(result);
  });

  app.get("/api/hub/form-templates", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { projectType, active } = req.query;
    const conditions = ["(tenant_id = $1 OR tenant_id = 'global')"];
    const params: any[] = [tenantId];
    let i = 2;
    if (projectType) { conditions.push(`(project_type = $${i} OR project_type IS NULL)`); params.push(projectType); i++; }
    if (active !== undefined) { conditions.push(`active = $${i}`); params.push(active === "true"); i++; }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM project_form_templates WHERE ${conditions.join(" AND ")} ORDER BY label`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/form-templates/:formType", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM project_form_templates
         WHERE form_type = $1 AND (tenant_id = $2 OR tenant_id = 'global')
         ORDER BY CASE WHEN tenant_id = $2 THEN 0 ELSE 1 END LIMIT 1`,
        [req.params.formType, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Template não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/form-templates", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_form_templates (tenant_id, project_type, form_type, label, icon, fields, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (form_type) DO UPDATE
        SET label = EXCLUDED.label, icon = EXCLUDED.icon, fields = EXCLUDED.fields,
            project_type = EXCLUDED.project_type, active = EXCLUDED.active
        RETURNING *`,
        [tenantId, d.projectType ?? null, d.formType, d.label, d.icon ?? null,
         JSON.stringify(d.fields), d.active ?? true]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/field-records", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { formType, status, collectedBy, from, to } = req.query;
    const conditions = ["r.project_id = $1", "r.tenant_id = $2"];
    const params: any[] = [req.params.id, tenantId];
    let i = 3;
    if (formType)    { conditions.push(`r.form_type = $${i}`);      params.push(formType);    i++; }
    if (status)      { conditions.push(`r.status = $${i}`);         params.push(status);      i++; }
    if (collectedBy) { conditions.push(`r.collected_by = $${i}`);   params.push(collectedBy); i++; }
    if (from)        { conditions.push(`r.collected_at >= $${i}`);  params.push(from);        i++; }
    if (to)          { conditions.push(`r.collected_at <= $${i}`);  params.push(to);          i++; }
    try {
      const { rows } = await pool.query(
        `SELECT r.*, w.title AS wbs_title, w.code AS wbs_code, t.title AS task_title
         FROM project_field_records r
         LEFT JOIN project_wbs_nodes w ON w.id = r.wbs_node_id
         LEFT JOIN project_tasks t ON t.id = r.task_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY r.collected_at DESC NULLS LAST, r.created_at DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/field-records", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_field_records (
          project_id, tenant_id, wbs_node_id, task_id, form_type,
          collected_by, collected_by_name, collected_at,
          latitude, longitude, location_name,
          field_data, attachments, status, point_id, sequence_number, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          req.params.id, tenantId, d.wbsNodeId ?? null, d.taskId ?? null, d.formType,
          d.collectedBy ?? userId, d.collectedByName ?? null,
          d.collectedAt ? new Date(d.collectedAt) : new Date(),
          d.latitude ?? null, d.longitude ?? null, d.locationName ?? null,
          JSON.stringify(d.fieldData), JSON.stringify(d.attachments ?? []),
          d.status ?? "rascunho", d.pointId ?? null, d.sequenceNumber ?? null, d.notes ?? null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/field-records/:recordId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = recordSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      wbs_node_id: d.wbsNodeId, task_id: d.taskId, form_type: d.formType,
      collected_by: d.collectedBy, collected_by_name: d.collectedByName,
      collected_at: d.collectedAt, latitude: d.latitude, longitude: d.longitude,
      location_name: d.locationName, status: d.status,
      point_id: d.pointId, sequence_number: d.sequenceNumber, notes: d.notes,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (d.fieldData !== undefined) {
      fields.push(`field_data = $${i}`); params.push(JSON.stringify(d.fieldData)); i++;
    }
    if (d.attachments !== undefined) {
      fields.push(`attachments = $${i}`); params.push(JSON.stringify(d.attachments)); i++;
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.recordId, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE project_field_records SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Registro não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/hub/field-records/:recordId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      await pool.query(
        `DELETE FROM project_field_records WHERE id = $1 AND tenant_id = $2 AND status = 'rascunho'`,
        [req.params.recordId, tenantId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/field-records/map", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { formType } = req.query;
    const conditions = ["project_id = $1", "tenant_id = $2", "latitude IS NOT NULL"];
    const params: any[] = [req.params.id, tenantId];
    let i = 3;
    if (formType) { conditions.push(`form_type = $${i}`); params.push(formType); i++; }
    try {
      const { rows } = await pool.query(
        `SELECT id, form_type, collected_at, latitude, longitude, location_name,
           point_id, status, collected_by_name,
           field_data->'ponto' AS ponto_id,
           field_data->'litologia' AS litologia
         FROM project_field_records
         WHERE ${conditions.join(" AND ")}
         ORDER BY collected_at DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/field-records/:recordId/submit", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(`
        UPDATE project_field_records
        SET status = 'submetido', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'rascunho' RETURNING *`,
        [req.params.recordId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Registro não encontrado ou já submetido" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/field-records/:recordId/review", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { action, notes } = req.body as { action: "approve" | "reject"; notes?: string };
    if (!["approve","reject"].includes(action)) {
      return res.status(400).json({ error: "action deve ser 'approve' ou 'reject'" });
    }
    const newStatus = action === "approve" ? "aprovado" : "rejeitado";
    try {
      const { rows } = await pool.query(`
        UPDATE project_field_records
        SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3, updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5 AND status = 'submetido' RETURNING *`,
        [newStatus, userId, notes ?? null, req.params.recordId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Registro não encontrado ou não submetido" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/field-records/:recordId/export", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: [record] } = await pool.query(
        `SELECT r.*, p.project_code, p.title AS project_title,
           ft.fields AS template_fields
         FROM project_field_records r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN project_form_templates ft ON ft.form_type = r.form_type
         WHERE r.id = $1 AND r.tenant_id = $2`,
        [req.params.recordId, tenantId]
      );
      if (!record) return res.status(404).json({ error: "Registro não encontrado" });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
