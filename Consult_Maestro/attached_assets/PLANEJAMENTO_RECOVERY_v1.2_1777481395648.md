# 📘 DOCUMENTO DE PLANEJAMENTO — MÓDULO DE RECUPERAÇÃO DE EMPRESAS
## **Arcádia Control | Gestão de Negociações, Acordos e Dívidas Estratégicas**

**Projeto:** Arcádia Consult | Sistema BPO Multi-Empresa  
**Módulo:** `arcadia-control/recovery`  
**Versão:** 1.2.0  
**Data:** 29/04/2026 (atualizado)  
**Status:** Planejamento de Implementação  
**Contexto:** Dívidas vencidas, fornecedores, impostos, bancos — isoladas do fluxo operacional até formalização de acordo

---

## 📑 SUMÁRIO EXECUTIVO

Empresas em dificuldade financeira possuem **dívidas que não podem entrar no fluxo operacional** — se forem tratadas como contas a pagar normais, comprometem a viabilidade da recuperação e geram pagamentos impossíveis com o caixa atual.

O Arcádia Control precisa de um **ambiente isolado** para:
- **Levantamento de dívidas** (vencidas, fornecedores, impostos, bancos, etc.)
- **Negociação e renegociação** (propostas, contra-propostas, acordos)
- **Formalização de acordos** (homologação, parcelas, condições)
- **Toneraud administrativo** (histórico cronológico completo de interações)
- **Liberação para fluxo de pagamento** (só após acordo formalizado)

> **Princípio fundamental:** Dívidas em negociação são **passivos estratégicos**, não operações rotineiras. Elas exigem acordo antes de virarem pagamentos.

---

## 1. CONTEXTO DE NEGÓCIO

### 1.1 Cenário Real — Caso Santander

```
Empresa Cliente X possui:
├── Dívida com Santander: R$ 132.012,00
│   ├── Cheque especial: R$ 45.000
│   ├── Capital de giro: R$ 62.012
│   └── Cartão de crédito: R$ 25.000
│
├── Proposta Santander:
│   ├── Entrada: 6 parcelas de R$ 800 (mês 1-6)
│   ├── Financiamento: 72 parcelas de R$ 2.700 (mês 7-78)
│   ├── Total: R$ 199.200 em 78 meses
│   └── Taxa: 1,0559% a.m. (CET real)
│
├── REGRA CRÍTICA:
│   ├── ❌ R$ 132.012 NÃO entra em Contas a Pagar
│   ├── ❌ NÃO gera alerta de vencimento normal
│   ├── ❌ NÃO aparece no fluxo de caixa operacional
│   ├── ✅ Negociação isolada no Recovery
│   ├── ✅ Acordo formalizado → parcelas liberadas para AP
│   └── ✅ Parcela 1 (R$ 800) entra no Control em 15/05
│
└── Outras dívidas em levantamento:
    ├── Fornecedores: 18 credores, R$ 425.000
    ├── Impostos (Prefeitura/RF): R$ 85.000
    ├── Outros bancos: R$ 180.000
    └── Trabalhistas: R$ 25.338
```

### 1.2 Tipos de Dívida em Negociação

| Tipo | Origem | Exemplo | Prioridade |
|------|--------|---------|------------|
| **Bancária** | Cheque especial, capital de giro, CDC, cartão | Santander R$ 132.012 | 🔴 Crítica |
| **Fornecedores** | Duplicatas vencidas, notas fiscais não pagas | 18 fornecedores, R$ 425.000 | 🔴 Alta |
| **Tributária** | ISS, ICMS, IR, PIS/COFINS atrasados | Prefeitura R$ 45.000, RF R$ 40.000 | 🔴 Alta |
| **Trabalhista** | Salários, rescisões, verbas rescisórias | 6 processos, R$ 25.338 | 🟡 Média |
| **Previdenciária** | INSS, FGTS atrasados | R$ 18.000 | 🟡 Média |
| **Locação** | Aluguel de imóveis/equipamentos | R$ 12.000 | 🟡 Média |
| **Outros** | Condomínio, energia, água, telefone | R$ 8.000 | 🟢 Baixa |

### 1.3 Stakeholders & Papéis

| Persona | Função | Necessidade | Permissão |
|---------|--------|-------------|-----------|
| **Consultor Financeiro** | Faz o levantamento inicial | Cadastrar dívidas, contatar credores | CRUD no Recovery |
| **Controller/Contador** | Analisa viabilidade | Simular cenários, calcular CET/TIR | CRUD + aprovação |
| **Diretor/Sócio** | Decide sobre acordos | Aprovar propostas, assinar acordos | Aprovação final |
| **Advogado** | Formaliza juridicamente | Homologação, assembleias, ações | Leitura + documentos |
| **Credor (externo)** | Recebe propostas | Visualizar proposta, responder | Portal limitado |
| **Agente Recovery** | IA do sistema | Análise preditiva, alertas | Service account |

---

## 2. ARQUITETURA DO MÓDULO

### 2.1 Isolamento do Fluxo Operacional

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCÁDIA CONTROL                                │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐  │
│  │   FLUXO OPERACIONAL │    │   MÓDULO RECOVERY (Isolado)    │  │
│  │   (AP/AR Normal)    │    │                                  │  │
│  │                     │    │  ┌─────────────────────────────┐ │  │
│  │  • Contas a Pagar   │◄───┼──┤  CARTEIRA DE DÍVIDAS         │ │  │
│  │  • Contas a Receber │    │  │  (bancos, fornecedores,      │ │  │
│  │  • Fluxo de Caixa   │    │  │   impostos, trabalhistas)   │ │  │
│  │  • Orçamento        │    │  └─────────────────────────────┘ │  │
│  │  • DRE/BP           │    │                                  │  │
│  └─────────────────────┘    │  ┌─────────────────────────────┐ │  │
│           ▲                 │  │  NEGOCIAÇÃO & ACORDOS         │ │  │
│           │                 │  │  (propostas, contra-propostas│ │  │
│           │                 │  │   simulações, aprovações)     │ │  │
│           │                 │  └─────────────────────────────┘ │  │
│           │                 │                                  │  │
│           │                 │  ┌─────────────────────────────┐ │  │
│           │                 │  │  TONERAUD ADMINISTRATIVO    │ │  │
│           │                 │  │  (timeline, interações,      │ │  │
│           │                 │  │   documentos, alertas)        │ │  │
│           │                 │  └─────────────────────────────┘ │  │
│           │                 │                                  │  │
│           │                 │  ┌─────────────────────────────┐ │  │
│           └─────────────────┤  │  LIBERAÇÃO PARA PAGAMENTO   │ │  │
│              (Acordo formalizado│  │  (parcelas → Control AP)    │ │  │
│               vira AP normal) │  └─────────────────────────────┘ │  │
│                             └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Regra de Isolamento (Middleware)

```typescript
// Middleware de isolamento do Recovery
export const recoveryIsolationGuard = async (req, res, next) => {
  const { tenantId } = req;
  const { recoveryId } = req.params;

  // 1. Verifica se existe processo de recuperação ativo
  const recovery = await db.query.recoveryProcesses.findFirst({
    where: and(
      eq(recoveryProcesses.id, recoveryId),
      eq(recoveryProcesses.tenantId, tenantId),
      eq(recoveryProcesses.status, 'active')
    )
  });

  if (!recovery) {
    return res.status(403).json({ 
      error: 'Tenant não está em processo de recuperação ativo' 
    });
  }

  // 2. BLOQUEIA operações de pagamento automático
  req.recoveryMode = true;
  req.blockAutoPayment = true;

  // 3. Redireciona alertas para equipe de recuperação
  req.notificationChannel = 'recovery_team';

  // 4. Marca que dívidas recovery NÃO geram AP normal
  req.skipNormalAP = true;

  next();
};
```

### 2.3 Fluxo de Estados de uma Dívida

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│IDENTIFIC│───►│CONTATO  │───►│PROPOSTA │───►│ACORDO   │───►│LIBERADO │
│AÇÃO     │    │INICIAL  │    │ENVIADA  │    │FIRMADO  │    │P/ PAGTO │
└─────────┘    └─────────┘    └────┬────┘    └────┬────┘    └────┬────┘
                                   │              │              │
                              ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
                              │CONTRA-  │    │REJEITADO│    │PARCELA  │
                              │PROPOSTA │    │(escalar)│    │GERADA   │
                              │(loop)   │    │         │    │         │
                              └────┬────┘    └─────────┘    └────┬────┘
                                   │                             │
                                   └─────────────────────────────┘
