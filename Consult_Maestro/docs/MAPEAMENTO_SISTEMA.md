# Mapeamento Completo do Sistema - Arcadia Consulting

## Visao Geral

Plataforma de gestao de consultoria empresarial com metodologia expandida de Business Model Canvas, mapeamento de processos, PDCA integrado e avaliacao de aderencia ERP.

---

## 1. MODULOS DO SISTEMA

### 1.0 Landing Page (Nao Autenticado)
**Arquivo:** `client/src/pages/Landing.tsx`
**Descricao:** Pagina inicial para usuarios nao autenticados.
**Funcionalidades:**
- Apresentacao da plataforma
- Botao de login via Replit Auth
- Redirecionamento para autenticacao OIDC

**Fluxo de Autenticacao:**
1. Usuario acessa qualquer rota
2. `App.tsx` verifica autenticacao via `useAuth()`
3. Se nao autenticado, exibe `Landing.tsx`
4. Ao clicar em login, redireciona para `/api/login`
5. Replit OIDC processa autenticacao
6. Callback em `/api/callback` cria/atualiza usuario
7. Sessao armazenada em PostgreSQL (tabela `sessions`)
8. Usuario redirecionado para `AuthenticatedRouter`

### 1.1 Dashboard (/)
**Arquivo:** `client/src/pages/Dashboard.tsx`
**Descricao:** Painel principal com visao geral de clientes, projetos e metricas.
**Funcionalidades:**
- Contagem de clientes, projetos, tarefas
- Resumo de projetos por status
- Acesso rapido aos modulos

### 1.2 Clientes (/clientes)
**Arquivos:** 
- `client/src/pages/Clients.tsx` - Lista de clientes
- `client/src/pages/ClientForm.tsx` - Formulario de cadastro/edicao
- `client/src/pages/ClientDetail.tsx` - Detalhes do cliente

**Funcionalidades:**
- CRUD completo de clientes
- Campos: nome, email, telefone, empresa, industria, website, endereco, notas, logo
- Lista de contatos por cliente
- Organograma de colaboradores
- Vinculo com projetos

**Componentes relacionados:**
- `ClientContacts.tsx` - Gestao de contatos
- `ClientOrgChart.tsx` - Organograma

### 1.3 Projetos (/projetos)
**Arquivos:**
- `client/src/pages/Projects.tsx` - Lista de projetos
- `client/src/pages/ProjectForm.tsx` - Formulario de cadastro/edicao
- `client/src/pages/ProjectDetail.tsx` - Detalhes do projeto

**Funcionalidades:**
- CRUD completo de projetos
- Status: backlog, diagnostico, andamento, revisao, concluido
- Vinculo com cliente e gerente
- Membros da equipe do projeto
- Datas de inicio e vencimento
- Prioridade

**Componentes relacionados:**
- `ProjectTeam.tsx` - Gestao de equipe

### 1.4 Canvas BMC (/canvas)
**Arquivo:** `client/src/pages/Canvas.tsx`

**Funcionalidades:**
- 9 blocos do Business Model Canvas:
  - Proposta de Valor
  - Segmentos de Clientes
  - Canais
  - Relacionamento
  - Fontes de Receita
  - Recursos Principais
  - Atividades Chave
  - Parcerias Principais
  - Estrutura de Custos

- 4 niveis evolutivos por bloco:
  - Intencao
  - Evidencias
  - Sistemico
  - Transformacao

- Perguntas diagnosticas por bloco (tabela `canvas_block_questions`)
  - Texto da pergunta
  - Resposta em texto livre
  - Avaliacao/rating (0-10) por pergunta
  - Notas adicionais
  - Ordem de exibicao
- Insights por bloco (array JSON)
- Completude do bloco (0-100%)

### 1.5 PDCA (/pdca)
**Arquivo:** `client/src/pages/Pdca.tsx`

**Funcionalidades:**
- Ciclos PDCA vinculados ao Canvas
- Etapas: Plan, Do, Check, Act, Done
- Responsaveis e prazos
- Origem do diagnostico (bloco/pergunta)
- Notas por fase
- Graficos de maturidade (radar chart)

**Componentes relacionados:**
- `MaturityRadarChart.tsx` - Grafico radar de maturidade

