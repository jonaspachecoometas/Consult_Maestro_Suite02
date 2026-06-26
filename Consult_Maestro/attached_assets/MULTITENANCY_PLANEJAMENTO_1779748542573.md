# Arcádia Consult — Plano Mestre Multi-Tenant & Multi-Empresa

> **Versão:** v1.0 · **Data:** Maio 2026  
> **Status:** Documento de referência permanente — deve ser consultado a cada sprint  
> **Princípio:** Toda feature nova deve ser auditada contra este documento antes de merge.

---

## 1. Modelo mental: quem é quem

```
Arcádia (Ometas/Jonas)
  └── Superadmin platform
       ├── Pool LLM da plataforma (env vars)
       ├── Gerencia Partners e Tenants
       └── Visualiza TUDO sem restrição de tenant

Partners (opcional — revendedores futuros)
  └── Gerenciam seus próprios tenants

Tenants = AGÊNCIAS / CONSULTORIAS / CONTABILIDADES
  ├── São os clientes pagantes do Arcádia Consult
  ├── Têm seus próprios usuários (consultores, analistas)
  ├── Têm suas próprias LLM configs (ou herdam da plataforma)
  └── Cadastram Empresas-Cliente (= clients no DB)

Empresas-Cliente (clients)
  ├── Empresas que a consultoria atende
  ├── Cada empresa pode ter múltiplas "filiais" (sub-tenants ou multi-company)
  ├── Têm Projetos, Canvas, Processos, Control, etc.
  └── Podem ter usuários com acesso restrito (portal do cliente)

Multi-Empresa (sub-tenants / filiais)
  ├── Um tenant pode criar N empresas-filial para um mesmo cliente
  ├── Ex: holding com 5 CNPJs → 5 sub-empresas, 1 tenant admin gerencia tudo
  └── Dados são isolados por empresa, mas admin vê consolidado
```

---

## 2. Hierarquia de acesso — tabela de referência

| Papel | Scope de dados | Pode ver LLM? | Pode configurar LLM? |
|---|---|---|---|
| `superadmin` | TUDO (todos tenants, todas empresas) | Pool plataforma | Sim — configura pool |
| `partner` | Tenants vinculados ao partner | Pool plataforma | Não |
| `tenant_admin` | Seu tenant + sub-tenants | Config tenant → fallback plataforma | Sim — sua config |
| `tenant_user` (gerente/técnico) | Empresas/projetos onde é membro | Herdada do tenant | Não |
| Portal cliente | Apenas seus próprios dados (portal/) | Nenhuma | Não |

---

## 3. Estado atual: diagnóstico honesto

### 3.1 O que está correto ✅

- `tenantContext.ts` resolve corretamente `req.tenantId` e `req.isSuperadmin`
- Superadmin pode impersonar qualquer tenant via header `X-Tenant-Id`
- `resolveProvider()` faz fallback tenant → platform corretamente
- `tenant_ai_configs` com criptografia AES-256-GCM está implementado
- `tenantUsers` com roles (admin, gerente, tecnico) existe
- `subTenants` tabela existe para filiais
- `getAllClients(tenantId)` filtra por tenant corretamente quando `tenantId` presente

### 3.2 Problemas críticos ❌

#### CRÍTICO-1: `tenantId` nullable nas tabelas core
`projects.tenantId`, `clients.tenantId`, `canvasBlocks.tenantId` são `varchar` sem `.notNull()`.  
Um bug de código que não passa o tenantId cria dados "órfãos" sem tenant — invisíveis para todos.

**Risco:** Vazamento silencioso de dados. Produção com clientes reais já pode ter dados sem tenant_id.

#### CRÍTICO-2: Sem FK entre `clients` e `tenants`
`clients.tenantId` é `varchar("tenant_id")` sem `.references(() => tenants.id)`.  
Não há constraint de integridade referencial — um client pode ter tenantId apontando para tenant deletado.

#### CRÍTICO-3: `getAllClients()` sem tenantId retorna TUDO
```typescript
async getAllClients(tenantId?: string | null): Promise<Client[]> {
  if (tenantId) { /* filtra */ }
  return await db.select().from(clients); // ← SEM filtro: vaza dados cross-tenant
}
```
Se qualquer rota chamar `storage.getAllClients()` sem passar `tenantId`, devolve dados de todos os tenants.

#### CRÍTICO-4: Mesma lacuna existe em `getAllProjects()` e outras
O mesmo padrão `if (tenantId) { filtrar } else { retornar tudo }` se repete em projetos, tarefas, etc.  
Lista completa a auditar: `getAllProjects`, `getAllTasks`, `getAllCrmLeads`, `getAllCrmOpportunities`, `getScrumInternalProjects`, `getScrumTeams`.

