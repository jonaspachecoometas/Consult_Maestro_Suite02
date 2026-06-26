/**
 * Backfill script: Assign existing data to a tenant after multi-tenant migration.
 *
 * Run with: npx tsx scripts/backfill-tenant-ids.ts
 *
 * IMPORTANT: Run this AFTER creating the initial tenant for the existing workspace.
 *
 * Steps:
 * 1. Create a partner record for Arcádia (superadmin partner)
 * 2. Create a tenant record for the existing workspace
 * 3. Run this script to assign all existing rows to that tenant
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TENANT_ID = process.env.BACKFILL_TENANT_ID;

if (!TENANT_ID) {
  console.error("ERROR: BACKFILL_TENANT_ID environment variable is required.");
  console.error("Usage: BACKFILL_TENANT_ID=<tenant-id> npx tsx scripts/backfill-tenant-ids.ts");
  process.exit(1);
}

const TABLES = [
  "clients",
  "projects",
  "canvas_blocks",
  "processes",
  "deliverables",
  "tasks",
  "swot_analyses",
  "erp_requirements",
  "scrum_backlog_items",
  "crm_leads",
  "crm_opportunities",
  "report_configurations",
];

async function backfill() {
  console.log(`\nBackfilling tenant_id for all existing records...\n`);

  for (const table of TABLES) {
    try {
      const result = await db.execute(
        sql`UPDATE ${sql.identifier(table)} SET tenant_id = ${TENANT_ID} WHERE tenant_id IS NULL`
      );
      const rowsAffected = (result as { rowCount: number | null }).rowCount ?? "unknown";
      console.log(`✓ ${table}: ${rowsAffected} rows updated`);
    } catch (err: any) {
      console.error(`✗ ${table}: ERROR - ${err.message}`);
    }
  }

  console.log("\nBackfill complete.");
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
