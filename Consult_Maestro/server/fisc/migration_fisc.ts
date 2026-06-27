/**
 * FISC — migration_fisc.ts
 * FISC-01: separa rg_ie em rg (PF) + ie (PJ) + contribuinte + consumidor_final na tabela pessoas.
 * FISC-02: cria fiscal_documentos + adiciona uf/codigo_municipio em emitentes_fiscal.
 */

import { pool } from '../db';

export async function runMigrationFisc01(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE pessoas
        ADD COLUMN IF NOT EXISTS rg               VARCHAR(20),
        ADD COLUMN IF NOT EXISTS ie               VARCHAR(30),
        ADD COLUMN IF NOT EXISTS contribuinte     VARCHAR(1) DEFAULT 'N',
        ADD COLUMN IF NOT EXISTS consumidor_final SMALLINT  DEFAULT 1
    `);

    await client.query(`
      UPDATE pessoas
      SET rg = rg_ie
      WHERE tipo_pessoa = 'PF'
        AND rg_ie IS NOT NULL AND rg_ie != ''
        AND rg IS NULL
    `);

    await client.query(`
      UPDATE pessoas
      SET ie = REGEXP_REPLACE(rg_ie, '[^0-9A-Za-z]', '', 'g')
      WHERE tipo_pessoa = 'PJ'
        AND rg_ie IS NOT NULL AND rg_ie != ''
        AND ie IS NULL
    `);

    await client.query(`
      UPDATE pessoas
      SET contribuinte = 'S'
      WHERE tipo_pessoa = 'PJ'
        AND ie IS NOT NULL AND ie != ''
        AND ie NOT IN ('ISENTO', 'isento', 'Isento', 'ISE', 'EX')
        AND contribuinte = 'N'
    `);

    await client.query(`
      UPDATE pessoas
      SET contribuinte = 'I'
      WHERE tipo_pessoa = 'PJ'
        AND ie IS NOT NULL
        AND ie ILIKE 'isento'
        AND contribuinte = 'N'
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pessoas_ie
        ON pessoas (tenant_id, ie)
        WHERE ie IS NOT NULL AND ie != ''
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pessoas_rg
        ON pessoas (tenant_id, rg)
        WHERE rg IS NOT NULL AND rg != ''
    `);

    await client.query('COMMIT');
    console.log('[FISC-01] Migration executada com sucesso.');

    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo_pessoa = 'PF' AND rg IS NOT NULL) AS pf_com_rg,
        COUNT(*) FILTER (WHERE tipo_pessoa = 'PJ' AND ie IS NOT NULL) AS pj_com_ie,
        COUNT(*) FILTER (WHERE tipo_pessoa = 'PJ' AND contribuinte = 'S') AS pj_contribuinte,
        COUNT(*) FILTER (WHERE tipo_pessoa = 'PJ' AND ie IS NULL)     AS pj_sem_ie
      FROM pessoas
    `);
    console.log('[FISC-01] Estatísticas:', stats[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[FISC-01] Erro na migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrationFisc02(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS fiscal_documentos (
        id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             VARCHAR NOT NULL,
        empresa_id            INTEGER NOT NULL,

        tipo                  VARCHAR(10) NOT NULL,
        numero                INTEGER,
        serie                 SMALLINT,
        chave_acesso          VARCHAR(44) UNIQUE,
        protocolo             VARCHAR(20),

        emitente_cnpj         VARCHAR(20) NOT NULL,
        destinatario_cnpj_cpf VARCHAR(20),
        destinatario_nome     VARCHAR(200),

        valor_total           NUMERIC(15,2),
        valor_icms            NUMERIC(15,2) DEFAULT 0,
        valor_pis             NUMERIC(15,2) DEFAULT 0,
        valor_cofins          NUMERIC(15,2) DEFAULT 0,
        valor_iss             NUMERIC(15,2) DEFAULT 0,

        ambiente              VARCHAR(20) NOT NULL DEFAULT 'homologacao',
        status                VARCHAR(30) NOT NULL DEFAULT 'montado',

        xml_autorizado        TEXT,
        pdf_danfe             TEXT,
        ultimo_erro           TEXT,

        sale_order_id         VARCHAR,
        purchase_invoice_id   VARCHAR,
        hub_fiscal_event_id   VARCHAR,
        ar_lancamento_id      VARCHAR,

        created_by_id         VARCHAR,
        cancelado_por_id      VARCHAR,
        cancelado_em          TIMESTAMP WITH TIME ZONE,
        created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_doc_tenant_tipo
        ON fiscal_documentos (tenant_id, tipo, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_doc_status
        ON fiscal_documentos (tenant_id, status)
        WHERE status NOT IN ('autorizado', 'cancelado')
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_doc_sale_order
        ON fiscal_documentos (sale_order_id)
        WHERE sale_order_id IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_doc_hub_event
        ON fiscal_documentos (hub_fiscal_event_id)
        WHERE hub_fiscal_event_id IS NOT NULL
    `);

    await client.query(`
      ALTER TABLE emitentes_fiscal
        ADD COLUMN IF NOT EXISTS uf               VARCHAR(2),
        ADD COLUMN IF NOT EXISTS codigo_municipio VARCHAR(10)
    `);

    await client.query(`
      UPDATE emitentes_fiscal ef
      SET uf               = te.uf,
          codigo_municipio = te.codigo_ibge
      FROM tenant_empresas te
      WHERE te.id = ef.empresa_id
        AND ef.uf IS NULL
        AND te.uf IS NOT NULL
    `).catch(() => {});

    await client.query('COMMIT');
    console.log('[FISC-02] Migration executada com sucesso.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[FISC-02] Erro na migration:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrationFisc(): Promise<void> {
  await runMigrationFisc01();
  await runMigrationFisc02();
}
