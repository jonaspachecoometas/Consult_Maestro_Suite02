# Arcádia Consulting - Plataforma de Diagnóstico

## Overview
The Arcádia Consulting Diagnostic Platform is a full-stack TypeScript application designed to enhance consulting efficiency and strategic decision-making for consulting firms. It provides comprehensive tools for business diagnostics, project management, and strategic planning, leveraging an expanded Business Model Canvas. Key capabilities include client, project, and process management, detailed diagnostic report generation, multi-tenancy, advanced reporting, a CRM, an integrated BI builder with AI agents, and a RAG-powered knowledge base.

## User Preferences
Preferred communication style: Simple, everyday language.

## Usuários de Teste (login padrão)
Seedados automaticamente no startup por `server/seedSuperadminIfMissing.ts` (idempotente, valem também em produção). Senha de todos: **123456**. Todos são membros do tenant demo "Arcádia Demo" (slug `arcadia-demo`), então conseguem entrar e usar o tenant via TenantSwitcher.

| Tipo / nível        | E-mail                  | Senha  | Acesso ao tenant demo |
|---------------------|-------------------------|--------|-----------------------|
| Superadmin          | a@a.com.br              | 123456 | admin                 |
| Partner             | partner@arcadia.test    | 123456 | admin                 |
| Tenant Admin        | admin@arcadia.test      | 123456 | admin                 |
| Gerente             | gerente@arcadia.test    | 123456 | gerente               |
| Usuário (técnico)   | user@arcadia.test       | 123456 | tecnico               |

## System Architecture

### UI/UX Decisions
The frontend uses React 18+, TypeScript, Vite, shadcn/ui (New York style), and Tailwind CSS for a modern and intuitive user experience. It features light/dark modes, a collapsible sidebar, a fixed top bar, and responsive grid layouts.

