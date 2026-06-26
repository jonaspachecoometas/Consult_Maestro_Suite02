# Atlas — Plano de População Completa do Banco
**Data:** 26/05/2026 · **Para o Replit Agent**
**Fonte:** 1.233.492 linhas · 176 tabelas · PostgreSQL 16

---

## Diagnóstico atual

O que **existe** no banco da Arcádia hoje:
- `analytics.fact_revenue` — estrutura básica (vazia, nunca populada com Atlas)
- `analytics.fact_crm` — estrutura básica (vazia)
- `analytics.dim_client`, `analytics.dim_source` — vazias

O que **não existe** e precisa ser criado:
- Nenhuma tabela `analytics.atlas_*` no banco real
- Nenhum conector/ETL funcionando com o dump real
- Nenhuma métrica semântica retornando dados reais

**Objetivo desta tarefa:** criar todas as tabelas de staging, popular com os dados reais do dump, rodar ETL completo para fatos analíticos, expandir semantic layer e criar alertas automáticos.

---

## ETAPA 1 — Tabelas staging completas no `server/index.ts`

Adicionar APÓS o bloco `analytics.fact_crm` existente (dentro de `runStartupMigrations`):

```sql
-- ════════════════════════════════════════════════════════════════════
-- DatasetAtlas — staging tables (população do dump Atlas ERP)
-- ════════════════════════════════════════════════════════════════════

-- Pessoas: clientes + fornecedores + funcionários
CREATE TABLE IF NOT EXISTS analytics.atlas_pessoas (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
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
CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_cliente ON analytics.atlas_pessoas(arcadia_tenant_id, cliente) WHERE cliente = true;
CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_fornecedor ON analytics.atlas_pessoas(arcadia_tenant_id, fornecedor) WHERE fornecedor = true;
CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_cpf ON analytics.atlas_pessoas(cpf_cnpj) WHERE cpf_cnpj IS NOT NULL;

-- Contatos (telefones e emails das pessoas)
CREATE TABLE IF NOT EXISTS analytics.atlas_contatos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  pessoa_id integer,
  nome varchar(255),
  telefone varchar(50),
  email varchar(255),
  padrao boolean DEFAULT false,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_contatos_pessoa ON analytics.atlas_contatos(arcadia_tenant_id, pessoa_id);

-- Endereços
CREATE TABLE IF NOT EXISTS analytics.atlas_enderecos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  pessoa_id integer,
  rua varchar(500),
  cidade varchar(200),
  bairro varchar(200),
  cep varchar(20),
  estado varchar(2),
  padrao boolean DEFAULT false,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_end_pessoa ON analytics.atlas_enderecos(arcadia_tenant_id, pessoa_id);

-- Produtos completo
CREATE TABLE IF NOT EXISTS analytics.atlas_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  codigo_comercial varchar(255),
  codigo_barra varchar(255),
  nome varchar(500),
  apelido varchar(500),
  saldo_estoque numeric(16,3) DEFAULT 0,
  preco_venda numeric(16,2),
  valor_custo numeric(16,2),
  margem_lucro varchar(50),
  marca_id integer,
  grupo_produto_id integer,
  tipo_id integer,
  unidade_id integer,
  imposto_id integer,
  ativo boolean DEFAULT true,
  aplicacao text,
  classificacao varchar(50),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_prod_tenant ON analytics.atlas_produtos(arcadia_tenant_id);
CREATE INDEX IF NOT EXISTS idx_atlas_prod_codigo ON analytics.atlas_produtos(arcadia_tenant_id, codigo_comercial);
CREATE INDEX IF NOT EXISTS idx_atlas_prod_marca ON analytics.atlas_produtos(arcadia_tenant_id, marca_id);
CREATE INDEX IF NOT EXISTS idx_atlas_prod_grupo ON analytics.atlas_produtos(arcadia_tenant_id, grupo_produto_id);

-- Marcas
CREATE TABLE IF NOT EXISTS analytics.atlas_marcas (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Grupos de produto
CREATE TABLE IF NOT EXISTS analytics.atlas_grupos_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Modelos de veículo (autopeças)
CREATE TABLE IF NOT EXISTS analytics.atlas_modelos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  marca_id integer,
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Similares de produto
CREATE TABLE IF NOT EXISTS analytics.atlas_produto_similares (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  produto_id integer,
  produto_similar_id integer,
  lista_similar_id integer,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_sim_prod ON analytics.atlas_produto_similares(arcadia_tenant_id, produto_id);

-- Tabelas de preço
CREATE TABLE IF NOT EXISTS analytics.atlas_tabela_preco_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  tabela_preco_id integer,
  produto_id integer,
  preco_custo numeric(16,2),
  preco_venda numeric(16,2),
  margem_lucro varchar(50),
  desconto_maximo numeric(16,2),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_tpp_produto ON analytics.atlas_tabela_preco_produtos(arcadia_tenant_id, produto_id);

-- Pedidos de venda (completo)
CREATE TABLE IF NOT EXISTS analytics.atlas_pedidos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  numero integer,
  cliente_id integer,
  funcionario_id integer,
  empresa_id integer,
  status_id integer,
  origem_venda_id integer,
  data_pedido timestamp,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_frete numeric(16,2) DEFAULT 0,
  valor_ipi numeric(16,2) DEFAULT 0,
  desconto_total numeric(16,2) DEFAULT 0,
  numero_nota_fiscal text,
  serie_nota_fiscal text,
  data_emissao_nota_fiscal timestamp,
  comissao_total_vendedor numeric(16,2),
  comissao_percentual numeric(16,2),
  motivo_cancelamento text,
  criado_consignado boolean DEFAULT false,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_ped_tenant ON analytics.atlas_pedidos(arcadia_tenant_id, data_pedido);
CREATE INDEX IF NOT EXISTS idx_atlas_ped_cliente ON analytics.atlas_pedidos(arcadia_tenant_id, cliente_id);
CREATE INDEX IF NOT EXISTS idx_atlas_ped_status ON analytics.atlas_pedidos(arcadia_tenant_id, status_id);
CREATE INDEX IF NOT EXISTS idx_atlas_ped_func ON analytics.atlas_pedidos(arcadia_tenant_id, funcionario_id);

-- Itens de pedido
CREATE TABLE IF NOT EXISTS analytics.atlas_pedido_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  pedido_id integer NOT NULL,
  produto_id integer,
  quantidade numeric(16,2) DEFAULT 0,
  valor_unitario numeric(16,2) DEFAULT 0,
  desconto numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_custo numeric(16,2) DEFAULT 0,
  comissao_vendedor numeric(16,2),
  comissao_percentual numeric(16,2),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pp_pedido ON analytics.atlas_pedido_produtos(arcadia_tenant_id, pedido_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pp_produto ON analytics.atlas_pedido_produtos(arcadia_tenant_id, produto_id);

-- Contas bancárias
CREATE TABLE IF NOT EXISTS analytics.atlas_contas (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  agencia varchar(50),
  conta varchar(50),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Formas de pagamento
CREATE TABLE IF NOT EXISTS analytics.atlas_forma_pagamentos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  ativo boolean DEFAULT true,
  parcelavel boolean DEFAULT false,
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Categorias de conta (plano de contas)
CREATE TABLE IF NOT EXISTS analytics.atlas_categoria_conta (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  tipo varchar(10),          -- 'R' receita | 'D' despesa
  pai_id integer,
  dre_id integer,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_cc_tipo ON analytics.atlas_categoria_conta(arcadia_tenant_id, tipo);

-- DRE (estrutura do demonstrativo)
CREATE TABLE IF NOT EXISTS analytics.atlas_dres (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  tipo varchar(10),
  indice integer DEFAULT 0,
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Pagar/Receber — FINANCEIRO CENTRAL
CREATE TABLE IF NOT EXISTS analytics.atlas_pagar_recebers (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  tipo varchar(10) NOT NULL,  -- 'C' crédito/receber | 'D' débito/pagar | 'R' (receita) | outros
  descricao varchar(500),
  categoria_conta_id integer,
  conta_id integer,
  pessoa_id integer,
  forma_pagamento_id integer,
  empresa_id integer,
  tabela_pai varchar(100),    -- origem: 'pedidos','compras','saida_estoques' etc
  vinculo_espinha varchar(255),
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
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_tenant ON analytics.atlas_pagar_recebers(arcadia_tenant_id, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_tipo ON analytics.atlas_pagar_recebers(arcadia_tenant_id, tipo, pago);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_pessoa ON analytics.atlas_pagar_recebers(arcadia_tenant_id, pessoa_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_conta ON analytics.atlas_pagar_recebers(arcadia_tenant_id, conta_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pr_venc ON analytics.atlas_pagar_recebers(arcadia_tenant_id, pago, data_vencimento);

-- Compras (NF entrada)
CREATE TABLE IF NOT EXISTS analytics.atlas_compras (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  fornecedor_id integer,
  empresa_id integer,
  status_id integer,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_frete numeric(16,2) DEFAULT 0,
  valor_ipi numeric(16,2) DEFAULT 0,
  valor_icms numeric(16,2) DEFAULT 0,
  valor_pis numeric(16,2) DEFAULT 0,
  valor_cofins numeric(16,2) DEFAULT 0,
  nota_fiscal varchar(255),
  natureza varchar(20),
  data_criacao timestamp,
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_comp_tenant ON analytics.atlas_compras(arcadia_tenant_id, data_criacao);
CREATE INDEX IF NOT EXISTS idx_atlas_comp_forn ON analytics.atlas_compras(arcadia_tenant_id, fornecedor_id);

-- Itens de compra
CREATE TABLE IF NOT EXISTS analytics.atlas_compra_produtos (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  compra_entrega_id integer,
  produto_id integer,
  quantidade numeric(16,2) DEFAULT 0,
  valor_unitario numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_cp_prod ON analytics.atlas_compra_produtos(arcadia_tenant_id, produto_id);

-- Movimentos de saída de estoque
CREATE TABLE IF NOT EXISTS analytics.atlas_saida_estoques (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  vendedor_id integer,
  empresa_id integer,
  data_saida timestamp,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  numero_nota_fiscal varchar(100),
  valor_icms numeric(16,2),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_se_tenant ON analytics.atlas_saida_estoques(arcadia_tenant_id, data_saida);

-- Itens de saída de estoque
CREATE TABLE IF NOT EXISTS analytics.atlas_produto_saida_estoques (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  saida_estoque_id integer,
  produto_id integer,
  quantidade numeric(16,2) DEFAULT 0,
  valor_unitario numeric(16,2) DEFAULT 0,
  valor_total numeric(16,2) DEFAULT 0,
  valor_custo numeric(16,2),
  devolvido boolean DEFAULT false,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_pse_saida ON analytics.atlas_produto_saida_estoques(arcadia_tenant_id, saida_estoque_id);
CREATE INDEX IF NOT EXISTS idx_atlas_pse_prod ON analytics.atlas_produto_saida_estoques(arcadia_tenant_id, produto_id);

-- Entradas de estoque (NF entrada)
CREATE TABLE IF NOT EXISTS analytics.atlas_entrada_estoques (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  fornecedor_id integer,
  empresa_id integer,
  compra_id integer,
  data_entrada timestamp,
  valor_produtos numeric(16,2) DEFAULT 0,
  valor_total_entrega numeric(16,2) DEFAULT 0,
  numero_nota_fiscal varchar(100),
  synced_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_ee_tenant ON analytics.atlas_entrada_estoques(arcadia_tenant_id, data_entrada);

-- Comissões de vendedores
CREATE TABLE IF NOT EXISTS analytics.atlas_comissoes (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  pedido_id integer,
  vendedor_id integer,
  empresa_id integer,
  valor numeric(16,2) DEFAULT 0,
  tipo varchar(50),
  ativo boolean DEFAULT true,
  data_prevista_pagamento timestamp,
  PRIMARY KEY (arcadia_tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_atlas_com_vend ON analytics.atlas_comissoes(arcadia_tenant_id, vendedor_id);

-- Status de entidades (dicionário de status)
CREATE TABLE IF NOT EXISTS analytics.atlas_status (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  nome varchar(255),
  cor varchar(50),
  entidade varchar(100),
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Transferências de estoque entre áreas
CREATE TABLE IF NOT EXISTS analytics.atlas_transferencias_estoque (
  id integer NOT NULL,
  arcadia_tenant_id varchar NOT NULL,
  produto_id integer,
  de_area_id integer,
  para_area_id integer,
  quantidade numeric(16,3) DEFAULT 0,
  empresa_id integer,
  created_at timestamp,
  PRIMARY KEY (arcadia_tenant_id, id)
);

-- Configuração de data sources Atlas por tenant
CREATE TABLE IF NOT EXISTS analytics.atlas_data_sources (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  arcadia_tenant_id varchar NOT NULL,
  atlas_tenant_id integer,
  mode varchar(20) NOT NULL DEFAULT 'dump',
  pg_host varchar(500),
  pg_port integer DEFAULT 5432,
  pg_database varchar(200),
  pg_user varchar(200),
  pg_password_encrypted text,
  pg_ssl boolean DEFAULT true,
  last_dump_filename varchar(500),
  last_dump_processed_at timestamp,
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

## ETAPA 2 — Criar `server/bi/connectors/atlasDumpConnector.ts`

```typescript
/**
 * Atlas Dump Connector — importa pg_dump SQL para analytics.atlas_*
 * Suporta: .sql direto, .zip contendo .sql, .gz
 */

