# 📋 PLANEJAMENTO TÉCNICO — FASE: CADASTRO DE PESSOAS (CRM 2.0)

**Projeto:** Arcádia Consult | Sistema BPO Multi-Empresa  
**Módulo:** `arcadia-crm` → `arcadia-pessoas`  
**Versão:** 2.0.1  
**Data:** 28/04/2026 (atualizado)  
**Status:** 🟡 Em Planejamento → 🟢 Pronto para Implementação  
**Responsável:** Arquiteto de Produto Arcádia  
**Prazo Estimado:** 5 Sprints (10 semanas)

---

## 1. CONTEXTO E JUSTIFICATIVA

### 1.1 O Problema

O Arcádia Consult possui um CRM básico de clientes, mas a operação BPO exige gerenciamento de **múltiplos tipos de relacionamentos**:

- **Clientes** (771 na planilha legada) — quem compra
- **Fornecedores** (132) — quem vende para nós
- **Colaboradores** (10+) — quem trabalha na empresa
- **Transportadoras** (8) — quem entrega
- **Credores** (em recuperação) — quem tem dívida a renegociar

Hoje esses dados estão **espalhados**: CRM tem clientes, Control tem fornecedores em texto livre, Recovery tem credores isolados. Isso gera:
- Duplicidade de cadastros (22 pessoas são cliente + fornecedor)
- Dados inconsistentes entre módulos
- Perda de inteligência de relacionamento

### 1.2 A Solução (Alinhada ao Posicionamento Estratégico)

> **"Não vendemos software. Entregamos inteligência."**

O Cadastro de Pessoas do Arcádia não é apenas um "banco de dados". É um **"sistema nervoso"** que:
- Centraliza todos os relacionamentos da empresa
- Enriquece dados com IA e analytics
- Alimenta todos os módulos (Control, Societário, Recovery, BI)
- Entrega insights proativos via Agentes

**O que fazemos:** ✅ Cadastro inteligente com score de relacionamento  
**O que não fazemos:** ❌ Não replicamos ERP operacional (Omie, Bling, Conta Azul)  

---

## 2. OBJETIVOS DA FASE

| # | Objetivo | KPI | Prazo |
|---|----------|-----|-------|
| 1 | Centralizar 903 registros da planilha legada em estrutura única | 100% importados | Sprint 1 |
| 2 | Eliminar duplicidades (22 casos identificados) | 0 duplicados | Sprint 1 |
| 3 | Integrar Pessoas → Control (AP/AR vinculados) | 100% dos lançamentos com pessoa_id | Sprint 3 |
| 4 | Habilitar múltiplos papéis por pessoa | 100% dos casos de duplo-papel funcionando | Sprint 2 |
| 5 | Entregar Score de Relacionamento v1 | 80% precisão em churn prediction | Sprint 4 |
| 6 | Integrar com Agente Comercial | 5 tipos de alerta ativos | Sprint 4 |

---

## 3. ARQUITETURA DE DADOS

### 3.1 Modelo Entidade-Relacionamento

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODELO DE DADOS — PESSOAS                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐│
│  │   PESSOA     │       │   ENDEREÇO   │       │   CONTATO    ││
│  │──────────────│       │──────────────│       │──────────────││
│  │ id (PK)      │◄──────│ id (PK)      │       │ id (PK)      ││
│  │ tenant_id    │   1:N │ pessoa_id    │       │ pessoa_id    ││
│  │ tipo_pessoa  │       │ tipo         │       │ tipo         ││
│  │ nome_fantasia│       │ logradouro   │       │ valor        ││
│  │ razao_social │       │ numero       │       │ is_principal ││
│  │ cnpj_cpf     │       │ complemento  │       │ is_validado  ││
│  │ rg_ie        │       │ bairro       │       └──────────────┘│
│  │ status       │       │ cidade       │                         │
│  │ observacoes  │       │ uf           │                         │
│  │ created_at   │       │ cep          │                         │
│  └──────────────┘       └──────────────┘                         │
│         │                                                        │
│         │ 1:N                                                    │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │ PAPEL (JSONB)│                                                │
│  │──────────────│                                                │
│  │ id (PK)      │                                                │
│  │ pessoa_id    │                                                │
│  │ tenant_id    │                                                │
│  │ tipo_papel   │ → 'cliente'|'fornecedor'|'colaborador'|...   │
│  │ status       │                                                │
│  │ metadata     │ → JSON flexível por papel                      │
│  │ data_inicio  │                                                │
│  │ data_fim     │                                                │
│  └──────────────┘                                                │
│                                                                  │
│  METADATA EXEMPLOS:                                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Cliente: { limiteCredito, tabelaPreco, vendedor, categoria, ││
│  │           scoreChurn, frequenciaCompra, valorMedioPedido }   ││
│  │ Fornecedor: { prazoMedio, tipoFornecimento, ratingQualidade, ││
│  │              ratingPrazo, isCritico }                       ││
│  │ Colaborador: { cargo, departamento, dataAdmissao, salario,  ││
│  │               tipoContratacao, gestorId, skills }            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 DDL — Drizzle ORM (PostgreSQL)