```

---

## 3. MODELAGEM DE DADOS (Drizzle ORM)

### 3.1 Processo de Recuperação

```typescript
export const recoveryProcesses = pgTable('recovery_processes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  // Identificação
  processNumber: varchar('process_number', { length: 100 }),
  processType: varchar('process_type', { length: 30 }).notNull(),
  // 'judicial', 'extrajudicial', 'negociacao_direta', 'administrativo'

  // Status
  status: varchar('status', { length: 30 }).notNull().default('levantamento'),
  // 'levantamento', 'em_negociacao', 'acordos_firmados', 
  // 'cumprimento', 'concluido', 'falencia'

  // Datas
  startDate: date('start_date').defaultNow(),
  expectedEndDate: date('expected_end_date'),
  actualEndDate: date('actual_end_date'),

  // Totais
  totalDebtAmount: decimal('total_debt_amount', { precision: 15, scale: 2 }).default('0'),
  totalNegotiatedAmount: decimal('total_negotiated_amount', { precision: 15, scale: 2 }).default('0'),
  totalPaidAmount: decimal('total_paid_amount', { precision: 15, scale: 2 }).default('0'),

  // Metadados
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
}, (table) => ({
  tenantStatusIdx: index('recovery_tenant_status_idx').on(table.tenantId, table.status),
}));
```

### 3.2 Carteira de Dívidas (Credores)

```typescript
export const recoveryCreditors = pgTable('recovery_creditors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryProcessId: uuid('recovery_process_id').notNull()
    .references(() => recoveryProcesses.id),

  // Vinculação com Pessoa (do cadastro central)
  pessoaId: uuid('pessoa_id').references(() => pessoas.id),

  // Dados do credor (denormalizado para histórico)
  creditorType: varchar('creditor_type', { length: 30 }).notNull(),
  // 'banco', 'fornecedor', 'tributo_prefeitura', 'tributo_federal', 
  // 'tributo_estadual', 'trabalhista', 'previdenciario', 'locacao', 'outros'

  creditorName: varchar('creditor_name', { length: 255 }).notNull(),
  creditorDocument: varchar('creditor_document', { length: 20 }),
  creditorContact: jsonb('creditor_contact'),

  // Dados da dívida
  debtOrigin: varchar('debt_origin', { length: 100 }),
  debtDescription: text('debt_description'),
  debtModalities: jsonb('debt_modalities'), // [{type, amount, description}]
  // Ex: [{type: 'cheque_especial', amount: 45000}, {type: 'cartao_credito', amount: 25000}]

  // Valores
  originalDebtAmount: decimal('original_debt_amount', { precision: 15, scale: 2 }).notNull(),
  updatedDebtAmount: decimal('updated_debt_amount', { precision: 15, scale: 2 }).notNull(),
  interestAmount: decimal('interest_amount', { precision: 15, scale: 2 }).default('0'),
  penaltyAmount: decimal('penalty_amount', { precision: 15, scale: 2 }).default('0'),
  legalCosts: decimal('legal_costs', { precision: 15, scale: 2 }).default('0'),

  // Classificação
  priority: varchar('priority', { length: 20 }).default('media'),
  // 'critica', 'alta', 'media', 'baixa'
  isCritical: boolean('is_critical').default(false),

  // Status da negociação
  negotiationStatus: varchar('negotiation_status', { length: 30 }).notNull().default('pendente'),
  // 'pendente', 'em_negociacao', 'proposta_enviada', 'aceita', 'rejeitada',
  // 'acordo_firmado', 'homologado', 'cumprindo', 'quitada', 'irrecuperavel'

  // Acordo aprovado
  agreedAmount: decimal('agreed_amount', { precision: 15, scale: 2 }),
  agreedInstallments: integer('agreed_installments'),
  agreedFirstPaymentDate: date('agreed_first_payment_date'),
  agreedInterestRate: decimal('agreed_interest_rate', { precision: 7, scale: 4 }),
  cetCalculated: decimal('cet_calculated', { precision: 7, scale: 4 }), // TIR real

  // Metadados
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  tenantRecoveryIdx: index('creditor_tenant_recovery_idx').on(table.tenantId, table.recoveryProcessId),
  statusIdx: index('creditor_status_idx').on(table.negotiationStatus),
  typeIdx: index('creditor_type_idx').on(table.creditorType),
}));
```

### 3.3 Cenários de Negociação

```typescript
export const negotiationScenarios = pgTable('negotiation_scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryProcessId: uuid('recovery_process_id').notNull(),

  // Identificação
  scenarioName: varchar('scenario_name', { length: 100 }).notNull(),
  scenarioDescription: text('scenario_description'),
  scenarioType: varchar('scenario_type', { length: 30 }).notNull(),
  // 'parcelamento', 'desconto_a_vista', 'conversao_cotas', 
  // 'cessao_ativos', 'hibrido', 'entrada_reduzida'

  // Parâmetros financeiros
  totalDebtAmount: decimal('total_debt_amount', { precision: 15, scale: 2 }).notNull(),
  proposedTotalPayment: decimal('proposed_total_payment', { precision: 15, scale: 2 }).notNull(),
  discountPercentage: decimal('discount_percentage', { precision: 5, scale: 2 }),
  numberOfInstallments: integer('number_of_installments'),
  installmentInterval: integer('installment_interval'), // dias
  gracePeriodMonths: integer('grace_period_months'),

  // Parcela reduzida inicial (caso Santander)
  hasReducedInitialInstallment: boolean('has_reduced_initial_installment').default(false),
  reducedInstallmentsCount: integer('reduced_installments_count'),
  reducedInstallmentAmount: decimal('reduced_installment_amount', { precision: 15, scale: 2 }),
  normalInstallmentAmount: decimal('normal_installment_amount', { precision: 15, scale: 2 }),

  // Taxas
  proposedInterestRate: decimal('proposed_interest_rate', { precision: 7, scale: 4 }),
  cetCalculated: decimal('cet_calculated', { precision: 7, scale: 4 }),

  // Simulação
  cashFlowImpact: jsonb('cash_flow_impact'),
  viabilityScore: decimal('viability_score', { precision: 3, scale: 2 }),

  // Status
  status: varchar('status', { length: 30 }).notNull().default('rascunho'),
  // 'rascunho', 'em_analise', 'aprovado_interno', 'enviado_credores',
  // 'aceito_credores', 'rejeitado', 'homologado'

  // Aprovações
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),

  createdAt: timestamp('created_at').defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
});
```

### 3.4 Propostas por Credor

```typescript
export const creditorProposals = pgTable('creditor_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  scenarioId: uuid('scenario_id').notNull(),
  recoveryCreditorId: uuid('recovery_creditor_id').notNull(),

  // Proposta
  proposedAmount: decimal('proposed_amount', { precision: 15, scale: 2 }).notNull(),
  proposedInstallments: integer('proposed_installments'),
  proposedFirstPayment: date('proposed_first_payment'),
  proposedInterestRate: decimal('proposed_interest_rate', { precision: 7, scale: 4 }),

  // Comparativo
  originalAmount: decimal('original_amount', { precision: 15, scale: 2 }).notNull(),
  discountPercentage: decimal('discount_percentage', { precision: 5, scale: 2 }),

  // Justificativa
  proposalRationale: text('proposal_rationale'),

  // Resposta do credor
  creditorResponse: varchar('creditor_response', { length: 30 }),
  counterProposalAmount: decimal('counter_proposal_amount', { precision: 15, scale: 2 }),
  counterProposalDetails: text('counter_proposal_details'),

  // Negociação
  negotiationRounds: integer('negotiation_rounds').default(0),
  lastContactDate: date('last_contact_date'),
  nextActionDate: date('next_action_date'),
  nextActionType: varchar('next_action_type', { length: 50 }),

  createdAt: timestamp('created_at').defaultNow(),
});
```

### 3.5 Parcelas do Acordo (Geradas após homologação)

```typescript
export const agreementInstallments = pgTable('agreement_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryCreditorId: uuid('recovery_creditor_id').notNull(),
  scenarioId: uuid('scenario_id').notNull(),

  // Parcela
  installmentNumber: integer('installment_number').notNull(),
  dueDate: date('due_date').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),

  // Status
  status: varchar('status', { length: 20 }).notNull().default('pendente'),
  // 'pendente', 'agendado', 'pago', 'atrasado', 'renegociado'

  // Pagamento
  paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).default('0'),
  paidDate: date('paid_date'),
  paymentMethod: varchar('payment_method', { length: 30 }),

  // Vinculação com Control (só quando liberado)
  controlApId: uuid('control_ap_id'), // FK para contas_a_pagar do Control
  isReleasedToControl: boolean('is_released_to_control').default(false),
  releasedAt: timestamp('released_at'),

  createdAt: timestamp('created_at').defaultNow(),
});
```

### 3.6 Workflow de Ações

```typescript
export const recoveryActions = pgTable('recovery_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryProcessId: uuid('recovery_process_id').notNull(),

  // Ação
  actionType: varchar('action_type', { length: 50 }).notNull(),
  // 'levantamento', 'contato_inicial', 'envio_proposta', 'reuniao_negociacao',
  // 'ajuste_proposta', 'analise_viabilidade', 'aprovacao_interna',
  // 'aceite_credor', 'homologacao', 'geracao_parcelas', 'liberacao_pagamento',
  // 'monitoramento', 'alerta_inadimplencia', 'acao_judicial'

  actionTitle: varchar('action_title', { length: 255 }).notNull(),
  actionDescription: text('action_description'),

  // Responsáveis
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedTeam: varchar('assigned_team', { length: 50 }),

  // Vinculação
  recoveryCreditorId: uuid('recovery_creditor_id'),
  scenarioId: uuid('scenario_id'),

  // Prazos
  dueDate: date('due_date'),
  completedAt: timestamp('completed_at'),

  // Status
  status: varchar('status', { length: 30 }).notNull().default('pendente'),
  priority: varchar('priority', { length: 20 }).default('media'),

  // Resultado
  outcome: text('outcome'),
  outcomeDocuments: jsonb('outcome_documents'),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantRecoveryIdx: index('action_tenant_recovery_idx').on(table.tenantId, table.recoveryProcessId),
  statusIdx: index('action_status_idx').on(table.status),
  dueDateIdx: index('action_due_date_idx').on(table.dueDate),
}));
```

### 3.7 Toneraud (Timeline Administrativo)

```typescript
export const recoveryTimeline = pgTable('recovery_timeline', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryProcessId: uuid('recovery_process_id').notNull(),

  // Evento
  eventDate: timestamp('event_date').notNull().defaultNow(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  // 'processo_iniciado', 'divida_identificada', 'credor_contatado',
  // 'proposta_enviada', 'reuniao_realizada', 'analise_feita',
  // 'documento_protocolado', 'proposta_aceita', 'acordo_firmado',
  // 'parcela_gerada', 'parcela_liberada', 'pagamento_efetuado',
  // 'inadimplencia_detectada', 'acao_judicial', 'comunicacao_externa'

  eventTitle: varchar('event_title', { length: 255 }).notNull(),
  eventDescription: text('event_description'),

  // Vinculações
  recoveryCreditorId: uuid('recovery_creditor_id'),
  actionId: uuid('action_id'),
  scenarioId: uuid('scenario_id'),
  installmentId: uuid('installment_id'),

  // Autor
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: varchar('created_by_name', { length: 100 }),

  // Evidências
  attachments: jsonb('attachments'),

  // Visibilidade
  isPublic: boolean('is_public').default(false),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tenantRecoveryDateIdx: index('timeline_tenant_recovery_date_idx')
    .on(table.tenantId, table.recoveryProcessId, table.eventDate),
}));
```

---

## 4. REQUISITOS FUNCIONAIS DETALHADOS

### 4.1 Levantamento de Dívidas

| Requisito | Descrição | Prioridade |
|-----------|-----------|------------|
| **Cadastro manual de dívida** | Incluir credor, valor, origem, data de vencimento | 🔴 Alta |
| **Importação de extratos** | Upload de extratos bancários, relatórios de cobrança | 🔴 Alta |
| **Classificação automática** | Sistema sugere tipo (banco, fornecedor, tributo) | 🟡 Média |
| **Cálculo de atualização** | Juros, multa, correção monetária até data de corte | 🔴 Alta |
| **Vinculação com Pessoa** | Link com cadastro central (CNPJ/CPF) | 🔴 Alta |
| **Anexo de documentos** | Contratos, notas fiscais, cobranças, protestos | 🟡 Média |
| **Priorização** | Flag crítico/alto/médio/baixo com justificativa | 🔴 Alta |

### 4.2 Negociação e Acordos

| Requisito | Descrição | Prioridade |
|-----------|-----------|------------|
| **Simulador financeiro** | Calcular CET/TIR real, comparar cenários | 🔴 Alta |
| **Proposta formal** | Gerar documento de proposta para envio ao credor | 🔴 Alta |
| **Contra-proposta** | Registrar resposta do credor com novos termos | 🔴 Alta |
| **Workflow de aprovação** | Controller → Diretor → Sócio (por valor/impacto) | 🔴 Alta |
| **Análise de viabilidade** | Score de viabilidade baseado em fluxo de caixa | 🔴 Alta |
| **Comparação de cenários** | Side-by-side de 2-3 propostas diferentes | 🟡 Média |
| **Histórico de negociação** | Todas as rodadas de proposta/contra-proposta | 🔴 Alta |

### 4.3 Formalização e Liberação

| Requisito | Descrição | Prioridade |
|-----------|-----------|------------|
| **Geração de parcelas** | Automática após acordo firmado (com regras de datas) | 🔴 Alta |
| **Agendamento de pagamento** | Parcelas vão para fila de liberação | 🔴 Alta |
| **Liberação para Control** | Parcela vira Conta a Pagar no módulo financeiro | 🔴 Alta |
| **Bloqueio de liberação** | Só libera se caixa projetado permite | 🔴 Alta |
| **Monitoramento de cumprimento** | Acompanhamento de pagamentos em dia/atraso | 🔴 Alta |
| **Alerta de inadimplência** | Se parcela do acordo atrasa, alerta imediato | 🔴 Alta |
| **Renegociação de acordo** | Se quebrar acordo, reiniciar negociação | 🟡 Média |

### 4.4 Toneraud Administrativo

| Requisito | Descrição | Prioridade |
|-----------|-----------|------------|
| **Timeline cronológica** | Todos os eventos em ordem temporal | 🔴 Alta |
| **Filtros por credor** | Visualizar apenas interações com credor X | 🔴 Alta |
| **Filtros por tipo** | Processo, contato, proposta, assembleia, pagamento | 🔴 Alta |
| **Anexos vinculados** | Documentos, emails, atas, contratos | 🟡 Média |
| **Exportação** | PDF da timeline para auditoria/judicial | 🟡 Média |
| **Notificações** | Alerta quando ação está próxima do vencimento | 🔴 Alta |
| **Comentários** | Adicionar notas internas em qualquer evento | 🟡 Média |

---

## 5. REGRAS DE NEGÓCIO CRÍTICAS

### 5.1 Isolamento Absoluto

```
REGRA #001: DÍVIDAS EM NEGOCIAÇÃO NÃO GERAM AP/AR NORMAL