import { db } from "../../db";
import { sql as drizzleSql } from "drizzle-orm";
import * as fs from "fs";
import * as readline from "readline";
import * as zlib from "zlib";
import * as crypto from "crypto";

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

// Mapeamento: tabela Atlas → tabela staging + colunas desejadas
const IMPORT_MAP: Record<string, { staging: string; cols: string[] }> = {
  pessoas: {
    staging: "analytics.atlas_pessoas",
    cols: ["id","tipo_pessoa","nome","nome_fantasia","razao_social","cpf_cnpj","email",
           "ativo","cliente","fornecedor","funcionario","categoria_id",
           "vendedor_responsavel_id","tabela_preco_id","tenant_id"],
  },
  contatos: {
    staging: "analytics.atlas_contatos",
    cols: ["id","pessoa_id","nome","telefone","email","padrao","tenant_id"],
  },
  enderecos: {
    staging: "analytics.atlas_enderecos",
    cols: ["id","pessoa_id","rua","cidade","bairro","cep","estado","padrao","tenant_id"],
  },
  produtos: {
    staging: "analytics.atlas_produtos",
    cols: ["id","codigo_comercial","codigo_barra","nome","apelido","saldo_estoque",
           "preco_venda","valor_custo","margem_lucro","marca_id","grupo_produto_id",
           "tipo_id","unidade_id","imposto_id","ativo","aplicacao","classificacao","tenant_id"],
  },
  marcas: {
    staging: "analytics.atlas_marcas",
    cols: ["id","nome","tenant_id"],
  },
  grupo_produtos: {
    staging: "analytics.atlas_grupos_produtos",
    cols: ["id","nome","tenant_id"],
  },
  modelos: {
    staging: "analytics.atlas_modelos",
    cols: ["id","nome","marca_id","tenant_id"],
  },
  produto_similares: {
    staging: "analytics.atlas_produto_similares",
    cols: ["id","produto_id","produto_similar_id","lista_similar_id"],
  },
  tabela_preco_produtos: {
    staging: "analytics.atlas_tabela_preco_produtos",
    cols: ["id","tabela_preco_id","produto_id","preco_custo","preco_venda",
           "margem_lucro","desconto_maximo","tenant_id"],
  },
  pedidos: {
    staging: "analytics.atlas_pedidos",
    cols: ["id","numero","cliente_id","funcionario_id","empresa_id","status_id",
           "origem_venda_id","data_pedido","valor_produtos","valor_total","valor_frete",
           "valor_ipi","numero_nota_fiscal","serie_nota_fiscal","data_emissao_nota_fiscal",
           "comissao_total_vendedor","comissao_percentual","motivo_cancelamento",
           "criado_consignado","tenant_id"],
  },
  pedido_produtos: {
    staging: "analytics.atlas_pedido_produtos",
    cols: ["id","pedido_id","produto_id","quantidade","valor_unitario","desconto",
           "valor_total","valor_custo","comissao_vendedor","comissao_percentual","tenant_id"],
  },
  conta: {
    staging: "analytics.atlas_contas",
    cols: ["id","nome","agencia","conta","tenant_id"],
  },
  forma_pagamentos: {
    staging: "analytics.atlas_forma_pagamentos",
    cols: ["id","nome","ativo","parcelavel","tenant_id"],
  },
  categoria_conta: {
    staging: "analytics.atlas_categoria_conta",
    cols: ["id","nome","tipo","financeiro_categoria_conta_pai_id",
           "tabela_financeiro_dre_id","tenant_id"],
  },
  dres: {
    staging: "analytics.atlas_dres",
    // dres não tem tenant_id — é global
    cols: ["id","nome","tipo","indice"],
  },
  pagar_recebers: {
    staging: "analytics.atlas_pagar_recebers",
    cols: ["id","tipo","descricao","categoria_conta_id","conta_id","pessoa_id",
           "forma_pagamento_id","empresa_id","tabela_pai","vinculo_espinha",
           "data_competencia","data_vencimento","data_pagamento","valor","valor_pago",
           "desconto","juros_multa","pago","ativo","extornado","tenant_id"],
  },
  compras: {
    staging: "analytics.atlas_compras",
    cols: ["id","fornecedor_id","empresa_id","status_id","valor_produtos","valor_total",
           "valor_frete","valor_ipi","valor_icms","valor_pis","valor_cofins",
           "nota_fiscal","natureza","data_criacao","tenant_id"],
  },
  compra_entrega_produtos: {
    staging: "analytics.atlas_compra_produtos",
    cols: ["id","compra_entrega_id","produto_distribuido","tenant_id"],
  },
  saida_estoques: {
    staging: "analytics.atlas_saida_estoques",
    cols: ["id","vendedor_id","empresa_id","data_saida","valor_produtos",
           "numero_nota_fiscal","valor_icms","tenant_id"],
  },
  produto_saida_estoques: {
    staging: "analytics.atlas_produto_saida_estoques",
    cols: ["id","saida_estoque_id","produto_id","quantidade","valor_unitario",
           "valor_total","valor_custo","devolvido","tenant_id"],
  },
  entrada_estoques: {
    staging: "analytics.atlas_entrada_estoques",
    cols: ["id","fornecedor_id","empresa_id","compra_id","data_entrada",
           "valor_produtos","valor_total_entrega","numero_nota_fiscal","tenant_id"],
  },
  comissao_vendedores: {
    staging: "analytics.atlas_comissoes",
    cols: ["id","pedido_id","vendedor_id","empresa_id","valor","tipo",
           "ativo","data_prevista_pagamento","tenant_id"],
  },
  status_entidades: {
    staging: "analytics.atlas_status",
    cols: ["id","nome","tenant_id"],
  },
  transferencia_estoques: {
    staging: "analytics.atlas_transferencias_estoque",
    cols: ["id","produto_id","de_area_estoque_id","para_area_estoque_id",
           "quantidade_transferir","empresa_id","createdAt","tenant_id"],
  },
};

