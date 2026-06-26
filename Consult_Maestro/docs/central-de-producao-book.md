# Central de Produção — Book de Estado Atual

> Plataforma Arcádia Consulting · Módulo de gestão e execução de projetos
> Versão do documento: 24/04/2026
> Produção: `consult.arcadiabusiness.com.br`

---

## 1. Visão Geral

A **Central de Produção** é o módulo operacional da plataforma Arcádia. Substitui o antigo "Diagnóstico" como página de detalhe do projeto e centraliza, em uma única tela, **toda a execução** de um projeto cliente — do planejamento estratégico (subprojetos, sprints, backlog) à entrega (tarefas, arquivos, calendário) passando por inteligência artificial (Agente Scrum, Super Agente).

### Filosofia

| Princípio | O que significa |
|---|---|
| **Um projeto, uma página** | `/projetos/:id` reúne 13 abas. Não há mais "ir pro Scrum global pra ver as sprints deste projeto". |
| **Hierarquia clara** | Projeto → Subprojeto → Sprint → PBI/Tarefa. Cada nível é opcional, então projetos pequenos não pagam o custo de complexidade. |
| **IA como copiloto** | Agente Scrum gera estrutura completa a partir de PDF. Super Agente conversa com contexto do projeto. Agente por tarefa apoia execução. |
| **Multi-tenant rigoroso** | Toda rota Scrum/Produção valida `tenant_id` via `projectBelongsToTenant` + helpers de cross-tenant linking. |

---

## 2. Linha do Tempo das Entregas

| Bloco | Status | Conteúdo |
|---|---|---|
| **Fundação Scrum (legado)** | ✅ Estável | `scrum_internal_projects`, `scrum_sprints`, `scrum_backlog_items`, `scrum_teams`, `scrum_timesheets`, `scrum_rework`, `scrum_backlog_attachments` |
| **Evolução F1–F11 (6 entregas)** | ✅ Entregue | Subprojetos · Drive · Arquivos por task · Agente Scrum (2 modos) · Calendário · Dashboards |
| **Bug fix Agente → PBIs reais** | ✅ Validado 2x | LLM agora gera `pbis[]` com tipo/prioridade/storyPoints, não mais `tasks[]` placeholder |
| **Visão Unificada do Projeto** | ✅ Entregue | 3 novas abas (Backlog/Sprints/Squads) dentro de `ProjectDetail.tsx` |
| **Hardening Multi-Tenant** | ✅ Code review PASS | Helpers `assertScrumInternalProjectTenantAccess` + `assertScrumSprintTenantAccess` aplicados em sprints + backlog |

---

## 3. Arquitetura

### 3.1 Stack

```
Frontend  ─ React 18 + TypeScript + Vite
            wouter (rotas) · TanStack Query · React Hook Form + Zod
            shadcn/ui (Radix) · Tailwind · Lucide

Backend   ─ Node.js + Express
            Drizzle ORM · PostgreSQL · Object Storage
            Multi-provider LLM (Anthropic/Gemini/Kimi/Ollama)
            OpenAI embeddings · pdf-parse/mammoth/xlsx

Auth      ─ OIDC (SSO) + email/senha · sessões PG · RBAC
            tenantContext middleware injeta req.tenantId/tenantRole
```

### 3.2 Hierarquia de dados

```
Tenant
  └── Cliente
        └── Projeto (projects)                      ← /projetos/:id
              ├── Subprojeto (subprojects)          [opcional, retrocompatível]
              │     ├── Sprint (scrum_sprints)
              │     │     └── PBI (scrum_backlog_items)
              │     │           └── Tarefa (tasks)
              │     │                 └── Arquivo (project_files)
              │     │                 └── Sessão Agente (task_agent_sessions)
              │     └── Tarefa (direto)
              ├── Arquivo (project_files)           [Drive do projeto]
              ├── Evento (project_calendar_events)  [Calendário]
              └── scrum_internal_project (1:1, idempotente)
                    └── espelho técnico do projeto cliente para
                       dados Scrum tenant-wide
```

> **Importante:** `subproject_id` é **nullable** em `tasks`, `scrum_sprints` e `scrum_backlog_items` — projetos antigos continuam funcionando sem subprojetos.

