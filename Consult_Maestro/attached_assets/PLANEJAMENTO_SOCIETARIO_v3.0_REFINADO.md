# 📘 PLANEJAMENTO REFINADO — PIPELINE SOCIETÁRIO KANBAN + AGENTE ASSISTENTE
## Arcádia Suite | Módulo Societário · v3.0

**Versão:** 3.0.0 (refinamento da v2.3)
**Data:** 29/04/2026
**Status:** Pronto para aprovação e Sprint 1
**Refinador:** auditoria de codebase + reuso explícito + modelo de dados unificado

---

## 🔒 PRINCÍPIO INEGOCIÁVEL — DUAL MODE (MANUAL + AUTOMÁTICO)

**Toda funcionalidade existente do Módulo Societário continua 100% manual.** O agente assistente é uma camada **aditiva** — nunca substitui, nunca remove, nunca limita ações humanas.

### Como isso se traduz em cada feature

| Comportamento | Modo Manual (sempre disponível) | Modo Automático (opcional) |
|---------------|---------------------------------|----------------------------|
| Criar processo | Botão "Novo processo" no Kanban | Agente cria via tool ao detectar gatilho |
| Concluir tarefa do checklist | Botão "Concluir" + nota + anexo opcional | Skill executa e marca `autoExecuted=true` |
| Mover card entre colunas | Drag-and-drop livre (com guard de obrigatórias) | `autoAdvance` quando configurado |
| Solicitar documentos ao cliente | Botão "Enviar solicitação" (envia in-app/canal preferido) | Skill `solicitar_documentos_cliente` no enter coluna |
| Validar documento recebido | Analista marca tarefa "validar X" como concluída + nota | Skill `validar_documentos_recebidos` via OCR |
| Gerar minuta | Editor manual + upload do PDF + tarefa "minuta criada" marcada | Skill `gerar_minuta` cria documento + tarefa "Revisar" |
| Enviar lembrete | Botão "Reenviar solicitação" no card | Cron diário com throttle |
| Avançar processo | Sempre permitido se obrigatórias estão concluídas | Apenas quando regra `autoAdvance=true` |

### Garantias técnicas
1. **Toggle por tarefa**: cada `pipelineChecklistItems` define `executorType` mas todo card mostra **dois botões** (Concluir manualmente | Executar agente) sempre que existir skill associada.
2. **Toggle por processo**: `processosSocietarios.modoOperacao` (`'manual'` | `'assistido'` | `'auto'`) — o analista escolhe na criação, padrão `'assistido'`. Em `'manual'`, agente NUNCA age sozinho (só responde quando chamado).
3. **Override sempre disponível**: analista pode reverter/refazer qualquer ação do agente — `autoExecutionResult` registra mas não trava.
4. **Skill = tool, não trigger compulsório**: as 6 skills do Sprint 3 são tools que o agente PODE chamar ou que o usuário PODE acionar via botão "Executar agente"; o cron só dispara quando `modoOperacao !== 'manual'`.
5. **Audit trail diferencia**: `processoMovimentacoes.movidoPorAgente` + `processoTarefas.autoExecuted` deixam claro o que foi humano vs máquina.

### Ajuste no schema
Acrescentar à tabela `processosSocietarios`:
```ts
modoOperacao varchar(20) NOT NULL DEFAULT 'assistido',  // 'manual'|'assistido'|'auto'
```

### Ajuste nas skills (Sprint 3)
Toda skill começa com guard:
```ts
if (processo.modoOperacao === 'manual' && trigger === 'cron') return;  // só roda quando chamada explicitamente
```

---

## 🎯 O QUE MUDOU EM RELAÇÃO À v2.3