function cleanValue(v: string): string {
  if (v === "\\N" || v === "" || v === "NULL") return "NULL";
  // Bool
  if (v === "t") return "true";
  if (v === "f") return "false";
  // Escape single quotes
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''").slice(0, 4000)}'`;
}

export async function importAtlasDump(opts: AtlasDumpOptions): Promise<AtlasDumpResult> {
  const start = Date.now();
  const result: AtlasDumpResult = { tables: {}, totalRows: 0, durationMs: 0 };

  if (!fs.existsSync(opts.filePath)) throw new Error(`Arquivo não encontrado: ${opts.filePath}`);

  // Build lookup of what each column maps to in the source COPY statement
  const parsed: Record<string, { cols: string[]; wantedIdx: number[]; rows: string[][] }> = {};

  let stream: NodeJS.ReadableStream = fs.createReadStream(opts.filePath, { encoding: "utf8" });
  if (opts.filePath.endsWith(".gz")) {
    stream = (fs.createReadStream(opts.filePath) as NodeJS.ReadableStream).pipe(zlib.createGunzip());
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let currentTable: string | null = null;
  let currentWanted: number[] = [];
  let currentWantedCols: string[] = [];

  for await (const line of rl) {
    const copyMatch = line.match(/^COPY public\.(\w+) \(([^)]+)\)/);
    if (copyMatch) {
      const tableName = copyMatch[1];
      const mapping = IMPORT_MAP[tableName];
      if (mapping) {
        currentTable = tableName;
        const srcCols = copyMatch[2].split(",").map(c => c.trim().replace(/"/g, ""));
        currentWanted = mapping.cols.map(w => srcCols.indexOf(w));
        currentWantedCols = mapping.cols;
        parsed[tableName] = { cols: currentWantedCols, wantedIdx: currentWanted, rows: [] };
      } else {
        currentTable = null;
      }
      continue;
    }
    if (line === "\\.") { currentTable = null; continue; }
    if (currentTable && parsed[currentTable]) {
      const values = line.split("\t");
      const row = currentWanted.map(idx => idx >= 0 ? (values[idx] ?? "\\N") : "\\N");
      parsed[currentTable].rows.push(row);
    }
  }

  // Upsert into staging tables
  const BATCH = 300;

  for (const [atlasTable, mapping] of Object.entries(IMPORT_MAP)) {
    const data = parsed[atlasTable];
    if (!data || data.rows.length === 0) {
      result.tables[atlasTable] = { rows: 0, status: "ok" };
      continue;
    }

    const { staging, cols } = mapping;
    const hasTenantId = cols.includes("tenant_id");

    // Build staging column list
    const stagingCols = hasTenantId
      ? ["arcadia_tenant_id", "atlas_tenant_id", ...cols.filter(c => c !== "tenant_id")]
      : ["arcadia_tenant_id", ...cols];

    const conflictTarget = '("arcadia_tenant_id", "id")';
    const updateSet = stagingCols
      .filter(c => c !== "arcadia_tenant_id" && c !== "id")
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");
    const colList = stagingCols.map(c => `"${c}"`).join(", ");

    let inserted = 0;
    try {
      for (let i = 0; i < data.rows.length; i += BATCH) {
        const batch = data.rows.slice(i, i + BATCH);
        const tenantColIdx = cols.indexOf("tenant_id");

        const values = batch
          .map(row => {
            // Filter by atlas tenant if specified
            if (opts.atlaseTenantId && tenantColIdx >= 0) {
              const tv = row[tenantColIdx];
              if (tv !== "\\N" && tv !== "NULL" && parseInt(tv) !== opts.atlaseTenantId) return null;
            }

            const rowVals: string[] = [`'${opts.arcadiaTenantId}'`];
            if (hasTenantId) {
              rowVals.push(cleanValue(tenantColIdx >= 0 ? row[tenantColIdx] : "\\N"));
            }
            for (let ci = 0; ci < cols.length; ci++) {
              if (cols[ci] === "tenant_id") continue;
              rowVals.push(cleanValue(row[ci] ?? "\\N"));
            }
            return `(${rowVals.join(",")})`;
          })
          .filter(Boolean) as string[];

        if (values.length === 0) continue;

        await db.execute(drizzleSql.raw(`
          INSERT INTO ${staging} (${colList}, synced_at)
          VALUES ${values.map(v => v.replace(/\)$/, ", NOW()")).join(",\n")}
          ON CONFLICT ${conflictTarget}
          DO UPDATE SET ${updateSet}, synced_at = NOW()
        `));
        inserted += values.length;
      }

      result.tables[atlasTable] = { rows: inserted, status: "ok" };
      result.totalRows += inserted;
      console.log(`[atlas-dump] ${atlasTable} → ${inserted} rows`);
    } catch (err: any) {
      result.tables[atlasTable] = { rows: 0, status: "error", error: err.message };
      console.error(`[atlas-dump] Error on ${atlasTable}:`, err.message.slice(0, 200));
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
```

---

## ETAPA 3 — ETL completo `server/bi/etl/atlasEtl.ts`

```typescript
/**
 * Atlas ETL — transforma staging analytics.atlas_* em fact_*
 *
 * Fact tables populadas:
 *   analytics.fact_revenue     ← atlas_pagar_recebers (todos os lançamentos)
 *   analytics.fact_crm         ← atlas_pedidos (pipeline de vendas)
 *   analytics.fact_atlas_products ← atlas_produto_saida_estoques × atlas_produtos
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
  const tid = arcadiaTenantId;

  // ── 1. fact_revenue ← pagar_recebers ────────────────────────────────────
  try {
    const res = await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.fact_revenue (
        id, tenant_id, source_data_source_id, natural_key,
        client_natural_key, period, amount, category, status, payload, ingested_at
      )
      SELECT
        gen_random_uuid(),
        '${tid}',
        'atlas',
        'atlas-pr-' || pr.id::text,
        pr.pessoa_id::text,
        COALESCE(pr.data_competencia, pr.data_vencimento)::date,
        CASE
          WHEN pr.tipo IN ('C','R') THEN ABS(pr.valor)
          ELSE -ABS(pr.valor)
        END,
        COALESCE(cc.nome, pr.descricao, 'Sem categoria'),
        CASE
          WHEN pr.extornado THEN 'extornado'
          WHEN pr.pago THEN 'pago'
          WHEN pr.data_vencimento < NOW() AND NOT pr.pago THEN 'vencido'
          ELSE 'pendente'
        END,
        jsonb_build_object(
          'atlas_id', pr.id,
          'tipo', pr.tipo,
          'tabela_pai', pr.tabela_pai,
          'conta_id', pr.conta_id,
          'forma_pagamento_id', pr.forma_pagamento_id,
          'empresa_id', pr.empresa_id,
          'dre_id', cc_dre.dre_id,
          'dre_nome', d.nome
        ),
        NOW()
      FROM analytics.atlas_pagar_recebers pr
      LEFT JOIN analytics.atlas_categoria_conta cc
             ON cc.id = pr.categoria_conta_id AND cc.arcadia_tenant_id = pr.arcadia_tenant_id
      LEFT JOIN analytics.atlas_categoria_conta cc_dre
             ON cc_dre.id = pr.categoria_conta_id AND cc_dre.arcadia_tenant_id = pr.arcadia_tenant_id
      LEFT JOIN analytics.atlas_dres d
             ON d.id = cc_dre.dre_id AND d.arcadia_tenant_id = pr.arcadia_tenant_id
      WHERE pr.arcadia_tenant_id = '${tid}'
        AND pr.ativo = true
        AND pr.extornado = false
        AND COALESCE(pr.data_competencia, pr.data_vencimento) IS NOT NULL
      ON CONFLICT (tenant_id, source_data_source_id, natural_key)
      DO UPDATE SET
        amount   = EXCLUDED.amount,
        status   = EXCLUDED.status,
        category = EXCLUDED.category,
        payload  = EXCLUDED.payload,
        ingested_at = NOW()
    `));
    revenue = (res as any).rowCount ?? 0;
    console.log(`[atlas-etl] fact_revenue: ${revenue} rows`);
  } catch (err: any) {
    errors.push(`fact_revenue: ${err.message}`);
    console.error("[atlas-etl] fact_revenue error:", err.message.slice(0, 300));
  }

  // ── 2. fact_crm ← pedidos ────────────────────────────────────────────────
  try {
    const res = await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.fact_crm (
        id, tenant_id, opportunity_id, client_natural_key,
        stage, value, probability, expected_close, status, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        '${tid}',
        'atlas-ped-' || p.id::text,
        p.cliente_id::text,
        COALESCE(s.nome,
          CASE p.status_id
            WHEN 14 THEN 'Entregue'
            WHEN 15 THEN 'Cancelado'
            ELSE 'Em andamento'
          END
        ),
        COALESCE(p.valor_total, 0),
        CASE p.status_id
          WHEN 14 THEN 100
          WHEN 15 THEN 0
          ELSE 60
        END,
        COALESCE(p.data_emissao_nota_fiscal, p.data_pedido)::date,
        CASE p.status_id
          WHEN 14 THEN 'won'
          WHEN 15 THEN 'lost'
          ELSE 'open'
        END,
        COALESCE(p.data_pedido::date, NOW()::date),
        NOW()
      FROM analytics.atlas_pedidos p
      LEFT JOIN analytics.atlas_status s
             ON s.id = p.status_id AND s.arcadia_tenant_id = p.arcadia_tenant_id
      WHERE p.arcadia_tenant_id = '${tid}'
        AND p.data_pedido IS NOT NULL
      ON CONFLICT (tenant_id, opportunity_id)
      DO UPDATE SET
        stage       = EXCLUDED.stage,
        value       = EXCLUDED.value,
        status      = EXCLUDED.status,
        probability = EXCLUDED.probability,
        updated_at  = NOW()
    `));
    crm = (res as any).rowCount ?? 0;
    console.log(`[atlas-etl] fact_crm: ${crm} rows`);
  } catch (err: any) {
    errors.push(`fact_crm: ${err.message}`);
    console.error("[atlas-etl] fact_crm error:", err.message.slice(0, 300));
  }

  // ── 3. fact_atlas_products (novo) — giro de produto ─────────────────────
  try {
    // Criar a tabela se não existir
    await db.execute(drizzleSql.raw(`
      CREATE TABLE IF NOT EXISTS analytics.fact_atlas_products (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        produto_id integer NOT NULL,
        produto_nome varchar(500),
        codigo_comercial varchar(255),
        marca_id integer,
        marca_nome varchar(255),
        grupo_id integer,
        grupo_nome varchar(255),
        mes date NOT NULL,
        qtd_vendida numeric(16,2) DEFAULT 0,
        receita_venda numeric(16,2) DEFAULT 0,
        custo_total numeric(16,2) DEFAULT 0,
        margem_valor numeric(16,2) DEFAULT 0,
        qtd_pedidos integer DEFAULT 0,
        saldo_estoque numeric(16,3) DEFAULT 0,
        ingested_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fap_tenant_mes ON analytics.fact_atlas_products(tenant_id, mes);
      CREATE INDEX IF NOT EXISTS idx_fap_produto ON analytics.fact_atlas_products(tenant_id, produto_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_fap_produto_mes ON analytics.fact_atlas_products(tenant_id, produto_id, mes);
    `));

    const res = await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.fact_atlas_products (
        tenant_id, produto_id, produto_nome, codigo_comercial,
        marca_id, marca_nome, grupo_id, grupo_nome,
        mes, qtd_vendida, receita_venda, custo_total, margem_valor,
        qtd_pedidos, saldo_estoque, ingested_at
      )
      SELECT
        '${tid}',
        pp.produto_id,
        COALESCE(pr.nome, pr.apelido, 'Produto ' || pp.produto_id::text),
        pr.codigo_comercial,
        pr.marca_id,
        m.nome,
        pr.grupo_produto_id,
        g.nome,
        date_trunc('month', ped.data_pedido)::date,
        SUM(pp.quantidade),
        SUM(pp.valor_total),
        SUM(pp.quantidade * COALESCE(pp.valor_custo, pr.valor_custo, 0)),
        SUM(pp.valor_total) - SUM(pp.quantidade * COALESCE(pp.valor_custo, pr.valor_custo, 0)),
        COUNT(DISTINCT pp.pedido_id),
        MAX(pr.saldo_estoque),
        NOW()
      FROM analytics.atlas_pedido_produtos pp
      JOIN analytics.atlas_pedidos ped
        ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
      LEFT JOIN analytics.atlas_produtos pr
        ON pr.id = pp.produto_id AND pr.arcadia_tenant_id = pp.arcadia_tenant_id
      LEFT JOIN analytics.atlas_marcas m
        ON m.id = pr.marca_id AND m.arcadia_tenant_id = pr.arcadia_tenant_id
      LEFT JOIN analytics.atlas_grupos_produtos g
        ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
      WHERE pp.arcadia_tenant_id = '${tid}'
        AND ped.status_id = 14
        AND ped.data_pedido IS NOT NULL
      GROUP BY pp.produto_id, pr.nome, pr.apelido, pr.codigo_comercial,
               pr.marca_id, m.nome, pr.grupo_produto_id, g.nome,
               date_trunc('month', ped.data_pedido)::date, pr.saldo_estoque
      ON CONFLICT (tenant_id, produto_id, mes)
      DO UPDATE SET
        qtd_vendida   = EXCLUDED.qtd_vendida,
        receita_venda = EXCLUDED.receita_venda,
        custo_total   = EXCLUDED.custo_total,
        margem_valor  = EXCLUDED.margem_valor,
        qtd_pedidos   = EXCLUDED.qtd_pedidos,
        ingested_at   = NOW()
    `));
    products = (res as any).rowCount ?? 0;
    console.log(`[atlas-etl] fact_atlas_products: ${products} rows`);
  } catch (err: any) {
    errors.push(`fact_atlas_products: ${err.message}`);
    console.error("[atlas-etl] fact_atlas_products error:", err.message.slice(0, 300));
  }

  // ── 4. Atualizar dim_client com pessoas do Atlas ─────────────────────────
  try {
    await db.execute(drizzleSql.raw(`
      INSERT INTO analytics.dim_client (
        sk, tenant_id, source_data_source_id, natural_key,
        name, document, status, valid_from, is_current
      )
      SELECT
        gen_random_uuid(),
        '${tid}',
        'atlas',
        p.id::text,
        COALESCE(p.nome_fantasia, p.razao_social, p.nome),
        p.cpf_cnpj,
        CASE WHEN p.ativo THEN 'active' ELSE 'inactive' END,
        NOW(),
        1
      FROM analytics.atlas_pessoas p
      WHERE p.arcadia_tenant_id = '${tid}'
        AND p.cliente = true
      ON CONFLICT DO NOTHING
    `));
  } catch (err: any) {
    errors.push(`dim_client: ${err.message}`);
  }

  await invalidateTenantCache(arcadiaTenantId);
  return { revenue, crm, products, errors };
}
```

---

## ETAPA 4 — Semantic Layer Atlas expandida `server/bi/semantic/atlas.ts`

```typescript
import type { SemanticContext, SemanticMetric } from "./types";
import { quoteIdent, dateRangeClause } from "./sqlHelpers";

export const metrics: SemanticMetric[] = [

  // ══ RECEITA / VENDAS ══════════════════════════════════════════════════════
  {
    id: "atlas.receita_por_periodo",
    label: "Receita de vendas por mês",
    description: "Pedidos entregues (status=14) agrupados por mês.",
    module: "atlas",
    defaultWidget: "area_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', data_pedido), 'YYYY-MM') AS name,
             SUM(valor_total)::float AS value
        FROM analytics.atlas_pedidos
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND status_id = 14
         ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1
    `}),
  },

  {
    id: "atlas.receita_vs_custo_por_mes",
    label: "Receita vs Custo por mês",
    description: "Comparativo receita bruta vs custo total dos produtos vendidos.",
    module: "atlas",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(mes, 'YYYY-MM') AS name,
             SUM(receita_venda)::float AS value,
             SUM(custo_total)::float AS series
        FROM analytics.fact_atlas_products
       WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1
    `, freeform: true }),
  },

  {
    id: "atlas.ticket_medio",
    label: "Ticket médio de pedidos",
    description: "Valor médio por pedido entregue.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Ticket médio' AS name,
             ROUND(AVG(valor_total),2)::float AS value
        FROM analytics.atlas_pedidos
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND status_id = 14
         ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
    `}),
  },

  {
    id: "atlas.total_pedidos",
    label: "Total de pedidos entregues",
    description: "Quantidade de pedidos com status 'Entregue'.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Total pedidos' AS name,
             COUNT(*)::float AS value
        FROM analytics.atlas_pedidos
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND status_id = 14
         ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
    `}),
  },

  {
    id: "atlas.receita_por_vendedor",
    label: "Receita por vendedor",
    description: "Receita de pedidos entregues agrupada por funcionário/vendedor.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(v.nome_fantasia, v.nome, 'Vendedor ' || p.funcionario_id::text) AS name,
             SUM(p.valor_total)::float AS value
        FROM analytics.atlas_pedidos p
        LEFT JOIN analytics.atlas_pessoas v
               ON v.id = p.funcionario_id AND v.arcadia_tenant_id = p.arcadia_tenant_id
       WHERE p.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND p.status_id = 14
         ${dateRangeClause("p.data_pedido", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.pedidos_por_status",
    label: "Pedidos por status",
    description: "Distribuição de todos os pedidos por status atual.",
    module: "atlas",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(s.nome, 'Status ' || p.status_id::text) AS name,
             COUNT(*)::float AS value
        FROM analytics.atlas_pedidos p
        LEFT JOIN analytics.atlas_status s
               ON s.id = p.status_id AND s.arcadia_tenant_id = p.arcadia_tenant_id
       WHERE p.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("p.data_pedido", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC
    `}),
  },

  // ══ CLIENTES ══════════════════════════════════════════════════════════════
  {
    id: "atlas.top_clientes",
    label: "Top 15 clientes por receita",
    description: "Clientes com maior volume de compras.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Cliente ' || ped.cliente_id::text) AS name,
             SUM(ped.valor_total)::float AS value
        FROM analytics.atlas_pedidos ped
        LEFT JOIN analytics.atlas_pessoas p
               ON p.id = ped.cliente_id AND p.arcadia_tenant_id = ped.arcadia_tenant_id
       WHERE ped.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND ped.status_id = 14
         ${dateRangeClause("ped.data_pedido", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 15
    `}),
  },

  {
    id: "atlas.novos_clientes_por_mes",
    label: "Novos clientes por mês",
    description: "Clientes com primeiro pedido no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', primeiro_pedido), 'YYYY-MM') AS name,
             COUNT(DISTINCT cliente_id)::float AS value
        FROM (
          SELECT cliente_id, MIN(data_pedido) AS primeiro_pedido
            FROM analytics.atlas_pedidos
           WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
             AND status_id = 14
           GROUP BY cliente_id
        ) t
       WHERE primeiro_pedido IS NOT NULL
         ${dateRangeClause("primeiro_pedido", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1
    `}),
  },

  {
    id: "atlas.total_clientes_ativos",
    label: "Total de clientes ativos",
    description: "Clientes com ao menos 1 pedido entregue.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Clientes ativos' AS name,
             COUNT(DISTINCT cliente_id)::float AS value
        FROM analytics.atlas_pedidos
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND status_id = 14
         ${dateRangeClause("data_pedido", ctx.startDate, ctx.endDate)}
    `}),
  },

  {
    id: "atlas.total_fornecedores",
    label: "Total de fornecedores",
    description: "Fornecedores cadastrados e ativos.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Fornecedores' AS name, COUNT(*)::float AS value
        FROM analytics.atlas_pessoas
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND fornecedor = true AND ativo = true
    `}),
  },

  // ══ PRODUTOS / ESTOQUE ════════════════════════════════════════════════════
  {
    id: "atlas.top_produtos_vendidos",
    label: "Top 20 produtos por quantidade",
    description: "Produtos mais vendidos por quantidade no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(produto_nome, 'Produto ' || produto_id::text) AS name,
             SUM(qtd_vendida)::float AS value
        FROM analytics.fact_atlas_products
       WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
       GROUP BY produto_id, produto_nome ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.top_produtos_receita",
    label: "Top 20 produtos por receita",
    description: "Produtos que mais geraram receita no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(produto_nome, 'Produto ' || produto_id::text) AS name,
             SUM(receita_venda)::float AS value
        FROM analytics.fact_atlas_products
       WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
       GROUP BY produto_id, produto_nome ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.margem_por_produto",
    label: "Margem bruta por produto (Top 20)",
    description: "Margem bruta percentual por produto: (receita - custo) / receita.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(produto_nome, 'Produto ' || produto_id::text) AS name,
             ROUND(100.0 * SUM(margem_valor) / NULLIF(SUM(receita_venda),0), 2)::float AS value
        FROM analytics.fact_atlas_products
       WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         AND receita_venda > 0
         ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
       GROUP BY produto_id, produto_nome ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.margem_total",
    label: "Margem bruta total (%)",
    description: "Margem bruta percentual agregada de todos os produtos vendidos.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Margem bruta' AS name,
             ROUND(100.0 * SUM(margem_valor) / NULLIF(SUM(receita_venda),0), 2)::float AS value
        FROM analytics.fact_atlas_products
       WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
    `}),
  },

  {
    id: "atlas.curva_abc_produtos",
    label: "Curva ABC de produtos",
    description: "Classificação A/B/C: A=80% receita, B=15%, C=5%.",
    module: "atlas",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx) => ({ sql: `
      WITH pr AS (
        SELECT produto_id, SUM(receita_venda) AS rec
          FROM analytics.fact_atlas_products
         WHERE tenant_id = ${quoteIdent(ctx.tenantId)}
           ${dateRangeClause("mes", ctx.startDate, ctx.endDate)}
         GROUP BY produto_id
      ),
      ranked AS (
        SELECT produto_id, rec,
               SUM(rec) OVER() AS total,
               SUM(rec) OVER(ORDER BY rec DESC) AS acum
          FROM pr
      )
      SELECT CASE
               WHEN acum/total <= 0.80 THEN 'A — Alto giro (80%)'
               WHEN acum/total <= 0.95 THEN 'B — Médio giro (15%)'
               ELSE 'C — Baixo giro (5%)'
             END AS name,
             COUNT(*)::float AS value
        FROM ranked GROUP BY 1 ORDER BY 1
    `}),
  },

  {
    id: "atlas.estoque_por_grupo",
    label: "Saldo de estoque por grupo",
    description: "Saldo atual de estoque (unidades) por grupo de produto.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(g.nome, 'Sem grupo') AS name,
             SUM(pr.saldo_estoque)::float AS value
        FROM analytics.atlas_produtos pr
        LEFT JOIN analytics.atlas_grupos_produtos g
               ON g.id = pr.grupo_produto_id AND g.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.ativo = true
       GROUP BY 1 ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.estoque_por_marca",
    label: "Saldo de estoque por marca",
    description: "Saldo atual agrupado por marca.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(m.nome, 'Sem marca') AS name,
             SUM(pr.saldo_estoque)::float AS value
        FROM analytics.atlas_produtos pr
        LEFT JOIN analytics.atlas_marcas m
               ON m.id = pr.marca_id AND m.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.ativo = true
       GROUP BY 1 ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.produtos_sem_giro",
    label: "Produtos sem giro (90 dias)",
    description: "Quantidade de produtos com estoque > 0 mas sem venda nos últimos 90 dias.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 3600,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Sem giro 90d' AS name,
             COUNT(*)::float AS value
        FROM analytics.atlas_produtos pr
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.saldo_estoque > 0
         AND pr.ativo = true
         AND NOT EXISTS (
           SELECT 1 FROM analytics.atlas_pedido_produtos pp
             JOIN analytics.atlas_pedidos ped
               ON ped.id = pp.pedido_id AND ped.arcadia_tenant_id = pp.arcadia_tenant_id
            WHERE pp.produto_id = pr.id
              AND pp.arcadia_tenant_id = pr.arcadia_tenant_id
              AND ped.status_id = 14
              AND ped.data_pedido >= NOW() - INTERVAL '90 days'
         )
    `}),
  },

  // ══ FINANCEIRO ════════════════════════════════════════════════════════════
  {
    id: "atlas.lancamentos_por_categoria",
    label: "Lançamentos por categoria de conta",
    description: "Receitas e despesas por categoria — estrutura DRE.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(cc.nome, pr.descricao, 'Sem categoria') AS name,
             SUM(CASE WHEN pr.tipo IN ('C','R') THEN ABS(pr.valor) ELSE -ABS(pr.valor) END)::float AS value
        FROM analytics.atlas_pagar_recebers pr
        LEFT JOIN analytics.atlas_categoria_conta cc
               ON cc.id = pr.categoria_conta_id AND cc.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.ativo = true AND pr.extornado = false
         ${dateRangeClause("pr.data_competencia", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 20
    `}),
  },

  {
    id: "atlas.dre_por_linha",
    label: "DRE por linha (estrutura Atlas)",
    description: "DRE gerencial seguindo a estrutura de categorias do Atlas.",
    module: "atlas",
    defaultWidget: "waterfall_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(d.nome, 'Sem DRE') AS name,
             SUM(CASE WHEN pr.tipo IN ('C','R') THEN ABS(pr.valor) ELSE -ABS(pr.valor) END)::float AS value
        FROM analytics.atlas_pagar_recebers pr
        LEFT JOIN analytics.atlas_categoria_conta cc
               ON cc.id = pr.categoria_conta_id AND cc.arcadia_tenant_id = pr.arcadia_tenant_id
        LEFT JOIN analytics.atlas_dres d ON d.id = cc.dre_id AND d.arcadia_tenant_id = cc.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.ativo = true AND pr.extornado = false
         AND cc.dre_id IS NOT NULL
         ${dateRangeClause("pr.data_competencia", ctx.startDate, ctx.endDate)}
       GROUP BY d.indice, d.nome ORDER BY d.indice
    `}),
  },

  {
    id: "atlas.fluxo_caixa_por_conta",
    label: "Fluxo por conta bancária",
    description: "Entradas e saídas por conta bancária no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(c.nome, 'Conta ' || pr.conta_id::text) AS name,
             SUM(CASE WHEN pr.tipo IN ('C','R') THEN pr.valor_pago ELSE -pr.valor_pago END)::float AS value
        FROM analytics.atlas_pagar_recebers pr
        LEFT JOIN analytics.atlas_contas c
               ON c.id = pr.conta_id AND c.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.pago = true
         ${dateRangeClause("pr.data_pagamento", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC
    `}),
  },

  {
    id: "atlas.inadimplencia_valor",
    label: "Inadimplência — valor em atraso",
    description: "Total de recebíveis vencidos não pagos.",
    module: "atlas",
    defaultWidget: "kpi_card",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT 'Inadimplência' AS name,
             COALESCE(SUM(valor - COALESCE(valor_pago,0)), 0)::float AS value
        FROM analytics.atlas_pagar_recebers
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND tipo IN ('C','R')
         AND pago = false AND ativo = true AND extornado = false
         AND data_vencimento < NOW()
    `}),
  },

  {
    id: "atlas.inadimplencia_por_cliente",
    label: "Inadimplência por cliente (Top 15)",
    description: "Clientes com maior valor em atraso.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Cliente ' || pr.pessoa_id::text) AS name,
             SUM(pr.valor - COALESCE(pr.valor_pago,0))::float AS value
        FROM analytics.atlas_pagar_recebers pr
        LEFT JOIN analytics.atlas_pessoas p
               ON p.id = pr.pessoa_id AND p.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.tipo IN ('C','R')
         AND pr.pago = false AND pr.ativo = true AND pr.extornado = false
         AND pr.data_vencimento < NOW()
       GROUP BY 1 ORDER BY value DESC LIMIT 15
    `}),
  },

  {
    id: "atlas.contas_a_receber_por_vencimento",
    label: "Contas a receber por vencimento",
    description: "Previsão de recebimentos por mês de vencimento.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
             SUM(valor - COALESCE(valor_pago,0))::float AS value
        FROM analytics.atlas_pagar_recebers
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND tipo IN ('C','R')
         AND pago = false AND ativo = true AND extornado = false
         AND data_vencimento >= CURRENT_DATE
         ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1 LIMIT 12
    `}),
  },

  {
    id: "atlas.contas_a_pagar_por_vencimento",
    label: "Contas a pagar por vencimento",
    description: "Previsão de pagamentos por mês de vencimento.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', data_vencimento), 'YYYY-MM') AS name,
             SUM(valor - COALESCE(valor_pago,0))::float AS value
        FROM analytics.atlas_pagar_recebers
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND tipo = 'D'
         AND pago = false AND ativo = true AND extornado = false
         AND data_vencimento >= CURRENT_DATE
         ${dateRangeClause("data_vencimento", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1 LIMIT 12
    `}),
  },

  {
    id: "atlas.despesas_por_categoria",
    label: "Despesas por categoria",
    description: "Breakdown das despesas por categoria de conta.",
    module: "atlas",
    defaultWidget: "pie_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(cc.nome, 'Sem categoria') AS name,
             SUM(ABS(pr.valor))::float AS value
        FROM analytics.atlas_pagar_recebers pr
        LEFT JOIN analytics.atlas_categoria_conta cc
               ON cc.id = pr.categoria_conta_id AND cc.arcadia_tenant_id = pr.arcadia_tenant_id
       WHERE pr.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND pr.tipo = 'D'
         AND pr.ativo = true AND pr.extornado = false
         ${dateRangeClause("pr.data_competencia", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 15
    `}),
  },

  {
    id: "atlas.receita_despesa_por_mes",
    label: "Receita vs Despesa por mês",
    description: "Comparativo mensal entre receitas e despesas lançadas.",
    module: "atlas",
    defaultWidget: "mixed_timeseries",
    cacheTtlSeconds: 300,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', data_competencia), 'YYYY-MM') AS name,
             SUM(CASE WHEN tipo IN ('C','R') THEN valor ELSE 0 END)::float AS value,
             SUM(CASE WHEN tipo = 'D' THEN ABS(valor) ELSE 0 END)::float AS series
        FROM analytics.atlas_pagar_recebers
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND ativo = true AND extornado = false
         ${dateRangeClause("data_competencia", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1
    `, freeform: true }),
  },

  // ══ COMPRAS ═══════════════════════════════════════════════════════════════
  {
    id: "atlas.compras_por_mes",
    label: "Compras por mês",
    description: "Volume total de compras (NF entrada) por mês.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT to_char(date_trunc('month', data_criacao), 'YYYY-MM') AS name,
             SUM(valor_total)::float AS value
        FROM analytics.atlas_compras
       WHERE arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("data_criacao", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY 1
    `}),
  },

  {
    id: "atlas.top_fornecedores",
    label: "Top 15 fornecedores por volume comprado",
    description: "Fornecedores com maior volume de compras no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(p.nome_fantasia, p.nome, p.razao_social, 'Fornecedor ' || c.fornecedor_id::text) AS name,
             SUM(c.valor_total)::float AS value
        FROM analytics.atlas_compras c
        LEFT JOIN analytics.atlas_pessoas p
               ON p.id = c.fornecedor_id AND p.arcadia_tenant_id = c.arcadia_tenant_id
       WHERE c.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         ${dateRangeClause("c.data_criacao", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 15
    `}),
  },

  // ══ COMISSÕES ═════════════════════════════════════════════════════════════
  {
    id: "atlas.comissoes_por_vendedor",
    label: "Comissões por vendedor",
    description: "Total de comissões geradas por vendedor no período.",
    module: "atlas",
    defaultWidget: "bar_chart",
    cacheTtlSeconds: 600,
    buildQuery: (ctx) => ({ sql: `
      SELECT COALESCE(p.nome_fantasia, p.nome, 'Vendedor ' || c.vendedor_id::text) AS name,
             SUM(c.valor)::float AS value
        FROM analytics.atlas_comissoes c
        LEFT JOIN analytics.atlas_pessoas p
               ON p.id = c.vendedor_id AND p.arcadia_tenant_id = c.arcadia_tenant_id
       WHERE c.arcadia_tenant_id = ${quoteIdent(ctx.tenantId)}
         AND c.ativo = true
         ${dateRangeClause("c.data_prevista_pagamento", ctx.startDate, ctx.endDate)}
       GROUP BY 1 ORDER BY value DESC LIMIT 20
    `}),
  },

];
```

---

## ETAPA 5 — Alertas automáticos `server/bi/atlasAlerts.ts`

```typescript
/**
 * Alertas predefinidos para o Atlas ERP.
 * Inserir no banco ao registrar um data source Atlas.
 * Cron runner verifica diariamente às 8h.
 */

export const ATLAS_DEFAULT_ALERTS = [
  {
    name: "Inadimplência alta (> R$ 5.000)",
    metricId: "atlas.inadimplencia_valor",
    condition: "gt" as const,
    threshold: 5000,
    notifyChannel: "email",
    cronExpression: "0 8 * * *",
  },
  {
    name: "Margem bruta abaixo de 20%",
    metricId: "atlas.margem_total",
    condition: "lt" as const,
    threshold: 20,
    notifyChannel: "email",
    cronExpression: "0 8 * * 1", // toda segunda
  },
  {
    name: "Produtos sem giro (> 50 itens parados)",
    metricId: "atlas.produtos_sem_giro",
    condition: "gt" as const,
    threshold: 50,
    notifyChannel: "email",
    cronExpression: "0 8 * * 1",
  },
  {
    name: "Ticket médio abaixo de R$ 100",
    metricId: "atlas.ticket_medio",
    condition: "lt" as const,
    threshold: 100,
    notifyChannel: "email",
    cronExpression: "0 8 1 * *", // todo dia 1 do mês
  },
];

export async function installAtlasDefaultAlerts(
  tenantId: string,
  userId: string | null,
  db: any,
  biAlertsTable: any,
): Promise<void> {
  for (const alert of ATLAS_DEFAULT_ALERTS) {
    try {
      await db.insert(biAlertsTable).values({
        tenantId,
        name: alert.name,
        metricId: alert.metricId,
        condition: alert.condition,
        threshold: String(alert.threshold),
        notifyChannel: alert.notifyChannel,
        cronExpression: alert.cronExpression,
        notifyTargets: [],
        isActive: 1,
        createdById: userId,
      }).onConflictDoNothing();
    } catch (_) {}
  }
}
```

---

## ETAPA 6 — Registrar módulo atlas no index semântico

### `server/bi/semantic/index.ts`

Adicionar:
```typescript
import * as atlas from "./atlas";
// No array MODULES:
const MODULES = [control, migration, dq, crm, hr, scrum, societario, recovery, fiscal, atlas];
```

---

## ETAPA 7 — Rotas completas no `server/routes.ts`

```typescript
// ── DatasetAtlas — CRUD data sources ───────────────────────────────────────
app.post("/api/atlas/data-sources", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const { mode = "dump", atlasaTenantId, pgHost, pgPort, pgDatabase, pgUser, pgPassword, pgSsl } = req.body;
    let pgPasswordEncrypted: string | null = null;
    if (pgPassword) {
      const { cryptoService } = await import("./cryptoService");
      pgPasswordEncrypted = await cryptoService.encryptConfig(pgPassword);
    }
    const id = crypto.randomUUID();
    await db.execute(sql.raw(`
      INSERT INTO analytics.atlas_data_sources
        (id, arcadia_tenant_id, atlas_tenant_id, mode, pg_host, pg_port,
         pg_database, pg_user, pg_password_encrypted, pg_ssl, is_active)
      VALUES ('${id}', '${req.tenantId}', ${atlasaTenantId ?? 'NULL'},
        '${mode}', ${pgHost ? `'${pgHost}'` : 'NULL'}, ${pgPort ?? 5432},
        ${pgDatabase ? `'${pgDatabase}'` : 'NULL'}, ${pgUser ? `'${pgUser}'` : 'NULL'},
        ${pgPasswordEncrypted ? `'${pgPasswordEncrypted}'` : 'NULL'},
        ${pgSsl ? 'true' : 'false'}, 1)
    `));
    res.status(201).json({ id, message: "Conexão Atlas criada" });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
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

// Upload dump via multipart
app.post("/api/atlas/sync/dump-upload/:dataSourceId",
  isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const multer = (await import("multer")).default;
    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");
    const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 700 * 1024 * 1024 } });

    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res as any, (err) => err ? reject(err) : resolve());
    });

    if (!req.file) return res.status(400).json({ message: "Arquivo não enviado" });

    let filePath = req.file.path;
    const origName: string = req.file.originalname ?? "";

    if (origName.endsWith(".zip")) {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries().filter((e: any) => e.entryName.endsWith(".sql"));
      if (entries.length === 0) return res.status(400).json({ message: "ZIP sem .sql" });
      zip.extractEntryTo(entries[0], os.tmpdir(), false, true);
      filePath = path.join(os.tmpdir(), entries[0].entryName.split("/").pop()!);
    }

    const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
    const importResult = await importAtlasDump({
      filePath,
      arcadiaTenantId: req.tenantId!,
    });

    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    fs.unlink(filePath, () => {});
    if (req.file.path !== filePath) fs.unlink(req.file.path, () => {});

    await db.execute(sql.raw(`
      UPDATE analytics.atlas_data_sources
         SET last_sync_at = NOW(), last_sync_status = 'success',
             last_dump_filename = '${origName.replace(/'/g,'')}',
             sync_rows_total = ${importResult.totalRows},
             updated_at = NOW()
       WHERE arcadia_tenant_id = '${req.tenantId}' AND id = '${req.params.dataSourceId}'
    `));

    res.json({ import: importResult, etl: etlResult });
  } catch (err: any) {
    console.error("[atlas/dump-upload]", err);
    res.status(500).json({ message: err.message });
  }
});