### 3.3 Modelo de dados (tabelas-chave)

| Tabela | Multi-tenant | Função |
|---|---|---|
| `projects` | `tenant_id` | Projeto cliente — fonte da verdade de tenant |
| `subprojects` | `tenant_id` | Agrupador opcional (cor, datas, status) |
| `scrum_internal_projects` | `tenant_id` + `client_project_id` | Espelho técnico do projeto cliente |
| `scrum_sprints` | via internal_project | Ciclo iterativo (start/end, status) |
| `scrum_backlog_items` (PBI) | `tenant_id` | Item de backlog (tipo, prioridade, story points, AC) |
| `tasks` | `tenant_id` (via project) | Atividade executável (≠ PBI) |
| `project_files` | `tenant_id` + `project_id` | Drive — extrai texto até 50k chars |
| `project_calendar_events` | `tenant_id` + `project_id` | Eventos coloridos por tipo |
| `task_agent_sessions` | `tenant_id` + `task_id` | Conversa do Agente por tarefa |
| `scrum_teams` / `scrum_team_members` | `tenant_id` | Squads (compartilhados entre projetos) |
| `scrum_timesheets` | `tenant_id` | Apontamentos de tempo por PBI |

---

## 4. UI — As 13 Abas do Projeto

`/projetos/:id` (arquivo: `client/src/pages/ProjectDetail.tsx`)

### 4.1 Abas de Produção (componentes em `client/src/components/producao/`)

| # | Aba | Componente | O que faz |
|---|---|---|---|
| 1 | **Dashboard** | `ProjectDashboard.tsx` | KPIs (tarefas totais/concluídas/em andamento/atrasadas), progresso por subprojeto, próximos 7 dias, arquivos recentes |
| 2 | **Subprojetos** | `SubprojectsTab.tsx` | Hierarquia expansível Subprojeto → Sprint → PBI com badges |
| 3 | **Backlog** | `ProjectBacklog.tsx` | Kanban dos PBIs por status, troca rápida via PATCH |
| 4 | **Sprints** | `ProjectSprints.tsx` | Lista com rollup (PBIs · pontos · % concluído), criar nova sprint |
| 5 | **Squads** | `ProjectSquads.tsx` | Squads do tenant (read-only com link para gestão global) |
| 6 | **Tarefas** | (inline) | Lista com botão "Agente" → abre `TaskAgentChat` |
| 7 | **Drive** | `ProjectDrive.tsx` | Upload, busca por nome+conteúdo, filtro por categoria, "Analisar com Agente" |
| 8 | **Calendário** | `ProjectCalendar.tsx` | Grade mensal CSS, tipos coloridos (reunião, marco, entrega, tarefa, bloqueio) |

### 4.2 Abas legadas (preservadas)

| # | Aba | Função |
|---|---|---|
| 9 | Visão Geral | Dados gerais, status, datas |
| 10 | História | Editor TipTap rich-text (documentação narrativa) |
| 11 | Equipe | Membros do projeto |
| 12 | Canvas | BMC expandido (4 níveis evolutivos) |
| 13 | Processos · Arquivos legado · Super Agente | Funcionalidades originais |

### 4.3 Páginas globais relacionadas

| Página | Rota | Função |
|---|---|---|
| `Scrum.tsx` | `/producao` | Visão Production tenant-wide (projetos, sprints, backlog cross-projeto) |
| `ScrumProjects.tsx` | `/producao/projetos` | Lista de projetos internos com link "Abrir Dashboard" → `/projetos/:clientProjectId` |
| `ScrumSprints.tsx` | `/producao/sprints` | Sprints tenant-wide |
| `ScrumBacklog.tsx` | `/producao/backlog` | Backlog tenant-wide |
| `ScrumSquads.tsx` | `/producao/squads` | Gestão de squads |
| `ScrumTimesheet.tsx` | `/producao/timesheets` | Apontamentos |
| `ScrumReports.tsx` | `/producao/relatorios` | Relatórios |

---

## 5. API — Endpoints Mapeados

### 5.1 Subprojetos
```
GET    /api/projects/:id/subprojects
POST   /api/projects/:id/subprojects
PATCH  /api/projects/:id/subprojects/:sid
DELETE /api/projects/:id/subprojects/:sid
```

