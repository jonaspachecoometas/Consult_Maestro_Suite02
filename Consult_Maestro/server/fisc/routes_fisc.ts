/**
 * FISC — routes_fisc.ts
 * FISC-01: diagnóstico de pessoas (IE, destinatário NF-e, relatório).
 * FISC-02: validação, emissão, cancelamento, documentos fiscais, dashboard.
 */

import type { Express } from 'express';
import { isAuthenticated } from '../portableAuth';
import { requireTenant } from '../tenantContext';
import { pool } from '../db';
import { runMigrationFisc01, runMigrationFisc02 } from './migration_fisc';
import { FiscalValidator } from './FiscalValidator';
import { fiscalAdapterV2 } from './FiscalAdapterV2';
import { buscarEmitente } from '../cad/cadService';
import { soeContextFromReq } from '../soe/conventions';
import { montarDestinatarioNfe, resolverCamposFiscaisPessoa } from './schema_patch_pessoas';

const auth = [isAuthenticated, requireTenant] as const;
const validator = new FiscalValidator();

export function registerFiscRoutes(app: Express): void {

  // ── Migrations (master only) ──────────────────────────────────────────────

  app.post('/api/fisc/migrate-fisc01', isAuthenticated, async (req: any, res) => {
    if (!req.isMaster) return res.status(403).json({ error: 'master_required' });
    try {
      await runMigrationFisc01();
      res.json({ ok: true, message: 'FISC-01 migration executada.' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/fisc/migrate-fisc02', isAuthenticated, async (req: any, res) => {
    if (!req.isMaster) return res.status(403).json({ error: 'master_required' });
    try {
      await runMigrationFisc02();
      res.json({ ok: true, message: 'FISC-02 migration executada.' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── FISC-01: Diagnóstico de pessoas ──────────────────────────────────────

  app.get('/api/fisc/pessoas-sem-ie', ...auth, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, nome_fantasia, cnpj_cpf, rg_ie, ie, contribuinte
         FROM pessoas
         WHERE tenant_id = $1
           AND tipo_pessoa = 'PJ'
           AND (ie IS NULL OR ie = '')
         ORDER BY nome_fantasia
         LIMIT 200`,
        [req.tenantId]
      );
      res.json({ ok: true, total: rows.length, data: rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/fisc/pessoas/:id/destinatario-nfe', ...auth, async (req: any, res) => {
    try {
      const { rows: [p] } = await pool.query(
        `SELECT p.*,
                e.logradouro, e.numero, e.complemento, e.bairro,
                e.cidade, e.codigo_municipio, e.uf, e.cep, e.pais, e.codigo_pais,
                c_email.valor AS email_principal,
                c_tel.valor   AS telefone_principal
         FROM pessoas p
         LEFT JOIN enderecos e
           ON e.pessoa_id = p.id AND e.tipo = 'principal'
         LEFT JOIN contatos c_email
           ON c_email.pessoa_id = p.id AND c_email.tipo = 'email' AND c_email.is_principal = 1
         LEFT JOIN contatos c_tel
           ON c_tel.pessoa_id = p.id AND c_tel.tipo IN ('telefone','celular') AND c_tel.is_principal = 1
         WHERE p.id = $1 AND p.tenant_id = $2
         LIMIT 1`,
        [req.params.id, req.tenantId]
      );

      if (!p) return res.status(404).json({ ok: false, error: 'Pessoa não encontrada.' });

      const fiscal = resolverCamposFiscaisPessoa({
        tipoPessoa:      p.tipo_pessoa,
        rgIe:            p.rg_ie,
        rg:              p.rg,
        ie:              p.ie,
        contribuinte:    p.contribuinte,
        consumidorFinal: p.consumidor_final,
      });

      const destinatario = montarDestinatarioNfe({
        tipoPessoa:      p.tipo_pessoa,
        nomeFantasia:    p.nome_fantasia,
        razaoSocial:     p.razao_social,
        cnpjCpf:         p.cnpj_cpf,
        rg:              p.rg,
        ie:              p.ie,
        rgIe:            p.rg_ie,
        contribuinte:    p.contribuinte,
        consumidorFinal: p.consumidor_final,
        email:           p.email_principal,
        telefone:        p.telefone_principal,
        enderecoPrincipal: p.logradouro ? {
          logradouro:      p.logradouro,
          numero:          p.numero,
          complemento:     p.complemento,
          bairro:          p.bairro,
          cidade:          p.cidade,
          codigoMunicipio: p.codigo_municipio,
          uf:              p.uf,
          cep:             p.cep,
          pais:            p.pais,
          codigoPais:      p.codigo_pais,
        } : null,
      });

      const alertas: string[] = [];
      if (!destinatario.cpf_cnpj || destinatario.cpf_cnpj.length < 11) {
        alertas.push('CPF/CNPJ ausente ou inválido — NF-e será rejeitada.');
      }
      if (p.tipo_pessoa === 'PJ' && destinatario.ind_ie_dest === 1 && !destinatario.ie) {
        alertas.push('Contribuinte marcado mas IE ausente — NF-e será rejeitada (rejeição 561).');
      }
      if (!destinatario.endereco) {
        alertas.push('Endereço principal não cadastrado — obrigatório para NF-e.');
      }
      if (destinatario.endereco && !destinatario.endereco.codigo_municipio) {
        alertas.push('Código IBGE do município não preenchido — obrigatório para NF-e.');
      }

      res.json({
        ok: true,
        data: {
          campos_fiscais:   fiscal,
          destinatario_nfe: destinatario,
          alertas,
          status: alertas.length === 0 ? 'pronto' : 'pendencias',
        }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/fisc/relatorio-ie', ...auth, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           p.id,
           p.nome_fantasia,
           p.cnpj_cpf,
           p.ie,
           p.rg_ie        AS ie_legado,
           p.contribuinte,
           p.consumidor_final,
           CASE
             WHEN p.ie IS NOT NULL AND p.ie != '' THEN 'ok'
             WHEN p.rg_ie IS NOT NULL AND p.rg_ie != '' THEN 'migrar'
             ELSE 'ausente'
           END             AS status_ie,
           e.codigo_municipio,
           e.uf
         FROM pessoas p
         LEFT JOIN enderecos e ON e.pessoa_id = p.id AND e.tipo = 'principal'
         WHERE p.tenant_id = $1 AND p.tipo_pessoa = 'PJ'
         ORDER BY status_ie, p.nome_fantasia`,
        [req.tenantId]
      );
      const summary = {
        total:   rows.length,
        ok:      rows.filter(r => r.status_ie === 'ok').length,
        migrar:  rows.filter(r => r.status_ie === 'migrar').length,
        ausente: rows.filter(r => r.status_ie === 'ausente').length,
      };
      res.json({ ok: true, summary, data: rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── FISC-02: Validação e emissão NF-e ────────────────────────────────────

  app.post('/api/fisc/validar', ...auth, async (req: any, res) => {
    try {
      const { nfe, empresaId } = req.body;
      if (!nfe || !empresaId) {
        return res.status(400).json({ ok: false, error: 'nfe e empresaId são obrigatórios.' });
      }

      const emitenteResult = await buscarEmitente(req.tenantId, parseInt(empresaId));
      if (!emitenteResult.ok) {
        return res.status(404).json({ ok: false, error: emitenteResult.error });
      }
      const emitente = emitenteResult.data;

      const result = validator.validateToObject(nfe, {
        cnpj:     emitente.cnpj,
        uf:       (emitente as any).uf ?? 'SP',
        crt:      emitente.crt as 1 | 2 | 3 | 4,
        ambiente: emitente.ambiente,
      });

      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/fisc/nfe/emitir', ...auth, async (req: any, res) => {
    try {
      const ctx = soeContextFromReq(req);
      const result = await fiscalAdapterV2.emitirNFe({
        tenantId: ctx.tenantId,
        userId:   ctx.userId,
        ...req.body,
      });
      if (!result.ok) return res.status(422).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/fisc/nfe/:chave/cancelar', ...auth, async (req: any, res) => {
    const { justificativa, empresaId } = req.body;
    const result = await fiscalAdapterV2.cancelarNFe(
      req.tenantId, parseInt(empresaId), req.params.chave, justificativa
    );
    if (!result.ok) return res.status(422).json(result);
    res.json(result);
  });

  app.get('/api/fisc/emitentes/:empresaId/certificado', ...auth, async (req: any, res) => {
    const result = await fiscalAdapterV2.verificarCertificado(parseInt(req.params.empresaId));
    res.json({ ok: true, data: result });
  });

  // ── FISC-02: Documentos fiscais ───────────────────────────────────────────

  app.get('/api/fisc/documentos', ...auth, async (req: any, res) => {
    try {
      const {
        tipo, status, page = '1', limit = '50', dataInicio, dataFim,
      } = req.query as Record<string, string>;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let q = `SELECT * FROM fiscal_documentos WHERE tenant_id = $1`;
      const params: any[] = [req.tenantId];

      if (tipo)       q += ` AND tipo = $${params.push(tipo)}`;
      if (status)     q += ` AND status = $${params.push(status)}`;
      if (dataInicio) q += ` AND created_at >= $${params.push(dataInicio)}`;
      if (dataFim)    q += ` AND created_at <= $${params.push(dataFim + 'T23:59:59Z')}`;

      q += ` ORDER BY created_at DESC LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(offset)}`;

      const { rows } = await pool.query(q, params);
      res.json({ ok: true, data: rows, page: parseInt(page), limit: parseInt(limit) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/fisc/documentos/:id', ...auth, async (req: any, res) => {
    const { rows: [doc] } = await pool.query(
      `SELECT * FROM fiscal_documentos WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (!doc) return res.status(404).json({ ok: false, error: 'Documento não encontrado.' });
    res.json({ ok: true, data: doc });
  });

  // ── FISC-02: Dashboard ────────────────────────────────────────────────────

  app.get('/api/fisc/dashboard', ...auth, async (req: any, res) => {
    try {
      const { rows: [resumo] } = await pool.query(
        `SELECT
           COUNT(*)                                        AS total,
           COUNT(*) FILTER (WHERE status = 'autorizado')  AS autorizados,
           COUNT(*) FILTER (WHERE status = 'rejeitado')   AS rejeitados,
           COUNT(*) FILTER (WHERE status = 'cancelado')   AS cancelados,
           COUNT(*) FILTER (WHERE status = 'simulado')    AS simulados,
           COUNT(*) FILTER (WHERE status IN ('montado','transmitindo')) AS pendentes,
           COALESCE(SUM(valor_total) FILTER (
             WHERE status = 'autorizado'
               AND created_at >= DATE_TRUNC('month', NOW())
           ), 0)                                          AS valor_mes_atual
         FROM fiscal_documentos WHERE tenant_id = $1`,
        [req.tenantId]
      );

      const { rows: certAlertas } = await pool.query(
        `SELECT e.empresa_id, te.nome_fantasia, e.certificado_valido_ate,
                EXTRACT(DAY FROM (e.certificado_valido_ate - NOW())) AS dias_restantes
         FROM emitentes_fiscal e
         JOIN tenant_empresas te ON te.id = e.empresa_id
         WHERE e.tenant_id = $1
           AND e.certificado_valido_ate IS NOT NULL
           AND e.certificado_valido_ate <= NOW() + INTERVAL '30 days'
           AND e.status = 'ativo'`,
        [req.tenantId]
      );

      res.json({
        ok: true,
        data: { resumo, alertas: { certificados_vencendo: certAlertas } }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
