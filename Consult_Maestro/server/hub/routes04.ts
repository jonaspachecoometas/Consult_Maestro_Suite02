import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runHub04Migration } from "./migration04";
import {
  gerarLancamentoReceber,
  resolveClienteControlId,
  findOrCreateClienteByNome,
} from "../control/arService";

const auth = [isAuthenticated, requireTenant] as const;

const contractSchema = z.object({
  contractNumber:  z.string().optional().nullable(),
  contractType:    z.string().default("servicos"),
  title:           z.string().optional().nullable(),
  clientId:        z.string().optional().nullable(),
  clientName:      z.string().optional().nullable(),
  contractValue:   z.number().optional().nullable(),
  currency:        z.string().default("BRL"),
  startDate:       z.string().optional().nullable(),
  endDate:         z.string().optional().nullable(),
  status:          z.enum(["rascunho","ativo","suspenso","concluido","cancelado"]).optional(),
  paymentTerms:    z.string().optional().nullable(),
  notes:           z.string().optional().nullable(),
  amendments:      z.array(z.any()).optional(),
  attachments:     z.array(z.any()).optional(),
});

const milestoneSchema = z.object({
  title:         z.string().min(1),
  description:   z.string().optional().nullable(),
  amount:        z.number().positive(),
  percentage:    z.number().optional().nullable(),
  dueDate:       z.string().optional().nullable(),
  status:        z.enum(["pendente","atingido","faturado","pago"]).optional(),
  nfseRequired:  z.boolean().optional(),
  conditions:    z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
});

async function gerarARParaMarco(params: {
  marco: any;
  projeto: any;
  tenantId: string;
  userId: string;
}) {
  const { marco, projeto, tenantId, userId } = params;
  let clienteControlId = await resolveClienteControlId(marco.client_id ?? projeto.client_id ?? null, tenantId);
  if (!clienteControlId && (marco.client_name ?? projeto.client_name)) {
    clienteControlId = await findOrCreateClienteByNome(
      marco.client_name ?? projeto.client_name, tenantId
    );
  }
  const lancamento = await gerarLancamentoReceber({
    tenantId,
    clienteControlId,
    valor: marco.amount,
    descricao: `Marco: ${marco.title} — Projeto ${projeto.project_code}`,
    vencimento: marco.due_date ?? new Date().toISOString().split("T")[0],
    projetoId: projeto.id,
    referenciaId: marco.id,
    referenciaTabela: "project_billing_milestones",
    criadoPor: userId,
  });
  return lancamento;
}

async function gerarFiscalEvent(params: {
  projectId: string;
  contractId: string;
  milestoneId: string;
  amount: number;
  description: string;
  dueDate: string | null;
  tenantId: string;
  userId: string;
  serviceCode?: string;
}) {
  const { rows } = await pool.query(`
    INSERT INTO project_fiscal_events (
      project_id, contract_id, milestone_id, tenant_id, event_type,
      service_description, iss_service_code, gross_amount, status,
      emission_due_date, created_by
    ) VALUES ($1,$2,$3,$4,'nfse',$5,$6,$7,'pendente',$8,$9)
    RETURNING *`,
    [
      params.projectId, params.contractId, params.milestoneId,
      params.tenantId, params.description,
      params.serviceCode ?? "17.20", params.amount,
      params.dueDate, params.userId,
    ]
  );
  return rows[0];
}