Se uma dívida está em recoveryCreditor.negotiationStatus 
IN ('pendente', 'em_negociacao', 'proposta_enviada', 'aceita'):
  → NÃO criar contas_a_pagar para essa dívida
  → NÃO incluir em fluxo de caixa operacional
  → NÃO gerar alertas de vencimento no Control
  → NÃO permitir pagamento automático
  → SIM criar recoveryCreditor com status apropriado
  → SIM incluir em orçamento de negociação
  → SIM gerar alertas no workflow de recuperação

REGRA #002: SÓ ACORDO HOMOLOGADO VIRA PAGAMENTO

Se recoveryCreditor.negotiationStatus = 'acordo_firmado' 
E agreementInstallments geradas:
  → Cada parcela com isReleasedToControl = false
  → Sistema verifica caixa projetado para liberação
  → Se caixa permite: isReleasedToControl = true
  → Criar contas_a_pagar no Control vinculada à parcela
  → Marcar parcela como 'agendado'
  → Registrar na toneraud: "Parcela X liberada para pagamento"

REGRA #003: PARCELA ATRASADA DISPARA ALERTA

Se agreementInstallments.status = 'atrasado' 
E dias de atraso > 10:
  → Alerta CRÍTICO para Controller + Diretor
  → Sugerir renegociação ou ação judicial
  → Atualizar score de viabilidade do processo
  → Registrar na toneraud: "Inadimplência detectada"