```typescript
// shared/schema/pessoas.ts
import { pgTable, uuid, varchar, text, timestamp, 
         boolean, integer, jsonb, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenants } from "./core";

export const pessoas = pgTable('pessoas', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  tipoPessoa: varchar('tipo_pessoa', { length: 2 }).notNull(), // 'PF' | 'PJ'
  nomeFantasia: varchar('nome_fantasia', { length: 255 }).notNull(),
  razaoSocial: varchar('razao_social', { length: 255 }),
  cnpjCpf: varchar('cnpj_cpf', { length: 20 }).notNull(),
  rgIe: varchar('rg_ie', { length: 20 }),
  inscricaoMunicipal: varchar('inscricao_municipal', { length: 20 }),

  dataNascimentoFundacao: date('data_nascimento_fundacao'),
  dataCadastro: timestamp('data_cadastro').defaultNow(),

  status: varchar('status', { length: 20 }).notNull().default('ativo'),
  observacoes: text('observacoes'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => ({
  tenantCnpjIdx: uniqueIndex('pessoa_tenant_cnpj_idx').on(table.tenantId, table.cnpjCpf),
  tenantStatusIdx: index('pessoa_tenant_status_idx').on(table.tenantId, table.status),
  nomeIdx: index('pessoa_nome_idx').on(table.nomeFantasia),
}));

export const enderecos = pgTable('enderecos', {
  id: uuid('id').primaryKey().defaultRandom(),
  pessoaId: uuid('pessoa_id').notNull().references(() => pessoas.id),
  tipo: varchar('tipo', { length: 20 }).notNull().default('principal'),
  logradouro: varchar('logradouro', { length: 255 }),
  numero: varchar('numero', { length: 20 }),
  complemento: varchar('complemento', { length: 100 }),
  bairro: varchar('bairro', { length: 100 }),
  cidade: varchar('cidade', { length: 100 }),
  codigoMunicipio: varchar('codigo_municipio', { length: 10 }),
  uf: varchar('uf', { length: 2 }),
  cep: varchar('cep', { length: 10 }),
  pais: varchar('pais', { length: 50 }).default('Brasil'),
  isPrincipal: boolean('is_principal').default(false),
});

export const contatos = pgTable('contatos', {
  id: uuid('id').primaryKey().defaultRandom(),
  pessoaId: uuid('pessoa_id').notNull().references(() => pessoas.id),
  tipo: varchar('tipo', { length: 20 }).notNull(), // telefone|whatsapp|celular|email|site
  valor: varchar('valor', { length: 255 }).notNull(),
  isPrincipal: boolean('is_principal').default(false),
  isValidado: boolean('is_validado').default(false),
  ultimoBounce: timestamp('ultimo_bounce'),
  bounceCount: integer('bounce_count').default(0),
});

export const pessoaPapeis = pgTable('pessoa_papeis', {
  id: uuid('id').primaryKey().defaultRandom(),
  pessoaId: uuid('pessoa_id').notNull().references(() => pessoas.id),
  tenantId: uuid('tenant_id').notNull(),
  tipoPapel: varchar('tipo_papel', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ativo'),
  dataInicio: date('data_inicio').defaultNow(),
  dataFim: date('data_fim'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  pessoaPapelIdx: uniqueIndex('pessoa_papel_idx').on(table.pessoaId, table.tipoPapel),
}));
```

---

## 4. API ENDPOINTS

