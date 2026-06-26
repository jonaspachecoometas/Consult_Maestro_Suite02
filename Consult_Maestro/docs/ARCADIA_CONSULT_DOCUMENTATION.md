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

### 3.6.1 Dev Center — Fase 2 — Planejador de Módulo

**Tabelas:** `module_plans`, `module_plan_versions` (uniqueIndex `(plan_id, version_number)`)
**Backend:** `server/modulePlanner/planner.ts` + `server/modulePlanner/routes.ts`
**Frontend:** `client/src/pages/Planejador.tsx` em `/planejador`

**Fluxo:**
1. Consultor abre `/planejador` (somente roles admin: superadmin, partner ou tenant_admin — gate aplicado em backend via `requireTenantAdminOrPartner` e em frontend pela própria página + flag `adminOnly` no item de menu) e descreve em PT o módulo desejado ("controlar honorários por consultor").
2. Backend chama o agente Anthropic (`analyzeModule`) com o snapshot do código atual (`readConsultContext` lê `replit.md`, `shared/schema.ts`, `server/routes.ts`, etc) e exige saída JSON validada pelo contrato Zod `modulePlanContractSchema` (`summary`, `tables[]`, `endpoints[]`, `pages[]`, `agents[]`, `dependencies[]`, `similarModule`).
3. UI renderiza cada item como editor inline (TableEditor com colunas, linhas de endpoints/páginas/agentes/dependências) — usuário ajusta e salva como rascunho.
4. **Aprovar e gerar** serializa o plano em markdown via `planToRequirement()` e dispara `createRun({ target: 'consult' })` da Fase 1, abrindo a run no Dev Center.

**Versionamento:**
- A cada `analyze`/`edit`/`approve`/`revert` é criada uma `module_plan_versions` com `source` rotulado.
- Histórico exibe autor (LEFT JOIN com `users`) + diff visual (`+2 tabelas`, `-1 endpoint`, `renomeou: X`).
- Reverter restaura a versão escolhida com validação defensiva contra mudanças de contrato.

**Concorrência:**
- `approve` usa `db.transaction` com `SELECT … FOR UPDATE` para idempotência (cliques duplos retornam o mesmo `runId`). Estado intermediário `status='generated'` + `pipelineRunId IS NULL` é tratado como "in_progress" → 409 com `retry: true`.
- `analyze`/`save`/`revert` usam compare-and-set em `current_version` (UPDATE … WHERE current_version = :expected) → 409 em conflito.
- Plano em status `generated` é read-only (auditoria) — bloqueia edits e delete.

**Observabilidade:** uso de LLM logado em `ai_usage_logs` com `taskType='module_planner:analyze'`.

**Contrato REST (intencionalmente RESTful por recurso):**
| Verbo  | Path                                       | Descrição                       |
|--------|--------------------------------------------|---------------------------------|
| GET    | `/api/module-planner`                      | Lista planos do tenant          |
| GET    | `/api/module-planner/:id`                  | Detalhe + versions + run        |
| POST   | `/api/module-planner/analyze`              | Cria plano OU re-analisa (planId opcional no body) |
| POST   | `/api/module-planner/:id/save`             | Salva edição (rascunho)          |
| POST   | `/api/module-planner/:id/approve`          | Aprova e dispara pipeline        |
| POST   | `/api/module-planner/:id/revert`           | Reverte (versionId no body)      |
| DELETE | `/api/module-planner/:id`                  | Remove plano (qualquer status exceto `generated`) |

> Nota: a especificação inicial mencionava `/save` e `/approve` sem `:id`. Optou-se por colocar `:id` no path para coerência REST e para evitar dependência de `body.planId` em ações idempotentes/críticas. O frontend foi escrito alinhado a este contrato.

### 3.6.2 BI Multi-Fonte — Semantic Layer + schema `analytics`

**Objetivo:** permitir que um dashboard combine dados de **2+ conectores
heterogêneos** (ERPNext, Domínio, Excel, REST, Postgres externo) sem
duplicar SQL e sem mover dados para fora do PostgreSQL principal.

**Decisão arquitetural:**
- **Schema `analytics` no MESMO Postgres** (não há banco separado nem
  data warehouse externo). Criação via `CREATE SCHEMA IF NOT EXISTS analytics`.
- **Semantic Layer própria em TS** (Cube.js / dbt / MetricFlow proibidos).
  Métricas e dimensões são objetos tipados em `server/bi/semantic/*.ts`,
  carregados em runtime e expostos via `/api/bi/semantic/*`.

**Tabelas (`analytics.*`):**
| Tabela | Descrição |
|---|---|
| `dim_source` | Fontes habilitadas no analytics (referencia `data_sources`) |
| `dim_client` | SCD Type 2 de clientes — `valid_from/valid_to/is_current` |
| `fact_revenue` | Receita por período/fonte/cliente — UNIQUE `(tenant_id, source_data_source_id, natural_key)` |
| `etl_runs` | Histórico de execuções com `rows_in/rows_upserted` por fonte |
| `dq_findings` | Discrepâncias cross-source — `severity` (info/warning/critical) |
| `migration_state` | Snapshot do progresso de migração entre 2 fontes (matched/missing) |

Todos os índices em `tenant_id`, mais um composto `(tenant_id, period)`
em `fact_revenue` e `(tenant_id, observed_at)` em `dq_findings`.

**Convenção de mapeamento:** cada `data_source.configPublic` recebe um
campo `analyticsMapping` que diz ao ETL como ler o snapshot:

```jsonc
{
  "analyticsMapping": {
    "kind": "fact_revenue",          // ou "dim_client"
    "cursorColumn": "updated_at",    // opcional — habilita ETL incremental
    "columnMap": {
      "natural_key": "id",
      "period": "data_emissao",
      "amount": "valor_total",
      "client_natural_key": "cliente_id",
      "category": "tipo_documento",
      "status": "situacao"
    }
  }
}
```

