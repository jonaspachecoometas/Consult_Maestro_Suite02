/**
 * Atlas Dump Connector — lê pg_dump SQL (formato COPY) e popula analytics.atlas_*
 * Isolamento por arcadia_tenant_id; opcional filtro por atlaseTenantId.
 */
import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";
import * as fs from "fs";
import * as readline from "readline";

export interface AtlasDumpOptions {
  filePath: string;
  arcadiaTenantId: string;
  atlaseTenantId?: number;
}

export interface AtlasDumpResult {
  tables: Record<string, { rows: number; status: "ok" | "error"; error?: string }>;
  totalRows: number;
  durationMs: number;
}

const TABLES_TO_IMPORT: Record<string, string> = {
  pessoas: "analytics.atlas_pessoas",
  produtos: "analytics.atlas_produtos",
  pedidos: "analytics.atlas_pedidos",
  pedido_produtos: "analytics.atlas_pedido_produtos",
  pagar_recebers: "analytics.atlas_pagar_recebers",
  compras: "analytics.atlas_compras",
  saida_estoques: "analytics.atlas_saida_estoques",
  marcas: "analytics.atlas_marcas",
  grupo_produtos: "analytics.atlas_grupos_produtos",
  modelos: "analytics.atlas_modelos",
  produto_similares: "analytics.atlas_produto_similares",
};

const TABLE_COLUMNS: Record<string, string[]> = {
  pessoas: ["id","tipo_pessoa","nome","nome_fantasia","razao_social","cpf_cnpj","email","ativo","cliente","fornecedor","funcionario","categoria_id","vendedor_responsavel_id","tabela_preco_id","tenant_id"],
  produtos: ["id","codigo_comercial","codigo_barra","nome","apelido","saldo_estoque","preco_venda","valor_custo","marca_id","grupo_produto_id","tipo_id","ativo","aplicacao","tenant_id"],
  pedidos: ["id","numero","cliente_id","funcionario_id","empresa_id","status_id","data_pedido","valor_produtos","valor_total","valor_frete","valor_ipi","numero_nota_fiscal","serie_nota_fiscal","data_emissao_nota_fiscal","tenant_id"],
  pedido_produtos: ["id","pedido_id","produto_id","quantidade","valor_unitario","desconto","valor_total","valor_custo","tenant_id"],
  pagar_recebers: ["id","tipo","descricao","categoria_conta_id","conta_id","pessoa_id","forma_pagamento_id","empresa_id","data_competencia","data_vencimento","data_pagamento","valor","valor_pago","desconto","juros_multa","pago","ativo","extornado","vinculo_espinha","tabela_pai","tenant_id"],
  compras: ["id","fornecedor_id","empresa_id","status_id","valor_produtos","valor_total","valor_frete","valor_ipi","valor_icms","nota_fiscal","data_criacao","tenant_id"],
  saida_estoques: ["id","data_saida","tenant_id"],
  marcas: ["id","nome","tenant_id"],
  grupo_produtos: ["id","nome","tenant_id"],
  modelos: ["id","nome","marca_id","tenant_id"],
  produto_similares: ["id","produto_id","produto_similar_id","lista_similar_id"],
};

// Boolean columns per table (pg_dump COPY uses 't'/'f')
const BOOL_COLS: Record<string, Set<string>> = {
  pessoas: new Set(["ativo","cliente","fornecedor","funcionario"]),
  produtos: new Set(["ativo"]),
  pagar_recebers: new Set(["pago","ativo","extornado"]),
};