| # | Mudança | Motivo |
|---|---------|--------|
| 1 | **Reuso explícito** dos componentes Kanban do Demandas (`@dnd-kit/core`) e da tabela `notifications` (Recovery acabou de mostrar o padrão). | A v2.3 propunha reescrever — perderíamos 1 semana. |
| 2 | **Modelo de dados unificado**: removida a duplicação `processoTarefas` (tabela) vs `checklist` (jsonb). Fica só a tabela. | A v2.3 mantinha as duas — gera divergência e bugs. |
| 3 | **Pipeline configs nasce como SEED** (2 templates fixos) e só vira CRUD no Sprint 4. | Reduz Sprint 1 em 30%; CRUD de configs é refinement. |
| 4 | **Comunicação WhatsApp/Email tratada como degradação graciosa** — usa `notificationService` em modo in-app no MVP, escala para WhatsApp/Email assim que `EVOLUTION_API_URL`/SMTP forem configurados. | Hoje os canais são stubs (auditado em `notificationService.ts`); planejar como se fossem reais é fingir. |
| 5 | **Agente assistente em 2 fases** (Read-only Tools → Action Tools) em vez de 9 skills num sprint só. | Cada skill = handler + testes; 9 num sprint seria atraso garantido. |
| 6 | **Recuperação Judicial REMOVIDA** dos tipos de processo. | Já existe módulo Recovery completo — duplicar geraria conflito. |
| 7 | **Sprint 5 dissolvido**: itens críticos (Pessoas, Caixa de Envio) entram em Sprint 4; resto vira backlog explícito. | Sprint 5 da v2.3 era catch-all sem critério de pronto. |
| 8 | **Critérios de aceitação testáveis sem dependências externas** (mockadas com seed quando preciso). | A v2.3 dependia de Receita Federal/JUCEMG inexistentes. |

---

## 🧱 AUDITORIA DE REUSO (o que JÁ existe)

| Capacidade necessária | O que já temos | Onde vive | Estratégia |
|----------------------|----------------|-----------|-----------|
| Drag-and-drop Kanban | `@dnd-kit/core` + `Column`/`Card`/`DragOverlay` | `client/src/pages/Demandas.tsx` | **Extrair** componentes para `client/src/components/kanban/` reusáveis |
| Notificações in-app | Tabela `notifications` + `sourceType`/`sourceId` + endpoints `GET/POST` | `shared/schema.ts:2969`, `server/notificationService.ts`, `server/recovery/notifications.ts` | **Reusar 100%**, novo `sourceType='societario_processo'` |
| Cron diário | `node-cron` hardcoded (Recovery 06:00) + motor dinâmico (`automationService` a cada minuto) | `server/recovery/overdueCron.ts`, `server/automationService.ts` | **Hardcoded** para regras fixas (lembrete docs); **dinâmico** se cliente quiser configurar |
| Upload com URL assinada + Object Storage privado | Padrão entregue no Societário (docs) e no Recovery (anexos) | `server/societario/routes.ts` (upload-url + reextract), `server/recovery/timeline.ts` | **Reusar idêntico** para anexos de checklist e documentos do processo |
| Extração de texto (OCR fallback) | `extractText` + `runOcrViaClaude` | `server/superAgentFiles.ts`, `server/societario/ocrFallback.ts` | **Reusar** na skill `validar_documentos_recebidos` |
| Agente com Context Injection | `buildSociedadeContext` + `<DadosAtuais>` no system prompt | `server/societario/agentChat.ts` | **Estender** para incluir contexto do processo + lista de pendências |
| Multi-tenant guard | `tenantContext` middleware + `tenantId` em toda tabela | global | **Obrigatório** em toda nova tabela |
| Comunicação externa (WhatsApp/Email) | `sendNotification(channel)` com **fallback stub** in-app | `server/notificationService.ts` | **Usar a abstração** — quando o canal externo for habilitado, o pipeline já funciona |
| Bibliotecas de PDF | `pdf-lib` (Recovery timeline) e `pdf-parse` (extração) | global | Reusar `pdf-lib` para gerar minutas em PDF |
| Schemas societários (`sociedades`, `socios`, `alteracoes_societarias`, `documentos_societarios`, `obrigacoes_societarias`) | Completos | `shared/schema.ts:3399+` | **Reusar 100%**, FK do processo aponta para `sociedades.id` |

> **Resultado:** ~60% do plano v2.3 já tem fundação. Foco do trabalho real é em (a) novo schema do pipeline+checklist, (b) UI Kanban societária, (c) skills do agente assistente.

---

## 🗂️ MODELO DE DADOS REFINADO (sem duplicação)

