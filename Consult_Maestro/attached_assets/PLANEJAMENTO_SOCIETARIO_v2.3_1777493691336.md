# 📘 DOCUMENTO DE PLANEJAMENTO — PIPELINE SOCIETÁRIO KANBAN + AGENTE ASSISTENTE
## **Arcádia Consult | Substituição de Assistentes por Automação Inteligente**

**Projeto:** Arcádia Suite | Módulo Societário — Pipeline Visual + Agente Assistente  
**Versão:** 2.3.0  
**Data:** 29/04/2026  
**Status:** Planejamento de Implementação  
**Contexto:** Criar pipeline visual estilo Trello/Kanban para processos societários, onde o Agente Societário assume funções de assistente (follow-up, coleta de docs, lembretes), liberando analistas para análise e decisão estratégica.

---

## 📑 SUMÁRIO EXECUTIVO

O módulo societário precisa evoluir de **cadastro + agente gerador de minutas** para uma **plataforma de gestão de processos com pipeline visual**, onde:

1. **Pipeline Kanban** — processos societários visualizados em colunas (estilo Trello)
2. **Checklist por etapa** — cada coluna tem tarefas obrigatórias para avançar
3. **Agente Assistente** — automatiza tarefas de assistente (follow-up, coleta de docs, lembretes ao cliente)
4. **Analista focado** — humano só entra para análise, aprovação e decisão estratégica
5. **Comunicação automática** — em etapas como "aguardando documentos", sistema envia mensagem ao cliente solicitando envio

> **Filosofia:** O assistente virtual (Agente) faz o operacional. O analista humano faz o estratégico.

---

## 1. CONCEITO: PIPELINE SOCIETÁRIO KANBAN

### 1.1 Colunas Padrão do Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE SOCIETÁRIO — VISÃO KANBAN                       │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 📝 BACKLOG   │  │ 📋 EM        │  │ 🔍 EM        │  │ ⏳ AGUARDANDO│   │
│  │              │  │ ANÁLISE      │  │ CONSULTA     │  │ DOCUMENTOS   │   │
│  │              │  │              │  │ COMERCIAL    │  │              │   │
│  │ • Nova     │  │ • Validar   │  │ • Verificar │  │ • Solicitar │   │
│  │   solicitação│  │   dados      │  │   viabilidade│  │   docs ao    │   │
│  │ • Lead     │  │ • Checar    │  │   jurídica   │  │   cliente    │   │
│  │   qualificado│  │   pendências │  │ • Analisar  │  │ • Aguardar  │   │
│  │              │  │              │  │   riscos     │  │   retorno    │   │
│  │              │  │              │  │              │  │              │   │
│  │ [+ Novo    │  │              │  │              │  │              │   │
│  │   Processo]│  │              │  │              │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 🖊️ EM        │  │ 📤 AGUARDANDO│  │ ✅ CONCLUÍDO │  │ ❌ CANCELADO │   │
│  │ ELABORAÇÃO   │  │ ASSINATURAS  │  │              │  │              │   │
│  │              │  │              │  │              │  │              │   │
│  │ • Gerar    │  │ • Enviar    │  │ • Registrar │  │ • Arquivar  │   │
│  │   minuta     │  │   para      │  │   na JUCEMG │  │   motivo    │   │
│  │ • Revisar  │  │   assinatura │  │ • Atualizar │  │              │   │
│  │   jurídica   │  │ • Acompanhar│  │   quadro     │  │              │   │
│  │ • Aprovar  │  │   retorno   │  │   societário │  │              │   │
│  │   cliente    │  │              │  │              │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Colunas Configuráveis por Tipo de Processo

| Tipo de Processo | Colunas Específicas |
|-----------------|---------------------|
| **Constituição** | Backlog → Em Análise → Aguardando Docs → Em Elaboração → Aguardando Assinaturas → Registro → Concluído |
| **Alteração Contratual** | Backlog → Em Análise → Consulta Jurídica → Aguardando Docs → Em Elaboração → Aguardando Assinaturas → Registro → Concluído |
| **Mudança de Status** | Backlog → Em Análise → Consulta Fiscal → Aguardando Docs → Em Elaboração → Aguardando Assinaturas → Registro → Concluído |
| **Recuperação Judicial** | Backlog → Em Análise → Consulta Jurídica → Aguardando Docs → Em Elaboração → Assembleia → Registro → Concluído |
| **Dissolução** | Backlog → Em Análise → Consulta Trabalhista → Aguardando Docs → Em Elaboração → Aguardando Assinaturas → Registro → Concluído |

---

## 2. CHECKLIST POR ETAPA (Tarefas Obrigatórias)

### 2.1 Estrutura do Checklist

Cada card (processo) em uma coluna tem um **checklist de tarefas** que devem ser concluídas para avançar para a próxima coluna.

