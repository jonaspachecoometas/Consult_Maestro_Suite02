# Arcádia Consult — Documentação Completa do Sistema

> **Versão:** 3.0 · **Data:** Abril 2026 · **Status:** Produção
> Este documento é a fonte de verdade da plataforma. Atualizar junto com cada sprint entregue.

---

## 1. Visão Geral

O **Arcádia Consult** é uma plataforma SaaS multi-tenant de consultoria empresarial com IA nativa. Cada módulo tem um agente especializado que age de forma proativa, reativa e executora. O produto substitui o papel do consultor, controller e conselheiro para empresas que não podem contratar esses profissionais em tempo integral.

### 1.1 Posicionamento estratégico

- **O que somos:** Inteligência empresarial — diagnosticamos, interpretamos, recomendamos e executamos
- **O que não somos:** ERP operacional — não emitimos NF-e, não gerenciamos estoque
- **Parceiros, não concorrentes:** Omie, Bling, Domínio, Totvs são fontes de dados, não adversários
- **O Grande Agente:** Maestro IA atua como consultor sênior, controller e conselheiro em um lugar só

### 1.2 Stack técnico

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, TypeScript, Vite, Wouter, TanStack Query v5, shadcn/ui New York, Tailwind |
| Backend | Node.js 20, Express, TypeScript, Drizzle ORM |
| Banco de dados | PostgreSQL (Neon serverless) — 137 tabelas |
| IA — LLM | Claude (Anthropic) — principal · Gemini · Kimi · Ollama local |
| IA — Embeddings | OpenAI (text-embedding-ada-002) |
| Storage | Google Cloud Storage (Object Storage Replit) |
| Auth | Local (bcrypt + sessão PG) + Replit OIDC |
| Deploy | Replit Deployments |

### 1.3 Credenciais de desenvolvimento

| Ambiente | URL | Login |
|---|---|---|
| Dev | process-compass--jonas207.replit.app | admin@333.com / 123456 |
| Produção | consult.arcadiabusiness.com.br | a@a.com.br / 123456 (seed) |
| Servidor | 85.31.60.39 (Coolify) | SSH + Coolify panel |

---

## 2. Arquitetura do Sistema

### 2.1 Estrutura de pastas

```
client/src/
  pages/          89 páginas React (93 rotas em App.tsx)
  components/     Componentes UI + domínio
  hooks/          useModuleAgent, usePermissions, useTenant...
  lib/            queryClient, apiRequest, helpers

server/
  index.ts        Bootstrap: migrations → seeds → routes
  routes.ts       ~445 endpoints (núcleo)
  storage.ts      DAL Drizzle (camada de persistência)
  tenantContext.ts Middleware multi-tenant
  agentService.ts  resolveAnthropicForTenant + execução de agentes
  aiConfigService.ts Gestão de providers de IA por tenant
  superAgentService.ts Maestro IA com tool-calling e SSE
  cryptoService.ts AES-256-GCM para credenciais
  control/        Arcádia Control (financeiro)
  societario/     Módulo Societário + Pipeline Kanban
  recovery/       Recovery (recuperação de empresas)
  producao/       Central de Produção (Scrum)
  ide/            Dev Center IDE Autônoma
  infra/          Hub de Infraestrutura (Coolify + Gitea)
  mcp/            [NOVO] MCP Server + Tool Registry + OAuth2

shared/
  schema.ts       137 tabelas Drizzle

docs/             Esta documentação
exports/          PDFs, ZIPs, SYSTEM_MAP.md gerados
```

### 2.2 Multi-tenancy

**3 níveis hierárquicos:**
- `superadmin` — vê tudo, gerencia parceiros e tenants
- `partner` — gerencia tenants do seu parceiro (white-label)
- `tenant admin / gerente / tecnico` — papéis dentro de um tenant

**Isolamento:** `tenantContext` middleware injeta `req.tenantId` em toda request. Toda tabela de negócio tem `tenant_id`. Queries duplicam o predicado `eq(tabela.tenantId, tenantId)` em JOINs (defense-in-depth).

**Troca de tenant:** Header `X-Tenant-Id` permite que partner/superadmin entrem em um tenant específico.

### 2.3 Resolução de motor de IA — fallback distribuído