```

### 5.2 Cálculo de CET/TIR (Custo Efetivo Total)

```typescript
function calculateCET(
  originalAmount: number,
  installments: { number: number; amount: number; date: Date }[],
  firstPaymentDate: Date
): CETResult {

  // Fluxo de caixa: valor negativo (dívida) + parcelas positivas (pagamentos)
  const cashFlows: number[] = [-originalAmount];
  const dates: Date[] = [new Date()]; // Hoje

  for (const inst of installments) {
    cashFlows.push(inst.amount);
    dates.push(inst.date);
  }

  // Calcular TIR (Taxa Interna de Retorno)
  const tir = calculateIRR(cashFlows, dates);

  // Converter para taxa mensal
  const monthlyRate = Math.pow(1 + tir, 1/12) - 1;

  // Converter para taxa anual
  const annualRate = Math.pow(1 + monthlyRate, 12) - 1;

  return {
    tir: tir,
    monthlyRate: monthlyRate,
    annualRate: annualRate,
    totalPaid: installments.reduce((sum, i) => sum + i.amount, 0),
    totalInterest: installments.reduce((sum, i) => sum + i.amount, 0) - originalAmount,
    isViable: monthlyRate < 0.03 // Viável se < 3% a.m.
  };
}
```

### 5.3 Liberação Condicional de Parcelas

```typescript
function canReleaseInstallment(
  installment: AgreementInstallment,
  cashFlowProjection: CashFlowProjection[],
  bufferPercentage: number = 0.15 // 15% de gordura
): boolean {

  const dueDate = new Date(installment.dueDate);
  const monthProjection = cashFlowProjection.find(
    p => p.month === format(dueDate, 'yyyy-MM')
  );

  if (!monthProjection) return false;

  // Verificar se caixa do mês permite pagamento
  const availableCash = monthProjection.projectedBalance * (1 - bufferPercentage);

  if (availableCash >= installment.amount) {
    return true;
  }

  // Se não permite, sugerir adiamento ou renegociação
  return false;
}
```

---

## 6. INTERFACE DO USUÁRIO

### 6.1 Dashboard de Recuperação

```
┌─────────────────────────────────────────────────────────────────┐
│  RECUPERAÇÃO DE EMPRESAS                    [+ Nova Dívida]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EMPRESA: Cliente X (CNPJ: 12.345.678/0001-90)                   │
│  Processo: #REC-2026-001 | Status: EM NEGOCIAÇÃO                 │
│                                                                  │
│  RESUMO DA CARTEIRA:                                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ TOTAL EM NEGOCIAÇÃO:                    R$ 847.350,00       ││
│  │ TOTAL DE ACORDOS FIRMADOS:              R$ 199.200,00      ││
│  │ TOTAL PAGO:                             R$ 0,00            ││
│  │ SALDO A NEGOCIAR:                       R$ 648.150,00    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  POR TIPO:                                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐│
│  │ 🏦 BANCOS   │ │ 🏭 FORNEC.  │ │ 🏛️ TRIBUTOS │ │ 👷 TRABALH. ││
│  │ R$ 312.012  │ │ R$ 425.000  │ │ R$ 85.000   │ │ R$ 25.338   ││
│  │  4 credores │ │ 18 credores │ │  2 credores │ │  6 credores ││
│  │ 🟢 1 acordo │ │ 🟡 5 em neg.│ │ 🔴 1 atraso │ │ ⚪ 0 iniciado││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘│
│                                                                  │
│  ACORDOS FIRMADOS:                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🏦 Santander        │ R$ 132.012 → R$ 199.200 │ 78 parcelas ││
│  │    Status: CUMPRINDO │ Próxima: 15/05 (R$ 800) │ 1/78 paga   ││
│  │                      │ CET: 1,0559% a.m.       │             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ 🏦 Banco do Brasil  │ R$ 85.000 → R$ 95.000   │ 24 parcelas ││
│  │    Status: HOMOLOGADO│ Início: 01/06           │ 0/24 pagas  ││
│  │                      │ CET: 0,85% a.m.          │             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ALERTAS:                                                        │
│  ⚠️ 3 fornecedores sem proposta enviada (prazo: 15 dias)        │
│  🔴 Banco Inter ameaçando ação judicial (R$ 45.000)             │
│  🟡 Prefeitura — ISS atrasado, multa crescendo 1% ao dia       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Tela de Detalhe do Credor (Santander)

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Voltar                    [Editar] [Ações ▼] [Arquivar]      │
│                                                                  │
│  🏦 BANCO SANTANDER (BRASIL) S.A.                                │
│  CNPJ: 90.400.888/0001-42 | Tipo: Bancária | Prioridade: CRÍTICA │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ DÍVIDA ORIGINAL                                             │  │
│  │ Cheque especial:        R$ 45.000,00                        │  │
│  │ Capital de giro:        R$ 62.012,00                        │  │
│  │ Cartão de crédito:      R$ 25.000,00                        │  │
│  │ ─────────────────────────────────────                       │  │
│  │ TOTAL:                  R$ 132.012,00                       │  │
│  │ Atualizado até:         28/04/2026                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ACORDO FIRMADO                                              │  │
│  │ Status:                 ✅ HOMOLOGADO                       │  │
│  │ Proposta:               6x R$ 800 + 72x R$ 2.700             │  │
│  │ Total a pagar:          R$ 199.200,00                       │  │
│  │ CET (TIR real):         1,0559% a.m. (13,43% a.a.)          │  │
│  │ Taxa informada:         1,18% a.m.                          │  │
│  │ Viabilidade:            ✅ VIÁVEL (score 0,85)              │  │
│  │                                                             │  │
│  │ PRÓXIMAS PARCELAS:                                          │  │
│  │ 15/05/2026  │ Parcela 1/78  │ R$ 800,00   │ ⏳ Aguardando   │  │
│  │ 15/06/2026  │ Parcela 2/78  │ R$ 800,00   │ ⏳ Aguardando   │  │
│  │ ...                                                   │  │
│  │ 15/11/2026 │ Parcela 7/78  │ R$ 2.700,00 │ ⏳ Aguardando   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [📋 Geral] [💰 Dívida] [📄 Proposta] [📊 Simulação] [📝 Toneraud] │
│                                                                  │
│  TAB: TONERAUD                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 15/03  📞 Contato inicial — Dívida confirmada R$ 132.012   │  │
│  │ 20/03  📄 Proposta recebida — 6x800 + 72x2700               │  │
│  │ 25/04  📊 Análise TIR — CET real 1,0559% a.m. (VIÁVEL)    │  │
│  │ 28/04  ✅ Aceite formal — Diretor aprovou                   │  │
│  │ 15/05  ⏳ Parcela 1 agendada — R$ 800,00                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Simulador de Cenários

```
┌─────────────────────────────────────────────────────────────────┐
│  SIMULADOR DE CENÁRIOS — SANTANDER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DÍVIDA ORIGINAL: R$ 132.012,00                                   │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │ CENÁRIO A       │  │ CENÁRIO B       │  │ CENÁRIO C       │    │
│  │ (Proposta       │  │ (Contra-proposta│  │ (Nossa proposta)│    │
│  │  Santander)     │  │  nossa)         │  │                 │    │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤    │
│  │ Entrada: 6x800  │  │ Entrada: 3x1500 │  │ Entrada: 12x500 │    │
│  │ Principal:      │  │ Principal:      │  │ Principal:      │    │
│  │   72x2700         │  │   60x3200       │  │   84x2200       │    │
│  │ Total: R$199.200│  │ Total: R$196.500│  │ Total: R$190.800│    │
│  │ Prazo: 78 meses │  │ Prazo: 63 meses │  │ Prazo: 96 meses │    │
│  │ CET: 1,0559%    │  │ CET: 1,25%      │  │ CET: 0,95%      │    │
│  │ a.m.            │  │ a.m.            │  │ a.m.            │    │
│  │                 │  │                 │  │                 │    │
│  │ [✅ Aceita]     │  │ [📤 Enviar]     │  │ [📤 Enviar]     │    │
│  │                 │  │                 │  │                 │    │
│  │ Viabilidade:    │  │ Viabilidade:    │  │ Viabilidade:    │    │
│  │ 85% (VIÁVEL)    │  │ 72% (VIÁVEL)    │  │ 92% (VIÁVEL)    │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│                                                                  │
│  GRÁFICO DE FLUXO DE CAIXA (próximos 24 meses):                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │    R$ 0 ─┬──────────────────────────────────────────────    │  │
│  │          │    ╱╲    ╱╲    ╱╲    ╱╲    ╱╲    ╱╲            │  │
│  │   -R$1M ─┤   ╱  ╲  ╱  ╲  ╱  ╲  ╱  ╲  ╱  ╲  ╱  ╲           │  │
│  │          │  ╱    ╲╱    ╲╱    ╲╱    ╲╱    ╲╱    ╲          │  │
│  │   -R$2M ─┤ ╱                                                │  │
│  │          └──────────────────────────────────────────────    │  │
│  │           M1  M3  M6  M9  M12 M15 M18 M21 M24              │  │
│  │                                                             │  │
│  │ Legenda: ─── Cenário A  ─ ─ Cenário B  ··· Cenário C        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. API ENDPOINTS

### 7.1 Recovery Process

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/recovery` | Listar processos de recuperação |
| POST | `/api/v1/recovery` | Criar novo processo |
| GET | `/api/v1/recovery/:id` | Detalhes do processo |
| PUT | `/api/v1/recovery/:id` | Atualizar processo |
| GET | `/api/v1/recovery/:id/dashboard` | Dashboard com KPIs |

