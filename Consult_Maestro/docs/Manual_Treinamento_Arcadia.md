# Manual de Treinamento — Arcádia Consulting

**Plataforma de Diagnóstico, Gestão e Inteligência Consultiva**

Versão do documento: 1.0 — Maio/2026
Público-alvo: Usuários finais (consultores, gestores, analistas, clientes finais)
Abordagem: Pensada como roteiro de QA Trainer — cada módulo traz **objetivo**, **regras de negócio**, **passo a passo**, **validações esperadas**, **cenários de teste** e **casos de borda**.

---

## Sumário

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Conceitos Fundamentais](#2-conceitos-fundamentais)
3. [Hierarquia de Acesso e Papéis](#3-hierarquia-de-acesso-e-papéis)
4. [Primeiro Acesso e Onboarding](#4-primeiro-acesso-e-onboarding)
5. [Módulo: CRM 2.0 — Pessoas e Pipeline](#5-módulo-crm-20)
6. [Módulo: Projetos e Demandas](#6-módulo-projetos-e-demandas)
7. [Módulo: Central de Produção (Scrum/PCP)](#7-módulo-central-de-produção)
8. [Módulo: Diagnóstico (Canvas, SWOT, Processos, PDCA)](#8-módulo-diagnóstico)
9. [Módulo: Societário](#9-módulo-societário)
10. [Módulo: Recovery (Recuperação de Empresas)](#10-módulo-recovery)
11. [Módulo: Arcádia Control (Financeiro/Controller)](#11-módulo-arcádia-control)
12. [Módulo: Inteligência e Agentes (Super Agente)](#12-módulo-inteligência-e-agentes)
13. [Módulo: Suporte e Portal do Cliente](#13-módulo-suporte-e-portal)
14. [Módulo: Administração (Superadmin / Partner / Tenant Admin)](#14-módulo-administração)
15. [Módulo: Dev Center e App Store Interna](#15-módulo-dev-center)
16. [Regras Transversais (Multi-tenant, Permissões, Auditoria)](#16-regras-transversais)
17. [Roteiro de Treinamento Sugerido](#17-roteiro-de-treinamento-sugerido)
18. [Glossário](#18-glossário)

---

## 1. Visão Geral do Sistema

A **Plataforma Arcádia** é uma solução fullstack multi-tenant para consultorias e seus clientes. Centraliza o ciclo completo de uma consultoria estratégica: prospecção (CRM) → diagnóstico → execução de projetos → controle financeiro → recuperação de empresas → governança societária — tudo apoiado por **agentes de IA especializados** e uma **base de conhecimento (RAG)** isolada por cliente.

**Arquitetura em três camadas de tenancy:**
- **Superadmin (Arcádia HQ)**: opera a plataforma como produto.
- **Partner (Retaguarda)**: consultoria que usa a plataforma para atender seus clientes.
- **Tenant (Cliente final)**: empresa atendida pela consultoria.

**Principais diferenciais:**
- Diagnóstico baseado no método Arcádia/O METAS com 4 níveis de maturidade.
- IA contextual em cada módulo (chat lateral, agentes especializados).
- Multi-tenant com isolamento estrito de dados por `tenant_id`.
- Controlador financeiro completo (DRE, fluxo de caixa, orçamento, conciliação).

---

## 2. Conceitos Fundamentais

| Conceito | Definição |
|---|---|
| **Tenant** | Empresa-cliente isolada (uma base de dados lógica). Toda informação de negócio carrega `tenant_id`. |
| **Partner** | Consultoria que tem múltiplos tenants sob sua gestão. |
| **Pessoa** | Cadastro unificado de PF/PJ usado em todos os módulos (cliente, fornecedor, sócio, credor). |
| **Projeto** | Container de trabalho consultivo. Pode ser tipo **Bússola** (diagnóstico) ou **Externo** (execução). |
| **Demanda** | Necessidade levantada num diagnóstico que vira backlog na Produção. |
| **Sprint** | Ciclo de execução curto (Scrum) com tarefas, squad e métricas. |
| **Canvas BMC Expandido** | Mapa estratégico de 9 blocos com perguntas e níveis de maturidade. |
| **PDCA** | Ciclo Plan-Do-Check-Act ligado a cada bloco do Canvas. |
| **Agente** | LLM com prompt especializado em 5 camadas (System/Context/Instructions/Tools/Output). |
| **Lançamento** | Movimentação financeira (CR ou CP) no Arcádia Control. |
| **Centro de Custo (CC)** | Categoria analítica que permite alocação parcial de um lançamento. |

---

## 3. Hierarquia de Acesso e Papéis

A plataforma combina **`systemRole`** (escopo de tenancy) com **`role`** (escopo funcional dentro do tenant):

### 3.1 systemRole (vertical)

| systemRole | O que vê | Painel inicial |
|---|---|---|
| `superadmin` | Tudo (todos partners, tenants, métricas globais, orquestrador LLM) | `/superadmin` |
| `partner` | Seus tenants, novos provisionamentos, retaguarda | `/partner` |
| `tenant_admin` | Sua empresa + filiais (sub-tenants), equipe, permissões | `/minha-empresa` |
| `user` | Apenas o tenant ativo, com módulos filtrados por permissão | `/` |

### 3.2 role (horizontal, dentro do tenant)

| role | Privilégios típicos |
|---|---|
| `admin` | Configurações, integrações, API keys, IA, equipe |
| `gerente` | Gestão de equipe e relatórios, sem configurações sensíveis |
| `tecnico` / `user` | Operação diária conforme permissões por módulo |

### 3.3 Bypass de permissões
> **Regra de negócio:** `superadmin`, `partner` e `tenant_admin` têm bypass total de permissões granulares (`/api/my-permissions`). Apenas usuários `user` regulares passam pelo filtro de `canView/canCreate/canEdit/canDelete` por módulo.

### 3.4 Cenário de QA — Papéis
1. Criar usuário `user` sem permissão de `crm` → menu CRM **não deve aparecer**.
2. Logar como `partner` → menu **Retaguarda** aparece + bypass de todas as permissões.
3. Logar como `tenant_admin` → **Tenant Switcher** aparece no topo da sidebar (se houver filiais).

---

## 4. Primeiro Acesso e Onboarding

### 4.1 Login
- URL: `consult.arcadiabusiness.com.br` (produção).
- Métodos: **email/senha local** ou **SSO via Replit/OIDC** (configurado por partner).
- Sessão em PostgreSQL (cookie `connect.sid`).

### 4.2 Fluxos de criação de conta
| Fluxo | Quem inicia | Resultado |
|---|---|---|
| Convite por email | `tenant_admin` ou `partner` | Link com token; o convidado define a senha |
| Criar conta direto | Usuário em `/register` | Conta sem tenant — precisa de convite para acessar dados |
| Provisionamento de tenant | `partner` em `/partner/novo-tenant` | Cria tenant + admin do tenant + envia convite |

### 4.3 Validações esperadas
- Email único por sistema.
- Senha mínima conforme política (verificar tela de cadastro).
- Convite expirado → mensagem clara, sem acesso.
- Usuário desativado (`isActive=0`) → não loga.

### 4.4 Cenário de QA — Onboarding completo
1. Superadmin cria partner.
2. Partner loga, cria novo tenant (`/partner/novo-tenant`).
3. Partner convida o admin do tenant por email.
4. Admin do tenant aceita convite → define senha → entra direto em `/minha-empresa`.
5. Admin do tenant convida usuários internos com perfis de acesso.

---

## 5. Módulo CRM 2.0

### 5.1 Pessoas (cadastro unificado)
**Rota:** `/pessoas` · **Detalhe:** `/pessoas/:id` · **Legado:** `/clientes` redireciona

**Regra de negócio fundamental:**
> **Uma pessoa = um cadastro único** que pode acumular múltiplos **papéis** (Cliente, Fornecedor, Sócio, Credor, Colaborador). Isso elimina duplicidade entre os módulos Control, Recovery e Societário.

**Campos principais:**
- Tipo (PF/PJ), Nome/Razão Social, Documento (CPF/CNPJ), Email, Telefone.
- Endereços (múltiplos), Contatos (múltiplos), Papéis (múltiplos).

**Validações:**
- CPF/CNPJ válido (dígitos verificadores).
- Documento único por tenant.
- Email no formato correto (não único, pessoas podem compartilhar).

**Cenário de QA:**
1. Criar pessoa PJ "Acme Ltda" com papel **Cliente**.
2. Mesma pessoa receber também papel **Fornecedor** no Control.
3. Verificar que aparece nos dois módulos sem duplicar cadastro.
4. Tentar cadastrar CNPJ duplicado → erro de unicidade.

### 5.2 Pipeline de CRM
**Rota:** `/crm`

**Entidades:** Lead → Oportunidade → Proposta → Contrato.

**Regras de negócio:**
- **Conversão Lead → Cliente:** ao fechar oportunidade, a pessoa-lead recebe papel `Cliente` automaticamente.
- **Conversão Proposta → Projeto:** proposta aprovada gera automaticamente um Projeto no Backlog da Produção (vínculo `linkedProjectId`).
- **Valor ponderado do pipeline:** soma de (valor × probabilidade) por estágio.

**Cenário de QA:**
1. Criar lead → mover por estágios do funil.
2. Marcar como ganho → verificar criação automática de Projeto no `/producao/backlog`.
3. Marcar como perdido → registrar motivo (campo obrigatório).

---

## 6. Módulo Projetos e Demandas

### 6.1 Projetos
**Rota:** `/projetos` · **Novo:** `/projetos/novo` · **Detalhe:** `/projetos/:id`

**Tipos:**
| Tipo | Uso |
|---|---|
| **Bússola** (interno) | Projeto de diagnóstico que usa Canvas/SWOT/PDCA |
| **Externo** | Projeto de execução para cliente final |

**Status:** `backlog` → `andamento` → `concluido` (transições controladas).

**Regra:** Um projeto "Bússola" pode gerar **demandas** que viram subprojetos de execução na Produção.

### 6.2 Demandas
**Rota:** `/demandas`

Demandas são "pedidos de trabalho" originados em diagnósticos. Fluxo:
1. Identificada no diagnóstico (Canvas/SWOT).
2. Triada (priorizada e estimada).
3. Aprovada → vira item de backlog Scrum.

**Cenário de QA:**
- Criar projeto Bússola → gerar demanda no Canvas → aprovar → verificar no `/producao/backlog`.

---

## 7. Módulo Central de Produção

**Rota raiz:** `/producao`

### 7.1 Estrutura
| Sub-rota | Função |
|---|---|
| `/producao` | Dashboard unificado (KPIs, gráficos) |
| `/producao/projetos` | Subprojetos hierárquicos |
| `/producao/backlog` | Itens priorizados não-alocados |
| `/producao/sprints` | Ciclos de execução |
| `/producao/sprints/:id/planning` | Sprint planning (drag & drop do backlog) |
| `/producao/squads` | Times multidisciplinares |
| `/producao/timesheet` | Apontamento de horas |
| `/producao/reunioes/:id` | Reunião ativa (atas, decisões, ações) |
| `/producao/relatorios` | Burndown, velocity, throughput |

### 7.2 Regras de negócio
- **Sprint só fecha** quando todas tarefas estão `done` ou movidas para próximo sprint.
- **Apontamento de horas** obrigatório para tarefas com estimativa.
- **Agente Scrum** pode gerar automaticamente: pauta de reunião, ata, plano de sprint, relatório de projeto.
- **Estouro de orçamento de horas** (real > estimado × threshold) → alerta no dashboard.

### 7.3 Cenário de QA
1. Criar squad com 3 membros.
2. Criar sprint de 2 semanas → fazer planning (arrastar 5 itens do backlog).
3. Iniciar sprint → membros executam tarefas → apontam horas.
4. Fazer daily/reunião → registrar ações.
5. Encerrar sprint → ver burndown e velocity calculados.

---

## 8. Módulo Diagnóstico

### 8.1 Canvas BMC Expandido
**Rota:** `/canvas/:projectId`

9 blocos do Business Model Canvas, cada um com:
- **Perguntas estruturadas** (banco Arcádia).
- **4 níveis de maturidade**: Intenção → Evidências → Sistêmico → Transformação.
- **PDCA por bloco**: plano de ação ligado às lacunas.
- **Insights gerados por IA** (Agente Diagnóstico).

**Regra:** o nível de maturidade do bloco é função das evidências carregadas + respostas validadas pelo consultor.

### 8.2 SWOT
**Rota:** `/swot/:projectId`
Matriz 2×2 (Forças/Fraquezas × Oportunidades/Ameaças) com:
- Cruzamentos automáticos (estratégias ofensivas/defensivas).
- Vínculo de itens SWOT a blocos do Canvas.

### 8.3 Processos e Aderência ERP
**Rota:** `/processos` · **ERP:** `/erp-aderencia`

- Mapeamento AS-IS (como é hoje) vs TO-BE (como deveria ser).
- Para cada processo: classificação **Nativo / Configurável / Customizável** no ERP.
- **Indicador de aderência:** % nativo + % configurável = quanto o ERP atende sem desenvolvimento.

### 8.4 PDCA Consolidado
**Rota:** `/pdca/:projectId`
Visão executiva de todos os ciclos PDCA do projeto, com status, responsável e prazo.

### 8.5 Cenário de QA — Diagnóstico
1. Criar projeto Bússola para "Empresa X".
2. Preencher Canvas — bloco "Proposta de Valor": responder 5 perguntas, anexar evidência (1 documento).
3. Verificar atualização do nível de maturidade.
4. Gerar SWOT → vincular Força ao bloco "Recursos-Chave".
5. Mapear 3 processos com aderência ERP → ver % no dashboard.
6. Acionar Agente para gerar insights → revisar e aprovar.

---

## 9. Módulo Societário

### 9.1 Cadastro Societário
**Rotas:** `/societario`, `/societario/:id`
Gestão de Sociedades, Sócios, Quotas, Capital Social, Certificados Digitais.

**Regras:**
- Soma de quotas dos sócios = 100% do capital social.
- Certificados com vencimento monitorado (alerta 30/15/7 dias antes).
- Documentos anexados passam por **extração de texto + OCR fallback** para busca semântica.

### 9.2 Pipeline Societário
**Rotas:** `/societario/pipeline`, `/societario/pipeline/:id`, `/societario/dashboard`

Kanban dinâmico de processos societários (alteração contratual, abertura, encerramento, etc.):
- **Checklist por etapa** (configurável por tipo de processo).
- **Aplicabilidade condicional** (etapas que aparecem só se condição X for verdadeira).
- **Auto-advance** quando todos os itens do checklist são marcados.
- **Agente Societário** pode executar tarefas como gerar minuta de alteração.
- Auditoria completa de todas as transições.

### 9.3 Cenário de QA
1. Cadastrar sociedade com 2 sócios (60%/40%).
2. Tentar adicionar terceiro com 20% → erro (excede 100%).
3. Abrir processo "Alteração Contratual" → preencher checklist da etapa 1 → auto-advance para etapa 2.
4. Anexar contrato em PDF → verificar OCR + busca por trecho do texto.
5. Verificar alerta para certificado digital próximo do vencimento.

---

## 10. Módulo Recovery

**Rotas:** `/recovery`, `/recovery/:id`, `/recovery/scenarios/:id`

### 10.1 Conceito
Gestão de **processos de recuperação** (judicial, extrajudicial, preventiva) com credores, negociações e acordos.

### 10.2 Regras de negócio críticas
- **Isolamento financeiro:** dívidas em negociação **não impactam** o fluxo de caixa do Control até o acordo ser **homologado**.
- **Versionamento de propostas:** cada proposta a credor tem versão; histórico imutável.
- **Homologação idempotente:** clicar "homologar" mais de uma vez não duplica lançamentos no Control.
- **Cenários comparativos:** simular múltiplas propostas (deságio, prazo, carência) e ver CET.
- **Aprovação multi-etapas:** algumas decisões precisam de aprovador adicional (workflow).

### 10.3 Cenário de QA
1. Cadastrar processo de recuperação extrajudicial.
2. Importar lista de 10 credores (CSV).
3. Criar 3 cenários de negociação (deságios diferentes).
4. Submeter cenário escolhido para aprovação.
5. Após aprovação → homologar → verificar lançamentos automáticos no Control (parcelas).
6. Tentar homologar **de novo** → sistema deve recusar (idempotência).

---

## 11. Módulo Arcádia Control

**Rota raiz:** `/control` · **Workspace por cliente:** `/control/:clienteId`

### 11.1 Estrutura por cliente
| Sub-rota | Função |
|---|---|
| `/control/:clienteId` | Dashboard 8-KPIs |
| `/control/:clienteId/centros-custo` | CCs e alocações |
| `/control/:clienteId/recorrencias` | Lançamentos recorrentes |
| `/control/:clienteId/orcamento` | Matriz Realizado × Previsto |
| `/control/:clienteId/fluxo-caixa-mensal` | Matriz mensal |
| `/control/:clienteId/fluxo-caixa-diario` | Visão diária com `COALESCE(dataPagamento, dataVencimento)` |
| `/control/:clienteId/dre` | DRE com Análise Vertical (AV%) |
| `/control/:clienteId/pivot` | Pivot Cliente×Mês e Fornecedor×Mês |
| `/control/:clienteId/carteiras` | Carteiras corporativas (Caju etc.) |
| `/control/:clienteId/calendario` | Calendário visual com chips |
| `/control/:clienteId/setup` | Wizard de setup (5 passos) |

### 11.2 Regras de negócio
- **Status de lançamento calculado** (não armazenado): `previsto` / `realizado` / `atrasado` (em função de data de pagamento e vencimento).
- **Centros de custo com alocação parcial:** soma das alocações = 100% do lançamento.
- **Parcelamento:** ao criar lançamento parcelado, gera N filhos com vencimentos espaçados.
- **Recorrências:** cron diário 06:30 cria lançamentos previstos no horizonte de 60 dias.
- **Transferências entre contas:** geram **dois lançamentos espelhados** (um CR, um CP), não entram em DRE.
- **Saldo inicial:** registrado por conta e data de início — base para fluxo de caixa.
- **Reconciliação bancária:** marca lançamentos como conciliados; gera extrato.
- **Orçamento (`orcamentos_mensais`):** cron diário 07:30 verifica desvios > 15% e dispara narrativa via agente.
- **Concentração de carteira:** alerta quando top-3 clientes > 60% do total.
- **Pivot agrupa por `favorecido`** (schema atual não tem `pessoaId` no lançamento — atenção em treinamentos).
- **NF-e Monitor:** modo simulado (cron horário) — categoriza notas via IA.
- **Exercício fiscal:** filtro de ano global por cliente, persistido em `localStorage` (hook `useExercicio`).

### 11.3 Carteiras corporativas
Contas do tipo `carteira` (ex: Caju, cartão corporativo) têm campos `apelido` e `responsavelId`. Helper `getDisplayName()` exibe apelido quando disponível.

### 11.4 Imports e templates
- **Mass import** de plano de contas, clientes, fornecedores, CCs, lançamentos via XLSX.
- **Templates CSV** disponíveis em `/api/control/templates/:tipo`.

### 11.5 Cenário de QA — Fluxo completo Control
1. Setup wizard: cadastrar cliente, conta bancária, plano de contas básico, centros de custo, saldo inicial.
2. Importar 50 lançamentos via XLSX (CR + CP).
3. Criar uma recorrência (aluguel mensal de 12 meses).
4. Criar transferência entre contas → verificar que **não aparece** na DRE.
5. Criar lançamento alocado 60%/40% em dois CCs.
6. Configurar orçamento mensal para uma categoria → criar lançamento com desvio > 15% → aguardar cron / forçar verificação → ver alerta.
7. Conciliar 10 lançamentos → gerar extrato.
8. Ir em Pivot Carteira → ver concentração; se top-3 > 60% → alerta visual.
9. Exportar XLSX da DRE com AV%.

### 11.6 Casos de borda
- Lançamento sem data de pagamento → status = `previsto` ou `atrasado` conforme vencimento.
- Recorrência editada após geração → versões futuras refletem; passadas mantêm.
- Cliente sem `pessoaId` no lançamento → Pivot agrupa por `favorecido` texto.

---

## 12. Módulo Inteligência e Agentes

### 12.1 Super Agente
**Rota:** `/super-agente` + **botão flutuante** disponível em qualquer tela.

Conversa global e contextual: o agente conhece o módulo atual do usuário e pode usar **tools** registradas no MCP Hub (listar projetos, ler contratos, consultar Brain, etc.).

### 12.2 Construtor de Agentes
**Rota:** `/agentes`

Permite criar agentes customizados por tenant com prompt de **5 camadas**:
1. **System** — papel/identidade
2. **Context** — domínio e dados disponíveis
3. **Instructions** — passos (STEP 0..N)
4. **Tools** — ferramentas que pode usar
5. **Output** — formato esperado

Existem também **agentes globais Arcádia** (read-only para tenants), como Agente Franqueador.

### 12.3 Base de Conhecimento (Brain)
**Rota:** `/inteligencia` e `/conhecimento`

- Documentos vetorizados com **embeddings OpenAI**.
- Isolamento por tenant (vector search filtrado por `tenant_id`).
- RAG: agente busca trechos relevantes antes de responder.

### 12.4 LLM Orchestrator
**Rota (admin):** `/admin/llm-orchestrator`

Cascata cloud → cloud → Ollama com:
- **Roteamento por sensibilidade** (dados sensíveis preferem provedores locais/aprovados).
- **Health monitoring** em memória (probe a cada 300s).
- **Audit trail** por chamada (custos, tokens, latência).
- **SSRF guard** whitelista apenas Modelfarm sidecar (`localhost:1106`).
- Modelos Anthropic fixados (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`).

### 12.5 Prompt Engineering Studio
**Rota:** `/dev-center/prompts`

3 painéis (Editor / Tester / AI Optimizer), versionamento e A/B test de prompts.

### 12.6 Cenário de QA
1. Abrir Super Agente em qualquer tela → perguntar "quantos projetos ativos?" → deve usar tool `list_projects`.
2. Em `/agentes`, criar agente customizado "Agente RH" com prompt 5 camadas.
3. Subir 3 PDFs para o Brain → fazer pergunta cujo conteúdo está nos PDFs → verificar citações.
4. Em `/admin/llm-orchestrator`, simular queda do provedor primário → ver fallback funcionando.

---

## 13. Módulo Suporte e Portal

### 13.1 Help Desk interno
**Rotas:** `/suporte`, `/suporte/tipos`, `/suporte/tickets/:id`
CRUD de tickets com tipos parametrizáveis, SLA, anexos, histórico.

### 13.2 Portal do Cliente
**Rotas:** `/portal`, `/portal/tickets`, `/portal/artigos`, `/portal/treinamentos`
Visão externa: cliente final abre tickets, acessa artigos da base de conhecimento e materiais de treinamento.

### 13.3 Cenário de QA
1. Cliente abre ticket pelo portal.
2. Consultor recebe, vincula a um projeto.
3. Cliente vê resposta + status atualizado em tempo real.

---

## 14. Módulo Administração

### 14.1 Superadmin (`/superadmin`)
- Gestão de Partners (`/superadmin/parceiros`, `/superadmin/tenants`).
- Métricas globais (parceiros, tenants, usuários, projetos ativos).
- Marketplace review (`/superadmin/marketplace`).
- Orquestrador LLM (`/admin/llm-orchestrator`).

### 14.2 Partner (`/partner`)
- Visão dos seus tenants (`/partner/tenants`).
- Novo tenant com wizard (`/partner/novo-tenant`).
- Detalhe + convite de usuários por tenant (`/partner/tenant/:id`).

### 14.3 Tenant Admin (`/minha-empresa`)
- Equipe (`/minha-empresa/equipe`).
- Filiais — sub-tenants (`/minha-empresa/filiais`).
- Perfis de acesso (`/minha-empresa/perfis`) — define `canView/canCreate/canEdit/canDelete` por módulo.

### 14.4 Integrações
**Rota:** `/integracoes`, `/configuracoes/integracoes`
OAuth2 Google / Microsoft 365, WhatsApp Business, conectores REST/PostgreSQL/Excel-CSV. Todos com **SSRF protection** e sandbox seguro.

### 14.5 API Keys e IA
- `/configuracoes/api-keys` — chaves para API pública `/mcp/v1` (rate-limit, Swagger).
- `/configuracoes/ia` — relatório de uso/custo de IA por tenant.

### 14.6 Cenário de QA
1. Tenant admin cria perfil "Analista Júnior" sem acesso a Control.
2. Usuário com esse perfil loga → menu Control **some**, tentativa via URL retorna 403.
3. Partner cria sub-tenant (filial) → tenant admin vê switcher e alterna contexto.

---

## 15. Módulo Dev Center

### 15.1 Dev Center (`/dev-center`)
Pipeline de codificação automatizada onde agentes especializados projetam, geram e revisam código. Integrado com Gitea e deploys Frappe.

### 15.2 Workspace IDE (`/workspace`)
IDE web de 3 painéis (Explorer / Editor / AI) com:
- Multi-tab + auto-save.
- Preview sandbox com auto-reload.
- SuperAgentChat integrado com quick actions.

### 15.3 Code Explorer (`/explorador-codigo`)
IDE web sobre o Git interno, capaz de gerar código para a própria plataforma.

### 15.4 Module Planner & Onboarding (`/dev-center/onboarding`)
Wizard zero-terminal para configurar infra (Coolify/Gitea/Frappe).

### 15.5 App Store interna (`/app-store`)
Tenants publicam (`/app-store/publicar`) e instalam módulos gerados no Dev Center. Cada instalação isola schema do módulo.

---

## 16. Regras Transversais

### 16.1 Multi-tenancy
- Toda tabela de negócio tem coluna `tenant_id` NOT NULL (exceto agentes globais que têm `tenant_id NULL`).
- Backend valida `tenant_id` em **toda** query via middleware.
- Erro `403 Tenant context required` quando usuário sem tenant tenta acessar dados de tenant.

### 16.2 Permissões granulares
Endpoint `/api/my-permissions` retorna `{ modulo: { canView, canCreate, canEdit, canDelete } }` por módulo. Frontend usa hook `usePermissions()`.

### 16.3 Auditoria
Operações sensíveis (homologação Recovery, transições Pipeline Societário, mudanças orçamentárias, chamadas IA) geram **audit trail** com usuário, timestamp, payload.

### 16.4 Sessões e segurança
- Cookies httpOnly + sameSite.
- CSRF protegido em mutations.
- SSRF guard em integrações externas.
- Senhas com hash (bcrypt).

### 16.5 Performance
- React Query com `staleTime` por endpoint.
- Lazy loading de todas as rotas (`React.lazy`).
- ErrorBoundary com auto-recovery de ChunkLoadError (máx 2 tentativas).
- Sourcemaps em produção para diagnóstico.

### 16.6 Cenários de QA transversais
1. Tentar acessar `/api/clients` sem sessão → 401.
2. Logar como tenant A → trocar `tenant_id` na URL → não deve trazer dados do tenant B.
3. Logar como user sem permissão de `crm` → acessar `/crm` direto → tela deve mostrar mensagem de bloqueio.

---

## 17. Roteiro de Treinamento Sugerido

**Trilha A — Usuário final (4h)**
1. Login e tour pela sidebar (15min)
2. Pessoas e Pipeline CRM (45min)
3. Projetos e Demandas (30min)
4. Diagnóstico Canvas + SWOT (60min)
5. Suporte e Portal (15min)
6. Super Agente em uso prático (30min)
7. Q&A + exercício livre (45min)

**Trilha B — Consultor sênior (8h)**
A + módulos avançados:
- Produção (Scrum completo): 90min
- Societário (cadastro + pipeline): 60min
- Recovery (cenários + homologação): 60min
- Arcádia Control (DRE, orçamento, conciliação): 120min

**Trilha C — Tenant Admin (3h)**
- Equipe e perfis de acesso (45min)
- Filiais e Tenant Switcher (30min)
- Integrações (Google/Microsoft) (45min)
- Configuração de API Keys (15min)
- Visão geral dos módulos (45min)

**Trilha D — Partner / Superadmin (4h)**
- Provisionamento de tenants
- Onboarding wizard Dev Center
- Métricas e orquestrador LLM
- Marketplace e App Store interna

---

## 18. Glossário

| Termo | Significado |
|---|---|
| AS-IS / TO-BE | Estado atual / estado desejado de um processo |
| AV% | Análise Vertical (% sobre receita ou base na DRE) |
| Backlog | Lista priorizada de itens a fazer |
| BMC | Business Model Canvas |
| BI | Business Intelligence |
| CCE | Centro de Custo |
| CET | Custo Efetivo Total |
| CR / CP | Contas a Receber / Contas a Pagar |
| Daily | Reunião diária Scrum |
| DRE | Demonstrativo do Resultado do Exercício |
| HQ | Headquarters (Arcádia central) |
| Idempotente | Operação que pode ser repetida sem efeito colateral adicional |
| Kanban | Quadro visual de tarefas em colunas |
| LLM | Large Language Model (IA generativa) |
| MCP Hub | Registro central de tools/ferramentas para agentes |
| NF-e | Nota Fiscal Eletrônica |
| OCR | Reconhecimento óptico de caracteres |
| OIDC | OpenID Connect (autenticação federada) |
| PCP | Planejamento e Controle da Produção |
| PDCA | Plan-Do-Check-Act (ciclo de melhoria) |
| PMP / PMR | Prazo Médio de Pagamento / Recebimento |
| RAG | Retrieval-Augmented Generation |
| RBAC | Role-Based Access Control |
| SSRF | Server-Side Request Forgery |
| SLA | Service Level Agreement |
| SSO | Single Sign-On |
| Sprint | Ciclo curto de execução (Scrum) |
| SWOT | Strengths, Weaknesses, Opportunities, Threats |
| Tenant | Empresa-cliente isolada na plataforma |
| Velocity | Pontos entregues por sprint (média) |

---

**Fim do manual.** Recomenda-se versionar este documento a cada release relevante e mantê-lo acessível no menu Ajuda (`/ajuda`) ou no Portal do Cliente.