export function registerHub04Routes(app: Express) {

  app.post("/api/hub/migrate04", ...auth, async (req, res) => {
    const result = await runHub04Migration();
    res.json(result);
  });

  app.get("/api/hub/projects/:id/contracts", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT c.*,
           (SELECT json_agg(m ORDER BY m.due_date NULLS LAST)
            FROM project_billing_milestones m WHERE m.contract_id = c.id
           ) AS milestones,
           (SELECT COALESCE(SUM(m.amount),0)
            FROM project_billing_milestones m WHERE m.contract_id = c.id AND m.status = 'pago'
           ) AS received_amount
         FROM project_contracts c
         WHERE c.project_id = $1 AND c.tenant_id = $2
         ORDER BY c.created_at`,
        [req.params.id, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/projects/:id/contracts", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const parsed = contractSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO project_contracts (
          project_id, tenant_id, contract_number, contract_type, title,
          client_id, client_name, contract_value, currency,
          start_date, end_date, status, payment_terms, notes,
          amendments, attachments, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          req.params.id, tenantId, d.contractNumber ?? null, d.contractType,
          d.title ?? null, d.clientId ?? null, d.clientName ?? null,
          d.contractValue ?? null, d.currency,
          d.startDate ?? null, d.endDate ?? null, d.status ?? "rascunho",
          d.paymentTerms ?? null, d.notes ?? null,
          JSON.stringify(d.amendments ?? []), JSON.stringify(d.attachments ?? []),
          userId,
        ]
      );
      if (d.contractValue != null) {
        await pool.query(
          `UPDATE projects SET contract_value = $1, updated_at = NOW() WHERE id = $2`,
          [d.contractValue, req.params.id]
        );
      }
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/contracts/:contractId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = contractSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      contract_number: d.contractNumber, contract_type: d.contractType,
      title: d.title, client_id: d.clientId, client_name: d.clientName,
      contract_value: d.contractValue, currency: d.currency,
      start_date: d.startDate, end_date: d.endDate,
      status: d.status, payment_terms: d.paymentTerms, notes: d.notes,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.contractId, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE project_contracts SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Contrato não encontrado" });
      if (d.contractValue != null) {
        await pool.query(
          `UPDATE projects SET contract_value = $1, updated_at = NOW() WHERE id = $2`,
          [d.contractValue, rows[0].project_id]
        );
      }
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/contracts/:contractId/milestones", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT m.*,
           (SELECT json_agg(fe) FROM project_fiscal_events fe WHERE fe.milestone_id = m.id
           ) AS fiscal_events
         FROM project_billing_milestones m
         WHERE m.contract_id = $1 AND m.tenant_id = $2
         ORDER BY m.due_date NULLS LAST, m.created_at`,
        [req.params.contractId, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/contracts/:contractId/milestones", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const parsed = milestoneSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows: c } = await pool.query(
        `SELECT project_id FROM project_contracts WHERE id = $1 AND tenant_id = $2`,
        [req.params.contractId, tenantId]
      );
      if (!c[0]) return res.status(404).json({ error: "Contrato não encontrado" });
      const { rows } = await pool.query(`
        INSERT INTO project_billing_milestones (
          project_id, contract_id, tenant_id, title, description,
          amount, percentage, due_date, status, nfse_required,
          conditions, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          c[0].project_id, req.params.contractId, tenantId,
          d.title, d.description ?? null, d.amount,
          d.percentage ?? null, d.dueDate ?? null, d.status ?? "pendente",
          d.nfseRequired ?? false, d.conditions ?? null, d.notes ?? null, userId,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/milestones/:milestoneId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = milestoneSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      title: d.title, description: d.description, amount: d.amount,
      percentage: d.percentage, due_date: d.dueDate, status: d.status,
      nfse_required: d.nfseRequired, conditions: d.conditions, notes: d.notes,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.milestoneId, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE project_billing_milestones SET ${fields.join(",")}
         WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Marco não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/milestones/:milestoneId/accept", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows: [marco] } = await pool.query(
        `SELECT m.*, c.project_id, c.client_id, c.client_name, c.contract_value, c.id AS contract_id
         FROM project_billing_milestones m
         JOIN project_contracts c ON c.id = m.contract_id
         WHERE m.id = $1 AND m.tenant_id = $2`,
        [req.params.milestoneId, tenantId]
      );
      if (!marco) return res.status(404).json({ error: "Marco não encontrado" });

      const { rows: [proj] } = await pool.query(
        `SELECT id, project_code, title, client_id, client_name FROM projects WHERE id = $1`,
        [marco.project_id]
      );

      await pool.query(
        `UPDATE project_billing_milestones SET status = 'atingido', accepted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [req.params.milestoneId]
      );

      let lancamento = null;
      try {
        lancamento = await gerarARParaMarco({ marco, projeto: proj, tenantId, userId });
        await pool.query(
          `UPDATE project_billing_milestones SET ar_lancamento_id = $1 WHERE id = $2`,
          [lancamento?.id ?? null, req.params.milestoneId]
        );
      } catch (arErr: any) {
        console.error("[HUB] gerarARParaMarco erro:", arErr.message);
      }

      let fiscalEvent = null;
      if (marco.nfse_required) {
        try {
          fiscalEvent = await gerarFiscalEvent({
            projectId:   proj.id,
            contractId:  marco.contract_id,
            milestoneId: req.params.milestoneId,
            amount:      marco.amount,
            description: `NFS-e — ${marco.title} — Projeto ${proj.project_code}`,
            dueDate:     marco.due_date,
            tenantId,
            userId,
          });
        } catch (feErr: any) {
          console.error("[HUB] gerarFiscalEvent erro:", feErr.message);
        }
      }

      res.json({ ok: true, lancamento, fiscalEvent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/milestones/:milestoneId/receive", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { receivedAt, notes } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE project_billing_milestones
        SET status = 'pago', received_at = $1, notes = COALESCE($2, notes), updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [receivedAt ?? new Date(), notes ?? null, req.params.milestoneId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Marco não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/fiscal-events", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT fe.*,
           c.contract_number, c.client_name,
           m.title AS milestone_title
         FROM project_fiscal_events fe
         LEFT JOIN project_contracts c ON c.id = fe.contract_id
         LEFT JOIN project_billing_milestones m ON m.id = fe.milestone_id
         WHERE fe.project_id = $1 AND fe.tenant_id = $2
         ORDER BY fe.emission_due_date NULLS LAST, fe.created_at DESC`,
        [req.params.id, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/fiscal-events/:eventId/approve", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows } = await pool.query(`
        UPDATE project_fiscal_events
        SET status = 'aprovado', approved_by = $1, approved_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [userId, req.params.eventId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Evento não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