```
Quando um agente precisa de um motor de IA:

1. tenant_ai_configs do tenant
   → Provider ativo com API key configurada?
   → Sim: usar credenciais do tenant (source: "tenant")
   → Não: ir para passo 2

2. Pool da plataforma (variáveis de ambiente)
   → PLATFORM_ANTHROPIC_API_KEY / PLATFORM_GEMINI_API_KEY
   → Usar com rate limit por tenant (fonte: "platform")
   → Nenhum tenant fica sem agente por falta de config

3. Se pool esgotado para o tenant:
   → Mensagem orientativa para configurar motor próprio
   → Nunca falha silenciosamente
```

**Implementado em:** `server/agentService.ts → resolveAnthropicForTenant()`
**Retorna:** `{ client, model, source: "tenant" | "platform" }`

---

## 3. Módulos do Sistema

### 3.1 Super Agente — Maestro IA

**Arquivos:** `server/superAgentService.ts`
**Rotas:** via `server/routes.ts` → `/api/super-agent/*`
**Frontend:** `client/src/pages/SuperAgente.tsx`

**Comportamento:**
- Tool-calling com 4 tools base: `list_projects`, `list_clients`, `get_project_detail`, `search_brain`
- SSE streaming evento a evento: `iteration → tool_call → tool_result → final → done`
- Sessões persistidas em `super_agent_sessions` + `super_agent_messages`
- Aceita anexos até 15MB (PDF, DOCX, XLSX, imagens)
- `aiSource` retornado em cada resposta indica se usou config do tenant ou da plataforma

**12 agentes especializados** (seed em `server/seedAgentDefinitions.ts`):
Maestro IA, Diagnóstico Canvas, Scrum, Controller, Societário, BPO, BI Consultivo, ERP, Fiscal, Comercial, Recuperação, Franqueador

### 3.2 Arcádia Control — Financeiro

**Arquivos:** `server/control/` (12 arquivos)
**Rotas:** `server/control/routes.ts` + `routesNovas.ts` (~68 endpoints)
**Frontend:** `client/src/pages/control/`

**Decisão estratégica:** O Control NÃO emite NF-e. Recebe, manifesta e analisa. Emissão é do Arcádia Suite (Frappe) ou ERP do cliente.

**Implementado:**
- Grupos empresariais (Matriz/Filiais) com DRE consolidada — `grupoService.ts`
- Lançamentos contábeis com partidas dobradas — `contabilidadeService.ts`
- IBS/CBS com tabela de transição 2026-2033 (LC 214/2025) — `ibsCbsService.ts`
- Modelo Fleuriet: NCG, CGL, ST, ciclos — `fleurietService.ts`
- Fechamento contábil com workflow e checklist — `fechamentoService.ts`
- NF-e Monitor horário via Nuvem Fiscal API — `nfeMonitor.ts` (**modo simulado**)
- Hub de Conectores com IConnector interface — `connectorHub.ts`
- 3 conectores: brasilApiConnector, dominioConnector, nuvemFiscalConnector
- Import Wizard para planilhas — `importService.ts`
- Seed do plano de contas — `seedPlanoContas.ts`

**Pendente (Sprints 6-9):**
- Open Finance OAuth2 (todos os bancos)
- Exportações: SPED ECD/EFD/ECF, DRE/Balanço em Excel
- Conectores: Omie, Bling, Conta Azul, CNAB 240/400
- Rolling Forecast integrado ao CRM
- PDD conforme CPC 48
- Hub de Cobrança: Asaas + Iugu
- Ativar NF-e Monitor com apiKey real da Nuvem Fiscal

### 3.3 Módulo Societário + Pipeline Kanban

**Arquivos:** `server/societario/` (routes, agentChat, pipeline/)
**Rotas:** ~83 endpoints
**Frontend:** `client/src/pages/societario/`

**Tabelas:** `sociedades`, `socios`, `documentos_societarios`, `pipeline_configs`, `pipeline_checklist_items`, `processos_societarios`, `processo_tarefas`, `processo_movimentacoes`

