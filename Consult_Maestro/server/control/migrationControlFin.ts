/**
 * CONTROL-MERGE — migrationControlFin.ts
 * Tabelas AP/AR: fin_bank_accounts, fin_payment_methods, fin_payment_plans,
 * fin_cash_flow_categories, fin_accounts_payable, fin_accounts_receivable, fin_transactions.
 */

import { pool } from '../db';

export async function runMigrationControlFin(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_bank_accounts (
        id              SERIAL PRIMARY KEY,
        tenant_id       VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code            VARCHAR(50) NOT NULL,
        name            VARCHAR(256) NOT NULL,
        bank_code       VARCHAR(10),
        bank_name       VARCHAR(100),
        agency          VARCHAR(20),
        account_number  VARCHAR(30),
        account_digit   VARCHAR(5),
        account_type    VARCHAR(50) DEFAULT 'checking',
        initial_balance NUMERIC(15,2) DEFAULT 0,
        current_balance NUMERIC(15,2) DEFAULT 0,
        is_active       BOOLEAN DEFAULT true,
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_bank_account_code ON fin_bank_accounts (tenant_id, code)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_payment_methods (
        id                      SERIAL PRIMARY KEY,
        tenant_id               VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code                    VARCHAR(50) NOT NULL,
        name                    VARCHAR(100) NOT NULL,
        type                    VARCHAR(50) NOT NULL,
        default_bank_account_id INTEGER REFERENCES fin_bank_accounts(id),
        fee                     NUMERIC(5,2) DEFAULT 0,
        days_to_receive         INTEGER DEFAULT 0,
        is_active               BOOLEAN DEFAULT true,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_payment_method_code ON fin_payment_methods (tenant_id, code)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_payment_plans (
        id               SERIAL PRIMARY KEY,
        tenant_id        VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code             VARCHAR(50) NOT NULL,
        name             VARCHAR(100) NOT NULL,
        installments     INTEGER DEFAULT 1,
        interval_days    INTEGER DEFAULT 30,
        first_due_days   INTEGER DEFAULT 30,
        discount_percent NUMERIC(5,2) DEFAULT 0,
        interest_percent NUMERIC(5,2) DEFAULT 0,
        is_active        BOOLEAN DEFAULT true,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_payment_plan_code ON fin_payment_plans (tenant_id, code)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_cash_flow_categories (
        id        SERIAL PRIMARY KEY,
        tenant_id VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code      VARCHAR(50) NOT NULL,
        name      VARCHAR(100) NOT NULL,
        type      VARCHAR(20) NOT NULL,
        parent_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_cashflow_cat_code ON fin_cash_flow_categories (tenant_id, code)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_accounts_payable (
        id              SERIAL PRIMARY KEY,
        tenant_id       VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        empresa_id      INTEGER REFERENCES tenant_empresas(id) ON DELETE SET NULL,
        document_number VARCHAR(100),
        pessoa_id       VARCHAR REFERENCES pessoas(id) ON DELETE SET NULL,
        supplier_name   VARCHAR(256),
        category_id     INTEGER REFERENCES fin_cash_flow_categories(id),
        description     TEXT,
        issue_date      DATE NOT NULL,
        due_date        DATE NOT NULL,
        original_amount NUMERIC(15,2) NOT NULL,
        discount_amount NUMERIC(15,2) DEFAULT 0,
        interest_amount NUMERIC(15,2) DEFAULT 0,
        fine_amount     NUMERIC(15,2) DEFAULT 0,
        paid_amount     NUMERIC(15,2) DEFAULT 0,
        remaining_amount NUMERIC(15,2) NOT NULL,
        status          VARCHAR(50) DEFAULT 'pending',
        payment_method_id INTEGER REFERENCES fin_payment_methods(id),
        bank_account_id   INTEGER REFERENCES fin_bank_accounts(id),
        paid_at         TIMESTAMPTZ,
        origem_ref_tipo VARCHAR(30),
        origem_ref_id   VARCHAR(100),
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fin_ap_tenant ON fin_accounts_payable (tenant_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fin_ap_due ON fin_accounts_payable (due_date) WHERE status = 'pending'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_accounts_receivable (
        id               SERIAL PRIMARY KEY,
        tenant_id        VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        empresa_id       INTEGER REFERENCES tenant_empresas(id) ON DELETE SET NULL,
        document_number  VARCHAR(100),
        pessoa_id        VARCHAR REFERENCES pessoas(id) ON DELETE SET NULL,
        customer_name    VARCHAR(256),
        category_id      INTEGER REFERENCES fin_cash_flow_categories(id),
        description      TEXT,
        issue_date       DATE NOT NULL,
        due_date         DATE NOT NULL,
        original_amount  NUMERIC(15,2) NOT NULL,
        discount_amount  NUMERIC(15,2) DEFAULT 0,
        interest_amount  NUMERIC(15,2) DEFAULT 0,
        fine_amount      NUMERIC(15,2) DEFAULT 0,
        received_amount  NUMERIC(15,2) DEFAULT 0,
        remaining_amount NUMERIC(15,2) NOT NULL,
        status           VARCHAR(50) DEFAULT 'pending',
        payment_method_id INTEGER REFERENCES fin_payment_methods(id),
        bank_account_id   INTEGER REFERENCES fin_bank_accounts(id),
        received_at      TIMESTAMPTZ,
        origem_ref_tipo  VARCHAR(30),
        origem_ref_id    VARCHAR(100),
        projeto_id       VARCHAR(100),
        projeto_codigo   VARCHAR(50),
        notes            TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fin_ar_tenant ON fin_accounts_receivable (tenant_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fin_ar_due ON fin_accounts_receivable (due_date) WHERE status = 'pending'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_transactions (
        id               SERIAL PRIMARY KEY,
        tenant_id        VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        bank_account_id  INTEGER NOT NULL REFERENCES fin_bank_accounts(id),
        type             VARCHAR(20) NOT NULL,
        category_id      INTEGER REFERENCES fin_cash_flow_categories(id),
        amount           NUMERIC(15,2) NOT NULL,
        balance_after    NUMERIC(15,2),
        transaction_date DATE NOT NULL,
        description      TEXT,
        document_number  VARCHAR(100),
        payable_id       INTEGER REFERENCES fin_accounts_payable(id),
        receivable_id    INTEGER REFERENCES fin_accounts_receivable(id),
        reconciled       BOOLEAN DEFAULT false,
        reconciled_at    TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fin_tx_account ON fin_transactions (bank_account_id, transaction_date)`);

    await client.query('COMMIT');
    console.log('[CONTROL-MERGE] fin_* migrations executadas com sucesso.');
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('[CONTROL-MERGE] Erro na migration fin_*:', e.message);
    throw e;
  } finally {
    client.release();
  }
}