```typescript
export const pipelineChecklistItems = pgTable('pipeline_checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Configuração do pipeline
  pipelineConfigId: uuid('pipeline_config_id').notNull(),
  // FK para pipeline_configs (define colunas e regras)

  // Etapa (coluna)
  etapa: varchar('etapa', { length: 50 }).notNull(),
  // 'backlog', 'em_analise', 'consulta_comercial', 'aguardando_documentos',
  // 'em_elaboracao', 'aguardando_assinaturas', 'registro', 'concluido', 'cancelado'

  // Tarefa
  ordem: integer('ordem').notNull(),
  titulo: varchar('titulo', { length: 255 }).notNull(),
  descricao: text('descricao'),

  // Quem executa
  executorType: varchar('executor_type', { length: 20 }).notNull(),
  // 'agente' = Agente Societário automatiza
  // 'analista' = Analista humano deve executar
  // 'cliente' = Cliente deve fornecer/enviar
  // 'sistema' = Sistema executa automaticamente

  // Ação automática (se executor = 'agente' ou 'sistema')
  acaoAutomatica: jsonb('acao_automatica'),
  /*
  {
    type: "enviar_mensagem",
    channel: "whatsapp",
    template: "solicitacao_documentos",
    when: "enter_column" // ao entrar na coluna
  }
  ou
  {
    type: "gerar_documento",
    template: "minuta_alteracao",
    when: "all_previous_completed" // quando tarefas anteriores concluídas
  }
  ou
  {
    type: "verificar_dados",
    source: "receita_federal",
    when: "enter_column"
  }
  */

  // Bloqueio
  isRequired: boolean('is_required').default(true),
  // true = obrigatório para avançar de coluna
  // false = opcional

  // Condição para aparecer
  condition: jsonb('condition'),
  // { "field": "tipoProcesso", "operator": "equals", "value": "alteracao_contratual" }

  createdAt: timestamp('created_at').defaultNow(),
});
```

### 2.2 Exemplo de Checklist por Coluna (Alteração Contratual)

#### Coluna: 📋 EM ANÁLISE

| # | Tarefa | Executor | Auto | Bloqueia Avanço? |
|---|--------|----------|------|-----------------|
| 1 | Verificar dados da sociedade no sistema | Agente | ✅ Consulta automática | Sim |
| 2 | Validar CNPJ na Receita Federal | Agente | ✅ API RF | Sim |
| 3 | Verificar certificados digitais vigentes | Agente | ✅ Query interna | Sim |
| 4 | Identificar sócios/administradores | Agente | ✅ Query interna | Sim |
| 5 | Checar obrigações societárias pendentes | Agente | ✅ Query interna | Sim |
| 6 | Analisar proposta de alteração | **Analista** | ❌ | Sim |
| 7 | Verificar impacto fiscal/trabalhista | **Analista** | ❌ | Não |

#### Coluna: 🔍 EM CONSULTA COMERCIAL

| # | Tarefa | Executor | Auto | Bloqueia Avanço? |
|---|--------|----------|------|-----------------|
| 1 | Consultar viabilidade de nome empresarial | Agente | ✅ API JUCEMG | Sim |
| 2 | Verificar CNAE compatível com novo objeto | Agente | ✅ Query interna | Sim |
| 3 | Consultar alvará de funcionamento (se mudança sede) | Agente | ✅ API | Sim |
| 4 | Análise de risco jurídico da alteração | **Analista** | ❌ | Sim |
| 5 | Parecer sobre viabilidade | **Analista** | ❌ | Sim |

#### Coluna: ⏳ AGUARDANDO DOCUMENTOS

| # | Tarefa | Executor | Auto | Bloqueia Avanço? |
|---|--------|----------|------|-----------------|
| 1 | Enviar lista de documentos necessários ao cliente | Agente | ✅ WhatsApp/Email | Sim |
| 2 | Aguardar envio de documentos pelo cliente | Cliente | ❌ | Sim |
| 3 | Validar documentos recebidos | Agente | ✅ OCR/validação | Sim |
| 4 | Notificar cliente sobre documentos pendentes | Agente | ✅ WhatsApp/Email | Não |
| 5 | Revisar documentos pelo analista | **Analista** | ❌ | Sim |

#### Coluna: 🖊️ EM ELABORAÇÃO

| # | Tarefa | Executor | Auto | Bloqueia Avanço? |
|---|--------|----------|------|-----------------|
| 1 | Gerar minuta de alteração contratual | Agente | ✅ Template + LLM | Sim |
| 2 | Gerar ata de assembleia (se necessário) | Agente | ✅ Template + LLM | Sim |
| 3 | Revisão jurídica da minuta | **Analista** | ❌ | Sim |
| 4 | Aprovação pelo cliente | Cliente | ❌ | Sim |
| 5 | Ajustes finais na minuta | Agente | ✅ LLM | Sim |

#### Coluna: 📤 AGUARDANDO ASSINATURAS

| # | Tarefa | Executor | Auto | Bloqueia Avanço? |
|---|--------|----------|------|-----------------|
| 1 | Enviar documentos para assinatura digital | Agente | ✅ Caixa de Envio | Sim |
| 2 | Acompanhar status de assinaturas | Agente | ✅ Tracking automático | Sim |
| 3 | Enviar lembretes a assinantes pendentes | Agente | ✅ Cron 7 dias | Não |
| 4 | Notificar analista quando todas assinadas | Sistema | ✅ Auto | Sim |

---

## 3. AGENTE ASSISTENTE (Automação de Tarefas de Assistente)

### 3.1 O que o Agente Assistente faz (substituindo assistente humano)

| Tarefa de Assistente | Como o Agente faz | Frequência |
|---------------------|-------------------|------------|
| **Verificar dados da empresa** | Consulta automática no sistema + API Receita Federal | Ao criar processo |
| **Solicitar documentos ao cliente** | Envia mensagem no WhatsApp/Email com lista personalizada | Ao entrar em "Aguardando Documentos" |
| **Lembrar cliente de documentos pendentes** | Reenvia mensagem a cada 3 dias | Cron diário |
| **Validar documentos recebidos** | OCR + verificação de campos obrigatórios | Ao cliente enviar |
| **Preencher formulários** | Auto-preenche com dados do sistema | Ao gerar documento |
| **Acompanhar assinaturas** | Tracking automático + lembretes | Contínuo |
| **Atualizar status no pipeline** | Move card automaticamente quando tarefa concluída | Event-driven |
| **Notificar analista** | Alerta quando ação humana é necessária | Quando checklist bloqueia |
| **Gerar minutas** | Template + LLM com contexto do processo | Ao concluir "Em Elaboração" |
| **Arquivar documentos** | Salva no repositório com metadados | Ao concluir processo |