// Import via URL externa (Dropbox, S3, etc.)
app.post("/api/atlas/sync/dump-url/:dataSourceId",
  isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ message: "url required" });
    const parsed = new URL(url);
    if (!["http:","https:"].includes(parsed.protocol))
      return res.status(400).json({ message: "URL deve ser http/https" });

    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");

    const tmpFile = path.join(os.tmpdir(), `atlas_${Date.now()}.download`);

    // Streaming download with redirect follow
    await new Promise<void>((resolve, reject) => {
      const get = (u: string) => {
        const proto = u.startsWith("https") ? require("https") : require("http");
        proto.get(u, (r: any) => {
          if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) {
            return get(r.headers.location);
          }
          const file = fs.createWriteStream(tmpFile);
          r.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
      };
      get(url);
    });

    let filePath = tmpFile;
    const stat = fs.statSync(tmpFile);
    if (stat.size > 100) {
      const header = fs.readFileSync(tmpFile).slice(0, 4).toString("hex");
      if (header === "504b0304") { // ZIP magic bytes
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(tmpFile);
        const entries = zip.getEntries().filter((e: any) => e.entryName.endsWith(".sql"));
        if (entries.length > 0) {
          zip.extractEntryTo(entries[0], os.tmpdir(), false, true);
          filePath = path.join(os.tmpdir(), entries[0].entryName.split("/").pop()!);
        }
      }
    }

    const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
    const importResult = await importAtlasDump({ filePath, arcadiaTenantId: req.tenantId! });
    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    fs.unlink(tmpFile, () => {});
    if (filePath !== tmpFile) fs.unlink(filePath, () => {});

    res.json({ import: importResult, etl: etlResult });
  } catch (err: any) {
    console.error("[atlas/dump-url]", err);
    res.status(500).json({ message: err.message });
  }
});