**Pipeline Kanban (Sprint 4 — mais recente):**
- CRUD de pipelineConfigs com `requireTenantAdmin`
- Agente com 6 skills: `verify_dados_empresa`, `solicitar_documentos`, `validar_documentos`, `gerar_minuta`, `lembrar_documentos`, `atualizar_pipeline`
- Modo dual: manual + automático. Throttle 5 movimentos/hora por processo
- Dashboard analista com filtros `tipo` e `analista=__me__` (resolvido server-side)
- Readonly para processos `concluido` com TOCTOU-safe `eq(status, expected)`
- Audit trail automático em `processo_movimentacoes`
- PDF per-process + PDF consolidado `/api/societario/pipeline/relatorio.pdf`
- Combobox Pessoa-cliente com busca server-side `?search=`

### 3.4 Recovery — Recuperação de Empresas

**Arquivos:** `server/recovery/` (10 arquivos)
**Rotas:** ~51 endpoints
**Frontend:** `client/src/pages/recovery/`

**Tabelas:** `recovery_processes`, `recovery_creditors`, `recovery_scenarios`, `recovery_proposals`, `recovery_installments`, `recovery_timeline`, `recovery_actions`, `recovery_annexos`

**Funcionalidades:**
- Processos extrajudicial/judicial/preventivo
- CET (Custo Efetivo Total) calculado por cenário — `cetCalculator.ts`
- Workflow de aprovação com propostas versionadas
- Homologação idempotente → geração automática de parcelas
- Timeline filtrada server-side + PDF + anexos
- Cron overdue 06:00 diário — `overdueCron.ts`
- Isolation guard por tenant — `isolationGuard.ts`

### 3.5 Central de Produção — Scrum

**Arquivos:** `server/producao/routes.ts` (27 endpoints)
**Frontend:** `client/src/pages/producao/`

**Hierarquia:** `internal_projects → subprojects → sprints → internal_tasks`

**Funcionalidades:**
- Squads e membros
- Drive por projeto + por task (upload + extração de texto PDF/DOCX/XLSX)
- Agente Scrum Modo 1: analisa doc → JSON `scrum-plan` → cria tudo em transação
- Agente Scrum Modo 2: chat por task com contexto automático injetado
- Calendário mensal, backlog, timesheet, relatórios

### 3.6 Dev Center — IDE Autônoma

**Arquivos:** `server/ide/` + `server/infra/`
**Rotas:** 12 + 6 + 20 endpoints
**Frontend:** rotas `/dev-center/*`

**Sprints entregues (1-8):**
- Pipeline 3 agentes: Architect → Developer → QA com SSE e persistência por fase
- Preview DocType (formulário Frappe-like por fieldtype)
- Editor editável com auto-save 2s, badge editado, restaurar original
- Auto-correção pós-deploy (max 2 tentativas), seletor de modelo por fase
- CoolifyClient com anti-SSRF via resolução DNS
- GiteaClient com commit atômico, revert com parent SHA real
- Deploy real no Frappe + multi-alvo (Suite/Consult/Standalone/Git)
- Wizard de Onboarding 5 passos retomáveis (`requireTenantAdmin`)
- Prompt Engineering Studio 3 painéis + comparador A/B
- Índice UNIQUE parcial `(tenant, agent) WHERE is_active=1`

### 3.7 Cadastro de Pessoas — CRM 2.0

**Tabelas:** `pessoas`, `pessoa_papeis`, `pessoa_contatos`, `pessoa_enderecos`, `pessoa_documentos`, `pessoa_canais_preferidos`

**Funcionalidades:**
- PF/PJ unificada com papéis múltiplos (cliente, fornecedor, colaborador)
- Mass import via `pessoaImportService.ts`
- Combobox server-side `?search=` usado no Pipeline Societário e Recovery

### 3.8 BI Builder

**Funcionalidades:**
- Drag-and-drop de widgets com METRIC_CATALOG interno
- Agente BI: linguagem natural → dashboard
- SQL agêntico em sandbox seguro (admin only)
- Share Link com bcrypt (links públicos protegidos por senha)

### 3.9 Cérebro de Conhecimento — RAG

**Tabelas:** `embeddings`, `documents`, `document_chunks`
**Arquivos:** `server/embeddingService.ts`

**Funcionalidades:**
- Vector embeddings OpenAI por tenant
- Tool `search_brain` disponível para todos os agentes
- Indexação automática de artefatos do Dev Center após deploy