### Decisões-chave
- **Uma única fonte de verdade para tarefas**: tabela `processo_tarefas`. Removido o jsonb `checklist` da `processos_societarios` que a v2.3 trazia em paralelo.
- **`pipeline_configs` é metadata global do tenant**, não copiada por processo. Cada processo aponta para a config vigente; a sequência de colunas é lida da config.
- **`pipeline_checklist_items` é template** (definido por config+etapa). Ao criar processo, materializamos em `processo_tarefas` (snapshot — assim alterar template não muda processos antigos).
- **Histórico de movimentação** vai numa tabela leve `processo_movimentacoes` (em vez de jsonb embarcado) — facilita relatórios e SLA.
- **Comunicações com cliente** reusam `notifications` (sourceType='societario_processo') em modo broadcast (`userId=null`) **e** quando WhatsApp/email externos estiverem ativos, o `notificationService` fala com Pessoa via canal real.

### Tabelas novas (4)

```ts
// 1. Configuração de pipeline (template de colunas + regras)
pipelineConfigs (
  id uuid PK,
  tenantId uuid NOT NULL,
  nome varchar(100) NOT NULL,
  tipoProcesso varchar(50) NOT NULL,          // 'constituicao'|'alteracao_contratual'|'mudanca_status'|'dissolucao'|'transformacao'
  colunas jsonb NOT NULL,                      // [{id, nome, ordem, cor}]
  regrasTransicao jsonb,                       // { "from→to": {condition, autoAdvance} }
  isDefault boolean DEFAULT false,             // 1 default por tipoProcesso por tenant
  isActive boolean DEFAULT true,
  createdAt timestamptz, createdBy uuid
)
INDEX (tenantId, tipoProcesso, isDefault)

// 2. Template de checklist por etapa
pipelineChecklistItems (
  id uuid PK,
  tenantId uuid NOT NULL,
  pipelineConfigId uuid NOT NULL FK,
  etapa varchar(50) NOT NULL,                  // matches colunas[].id
  ordem integer NOT NULL,
  titulo varchar(255) NOT NULL,
  descricao text,
  executorType varchar(20) NOT NULL,           // 'agente'|'analista'|'cliente'|'sistema'
  acaoAutomatica jsonb,                        // {type, params, when}  (apenas se executor='agente'|'sistema')
  isRequired boolean DEFAULT true,
  bloqueiaAvanco boolean DEFAULT true,
  condition jsonb,                             // condicional para aparecer no processo
  createdAt timestamptz
)
INDEX (pipelineConfigId, etapa, ordem)

// 3. Processo (CARD do Kanban)
processosSocietarios (
  id uuid PK,
  tenantId uuid NOT NULL,
  processNumber varchar(50) NOT NULL,          // SOC-{YYYY}-{seq} — gerado por sequência por tenant
  sociedadeId uuid NOT NULL FK,
  pipelineConfigId uuid NOT NULL FK,
  tipoProcesso varchar(50) NOT NULL,
  subtipo varchar(50),
  titulo varchar(255) NOT NULL,
  descricao text,
  colunaAtual varchar(50) NOT NULL DEFAULT 'backlog',
  analistaResponsavelId uuid FK users,
  solicitanteId uuid FK users,
  clientePessoaId uuid FK pessoas,             // CRM 2.0
  clienteContatoPreferido varchar(20) DEFAULT 'inapp',  // 'whatsapp'|'email'|'inapp'|'ambos'
  dataSolicitacao timestamptz DEFAULT now(),
  dataPrevistaConclusao date,
  dataConclusao timestamptz,
  status varchar(20) DEFAULT 'ativo',
  prioridade varchar(20) DEFAULT 'media',
  alteracaoSocietariaId uuid FK,               // criado quando processo se torna registro oficial
  notasInternas text,
  createdAt, updatedAt, createdBy
)
INDEX (tenantId, colunaAtual), (tenantId, status), (analistaResponsavelId), UNIQUE (tenantId, processNumber)

// 4. Tarefas materializadas no processo (instâncias do checklist)
processoTarefas (
  id uuid PK,
  tenantId uuid NOT NULL,
  processoId uuid NOT NULL FK CASCADE,
  checklistItemId uuid FK pipelineChecklistItems,  // origem (nullable se ad-hoc)
  etapa varchar(50) NOT NULL,
  ordem integer NOT NULL,
  titulo varchar(255) NOT NULL,
  descricao text,
  executorType varchar(20) NOT NULL,
  status varchar(20) DEFAULT 'pendente',       // pendente|em_andamento|concluido|bloqueado|cancelado
  isRequired boolean DEFAULT true,
  bloqueiaAvanco boolean DEFAULT true,
  acaoAutomatica jsonb,
  autoExecuted boolean DEFAULT false,
  autoExecutionResult jsonb,
  concluidoAt timestamptz,
  concluidoBy uuid FK users,
  concluidoNotes text,
  anexos jsonb,                                 // [{path, name, mime, size}] — Object Storage
  assignedTo uuid FK users,                     // se executor=analista
  createdAt
)
INDEX (processoId, etapa, ordem), (tenantId, status, executorType)

// 5. Movimentação entre colunas (histórico)
processoMovimentacoes (
  id uuid PK,
  tenantId uuid NOT NULL,
  processoId uuid NOT NULL FK CASCADE,
  colunaDe varchar(50),
  colunaPara varchar(50) NOT NULL,
  movidoPor uuid FK users,                      // null = automático pelo agente
  movidoPorAgente boolean DEFAULT false,
  motivo text,
  createdAt timestamptz DEFAULT now()
)
INDEX (processoId, createdAt DESC)
```