### 1.6 Processos (/processos)
**Arquivos:**
- `client/src/pages/Processes.tsx` - Lista de processos
- `client/src/pages/ProcessDetail.tsx` - Editor de diagrama

**Funcionalidades:**
- Mapeamento AS-IS e TO-BE
- Categorias: operacional, estrategico, suporte
- Editor visual de fluxograma (React Flow)
- Etapas do processo com:
  - Nome, descricao, tipo (inicio, acao, decisao, fim)
  - Responsavel (colaborador)
  - Duracao e ferramentas
  - Anexos de arquivos
  - Diagnosticos (dor/oportunidade)
  - PDCA por etapa
  - Mapeamento de sistemas (ERP/CRM)

- Versionamento de diagramas
- KPIs de processo
- Recomendacoes de melhoria
- Templates de processo

**Componentes relacionados:**
- `ProcessDiagramEditor.tsx` - Editor visual

### 1.7 Aderencia ERP (/erp-aderencia)
**Arquivo:** `client/src/pages/ErpAdherence.tsx`

**Funcionalidades:**
- Requisitos de ERP por processo
- Status de aderencia:
  - Nativo (verde)
  - Configuravel (amarelo)
  - Customizavel (laranja)
  - Nao Aplicavel (cinza)

- Prioridade: alta, media, baixa
- Modulos ERP: vendas, compras, estoque, financeiro, producao, rh, contabil, fiscal, outros
- Notas de customizacao
- Esforco estimado
- Anexos por requisito
- Checklist de parametrizacao
- Gerador de relatorios

**Componentes relacionados:**
- `ErpAttachmentViewer.tsx` - Visualizador de anexos
- `ErpParameterizationChecklist.tsx` - Checklist
- `ErpReportsEditor.tsx` - Editor de relatorios

### 1.8 Tarefas (/tarefas)
**Arquivo:** `client/src/pages/Tasks.tsx`

**Funcionalidades:**
- Kanban de tarefas
- Status: todo, in_progress, review, done
- Atribuicao a usuarios ou colaboradores
- Prioridade e data de vencimento
- Vinculo com projetos

### 1.9 Relatorios (/relatorios)
**Arquivo:** `client/src/pages/Reports.tsx`

**Funcionalidades:**
- Relatorios consolidados por projeto
- Exportacao (PDF, Word, Excel)
- Visualizacao de anexos

**Componentes relacionados:**
- `ReportPreview.tsx` - Visualizador

### 1.10 Equipe (/equipe)
**Arquivo:** `client/src/pages/Usuarios.tsx`

**Funcionalidades:**
- Lista de usuarios do sistema
- Roles: admin, gerente, tecnico
- Alteracao de permissoes (admin only)
- Criacao de usuarios

### 1.11 Colaboradores (/colaboradores)
**Arquivo:** `client/src/pages/Collaborators.tsx`

**Funcionalidades:**
- Funcionarios da empresa cliente
- Hierarquia (gestor)
- Vinculo com projetos
- Permissoes: visualizar, editar

### 1.12 Organograma (/organograma)
**Arquivo:** `client/src/pages/OrgChart.tsx`

**Funcionalidades:**
- Visualizacao hierarquica dos colaboradores
- Arvore organizacional interativa

---

## 2. BANCO DE DADOS

### 2.1 Tabelas Principais

| Tabela | Descricao |
|--------|-----------|
| `users` | Usuarios do sistema (consultores) |
| `sessions` | Sessoes de autenticacao |
| `clients` | Clientes da consultoria |
| `client_contacts` | Contatos dos clientes |
| `collaborators` | Funcionarios dos clientes |
| `projects` | Projetos de consultoria |
| `project_members` | Membros da equipe (N:N users-projects) |
| `project_collaborators` | Colaboradores no projeto (N:N) |

### 2.2 Tabelas Canvas/PDCA

| Tabela | Descricao |
|--------|-----------|
| `canvas_blocks` | Blocos do Canvas BMC |
| `canvas_block_questions` | Perguntas diagnosticas |
| `canvas_pdca_items` | Itens PDCA do Canvas |

### 2.3 Tabelas Processos

