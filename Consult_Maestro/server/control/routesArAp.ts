/**
 * CONTROL-MERGE — routesArAp.ts
 * Rotas de Contas a Receber (AR) e a Pagar (AP).
 */

import type { Express } from 'express';
import { isAuthenticated } from '../portableAuth';
import { requireTenant } from '../tenantContext';
import { pool } from '../db';

export function registerControlArApRoutes(app: Express) {

  // ─── Contas Bancárias ──────────────────────────────────────────────────────

  app.get('/api/control/contas-bancarias', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM fin_bank_accounts WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
        [req.tenantId]
      );
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/control/contas-bancarias', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { code, name, bank_code, bank_name, agency, account_number, account_digit, account_type, initial_balance, notes } = req.body;
      if (!code || !name) return res.status(400).json({ error: 'code e name são obrigatórios.' });
      const { rows } = await pool.query(
        `INSERT INTO fin_bank_accounts (tenant_id, code, name, bank_code, bank_name, agency, account_number, account_digit, account_type, initial_balance, current_balance, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11) RETURNING *`,
        [req.tenantId, code, name, bank_code ?? null, bank_name ?? null, agency ?? null, account_number ?? null, account_digit ?? null, account_type ?? 'checking', initial_balance ?? 0, notes ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'Conta com este código já existe.' });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Contas a Receber ──────────────────────────────────────────────────────

  app.get('/api/control/contas-receber', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { status, pessoa_id, page = '1', limit = '50' } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params: any[] = [req.tenantId, parseInt(limit), offset];
      let where = 'WHERE tenant_id = $1';
      if (status) { where += ` AND status = $${params.length + 1}`; params.push(status); }
      if (pessoa_id) { where += ` AND pessoa_id = $${params.length + 1}`; params.push(pessoa_id); }

      const { rows } = await pool.query(
        `SELECT ar.*, p.nome_fantasia AS pessoa_nome
         FROM fin_accounts_receivable ar
         LEFT JOIN pessoas p ON p.id = ar.pessoa_id
         ${where}
         ORDER BY ar.due_date ASC
         LIMIT $2 OFFSET $3`,
        params
      );
      const { rows: count } = await pool.query(
        `SELECT COUNT(*) AS total FROM fin_accounts_receivable ${where}`,
        params.slice(0, -2)
      );
      res.json({ data: rows, total: parseInt(count[0]?.total ?? '0'), page: parseInt(page), limit: parseInt(limit) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/control/contas-receber/:id', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM fin_accounts_receivable WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Conta a receber não encontrada.' });
      res.json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/control/contas-receber', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { pessoa_id, customer_name, description, issue_date, due_date, original_amount, categoria_id, origem_ref_tipo, origem_ref_id, empresa_id, notes } = req.body;
      if (!due_date || !original_amount) return res.status(400).json({ error: 'due_date e original_amount são obrigatórios.' });
      const { rows } = await pool.query(
        `INSERT INTO fin_accounts_receivable
           (tenant_id, empresa_id, pessoa_id, customer_name, description, issue_date, due_date,
            original_amount, remaining_amount, category_id, origem_ref_tipo, origem_ref_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12) RETURNING *`,
        [req.tenantId, empresa_id ?? null, pessoa_id ?? null, customer_name ?? null, description ?? null,
          issue_date ?? new Date().toISOString().split('T')[0], due_date, original_amount, categoria_id ?? null,
          origem_ref_tipo ?? 'manual', origem_ref_id ?? null, notes ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/control/contas-receber/:id/baixar', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { valor_recebido, data_recebimento, bank_account_id } = req.body;
      if (!valor_recebido) return res.status(400).json({ error: 'valor_recebido é obrigatório.' });
      const { rows } = await pool.query(
        `UPDATE fin_accounts_receivable
         SET received_amount = received_amount + $3,
             remaining_amount = GREATEST(0, remaining_amount - $3),
             received_at = $4,
             bank_account_id = COALESCE($5, bank_account_id),
             status = CASE WHEN remaining_amount - $3 <= 0.01 THEN 'received' ELSE 'partial' END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('received','cancelled')
         RETURNING *`,
        [req.params.id, req.tenantId, valor_recebido, data_recebimento ?? new Date().toISOString().split('T')[0], bank_account_id ?? null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada ou já baixada.' });
      res.json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Contas a Pagar ────────────────────────────────────────────────────────

  app.get('/api/control/contas-pagar', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { status, pessoa_id, page = '1', limit = '50' } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params: any[] = [req.tenantId, parseInt(limit), offset];
      let where = 'WHERE tenant_id = $1';
      if (status) { where += ` AND status = $${params.length + 1}`; params.push(status); }
      if (pessoa_id) { where += ` AND pessoa_id = $${params.length + 1}`; params.push(pessoa_id); }

      const { rows } = await pool.query(
        `SELECT ap.*, p.nome_fantasia AS pessoa_nome
         FROM fin_accounts_payable ap
         LEFT JOIN pessoas p ON p.id = ap.pessoa_id
         ${where}
         ORDER BY ap.due_date ASC
         LIMIT $2 OFFSET $3`,
        params
      );
      res.json({ data: rows, page: parseInt(page), limit: parseInt(limit) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/control/contas-pagar', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { pessoa_id, supplier_name, description, issue_date, due_date, original_amount, categoria_id, origem_ref_tipo, origem_ref_id, empresa_id, notes } = req.body;
      if (!due_date || !original_amount) return res.status(400).json({ error: 'due_date e original_amount são obrigatórios.' });
      const { rows } = await pool.query(
        `INSERT INTO fin_accounts_payable
           (tenant_id, empresa_id, pessoa_id, supplier_name, description, issue_date, due_date,
            original_amount, remaining_amount, category_id, origem_ref_tipo, origem_ref_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12) RETURNING *`,
        [req.tenantId, empresa_id ?? null, pessoa_id ?? null, supplier_name ?? null, description ?? null,
          issue_date ?? new Date().toISOString().split('T')[0], due_date, original_amount, categoria_id ?? null,
          origem_ref_tipo ?? 'manual', origem_ref_id ?? null, notes ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/control/contas-pagar/:id/baixar', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { valor_pago, data_pagamento, bank_account_id } = req.body;
      if (!valor_pago) return res.status(400).json({ error: 'valor_pago é obrigatório.' });
      const { rows } = await pool.query(
        `UPDATE fin_accounts_payable
         SET paid_amount = paid_amount + $3,
             remaining_amount = GREATEST(0, remaining_amount - $3),
             paid_at = $4,
             bank_account_id = COALESCE($5, bank_account_id),
             status = CASE WHEN remaining_amount - $3 <= 0.01 THEN 'paid' ELSE 'partial' END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status NOT IN ('paid','cancelled')
         RETURNING *`,
        [req.params.id, req.tenantId, valor_pago, data_pagamento ?? new Date().toISOString().split('T')[0], bank_account_id ?? null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Conta não encontrada ou já baixada.' });
      res.json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
