import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import { runMigrationSoe00, startEventWorker } from "./soe";
import { startAutomationEngine } from "./automationService";
import { startRecoveryOverdueCron } from "./recovery/overdueCron";
import { startNfeMonitor } from "./control/nfeMonitor";
import { startPipelineLembretesCron } from "./societario/pipeline/cron";
import { startMarketplaceMonthlyBillingCron } from "./marketplace/billingCron";
import { startProviderHealthCron } from "./mcp/providerHealthWorker";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// PROD-2: NÃO servir /uploads estaticamente — atas contêm dados confidenciais.
// O único caminho de download é GET /api/producao/reunioes/:id/ata/download
// que aplica check de tenant via obterReuniao().

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Fields whose values must NEVER appear in application logs
const SENSITIVE_LOG_FIELDS = new Set([
  "plainKey",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "clientId",
  "password",
  "passwordHash",
  "secret",
  "token",
  "apiKey",
  "X-MCP-Key",
]);

function sanitizeForLog(value: any, depth = 0): any {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForLog(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_LOG_FIELDS.has(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = sanitizeForLog(v, depth + 1);
    }
  }
  return out;
}

// Endpoints whose response bodies must never be logged at all
const SENSITIVE_PATH_PREFIXES = [
  "/api/api-keys",
  "/api/oauth/platform",
  "/api/oauth/whatsapp",
];

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const isSensitivePath = SENSITIVE_PATH_PREFIXES.some((p) => path.startsWith(p));
        if (isSensitivePath) {
          logLine += ` :: [body suppressed]`;
        } else {
          logLine += ` :: ${JSON.stringify(sanitizeForLog(capturedJsonResponse))}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

async function runStartupMigrations() {
  // SOE-PORT: fundação transacional deve rodar antes de todas as outras migrations
  await runMigrationSoe00();

  const client = await pool.connect();
  try {
    // Create enum types if they don't exist
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE system_role AS ENUM ('superadmin', 'partner', 'tenant_admin', 'user');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE partner_status AS ENUM ('active', 'inactive', 'suspended');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Platform-level AI configs (superadmin gerencia chaves de plataforma)
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_ai_configs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(20) NOT NULL UNIQUE,
        api_key_enc text,
        model varchar(100),
        base_url varchar(500),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
    `);

    // Add system_role column to users if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS system_role system_role NOT NULL DEFAULT 'user';
    `);

    // Add missing columns to partners table
    await client.query(`
      ALTER TABLE partners
      ADD COLUMN IF NOT EXISTS status partner_status NOT NULL DEFAULT 'active';
    `);
    await client.query(`
      ALTER TABLE partners
      ADD COLUMN IF NOT EXISTS user_id varchar REFERENCES users(id);
    `);

    // Add missing columns to tenants table
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sector varchar(100);`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS admin_email varchar(255);`);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE tenant_plan AS ENUM ('free', 'starter', 'professional', 'enterprise');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'inactive', 'suspended');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan tenant_plan NOT NULL DEFAULT 'free';`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status tenant_status NOT NULL DEFAULT 'trial';`);

    // Add sub_tenant_id to tenant_users for filial assignment
    await client.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sub_tenant_id varchar;`);

    // Create role_permissions table for configurable per-tenant role access
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role user_role NOT NULL,
        module varchar(50) NOT NULL,
        can_view integer NOT NULL DEFAULT 1,
        can_create integer NOT NULL DEFAULT 0,
        can_edit integer NOT NULL DEFAULT 0,
        can_delete integer NOT NULL DEFAULT 0,
        updated_at timestamp DEFAULT NOW(),
        UNIQUE (tenant_id, role, module)
      );
    `);

    // Create process_collaborators table to link project collaborators to processes
    await client.query(`
      CREATE TABLE IF NOT EXISTS process_collaborators (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        process_id varchar NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
        collaborator_id varchar NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
        participates integer NOT NULL DEFAULT 1,
        role varchar(255),
        assigned_at timestamp DEFAULT NOW()
      );
    `);

    // Fix existing members that got tenant_admin systemRole incorrectly:
    // gerente and tecnico roles should never have systemRole=tenant_admin (only superadmin/partner/admin can).
    await client.query(`
      UPDATE users
      SET system_role = 'user'
      WHERE system_role = 'tenant_admin'
        AND role IN ('gerente', 'tecnico')
    `);

    // ── Knowledge Brain (RAG) tables ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS brain_categories (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar,
        name varchar(100) NOT NULL,
        description text,
        slug varchar(100) NOT NULL,
        color varchar(20),
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS brain_items (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar,
        category_id varchar REFERENCES brain_categories(id),
        type varchar(50) NOT NULL,
        title varchar(255) NOT NULL,
        content text NOT NULL,
        tags text,
        embedding jsonb,
        embedding_provider varchar(30),
        embedding_dim integer,
        usage_count integer DEFAULT 0,
        created_by varchar,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar,
        project_id varchar,
        user_id varchar,
        agent_type varchar(80) NOT NULL,
        prompt_sent text,
        response_full text,
        knowledge_source_ids jsonb,
        tokens_input integer,
        tokens_output integer,
        duration_ms integer,
        status varchar(20),
        error_message text,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_brain_items_tenant ON brain_items(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_brain_items_type ON brain_items(type);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_logs_tenant_project ON agent_logs(tenant_id, project_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_definitions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar,
        name varchar(100) NOT NULL,
        description text,
        slug varchar(80) NOT NULL,
        system_prompt text NOT NULL,
        context_modules text[] DEFAULT ARRAY[]::text[],
        visible_in text[] DEFAULT ARRAY[]::text[],
        max_tokens integer DEFAULT 2000 NOT NULL,
        is_active integer DEFAULT 1 NOT NULL,
        created_by varchar,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_defs_tenant ON agent_definitions(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_defs_slug ON agent_definitions(slug);`);

    // Fix existing accounts: if a user has a password_hash set but is_local_auth=0,
    // they were created via agency/user admin flow but are blocked from logging in.
    // Set is_local_auth=1 and provider='local' so they can use local login.
    await client.query(`
      UPDATE users
      SET is_local_auth = 1, provider = 'local'
      WHERE password_hash IS NOT NULL
        AND password_hash != ''
        AND (is_local_auth = 0 OR is_local_auth IS NULL);
    `);

    // ── Sprint 3 Recovery: tabela de parcelas + coluna em lancamentos_financeiros ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS recovery_installments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        process_id varchar NOT NULL REFERENCES recovery_processes(id) ON DELETE CASCADE,
        scenario_id varchar NOT NULL REFERENCES recovery_scenarios(id) ON DELETE CASCADE,
        creditor_id varchar NOT NULL REFERENCES recovery_creditors(id) ON DELETE CASCADE,
        proposal_id varchar REFERENCES recovery_proposals(id) ON DELETE SET NULL,
        numero integer NOT NULL,
        due_date date NOT NULL,
        valor numeric(15,2) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'pendente',
        paid_amount numeric(15,2),
        paid_date date,
        payment_method varchar(50),
        control_ap_id varchar,
        is_released_to_control boolean NOT NULL DEFAULT false,
        released_at timestamp,
        released_by_id varchar,
        observacoes text,
        created_at timestamp NOT NULL DEFAULT NOW(),
        updated_at timestamp NOT NULL DEFAULT NOW(),
        created_by_id varchar,
        updated_by_id varchar
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recovery_inst_tenant_proc_due ON recovery_installments(tenant_id, process_id, due_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recovery_inst_status ON recovery_installments(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recovery_inst_release ON recovery_installments(is_released_to_control, due_date);`);
    // Idempotência: 1 parcela única por (scenario, creditor, numero) — bloqueia homologações duplicadas concorrentes
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_recovery_inst_scen_cred_num ON recovery_installments(scenario_id, creditor_id, numero);`);

    // FK lancamentos → installment (se ainda não existe)
    await client.query(`
      ALTER TABLE lancamentos_financeiros
      ADD COLUMN IF NOT EXISTS recovery_installment_id varchar;
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_lanc_recovery_installment'
        ) THEN
          ALTER TABLE lancamentos_financeiros
          ADD CONSTRAINT fk_lanc_recovery_installment
          FOREIGN KEY (recovery_installment_id)
          REFERENCES recovery_installments(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    // Idempotência: 1 AP única por parcela liberada — bloqueia releases duplicados concorrentes
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_lanc_recovery_inst_id ON lancamentos_financeiros(recovery_installment_id) WHERE recovery_installment_id IS NOT NULL;`);

    // Colunas viability_score / cash_flow_impact em recovery_processes (Sprint 3)
    await client.query(`ALTER TABLE recovery_processes ADD COLUMN IF NOT EXISTS viability_score numeric(5,4);`);
    await client.query(`ALTER TABLE recovery_processes ADD COLUMN IF NOT EXISTS cash_flow_impact jsonb;`);

    // ── Pipeline Societário Sprint 1 (5 tabelas) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_configs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        nome varchar(100) NOT NULL,
        tipo_processo varchar(50) NOT NULL,
        colunas jsonb NOT NULL,
        regras_transicao jsonb DEFAULT '{}'::jsonb,
        is_default boolean DEFAULT false,
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT NOW(),
        created_by varchar
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_configs_tenant ON pipeline_configs(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_configs_tipo ON pipeline_configs(tenant_id, tipo_processo, is_default);`);
    // Índice único parcial: garante 1 template default por tenant+tipo (idempotência do seed sob race)
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_configs_default ON pipeline_configs(tenant_id, tipo_processo) WHERE is_default = true;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_checklist_items (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        pipeline_config_id varchar NOT NULL REFERENCES pipeline_configs(id) ON DELETE CASCADE,
        etapa varchar(50) NOT NULL,
        ordem integer NOT NULL,
        titulo varchar(255) NOT NULL,
        descricao text,
        executor_type varchar(20) NOT NULL,
        acao_automatica jsonb,
        is_required boolean DEFAULT true,
        bloqueia_avanco boolean DEFAULT true,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_checklist_config_etapa ON pipeline_checklist_items(pipeline_config_id, etapa, ordem);`);
    // Motor dinâmico — colunas opcionais (idempotente)
    await client.query(`ALTER TABLE pipeline_checklist_items ADD COLUMN IF NOT EXISTS tipo varchar(20) NOT NULL DEFAULT 'checkbox';`);
    await client.query(`ALTER TABLE pipeline_checklist_items ADD COLUMN IF NOT EXISTS tarefa_key varchar(80);`);
    await client.query(`ALTER TABLE pipeline_checklist_items ADD COLUMN IF NOT EXISTS depends_on_keys text[];`);
    await client.query(`ALTER TABLE pipeline_checklist_items ADD COLUMN IF NOT EXISTS condicao_json jsonb;`);
    await client.query(`ALTER TABLE pipeline_checklist_items ADD COLUMN IF NOT EXISTS form_schema_json jsonb;`);

    // Capacidades do Agente (Sprint Agent-Builder-V2) — colunas idempotentes
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS allowed_tools text[] DEFAULT ARRAY[]::text[];`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS linked_credential_ids text[] DEFAULT ARRAY[]::text[];`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS enabled_skill_names text[] DEFAULT ARRAY[]::text[];`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS llm_model_override varchar(100);`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS required_approval_actions text[] DEFAULT ARRAY[]::text[];`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS allowed_roles text[] DEFAULT ARRAY[]::text[];`);
    await client.query(`ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS automation_triggers jsonb DEFAULT '[]'::jsonb;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS processos_societarios (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        process_number varchar(50) NOT NULL,
        sociedade_id varchar NOT NULL REFERENCES sociedades(id) ON DELETE CASCADE,
        pipeline_config_id varchar NOT NULL REFERENCES pipeline_configs(id) ON DELETE RESTRICT,
        tipo_processo varchar(50) NOT NULL,
        subtipo varchar(50),
        titulo varchar(255) NOT NULL,
        descricao text,
        coluna_atual varchar(50) NOT NULL DEFAULT 'backlog',
        modo_operacao varchar(20) NOT NULL DEFAULT 'assistido',
        analista_responsavel_id varchar,
        solicitante_id varchar,
        cliente_pessoa_id varchar,
        cliente_contato_preferido varchar(20) DEFAULT 'inapp',
        data_solicitacao timestamp DEFAULT NOW(),
        data_prevista_conclusao date,
        data_conclusao timestamp,
        status varchar(20) DEFAULT 'ativo',
        prioridade varchar(20) DEFAULT 'media',
        alteracao_societaria_id varchar,
        notas_internas text,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW(),
        created_by varchar
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_soc_tenant_coluna ON processos_societarios(tenant_id, coluna_atual);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_soc_tenant_status ON processos_societarios(tenant_id, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_soc_analista ON processos_societarios(analista_responsavel_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_soc_sociedade ON processos_societarios(sociedade_id);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_proc_soc_tenant_number ON processos_societarios(tenant_id, process_number);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS processo_tarefas (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        processo_id varchar NOT NULL REFERENCES processos_societarios(id) ON DELETE CASCADE,
        checklist_item_id varchar REFERENCES pipeline_checklist_items(id) ON DELETE SET NULL,
        etapa varchar(50) NOT NULL,
        ordem integer NOT NULL,
        titulo varchar(255) NOT NULL,
        descricao text,
        executor_type varchar(20) NOT NULL,
        status varchar(20) DEFAULT 'pendente',
        is_required boolean DEFAULT true,
        bloqueia_avanco boolean DEFAULT true,
        acao_automatica jsonb,
        auto_executed boolean DEFAULT false,
        auto_execution_result jsonb,
        concluido_at timestamp,
        concluido_by varchar,
        concluido_notes text,
        anexos jsonb DEFAULT '[]'::jsonb,
        assigned_to varchar,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_tarefa_processo ON processo_tarefas(processo_id, etapa, ordem);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_tarefa_tenant_status ON processo_tarefas(tenant_id, status, executor_type);`);
    // Motor dinâmico — snapshot do template + resposta + aplicabilidade
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS tipo varchar(20) NOT NULL DEFAULT 'checkbox';`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS tarefa_key varchar(80);`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS depends_on_keys text[];`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS condicao_json jsonb;`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS form_schema_json jsonb;`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS dados_coletados_json jsonb;`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS aplicavel boolean NOT NULL DEFAULT true;`);
    // Sprint 3 — audit de execução de skill + throttle de lembretes
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS last_auto_execution_at timestamp;`);
    await client.query(`ALTER TABLE processo_tarefas ADD COLUMN IF NOT EXISTS last_reminder_at timestamp;`);
    // Sprint 3 — distingue documentos gerados pelo agente
    await client.query(`ALTER TABLE documentos_societarios ADD COLUMN IF NOT EXISTS gerado_por_agente boolean DEFAULT false;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS processo_movimentacoes (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        processo_id varchar NOT NULL REFERENCES processos_societarios(id) ON DELETE CASCADE,
        coluna_de varchar(50),
        coluna_para varchar(50) NOT NULL,
        movido_por varchar,
        movido_por_agente boolean DEFAULT false,
        motivo text,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_proc_mov_processo ON processo_movimentacoes(processo_id, created_at);`);

    // ── MCP Hub Sprint 1 — OAuth connections + AI usage logs ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_connections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        provider varchar(30) NOT NULL,
        account_email varchar(300),
        access_token_enc text,
        refresh_token_enc text,
        scopes text[],
        expires_at timestamp,
        status varchar(20) NOT NULL DEFAULT 'active',
        metadata jsonb,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_conn_tenant_provider ON oauth_connections(tenant_id, provider);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_oauth_conn_tenant_provider ON oauth_connections(tenant_id, provider);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        user_id varchar,
        provider varchar(20) NOT NULL,
        model varchar(100) NOT NULL,
        source varchar(10) NOT NULL,
        tokens_input integer NOT NULL DEFAULT 0,
        tokens_output integer NOT NULL DEFAULT 0,
        task_type varchar(50),
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created ON ai_usage_logs(tenant_id, created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_source ON ai_usage_logs(provider, source);`);
    // Sprint 4 — widen `source` to fit 'partner_api' (and any future sources up to 20 chars)
    await client.query(`ALTER TABLE ai_usage_logs ALTER COLUMN source TYPE varchar(20);`);
    await client.query(`ALTER TABLE ai_usage_logs ALTER COLUMN provider TYPE varchar(30);`);

    // ── Code Explorer (Fase 5) — audit log de leitura/edição via IDE web ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS explorer_audit_log (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        user_id varchar,
        action varchar(20) NOT NULL,
        file_path varchar(1000),
        sha varchar(80),
        meta_json jsonb,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_explorer_audit_tenant_created ON explorer_audit_log(tenant_id, created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_explorer_audit_tenant_user ON explorer_audit_log(tenant_id, user_id);`);

    // ── Task #47 — LLM Orchestrator decisions (audit trail) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_decisions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        task_type varchar(80) NOT NULL,
        provider_used varchar(30) NOT NULL,
        model_used varchar(100) NOT NULL,
        tier integer NOT NULL,
        was_local integer NOT NULL DEFAULT 0,
        reason varchar(200) NOT NULL,
        tokens_in integer DEFAULT 0,
        tokens_out integer DEFAULT 0,
        latency_ms integer,
        cost_usd numeric(10,6),
        quality_score integer,
        outcome varchar(20) NOT NULL,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ld_tenant_task ON llm_decisions(tenant_id, task_type);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ld_provider ON llm_decisions(provider_used);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ld_created ON llm_decisions(created_at);`);

    // ── MCP Hub Sprint 3 — Platform-level OAuth app credentials (superadmin-managed) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_oauth_apps (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(30) NOT NULL UNIQUE,
        client_id_enc text NOT NULL,
        client_secret_enc text NOT NULL,
        redirect_uri text,
        enabled boolean NOT NULL DEFAULT true,
        updated_by varchar,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);

    // ── MCP Hub Sprint 4 — Partner API keys (public /mcp/v1) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_api_keys (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        name varchar(200) NOT NULL,
        key_hash varchar(64) NOT NULL UNIQUE,
        key_prefix varchar(16) NOT NULL,
        scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
        rate_limit integer NOT NULL DEFAULT 60,
        last_used_at timestamp,
        revoked_at timestamp,
        created_by_id varchar,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_partner_api_keys_hash ON partner_api_keys(key_hash);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_partner_api_keys_tenant ON partner_api_keys(tenant_id);`);

    // ── Phase 3 BI Multi-Fonte — analytics schema (mesmo Postgres) ──
    await client.query(`CREATE SCHEMA IF NOT EXISTS analytics;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.dim_source (
        data_source_id varchar PRIMARY KEY,
        tenant_id varchar NOT NULL,
        name varchar(200) NOT NULL,
        type varchar(50) NOT NULL,
        last_sync_at timestamp,
        updated_at timestamp NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_dim_source_tenant ON analytics.dim_source(tenant_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.dim_client (
        sk varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        source_data_source_id varchar NOT NULL,
        natural_key varchar(200) NOT NULL,
        name varchar(500),
        document varchar(50),
        status varchar(50),
        valid_from timestamp NOT NULL DEFAULT NOW(),
        valid_to timestamp,
        is_current smallint NOT NULL DEFAULT 1
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_dim_client_tenant ON analytics.dim_client(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_dim_client_lookup ON analytics.dim_client(tenant_id, source_data_source_id, natural_key, is_current);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.fact_revenue (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        source_data_source_id varchar NOT NULL,
        natural_key varchar(200) NOT NULL,
        client_natural_key varchar(200),
        period date NOT NULL,
        amount numeric(18,2) NOT NULL DEFAULT 0,
        category varchar(100),
        status varchar(50),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        ingested_at timestamp NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_fact_revenue_tenant ON analytics.fact_revenue(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_fact_revenue_period ON analytics.fact_revenue(tenant_id, period);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_fact_revenue_source ON analytics.fact_revenue(tenant_id, source_data_source_id);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_fact_revenue_nk ON analytics.fact_revenue(tenant_id, source_data_source_id, natural_key) WHERE natural_key IS NOT NULL;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.etl_runs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        data_source_id varchar NOT NULL,
        mapping_kind varchar(40) NOT NULL,
        status varchar(20) NOT NULL,
        rows_in integer NOT NULL DEFAULT 0,
        rows_upserted integer NOT NULL DEFAULT 0,
        rows_skipped integer NOT NULL DEFAULT 0,
        cursor_since timestamp,
        cursor_until timestamp,
        error_message text,
        started_at timestamp NOT NULL DEFAULT NOW(),
        finished_at timestamp
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_etl_runs_tenant ON analytics.etl_runs(tenant_id, started_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.dq_findings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        metric_id varchar(100) NOT NULL,
        source_a varchar NOT NULL,
        value_a numeric(18,2),
        source_b varchar NOT NULL,
        value_b numeric(18,2),
        diff numeric(18,2),
        diff_pct numeric(8,4),
        severity varchar(20) NOT NULL,
        explanation text,
        observed_at timestamp NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_dq_findings_tenant ON analytics.dq_findings(tenant_id, observed_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.migration_state (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        source_a varchar NOT NULL,
        source_b varchar NOT NULL,
        dimension varchar(50) NOT NULL,
        count_a integer NOT NULL DEFAULT 0,
        count_b integer NOT NULL DEFAULT 0,
        matched integer NOT NULL DEFAULT 0,
        missing_in_b integer NOT NULL DEFAULT 0,
        missing_in_a integer NOT NULL DEFAULT 0,
        observed_at timestamp NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_migration_tenant ON analytics.migration_state(tenant_id, observed_at DESC);`);

    // ── BI Expansion — fact tables para CRM/HR/Scrum + bi_alerts ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.fact_crm (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        opportunity_natural_key varchar NOT NULL,
        client_natural_key varchar,
        stage varchar(80),
        status varchar(40),
        value numeric(18,2) NOT NULL DEFAULT 0,
        probability numeric(5,2) NOT NULL DEFAULT 0,
        owner_user_id varchar,
        created_at timestamp NOT NULL DEFAULT NOW(),
        closed_at timestamp,
        ingested_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fact_crm_tenant_created ON analytics.fact_crm(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_fact_crm_stage ON analytics.fact_crm(tenant_id, stage);

      CREATE TABLE IF NOT EXISTS analytics.fact_hr (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        employee_id varchar NOT NULL,
        period date NOT NULL,
        department varchar(120),
        status varchar(20) NOT NULL DEFAULT 'active',
        gross_salary numeric(18,2) NOT NULL DEFAULT 0,
        encargos numeric(18,2) NOT NULL DEFAULT 0,
        benefits numeric(18,2) NOT NULL DEFAULT 0,
        ingested_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fact_hr_tenant_period ON analytics.fact_hr(tenant_id, period DESC);

      CREATE TABLE IF NOT EXISTS analytics.fact_scrum (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        sprint_id varchar NOT NULL,
        project_id varchar,
        period_start date NOT NULL,
        period_end date,
        tasks_planned integer NOT NULL DEFAULT 0,
        tasks_done integer NOT NULL DEFAULT 0,
        tasks_carried integer NOT NULL DEFAULT 0,
        story_points_planned integer NOT NULL DEFAULT 0,
        story_points_done integer NOT NULL DEFAULT 0,
        ingested_at timestamp NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fact_scrum_tenant_period ON analytics.fact_scrum(tenant_id, period_start DESC);

      CREATE TABLE IF NOT EXISTS bi_alerts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        name varchar(200) NOT NULL,
        metric_id varchar(200) NOT NULL,
        condition varchar(10) NOT NULL,
        threshold numeric(18,4) NOT NULL,
        is_active integer NOT NULL DEFAULT 1,
        notify_channels jsonb DEFAULT '[]'::jsonb,
        last_checked_at timestamp,
        last_triggered_at timestamp,
        last_value numeric(18,4),
        created_by_id varchar,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bi_alerts_tenant ON bi_alerts(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_bi_alerts_active ON bi_alerts(tenant_id, is_active);
    `);

    // ── Phase 4 — App Store interna (marketplace de módulos) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_apps (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_tenant_id varchar NOT NULL,
        slug varchar(80) NOT NULL UNIQUE,
        title varchar(200) NOT NULL,
        short_description varchar(280) NOT NULL,
        long_description text,
        category varchar(50) NOT NULL DEFAULT 'geral',
        status varchar(20) NOT NULL DEFAULT 'draft',
        billing_model varchar(20) NOT NULL DEFAULT 'free',
        price_cents integer NOT NULL DEFAULT 0,
        source_run_id varchar REFERENCES ide_pipeline_runs(id) ON DELETE SET NULL,
        source_plan_id varchar REFERENCES module_plans(id) ON DELETE SET NULL,
        icon_url varchar(500),
        screenshots jsonb DEFAULT '[]'::jsonb,
        current_version_id varchar,
        install_count integer NOT NULL DEFAULT 0,
        rating_avg numeric(3,2),
        rating_count integer NOT NULL DEFAULT 0,
        review_notes text,
        reviewed_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at timestamp,
        submitted_at timestamp,
        published_at timestamp,
        created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_app_owner ON marketplace_apps(owner_tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_app_status ON marketplace_apps(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_app_category ON marketplace_apps(category);`);
    // Invariante arquitetural: toda tabela de negócio tem tenant_id (= owner_tenant_id).
    await client.query(`ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS tenant_id varchar;`);
    await client.query(`UPDATE marketplace_apps SET tenant_id = owner_tenant_id WHERE tenant_id IS NULL;`);
    await client.query(`ALTER TABLE marketplace_apps ALTER COLUMN tenant_id SET NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_app_tenant ON marketplace_apps(tenant_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_app_versions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
        owner_tenant_id varchar NOT NULL,
        version varchar(30) NOT NULL,
        manifest_json jsonb NOT NULL,
        files_ref varchar(200),
        files_snapshot jsonb,
        schema_diff jsonb,
        changelog text,
        published_at timestamp,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_ver_app_version ON marketplace_app_versions(app_id, version);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_ver_app ON marketplace_app_versions(app_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_ver_owner ON marketplace_app_versions(owner_tenant_id);`);
    await client.query(`ALTER TABLE marketplace_app_versions ADD COLUMN IF NOT EXISTS rejected_at timestamp;`);
    await client.query(`ALTER TABLE marketplace_app_versions ADD COLUMN IF NOT EXISTS review_notes text;`);
    // Per-version submission signal — só entra na fila quando owner explicita.
    await client.query(`ALTER TABLE marketplace_app_versions ADD COLUMN IF NOT EXISTS submitted_at timestamp;`);
    // Invariante arquitetural: toda tabela de negócio tem tenant_id (= owner_tenant_id).
    await client.query(`ALTER TABLE marketplace_app_versions ADD COLUMN IF NOT EXISTS tenant_id varchar;`);
    await client.query(`UPDATE marketplace_app_versions SET tenant_id = owner_tenant_id WHERE tenant_id IS NULL;`);
    await client.query(`ALTER TABLE marketplace_app_versions ALTER COLUMN tenant_id SET NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_ver_tenant ON marketplace_app_versions(tenant_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_installations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
        tenant_id varchar NOT NULL,
        installed_version_id varchar NOT NULL REFERENCES marketplace_app_versions(id) ON DELETE RESTRICT,
        status varchar(20) NOT NULL DEFAULT 'installing',
        error_message text,
        installed_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        installed_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW(),
        uninstalled_at timestamp
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_install_app_tenant ON marketplace_installations(app_id, tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_install_tenant ON marketplace_installations(tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_install_app ON marketplace_installations(app_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_reviews (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
        tenant_id varchar NOT NULL,
        user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        rating integer NOT NULL,
        comment text,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_review_app_tenant ON marketplace_reviews(app_id, tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_review_app ON marketplace_reviews(app_id);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_charges (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
        installation_id varchar NOT NULL REFERENCES marketplace_installations(id) ON DELETE CASCADE,
        tenant_id varchar NOT NULL,
        owner_tenant_id varchar NOT NULL,
        amount_cents integer NOT NULL,
        kind varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        period_month varchar(7),
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_charge_owner ON marketplace_charges(owner_tenant_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mkt_charge_tenant ON marketplace_charges(tenant_id);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_charge_monthly ON marketplace_charges(installation_id, period_month);`);

    // ── Sprint C6.1: Extrato bancário (movimentações geradas por conciliação) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimentacoes_bancarias (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        conta_bancaria_id varchar NOT NULL REFERENCES contas_bancarias(id) ON DELETE CASCADE,
        lancamento_id varchar REFERENCES lancamentos_financeiros(id) ON DELETE SET NULL,
        data date NOT NULL,
        tipo varchar(10) NOT NULL,
        origem varchar(20) NOT NULL DEFAULT 'conciliacao',
        descricao varchar(500) NOT NULL,
        valor numeric(15,2) NOT NULL,
        saldo_apos numeric(15,2),
        criado_por varchar REFERENCES users(id),
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mov_banc_tenant_conta_data ON movimentacoes_bancarias(tenant_id, conta_bancaria_id, data);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_mov_banc_lancamento ON movimentacoes_bancarias(lancamento_id) WHERE lancamento_id IS NOT NULL;`);

    // ── Sprint C7: Tipos de Documento (parametrizáveis) ──────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tipos_documento (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        nome varchar(100) NOT NULL,
        icone varchar(50) DEFAULT 'file',
        ativo boolean NOT NULL DEFAULT true,
        ordem integer DEFAULT 0,
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tipos_doc_tenant ON tipos_documento(tenant_id);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_tipos_doc_tenant_nome ON tipos_documento(tenant_id, nome);`);

    // Seed dos tipos globais (tenant_id = '__global__'), idempotente.
    const TIPOS_PADRAO = [
      ['NF-e',                'file-text',       1],
      ['NFC-e',               'shopping-bag',    2],
      ['Boleto',              'barcode',         3],
      ['PIX',                 'zap',             4],
      ['CTE',                 'truck',           5],
      ['Recibo',              'receipt',         6],
      ['Folha de Pagamento',  'users',           7],
      ['Débito Automático',   'repeat',          8],
      ['Estorno',             'rotate-ccw',      9],
      ['Contrato',            'pen-tool',       10],
      ['Extrato',             'list',           11],
      ['Outros',              'more-horizontal',99],
    ] as const;
    for (const [nome, icone, ordem] of TIPOS_PADRAO) {
      await client.query(
        `INSERT INTO tipos_documento (tenant_id, nome, icone, ordem)
         VALUES ('__global__', $1, $2, $3)
         ON CONFLICT (tenant_id, nome) DO NOTHING;`,
        [nome, icone, ordem],
      );
    }

    // ── Sprint C7 — G1 Parcelamento ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS grupos_parcelamento (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        cliente_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        tipo varchar(10) NOT NULL,
        descricao varchar(300) NOT NULL,
        total_parcelas integer NOT NULL,
        valor_total numeric(15,2) NOT NULL,
        plano_conta_id varchar REFERENCES planos_contas(id),
        centro_custo_id varchar REFERENCES centros_custo(id),
        tipo_documento_id varchar,
        favorecido varchar(300),
        observacoes text,
        criado_por varchar REFERENCES users(id),
        created_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_grupos_parcel_tenant_cliente ON grupos_parcelamento(tenant_id, cliente_id);`);

    // ── Sprint C7 — G2 Recorrência ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates_recorrencia (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        cliente_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        descricao varchar(300) NOT NULL,
        tipo varchar(10) NOT NULL,
        frequencia varchar(20) NOT NULL,
        dia_vencimento integer,
        valor_fixo numeric(15,2),
        plano_conta_id varchar REFERENCES planos_contas(id),
        centro_custo_id varchar REFERENCES centros_custo(id),
        conta_bancaria_id varchar REFERENCES contas_bancarias(id),
        tipo_documento_id varchar,
        favorecido varchar(300),
        data_inicio date NOT NULL,
        data_fim date,
        ativa boolean NOT NULL DEFAULT true,
        geradas_ate date,
        observacoes text,
        criado_por varchar REFERENCES users(id),
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_templates_rec_tenant_cliente ON templates_recorrencia(tenant_id, cliente_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_templates_rec_ativa ON templates_recorrencia(tenant_id, ativa);`);

    // ── Sprint C7 — colunas em lancamentos_financeiros ───────────────────
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS grupo_parcelamento_id varchar;`);
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS numero_parcela integer;`);
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS total_parcelas integer;`);
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS template_recorrencia_id varchar;`);
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS origem_recorrencia boolean DEFAULT false;`);
    await client.query(`ALTER TABLE lancamentos_financeiros ADD COLUMN IF NOT EXISTS tipo_documento_id varchar;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lanc_grupo_parcelamento ON lancamentos_financeiros(grupo_parcelamento_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lanc_template_recorrencia ON lancamentos_financeiros(template_recorrencia_id);`);
    // FKs nominais (sem ON DELETE para preservar histórico)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lanc_grupo_parcelamento') THEN
          ALTER TABLE lancamentos_financeiros
            ADD CONSTRAINT fk_lanc_grupo_parcelamento
            FOREIGN KEY (grupo_parcelamento_id) REFERENCES grupos_parcelamento(id) ON DELETE SET NULL;
        END IF;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lanc_template_recorrencia') THEN
          ALTER TABLE lancamentos_financeiros
            ADD CONSTRAINT fk_lanc_template_recorrencia
            FOREIGN KEY (template_recorrencia_id) REFERENCES templates_recorrencia(id) ON DELETE SET NULL;
        END IF;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);

    // Sprint C7 — defesa de idempotência (architect review):
    // Impede duplicar parcelas geradas por recorrência mesmo sob concorrência
    // (cron + trigger manual rodando em paralelo, dois workers, etc).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lanc_template_data
        ON lancamentos_financeiros(template_recorrencia_id, data_vencimento)
        WHERE template_recorrencia_id IS NOT NULL;
    `);
    // Garante 1 movimentação saldo_inicial por conta — torna definirSaldoInicial
    // estritamente idempotente.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_banc_saldo_inicial
        ON movimentacoes_bancarias(tenant_id, conta_bancaria_id)
        WHERE origem = 'saldo_inicial';
    `);

    // ── Sprint C8 — Orçamento mensal (Realizado × Previsto) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS orcamentos_mensais (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL,
        cliente_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        plano_conta_id varchar NOT NULL REFERENCES planos_contas(id) ON DELETE CASCADE,
        centro_custo_id varchar REFERENCES centros_custo(id) ON DELETE CASCADE,
        ano integer NOT NULL,
        mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
        valor_previsto numeric(15,2) NOT NULL DEFAULT 0,
        threshold_alerta_pct numeric(5,2),
        observacoes text,
        criado_por varchar REFERENCES users(id),
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant_cliente_ano ON orcamentos_mensais(tenant_id, cliente_id, ano);`);
    // UNIQUE parciais — diferenciam linhas com/sem CC porque NULL é distinto em UNIQUE padrão.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_orcamento_mensal_full
        ON orcamentos_mensais(tenant_id, cliente_id, plano_conta_id, centro_custo_id, ano, mes)
        WHERE centro_custo_id IS NOT NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_orcamento_mensal_sem_cc
        ON orcamentos_mensais(tenant_id, cliente_id, plano_conta_id, ano, mes)
        WHERE centro_custo_id IS NULL;
    `);

    // ── Sprint C10/C11 — apelido + responsavelId em contas_bancarias ────
    await client.query(`ALTER TABLE contas_bancarias ADD COLUMN IF NOT EXISTS apelido varchar(100);`);
    await client.query(`ALTER TABLE contas_bancarias ADD COLUMN IF NOT EXISTS responsavel_id varchar;`);

    // ── MT-1: Blindagem multi-tenant — backfill nulls + SET NOT NULL idempotente ──
    // Estratégia: se houver UM único tenant ativo, faz backfill dos nulls
    // para esse tenant. Se houver múltiplos tenants, registra warning e mantém
    // nullable (decisão manual exige escolher dono dos órfãos).
    const mtTables = [
      'clients', 'projects', 'canvas_blocks', 'project_files', 'processes',
      'deliverables', 'tasks', 'crm_leads', 'crm_opportunities',
      'swot_analyses', 'erp_requirements', 'report_configurations',
      'scrum_backlog_items',
    ];
    const tenantsRes = await client.query(`SELECT id FROM tenants LIMIT 2`);
    const fallbackTenantId = tenantsRes.rows.length === 1 ? tenantsRes.rows[0].id : null;
    for (const t of mtTables) {
      try {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE tenant_id IS NULL`);
        const nulls: number = rows[0]?.n ?? 0;
        if (nulls > 0) {
          if (fallbackTenantId) {
            await client.query(`UPDATE ${t} SET tenant_id = $1 WHERE tenant_id IS NULL`, [fallbackTenantId]);
            console.log(`[migration MT-1] backfilled ${nulls} rows in ${t} → tenant ${fallbackTenantId}`);
          } else {
            console.warn(`[migration MT-1] ${t} tem ${nulls} linhas sem tenant_id e há múltiplos tenants — SET NOT NULL ignorado (resolver manualmente)`);
            continue;
          }
        }
        // SET NOT NULL é seguro mesmo se já estiver NOT NULL
        await client.query(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL`);
      } catch (e: any) {
        console.warn(`[migration MT-1] falha em ${t}:`, e?.message ?? e);
      }
    }

    // FK em clients/projects (CASCADE) — idempotente
    for (const t of ['clients', 'projects'] as const) {
      try {
        await client.query(`
          DO $$ BEGIN
            ALTER TABLE ${t}
              ADD CONSTRAINT ${t}_tenant_id_fkey
              FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
          EXCEPTION
            WHEN duplicate_object THEN null;
            WHEN invalid_foreign_key THEN
              RAISE WARNING '[migration MT-1] ${t}.tenant_id contém valores órfãos — FK não adicionada';
          END $$;
        `);
      } catch (e: any) {
        console.warn(`[migration MT-1] FK ${t}:`, e?.message ?? e);
      }
    }

    // ── DatasetAtlas — staging analytics.atlas_* ──
    await client.query(`
      DROP TABLE IF EXISTS analytics.atlas_data_sources CASCADE;
      DROP TABLE IF EXISTS analytics.atlas_import_jobs CASCADE;

      CREATE TABLE IF NOT EXISTS analytics.atlas_pessoas (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        tipo_pessoa varchar(50),
        nome varchar(500),
        nome_fantasia varchar(500),
        razao_social varchar(500),
        cpf_cnpj varchar(50),
        email varchar(255),
        ativo boolean DEFAULT true,
        cliente boolean DEFAULT false,
        fornecedor boolean DEFAULT false,
        funcionario boolean DEFAULT false,
        categoria_id integer,
        vendedor_responsavel_id integer,
        tabela_preco_id integer,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_tenant ON analytics.atlas_pessoas(arcadia_tenant_id);
      CREATE INDEX IF NOT EXISTS idx_atlas_pessoas_cpf ON analytics.atlas_pessoas(cpf_cnpj);

      CREATE TABLE IF NOT EXISTS analytics.atlas_produtos (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        codigo_comercial varchar(255),
        codigo_barra varchar(255),
        nome varchar(500),
        apelido varchar(500),
        saldo_estoque numeric(16,3) DEFAULT 0,
        preco_venda numeric(16,2),
        valor_custo numeric(16,2),
        marca_id integer,
        grupo_produto_id integer,
        tipo_id integer,
        ativo boolean DEFAULT true,
        aplicacao text,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_produtos_tenant ON analytics.atlas_produtos(arcadia_tenant_id);
      CREATE INDEX IF NOT EXISTS idx_atlas_produtos_codigo ON analytics.atlas_produtos(codigo_comercial);

      CREATE TABLE IF NOT EXISTS analytics.atlas_pedidos (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        numero integer,
        cliente_id integer,
        funcionario_id integer,
        empresa_id integer,
        status_id integer,
        data_pedido timestamp,
        valor_produtos numeric(16,2) DEFAULT 0,
        valor_total numeric(16,2) DEFAULT 0,
        valor_frete numeric(16,2) DEFAULT 0,
        valor_ipi numeric(16,2) DEFAULT 0,
        numero_nota_fiscal text,
        serie_nota_fiscal text,
        data_emissao_nota_fiscal timestamp,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_pedidos_tenant ON analytics.atlas_pedidos(arcadia_tenant_id, data_pedido);
      CREATE INDEX IF NOT EXISTS idx_atlas_pedidos_cliente ON analytics.atlas_pedidos(arcadia_tenant_id, cliente_id);

      CREATE TABLE IF NOT EXISTS analytics.atlas_pedido_produtos (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        pedido_id integer NOT NULL,
        produto_id integer,
        quantidade numeric(16,2) DEFAULT 0,
        valor_unitario numeric(16,2) DEFAULT 0,
        desconto numeric(16,2) DEFAULT 0,
        valor_total numeric(16,2) DEFAULT 0,
        valor_custo numeric(16,2) DEFAULT 0,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_pp_pedido ON analytics.atlas_pedido_produtos(arcadia_tenant_id, pedido_id);
      CREATE INDEX IF NOT EXISTS idx_atlas_pp_produto ON analytics.atlas_pedido_produtos(arcadia_tenant_id, produto_id);

      CREATE TABLE IF NOT EXISTS analytics.atlas_pagar_recebers (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        tipo varchar(10),
        descricao varchar(500),
        categoria_conta_id integer,
        conta_id integer,
        pessoa_id integer,
        forma_pagamento_id integer,
        empresa_id integer,
        data_competencia timestamp,
        data_vencimento timestamp,
        data_pagamento timestamp,
        valor numeric(16,2) DEFAULT 0,
        valor_pago numeric(16,2) DEFAULT 0,
        desconto numeric(16,2) DEFAULT 0,
        juros_multa numeric(16,2) DEFAULT 0,
        pago boolean DEFAULT false,
        ativo boolean DEFAULT true,
        extornado boolean DEFAULT false,
        vinculo_espinha varchar(255),
        tabela_pai varchar(100),
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_pr_tenant ON analytics.atlas_pagar_recebers(arcadia_tenant_id, data_vencimento);
      CREATE INDEX IF NOT EXISTS idx_atlas_pr_tipo ON analytics.atlas_pagar_recebers(arcadia_tenant_id, tipo, pago);

      CREATE TABLE IF NOT EXISTS analytics.atlas_compras (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        fornecedor_id integer,
        empresa_id integer,
        status_id integer,
        valor_produtos numeric(16,2) DEFAULT 0,
        valor_total numeric(16,2) DEFAULT 0,
        valor_frete numeric(16,2) DEFAULT 0,
        valor_ipi numeric(16,2) DEFAULT 0,
        valor_icms numeric(16,2) DEFAULT 0,
        nota_fiscal varchar(255),
        data_criacao timestamp,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_compras_tenant ON analytics.atlas_compras(arcadia_tenant_id, data_criacao);

      CREATE TABLE IF NOT EXISTS analytics.atlas_saida_estoques (
        id integer NOT NULL,
        atlas_tenant_id integer,
        arcadia_tenant_id varchar NOT NULL,
        produto_id integer,
        pedido_id integer,
        empresa_id integer,
        quantidade numeric(16,3) DEFAULT 0,
        valor_total numeric(16,2) DEFAULT 0,
        data_saida timestamp,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_saida_tenant ON analytics.atlas_saida_estoques(arcadia_tenant_id, data_saida);

      CREATE TABLE IF NOT EXISTS analytics.atlas_marcas (
        id integer NOT NULL,
        arcadia_tenant_id varchar NOT NULL,
        nome varchar(255),
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS analytics.atlas_grupos_produtos (
        id integer NOT NULL,
        arcadia_tenant_id varchar NOT NULL,
        nome varchar(255),
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS analytics.atlas_modelos (
        id integer NOT NULL,
        arcadia_tenant_id varchar NOT NULL,
        nome varchar(255),
        marca_id integer,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS analytics.atlas_produto_similares (
        id integer NOT NULL,
        arcadia_tenant_id varchar NOT NULL,
        produto_id integer,
        produto_similar_id integer,
        lista_similar_id integer,
        synced_at timestamp NOT NULL DEFAULT NOW(),
        PRIMARY KEY (arcadia_tenant_id, id)
      );

      CREATE TABLE IF NOT EXISTS analytics.atlas_data_sources (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        arcadia_tenant_id varchar NOT NULL,
        atlas_tenant_id integer,
        mode varchar(20) NOT NULL DEFAULT 'dump',
        pg_host varchar(500),
        pg_port integer DEFAULT 5432,
        pg_database varchar(200),
        pg_user varchar(200),
        pg_password_encrypted text,
        pg_ssl boolean DEFAULT true,
        last_dump_filename varchar(500),
        last_dump_processed_at timestamp,
        is_active integer DEFAULT 1,
        last_sync_at timestamp,
        last_sync_status varchar(20),
        last_sync_error text,
        sync_rows_total bigint DEFAULT 0,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_ds_tenant ON analytics.atlas_data_sources(arcadia_tenant_id);

      CREATE TABLE IF NOT EXISTS analytics.atlas_import_jobs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source_id varchar NOT NULL,
        arcadia_tenant_id varchar NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        source_kind varchar(20) NOT NULL,
        source_ref varchar(500),
        file_bytes bigint,
        tables jsonb NOT NULL DEFAULT '{}'::jsonb,
        etl_result jsonb,
        error_message text,
        started_at timestamp NOT NULL DEFAULT NOW(),
        finished_at timestamp
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_jobs_ds ON analytics.atlas_import_jobs(data_source_id, started_at DESC);

      -- Constraint UNIQUE necessária para ON CONFLICT no ETL
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_fact_crm_atlas
        ON analytics.fact_crm(tenant_id, opportunity_natural_key);
    `);

    console.log('[migration] startup migrations completed successfully');
  } catch (err) {
    console.error('[migration] startup migration error:', err);
  } finally {
    client.release();
  }
}

(async () => {
  await runStartupMigrations();

  try {
    const { seedAgentDefinitionsIfNeeded } = await import("./seedAgentDefinitions");
    await seedAgentDefinitionsIfNeeded();
  } catch (err) {
    console.error("[seed] agent_definitions seed failed:", err);
  }

  try {
    const { seedSuperadminIfMissing } = await import("./seedSuperadminIfMissing");
    await seedSuperadminIfMissing();
  } catch (err) {
    console.error("[seed] superadmin seed failed:", err);
  }

  // MCP Hub Sprint 2: register core + module tools before routes.
  // `registerAllTools` is idempotent and itself calls `registerCoreTools`.
  try {
    const { registerAllTools } = await import("./mcp/registerAllTools");
    registerAllTools();
  } catch (err) {
    console.error("[mcp] tools registration failed:", err);
  }

  // SOE EventWorker — processa outbox de eventos em background
  startEventWorker();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      try {
        startAutomationEngine();
      } catch (e) {
        console.error("[startup] startAutomationEngine failed:", e);
      }
      try {
        // Sprint 3 Recovery: cron de inadimplência (06:00 diário)
        startRecoveryOverdueCron();
      } catch (e) {
        console.error("[startup] startRecoveryOverdueCron failed:", e);
      }
      try {
        startNfeMonitor();
      } catch (e) {
        console.error("[startup] startNfeMonitor failed:", e);
      }
      // Sprint C7 — G2 Recorrência: cron diário (06:30) gera 60d à frente
      import("./control/recorrenciaEngine")
        .then(({ startRecorrenciaCron }) => startRecorrenciaCron())
        .catch((e) => console.error("[startup] startRecorrenciaCron failed:", e));
      // Sprint C11 — Alertas proativos de desvio orçamentário (07:30 diário)
      import("./control/alertasService")
        .then(({ startAlertasCron }) => startAlertasCron())
        .catch((e) => console.error("[startup] startAlertasCron failed:", e));
      // PROD-2 — Pauta automática + notificação de reuniões do dia (08:00 diário)
      import("./producao/notificacaoReuniaoService")
        .then(({ startReunioesCron }) => startReunioesCron())
        .catch((e) => console.error("[startup] startReunioesCron failed:", e));
      try {
        // Sprint 3 Pipeline Societário: lembretes diários de docs pendentes (06:10)
        startPipelineLembretesCron();
      } catch (e) {
        console.error("[startup] startPipelineLembretesCron failed:", e);
      }
      try {
        // Fase 4 Marketplace: cobrança mensal placeholder (12h interval)
        startMarketplaceMonthlyBillingCron();
      } catch (e) {
        console.error("[startup] startMarketplaceMonthlyBillingCron failed:", e);
      }
      try {
        // Task #47: probe de health dos providers de IA (Map em memória, 5min)
        startProviderHealthCron();
      } catch (e) {
        console.error("[startup] startProviderHealthCron failed:", e);
      }
    },
  );
})();