O ETL roda 1× por fonte por chamada de `POST /api/bi/etl/run`,
suporta cursor (`since`), faz `UPSERT` idempotente em `fact_revenue` e
mantém `dim_client` com SCD2 (fecha versão anterior + insere nova quando
algum atributo muda).

**Semantic Layer — formato:**

```ts
// server/bi/semantic/control.ts
export const revenueByMonth: SemanticMetric = {
  id: "control.revenue_by_month",
  module: "control",
  label: "Receita consolidada por mês",
  description: "Soma fact_revenue agrupada por YYYY-MM, todas as fontes mapeadas.",
  defaultWidget: "line_chart",
  cacheTtlSeconds: 300,
  buildSql: (ctx) => ({
    text: `SELECT to_char(period, 'YYYY-MM') AS month, SUM(amount)::numeric AS amount
           FROM analytics.fact_revenue
           WHERE tenant_id = $1 ${ctx.sourceFilter("source_data_source_id")}
           GROUP BY 1 ORDER BY 1`,
    params: [ctx.tenantId, ...ctx.sourceParams],
  }),
};
```

**Cache:** `server/bi/cache.ts` expõe `BiCache` com `get/set/delByPrefix`.
O backend é selecionado em runtime:
- Default: `MemoryCache` (TTL + FIFO eviction, escopado ao processo).
- Se `process.env.REDIS_URL` estiver definida **e** o pacote `ioredis`
  estiver disponível, troca automaticamente para `RedisCache` (usa
  `SCAN+DEL` em `tenantId:*` para invalidação por tenant). Loga
  `[bi/cache] backend=RedisCache` no boot.
- Se `REDIS_URL` está setada mas `ioredis` não está instalado, loga
  aviso e cai para MemoryCache (degradação graciosa, sem crash).

Chave canônica: `tenantId + ':' + namespace + ':' + sha256(payload)` —
o prefixo por tenant garante isolamento mesmo num Redis compartilhado
entre instâncias. Invalidação acontece em `POST /api/bi/etl/run` e em
qualquer mudança em `data_sources` do tenant via `invalidateTenantCache`.

**Contrato REST (`/api/bi/*` — Fase 3):**
| Verbo | Path | Permissão | Descrição |
|---|---|---|---|
| GET  | `/api/bi/semantic/catalog`       | `requireTenant` | Métricas semânticas disponíveis |
| GET  | `/api/bi/semantic/dimensions`    | `requireTenant` | Dimensões reutilizáveis |
| POST | `/api/bi/semantic/run`           | `requireTenant` | Executa métrica `{metricId, sources?, filters?}` |
| POST | `/api/bi/etl/run`                | `requireTenantAdminOrPartner` | Materializa `analytics.*` |
| GET  | `/api/bi/etl/runs`               | `requireTenant` | Histórico de execuções |
| GET  | `/api/bi/migration-monitor`      | `requireTenant` | Estado SCD2 entre 2 fontes |
| GET  | `/api/bi/data-quality`           | `requireTenant` | Findings cross-source |

**`DataSourceRef` ganha variant `semantic`:**
```ts
{ type: "semantic", metricId: string, sources?: string[] }
```
Quando `sources` é vazio o Semantic Layer combina todas as fontes mapeadas
do tenant. O frontend hidrata via `useWidgetData` que faz POST para
`/api/bi/semantic/run`.

**BI Builder UI:**
- Nova aba **Multi** em `/bi-builder` com (a) lista de fontes mapeadas
  com checkbox, (b) selector de métrica semântica, (c) botão **Rodar
  ETL agora**, (d) cards para os painéis especiais.
- Tipos de widget novos: `migration_monitor` e `data_quality_panel`
  (renderizam dados próprios de `/api/bi/migration-monitor` e
  `/api/bi/data-quality`, bypassando `useWidgetData`).

**BI Agent (Fase 13) ciente do catálogo:**
O prompt de `runSqlAgent` injeta o catálogo semântico (id/módulo/label/descrição)
e instrui o LLM a preferir `analytics.fact_revenue` / `analytics.dim_client`
quando a pergunta envolver múltiplas fontes. Para perguntas operacionais
(CRM nativo, Scrum, Diagnóstico) continua consultando `public.*`.

**Tenant isolation:** Todas as tabelas analíticas têm `tenant_id NOT NULL`
e são filtradas em todas as queries via `tenantContext` middleware.
Adapter (`analyticalReader`) também filtra `data_snapshots.tenant_id`
antes de devolver linhas para o ETL.

**Fora de escopo nesta fase:**
- Cron schedule do ETL (rodada manual via UI por enquanto).
- Editor visual da Semantic Layer (definição é em código).
- Auto-geração de `analyticsMapping` via Module Planner.

### 3.6.3 Code Explorer — IDE web sobre Git interno (Fase 5)

**Objetivo:** dar ao consultor/admin uma IDE leve embutida em
`/explorador-codigo` para inspecionar e ajustar manualmente o repositório
interno gerado pelo Dev Center (Fase 1) sem precisar clonar localmente.
Toda edição é commit no `InternalGit` do tenant — sem workspace solto.

**Arquitetura backend (`server/explorer/`):**
- `fileService.ts` — helpers de filesystem isolados pelo tenant.
  Resolve paths via `safeResolve` (rejeita `..` e qualquer caminho fora do
  `repoDirForTenant`). Garante o repo via `internalGit.ensureRepo` no
  primeiro acesso.
- `search.ts` — wrapper de `ripgrep` (`spawn rg --json`) com timeout 15s,
  exclusões de blocklist, sanitização de glob (`/^[A-Za-z0-9*?./_\-]+$/`)
  e limite máximo de 500 hits por query.
- `audit.ts` — `recordAudit({tenantId,userId,action,filePath,sha,meta})`,
  best-effort (erro nunca quebra a operação principal).
- `routes.ts` — `registerExplorerRoutes(app)`.