// Decodifica escape sequences do COPY: \N=null, \t, \n, \r, \\
function unescapeCopy(s: string): string {
  return s
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

function sqlLiteral(raw: string, col: string, table: string): string {
  if (raw === "\\N" || raw === undefined) return "NULL";
  const boolSet = BOOL_COLS[table];
  if (boolSet?.has(col)) {
    return raw === "t" ? "true" : "false";
  }
  const v = unescapeCopy(raw).replace(/'/g, "''").slice(0, 4000);
  return `'${v}'`;
}

export async function importAtlasDump(opts: AtlasDumpOptions): Promise<AtlasDumpResult> {
  const start = Date.now();
  const result: AtlasDumpResult = { tables: {}, totalRows: 0, durationMs: 0 };

  if (!fs.existsSync(opts.filePath)) {
    throw new Error(`Arquivo não encontrado: ${opts.filePath}`);
  }

  // Parse file line by line, agrupando por tabela
  const parsedData: Record<string, { cols: string[]; rawCols: string[]; rows: string[][] }> = {};

  const rl = readline.createInterface({
    input: fs.createReadStream(opts.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let currentTable: string | null = null;
  let currentCols: string[] = [];
  let wantedCols: number[] = [];
  let wantedNames: string[] = [];

  for await (const line of rl) {
    const copyMatch = line.match(/^COPY\s+(?:public\.)?"?(\w+)"?\s*\(([^)]+)\)\s+FROM\s+stdin/i);
    if (copyMatch) {
      const tableName = copyMatch[1];
      if (TABLES_TO_IMPORT[tableName]) {
        currentTable = tableName;
        currentCols = copyMatch[2].split(",").map(c => c.trim().replace(/"/g, ""));
        const wanted = TABLE_COLUMNS[tableName] || currentCols;
        wantedNames = wanted.filter(w => currentCols.includes(w));
        wantedCols = wantedNames.map(w => currentCols.indexOf(w));
        parsedData[tableName] = { cols: wantedNames, rawCols: currentCols, rows: [] };
      } else {
        currentTable = null;
      }
      continue;
    }

    if (line === "\\." || line.startsWith("\\.")) {
      currentTable = null;
      continue;
    }

    if (currentTable && parsedData[currentTable]) {
      const values = line.split("\t");
      const row = wantedCols.map(idx => idx >= 0 ? (values[idx] ?? "\\N") : "\\N");
      parsedData[currentTable].rows.push(row);
    }
  }

  const { arcadiaTenantId } = opts;
  const tenantLit = `'${arcadiaTenantId.replace(/'/g, "''")}'`;

  for (const [atlasTable, stagingTable] of Object.entries(TABLES_TO_IMPORT)) {
    const data = parsedData[atlasTable];
    if (!data || data.rows.length === 0) {
      result.tables[atlasTable] = { rows: 0, status: "ok" };
      continue;
    }

    try {
      const tenantIdx = data.cols.indexOf("tenant_id");
      const colsNoTenant = data.cols.filter(c => c !== "tenant_id");
      // Tabelas lookup simples (marcas/grupos/modelos/produto_similares) não têm coluna atlas_tenant_id
      const TABLES_WITHOUT_ATLAS_TENANT = new Set(["marcas", "grupo_produtos", "modelos", "produto_similares"]);
      const stagingCols = TABLES_WITHOUT_ATLAS_TENANT.has(atlasTable)
        ? ["arcadia_tenant_id", ...colsNoTenant]
        : ["arcadia_tenant_id", "atlas_tenant_id", ...colsNoTenant];

      const colList = stagingCols.map(c => `"${c}"`).join(", ");
      const updateSet = stagingCols
        .filter(c => c !== "arcadia_tenant_id" && c !== "id")
        .map(c => `"${c}" = EXCLUDED."${c}"`)
        .concat(['"synced_at" = NOW()'])
        .join(", ");

      const BATCH = 500;
      let inserted = 0;

      for (let i = 0; i < data.rows.length; i += BATCH) {
        const batch = data.rows.slice(i, i + BATCH);
        const valuesRows: string[] = [];

        for (const row of batch) {
          const atlasTenantRaw = tenantIdx >= 0 ? row[tenantIdx] : "\\N";

          if (opts.atlaseTenantId && atlasTenantRaw !== "\\N") {
            if (parseInt(atlasTenantRaw, 10) !== opts.atlaseTenantId) continue;
          }

          const cells: string[] = [tenantLit];
          if (!TABLES_WITHOUT_ATLAS_TENANT.has(atlasTable)) {
            cells.push(atlasTenantRaw === "\\N" ? "NULL" : String(parseInt(atlasTenantRaw, 10) || "NULL"));
          }
          for (let ci = 0; ci < data.cols.length; ci++) {
            const col = data.cols[ci];
            if (col === "tenant_id") continue;
            cells.push(sqlLiteral(row[ci], col, atlasTable));
          }
          valuesRows.push(`(${cells.join(",")}, NOW())`);
        }

        if (valuesRows.length === 0) continue;

        await db.execute(drizzleSql.raw(`
          INSERT INTO ${stagingTable} (${colList}, synced_at)
          VALUES ${valuesRows.join(",\n")}
          ON CONFLICT (arcadia_tenant_id, id)
          DO UPDATE SET ${updateSet}
        `));

        inserted += valuesRows.length;
      }

      result.tables[atlasTable] = { rows: inserted, status: "ok" };
      result.totalRows += inserted;
    } catch (err: any) {
      result.tables[atlasTable] = { rows: 0, status: "error", error: err.message };
      console.error(`[atlas-dump] Erro importando ${atlasTable}:`, err.message);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