#### CRÍTICO-5: Multi-empresa não tem UI completa para o tenant admin
O schema `subTenants` existe mas a gestão de múltiplas empresas-cliente sob um tenant não tem fluxo claro na UI. O conceito "empresa-cliente (client) vs filial (sub-tenant)" precisa ser unificado.

#### CRÍTICO-6: LLM config do superadmin não é visível para tenant
Quando um tenant não tem LLM configurada, ele usa o pool da plataforma silenciosamente. Não há feedback visual no tenant dizendo "você está usando a LLM da plataforma". Isso cria confusão sobre custos.

---

## 4. Modelo de dados corrigido — o que deve ser

### 4.1 Hierarquia tenant ↔ empresa

```
tenants (agência/consultoria)
  id, name, slug, plan, partnerId, settings
  └── É a AGÊNCIA (ex: "Arcádia Capital Consultores")

clients (empresa-cliente)  ← RENOMEAR mentalmente para "empresa atendida"
  id, tenantId NOT NULL + FK → tenants.id
  cnpj, razaoSocial, nomeFantasia, setor
  └── É o CLIENTE DA AGÊNCIA (ex: "Cortiart Ltda")

sub_tenants (filiais / empresas do grupo)
  id, parentTenantId → tenants.id
  └── Usado quando a AGÊNCIA tem filiais (ex: "Arcádia SP", "Arcádia RJ")
  └── NÃO confundir com empresas-cliente multi-CNPJ

client_companies (NOVO — empresas do grupo do cliente)  
  id, clientId → clients.id, tenantId NOT NULL
  cnpj, razaoSocial, tipo (matriz/filial), isActive
  └── Para clientes tipo holding com múltiplos CNPJs
  └── Control, Societário, RH ficam vinculados a um client_company específico
```

### 4.2 Campos obrigatórios em todas tabelas de domínio

**REGRA ABSOLUTA:** Toda tabela que contém dados de negócio DEVE ter:
```sql
tenant_id VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
```

Tabelas que ainda precisam receber `.notNull()` e/ou FK:
- `clients.tenantId`
- `projects.tenantId`
- `canvas_blocks.tenantId`
- `canvas_pdca_items.tenantId`
- `processes.tenantId`
- `process_steps.tenantId` (herda via processo)
- `tasks.tenantId`
- `deliverables.tenantId`
- `swot_analyses.tenantId`
- `crm_*` tabelas (oportunidades, leads, propostas)

### 4.3 LLM por tenant — modelo completo

```
Resolução LLM para uma chamada de um tenant X:

1. tenant_ai_configs WHERE tenantId = X AND provider = ? AND isActive = true
   → usa a chave do tenant (source: "tenant")
   
2. Se tenant não tem config ativa:
   → verifica env vars da plataforma (PLATFORM_ANTHROPIC_API_KEY etc.)
   → usa pool da plataforma (source: "platform")
   → registra em ai_usage_logs com source="platform", tenantId=X
   
3. Se nem plataforma tem:
   → retorna unavailable com mensagem amigável

4. UI do tenant DEVE mostrar qual fonte está ativa (tenant ou platform)
   → Badge "Usando LLM da plataforma" quando sem config própria
   → Nudge de custo: "X tokens consumidos do pool da plataforma este mês"
```

---

## 5. Regras de isolamento — checklist por operação

### 5.1 Leitura de dados (GET)

```
SEMPRE aplicar WHERE tenant_id = req.tenantId
EXCETO para superadmin, que pode:
  - Ler sem filtro de tenant
  - Ler com header X-Tenant-Id para impersonar
  
NUNCA fazer:
  if (tenantId) { WHERE tenant_id = ? } else { sem filtro }
  
SEMPRE fazer:
  if (!tenantId && !isSuperadmin) throw new Error("tenant required")
  if (tenantId) WHERE tenant_id = tenantId
  // superadmin sem tenantId = visão global (intencional)
```

### 5.2 Escrita de dados (POST/PATCH/DELETE)

```
SEMPRE inserir com tenantId: req.tenantId (obrigatório)
NUNCA aceitar tenantId do body — sempre do req.tenantId (contexto autenticado)
NUNCA atualizar/deletar sem WHERE tenant_id = req.tenantId (mesmo se isSuperadmin atuando em tenant)

PATCH/DELETE: verificar que o registro pertence ao tenant ANTES de modificar
  const record = await storage.get(id)
  if (record.tenantId !== req.tenantId && !req.isSuperadmin) return 403
```

