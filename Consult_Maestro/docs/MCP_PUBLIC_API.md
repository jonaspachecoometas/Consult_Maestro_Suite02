# MCP Hub — API Pública `/mcp/v1`

Guia de integração para parceiros que vão consumir as ferramentas (tools) do
Arcádia via HTTP. Entregue na **Sprint 4 do MCP Hub** (Task #22).

> Para a visão geral do MCP Hub e do plano por sprint, veja
> `docs/MCP_HUB_PLANO_MESTRE.md`. Para detalhes arquiteturais, veja a §4.4 de
> `docs/ARCADIA_CONSULT_DOCUMENTATION.md`.

---

## 1. Conceitos

- **Tool** — uma capacidade exposta pelo Arcádia (consulta de cliente, leitura
  de OneDrive, envio de e-mail, envio de WhatsApp, etc.). Cada tool pertence a
  um **módulo** (`core`, `control`, `societario`, `recovery`, `google`,
  `microsoft`, `whatsapp`).
- **Partner API key** — credencial gerada pelo admin de um tenant em
  `/configuracoes/api-keys`. Formato `arc_<32 bytes em base64url>` (256 bits de
  entropia). A chave em texto claro é mostrada **uma única vez** no momento da
  criação; depois disso só sobra o hash no servidor.
- **Escopos (scopes)** — lista de módulos que a chave pode invocar. O wildcard
  `*` libera todos. Tool fora do escopo retorna `403 tool_not_available`.
- **Confirmação** — tools que mudam estado externo
  (`requiresConfirmation: true`) — ex.: `outlook_send_email`,
  `whatsapp_send_text`, `onedrive_write_file` — exigem **duas chamadas**: a
  primeira devolve `202` com um sentinela, a segunda confirma com
  `userConfirmed: true`.
- **Rate limit** — por chave, padrão 60 req/min (configurável até 1000). Cada
  resposta traz os headers `X-RateLimit-Limit`, `X-RateLimit-Remaining` e
  `X-RateLimit-Reset` (epoch segundos).

---

## 2. Base URL

```
https://<seu-deploy>/mcp/v1
```

Em desenvolvimento local: `http://localhost:5000/mcp/v1`.

---

## 3. Autenticação

Envie a chave em **todo request autenticado** via header:

```
X-MCP-Key: arc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Cada chave está vinculada a **um único tenant**. Não envie nada além do
header — não há cookies, sessão ou OAuth.

| Status | Significado |
|--------|-------------|
| `401 missing_api_key` | Header `X-MCP-Key` ausente. |
| `401 invalid_api_key` | Chave não encontrada. |
| `401 revoked_api_key` | Chave revogada (`revoked_at` preenchido). |
| `403 tool_not_available` | Tool não existe **ou** está fora dos escopos da chave (colapsado para evitar enumeração). |
| `429 rate_limited` | Cota da chave estourada na janela de 60s. |

---

## 4. Endpoints

### 4.1 `GET /mcp/v1/health`

Liveness check, **sem auth**.

```bash
curl https://exemplo.replit.app/mcp/v1/health
# {"ok":true,"service":"mcp-public","version":"v1"}
```

### 4.2 `GET /mcp/v1/tools`

Lista as tools que a chave pode invocar (já filtradas por escopo).

```bash
curl -H "X-MCP-Key: arc_..." https://exemplo.replit.app/mcp/v1/tools
```

```json
{
  "tools": [
    {
      "name": "list_clients",
      "module": "core",
      "description": "Lista os clientes do tenant.",
      "requiresConfirmation": false,
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "outlook_send_email",
      "module": "microsoft",
      "description": "Envia e-mail via Outlook…",
      "requiresConfirmation": true,
      "inputSchema": { "type": "object", "properties": { "to": {"type":"string"}, "subject": {"type":"string"}, "body": {"type":"string"} }, "required": ["to","subject","body"] }
    }
  ]
}
```

### 4.3 `POST /mcp/v1/tools/:name`

Executa a tool. Body:

```json
{
  "input":         { /* conforme inputSchema da tool */ },
  "userConfirmed": true,            // só para tools com requiresConfirmation
  "projectId":    "uuid-opcional"   // contexto extra, opcional
}
```

#### 4.3.1 Tool sem confirmação

```bash
curl -H "X-MCP-Key: arc_..." -H "Content-Type: application/json" \
     -d '{"input":{}}' \
     https://exemplo.replit.app/mcp/v1/tools/list_clients
# 200 OK
# [{"id":"...","name":"Cliente X", ...}, ...]
```

#### 4.3.2 Tool com confirmação (fluxo de 2 passos)

**Passo 1** — chamada exploratória (sem `userConfirmed`):

```bash
curl -i -H "X-MCP-Key: arc_..." -H "Content-Type: application/json" \
     -d '{"input":{"to":"alice@empresa.com","subject":"Oi","body":"Teste"}}' \
     https://exemplo.replit.app/mcp/v1/tools/outlook_send_email
```

Resposta `202 Accepted`:

```json
{
  "__requires_confirmation": true,
  "toolName": "outlook_send_email",
  "module": "microsoft",
  "description": "Envia e-mail via Outlook…",
  "input": { "to": "alice@empresa.com", "subject": "Oi", "body": "Teste" }
}
```

Mostre essa intenção ao usuário humano. Se ele confirmar:

**Passo 2** — repete o mesmo body com `userConfirmed: true`:

```bash
curl -H "X-MCP-Key: arc_..." -H "Content-Type: application/json" \
     -d '{"input":{"to":"alice@empresa.com","subject":"Oi","body":"Teste"},"userConfirmed":true}' \
     https://exemplo.replit.app/mcp/v1/tools/outlook_send_email
# 200 OK
# {"ok":true,"messageId":"...","sent":true}
```

#### 4.3.3 Códigos de retorno

| Status | Quando |
|--------|--------|
| `200` | Execução completa, body é o resultado da tool. |
| `202` | Tool exige confirmação — repita com `userConfirmed:true`. |
| `400` | Erro de domínio (ex.: `microsoft_not_connected`, schema inválido). |
| `401` | Auth falhou (ver tabela acima). |
| `403` | Tool não existe ou está fora do escopo da chave. |
| `429` | Rate limit estourado. |
| `500` | Erro interno; tente novamente após alguns segundos. |

---

## 5. Tools disponíveis (Sprint 4)

| Módulo | Tool | Escopo necessário | Confirma? | O que faz |
|--------|------|-------------------|-----------|-----------|
| core | `list_projects` | `core` | ❌ | Lista projetos do tenant. |
| core | `list_clients` | `core` | ❌ | Lista clientes do tenant. |
| core | `get_project_detail` | `core` | ❌ | Detalhes de um projeto. |
| core | `read_frappe_doc` | `core` | ❌ | Lê documento do ERP Frappe. |
| core | `search_brain` | `core` | ❌ | Busca no RAG (knowledge base). |
| control | `gerar_relatorio_financeiro` | `control` | ❌ | Relatório consolidado. |
| societario | `criar_processo_societario` | `societario` | ✅ | Abre processo no pipeline. |
| societario | `consultar_documento_societario` | `societario` | ❌ | Consulta documento. |
| recovery | `calcular_fleuriet` | `recovery` | ❌ | Cálculo Fleuriet. |
| google | `gmail_*`, `gdrive_*`, `gcal_*` (6 tools) | `google` | parcial | Gmail, Drive, Calendar. |
| microsoft | `onedrive_list_files` | `microsoft` | ❌ | Lista raiz/pasta. |
| microsoft | `onedrive_read_file` | `microsoft` | ❌ | Lê arquivo (até 200KB). |
| microsoft | `onedrive_write_file` | `microsoft` | ✅ | Cria/atualiza arquivo (utf-8 ou base64). |
| microsoft | `outlook_send_email` | `microsoft` | ✅ | Envia e-mail. |
| microsoft | `teams_send_message` | `microsoft` | ✅ | Posta em chat ou canal. |
| whatsapp | `whatsapp_send_text` | `whatsapp` | ✅ | Mensagem de texto. |
| whatsapp | `whatsapp_send_template` | `whatsapp` | ✅ | Template Meta-aprovado. |

> Total: **22 tools** registradas no boot (5 core + 17 de módulos).
> A descrição completa e o `inputSchema` de cada tool podem ser obtidos via
> `GET /mcp/v1/tools` ou `GET /api-docs.json` (Swagger).

---

## 6. Rate limit

Cada chave tem uma cota em janela móvel de 60 segundos. Toda resposta traz:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1746013820
```

- `X-RateLimit-Limit` — cota da chave.
- `X-RateLimit-Remaining` — quanto sobrou na janela atual.
- `X-RateLimit-Reset` — epoch segundos UTC do reset.

Quando a cota estoura você recebe **`429 rate_limited`** com o body
`{"error":"rate_limited"}` e o mesmo conjunto de headers (com
`Remaining: 0`). Espere até `X-RateLimit-Reset` para tentar de novo.

> **Implementação atual:** o contador é por instância (memória local). Em
> deploy multi-instância, a cota efetiva é `limit × N_instâncias` — ver
> follow-up #27.

---

## 7. Observabilidade

Cada chamada é registrada em `ai_usage_logs` com:

- `source = 'partner_api'`
- `provider = 'mcp_public'`
- `model = <nome da tool>`
- `task_type = '<outcome>:<duração>ms'` onde outcome ∈
  `ok`, `confirmation_required`, `error`, `scope_denied`, `bad_input`.

O admin do tenant vê o consolidado na tela `/configuracoes/ia` (cards de
KPI, gráfico empilhado por provider, distribuição por origem).

---

## 8. Gerenciamento de chaves (UI)

Em `/configuracoes/api-keys`:

1. **Gerar nova** — informe nome, marque os escopos (multi-select), opcionalmente
   o rate limit. A chave em texto claro aparece em modal **uma única vez** com
   botão Copiar — guarde fora do Arcádia.
2. **Listar** — vê nome, prefix (`arc_xxxxxxxx`), escopos, rate limit,
   `lastUsedAt`, status.
3. **Revogar** — confirma com AlertDialog. Depois de revogada, qualquer
   chamada com a chave devolve `401 revoked_api_key` imediatamente.

A API key NUNCA é logada em texto claro: o logger global mascara `plainKey`,
`accessToken`, `refreshToken` e `passwordHash` e suprime body inteiro de
`/api/api-keys`, `/api/oauth/platform` e `/api/oauth/whatsapp`.

---

## 9. Swagger / OpenAPI

- UI interativa: `GET /api-docs`
- Spec JSON: `GET /api-docs.json` (OpenAPI 3.0.3)

Use a spec para gerar SDKs (openapi-generator, swagger-codegen) ou para
documentar o uso interno de outros times.

---

## 10. Segurança — checklist do parceiro

- ✅ Guarde a chave em **secret manager** (nunca no Git, em log ou em
  client-side JavaScript).
- ✅ Uma chave por integração / por ambiente. Revogue separadamente quando
  sair de uso.
- ✅ Restrinja o **escopo** ao mínimo necessário (não use `*` em produção).
- ✅ Trate `401 revoked_api_key` como sinal terminal — não tente reusar.
- ✅ Em automações, sempre logue o `outcome` da resposta (200/202/4xx/5xx)
  do seu lado também — facilita correlacionar com `ai_usage_logs`.
- ✅ Para tools com confirmação, apresente ao operador humano os campos do
  `input` antes do passo 2.

---

## 11. Histórico

- **Sprint 4 (Task #22)** — entrega inicial: 22 tools, Microsoft 365,
  WhatsApp Business, `/mcp/v1`, Swagger, dashboard IA.
- Follow-ups (backlog):
  - **#27** — rate limit distribuído (Redis) para deploy multi-instância.
  - **#28** — botão "testar conexão" Microsoft / WhatsApp pela UI.
  - **#29** — histórico/log de chamadas da API pública por chave (com
    filtro de erro) na UI.