### 3.2 Configuração do Agente Assistente

```yaml
agent:
  name: "agente_assistente_societario"
  description: "Assistente virtual que automatiza tarefas operacionais do processo societário"
  icon: "🤖"
  category: "automation"

  llm_config:
    default_model: "claude-sonnet-4.6"
    fallback_model: "gemini-2.0-pro"
    temperature: 0.2
    max_tokens: 4000

  skills:
    - name: "verificar_dados_empresa"
      description: "Consulta dados da empresa no sistema e APIs externas"
      type: "query"
      auto_execute: true
      triggers: ["processo_criado", "enter_column_em_analise"]

    - name: "solicitar_documentos_cliente"
      description: "Envia mensagem ao cliente solicitando documentos necessários"
      type: "action"
      channels: ["whatsapp", "email"]
      auto_execute: true
      triggers: ["enter_column_aguardando_documentos"]
      template: "solicitacao_documentos_{{tipo_processo}}"

    - name: "lembrar_documentos_pendentes"
      description: "Reenvia lembrete ao cliente sobre documentos pendentes"
      type: "action"
      channels: ["whatsapp", "email"]
      auto_execute: true
      triggers: ["cron_diario"]
      condition: "documentos_pendentes > 0 AND dias_na_coluna > 3"

    - name: "validar_documentos_recebidos"
      description: "Valida documentos enviados pelo cliente via OCR"
      type: "validation"
      auto_execute: true
      triggers: ["documento_recebido"]

    - name: "acompanhar_assinaturas"
      description: "Acompanha status de assinaturas e envia lembretes"
      type: "action"
      auto_execute: true
      triggers: ["cron_diario"]
      condition: "status_assinaturas = 'pendente' AND dias_envio > 7"

    - name: "gerar_minuta"
      description: "Gera minuta de documento societário"
      type: "generation"
      auto_execute: true
      triggers: ["all_checklist_completed_em_elaboracao"]
      template_engine: "jinja2"

    - name: "notificar_analista"
      description: "Notifica analista quando ação humana é necessária"
      type: "notification"
      auto_execute: true
      triggers: ["checklist_blocked", "analise_necessaria"]
      channels: ["in_app", "email"]

    - name: "atualizar_pipeline"
      description: "Move card no pipeline quando tarefas concluídas"
      type: "action"
      auto_execute: true
      triggers: ["all_required_tasks_completed"]

  guardrails:
    - "SEMPRE usar tom cordial e profissional ao comunicar com cliente"
    - "NUNCA enviar dados de outro cliente para o cliente errado"
    - "SEMPRE confirmar recebimento de documentos com o cliente"
    - "NUNCA avançar coluna sem todas as tarefas obrigatórias concluídas"
    - "SEMPRE notificar analista quando não conseguir automatizar"
    - "NUNCA gerar minuta sem validação jurídica prévia"
    - "SEMPRE registrar log de todas as ações automatizadas"
```

### 3.3 Exemplo de Interação: Processo de Alteração Contratual

