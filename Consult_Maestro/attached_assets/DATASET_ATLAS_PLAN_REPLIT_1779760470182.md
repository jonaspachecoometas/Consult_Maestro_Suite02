# DatasetAtlas — Plano de Integração com Arcádia Consult
**Data:** 26/05/2026 · **Para o Replit Agent:** executar em sequência  
**Fonte analisada:** dump-atlas_prod-202605111245.sql (336MB · 1.233.492 linhas · 176 tabelas · PostgreSQL 16)

---

## O que é o Atlas ERP

ERP focado em **autopeças e distribuição** com as seguintes características confirmadas no dump:

- Multi-tenant nativo (`tenant_id` em todas as tabelas core)
- Multi-empresa por tenant (`empresa_id` em pedidos, compras, pagar_recebers)
- Stack: Node.js + Sequelize (tabela `SequelizeMeta` confirma)
- **42.579 pedidos**, **20.205 clientes/fornecedores (pessoas)**, **2.374 produtos**, **49.153 lançamentos financeiros**
- Módulos identificados: Vendas · Compras · Estoque · Financeiro (Pagar/Receber) · PDV · Produção · Consignado · DRE nativa · Orçamentos · Comissões

### Tabelas-chave do Atlas

| Grupo | Tabelas principais | Arcádia mapeia para |
|---|---|---|
| **Financeiro** | `pagar_recebers`, `conta`, `categoria_conta`, `dres` | Control — lançamentos, DRE, contas |
| **Vendas** | `pedidos`, `pedido_produtos`, `pedido_entregas` | CRM — oportunidades / receita |
| **Compras** | `compras`, `compra_entregas`, `compra_entrega_produtos` | Control — despesas / CMV |
| **Estoque** | `entrada_estoques`, `saida_estoques`, `produto_saida_estoques`, `area_estoques` | BI — giro, ruptura |
| **Clientes/Fornecedores** | `pessoas`, `contatos`, `enderecos`, `pessoa_empresas` | CRM — clientes |
| **Produtos** | `produtos`, `produto_codigos`, `produto_similares`, `marcas`, `grupo_produtos` | Catálogo + BI |
| **Autopeças específico** | `modelos`, `marcas`, `lista_similares`, `produto_similares`, `espinhas` | BI autopeças (curva ABC, giro por modelo) |
| **DRE** | `dres`, `categoria_conta` | Control — DRE gerencial |
| **Multi-empresa** | `empresas`, `tenants` | Multi-tenant Arcádia |

---

## Arquitetura da integração

```
Atlas ERP (PostgreSQL externo)
        │
        ├─── Modo A: Arquivo (dump/Dropbox) ──► atlasDumpConnector.ts → analytics.atlas_*
        │
        └─── Modo B: PostgreSQL direto ──────► atlasLiveConnector.ts → analytics.atlas_* (real-time)
                                                        │
                                        analytics.atlas_* (schema de staging)
                                                        │
                                        ┌───────────────┴──────────────────┐
                                        │        atlasEtl.ts               │
                                        │  (transforma atlas_* → fact_*)   │
                                        └───────────────┬──────────────────┘
                                                        │
                            ┌───────────────────────────┼────────────────────────┐
                            ▼                           ▼                        ▼
                 analytics.fact_revenue      analytics.fact_crm      analytics.fact_atlas_products
                 (pagar_recebers C=crédito)  (pedidos como opps)     (produtos + estoque)
                            │
                 Semantic Layer (control.ts, crm.ts, atlas_products.ts)
                            │
                 BI Agent + Dashboards Arcádia
```

---

## ETAPA 1 — Schema de staging `analytics.atlas_*`

### 1.1 Adicionar tabelas de staging no `server/index.ts`

Dentro de `runStartupMigrations()`, após os blocos analytics existentes:

