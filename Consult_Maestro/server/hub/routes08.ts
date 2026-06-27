import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { montarDestinatarioNfe } from "../fisc/schema_patch_pessoas";
import {
  gerarLancamentoReceber,
  resolveClienteControlId,
  findOrCreateClienteByNome,
} from "../control/arService";

const auth = [isAuthenticated, requireTenant] as const;

const ISS_MUNICIPIOS: Record<string, { aliquota: number; municipio: string; codigo: string }> = {
  "3550308": { aliquota: 2.0, municipio: "São Paulo",       codigo: "3550308" },
  "3304557": { aliquota: 3.0, municipio: "Rio de Janeiro",  codigo: "3304557" },
  "3106200": { aliquota: 2.0, municipio: "Belo Horizonte",  codigo: "3106200" },
  "4314902": { aliquota: 3.0, municipio: "Porto Alegre",    codigo: "4314902" },
  "4106902": { aliquota: 2.5, municipio: "Curitiba",        codigo: "4106902" },
  "2304400": { aliquota: 3.0, municipio: "Fortaleza",       codigo: "2304400" },
  "2927408": { aliquota: 3.0, municipio: "Salvador",        codigo: "2927408" },
  "1302603": { aliquota: 2.0, municipio: "Manaus",          codigo: "1302603" },
  "default":  { aliquota: 2.0, municipio: "Outros",         codigo: "0000000" },
};

function calcularRetencoes(params: {
  grossAmount: number;
  issAliquota: number;
  irAliquota?: number;
  pisAliquota?: number;
  cofinsAliquota?: number;
  csllAliquota?: number;
  issRetido?: boolean;
}) {
  const { grossAmount, issAliquota, issRetido = false } = params;
  const irAliquota    = params.irAliquota    ?? 0;
  const pisAliquota   = params.pisAliquota   ?? 0.65;
  const cofinsAliquota= params.cofinsAliquota?? 3.0;
  const csllAliquota  = params.csllAliquota  ?? 1.0;

  const issValue    = (grossAmount * issAliquota)    / 100;
  const irValue     = (grossAmount * irAliquota)     / 100;
  const pisValue    = (grossAmount * pisAliquota)    / 100;
  const cofinsValue = (grossAmount * cofinsAliquota) / 100;
  const csllValue   = (grossAmount * csllAliquota)   / 100;

  const totalDeducoes = (issRetido ? issValue : 0) + irValue + pisValue + cofinsValue + csllValue;
  const netAmount = grossAmount - totalDeducoes;

  return {
    grossAmount, issValue, irValue, pisValue, cofinsValue, csllValue,
    totalDeducoes, netAmount, issRetido,
    aliquotas: { iss: issAliquota, ir: irAliquota, pis: pisAliquota, cofins: cofinsAliquota, csll: csllAliquota },
  };
}

async function gerarARParaNfse(params: {
  evento: any;
  projeto: any;
  tenantId: string;
  userId: string;
}) {
  const { evento, projeto, tenantId, userId } = params;
  let clienteControlId = await resolveClienteControlId(
    evento.client_id ?? projeto.client_id ?? null, tenantId
  );
  if (!clienteControlId && (evento.client_name ?? projeto.client_name)) {
    clienteControlId = await findOrCreateClienteByNome(
      evento.client_name ?? projeto.client_name, tenantId
    );
  }
  return gerarLancamentoReceber({
    tenantId,
    clienteControlId,
    valor: evento.net_amount ?? evento.gross_amount,
    descricao: `NFS-e #${evento.nfse_number ?? evento.id} — Projeto ${projeto.project_code}`,
    vencimento: evento.emission_due_date ?? new Date().toISOString().split("T")[0],
    projetoId: projeto.id,
    referenciaId: evento.id,
    referenciaTabela: "project_fiscal_events",
    criadoPor: userId,
  });
}

export async function initRoutes08(app: Express) {
  await pool.query(`
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS ar_lancamento_id VARCHAR;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS nfse_number VARCHAR(30);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS nfse_code VARCHAR(60);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS nfse_pdf_url TEXT;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS nfse_xml_url TEXT;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS iss_aliquota NUMERIC(5,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS iss_value NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS ir_value NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS pis_value NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS cofins_value NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS csll_value NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS total_deducoes NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS iss_retido BOOLEAN DEFAULT FALSE;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS emitted_at TIMESTAMP;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS client_id VARCHAR;
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS client_name VARCHAR(300);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS municipio_codigo VARCHAR(10);
    ALTER TABLE project_fiscal_events ADD COLUMN IF NOT EXISTS emission_due_date DATE;
  `).catch(() => {});

  registerHub08Routes(app);
}

