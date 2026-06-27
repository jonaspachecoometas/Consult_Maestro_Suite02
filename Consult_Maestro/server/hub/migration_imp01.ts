import { pool } from "../db";

export const FASES_PROJETO = [
  "pre_programacao",
  "programacao",
  "campo",
  "laboratorio",
  "elaboracao_relatorio",
  "revisao_interna",
  "entrega_cliente",
  "aprovado",
  "faturado",
  "concluido",
] as const;

export type FaseProjeto = typeof FASES_PROJETO[number];

export async function runMigrationHubImp01(): Promise<{ ok: boolean; log: string[] }> {
  const client = await pool.connect();
  const log: string[] = [];

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS codigo_externo   VARCHAR(30),
        ADD COLUMN IF NOT EXISTS fase_atual        VARCHAR(40) DEFAULT 'pre_programacao',
        ADD COLUMN IF NOT EXISTS checklist_fases   JSONB       DEFAULT '{}'::jsonb
    `);
    log.push("✓ ALTER TABLE projects ADD COLUMN codigo_externo + fase_atual + checklist_fases");

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_proj_codigo_ext
        ON projects(tenant_id, codigo_externo)
        WHERE codigo_externo IS NOT NULL
    `);
    log.push("✓ INDEX idx_proj_codigo_ext");

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_billing_blockers (
        id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       VARCHAR      NOT NULL,
        project_id      VARCHAR      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        tipo            VARCHAR(50)  NOT NULL,
        descricao       TEXT         NOT NULL,
        impacto_valor   NUMERIC(15,2),
        data_evento     DATE         NOT NULL DEFAULT CURRENT_DATE,
        status          VARCHAR(20)  NOT NULL DEFAULT 'aberto',
        alertado_em     TIMESTAMP,
        resolvido_em    TIMESTAMP,
        resolvido_por   VARCHAR,
        observacoes     TEXT,
        created_by      VARCHAR,
        created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    log.push("✓ TABLE project_billing_blockers");

    await client.query(`CREATE INDEX IF NOT EXISTS idx_blocker_project ON project_billing_blockers(project_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blocker_tenant  ON project_billing_blockers(tenant_id, status, data_evento DESC)`);
    log.push("✓ INDEXES project_billing_blockers");

    await client.query(`
      UPDATE projects p
      SET codigo_externo = ep.numero
      FROM engineering_projects ep
      WHERE ep.hub_project_id = p.id
        AND p.codigo_externo IS NULL
        AND ep.numero IS NOT NULL
    `).catch(() => {});
    log.push("✓ backfill projects.codigo_externo a partir de engineering_projects.numero");

    await client.query("COMMIT");
    log.push("✓ COMMIT — HUB-IMP-01 concluída");
    return { ok: true, log };

  } catch (err: any) {
    await client.query("ROLLBACK");
    return { ok: false, log: [...log, `✗ ${err.message}`] };
  } finally {
    client.release();
  }
}