### 5.3 Acesso cross-tenant (superadmin)

```
Superadmin pode:
  GET /superadmin/tenants → lista todos
  GET /superadmin/tenants/:id → detalhes
  GET /superadmin/tenants/:id/clients → empresas do tenant
  GET /superadmin/tenants/:id/ai-usage → uso de LLM
  PUT /superadmin/tenants/:id → editar settings
  
Superadmin com X-Tenant-Id: <id> pode:
  Operar como se fosse admin daquele tenant
  Todos os módulos normais funcionam com aquele tenant
  
Superadmin SEM X-Tenant-Id:
  Acessa endpoints /superadmin/* apenas
  Módulos normais retornam erro "selecione um tenant" na UI
```

---

## 6. Sprints de correção — roadmap

### Sprint MT-1: Blindagem de dados (URGENTE — fazer antes de qualquer nova feature)

**Objetivo:** Garantir que nenhum dado vaze cross-tenant em produção.

**Tarefas:**

1. **Adicionar NOT NULL + FK em `clients` e `projects`**
   - `shared/schema.ts`: `clients.tenantId` → `.notNull().references(() => tenants.id)`
   - `shared/schema.ts`: `projects.tenantId` → `.notNull()`
   - Migration idempotente em `runStartupMigrations()`: 
     ```sql
     UPDATE clients SET tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE tenant_id IS NULL;
     ALTER TABLE clients ALTER COLUMN tenant_id SET NOT NULL;
     ```

2. **Corrigir `getAllClients()` e similares no `storage.ts`**
   - Remover o branch `else { return todos }` — substituir por erro ou retorno vazio
   - Padrão correto:
     ```typescript
     async getAllClients(tenantId: string | null, isSuperadmin = false): Promise<Client[]> {
       if (!tenantId && !isSuperadmin) return []; // nunca vazar
       const q = db.select().from(clients);
       if (tenantId) q.where(eq(clients.tenantId, tenantId));
       return q.orderBy(desc(clients.createdAt));
     }
     ```

3. **Auditoria e correção das rotas em `server/routes.ts`**
   - Grep por `storage.getAllClients()` sem argumento
   - Grep por `storage.getAllProjects()` sem argumento
   - Adicionar `req.tenantId` onde faltando

4. **Adicionar `requireTenant` nas rotas que não têm**
   - Revisar todas as rotas de domínio: clients, projects, canvas, processos, control, etc.
   - Adicionar middleware `requireTenant` antes dos handlers

**Entregáveis:** PR com diff de `shared/schema.ts` + `server/storage.ts` + `server/routes.ts`  
**Teste:** Criar dois tenants, criar client em tenant A, logar como tenant B, verificar que não vê client A.

---

### Sprint MT-2: UI Superadmin completa

**Objetivo:** Superadmin consegue gerenciar tenants, visualizar empresas, ver uso de LLM.

**Tarefas:**

1. **Dashboard superadmin (`/superadmin/dashboard`)**
   - Cards: total tenants ativos, total empresas-cliente, tokens consumidos mês, alertas
   - Lista de tenants com status, plano, último acesso, config LLM

2. **Detalhe de tenant (`/superadmin/tenants/:id`)**
   - Info do tenant + edição (nome, plano, status, settings)
   - Lista de usuários do tenant
   - Lista de empresas-cliente do tenant
   - Config LLM do tenant (readonly + override)
   - Botão "Entrar como tenant" → seta X-Tenant-Id no frontend, navega para dashboard normal

3. **Impersonação de tenant na UI**
   - `TenantSwitcher.tsx` já existe — completar para superadmin
   - Banner visível quando superadmin está operando em tenant: "Você está operando como: [Nome Tenant]"
   - Botão de saída do modo impersonação

4. **Listagem global de empresas (`/superadmin/companies`)**
   - Tabela com: empresa, tenant dono, setor, projetos ativos, última atividade

**Arquivos a criar/modificar:**
- `server/routes.ts`: novas rotas `/api/superadmin/tenants/:id/clients`, `/api/superadmin/overview`
- `client/src/pages/superadmin/Dashboard.tsx`: expandir
- `client/src/pages/superadmin/TenantDetail.tsx`: adicionar aba "Empresas" e "LLM"
- `client/src/components/TenantSwitcher.tsx`: modo impersonação

---

### Sprint MT-3: UI Tenant Admin — gestão de empresas-cliente

**Objetivo:** Admin do tenant consegue cadastrar e gerenciar múltiplas empresas-cliente.

