/**
 * SOE-00 — Migration base do Sistema Operacional Empresarial
 *
 * Cria a infraestrutura transversal que todos os módulos SOE consomem:
 *   1. soe_events         — outbox transacional
 *   2. soe_audit_log      — trilha de auditoria imutável cross-módulo
 *   3. VIEW v_customers   — compatibilidade: lê pessoas com papel 'cliente'
 *   4. VIEW v_suppliers   — compatibilidade: lê pessoas com papel 'fornecedor'
 *   5. VIEW v_products    — alias estável para queries legadas de produto
 */

import { pool } from '../db';

export async function runMigrationSoe00(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. soe_events — outbox transacional
    await client.query(`
      CREATE TABLE IF NOT EXISTS soe_events (
        id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        VARCHAR NOT NULL,
        event_type       VARCHAR(100) NOT NULL,
        aggregate_type   VARCHAR(100) NOT NULL,
        aggregate_id     VARCHAR(100) NOT NULL,
        payload          JSONB NOT NULL DEFAULT '{}',
        idempotency_key  VARCHAR(200) UNIQUE,
        status           VARCHAR(30) NOT NULL DEFAULT 'pending',
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 3,
        last_error       TEXT,
        scheduled_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        locked_until     TIMESTAMP WITH TIME ZONE,
        processed_at     TIMESTAMP WITH TIME ZONE,
        created_by_id    VARCHAR,
        created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_soe_events_poll
        ON soe_events (status, scheduled_at)
        WHERE status IN ('pending', 'failed')
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_soe_events_tenant_type
        ON soe_events (tenant_id, event_type, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_soe_events_aggregate
        ON soe_events (aggregate_type, aggregate_id)
    `);

    // 2. soe_audit_log — trilha imutável de auditoria cross-módulo
    await client.query(`
      CREATE TABLE IF NOT EXISTS soe_audit_log (
        id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      VARCHAR NOT NULL,
        entity_type    VARCHAR(100) NOT NULL,
        entity_id      VARCHAR(100) NOT NULL,
        action         VARCHAR(50)  NOT NULL,
        before_state   JSONB,
        after_state    JSONB,
        user_id        VARCHAR,
        user_email     VARCHAR(255),
        ip_address     INET,
        user_agent     TEXT,
        request_id     VARCHAR(100),
        created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_soe_audit_entity
        ON soe_audit_log (entity_type, entity_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_soe_audit_tenant_ts
        ON soe_audit_log (tenant_id, created_at DESC)
    `);

    // 3. VIEW v_customers
    await client.query(`
      CREATE OR REPLACE VIEW v_customers AS
      SELECT
        p.id::TEXT                          AS id,
        p.tenant_id::INTEGER                AS tenant_id,
        COALESCE(p.codigo_externo, p.id)    AS code,
        p.nome_fantasia                     AS name,
        CASE WHEN p.tipo_pessoa = 'PF'
             THEN 'individual' ELSE 'company' END AS type,
        p.cnpj_cpf                          AS tax_id,
        c_email.valor                       AS email,
        c_tel.valor                         AS phone,
        CASE WHEN e.logradouro IS NOT NULL
             THEN CONCAT(e.logradouro,
                  CASE WHEN e.numero IS NOT NULL THEN ', '||e.numero ELSE '' END,
                  CASE WHEN e.bairro IS NOT NULL THEN ' - '||e.bairro ELSE '' END)
             ELSE NULL END                  AS address,
        e.cidade                            AS city,
        e.estado                            AS state,
        COALESCE(e.pais, 'Brasil')          AS country,
        COALESCE(p.limite_credito, 0)       AS credit_limit,
        COALESCE(p.periodicidade_venda_compra, 30) AS payment_terms,
        CASE WHEN p.status = 'ativo' THEN 'active'
             WHEN p.status = 'inativo' THEN 'inactive'
             ELSE p.status END              AS status,
        p.observacoes                       AS notes,
        p.created_at,
        p.updated_at
      FROM pessoas p
      JOIN pessoa_papeis pp
        ON pp.pessoa_id = p.id
       AND pp.tipo_papel = 'cliente'
       AND pp.status     = 'ativo'
      LEFT JOIN enderecos e
        ON e.pessoa_id = p.id
       AND e.tipo = 'principal'
      LEFT JOIN contatos c_email
        ON c_email.pessoa_id = p.id
       AND c_email.tipo = 'email'
       AND c_email.principal = true
      LEFT JOIN contatos c_tel
        ON c_tel.pessoa_id = p.id
       AND c_tel.tipo IN ('telefone','celular')
       AND c_tel.principal = true
    `);

    // 4. VIEW v_suppliers
    await client.query(`
      CREATE OR REPLACE VIEW v_suppliers AS
      SELECT
        p.id::TEXT                          AS id,
        p.tenant_id::INTEGER                AS tenant_id,
        COALESCE(p.codigo_externo, p.id)    AS code,
        p.nome_fantasia                     AS name,
        p.cnpj_cpf                          AS tax_id,
        c_email.valor                       AS email,
        c_tel.valor                         AS phone,
        CASE WHEN e.logradouro IS NOT NULL
             THEN CONCAT(e.logradouro,
                  CASE WHEN e.numero IS NOT NULL THEN ', '||e.numero ELSE '' END,
                  CASE WHEN e.bairro IS NOT NULL THEN ' - '||e.bairro ELSE '' END)
             ELSE NULL END                  AS address,
        e.cidade                            AS city,
        e.estado                            AS state,
        COALESCE(e.pais, 'Brasil')          AS country,
        COALESCE((pp.metadata->>'prazoMedioPagamento')::integer, 30) AS payment_terms,
        CASE WHEN p.status = 'ativo' THEN 'active' ELSE p.status END AS status,
        p.observacoes                       AS notes,
        0                                   AS is_homologated,
        NULL::TIMESTAMP                     AS homologation_date,
        NULL::TIMESTAMP                     AS homologation_expiry,
        NULL::VARCHAR                       AS homologation_status,
        NULL::TEXT[]                        AS certifications,
        NULL::INTEGER                       AS quality_score,
        NULL::TIMESTAMP                     AS last_audit_date,
        NULL::TIMESTAMP                     AS next_audit_date,
        0                                   AS blocked_for_purchase,
        NULL::TEXT                          AS block_reason,
        p.created_at,
        p.updated_at
      FROM pessoas p
      JOIN pessoa_papeis pp
        ON pp.pessoa_id = p.id
       AND pp.tipo_papel = 'fornecedor'
       AND pp.status     = 'ativo'
      LEFT JOIN enderecos e
        ON e.pessoa_id = p.id
       AND e.tipo = 'principal'
      LEFT JOIN contatos c_email
        ON c_email.pessoa_id = p.id
       AND c_email.tipo = 'email'
       AND c_email.principal = true
      LEFT JOIN contatos c_tel
        ON c_tel.pessoa_id = p.id
       AND c_tel.tipo IN ('telefone','celular')
       AND c_tel.principal = true
    `);

    // 5. VIEW v_products (apenas se produto_fiscal ainda não existe)
    const { rows: pfExists } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'produto_fiscal' AND table_schema = 'public'
    `);
    if (pfExists.length === 0) {
      await client.query(`DROP VIEW IF EXISTS v_products`);
      await client.query(`
        CREATE VIEW v_products AS
        SELECT
          p.id,
          p.tenant_id,
          p.code,
          p.name,
          p.description,
          p.category,
          p.unit,
          p.cost_price,
          p.sale_price,
          p.stock_qty,
          p.min_stock,
          p.barcode,
          p.ncm,
          p.tax_group_id,
          p.status,
          p.image_url,
          p.requires_serial_tracking,
          p.tracking_type,
          p.default_brand,
          p.default_model,
          NULL::VARCHAR   AS cest,
          NULL::INTEGER   AS origem,
          NULL::VARCHAR   AS produto_fiscal_id,
          NULL::BOOLEAN   AS controla_lote,
          NULL::VARCHAR   AS descricao_nfe,
          NULL::VARCHAR   AS unidade_tributavel,
          NULL::NUMERIC   AS custo_medio,
          NULL::NUMERIC   AS estoque_minimo,
          p.created_at,
          p.updated_at
        FROM products p
      `);
    }

    await client.query("COMMIT");
    console.log("[SOE-00] Migration executada com sucesso.");
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error("[SOE-00] Erro na migration:", e.message);
    throw e;
  } finally {
    client.release();
  }
}
