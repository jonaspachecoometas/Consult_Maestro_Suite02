# Arcádia Consult — Plano Mestre MCP Hub

> **Versão:** v1.0 · **Data:** Abril 2026 · **Status:** Em execução (Sprint 1 entregue)
> **Princípio:** O Consult **é** o agente. Soberania total. Nenhum intermediário.

Documento mestre dos **4 sprints** que implementam o MCP Hub dentro do Arcádia Consult. Atualiza a fonte técnica `docs/ARCADIA_CONSULT_DOCUMENTATION.md` na mesma PR de cada sprint.

---

## 1. O que já existia antes do Sprint 1

| Componente | Onde | Estado |
|---|---|---|
| `resolveAnthropicForTenant()` | `server/agentService.ts` | ✅ Fallback tenant → platform para Claude |
| `aiConfigService.ts` | `server/aiConfigService.ts` | ✅ Roteamento multi-provider (Claude/Gemini/Kimi/Ollama) com SSRF guard |
| `tenant_ai_configs` | `shared/schema.ts:1504` | ✅ Configuração de IA por tenant com chave criptografada |
| `cryptoService.ts` | `server/cryptoService.ts` | ✅ AES-256-GCM para todas as credenciais |
| `superAgentService.ts` | `server/superAgentService.ts` | ✅ Tool-calling com 5 tools hardcoded |
| `audit_log` / `agentLogs` | `shared/schema.ts` | ✅ Auditoria já existia |
| SSE no superAgentService | idem | ✅ Streaming `iteration → tool_call → tool_result → final → done` |

## 2. O que faltava

| Lacuna | Por quê é necessária |
|---|---|
| Pasta `server/mcp/` | Não existia. Toda a infra MCP precisa nascer aqui. |
| Tool Registry centralizado | Tools eram hardcoded em `superAgentService`. Precisam ser dinâmicas e plugáveis por módulo. |
| OAuth2 por tenant | Não existia tabela nem fluxo de autorização. |
| Fallback multi-provider distribuído | Só Claude tinha fallback. Gemini, Kimi, Ollama não tinham acesso ao pool da plataforma. |
| Tools dos módulos (Control, Societário, Recovery, Produção) | Agentes dos módulos não expunham tools. |
| Comportamento proativo `INIT_MODULE` | Nenhum módulo disparava análise proativa ao ser aberto. |
| Endpoint público `/mcp` | Parceiros software house não conseguiam se conectar. |

---

## SPRINT 1 — Tool Registry + Fallback multi-provider + Schema

**Status:** ✅ Entregue.
**Por quê primeiro:** É a fundação. Sem o registry e sem o schema, S2/S3/S4 não têm onde se apoiar.

### 1A — Tool Registry
Arquivo: `server/mcp/toolRegistry.ts`

- Singleton `toolRegistry` com `register()`, `get()`, `has()`, `listForAgent()`, `listForAnthropic()`, `execute()`.
- Interface `ToolDefinition`: `{ name, description, inputSchema, module, requiresConfirmation, handler }`.
- Interface `ToolContext`: `{ tenantId, userId?, projectId?, userConfirmed?, meta? }`.
- Tools com `requiresConfirmation: true` retornam um sentinel `ConfirmationRequired` quando `ctx.userConfirmed !== true` — caller (Sprint 2: `/mcp/tools/:name`) deve renderizar modal antes de re-tentar com `userConfirmed: true`.
- Erros do handler nunca lançam: viram `{ error: string }`. O loop tool-calling continua.

### 1B — Migração das 5 tools core
Arquivo: `server/mcp/registerCoreTools.ts` — registra:
- `list_projects`, `list_clients`, `get_project_detail`, `read_frappe_doc`, `search_brain`
- Idempotente: flag `coreRegistered` evita registros duplicados.
- Chamado no boot a partir de `server/index.ts` após `seedSuperadminIfMissing`.