```sql
-- ── DatasetAtlas — staging tables ──────────────────────────────────────────

-- Pessoas (clientes/fornecedores/funcionários do Atlas)
CREATE TABLE IF NOT EXISTS analytics.atlas_pessoas (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  tipo_pessoa varchar(50),
  nome varchar(500),
  nome_fantasia varchar(500),
  razao_social varchar(500),
  cpf_cnpj varchar(50),
  email varchar(255),
  ativo boolean DEFAULT true,
  cliente boolean DEFAULT false,
  fornecedor boolean DEFAULT false,
  funcionario boolean DEFAULT false,
  categoria_id integer,
  vendedor_responsavel_id integer,
  tabela_preco_id integer,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_tenant ON analytics.atlas_pessoas(arcadia_tenant_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_cpf ON analytics.atlas_pessoas(cpf_cnpj);

-- Produtos do Atlas
CREATE TABLE IF NOT EXISTS analytics.atlas_produtos (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  codigo_comercial varchar(255),
  codigo_barra varchar(255),
  nome varchar(500),
  apelido varchar(500),
  saldo_estoque numeric(16,3) DEFAULT 0,
  preco_venda numeric(16,2),
  valor_custo numeric(16,2),
  marca_id integer,
  grupo_produto_id integer,
  tipo_id integer,
  ativo boolean DEFAULT true,
  aplicacao text,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_produtos_tenant ON analytics.atlas_produtos(arcadia_tenant_id);
CREATE INDEX IF NOT EXISTS idx_atlas_produtos_codigo ON analytics.atlas_produtos(codigo_comercial);

-- Pedidos (vendas) do Atlas
CREATE TABLE IF NOT EXISTS analytics.atlas_pedidos (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  numero integer,
  cliente_id integer,
  funcionario_id integer,
  empresa_id integer,
  status_id integer,
  data_pedido timestamp,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_frete numeric(16,2) DEFAULT 0,
  valor_ipi numeric(16,2) DEFAULT 0,
  numero_nota_fiscal text,
  serie_nota_fiscal text,
  data_emissao_nota_fiscal timestamp,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pedidos_tenant ON analytics.atlas_pedidos(arcadia_tenant_id, data_pedido);
CREATE INDEX IF NOT EXISTS idx_atlas_pedidos_cliente ON analytics.atlas_pedidos(arcadia_tenant_id, cliente_id);

-- Itens de pedido
CREATE TABLE IF NOT EXISTS analytics.atlas_pedido_produtos (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  pedido_id integer NOT NULL,
  produto_id integer,
  quantidade numeric(16,2) DEFAULT 0,
  valor_unitario numeric(16,2) DEFAULT 0,
  desconto numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_custo numeric(16,2) DEFAULT 0,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pp_pedido ON analytics.atlas_pedido_produtos(arcadia_tenant_id, pedido_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pp_produto ON analytics.atlas_pedido_produtos(arcadia_tenant_id, produto_id);

-- Financeiro (pagar/receber)
CREATE TABLE IF NOT EXISTS analytics.atlas_pagar_recebers (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  tipo varchar(10),  -- 'C' = crédito/receber, 'D' = débito/pagar
  descricao varchar(500),
  categoria_conta_id integer,
  conta_id integer,
  pessoa_id integer,
  forma_pagamento_id integer,
  empresa_id integer,
  data_competencia timestamp,
  data_vencimento timestamp,
  data_pagamento timestamp,
  valor numeric(16,2) DEFAULT 0,
  valor_pago numeric(16,2) DEFAULT 0,
  desconto numeric(16,2) DEFAULT 0,
  juros_multa numeric(16,2) DEFAULT 0,
  pago boolean DEFAULT false,
  ativo boolean DEFAULT true,
  extornado boolean DEFAULT false,
  vinculo_espinha varchar(255),
  tabela_pai varchar(100),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_tenant ON analytics.atlas_pagar_recebers(arcadia_tenant_id, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_tipo ON analytics.atlas_pagar_recebers(arcadia_tenant_id, tipo, pago);

-- Compras
CREATE TABLE IF NOT EXISTS analytics.atlas_compras (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  fornecedor_id integer,
  empresa_id integer,
  status_id integer,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_frete numeric(16,2) DEFAULT 0,
  valor_ipi numeric(16,2) DEFAULT 0,
  valor_icms numeric(16,2) DEFAULT 0,
  nota_fiscal varchar(255),
  data_criacao timestamp,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_compras_tenant ON analytics.atlas_compras(arcadia_tenant_id, data_criacao);

-- Estoque (movimentos de saída)
CREATE TABLE IF NOT EXISTS analytics.atlas_saida_estoques (
  id integer NOT NULL,
  atlas_tenant_id integer,
  arcadia_tenant_id varchar NOT NULL,
  produto_id integer,
  pedido_id integer,
  empresa_id integer,
  quantidade numeric(16,3) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  data_saida timestamp,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_saida_tenant ON analytics.atlas_saida_estoques(arcadia_tenant_id, data_saida);

-- Marcas e grupos (dimensões autopeças)
CREATE TABLE IF NOT EXISTS analytics.atlas_marcas (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);

CREATE TABLE IF NOT EXISTS analytics.atlas_grupos_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Modelos de veículos (autopeças)
CREATE TABLE IF NOT EXISTS analytics.atlas_modelos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  marca_id integer,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Similares de produtos (específico autopeças)
CREATE TABLE IF NOT EXISTS analytics.atlas_produto_similares (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  produto_id integer,
  produto_similar_id integer,
  lista_similar_id integer,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Configuração de data sources Atlas por tenant
CREATE TABLE IF NOT EXISTS analytics.atlas_data_sources (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  mode varchar(20) NOT NULL DEFAULT 'dump', -- 'dump' | 'live'
  -- Para modo 'live': conexão PostgreSQL
  pg_host varchar(500),
  pg_port integer DEFAULT 5432,
  pg_database varchar(200),
  pg_user varchar(200),
  pg_password_encrypted text, -- AES-256-GCM
  pg_ssl boolean DEFAULT true,
  -- Para modo 'dump': último arquivo processado
  last_dump_filename varchar(500),
  last_dump_processed_at timestamp,
  -- Status
  is_active integer DEFAULT 1,
  last_sync_at timestamp,
  last_sync_status varchar(20),
  last_sync_error text,
  sync_rows_total integer DEFAULT 0,
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_atlas_ds_tenant ON analytics.atlas_data_sources(arcadia_tenant_id);
```