```
[CLIENTE SOLICITA ALTERAÇÃO DE ENDEREÇO VIA WHATSAPP]

Agente Assistente: "Olá! Recebemos sua solicitação de alteração de endereço 
para a empresa Cliente X LTDA. Vou iniciar o processo para você."

[AGENTE CRIA PROCESSO NO PIPELINE]
├─ Processo: ALT-2026-001 | Alteração de Endereço
├─ Coluna: 📋 EM ANÁLISE
├─ Checklist iniciado automaticamente

[AGENTE EXECUTA TAREFAS AUTOMÁTICAS — Coluna EM ANÁLISE]
✅ Verificar dados da sociedade no sistema
✅ Validar CNPJ na Receita Federal
✅ Verificar certificados digitais vigentes
✅ Identificar sócios/administradores
✅ Checar obrigações societárias pendentes

[AGENTE NOTIFICA ANALISTA]
📧 "Analista João: Processo ALT-2026-001 aguarda sua análise. 
Dados verificados automaticamente. Proposta: alteração de endereço 
de Rua A para Rua B."

[ANALISTA APROVA — MOVE PARA CONSULTA COMERCIAL]

[AGENTE EXECUTA — Coluna CONSULTA COMERCIAL]
✅ Consultar viabilidade de endereço na JUCEMG
✅ Verificar CNAE compatível
✅ Consultar alvará de funcionamento no novo município

[AGENTE NOTIFICA ANALISTA]
📧 "Analista João: Consultas comerciais concluídas. 
Endereço aprovado pela JUCEMG. Aguardando parecer jurídico."

[ANALISTA EMITE PARECER — MOVE PARA AGUARDANDO DOCUMENTOS]

[AGENTE EXECUTA — Coluna AGUARDANDO DOCUMENTOS]
✅ Enviar lista de documentos ao cliente
   📱 WhatsApp para Carlos (sócio-administrador):
   "Olá Carlos! Para prosseguir com a alteração de endereço da 
   Cliente X LTDA, precisamos dos seguintes documentos:
   1. Contrato social atualizado (última alteração)
   2. Certidão negativa de débitos (novo município)
   3. Comprovante de endereço da nova sede
   4. Certificado digital vigente de todos os sócios

   Você pode enviar respondendo esta mensagem ou pelo portal."

[3 DIAS DEPOIS — DOCUMENTOS NÃO ENVIADOS]

[AGENTE EXECUTA LEMBRETE AUTOMÁTICO]
📱 WhatsApp para Carlos:
"Olá Carlos! Lembrando que aguardamos os documentos para a alteração 
de endereço da Cliente X LTDA. Documentos pendentes:
1. Certidão negativa de débitos ❌
2. Comprovante de endereço ❌

Já recebemos: Contrato social ✅, Certificados ✅"

[CLIENTE ENVIA DOCUMENTOS]

[AGENTE VALIDA DOCUMENTOS AUTOMATICAMENTE]
✅ Contrato social: validado (OCR + hash)
✅ Certidão negativa: validada (verificação online)
✅ Comprovante de endereço: validado (campos obrigatórios)
✅ Certificados: validados (datas de validade)

[AGENTE NOTIFICA ANALISTA]
📧 "Analista João: Todos os documentos recebidos e validados 
automaticamente. Aguardando revisão final para elaboração da minuta."

[ANALISTA REVISA — MOVE PARA EM ELABORAÇÃO]

[AGENTE GERA MINUTA AUTOMATICAMENTE]
✅ Gerar minuta de alteração contratual (endereço)
✅ Gerar ata de assembleia (se necessário)

[ANALISTA REVISA MINUTA — APROVA — MOVE PARA AGUARDANDO ASSINATURAS]

[AGENTE ENVIA PARA ASSINATURA]
✅ Enviar documentos para assinatura digital
   📧 Email para Carlos (sócio-administrador)
   📧 Email para Maria (sócia)
   📱 WhatsApp para Carlos (confirmação)

[7 DIAS DEPOIS — MARIA NÃO ASSINOU]

[AGENTE ENVIA LEMBRETE]
📱 WhatsApp para Maria:
"Olá Maria! O documento de alteração de endereço da Cliente X LTDA 
está aguardando sua assinatura digital. Acesse: [link]"

[MARIA ASSINA]

[AGENTE ATUALIZA PIPELINE — MOVE PARA REGISTRO]
✅ Todas as assinaturas recebidas
✅ Notificar analista: "Pronto para registro na JUCEMG"

[ANALISTA REGISTRA NA JUCEMG — MOVE PARA CONCLUÍDO]

[AGENTE FINALIZA]
✅ Atualizar quadro societário no sistema
✅ Arquivar documentos no repositório
✅ Notificar cliente: "Alteração de endereço concluída! 
   Novo registro: JUCEMG 123456. Prazo para próxima obrigação: 30 dias."
✅ Criar evento na agenda: "Renovação de alvará — novo município"

[PROCESSO CONCLUÍDO EM 15 DIAS — ANALISTA INTERVEIO APENAS 4 VEZES]
```

---

## 4. MODELAGEM DE DADOS

### 4.1 Pipeline Config (Colunas do Kanban)

```typescript
export const pipelineConfigs = pgTable('pipeline_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Configuração
  nome: varchar('nome', { length: 100 }).notNull(),
  descricao: text('descricao'),

  // Tipo de processo que usa este pipeline
  tipoProcesso: varchar('tipo_processo', { length: 50 }).notNull(),
  // 'constituicao', 'alteracao_contratual', 'mudanca_status',
  // 'recuperacao_judicial', 'dissolucao', 'transformacao'

  // Colunas (ordem define a sequência)
  colunas: jsonb('colunas').notNull(),
  /*
  [
    { id: "backlog", nome: "📝 Backlog", ordem: 1, cor: "#gray" },
    { id: "em_analise", nome: "📋 Em Análise", ordem: 2, cor: "#blue" },
    { id: "consulta_comercial", nome: "🔍 Consulta Comercial", ordem: 3, cor: "#yellow" },
    { id: "aguardando_documentos", nome: "⏳ Aguardando Documentos", ordem: 4, cor: "#orange" },
    { id: "em_elaboracao", nome: "🖊️ Em Elaboração", ordem: 5, cor: "#purple" },
    { id: "aguardando_assinaturas", nome: "📤 Aguardando Assinaturas", ordem: 6, cor: "#pink" },
    { id: "registro", nome: "🏛️ Registro", ordem: 7, cor: "#indigo" },
    { id: "concluido", nome: "✅ Concluído", ordem: 8, cor: "#green" },
    { id: "cancelado", nome: "❌ Cancelado", ordem: 99, cor: "#red" }
  ]
  */

  // Regras de transição
  regrasTransicao: jsonb('regras_transicao'),
  /*
  {
    "em_analise → consulta_comercial": {
      condition: "all_required_tasks_completed",
      auto_advance: false // analista deve mover manualmente
    },
    "aguardando_documentos → em_elaboracao": {
      condition: "all_required_tasks_completed AND documentos_validados",
      auto_advance: true // agente move automaticamente
    }
  }
  */

  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),

  createdAt: timestamp('created_at').defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
});
```

### 4.2 Processos Societários (Cards no Kanban)