---

## 4. Arquitetura Agêntica — MCP Hub

### 4.1 Princípio de soberania

O Arcádia Consult é o MCP Server — não chama um servidor MCP externo. Tudo roda dentro do processo Node.js. Nenhum agente depende de infraestrutura externa.

```
/mcp        → MCP Server interno (SSE + JSON-RPC)
             Uso interno: agentes chamam tools via Tool Registry
             Uso externo: parceiros software house se conectam
```

### 4.2 Tool Registry

**Arquivo:** `server/mcp/toolRegistry.ts` (a implementar)

Cada módulo registra suas tools no boot via `server/mcp/registerAllTools.ts`. O agente chama pelo nome — o registry resolve qual função executar e loga automaticamente em `audit_log`.

```typescript
interface ToolDefinition {
  name:                 string;
  description:          string;
  inputSchema:          Record<string, any>;
  module:               'control' | 'societario' | 'recovery' | ...;
  requiresConfirmation: boolean; // true = modal antes de executar
  handler:              (input, ctx: ToolContext) => Promise<any>;
}
```

**Tools planejadas por módulo:**

| Módulo | Tools |
|---|---|
| Control | `calcular_fleuriet`, `gerar_dre_gerencial`, `criar_lancamento`, `listar_obrigacoes` |
| Societário | `gerar_documento_societario`, `verificar_obrigacoes`, `listar_processos` |
| Recovery | `get_recovery_status`, `calcular_cet_cenario`, `gerar_plano_recuperacao` |
| Produção | `listar_tarefas_atrasadas`, `criar_sprint`, `criar_task` |
| Google | `google_drive_read_file`, `google_drive_create_doc`, `gmail_send`, `google_calendar_create_event` |
| Comunicação | `whatsapp_send`, `slack_send`, `email_send` |

### 4.3 OAuth2 por tenant

**Tabela:** `oauth_connections` (a criar)
**Arquivo:** `server/mcp/oauthService.ts` (a implementar)

Cada tenant autoriza sua própria conta Google. Tokens criptografados com `cryptoService`. Refresh automático. Os dados do cliente ficam na conta do cliente — nunca na conta da Arcádia.

**Provedores planejados:** Google (Drive + Gmail + Calendar + Docs), Microsoft 365, WhatsApp Business, Slack

### 4.4 Comportamento proativo — INIT_MODULE

Hook `useModuleAgent` no frontend: ao abrir qualquer módulo, envia `INIT_MODULE` para o agente. O agente executa o Step 0 do system prompt (análise proativa) e apresenta observações antes de aguardar input do consultor.

---

## 5. Modelo de Dados

**Total:** 137 tabelas em `shared/schema.ts` (4.610 linhas)

### 5.1 Famílias de tabelas

| Família | Tabelas principais |
|---|---|
| Núcleo | `users`, `sessions`, `tenants`, `tenant_users`, `partners` |
| Negócio | `clients`, `projects`, `business_canvases`, `swot_analyses`, `pdca_cycles` |
| CRM | `crm_pipelines`, `crm_stages`, `crm_deals`, `crm_activities` |
| Pessoas | `pessoas`, `pessoa_papeis`, `pessoa_contatos`, `pessoa_enderecos` |
| Societário | `sociedades`, `socios`, `pipeline_configs`, `processos_societarios`, `processo_tarefas` |
| Recovery | `recovery_processes`, `recovery_creditors`, `recovery_scenarios`, `recovery_proposals`, `recovery_installments` |
| Produção/Scrum | `internal_projects`, `subprojects`, `sprints`, `internal_tasks`, `project_files` |
| Control | `lancamentos_financeiros`, `grupos_empresariais`, `lancamentos_contabeis`, `nfes_recebidas` |
| IA & RAG | `agent_definitions`, `embeddings`, `documents`, `prompt_versions`, `tenant_ai_configs` |
| Dev Center | `ide_pipeline_runs`, `infra_servers`, `infra_services` |
| BI | `bi_dashboards`, `bi_widgets`, `bi_metrics` |
| Infra | `connectors`, `webhooks`, `audit_log` |
| MCP (novo) | `oauth_connections`, `ai_usage_logs` |