### 5.2 Drive (arquivos por projeto e por tarefa)
```
GET    /api/projects/:id/drive                  ?categoria=&search=
GET    /api/projects/:id/drive/:fid
GET    /api/projects/:id/drive/:fid/download
POST   /api/projects/:id/drive                  multipart, extrai texto
PATCH  /api/projects/:id/drive/:fid
DELETE /api/projects/:id/drive/:fid

GET    /api/tasks/:id/files
POST   /api/tasks/:id/files                     multipart, vincula taskId
```
> Persistência binária em **Object Storage** (`.private/produccao-files/{projectId}/`).
> Texto extraído (PDF/DOCX/XLSX) cacheado em `project_files.extracted_text` até 50k chars.

### 5.3 Calendário
```
GET    /api/projects/:id/calendar               ?ano=&mes=
POST   /api/projects/:id/calendar
PATCH  /api/projects/:id/calendar/:eid
DELETE /api/projects/:id/calendar/:eid
```

### 5.4 Agente Scrum — 2 modos
```
# Modo 1: análise de documento → estrutura Scrum completa
POST /api/projects/:id/drive/:fid/analyze       LLM lê extracted_text e devolve plano
POST /api/projects/:id/drive/:fid/apply-plan    Cria subprojetos + sprints + PBIs + eventos em transação

# Modo 2: chat assistente dentro de uma tarefa
GET  /api/tasks/:id/agent/sessions
POST /api/tasks/:id/agent/sessions
GET  /api/tasks/:id/agent/sessions/:sid/messages
POST /api/tasks/:id/agent/sessions/:sid/messages
```
> O Modo 1 cria **PBIs reais** (`scrum_backlog_items`) — não tasks placeholder.
> Prompt enforça mín. 3 PBIs por sprint, story points Fibonacci, enums válidos.
> Multi-provider via `resolveAnthropicForTenant`.

### 5.5 Visão unificada do projeto
```
GET  /api/projects/:id/scrum-context           Retorna internalProjectId (ou null)
POST /api/projects/:id/scrum-context/ensure    Idempotente, race-safe via PG 23505 + re-select
GET  /api/projects/:id/sprints                 Sprints deste projeto
GET  /api/projects/:id/pbis                    ?subprojectId=&sprintId=
```

### 5.6 Endpoints Scrum globais (preservados)
```
/api/scrum/teams           CRUD (admin)
/api/scrum/sprints         CRUD (com guards de tenant)
/api/scrum/backlog         CRUD (com guards de tenant)
/api/scrum/backlog/:pbiId/attachments
/api/scrum/timesheets      CRUD
```

---

## 6. Agente Scrum — Fluxo Detalhado

### Modo 1: Análise de PDF/DOCX → Estrutura Scrum

```
┌──────────────┐    1. Upload          ┌──────────────┐
│ Drive (UI)   │ ────────────────────► │ Object Stor. │
└──────────────┘                       └──────────────┘
       │                                      │
       │ 2. extract_text                      │
       ▼                                      ▼
┌──────────────┐    3. Analisar        ┌──────────────┐
│ Botão        │ ────────────────────► │ /analyze     │
│ "Agente"     │                       │ → LLM        │
└──────────────┘ ◄──────────────────── │ JSON plano   │
       │           4. Resumo            └──────────────┘
       │
       │ 5. Aprovar
       ▼
┌──────────────┐    6. apply-plan      ┌──────────────┐
│ Modal        │ ────────────────────► │ Transação    │
│ Confirmação  │                       │ subprojects  │
└──────────────┘                       │ + sprints    │
                                       │ + PBIs       │
                                       │ + eventos    │
                                       └──────────────┘
```

**Garantias do prompt:**
- Mínimo 3 PBIs por sprint
- Story points em Fibonacci (1, 2, 3, 5, 8, 13)
- Tipo: `feature | bug | improvement | task | support | analysis | documentation | training | meeting`
- Reuniões de sprint (planning, daily, review, retro) viram `project_calendar_events`
- Auto-instancia/reaproveita `scrum_internal_project` vinculado ao `clientProjectId`

### Modo 2: Chat assistente por tarefa