// Sync live PostgreSQL
app.post("/api/atlas/sync/live/:dataSourceId",
  isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const rows = (await db.execute(sql.raw(`
      SELECT * FROM analytics.atlas_data_sources
      WHERE id = '${req.params.dataSourceId}' AND arcadia_tenant_id = '${req.tenantId}'
    `))) as any;
    const ds = rows.rows?.[0];
    if (!ds) return res.status(404).json({ message: "Data source não encontrado" });
    const { cryptoService } = await import("./cryptoService");
    const password = ds.pg_password_encrypted
      ? await cryptoService.decryptConfig(ds.pg_password_encrypted) : "";
    const { syncAtlasLive } = await import("./bi/connectors/atlasLiveConnector");
    const syncResult = await syncAtlasLive({
      arcadiaTenantId: req.tenantId!,
      atlasDataSourceId: ds.id,
      host: ds.pg_host, port: ds.pg_port, database: ds.pg_database,
      user: ds.pg_user, password, ssl: ds.pg_ssl,
      atlaseTenantId: ds.atlas_tenant_id,
    });
    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);
    res.json({ sync: syncResult, etl: etlResult });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Test connection
app.post("/api/atlas/test-connection", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({
      host: req.body.pgHost, port: req.body.pgPort ?? 5432,
      database: req.body.pgDatabase, user: req.body.pgUser,
      password: req.body.pgPassword,
      ssl: req.body.pgSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000, max: 1,
    });
    const client = await pool.connect();
    const r = await client.query("SELECT version()");
    client.release(); await pool.end();
    res.json({ ok: true, version: r.rows[0]?.version });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});