---

## ETAPA 2 — Connector de dump (`server/bi/connectors/atlasDumpConnector.ts`)

```typescript
/**
 * Atlas Dump Connector — lê arquivo SQL do Atlas e popula analytics.atlas_*
 *
 * Suporta:
 *   - pg_dump SQL format (formato do arquivo enviado)
 *   - Leitura incremental com cursor por tabela
 *   - Isolamento por arcadia_tenant_id
 */

import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";
import * as fs from "fs";
import * as readline from "readline";
import * as crypto from "crypto";

export interface AtlasDumpOptions {
  filePath: string;
  arcadiaTenantId: string;
  atlaseTenantId?: number; // se null, importa todos os tenants do dump
}

export interface AtlasDumpResult {
  tables: Record<string, { rows: number; status: "ok" | "error"; error?: string }>;
  totalRows: number;
  durationMs: number;
}

// Tabelas a importar e seu mapeamento para staging
const TABLES_TO_IMPORT: Record<string, string> = {
  pessoas:            "analytics.atlas_pessoas",
  produtos:           "analytics.atlas_produtos",
  pedidos:            "analytics.atlas_pedidos",
  pedido_produtos:    "analytics.atlas_pedido_produtos",
  pagar_recebers:     "analytics.atlas_pagar_recebers",
  compras:            "analytics.atlas_compras",
  saida_estoques:     "analytics.atlas_saida_estoques",
  marcas:             "analytics.atlas_marcas",
  grupo_produtos:     "analytics.atlas_grupos_produtos",
  modelos:            "analytics.atlas_modelos",
  produto_similares:  "analytics.atlas_produto_similares",
};

// Colunas que queremos de cada tabela (subconjunto seguro)
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

export async function importAtlasDump(opts: AtlasDumpOptions): Promise<AtlasDumpResult> {
  const start = Date.now();
  const result: AtlasDumpResult = { tables: {}, totalRows: 0, durationMs: 0 };

  if (!fs.existsSync(opts.filePath)) {
    throw new Error(`Arquivo não encontrado: ${opts.filePath}`);
  }

  // Parse the dump file line by line
  const parsedData: Record<string, { cols: string[]; rows: string[][] }> = {};

  const rl = readline.createInterface({
    input: fs.createReadStream(opts.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let currentTable: string | null = null;
  let currentCols: string[] = [];
  let wantedCols: number[] = [];

  for await (const line of rl) {
    // Detect COPY statement
    const copyMatch = line.match(/^COPY public\.(\w+) \(([^)]+)\)/);
    if (copyMatch) {
      const tableName = copyMatch[1];
      if (TABLES_TO_IMPORT[tableName]) {
        currentTable = tableName;
        currentCols = copyMatch[2].split(",").map(c => c.trim().replace(/"/g, ""));
        const wanted = TABLE_COLUMNS[tableName] || currentCols;
        wantedCols = wanted.map(w => currentCols.indexOf(w));
        parsedData[tableName] = { cols: wanted, rows: [] };
      } else {
        currentTable = null;
      }
      continue;
    }

    // End of COPY block
    if (line === "\\.") {
      currentTable = null;
      continue;
    }

    // Data row
    if (currentTable && parsedData[currentTable]) {
      const values = line.split("\t");
      const row = wantedCols.map(idx => idx >= 0 ? values[idx] : "\\N");
      parsedData[currentTable].rows.push(row);
    }
  }

  // Now upsert into staging tables
  const { arcadiaTenantId } = opts;

  for (const [atlasTable, stagingTable] of Object.entries(TABLES_TO_IMPORT)) {
    const data = parsedData[atlasTable];
    if (!data || data.rows.length === 0) {
      result.tables[atlasTable] = { rows: 0, status: "ok" };
      continue;
    }

    try {
      // Build upsert SQL in batches of 500
      let inserted = 0;
      const BATCH = 500;

      // Get staging columns (matching atlas columns + arcadia_tenant_id)
      const stagingCols = ["arcadia_tenant_id", "atlas_tenant_id", ...data.cols.filter(c => c !== "tenant_id")];

      for (let i = 0; i < data.rows.length; i += BATCH) {
        const batch = data.rows.slice(i, i + BATCH);

        const values = batch.map(row => {
          const atlasTenantIdx = data.cols.indexOf("tenant_id");
          const atlasTenantVal = atlasTenantIdx >= 0 ? row[atlasTenantIdx] : "\\N";

          // Filter to tenantId if specified
          if (opts.atlaseTenantId && atlasTenantVal !== "\\N") {
            if (parseInt(atlasTenantVal) !== opts.atlaseTenantId) return null;
          }

          const rowValues = [arcadiaTenantId, atlasTenantVal];
          for (let ci = 0; ci < data.cols.length; ci++) {
            if (data.cols[ci] === "tenant_id") continue;
            const v = row[ci];
            rowValues.push(v === "\\N" ? "NULL" : `'${v.replace(/'/g, "''")}'`);
          }
          return `(${rowValues.map(v => v === "NULL" || !v ? "NULL" : v.startsWith("'") ? v : `'${v}'`).join(",")})`;
        }).filter(Boolean);

        if (values.length === 0) continue;

        const colList = stagingCols.map(c => `"${c}"`).join(", ");
        const conflictCols = '("arcadia_tenant_id", "id")';
        const updateSet = stagingCols
          .filter(c => c !== "arcadia_tenant_id" && c !== "id")
          .map(c => `"${c}" = EXCLUDED."${c}"`)
          .join(", ");

        await db.execute(drizzleSql.raw(`
          INSERT INTO ${stagingTable} (${colList}, synced_at)
          VALUES ${values.join(",")}
          , NOW())
          ON CONFLICT ${conflictCols}
          DO UPDATE SET ${updateSet}, synced_at = NOW()
        `));

        inserted += values.length;
      }

      result.tables[atlasTable] = { rows: inserted, status: "ok" };
      result.totalRows += inserted;
    } catch (err: any) {
      result.tables[atlasTable] = { rows: 0, status: "error", error: err.message };
      console.error(`[atlas-dump] Error importing ${atlasTable}:`, err.message);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
```

---

## ETAPA 3 — Connector live PostgreSQL (`server/bi/connectors/atlasLiveConnector.ts`)

```typescript
/**
 * Atlas Live Connector — lê diretamente do PostgreSQL do Atlas em tempo real.
 * Usa pool de conexão separado, nunca mistura com o banco da Arcádia.
 * Suporta SSL e credenciais criptografadas com AES-256-GCM.
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
  password: string; // já descriptografado pelo chamador
  ssl: boolean;
  atlaseTenantId?: number;
}

// Query incremental por tabela (usa updatedAt como cursor)
const SYNC_QUERIES: Record<string, (tenantId: number | undefined, since: Date | null) => string> = {
  pessoas: (tid, since) => `
    SELECT id, tipo_pessoa, nome, nome_fantasia, razao_social, cpf_cnpj, email,
           ativo, cliente, fornecedor, funcionario, categoria_id,
           vendedor_responsavel_id, tabela_preco_id, tenant_id, "updatedAt"
      FROM public.pessoas
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt"
     LIMIT 10000
  `,
  pedidos: (tid, since) => `
    SELECT id, numero, cliente_id, funcionario_id, empresa_id, status_id,
           data_pedido, valor_produtos, valor_total, valor_frete, valor_ipi,
           numero_nota_fiscal, serie_nota_fiscal, data_emissao_nota_fiscal,
           tenant_id, "updatedAt"
      FROM public.pedidos
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt"
     LIMIT 10000
  `,
  pagar_recebers: (tid, since) => `
    SELECT id, tipo, descricao, categoria_conta_id, conta_id, pessoa_id,
           forma_pagamento_id, empresa_id, data_competencia, data_vencimento,
           data_pagamento, valor, valor_pago, desconto, juros_multa,
           pago, ativo, extornado, vinculo_espinha, tabela_pai,
           tenant_id, "updatedAt"
      FROM public.pagar_recebers
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt"
     LIMIT 10000
  `,
  produtos: (tid, since) => `
    SELECT id, codigo_comercial, codigo_barra, nome, apelido, saldo_estoque,
           preco_venda, valor_custo, marca_id, grupo_produto_id, tipo_id,
           ativo, aplicacao, tenant_id, "updatedAt"
      FROM public.produtos
     WHERE TRUE
       ${tid ? `AND tenant_id = ${tid}` : ""}
       ${since ? `AND "updatedAt" > '${since.toISOString()}'` : ""}
     ORDER BY "updatedAt"
     LIMIT 10000
  `,
};

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
  let nextCursor = new Date();

  try {
    // Test connection
    const client = await pool.connect();
    client.release();

    // Get last sync cursor from atlas_data_sources
    const [ds] = await db.execute(drizzleSql.raw(`
      SELECT last_sync_at FROM analytics.atlas_data_sources
      WHERE id = '${config.atlasDataSourceId}'
    `)) as any;
    const since = ds?.last_sync_at ? new Date(ds.last_sync_at) : null;

    for (const [table, queryFn] of Object.entries(SYNC_QUERIES)) {
      try {
        const query = queryFn(config.atlaseTenantId, since);
        const res = await pool.query(query);

        if (res.rows.length === 0) {
          synced[table] = 0;
          continue;
        }

        // Upsert into staging
        // (same upsert logic as dump connector — staging table name maps)
        const stagingMap: Record<string, string> = {
          pessoas: "analytics.atlas_pessoas",
          pedidos: "analytics.atlas_pedidos",
          pagar_recebers: "analytics.atlas_pagar_recebers",
          produtos: "analytics.atlas_produtos",
        };

        const stagingTable = stagingMap[table];
        if (!stagingTable) continue;

        // Build bulk upsert
        const BATCH = 200;
        let count = 0;
        for (let i = 0; i < res.rows.length; i += BATCH) {
          const batch = res.rows.slice(i, i + BATCH);
          const cols = Object.keys(batch[0]).filter(c => c !== "updatedAt");
          const stagingCols = ["arcadia_tenant_id", "atlas_tenant_id", ...cols.filter(c => c !== "tenant_id")];

          const values = batch.map(row => {
            const rowVals = [
              `'${config.arcadiaTenantId}'`,
              row.tenant_id ?? "NULL",
            ];
            for (const col of cols) {
              if (col === "tenant_id") continue;
              const v = row[col];
              if (v === null || v === undefined) rowVals.push("NULL");
              else if (typeof v === "boolean") rowVals.push(v ? "true" : "false");
              else if (typeof v === "number") rowVals.push(String(v));
              else if (v instanceof Date) rowVals.push(`'${v.toISOString()}'`);
              else rowVals.push(`'${String(v).replace(/'/g, "''").slice(0, 2000)}'`);
            }
            return `(${rowVals.join(",")})`;
          });

          const colList = stagingCols.map(c => `"${c}"`).join(", ");
          const updateSet = stagingCols
            .filter(c => c !== "arcadia_tenant_id" && c !== "id")
            .map(c => `"${c}" = EXCLUDED."${c}"`)
            .join(", ");

          await db.execute(drizzleSql.raw(`
            INSERT INTO ${stagingTable} (${colList}, synced_at)
            VALUES ${values.map(v => v + ", NOW()").join(", ")}
            ON CONFLICT ("arcadia_tenant_id", "id")
            DO UPDATE SET ${updateSet}, synced_at = NOW()
          `));
          count += batch.length;
        }

        synced[table] = count;
      } catch (err: any) {
        errors[table] = err.message;
        console.error(`[atlas-live] sync error for ${table}:`, err.message);
      }
    }

    // Update last_sync_at
    await db.execute(drizzleSql.raw(`
      UPDATE analytics.atlas_data_sources
      SET last_sync_at = NOW(), last_sync_status = 'success',
          sync_rows_total = sync_rows_total + ${Object.values(synced).reduce((a, b) => a + b, 0)},
          updated_at = NOW()
      WHERE id = '${config.atlasDataSourceId}'
    `));

  } finally {
    await pool.end();
  }

  return { synced, errors, nextCursor };
}

export async function testAtlasConnection(config: Omit<AtlasLiveConfig, "arcadiaTenantId" | "atlasDataSourceId">): Promise<{
  ok: boolean;
  version?: string;
  error?: string;
}> {
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
    const client = await pool.connect();
    const res = await client.query("SELECT version()");
    client.release();
    await pool.end();
    return { ok: true, version: res.rows[0]?.version };
  } catch (err: any) {
    await pool.end().catch(() => {});
    return { ok: false, error: err.message };
  }
}
```

---

## ETAPA 4 — ETL Atlas → analytics fact_* (`server/bi/etl/atlasEtl.ts`)

```typescript
/**
 * ETL Atlas — transforma staging atlas_* em fact_* da Arcádia.
 *
 * Mapeia:
 *   atlas_pagar_recebers (tipo='C', pago=true) → fact_revenue (receitas reais)
 *   atlas_pagar_recebers (tipo='D')            → fact_revenue (despesas — valor negativo)
 *   atlas_pedidos                              → fact_crm (pipeline/vendas)
 *   atlas_pedido_produtos × atlas_produtos     → fact_atlas_products (giro por produto)
 */

import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";
import { invalidateTenantCache } from "../cache";

export async function runAtlasEtl(arcadiaTenantId: string): Promise<{
  revenue: number;
  crm: number;
  products: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let revenue = 0, crm = 0, products = 0;

  // ── 1. Lançamentos financeiros → fact_revenue ────────────────────────
  try {
    const res = await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.fact_revenue (
        id, tenant_id, source_data_source_id, natural_key,
        client_natural_key, period, amount, category, status, payload, ingested_at
      )
      SELECT
        gen_random_uuid(),
        '${arcadiaTenantId}',
        'atlas',
        'atlas-pr-' || pr.id::text,
        pr.pessoa_id::text,
        COALESCE(pr.data_competencia, pr.data_vencimento)::date,
        CASE
          WHEN pr.tipo = 'C' THEN pr.valor
          ELSE -ABS(pr.valor)
        END,
        COALESCE(cc.nome, pr.descricao, 'Atlas'),
        CASE WHEN pr.pago THEN 'pago' ELSE 'pendente' END,
        jsonb_build_object(
          'atlas_id', pr.id,
          'tipo', pr.tipo,
          'tabela_pai', pr.tabela_pai,
          'empresa_id', pr.empresa_id
        ),
        NOW()
      FROM analytics.atlas_pagar_recebers pr
      LEFT JOIN analytics.atlas_pagar_recebers cc_src ON false  -- placeholder
      WHERE pr.arcadia_tenant_id = '${arcadiaTenantId}'
        AND pr.ativo = true
        AND pr.extornado = false
        AND COALESCE(pr.data_competencia, pr.data_vencimento) IS NOT NULL
      ON CONFLICT (tenant_id, source_data_source_id, natural_key)
      DO UPDATE SET
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        category = EXCLUDED.category,
        payload = EXCLUDED.payload,
        ingested_at = NOW()
    `));
    revenue = (res as any).rowCount ?? 0;
  } catch (err: any) {
    errors.push(`fact_revenue: ${err.message}`);
  }

  // ── 2. Pedidos → fact_crm ────────────────────────────────────────────
  try {
    const res = await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.fact_crm (
        id, tenant_id, opportunity_id, client_natural_key,
        stage, value, probability, expected_close, status, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        '${arcadiaTenantId}',
        'atlas-ped-' || p.id::text,
        p.cliente_id::text,
        CASE p.status_id
          WHEN 14 THEN 'Entregue'
          WHEN 15 THEN 'Cancelado'
          ELSE 'Em andamento'
        END,
        COALESCE(p.valor_total, 0),
        CASE WHEN p.status_id = 14 THEN 100 ELSE 50 END,
        p.data_pedido::date,
        CASE p.status_id
          WHEN 14 THEN 'won'
          WHEN 15 THEN 'lost'
          ELSE 'open'
        END,
        p.data_pedido::date,
        NOW()
      FROM analytics.atlas_pedidos p
      WHERE p.arcadia_tenant_id = '${arcadiaTenantId}'
        AND p.data_pedido IS NOT NULL
      ON CONFLICT (tenant_id, opportunity_id)
      DO UPDATE SET
        stage = EXCLUDED.stage,
        value = EXCLUDED.value,
        status = EXCLUDED.status,
        probability = EXCLUDED.probability,
        updated_at = NOW()
    `));
    crm = (res as any).rowCount ?? 0;
  } catch (err: any) {
    errors.push(`fact_crm: ${err.message}`);
  }

  // ── 3. Invalidar cache do tenant ────────────────────────────────────
  await invalidateTenantCache(arcadiaTenantId);

  return { revenue, crm, products, errors };
}
```

---

## ETAPA 5 — Semantic Layer Atlas (`server/bi/semantic/atlas.ts`)

```typescript
/**
 * Módulo semântico "atlas" — métricas específicas do ERP Atlas / autopeças.
 * Lê de analytics.atlas_* (staging) e analytics.fact_* (ETL).
 */