### 7.2 Credores (Dívidas)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/recovery/:id/creditors` | Listar credores |
| POST | `/api/v1/recovery/:id/creditors` | Adicionar credor/dívida |
| GET | `/api/v1/recovery/:id/creditors/:creditorId` | Detalhes |
| PUT | `/api/v1/recovery/:id/creditors/:creditorId` | Atualizar |
| DELETE | `/api/v1/recovery/:id/creditors/:creditorId` | Remover |
| POST | `/api/v1/recovery/:id/creditors/import` | Importar extrato |
| GET | `/api/v1/recovery/:id/creditors/:creditorId/timeline` | Toneraud |

### 7.3 Cenários e Propostas

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/recovery/:id/scenarios` | Listar cenários |
| POST | `/api/v1/recovery/:id/scenarios` | Criar cenário |
| POST | `/api/v1/recovery/:id/scenarios/:scenarioId/simulate` | Simular |
| POST | `/api/v1/recovery/:id/scenarios/:scenarioId/approve` | Aprovar |
| GET | `/api/v1/recovery/:id/creditors/:creditorId/proposals` | Propostas |
| POST | `/api/v1/recovery/:id/creditors/:creditorId/proposals` | Enviar proposta |
| PUT | `/api/v1/recovery/:id/creditors/:creditorId/proposals/:proposalId` | Responder |

### 7.4 Parcelas e Liberação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/recovery/:id/installments` | Listar parcelas |
| POST | `/api/v1/recovery/:id/creditors/:creditorId/generate-installments` | Gerar parcelas |
| POST | `/api/v1/recovery/:id/installments/:installmentId/release` | Liberar para Control |
| GET | `/api/v1/recovery/:id/installments/pending-release` | Parcelas pendentes |
| POST | `/api/v1/recovery/:id/installments/batch-release` | Liberar em lote |

### 7.5 Ações e Workflow

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/recovery/:id/actions` | Listar ações |
| POST | `/api/v1/recovery/:id/actions` | Criar ação |
| PUT | `/api/v1/recovery/:id/actions/:actionId` | Atualizar status |
| GET | `/api/v1/recovery/:id/actions/pending` | Ações pendentes |
| GET | `/api/v1/recovery/:id/actions/overdue` | Ações atrasadas |

---

## 8. INTEGRAÇÕES

### 8.1 Com Arcádia Control (Financeiro)

```
FLUXO DE LIBERAÇÃO DE PARCELA:

1. agreementInstallments.status = 'pendente'
   └── isReleasedToControl = false

2. Sistema verifica caixa projetado (Control)
   └── Se caixa >= parcela * 1.15 (buffer 15%)

3. Controller aprova liberação manual (ou automática se configurado)
   └── POST /api/v1/recovery/:id/installments/:id/release

4. Sistema cria contas_a_pagar no Control:
   {
     "pessoaId": "uuid-santander",
     "description": "Parcela 1/78 - Acordo Santander REC-2026-001",
     "amount": 800.00,
     "dueDate": "2026-05-15",
     "recoveryInstallmentId": "uuid-parcela",
     "category": "recuperacao", // Flag especial
     "skipApprovalWorkflow": true // Já aprovado no Recovery
   }

5. agreementInstallments atualiza:
   └── isReleasedToControl = true
   └── controlApId = "uuid-da-ap-criada"
   └── status = 'agendado'

6. Toneraud registra:
   └── "Parcela 1/78 liberada para pagamento em 15/05/2026"
```

### 8.2 Com Cadastro de Pessoas

```
FLUXO: PESSOA → CREDOR

1. Santander já existe no cadastro de pessoas (CNPJ 90.400.888/0001-42)
   └── Papel: fornecedor (banco)

2. Ao criar recoveryCreditor:
   └── pessoaId = "uuid-santander"
   └── Sistema herda dados: nome, CNPJ, contato, endereço

3. Se Santander não existe:
   └── Sistema sugere criar nova pessoa
   └── Ou cadastra como "credor_temporario" para validação posterior

4. Após recuperação:
   └── Papel de credor é removido
   └── Papel de fornecedor mantido (se houver relação comercial)
```

### 8.3 Com Construtor de Agentes do Arcádia Consult

```yaml
agent:
  name: "agente_recuperacao"
  description: "Agente especializado em recuperação e renegociação de dívidas"

  skills:
    - name: "analyze_viability"
      description: "Analisa viabilidade econômico-financeira do acordo"
      endpoint: "/api/v1/recovery/:id/analysis/viability"

    - name: "calculate_cet"
      description: "Calcula CET/TIR real da proposta"
      endpoint: "/api/v1/recovery/:id/creditors/:id/calculate-cet"

    - name: "generate_proposal"
      description: "Gera proposta de reestruturação baseada em cenários"
      endpoint: "/api/v1/recovery/:id/scenarios/generate"

    - name: "predict_cash_flow"
      description: "Projeta fluxo de caixa com pagamentos do acordo"
      endpoint: "/api/v1/recovery/:id/cash-flow-projection"

    - name: "alert_risk"
      description: "Alerta sobre riscos de inadimplência do acordo"
      endpoint: "/api/v1/recovery/:id/monitoring/alerts"

    - name: "generate_timeline_report"
      description: "Gera relatório da toneraud para judicial"
      endpoint: "/api/v1/recovery/:id/timeline/report"
```

---

## 8.5 Módulo de Atas de Autorização (Agente Construtor)

### 8.5.1 Visão Geral

O módulo de **Atas de Autorização** é um componente crítico do Recovery que formaliza todas as decisões de negociação em documentos estruturados, gerados por um **Agente especializado construído no Construtor de Agentes** do Arcádia.

> **Princípio:** Toda decisão de negociação (aprovação, rejeição, contra-proposta, homologação) deve ser documentada em ata formal, com assinatura digital e registro imutável na toneraud.

### 8.5.2 Agente "Ata de Autorização" (Construtor de Agentes)

```yaml
# Configuração do Agente no Construtor de Agentes
agent:
  name: "agente_ata_autorizacao"
  description: "Agente especializado em gerar atas de autorização para decisões de negociação no Recovery"
  icon: "📋"
  category: "juridico"

  llm_config:
    default_model: "claude-sonnet-4.6"
    fallback_model: "gemini-2.0-pro"
    temperature: 0.3  # Baixa criatividade, alta precisão jurídica
    max_tokens: 4000

  skills:
    - name: "generate_authorization_minutes"
      description: "Gera ata de autorização completa baseada em dados do processo de recuperação"
      type: "generation"
      template_engine: "jinja2"
      output_format: "structured_json"

    - name: "extract_decision_context"
      description: "Extrai contexto completo da decisão (dívidas, propostas, análises)"
      type: "query"
      endpoint: "/api/v1/recovery/{recoveryId}/context"

    - name: "validate_legal_compliance"
      description: "Valida se ata atende requisitos legais (Lei 11.101/2005)"
      type: "validation"
      rules_engine: "drools"

    - name: "generate_signature_block"
      description: "Gera bloco de assinaturas com hash de integridade"
      type: "generation"
      crypto: "sha256"

    - name: "register_immutable_record"
      description: "Registra ata na toneraud como registro imutável"
      type: "action"
      endpoint: "/api/v1/recovery/{recoveryId}/timeline"

    - name: "notify_stakeholders"
      description: "Notifica stakeholders sobre nova ata gerada"
      type: "notification"
      channels: ["email", "whatsapp", "in_app"]

  memory:
    type: "conversation"
    retention: "permanent"
    context_window: "full_process"

  guardrails:
    - "NUNCA omitir valor total da dívida na ata"
    - "NUNCA omitir CET/TIR real do acordo"
    - "SEMPRE incluir alternativas consideradas e rejeitadas"
    - "SEMPRE citar base legal (Lei 11.101/2005, artigos relevantes)"
    - "SEMPRE registrar quórum de aprovação se aplicável"
    - "NUNCA gerar ata sem contexto completo do processo"
    - "SEMPRE incluir recomendação do Agente Controller"
    - "SEMPRE registrar data/hora e identificação do agente gerador"

  triggers:
    - event: "scenario_approved"
      description: "Quando cenário de negociação é aprovado internamente"
      auto_generate: true

    - event: "creditor_accepted"
      description: "Quando credor aceita proposta"
      auto_generate: true

    - event: "agreement_signed"
      description: "Quando acordo é formalizado"
      auto_generate: true

    - event: "manual_request"
      description: "Quando usuário solicita ata manualmente"
      auto_generate: false

    - event: "assembly_approved"
      description: "Quando assembleia de credores aprova plano"
      auto_generate: true
      priority: "critical"

  templates:
    - id: "ata_aprovacao_cenario"
      name: "Ata de Aprovação de Cenário de Negociação"
      description: "Formaliza aprovação interna de cenário"

    - id: "ata_aceite_credor"
      name: "Ata de Aceite de Proposta pelo Credor"
      description: "Formaliza aceite da proposta pelo credor"

    - id: "ata_homologacao_acordo"
      name: "Ata de Homologação de Acordo"
      description: "Formaliza acordo firmado entre partes"

    - id: "ata_assembleia"
      name: "Ata de Assembleia de Credores"
      description: "Formaliza deliberações da assembleia"

    - id: "ata_renegociacao"
      name: "Ata de Renegociação de Acordo Quebrado"
      description: "Formaliza reabertura de negociação"

    - id: "ata_decisao_rejeicao"
      name: "Ata de Decisão de Rejeição de Proposta"
      description: "Formaliza rejeição com justificativa"