### 4.1 CRUD de Pessoas

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/pessoas` | Lista com filtros e paginação | tenant |
| GET | `/api/pessoas/:id` | Detalhe completo (com endereços, contatos, papéis) | tenant |
| POST | `/api/pessoas` | Criar nova pessoa + papéis | tenant_admin |
| PATCH | `/api/pessoas/:id` | Atualizar dados cadastrais | tenant_admin |
| DELETE | `/api/pessoas/:id` | Soft delete (arquivar) | tenant_admin |
| POST | `/api/pessoas/:id/papeis` | Adicionar papel | tenant_admin |
| PATCH | `/api/pessoas/:id/papeis/:papelId` | Atualizar metadata do papel | tenant_admin |
| DELETE | `/api/pessoas/:id/papeis/:papelId` | Remover papel | tenant_admin |

### 4.2 Importação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/pessoas/import` | Upload CSV/XLSX |
| GET | `/api/pessoas/import/:jobId/status` | Status do job |
| GET | `/api/pessoas/import/template` | Download template |

### 4.3 Validação & Enriquecimento

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/pessoas/:id/validar-cnpj` | Consulta Receita Federal |
| POST | `/api/pessoas/:id/validar-cep` | Auto-complete endereço |
| POST | `/api/pessoas/:id/enriquecer` | Busca dados públicos |

### 4.4 Analytics

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/pessoas/analytics/portfolio` | Análise de carteira |
| GET | `/api/pessoas/analytics/concentracao` | Risco de concentração |
| GET | `/api/pessoas/analytics/churn-risk` | Clientes em risco |
| GET | `/api/pessoas/:id/score` | Score de relacionamento |

---

## 5. INTERFACE DO USUÁRIO

### 5.1 Telas Principais

```
┌─────────────────────────────────────────────────────────────────┐
│  /pessoas — LISTA                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [🔍 Buscar...] [Filtros ▼] [+ Nova Pessoa] [📥 Importar]       │
│                                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ TODOS   │ │CLIENTES │ │FORNEC.  │ │COLABOR. │ │TRANSPORT│ │
│  │   903   │ │   771   │ │   132   │ │   10    │ │    8    │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│                                                                  │
│  Tabela: Nome | CNPJ/CPF | Papéis | Cidade | Score | Ações     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  /pessoas/:id — DETALHE                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [📋 Geral] [🏠 Endereços] [📞 Contatos] [💼 Papéis] [💰 Financeiro] │
│  [📊 Analytics] [📝 Histórico] [⚙️ Config]                        │
│                                                                  │
│  TAB Geral:                                                      │
│  ├── Dados cadastrais (editáveis)                               │
│  ├── Status e observações                                       │
│  └── Últimas atividades                                         │
│                                                                  │
│  TAB Papéis:                                                     │
│  ├── Lista de papéis ativos (com badges coloridos)              │
│  ├── Metadata específico por papel (form dinâmico)              │
│  └── [+ Adicionar Papel] [Transicionar Papel]                   │
│                                                                  │
│  TAB Financeiro:                                                 │
│  ├── Resumo: Total a pagar/receber | Últimas transações         │
│  ├── Gráfico: Evolução 12 meses                                 │
│  └── Alertas: Inadimplência, prazo, etc.                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Componentes Reutilizáveis (shadcn/ui)

| Componente | Uso | Status |
|------------|-----|--------|
| `PessoaCard` | Resumo em listas | 🆕 Novo |
| `PapelBadge` | Badge colorido por papel | 🆕 Novo |
| `ScoreIndicator` | Score 0-100 com cor | 🆕 Novo |
| `EnderecoForm` | Form de endereço com CEP | 🆕 Novo |
| `ContatoList` | Lista de contatos com validação | 🆕 Novo |
| `MetadataEditor` | Editor JSON por papel | 🆕 Novo |
| `ImportWizard` | Wizard de importação | 🆕 Novo |

---

## 6. INTEGRAÇÃO COM MÓDULOS

### 6.1 Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────────┐
│              INTEGRAÇÃO: PESSOAS ↔ MÓDULOS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PESSOAS (Fonte Única da Verdade)                                │
│         │                                                        │
│         ├────────────────► CONTROL                                │
│         │   • AP/AR vinculados a pessoa_id                        │
│         │   • DRE por pessoa                                      │
│         │   • Score de inadimplência                              │
│         │                                                        │
│         ├────────────────► RECOVERY                               │
│         │   • Credores = Fornecedores com papel 'credor'          │
│         │   • Dívidas isoladas do fluxo normal                    │
│         │   • Toneraud de negociação                              │
│         │                                                        │
│         ├────────────────► SOCIETÁRIO                             │
│         │   • Sócios vinculados a pessoas                         │
│         │   • Certidões por CNPJ                                  │
│         │                                                        │
│         ├────────────────► PRODUÇÃO / SCRUM                      │
│         │   • Cliente do projeto                                  │
│         │   • Colaboradores alocados                              │
│         │                                                        │
│         ├────────────────► BI / METASET                         │
│         │   • Dashboards de carteira                              │
│         │   • Benchmarks setoriais                                │
│         │   • Análise preditiva                                   │
│         │                                                        │
│         └────────────────► AGENTES                               │
│             • Agente Comercial: oportunidades                     │
│             • Agente Controller: riscos financeiros               │
│             • Agente Recovery: negociações                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Contratos de Integração

```typescript
// Interface que todos os módulos usam
interface PessoaResumo {
  id: string;
  nomeFantasia: string;
  razaoSocial: string | null;
  cnpjCpf: string;
  tipoPessoa: 'PF' | 'PJ';
  status: 'ativo' | 'inativo' | 'bloqueado';
  papeis: PapelResumo[];
  enderecoPrincipal?: Endereco;
  contatoPrincipal?: Contato;
  scoreRelacionamento?: number;
}