**Tarefas:**

1. **Gestão de empresas-cliente (`/tenant/companies`)**  
   - CRUD completo de `clients` com contexto multi-empresa
   - Campos adicionais: CNPJ, razão social, nome fantasia, regime tributário
   - Status: ativo, inativo, prospecto

2. **Multi-empresa por cliente (holdings)**
   - Nova tabela `client_companies` (Sprint MT-3 schema)
   - UI para adicionar filiais/empresas do grupo a um cliente
   - Seletor de empresa no Control, Societário, HR

3. **Página de configuração LLM do tenant (`/configuracoes/ia-e-modelos`)**
   - Já existe parcialmente em `IaUso.tsx` e `TenantAiConfigsCard.tsx`
   - Adicionar: badge "usando plataforma" quando sem config própria
   - Adicionar: estimativa de custo mensal com config própria vs pool

4. **Convite de usuários ao tenant**
   - Fluxo `/invite` já existe — validar que está completo
   - Adicionar: nível de acesso por empresa (usuário vê empresa A mas não B)

**Schema novo — `client_companies`:**
```typescript
export const clientCompanies = pgTable("client_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  cnpj: varchar("cnpj", { length: 18 }),
  razaoSocial: varchar("razao_social", { length: 255 }).notNull(),
  nomeFantasia: varchar("nome_fantasia", { length: 255 }),
  tipo: varchar("tipo", { length: 20 }).default("matriz"), // matriz | filial | coligada
  isActive: integer("is_active").default(1),
  settings: jsonb("settings").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

---

### Sprint MT-4: LLM por tenant — experiência completa

**Objetivo:** Cada tenant configura sua LLM, vê consumo, entende fallback.

**Tarefas:**

1. **Badge de fonte LLM em toda chamada de agente**
   - Quando SuperAgent responde, mostrar discretamente: "Claude · pool plataforma" ou "Gemini · config sua"
   - Componente: `<LlmSourceBadge source="platform" provider="anthropic" />`

2. **Dashboard de uso de LLM por empresa-cliente**
   - Breakdown: tokens por empresa atendida (clientId) dentro do tenant
   - Gráfico mensal de consumo
   - Alerta quando aproxima do limite do pool da plataforma

3. **Configuração LLM granular**
   - Tenant pode definir: provider padrão, modelo padrão, provider por módulo
   - Ex: "Use Claude para SuperAgent, use Gemini para BI SQL Agent (mais barato)"
   - Schema: adicionar campo `module` em `tenant_ai_configs` (null = padrão para todos)

4. **Superadmin: gestão do pool da plataforma**
   - UI em `/superadmin/llm` (já existe parcialmente em `LlmOrchestrator.tsx`)
   - Adicionar: limite mensal por tenant, alerta de abuso, override de config

---

## 7. Regras de código — devem ser seguidas em TODA PR

### 7.1 Checklist obrigatório (para o agente de código revisar)

Antes de qualquer merge de feature que toque dados de negócio:

- [ ] A rota tem `requireTenant` ou `requireSuperadmin` no middleware?
- [ ] O handler passa `req.tenantId` ao método de storage?
- [ ] O método de storage tem `tenantId` como parâmetro **obrigatório** (não opcional)?
- [ ] INSERT inclui `tenantId: req.tenantId`?
- [ ] UPDATE/DELETE verifica ownership antes de modificar?
- [ ] Se for rota de superadmin, está em `/api/superadmin/*` ou tem `requireSuperadmin`?
- [ ] A feature funciona com dois tenants isolados em paralelo?
- [ ] O frontend passa `X-Tenant-Id` quando superadmin impersona tenant?

### 7.2 Padrão de rota obrigatório

```typescript
// ✅ CORRETO
app.get("/api/clients", isAuthenticated, tenantContext, requireTenant, async (req, res) => {
  const clients = await storage.getAllClients(req.tenantId!);
  res.json(clients);
});

// ❌ ERRADO — sem requireTenant, vaza dados
app.get("/api/clients", isAuthenticated, tenantContext, async (req, res) => {
  const clients = await storage.getAllClients(req.tenantId);
  res.json(clients);
});

// ❌ ERRADO — storage sem tenantId
app.get("/api/clients", isAuthenticated, tenantContext, requireTenant, async (req, res) => {
  const clients = await storage.getAllClients(); // nunca fazer isso
  res.json(clients);
});
```

### 7.3 Padrão de storage obrigatório

```typescript
// ✅ CORRETO — tenantId obrigatório, isSuperadmin opcional para visão global
async getAllClients(tenantId: string, isSuperadmin = false): Promise<Client[]> {
  const q = db.select().from(clients);
  if (!isSuperadmin || tenantId) {
    q.where(eq(clients.tenantId, tenantId));
  }
  return q.orderBy(desc(clients.createdAt));
}

// ❌ ERRADO — tenantId opcional abre brecha
async getAllClients(tenantId?: string | null): Promise<Client[]> {
  if (tenantId) { /* filtra */ }
  return await db.select().from(clients); // sem filtro = BRECHA
}
```

### 7.4 LLM — padrão de chamada

```typescript
// ✅ CORRETO — sempre passa tenantId para resolveProvider
const resolved = await resolveProvider(req.tenantId, "anthropic");
if (resolved.unavailable) {
  return res.status(503).json({ message: resolved.reason });
}
// usa resolved.apiKey, resolved.model, resolved.source

