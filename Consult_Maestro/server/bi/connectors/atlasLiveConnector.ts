/**
 * Atlas Live Connector — sincroniza incrementalmente de PostgreSQL remoto
 * (Atlas ERP) para analytics.atlas_*. Usa pool separado e cursor updatedAt.
 */
import { Pool } from "pg";
import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";

export interface AtlasLiveConfig {
  arcadiaTenantId: string;
  atlasDataSourceId: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  atlaseTenantId?: number | null;
}

const STAGING_MAP: Record<string, string> = {
  pessoas: "analytics.atlas_pessoas",
  pedidos: "analytics.atlas_pedidos",
  pagar_recebers: "analytics.atlas_pagar_recebers",
  produtos: "analytics.atlas_produtos",
};

const SYNC_QUERIES: Record<string, (tid: number | null | undefined, since: Date | null) => string> = {
  pessoas: (tid, since) => `
    SELECT id, tipo_pessoa, nome, nome_fantasia, razao_social, cpf_cnpj, email,
           ativo, cliente, fornecedor, funcionario, categoria_id,
           vendedor_responsavel_id, tabela_preco_id, tenant_id
      FROM public.pessoas
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt" NULLS FIRST
     LIMIT 10000
  `,
  pedidos: (tid, since) => `
    SELECT id, numero, cliente_id, funcionario_id, empresa_id, status_id,
           data_pedido, valor_produtos, valor_total, valor_frete, valor_ipi,
           numero_nota_fiscal, serie_nota_fiscal, data_emissao_nota_fiscal, tenant_id
      FROM public.pedidos
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt" NULLS FIRST
     LIMIT 10000
  `,
  pagar_recebers: (tid, since) => `
    SELECT id, tipo, descricao, categoria_conta_id, conta_id, pessoa_id,
           forma_pagamento_id, empresa_id, data_competencia, data_vencimento,
           data_pagamento, valor, valor_pago, desconto, juros_multa,
           pago, ativo, extornado, vinculo_espinha, tabela_pai, tenant_id
      FROM public.pagar_recebers
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt" NULLS FIRST
     LIMIT 10000
  `,
  produtos: (tid, since) => `
    SELECT id, codigo_comercial, codigo_barra, nome, apelido, saldo_estoque,
           preco_venda, valor_custo, marca_id, grupo_produto_id, tipo_id,
           ativo, aplicacao, tenant_id
      FROM public.produtos
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt" NULLS FIRST
     LIMIT 10000
  `,
};

function jsLiteral(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''").slice(0, 4000)}'`;
}

export async function syncAtlasLive(config: AtlasLiveConfig): Promise<{
  synced: Record<string, number>;
  errors: Record<string, string>;
  nextCursor: Date;
}> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    max: 3,
  });

  const synced: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const nextCursor = new Date();

  try {
    const test = await pool.connect();
    test.release();

    const dsRes: any = await db.execute(drizzleSql`
      SELECT last_sync_at FROM analytics.atlas_data_sources
       WHERE id = ${config.atlasDataSourceId}
    `);
    const dsRow = (dsRes.rows ?? dsRes)[0];
    const since = dsRow?.last_sync_at ? new Date(dsRow.last_sync_at) : null;

    const tenantLit = `'${config.arcadiaTenantId.replace(/'/g, "''")}'`;

    for (const [table, queryFn] of Object.entries(SYNC_QUERIES)) {
      const stagingTable = STAGING_MAP[table];
      if (!stagingTable) continue;
      try {
        const res = await pool.query(queryFn(config.atlaseTenantId ?? null, since));
        if (res.rows.length === 0) { synced[table] = 0; continue; }

        const cols = Object.keys(res.rows[0]);
        const colsNoTenant = cols.filter(c => c !== "tenant_id");
        const stagingCols = ["arcadia_tenant_id", "atlas_tenant_id", ...colsNoTenant];
        const colList = stagingCols.map(c => `"${c}"`).join(", ");
        const updateSet = stagingCols
          .filter(c => c !== "arcadia_tenant_id" && c !== "id")
          .map(c => `"${c}" = EXCLUDED."${c}"`)
          .concat(['"synced_at" = NOW()'])
          .join(", ");

        const BATCH = 200;
        let count = 0;
        for (let i = 0; i < res.rows.length; i += BATCH) {
          const batch = res.rows.slice(i, i + BATCH);
          const valuesRows = batch.map(row => {
            const cells = [tenantLit, jsLiteral(row.tenant_id ?? null)];
            for (const c of cols) {
              if (c === "tenant_id") continue;
              cells.push(jsLiteral(row[c]));
            }
            return `(${cells.join(",")}, NOW())`;
          });

          await db.execute(drizzleSql.raw(`
            INSERT INTO ${stagingTable} (${colList}, synced_at)
            VALUES ${valuesRows.join(",\n")}
            ON CONFLICT (arcadia_tenant_id, id)
            DO UPDATE SET ${updateSet}
          `));
          count += batch.length;
        }
        synced[table] = count;
      } catch (err: any) {
        errors[table] = err.message;
        console.error(`[atlas-live] erro em ${table}:`, err.message);
      }
    }

    const total = Object.values(synced).reduce((a, b) => a + b, 0);
    await db.execute(drizzleSql`
      UPDATE analytics.atlas_data_sources
         SET last_sync_at = NOW(),
             last_sync_status = 'success',
             last_sync_error = NULL,
             sync_rows_total = COALESCE(sync_rows_total, 0) + ${total},
             updated_at = NOW()
       WHERE id = ${config.atlasDataSourceId}
    `);
  } finally {
    await pool.end().catch(() => {});
  }

  return { synced, errors, nextCursor };
}

export async function testAtlasConnection(config: {
  host: string; port: number; database: string; user: string; password: string; ssl: boolean;
}): Promise<{ ok: boolean; version?: string; error?: string }> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  try {
    const c = await pool.connect();
    const r = await c.query("SELECT version()");
    c.release();
    return { ok: true, version: r.rows[0]?.version };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    await pool.end().catch(() => {});
  }
}