interface PapelResumo {
  tipo: 'cliente' | 'fornecedor' | 'colaborador' | 'transportadora' | 'credor';
  status: 'ativo' | 'inativo';
  metadata: Record<string, any>;
}

// Control usa:
interface PessoaFinanceiro extends PessoaResumo {
  totalAP: number;      // Total Contas a Pagar em aberto
  totalAR: number;      // Total Contas a Receber em aberto
  prazoMedioPagamento: number;
  prazoMedioRecebimento: number;
  ultimaTransacao: Date;
  statusCredito: 'liberado' | 'bloqueado' | 'analise';
}

// Recovery usa:
interface PessoaCredor extends PessoaResumo {
  papelCredor: {
    valorDivida: number;
    classeCredor: 'trabalhista' | 'garantia_real' | 'quirografario' | 'fiscal';
    statusNegociacao: 'pendente' | 'em_negociacao' | 'aceita' | 'rejeitada';
    propostaAtual?: number;
  };
}
```

---

## 7. MIGRAÇÃO DA PLANILHA LEGADA

### 7.1 Estatísticas da Planilha

| Métrica | Valor |
|---------|-------|
| Total de registros | 903 |
| Clientes | 771 (85.4%) |
| Fornecedores | 132 (14.6%) |
| Colaboradores | 10 (1.1%) |
| Transportadoras | 8 (0.9%) |
| Múltiplos papéis | 22 (2.4%) |
| Pessoa Física | ~400 (44%) |
| Pessoa Jurídica | ~503 (56%) |

### 7.2 Mapeamento de Campos

| Campo Planilha | Campo Arcádia | Transformação | Obrigatório |
|----------------|---------------|---------------|-------------|
| `PessoaFisica` | `tipoPessoa` | SIM→'PF', NÃO→'PJ' | ✅ |
| `NomeFantasia` | `nomeFantasia` | Direto | ✅ |
| `RazaoSocial` | `razaoSocial` | '---' → null | |
| `CNPJ_CPF` | `cnpjCpf` | Limpar formatação | ✅ |
| `RG` / `IE` | `rgIe` | PF:RG, PJ:IE | |
| `Logradouro`..`CEP` | `enderecos[]` | Criar registro | |
| `Telefone`..`Email` | `contatos[]` | Criar registros | |
| `Cliente` | `papel: cliente` | SIM → criar | |
| `Fornecedor` | `papel: fornecedor` | SIM → criar | |
| `Colaborador` | `papel: colaborador` | SIM → criar | |
| `Transportadora` | `papel: transportadora` | SIM → criar | |
| `VendedorPadrao` | `metadata.vendedorPadrao` | No papel cliente | |
| `Categoria` | `metadata.categoria` | No papel cliente | |
| `TabelaPreco` | `metadata.tabelaPreco` | No papel cliente | |
| `Limite de Crédito` | `metadata.limiteCredito` | No papel cliente | |
| `Periodicidade` | `metadata.frequenciaCompraDias` | No papel cliente | |
| `ValorMinimoCompra` | `metadata.valorMinimoPedido` | No papel cliente | |
| `Observações` | `observacoes` | Direto | |
| `DataNascimentoFundacao` | `dataNascimentoFundacao` | Converter Excel date | |

### 7.3 Script de Importação (Resumo)

```typescript
// server/services/pessoaImportService.ts
export class PessoaImportService {