// ❌ ERRADO — usa API key hardcoded sem fallback
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

---

## 8. Matriz de visibilidade — quem vê o quê

| Entidade | superadmin | tenant_admin | tenant_user | portal_client |
|---|---|---|---|---|
| Lista de todos tenants | ✅ | ❌ | ❌ | ❌ |
| Detalhe de seu tenant | ✅ | ✅ | read-only | ❌ |
| Empresas-cliente de SEU tenant | ✅ (via impersonação) | ✅ | ✅ (onde é membro) | ❌ |
| Empresas-cliente de OUTRO tenant | ✅ | ❌ | ❌ | ❌ |
| Projetos de uma empresa | ✅ | ✅ | ✅ (membros) | leitura limitada |
| Config LLM do tenant | ✅ | ✅ | ❌ | ❌ |
| Pool LLM da plataforma | ✅ edita | ✅ lê (só o que é exposto) | ❌ | ❌ |
| Uso de tokens por tenant | ✅ todos | ✅ seu tenant | ❌ | ❌ |
| API keys do tenant | ✅ | ✅ | ❌ | ❌ |
| Outros tenants do partner | partner only | ❌ | ❌ | ❌ |

---

## 9. Nomenclatura canônica — usar sempre

Para evitar confusão no código, time e documentação:

| Conceito | Nome canônico | Não usar |
|---|---|---|
| A agência/consultoria que usa o Arcádia | **Tenant** | workspace, organização |
| O cliente da agência | **Empresa-cliente** ou **Client** | tenant-filho, sub-cliente |
| Filial/empresa do grupo do cliente | **ClientCompany** | sub-tenant (reservado para filiais da agência) |
| Filial da agência | **SubTenant** | sub-cliente |
| Usuário da agência | **TenantUser** | user, membro |
| Usuário do portal do cliente | **ClientPortalUser** | colaborador externo |
| Configuração LLM | **TenantAiConfig** | ai-config, llm-config |
| Pool LLM da plataforma | **Platform LLM Pool** | default LLM |

---

## 10. Testes obrigatórios por sprint

### Cenário de teste padrão (executar antes de cada deploy)

```
Setup:
  - Tenant A: "Consultoria ABC" (admin: userA@abc.com)
  - Tenant B: "Contabilidade XYZ" (admin: userB@xyz.com)
  - Superadmin: superadmin@arcadia.com
  - Client de A: "Empresa Alpha Ltda"
  - Client de B: "Empresa Beta S.A."

Testes de isolamento:
  1. userA@abc.com: GET /api/clients → retorna apenas "Empresa Alpha"
  2. userB@xyz.com: GET /api/clients → retorna apenas "Empresa Beta"
  3. superadmin sem X-Tenant-Id: GET /api/superadmin/tenants → lista A e B
  4. superadmin com X-Tenant-Id: A → GET /api/clients → vê "Empresa Alpha"
  5. Tentar: GET /api/clients/:id_da_empresa_beta como userA → 403 ou 404
  
Testes de LLM:
  6. Tenant A sem config LLM → SuperAgent usa pool plataforma → source="platform" em ai_usage_logs
  7. Tenant A configura Claude próprio → SuperAgent usa config do tenant → source="tenant"
  8. Tenant A sem config, plataforma sem config → SuperAgent retorna erro amigável (não 500)

Testes multi-empresa:
  9. Admin de A cria 2 empresas-cliente: Alpha e Beta do cliente
  10. Usuário de A com acesso só a Alpha: não vê projetos de Beta
  11. Admin de A vê consolidado de Alpha + Beta
```

---

*Documento vivo — atualizar a cada sprint quando regras mudarem.*  
*Próxima revisão obrigatória: Sprint MT-2.*