| Tabela | Descricao |
|--------|-----------|
| `processes` | Processos mapeados |
| `process_steps` | Etapas dos processos |
| `process_step_files` | Anexos das etapas |
| `process_diagrams` | Diagramas visuais |
| `process_diagram_versions` | Historico de versoes |
| `process_step_diagnostics` | Diagnosticos (dor/oportunidade) |
| `process_recommendations` | Recomendacoes de melhoria |
| `process_kpis` | KPIs dos processos |
| `process_step_systems` | Mapeamento ERP/CRM |
| `process_step_pdca` | PDCA das etapas TO-BE |
| `reusable_recommendations` | Biblioteca de recomendacoes |
| `process_templates` | Templates de processo |

### 2.4 Tabelas ERP

| Tabela | Descricao |
|--------|-----------|
| `erp_requirements` | Requisitos de ERP |
| `erp_requirement_attachments` | Anexos dos requisitos |
| `erp_parameterization_topics` | Topicos de parametrizacao |
| `erp_parameterization_items` | Itens do checklist |

### 2.5 Outras Tabelas

| Tabela | Descricao |
|--------|-----------|
| `deliverables` | Entregaveis do projeto |
| `tasks` | Tarefas (Kanban) |

---

## 3. APIs REST

### 3.1 Autenticacao
```
GET  /api/auth/user          - Usuario logado
```

### 3.2 Usuarios
```
GET    /api/users            - Listar usuarios
POST   /api/users            - Criar usuario
PATCH  /api/users/:id/role   - Alterar role
```

### 3.3 Clientes
```
GET    /api/clients          - Listar clientes
GET    /api/clients/:id      - Detalhe cliente
POST   /api/clients          - Criar cliente
PATCH  /api/clients/:id      - Atualizar cliente
DELETE /api/clients/:id      - Remover cliente
```

### 3.4 Contatos
```
GET    /api/clients/:id/contacts   - Listar contatos
POST   /api/clients/:id/contacts   - Criar contato
PATCH  /api/contacts/:id           - Atualizar contato
DELETE /api/contacts/:id           - Remover contato
```

### 3.5 Colaboradores
```
GET    /api/collaborators              - Listar todos
GET    /api/clients/:id/collaborators  - Por cliente
GET    /api/collaborators/:id          - Detalhe
POST   /api/clients/:id/collaborators  - Criar
PATCH  /api/collaborators/:id          - Atualizar
DELETE /api/collaborators/:id          - Remover
```

### 3.6 Projetos
```
GET    /api/projects          - Listar projetos
GET    /api/projects/:id      - Detalhe projeto
POST   /api/projects          - Criar projeto
PATCH  /api/projects/:id      - Atualizar projeto
DELETE /api/projects/:id      - Remover projeto
```

### 3.7 Membros do Projeto
```
GET    /api/projects/:id/members            - Listar membros
POST   /api/projects/:id/members            - Adicionar membro
DELETE /api/projects/:id/members/:userId    - Remover membro
```

### 3.8 Colaboradores do Projeto
```
GET    /api/projects/:id/collaborators                  - Listar
GET    /api/projects/:id/available-collaborators        - Disponiveis
POST   /api/projects/:id/collaborators                  - Adicionar
PATCH  /api/projects/:id/collaborators/:collaboratorId  - Atualizar
DELETE /api/projects/:id/collaborators/:collaboratorId  - Remover
```

### 3.9 Canvas
```
GET    /api/projects/:id/canvas   - Listar blocos
POST   /api/projects/:id/canvas   - Criar bloco
PATCH  /api/canvas/:id            - Atualizar bloco
DELETE /api/canvas/:id            - Remover bloco
```

### 3.10 Perguntas Canvas
```
GET    /api/canvas/:id/questions     - Listar perguntas
POST   /api/canvas/:id/questions     - Criar pergunta
PATCH  /api/canvas/questions/:id     - Atualizar
DELETE /api/canvas/questions/:id     - Remover
```

### 3.11 PDCA Canvas
```
GET    /api/projects/:id/pdca   - Listar itens PDCA
POST   /api/projects/:id/pdca   - Criar item
PATCH  /api/pdca/:id            - Atualizar item
DELETE /api/pdca/:id            - Remover item
```

### 3.12 Processos
```
GET    /api/projects/:id/processes   - Listar processos
POST   /api/projects/:id/processes   - Criar processo
GET    /api/processes/:id            - Detalhe
PATCH  /api/processes/:id            - Atualizar
DELETE /api/processes/:id            - Remover
POST   /api/processes/:id/create-to-be - Criar versao TO-BE
```