**Endpoints (todos `tenantContext + requireTenant`):**
| Método | Rota | Gate | Descrição |
| --- | --- | --- | --- |
| GET  | `/api/explorer/tree?path` | tenantAdmin/partner/superadmin | Lista 1 nível (lazy load), dirs antes |
| GET  | `/api/explorer/file?path&ref?` | leitura | HEAD ou commit específico via `git show` |
| POST | `/api/explorer/file` | developer | Escreve + commita (`internalGit.commitFile`) |
| GET  | `/api/explorer/search?q&regex&caseSensitive&pathGlob&limit` | leitura | ripgrep no repo do tenant |
| GET  | `/api/explorer/history?path&limit` | leitura | `git log -- file` (`simple-git` raw) |
| GET  | `/api/explorer/diff?path&ref1&ref2?` | leitura | `git show ref:path` para 2 versões (ref2 default = HEAD) |
| POST | `/api/explorer/revert` | developer | Restaura conteúdo de SHA + novo commit |
| GET  | `/api/explorer/vscode-link?path?&line?` | leitura | Deep links `vscode://…` (sem `path` retorna link de clone do repo) |
| GET  | `/api/explorer/audit?limit` | leitura | Últimas N ações |
| GET  | `/api/explorer/capabilities` | leitura | `{canWrite, isSuperadmin, systemRole, maxFileBytes}` |

**RBAC:**
- **Leitura** (tree, file GET, search, history, diff, vscode-link, audit,
  capabilities): `requireTenantAdminOrPartner` —
  tenant_admin, partner ou superadmin.
- **Escrita** (file POST, revert): `requireDeveloper` — política
  least-privilege ESCOPADA AO TENANT ATIVO: somente
  `req.isSuperadmin` **ou** `req.tenantRole ∈ {admin, superadmin}`
  (admin de membership do tenant ativo, resolvido por `tenantContext`
  a partir de `tenant_users.role`). Os papéis globais
  `users.role='admin'` e `users.systemRole='tenant_admin'` **não**
  autorizam escrita — isso bloqueia escalonamento entre tenants
  quando um tenant_admin global troca de tenant via `x-tenant-id` e
  ali é apenas membro comum. **Partner NÃO tem escrita por padrão**
  (somente leitura). `/capabilities` aplica a MESMA regra (e expõe
  `tenantRole` para o frontend); a página desativa Monaco
  (`readOnly=true`) + esconde revert/save quando `canWrite=false`.

**Blocklist (defesa em profundidade — `InternalGit.safeJoin` já bloqueia
`..` e `.git/`):** match **por segmento em qualquer profundidade**, não
apenas prefixo da raiz.
- Diretórios bloqueados (qualquer nível): `.git`, `node_modules`,
  `.local`, `dist`, `build`, `.cache`, `.pnpm-store`. Logo,
  `client/node_modules/foo.js`, `apps/.local/x` e `pkg/dist/y` são
  todos rejeitados, não apenas `node_modules/foo.js`.
- Nomes de arquivo sensíveis em qualquer pasta: `.env`, `.env.local`,
  `.env.production`, `.env.development`, `.env.test`, `.npmrc`,
  `.pnpmrc`, e qualquer arquivo cujo basename case com `^\.env(\..+)?$`.
- Symlinks são ignorados em `listDir` (não exibidos, não percorridos).
- A mesma checagem (`isPathBlocked`) é aplicada em tree/read/write/
  search/history/diff/revert.

**Limites de tamanho/binário:**
- `MAX_FILE_BYTES = 1_000_000` (1 MB). Acima disso, `readFile` devolve
  preview truncado com `truncated:true` e o editor entra em readOnly.
- Detecção binária por extensão (`png/pdf/zip/wasm/woff/…`) **e** por
  sniff dos primeiros 8 KB (`looksBinary` = qualquer NUL byte).
- Edição de binário é proibida no `writeFile` (erro 400). Frontend mostra
  badge "Binário" e mensagem específica.
- `POST /file` valida `content.length ≤ 1 MB` via Zod antes de gravar.

**Auditoria — tabela `explorer_audit_log`:**
| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | varchar NOT NULL | indexado |
| `user_id` | varchar | quem realizou |
| `action` | varchar(20) NOT NULL | `tree`/`read`/`write`/`delete`/`revert`/`search`/`history`/`diff` |
| `file_path` | varchar(1000) | null em search/tree raiz |
| `sha` | varchar(80) | commit gerado em write/revert |
| `meta_json` | jsonb | query, ref, hits, durationMs… |
| `created_at` | timestamp | default `NOW()` |

Índices: `(tenant_id, created_at)` e `(tenant_id, user_id)`. DDL aplicada
em `server/index.ts → runStartupMigrations` (idempotente, `IF NOT EXISTS`).
`tree` audita apenas a raiz para não inundar a tabela com cliques de
expansão; `read` é registrado por arquivo.

**Frontend (`client/src/pages/CodeExplorer.tsx`):**
- Layout 2-painéis: árvore (esquerda, 288 px, ScrollArea) + main com 4
  tabs (Editor, Histórico, Busca, Auditoria).
- Árvore lazy: cada `TreeNode` carrega seus filhos sob demanda via
  `loadDir(path)` quando o usuário expande. Cache em `Map<path, entries>`.
- Monaco Editor (`@monaco-editor/react`) é `lazy()` + `Suspense` (~300 KB
  só carregam quando o primeiro arquivo é aberto). Tema `vs-dark`,
  `wordWrap:'on'`, `minimap:false`, `automaticLayout:true`.
- **Auto-save com debounce 2s**: `onChange` reseta um `setTimeout(2000)`;
  ao expirar, dispara `POST /file`. Estados visíveis no header:
  `idle → dirty → saving → saved` (ou `error`). Botões "Salvar agora"
  (sync, ignora debounce) e "Descartar" (volta ao `originalValue`).
- Aba Histórico: lista de commits do arquivo (até 50). "Ver" carrega o
  conteúdo histórico no editor (badge do SHA, readOnly automático).
  "Reverter" disponível apenas para `canWrite`, faz POST `/revert` e
  invalida cache. Botões **A/B** por commit + barra "Comparar A:/B:"
  no topo selecionam duas refs e renderizam um Monaco `DiffEditor`
  inline (lazy, side-by-side, read-only) chamando `/api/explorer/diff`.