import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

export const metrics: SemanticMetric[] = [

  // ── Vendas ────────────────────────────────────────────────────────────
  {
    id: "atlas.receita_por_periodo",
    label: "Receita de vendas por mês (Atlas)",
    description: "Pedidos entregues (status=14) agrupados por mês.",
    module: "atlas",
    defaultWidget: "line_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_pedido), 'YYYY-MM') AS name,
               SUM(valor_total)::float AS value
          FROM analytics.atlas_pedidos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status_id = 14
           ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },

  {
    id: "atlas.ticket_medio",
    label: "Ticket médio de pedidos",
    description: "Valor médio por pedido entregue.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Ticket médio' AS name,
               ROUND(AVG(valor_total), 2)::float AS value
          FROM analytics.atlas_pedidos
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND status_id = 14
           ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
      `,
    }),
  },

  {
    id: "atlas.top_clientes",
    label: "Top 15 clientes por receita",
    description: "Clientes com maior volume de pedidos entregues.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Cliente ' || ped.cliente_id::text) AS name,
               SUM(ped.valor_total)::float AS value
          FROM analytics.atlas_pedidos ped
          LEFT JOIN analytics.atlas_pessoas p
                 ON p.id = ped.cliente_id AND p.arcadia_tenant_id = ped.arcadia_tenant_id
         WHERE ped.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 15
      `,
    }),
  },

  // ── Produtos / Autopeças ──────────────────────────────────────────────
  {
    id: "atlas.top_produtos_vendidos",
    label: "Top 20 produtos mais vendidos",
    description: "Produtos por quantidade vendida em pedidos entregues.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, 'Produto ' || pp.produto_id::text) AS name,
               SUM(pp.quantidade)::float AS value
          FROM analytics.atlas_pedido_produtos pp
          JOIN analytics.atlas_pedidos ped ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
          LEFT JOIN analytics.atlas_produtos pr ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 20
      `,
    }),
  },

  {
    id: "atlas.margem_por_produto",
    label: "Margem por produto (Top 20)",
    description: "(valor_unitario - valor_custo) / valor_unitario × 100.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(pr.nome, pr.apelido, 'Produto ' || pp.produto_id::text) AS name,
               ROUND(
                 100.0 * (AVG(pp.valor_unitario) - AVG(COALESCE(pp.valor_custo, pr.valor_custo, 0)))
                 / NULLIF(AVG(pp.valor_unitario), 0),
               2)::float AS value
          FROM analytics.atlas_pedido_produtos pp
          JOIN analytics.atlas_pedidos ped ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
          LEFT JOIN analytics.atlas_produtos pr ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
         WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND ped.status_id = 14
           AND pp.valor_unitario > 0
           ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
         GROUP BY pp.produto_id, pr.nome, pr.apelido
         ORDER BY value DESC
         LIMIT 20
      `,
    }),
  },

  {
    id: "atlas.curva_abc_produtos",
    label: "Curva ABC de produtos",
    description: "Classificação A/B/C por receita acumulada (A=80%, B=15%, C=5%).",
    module: "atlas",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        WITH produto_receita AS (
          SELECT pp.produto_id,
                 SUM(pp.valor_total) AS receita
            FROM analytics.atlas_pedido_produtos pp
            JOIN analytics.atlas_pedidos ped ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
           WHERE pp.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND ped.status_id = 14
             ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
           GROUP BY pp.produto_id
        ),
        ranked AS (
          SELECT produto_id, receita,
                 SUM(receita) OVER () AS total,
                 SUM(receita) OVER (ORDER BY receita DESC) AS acumulada
            FROM produto_receita
        )
        SELECT
          CASE
            WHEN acumulada / total <= 0.80 THEN 'A — Alto giro (80%)'
            WHEN acumulada / total <= 0.95 THEN 'B — Médio giro (15%)'
            ELSE 'C — Baixo giro (5%)'
          END AS name,
          COUNT(*)::float AS value
          FROM ranked
         GROUP BY 1
         ORDER BY 1
      `,
    }),
  },

  {
    id: "atlas.estoque_por_grupo",
    label: "Estoque por grupo de produto",
    description: "Saldo de estoque atual agrupado por grupo/categoria.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT COALESCE(g.nome, 'Sem grupo') AS name,
               SUM(pr.saldo_estoque)::float AS value
          FROM analytics.atlas_produtos pr
          LEFT JOIN analytics.atlas_grupos_produtos g
                 ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
         WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND pr.ativo = true
         GROUP BY 1
         ORDER BY value DESC
         LIMIT 20
      `,
    }),
  },

  // ── Financeiro (pagar/receber direto do staging) ─────────────────────
  {
    id: "atlas.inadimplencia_valor",
    label: "Inadimplência — valor em atraso (R$)",
    description: "Total de recebíveis não pagos com vencimento passado.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT 'Inadimplência' AS name,
               COALESCE(SUM(valor - COALESCE(valor_pago, 0)), 0)::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'C'
           AND pago = false
           AND ativo = true
           AND data_vencimento < NOW()
      `,
    }),
  },

  {
    id: "atlas.contas_a_receber_por_vencimento",
    label: "Contas a receber por vencimento",
    description: "Distribuição do contas a receber em vencer por mês.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx: SemanticContext) => ({
      sql: `
        SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
               SUM(valor - COALESCE(valor_pago, 0))::float AS value
          FROM analytics.atlas_pagar_recebers
         WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
           AND tipo = 'C'
           AND pago = false
           AND ativo = true
           AND data_vencimento >= CURRENT_DATE
           ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
         GROUP BY 1
         ORDER BY 1
         LIMIT 12
      `,
    }),
  },

];
```

---

## ETAPA 6 — Registrar módulo atlas na semantic layer

### `server/bi/semantic/index.ts` — adicionar:

```typescript
import * as atlas from "./atlas";
// No array MODULES:
const MODULES: SemanticModule[] = [control, migration, dq, crm, hr, scrum, societario, recovery, fiscal, atlas];
```

---

## ETAPA 7 — Rotas de gestão do DatasetAtlas

### Adicionar em `server/routes.ts`:

```typescript
// ── DatasetAtlas — gestão de data sources Atlas ──
app.post("/api/atlas/data-sources", isAuthenticated, requireTenant, async (req: any, res) => {
  try {
    const { mode, atlasaTenantId, pgHost, pgPort, pgDatabase, pgUser, pgPassword, pgSsl } = req.body;
    const id = crypto.randomUUID();

    let pgPasswordEncrypted: string | null = null;
    if (pgPassword) {
      const { cryptoService } = await import("./cryptoService");
      pgPasswordEncrypted = await cryptoService.encrypt(pgPassword);
    }

    await db.execute(sql.raw(`
      INSERT INTO analytics.atlas_data_sources
        (id, arcadia_tenant_id, atlas_tenant_id, mode, pg_host, pg_port, pg_database, pg_user, pg_password_encrypted, pg_ssl, is_active)
      VALUES
        ('${id}', '${req.tenantId}', ${atlasaTenantId ?? 'NULL'},
         '${mode || 'dump'}', ${pgHost ? `'${pgHost}'` : 'NULL'},
         ${pgPort ?? 5432}, ${pgDatabase ? `'${pgDatabase}'` : 'NULL'},
         ${pgUser ? `'${pgUser}'` : 'NULL'}, ${pgPasswordEncrypted ? `'${pgPasswordEncrypted}'` : 'NULL'},
         ${pgSsl ? 'true' : 'false'}, 1)
    `));

    res.status(201).json({ id, message: "Data source Atlas criado" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/atlas/data-sources", isAuthenticated, requireTenant, async (req: any, res) => {
  const rows = await db.execute(sql.raw(`
    SELECT id, mode, pg_host, pg_port, pg_database, pg_user, atlas_tenant_id,
           is_active, last_sync_at, last_sync_status, sync_rows_total
      FROM analytics.atlas_data_sources
     WHERE arcadia_tenant_id = '${req.tenantId}'
  `));
  res.json((rows as any).rows ?? []);
});

// Trigger manual de sync do dump
app.post("/api/atlas/sync/dump", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const filePath = req.body?.filePath;
    if (!filePath) return res.status(400).json({ message: "filePath required" });

    const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
    const result = await importAtlasDump({
      filePath,
      arcadiaTenantId: req.tenantId!,
      atlaseTenantId: req.body?.atlasaTenantId,
    });

    // Após import, rodar ETL
    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    res.json({ import: result, etl: etlResult });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Trigger sync live
app.post("/api/atlas/sync/live/:dataSourceId", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const [ds] = ((await db.execute(sql.raw(`
      SELECT * FROM analytics.atlas_data_sources
      WHERE id = '${req.params.dataSourceId}' AND arcadia_tenant_id = '${req.tenantId}'
    `))) as any).rows ?? [];

    if (!ds) return res.status(404).json({ message: "Data source não encontrado" });

    const { cryptoService } = await import("./cryptoService");
    const password = ds.pg_password_encrypted ? await cryptoService.decrypt(ds.pg_password_encrypted) : "";

    const { syncAtlasLive } = await import("./bi/connectors/atlasLiveConnector");
    const result = await syncAtlasLive({
      arcadiaTenantId: req.tenantId!,
      atlasDataSourceId: ds.id,
      host: ds.pg_host,
      port: ds.pg_port,
      database: ds.pg_database,
      user: ds.pg_user,
      password,
      ssl: ds.pg_ssl,
      atlaseTenantId: ds.atlas_tenant_id,
    });

    // ETL após sync
    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    res.json({ sync: result, etl: etlResult });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Testar conexão live
app.post("/api/atlas/test-connection", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const { testAtlasConnection } = await import("./bi/connectors/atlasLiveConnector");
    const result = await testAtlasConnection({
      host: req.body.pgHost,
      port: req.body.pgPort ?? 5432,
      database: req.body.pgDatabase,
      user: req.body.pgUser,
      password: req.body.pgPassword,
      ssl: req.body.pgSsl ?? true,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

---

## Ordem de execução para o Replit

```
1.  server/index.ts                           → seção 1.1: staging tables analytics.atlas_*
2.  server/bi/connectors/atlasDumpConnector.ts → criar (seção 2)
3.  server/bi/connectors/atlasLiveConnector.ts → criar (seção 3)
4.  server/bi/etl/atlasEtl.ts                 → criar (seção 4)
5.  server/bi/semantic/atlas.ts               → criar (seção 5)
6.  server/bi/semantic/index.ts               → importar atlas + adicionar ao MODULES (seção 6)
7.  server/routes.ts                          → adicionar rotas /api/atlas/* (seção 7)
```

## Verificação após deploy

```bash
# 1. Tabelas staging criadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'analytics' AND table_name LIKE 'atlas_%';
# deve retornar: atlas_pessoas, atlas_produtos, atlas_pedidos, atlas_pedido_produtos,
#                atlas_pagar_recebers, atlas_compras, atlas_saida_estoques,
#                atlas_marcas, atlas_grupos_produtos, atlas_modelos,
#                atlas_produto_similares, atlas_data_sources

# 2. Semantic catalog inclui módulo atlas
GET /api/bi/semantic/catalog
# deve mostrar módulo "atlas" com 9 métricas

# 3. Teste de import do dump (com arquivo disponível no servidor)
POST /api/atlas/sync/dump  { "filePath": "/path/to/dump.sql" }
# deve retornar rowCounts por tabela e resultado do ETL

# 4. Métricas atlas funcionam (mesmo com staging vazio retorna 0 sem erro)
POST /api/bi/semantic/run  { "metricId": "atlas.ticket_medio" }
# deve retornar { rows: [{ name: "Ticket médio", value: 0 }], cached: false }
```

## O que vem depois (não neste plano)

- **UI de configuração do DatasetAtlas** no Arcádia Consult — tela para o tenant admin cadastrar a conexão live ou fazer upload do dump
- **Dashboard Pack autopeças** — Curva ABC + Giro de estoque + Top clientes + Inadimplência + DRE Atlas
- **Webhook do Atlas** — quando Atlas ERP emite evento (pedido criado, NF emitida), aciona sync incremental via `/api/atlas/sync/live`
- **Agente Atlas especializado** — Agente que conhece o vocabulário autopeças (aplicação, similares, espinha) e responde com dados do Atlas