### 3.13 Etapas de Processo
```
GET    /api/processes/:id/steps   - Listar etapas
POST   /api/processes/:id/steps   - Criar etapa
PATCH  /api/process-steps/:id     - Atualizar
DELETE /api/process-steps/:id     - Remover
```

### 3.14 Arquivos de Etapa
```
GET    /api/process-steps/:id/files   - Listar arquivos
POST   /api/process-steps/:id/files   - Upload arquivo
DELETE /api/process-step-files/:id    - Remover arquivo
```

### 3.15 Diagramas
```
GET    /api/processes/:id/diagram    - Obter diagrama
PUT    /api/processes/:id/diagram    - Salvar diagrama
GET    /api/processes/:id/diagram/versions  - Versoes
POST   /api/processes/:id/diagram/versions  - Salvar versao
```

### 3.16 Diagnosticos
```
GET    /api/process-steps/:id/diagnostics   - Listar
POST   /api/process-steps/:id/diagnostics   - Criar
PATCH  /api/diagnostics/:id                 - Atualizar
DELETE /api/diagnostics/:id                 - Remover
```

### 3.17 Recomendacoes
```
GET    /api/processes/:id/recommendations   - Listar
POST   /api/processes/:id/recommendations   - Criar
PATCH  /api/recommendations/:id             - Atualizar
DELETE /api/recommendations/:id             - Remover
```

### 3.18 KPIs
```
GET    /api/processes/:id/kpis   - Listar KPIs
POST   /api/processes/:id/kpis   - Criar KPI
PATCH  /api/kpis/:id             - Atualizar
DELETE /api/kpis/:id             - Remover
```

### 3.19 PDCA de Etapa
```
GET    /api/process-steps/:id/pdca   - Listar
POST   /api/process-steps/:id/pdca   - Criar
PATCH  /api/step-pdca/:id            - Atualizar
DELETE /api/step-pdca/:id            - Remover
```

### 3.20 Sistemas (ERP/CRM)
```
GET    /api/process-steps/:id/systems   - Listar
POST   /api/process-steps/:id/systems   - Criar
DELETE /api/step-systems/:id            - Remover
```

### 3.21 Requisitos ERP
```
GET    /api/projects/:id/erp-requirements       - Listar
POST   /api/projects/:id/erp-requirements       - Criar
GET    /api/erp-requirements/:id                - Detalhe
PATCH  /api/erp-requirements/:id                - Atualizar
DELETE /api/erp-requirements/:id                - Remover
```

### 3.22 Anexos ERP
```
GET    /api/erp-requirements/:id/attachments    - Listar
POST   /api/erp-requirements/:id/attachments    - Upload
GET    /api/erp-attachments/:id/view            - Visualizar
DELETE /api/erp-attachments/:id                 - Remover
```

### 3.23 Parametrizacao ERP
```
GET    /api/projects/:id/erp-topics              - Topicos
POST   /api/projects/:id/erp-topics              - Criar topico
PATCH  /api/erp-topics/:id                       - Atualizar
DELETE /api/erp-topics/:id                       - Remover
GET    /api/erp-topics/:id/items                 - Itens
POST   /api/erp-topics/:id/items                 - Criar item
PATCH  /api/erp-items/:id                        - Atualizar
DELETE /api/erp-items/:id                        - Remover
```

### 3.24 Entregaveis
```
GET    /api/projects/:id/deliverables   - Listar
POST   /api/projects/:id/deliverables   - Criar
PATCH  /api/deliverables/:id            - Atualizar
DELETE /api/deliverables/:id            - Remover
```

### 3.25 Tarefas
```
GET    /api/tasks                       - Todas tarefas
GET    /api/projects/:id/tasks          - Por projeto
POST   /api/projects/:id/tasks          - Criar
PATCH  /api/tasks/:id                   - Atualizar
DELETE /api/tasks/:id                   - Remover
```

### 3.26 Bibliotecas
```
GET    /api/reusable-recommendations    - Recomendacoes
POST   /api/reusable-recommendations    - Criar
PATCH  /api/reusable-recommendations/:id - Atualizar
DELETE /api/reusable-recommendations/:id - Remover

GET    /api/process-templates           - Templates
GET    /api/process-templates/:id       - Detalhe
POST   /api/process-templates           - Criar
PATCH  /api/process-templates/:id       - Atualizar
DELETE /api/process-templates/:id       - Remover
```