```

### 8.5.3 Estrutura da Ata de Autorização

```typescript
export const authorizationMinutes = pgTable('authorization_minutes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  recoveryProcessId: uuid('recovery_process_id').notNull()
    .references(() => recoveryProcesses.id),

  // Identificação
  minuteNumber: varchar('minute_number', { length: 50 }).notNull(),
  // Formato: ATA-REC-2026-001-001 (processo + sequencial)

  templateId: varchar('template_id', { length: 50 }).notNull(),
  // 'ata_aprovacao_cenario', 'ata_aceite_credor', etc.

  // Contexto da decisão
  decisionType: varchar('decision_type', { length: 50 }).notNull(),
  // 'aprovacao_cenario', 'aceite_proposta', 'homologacao_acordo',
  // 'rejeicao_proposta', 'renegociacao', 'assembleia_deliberacao'

  // Dados do processo (snapshot no momento da decisão)
  processSnapshot: jsonb('process_snapshot').notNull(),
  /*
  {
    processNumber: "REC-2026-001",
    companyName: "Cliente X LTDA",
    companyDocument: "12.345.678/0001-90",
    totalDebtAmount: 847350.00,
    totalCreditors: 30,
    processStatus: "em_negociacao",
    decisionDate: "2026-04-28T15:30:00Z"
  }
  */

  // Dados do cenário/proposta (snapshot)
  scenarioSnapshot: jsonb('scenario_snapshot'),
  /*
  {
    scenarioId: "uuid",
    scenarioName: "Santander - Renegociação 78 meses",
    scenarioType: "parcelamento",
    originalDebtAmount: 132012.00,
    proposedTotalPayment: 199200.00,
    numberOfInstallments: 78,
    reducedInitialInstallments: 6,
    reducedInstallmentAmount: 800.00,
    normalInstallmentAmount: 2700.00,
    cetCalculated: 0.010559,
    viabilityScore: 0.85,
    cashFlowImpact: [...]
  }
  */

  // Dados do credor (snapshot)
  creditorSnapshot: jsonb('creditor_snapshot'),
  /*
  {
    creditorId: "uuid",
    creditorName: "Banco Santander (Brasil) S.A.",
    creditorDocument: "90.400.888/0001-42",
    creditorType: "banco",
    originalDebtAmount: 132012.00,
    debtModalities: [
      {type: "cheque_especial", amount: 45000},
      {type: "capital_giro", amount: 62012},
      {type: "cartao_credito", amount: 25000}
    ],
    negotiationStatus: "acordo_firmado"
  }
  */

  // Análise do Agente Controller (snapshot)
  controllerAnalysis: jsonb('controller_analysis'),
  /*
  {
    agentName: "agente_controller",
    analysisDate: "2026-04-25T16:00:00Z",
    recommendation: "ACEITAR",
    viabilityScore: 0.85,
    keyPoints: [
      "CET real 1,0559% a.m. inferior aos 1,18% informados",
      "Parcela reduzida nos primeiros 6 meses permite recomposição de caixa",
      "Taxa efetiva de 13,43% a.a. é competitiva para renegociação"
    ],
    riskFactors: [
      "Primeiras 6 parcelas consomem 68% do fluxo operacional",
      "Projeção de receita depende de retomada de contrato Y"
    ],
    alternativeScenarios: [
      {id: "uuid", name: "Cenário B", viabilityScore: 0.72, status: "rejeitado"}
    ]
  }
  */

  // Decisão formal
  decision: jsonb('decision').notNull(),
  /*
  {
    decision: "APROVAR",
    // "APROVAR", "REJEITAR", "CONTRA_PROPOSTA", "ADiar", "RENEGOCIAR"

    justification: "Cenário viável com CET real inferior ao informado. Recomposição de caixa nos primeiros 6 meses é estratégica.",

    conditions: [
      "Manter reserva de caixa de 15% durante período de entrada",
      "Renegociar prazo com fornecedores operacionais críticos",
      "Monitorar receita do contrato Y mensalmente"
    ],

    dissentingOpinions: [
      {
        stakeholder: "Diretor Financeiro",
        opinion: "Preferiria cenário com prazo menor, mesmo com parcela maior",
        reason: "Reduzir exposição a 78 meses"
      }
    ],

    quorum: {
      present: 3,
      total: 3,
      votesFavor: 2,
      votesAgainst: 0,
      abstentions: 1
    }
  }
  */

  // Conteúdo gerado pelo agente
  generatedContent: text('generated_content').notNull(),
  // Texto completo da ata em formato markdown

  structuredContent: jsonb('structured_content'),
  /*
  {
    header: {
      title: "ATA DE AUTORIZAÇÃO DE CENÁRIO DE NEGOCIAÇÃO",
      minuteNumber: "ATA-REC-2026-001-003",
      date: "2026-04-28",
      location: "São Paulo, SP",
      company: "Arcádia Consult - BPO Financeiro"
    },
    preamble: "...",
    participants: [...],
    deliberations: [...],
    decision: "...",
    signatures: [...]
  }
  */

  // Assinaturas digitais
  signatures: jsonb('signatures'),
  /*
  [
    {
      stakeholderId: "uuid",
      stakeholderName: "João Silva",
      stakeholderRole: "Controller Responsável",
      signatureHash: "sha256:abc123...",
      signedAt: "2026-04-28T15:35:00Z",
      ipAddress: "192.168.1.100",
      userAgent: "Mozilla/5.0..."
    }
  ]
  */

  // Hash de integridade
  integrityHash: varchar('integrity_hash', { length: 64 }).notNull(),
  // SHA-256 do conteúdo + metadados

  // Status
  status: varchar('status', { length: 30 }).notNull().default('rascunho'),
  // 'rascunho', 'aguardando_assinaturas', 'parcialmente_assinada', 
  // 'totalmente_assinada', 'homologada', 'arquivada'

  // Vinculações
  scenarioId: uuid('scenario_id').references(() => negotiationScenarios.id),
  creditorId: uuid('creditor_id').references(() => recoveryCreditors.id),
  actionId: uuid('action_id').references(() => recoveryActions.id),

  // Metadados do agente
  generatedByAgent: varchar('generated_by_agent', { length: 100 }).notNull(),
  // 'agente_ata_autorizacao_v1.0'

  generationPrompt: text('generation_prompt'),
  // Prompt completo enviado ao LLM (para auditoria)

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),

}, (table) => ({
  tenantRecoveryIdx: index('ata_tenant_recovery_idx').on(table.tenantId, table.recoveryProcessId),
  numberIdx: uniqueIndex('ata_number_idx').on(table.minuteNumber),
  statusIdx: index('ata_status_idx').on(table.status),
}));
```

### 8.5.4 Templates de Ata

#### Template 1: Ata de Aprovação de Cenário

```markdown
# ATA DE AUTORIZAÇÃO DE CENÁRIO DE NEGOCIAÇÃO

**Número:** {{minuteNumber}}  
**Data:** {{decisionDate}}  
**Local:** {{location}}  
**Processo de Recuperação:** {{processNumber}}  

---

## 1. PARTICIPANTES