  async importarPlanilha(tenantId: string, buffer: Buffer): Promise<ImportResult> {
    const rows = parseExcel(buffer); // 903 registros
    const result = { total: 0, criados: 0, atualizados: 0, erros: [] };

    for (const row of rows) {
      try {
        const cnpjCpf = limparDocumento(row.CNPJ_CPF);

        // 1. Verificar duplicidade
        const existente = await db.query.pessoas.findFirst({
          where: and(eq(pessoas.tenantId, tenantId), eq(pessoas.cnpjCpf, cnpjCpf))
        });

        let pessoaId: string;

        if (existente) {
          // Merge: atualizar dados, adicionar papéis novos
          await this.mergePessoa(existente.id, row);
          pessoaId = existente.id;
          result.atualizados++;
        } else {
          // Criar nova pessoa + endereço + contatos + papéis
          pessoaId = await this.criarPessoaCompleta(tenantId, row);
          result.criados++;
        }

        result.total++;

      } catch (error) {
        result.erros.push({ linha: row.NomeFantasia, erro: error.message });
      }
    }

    return result;
  }

  private async criarPessoaCompleta(tenantId: string, row: any): Promise<string> {
    // Transaction: pessoa → endereço → contatos → papéis
    return await db.transaction(async (tx) => {

      // 1. Pessoa
      const [pessoa] = await tx.insert(pessoas).values({
        tenantId,
        tipoPessoa: row.PessoaFisica === 'SIM' ? 'PF' : 'PJ',
        nomeFantasia: row.NomeFantasia,
        razaoSocial: row.RazaoSocial !== '---' ? row.RazaoSocial : null,
        cnpjCpf: limparDocumento(row.CNPJ_CPF),
        rgIe: row.RG !== '---' ? row.RG : row.IE,
        dataNascimentoFundacao: converterDataExcel(row.DataNascimentoFundacao),
        observacoes: row.Observacoes !== '---' ? row.Observacoes : null
      }).returning();

      // 2. Endereço (se preenchido)
      if (row.Logradouro && row.Logradouro !== '---') {
        await tx.insert(enderecos).values({
          pessoaId: pessoa.id,
          tipo: 'principal',
          logradouro: row.Logradouro,
          numero: row.LogradouroNumero !== '---' ? row.LogradouroNumero : null,
          complemento: row.Complemento !== '---' ? row.Complemento : null,
          bairro: row.Bairro !== '---' ? row.Bairro : null,
          cidade: row.Cidade !== '---' ? row.Cidade : null,
          codigoMunicipio: row.CodigoMunicipio !== '---' ? row.CodigoMunicipio : null,
          uf: row.UF !== '---' ? row.UF : null,
          cep: row.CEP !== '---' ? row.CEP : null
        });
      }

      // 3. Contatos
      const contatosParaInserir = [];
      if (row.Telefone && row.Telefone !== '---') 
        contatosParaInserir.push({ pessoaId: pessoa.id, tipo: 'telefone', valor: row.Telefone });
      if (row.Whatsapp && row.Whatsapp !== '---')
        contatosParaInserir.push({ pessoaId: pessoa.id, tipo: 'whatsapp', valor: row.Whatsapp });
      if (row.Celular && row.Celular !== '---')
        contatosParaInserir.push({ pessoaId: pessoa.id, tipo: 'celular', valor: row.Celular });
      if (row.Email && row.Email !== '---')
        contatosParaInserir.push({ pessoaId: pessoa.id, tipo: 'email', valor: row.Email, isPrincipal: true });
      if (row.Site && row.Site !== '---')
        contatosParaInserir.push({ pessoaId: pessoa.id, tipo: 'site', valor: row.Site });

      if (contatosParaInserir.length > 0) {
        await tx.insert(contatos).values(contatosParaInserir);
      }

      // 4. Papéis
      const papeis = [];
      if (row.Cliente === 'SIM') papeis.push({
        tipoPapel: 'cliente',
        metadata: {
          limiteCredito: row['Limite de Crédito'] || 0,
          tabelaPreco: row.TabelaPreco !== '---' ? row.TabelaPreco : null,
          vendedorPadrao: row.VendedorPadrao !== '---' ? row.VendedorPadrao : null,
          categoria: row.Categoria !== '---' ? row.Categoria : null,
          frequenciaCompraDias: row['Periodicidade Venda/Compra(dias)'] || 0,
          valorMinimoPedido: row.ValorMinimoCompra || 0
        }
      });
      if (row.Fornecedor === 'SIM') papeis.push({
        tipoPapel: 'fornecedor',
        metadata: { prazoMedioPagamento: 30, tipoFornecimento: ['geral'], isCritico: false }
      });
      if (row.Colaborador === 'SIM') papeis.push({
        tipoPapel: 'colaborador',
        metadata: { cargo: row.Observacoes !== '---' ? row.Observacoes : null }
      });
      if (row.Transportadora === 'SIM') papeis.push({
        tipoPapel: 'transportadora',
        metadata: {}
      });

      for (const papel of papeis) {
        await tx.insert(pessoaPapeis).values({
          pessoaId: pessoa.id,
          tenantId,
          tipoPapel: papel.tipoPapel,
          metadata: papel.metadata
        });
      }

      return pessoa.id;
    });
  }
}
```

---

## 7.5. TEMPLATE DE PLANILHA PARA IMPORTAÇÃO

Para facilitar a importação em massa de pessoas, foi criado um template Excel padronizado.

### 📥 Download do Template

**Arquivo:** `TEMPLATE_IMPORTACAO_PESSOAS.xlsx`

O template contém **5 abas**:

| Aba | Descrição |
|-----|-----------|
| **Instruções** | Guia completo de como preencher, regras de validação e explicação dos papéis |
| **Template** | Planilha vazia para preenchimento (com validação de dados e formatação) |
| **Exemplos** | 3 registros preenchidos: Cliente PF, Fornecedor PJ, Cliente+Fornecedor |
| **Papéis_Detalhado** | Tabela explicando cada campo de metadata por tipo de papel |
| **Validações** | Regras de validação com exemplos válidos e inválidos |

### Estrutura do Template

O template possui **40 colunas** organizadas em grupos:

```
┌─────────────────────────────────────────────────────────────────┐
│              ESTRUTURA DO TEMPLATE DE IMPORTAÇÃO                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GRUPO 1: DADOS BÁSICOS (7 colunas)                            │
│  ├── tipo_pessoa*        → PF ou PJ                             │
│  ├── nome_fantasia*      → Nome comercial                      │
│  ├── razao_social        → Nome formal (PJ)                     │
│  ├── cnpj_cpf*           → Apenas números                      │
│  ├── rg                  → RG (PF) ou IE (PJ)                 │
│  ├── ie                  → Inscrição Estadual                  │
│  └── data_nascimento_fundacao → AAAA-MM-DD                    │
│                                                                  │
│  GRUPO 2: ENDEREÇO (8 colunas)                                 │
│  ├── logradouro, numero, complemento, bairro                   │
│  ├── cidade, codigo_municipio, uf, cep                         │
│                                                                  │
│  GRUPO 3: CONTATO (5 colunas)                                  │
│  ├── telefone, whatsapp, celular, email, site                  │
│                                                                  │
│  GRUPO 4: PAPÉIS (4 colunas) — preencher SIM ou NÃO            │
│  ├── cliente, fornecedor, colaborador, transportadora            │
│                                                                  │
│  GRUPO 5: DADOS COMERCIAIS — CLIENTE (6 colunas)               │
│  ├── limite_credito, tabela_preco, vendedor_padrao             │
│  ├── categoria, periodicidade_compra, valor_minimo_compra        │
│                                                                  │
│  GRUPO 6: DADOS COMERCIAIS — FORNECEDOR (3 colunas)            │
│  ├── prazo_medio_pagamento, tipo_fornecimento, is_critico      │
│                                                                  │
│  GRUPO 7: DADOS — COLABORADOR (4 colunas)                      │
│  ├── cargo, departamento, data_admissao, tipo_contratacao      │
│                                                                  │
│  GRUPO 8: DADOS — TRANSPORTADORA (2 colunas)                  │
│  ├── regiao_atuacao, tipo_frota                                 │
│                                                                  │
│  GRUPO 9: GERAL (1 coluna)                                     │
│  └── observacoes                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Regras de Preenchimento