### 3.27 Storage
```
POST   /api/objects/upload              - URL de upload
GET    /objects/:path                   - Download arquivo
```

---

## 4. COMPONENTES UI

### 4.1 Componentes Base (shadcn/ui)
- accordion, alert-dialog, avatar, badge, breadcrumb, button
- calendar, card, carousel, chart, checkbox, collapsible
- command, dialog, drawer, dropdown-menu, form
- input, input-otp, label, menubar, navigation-menu
- pagination, popover, progress, radio-group, resizable
- scroll-area, select, separator, sheet, sidebar
- skeleton, slider, switch, table, tabs, textarea
- toast, toaster, toggle, toggle-group, tooltip

### 4.2 Componentes Customizados
| Componente | Descricao |
|------------|-----------|
| AppSidebar | Navegacao lateral principal |
| ThemeProvider | Gerenciador de tema claro/escuro |
| ThemeToggle | Botao de alternancia de tema |
| ClientContacts | CRUD de contatos do cliente |
| ClientOrgChart | Organograma do cliente |
| ProjectTeam | Gestao de equipe do projeto |
| ProcessDiagramEditor | Editor visual de fluxograma |
| MaturityRadarChart | Grafico radar de maturidade |
| ObjectUploader | Upload de arquivos para storage |
| ErpAttachmentViewer | Visualizador de anexos ERP |
| ErpParameterizationChecklist | Checklist de parametrizacao |
| ErpReportsEditor | Editor de relatorios ERP |
| ReportPreview | Visualizador de relatorios |

---

## 5. AUTENTICACAO ATUAL

**Sistema:** Replit Auth (OIDC)
**Arquivo:** `server/replitAuth.ts`

**Fluxo:**
1. Usuario acessa a aplicacao
2. Redirecionamento para Replit OIDC
3. Callback com token
4. Criacao/atualizacao de usuario no banco
5. Sessao armazenada em PostgreSQL

**Roles:**
- `admin` - Acesso total
- `gerente` - Gerenciamento de projetos
- `tecnico` - Acesso padrao

---

## 6. TECNOLOGIAS

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Wouter (roteamento)
- TanStack Query (estado servidor)
- React Hook Form + Zod (formularios)
- Tailwind CSS (estilizacao)
- shadcn/ui (componentes)
- React Flow (diagramas)
- Recharts (graficos)
- Lucide React (icones)

### Backend
- Node.js + Express
- Drizzle ORM
- PostgreSQL
- Passport.js (auth)
- Google Cloud Storage (arquivos)

---

## 7. ESTRUTURA DE ARQUIVOS

```
/
├── client/
│   └── src/
│       ├── pages/          # Paginas da aplicacao
│       ├── components/     # Componentes React
│       │   └── ui/         # Componentes shadcn
│       ├── hooks/          # Hooks customizados
│       └── lib/            # Utilitarios
├── server/
│   ├── index.ts            # Entrada do servidor
│   ├── routes.ts           # Rotas da API
│   ├── storage.ts          # Camada de dados
│   ├── replitAuth.ts       # Autenticacao
│   └── objectStorage.ts    # Storage de arquivos
├── shared/
│   └── schema.ts           # Modelos de dados
└── docs/
    └── MAPEAMENTO_SISTEMA.md
```

---

## 8. MODULOS A IMPLEMENTAR

### 8.1 Modulo de Ajuda (Help)
- Documentacao automatica de funcionalidades
- Tutoriais interativos
- Pesquisa de ajuda

### 8.2 Autenticacao Login/Senha
- Substituir Replit Auth
- Registro e login com senha
- Recuperacao de senha
- Gestao de usuarios

### 8.3 Modulo SWOT
- Matriz SWOT manual
- Integracao com Canvas/Processos/PDCA
- Pontuacao por item
- Dashboard e graficos
- SWOT setorial
- Mapas de melhoria
- Conversao para PDCA

### 8.4 Construtor de Relatorios
- Editor SQL seguro
- Drag-and-drop de campos
- Templates de relatorio
- Exportacao multiplos formatos

---

*Documento gerado em: Dezembro 2024*
*Versao: 1.0*