### Migrations
Tudo via `runStartupMigrations` (padrão da casa) — DDL idempotente + seed dos 2 templates default no primeiro boot por tenant.

---

## 🚀 ROADMAP REFINADO — 4 SPRINTS de 1-2 semanas

### **Sprint 1 — Fundação Pipeline + Kanban Visual** (1.5 semanas)
**Objetivo:** Analista cria processo manual, vê no Kanban, arrasta entre colunas, acompanha checklist (sem agente ainda).

| Task | Blocked By | Detalhes |
|------|------------|----------|
| **S1.T1** Schema + migrations | — | 5 tabelas + índices + FK; runStartupMigrations idempotente; seed de 2 pipelineConfigs default ('Constituição', 'Alteração Contratual') com checklist completo. |
| **S1.T2** Backend CRUD processo | S1.T1 | `server/societario/pipeline/routes.ts`: `POST/GET /processos`, `GET /processos/:id` (inclui tarefas), `PATCH /processos/:id/coluna` (com guard `bloqueiaAvanco`), `POST /processos/:id/tarefas/:tid/concluir`. Geração automática de `processNumber` + materialização do checklist. |
| **S1.T3** Componentes Kanban reusáveis | — | Extrair `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `KanbanDragOverlay` de `Demandas.tsx` para `client/src/components/kanban/`. Sem regressão no Demandas. |
| **S1.T4** Página `/societario/pipeline` | S1.T2, S1.T3 | Lista colunas dinâmicas, cards com `processNumber`/`titulo`/`tempoNaColuna`/`prioridade`. Drag-drop chama PATCH; bloqueio visual quando há tarefa obrigatória pendente; modal "Novo processo" com select de sociedade + tipoProcesso. |
| **S1.T5** Detalhe do processo | S1.T2 | Rota `/societario/pipeline/:id`: tabs Resumo / Checklist / Documentos / Notas / Histórico. Checklist agrupado por etapa; tarefas marcáveis (analista) com nota + anexo. Botão "Avançar" só habilita quando todas obrigatórias da etapa atual estão concluídas. |
| **S1.T6** Histórico de movimentação | S1.T2 | Insert em `processoMovimentacoes` em todo PATCH coluna; aba Histórico lê e exibe timeline simples. |

**Acceptance Sprint 1:** criar processo manual → Kanban mostra na coluna 'backlog' → completar checklist obrigatório → arrastar para próxima coluna funciona; com tarefa pendente, bloqueia.

---

### **Sprint 2 — Agente Assistente Read-Only + Notificações** (1.5 semanas)
**Objetivo:** Agente "vê" o processo, lista pendências para o analista, envia notificação in-app quando ação humana é necessária. Ainda não move card nem gera minuta.

| Task | Blocked By | Detalhes |
|------|------------|----------|
| **S2.T1** Estender `agentChat` com contexto de processo | S1 | `buildProcessoContext(processoId)` injeta no system prompt: dados do processo, sociedade, sócios, checklist (com status), histórico de movimentação. Mantém regra anti prompt-injection. |
| **S2.T2** Tool-calling read-only | S2.T1 | 3 tools no agente: `listar_processos_pendentes(filtros)`, `detalhes_processo(id)`, `tarefas_pendentes_de(executorType)`. Usar padrão de tool-calling do agente Scrum como referência. |
| **S2.T3** Hook de notificação por evento | — | `server/societario/pipeline/notifications.ts` com `notifyProcessoEvent(tenantId, processoId, event)`. Eventos: `criado`, `coluna_avancada`, `tarefa_bloqueada`, `prazo_estourado`. Reusa `notifications` (sourceType='societario_processo'). Hooks chamados em PATCH coluna e em concluir tarefa. |
| **S2.T4** Cron diário (06:00) | S2.T3 | Em `server/societario/pipeline/cron.ts` (registrado em `server/index.ts`): para processos `dataPrevistaConclusao < today` AND `status='ativo'` → marcar atraso, notificar analista. |
| **S2.T5** Card "Alertas Recovery"-style no dashboard | S2.T3 | Em nova página `/societario` (dashboard): widget de notificações ativas + KPIs (processos por coluna, tempo médio, atrasados). Reusa componente `RecoveryNotifications` se possível. |

**Acceptance Sprint 2:** agente responde "quais processos estão aguardando minha análise?" listando corretamente; ao bloquear card, analista recebe notificação no sino; cron marca atrasados.

---

### **Sprint 3 — Skills de Ação do Agente + Comunicação com Cliente** (2 semanas)
**Objetivo:** Agente executa tarefas auto: pede docs ao cliente, valida docs recebidos via OCR, gera minuta de alteração, move card.

| Task | Blocked By | Detalhes |
|------|------------|----------|
| **S3.T1** Skill `verificar_dados_empresa` | S2 | Tool agentic: lê `sociedades`/`socios`/`certificados_digitais`/`obrigacoes_societarias`; marca tarefas correspondentes como `concluido` + `autoExecutionResult`. Sem APIs externas no MVP — só consulta interna. |
| **S3.T2** Skill `solicitar_documentos_cliente` | S2 | Trigger: ao entrar coluna `aguardando_documentos`. Cria entrada em `notifications` direcionada à `pessoa.userId` (se cliente tem login) OU em `caixa_envio` (se já existe) OU broadcast in-app. Quando `pessoa.whatsapp`/`email` estão preenchidos E o `notificationService` tem canal externo configurado, envia também por lá — caso contrário, fica só in-app (degradação graciosa). Template renderizado server-side com Mustache simples. |
| **S3.T3** Skill `validar_documentos_recebidos` | S2 | Trigger: ao subir documento no processo. Reusa `extractText` (com OCR fallback). Se conseguiu extrair texto, marca tarefa "Validar documento X" como concluída; se não, notifica analista. |
| **S3.T4** Skill `gerar_minuta` | S2 | Trigger: todas obrigatórias da etapa `em_elaboracao` concluídas. Usa LLM (Claude) com template do tipo de processo + contexto do processo. Salva em `documentos_societarios` (tipo='minuta', gerado pelo agente) + cria tarefa "Revisar minuta" para analista. |
| **S3.T5** Skill `lembrar_documentos_pendentes` | S3.T2 | Cron diário (06:00 já criado): para processos em `aguardando_documentos` há > 3 dias com tarefas cliente pendentes, reenvia notificação. Throttle: max 1 lembrete por 3 dias. |
| **S3.T6** Skill `atualizar_pipeline` (auto-advance) | S3.T1-T4 | Quando `regrasTransicao[from→to].autoAdvance===true` E todas obrigatórias da etapa concluídas, agente move card automaticamente. Insere movimentação com `movidoPorAgente=true`. |
| **S3.T7** UI: badges + botões manuais por skill | S3.T1-T6 | Cada tarefa com `executorType='agente'` ganha botão "Executar agora" (dispara skill on-demand) e badge mostrando última execução. Status de erro visível (ex: skill falhou). |

**Acceptance Sprint 3:** criar processo "Alteração Contratual" → mover para `em_analise` → agente conclui auto as 5 tarefas dele → notifica analista → analista aprova → mover para `aguardando_documentos` → agente envia notificação ao cliente → upload de PDF → agente valida via OCR → tarefa marca concluída → mover para `em_elaboracao` → agente gera minuta como documento → analista revisa.

---

### **Sprint 4 — Configuração, Pessoas, Polish** (1.5 semanas)
**Objetivo:** Personalização de pipelines, integração com Cadastro de Pessoas, dashboard final, hardening, exportação.

| Task | Blocked By | Detalhes |
|------|------------|----------|
| **S4.T1** CRUD de `pipelineConfigs` | S1 | Página `/societario/configuracoes/pipelines`: editar colunas, drag-reorder, definir regras de transição, configurar checklist por etapa (nome, executor, ação automática, isRequired). Validação: não pode haver coluna duplicada; `acaoAutomatica.type` deve estar no enum suportado. |
| **S4.T2** Integração com Cadastro de Pessoas | S3.T2 | Wizard "Novo processo" ganha campo `clientePessoaId` (autocomplete em `pessoas` filtrado por papel `cliente`). Mostra contatos disponíveis (whatsapp/email) e permite escolher canal preferido. |
| **S4.T3** Dashboard analista (versão final) | S2.T5 | KPIs: processos ativos, atrasados, tempo médio por coluna, taxa de auto-conclusão pelo agente. Filtro por analista. Lista "meus processos" agrupada por coluna. |
| **S4.T4** Exportação relatório PDF | S4.T3 | `GET /api/societario/pipeline/relatorio.pdf` — usa `pdf-lib` (mesmo padrão Recovery). Lista processos por coluna, com analista, prazo, status. |
| **S4.T5** Audit trail | S1, S2, S3 | Toda criação/atualização/movimentação grava em `processoMovimentacoes` + log estruturado (já temos pino-style `console.log` com prefixo `[societario]`). Bloquear PATCH em campos sensíveis após conclusão (`status='concluido'` → readonly). |
| **S4.T6** Hardening + testes E2E | S1-S3 | runTest cobrindo: criar processo → checklist obrigatório bloqueia → agente conclui auto → cliente upload doc → OCR valida → minuta gerada → conclusão. architect com `includeGitDiff:true`. Atualizar `replit.md`. |

**Acceptance Sprint 4:** admin cria pipeline custom; processo criado pega clientePessoaId real; dashboard mostra métricas; runTest E2E passa do início ao fim.

---

## ⚠️ FORA DO MVP (backlog explícito, NÃO entra nas 6 semanas)

| Item | Por quê fica fora | Quando reabordar |
|------|-------------------|------------------|
| Integração real WhatsApp (Evolution API/Twilio) | Requer credenciais externas + custo + onboarding | Sprint dedicado quando cliente quiser pagar |
| Integração real SMTP (Resend/SES/SMTP custom) | Precisa configurar provedor + DKIM/SPF | Junto com WhatsApp |
| Portal do cliente (upload externo) | Escopo grande (auth pública, magic link, UI dedicada) | Sprint 5+ |
| API Receita Federal / JUCEMG | Indisponíveis sem credencial; mockáveis se necessário | Quando cliente disponibilizar |
| Tracking de assinatura digital (D4Sign etc) | Integração externa | Sprint próprio |
| Recuperação Judicial como tipo de processo | Já existe módulo Recovery | Nunca — manter separado |
| Hash de integridade no checklist | Complexidade alta para ganho marginal | Quando aparecer requisito de auditoria externa |

---

## 🛡️ RISCOS E MITIGAÇÕES

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Tool-calling do agente quebrar com context grande | Média | Alto | Limitar contexto a 1 processo por chamada; truncar `notasInternas` em 2k chars. |
| Auto-advance gerar loops (skill conclui → move → trigger nova skill → conclui...) | Média | Alto | Guard com `autoAdvanceMaxPerHour` por processo (ex: 5); log de ciclo no `processoMovimentacoes`. |
| Geração de minuta com LLM produzir conteúdo inconsistente | Alta | Médio | Sempre criar tarefa "Revisar minuta" para analista — minuta NUNCA vai para assinatura sem revisão humana. |
| Notificação spammar cliente (muitos lembretes) | Média | Médio | Throttle: max 1 notificação/3 dias por processo; preference de canal opt-in. |
| Migration falhar em tenants existentes | Baixa | Alto | DDL idempotente (CREATE TABLE IF NOT EXISTS, ALTER ADD COLUMN IF NOT EXISTS); seed default verifica antes de inserir. |
| Tempo total estimado escorregar | Alta | Médio | Cada sprint termina com runTest E2E; se falhar, NÃO avança. Fora do MVP é fora do MVP. |

---

## 📋 CRITÉRIOS DE ACEITAÇÃO MVP (testáveis hoje)

| # | Critério | Como testar (sem dependência externa) |
|---|----------|---------------------------------------|
| 1 | Pipeline visual funcional | Acessar `/societario/pipeline` → ver colunas → arrastar card |
| 2 | Checklist bloqueia avanço | Tentar mover card com tarefa obrigatória pendente → bloqueio visual + erro 409 no PATCH |
| 3 | Agente lista pendências | Chat agente "minhas pendências" → resposta cita processNumber + etapa |
| 4 | Skill auto: verificar dados | Criar processo → ver tarefas de "verificar dados" concluídas em < 30s |
| 5 | Skill auto: solicitar docs | Mover para `aguardando_documentos` → notificação criada (in-app) |
| 6 | Skill auto: validar doc | Upload PDF no processo → tarefa "Validar X" marca concluída |
| 7 | Skill auto: gerar minuta | Concluir tarefas de `em_elaboracao` → documento "Minuta - SOC-..." aparece nos documentos da sociedade |
| 8 | Notificação ao analista | Bloquear card → notificação aparece no sino do analista |
| 9 | Cron de atrasados | Forçar `dataPrevistaConclusao = ontem` + rodar `/admin/run-overdue-check-societario` → status muda + notification |
| 10 | Dashboard com KPIs | `/societario` mostra contagens corretas por coluna |
| 11 | Audit trail | Toda movimentação aparece em `processoMovimentacoes` |
| 12 | Multi-tenant | Tenant A não vê processos do Tenant B (testar com 2 logins) |

---

## 📦 ARQUIVOS NOVOS / MODIFICADOS

### Novos
- `shared/schema.ts` — 5 tabelas (pipelineConfigs, pipelineChecklistItems, processosSocietarios, processoTarefas, processoMovimentacoes)
- `server/societario/pipeline/routes.ts` — CRUD processo + tarefas + movimentação
- `server/societario/pipeline/skills.ts` — implementação das 6 skills
- `server/societario/pipeline/notifications.ts` — `notifyProcessoEvent`
- `server/societario/pipeline/cron.ts` — cron diário (atrasados + lembretes)
- `server/societario/pipeline/templates.ts` — templates de minuta + mensagens cliente
- `server/societario/pipeline/seed.ts` — seed dos 2 pipelineConfigs default
- `client/src/components/kanban/{KanbanBoard,KanbanColumn,KanbanCard,KanbanDragOverlay}.tsx` — extraídos de Demandas
- `client/src/pages/societario/Pipeline.tsx` — board principal
- `client/src/pages/societario/ProcessoDetail.tsx` — detalhe com tabs
- `client/src/pages/societario/Dashboard.tsx` — dashboard analista
- `client/src/pages/societario/PipelineConfigs.tsx` — Sprint 4

### Modificados
- `server/index.ts` — registrar cron e rotas
- `server/societario/agentChat.ts` — adicionar contexto + tools
- `server/societario/routes.ts` — registrar nested routes
- `client/src/pages/Demandas.tsx` — usar componentes extraídos
- `client/src/App.tsx` — registrar rotas novas
- `replit.md` — Sprint summary final

---

## ✅ PRÓXIMOS PASSOS (decisão do usuário)

1. **Aprovar este plano** → criar 4 tasks no project_tasks (uma por sprint).
2. **Optar entre dois caminhos**:
   - (a) Iniciar Sprint 1 imediatamente como tarefa única para mim (Build mode).
   - (b) Quebrar em 4 tarefas separadas para distribuir entre agente principal e task agents isolados (paralelizar Sprint 1 e Sprint 2 em branches separadas, já que dependências permitem).
3. **Confirmar premissas**:
   - Aceito tratar WhatsApp/Email como degradação para in-app no MVP? **(crítico)**
   - Aceito remover Recuperação Judicial dos tipos (já existe no Recovery)?
   - Aceito 2 templates fixos no MVP, com CRUD só no Sprint 4?

---

**Versão refinada com base em auditoria de codebase real em 29/04/2026.**