1. **Campos obrigatórios** (marcados com *): `tipo_pessoa`, `nome_fantasia`, `cnpj_cpf`
2. **CNPJ/CPF**: apenas números, sem pontos, traços ou barras
   - PF = 11 dígitos | PJ = 14 dígitos
3. **Papéis**: preencher `SIM` ou `NÃO` (ou deixar em branco = NÃO)
4. **Uma pessoa pode ter múltiplos papéis**: ex: Cliente = SIM + Fornecedor = SIM
5. **Datas**: formato `AAAA-MM-DD` (ex: `1985-03-15`)
6. **Valores monetários**: ponto como separador decimal (ex: `1500.50`)
7. **Campos não aplicáveis**: deixar em branco (não preencher '---')

### Exemplos de Registros

**Exemplo 1 — Cliente Pessoa Física:**
```
tipo_pessoa: PF
nome_fantasia: Maria Silva
cnpj_cpf: 12345678901
cliente: SIM
limite_credito: 5000.00
categoria: VIP
```

**Exemplo 2 — Fornecedor Pessoa Jurídica:**
```
tipo_pessoa: PJ
nome_fantasia: Alumínio ABC
razao_social: Alumínio ABC Indústria e Comércio LTDA
cnpj_cpf: 72831217000154
fornecedor: SIM
prazo_medio_pagamento: 30
tipo_fornecimento: materia_prima
is_critico: SIM
```