### Technical Implementations
- **Frontend**: Built with React 18+, TypeScript, Vite, Wouter for routing, TanStack Query for server state, React Hook Form with Zod for form management, and React Context for themes.
- **Backend**: Implemented using Node.js and Express.js, providing a RESTful API.
- **Authentication & Authorization**: Supports Portable OIDC (SSO) and local email/password authentication, with PostgreSQL-backed sessions and Role-Based Access Control (RBAC). Multi-tenant data isolation is enforced.
- **Data Layer**: Drizzle ORM for type-safe PostgreSQL interactions. The normalized, relational schema supports core, multi-tenant, business, CRM, Scrum/Internal, Support/Knowledge, and AI/RAG entities. All business data tables include `tenant_id` for isolation.
- **Multi-Tenancy**: Hierarchical 3-level multi-tenancy (Superadmin, Partner, Tenant Admin) with dynamic, role-adaptive navigation.
- **AI & Knowledge Management**: Features a RAG-based knowledge base with vector embeddings and per-tenant isolation, utilizing Claude (LLM) and OpenAI (embeddings). Includes built-in agents, a custom AI agent builder, and a global library of specialized Arcádia agents with 5-layer prompts accessible via SuperAgentChat. A Super Agent provides a global and contextual conversational copilot.
- **LLM Orchestrator**: Implements a cascade fallback layer for LLM providers (cloud→cloud→Ollama), with sensitivity-aware routing, per-call audit trails, and an in-memory health monitoring system. SSRF guard whitelists Replit Modelfarm sidecar (`localhost:1106/modelfarm/*`); Anthropic models pinned to Modelfarm-supported IDs (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`); health probe POSTa `/v1/messages` quando o baseUrl é Modelfarm.
- **MCP Hub**: Centralized tool registry for AI agents with dynamic tool registration and execution. Supports integration with various LLM providers (Anthropic, Gemini, Kimi, Ollama) and logs AI usage. Integrates OAuth2 for Google and Microsoft 365, and WhatsApp Business API. Exposes a public API endpoint with API key management, rate limiting, and Swagger documentation.
- **Business Intelligence (BI) Builder**: A drag-and-drop dashboard builder with an internal metrics catalog, a BI Agent for natural language-to-dashboard generation, and agentic SQL in a secure sandbox. Includes a multi-source BI layer for combining heterogeneous connectors.
- **Reporting & CRM**: Offers customizable client reports, a unified PDCA dashboard, SWOT analysis, and a CRM module for sales pipeline management and unified relationship management.
- **Integration Hub**: Manages encrypted external data source connectors (REST API, PostgreSQL, Excel/CSV) with SSRF protection and secure sandboxes.
- **Módulo Societário**: Manages legal and compliance for client companies, including `sociedades`, `socios`, and legal documents, with tenant isolation and secure data handling. Features in-app document viewing with text extraction and OCR fallback, and a contextual Societário Agent.
- **Pipeline Societário**: A dynamic Kanban system for managing corporate processes, integrated with the Societário module. It includes configurable checklists, conditional task applicability, and an auto-advance motor with agent execution capabilities and audit trails.
- **Production Hub**: A unified project view encompassing Dashboard, Subprojects, Backlog, Sprints, Squads, Tasks, Drive+Agent, and Calendar, supporting hierarchical projects and a Scrum Agent.
- **Arcádia Control**: A financial controller module with per-client workspaces, operational tables, an 8-KPI dashboard, and a projected payments report. Includes mass import, Accounting Base, Corporate Groups, Connector Hub for external APIs, and an NF-e Monitor with AI categorization. Key features include dynamic cost centers with allocation, installment management, recurring transactions, transfers, initial balances, calculated transaction statuses, document type parametrization, bank reconciliation with statement generation, and a **monthly budget matrix** (`orcamentos_mensais`) with Realizado × Previsto comparison, deviation alerts (>threshold) and XLSX import/export. **Sprint C9 — Result visualizations**: Monthly Cash Flow matrix; Daily Cash Flow with `COALESCE(dataPagamento, dataVencimento)`; DRE with Vertical Analysis (AV%) + Previsto + deviation alerts; PMP/PMR cards. **Sprint C10 — Análise de Carteira**: Pivot Cliente × Mês e Fornecedor × Mês (agrupado por `favorecido` — schema atual não tem pessoaId), com toggle CR/CP, busca, alerta de concentração (top-3 > 60%), drill-down e export XLSX; Carteiras corporativas (Caju etc.) modeladas como `contas_bancarias.tipo='carteira'` com novos campos `apelido`/`responsavelId`; Endpoint `/exercicios` lista anos disponíveis e hook `useExercicio` (Context + localStorage por clienteId) sincroniza filtro fiscal nas telas analíticas. **Sprint C11 — UX Polish & Setup**: Wizard de Setup em 5 passos com persistência localStorage, Calendário visual mensal com chips coloridos (verde=CR/vermelho=CP) e popover "+N mais", Templates CSV (`/api/control/templates/:tipo`) para clientes/fornecedores/CCs/plano de contas/lançamentos, helper `getDisplayName()` para apelidos de conta, e cron diário 07:30 (`alertasService.verificarDesviosOrcamento`) que detecta desvios > 15% no orçamento e dispara narrativa via `runWithOrchestration`.
- **Recovery (Recuperação de Empresas)**: A module for managing extrajudicial/judicial/preventive recovery processes, including process and creditor management, negotiation scenarios, approval workflows, versioned proposals, and idempotent agreement homologation.
- **Prompt Engineering Studio**: A dedicated page for versioning system prompts with a 3-panel UI (Editor, Tester, AI Optimizer) and A/B comparison.
- **Dev Center**: An automated coding pipeline where specialized agents collaborate to design, generate, and review code, integrated with Gitea and real Frappe deployments. It includes a `Module Planner` for generating structured technical plans and a `Code Explorer` providing a web IDE for the internal Git repository, capable of generating code for the platform itself.
- **Internal App Store**: A marketplace where tenants can publish and install modules generated by the Dev Center, featuring schema isolation and secure installation/uninstallation processes.
- **Workspace IDE Unificado (`/workspace`)**: A 3-pane web IDE for the Dev Center, providing an Explorer, Editor, and AI panel, with features like multi-tab editing, auto-save, sandboxed preview with auto-reload, and integrated SuperAgentChat with quick actions.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Replit Auth / Portable OIDC**: Authentication provider.
- **Radix UI**: Headless UI components.
- **Google Fonts**: Inter and Poppins fonts.
- **Tailwind CSS**: Styling framework.
- **TanStack Query**: Server state management.
- **React Hook Form**: Form management.
- **Zod**: Schema validation.
- **Wouter**: Client-side routing.
- **class-variance-authority**: Component variants.
- **date-fns**: Date utility.
- **Anthropic**: LLM provider (Claude).
- **OpenAI**: Embedding provider.