- Chat persistido em `task_agent_sessions` + `super_agent_messages.task_session_id`
- Contexto auto-injetado: dados da tarefa, projeto, cliente, arquivos vinculados
- Tool-calling habilitado (mesmo arsenal do Super Agente)

---

## 7. Segurança Multi-Tenant

### 7.1 Camadas de proteção

```
1. isAuthenticated         Verifica sessão
2. tenantContext           Injeta req.tenantId, req.tenantRole, req.isSuperadmin
3. requireTenant           Bloqueia rota se sem tenant
4. projectBelongsToTenant  Valida projeto antes de operação
5. assertScrum*Access      Cross-tenant linking guards (NOVOS)
```

### 7.2 Helpers anti-cross-tenant (após code review)

| Helper | Onde | O que valida |
|---|---|---|
| `assertScrumInternalProjectTenantAccess` | `server/routes.ts:154` | `internalProjectId → clientProjectId → projects.tenant_id == req.tenantId` |
| `assertScrumSprintTenantAccess` | `server/routes.ts:179` | `sprintId → internalProjectId → ...` (delegação) |
| `projectBelongsToTenant` | `server/routes.ts` | Toda rota `/api/projects/:id/*` |
| `subprojectBelongsToProject` | idem | Toda rota `/subprojects/:sid` |
| `taskBelongsToTenant` | idem | Toda rota `/api/tasks/:id/*` |

### 7.3 Pontos de aplicação (atualizado)

| Endpoint | Guard |
|---|---|
| `POST /api/scrum/sprints` | `assertScrumInternalProjectTenantAccess` |
| `PATCH /api/scrum/sprints/:id` | sprint atual + novo `internalProjectId` |
| `DELETE /api/scrum/sprints/:id` | sprint + role (admin/gerente/superadmin) |
| `POST /api/scrum/backlog` | sprint + internalProject |
| `PATCH /api/scrum/backlog/:id` | item atual + novo sprint/internalProject |
| Todas rotas Produção | `[isAuthenticated, tenantContext, requireTenant]` + `projectBelongsToTenant` |

### 7.4 Code Review Final
✅ **PASS** com 2 achados LOW pré-existentes fora do escopo (timesheets diretos e POST direto a `scrum_internal_projects`).

---

## 8. Estado Atual (snapshot 24/04/2026)

| Métrica | Valor |
|---|---|
| App rodando | ✅ porta 5000 |
| Erros no startup | 0 |
| Tabelas Produção no DB | 12 |
| Componentes em `client/src/components/producao/` | 9 |
| Endpoints registrados em `server/producao/routes.ts` | 27 |
| Endpoints Scrum globais em `server/routes.ts` | 24 |
| Registros de teste no DB | 5 internal_projects · 2 sprints · 5 PBIs · 1 squad · 2 arquivos · 1 evento |

---

## 9. Roadmap Próximo

### Curto prazo (sugestões)
- **Hardening LOW** restante: aplicar guards em `POST/PATCH /api/scrum/timesheets` (validar PBI cross-tenant)
- **Drag-and-drop de PBIs entre sprints** no `ProjectBacklog`
- **Burndown chart** dentro de `ProjectSprints` (consumindo `scrum_timesheets`)
- **Anexos no PBI** já têm tabela (`scrum_backlog_attachments`) — falta UI

### Médio prazo (estratégico)
- **Squads escopadas a projeto** (hoje são tenant-wide) — exigiria coluna em `scrum_teams` ou tabela join `project_teams`
- **Notificações** de PBIs atrasadas, sprints fechando
- **Templates de projeto** (subprojetos + sprints pré-configurados por tipo de consultoria)
- **Integração com Demandas Kanban** para puxar demandas externas como PBIs

### Pendente (paralelo)
- Retomar **Arcádia Control Sprint 2** (Agente Controller) — pausado durante esta evolução

---

## 10. Documentos de Referência

- `replit.md` — bullets "Central de Produção — Visão Unificada do Projeto" e "Central de Produção — Evolução"
- `attached_assets/arcadia-producao-evolucao_1777024683014.docx` — especificação original das 6 entregas
- `arcadia-control.docx` — roadmap do módulo paralelo Arcádia Control

---

*Fim do documento.*