```

---

## Ordem de execução no Replit

```
1. server/index.ts                           — adicionar staging tables (etapa 1)
2. server/bi/connectors/atlasDumpConnector.ts — criar (etapa 2)
3. server/bi/etl/atlasEtl.ts                 — criar (etapa 3)
4. server/bi/semantic/atlas.ts               — criar (etapa 4) — 24 métricas
5. server/bi/atlasAlerts.ts                  — criar (etapa 5)
6. server/bi/semantic/index.ts               — importar atlas (etapa 6)
7. server/routes.ts                          — adicionar rotas /api/atlas/* (etapa 7)
8. npm install adm-zip && npm install @types/adm-zip --save-dev
9. Restart servidor
10. POST /api/atlas/data-sources  { mode: "dump" }
11. POST /api/atlas/sync/dump-upload/:id  (enviar dump-atlas_prod-202605111245.zip)
12. GET /api/bi/semantic/catalog  → deve mostrar módulo atlas com 24 métricas
13. POST /api/bi/semantic/run { metricId: "atlas.receita_por_periodo" }  → dados reais
```

## Verificação pós-deploy

```sql
-- Tabelas staging criadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'analytics' AND table_name LIKE 'atlas_%'
ORDER BY table_name;
-- esperado: 20 tabelas

-- Dados importados (após sync)
SELECT 'atlas_pessoas' AS t, COUNT(*) FROM analytics.atlas_pessoas
UNION ALL SELECT 'atlas_pedidos', COUNT(*) FROM analytics.atlas_pedidos
UNION ALL SELECT 'atlas_pedido_produtos', COUNT(*) FROM analytics.atlas_pedido_produtos
UNION ALL SELECT 'atlas_pagar_recebers', COUNT(*) FROM analytics.atlas_pagar_recebers
UNION ALL SELECT 'atlas_produtos', COUNT(*) FROM analytics.atlas_produtos;
-- esperado: ~20k pessoas, ~42k pedidos, ~200k itens, ~49k lançamentos, ~2.4k produtos

-- fact tables populadas
SELECT 'fact_revenue' AS t, COUNT(*) FROM analytics.fact_revenue WHERE source_data_source_id='atlas'
UNION ALL SELECT 'fact_crm', COUNT(*) FROM analytics.fact_crm WHERE opportunity_id LIKE 'atlas-%'
UNION ALL SELECT 'fact_atlas_products', COUNT(*) FROM analytics.fact_atlas_products;
```
