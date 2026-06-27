import { pool } from "../db";

export async function runMigrationRhMerge(): Promise<{ ok: boolean; log: string[] }> {
  const client = await pool.connect();
  const log: string[] = [];
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS people_beneficios (
        id            SERIAL PRIMARY KEY,
        tenant_id     VARCHAR NOT NULL,
        codigo        VARCHAR(20),
        nome          VARCHAR(100) NOT NULL,
        tipo          VARCHAR(30),
        fornecedor    VARCHAR(100),
        valor_empresa         NUMERIC(15,2) DEFAULT 0,
        valor_funcionario     NUMERIC(15,2) DEFAULT 0,
        percentual_desconto   NUMERIC(5,2)  DEFAULT 0,
        status        VARCHAR(20) DEFAULT 'ativo',
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_beneficios_tenant ON people_beneficios(tenant_id)`);
    log.push("✓ TABLE people_beneficios");

    await client.query(`
      CREATE TABLE IF NOT EXISTS people_funcionario_beneficios (
        id              SERIAL PRIMARY KEY,
        tenant_id       VARCHAR NOT NULL,
        funcionario_id  VARCHAR NOT NULL,
        beneficio_id    INTEGER NOT NULL REFERENCES people_beneficios(id) ON DELETE CASCADE,
        data_inicio     DATE,
        data_fim        DATE,
        valor_personalizado NUMERIC(15,2),
        status          VARCHAR(20) DEFAULT 'ativo',
        created_at      TIMESTAMP DEFAULT NOW(),
        UNIQUE(funcionario_id, beneficio_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_func_benef_func ON people_funcionario_beneficios(funcionario_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_func_benef_tenant ON people_funcionario_beneficios(tenant_id)`);
    log.push("✓ TABLE people_funcionario_beneficios");

    await client.query(`
      CREATE TABLE IF NOT EXISTS people_ponto (
        id              SERIAL PRIMARY KEY,
        tenant_id       VARCHAR NOT NULL,
        funcionario_id  VARCHAR NOT NULL,
        data            DATE NOT NULL,
        entrada1        VARCHAR(5),
        saida1          VARCHAR(5),
        entrada2        VARCHAR(5),
        saida2          VARCHAR(5),
        horas_trabalhadas NUMERIC(10,2),
        horas_extras      NUMERIC(10,2) DEFAULT 0,
        horas_noturnas    NUMERIC(10,2) DEFAULT 0,
        atraso            NUMERIC(10,2) DEFAULT 0,
        falta             INTEGER DEFAULT 0,
        justificativa     TEXT,
        status            VARCHAR(20) DEFAULT 'normal',
        created_at        TIMESTAMP DEFAULT NOW(),
        UNIQUE(funcionario_id, data)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ponto_func  ON people_ponto(funcionario_id, data)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ponto_tenant ON people_ponto(tenant_id, data DESC)`);
    log.push("✓ TABLE people_ponto");

    await client.query(`
      CREATE TABLE IF NOT EXISTS people_ferias (
        id                        SERIAL PRIMARY KEY,
        tenant_id                 VARCHAR NOT NULL,
        funcionario_id            VARCHAR NOT NULL,
        periodo_aquisitivo_inicio DATE NOT NULL,
        periodo_aquisitivo_fim    DATE NOT NULL,
        dias_direito              INTEGER DEFAULT 30,
        dias_gozados              INTEGER DEFAULT 0,
        dias_vendidos             INTEGER DEFAULT 0,
        data_inicio               DATE,
        data_fim                  DATE,
        valor_ferias              NUMERIC(15,2),
        valor_terco               NUMERIC(15,2),
        valor_abono               NUMERIC(15,2),
        status                    VARCHAR(20) DEFAULT 'pendente',
        aprovado_por              VARCHAR,
        aprovado_em               TIMESTAMP,
        observacoes               TEXT,
        created_at                TIMESTAMP DEFAULT NOW(),
        updated_at                TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ferias_func   ON people_ferias(funcionario_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ferias_tenant ON people_ferias(tenant_id, status)`);
    log.push("✓ TABLE people_ferias");

    await client.query("COMMIT");
    log.push("✓ COMMIT — RH-MERGE migration concluída");
    return { ok: true, log };
  } catch (err: any) {
    await client.query("ROLLBACK");
    return { ok: false, log: [...log, `✗ ${err.message}`] };
  } finally {
    client.release();
  }
}