**Exemplo 3 — Cliente + Fornecedor (múltiplos papéis):**
```
tipo_pessoa: PJ
nome_fantasia: Corttex Indústria
cnpj_cpf: 48606503000565
cliente: SIM
fornecedor: SIM
limite_credito: 100000.00
categoria: Industrial
prazo_medio_pagamento: 60
tipo_fornecimento: materia_prima,servico
```

### Validações Automáticas

O sistema validará na importação:
- ✅ CNPJ/CPF único por tenant
- ✅ CNPJ/CPF com dígitos verificadores válidos
- ✅ Email em formato válido
- ✅ CEP com 8 dígitos
- ✅ UF com 2 letras
- ✅ Data em formato válido
- ✅ Valores numéricos positivos
- ✅ Papéis apenas SIM/NÃO/vazio


## 8. ROADMAP DE SPRINTS

### Sprint 1 — Fundação (Semanas 1-2)
**Objetivo:** Estrutura de dados e importação da planilha

| Tarefa | Responsável | Status |
|--------|-------------|--------|
| Criar migration das tabelas (pessoas, enderecos, contatos, pessoaPapeis) | Backend | ⬜ |
| Implementar CRUD de pessoas (API) | Backend | ⬜ |
| Implementar importação da planilha (903 registros) | Backend | ⬜ |
| Criar tela de lista de pessoas | Frontend | ⬜ |
| Criar tela de detalhe (abas: Geral, Endereços, Contatos) | Frontend | ⬜ |
| Testar importação e validar dados | QA | ⬜ |

**Entregável:** 903 pessoas importadas, navegáveis na interface

---

### Sprint 2 — Papéis Dinâmicos (Semanas 3-4)
**Objetivo:** Gestão de múltiplos papéis e transições

| Tarefa | Responsável | Status |
|--------|-------------|--------|
| Implementar CRUD de papéis (adicionar/remover) | Backend | ⬜ |
| Criar interface de gestão de papéis (badges, forms dinâmicos) | Frontend | ⬜ |
| Implementar transição de papéis (prospect → cliente) | Backend | ⬜ |
| Criar histórico de alterações de papel | Backend | ⬜ |
| Testar casos de múltiplos papéis (22 casos da planilha) | QA | ⬜ |

**Entregável:** Pessoa pode ser Cliente + Fornecedor simultaneamente

---

### Sprint 3 — Integração com Control (Semanas 5-6)
**Objetivo:** Vincular AP/AR ao cadastro de pessoas

| Tarefa | Responsável | Status |
|--------|-------------|--------|
| Adicionar `pessoaId` nas tabelas de AP/AR do Control | Backend | ⬜ |
| Criar migration de dados existentes (vincular por nome/CNPJ) | Backend | ⬜ |
| Atualizar interface do Control para mostrar pessoa vinculada | Frontend | ⬜ |
| Implementar resumo financeiro na tela de pessoa | Frontend | ⬜ |
| Testar integração end-to-end | QA | ⬜ |

**Entregável:** Todo lançamento financeiro vinculado a uma pessoa

---

### Sprint 4 — Inteligência & Agentes (Semanas 7-8)
**Objetivo:** Score de relacionamento e alertas preditivos

| Tarefa | Responsável | Status |
|--------|-------------|--------|
| Implementar cálculo de Score de Relacionamento v1 | Backend | ⬜ |
| Criar algoritmo de churn prediction (regras + histórico) | Backend | ⬜ |
| Implementar alertas: inadimplência, churn, concentração | Backend | ⬜ |
| Integrar Agente Comercial ao cadastro de pessoas | AI/Agent | ⬜ |
| Criar dashboard de analytics de carteira | Frontend | ⬜ |
| Testar precisão dos alertas | QA | ⬜ |

**Entregável:** Sistema proativo alertando sobre riscos e oportunidades