| Nome | Função | Presente | Assinatura |
|------|--------|----------|------------|
{{#participants}}
| {{name}} | {{role}} | {{present}} | {{signatureStatus}} |
{{/participants}}

## 2. CONTEXTO

Empresa: **{{companyName}}** (CNPJ: {{companyDocument}})  
Total da dívida em recuperação: **R$ {{totalDebtAmount}}**  
Número de credores: **{{totalCreditors}}**  

## 3. CENÁRIO APRESENTADO

**Cenário:** {{scenarioName}}  
**Tipo:** {{scenarioType}}  
**Credor:** {{creditorName}} ({{creditorDocument}})  

### 3.1 Dívida Original

| Modalidade | Valor |
|------------|-------|
{{#debtModalities}}
| {{type}} | R$ {{amount}} |
{{/debtModalities}}
| **TOTAL** | **R$ {{originalDebtAmount}}** |

### 3.2 Proposta de Acordo

- **Total a pagar:** R$ {{proposedTotalPayment}}
- **Número de parcelas:** {{numberOfInstallments}}
- **Parcela de entrada:** {{reducedInitialInstallments}}x R$ {{reducedInstallmentAmount}}
- **Parcela principal:** {{normalInstallments}}x R$ {{normalInstallmentAmount}}
- **Taxa informada:** {{proposedInterestRate}}% a.m.
- **CET calculado (TIR real):** {{cetCalculated}}% a.m. ({{cetAnnual}}% a.a.)

## 4. ANÁLISE DO AGENTE CONTROLLER

**Recomendação:** {{controllerRecommendation}}  
**Score de Viabilidade:** {{viabilityScore}}/1.00  

### 4.1 Pontos Positivos
{{#controllerKeyPoints}}
- {{.}}
{{/controllerKeyPoints}}

### 4.2 Fatores de Risco
{{#controllerRiskFactors}}
- {{.}}
{{/controllerRiskFactors}}

### 4.3 Cenários Alternativos Considerados
{{#alternativeScenarios}}
- **{{name}}** (Viabilidade: {{viabilityScore}}) — {{status}}
{{/alternativeScenarios}}

## 5. DELIBERAÇÃO

Após análise do cenário apresentado e considerando:

1. A viabilidade econômico-financeira demonstrada (score {{viabilityScore}});
2. O CET real de {{cetCalculated}}% a.m., inferior à taxa informada de {{proposedInterestRate}}% a.m.;
3. A estratégia de recomposição de caixa nos primeiros {{reducedInitialInstallments}} meses;
4. {{#conditions}}5. {{.}};{{/conditions}}

**FICA APROVADO** o cenário de negociação "{{scenarioName}}" para o credor {{creditorName}}, nos termos acima descritos.

## 6. CONDIÇÕES DA APROVAÇÃO

{{#conditions}}
{{number}}. {{description}};
{{/conditions}}

## 7. OPINIÕES DIVERGENTES

{{#dissentingOpinions}}
**{{stakeholder}}** ({{role}}): {{opinion}}  
*Justificativa:* {{reason}}

{{/dissentingOpinions}}
{{^dissentingOpinions}}
Não houve opiniões divergentes registradas.
{{/dissentingOpinions}}

## 8. QUÓRUM

Participantes presentes: {{quorum.present}}/{{quorum.total}}  
Votos favoráveis: {{quorum.votesFavor}}  
Votos contrários: {{quorum.votesAgainst}}  
Abstenções: {{quorum.abstentions}}  

**Resultado:** {{quorumResult}}

## 9. ASSINATURAS

{{#signatures}}
---

**{{name}}**  
{{role}}  
Assinado digitalmente em {{signedAt}}  
Hash: {{signatureHash}}

{{/signatures}}

---

*Documento gerado automaticamente pelo Agente Ata de Autorização ({{agentVersion}}) em {{generationDate}}*  
*Hash de integridade: {{integrityHash}}*  
*Esta ata é registro imutável nos termos da Lei 11.101/2005*
```

#### Template 2: Ata de Aceite de Proposta pelo Credor

```markdown
# ATA DE ACEITE DE PROPOSTA PELO CREDOR

**Número:** {{minuteNumber}}  
**Data:** {{decisionDate}}  
**Processo:** {{processNumber}}  
**Credor:** {{creditorName}} (CNPJ: {{creditorDocument}})  

---

## 1. HISTÓRICO DA NEGOCIAÇÃO

{{#negotiationHistory}}
- **{{date}}**: {{event}} — {{description}}
{{/negotiationHistory}}

## 2. PROPOSTA APRESENTADA

**Proposta Arcádia:** {{proposalSummary}}  
**Data de envio:** {{proposalSentDate}}  
**Resposta do credor:** {{creditorResponseDate}}  

## 3. ACEITE FORMAL

O credor **{{creditorName}}**, representado por {{creditorRepresentative}}, **ACEITA** a proposta de reestruturação nos seguintes termos:

- **Valor original:** R$ {{originalDebtAmount}}
- **Valor acordado:** R$ {{agreedAmount}}
- **Desconto:** {{discountPercentage}}%
- **Parcelas:** {{numberOfInstallments}}x de R$ {{installmentAmount}}
- **Primeiro pagamento:** {{firstPaymentDate}}
- **Taxa:** {{interestRate}}% a.m.

## 4. COMPROMISSOS DO CREDOR

{{#creditorCommitments}}
{{number}}. {{description}};
{{/creditorCommitments}}

## 5. COMPROMISSOS DA EMPRESA

{{#companyCommitments}}
{{number}}. {{description}};
{{/companyCommitments}}

## 6. CLÁUSULA PENAL

{{#penaltyClause}}
{{description}}
{{/penaltyClause}}

## 7. ASSINATURAS

{{#signatures}}
---

**{{name}}**  
{{role}} — {{organization}}  
Assinado digitalmente em {{signedAt}}  
Hash: {{signatureHash}}

{{/signatures}}

---

*Documento gerado automaticamente pelo Agente Ata de Autorização*  
*Hash de integridade: {{integrityHash}}*
```

### 8.5.5 Fluxo de Geração da Ata

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ TRIGGER     │───►│ COLETA DE   │───►│ GERAÇÃO   │───►│ REVISÃO   │
│ (evento)    │    │ CONTEXTO    │    │ PELO      │    │ HUMANA    │
└─────────────┘    │ (Agente)    │    │ AGENTE    │    │           │
                   └─────────────┘    └─────────────┘    └─────┬─────┘
                                                                 │
                    ┌─────────────────────────────────────────────┘
                    │
                    ▼
              ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
              │ ASSINATURA  │───►│ REGISTRO    │───►│ NOTIFICAÇÃO │
              │ DIGITAL     │    │ IMUTÁVEL    │    │ STAKEHOLDERS│
              └─────────────┘    │ (Toneraud)  │    └─────────────┘
                                 └─────────────┘
```

**Passo a passo:**

1. **Trigger:** Evento dispara geração (ex: cenário aprovado)
2. **Coleta de Contexto:** Agente busca todos os dados do processo, cenário, credor, análise do Controller
3. **Geração:** Agente monta prompt completo e chama LLM com template específico
4. **Revisão Humana:** Controller revisa, edita se necessário, aprova
5. **Assinatura Digital:** Stakeholders assinam com hash SHA-256
6. **Registro Imutável:** Ata vai para recoveryTimeline com flag isPublic = true
7. **Notificação:** Email/WhatsApp para todos os envolvidos

### 8.5.6 Exemplo de Interação com o Agente

```
Usuário: "Gerar ata de aprovação do cenário Santander"

Agente: "Iniciando geração da Ata de Autorização ATA-REC-2026-001-003...

Coletando contexto:
✓ Processo REC-2026-001 (Cliente X)
✓ Cenário: Santander - Renegociação 78 meses
✓ Credor: Banco Santander (Brasil) S.A.
✓ Análise Controller: Score 0.85 (VIÁVEL)
✓ CET real: 1,0559% a.m.
✓ 3 participantes identificados

Gerando ata...
✓ Preamble completo
✓ Contexto da dívida (R$ 132.012)
✓ Detalhamento das modalidades
✓ Análise do Controller incluída
✓ Cenários alternativos mencionados
✓ Condições de aprovação
✓ Bloco de assinaturas

Ata gerada: ATA-REC-2026-001-003
Status: AGUARDANDO_ASSINATURAS

Participantes para assinatura:
1. João Silva (Controller) — PENDENTE
2. Maria Santos (Diretora Financeira) — PENDENTE
3. Carlos Oliveira (Sócio) — PENDENTE

Enviar notificações de assinatura? [Sim/Não]"

Usuário: "Sim"

Agente: "Notificações enviadas:
✓ Email para joao.silva@arcadia.com
✓ Email para maria.santos@arcadia.com
✓ Email para carlos.oliveira@arcadia.com
✓ WhatsApp para Carlos Oliveira (sócio)

Prazo para assinatura: 48 horas
Lembrete automático em 24 horas se não assinado.

Ata registrada na toneraud como evento público."
```

### 8.5.7 Dashboard de Atas

```
┌─────────────────────────────────────────────────────────────────┐
│  ATAS DE AUTORIZAÇÃO                    [+ Gerar Nova Ata]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROCESSO: REC-2026-001 | Cliente X                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ RESUMO                                                      ││
│  │ Total de atas:        12                                    ││
│  │ Aguardando assinatura: 3                                    ││
│  │ Totalmente assinadas:  7                                    ││
│  │ Homologadas:           5                                    ││
│  │ Arquivadas:            2                                    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ATAS RECENTES                                               ││
│  │                                                             ││
│  │ 📋 ATA-REC-2026-001-012  │ Aprovação Cenário BB            ││
│  │    Status: ✅ Totalmente assinada                          ││
│  │    Data: 28/04/2026 | Credor: Banco do Brasil              ││
│  │    Assinaturas: 3/3 | Hash: abc123...                      ││
│  │                                                             ││
│  │ 📋 ATA-REC-2026-001-011  │ Aceite Proposta Santander       ││
│  │    Status: ⏳ Aguardando assinatura (2/3)                  ││
│  │    Data: 28/04/2026 | Credor: Santander                    ││
│  │    Pendente: Carlos Oliveira (Sócio)                       ││
│  │    [Reenviar notificação] [Assinar como substituto]        ││
│  │                                                             ││
│  │ 📋 ATA-REC-2026-001-010  │ Homologação Assembleia          ││
│  │    Status: 🏛️ Homologada                                   ││
│  │    Data: 25/04/2026 | 78% credores aprovaram              ││
│  │    Hash: def456... | Registro imutável                     ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [Ver todas] [Exportar relatório] [Auditoria]                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.5.8 API Endpoints para Atas

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/v1/recovery/:id/minutes/generate` | Gerar ata (agente) |
| GET | `/api/v1/recovery/:id/minutes` | Listar atas |
| GET | `/api/v1/recovery/:id/minutes/:minuteId` | Detalhes da ata |
| PUT | `/api/v1/recovery/:id/minutes/:minuteId` | Editar rascunho |
| POST | `/api/v1/recovery/:id/minutes/:minuteId/sign` | Assinar digitalmente |
| GET | `/api/v1/recovery/:id/minutes/:minuteId/verify` | Verificar integridade |
| POST | `/api/v1/recovery/:id/minutes/:minuteId/notify` | Reenviar notificação |
| GET | `/api/v1/recovery/:id/minutes/pending-signatures` | Pendentes de assinatura |

---

## 9. ROADMAP DE IMPLEMENTAÇÃO

### Sprint 1 — Fundação (Semanas 1-2)
- [ ] Criar tabelas: recoveryProcesses, recoveryCreditors, recoveryActions, recoveryTimeline
- [ ] Middleware de isolamento do fluxo operacional
- [ ] CRUD de processos de recuperação
- [ ] CRUD de credores/dívidas
- [ ] Dashboard básico de recuperação
- [ ] Importação de extratos/dívidas em massa

### Sprint 2 — Negociação (Semanas 3-4)
- [ ] Tabelas: negotiationScenarios, creditorProposals
- [ ] Simulador financeiro (CET/TIR)
- [ ] Cenários de reestruturação
- [ ] Workflow de proposta/contra-proposta
- [ ] Aprovação interna de cenários
- [ ] Geração de proposta formal (PDF)

### Sprint 3 — Acordos e Parcelas (Semanas 5-6)
- [ ] Tabela: agreementInstallments
- [ ] Geração automática de parcelas
- [ ] Workflow de homologação de acordo
- [ ] Liberação condicional para Control
- [ ] Monitoramento de cumprimento
- [ ] Alerta de inadimplência de acordo

### Sprint 4 — Toneraud e Integração (Semanas 7-8)
- [ ] Timeline completa com filtros
- [ ] Anexos e documentos vinculados
- [ ] Exportação de relatório para judicial
- [ ] Integração com Control (liberação de parcelas)
- [ ] Integração com Pessoas (vinculação de credores)
- [ ] Notificações automáticas (email/WhatsApp)

### Sprint 5 — Agente e Automação (Semanas 9-10)
- [ ] Agente Recovery no Construtor de Agentes do Arcádia Consult
- [ ] Análise preditiva de viabilidade
- [ ] Predição de comportamento de credores
- [ ] Geração automática de documentos
- [ ] Automação de ações (follow-up, alertas)
- [ ] Dashboard avançado com KPIs

### Sprint 6 — Atas de Autorização (Semanas 11-12)
- [ ] Agente Ata de Autorização no Construtor de Agentes
- [ ] Templates de ata (aprovação, aceite, homologação, assembleia)
- [ ] Geração automática de atas por trigger de evento
- [ ] Assinatura digital com hash SHA-256
- [ ] Registro imutável na toneraud
- [ ] Notificação automática de assinatura
- [ ] Dashboard de atas com status de assinatura
- [ ] Verificação de integridade do documento
- [ ] Agente Recovery no Construtor de Agentes do Arcádia Consult
- [ ] Análise preditiva de viabilidade
- [ ] Predição de comportamento de credores
- [ ] Geração automática de documentos
- [ ] Automação de ações (follow-up, alertas)
- [ ] Dashboard avançado com KPIs

---

## 10. CRITÉRIOS DE ACEITAÇÃO

### 10.1 Funcionais

| # | Critério | Como Testar |
|---|----------|-------------|
| 1 | Dívida cadastrada no Recovery NÃO aparece no Control AP | Criar dívida → verificar que não gerou AP |
| 2 | Acordo firmado gera parcelas no Recovery | Firmar acordo → verificar parcelas geradas |
| 3 | Parcela liberada vira AP no Control | Liberar parcela → verificar AP criada com flag recovery |
| 4 | CET calculado corretamente (caso Santander) | Simular proposta → verificar 1,0559% a.m. |
| 5 | Toneraud registra todos os eventos | Realizar ação → verificar timeline |
| 6 | Alerta de inadimplência funciona | Simular atraso → verificar alerta |
| 7 | Importação de extrato funciona | Upload extrato → verificar credores criados |
| 8 | Filtros da toneraud funcionam | Aplicar filtros → verificar resultados |

### 10.2 Não-Funcionais

| # | Critério | Target |
|---|----------|--------|
| 1 | Simulação financeira < 2s | < 2000ms |
| 2 | Dashboard carrega < 3s | < 3000ms |
| 3 | Timeline com 1000 eventos < 2s | < 2000ms |
| 4 | Isolamento de dados por tenant | 100% rigoroso |
| 5 | Audit trail completo | 100% das operações |

---

## 11. RISCOS E MITIGAÇÕES

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Credor não aceita proposta | Alta | Alto | Ter 2-3 cenários prontos; escalar para advogado |
| Empresa quebra acordo | Média | Alto | Monitoramento rigoroso; alerta antecipado; renegociação rápida |
| Cálculo de CET incorreto | Baixa | Alto | Validar com planilha Excel independente; teste unitário |
| Parcela liberada sem caixa | Média | Alto | Buffer de 15%; aprovação manual obrigatória |
| Dados de credor duplicado | Média | Médio | Merge inteligente; validação por CNPJ |
| Vazamento de dados sensíveis | Baixa | Alto | Isolamento por tenant; criptografia; LGPD |

---

## 12. DEPENDÊNCIAS

| Dependência | Status | Impacto |
|-------------|--------|---------|
| Cadastro de Pessoas (CRM 2.0) | 🔄 Em andamento | Vinculação de credores |
| Arcádia Control (AP/AR) | ✅ Produção | Liberação de parcelas |
| Construtor de Agentes do Arcádia Consult | ✅ Produção | Agente Recovery |
| PostgreSQL | ✅ Produção | Banco de dados |
| Drizzle ORM | ✅ Produção | ORM |
| React + shadcn/ui | ✅ Produção | Frontend |
| Coolify (deploy) | ⚠️ Pendente | Deploy em produção |

---

## 13. ANEXOS

### Anexo A — Caso Santander (Documento Real)
- **Arquivo:** `Renegociação com Santander - Conta 13003694.pdf`
- **Conteúdo:** Proposta de renegociação com CET, parcelas, taxas
- **Uso:** Validação do simulador financeiro

### Anexo B — Planilha de Fornecedores em Atraso
- **Arquivo:** Fornecedores com dívidas vencidas
- **Conteúdo:** Lista de 18 fornecedores, valores, dias de atraso
- **Uso:** Importação inicial no Recovery

### Anexo C — Tipos de Dívida
- **Conteúdo:** Bancária, tributária, trabalhista, previdenciária, locação
- **Uso:** Classificação automática de credores

---

## 14. HISTÓRICO DE REVISÕES

| Versão | Data | Autor | Alterações |
|--------|------|-------|------------|
| 1.0.0 | 28/04/2026 | Arquiteto Arcádia | Versão inicial com caso Santander |
| 1.1.0 | 28/04/2026 | Arquiteto Arcádia | Adicionado módulo de Atas de Autorização com Agente no Construtor |
| 1.2.0 | 29/04/2026 | Arquiteto Arcádia | Correção: Construtor de Agentes do Arcádia Consult (não OpenClaw) |

---

**Próximo passo sugerido:** Aprovar planejamento → criar migration das tabelas → implementar Sprint 1 (Fundação).

Quer que eu parta para implementação do schema (tabelas Recovery) agora?