```typescript
export const processosSocietarios = pgTable('processos_societarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Identificação
  processNumber: varchar('process_number', { length: 50 }).notNull(),
  // Formato: SOC-{ano}-{sequencial} (ex: SOC-2026-0042)

  // Vinculações
  sociedadeId: uuid('sociedade_id').notNull().references(() => sociedades.id),
  pipelineConfigId: uuid('pipeline_config_id').notNull().references(() => pipelineConfigs.id),

  // Tipo e descrição
  tipoProcesso: varchar('tipo_processo', { length: 50 }).notNull(),
  subtipo: varchar('subtipo', { length: 50 }),
  titulo: varchar('titulo', { length: 255 }).notNull(),
  descricao: text('descricao'),

  // Pipeline (Kanban)
  colunaAtual: varchar('coluna_atual', { length: 50 }).notNull().default('backlog'),
  // 'backlog', 'em_analise', 'consulta_comercial', 'aguardando_documentos',
  // 'em_elaboracao', 'aguardando_assinaturas', 'registro', 'concluido', 'cancelado'

  // Checklist do processo (snapshot das tarefas)
  checklist: jsonb('checklist').notNull().default([]),
  /*
  [
    {
      id: "task-001",
      etapa: "em_analise",
      titulo: "Verificar dados da sociedade",
      executor: "agente",
      status: "concluido",
      concluidoAt: "2026-04-29T10:00:00Z",
      concluidoBy: "agente_assistente",
      autoExecuted: true
    },
    {
      id: "task-002",
      etapa: "em_analise",
      titulo: "Analisar proposta de alteração",
      executor: "analista",
      status: "pendente",
      concluidoAt: null,
      concluidoBy: null,
      autoExecuted: false,
      assignedTo: "uuid-analista-joao"
    }
  ]
  */

  // Responsáveis
  analistaResponsavelId: uuid('analista_responsavel_id').references(() => users.id),
  solicitanteId: uuid('solicitante_id').references(() => users.id),

  // Cliente (quem solicitou)
  clientePessoaId: uuid('cliente_pessoa_id').references(() => pessoas.id),
  clienteContatoPreferido: varchar('cliente_contato_preferido', { length: 20 }).default('whatsapp'),
  // 'whatsapp', 'email', 'ambos'

  // Datas
  dataSolicitacao: timestamp('data_solicitacao').defaultNow(),
  dataPrevistaConclusao: date('data_prevista_conclusao'),
  dataConclusao: timestamp('data_conclusao'),

  // Métricas
  diasEmColuna: integer('dias_em_coluna').default(0),
  totalDiasProcesso: integer('total_dias_processo').default(0),

  // Documentos gerados
  documentosIds: jsonb('documentos_ids'), // [uuid, uuid]

  // Assinaturas
  assinaturasPendentes: integer('assinaturas_pendentes').default(0),
  assinaturasRecebidas: integer('assinaturas_recebidas').default(0),

  // Status
  status: varchar('status', { length: 20 }).default('ativo'),
  // 'ativo', 'concluido', 'cancelado', 'suspenso'

  // Prioridade
  prioridade: varchar('prioridade', { length: 20 }).default('media'),
  // 'baixa', 'media', 'alta', 'critica'

  // Notas internas
  notasInternas: text('notas_internas'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
}, (table) => ({
  tenantColunaIdx: index('proc_tenant_coluna_idx').on(table.tenantId, table.colunaAtual),
  statusIdx: index('proc_status_idx').on(table.status),
  analistaIdx: index('proc_analista_idx').on(table.analistaResponsavelId),
}));
```

### 4.3 Tarefas do Checklist (Histórico Detalhado)

```typescript
export const processoTarefas = pgTable('processo_tarefas', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  processoId: uuid('processo_id').notNull().references(() => processosSocietarios.id),

  // Configuração da tarefa
  checklistItemId: uuid('checklist_item_id').references(() => pipelineChecklistItems.id),

  // Dados
  etapa: varchar('etapa', { length: 50 }).notNull(),
  ordem: integer('ordem').notNull(),
  titulo: varchar('titulo', { length: 255 }).notNull(),
  descricao: text('descricao'),

  // Executor
  executorType: varchar('executor_type', { length: 20 }).notNull(),
  // 'agente', 'analista', 'cliente', 'sistema'

  executorId: uuid('executor_id').references(() => users.id),
  // null para agente/sistema

  // Status
  status: varchar('status', { length: 20 }).default('pendente'),
  // 'pendente', 'em_andamento', 'concluido', 'bloqueado', 'cancelado'

  // Execução automática
  autoExecuted: boolean('auto_executed').default(false),
  autoExecutionResult: jsonb('auto_execution_result'),
  /*
  {
    agentId: "agente_assistente_societario",
    executedAt: "2026-04-29T10:00:00Z",
    result: "success",
    details: { apiResponse: "...", validationResult: "..." }
  }
  */

  // Execução manual
  concluidoAt: timestamp('concluido_at'),
  concluidoBy: uuid('concluido_by').references(() => users.id),
  concluidoNotes: text('concluido_notes'),

  // Bloqueio
  isRequired: boolean('is_required').default(true),
  bloqueiaAvanco: boolean('bloqueia_avanco').default(true),

  // Anexos
  anexos: jsonb('anexos'),
  // [{nome, url, tipo, tamanho}]

  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 5. COMUNICAÇÃO AUTOMÁTICA COM CLIENTE

### 5.1 Templates de Mensagem por Etapa

#### Template: Solicitação de Documentos (WhatsApp)

```
Olá {{clienteNome}}! 👋

Recebemos sua solicitação de {{tipoProcesso}} para a empresa 
{{empresaRazaoSocial}} (CNPJ: {{empresaCnpj}}).

Para prosseguir, precisamos que você envie os seguintes documentos:

