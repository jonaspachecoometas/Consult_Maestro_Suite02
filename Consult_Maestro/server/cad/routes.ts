/**
 * CAD-01 — registerCad01Routes
 * CRUD de Produtos Fiscais, Emitentes, Tabelas de Preço e Condições de Pagamento.
 */

import type { Express } from 'express';
import { isAuthenticated } from '../portableAuth';
import { requireTenant } from '../tenantContext';
import { soeContextFromReq } from '../soe';
import {
  criarProdutoFiscal, buscarProdutoFiscal, resolverPreco, gerarParcelas,
  criarOuAtualizarEmitente, buscarEmitente, proximoNumeroFiscal,
} from './cadService';
import { pool } from '../db';

export function registerCad01Routes(app: Express) {

  // ─── PRODUTO FISCAL ────────────────────────────────────────────────────────

  app.get('/api/cad/produtos', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { status = 'ativo', q, ncm, categoria, page = '1', limit = '50' } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params: any[] = [req.tenantId, parseInt(limit), offset];
      let where = 'WHERE tenant_id = $1';
      if (status !== 'todos') { where += ` AND status = $${params.length + 1}`; params.push(status); }
      if (q) { where += ` AND (codigo ILIKE $${params.length + 1} OR descricao ILIKE $${params.length + 1})`; params.push(`%${q}%`); }
      if (ncm) { where += ` AND ncm = $${params.length + 1}`; params.push(ncm.replace(/\D/g, '')); }
      if (categoria) { where += ` AND categoria = $${params.length + 1}`; params.push(categoria); }

      const { rows } = await pool.query(
        `SELECT *, COUNT(*) OVER () AS total_count
         FROM produto_fiscal ${where}
         ORDER BY descricao ASC
         LIMIT $2 OFFSET $3`,
        params
      );
      const total = rows[0]?.total_count ?? 0;
      res.json({ data: rows, total: parseInt(total), page: parseInt(page), limit: parseInt(limit) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/cad/produtos/:id', isAuthenticated, requireTenant, async (req: any, res) => {
    const result = await buscarProdutoFiscal(req.tenantId, req.params.id);
    if (!result.ok) return res.status(result.code === 'NOT_FOUND' ? 404 : 400).json({ error: result.error });
    res.json(result.value);
  });

  app.post('/api/cad/produtos', isAuthenticated, requireTenant, async (req: any, res) => {
    const ctx = soeContextFromReq(req);
    const result = await criarProdutoFiscal(ctx, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });
    res.status(201).json(result.value);
  });

  app.patch('/api/cad/produtos/:id', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const allowed = [
        'descricao', 'descricao_nfe', 'unidade', 'ncm', 'cest', 'origem',
        'grupo_tributacao_id', 'controla_lote', 'controla_serial',
        'preco_venda_base', 'preco_custo', 'estoque_minimo', 'estoque_maximo',
        'ponto_reposicao', 'categoria', 'subcategoria', 'marca', 'modelo',
        'status', 'externo_id_plus', 'externo_id_erp',
      ];
      const sets: string[] = [];
      const params: any[] = [req.params.id, req.tenantId];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          params.push(req.body[key]);
          sets.push(`${key} = $${params.length}`);
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
      sets.push(`updated_at = NOW()`, `updated_by_id = '${req.user?.id ?? ''}'`);

      const { rowCount } = await pool.query(
        `UPDATE produto_fiscal SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`,
        params
      );
      if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
      const updated = await buscarProdutoFiscal(req.tenantId, req.params.id);
      res.json(updated.ok ? updated.value : { id: req.params.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tributação por UF
  app.get('/api/cad/produtos/:id/tributacao-uf', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ptu.* FROM produto_fiscal_tributacao_uf ptu
         JOIN produto_fiscal pf ON pf.id = ptu.produto_fiscal_id
         WHERE ptu.produto_fiscal_id = $1 AND pf.tenant_id = $2
         ORDER BY uf_destino`,
        [req.params.id, req.tenantId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/cad/produtos/:id/tributacao-uf/:uf', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { uf } = req.params;
      const body = req.body;
      const { rows } = await pool.query(
        `INSERT INTO produto_fiscal_tributacao_uf
           (tenant_id, produto_fiscal_id, uf_destino, cfop_saida, cfop_entrada,
            cst_csosn, perc_icms, perc_red_bc, perc_mva_st, perc_icms_st, observacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (produto_fiscal_id, uf_destino) WHERE vigencia_fim IS NULL
         DO UPDATE SET
           cfop_saida = EXCLUDED.cfop_saida, cfop_entrada = EXCLUDED.cfop_entrada,
           cst_csosn = EXCLUDED.cst_csosn, perc_icms = EXCLUDED.perc_icms,
           perc_red_bc = EXCLUDED.perc_red_bc, perc_mva_st = EXCLUDED.perc_mva_st,
           perc_icms_st = EXCLUDED.perc_icms_st, observacao = EXCLUDED.observacao
         RETURNING *`,
        [
          req.tenantId, req.params.id, uf.toUpperCase(),
          body.cfopSaida ?? body.cfop_saida ?? null,
          body.cfopEntrada ?? body.cfop_entrada ?? null,
          body.cstCsosn ?? body.cst_csosn ?? null,
          body.percIcms ?? body.perc_icms ?? 0,
          body.percRedBc ?? body.perc_red_bc ?? 0,
          body.percMvaSt ?? body.perc_mva_st ?? 0,
          body.percIcmsSt ?? body.perc_icms_st ?? 0,
          body.observacao ?? null,
        ]
      );
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── EMITENTE FISCAL ───────────────────────────────────────────────────────

  app.get('/api/cad/emitentes', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ef.*, te.nome_fantasia AS empresa_nome
         FROM emitentes_fiscal ef
         LEFT JOIN tenant_empresas te ON te.id = ef.empresa_id
         WHERE ef.tenant_id = $1 AND ef.status = 'ativo'
         ORDER BY ef.razao_social`,
        [req.tenantId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/cad/emitentes/empresa/:empresaId', isAuthenticated, requireTenant, async (req: any, res) => {
    const result = await buscarEmitente(req.tenantId, parseInt(req.params.empresaId));
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result.value);
  });

  app.post('/api/cad/emitentes', isAuthenticated, requireTenant, async (req: any, res) => {
    const ctx = soeContextFromReq(req);
    const result = await criarOuAtualizarEmitente(ctx, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });
    res.status(201).json(result.value);
  });

  app.get('/api/cad/emitentes/empresa/:empresaId/proximo-numero/:tipo', isAuthenticated, requireTenant, async (req: any, res) => {
    const tipo = req.params.tipo as 'nfe' | 'nfce' | 'nfse';
    const result = await proximoNumeroFiscal(req.tenantId, parseInt(req.params.empresaId), tipo);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result.value);
  });

  // ─── TABELAS DE PREÇO ──────────────────────────────────────────────────────

  app.get('/api/cad/tabelas-preco', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM soe_tabelas_preco
         WHERE tenant_id = $1 AND status = 'ativo'
         ORDER BY padrao DESC, nome ASC`,
        [req.tenantId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/cad/tabelas-preco', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { codigo, nome, descricao, tipo_cliente, canal_venda, desconto_perc, markup_perc, vigencia_inicio, vigencia_fim, tabela_pai_id, padrao } = req.body;
      if (!codigo || !nome) return res.status(400).json({ error: 'codigo e nome são obrigatórios.' });
      const { rows } = await pool.query(
        `INSERT INTO soe_tabelas_preco
           (tenant_id, codigo, nome, descricao, tipo_cliente, canal_venda,
            desconto_perc, markup_perc, vigencia_inicio, vigencia_fim, tabela_pai_id, padrao,
            created_by_id, updated_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING *`,
        [
          req.tenantId, codigo.toUpperCase(), nome,
          descricao ?? null, tipo_cliente ?? null, canal_venda ?? null,
          desconto_perc ?? 0, markup_perc ?? 0,
          vigencia_inicio ?? null, vigencia_fim ?? null,
          tabela_pai_id ?? null, padrao ?? false,
          req.user?.id ?? null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: `Tabela com código já existe.` });
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/cad/tabelas-preco/:id', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const allowed = ['nome', 'descricao', 'tipo_cliente', 'canal_venda', 'desconto_perc', 'markup_perc', 'vigencia_inicio', 'vigencia_fim', 'padrao', 'status'];
      const sets: string[] = [];
      const params: any[] = [req.params.id, req.tenantId];
      for (const key of allowed) {
        if (req.body[key] !== undefined) { params.push(req.body[key]); sets.push(`${key} = $${params.length}`); }
      }
      if (!sets.length) return res.status(400).json({ error: 'Nenhum campo válido.' });
      sets.push('updated_at = NOW()');
      const { rowCount } = await pool.query(
        `UPDATE soe_tabelas_preco SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`, params
      );
      if (!rowCount) return res.status(404).json({ error: 'Tabela não encontrada.' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Itens de tabela de preço
  app.get('/api/cad/tabelas-preco/:id/itens', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT pti.*, pf.codigo, pf.descricao
         FROM soe_tabela_preco_itens pti
         LEFT JOIN produto_fiscal pf ON pf.id = pti.produto_fiscal_id
         WHERE pti.tabela_preco_id = $1
         ORDER BY pf.descricao NULLS LAST`,
        [req.params.id]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/cad/tabelas-preco/:id/itens', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { produto_fiscal_id, product_id, preco_unitario, desconto_perc, markup_perc, unidade, quantidade_minima, vigencia_inicio, vigencia_fim } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO soe_tabela_preco_itens
           (tabela_preco_id, produto_fiscal_id, product_id, preco_unitario, desconto_perc, markup_perc, unidade, quantidade_minima, vigencia_inicio, vigencia_fim)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.id, produto_fiscal_id ?? null, product_id ?? null,
          preco_unitario ?? null, desconto_perc ?? null, markup_perc ?? null,
          unidade ?? null, quantidade_minima ?? 1, vigencia_inicio ?? null, vigencia_fim ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'Item já existe nesta tabela.' });
      res.status(500).json({ error: e.message });
    }
  });

  // Resolver preço
  app.post('/api/cad/resolver-preco', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const result = await resolverPreco({ tenantId: req.tenantId, ...req.body });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── CONDIÇÕES DE PAGAMENTO ────────────────────────────────────────────────

  app.get('/api/cad/condicoes-pagamento', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT cp.*, COALESCE(
           json_agg(p ORDER BY p.sequencia) FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS parcelas
         FROM soe_condicoes_pagamento cp
         LEFT JOIN soe_condicao_parcelas p ON p.condicao_pagamento_id = cp.id
         WHERE cp.tenant_id = $1 AND cp.status = 'ativo'
         GROUP BY cp.id
         ORDER BY cp.padrao DESC, cp.nome ASC`,
        [req.tenantId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/cad/condicoes-pagamento', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { codigo, nome, tipo = 'parcelado', acrescimo_perc, desconto_perc, dias_vencimento, formas_aceitas, padrao, parcelas = [] } = req.body;
      if (!codigo || !nome) return res.status(400).json({ error: 'codigo e nome são obrigatórios.' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO soe_condicoes_pagamento
             (tenant_id, codigo, nome, tipo, acrescimo_perc, desconto_perc,
              dias_vencimento, formas_aceitas, padrao, created_by_id, updated_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
          [req.tenantId, codigo, nome, tipo, acrescimo_perc ?? 0, desconto_perc ?? 0,
            dias_vencimento ?? 0, formas_aceitas ?? ['01', '15', '17'], padrao ?? false, req.user?.id ?? null]
        );
        const cid = rows[0].id;
        for (const p of parcelas) {
          await client.query(
            `INSERT INTO soe_condicao_parcelas (condicao_pagamento_id, sequencia, dias, percentual, forma_pagamento, descricao)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [cid, p.sequencia, p.dias, p.percentual, p.forma_pagamento ?? null, p.descricao ?? null]
          );
        }
        await client.query('COMMIT');
        res.status(201).json(rows[0]);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'Condição com este código já existe.' });
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/cad/condicoes-pagamento/:id', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const allowed = ['nome', 'tipo', 'acrescimo_perc', 'desconto_perc', 'dias_vencimento', 'formas_aceitas', 'padrao', 'status'];
      const sets: string[] = [];
      const params: any[] = [req.params.id, req.tenantId];
      for (const key of allowed) {
        if (req.body[key] !== undefined) { params.push(req.body[key]); sets.push(`${key} = $${params.length}`); }
      }
      if (!sets.length) return res.status(400).json({ error: 'Nenhum campo válido.' });
      sets.push('updated_at = NOW()');
      const { rowCount } = await pool.query(
        `UPDATE soe_condicoes_pagamento SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`, params
      );
      if (!rowCount) return res.status(404).json({ error: 'Condição não encontrada.' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Gerar parcelas
  app.post('/api/cad/condicoes-pagamento/:id/gerar-parcelas', isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { total, data_base } = req.body;
      if (!total) return res.status(400).json({ error: 'total é obrigatório.' });
      const dataBase = data_base ? new Date(data_base) : undefined;
      const result = await gerarParcelas(req.tenantId, req.params.id, parseFloat(total), dataBase);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