### 5.2 Convenções de schema

- IDs: `varchar PRIMARY KEY DEFAULT gen_random_uuid()`
- Tenant isolation: toda tabela de negócio tem `tenant_id NOT NULL`
- Credenciais: sempre criptografadas com `cryptoService.encrypt()` antes de persistir
- Migrations: `runStartupMigrations()` no boot (DDL idempotente: `CREATE TABLE IF NOT EXISTS`)
- Timestamps: `created_at DEFAULT NOW()` + `updated_at` onde aplicável

---

## 6. API — Endpoints principais

**Total estimado:** ~700 endpoints

| Arquivo | Count | Cobertura |
|---|---|---|
| `server/routes.ts` | 445 | Núcleo completo |
| `server/control/routes.ts` + `routesNovas.ts` | 68 | Control financeiro |
| `server/societario/routes.ts` + pipeline/* | ~83 | Societário + Pipeline |
| `server/recovery/routes.ts` + submodules | ~51 | Recovery completo |
| `server/ide/routes.ts` + `promptRoutes.ts` | 18 | Dev Center |
| `server/infra/routes.ts` | 20 | Infra (Coolify + Gitea) |
| `server/producao/routes.ts` | 27 | Scrum + Drive |

**Convenções:**
- Toda rota autenticada: `isAuthenticated` (Passport) + `tenantContext`
- Validação de payload: Zod via schemas de `shared/schema.ts`
- Mutations sensíveis: `requireTenantAdmin` middleware
- Respostas de erro: `{ message: string }` com status HTTP correto

---

## 7. Segurança

### 7.1 Proteções implementadas

| Proteção | Onde |
|---|---|
| SSRF guard | `aiConfigService.ts`, `frappeClient.ts`, `coolifyClient.ts` — resolução DNS + bloqueio de ranges privados |
| AES-256-GCM | `cryptoService.ts` — todas as credenciais (API keys, tokens OAuth2, senhas de ERP) |
| TOCTOU-safe | Pipeline Societário — `eq(status, expectedStatus)` em WHERE de mutations críticas |
| Isolation guard | `recovery/isolationGuard.ts` — validação explícita de tenant em Recovery |
| Rate limit agêntico | Pipeline Societário: 5 movimentos automáticos/hora por processo |
| Confirmação humana | `requiresConfirmation: true` nas tools MCP irreversíveis |
| Audit log | `audit_log` — toda execução de tool agêntica registrada |

### 7.2 Guardrails dos agentes

- Tools com `requiresConfirmation: true` mostram modal antes de executar
- Tokens OAuth2 nunca aparecem no contexto enviado ao LLM
- Deploy de DocTypes core do Frappe bloqueado no servidor
- Máximo 2 tentativas de auto-correção no Dev Center antes de pedir revisão humana
- Conteúdo de arquivos carregados tratado como dados (proteção contra prompt injection)

---

## 8. Integrações externas

### 8.1 Implementadas

| Sistema | Arquivo | Status |
|---|---|---|
| Frappe/ERPNext | `server/frappeClient.ts` | ✅ Produção |
| Domínio Sistemas | `server/control/connectors/dominioConnector.ts` | ✅ |
| BrasilAPI (CNPJ) | `server/control/connectors/brasilApiConnector.ts` | ✅ |
| Nuvem Fiscal (NF-e) | `server/control/connectors/nuvemFiscalConnector.ts` | 🔶 Modo simulado |
| Coolify | `server/infra/coolifyClient.ts` | ✅ |
| Gitea | `server/infra/giteaClient.ts` | ✅ |
| Anthropic Claude | `server/agentService.ts` | ✅ |
| OpenAI Embeddings | `server/embeddingService.ts` | ✅ |

### 8.2 Planejadas (Sprints futuros)

| Sistema | Sprint | Categoria |
|---|---|---|
| Open Finance (API BC) | Control S6 | bank |
| Omie, Conta Azul, Bling | Control S6 | erp |
| CNAB 240/400 | Control S6 | bank |
| Asaas, Iugu | Control S9 | gateway |
| Totvs Protheus, SAP B1 | Control S9 | erp |
| Google Workspace | MCP S3 | oauth2 |
| Microsoft 365 | MCP S4 | oauth2 |
| WhatsApp Business | MCP S4 | comm |
| eSocial, REINF | Control S7 | gov |
| Pipedrive, HubSpot | Control S7 | crm |

---

## 9. Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL (Neon) |
| `SESSION_SECRET` | ✅ | Cookie de sessão (32+ chars) |
| `ANTHROPIC_API_KEY` | ✅ | Claude — pool da plataforma |
| `OPENAI_API_KEY` | ⚠️ | Embeddings RAG (opcional, degrada sem) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ✅ | Google Cloud Storage |
| `PRIVATE_OBJECT_DIR` | ✅ | Path do bucket privado |
| `PLATFORM_ANTHROPIC_API_KEY` | Recomendada | Fallback para tenants sem config |
| `PLATFORM_GEMINI_API_KEY` | Recomendada | Fallback Gemini distribuído |
| `GOOGLE_CLIENT_ID` | MCP S1 | OAuth2 Google por tenant |
| `GOOGLE_CLIENT_SECRET` | MCP S1 | OAuth2 Google por tenant |
| `APP_URL` | MCP S1 | Callback URL do OAuth2 |
| `MCP_API_KEY` | MCP S1 | Autenticação do endpoint /mcp |
| `ALLOW_PRIVATE_AI` | Dev | Libera Ollama em localhost (padrão: bloqueado) |
| `ANTHROPIC_MODEL` | Opcional | Sobrescreve modelo padrão |
| `GITHUB_TOKEN` | Dev Center | Bridge para Gitea |
| `ISSUER_URL` / `OIDC_CLIENT_ID` | Opcional | Replit Auth (desligado em prod) |

---

## 10. Crons registrados no boot

| Cron | Frequência | Arquivo |
|---|---|---|
| Automation Engine | A cada minuto | `server/automationService.ts` |
| NF-e Monitor | A cada hora (min :05) | `server/control/nfeMonitor.ts` |
| Recovery overdue | 06:00 diário | `server/recovery/overdueCron.ts` |
| Pipeline Societário (lembretes) | 06:10 diário | `server/societario/pipeline/cron.ts` |
| Intelligence Layer nightlyJob | 02:00 diário (planejado) | `server/intelligence/nightlyJob.ts` |
| Anomaly Detector | A cada 15min (planejado) | `server/intelligence/anomalyWorker.ts` |

---

## 11. Fluxo de deploy

```bash
# Desenvolvimento
npm run dev          # Express + Vite no processo único, porta 5000

# Produção (Replit Deployments)
npm run build        # Vite build + esbuild do backend
node dist/index.cjs  # Sobe o servidor compilado

# Boot do servidor:
runStartupMigrations()  # DDL idempotente — CREATE TABLE IF NOT EXISTS
seedAgentDefinitions()  # 12 agentes globais (idempotente)
seedSuperadminIfMissing() # a@a.com.br / 123456 se tabela vazia
registerRoutes()        # Monta todos os routers
startCrons()           # Registra todos os crons
```

---

## 12. Roadmap — próximos sprints

### Em execução agora
- Control Sprint 6: Open Finance + Exportações SPED + Conectores Omie/Bling/CNAB

### Sequência planejada

| Sprint | Entrega |
|---|---|
| Control 7 | Rolling Forecast + PDD (CPC 48) + eSocial/REINF |
| Control 8 | EBITDA + Variância + Relatório executivo automático |
| Control 9 | Hub de Cobrança (Asaas/Iugu) + ERPs grandes |
| MCP S1 | MCP Server + Tool Registry + OAuth2 Google por tenant |
| MCP S2 | Tools dos módulos registradas no registry |
| MCP S3 | Google Workspace tools + comportamento proativo INIT_MODULE |
| MCP S4 | Microsoft + WhatsApp + Slack + API pública para parceiros |
| Intelligence I | Event Tracker com BullMQ+Redis (trackEvent < 1ms) |
| Intelligence II | Intelligence Store: Worker Threads + percentile_cont + Redis |
| Intelligence III | Construtor de Padrões No-Code (json-rules-engine) |
| Intelligence IV | Detecção de Anomalias a cada 15min |
| Intelligence V | Intelligence API + Forecasting + Dashboard |
| Portal Cliente | Dashboard ao vivo + Demandas + Societário + Relatórios |
| Estratégico | Planejamento Estratégico, Valuation, ERM, FP&A, Franquias |

---

## 13. Decisões arquiteturais consolidadas

| Decisão | Racional |
|---|---|
| Control NÃO emite NF-e | Emissão é do Suite (Frappe) ou ERP do cliente. Control é o cérebro, não o braço. |
| NF-e via Nuvem Fiscal API | REST moderno — sem SOAP da SEFAZ diretamente. |
| MCP Server interno, não externo | Soberania total — nenhum agente depende de infra externa. |
| OAuth2 por tenant para Google | Dados do cliente ficam na conta do cliente. |
| Fallback de IA: tenant → plataforma | Nenhum tenant fica sem agente por falta de configuração. |
| aiProviderService sem LLMFit | Já roteia Claude/Gemini/Kimi/Ollama. Terceira camada desnecessária. |
| simple-statistics para forecasting | Sem GPU, sem TensorFlow — suficiente para Ano 1. ML quando tiver dados. |
| BullMQ+Redis para trackEvent() | Fire-and-forget real < 1ms. db.insert() direto exauriria o pool sob carga. |
| percentile_cont no PostgreSQL | Cálculo de percentis nunca no Node.js — Event Loop não bloqueia. |
| Worker Threads para nightlyJob | Cálculos pesados em thread separada. Event Loop responsivo. |
| Dev Center não substitui Coolify | Abstrai a complexidade. Coolify continua como motor de infra. |
| getProductionProjects(tenantId) | Fonte única com filtro type!=compass aplicado em 8 telas. |
| PDF padrão pdf-lib layout Recovery | Consistência visual entre todos os PDFs gerados. |
| requiresConfirmation nas tools MCP | Ações irreversíveis sempre pedem aprovação humana explícita. |

---

## 14. Padrões de desenvolvimento

### 14.1 Adicionar nova rota

```typescript
// server/routes.ts ou server/<modulo>/routes.ts
router.post('/api/<recurso>', isAuthenticated, tenantContext, async (req, res) => {
  const { tenantId } = req;
  const body = insertSchema.parse(req.body); // Zod validation
  const result = await db.insert(tabela).values({ ...body, tenantId }).returning();
  res.json(result[0]);
});
```

### 14.2 Adicionar nova tabela

```typescript
// shared/schema.ts
export const novaTabela = pgTable('nova_tabela', {
  id:        varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId:  varchar('tenant_id').notNull(),
  // ... campos
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [ index('idx_nt_tenant').on(t.tenantId) ]);

// Executar: npx drizzle-kit push
// OU adicionar em runStartupMigrations() para migração idempotente
```

### 14.3 Registrar tool no MCP

```typescript
// server/mcp/registerAllTools.ts
toolRegistry.register({
  name: 'minha_tool',
  description: 'O que a tool faz (usado pelo LLM para decidir quando chamar)',
  inputSchema: { param1: { type: 'string' }, param2: { type: 'number' } },
  module: 'meu_modulo',
  requiresConfirmation: false, // true para ações irreversíveis
  handler: async ({ param1, param2 }, ctx) => {
    return meuService.executar(ctx.tenantId, param1, param2);
  },
});
```

### 14.4 Adicionar agente especializado

```typescript
// server/seedAgentDefinitions.ts — adicionar no array
{
  name: 'Nome do Agente',
  systemName: 'snake_case_name',
  systemPrompt: `
<System>
Identidade + expertise + missão
</System>
<Context>
Situação do usuário + objetivo
</Context>
<Instructions>
// STEP 0 — COMPORTAMENTO PROATIVO (ao ser ativado)
0. Análise proativa sem precisar ser chamado

1. Tarefa principal
2. Síntese e recomendações
</Instructions>
<Constraints>
- Guardrails e restrições
- Português Brasileiro
</Constraints>
<Output>
Formato esperado de resposta
</Output>
  `,
  isGlobal: true,
  tools: ['tool1', 'tool2'],
}
```

---

*Documento gerado em Abril 2026. Atualizar a cada sprint entregue.*
*Fonte de verdade técnica do Arcádia Consult — manter sincronizado com o código.*