`server/superAgentService.ts` foi reduzido: removidos `TOOL_DEFS`, `execTool` e `interface ToolContext` locais; agora usa `toolRegistry.listForAnthropic(tenantId)` e `toolRegistry.execute(name, input, ctx)`. Comportamento idêntico ao anterior.

### 1C — Fallback multi-provider distribuído
Arquivo: `server/agentService.ts` — adicionado:

```ts
export async function resolveProvider(
  tenantId: string | null | undefined,
  provider: AiProvider,
): Promise<ResolvedAiProvider>
```

Cadeia de fallback:
1. `tenant_ai_configs` ativa + secret usável → `source: "tenant"`
2. Pool da plataforma (`PLATFORM_<PROVIDER>_API_KEY` etc.) → `source: "platform"`
3. Sem nada → `unavailable: true` + razão amigável

Variáveis de ambiente reconhecidas (em ordem de precedência por provider):

| Provider | API key | Base URL |
|---|---|---|
| anthropic | `PLATFORM_ANTHROPIC_API_KEY` › `AI_INTEGRATIONS_ANTHROPIC_API_KEY` › `ANTHROPIC_API_KEY` | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` |
| gemini | `PLATFORM_GEMINI_API_KEY` › `AI_INTEGRATIONS_GEMINI_API_KEY` › `GEMINI_API_KEY` | — |
| kimi | `PLATFORM_KIMI_API_KEY` › `AI_INTEGRATIONS_KIMI_API_KEY` › `KIMI_API_KEY` › `MOONSHOT_API_KEY` | `PLATFORM_KIMI_BASE_URL` › `AI_INTEGRATIONS_KIMI_BASE_URL` › `KIMI_BASE_URL` |
| ollama | (sem chave) | `PLATFORM_OLLAMA_BASE_URL` › `AI_INTEGRATIONS_OLLAMA_BASE_URL` › `OLLAMA_BASE_URL` |

Toda `baseUrl` (de tenant ou platform) passa pelo guard SSRF `assertSafeBaseUrl()` (`server/aiConfigService.ts`): hosts privados/localhost são bloqueados a menos que `ALLOW_PRIVATE_AI=1`.

Ollama segue bloqueado por SSRF se base URL for privada e `ALLOW_PRIVATE_AI != 1` (regra herdada de `aiConfigService.assertSafeBaseUrl`).

Compatibilidade: `resolveAnthropicForTenant` permanece exportado e funcional — chamadores existentes não precisam mudar.

### 1D — Schema novo
Tabelas em `shared/schema.ts` + migrations idempotentes em `server/index.ts → runStartupMigrations()`:

#### `oauth_connections`
```
id, tenant_id, provider, account_email,
access_token_enc, refresh_token_enc, scopes (text[]),
expires_at, status, metadata (jsonb), created_at, updated_at
UNIQUE (tenant_id, provider)
```
Tokens **sempre** criptografados via `cryptoService.encryptConfig()`. Sprint 3 grava aqui.

#### `ai_usage_logs`
```
id, tenant_id, user_id, provider, model, source,
tokens_input, tokens_output, task_type, created_at
INDEX (tenant_id, created_at), INDEX (provider, source)
```
Wrapper `recordAiUsage()` em `server/mcp/usageLogger.ts` é chamado:
- `runAgent()` em `agentService.ts` (taskType: `agent:<type>`)
- `sendMessage()` em `superAgentService.ts` (taskType: `super_agent`)

Falhas no logger **nunca** propagam. `tenantId` ausente = ignora silenciosamente.

### Validação E2E — Sprint 1

- [x] Boot mostra `[mcp] registered 5 core tools (...)`
- [x] Tabelas `oauth_connections` e `ai_usage_logs` criadas
- [x] `tools: TOOL_DEFS` substituído por `tools: toolRegistry.listForAnthropic(tenantId)` no Super Agente
- [x] `search_brain` continua funcionando idêntico via `toolRegistry.execute()`
- [x] `resolveProvider('gemini')` em tenant sem config + `PLATFORM_GEMINI_API_KEY` setado → retorna `source: "platform"`
- [x] `resolveProvider('claude')` em tenant com config própria ativa → retorna `source: "tenant"`
- [x] Toda chamada bem-sucedida do Super Agente grava 1 linha em `ai_usage_logs`

---

## SPRINT 2 — Tools dos módulos + endpoint /mcp + INIT_MODULE

**Status:** ✅ DONE (Task #20). Entrega real abaixo. Tabela 2A original ficou conservadora — entrega manteve apenas tools que respeitam o princípio "não inventar dados, não duplicar lógica de domínio existente". Próximas tools (`gerar_dre_gerencial`, `criar_lancamento`, `gerar_documento_societario`, `criar_sprint`/`criar_task`) ficam no backlog do S3+.

### 2A entregue — `server/mcp/registerAllTools.ts`
| Módulo | Tool | Confirma? | Observação |
|---|---|---|---|
| Control | `calcular_fleuriet` | ❌ | Read-only; valida que `clienteId` pertence ao tenant; retorna `{ncg, st, t, sit}`. |
| Societário | `analisar_pipeline_societario` | ❌ | Agrega contagens por stage/tipo + processos vencidos. **Não** reusa lógica do `dashboard.ts` (intencionalmente mais simples para evitar acoplamento). |
| Societário | `validar_documento_societario` | ✅ | Wrapper sobre `dispatchSkill("validar_documentos_recebidos")` — chama OCR + grava auditoria. |
| Recovery | `simular_cenario_recovery` | ❌ | Reusa `calculateCET` + `buildScheduleFromScenario`; **não persiste**. |

### 2B entregue — Endpoint `/api/mcp`
Arquivo: `server/mcp/server.ts` exporta `registerMcpRoutes(app)`, montado em `server/routes.ts` após `registerInfraRoutes`.

| Verbo | Path | Auth | Função |
|---|---|---|---|
| GET | `/api/mcp/tools` | `isAuthenticated` + `requireTenant` | Lista tools formatadas para Anthropic. |
| POST | `/api/mcp/tools/:name` | idem | Body aceita `{input, userConfirmed?, projectId?}` ou shape plano. Retorna 202 + `{requiresConfirmation:true}` em sentinel; 400 + `{error}` em falha de validação; 404 se a tool não existe. |

> SSE (`/mcp/sse`) **adiado** — primeiro consumidor (cliente MCP externo) só aparece no Sprint 4 quando expusermos `/mcp` público com API keys.

### 2C entregue — `__INIT_MODULE__`
- Hook: `client/src/hooks/useModuleAgent.ts`
  - Garante 1 sessão Super Agente global por usuário (reusa a mais recente, `projectId=null`).
  - Envia `__INIT_MODULE__:<module>` exatamente uma vez por `(module, sessionId)` — guarda em `sessionStorage` para sobreviver a re-mounts/HMR.
  - Expõe `{sessionId, status, error, response, run, reset}` para botões "Reanalisar".
- Service: `server/superAgentService.ts::sendMessage`
  - Regex `^__INIT_MODULE__(?::([\w-]+))?$` detecta sentinel.
  - Substitui o conteúdo persistido por um prompt amigável em PT-BR (histórico nunca mostra a string mágica).
  - Anexa um **Step 0** ao system prompt do agente exigindo uso de pelo menos uma tool real e proibindo invenção de números.
- UI: `client/src/components/agent/ModuleAgentBanner.tsx` — card colapsável com botão "Reanalisar"; renderizado nas páginas `Control.tsx`, `Societario.tsx` e `Recovery.tsx` logo abaixo do header.

---

## SPRINT 3 — OAuth2 Google por tenant + Google Workspace tools

**Status:** PENDING (Task #21).

### 3A — `OAuthService` (Google primeiro)
Arquivo: `server/mcp/oauthService.ts` — usa `googleapis` (instalar **somente** neste sprint).

- `getGoogleAuthUrl(tenantId)` → URL de autorização com escopos Drive/Gmail/Calendar/Docs.
- `handleCallback(code, tenantId)` → troca code por tokens, criptografa via `cryptoService.encryptConfig`, faz upsert em `oauth_connections`.
- `getGoogleClient(tenantId)` → instancia clients autenticados (drive/gmail/calendar/docs) com **refresh automático** quando `expiresAt < now`.

### 3B — Tools Google
Registradas em `registerAllTools.ts` no módulo `google`:
- `google_drive_read_file` (read; sem confirmação)
- `google_drive_create_doc` (write; **confirmação obrigatória**)
- `gmail_send` (send; **confirmação obrigatória**)
- `google_calendar_create_event` (write; **confirmação obrigatória**)

### 3C — Tela `Configurações → Integrações`
`client/src/pages/configuracoes/Integracoes.tsx`. Card por provedor com status (`Conectado como user@gmail.com` / `Não conectado`), botões Conectar/Desconectar. Após conectar, agentes ganham as tools `google_*` automaticamente.

### Variáveis de ambiente (Sprint 3)
| Variável | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth2 Google (uma por toda a plataforma) |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Google |
| `APP_URL` | Base do callback (`/api/oauth/callback/google`) |

---

## SPRINT 4 — Microsoft 365 + WhatsApp + API pública /mcp

**Status:** PENDING (Task #22).

| Entrega | Detalhe |
|---|---|
| **Microsoft 365 OAuth2** | OneDrive (read/write), Outlook (send email), Teams (send message). Mesmo padrão Google. |
| **WhatsApp Business** | Meta Cloud API. Texto, templates e documentos. `requiresConfirmation: true`. Token por tenant. |
| **Slack / Teams** | Webhook por workspace. Alertas automáticos de anomalias e obrigações. |
| **API pública `/mcp`** | Autenticação via API key (tabela `partner_api_keys`). Rate limit por parceiro. Escopos por módulo. Swagger em `/api-docs`. |
| **Tela de uso de IA** | Em `Configurações → IA & Modelos`: consumo do pool da plataforma vs próprio. Nudge para configurar chave própria quando próximo do limite. Lê de `ai_usage_logs`. |

---

## Regras transversais para o Replit Agent

1. **Ordem fixa:** S1 → S2 → S3 → S4. Nunca pular.
2. **Não duplicar:** S1 migra as 5 tools existentes — não cria novas versões.
3. **Não quebrar:** comportamento do Super Agente atual deve permanecer idêntico após cada sprint.
4. `drizzle-kit push` (ou DDL idempotente em `runStartupMigrations`) somente após o sprint que adiciona as tabelas.
5. `npm install googleapis` **apenas no S3**.
6. Toda tool com efeito externo (email, calendar, WhatsApp, criação de documento): `requiresConfirmation: true`.
7. **Tokens OAuth2 NUNCA** aparecem em logs, respostas de API ou contexto enviado ao LLM. Logs sanitizam para `***redacted***` quando incluem `access_token` / `refresh_token`.
8. Após cada sprint: checkpoint + checklist de validação preenchido neste documento.

---

## Anexo — Checklist mestre

### Sprint 1 ✅
- [x] `server/mcp/toolRegistry.ts` criado com singleton + sentinel de confirmação
- [x] `server/mcp/registerCoreTools.ts` registra 5 tools idempotentemente
- [x] `server/mcp/usageLogger.ts` grava em `ai_usage_logs` (best-effort)
- [x] `agentService.resolveProvider()` cobre 4 providers com fallback
- [x] `superAgentService` 100% migrado para o registry — comportamento idêntico
- [x] Migrations DDL `oauth_connections` + `ai_usage_logs` aplicadas no boot
- [x] Boot logs: `[mcp] registered 5 core tools (...)`
- [x] `replit.md` + `docs/ARCADIA_CONSULT_DOCUMENTATION.md` atualizados

### Sprint 2 ✅
- [x] `registerAllTools.ts` com tools de Control, Societário, Recovery (Produção postergada)
- [x] `GET /api/mcp/tools` e `POST /api/mcp/tools/:name` (SSE adiado para S4)
- [x] Hook `useModuleAgent` + suporte a `__INIT_MODULE__` no `sendMessage`
- [x] Tool `validar_documento_societario` (`requiresConfirmation=true`) sem `userConfirmed` retorna sentinel via 202
- [x] Banner do agente wired em `Control.tsx`, `Societario.tsx`, `Recovery.tsx`
- [x] Boot logs: `[mcp] registered N tools (...)`

### Sprint 3 (entregue — Abril 2026)
- [x] **Desvio aprovado pelo usuário**: credenciais OAuth (Client ID/Secret) **NÃO** ficam em env vars. Superadmin cola na UI no momento do deploy; persistem na tabela nova `platform_oauth_apps` com `clientIdEnc` + `clientSecretEnc` criptografados via `cryptoService.encryptConfig()`. Env vars `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` permanecem como fallback opcional.
- [x] Schema novo `platform_oauth_apps` (1 linha por provider, unique em `provider`) + DDL idempotente em `runStartupMigrations()` — `server/index.ts`.
- [x] `server/mcp/oauthService.ts` — `resolveGoogleAppConfig()` (DB → env-var → erro PT-BR), `getGoogleAuthUrl()` com state HMAC-SHA256 assinado por `SESSION_SECRET`, `handleGoogleCallback()` (chama `oauth2.userinfo` para email, criptografa access+refresh, upsert em `oauth_connections`), `getValidAccessToken()` com refresh automático (margem de 60s), `getGoogleAuthClient()` para uso direto pelo `googleapis`, `disconnectGoogle()` e `getTenantConnection()`. Escopos mínimos: `openid`, `email`, `profile`, `drive.file`, `gmail.send`, `calendar.events`, `documents`.
- [x] `server/mcp/oauthRoutes.ts` — `GET/PUT/DELETE /api/oauth/platform/google` (`requireSuperadmin`), `GET /api/oauth/connections` (`requireTenant`), `GET /api/oauth/google/connect` (302), `GET /api/oauth/google/callback` (HTML auto-fechável com `postMessage`), `POST /api/oauth/google/disconnect`. Wirado em `server/routes.ts` logo após `registerMcpRoutes`. Resposta de status sempre mascara o `clientId` (formato `••••<últimos 6 chars>`) e nunca devolve secret nem token.
- [x] 6 Google Workspace tools em `server/mcp/registerAllTools.ts` (módulo `google`):
  - `google_drive_list_files` (read, sem confirmação)
  - `google_drive_read_file` (read; export Docs→txt, Sheets→csv; trunca em 200KB)
  - `google_drive_create_file` (write, `requiresConfirmation:true`)
  - `gmail_send` (write/external, `requiresConfirmation:true`, RFC 2047 nos headers PT-BR)
  - `google_calendar_create_event` (write/external, `requiresConfirmation:true`, `sendUpdates: all` se houver convidados)
  - `google_docs_create` (write, `requiresConfirmation:true`)
  Cada handler faz `import("googleapis")` dinâmico e usa `getGoogleAuthClient(ctx.tenantId)`; falhas devolvem `{error}` em vez de throw.
- [x] UI `client/src/pages/configuracoes/Integracoes.tsx` — card "Configuração do app OAuth Google (plataforma)" só para superadmin (mostra status + redirectUri exato a colar no Google Cloud Console + inputs Client ID/Secret/redirect override + ações Salvar/Remover) e card "Google Workspace" para qualquer admin do tenant (status, conta conectada, escopos, próxima renovação, botões Conectar/Reconectar/Desconectar via popup com `postMessage`). Aviso amigável quando plataforma não está configurada.
- [x] Página índice `/configuracoes` (`Index.tsx`) com cards para Integrações, IA & Modelos e Permissões. Sub-item "Integrações" adicionado na sidebar (`AppSidebar.tsx`) abaixo do link Configurações.
- [x] Tokens nunca aparecem em logs nem em respostas; o callback persiste mas resposta visível ao usuário se limita a `{provider, ok, accountEmail}`. Refresh transparente sempre que `expiresAt - now < 60s`.
- [x] Boot validado: `[mcp] registered module tools (control: 1, societario: 2, recovery: 1, google: 6)` → 15 tools totais no registry.

### Sprint 4 (concluído)
- [x] **Microsoft 365 OAuth2** — `oauthService.ts` ganhou `resolveMicrosoftAppConfig` (DB→env fallback `MICROSOFT_OAUTH_CLIENT_ID/_SECRET/_TENANT_ID`, default tenant=`common`), `getMicrosoftAuthUrl/handleMicrosoftCallback/getValidMicrosoftAccessToken` (refresh via `offline_access`), `setPlatformMicrosoftAppConfig`, `getPlatformMicrosoftAppPublic`, `disconnectPlatformMicrosoftApp`. Persistência reusa `oauth_connections` com `provider='microsoft'`, tokens criptografados via `cryptoService`.
- [x] **WhatsApp Business (Meta Cloud API)** — provider `whatsapp` em `oauth_connections` (sem OAuth — config manual). `setWhatsappConnection({accessToken, phoneNumberId, businessAccountId, displayName})`, `getWhatsappConnection`, `disconnectWhatsapp`. Token criptografado em `accessTokenEnc`; `phoneNumberId/businessAccountId/displayName` em `metadata` jsonb.
- [x] **Rotas OAuth Microsoft + WhatsApp** em `server/mcp/oauthRoutes.ts`: `GET/PUT/DELETE /api/oauth/platform/microsoft` (superadmin, com redirectUri sugerido + status mascarado), `GET /api/oauth/microsoft/connect` (redirect 302 com state HMAC), `GET /api/oauth/microsoft/callback` (HTML auto-fechável + `postMessage` com `provider` dinâmico), `POST /api/oauth/microsoft/disconnect`. WhatsApp: `GET/PUT/DELETE /api/oauth/whatsapp` (admin do tenant). `GET /api/oauth/connections` agora inclui `microsoft` e `whatsapp`.
- [x] **7 tools novas** em `server/mcp/registerAllTools.ts`. Microsoft (5 — módulo `microsoft`):
  - `onedrive_list_files` (read, sem confirmação) — lista raiz ou pasta `path`.
  - `onedrive_read_file` (read) — `GET /content`, trunca em 200KB.
  - `onedrive_write_file` (write, `requiresConfirmation:true`) — `PUT` para `/me/drive/root:/<path>:/content` ou `/me/drive/items/{folderId}:/{name}:/content`. Aceita conteúdo utf-8 ou base64 (binário).
  - `outlook_send_email` (write/external, `requiresConfirmation:true`).
  - `teams_send_message` (write/external, `requiresConfirmation:true`) — `chats/{id}/messages` ou `teams/{teamId}/channels/{channelId}/messages`.
  WhatsApp (2 — módulo `whatsapp`):
  - `whatsapp_send_text` (write/external, `requiresConfirmation:true`).
  - `whatsapp_send_template` (write/external, `requiresConfirmation:true`) — `template.name + language + components`.
  Helpers `callGraph` (Microsoft Graph v1.0) e `callMeta` (Facebook Graph v20.0). Tools sem conexão devolvem `{error: "...não conectado..."}`.
- [x] **`partner_api_keys`** — nova tabela em `shared/schema.ts` (id, tenantId, name, keyHash único, keyPrefix 12-char, scopes:text[], rateLimit, lastUsedAt, revokedAt, createdAt, createdById) + DDL idempotente em `runStartupMigrations()`. `apiKeyService.ts` gera chaves no formato `arc_<base64url-32B>` (256 bits de entropia) e armazena **HMAC-SHA-256** com pepper `SESSION_SECRET` (defesa em profundidade contra dump da DB; lookup deterministico para auth O(1) por hash). 5 helpers no `DatabaseStorage`: `createPartnerApiKey`, `listPartnerApiKeys`, `getPartnerApiKeyByHash`, `revokePartnerApiKey`, `touchPartnerApiKeyUsage`.
- [x] **Endpoint público `/mcp/v1`** — `server/mcp/publicRouter.ts` montado em `server/routes.ts` **antes** do `tenantContext`. Auth via header `X-MCP-Key` (lookup pelo hash, valida `revokedAt is null`, hidrata `req.tenantId/req.scopes`). Rate limit em memória `Map<keyId,{count,resetAt}>` 60req/min default (usa `key.rateLimit` se setado), headers `X-RateLimit-Limit/Remaining/Reset`, 429 ao estourar. Endpoints: `GET /mcp/v1/health` (público), `GET /mcp/v1/tools` (filtra por escopo da key — wildcard `*` libera tudo), `POST /mcp/v1/tools/:name` (valida módulo da tool ∈ scopes; mantém sentinel 202 `{requiresConfirmation:true,...}` igual `/api/mcp`). Logs de cada execução em `ai_usage_logs(source='partner_api')`.
- [x] **Swagger /api-docs** — `server/mcp/swaggerSpec.ts` (OpenAPI 3) montado via `swagger-ui-express` em `/api-docs` + spec JSON em `/api-docs.json`. Cobre `/mcp/v1/*` com securityScheme `X-MCP-Key`, schemas Tool/ToolList/ToolError, exemplos de payload.
- [x] **Dashboard `Configurações → IA & Modelos`** — `server/mcp/iaUsageRoutes.ts` expõe `GET /api/ia/usage?days=30` (default 30, max 90): agrega `ai_usage_logs` por dia/provider/source, calcula totais current vs previous (mesma janela anterior) e variação %, e expõe `platformPool` (consumo do mês via `source='platform'` contra `PLATFORM_AI_TOKENS_MONTHLY_QUOTA`, default 1.000.000) com flag `nudge=true` se ≥80%. UI `client/src/pages/configuracoes/IaUso.tsx`: 3 cards KPI (tokens mês, vs mês anterior, requisições), gráfico `recharts` BarChart empilhado por provider, banner âmbar quando nudge.
- [x] **UI Integrações expandida** — `Integracoes.tsx` reescrito com componentes `PlatformOAuthCard` (reutilizado para Google + Microsoft), `ProviderConnectionCard` (Google/Microsoft) e `WhatsappCard` (form direto: accessToken + phoneNumberId + businessAccountId + displayName, Salvar/Desconectar, mascara token).
- [x] **UI API Keys** — `client/src/pages/configuracoes/ApiKeys.tsx`: tabela (nome, prefix, scopes, rate limit, lastUsed, status), dialog "Gerar nova" (nome obrigatório, multi-select de escopos, rateLimit), modal pós-criação mostra a chave plaintext **uma única vez** com botão Copiar e aviso, AlertDialog de revogação. Rota `/configuracoes/api-keys` em `App.tsx`. Atalho no `/configuracoes` index e na sidebar admin.
- [x] **Renderização do callback OAuth** — `renderCallbackHtml` agora aceita `provider` param e gera o `postMessage` com `type` dinâmico (`google-oauth-callback` / `microsoft-oauth-callback`).
- [x] Boot validado: `[mcp] registered module tools (control: 1, societario: 2, recovery: 1, google: 6, microsoft: 5, whatsapp: 2)` → 22 tools totais. Smoke OK: `/mcp/v1/health` 200, `/api-docs` 200, criação de key → `arc_*` retornada 1×, `GET /mcp/v1/tools` com key core → 5 tools, `POST /mcp/v1/tools/<out-of-scope>` → 403 `tool_not_available`, key revogada → 401 `revoked_api_key`, headers `X-RateLimit-*` presentes.

---

**Arcádia Consult — Plano Mestre MCP Hub v1.0 — 4 Sprints — O Consult É o Agente.**