- Aba Busca: input + glob opcional + checkboxes Regex/Case. Cada hit é
  clicável: troca para a aba Editor, carrega o arquivo (se não for o
  atual) e revela a linha do hit (`revealLineInCenter` + `setPosition`).
- Aba Auditoria: últimas 50 ações com badges, botão "Atualizar".
- Deep link VSCode: badge no header com `vscode://file/<path>:<line>`
  (renderizado quando há arquivo selecionado) **e** "Clonar repo no
  VSCode" sempre presente no header (`vscode://vscode.git/clone?url=…`)
  quando `EXPLORER_REMOTE_BASE_URL` estiver setado, ex.: Gitea público.
  Sem o env, nenhum link de clone aparece.

**Integração com Fase 1:**
- Reutiliza `repoDirForTenant(tenantId)` e `getInternalGitForTenant(tenantId)`
  de `server/devCenter/internalGit.ts`. Não há novo Git nem novo schema
  de filesystem. Edits manuais aparecem normalmente no `git log` e podem
  ser deployados via `deployToConsult` se o tenant tiver Coolify
  configurado.
- O frontend não requer Gitea (a Fase 1 já tornou Gitea opcional). Se
  houver Gitea cadastrado no Hub de Infraestrutura e
  `EXPLORER_REMOTE_BASE_URL` apontar para ele, o deep link de clone fica
  ativo.

**Fora de escopo nesta fase:**
- Rename / mover arquivo (apenas edit + create implícito via novo path
  não suportado pelo `commitFile`, que requer arquivo existente após
  primeiro commit — primeira escrita cria normalmente).
- Delete de arquivos (não exposto no frontend; `internalGit.deleteFile`
  existe mas o explorer não usa nesta fase).
- Code intelligence (LSP, autocomplete cross-file, "go to definition").

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

### 3.10 App Store interna — Marketplace de módulos (Fase 4)

**Tabelas:** `marketplace_apps`, `marketplace_app_versions`, `marketplace_installations`, `marketplace_reviews`, `marketplace_charges`
**Arquivos:** `server/marketplace/{packager,installer,routes,dynamicRouter,billingCron}.ts` · `client/src/pages/{AppStore,AppStoreDetail,AppStorePublish}.tsx` · `client/src/pages/superadmin/MarketplaceReview.tsx`

#### 3.10.1 Conceito (modelo Odoo + iOS)

Marketplace **interno** onde tenants publicam módulos gerados pelo **Module Planner (Fase 2)** ou **Dev Center (Fase 1)** e outros tenants instalam com 1 clique. Módulos base da Arcádia (Control, Societário, Recovery, Produção, Dev Center, BI, Cérebro, Intelligence) **são imutáveis** — só aparecem no app, não no marketplace.

#### 3.10.2 Fluxo end-to-end

```
Tenant A (owner)                 Superadmin               Tenant B (installer)
─────────────────                ───────────              ────────────────────
1. Module Planner / Dev Center → run/plan
2. POST /api/marketplace/apps   ┐
   ├ packageFromRun/Plan()      │  (draft)
   └ cria app + versão 1.0.0    ┘
3. POST /apps/:id/submit  ──────► (in_review)
                                4. GET /admin/queue
                                5. POST /apps/:id/review {action:"approve"}
                                   └ status=published, currentVersionId set
                                                                6. GET /api/marketplace/apps
                                                                7. POST /apps/:id/install
                                                                   ├ installer.ts (transação)
                                                                   ├ DDL mkt_<slug>_<table>
                                                                   ├ INSERT installation
                                                                   └ INSERT charge (per_install)
                                                                8. /api/mkt/<slug>/<resource>
                                                                   (CRUD genérico tenant-scoped)
billingCron 12h ──┐
                  └ INSERT charge mensal (idempotente UNIQUE installation+period)
9. GET /charges/report (owner vê pagamentos pendentes/pagos)
```

#### 3.10.3 Manifest (schema)

```json
{
  "tables": [{
    "name": "honorarios",
    "tenantScoped": true,
    "columns": [
      { "name": "consultor_id", "type": "varchar", "nullable": false },
      { "name": "valor_cents", "type": "integer" }
    ]
  }],
  "routes": [{ "method": "GET", "path": "/api/honorarios" }],
  "menu":   [{ "title": "Honorários", "url": "/honorarios" }],
  "permissions": ["marketplace.module.honorarios.view"],
  "dependencies": [{ "module": "control", "minVersion": "1.0" }]
}
```

