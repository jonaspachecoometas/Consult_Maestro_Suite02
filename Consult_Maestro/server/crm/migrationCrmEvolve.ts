import { pool } from "../db";

export async function runMigrationCrmEvolve(): Promise<{ ok: boolean; log: string[] }> {
  const client = await pool.connect();
  const log: string[] = [];
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE crm_leads
        ADD COLUMN IF NOT EXISTS pessoa_id VARCHAR REFERENCES pessoas(id) ON DELETE SET NULL
    `);
    log.push("✓ crm_leads ADD COLUMN pessoa_id");

    await client.query(`
      ALTER TABLE crm_opportunities
        ADD COLUMN IF NOT EXISTS pessoa_id VARCHAR REFERENCES pessoas(id) ON DELETE SET NULL
    `);
    log.push("✓ crm_opportunities ADD COLUMN pessoa_id");

    await client.query(`
      ALTER TABLE crm_proposals
        ADD COLUMN IF NOT EXISTS sale_order_id VARCHAR,
        ADD COLUMN IF NOT EXISTS converted_to_sale_order_at TIMESTAMP
    `);
    log.push("✓ crm_proposals ADD COLUMN sale_order_id + converted_to_sale_order_at");

    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_leads_pessoa       ON crm_leads(pessoa_id) WHERE pessoa_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_opps_pessoa        ON crm_opportunities(pessoa_id) WHERE pessoa_id IS NOT NULL`);
    log.push("✓ INDEXES pessoa_id");

    await client.query("COMMIT");
    log.push("✓ COMMIT — CRM-EVOLVE migration concluída");
    return { ok: true, log };
  } catch (err: any) {
    await client.query("ROLLBACK");
    return { ok: false, log: [...log, `✗ ${err.message}`] };
  } finally {
    client.release();
  }
}