{{#documentos}}
{{numero}}. {{nome}} {{#obrigatorio}}*{{/obrigatorio}}
   {{descricao}}
{{/documentos}}

*Documentos obrigatórios

✅ Já recebemos:
{{#recebidos}}
• {{nome}} ✅
{{/recebidos}}

⏳ Aguardando:
{{#pendentes}}
• {{nome}} ❌
{{/pendentes}}

Você pode enviar respondendo esta mensagem com fotos/PDFs 
ou pelo portal: {{portalUrl}}

Prazo estimado para conclusão: {{prazoConclusao}} dias

Dúvidas? Responda aqui ou fale com seu analista {{analistaNome}}.

— Assistente Virtual Arcádia 🤖
```

#### Template: Lembrete de Documentos (WhatsApp)

```
Olá {{clienteNome}}! 

Lembrando que aguardamos os seguintes documentos para 
{{tipoProcesso}} da {{empresaRazaoSocial}}:

{{#pendentes}}
• {{nome}} ❌ ({{diasPendentes}} dias pendentes)
{{/pendentes}}

{{#urgente}}
⚠️ Atenção: documentos pendentes há mais de 7 dias podem 
atrasar o processo.
{{/urgente}}

Envie respondendo esta mensagem ou pelo portal: {{portalUrl}}

— Assistente Virtual Arcádia 🤖
```

#### Template: Documento para Assinatura (Email)

```
Assunto: [Arcádia Consult] Documento para assinatura digital — {{empresaRazaoSocial}}

Olá {{clienteNome}},

O documento de {{tipoProcesso}} para {{empresaRazaoSocial}} 
está pronto para assinatura digital.

📄 Documento: {{documentoNome}}
📅 Prazo para assinatura: {{prazoAssinatura}}

[ASSINAR DOCUMENTO] ← Botão para portal de assinatura

Este documento foi preparado pelo analista {{analistaNome}} 
e revisado juridicamente.

Dúvidas? Responda este email ou entre em contato.

— Arcádia Consult
Assistente Virtual Societário
```

#### Template: Processo Concluído (WhatsApp)

```
Olá {{clienteNome}}! 🎉

{{tipoProcesso}} da {{empresaRazaoSocial}} foi concluído com sucesso!

✅ Registro: {{numeroRegistro}}
✅ Data do registro: {{dataRegistro}}
✅ Novo status: {{novoStatus}}

📎 Documentos finais:
{{#documentos}}
• {{nome}} — {{url}}
{{/documentos}}

Próximas obrigações:
{{#obrigacoes}}
• {{nome}} — vence em {{dataVencimento}}
{{/obrigacoes}}

Agradecemos a confiança!

— Assistente Virtual Arcádia 🤖
```

### 5.2 Serviço de Comunicação

```typescript
export class ComunicacaoClienteService {

  async enviarSolicitacaoDocumentos(processoId: string): Promise<void> {
    const processo = await this.getProcesso(processoId);
    const cliente = await this.pessoasService.findById(processo.clientePessoaId);
    const sociedade = await this.sociedadesService.findById(processo.sociedadeId);

    // Buscar documentos pendentes
    const tarefas = await this.db.query.processoTarefas.findMany({
      where: and(
        eq(processoTarefas.processoId, processoId),
        eq(processoTarefas.etapa, 'aguardando_documentos'),
        eq(processoTarefas.executorType, 'cliente'),
        eq(processoTarefas.status, 'pendente')
      )
    });

    const documentos = tarefas.map(t => ({
      numero: t.ordem,
      nome: t.titulo,
      descricao: t.descricao,
      obrigatorio: t.isRequired
    }));

    const mensagem = this.templateService.render('solicitacao_documentos', {
      clienteNome: cliente.nome,
      tipoProcesso: processo.tipoProcesso,
      empresaRazaoSocial: sociedade.razaoSocial,
      empresaCnpj: sociedade.cnpj,
      documentos,
      recebidos: [], // ainda nenhum
      pendentes: documentos,
      portalUrl: `https://arcadia.consult/portal/${processo.tenantId}/processos/${processoId}`,
      prazoConclusao: 15,
      analistaNome: processo.analistaResponsavel?.nome || 'Arcádia'
    });

    // Enviar por WhatsApp
    if (processo.clienteContatoPreferido === 'whatsapp' || processo.clienteContatoPreferido === 'ambos') {
      await this.whatsappService.send({
        to: cliente.whatsapp,
        message: mensagem,
        template: 'solicitacao_documentos'
      });
    }

    // Enviar por Email
    if (processo.clienteContatoPreferido === 'email' || processo.clienteContatoPreferido === 'ambos') {
      await this.emailService.send({
        to: cliente.email,
        subject: `[Arcádia] Documentos necessários — ${sociedade.razaoSocial}`,
        body: mensagem,
        template: 'solicitacao_documentos'
      });
    }

    // Registrar comunicação
    await this.db.insert(caixaEnvio).values({
      tenantId: processo.tenantId,
      origemType: 'societario',
      origemId: processoId,
      destinatarioPessoaId: cliente.id,
      destinatarioNome: cliente.nome,
      destinatarioEmail: cliente.email,
      destinatarioWhatsapp: cliente.whatsapp,
      documentoType: 'solicitacao_documentos',
      canalEnvio: processo.clienteContatoPreferido,
      statusEnvio: 'enviado',
      dataEnvio: new Date()
    });
  }

  async enviarLembreteDocumentos(processoId: string): Promise<void> {
    const processo = await this.getProcesso(processoId);
    const cliente = await this.pessoasService.findById(processo.clientePessoaId);
    const sociedade = await this.sociedadesService.findById(processo.sociedadeId);

    // Buscar documentos pendentes
    const pendentes = await this.getDocumentosPendentes(processoId);

    const mensagem = this.templateService.render('lembrete_documentos', {
      clienteNome: cliente.nome,
      tipoProcesso: processo.tipoProcesso,
      empresaRazaoSocial: sociedade.razaoSocial,
      pendentes: pendentes.map(p => ({
        nome: p.titulo,
        diasPendentes: differenceInDays(new Date(), p.createdAt)
      })),
      urgente: pendentes.some(p => differenceInDays(new Date(), p.createdAt) > 7),
      portalUrl: `https://arcadia.consult/portal/${processo.tenantId}/processos/${processoId}`
    });

    await this.whatsappService.send({
      to: cliente.whatsapp,
      message: mensagem
    });

    // Incrementar contador de lembretes
    await this.db.update(processosSocietarios)
      .set({ lembretesEnviados: sql`${processosSocietarios.lembretesEnviados} + 1` })
      .where(eq(processosSocietarios.id, processoId));
  }
}
```

---

## 6. INTERFACE DO ANALISTA (Foco no Estratégico)

### 6.1 Dashboard do Analista

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PIPELINE SOCIETÁRIO — Analista: João Silva                    [+ Novo Proc] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MEUS PROCESSOS (5)                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ 📝 BACKLOG   │ │ 📋 EM        │ │ 🔍 EM        │ │ ⏳ AGUARDANDO│       │
│  │     1        │ │ ANÁLISE      │ │ CONSULTA     │ │ DOCUMENTOS   │       │
│  │              │ │     2        │ │ COMERCIAL    │ │     1        │       │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤       │
│  │ SOC-2026-0042│ │ SOC-2026-0040│ │ SOC-2026-0038│ │ SOC-2026-0035│       │
│  │ Alteração    │ │ Constituição │ │ Mudança      │ │ Alteração    │       │
│  │ endereço     │ │ Empresa Y    │ │ status       │ │ objeto       │       │
│  │              │ │              │ │              │ │              │       │
│  │ ⏱️ 2 dias    │ │ ⏱️ 5 dias    │ │ ⏱️ 8 dias    │ │ ⏱️ 12 dias   │       │
│  │              │ │              │ │              │ │ 🔴 URGENTE   │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│  │ 🖊️ EM        │ │ 📤 AGUARDANDO│ │ ✅ CONCLUÍDO │                        │
│  │ ELABORAÇÃO   │ │ ASSINATURAS  │ │     8        │                        │
│  │     0        │ │     1        │ │              │                        │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤                        │
│  │              │ │ SOC-2026-0030│ │ SOC-2026-0025│                        │
│  │              │ │ Alteração    │ │ Constituição │                        │
│  │              │ │ capital      │ │ Empresa Z    │                        │
│  │              │ │              │ │              │                        │
│  │              │ │ ⏱️ 3 dias    │ │ ✅ Ontem     │                        │
│  │              │ │ 🟡 1/3 assin.│ │              │                        │
│  └──────────────┘ └──────────────┘ └──────────────┘                        │
│                                                                              │
│  ALERTAS DO AGENTE ASSISTENTE                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 🤖 SOC-2026-0035 (Aguardando Documentos): Cliente não responde há 12   ││
│  │    dias. Recomendo contato telefônico direto.                           ││
│  │                                                                         ││
│  │ 🤖 SOC-2026-0038 (Consulta Comercial): Consulta JUCEMG aprovada.        ││
│  │    Aguardando seu parecer para avançar.                               ││
│  │                                                                         ││
│  │ 🤖 SOC-2026-0040 (Em Análise): Todos os dados verificados             ││
│  │    automaticamente. Aguardando sua análise da proposta.               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  AÇÕES RÁPIDAS                                                               │
│  [Ver processos atrasados] [Ver concluídos hoje] [Relatório semanal]       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Detalhe do Processo (Visão do Analista)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SOC-2026-0040 │ Constituição Empresa Y LTDA                    [Arquivar] │
│  Coluna: 📋 EM ANÁLISE              │ Prioridade: 🔴 Alta    │ Analista: João│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [📊 Resumo] [📋 Checklist] [💬 Comunicação] [📎 Documentos] [📝 Notas]     │
│                                                                              │
│  TAB: 📋 CHECKLIST                                                           │
│                                                                              │
│  📋 EM ANÁLISE (2/5 concluídas)                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ ✅ Verificar dados da sociedade no sistema                              ││
│  │    Executor: Agente 🤖 │ Concluído em 29/04 10:00 │ Auto                ││
│  │                                                                         ││
│  │ ✅ Validar CNPJ na Receita Federal                                      ││
│  │    Executor: Agente 🤖 │ Concluído em 29/04 10:02 │ Auto                ││
│  │                                                                         ││
│  │ ✅ Verificar certificados digitais vigentes                             ││
│  │    Executor: Agente 🤖 │ Concluído em 29/04 10:03 │ Auto                ││
│  │                                                                         ││
│  │ ⏳ Analisar proposta de constituição                                    ││
│  │    Executor: Analista 👤 │ Aguardando você │ [Concluir] [Delegar]    ││
│  │    Nota: Verificar regime tributário ideal para o objeto social         ││
│  │                                                                         ││
│  │ ⏳ Verificar impacto fiscal/trabalhista                                 ││
│  │    Executor: Analista 👤 │ Aguardando você │ [Concluir] [Delegar]    ││
│  │    (Opcional — não bloqueia avanço)                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  [Avançar para Consulta Comercial] ← Só habilita quando todas obrigatórias   │
│                                                                              │
│  HISTÓRICO DE MOVIMENTAÇÃO                                                   │
│  29/04 10:00 — Entrou em "📋 Em Análise" (Agente 🤖)                        │
│  29/04 09:30 — Criado por Cliente via WhatsApp (Agente 🤖)                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. ROADMAP DE IMPLEMENTAÇÃO

### Sprint 1 — Pipeline e Checklist (Semanas 1-2)
- [ ] Criar tabela `pipeline_configs` (colunas configuráveis)
- [ ] Criar tabela `processosSocietarios` (cards no kanban)
- [ ] Criar tabela `pipelineChecklistItems` (tarefas por coluna)
- [ ] Criar tabela `processoTarefas` (histórico de execução)
- [ ] CRUD de configurações de pipeline
- [ ] Interface Kanban (drag-and-drop entre colunas)
- [ ] Checklist visual por processo
- [ ] Regras de transição entre colunas

### Sprint 2 — Agente Assistente (Semanas 3-4)
- [ ] Criar agente `agente_assistente_societario` no Construtor
- [ ] Skill: `verificar_dados_empresa` (auto)
- [ ] Skill: `solicitar_documentos_cliente` (auto)
- [ ] Skill: `lembrar_documentos_pendentes` (cron)
- [ ] Skill: `validar_documentos_recebidos` (auto)
- [ ] Skill: `acompanhar_assinaturas` (cron)
- [ ] Skill: `gerar_minuta` (auto)
- [ ] Skill: `notificar_analista` (auto)
- [ ] Skill: `atualizar_pipeline` (auto)
- [ ] Integrar agente ao fluxo de processos

### Sprint 3 — Comunicação com Cliente (Semanas 5-6)
- [ ] Templates de mensagem (WhatsApp + Email)
- [ ] Serviço de comunicação automática
- [ ] Integração WhatsApp (API/Baileys)
- [ ] Integração Email (SMTP)
- [ ] Portal do cliente (upload de documentos)
- [ ] Tracking de mensagens (entregue, lido, respondido)
- [ ] Lembretes automáticos configuráveis
- [ ] Preferência de contato do cliente (WhatsApp/Email)

### Sprint 4 — Dashboard do Analista e Relatórios (Semanas 7-8)
- [ ] Dashboard do analista (pipeline pessoal)
- [ ] Alertas do agente assistente
- [ ] Métricas de processo (tempo por coluna, gargalos)
- [ ] Relatório de produtividade (analista vs agente)
- [ ] Relatório de SLA (tempo médio de conclusão)
- [ ] Exportação de relatórios (PDF/Excel)
- [ ] Notificações in-app para analistas

### Sprint 5 — Integrações e Hardening (Semanas 9-10)
- [ ] Integrar com Cadastro de Pessoas (sócios como Pessoas)
- [ ] Integrar com Caixa de Envio existente
- [ ] Integrar com Agenda Unificada
- [ ] Integrar com Recovery (processos de recuperação)
- [ ] Hash de integridade em checklist
- [ ] Audit trail completo
- [ ] Testes E2E de fluxo completo
- [ ] Documentação técnica

---

## 8. CRITÉRIOS DE ACEITAÇÃO

| # | Critério | Como Testar |
|---|----------|-------------|
| 1 | Processo criado entra no pipeline | Criar processo → verificar coluna "Backlog" |
| 2 | Agente verifica dados automaticamente | Criar processo → verificar tarefas concluídas em "Em Análise" |
| 3 | Agente solicita documentos ao cliente | Mover para "Aguardando Documentos" → verificar mensagem enviada |
| 4 | Cliente recebe mensagem no WhatsApp | Verificar entrega no tracking |
| 5 | Agente envia lembrete após 3 dias | Esperar 3 dias → verificar reenvio |
| 6 | Analista só vê tarefas que precisa executar | Verificar checklist — tarefas de agente já concluídas |
| 7 | Processo não avança sem tarefas obrigatórias | Tentar mover card → verificar bloqueio |
| 8 | Agente move card automaticamente quando possível | Concluir tarefas → verificar auto-avanço |
| 9 | Dashboard mostra métricas de produtividade | Verificar tempo médio por coluna |
| 10 | Cliente pode acompanhar status pelo portal | Acessar portal → verificar status do processo |

---

## 9. DEPENDÊNCIAS

| Dependência | Status |
|-------------|--------|
| Cadastro de Pessoas | 🔄 Em andamento |
| Agente Societário (existente) | ✅ Produção |
| Recovery | ✅ Completo |
| Control | ✅ Produção |
| WhatsApp API / Baileys | 🟡 Avaliar |
| SMTP | ✅ Produção |
| pdf-lib | ✅ Produção |
| PostgreSQL + Drizzle | ✅ Produção |
| React DnD (drag-and-drop) | 🟡 Avaliar |

---

## 10. HISTÓRICO

| Versão | Data | Alterações |
|--------|------|------------|
| 2.3.0 | 29/04/2026 | Pipeline Kanban + Agente Assistente + Comunicação automática com cliente |

---

**Próximo passo:** Aprovar → iniciar Sprint 1 (Pipeline e Checklist).

Quer que eu parta para implementação do schema (tabelas `pipeline_configs`, `processosSocietarios`, `pipelineChecklistItems`, `processoTarefas`) agora?
