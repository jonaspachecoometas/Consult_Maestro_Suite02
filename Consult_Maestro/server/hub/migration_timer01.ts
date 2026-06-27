import { pool } from "../db";

export async function runTimer01Migration(): Promise<{ ok: boolean; log: string[] }> {
  const client = await pool.connect();
  const log: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query(`
      ALTER TABLE project_timesheets
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS ended_at   TIMESTAMP
    `);
    log.push("✓ ALTER TABLE project_timesheets ADD started_at, ended_at");
    await client.query("COMMIT");
    log.push("✓ COMMIT — TIMER-01 concluída");
    return { ok: true, log };
  } catch (err: any) {
    await client.query("ROLLBACK");
    return { ok: false, log: [...log, `✗ ${err.message}`] };
  } finally {
    client.release();
  }
}