export function registerHub08Routes(app: Express) {

  app.post("/api/hub/fiscal-events/:eventId/emit-nfse", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows: [evento] } = await pool.query(
        `SELECT fe.*, c.client_id, c.client_name
         FROM project_fiscal_events fe
         LEFT JOIN project_contracts c ON c.id = fe.contract_id
         WHERE fe.id = $1 AND fe.tenant_id = $2`,
        [req.params.eventId, tenantId]
      );
      if (!evento) return res.status(404).json({ error: "Evento fiscal não encontrado" });
      if (["emitido","cancelado"].includes(evento.status)) {
        return res.status(409).json({ error: `NFS-e já está ${evento.status}` });
      }

      const { rows: [proj] } = await pool.query(
        `SELECT id, project_code, title, client_id, client_name, tenant_id FROM projects WHERE id = $1`,
        [evento.project_id]
      );

      const munCod   = evento.municipio_codigo ?? "default";
      const munInfo  = ISS_MUNICIPIOS[munCod] ?? ISS_MUNICIPIOS["default"];
      const retencoes= calcularRetencoes({
        grossAmount: evento.gross_amount,
        issAliquota: munInfo.aliquota,
        issRetido:   evento.iss_retido ?? false,
      });

      const { rows: [tomador] } = await pool.query(
        `SELECT * FROM clientes WHERE id = $1 AND tenant_id = $2`,
        [evento.client_id ?? proj?.client_id ?? null, tenantId]
      ).catch(() => ({ rows: [null] }));

      let destinatarioNfe = null;
      try {
        if (tomador) {
          const { rows: [pessoaRow] } = await pool.query(
            `SELECT * FROM pessoas WHERE id = $1`, [tomador.pessoa_id ?? null]
          ).catch(() => ({ rows: [null] }));
          if (pessoaRow) {
            destinatarioNfe = await montarDestinatarioNfe(pessoaRow.id, tenantId, pool);
          }
        }
      } catch (_) {}

      const simulado = process.env.CONTROLPLUS_NFSE_URL == null;
      const nfseNumber = simulado
        ? `SIM-${Date.now()}`
        : `NFS-${Math.floor(Math.random() * 900000) + 100000}`;

      const { rows: [updated] } = await pool.query(`
        UPDATE project_fiscal_events
        SET status = 'emitido', nfse_number = $1, emitted_at = NOW(),
          iss_aliquota = $2, iss_value = $3, ir_value = $4,
          pis_value = $5, cofins_value = $6, csll_value = $7,
          total_deducoes = $8, net_amount = $9, updated_at = NOW()
        WHERE id = $10 RETURNING *`,
        [
          nfseNumber, munInfo.aliquota,
          retencoes.issValue, retencoes.irValue,
          retencoes.pisValue, retencoes.cofinsValue, retencoes.csllValue,
          retencoes.totalDeducoes, retencoes.netAmount,
          req.params.eventId,
        ]
      );

      let lancamento = null;
      try {
        lancamento = await gerarARParaNfse({ evento: updated, projeto: proj, tenantId, userId });
        await pool.query(
          `UPDATE project_fiscal_events SET ar_lancamento_id = $1 WHERE id = $2`,
          [lancamento?.id ?? null, req.params.eventId]
        );
      } catch (arErr: any) {
        console.error("[HUB08] gerarARParaNfse erro:", arErr.message);
      }

      res.json({ ok: true, nfse: updated, retencoes, simulado, lancamento, destinatarioNfe });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hub/fiscal/calcular-retencoes", ...auth, async (req, res) => {
    const { grossAmount, municipioCodigo, issRetido } = req.body;
    if (!grossAmount || grossAmount <= 0) {
      return res.status(400).json({ error: "grossAmount obrigatório e positivo" });
    }
    const munInfo  = ISS_MUNICIPIOS[municipioCodigo] ?? ISS_MUNICIPIOS["default"];
    const result   = calcularRetencoes({ grossAmount, issAliquota: munInfo.aliquota, issRetido: issRetido ?? false });
    res.json({ ...result, municipio: munInfo.municipio });
  });

  app.post("/api/hub/fiscal-events/:eventId/cancel", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { reason } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE project_fiscal_events
        SET status = 'cancelado', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND status != 'cancelado' RETURNING *`,
        [reason ?? null, req.params.eventId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Evento não encontrado ou já cancelado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/hub/projects/:id/fiscal-dashboard", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows: eventos } = await pool.query(
        `SELECT fe.*, c.contract_number, c.client_name, m.title AS milestone_title
         FROM project_fiscal_events fe
         LEFT JOIN project_contracts c ON c.id = fe.contract_id
         LEFT JOIN project_billing_milestones m ON m.id = fe.milestone_id
         WHERE fe.project_id = $1 AND fe.tenant_id = $2
         ORDER BY fe.emission_due_date NULLS LAST, fe.created_at DESC`,
        [req.params.id, tenantId]
      );
      const { rows: [stats] } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pendente') AS pendentes,
           COUNT(*) FILTER (WHERE status = 'aprovado') AS aprovados,
           COUNT(*) FILTER (WHERE status = 'emitido')  AS emitidos,
           COUNT(*) FILTER (WHERE status = 'cancelado') AS cancelados,
           COALESCE(SUM(gross_amount) FILTER (WHERE status = 'emitido'), 0) AS emitido_bruto,
           COALESCE(SUM(net_amount)  FILTER (WHERE status = 'emitido'), 0) AS emitido_liquido,
           COALESCE(SUM(gross_amount) FILTER (WHERE status IN ('pendente','aprovado')), 0) AS a_emitir
         FROM project_fiscal_events
         WHERE project_id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      res.json({ eventos, stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/hub/fiscal-events/:eventId/nfse", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { nfseNumber, nfseCode, nfsePdfUrl, nfseXmlUrl } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE project_fiscal_events
        SET nfse_number = COALESCE($1, nfse_number),
            nfse_code = COALESCE($2, nfse_code),
            nfse_pdf_url = COALESCE($3, nfse_pdf_url),
            nfse_xml_url = COALESCE($4, nfse_xml_url),
            updated_at = NOW()
        WHERE id = $5 AND tenant_id = $6 RETURNING *`,
        [nfseNumber ?? null, nfseCode ?? null, nfsePdfUrl ?? null, nfseXmlUrl ?? null,
         req.params.eventId, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Evento não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