- Tabelas físicas viram `mkt_<slug>_<table>` (regex `^[a-z][a-z0-9_]{0,60}$`).
- Tipos restritos a `varchar | text | integer | numeric | jsonb | timestamp | boolean | date | uuid`.
- `id varchar PK` + `tenant_id varchar NOT NULL` + `created_at`/`updated_at` automáticos; índice em `tenant_id`.
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` em updates — nunca DROP (preserva dados).

#### 3.10.4 Roteador dinâmico — `/api/mkt/:slug/:resource`

Toda installation ativa expõe CRUD genérico:

| Método | Rota | Auth | Comportamento |
|---|---|---|---|
| GET    | `/api/mkt/:slug/:resource`        | tenant member | Lista (paginação `limit`/`offset`, ORDER BY `created_at DESC`) |
| GET    | `/api/mkt/:slug/:resource/:id`    | tenant member | Detalhe |
| POST   | `/api/mkt/:slug/:resource`        | **tenantAdmin** | Insere (tenant_id forçado) |
| PATCH  | `/api/mkt/:slug/:resource/:id`    | **tenantAdmin** | Atualiza colunas declaradas |
| DELETE | `/api/mkt/:slug/:resource/:id`    | **tenantAdmin** | Remove |

Validações: slug/resource/coluna por `SAFE_IDENT`; só colunas declaradas no manifest são gravadas; `tenant_id` sempre vem do session/middleware. Acesso só se a installation está em status `installed`.

#### 3.10.5 Endpoints de gestão (`/api/marketplace/*`)

- **Catálogo (auth tenant member):** `GET apps` (com `ownerName` via JOIN), `GET apps/:slug`, `GET installed-menu` (para sidebar agregado), `GET installations`, `GET sources` (runs/plans elegíveis).
- **Owner / publicação (`requireTenantAdminOrPartner`):** `POST apps`, `POST apps/:id/versions`, `POST apps/:id/submit`, `GET my-apps`, `GET charges/report`.
- **Instalação (`requireTenantAdmin` — superadmin via guard interna):** `POST apps/:id/install`, `POST installations/:id/update`, `POST installations/:id/rollback`, `DELETE installations/:id`.
- **Revisão humana (`requireSuperadmin`):** `GET admin/queue`, `POST apps/:id/review {action:"approve"|"reject", notes?}`.
- **Avaliações (auth tenant member, mas só quem instalou):** `POST apps/:id/reviews {rating 1-5, comment?}`.

#### 3.10.6 Cobrança (placeholder Stripe)

- `marketplace_charges` (kind `install`/`monthly`, status `pending`/`paid`/`failed`/`refunded`, `period_month YYYY-MM` para mensais).
- **Per-install:** charge criado na transação do `installApp`.
- **Monthly:** `startMarketplaceMonthlyBillingCron` (boot + 12h) varre installations ativas de apps `billingModel='monthly' AND priceCents>0` e faz INSERT idempotente via `UNIQUE (installation_id, period_month)`. Real processing (Stripe etc.) consome registros `pending` — fora do MVP.

#### 3.10.7 Restrições arquiteturais

- **Tenant isolation absoluto:** toda tabela publicada tem `tenant_id NOT NULL`; o roteador dinâmico nunca aceita `tenant_id` no payload.
- **Installer transacional:** se DDL de qualquer tabela falhar, a transação reverte e a installation fica `failed` com `errorMessage` — nunca tabela parcial.
- **Materialização de arquivos:** após o commit da transação, `writeInstalledFiles()` grava `filesSnapshot` em `${MARKETPLACE_INSTALLS_BASE_PATH || .local/marketplace-installs}/<tenantId>/<slug>/<version>/<file>`. Caminhos são sanitizados (regex `[^a-zA-Z0-9._-]`) e protegidos contra path-traversal (`../` rejeitado via `path.resolve` checagem de prefixo). Falha no FS é loggada mas não derruba a install — tenant pode reinstalar idempotentemente.
- **Soft-uninstall:** `DELETE installations/:id` marca `status='uninstalled'` mas mantém as tabelas físicas (`mkt_<slug>_<table>`) e os arquivos materializados para reinstalação futura.
- **Versionamento imutável:** `marketplace_app_versions.filesSnapshot` é congelado pós-publicação — a run original pode mudar e a versão continua instalável.
- **Schema diff em updates:** `computeSchemaDiff(oldManifest, newManifest)` produz só `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Drops manuais ficam para roadmap.
- **Módulos base imutáveis:** o marketplace só hospeda módulos gerados por tenants — o core da Arcádia nunca aparece como app instalável.
- **Gate humano:** publicação exige `superadmin` aprovar cada versão.

#### 3.10.8 Páginas (frontend)

- `/app-store` — grid com busca, filtro por categoria, cards mostrando ownerName, rating, install count, preço, e botões `Instalar` / `Desinstalar` (tenant admin).
- `/app-store/:slug` — detalhe com tabs Versões / Avaliações; ações Install / Update / Rollback / Uninstall.
- `/app-store/publicar` — wizard 3 passos (origem run/plan → infos → cobrança/versão); aba "Meus Apps" com status.
- `/superadmin/marketplace` — fila de revisão com **diff-view por versão** (manifest expandido: tabelas+colunas, rotas, menu, dependências, lista de arquivos, schemaDiff vs versão anterior) antes de aprovar / rejeitar com notas.

Sidebar: "App Store" (todos), "Publicar Módulo" (tenantAdmin/partner), "Revisão Marketplace" (superadmin).

---

### 3.11 Orquestrador LLM — Cascata de Fallback (Task #47)

Camada acima do `resolveProvider` (§2.3) que escolhe **qual provider usar para cada chamada**, com fallback automático cloud→cloud→Ollama, decisão por sensibilidade de dados, e auditoria persistente.

**Componentes** (todos em `server/mcp/`):
- `providerHealthWorker.ts` — Map em memória `Map<AiProvider, HealthEntry>` com TTL 5min. Cron `startProviderHealthCron()` registrado em `server/index.ts` (junto ao `startMarketplaceMonthlyBillingCron`). Probes: Ollama via `/api/tags`; Anthropic/Gemini/Kimi via 1 chamada de ≤5 tokens. **Sem Redis/PG** por decisão arquitetural — cada réplica mantém o seu Map (esperado).
- `taskCascade.ts` — mapa `taskType → AiProvider[]` ordenado. ~12 taskTypes (`agent:*`, `bi:*`, `dev_center:*`, `societario:*`, `recovery:*`, `super_agent:*`, `embedding`, `pii_scan`). Sensibilidade `data_sensitive`/`secret` força Ollama no topo da cascata.
- `llmClient.ts` — `callChatLLM(args, {systemPrompt, userPrompt, maxTokens})` unificando os 4 providers (Anthropic SDK; Gemini/Kimi/Ollama via REST puro).
- `llmOrchestrator.ts` — `runWithOrchestration(taskType, tenantId, opts, fn)`:
  1. Resolve cascata via `taskCascade`.
  2. Filtra por health (Map em memória) e budget do tenant (consulta `ai_usage_logs`).
  3. Para cada provider, chama `resolveProvider` (que devolve apiKey/model/baseUrl) e invoca `fn(callbackArgs)`.
  4. Se sucesso → grava 1 linha em `llm_decisions` + dispara `recordAiUsage` em `ai_usage_logs`.
  5. Se erro → marca provider unhealthy no Map e tenta o próximo. Após esgotar a lista grava `outcome=all_failed` e propaga o erro.
- **Reasons**: `primary_healthy | <provider>_unhealthy | tenant_budget_low | data_sensitive | force_local | emergency_local | no_provider_available`.
- **Outcomes**: `success | fallback_used | all_failed`.

**Schema** — `shared/schema.ts` (`llmDecisions`, linhas ~1631-1664). DDL idempotente em `server/index.ts` (~L532-554). Índices: `(tenant_id, task_type)`, `(provider_used)`, `(created_at desc)`. `ai_usage_logs` permanece intacto — `llm_decisions` é a *trilha de decisão* (custo, tier, reason); `ai_usage_logs` é a *trilha de uso* (tokens por provider).

**Sites migrados** — `runAgent` em `agentService.ts` (~L338-368) chama o orquestrador no lugar de `client.messages.create` direto. `runWithOrchestration` e `callChatLLM` re-exportados de `agentService` para uso por outros módulos.

**Admin API** — `server/mcp/adminLlmRoutes.ts`, todos sob `requireSuperadmin`:
- `GET  /api/admin/llm/health` — estado em memória dos 4 providers + lista de taskTypes registrados.
- `POST /api/admin/llm/health/probe` — força probe imediato (cron normal a cada 5min).
- `GET  /api/admin/llm/decisions?days=N` — agregados (provider×outcome, taskType×tier, top reasons, últimas 50 decisões).
- `GET  /api/admin/llm/budget?tenantId=…&days=N` — tokens, calls, custo estimado, fallbacks, falhas.

**UI** — `/admin/llm-orchestrator` (`client/src/pages/superadmin/LlmOrchestrator.tsx`), 7 painéis: saúde dos providers, decisões por provider/outcome, top motivos, últimas 50 decisões, taskTypes registrados, distribuição por tier, budget por tenant. Link no sidebar superadmin (ícone `Zap`).

**Custo aproximado** — tabela `COST_PER_1K_TOKENS` em `llmOrchestrator.ts` (anthropic/gemini/kimi/ollama). Estimativa apenas — não substitui billing real do provider.

**Variáveis** — `DISABLE_LLM_HEALTH_CRON=1` desativa o cron (útil em testes).

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

**Arquivo:** `server/mcp/toolRegistry.ts` ✅ **Implementado (Sprint 1)**

Singleton `toolRegistry` com `register()`, `has()`, `get()`, `listForAgent(tenantId)`, `listForAnthropic(tenantId)` (formato Claude tool-use) e `execute(name, input, ctx)`. Tools com `requiresConfirmation:true` retornam o sentinel `ConfirmationRequired` quando `ctx.userConfirmed !== true` — caller (Sprint 2: `/mcp/tools/:name`) deve renderizar modal e re-chamar com `userConfirmed:true`. Erros do handler são capturados em `{ error: string }` para o loop tool-calling do Super Agente continuar.

Cada módulo registra suas tools no boot. **Sprint 1 entregou:** `server/mcp/registerCoreTools.ts` registra as 5 tools core (`list_projects`, `list_clients`, `get_project_detail`, `read_frappe_doc`, `search_brain`) que antes estavam hardcoded no `superAgentService.ts`. O Super Agente agora monta seu `tools[]` para o Claude via `toolRegistry.listForAnthropic(tenantId)` e executa com `toolRegistry.execute(name, input, { tenantId, userId, userConfirmed:true })`. Comportamento idêntico ao anterior — refator puro.

```typescript
interface ToolDefinition {
  name:                 string;
  description:          string;
  inputSchema:          Record<string, any>;
  module:               'core' | 'control' | 'societario' | 'recovery' | ...;
  requiresConfirmation: boolean;
  handler:              (input, ctx: ToolContext) => Promise<any>;
}
interface ToolContext {
  tenantId:       string;
  userId?:        string;
  projectId?:     string;
  userConfirmed?: boolean;
  meta?:          Record<string, unknown>;
}
```

### 4.2.1 Fallback multi-provider (Sprint 1)

**Arquivo:** `server/agentService.ts` — função `resolveProvider(tenantId, provider)` cobre Anthropic / Gemini / Kimi / Ollama. Cadeia:

1. `tenant_ai_configs` ativa para o provider + secret usável → `{ source: 'tenant', apiKey, model, baseUrl? }`
2. Pool da plataforma: `PLATFORM_<X>_API_KEY` › `AI_INTEGRATIONS_<X>_API_KEY` › `<X>_API_KEY` → `{ source: 'platform' }`
3. Sem nada utilizável → `{ unavailable: true, reason }` (mensagem amigável que orienta a configurar em "Configurações → IA & Modelos")

Compatibilidade: `resolveAnthropicForTenant()` segue exportada e funcional. Ollama continua bloqueado por SSRF se base URL for privada e `ALLOW_PRIVATE_AI != 1` (regra herdada de `aiConfigService.assertSafeBaseUrl`).

### 4.2.2 Telemetria de uso de IA (Sprint 1)

**Tabela:** `ai_usage_logs(tenant_id, user_id, provider, model, source, tokens_input, tokens_output, task_type, created_at)`
**Wrapper:** `server/mcp/usageLogger.ts → recordAiUsage()` — best-effort (nunca lança, ignora silenciosamente se `tenantId` ausente).

Pontos de coleta atuais:
- `agentService.runAgent()` — `taskType: "agent:<type>"` (planning, diagnostic, conversational, etc.)
- `superAgentService.sendMessage()` — `taskType: "super_agent"`

Sprint 4 expõe esses dados em "Configurações → IA & Modelos" (consumo do pool da plataforma vs. próprio + nudge para configurar chave própria).

### 4.2.3 Plano mestre

Documento canônico dos 4 sprints (S1+S2 entregues, S3/S4 pendentes): **`docs/MCP_HUB_PLANO_MESTRE.md`**.

### 4.2.4 Sprint 2 — Tools de domínio + endpoint /api/mcp + INIT_MODULE

**Arquivo entry-point:** `server/mcp/registerAllTools.ts` ✅ — chama `registerCoreTools()` e adiciona 4 tools de domínio (idempotente: pode ser invocado várias vezes sem duplicar).

| Tool | Módulo | Confirma? | O que faz |
|---|---|---|---|
| `calcular_fleuriet` | control | ❌ | Chama `controlService.calcularFleuriet({clienteId, ano, mes})` após validar que o cliente pertence ao tenant. |
| `analisar_pipeline_societario` | societario | ❌ | Agrega `processosSocietarios` por stage/tipo + lista vencidos (sem reusar lógica do dashboard). |
| `validar_documento_societario` | societario | ✅ | Wrapper sobre `dispatchSkill("validar_documentos_recebidos")` — OCR + grava auditoria em `processoTarefas`. |
| `simular_cenario_recovery` | recovery | ❌ | Reusa `calculateCET` + `buildScheduleFromScenario` para devolver CET + cronograma sem persistir nenhum cenário/proposta. |

**Endpoint:** `server/mcp/server.ts → registerMcpRoutes(app)` montado em `server/routes.ts` após `registerInfraRoutes`.

| Verbo | Path | Resposta |
|---|---|---|
| GET | `/api/mcp/tools` | `[{ name, description, input_schema, requiresConfirmation, module }]` (formato Anthropic). |
| POST | `/api/mcp/tools/:name` | 200 + result; **202** + `{requiresConfirmation:true, tool, message}` quando o sentinel é devolvido; 400 + `{error}` em validação Zod; 404 se a tool não existe. Body: `{input, userConfirmed?, projectId?}` ou shape plano. |

Ambas as rotas exigem `isAuthenticated` + `requireTenant`. Toda execução flui pelo registry — mesma trilha de auditoria/usage-log do Super Agente.

**INIT_MODULE proativo:**
- Hook `client/src/hooks/useModuleAgent.ts` cria/reusa **uma** sessão Super Agente global (`projectId=null`) e dispara o sentinel `__INIT_MODULE__:<module>` exatamente uma vez por `(module, sessionId)` — guard via `sessionStorage`. Expõe `{sessionId, status, error, response, run, reset}` para botões "Reanalisar".
- `superAgentService.sendMessage` reconhece `^__INIT_MODULE__(?::([\w-]+))?$`, troca o conteúdo persistido por um prompt PT-BR amigável (a string mágica nunca aparece no histórico) e injeta um **Step 0** ao system prompt obrigando uso de pelo menos uma tool real e proibindo invenção de números.
- Banner UI: `client/src/components/agent/ModuleAgentBanner.tsx` — card colapsável com botão "Reanalisar", wired em `Control.tsx`, `Societario.tsx` e `Recovery.tsx` logo abaixo do header.

**Tools planejadas por módulo (S2–S4):**

| Módulo | Tools |
|---|---|
| Control | `calcular_fleuriet`, `gerar_dre_gerencial`, `criar_lancamento`, `listar_obrigacoes` |
| Societário | `gerar_documento_societario`, `verificar_obrigacoes`, `listar_processos` |
| Recovery | `get_recovery_status`, `calcular_cet_cenario`, `gerar_plano_recuperacao` |
| Produção | `listar_tarefas_atrasadas`, `criar_sprint`, `criar_task` |
| Google | `google_drive_read_file`, `google_drive_create_doc`, `gmail_send`, `google_calendar_create_event` |
| Comunicação | `whatsapp_send`, `slack_send`, `email_send` |

### 4.3 OAuth2 por tenant — Google Workspace ✅ Sprint 3

**Tabelas:** `oauth_connections` (Sprint 1, tokens por tenant) + `platform_oauth_apps` (Sprint 3, credenciais do app por provider).
**Arquivos:** `server/mcp/oauthService.ts` + `server/mcp/oauthRoutes.ts`.

**Desvio aprovado pelo usuário em Sprint 3:** as credenciais do app OAuth (Client ID + Secret) **não vivem em variáveis de ambiente**. O superadmin cola na UI (`/configuracoes/integracoes`) no momento do deploy e elas ficam criptografadas em `platform_oauth_apps.clientIdEnc` e `clientSecretEnc` via `cryptoService.encryptConfig()`. As env vars `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` continuam aceitas como fallback, mas o DB sempre tem precedência. Motivação: deploys self-hosted por parceiros podem trocar credenciais sem rebuild.

**Fluxo:**
1. Superadmin acessa `/configuracoes/integracoes` → card "Configuração do app OAuth Google (plataforma)" → cola Client ID + Secret. O sistema mostra exatamente qual `redirect_uri` precisa ser cadastrada no Google Cloud Console.
2. Tenant admin acessa a mesma tela → card "Google Workspace" → clica em "Conectar Google" → popup OAuth com state HMAC-SHA256 assinado por `SESSION_SECRET` (contém `tenantId`+`userId`+`nonce`+`exp`).
3. Callback `/api/oauth/google/callback`: valida state, troca `code` por tokens, chama `oauth2.userinfo` para obter o email, criptografa `accessToken`+`refreshToken` e faz upsert em `oauth_connections` (unique `(tenant_id, provider)`).
4. Cada chamada de tool Google passa por `getValidAccessToken(tenantId)` — se faltarem ≤60s para expirar, faz refresh automático e regrava o token criptografado.

**Escopos mínimos:** `openid`, `email`, `profile`, `drive.file` (só arquivos criados/abertos pelo app), `gmail.send` (envio apenas, sem leitura), `calendar.events`, `documents`.

**Princípios de segurança aplicados:**
- Tokens **nunca** aparecem em logs, respostas HTTP ou prompts de LLM. A resposta de `/api/oauth/connections` devolve só `{provider, connected, accountEmail, scopes, expiresAt}`.
- Credenciais da plataforma também nunca aparecem decifradas; o GET `/api/oauth/platform/google` devolve `clientIdMasked` (formato `••••<últimos 6 chars>`).
- State é assinado e validado com expiração de 10 minutos para impedir CSRF.
- Os dados do cliente ficam na conta Google do cliente — nunca na conta da Arcádia.

**Tools entregues (módulo `google`):**
| Tool | Tipo | Confirmação |
|------|------|-------------|
| `google_drive_list_files` | read | ❌ |
| `google_drive_read_file` | read (export Docs→txt, Sheets→csv, trunca em 200KB) | ❌ |
| `google_drive_create_file` | write | ✅ |
| `gmail_send` | external (RFC 2047 nos headers para PT-BR) | ✅ |
| `google_calendar_create_event` | external (`sendUpdates: all` quando há convidados) | ✅ |
| `google_docs_create` | write | ✅ |

**Provedores planejados (Sprint 4):** Microsoft 365 (OneDrive, Outlook, Teams), WhatsApp Business, Slack — reusam a mesma estrutura `platform_oauth_apps` + `oauth_connections`.

### 4.4 Microsoft 365 + WhatsApp Business + endpoint público ✅ Sprint 4

**Microsoft 365 OAuth2** — `oauthService.ts` ganhou `resolveMicrosoftAppConfig` (DB → env fallback `MICROSOFT_OAUTH_CLIENT_ID/_SECRET/_TENANT_ID`, default `common`), `getMicrosoftAuthUrl/handleMicrosoftCallback/getValidMicrosoftAccessToken` (refresh via `offline_access`). Persistência reusa `oauth_connections` com `provider='microsoft'`. Rotas `GET/PUT/DELETE /api/oauth/platform/microsoft` (superadmin), `GET /api/oauth/microsoft/connect+callback`, `POST /api/oauth/microsoft/disconnect`. Helper `callGraph` chama Microsoft Graph v1.0.

| Tool | Tipo | Confirmação |
|---|---|---|
| `onedrive_list_files` | read | ❌ |
| `onedrive_read_file` | read (200KB) | ❌ |
| `onedrive_write_file` | write (path ou folderId+name; utf-8 ou base64) | ✅ |
| `outlook_send_email` | external | ✅ |
| `teams_send_message` | external (chat ou channel) | ✅ |

**WhatsApp Business (Meta Cloud API)** — sem OAuth, config manual via UI: `setWhatsappConnection({accessToken, phoneNumberId, businessAccountId, displayName})` encripta token em `accessTokenEnc` e persiste IDs em `metadata` jsonb. Rotas `GET/PUT/DELETE /api/oauth/whatsapp` (admin do tenant). Helper `callMeta` chama Facebook Graph v20.0.

| Tool | Tipo | Confirmação |
|---|---|---|
| `whatsapp_send_text` | external | ✅ |
| `whatsapp_send_template` | external (template aprovado pela Meta) | ✅ |

**`partner_api_keys` + endpoint público `/mcp/v1`:**
- Tabela `partner_api_keys` (id, tenantId, name, `keyHash` único, `keyPrefix` 12-char, `scopes:text[]`, `rateLimit`, `lastUsedAt`, `revokedAt`). Plain key **só existe no momento da criação** — formato `arc_<base64url-32B>` (256 bits de entropia).
- `apiKeyService.ts`: `generateApiKey/hashApiKey/isValidKeyFormat`. Hash usa **HMAC-SHA-256** com pepper `SESSION_SECRET` (defesa em profundidade contra dump da DB; lookup deterministico O(1) por hash). CRUD em `/api/api-keys` retorna `plainKey` 1× na criação.
- `publicRouter.ts` montado **fora do `tenantContext`** em `/mcp/v1`. Auth via header `X-MCP-Key` → HMAC-SHA-256 → lookup → hidrata `req.tenantId/scopes`. Rate limit em memória 60req/min default (configurável por key), headers `X-RateLimit-Limit/Remaining/Reset`, 429 ao estourar, GC periódico do bucket. Escopos por módulo (`core`, `control`, `societario`, `recovery`, `google`, `microsoft`, `whatsapp`, ou `*`). Mantém sentinel 202 `{requiresConfirmation:true}` para tools com confirmação. Tool inexistente E out-of-scope colapsam em `403 tool_not_available` para evitar enumeração.
- Endpoints: `GET /mcp/v1/health`, `GET /mcp/v1/tools` (filtra por scope), `POST /mcp/v1/tools/:name`. **Toda execução loga em `ai_usage_logs(source='partner_api', provider='mcp_public', model=<tool name>)`** com `taskType='<outcome>:<duration>ms'` (`ok`, `confirmation_required`, `error`, `scope_denied`, `bad_input`). Coluna `source` foi alargada para `varchar(20)` via migração idempotente.
- **Swagger** em `/api-docs` (UI) e `/api-docs.json` (spec OpenAPI 3) — generado por `swaggerSpec.ts` (swagger-jsdoc + swagger-ui-express).

**Dashboard `Configurações → IA & Modelos`:** `GET /api/ia/usage?days=30` agrega `ai_usage_logs` por dia/provider/source, totais current vs previous + variação %, e `platformPool` (mês corrente vs `PLATFORM_AI_TOKENS_MONTHLY_QUOTA`, default 1M) com flag `nudge` quando ≥80%. Front em `IaUso.tsx` (3 cards KPI, BarChart empilhado por provider via recharts, banner âmbar de nudge).

**UI Sprint 4:** `Integracoes.tsx` com cards Google + Microsoft + WhatsApp (componentes `PlatformOAuthCard`, `ProviderConnectionCard`, `WhatsappCard`). Páginas novas `/configuracoes/api-keys` (lista, gerar com modal de plain key 1×, revogar) e `/configuracoes/ia`. Sidebar admin lista os 3 sub-itens (Integrações, API Keys, IA — Uso).

### 4.5 Comportamento proativo — INIT_MODULE

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