---

### Sprint 5 — CRM Avançado & Integrações (Semanas 9-10)
**Objetivo:** Pipeline, timeline e integrações externas

| Tarefa | Responsável | Status |
|--------|-------------|--------|
| Implementar pipeline de vendas por cliente | Frontend | ⬜ |
| Criar timeline de interações (histórico unificado) | Backend | ⬜ |
| Integrar com WhatsApp API para contato | Integração | ⬜ |
| Implementar tarefas e follow-ups automáticos | Backend | ⬜ |
| Criar Hub de Conectores para sincronizar com ERPs externos | Backend | ⬜ |
| Documentar API pública para parceiros | Tech Writer | ⬜ |

**Entregável:** CRM completo, integrado, com inteligência ativa

---

## 9. CRITÉRIOS DE ACEITAÇÃO

### 9.1 Funcionais

- [ ] 903 registros da planilha importados sem perda de dados
- [ ] 0 duplicidades de CNPJ/CPF por tenant
- [ ] 22 casos de múltiplos papéis funcionando corretamente
- [ ] AP/AR do Control 100% vinculados a pessoa_id
- [ ] Score de relacionamento calculado para todos os clientes
- [ ] 5 tipos de alerta ativos e testados

### 9.2 Não-Funcionais

- [ ] Tempo de resposta da lista < 500ms (p95)
- [ ] Importação de 903 registros < 2 minutos
- [ ] Cobertura de testes > 70%
- [ ] Documentação API completa (OpenAPI/Swagger)

---

## 10. RISCOS E MITIGAÇÕES

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Dados da planilha inconsistentes | Alta | Médio | Parser tolerante, log de erros, revisão manual |
| CNPJ/CPF inválidos na planilha | Média | Médio | Validação na importação, flag para revisão |
| Conflito com CRM existente | Média | Alto | Migration controlada, backup antes de alterar |
| Performance com 1000+ pessoas | Baixa | Médio | Índices adequados, paginação, cache |
| Resistência de usuários à mudança | Média | Médio | Treinamento, interface intuitiva, feedback |

---

## 11. DEPENDÊNCIAS

| Dependência | Status | Bloqueia |
|-------------|--------|----------|
| Stack atual (Node + Drizzle + PostgreSQL) | ✅ Pronto | Não |
| Multi-tenancy (tenantContext) | ✅ Pronto | Não |
| RBAC existente | ✅ Pronto | Não |
| Control com AP/AR | ✅ Pronto | Sprint 3 |
| BrasilAPI para validação | 🟡 Configurar | Sprint 1 |
| Planilha legada (fornecida) | ✅ Recebida | Não |

---

## 12. ANEXOS

### Anexo A: Planilhas

**A1 — Planilha Legada (origem)**
- Arquivo: `e757dd71-24db-471c-870e-97c10bb57549.xlsx`
- Total: 903 registros, 37 colunas
- Formatos: Excel date, CNPJ com máscara, campos '---' para vazio
- Status: ✅ Recebida e analisada

**A2 — Template de Importação (destino)**
- Arquivo: `TEMPLATE_IMPORTACAO_PESSOAS.xlsx`
- Abas: Instruções | Template | Exemplos | Papéis_Detalhado | Validações
- Colunas: 40 campos organizados em 9 grupos
- Status: ✅ Gerado e disponível para download

- Arquivo: `e757dd71-24db-471c-870e-97c10bb57549.xlsx`
- Total: 903 registros, 37 colunas
- Formatos: Excel date, CNPJ com máscara, campos '---' para vazio

### Anexo B: Posicionamento Estratégico
- Documento: `arcadia-posicionamento-estrategico.docx`
- Princípio: "Não vendemos software. Entregamos inteligência."
- Arcádia é camada analítica, não ERP operacional

### Anexo C: Stack Técnico
- Documento: `replit.md`
- Node.js + TypeScript + React 18 + Vite + Drizzle ORM + PostgreSQL + shadcn/ui

---

## 13. HISTÓRICO DE REVISÕES

| Versão | Data | Autor | Alterações |
|--------|------|-------|------------|
| 1.0 | 28/04/2026 | Arquiteto | Criação inicial |
| 1.1 | 28/04/2026 | Arquiteto | Adicionado Template de Importação (Seção 7.5 + Anexo A2) |

---

**Próxima ação:** Revisão técnica da equipe → Aprovação → Início Sprint 1

**Documento gerado para:** Replit / Arcádia Consult / Planejamento Técnico
