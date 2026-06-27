import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  pgEnum,
  boolean,
  unique,
  uniqueIndex,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'gerente', 'tecnico']);
export const systemRoleEnum = pgEnum('system_role', ['superadmin', 'partner', 'tenant_admin', 'user']);
export const projectStatusEnum = pgEnum('project_status', ['backlog', 'diagnostico', 'andamento', 'revisao', 'concluido', 'proposta_enviada', 'aprovada', 'entregue']);
export const canvasLevelEnum = pgEnum('canvas_level', ['intencao', 'evidencias', 'sistemico', 'transformacao']);
export const partnerStatusEnum = pgEnum('partner_status', ['active', 'inactive', 'pending']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'inactive', 'trial']);
export const tenantPlanEnum = pgEnum('tenant_plan', ['free', 'starter', 'professional', 'enterprise']);

// Session storage table (IMPORTANT for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table (supports both OIDC Auth and local login/password)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: userRoleEnum("role").default('tecnico').notNull(),
    systemRole: systemRoleEnum("system_role").default('user').notNull(),
    partnerId: varchar("partner_id"),
  // Authentication fields
  passwordHash: varchar("password_hash"),
  isLocalAuth: integer("is_local_auth").default(0), // 0 = OIDC Auth, 1 = Local
  isActive: integer("is_active").default(1), // 0 = inactive, 1 = active
  provider: varchar("provider").default("local"), // 'local' | 'oidc'
  providerSub: varchar("provider_sub"), // OIDC subject identifier
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Multi-tenant: Partners (consulting firms, accountants, etc.)
export const partners = pgTable("partners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  plan: tenantPlanEnum("plan").default('starter').notNull(),
  status: partnerStatusEnum("status").default('active').notNull(),
  isActive: integer("is_active").default(1),
  notes: text("notes"),
  userId: varchar("user_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Multi-tenant: Tenants (client workspaces)
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  sector: varchar("sector", { length: 100 }),
  plan: tenantPlanEnum("plan").default('free').notNull(),
  status: tenantStatusEnum("status").default('trial').notNull(),
  partnerId: varchar("partner_id").references(() => partners.id),
  parentTenantId: varchar("parent_tenant_id"),
  logoUrl: varchar("logo_url", { length: 500 }),
  primaryColor: varchar("primary_color", { length: 20 }),
  adminEmail: varchar("admin_email", { length: 255 }),
  isActive: integer("is_active").default(1),
  settings: jsonb("settings").$type<Record<string, any>>().default({}),
  // Frappe / ERPNext backend integration (Phase 0).
  // frappeCredentials stores encrypted JSON { apiKey, apiSecret } via cryptoService.
  frappeUrl: varchar("frappe_url", { length: 500 }),
  frappeCredentials: text("frappe_credentials"),
  frappeWebhookSecret: varchar("frappe_webhook_secret", { length: 255 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Multi-tenant: Tenant Users (user membership per tenant)
export const tenantUsers = pgTable("tenant_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").default('tecnico').notNull(),
  isActive: integer("is_active").default(1),
  subTenantId: varchar("sub_tenant_id"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

// Invite Tokens (for inviting users to tenants)
export const inviteTokens = pgTable("invite_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 255 }).unique().notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").default('tecnico').notNull(),
  invitedBy: varchar("invited_by").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Role Permissions — configures what each tenant role can see/do per module
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").notNull(),
  module: varchar("module", { length: 50 }).notNull(),
  canView: integer("can_view").default(1),
  canCreate: integer("can_create").default(0),
  canEdit: integer("can_edit").default(0),
  canDelete: integer("can_delete").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, updatedAt: true });
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

// Multi-tenant: Sub-tenants (branches) — explicit sub-tenant relationship table
// Hierarchy: Superadmin (Arcádia) → Partners → Tenants → Sub-tenants (branches)
export const subTenants = pgTable("sub_tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentTenantId: varchar("parent_tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  isActive: integer("is_active").default(1),
  settings: jsonb("settings").$type<Record<string, any>>().default({}),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
// Clients table
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  company: varchar("company", { length: 255 }),
  industry: varchar("industry", { length: 100 }),
  website: varchar("website", { length: 255 }),
  address: text("address"),
  notes: text("notes"),
  logoUrl: varchar("logo_url", { length: 500 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Projects table
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  history: text("history"), // Rich text content for project history (HTML)
  status: projectStatusEnum("status").default('backlog').notNull(),
  type: varchar("type", { length: 20 }).default('compass').notNull(), // 'compass' (demanda do Canvas) | 'external' (projeto Scrum criado a partir de demanda aprovada)
  compassProjectId: varchar("compass_project_id"), // Em projetos type='external': aponta para a demanda (type='compass') que originou
  linkedProjectId: varchar("linked_project_id"), // Em demandas (type='compass'): aponta para o projeto Scrum (type='external') criado ao aprovar
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  managerId: varchar("manager_id").references(() => users.id),
  startDate: timestamp("start_date"),
  dueDate: timestamp("due_date"),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Project team members (many-to-many)
export const projectMembers = pgTable("project_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  role: varchar("role", { length: 50 }).default('tecnico'),
  assignedAt: timestamp("assigned_at").defaultNow(),
});

// Canvas blocks (9 BMC blocks with expanded diagnostic)
export const canvasBlocks = pgTable("canvas_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  blockType: varchar("block_type", { length: 50 }).notNull(), // proposta_valor, segmentos, canais, relacionamento, receita, recursos, atividades, parcerias, custos
  level: canvasLevelEnum("level").default('intencao').notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  questions: jsonb("questions").$type<string[]>().default([]),
  insights: jsonb("insights").$type<string[]>().default([]),
  completeness: integer("completeness").default(0), // 0-100
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Project Files - File Manager for client projects
// Estendido pela Central de Produção evolução (campos: tenantId, subprojectId, taskId,
// extractedText, categoria) — backward-compatible (todas as novas colunas são nullable).
export const projectFiles = pgTable("project_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  tenantId: varchar("tenant_id").notNull(), // multi-tenant isolation no Drive
  subprojectId: varchar("subproject_id"), // FK lógica → subprojects.id (resolvida em runtime)
  taskId: varchar("task_id"), // FK lógica → tasks.id (link Drive ↔ Tarefa)
  fileName: varchar("file_name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }), // document, spreadsheet, presentation, pdf, video, audio, ofx, image, other
  mimeType: varchar("mime_type", { length: 255 }),
  fileSize: integer("file_size").default(0), // In bytes
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  description: text("description"),
  folder: varchar("folder", { length: 255 }).default('/'),
  // Texto extraído automaticamente (pdf-parse | mammoth | xlsx) — usado pelo Agente Scrum
  extractedText: text("extracted_text"),
  // documento|planilha|imagem|requisitos|contrato|reuniao|outros
  categoria: varchar("categoria", { length: 50 }).default("documento"),
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxPfProject: index("idx_pf_project").on(t.projectId),
  idxPfTask: index("idx_pf_task").on(t.taskId),
  idxPfTenant: index("idx_pf_tenant").on(t.tenantId),
}));

// Process variant type enum
export const processVariantTypeEnum = pgEnum('process_variant_type', ['as_is', 'to_be']);

// Process mapping
export const processes = pgTable("processes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  status: varchar("status", { length: 50 }).default('identified'),
  priority: integer("priority").default(0),
  isAutomatable: integer("is_automatable").default(0), // 0 = no, 1 = yes
  notes: text("notes"),
  variantType: processVariantTypeEnum("variant_type").default('as_is'), // AS-IS or TO-BE
  linkedVariantId: varchar("linked_variant_id"), // Links AS-IS to its TO-BE version
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process steps (for flow diagram)
export const processSteps = pgTable("process_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  stepType: varchar("step_type", { length: 50 }).default('action'), // start, action, decision, end
  order: integer("order").default(0),
  responsible: varchar("responsible", { length: 255 }),
  responsibleCollaboratorId: varchar("responsible_collaborator_id"), // Link to collaborator
  duration: varchar("duration", { length: 100 }),
  tools: text("tools"),
  notes: text("notes"),
  linkedProcessId: varchar("linked_process_id").references(() => processes.id), // Link to another process
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process step files (attachments)
export const processStepFiles = pgTable("process_step_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stepId: varchar("step_id").references(() => processSteps.id, { onDelete: "cascade" }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }),
  fileSize: integer("file_size"),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

// Process diagrams (React Flow nodes and edges)
export const processDiagrams = pgTable("process_diagrams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "cascade" }).notNull().unique(),
  nodes: jsonb("nodes").default([]),
  edges: jsonb("edges").default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process diagram versions (history)
export const processDiagramVersions = pgTable("process_diagram_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "cascade" }).notNull(),
  version: integer("version").notNull(),
  nodes: jsonb("nodes").default([]),
  edges: jsonb("edges").default([]),
  changelog: text("changelog"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Severity enum for diagnostics
export const diagnosticSeverityEnum = pgEnum('diagnostic_severity', ['low', 'medium', 'high', 'critical']);

// PDCA status enum
export const pdcaStatusEnum = pgEnum('pdca_status', ['plan', 'do', 'check', 'act', 'done']);

// Process step diagnostics (pain points and opportunities)
export const processStepDiagnostics = pgTable("process_step_diagnostics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stepId: varchar("step_id").references(() => processSteps.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // pain_point, opportunity
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  severity: diagnosticSeverityEnum("severity").default('medium'),
  impact: text("impact"), // Business impact description
  causes: text("causes"), // Root causes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process recommendations (linked to diagnostics)
export const processRecommendations = pgTable("process_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "cascade" }).notNull(),
  diagnosticId: varchar("diagnostic_id").references(() => processStepDiagnostics.id, { onDelete: "set null" }),
  linkedToBeStepId: varchar("linked_to_be_step_id"), // Links to step in TO-BE process
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  expectedBenefit: text("expected_benefit"),
  effort: varchar("effort", { length: 50 }), // low, medium, high
  priority: integer("priority").default(0),
  status: varchar("status", { length: 50 }).default('proposed'), // proposed, approved, implemented
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process KPIs
export const processKpis = pgTable("process_kpis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 50 }), // %, hours, days, R$, count
  currentValue: varchar("current_value", { length: 100 }), // AS-IS baseline
  targetValue: varchar("target_value", { length: 100 }), // TO-BE target
  projectedGain: varchar("projected_gain", { length: 100 }), // Expected improvement
  frequency: varchar("frequency", { length: 50 }), // daily, weekly, monthly
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process step system mappings (ERP/CRM modules)
export const processStepSystems = pgTable("process_step_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stepId: varchar("step_id").references(() => processSteps.id, { onDelete: "cascade" }).notNull(),
  systemType: varchar("system_type", { length: 50 }).notNull(), // erp, crm, other
  moduleName: varchar("module_name", { length: 255 }).notNull(), // e.g., Financeiro, Comercial, RH
  functionality: varchar("functionality", { length: 255 }), // Specific function within module
  integrationNotes: text("integration_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Process step PDCA items (for TO-BE steps only)
export const processStepPdca = pgTable("process_step_pdca", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stepId: varchar("step_id").references(() => processSteps.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: pdcaStatusEnum("status").default('plan').notNull(),
  priority: integer("priority").default(0), // 0-5 scale
  responsible: varchar("responsible", { length: 255 }),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  planNotes: text("plan_notes"),
  doNotes: text("do_notes"),
  checkNotes: text("check_notes"),
  actNotes: text("act_notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Reusable recommendations library (Phase 3)
export const reusableRecommendations = pgTable("reusable_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // automation, integration, process_improvement
  tags: jsonb("tags").$type<string[]>().default([]),
  expectedBenefit: text("expected_benefit"),
  applicableModules: jsonb("applicable_modules").$type<string[]>().default([]), // ERP/CRM modules
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Process templates (TO-BE best practices - Phase 3)
export const processTemplates = pgTable("process_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // vendas, financeiro, rh, etc.
  industry: varchar("industry", { length: 100 }), // retail, manufacturing, services
  steps: jsonb("steps").$type<{ name: string; description: string; stepType: string; order: number }[]>().default([]),
  diagramNodes: jsonb("diagram_nodes").default([]),
  diagramEdges: jsonb("diagram_edges").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Client contacts
export const clientContacts = pgTable("client_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  position: varchar("position", { length: 255 }),
  department: varchar("department", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  mobile: varchar("mobile", { length: 50 }),
  isPrimary: integer("is_primary").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Collaborators (organization employees with hierarchy for org chart)
export const collaborators = pgTable("collaborators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  managerId: varchar("manager_id"), // Self-referential for hierarchy
  name: varchar("name", { length: 255 }).notNull(),
  position: varchar("position", { length: 255 }),
  department: varchar("department", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  mobile: varchar("mobile", { length: 50 }),
  photoUrl: varchar("photo_url", { length: 500 }),
  notes: text("notes"),
  isActive: integer("is_active").default(1), // 0 = inactive, 1 = active
  canParticipateInProjects: integer("can_participate_in_projects").default(0), // 0 = no, 1 = yes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Project collaborators (many-to-many between projects and client collaborators)
export const projectCollaborators = pgTable("project_collaborators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  collaboratorId: varchar("collaborator_id").references(() => collaborators.id, { onDelete: "cascade" }).notNull(),
  permission: varchar("permission", { length: 20 }).default('view').notNull(), // 'view' or 'edit'
  assignedAt: timestamp("assigned_at").defaultNow(),
});

// Process collaborators (marks which project collaborators participate in a process)
export const processCollaborators = pgTable("process_collaborators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "cascade" }).notNull(),
  collaboratorId: varchar("collaborator_id").references(() => collaborators.id, { onDelete: "cascade" }).notNull(),
  participates: integer("participates").default(1).notNull(), // 1 = yes, 0 = no
  role: varchar("role", { length: 255 }), // optional role in this process
  assignedAt: timestamp("assigned_at").defaultNow(),
});

// Deliverables (Canvas Real, Canvas Sistêmico, Lacunas, Roadmap)
export const deliverables = pgTable("deliverables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // canvas_real, canvas_sistemico, lacunas, roadmap
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  data: jsonb("data"),
  status: varchar("status", { length: 50 }).default('draft'),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tasks (for Kanban)
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  subprojectId: varchar("subproject_id"), // Optional FK to subprojects (added by Central de Produção evolução)
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  entregavel: text("entregavel"), // What is expected as output of the task (used by Agente Scrum)
  status: varchar("status", { length: 50 }).default('todo').notNull(),
  priority: integer("priority").default(0),
  assigneeId: varchar("assignee_id").references(() => users.id),
  collaboratorId: varchar("collaborator_id"), // Link to client collaborator
  dueDate: timestamp("due_date"),
  order: integer("order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Enums
export const crmLeadStatusEnum = pgEnum('crm_lead_status', ['new', 'contacted', 'qualified', 'unqualified', 'converted']);
export const crmOpportunityStatusEnum = pgEnum('crm_opportunity_status', ['open', 'won', 'lost']);
export const crmActivityTypeEnum = pgEnum('crm_activity_type', ['call', 'email', 'meeting', 'task', 'note']);

// CRM Pipeline Stages
export const crmPipelineStages = pgTable("crm_pipeline_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 50 }).default('#3b82f6'),
  order: integer("order").default(0),
  probability: integer("probability").default(0), // 0-100% chance of closing
  isDefault: integer("is_default").default(0), // 1 = default stage for new opportunities
  isWon: integer("is_won").default(0), // 1 = marks as won
  isLost: integer("is_lost").default(0), // 1 = marks as lost
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Leads
export const crmLeads = pgTable("crm_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  company: varchar("company", { length: 255 }),
  position: varchar("position", { length: 255 }),
  industry: varchar("industry", { length: 100 }),
  source: varchar("source", { length: 100 }), // website, referral, cold_call, event, etc.
  status: crmLeadStatusEnum("status").default('new').notNull(),
  notes: text("notes"),
  estimatedValue: integer("estimated_value"), // Potential deal value
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  convertedToClientId: varchar("converted_to_client_id").references(() => clients.id),
  convertedToOpportunityId: varchar("converted_to_opportunity_id"),
  convertedAt: timestamp("converted_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Opportunities
export const crmOpportunities = pgTable("crm_opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  clientId: varchar("client_id").references(() => clients.id),
  leadId: varchar("lead_id").references(() => crmLeads.id),
  stageId: varchar("stage_id").references(() => crmPipelineStages.id),
  status: crmOpportunityStatusEnum("status").default('open').notNull(),
  value: integer("value"), // Deal value in cents
  currency: varchar("currency", { length: 10 }).default('BRL'),
  probability: integer("probability").default(50), // 0-100%
  expectedCloseDate: timestamp("expected_close_date"),
  actualCloseDate: timestamp("actual_close_date"),
  lostReason: text("lost_reason"),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id), // Link to project when won
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Activities
export const crmActivities = pgTable("crm_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: crmActivityTypeEnum("type").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  description: text("description"),
  leadId: varchar("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").references(() => clients.id),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  isCompleted: integer("is_completed").default(0),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Relations
export const crmPipelineStagesRelations = relations(crmPipelineStages, ({ many }) => ({
  opportunities: many(crmOpportunities),
}));

export const crmLeadsRelations = relations(crmLeads, ({ one, many }) => ({
  assignedTo: one(users, {
    fields: [crmLeads.assignedToId],
    references: [users.id],
    relationName: 'leadAssignee',
  }),
  createdBy: one(users, {
    fields: [crmLeads.createdById],
    references: [users.id],
    relationName: 'leadCreator',
  }),
  convertedClient: one(clients, {
    fields: [crmLeads.convertedToClientId],
    references: [clients.id],
  }),
  activities: many(crmActivities),
  opportunities: many(crmOpportunities),
}));

export const crmOpportunitiesRelations = relations(crmOpportunities, ({ one, many }) => ({
  client: one(clients, {
    fields: [crmOpportunities.clientId],
    references: [clients.id],
  }),
  lead: one(crmLeads, {
    fields: [crmOpportunities.leadId],
    references: [crmLeads.id],
  }),
  stage: one(crmPipelineStages, {
    fields: [crmOpportunities.stageId],
    references: [crmPipelineStages.id],
  }),
  assignedTo: one(users, {
    fields: [crmOpportunities.assignedToId],
    references: [users.id],
    relationName: 'opportunityAssignee',
  }),
  createdBy: one(users, {
    fields: [crmOpportunities.createdById],
    references: [users.id],
    relationName: 'opportunityCreator',
  }),
  project: one(projects, {
    fields: [crmOpportunities.projectId],
    references: [projects.id],
  }),
  activities: many(crmActivities),
}));

export const crmActivitiesRelations = relations(crmActivities, ({ one }) => ({
  lead: one(crmLeads, {
    fields: [crmActivities.leadId],
    references: [crmLeads.id],
  }),
  opportunity: one(crmOpportunities, {
    fields: [crmActivities.opportunityId],
    references: [crmOpportunities.id],
  }),
  client: one(clients, {
    fields: [crmActivities.clientId],
    references: [clients.id],
  }),
  assignedTo: one(users, {
    fields: [crmActivities.assignedToId],
    references: [users.id],
    relationName: 'activityAssignee',
  }),
  createdBy: one(users, {
    fields: [crmActivities.createdById],
    references: [users.id],
    relationName: 'activityCreator',
  }),
}));

// CRM Proposal Enums
export const crmProposalStatusEnum = pgEnum('crm_proposal_status', ['draft', 'sent', 'negotiation', 'approved', 'rejected', 'expired']);
export const crmContractStatusEnum = pgEnum('crm_contract_status', ['draft', 'pending_signature', 'active', 'completed', 'cancelled']);
export const crmPartnerTypeEnum = pgEnum('crm_partner_type', ['referral', 'service', 'reseller', 'affiliate']);
export const crmPartnerStatusEnum = pgEnum('crm_partner_status', ['active', 'inactive', 'pending']);

// CRM Proposals
export const crmProposals = pgTable("crm_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  number: varchar("number", { length: 50 }).notNull(),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id),
  clientId: varchar("client_id").references(() => clients.id),
  projectId: varchar("project_id").references(() => projects.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: crmProposalStatusEnum("status").default('draft').notNull(),
  totalValue: integer("total_value"),
  currency: varchar("currency", { length: 10 }).default('BRL'),
  validUntil: timestamp("valid_until"),
  sentAt: timestamp("sent_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  terms: text("terms"),
  notes: text("notes"),
  partnerId: varchar("partner_id"),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Proposal Items (Scope Items)
export const crmProposalItems = pgTable("crm_proposal_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").references(() => crmProposals.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).default('service'),
  quantity: integer("quantity").default(1),
  unitPrice: integer("unit_price"),
  totalPrice: integer("total_price"),
  estimatedHours: integer("estimated_hours"),
  order: integer("order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Contracts
export const crmContracts = pgTable("crm_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  number: varchar("number", { length: 50 }).notNull(),
  proposalId: varchar("proposal_id").references(() => crmProposals.id),
  opportunityId: varchar("opportunity_id").references(() => crmOpportunities.id),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: crmContractStatusEnum("status").default('draft').notNull(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  totalValue: integer("total_value"),
  currency: varchar("currency", { length: 10 }).default('BRL'),
  signedAt: timestamp("signed_at"),
  terms: text("terms"),
  projectId: varchar("project_id").references(() => projects.id),
  scrumProjectId: varchar("scrum_project_id"),
  partnerId: varchar("partner_id"),
  partnerCommissionRate: integer("partner_commission_rate"),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Partners
export const crmPartners = pgTable("crm_partners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  company: varchar("company", { length: 255 }),
  type: crmPartnerTypeEnum("type").default('referral').notNull(),
  status: crmPartnerStatusEnum("status").default('pending').notNull(),
  defaultCommissionRate: integer("default_commission_rate").default(10),
  notes: text("notes"),
  portalUserId: varchar("portal_user_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Partner Commissions
export const crmPartnerCommissions = pgTable("crm_partner_commissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  partnerId: varchar("partner_id").references(() => crmPartners.id, { onDelete: "cascade" }).notNull(),
  contractId: varchar("contract_id").references(() => crmContracts.id, { onDelete: "cascade" }),
  proposalId: varchar("proposal_id").references(() => crmProposals.id, { onDelete: "set null" }),
  amount: integer("amount").notNull(),
  rate: integer("rate"),
  status: varchar("status", { length: 50 }).default('pending'),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// CRM Contract Milestones
export const crmContractMilestones = pgTable("crm_contract_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").references(() => crmContracts.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  amount: integer("amount"),
  status: varchar("status", { length: 50 }).default('pending'),
  order: integer("order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CRM Proposal Relations
export const crmProposalsRelations = relations(crmProposals, ({ one, many }) => ({
  opportunity: one(crmOpportunities, {
    fields: [crmProposals.opportunityId],
    references: [crmOpportunities.id],
  }),
  client: one(clients, {
    fields: [crmProposals.clientId],
    references: [clients.id],
  }),
  assignedTo: one(users, {
    fields: [crmProposals.assignedToId],
    references: [users.id],
    relationName: 'proposalAssignee',
  }),
  createdBy: one(users, {
    fields: [crmProposals.createdById],
    references: [users.id],
    relationName: 'proposalCreator',
  }),
  items: many(crmProposalItems),
  contracts: many(crmContracts),
}));

export const crmProposalItemsRelations = relations(crmProposalItems, ({ one }) => ({
  proposal: one(crmProposals, {
    fields: [crmProposalItems.proposalId],
    references: [crmProposals.id],
  }),
}));

export const crmContractsRelations = relations(crmContracts, ({ one, many }) => ({
  proposal: one(crmProposals, {
    fields: [crmContracts.proposalId],
    references: [crmProposals.id],
  }),
  opportunity: one(crmOpportunities, {
    fields: [crmContracts.opportunityId],
    references: [crmOpportunities.id],
  }),
  client: one(clients, {
    fields: [crmContracts.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [crmContracts.projectId],
    references: [projects.id],
  }),
  assignedTo: one(users, {
    fields: [crmContracts.assignedToId],
    references: [users.id],
    relationName: 'contractAssignee',
  }),
  createdBy: one(users, {
    fields: [crmContracts.createdById],
    references: [users.id],
    relationName: 'contractCreator',
  }),
  milestones: many(crmContractMilestones),
  commissions: many(crmPartnerCommissions),
}));

export const crmContractMilestonesRelations = relations(crmContractMilestones, ({ one }) => ({
  contract: one(crmContracts, {
    fields: [crmContractMilestones.contractId],
    references: [crmContracts.id],
  }),
}));

export const crmPartnersRelations = relations(crmPartners, ({ one, many }) => ({
  portalUser: one(users, {
    fields: [crmPartners.portalUserId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [crmPartners.createdById],
    references: [users.id],
    relationName: 'partnerCreator',
  }),
  commissions: many(crmPartnerCommissions),
}));

export const crmPartnerCommissionsRelations = relations(crmPartnerCommissions, ({ one }) => ({
  partner: one(crmPartners, {
    fields: [crmPartnerCommissions.partnerId],
    references: [crmPartners.id],
  }),
  contract: one(crmContracts, {
    fields: [crmPartnerCommissions.contractId],
    references: [crmContracts.id],
  }),
  proposal: one(crmProposals, {
    fields: [crmPartnerCommissions.proposalId],
    references: [crmProposals.id],
  }),
}));

// SWOT Analysis enums
export const swotTypeEnum = pgEnum('swot_type', ['strength', 'weakness', 'opportunity', 'threat']);
export const swotPriorityEnum = pgEnum('swot_priority', ['high', 'medium', 'low']);
export const swotStatusEnum = pgEnum('swot_status', ['identified', 'in_analysis', 'action_defined', 'completed']);

// SWOT Analysis - main table per project
export const swotAnalyses = pgTable("swot_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  industry: varchar("industry", { length: 100 }), // Setor para análise setorial
  analysisDate: timestamp("analysis_date").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
  status: varchar("status", { length: 50 }).default('draft'), // draft, in_progress, completed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// SWOT Items - individual items within a SWOT analysis
export const swotItems = pgTable("swot_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  analysisId: varchar("analysis_id").references(() => swotAnalyses.id, { onDelete: "cascade" }).notNull(),
  type: swotTypeEnum("type").notNull(), // strength, weakness, opportunity, threat
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priority: swotPriorityEnum("priority").default('medium'),
  status: swotStatusEnum("status").default('identified'),
  impact: integer("impact").default(3), // 1-5 scale
  probability: integer("probability").default(3), // 1-5 scale (for O/T)
  order: integer("order").default(0),
  // PDCA integration fields
  pdcaStatus: varchar("pdca_status", { length: 50 }).default('plan'), // plan, do, check, act
  actionPlan: text("action_plan"),
  actionDueDate: timestamp("action_due_date"),
  actionAssigneeId: varchar("action_assignee_id").references(() => users.id),
  actionResult: text("action_result"),
  // Linking to other modules
  linkedCanvasBlockId: varchar("linked_canvas_block_id"),
  linkedProcessId: varchar("linked_process_id"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  managedProjects: many(projects, { relationName: 'manager' }),
  projectMemberships: many(projectMembers),
  createdClients: many(clients),
  assignedTasks: many(tasks),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [clients.createdById],
    references: [users.id],
  }),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  manager: one(users, {
    fields: [projects.managerId],
    references: [users.id],
    relationName: 'manager',
  }),
  members: many(projectMembers),
  canvasBlocks: many(canvasBlocks),
  processes: many(processes),
  deliverables: many(deliverables),
  tasks: many(tasks),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const canvasBlocksRelations = relations(canvasBlocks, ({ one }) => ({
  project: one(projects, {
    fields: [canvasBlocks.projectId],
    references: [projects.id],
  }),
}));

export const processesRelations = relations(processes, ({ one, many }) => ({
  project: one(projects, {
    fields: [processes.projectId],
    references: [projects.id],
  }),
  steps: many(processSteps),
}));

export const processStepsRelations = relations(processSteps, ({ one, many }) => ({
  process: one(processes, {
    fields: [processSteps.processId],
    references: [processes.id],
  }),
  files: many(processStepFiles),
  pdcaItems: many(processStepPdca),
}));

export const processStepPdcaRelations = relations(processStepPdca, ({ one }) => ({
  step: one(processSteps, {
    fields: [processStepPdca.stepId],
    references: [processSteps.id],
  }),
  createdBy: one(users, {
    fields: [processStepPdca.createdById],
    references: [users.id],
  }),
}));

export const processStepFilesRelations = relations(processStepFiles, ({ one }) => ({
  step: one(processSteps, {
    fields: [processStepFiles.stepId],
    references: [processSteps.id],
  }),
  uploadedBy: one(users, {
    fields: [processStepFiles.uploadedById],
    references: [users.id],
  }),
}));

export const processDiagramsRelations = relations(processDiagrams, ({ one }) => ({
  process: one(processes, {
    fields: [processDiagrams.processId],
    references: [processes.id],
  }),
}));

export const processDiagramVersionsRelations = relations(processDiagramVersions, ({ one }) => ({
  process: one(processes, {
    fields: [processDiagramVersions.processId],
    references: [processes.id],
  }),
  createdBy: one(users, {
    fields: [processDiagramVersions.createdById],
    references: [users.id],
  }),
}));

export const processStepDiagnosticsRelations = relations(processStepDiagnostics, ({ one, many }) => ({
  step: one(processSteps, {
    fields: [processStepDiagnostics.stepId],
    references: [processSteps.id],
  }),
  recommendations: many(processRecommendations),
}));

export const processRecommendationsRelations = relations(processRecommendations, ({ one }) => ({
  process: one(processes, {
    fields: [processRecommendations.processId],
    references: [processes.id],
  }),
  diagnostic: one(processStepDiagnostics, {
    fields: [processRecommendations.diagnosticId],
    references: [processStepDiagnostics.id],
  }),
}));

export const processKpisRelations = relations(processKpis, ({ one }) => ({
  process: one(processes, {
    fields: [processKpis.processId],
    references: [processes.id],
  }),
}));

export const processStepSystemsRelations = relations(processStepSystems, ({ one }) => ({
  step: one(processSteps, {
    fields: [processStepSystems.stepId],
    references: [processSteps.id],
  }),
}));

export const deliverablesRelations = relations(deliverables, ({ one }) => ({
  project: one(projects, {
    fields: [deliverables.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [deliverables.createdById],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
  }),
}));

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  client: one(clients, {
    fields: [clientContacts.clientId],
    references: [clients.id],
  }),
}));

export const collaboratorsRelations = relations(collaborators, ({ one, many }) => ({
  client: one(clients, {
    fields: [collaborators.clientId],
    references: [clients.id],
  }),
  manager: one(collaborators, {
    fields: [collaborators.managerId],
    references: [collaborators.id],
    relationName: 'manager',
  }),
  projectAssignments: many(projectCollaborators),
}));

export const projectCollaboratorsRelations = relations(projectCollaborators, ({ one }) => ({
  project: one(projects, {
    fields: [projectCollaborators.projectId],
    references: [projects.id],
  }),
  collaborator: one(collaborators, {
    fields: [projectCollaborators.collaboratorId],
    references: [collaborators.id],
  }),
}));

// SWOT Relations
export const swotAnalysesRelations = relations(swotAnalyses, ({ one, many }) => ({
  project: one(projects, {
    fields: [swotAnalyses.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [swotAnalyses.createdById],
    references: [users.id],
  }),
  items: many(swotItems),
}));

export const swotItemsRelations = relations(swotItems, ({ one }) => ({
  analysis: one(swotAnalyses, {
    fields: [swotItems.analysisId],
    references: [swotAnalyses.id],
  }),
  actionAssignee: one(users, {
    fields: [swotItems.actionAssigneeId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [swotItems.createdById],
    references: [users.id],
    relationName: 'swotItemCreator',
  }),
}));

// Canvas block questions (for diagnostic questions with answers and ratings)
export const canvasBlockQuestions = pgTable("canvas_block_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  blockId: varchar("block_id").references(() => canvasBlocks.id, { onDelete: "cascade" }).notNull(),
  questionText: text("question_text").notNull(),
  answer: text("answer"),
  rating: integer("rating"), // 0-10 scale
  notes: text("notes"),
  order: integer("order").default(0),
  isDefault: integer("is_default").default(0), // 1 = from template, 0 = custom
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Canvas PDCA items (Plan-Do-Check-Act cycle linked to canvas diagnostics)
export const canvasPdcaItems = pgTable("canvas_pdca_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  blockId: varchar("block_id").references(() => canvasBlocks.id, { onDelete: "set null" }),
  questionId: varchar("question_id").references(() => canvasBlockQuestions.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: pdcaStatusEnum("status").default('plan').notNull(),
  priority: integer("priority").default(0), // 0-5 scale
  responsible: varchar("responsible", { length: 255 }),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  planNotes: text("plan_notes"),
  doNotes: text("do_notes"),
  checkNotes: text("check_notes"),
  actNotes: text("act_notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ERP Adherence enums
export const erpAdherenceStatusEnum = pgEnum('erp_adherence_status', ['nativo', 'configuravel', 'customizavel', 'nao_atendido']);
export const erpPriorityEnum = pgEnum('erp_priority', ['alta', 'media', 'baixa']);

// ERP Adherence requirements (for ERP implementation assessment)
export const erpRequirements = pgTable("erp_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  processId: varchar("process_id").references(() => processes.id, { onDelete: "set null" }),
  requirement: varchar("requirement", { length: 500 }).notNull(),
  description: text("description"),
  erpModule: varchar("erp_module", { length: 100 }), // Financeiro, Contabil, Faturamento, Compras, Estoque, Producao, RH, CRM
  adherenceStatus: erpAdherenceStatusEnum("adherence_status").default('nao_atendido'),
  priority: erpPriorityEnum("priority").default('media'),
  customizationNotes: text("customization_notes"),
  estimatedEffort: varchar("estimated_effort", { length: 100 }), // hours/days
  processRedesignRequired: integer("process_redesign_required").default(0), // 0 = no, 1 = yes
  // PDCA integration fields
  pdcaStatus: varchar("pdca_status", { length: 50 }).default('plan'),
  recommendation: text("recommendation"),
  actionDueDate: timestamp("action_due_date"),
  actionAssigneeId: varchar("action_assignee_id").references(() => users.id),
  actionResult: text("action_result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ERP Modules catalog
export const erpModules = pgTable("erp_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }), // Operacional, Financeiro, RH, etc.
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// ERP Requirement Attachments (files linked to ERP requirements)
export const erpRequirementAttachments = pgTable("erp_requirement_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requirementId: varchar("requirement_id").references(() => erpRequirements.id, { onDelete: "cascade" }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }).notNull(), // pdf, image, word, excel, other
  fileUrl: varchar("file_url", { length: 1000 }).notNull(),
  fileSize: integer("file_size"), // in bytes
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ERP Parameterization Topics (checklist groups for ERP configuration)
export const erpParameterizationTopics = pgTable("erp_parameterization_topics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  erpModule: varchar("erp_module", { length: 100 }), // Same modules as requirements
  order: integer("order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ERP Parameterization Items (checklist items within topics)
export const erpParameterizationItems = pgTable("erp_parameterization_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  topicId: varchar("topic_id").references(() => erpParameterizationTopics.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isCompleted: integer("is_completed").default(0), // 0 = no, 1 = yes
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  notes: text("notes"),
  order: integer("order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PDCA KPIs (KPIs linked to PDCA cycles for tracking improvement)
export const pdcaKpis = pgTable("pdca_kpis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pdcaItemId: varchar("pdca_item_id"), // Can link to canvasPdcaItems or processStepPdca
  pdcaType: varchar("pdca_type", { length: 20 }).notNull(), // 'canvas' or 'process'
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 50 }), // %, hours, days, R$, count
  baselineValue: varchar("baseline_value", { length: 100 }), // Initial value at cycle start
  targetValue: varchar("target_value", { length: 100 }), // Target to achieve
  currentValue: varchar("current_value", { length: 100 }), // Latest measured value
  measurementFrequency: varchar("measurement_frequency", { length: 50 }), // daily, weekly, monthly
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PDCA KPI Measurements (historical tracking)
export const pdcaKpiMeasurements = pgTable("pdca_kpi_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kpiId: varchar("kpi_id").references(() => pdcaKpis.id, { onDelete: "cascade" }).notNull(),
  value: varchar("value", { length: 100 }).notNull(),
  measuredAt: timestamp("measured_at").defaultNow(),
  notes: text("notes"),
  measuredById: varchar("measured_by_id").references(() => users.id),
});

// Action logs for audit trail
export const actionLogs = pgTable("action_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: varchar("entity_type", { length: 50 }).notNull(), // pdca, process, canvas, project
  entityId: varchar("entity_id").notNull(),
  action: varchar("action", { length: 100 }).notNull(), // created, updated, status_changed, etc.
  details: jsonb("details").$type<Record<string, any>>(),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Help articles for documentation module
export const helpArticles = pgTable("help_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  content: text("content").notNull(),
  summary: text("summary"),
  category: varchar("category", { length: 100 }).notNull(),
  moduleKey: varchar("module_key", { length: 100 }),
  icon: varchar("icon", { length: 50 }),
  order: integer("order").default(0),
  isPublished: integer("is_published").default(1),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Report template type enum
export const reportTemplateTypeEnum = pgEnum('report_template_type', ['executive_summary', 'full_diagnostic', 'swot_report', 'process_analysis', 'canvas_report', 'custom']);

// Report configurations (saved report setups)
export const reportConfigurations = pgTable("report_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  templateType: reportTemplateTypeEnum("template_type").default('custom').notNull(),
  description: text("description"),
  // Sections to include (array of section keys)
  sections: jsonb("sections").$type<string[]>().default([]),
  // Section-specific options
  sectionOptions: jsonb("section_options").$type<Record<string, any>>().default({}),
  // Layout options
  layoutOptions: jsonb("layout_options").$type<{
    showCoverPage?: boolean;
    showTableOfContents?: boolean;
    showPageNumbers?: boolean;
    orientation?: 'portrait' | 'landscape';
  }>().default({}),
  // Filters
  filters: jsonb("filters").$type<{
    dateRange?: { start?: string; end?: string };
    canvasLevels?: string[];
    swotTypes?: string[];
    processVariants?: string[];
  }>().default({}),
  lastGeneratedAt: timestamp("last_generated_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Multi-tenant Relations
export const partnersRelations = relations(partners, ({ one, many }) => ({
  userId: one(users, {
    fields: [partners.userId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [partners.createdById],
    references: [users.id],
  }),
  tenants: many(tenants),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  partner: one(partners, {
    fields: [tenants.partnerId],
    references: [partners.id],
  }),
  createdBy: one(users, {
    fields: [tenants.createdById],
    references: [users.id],
  }),
  users: many(tenantUsers),
}));

export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantUsers.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tenantUsers.userId],
    references: [users.id],
  }),
}));

export const inviteTokensRelations = relations(inviteTokens, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inviteTokens.tenantId],
    references: [tenants.id],
  }),
  invitedBy: one(users, {
    fields: [inviteTokens.invitedBy],
    references: [users.id],
  }),
}));

// Relations for report configurations
export const reportConfigurationsRelations = relations(reportConfigurations, ({ one }) => ({
  project: one(projects, {
    fields: [reportConfigurations.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [reportConfigurations.createdById],
    references: [users.id],
  }),
}));

// Relations for canvas block questions
export const canvasBlockQuestionsRelations = relations(canvasBlockQuestions, ({ one, many }) => ({
  block: one(canvasBlocks, {
    fields: [canvasBlockQuestions.blockId],
    references: [canvasBlocks.id],
  }),
  pdcaItems: many(canvasPdcaItems),
}));

// Relations for canvas PDCA items
export const canvasPdcaItemsRelations = relations(canvasPdcaItems, ({ one }) => ({
  project: one(projects, {
    fields: [canvasPdcaItems.projectId],
    references: [projects.id],
  }),
  block: one(canvasBlocks, {
    fields: [canvasPdcaItems.blockId],
    references: [canvasBlocks.id],
  }),
  question: one(canvasBlockQuestions, {
    fields: [canvasPdcaItems.questionId],
    references: [canvasBlockQuestions.id],
  }),
  createdBy: one(users, {
    fields: [canvasPdcaItems.createdById],
    references: [users.id],
  }),
}));

// Multi-tenant Insert Schemas
export const insertPartnerSchema = createInsertSchema(partners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTenantUserSchema = createInsertSchema(tenantUsers).omit({
  id: true,
  joinedAt: true,
});

export const insertInviteTokenSchema = createInsertSchema(inviteTokens).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
});

export const insertSubTenantSchema = createInsertSchema(subTenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Insert schemas
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ===== Tenant AI Configurations (per-tenant LLM provider keys) =====
export const tenantAiConfigs = pgTable("tenant_ai_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // 'anthropic' | 'gemini' | 'kimi' | 'ollama'
  apiKeyEnc: text("api_key_enc"), // Encrypted via cryptoService (AES-256-GCM); null for ollama (local, no key needed)
  model: varchar("model", { length: 100 }),
  baseUrl: varchar("base_url", { length: 500 }), // Custom endpoint (Ollama, Azure-OpenAI, proxies)
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueTenantProvider: unique().on(table.tenantId, table.provider),
}));

export const insertTenantAiConfigSchema = createInsertSchema(tenantAiConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TenantAiConfig = typeof tenantAiConfigs.$inferSelect;
export type InsertTenantAiConfig = z.infer<typeof insertTenantAiConfigSchema>;

// ===== Platform AI Configurations (chaves de plataforma — superadmin only) =====
// Mesmo shape de tenantAiConfigs, sem tenantId. Sobrepõe env vars quando presente.
export const platformAiConfigs = pgTable("platform_ai_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 20 }).notNull().unique(),
  apiKeyEnc: text("api_key_enc"),
  model: varchar("model", { length: 100 }),
  baseUrl: varchar("base_url", { length: 500 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertPlatformAiConfigSchema = createInsertSchema(platformAiConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type PlatformAiConfig = typeof platformAiConfigs.$inferSelect;
export type InsertPlatformAiConfig = z.infer<typeof insertPlatformAiConfigSchema>;

// ===== MCP Hub Sprint 1 — OAuth connections + AI usage logs =====
// OAuth2 connections per tenant (Google, Microsoft, Slack, WhatsApp, etc.)
// Tokens are encrypted via cryptoService (AES-256-GCM) before persisting.
export const oauthConnections = pgTable("oauth_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  provider: varchar("provider", { length: 30 }).notNull(), // 'google' | 'microsoft' | 'slack' | 'whatsapp'
  accountEmail: varchar("account_email", { length: 300 }),
  accessTokenEnc: text("access_token_enc"), // Encrypted via cryptoService
  refreshTokenEnc: text("refresh_token_enc"), // Encrypted via cryptoService
  scopes: text("scopes").array(),
  expiresAt: timestamp("expires_at"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // 'active' | 'revoked' | 'expired'
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueTenantProvider: unique().on(table.tenantId, table.provider),
  idxTenantProvider: index("idx_oauth_conn_tenant_provider").on(table.tenantId, table.provider),
}));

export const insertOauthConnectionSchema = createInsertSchema(oauthConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OauthConnection = typeof oauthConnections.$inferSelect;
export type InsertOauthConnection = z.infer<typeof insertOauthConnectionSchema>;

// ===== MCP Hub Sprint 3 — Platform-level OAuth app credentials =====
// Stores the OAuth client_id + client_secret of the platform-owned OAuth app
// (not per-tenant). Configured by superadmin via UI; tenants then use this
// app to authorize their own accounts. Both fields encrypted via cryptoService.
export const platformOauthApps = pgTable("platform_oauth_apps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 30 }).notNull().unique(), // 'google' | 'microsoft' | ...
  clientIdEnc: text("client_id_enc").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  redirectUri: text("redirect_uri"), // optional override; default derived from REPLIT_DOMAINS
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PlatformOauthApp = typeof platformOauthApps.$inferSelect;

// AI usage logs — every LLM call goes through resolveProvider() and writes one row here.
// Powers consumption dashboard (Sprint 4) and audit of tenant vs platform pool usage.
export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id"),
  provider: varchar("provider", { length: 20 }).notNull(), // 'anthropic' | 'gemini' | 'kimi' | 'ollama'
  model: varchar("model", { length: 100 }).notNull(),
  source: varchar("source", { length: 20 }).notNull(), // 'tenant' | 'platform' | 'partner_api'
  tokensInput: integer("tokens_input").default(0).notNull(),
  tokensOutput: integer("tokens_output").default(0).notNull(),
  taskType: varchar("task_type", { length: 50 }), // 'super_agent' | 'agent_run' | 'embedding' | etc.
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  idxTenantCreated: index("idx_ai_usage_tenant_created").on(table.tenantId, table.createdAt),
  idxProviderSource: index("idx_ai_usage_provider_source").on(table.provider, table.source),
}));

export const insertAiUsageLogSchema = createInsertSchema(aiUsageLogs).omit({
  id: true,
  createdAt: true,
});

export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;

// ===== Code Explorer (Fase 5) — auditoria de leitura/edição via IDE web =====
// 1 registro por ação significativa do explorer (read/write/delete/revert/
// search/history). `metaJson` guarda payload contextual (query do search, ref
// do history, etc.). `sha` é o commit gerado em write/revert/delete (null em
// reads). `tenantId` e índices garantem isolamento e queries rápidas.
export const explorerAuditLog = pgTable("explorer_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id"),
  action: varchar("action", { length: 20 }).notNull(), // 'read' | 'write' | 'delete' | 'revert' | 'search' | 'history' | 'tree'
  filePath: varchar("file_path", { length: 1000 }),
  sha: varchar("sha", { length: 80 }),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  idxTenantCreated: index("idx_explorer_audit_tenant_created").on(table.tenantId, table.createdAt),
  idxTenantUser: index("idx_explorer_audit_tenant_user").on(table.tenantId, table.userId),
}));

export const insertExplorerAuditLogSchema = createInsertSchema(explorerAuditLog).omit({
  id: true,
  createdAt: true,
});

export type ExplorerAuditLog = typeof explorerAuditLog.$inferSelect;
export type InsertExplorerAuditLog = z.infer<typeof insertExplorerAuditLogSchema>;

// ===== Task #47 — LLM Orchestrator decisions (audit trail) =====
// Uma linha por execução de runWithOrchestration: registra qual provider foi
// efetivamente usado, em que tier da cascata, motivo da escolha e desfecho.
// Health check é em memória (sem persistência) — esta tabela é o histórico
// auditável das decisões do orquestrador.
export const llmDecisions = pgTable("llm_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  taskType: varchar("task_type", { length: 80 }).notNull(),
  providerUsed: varchar("provider_used", { length: 30 }).notNull(),
  modelUsed: varchar("model_used", { length: 100 }).notNull(),
  tier: integer("tier").notNull(), // 1 = primário; 2,3 = fallback
  wasLocal: integer("was_local").notNull().default(0), // 1 quando ollama
  reason: varchar("reason", { length: 200 }).notNull(), // primary_healthy | <prov>_unhealthy | tenant_budget_low | data_sensitive | force_local | emergency_local
  tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0),
  latencyMs: integer("latency_ms"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  qualityScore: integer("quality_score"),
  outcome: varchar("outcome", { length: 20 }).notNull(), // success | fallback_used | all_failed
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  idxTenantTask: index("idx_ld_tenant_task").on(table.tenantId, table.taskType),
  idxProvider: index("idx_ld_provider").on(table.providerUsed),
  idxCreated: index("idx_ld_created").on(table.createdAt),
}));

export const insertLlmDecisionSchema = createInsertSchema(llmDecisions).omit({
  id: true,
  createdAt: true,
});

export type LlmDecision = typeof llmDecisions.$inferSelect;
export type InsertLlmDecision = z.infer<typeof insertLlmDecisionSchema>;

// ===== MCP Hub Sprint 4 — Partner API keys (public /mcp/v1) =====
// Hash-only storage (HMAC-SHA-256 peppered with SESSION_SECRET).
// Plain key shown ONCE at creation time.
// `keyPrefix` is the first 8 chars for UX (lookup hint), never used for auth.
// `scopes` lists module names the key may invoke (e.g. ['control','google']).
export const partnerApiKeys = pgTable("partner_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(), // HMAC-SHA-256 hex
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  rateLimit: integer("rate_limit").notNull().default(60), // req/min
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdById: varchar("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  idxKeyHash: index("idx_partner_api_keys_hash").on(table.keyHash),
  idxTenant: index("idx_partner_api_keys_tenant").on(table.tenantId),
}));

export const insertPartnerApiKeySchema = createInsertSchema(partnerApiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
});

export type PartnerApiKey = typeof partnerApiKeys.$inferSelect;
export type InsertPartnerApiKey = z.infer<typeof insertPartnerApiKeySchema>;

// ===== Super Agent (Phase 3 — contextual conversational agent) =====
export const superAgentSessions = pgTable("super_agent_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").notNull(),
  projectId: varchar("project_id"), // nullable: null = global session
  agentId: varchar("agent_id"), // nullable: null = Super Agente Geral; otherwise references agentDefinitions.id
  title: varchar("title", { length: 200 }).notNull().default("Nova conversa"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  idxTenantUser: index("idx_super_agent_sessions_tenant_user").on(table.tenantId, table.userId),
  idxProject: index("idx_super_agent_sessions_project").on(table.projectId),
}));

export const superAgentMessages = pgTable("super_agent_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").references(() => superAgentSessions.id, { onDelete: "cascade" }), // Now nullable: messages may belong to taskAgentSessions instead
  taskSessionId: varchar("task_session_id"), // Optional FK to taskAgentSessions (Central de Produção evolução). Resolved at runtime to avoid forward-reference cycle.
  role: varchar("role", { length: 20 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  tokensInput: integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  idxSession: index("idx_super_agent_messages_session").on(table.sessionId, table.createdAt),
  idxTaskSession: index("idx_super_agent_messages_task_session").on(table.taskSessionId, table.createdAt),
}));

export type SuperAgentSession = typeof superAgentSessions.$inferSelect;
export type SuperAgentMessage = typeof superAgentMessages.$inferSelect;
export const insertSuperAgentSessionSchema = createInsertSchema(superAgentSessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSuperAgentMessageSchema = createInsertSchema(superAgentMessages).omit({ id: true, createdAt: true });
export type InsertSuperAgentSession = z.infer<typeof insertSuperAgentSessionSchema>;
export type InsertSuperAgentMessage = z.infer<typeof insertSuperAgentMessageSchema>;

export const insertCanvasBlockSchema = createInsertSchema(canvasBlocks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessSchema = createInsertSchema(processes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessStepSchema = createInsertSchema(processSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessDiagramSchema = createInsertSchema(processDiagrams).omit({
  id: true,
  updatedAt: true,
});

export const insertDeliverableSchema = createInsertSchema(deliverables).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  dueDate: z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      if (val instanceof Date) return val;
      if (typeof val === 'string') {
        const parsed = new Date(val);
        if (isNaN(parsed.getTime())) {
          return null; // Invalid date string becomes null
        }
        return parsed;
      }
      return null;
    },
    z.date().nullable().optional()
  ),
});

export const insertProjectMemberSchema = createInsertSchema(projectMembers).omit({
  id: true,
  assignedAt: true,
});

export const insertProcessStepFileSchema = createInsertSchema(processStepFiles).omit({
  id: true,
  uploadedAt: true,
});

export const insertClientContactSchema = createInsertSchema(clientContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCollaboratorSchema = createInsertSchema(collaborators).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectCollaboratorSchema = createInsertSchema(projectCollaborators).omit({
  id: true,
  assignedAt: true,
});

export const insertProcessCollaboratorSchema = createInsertSchema(processCollaborators).omit({
  id: true,
  assignedAt: true,
});

export const insertProcessDiagramVersionSchema = createInsertSchema(processDiagramVersions).omit({
  id: true,
  createdAt: true,
});

export const insertProcessStepDiagnosticSchema = createInsertSchema(processStepDiagnostics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessRecommendationSchema = createInsertSchema(processRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessKpiSchema = createInsertSchema(processKpis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessStepSystemSchema = createInsertSchema(processStepSystems).omit({
  id: true,
  createdAt: true,
});

export const insertReusableRecommendationSchema = createInsertSchema(reusableRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcessTemplateSchema = createInsertSchema(processTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCanvasBlockQuestionSchema = createInsertSchema(canvasBlockQuestions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCanvasPdcaItemSchema = createInsertSchema(canvasPdcaItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertProcessStepPdcaSchema = createInsertSchema(processStepPdca).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertErpRequirementSchema = createInsertSchema(erpRequirements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertErpModuleSchema = createInsertSchema(erpModules).omit({
  id: true,
  createdAt: true,
});

export const insertPdcaKpiSchema = createInsertSchema(pdcaKpis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPdcaKpiMeasurementSchema = createInsertSchema(pdcaKpiMeasurements).omit({
  id: true,
  measuredAt: true,
});

export const insertActionLogSchema = createInsertSchema(actionLogs).omit({
  id: true,
  createdAt: true,
});

export const insertHelpArticleSchema = createInsertSchema(helpArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertErpRequirementAttachmentSchema = createInsertSchema(erpRequirementAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertErpParameterizationTopicSchema = createInsertSchema(erpParameterizationTopics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertErpParameterizationItemSchema = createInsertSchema(erpParameterizationItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertSwotAnalysisSchema = createInsertSchema(swotAnalyses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  analysisDate: true,
});

export const insertSwotItemSchema = createInsertSchema(swotItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// CRM Insert Schemas
export const insertCrmPipelineStageSchema = createInsertSchema(crmPipelineStages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmLeadSchema = createInsertSchema(crmLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  convertedAt: true,
});

export const insertCrmOpportunitySchema = createInsertSchema(crmOpportunities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actualCloseDate: true,
});

export const insertCrmActivitySchema = createInsertSchema(crmActivities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertReportConfigurationSchema = createInsertSchema(reportConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastGeneratedAt: true,
});

// ==========================================
// SUPPORT & KNOWLEDGE BASE TABLES
// ==========================================

// Support Types (defines types of support that can generate tasks)
export const supportTypes = pgTable("support_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  generateTask: integer("generate_task").default(0), // 0 = no, 1 = yes
  defaultPriority: varchar("default_priority", { length: 50 }).default("medium"),
  slaHours: integer("sla_hours").default(24),
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// Support Tickets
export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  supportTypeId: varchar("support_type_id").references(() => supportTypes.id),
  generatedTaskId: varchar("generated_task_id").references(() => tasks.id),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).default("open"), // open, in_progress, waiting_client, resolved, closed
  priority: varchar("priority", { length: 50 }).default("medium"), // low, medium, high, urgent
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  createdByClientContactId: varchar("created_by_client_contact_id").references(() => clientContacts.id),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Ticket Comments/Messages
export const ticketComments = pgTable("ticket_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").references(() => supportTickets.id).notNull(),
  authorId: varchar("author_id").references(() => users.id),
  authorClientContactId: varchar("author_client_contact_id").references(() => clientContacts.id),
  authorType: varchar("author_type", { length: 50 }).default("consultant"), // consultant, client
  message: text("message").notNull(),
  isInternal: integer("is_internal").default(0), // Internal notes not visible to client
  createdAt: timestamp("created_at").defaultNow(),
});

// Knowledge Base Categories
export const knowledgeCategories = pgTable("knowledge_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  slug: varchar("slug", { length: 255 }).notNull(),
  parentId: varchar("parent_id"),
  icon: varchar("icon", { length: 100 }),
  order: integer("order").default(0),
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

// Knowledge Base Articles
export const knowledgeArticles = pgTable("knowledge_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").references(() => knowledgeCategories.id),
  title: varchar("title", { length: 500 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  content: text("content"),
  excerpt: text("excerpt"),
  authorId: varchar("author_id").references(() => users.id),
  status: varchar("status", { length: 50 }).default("draft"), // draft, published, archived
  accessLevel: varchar("access_level", { length: 50 }).default("public"), // public, members, premium
  viewCount: integer("view_count").default(0),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Training Content (Videos, Documents, etc.)
export const trainingContent = pgTable("training_content", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").references(() => knowledgeCategories.id),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  contentType: varchar("content_type", { length: 50 }).default("video"), // video, document, link, audio
  contentUrl: varchar("content_url", { length: 1000 }),
  thumbnailUrl: varchar("thumbnail_url", { length: 1000 }),
  duration: integer("duration"), // in seconds for videos
  accessLevel: varchar("access_level", { length: 50 }).default("members"), // public, members, premium
  order: integer("order").default(0),
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Client Memberships (what content each client has access to)
export const clientMemberships = pgTable("client_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  membershipType: varchar("membership_type", { length: 50 }).default("basic"), // basic, standard, premium
  accessLevel: varchar("access_level", { length: 50 }).default("members"), // members, premium
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date"),
  isActive: integer("is_active").default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Content Access Log (tracks what clients have viewed)
export const contentAccessLog = pgTable("content_access_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  clientContactId: varchar("client_contact_id").references(() => clientContacts.id),
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, training
  contentId: varchar("content_id").notNull(),
  accessedAt: timestamp("accessed_at").defaultNow(),
});

// Client Portal Access (login credentials for clients)
export const clientPortalAccess = pgTable("client_portal_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientContactId: varchar("client_contact_id").references(() => clientContacts.id).notNull(),
  passwordHash: varchar("password_hash"),
  isActive: integer("is_active").default(1),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// SCRUM MODULE (Central de Produção)
// ============================================

// Scrum Enums
export const scrumPbiStatusEnum = pgEnum('scrum_pbi_status', [
  'backlog',          // No backlog geral
  'selecionado',      // Selecionado para sprint
  'em_execucao',      // Em execução
  'em_revisao',       // Em revisão técnica
  'aguardando_validacao', // Aguardando validação do solicitante
  'concluido',        // Concluído
  'bloqueado',        // Bloqueado por impedimento
  'cancelado'         // Cancelado
]);

export const scrumPbiOriginEnum = pgEnum('scrum_pbi_origin', [
  'manual',           // Criado diretamente no Scrum
  'task',             // Originado de Tarefas
  'requirement',      // Originado de Requisitos ERP
  'support_ticket',   // Originado de Ticket de Suporte
  'canvas_pdca',      // Originado de PDCA do Canvas
  'process_pdca',     // Originado de PDCA de Processos
  'swot'              // Originado de SWOT
]);

export const scrumSprintStatusEnum = pgEnum('scrum_sprint_status', [
  'planning',         // Em planejamento
  'active',           // Sprint ativa
  'review',           // Em revisão
  'completed',        // Concluída
  'cancelled'         // Cancelada
]);

export const scrumPbiTypeEnum = pgEnum('scrum_pbi_type', [
  'feature',          // Nova funcionalidade
  'bug',              // Correção de bug
  'improvement',      // Melhoria
  'task',             // Tarefa genérica
  'support',          // Suporte/atendimento
  'analysis',         // Análise/diagnóstico
  'documentation',    // Documentação
  'training',         // Treinamento
  'meeting'           // Reunião
]);

export const scrumPbiPriorityEnum = pgEnum('scrum_pbi_priority', [
  'critical',         // Crítico - bloqueante
  'high',             // Alta
  'medium',           // Média
  'low'               // Baixa
]);

// Internal Projects for Scrum (projects without clients)
export const scrumInternalProjects = pgTable("scrum_internal_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Tenant explícito para projetos Scrum internos (sem clientProjectId).
  // Nullable para compatibilidade com registros legados criados antes desta coluna.
  // O middleware assertScrumInternalProjectTenantAccess usa tenantId quando presente,
  // cai para clientProjectId quando não, e tem fallback legado (tenantId=null + clientProjectId=null).
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  clientProjectId: varchar("client_project_id").references(() => projects.id), // Link to client project if applicable
  isInternal: integer("is_internal").default(1), // 1 = internal only, 0 = linked to client project
  status: varchar("status", { length: 50 }).default('active'), // active, paused, completed, archived
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  color: varchar("color", { length: 50 }).default('#3b82f6'), // For visual identification
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  // Garantir 1 internal_project por client_project_id (evita duplicação pelo Agente Scrum
  // em chamadas concorrentes). Índice parcial: NULL é permitido em vários registros.
  uniqClient: uniqueIndex("scrum_internal_projects_client_project_unique")
    .on(t.clientProjectId)
    .where(sql`${t.clientProjectId} IS NOT NULL`),
}));

// Scrum Teams/Squads
export const scrumTeams = pgTable("scrum_teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Isolamento por tenant (nullable p/ registros legados criados antes desta coluna).
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  leaderId: varchar("leader_id").references(() => users.id), // Tech lead or Scrum Master
  capacity: integer("capacity").default(40), // Weekly capacity in hours
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Scrum Team Members (with cost tracking)
export const scrumTeamMembers = pgTable("scrum_team_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id").references(() => scrumTeams.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  role: varchar("role", { length: 100 }).default('developer'), // developer, analyst, consultant, support, tester
  costPerHour: integer("cost_per_hour").default(0), // Cost in cents
  weeklyCapacity: integer("weekly_capacity").default(40), // Hours per week
  isActive: integer("is_active").default(1),
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
});

// Sprints
export const scrumSprints = pgTable("scrum_sprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  internalProjectId: varchar("internal_project_id").references(() => scrumInternalProjects.id),
  subprojectId: varchar("subproject_id"), // Optional FK to subprojects (Central de Produção evolução)
  teamId: varchar("team_id").references(() => scrumTeams.id),
  name: varchar("name", { length: 255 }).notNull(),
  goal: text("goal"), // Sprint goal
  status: scrumSprintStatusEnum("status").default('planning').notNull(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  plannedCapacity: integer("planned_capacity").default(0), // Hours planned
  committedPoints: integer("committed_points").default(0), // Story points committed
  completedPoints: integer("completed_points").default(0), // Story points completed
  velocity: integer("velocity").default(0), // Calculated velocity
  retrospectiveNotes: text("retrospective_notes"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Product Backlog Items (PBIs)
export const scrumBacklogItems = pgTable("scrum_backlog_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  internalProjectId: varchar("internal_project_id").references(() => scrumInternalProjects.id),
  subprojectId: varchar("subproject_id"), // Optional FK to subprojects (Central de Produção evolução)
  sprintId: varchar("sprint_id").references(() => scrumSprints.id), // Null if in backlog
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  type: scrumPbiTypeEnum("type").default('feature').notNull(),
  status: scrumPbiStatusEnum("status").default('backlog').notNull(),
  priority: scrumPbiPriorityEnum("priority").default('medium').notNull(),
  storyPoints: integer("story_points"), // Fibonacci: 1, 2, 3, 5, 8, 13, 21
  estimatedHours: integer("estimated_hours"),
  actualHours: integer("actual_hours").default(0), // Calculated from timesheets
  // Origin tracking
  originType: scrumPbiOriginEnum("origin_type").default('manual').notNull(),
  originId: varchar("origin_id"), // ID of the source item (task, requirement, ticket, etc.)
  originProjectId: varchar("origin_project_id").references(() => projects.id), // Client project if applicable
  // Assignment
  assigneeId: varchar("assignee_id").references(() => users.id),
  reporterId: varchar("reporter_id").references(() => users.id), // Who requested this
  // Dates
  dueDate: timestamp("due_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  // Ordering
  backlogOrder: integer("backlog_order").default(0),
  sprintOrder: integer("sprint_order").default(0),
  // Costs
  estimatedCost: integer("estimated_cost").default(0), // In cents
  actualCost: integer("actual_cost").default(0), // Calculated from timesheets
  // Flags
  isBlocked: integer("is_blocked").default(0),
  blockedReason: text("blocked_reason"),
  // Metadata
  tags: jsonb("tags").$type<string[]>().default([]),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Timesheets / Work Logs
export const scrumTimesheets = pgTable("scrum_timesheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pbiId: varchar("pbi_id").references(() => scrumBacklogItems.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  date: timestamp("date").notNull(),
  hoursWorked: integer("hours_worked").notNull(), // In minutes for precision
  description: text("description"),
  // Cost calculation
  costPerHour: integer("cost_per_hour").default(0), // Snapshot of user's rate at time of log
  calculatedCost: integer("calculated_cost").default(0), // In cents
  // Activity type
  activityType: varchar("activity_type", { length: 50 }).default('development'), // development, analysis, testing, meeting, support
  isBillable: integer("is_billable").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Backlog Item Attachments
export const scrumBacklogAttachments = pgTable("scrum_backlog_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pbiId: varchar("pbi_id").references(() => scrumBacklogItems.id, { onDelete: "cascade" }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 100 }),
  fileSize: integer("file_size").default(0), // In bytes
  storageKey: varchar("storage_key", { length: 500 }).notNull(), // Path in object storage
  uploadedById: varchar("uploaded_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Rework Tracking
export const scrumRework = pgTable("scrum_rework", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originalPbiId: varchar("original_pbi_id").references(() => scrumBacklogItems.id, { onDelete: "cascade" }).notNull(),
  reworkPbiId: varchar("rework_pbi_id").references(() => scrumBacklogItems.id), // New PBI created for rework
  reason: text("reason").notNull(), // Why rework was needed
  category: varchar("category", { length: 100 }).default('bug'), // bug, scope_change, client_feedback, quality_issue
  impactLevel: varchar("impact_level", { length: 50 }).default('medium'), // low, medium, high, critical
  hoursSpent: integer("hours_spent").default(0), // Additional hours for rework
  cost: integer("cost").default(0), // Additional cost in cents
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// Scrum Relations
export const scrumInternalProjectsRelations = relations(scrumInternalProjects, ({ one, many }) => ({
  clientProject: one(projects, {
    fields: [scrumInternalProjects.clientProjectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [scrumInternalProjects.createdById],
    references: [users.id],
  }),
  sprints: many(scrumSprints),
  backlogItems: many(scrumBacklogItems),
}));

export const scrumTeamsRelations = relations(scrumTeams, ({ one, many }) => ({
  leader: one(users, {
    fields: [scrumTeams.leaderId],
    references: [users.id],
  }),
  members: many(scrumTeamMembers),
  sprints: many(scrumSprints),
}));

export const scrumTeamMembersRelations = relations(scrumTeamMembers, ({ one }) => ({
  team: one(scrumTeams, {
    fields: [scrumTeamMembers.teamId],
    references: [scrumTeams.id],
  }),
  user: one(users, {
    fields: [scrumTeamMembers.userId],
    references: [users.id],
  }),
}));

export const scrumSprintsRelations = relations(scrumSprints, ({ one, many }) => ({
  internalProject: one(scrumInternalProjects, {
    fields: [scrumSprints.internalProjectId],
    references: [scrumInternalProjects.id],
  }),
  team: one(scrumTeams, {
    fields: [scrumSprints.teamId],
    references: [scrumTeams.id],
  }),
  createdBy: one(users, {
    fields: [scrumSprints.createdById],
    references: [users.id],
  }),
  backlogItems: many(scrumBacklogItems),
}));

export const scrumBacklogItemsRelations = relations(scrumBacklogItems, ({ one, many }) => ({
  internalProject: one(scrumInternalProjects, {
    fields: [scrumBacklogItems.internalProjectId],
    references: [scrumInternalProjects.id],
  }),
  sprint: one(scrumSprints, {
    fields: [scrumBacklogItems.sprintId],
    references: [scrumSprints.id],
  }),
  originProject: one(projects, {
    fields: [scrumBacklogItems.originProjectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [scrumBacklogItems.assigneeId],
    references: [users.id],
    relationName: 'pbiAssignee',
  }),
  reporter: one(users, {
    fields: [scrumBacklogItems.reporterId],
    references: [users.id],
    relationName: 'pbiReporter',
  }),
  createdBy: one(users, {
    fields: [scrumBacklogItems.createdById],
    references: [users.id],
    relationName: 'pbiCreator',
  }),
  timesheets: many(scrumTimesheets),
  reworkItems: many(scrumRework),
}));

export const scrumTimesheetsRelations = relations(scrumTimesheets, ({ one }) => ({
  pbi: one(scrumBacklogItems, {
    fields: [scrumTimesheets.pbiId],
    references: [scrumBacklogItems.id],
  }),
  user: one(users, {
    fields: [scrumTimesheets.userId],
    references: [users.id],
  }),
}));

export const scrumReworkRelations = relations(scrumRework, ({ one }) => ({
  originalPbi: one(scrumBacklogItems, {
    fields: [scrumRework.originalPbiId],
    references: [scrumBacklogItems.id],
    relationName: 'originalPbi',
  }),
  reworkPbi: one(scrumBacklogItems, {
    fields: [scrumRework.reworkPbiId],
    references: [scrumBacklogItems.id],
    relationName: 'reworkPbi',
  }),
  createdBy: one(users, {
    fields: [scrumRework.createdById],
    references: [users.id],
  }),
}));

// ─── PROD-2: Reuniões de projeto + ações ────────────────────────────────────
export const reunioesProjeto = pgTable("reunioes_projeto", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projetoId: varchar("projeto_id").references(() => scrumInternalProjects.id, { onDelete: "cascade" }).notNull(),
  numero: integer("numero").default(0),
  data: timestamp("data").notNull(),
  tipo: varchar("tipo", { length: 30 }).default("acompanhamento").notNull(), // kickoff, acompanhamento, sprint_review, retrospectiva, golive
  sprint: varchar("sprint", { length: 100 }),
  pautaJson: jsonb("pauta_json").$type<Array<{ titulo: string; descricao?: string; ordem?: number; tempoMin?: number }>>().default([]),
  anotacoes: text("anotacoes"),
  ataDocUrl: varchar("ata_doc_url", { length: 500 }),
  participantes: jsonb("participantes").$type<Array<{ nome: string; papel?: string; email?: string }>>().default([]),
  status: varchar("status", { length: 20 }).default("agendada").notNull(), // agendada, realizada, cancelada
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const acoesReuniao = pgTable("acoes_reuniao", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  reuniaoId: varchar("reuniao_id").references(() => reunioesProjeto.id, { onDelete: "cascade" }).notNull(),
  descricao: text("descricao").notNull(),
  responsavel: varchar("responsavel", { length: 200 }),
  prazo: timestamp("prazo"),
  status: varchar("status", { length: 20 }).default("pendente").notNull(), // pendente, concluida, cancelada
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const reunioesProjetoRelations = relations(reunioesProjeto, ({ one, many }) => ({
  projeto: one(scrumInternalProjects, {
    fields: [reunioesProjeto.projetoId],
    references: [scrumInternalProjects.id],
  }),
  acoes: many(acoesReuniao),
}));

export const acoesReuniaoRelations = relations(acoesReuniao, ({ one }) => ({
  reuniao: one(reunioesProjeto, {
    fields: [acoesReuniao.reuniaoId],
    references: [reunioesProjeto.id],
  }),
}));

export const insertReuniaoProjetoSchema = createInsertSchema(reunioesProjeto).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertReuniaoProjeto = z.infer<typeof insertReuniaoProjetoSchema>;
export type ReuniaoProjeto = typeof reunioesProjeto.$inferSelect;

export const insertAcaoReuniaoSchema = createInsertSchema(acoesReuniao).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertAcaoReuniao = z.infer<typeof insertAcaoReuniaoSchema>;
export type AcaoReuniao = typeof acoesReuniao.$inferSelect;

// Support Insert Schemas
export const insertSupportTypeSchema = createInsertSchema(supportTypes).omit({
  id: true,
  createdAt: true,
});

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
});

export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({
  id: true,
  createdAt: true,
});

export const insertKnowledgeCategorySchema = createInsertSchema(knowledgeCategories).omit({
  id: true,
  createdAt: true,
});

export const insertKnowledgeArticleSchema = createInsertSchema(knowledgeArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  viewCount: true,
});

export const insertTrainingContentSchema = createInsertSchema(trainingContent).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientMembershipSchema = createInsertSchema(clientMemberships).omit({
  id: true,
  createdAt: true,
});

export const insertContentAccessLogSchema = createInsertSchema(contentAccessLog).omit({
  id: true,
  accessedAt: true,
});

export const insertClientPortalAccessSchema = createInsertSchema(clientPortalAccess).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});

// Scrum Insert Schemas
export const insertScrumInternalProjectSchema = createInsertSchema(scrumInternalProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScrumTeamSchema = createInsertSchema(scrumTeams).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScrumTeamMemberSchema = createInsertSchema(scrumTeamMembers).omit({
  id: true,
  joinedAt: true,
});

export const insertScrumSprintSchema = createInsertSchema(scrumSprints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScrumBacklogItemSchema = createInsertSchema(scrumBacklogItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actualHours: true,
  actualCost: true,
});

export const insertScrumTimesheetSchema = createInsertSchema(scrumTimesheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScrumBacklogAttachmentSchema = createInsertSchema(scrumBacklogAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertScrumReworkSchema = createInsertSchema(scrumRework).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});

// CRM Proposals Insert Schemas
export const insertCrmProposalSchema = createInsertSchema(crmProposals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmProposalItemSchema = createInsertSchema(crmProposalItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmContractSchema = createInsertSchema(crmContracts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmContractMilestoneSchema = createInsertSchema(crmContractMilestones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmPartnerSchema = createInsertSchema(crmPartners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCrmPartnerCommissionSchema = createInsertSchema(crmPartnerCommissions).omit({
  id: true,
  createdAt: true,
});

// Multi-tenant Types
export type Partner = typeof partners.$inferSelect;
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = z.infer<typeof insertTenantUserSchema>;
export type TenantInvitation = never; // Deprecated, use InviteToken
export type InviteToken = typeof inviteTokens.$inferSelect;
export type InsertInviteToken = z.infer<typeof insertInviteTokenSchema>;
export type SubTenant = typeof subTenants.$inferSelect;
export type InsertSubTenant = z.infer<typeof insertSubTenantSchema>;
export type PartnerWithStats = Partner & { tenantCount: number };
export type TenantWithRelations = Tenant & { partner?: Partner; userCount: number; subTenantCount: number };

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type CanvasBlock = typeof canvasBlocks.$inferSelect;
export type InsertCanvasBlock = z.infer<typeof insertCanvasBlockSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type Process = typeof processes.$inferSelect;
export type InsertProcess = z.infer<typeof insertProcessSchema>;
export type ProcessStep = typeof processSteps.$inferSelect;
export type InsertProcessStep = z.infer<typeof insertProcessStepSchema>;
export type ProcessDiagram = typeof processDiagrams.$inferSelect;
export type InsertProcessDiagram = z.infer<typeof insertProcessDiagramSchema>;
export type Deliverable = typeof deliverables.$inferSelect;
export type InsertDeliverable = z.infer<typeof insertDeliverableSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProcessStepFile = typeof processStepFiles.$inferSelect;
export type InsertProcessStepFile = z.infer<typeof insertProcessStepFileSchema>;
export type ClientContact = typeof clientContacts.$inferSelect;
export type InsertClientContact = z.infer<typeof insertClientContactSchema>;
export type Collaborator = typeof collaborators.$inferSelect;
export type InsertCollaborator = z.infer<typeof insertCollaboratorSchema>;
export type ProjectCollaborator = typeof projectCollaborators.$inferSelect;
export type InsertProjectCollaborator = z.infer<typeof insertProjectCollaboratorSchema>;
export type ProcessCollaborator = typeof processCollaborators.$inferSelect;
export type InsertProcessCollaborator = z.infer<typeof insertProcessCollaboratorSchema>;
export type ProcessDiagramVersion = typeof processDiagramVersions.$inferSelect;
export type InsertProcessDiagramVersion = z.infer<typeof insertProcessDiagramVersionSchema>;
export type ProcessStepDiagnostic = typeof processStepDiagnostics.$inferSelect;
export type InsertProcessStepDiagnostic = z.infer<typeof insertProcessStepDiagnosticSchema>;
export type ProcessRecommendation = typeof processRecommendations.$inferSelect;
export type InsertProcessRecommendation = z.infer<typeof insertProcessRecommendationSchema>;
export type ProcessKpi = typeof processKpis.$inferSelect;
export type InsertProcessKpi = z.infer<typeof insertProcessKpiSchema>;
export type ProcessStepSystem = typeof processStepSystems.$inferSelect;
export type InsertProcessStepSystem = z.infer<typeof insertProcessStepSystemSchema>;
export type ReusableRecommendation = typeof reusableRecommendations.$inferSelect;
export type InsertReusableRecommendation = z.infer<typeof insertReusableRecommendationSchema>;
export type ProcessTemplate = typeof processTemplates.$inferSelect;
export type InsertProcessTemplate = z.infer<typeof insertProcessTemplateSchema>;
export type CanvasBlockQuestion = typeof canvasBlockQuestions.$inferSelect;
export type InsertCanvasBlockQuestion = z.infer<typeof insertCanvasBlockQuestionSchema>;
export type CanvasPdcaItem = typeof canvasPdcaItems.$inferSelect;
export type InsertCanvasPdcaItem = z.infer<typeof insertCanvasPdcaItemSchema>;
export type ProcessStepPdca = typeof processStepPdca.$inferSelect;
export type InsertProcessStepPdca = z.infer<typeof insertProcessStepPdcaSchema>;
export type ErpRequirement = typeof erpRequirements.$inferSelect;
export type InsertErpRequirement = z.infer<typeof insertErpRequirementSchema>;
export type ErpModule = typeof erpModules.$inferSelect;
export type InsertErpModule = z.infer<typeof insertErpModuleSchema>;
export type PdcaKpi = typeof pdcaKpis.$inferSelect;
export type InsertPdcaKpi = z.infer<typeof insertPdcaKpiSchema>;
export type PdcaKpiMeasurement = typeof pdcaKpiMeasurements.$inferSelect;
export type InsertPdcaKpiMeasurement = z.infer<typeof insertPdcaKpiMeasurementSchema>;
export type ActionLog = typeof actionLogs.$inferSelect;
export type InsertActionLog = z.infer<typeof insertActionLogSchema>;
export type HelpArticle = typeof helpArticles.$inferSelect;
export type InsertHelpArticle = z.infer<typeof insertHelpArticleSchema>;
export type ErpRequirementAttachment = typeof erpRequirementAttachments.$inferSelect;
export type InsertErpRequirementAttachment = z.infer<typeof insertErpRequirementAttachmentSchema>;
export type ErpParameterizationTopic = typeof erpParameterizationTopics.$inferSelect;
export type InsertErpParameterizationTopic = z.infer<typeof insertErpParameterizationTopicSchema>;
export type ErpParameterizationItem = typeof erpParameterizationItems.$inferSelect;
export type InsertErpParameterizationItem = z.infer<typeof insertErpParameterizationItemSchema>;
export type SwotAnalysis = typeof swotAnalyses.$inferSelect;
export type InsertSwotAnalysis = z.infer<typeof insertSwotAnalysisSchema>;
export type SwotItem = typeof swotItems.$inferSelect;
export type InsertSwotItem = z.infer<typeof insertSwotItemSchema>;
export type ReportConfiguration = typeof reportConfigurations.$inferSelect;
export type InsertReportConfiguration = z.infer<typeof insertReportConfigurationSchema>;

// CRM Types
export type CrmPipelineStage = typeof crmPipelineStages.$inferSelect;
export type InsertCrmPipelineStage = z.infer<typeof insertCrmPipelineStageSchema>;
export type CrmLead = typeof crmLeads.$inferSelect;
export type InsertCrmLead = z.infer<typeof insertCrmLeadSchema>;
export type CrmOpportunity = typeof crmOpportunities.$inferSelect;
export type InsertCrmOpportunity = z.infer<typeof insertCrmOpportunitySchema>;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type InsertCrmActivity = z.infer<typeof insertCrmActivitySchema>;
export type CrmProposal = typeof crmProposals.$inferSelect;
export type InsertCrmProposal = z.infer<typeof insertCrmProposalSchema>;
export type CrmProposalItem = typeof crmProposalItems.$inferSelect;
export type InsertCrmProposalItem = z.infer<typeof insertCrmProposalItemSchema>;
export type CrmContract = typeof crmContracts.$inferSelect;
export type InsertCrmContract = z.infer<typeof insertCrmContractSchema>;
export type CrmContractMilestone = typeof crmContractMilestones.$inferSelect;
export type InsertCrmContractMilestone = z.infer<typeof insertCrmContractMilestoneSchema>;
export type CrmPartner = typeof crmPartners.$inferSelect;
export type InsertCrmPartner = z.infer<typeof insertCrmPartnerSchema>;
export type CrmPartnerCommission = typeof crmPartnerCommissions.$inferSelect;
export type InsertCrmPartnerCommission = z.infer<typeof insertCrmPartnerCommissionSchema>;

// CRM Extended Types
export type CrmLeadWithRelations = CrmLead & {
  assignedTo?: User;
  activities?: CrmActivity[];
};

export type CrmOpportunityWithRelations = CrmOpportunity & {
  client?: Client;
  lead?: CrmLead;
  stage?: CrmPipelineStage;
  assignedTo?: User;
  activities?: CrmActivity[];
};

// Extended types for frontend
export type ProjectWithRelations = Project & {
  client?: Client;
  manager?: User;
  members?: (ProjectMember & { user?: User })[];
};

export type ClientWithRelations = Client & {
  createdBy?: User;
  projects?: Project[];
};

// Support & Knowledge Base Types
export type SupportType = typeof supportTypes.$inferSelect;
export type InsertSupportType = z.infer<typeof insertSupportTypeSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export type KnowledgeCategory = typeof knowledgeCategories.$inferSelect;
export type InsertKnowledgeCategory = z.infer<typeof insertKnowledgeCategorySchema>;
export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;
export type InsertKnowledgeArticle = z.infer<typeof insertKnowledgeArticleSchema>;
export type TrainingContent = typeof trainingContent.$inferSelect;
export type InsertTrainingContent = z.infer<typeof insertTrainingContentSchema>;
export type ClientMembership = typeof clientMemberships.$inferSelect;
export type InsertClientMembership = z.infer<typeof insertClientMembershipSchema>;
export type ContentAccessLog = typeof contentAccessLog.$inferSelect;
export type InsertContentAccessLog = z.infer<typeof insertContentAccessLogSchema>;
export type ClientPortalAccess = typeof clientPortalAccess.$inferSelect;
export type InsertClientPortalAccess = z.infer<typeof insertClientPortalAccessSchema>;

// Support Extended Types
export type SupportTicketWithRelations = SupportTicket & {
  client?: Client;
  project?: Project;
  supportType?: SupportType;
  assignedTo?: User;
  createdBy?: User;
  comments?: TicketComment[];
};

export type KnowledgeArticleWithRelations = KnowledgeArticle & {
  category?: KnowledgeCategory;
  author?: User;
};

export type TrainingContentWithRelations = TrainingContent & {
  category?: KnowledgeCategory;
};

// Scrum Types
export type ScrumInternalProject = typeof scrumInternalProjects.$inferSelect;
export type InsertScrumInternalProject = z.infer<typeof insertScrumInternalProjectSchema>;
export type ScrumTeam = typeof scrumTeams.$inferSelect;
export type InsertScrumTeam = z.infer<typeof insertScrumTeamSchema>;
export type ScrumTeamMember = typeof scrumTeamMembers.$inferSelect;
export type InsertScrumTeamMember = z.infer<typeof insertScrumTeamMemberSchema>;
export type ScrumSprint = typeof scrumSprints.$inferSelect;
export type InsertScrumSprint = z.infer<typeof insertScrumSprintSchema>;
export type ScrumBacklogItem = typeof scrumBacklogItems.$inferSelect;
export type InsertScrumBacklogItem = z.infer<typeof insertScrumBacklogItemSchema>;
export type ScrumTimesheet = typeof scrumTimesheets.$inferSelect;
export type InsertScrumTimesheet = z.infer<typeof insertScrumTimesheetSchema>;
export type ScrumRework = typeof scrumRework.$inferSelect;
export type InsertScrumRework = z.infer<typeof insertScrumReworkSchema>;
export type ScrumBacklogAttachment = typeof scrumBacklogAttachments.$inferSelect;
export type InsertScrumBacklogAttachment = z.infer<typeof insertScrumBacklogAttachmentSchema>;

// ── Knowledge Brain (RAG) ─────────────────────────────────────
export const brainCategories = pgTable("brain_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"), // null = global
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  slug: varchar("slug", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const brainItems = pgTable("brain_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"), // null = global
  categoryId: varchar("category_id").references(() => brainCategories.id),
  type: varchar("type", { length: 50 }).notNull(),
  // 'legislacao' | 'caso_de_uso' | 'metodologia' | 'template' | 'licao_aprendida' | 'best_practice'
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  tags: text("tags"), // comma-separated
  embedding: jsonb("embedding"), // number[] vector
  embeddingProvider: varchar("embedding_provider", { length: 30 }),
  embeddingDim: integer("embedding_dim"),
  usageCount: integer("usage_count").default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const agentLogs = pgTable("agent_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  projectId: varchar("project_id"),
  userId: varchar("user_id"),
  agentType: varchar("agent_type", { length: 80 }).notNull(),
  promptSent: text("prompt_sent"),
  responseFull: text("response_full"),
  knowledgeSourceIds: jsonb("knowledge_source_ids"),
  tokensInput: integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  durationMs: integer("duration_ms"),
  status: varchar("status", { length: 20 }), // 'success' | 'error'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentDefinitions = pgTable("agent_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"), // null = global (Arcádia)
  parentDefinitionId: varchar("parent_definition_id"), // when this is a tenant fork of a global, points to the global id
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  slug: varchar("slug", { length: 80 }).notNull(),
  systemPrompt: text("system_prompt").notNull(),
  // Array of strings: 'canvas' | 'pdca' | 'processes' | 'swot' | 'erp' | 'scrum'
  contextModules: text("context_modules").array().default(sql`ARRAY[]::text[]`),
  // Array of strings: 'all' | 'canvas' | 'pdca' | 'processes' | 'scrum_reports' | 'reports'
  visibleIn: text("visible_in").array().default(sql`ARRAY[]::text[]`),
  maxTokens: integer("max_tokens").default(2000).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  createdBy: varchar("created_by"),
  // Catalogação para AgentPickerForBi e packs (Task #54)
  pack: varchar("pack", { length: 50 }),                 // ex.: 'contabilidade'
  category: varchar("category", { length: 80 }),         // ex.: 'Tributário'
  biWidget: varchar("bi_widget", { length: 50 }),        // sugestão de widget no BI Builder
  biMetricIds: text("bi_metric_ids").array().default(sql`ARRAY[]::text[]`),
  // Disponibiliza o agente para o cliente final (B2C) do tenant.
  // Ex.: a BCPrime usa o sistema todo; seu cliente B2C só vê agentes com esta flag.
  b2cAvailable: integer("b2c_available").default(0).notNull(),
  // === Capacidades do Agente (Sprint Agent-Builder-V2) ===
  // Tools MCP que este agente pode usar. [] = usa todas as disponíveis.
  allowedTools: text("allowed_tools").array().default(sql`ARRAY[]::text[]`),
  // IDs de web_credentials vinculadas (acesso a sistemas externos)
  linkedCredentialIds: text("linked_credential_ids").array().default(sql`ARRAY[]::text[]`),
  // Nomes de browser_skills que este agente pode executar
  enabledSkillNames: text("enabled_skill_names").array().default(sql`ARRAY[]::text[]`),
  // Override do modelo LLM. null = padrão do tenant.
  llmModelOverride: varchar("llm_model_override", { length: 100 }),
  // Ações que exigem aprovação humana obrigatória
  requiredApprovals: text("required_approval_actions").array().default(sql`ARRAY[]::text[]`),
  // Roles que podem usar este agente. [] = todos do tenant.
  allowedRoles: text("allowed_roles").array().default(sql`ARRAY[]::text[]`),
  // Gatilhos de automação (cron) vinculados — [{label,cron,skillName,active}]
  automationTriggers: jsonb("automation_triggers").default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_agent_defs_tenant").on(t.tenantId),
  index("idx_agent_defs_slug").on(t.slug),
  index("idx_agent_defs_parent").on(t.parentDefinitionId),
  index("idx_agent_defs_pack").on(t.pack),
  // Idempotência do fork: cada tenant só pode ter UM fork por agente-pai
  // Índice parcial criado via SQL (WHERE parent_definition_id IS NOT NULL): uniq_agent_defs_tenant_parent
]);

export const agentDefinitionVersions = pgTable("agent_definition_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentDefinitionId: varchar("agent_definition_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  snapshot: jsonb("snapshot").notNull(), // full row at this version
  changeNote: text("change_note"),
  changedBy: varchar("changed_by"),
  changedAt: timestamp("changed_at").defaultNow(),
}, (t) => [
  index("idx_agent_def_versions_def").on(t.agentDefinitionId),
  // Sem versionNumber duplicado por definição (constraint criada via SQL: uniq_agent_def_versions_def_version)
  uniqueIndex("uniq_agent_def_versions_def_version").on(t.agentDefinitionId, t.versionNumber),
]);

export const insertAgentDefinitionSchema = createInsertSchema(agentDefinitions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertAgentDefinitionVersionSchema = createInsertSchema(agentDefinitionVersions).omit({
  id: true, changedAt: true,
});
export type AgentDefinition = typeof agentDefinitions.$inferSelect;
export type InsertAgentDefinition = z.infer<typeof insertAgentDefinitionSchema>;
export type AgentDefinitionVersion = typeof agentDefinitionVersions.$inferSelect;
export type InsertAgentDefinitionVersion = z.infer<typeof insertAgentDefinitionVersionSchema>;

export const insertBrainCategorySchema = createInsertSchema(brainCategories).omit({ id: true, createdAt: true });
export const insertBrainItemSchema = createInsertSchema(brainItems).omit({
  id: true, createdAt: true, updatedAt: true, embedding: true,
  embeddingProvider: true, embeddingDim: true, usageCount: true,
});
export const insertAgentLogSchema = createInsertSchema(agentLogs).omit({ id: true, createdAt: true });
export type BrainCategory = typeof brainCategories.$inferSelect;
export type InsertBrainCategory = z.infer<typeof insertBrainCategorySchema>;
export type BrainItem = typeof brainItems.$inferSelect;
export type InsertBrainItem = z.infer<typeof insertBrainItemSchema>;
export type AgentLog = typeof agentLogs.$inferSelect;
export type InsertAgentLog = z.infer<typeof insertAgentLogSchema>;

// Scrum Extended Types
export type ScrumInternalProjectWithRelations = ScrumInternalProject & {
  clientProject?: Project;
  createdBy?: User;
  sprints?: ScrumSprint[];
  backlogItems?: ScrumBacklogItem[];
};

export type ScrumTeamWithRelations = ScrumTeam & {
  leader?: User;
  members?: (ScrumTeamMember & { user?: User })[];
};

export type ScrumSprintWithRelations = ScrumSprint & {
  internalProject?: ScrumInternalProject;
  team?: ScrumTeam;
  createdBy?: User;
  backlogItems?: ScrumBacklogItem[];
};

export type ScrumBacklogItemWithRelations = ScrumBacklogItem & {
  internalProject?: ScrumInternalProject;
  sprint?: ScrumSprint;
  originProject?: Project;
  assignee?: User;
  reporter?: User;
  createdBy?: User;
  timesheets?: ScrumTimesheet[];
};


// ════════════════════════════════════════════════════════════════════
// Phase 13 — BI Builder (DataSourceRef + WidgetConfig + sql_queries +
// bi_dashboards). The first two are TypeScript-only; the latter two
// are real Drizzle tables.
// ════════════════════════════════════════════════════════════════════

// Discriminated union — every variant has its own required fields.
// Today: 'internal' | 'sql_agent'. Future: add 'connector' for external
// datasets (ERP, Sheets, etc.) without touching renderer/grid code.
export type DataSourceRef =
  | {
      type: "internal";
      // Catalog key — maps to GET /api/bi/{key.replace(/_/g,"-")}
      metricKey: string;
      // For Function 3 (combine series) — defaults to [metricKey]
      metricKeys?: string[];
    }
  | {
      type: "sql_agent";
      sqlQueryId: string;
      agentPrompt?: string;
      xAxisColumn?: string;
      yAxisColumns?: string[];
    }
  | {
      type: "connector";
      connectorId: string;
      query?: string;
      refreshInterval?: number;
      xAxisColumn?: string;
      yAxisColumns?: string[];
    }
  | {
      // Phase 3 (BI Multi-Fonte) — Semantic Layer metric reading from
      // analytics.* materialized by the ETL. `sources` is the optional
      // subset of data_source_ids to combine (empty = all).
      type: "semantic";
      metricId: string;
      sources?: string[];
    };

export type WidgetType =
  | "kpi_card" | "bar_chart" | "line_chart" | "radar_chart"
  // BI Expansion — novos tipos de widget
  | "area_chart" | "pie_chart" | "donut_chart" | "big_number"
  | "waterfall_chart" | "funnel_chart" | "gauge_chart"
  | "mixed_timeseries" | "data_table" | "scatter_plot"
  // Phase 3 — BI Multi-Fonte specials
  | "migration_monitor" | "data_quality_panel";

// Phase 3b — Global dashboard filter applied to widgets that opt in.
export type DashboardFilter = {
  startDate?: string;   // ISO date 'YYYY-MM-DD'
  endDate?: string;
  clientId?: string;
  projectId?: string;
  status?: string;
  enabledFilters: ("daterange" | "client" | "project" | "status")[];
};

export type WidgetConfig = {
  id: string;
  type: WidgetType;
  title: string;
  gridPos: {
    x: number; // 0..11
    y: number;
    w: number; // columns
    h: number; // grid units (1 = 80px)
  };
  options?: {
    color?: string;
    colors?: string[];
    showLegend?: boolean;
    valuePrefix?: string;
    valueSuffix?: string;
  };
  // Legacy fields — kept so old saved dashboards keep rendering.
  metricKey?: string;
  metricKeys?: string[];
  sqlQueryId?: string;
  // New canonical field for new widgets.
  dataSource?: DataSourceRef;
  // Phase 3b — opt out of global dashboard filters.
  ignoreGlobalFilters?: boolean;
};

// ── sql_queries — agent-generated, tenant-owned, re-executable ─────
export const sqlQueries = pgTable("sql_queries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  agentPrompt: text("agent_prompt"),
  querySql: text("query_sql").notNull(),
  name: varchar("name", { length: 200 }),
  description: text("description"),
  resultSample: jsonb("result_sample").$type<Record<string, any>[]>().default([]),
  columns: jsonb("columns").$type<string[]>().default([]),
  xAxisColumn: varchar("x_axis_column", { length: 100 }),
  yAxisColumns: jsonb("y_axis_columns").$type<string[]>().default([]),
  brainItemId: varchar("brain_item_id"),
  isCurated: integer("is_curated").default(0),
  executionCount: integer("execution_count").default(1),
  lastExecutedAt: timestamp("last_executed_at").defaultNow(),
  createdById: varchar("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_sql_queries_tenant").on(t.tenantId),
]);

export const insertSqlQuerySchema = createInsertSchema(sqlQueries).omit({
  id: true, createdAt: true, updatedAt: true,
  executionCount: true, lastExecutedAt: true,
});
export type SqlQuery = typeof sqlQueries.$inferSelect;
export type InsertSqlQuery = z.infer<typeof insertSqlQuerySchema>;

// ── bi_dashboards — saved layouts (one default per tenant) ─────────
export const biDashboards = pgTable("bi_dashboards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  ownerId: varchar("owner_id"),
  name: varchar("name", { length: 200 }).notNull().default("Meu Dashboard"),
  layout: jsonb("layout").$type<WidgetConfig[]>().default([]),
  isDefault: integer("is_default").default(0),
  filters: jsonb("filters").$type<DashboardFilter>().default({ enabledFilters: [] }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_bi_dashboards_tenant").on(t.tenantId),
]);

export const insertBiDashboardSchema = createInsertSchema(biDashboards).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type BiDashboard = typeof biDashboards.$inferSelect;
export type InsertBiDashboard = z.infer<typeof insertBiDashboardSchema>;

// ── dashboard_shares — public links per dashboard ─────────────────
export const dashboardShares = pgTable("dashboard_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  dashboardId: varchar("dashboard_id")
    .references(() => biDashboards.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  expiresAt: timestamp("expires_at"),
  viewCount: integer("view_count").default(0),
  lastViewedAt: timestamp("last_viewed_at"),
  isActive: integer("is_active").default(1),
  createdById: varchar("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_dashboard_shares_token").on(t.token),
  index("idx_dashboard_shares_dashboard").on(t.dashboardId),
]);
export type DashboardShare = typeof dashboardShares.$inferSelect;

// ── bi_alerts — alertas sobre métricas BI ──────────────────────────
export const biAlerts = pgTable("bi_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  metricId: varchar("metric_id", { length: 200 }).notNull(),
  condition: varchar("condition", { length: 10 }).notNull(), // gt|lt|gte|lte|eq
  threshold: numeric("threshold", { precision: 18, scale: 4 }).notNull(),
  isActive: integer("is_active").notNull().default(1),
  notifyChannels: jsonb("notify_channels").$type<string[]>().default([]),
  lastCheckedAt: timestamp("last_checked_at"),
  lastTriggeredAt: timestamp("last_triggered_at"),
  lastValue: numeric("last_value", { precision: 18, scale: 4 }),
  createdById: varchar("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_bi_alerts_tenant").on(t.tenantId),
  index("idx_bi_alerts_active").on(t.tenantId, t.isActive),
]);

export const insertBiAlertSchema = createInsertSchema(biAlerts).omit({
  id: true, createdAt: true, updatedAt: true,
  lastCheckedAt: true, lastTriggeredAt: true, lastValue: true,
});
export type BiAlert = typeof biAlerts.$inferSelect;
export type InsertBiAlert = z.infer<typeof insertBiAlertSchema>;

// ═══════════════════════════════════════════════════════════════════
//  PHASE 4a — Central de Integração: data_sources, snapshots,
//  sync_jobs, automation_rules, notifications
// ═══════════════════════════════════════════════════════════════════

// External data source registered for a tenant. The encrypted blob
// holds secrets (passwords, API keys, tokens); configPublic holds
// safe-to-display fields (host, base URL, auth type, sheet name).
export const dataSources = pgTable("data_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  // Phase 4a active types: 'rest_api' | 'postgres' | 'excel_upload'
  // Phase 4b stubs:        'mysql' | 'sqlserver' | 'google_sheets' | 'totvs'
  configEncrypted: text("config_encrypted"),
  configPublic: jsonb("config_public").$type<Record<string, any>>().default({}),
  scheduleCron: varchar("schedule_cron", { length: 80 }),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 20 }),
  isActive: integer("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_data_sources_tenant").on(t.tenantId),
]);

export const dataSnapshots = pgTable("data_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  dataSourceId: varchar("data_source_id")
    .references(() => dataSources.id, { onDelete: "cascade" })
    .notNull(),
  snapshotKey: varchar("snapshot_key", { length: 100 }).notNull().default("default"),
  data: jsonb("data").$type<Record<string, any>[]>().default([]),
  columns: jsonb("columns").$type<string[]>().default([]),
  rowCount: integer("row_count").default(0),
  syncedAt: timestamp("synced_at").defaultNow(),
}, (t) => [
  index("idx_snapshots_source").on(t.dataSourceId, t.snapshotKey),
  index("idx_snapshots_tenant").on(t.tenantId),
]);

export const syncJobs = pgTable("sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  dataSourceId: varchar("data_source_id")
    .references(() => dataSources.id, { onDelete: "cascade" })
    .notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  // 'pending' | 'running' | 'success' | 'error'
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
  rowsSynced: integer("rows_synced").default(0),
  triggeredBy: varchar("triggered_by", { length: 40 }).default("manual"),
  // 'manual' | 'cron' | 'automation'
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_sync_jobs_tenant").on(t.tenantId),
  index("idx_sync_jobs_source").on(t.dataSourceId),
]);

export const automationRules = pgTable("automation_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  triggerType: varchar("trigger_type", { length: 20 }).notNull().default("cron"),
  // Phase 4a: 'cron'   ·   Phase 4b: 'event'
  triggerConfig: jsonb("trigger_config")
    .$type<{ cronExpression?: string; event?: string }>()
    .default({ cronExpression: "0 8 * * 1" }),
  actionType: varchar("action_type", { length: 40 }).notNull(),
  // 'sync_datasource' | 'run_agent' | 'send_notification'
  actionConfig: jsonb("action_config").$type<Record<string, any>>().default({}),
  isActive: integer("is_active").default(1),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: varchar("last_run_status", { length: 20 }),
  lastRunMessage: text("last_run_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_automations_tenant").on(t.tenantId),
]);

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").references(() => users.id),
  // null = visible to every user in the tenant
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  type: varchar("type", { length: 50 }).default("info"),
  // 'info' | 'warning' | 'success' | 'error'
  isRead: integer("is_read").default(0),
  sourceType: varchar("source_type", { length: 50 }),
  sourceId: varchar("source_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_notifications_tenant").on(t.tenantId),
  index("idx_notifications_user").on(t.userId),
]);

export const insertDataSourceSchema = createInsertSchema(dataSources).omit({
  id: true, createdAt: true, updatedAt: true,
  lastSyncAt: true, lastSyncStatus: true,
});
export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({
  id: true, createdAt: true, updatedAt: true,
  lastRunAt: true, lastRunStatus: true, lastRunMessage: true,
});
export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true, createdAt: true,
});

export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type DataSnapshot = typeof dataSnapshots.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// =====================================================================
//  ARCÁDIA CONTROL — Sprint 1: Fundação Operacional
//  Tabelas: planos_contas, centros_custo, contas_bancarias,
//           lancamentos_financeiros, periodos_competencia
//  Plano de contas é por TENANT (compartilhado).
//  Demais tabelas são por CLIENTE (CRM).
// =====================================================================

export const planosContas = pgTable("planos_contas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  codigo: varchar("codigo", { length: 30 }).notNull(),
  descricao: varchar("descricao", { length: 300 }).notNull(),
  // ativo|passivo|patrimonio_liquido|receita|custo|despesa|resultado
  natureza: varchar("natureza", { length: 30 }).notNull(),
  nivel: integer("nivel").notNull().default(1),
  parentId: varchar("parent_id"),
  // Tag DRE/Fluxo/Fleuriet (ex: 'EBITDA', 'NCG', 'tesouraria', 'fluxo', 'calculado')
  naturezaDre: varchar("natureza_dre", { length: 30 }),
  permiteLancamento: boolean("permite_lancamento").default(true),
  ativo: boolean("ativo").default(true),
  // Sprint C6 — compatibilidade com balancete Domínio (5 níveis)
  // Código no padrão CFC: '3.2.2.04.0027' (até 5 segmentos)
  codigoCfc: varchar("codigo_cfc", { length: 30 }),
  // 'sintetica' (agrupadora, não recebe lançamento) | 'analitica' (folha, recebe)
  // Quando definido, sobrepõe `permiteLancamento` para validação dura.
  tipoConta: varchar("tipo_conta", { length: 15 }),
  // Grupo DRE para alimentar relatório:
  // 'receita_bruta'|'deducoes'|'cmv'|'despesas_pessoal'|'despesas_gerais'
  // |'despesas_financeiras'|'resultado_financeiro'|'outras'
  grupoDre: varchar("grupo_dre", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_planos_contas_tenant").on(t.tenantId),
  uniqueIndex("planos_contas_tenant_codigo_uniq").on(t.tenantId, t.codigo),
  index("idx_planos_contas_codigo_cfc").on(t.tenantId, t.codigoCfc),
]);

// Sprint C6 — Centros de Custo dinâmicos. Tipos: departamento (permanente),
// projeto (com data início/fim), atividade (semi-permanente).
// `parentId` permite hierarquia (CC pai/filho) — FK self-referencial declarada
// inline com any-cast para evitar circular declaration.
export const centrosCusto = pgTable("centros_custo", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  codigo: varchar("codigo", { length: 30 }).notNull(),
  nome: varchar("nome", { length: 200 }).notNull(),
  descricao: text("descricao"),
  ativo: boolean("ativo").default(true),
  // Sprint C6 — campos novos
  tipo: varchar("tipo", { length: 20 }).notNull().default("departamento"),
  // 'departamento' | 'projeto' | 'atividade'
  parentId: varchar("parent_id"),
  // FK lógica para centros_custo.id; sem .references() (self-ref / circular)
  responsavel: varchar("responsavel", { length: 200 }),
  dataInicio: date("data_inicio"),
  dataFim: date("data_fim"),
  orcamentoAnual: numeric("orcamento_anual", { precision: 15, scale: 2 }),
  cor: varchar("cor", { length: 7 }).default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_centros_custo_tenant_cliente").on(t.tenantId, t.clienteId),
  index("idx_centros_custo_parent").on(t.parentId),
  index("idx_centros_custo_tipo").on(t.tenantId, t.tipo),
]);

// Sprint C6 — Rateio de lançamentos financeiros entre múltiplos CCs.
// SUM(percentual) DEVE = 100 ± 0.01 (validado no service em transação).
// Se vazio, lançamento usa centroCustoId direto. Se houver linhas,
// elas têm precedência (centroCustoId pode ficar null).
export const rateiosCc = pgTable("rateios_cc", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  lancamentoId: varchar("lancamento_id").notNull().references(() => lancamentosFinanceiros.id, { onDelete: "cascade" }),
  centroCustoId: varchar("centro_custo_id").notNull().references(() => centrosCusto.id),
  percentual: numeric("percentual", { precision: 5, scale: 2 }).notNull(),
  valorRateado: numeric("valor_rateado", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_rateios_cc_lanc").on(t.lancamentoId),
  index("idx_rateios_cc_tenant_cc").on(t.tenantId, t.centroCustoId),
]);

export const contasBancarias = pgTable("contas_bancarias", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  banco: varchar("banco", { length: 100 }).notNull(),
  agencia: varchar("agencia", { length: 20 }),
  conta: varchar("conta", { length: 30 }),
  // cc | poupanca | caixa | carteira | outro
  tipo: varchar("tipo", { length: 20 }).notNull().default("cc"),
  saldoInicial: numeric("saldo_inicial", { precision: 15, scale: 2 }).default("0"),
  saldoAtual: numeric("saldo_atual", { precision: 15, scale: 2 }).default("0"),
  ativo: boolean("ativo").default(true),
  // Reservado para Sprint 4 (consolidação por grupo)
  grupoId: varchar("grupo_id"),
  // Sprint C10/C11 — apelido amigável (ex: 'Itaú Principal'), responsável
  // (titular de carteira corporativa, ex: 'Caju - Amanda')
  apelido: varchar("apelido", { length: 100 }),
  responsavelId: varchar("responsavel_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_contas_bancarias_tenant_cliente").on(t.tenantId, t.clienteId),
]);

export const lancamentosFinanceiros = pgTable("lancamentos_financeiros", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // pagar | receber
  tipo: varchar("tipo", { length: 10 }).notNull(),
  descricao: varchar("descricao", { length: 500 }).notNull(),
  favorecido: varchar("favorecido", { length: 300 }),
  documento: varchar("documento", { length: 80 }),
  valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
  dataEmissao: date("data_emissao"),
  dataVencimento: date("data_vencimento").notNull(),
  dataPagamento: date("data_pagamento"),
  // previsto | aprovado | pago | vencido | cancelado | inadimplente
  status: varchar("status", { length: 20 }).notNull().default("previsto"),
  planoContaId: varchar("plano_conta_id").references(() => planosContas.id),
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id),
  contaBancariaId: varchar("conta_bancaria_id").references(() => contasBancarias.id),
  // manual | ia | integracao | importacao
  origem: varchar("origem", { length: 20 }).notNull().default("manual"),
  criadoPorIa: boolean("criado_por_ia").default(false),
  criadoPor: varchar("criado_por").references(() => users.id),
  aprovadoPor: varchar("aprovado_por").references(() => users.id),
  aprovadoEm: timestamp("aprovado_em"),
  observacoes: text("observacoes"),
  // Reservado para Sprint 4
  grupoId: varchar("grupo_id"),
  // Sprint 3 Recovery: vínculo bidirecional com parcela de acordo
  // (FK criada via SQL na migration; Drizzle não declara `.references` pra evitar circular import)
  recoveryInstallmentId: varchar("recovery_installment_id"),
  // Sprint C7 — G1 Parcelamento: vínculo com grupo + posição da parcela
  grupoParcelamentoId: varchar("grupo_parcelamento_id"),
  numeroParcela: integer("numero_parcela"),
  totalParcelas: integer("total_parcelas"),
  // Sprint C7 — G2 Recorrência: vínculo com template gerador
  templateRecorrenciaId: varchar("template_recorrencia_id"),
  origemRecorrencia: boolean("origem_recorrencia").default(false),
  // Sprint C7 — G11 Tipo de Documento parametrizável
  tipoDocumentoId: varchar("tipo_documento_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_lanc_tenant_cliente").on(t.tenantId, t.clienteId),
  index("idx_lanc_status").on(t.tenantId, t.status),
  index("idx_lanc_vencimento").on(t.tenantId, t.dataVencimento),
  index("idx_lanc_tipo").on(t.tenantId, t.tipo),
  index("idx_lanc_recovery_installment").on(t.recoveryInstallmentId),
  index("idx_lanc_grupo_parcelamento").on(t.grupoParcelamentoId),
  index("idx_lanc_template_recorrencia").on(t.templateRecorrenciaId),
]);

// =====================================================================
//  Sprint C7 — G1 Parcelamento, G2 Recorrência, G11 Tipos de Documento
// =====================================================================

// Grupo de parcelamento — vincula N lançamentos (numeroParcela 1..N)
export const gruposParcelamento = pgTable("grupos_parcelamento", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // 'pagar' | 'receber'
  tipo: varchar("tipo", { length: 10 }).notNull(),
  descricao: varchar("descricao", { length: 300 }).notNull(),
  totalParcelas: integer("total_parcelas").notNull(),
  valorTotal: numeric("valor_total", { precision: 15, scale: 2 }).notNull(),
  planoContaId: varchar("plano_conta_id").references(() => planosContas.id),
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id),
  tipoDocumentoId: varchar("tipo_documento_id"),
  favorecido: varchar("favorecido", { length: 300 }),
  observacoes: text("observacoes"),
  criadoPor: varchar("criado_por").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_grupos_parcel_tenant_cliente").on(t.tenantId, t.clienteId),
]);

// Template de recorrência — gera lançamentos automaticamente via cron diário
export const templatesRecorrencia = pgTable("templates_recorrencia", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  descricao: varchar("descricao", { length: 300 }).notNull(),
  // 'pagar' | 'receber'
  tipo: varchar("tipo", { length: 10 }).notNull(),
  // 'mensal' | 'quinzenal' | 'semanal' | 'anual'
  frequencia: varchar("frequencia", { length: 20 }).notNull(),
  // 1..28 para mensal/anual
  diaVencimento: integer("dia_vencimento"),
  // null = valor variável (usuário ajusta na geração)
  valorFixo: numeric("valor_fixo", { precision: 15, scale: 2 }),
  planoContaId: varchar("plano_conta_id").references(() => planosContas.id),
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id),
  contaBancariaId: varchar("conta_bancaria_id").references(() => contasBancarias.id),
  tipoDocumentoId: varchar("tipo_documento_id"),
  favorecido: varchar("favorecido", { length: 300 }),
  dataInicio: date("data_inicio").notNull(),
  // null = recorrência indefinida
  dataFim: date("data_fim"),
  ativa: boolean("ativa").notNull().default(true),
  // última data até a qual o cron já gerou ocorrências (avança para frente)
  geradasAte: date("geradas_ate"),
  observacoes: text("observacoes"),
  criadoPor: varchar("criado_por").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_templates_rec_tenant_cliente").on(t.tenantId, t.clienteId),
  index("idx_templates_rec_ativa").on(t.tenantId, t.ativa),
]);

// Tipos de documento parametrizáveis (NF-e, Boleto, PIX, etc.)
// tenantId='__global__' = seed da plataforma (visível a todos os tenants em leitura)
// tenantId=<real>      = customizado pelo tenant
export const tiposDocumento = pgTable("tipos_documento", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  nome: varchar("nome", { length: 100 }).notNull(),
  icone: varchar("icone", { length: 50 }).default("file"),
  ativo: boolean("ativo").notNull().default(true),
  ordem: integer("ordem").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_tipos_doc_tenant").on(t.tenantId),
  uniqueIndex("uniq_tipos_doc_tenant_nome").on(t.tenantId, t.nome),
]);

export const periodosCompetencia = pgTable("periodos_competencia", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ano: integer("ano").notNull(),
  mes: integer("mes").notNull(),
  // aberto | em_revisao | fechado
  status: varchar("status", { length: 20 }).notNull().default("aberto"),
  fechadoPor: varchar("fechado_por").references(() => users.id),
  fechadoEm: timestamp("fechado_em"),
  observacoes: text("observacoes"),
  grupoId: varchar("grupo_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_periodos_tenant_cliente").on(t.tenantId, t.clienteId),
  uniqueIndex("uniq_periodo_cliente_mes").on(t.tenantId, t.clienteId, t.ano, t.mes),
]);

// Sprint C6.1 — Extrato bancário: cada movimento (origem conciliação de
// lançamento, ajuste manual ou saldo inicial) gera 1 linha aqui. saldoApos
// é calculado no service (saldoAtual da conta após este movimento) e fica
// congelado para fins de extrato/auditoria. Quando uma conciliação é
// revertida, a linha correspondente é deletada e o saldo da conta volta.
export const movimentacoesBancarias = pgTable("movimentacoes_bancarias", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  contaBancariaId: varchar("conta_bancaria_id").notNull().references(() => contasBancarias.id, { onDelete: "cascade" }),
  // Pode ser null (ajuste manual ou saldo inicial). FK só é preservada se
  // o lançamento existir; ON DELETE SET NULL para não perder histórico.
  lancamentoId: varchar("lancamento_id").references(() => lancamentosFinanceiros.id, { onDelete: "set null" }),
  data: date("data").notNull(),
  // entrada (recebimento, ajuste positivo, saldo inicial) | saida (pagamento, ajuste negativo)
  tipo: varchar("tipo", { length: 10 }).notNull(),
  // conciliacao | desconciliacao | ajuste_manual | saldo_inicial
  origem: varchar("origem", { length: 20 }).notNull().default("conciliacao"),
  descricao: varchar("descricao", { length: 500 }).notNull(),
  valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
  saldoApos: numeric("saldo_apos", { precision: 15, scale: 2 }),
  criadoPor: varchar("criado_por").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_mov_banc_tenant_conta_data").on(t.tenantId, t.contaBancariaId, t.data),
  // Index único PARCIAL — bate com a startup migration; permite múltiplas
  // movimentações com lancamento_id NULL (ajustes manuais / saldo inicial).
  uniqueIndex("uniq_mov_banc_lancamento")
    .on(t.lancamentoId)
    .where(sql`${t.lancamentoId} IS NOT NULL`),
]);

export const insertMovimentacaoBancariaSchema = createInsertSchema(movimentacoesBancarias).omit({ id: true, createdAt: true, saldoApos: true });
export type MovimentacaoBancaria = typeof movimentacoesBancarias.$inferSelect;
export type InsertMovimentacaoBancaria = z.infer<typeof insertMovimentacaoBancariaSchema>;

export const insertPlanoContaSchema = createInsertSchema(planosContas).omit({ id: true, createdAt: true });
// Sprint C6 — refine: tipo='projeto' exige dataInicio E dataFim; cor deve ser hex válido.
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const insertCentroCustoSchema = createInsertSchema(centrosCusto)
  .omit({ id: true, createdAt: true })
  .refine(
    (d) => d.tipo !== "projeto" || (!!d.dataInicio && !!d.dataFim),
    { message: "Centros de Custo do tipo 'projeto' exigem dataInicio e dataFim", path: ["dataInicio"] },
  )
  .refine(
    (d) => !d.cor || HEX_COLOR_RE.test(d.cor),
    { message: "Cor deve ser hex no formato #RRGGBB", path: ["cor"] },
  )
  .refine(
    (d) => ["departamento", "projeto", "atividade"].includes(d.tipo ?? "departamento"),
    { message: "Tipo deve ser departamento, projeto ou atividade", path: ["tipo"] },
  );
export const insertRateioCcSchema = createInsertSchema(rateiosCc).omit({ id: true, createdAt: true, valorRateado: true });
export const insertContaBancariaSchema = createInsertSchema(contasBancarias).omit({ id: true, createdAt: true, saldoAtual: true });
export const insertLancamentoFinanceiroSchema = createInsertSchema(lancamentosFinanceiros).omit({ id: true, createdAt: true, updatedAt: true, aprovadoPor: true, aprovadoEm: true });
export const insertPeriodoCompetenciaSchema = createInsertSchema(periodosCompetencia).omit({ id: true, createdAt: true, fechadoPor: true, fechadoEm: true });

// Sprint C7
export const insertGrupoParcelamentoSchema = createInsertSchema(gruposParcelamento).omit({ id: true, createdAt: true });
export const insertTemplateRecorrenciaSchema = createInsertSchema(templatesRecorrencia).omit({ id: true, createdAt: true, updatedAt: true, geradasAte: true });
export const insertTipoDocumentoSchema = createInsertSchema(tiposDocumento).omit({ id: true, createdAt: true });

// =====================================================================
//  Sprint C8 — Orçamento mensal por conta (Realizado × Previsto)
//  Cobertura do gap G3 da planilha Impacto (MetaReceitas/MetaDespesas).
// =====================================================================
export const orcamentosMensais = pgTable("orcamentos_mensais", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  planoContaId: varchar("plano_conta_id").notNull().references(() => planosContas.id, { onDelete: "cascade" }),
  // null = orçamento da conta sem rateio por CC
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id, { onDelete: "cascade" }),
  ano: integer("ano").notNull(),
  mes: integer("mes").notNull(), // 1..12
  valorPrevisto: numeric("valor_previsto", { precision: 15, scale: 2 }).notNull().default("0"),
  // Threshold de desvio em pontos percentuais para alertar (ex: 15 = 15%).
  // Quando null usa o default do cliente (env LLM_DESVIO_DEFAULT_PCT ou 15).
  thresholdAlertaPct: numeric("threshold_alerta_pct", { precision: 5, scale: 2 }),
  observacoes: text("observacoes"),
  criadoPor: varchar("criado_por").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_orcamentos_tenant_cliente_ano").on(t.tenantId, t.clienteId, t.ano),
  // UNIQUE garante upsert por chave natural. Como Postgres trata NULL como
  // distinto, usamos COALESCE via expressão para fazer "centroCusto opcional"
  // funcionar como single row — por isso há também um índice parcial abaixo.
  uniqueIndex("uniq_orcamento_mensal_full")
    .on(t.tenantId, t.clienteId, t.planoContaId, t.centroCustoId, t.ano, t.mes)
    .where(sql`${t.centroCustoId} IS NOT NULL`),
  uniqueIndex("uniq_orcamento_mensal_sem_cc")
    .on(t.tenantId, t.clienteId, t.planoContaId, t.ano, t.mes)
    .where(sql`${t.centroCustoId} IS NULL`),
]);

export const insertOrcamentoMensalSchema = createInsertSchema(orcamentosMensais).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type OrcamentoMensal = typeof orcamentosMensais.$inferSelect;
export type InsertOrcamentoMensal = z.infer<typeof insertOrcamentoMensalSchema>;

export type PlanoConta = typeof planosContas.$inferSelect;
export type InsertPlanoConta = z.infer<typeof insertPlanoContaSchema>;
export type CentroCusto = typeof centrosCusto.$inferSelect;
export type InsertCentroCusto = z.infer<typeof insertCentroCustoSchema>;
export type RateioCc = typeof rateiosCc.$inferSelect;
export type InsertRateioCc = z.infer<typeof insertRateioCcSchema>;
export type ContaBancaria = typeof contasBancarias.$inferSelect;
export type InsertContaBancaria = z.infer<typeof insertContaBancariaSchema>;
export type LancamentoFinanceiro = typeof lancamentosFinanceiros.$inferSelect;
export type InsertLancamentoFinanceiro = z.infer<typeof insertLancamentoFinanceiroSchema>;
export type PeriodoCompetencia = typeof periodosCompetencia.$inferSelect;
export type InsertPeriodoCompetencia = z.infer<typeof insertPeriodoCompetenciaSchema>;

// Sprint C7
export type GrupoParcelamento = typeof gruposParcelamento.$inferSelect;
export type InsertGrupoParcelamento = z.infer<typeof insertGrupoParcelamentoSchema>;
export type TemplateRecorrencia = typeof templatesRecorrencia.$inferSelect;
export type InsertTemplateRecorrencia = z.infer<typeof insertTemplateRecorrenciaSchema>;
export type TipoDocumento = typeof tiposDocumento.$inferSelect;
export type InsertTipoDocumento = z.infer<typeof insertTipoDocumentoSchema>;

// =====================================================================
//  ARCÁDIA CONTROL — Sprint 4 + 5: Base contábil expandida
//  Grupos/Filiais, Partidas Dobradas, Hub de Conectores, Import,
//  IBS/CBS, Monitor NF-e, Fleuriet, Fechamento, Retenções
// =====================================================================

// ── Grupos empresariais (matriz / filiais / holdings) ───────────────
export const gruposEmpresariais = pgTable("grupos_empresariais", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  nome: varchar("nome", { length: 300 }).notNull(),
  // grupo_simples | holding | franquia | rede
  tipo: varchar("tipo", { length: 30 }).notNull().default("grupo_simples"),
  matrizClienteId: varchar("matriz_cliente_id").references(() => clients.id, { onDelete: "set null" }),
  descricao: text("descricao"),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_grupos_empresariais_tenant").on(t.tenantId),
]);

export const gruposEmpresariaisMembros = pgTable("grupos_empresariais_membros", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  grupoId: varchar("grupo_id").notNull().references(() => gruposEmpresariais.id, { onDelete: "cascade" }),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // matriz | filial | controlada | coligada
  papel: varchar("papel", { length: 20 }).notNull().default("filial"),
  participacao: numeric("participacao", { precision: 6, scale: 3 }).default("100.000"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_grupos_membros_tenant_grupo").on(t.tenantId, t.grupoId),
  uniqueIndex("uniq_grupo_cliente").on(t.grupoId, t.clienteId),
]);

// ── Lançamentos contábeis (cabeçalho) e partidas (linhas D/C) ───────
export const lancamentosContabeis = pgTable("lancamentos_contabeis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  grupoId: varchar("grupo_id"),
  data: date("data").notNull(),
  historico: text("historico").notNull(),
  numeroDoc: varchar("numero_doc", { length: 80 }),
  lote: varchar("lote", { length: 80 }),
  // pendente | conferido | lancado | estornado
  status: varchar("status", { length: 20 }).notNull().default("pendente"),
  // manual | sistema | integracao | importacao
  origem: varchar("origem", { length: 20 }).notNull().default("manual"),
  totalDebito: numeric("total_debito", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCredito: numeric("total_credito", { precision: 15, scale: 2 }).notNull().default("0"),
  periodoId: varchar("periodo_id").references(() => periodosCompetencia.id),
  criadoPor: varchar("criado_por").references(() => users.id),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_lanc_contabeis_tenant_cliente").on(t.tenantId, t.clienteId),
  index("idx_lanc_contabeis_data").on(t.tenantId, t.data),
]);

export const partidasContabeis = pgTable("partidas_contabeis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  lancamentoContabilId: varchar("lancamento_contabil_id").notNull().references(() => lancamentosContabeis.id, { onDelete: "cascade" }),
  planoContaId: varchar("plano_conta_id").notNull().references(() => planosContas.id),
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id),
  // D | C
  tipo: varchar("tipo", { length: 1 }).notNull(),
  valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
  // Para rateio: 100% por padrão
  rateio: numeric("rateio", { precision: 6, scale: 3 }).default("100.000"),
  descricao: text("descricao"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_partidas_lanc").on(t.lancamentoContabilId),
  index("idx_partidas_tenant_conta").on(t.tenantId, t.planoContaId),
]);

// ── Hub de Conectores ────────────────────────────────────────────────
export const conectores = pgTable("conectores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  // Pode ser por cliente (ERP do cliente) ou por tenant (BrasilAPI compartilhada)
  clienteId: varchar("cliente_id").references(() => clients.id, { onDelete: "cascade" }),
  // brasil_api | dominio | nuvem_fiscal | omie | bling | conta_azul | open_finance | asaas | iugu | pipedrive | hubspot | rd_station | totvs_protheus | sap_b1 | quickbooks | stripe
  tipoConector: varchar("tipo_conector", { length: 40 }).notNull(),
  nome: varchar("nome", { length: 200 }).notNull(),
  // Config criptografada (chaves API, OAuth tokens, endpoints customizados)
  configCriptografada: text("config_criptografada"),
  // ativo | inativo | erro | nao_configurado
  status: varchar("status", { length: 20 }).notNull().default("nao_configurado"),
  ultimaSincronizacao: timestamp("ultima_sincronizacao"),
  ultimoErro: text("ultimo_erro"),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_conectores_tenant").on(t.tenantId),
  index("idx_conectores_tenant_tipo").on(t.tenantId, t.tipoConector),
]);

export const conectoresSyncLogs = pgTable("conectores_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  conectorId: varchar("conector_id").notNull().references(() => conectores.id, { onDelete: "cascade" }),
  iniciadoEm: timestamp("iniciado_em").defaultNow(),
  finalizadoEm: timestamp("finalizado_em"),
  // sucesso | erro | em_andamento
  status: varchar("status", { length: 20 }).notNull().default("em_andamento"),
  registrosProcessados: integer("registros_processados").default(0),
  mensagem: text("mensagem"),
  payloadResumo: jsonb("payload_resumo"),
}, (t) => [
  index("idx_sync_logs_tenant_conector").on(t.tenantId, t.conectorId),
]);

// ── NF-e recebidas (Sprint 5 — Monitor) ──────────────────────────────
export const nfesRecebidas = pgTable("nfes_recebidas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  chaveNfe: varchar("chave_nfe", { length: 44 }).notNull(),
  numeroNfe: varchar("numero_nfe", { length: 20 }),
  serieNfe: varchar("serie_nfe", { length: 5 }),
  dataEmissao: date("data_emissao"),
  valorTotal: numeric("valor_total", { precision: 15, scale: 2 }),
  fornecedorCnpj: varchar("fornecedor_cnpj", { length: 14 }),
  fornecedorNome: varchar("fornecedor_nome", { length: 300 }),
  xmlConteudo: text("xml_conteudo"),
  // pendente | ciencia | confirmacao | desconhecimento | nao_realizada
  statusManifestacao: varchar("status_manifestacao", { length: 30 }).notNull().default("pendente"),
  categorizacaoIa: jsonb("categorizacao_ia"),
  lancamentoFinanceiroId: varchar("lancamento_financeiro_id").references(() => lancamentosFinanceiros.id, { onDelete: "set null" }),
  processadoEm: timestamp("processado_em"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_nfes_tenant_cliente").on(t.tenantId, t.clienteId),
  uniqueIndex("uniq_nfe_chave_cliente").on(t.clienteId, t.chaveNfe),
]);

// ── Fechamento contábil (Sprint 5) ──────────────────────────────────
export const fechamentosContabeis = pgTable("fechamentos_contabeis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ano: integer("ano").notNull(),
  mes: integer("mes").notNull(),
  // em_andamento | concluido | reaberto
  status: varchar("status", { length: 20 }).notNull().default("em_andamento"),
  checklist: jsonb("checklist"),
  iniciadoPor: varchar("iniciado_por").references(() => users.id),
  iniciadoEm: timestamp("iniciado_em").defaultNow(),
  concluidoPor: varchar("concluido_por").references(() => users.id),
  concluidoEm: timestamp("concluido_em"),
  observacoes: text("observacoes"),
}, (t) => [
  uniqueIndex("uniq_fechamento_cliente_periodo").on(t.tenantId, t.clienteId, t.ano, t.mes),
]);

// ── Regime tributário por cliente / ano (Sprint 5 — IBS/CBS) ────────
export const regimeTributarioConfig = pgTable("regime_tributario_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ano: integer("ano").notNull(),
  // simples | lucro_presumido | lucro_real | mei
  regime: varchar("regime", { length: 30 }).notNull(),
  aliquotasPersonalizadas: jsonb("aliquotas_personalizadas"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("uniq_regime_cliente_ano").on(t.tenantId, t.clienteId, t.ano),
]);

// ── Retenções (Sprint 5 — IRRF/PIS/COFINS/CSLL/INSS/ISS) ─────────────
export const retencoes = pgTable("retencoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  lancamentoFinanceiroId: varchar("lancamento_financeiro_id").notNull().references(() => lancamentosFinanceiros.id, { onDelete: "cascade" }),
  // irrf | pis | cofins | csll | inss | iss | ibs | cbs
  tipo: varchar("tipo", { length: 10 }).notNull(),
  aliquota: numeric("aliquota", { precision: 6, scale: 4 }).notNull(),
  baseCalculo: numeric("base_calculo", { precision: 15, scale: 2 }).notNull(),
  valorRetido: numeric("valor_retido", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_retencoes_lanc").on(t.lancamentoFinanceiroId),
]);

// Insert schemas + types
export const insertGrupoEmpresarialSchema = createInsertSchema(gruposEmpresariais).omit({ id: true, createdAt: true });
export const insertGrupoMembroSchema = createInsertSchema(gruposEmpresariaisMembros).omit({ id: true, createdAt: true });
export const insertLancamentoContabilSchema = createInsertSchema(lancamentosContabeis).omit({ id: true, createdAt: true, updatedAt: true, totalDebito: true, totalCredito: true });
export const insertPartidaContabilSchema = createInsertSchema(partidasContabeis).omit({ id: true, createdAt: true });
export const insertConectorSchema = createInsertSchema(conectores).omit({ id: true, createdAt: true, ultimaSincronizacao: true, ultimoErro: true });
export const insertConectorSyncLogSchema = createInsertSchema(conectoresSyncLogs).omit({ id: true, iniciadoEm: true, finalizadoEm: true });
export const insertNfeRecebidaSchema = createInsertSchema(nfesRecebidas).omit({ id: true, createdAt: true, processadoEm: true });
export const insertFechamentoContabilSchema = createInsertSchema(fechamentosContabeis).omit({ id: true, iniciadoEm: true, concluidoEm: true, concluidoPor: true });
export const insertRegimeTributarioSchema = createInsertSchema(regimeTributarioConfig).omit({ id: true, createdAt: true });
export const insertRetencaoSchema = createInsertSchema(retencoes).omit({ id: true, createdAt: true });

export type GrupoEmpresarial = typeof gruposEmpresariais.$inferSelect;
export type InsertGrupoEmpresarial = z.infer<typeof insertGrupoEmpresarialSchema>;
export type GrupoMembro = typeof gruposEmpresariaisMembros.$inferSelect;
export type InsertGrupoMembro = z.infer<typeof insertGrupoMembroSchema>;
export type LancamentoContabil = typeof lancamentosContabeis.$inferSelect;
export type InsertLancamentoContabil = z.infer<typeof insertLancamentoContabilSchema>;
export type PartidaContabil = typeof partidasContabeis.$inferSelect;
export type InsertPartidaContabil = z.infer<typeof insertPartidaContabilSchema>;
export type Conector = typeof conectores.$inferSelect;
export type InsertConector = z.infer<typeof insertConectorSchema>;
export type ConectorSyncLog = typeof conectoresSyncLogs.$inferSelect;
export type InsertConectorSyncLog = z.infer<typeof insertConectorSyncLogSchema>;
export type NfeRecebida = typeof nfesRecebidas.$inferSelect;
export type InsertNfeRecebida = z.infer<typeof insertNfeRecebidaSchema>;
export type FechamentoContabil = typeof fechamentosContabeis.$inferSelect;
export type InsertFechamentoContabil = z.infer<typeof insertFechamentoContabilSchema>;
export type RegimeTributario = typeof regimeTributarioConfig.$inferSelect;
export type InsertRegimeTributario = z.infer<typeof insertRegimeTributarioSchema>;
export type Retencao = typeof retencoes.$inferSelect;
export type InsertRetencao = z.infer<typeof insertRetencaoSchema>;

// =====================================================================
//  SUPER AGENTE — Fase 3: anexos de arquivos por sessão
// =====================================================================

export const superAgentFiles = pgTable("super_agent_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  tenantId: varchar("tenant_id").notNull(),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  filename: varchar("filename", { length: 300 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  sizeBytes: integer("size_bytes").default(0),
  storagePath: varchar("storage_path", { length: 500 }),
  // Texto extraído (PDF/DOCX/XLSX/TXT). Limitado por servidor a ~80kB.
  extractedText: text("extracted_text"),
  // ok | failed | empty | too_large
  status: varchar("status", { length: 20 }).default("ok"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_super_agent_files_session").on(t.sessionId),
  index("idx_super_agent_files_tenant").on(t.tenantId),
]);

export const insertSuperAgentFileSchema = createInsertSchema(superAgentFiles).omit({
  id: true, createdAt: true,
});
export type SuperAgentFile = typeof superAgentFiles.$inferSelect;
export type InsertSuperAgentFile = z.infer<typeof insertSuperAgentFileSchema>;

// =====================================================================
//  MÓDULO SOCIETÁRIO — Sprint 1
//  6 tabelas: sociedades, socios, alteracoes, documentos,
//  obrigacoes, certificados_digitais
// =====================================================================

export const sociedades = pgTable("sociedades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  // Referência ao cliente do CRM (sem duplicar cadastro)
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  razaoSocial: varchar("razao_social", { length: 300 }).notNull(),
  nomeFantasia: varchar("nome_fantasia", { length: 300 }),
  cnpj: varchar("cnpj", { length: 18 }),
  inscricaoEstadual: varchar("inscricao_estadual", { length: 50 }),
  inscricaoMunicipal: varchar("inscricao_municipal", { length: 50 }),
  // simples | mei | lucro_presumido | lucro_real | imune
  regimeTributario: varchar("regime_tributario", { length: 30 }).default("simples"),
  // ltda | sa | eireli | mei | slu | sociedade_simples
  naturezaJuridica: varchar("natureza_juridica", { length: 50 }).default("ltda"),
  capitalSocial: numeric("capital_social", { precision: 14, scale: 2 }).default("0"),
  dataConstituicao: date("data_constituicao"),
  enderecoLogradouro: varchar("endereco_logradouro", { length: 255 }),
  enderecoNumero: varchar("endereco_numero", { length: 30 }),
  enderecoComplemento: varchar("endereco_complemento", { length: 100 }),
  enderecoBairro: varchar("endereco_bairro", { length: 100 }),
  enderecoCidade: varchar("endereco_cidade", { length: 100 }),
  enderecoUf: varchar("endereco_uf", { length: 2 }),
  enderecoCep: varchar("endereco_cep", { length: 10 }),
  objetoSocial: text("objeto_social"),
  cnaePrincipal: varchar("cnae_principal", { length: 20 }),
  cnaesSecundarios: text("cnaes_secundarios").array(),
  // ativa | inativa | em_constituicao | em_baixa | baixada
  status: varchar("status", { length: 20 }).default("ativa"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_sociedades_tenant").on(t.tenantId),
  index("idx_sociedades_cnpj").on(t.cnpj),
  index("idx_sociedades_client").on(t.clientId),
]);

export const socios = pgTable("socios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  nome: varchar("nome", { length: 200 }).notNull(),
  // pf | pj
  tipoPessoa: varchar("tipo_pessoa", { length: 2 }).default("pf"),
  cpfCnpj: varchar("cpf_cnpj", { length: 18 }),
  rg: varchar("rg", { length: 30 }),
  nacionalidade: varchar("nacionalidade", { length: 50 }).default("Brasileira"),
  estadoCivil: varchar("estado_civil", { length: 30 }),
  profissao: varchar("profissao", { length: 100 }),
  email: varchar("email", { length: 200 }),
  telefone: varchar("telefone", { length: 30 }),
  enderecoCompleto: text("endereco_completo"),
  // socio | administrador | socio_administrador | conselheiro
  qualificacao: varchar("qualificacao", { length: 50 }).default("socio"),
  percentualParticipacao: numeric("percentual_participacao", { precision: 7, scale: 4 }).default("0"),
  valorIntegralizado: numeric("valor_integralizado", { precision: 14, scale: 2 }).default("0"),
  dataEntrada: date("data_entrada"),
  dataSaida: date("data_saida"),
  isAtivo: integer("is_ativo").default(1),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_socios_sociedade").on(t.sociedadeId),
  index("idx_socios_tenant").on(t.tenantId),
]);

export const alteracoesSocietarias = pgTable("alteracoes_societarias", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  // constituicao | alteracao_contratual | cessao_cotas |
  // mudanca_regime | mudanca_endereco | entrada_socio |
  // saida_socio | aumento_capital | reducao_capital |
  // mudanca_objeto | distrato
  tipo: varchar("tipo", { length: 40 }).notNull(),
  descricao: text("descricao").notNull(),
  dataEvento: date("data_evento").notNull(),
  dataRegistro: date("data_registro"),
  // jucemg | jucesp | rfb | prefeitura | cartorio
  orgaoRegistro: varchar("orgao_registro", { length: 30 }),
  numeroRegistro: varchar("numero_registro", { length: 100 }),
  // Snapshot do quadro societário no momento da alteração
  snapshotQuadro: jsonb("snapshot_quadro").$type<Record<string, any>>().default({}),
  documentoId: varchar("documento_id"),
  // pendente | registrada | cancelada
  status: varchar("status", { length: 20 }).default("registrada"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_alteracoes_sociedade").on(t.sociedadeId),
  index("idx_alteracoes_tenant").on(t.tenantId),
  index("idx_alteracoes_data").on(t.dataEvento),
]);

export const documentosSocietarios = pgTable("documentos_societarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  // contrato_social | ata | distrato | procuracao | certidao |
  // certificado | alvara | licenca | template | outro
  tipo: varchar("tipo", { length: 30 }).notNull(),
  titulo: varchar("titulo", { length: 300 }).notNull(),
  descricao: text("descricao"),
  // Path no object storage ou markdown inline (templates)
  storagePath: varchar("storage_path", { length: 500 }),
  conteudoMarkdown: text("conteudo_markdown"),
  mimeType: varchar("mime_type", { length: 100 }),
  tamanhoBytes: integer("tamanho_bytes"),
  // Texto extraído (PDF/DOCX) — útil pro Cérebro/RAG
  textoExtraido: text("texto_extraido"),
  dataDocumento: date("data_documento"),
  dataValidade: date("data_validade"),
  numeroDocumento: varchar("numero_documento", { length: 100 }),
  variaveis: jsonb("variaveis").$type<Record<string, any>>().default({}),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  // Sprint 3 — distingue documentos gerados pelo agente (ex.: minutas) dos uploadados manualmente.
  geradoPorAgente: boolean("gerado_por_agente").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_documentos_sociedade").on(t.sociedadeId),
  index("idx_documentos_tenant").on(t.tenantId),
  index("idx_documentos_tipo").on(t.tipo),
]);

export const obrigacoesSocietarias = pgTable("obrigacoes_societarias", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  titulo: varchar("titulo", { length: 200 }).notNull(),
  // certidao_negativa | renovacao_alvara | assembleia |
  // declaracao_anual | renovacao_certificado | livro_diario | outro
  tipo: varchar("tipo", { length: 40 }).notNull(),
  descricao: text("descricao"),
  dataVencimento: date("data_vencimento").notNull(),
  // unica | mensal | trimestral | semestral | anual
  periodicidade: varchar("periodicidade", { length: 20 }).default("unica"),
  alertaDias: integer("alerta_dias").default(15),
  // pendente | em_andamento | concluida | atrasada | cancelada
  status: varchar("status", { length: 20 }).default("pendente"),
  dataConclusao: date("data_conclusao"),
  responsavel: varchar("responsavel").references(() => users.id),
  documentoId: varchar("documento_id"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_obrigacoes_sociedade").on(t.sociedadeId),
  index("idx_obrigacoes_tenant").on(t.tenantId),
  index("idx_obrigacoes_vencimento").on(t.dataVencimento),
  index("idx_obrigacoes_status").on(t.status),
]);

export const certificadosDigitais = pgTable("certificados_digitais", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  // a1 | a3
  tipo: varchar("tipo", { length: 5 }).notNull(),
  titular: varchar("titular", { length: 200 }).notNull(),
  cpfCnpjTitular: varchar("cpf_cnpj_titular", { length: 18 }),
  emissor: varchar("emissor", { length: 100 }),
  numeroSerie: varchar("numero_serie", { length: 100 }),
  dataEmissao: date("data_emissao"),
  dataValidade: date("data_validade").notNull(),
  // arquivoEnc: PFX criptografado via cryptoService AES-256-GCM. NUNCA em texto puro.
  arquivoEnc: text("arquivo_enc"),
  // ativo | vencido | revogado
  status: varchar("status", { length: 20 }).default("ativo"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_certificados_sociedade").on(t.sociedadeId),
  index("idx_certificados_tenant").on(t.tenantId),
  index("idx_certificados_validade").on(t.dataValidade),
]);

export const insertSociedadeSchema = createInsertSchema(sociedades).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertSocioSchema = createInsertSchema(socios).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertAlteracaoSocietariaSchema = createInsertSchema(alteracoesSocietarias).omit({
  id: true, createdAt: true,
});
export const insertDocumentoSocietarioSchema = createInsertSchema(documentosSocietarios).omit({
  id: true, createdAt: true,
});
export const insertObrigacaoSocietariaSchema = createInsertSchema(obrigacoesSocietarias).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertCertificadoDigitalSchema = createInsertSchema(certificadosDigitais).omit({
  id: true, createdAt: true,
});

export type Sociedade = typeof sociedades.$inferSelect;
export type InsertSociedade = z.infer<typeof insertSociedadeSchema>;
export type Socio = typeof socios.$inferSelect;
export type InsertSocio = z.infer<typeof insertSocioSchema>;
export type AlteracaoSocietaria = typeof alteracoesSocietarias.$inferSelect;
export type InsertAlteracaoSocietaria = z.infer<typeof insertAlteracaoSocietariaSchema>;
export type DocumentoSocietario = typeof documentosSocietarios.$inferSelect;
export type InsertDocumentoSocietario = z.infer<typeof insertDocumentoSocietarioSchema>;
export type ObrigacaoSocietaria = typeof obrigacoesSocietarias.$inferSelect;
export type InsertObrigacaoSocietaria = z.infer<typeof insertObrigacaoSocietariaSchema>;
export type CertificadoDigital = typeof certificadosDigitais.$inferSelect;
export type InsertCertificadoDigital = z.infer<typeof insertCertificadoDigitalSchema>;

// =============================================================================
// PIPELINE SOCIETÁRIO (Sprint 1 — fundação Kanban manual + checklist)
// 5 tabelas. Princípio dual-mode: tudo aqui funciona 100% manual; Sprint 2
// adiciona agente como camada aditiva sobre estas tabelas (jamais substitui).
// =============================================================================

// 1. Configuração de pipeline (template de colunas + regras por tenant)
export const pipelineConfigs = pgTable("pipeline_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  nome: varchar("nome", { length: 100 }).notNull(),
  // 'constituicao' | 'alteracao_contratual' | 'mudanca_status' | 'dissolucao' | 'transformacao'
  tipoProcesso: varchar("tipo_processo", { length: 50 }).notNull(),
  // [{ id: 'backlog', nome: 'Backlog', ordem: 0, cor: 'bg-slate-500' }, ...]
  colunas: jsonb("colunas").$type<Array<{ id: string; nome: string; ordem: number; cor?: string }>>().notNull(),
  // { "from→to": { autoAdvance?: boolean, condition?: string } } — usado no Sprint 3
  regrasTransicao: jsonb("regras_transicao").$type<Record<string, any>>().default({}),
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
}, (t) => [
  index("idx_pipeline_configs_tenant").on(t.tenantId),
  index("idx_pipeline_configs_tipo").on(t.tenantId, t.tipoProcesso, t.isDefault),
]);

// 2. Itens de checklist por etapa (template — materializado em processoTarefas ao criar processo)
export const pipelineChecklistItems = pgTable("pipeline_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  pipelineConfigId: varchar("pipeline_config_id").notNull().references(() => pipelineConfigs.id, { onDelete: "cascade" }),
  // matches colunas[].id
  etapa: varchar("etapa", { length: 50 }).notNull(),
  ordem: integer("ordem").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  // 'agente' | 'analista' | 'cliente' | 'sistema'
  executorType: varchar("executor_type", { length: 20 }).notNull(),
  // {type, params, when} — apenas se executor='agente'|'sistema' (Sprint 3)
  acaoAutomatica: jsonb("acao_automatica").$type<Record<string, any>>(),
  isRequired: boolean("is_required").default(true),
  bloqueiaAvanco: boolean("bloqueia_avanco").default(true),
  // Motor dinâmico:
  // 'checkbox' (default) | 'upload' | 'date' | 'form' | 'approval'
  tipo: varchar("tipo", { length: 20 }).notNull().default("checkbox"),
  // slug estável p/ referência cruzada (deps); único por config quando informado
  tarefaKey: varchar("tarefa_key", { length: 80 }),
  // tarefaKeys que precisam estar concluídas antes desta ficar liberada
  dependsOnKeys: text("depends_on_keys").array(),
  // regra opcional: { field: 'sociedade.naturezaJuridica', op: 'eq'|'neq'|'in', value: ... }
  // Avaliada na materialização contra a sociedade — se false, tarefa fica aplicavel=false
  condicaoJson: jsonb("condicao_json").$type<Record<string, any>>(),
  // [{ name, label, type:'text'|'number'|'date'|'select', required, options? }] para tipo='form'
  formSchemaJson: jsonb("form_schema_json").$type<Array<Record<string, any>>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_checklist_config_etapa").on(t.pipelineConfigId, t.etapa, t.ordem),
]);

// 3. Processo societário (CARD do Kanban)
export const processosSocietarios = pgTable("processos_societarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  // SOC-{YYYY}-{seq} — gerado pelo backend, único por tenant
  processNumber: varchar("process_number", { length: 50 }).notNull(),
  sociedadeId: varchar("sociedade_id").notNull().references(() => sociedades.id, { onDelete: "cascade" }),
  pipelineConfigId: varchar("pipeline_config_id").notNull().references(() => pipelineConfigs.id, { onDelete: "restrict" }),
  tipoProcesso: varchar("tipo_processo", { length: 50 }).notNull(),
  subtipo: varchar("subtipo", { length: 50 }),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  colunaAtual: varchar("coluna_atual", { length: 50 }).notNull().default("backlog"),
  // Princípio dual-mode: 'manual' | 'assistido' | 'auto'
  modoOperacao: varchar("modo_operacao", { length: 20 }).notNull().default("assistido"),
  analistaResponsavelId: varchar("analista_responsavel_id").references(() => users.id),
  solicitanteId: varchar("solicitante_id").references(() => users.id),
  clientePessoaId: varchar("cliente_pessoa_id"), // FK lógica → pessoas (CRM 2.0); validado em runtime
  // 'whatsapp' | 'email' | 'inapp' | 'ambos'
  clienteContatoPreferido: varchar("cliente_contato_preferido", { length: 20 }).default("inapp"),
  dataSolicitacao: timestamp("data_solicitacao").defaultNow(),
  dataPrevistaConclusao: date("data_prevista_conclusao"),
  dataConclusao: timestamp("data_conclusao"),
  // 'ativo' | 'pausado' | 'concluido' | 'cancelado'
  status: varchar("status", { length: 20 }).default("ativo"),
  // 'baixa' | 'media' | 'alta' | 'urgente'
  prioridade: varchar("prioridade", { length: 20 }).default("media"),
  alteracaoSocietariaId: varchar("alteracao_societaria_id"), // FK lógica → alteracoesSocietarias
  notasInternas: text("notas_internas"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
}, (t) => [
  index("idx_proc_soc_tenant_coluna").on(t.tenantId, t.colunaAtual),
  index("idx_proc_soc_tenant_status").on(t.tenantId, t.status),
  index("idx_proc_soc_analista").on(t.analistaResponsavelId),
  index("idx_proc_soc_sociedade").on(t.sociedadeId),
  uniqueIndex("uq_proc_soc_tenant_number").on(t.tenantId, t.processNumber),
]);

// 4. Tarefas materializadas no processo (instâncias do checklist)
export const processoTarefas = pgTable("processo_tarefas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  processoId: varchar("processo_id").notNull().references(() => processosSocietarios.id, { onDelete: "cascade" }),
  // Origem do template (nullable para tarefas ad-hoc)
  checklistItemId: varchar("checklist_item_id").references(() => pipelineChecklistItems.id, { onDelete: "set null" }),
  etapa: varchar("etapa", { length: 50 }).notNull(),
  ordem: integer("ordem").notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  executorType: varchar("executor_type", { length: 20 }).notNull(),
  // 'pendente' | 'em_andamento' | 'concluido' | 'bloqueado' | 'cancelado'
  status: varchar("status", { length: 20 }).default("pendente"),
  isRequired: boolean("is_required").default(true),
  bloqueiaAvanco: boolean("bloqueia_avanco").default(true),
  acaoAutomatica: jsonb("acao_automatica").$type<Record<string, any>>(),
  autoExecuted: boolean("auto_executed").default(false),
  autoExecutionResult: jsonb("auto_execution_result").$type<Record<string, any>>(),
  // Sprint 3 — audit de execução de skill (manual ou automática) + throttle de lembretes.
  lastAutoExecutionAt: timestamp("last_auto_execution_at"),
  lastReminderAt: timestamp("last_reminder_at"),
  concluidoAt: timestamp("concluido_at"),
  concluidoBy: varchar("concluido_by").references(() => users.id),
  concluidoNotes: text("concluido_notes"),
  // [{path, name, mime, size}] — Object Storage
  anexos: jsonb("anexos").$type<Array<{ path: string; name: string; mime?: string; size?: number }>>().default([]),
  assignedTo: varchar("assigned_to").references(() => users.id),
  // Motor dinâmico (snapshot do template no momento da materialização):
  tipo: varchar("tipo", { length: 20 }).notNull().default("checkbox"),
  tarefaKey: varchar("tarefa_key", { length: 80 }),
  dependsOnKeys: text("depends_on_keys").array(),
  condicaoJson: jsonb("condicao_json").$type<Record<string, any>>(),
  formSchemaJson: jsonb("form_schema_json").$type<Array<Record<string, any>>>(),
  // Resposta coletada na conclusão. Por tipo:
  //   upload:   { path, name, mime?, size? }
  //   date:     { data: 'YYYY-MM-DD' }
  //   form:     { values: { [name]: any } }
  //   approval: { aprovadorId, aprovadoEm }
  dadosColetadosJson: jsonb("dados_coletados_json").$type<Record<string, any>>(),
  // false quando condicaoJson não bateu na sociedade — tarefa fica oculta / N/A
  aplicavel: boolean("aplicavel").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_proc_tarefa_processo").on(t.processoId, t.etapa, t.ordem),
  index("idx_proc_tarefa_tenant_status").on(t.tenantId, t.status, t.executorType),
]);

// 5. Histórico de movimentação entre colunas
export const processoMovimentacoes = pgTable("processo_movimentacoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  processoId: varchar("processo_id").notNull().references(() => processosSocietarios.id, { onDelete: "cascade" }),
  colunaDe: varchar("coluna_de", { length: 50 }),
  colunaPara: varchar("coluna_para", { length: 50 }).notNull(),
  movidoPor: varchar("movido_por").references(() => users.id),
  movidoPorAgente: boolean("movido_por_agente").default(false),
  motivo: text("motivo"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_proc_mov_processo").on(t.processoId, t.createdAt),
]);

export const insertPipelineConfigSchema = createInsertSchema(pipelineConfigs).omit({
  id: true, createdAt: true,
});
export const insertPipelineChecklistItemSchema = createInsertSchema(pipelineChecklistItems).omit({
  id: true, createdAt: true,
});
export const insertProcessoSocietarioSchema = createInsertSchema(processosSocietarios).omit({
  id: true, processNumber: true, createdAt: true, updatedAt: true,
});
export const insertProcessoTarefaSchema = createInsertSchema(processoTarefas).omit({
  id: true, createdAt: true,
});
export const insertProcessoMovimentacaoSchema = createInsertSchema(processoMovimentacoes).omit({
  id: true, createdAt: true,
});

export type PipelineConfig = typeof pipelineConfigs.$inferSelect;
export type InsertPipelineConfig = z.infer<typeof insertPipelineConfigSchema>;
export type PipelineChecklistItem = typeof pipelineChecklistItems.$inferSelect;
export type InsertPipelineChecklistItem = z.infer<typeof insertPipelineChecklistItemSchema>;
export type ProcessoSocietario = typeof processosSocietarios.$inferSelect;
export type InsertProcessoSocietario = z.infer<typeof insertProcessoSocietarioSchema>;
export type ProcessoTarefa = typeof processoTarefas.$inferSelect;
export type InsertProcessoTarefa = z.infer<typeof insertProcessoTarefaSchema>;
export type ProcessoMovimentacao = typeof processoMovimentacoes.$inferSelect;
export type InsertProcessoMovimentacao = z.infer<typeof insertProcessoMovimentacaoSchema>;

// =============================================================================
// CENTRAL DE PRODUÇÃO — EVOLUÇÃO (Subprojetos · Drive · Calendário · Agente Scrum)
// Tabelas adicionadas SEM modificar funcionalidades existentes.
// =============================================================================

// Subprojetos: nível intermediário Projeto → Subprojeto → Sprint → Task
// Retrocompatível: sprints/tasks sem subprojectId continuam funcionando
export const subprojects = pgTable("subprojects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  description: text("description"),
  ordem: integer("ordem").default(0),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: varchar("status", { length: 20 }).default("ativo"), // ativo|concluido|pausado
  color: varchar("color", { length: 20 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxSubProject: index("idx_sub_project").on(t.projectId),
  idxSubTenant: index("idx_sub_tenant").on(t.tenantId),
}));

// (projectFiles unificado com a tabela já existente acima — apenas estendido com tenantId/subprojectId/taskId/extractedText/categoria.)

// Calendário do projeto — reuniões, marcos, entregas, bloqueios, tasks com prazo
export const projectCalendarEvents = pgTable("project_calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull(),
  subprojectId: varchar("subproject_id").references(() => subprojects.id, { onDelete: "set null" }),
  sprintId: varchar("sprint_id"), // FK lógica scrum_sprints
  titulo: varchar("titulo", { length: 300 }).notNull(),
  descricao: text("descricao"),
  dataInicio: date("data_inicio").notNull(),
  dataFim: date("data_fim"),
  horaInicio: varchar("hora_inicio", { length: 5 }), // '09:00'
  horaFim: varchar("hora_fim", { length: 5 }),
  // reuniao_sprint|marco_go_live|entrega|tarefa|bloqueio|outro
  tipo: varchar("tipo", { length: 30 }).default("outro"),
  participantes: text("participantes"), // CSV ou JSON-string
  local: varchar("local", { length: 300 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxCalProject: index("idx_cal_project").on(t.projectId),
  idxCalTenant: index("idx_cal_tenant").on(t.tenantId),
  idxCalDateRange: index("idx_cal_date_range").on(t.projectId, t.dataInicio),
}));

// Sessões de chat do Agente Scrum por tarefa (Modo 2 — assistente da tarefa)
// Reutiliza super_agent_messages com taskSessionId
export const taskAgentSessions = pgTable("task_agent_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull(),
  projectId: varchar("project_id").notNull(),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").references(() => users.id),
  titulo: varchar("titulo", { length: 200 }).default("Conversa com Agente Scrum"),
  taskContext: jsonb("task_context"), // Snapshot dos dados da task no início da sessão
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxTasSession: index("idx_tas_task").on(t.taskId),
  idxTasTenant: index("idx_tas_tenant").on(t.tenantId),
}));

// Insert schemas (Central de Produção evolução — projectFiles já tinha schema acima)
export const insertSubprojectSchema = createInsertSchema(subprojects).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectCalendarEventSchema = createInsertSchema(projectCalendarEvents).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTaskAgentSessionSchema = createInsertSchema(taskAgentSessions).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type Subproject = typeof subprojects.$inferSelect;
export type InsertSubproject = z.infer<typeof insertSubprojectSchema>;
export type ProjectCalendarEvent = typeof projectCalendarEvents.$inferSelect;
export type InsertProjectCalendarEvent = z.infer<typeof insertProjectCalendarEventSchema>;
export type TaskAgentSession = typeof taskAgentSessions.$inferSelect;
export type InsertTaskAgentSession = z.infer<typeof insertTaskAgentSessionSchema>;

// ─── Dev Center IDE — pipeline runs e artefatos gerados ─────────────────────
// Sprint 1: Architect → Developer → QA → awaiting_deploy (deploy real é Sprint 2)
export const idePipelineRuns = pgTable("ide_pipeline_runs", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId:        varchar("tenant_id").notNull(),
  userId:          varchar("user_id"),
  projectId:       varchar("project_id"), // opcional: vincular a projeto do CRM/Produção
  title:           varchar("title", { length: 300 }).notNull(),
  requirement:     text("requirement").notNull(),
  // pending | running_architect | awaiting_design_approval | running_developer | running_qa
  // | awaiting_deploy | deploying | deployed | failed | cancelled
  status:          varchar("status", { length: 40 }).notNull().default("pending"),
  currentPhase:    varchar("current_phase", { length: 40 }), // architect|developer|qa|devops|done
  errorMessage:    text("error_message"),
  designDoc:       jsonb("design_doc"),       // saída do Arquiteto (analise + plano de arquivos)
  qaReport:        jsonb("qa_report"),        // {verdict:'PASS'|'FAIL', findings:[...]}
  deployResult:    jsonb("deploy_result"),    // Sprint 2 — placeholder no Sprint 1
  modelArchitect:  varchar("model_architect", { length: 100 }),
  modelDeveloper:  varchar("model_developer", { length: 100 }),
  modelQa:         varchar("model_qa", { length: 100 }),
  // Sprint 3B — Loop de auto-correção pós-deploy
  autoFixAttempts: integer("auto_fix_attempts").default(0).notNull(),
  lastDeployError: text("last_deploy_error"),
  startedAt:       timestamp("started_at"),
  finishedAt:      timestamp("finished_at"),
  // Marca quando o consultor visitou o Preview da run pela primeira vez.
  // Usado como gate server-side para liberar /approve-deploy.
  previewVisitedAt: timestamp("preview_visited_at"),
  // Sprint 5 — URL do repositório criado/usado pelo commit automático no Gitea
  // (preenchido após primeiro deploy com Gitea configurado). NULL se nunca foi
  // commitado ou se o tenant não tem servidor Gitea cadastrado.
  gitRepoUrl:      varchar("git_repo_url"),
  // Sprint 6 — alvo do deploy: 'frappe' (default), 'suite', 'consult',
  // 'standalone' ou 'clone'. Define o prompt do Arquiteto e o destino real
  // do executeDeploy.
  target:          varchar("target", { length: 20 }).notNull().default("frappe"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxIdeRunTenant: index("idx_ide_run_tenant").on(t.tenantId),
  idxIdeRunStatus: index("idx_ide_run_status").on(t.status),
}));

export const ideArtifacts = pgTable("ide_artifacts", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId:        varchar("run_id").notNull().references(() => idePipelineRuns.id, { onDelete: "cascade" }),
  tenantId:     varchar("tenant_id").notNull(),
  fileName:     varchar("file_name", { length: 300 }).notNull(),
  language:     varchar("language", { length: 30 }).notNull().default("text"), // python|json|javascript|typescript|sql|markdown
  // 'doctype' | 'server_script' | 'client_script' | 'doc' | 'sql' | 'other'
  kind:         varchar("kind", { length: 30 }).notNull().default("other"),
  content:      text("content").notNull(),
  ordem:        integer("ordem").default(0),
  // qual fase produziu/atualizou: 'architect' | 'developer' | 'qa_fix' | 'user_edit' | 'auto_fix'
  phase:        varchar("phase", { length: 30 }).notNull().default("developer"),
  // Sprint 3A — snapshot do conteúdo gerado, usado pelo botão "Resetar arquivo"
  // e como referência de diff para a re-validação focada do QA.
  originalContent: text("original_content"),
  isEdited:        boolean("is_edited").default(false).notNull(),
  editedAt:        timestamp("edited_at"),
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxIdeArtRun: index("idx_ide_art_run").on(t.runId),
  idxIdeArtTenant: index("idx_ide_art_tenant").on(t.tenantId),
}));

// Sprint 3C — preferências de modelo Claude por fase, por tenant
export const idePreferences = pgTable("ide_preferences", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId:       varchar("tenant_id").notNull().unique(),
  modelArchitect: varchar("model_architect", { length: 100 }),
  modelDeveloper: varchar("model_developer", { length: 100 }),
  modelQa:        varchar("model_qa", { length: 100 }),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

export const insertIdePipelineRunSchema = createInsertSchema(idePipelineRuns).omit({ id: true, createdAt: true, updatedAt: true, startedAt: true, finishedAt: true });
export const insertIdeArtifactSchema = createInsertSchema(ideArtifacts).omit({ id: true, createdAt: true, updatedAt: true });

// Sprint 6 — Log granular do executeDeploy: cada artefato (DocType / Server
// Script) gera uma linha success/error. Usado pelo painel Pipeline para
// mostrar feedback em tempo real e pelo retry/auto-fix.
export const devDeployLogs = pgTable("dev_deploy_logs", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId:            varchar("run_id").notNull().references(() => idePipelineRuns.id, { onDelete: "cascade" }),
  tenantId:         varchar("tenant_id").notNull(),
  // 'frappe' | 'suite' | 'consult' | 'standalone' | 'clone'
  target:           varchar("target", { length: 20 }).notNull(),
  // 'success' | 'error' | 'skipped'
  status:           varchar("status", { length: 20 }).notNull(),
  // tipo do artefato deployado: 'doctype' | 'server_script' | 'clear_cache' | 'other'
  artifactKind:     varchar("artifact_kind", { length: 30 }),
  artifactName:     varchar("artifact_name", { length: 255 }),
  // URL absoluta no Frappe (se disponível)
  doctypeUrl:       varchar("doctype_url", { length: 500 }),
  errorMessage:     text("error_message"),
  payload:          jsonb("payload"),
  createdAt:        timestamp("created_at").defaultNow(),
}, (t) => ({
  idxDevDeployRun: index("idx_dev_deploy_run").on(t.runId),
  idxDevDeployTenant: index("idx_dev_deploy_tenant").on(t.tenantId),
}));

export const insertDevDeployLogSchema = createInsertSchema(devDeployLogs).omit({ id: true, createdAt: true });
export type DevDeployLog = typeof devDeployLogs.$inferSelect;
export type InsertDevDeployLog = z.infer<typeof insertDevDeployLogSchema>;
export const insertIdePreferencesSchema = createInsertSchema(idePreferences).omit({ id: true, updatedAt: true });
export type IdePipelineRun = typeof idePipelineRuns.$inferSelect;
export type InsertIdePipelineRun = z.infer<typeof insertIdePipelineRunSchema>;
export type IdeArtifact = typeof ideArtifacts.$inferSelect;
export type InsertIdeArtifact = z.infer<typeof insertIdeArtifactSchema>;
export type IdePreferences = typeof idePreferences.$inferSelect;
export type InsertIdePreferences = z.infer<typeof insertIdePreferencesSchema>;

// ============================================================================
// Sprint 4 — Infraestrutura (CoolifyClient + InfraManager)
// ----------------------------------------------------------------------------
// infra_servers: cada tenant pode conectar 1+ servidores Coolify (URL + token).
//   - coolifyTokenEnc é AES-256-GCM via cryptoService (formato iv:tag:cipher)
//   - status reflete último ping (online|offline|unknown)
// infra_services: cache local dos serviços/aplicações descobertos no Coolify.
//   - coolifyId é o UUID do recurso no Coolify (chave estrangeira lógica)
//   - clienteId opcional: vincula serviço a um cliente (multi-cliente por server)
//   - envVars armazenado em jsonb por simplicidade de UI (a fonte de verdade
//     continua sendo o Coolify; aqui é só cache da última leitura).
// ============================================================================
export const infraServers = pgTable("infra_servers", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId:         varchar("tenant_id").notNull(),
  name:             varchar("name", { length: 200 }).notNull(),
  // URL e token no nome "coolify_*" por compatibilidade com Sprint 4 — na prática
  // armazena URL+token de qualquer serviço (Coolify, Gitea, etc.) cujo tipo é
  // discriminado por `serviceType` (Sprint 5).
  coolifyUrl:       varchar("coolify_url", { length: 500 }).notNull(),
  coolifyTokenEnc:  text("coolify_token_enc").notNull(),
  serverIp:         varchar("server_ip", { length: 100 }),
  // 'online' | 'offline' | 'unknown'
  status:           varchar("status", { length: 20 }).notNull().default("unknown"),
  lastPingAt:       timestamp("last_ping_at"),
  // Sprint 5 — discrimina o tipo de serviço cadastrado: 'coolify' (default) ou 'gitea'.
  serviceType:      varchar("service_type", { length: 30 }).notNull().default("coolify"),
  createdAt:        timestamp("created_at").defaultNow(),
}, (t) => ({
  idxInfraServerTenant: index("idx_infra_server_tenant").on(t.tenantId),
  idxInfraServerType:   index("idx_infra_server_type").on(t.tenantId, t.serviceType),
}));

export const infraServices = pgTable("infra_services", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serverId:     varchar("server_id").notNull().references(() => infraServers.id, { onDelete: "cascade" }),
  tenantId:     varchar("tenant_id").notNull(),
  // UUID/identificador do recurso dentro do Coolify
  coolifyId:    varchar("coolify_id", { length: 100 }).notNull(),
  name:         varchar("name", { length: 200 }).notNull(),
  // 'application' | 'database' | 'service' (free-form do Coolify)
  serviceType:  varchar("service_type", { length: 50 }).notNull().default("application"),
  publicUrl:    varchar("public_url", { length: 500 }),
  // 'running' | 'stopped' | 'failed' | 'building' | 'unknown'
  status:       varchar("status", { length: 30 }).notNull().default("unknown"),
  clienteId:    varchar("cliente_id").references(() => clients.id),
  envVars:      jsonb("env_vars").$type<Record<string, string>>(),
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxInfraSvcServer: index("idx_infra_svc_server").on(t.serverId),
  idxInfraSvcTenant: index("idx_infra_svc_tenant").on(t.tenantId),
  uqInfraSvcCoolify: uniqueIndex("uq_infra_svc_coolify").on(t.serverId, t.coolifyId),
}));

export const insertInfraServerSchema = createInsertSchema(infraServers).omit({ id: true, createdAt: true, lastPingAt: true });
export const insertInfraServiceSchema = createInsertSchema(infraServices).omit({ id: true, createdAt: true, updatedAt: true });
export type InfraServer = typeof infraServers.$inferSelect;
export type InsertInfraServer = z.infer<typeof insertInfraServerSchema>;
export type InfraService = typeof infraServices.$inferSelect;
export type InsertInfraService = z.infer<typeof insertInfraServiceSchema>;

// ============================================================================
// Sprint 8 — Prompt Engineering Studio
// Versionamento dos system prompts dos agentes do pipeline IDE.
// Apenas uma versão isActive=1 por (tenantId, agentType) — garantido em
// transação ao ativar.
// ============================================================================
export const promptVersions = pgTable("prompt_versions", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId:     varchar("tenant_id").notNull(),
  // 'architect' | 'developer' | 'qa' | 'devops' | custom string
  agentType:    varchar("agent_type", { length: 50 }).notNull(),
  versionName:  varchar("version_name", { length: 100 }),
  systemPrompt: text("system_prompt").notNull(),
  changeNotes:  text("change_notes"),
  testScore:    integer("test_score"),       // 0-100, nullable
  isActive:     integer("is_active").default(0),
  createdById:  varchar("created_by_id").references(() => users.id),
  createdAt:    timestamp("created_at").defaultNow(),
}, (t) => ({
  idxPvTenantAgent: index("idx_pv_tenant_agent").on(t.tenantId, t.agentType),
  // Garante semântica "uma única versão ativa por (tenant, agentType)" no DB —
  // mesmo sob requisições concorrentes de activate ou seed simultâneo.
  uqPvActive: uniqueIndex("uq_pv_tenant_agent_active")
    .on(t.tenantId, t.agentType)
    .where(sql`is_active = 1`),
}));

export const insertPromptVersionSchema = createInsertSchema(promptVersions).omit({
  id: true, createdAt: true, isActive: true, testScore: true,
});
export type PromptVersion = typeof promptVersions.$inferSelect;
export type InsertPromptVersion = z.infer<typeof insertPromptVersionSchema>;

// ============================================================================
// MÓDULO PESSOAS (CRM 2.0) — Cadastro centralizado de relacionamentos
// Sprint 1: Fundação. Tenant-scoped, com múltiplos papéis (cliente, fornecedor,
// colaborador, transportadora, credor) por pessoa via tabela pessoa_papeis.
// ============================================================================

export const pessoas = pgTable("pessoas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),

  // 'PF' (pessoa física) | 'PJ' (pessoa jurídica)
  tipoPessoa: varchar("tipo_pessoa", { length: 2 }).notNull(),
  nomeFantasia: varchar("nome_fantasia", { length: 255 }).notNull(),
  razaoSocial: varchar("razao_social", { length: 255 }),
  // CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos
  cnpjCpf: varchar("cnpj_cpf", { length: 20 }).notNull(),
  rgIe: varchar("rg_ie", { length: 30 }),
  inscricaoMunicipal: varchar("inscricao_municipal", { length: 30 }),

  dataNascimentoFundacao: date("data_nascimento_fundacao"),

  // 'ativo' | 'inativo' | 'bloqueado'
  status: varchar("status", { length: 20 }).default("ativo").notNull(),
  observacoes: text("observacoes"),

  // ----- Campos comerciais (cf. planilha DATAEXPORT) -----
  // Identificador externo do sistema de origem (ex.: ERP, CRM legado, planilha)
  codigoExterno: varchar("codigo_externo", { length: 100 }),
  // Grupo / segmento de cadastro (ex.: VIP, Atacado, Revenda)
  pessoaGrupo: varchar("pessoa_grupo", { length: 100 }),
  // Vendedor responsável (texto livre — pode virar FK depois)
  vendedorPadrao: varchar("vendedor_padrao", { length: 150 }),
  categoria: varchar("categoria", { length: 100 }),
  tabelaPreco: varchar("tabela_preco", { length: 100 }),
  // Limite de crédito em R$ (decimal 14,2)
  limiteCredito: numeric("limite_credito", { precision: 14, scale: 2 }),
  // Periodicidade de compra/venda em dias (média histórica)
  periodicidadeVendaCompra: integer("periodicidade_venda_compra"),
  // Valor mínimo de pedido/compra (R$)
  valorMinimoCompra: numeric("valor_minimo_compra", { precision: 14, scale: 2 }),

  // Vínculo com o cadastro legado (clients.id) para idempotência da migração
  // e para resolver redirects de URLs antigas /clientes/:legacyId → /pessoas/:novoId
  legacyClientId: varchar("legacy_client_id"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id"),
  updatedById: varchar("updated_by_id"),
}, (t) => ({
  // Unicidade de documento por tenant (evita duplicidade na importação)
  uqPessoaTenantCnpj: uniqueIndex("uq_pessoa_tenant_cnpj").on(t.tenantId, t.cnpjCpf),
  // Unicidade de vínculo com o cadastro legado por tenant (idempotência)
  uqPessoaTenantLegacy: uniqueIndex("uq_pessoa_tenant_legacy").on(t.tenantId, t.legacyClientId),
  idxPessoaTenantStatus: index("idx_pessoa_tenant_status").on(t.tenantId, t.status),
  idxPessoaTenantNome: index("idx_pessoa_tenant_nome").on(t.tenantId, t.nomeFantasia),
}));

export const enderecos = pgTable("enderecos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pessoaId: varchar("pessoa_id").references(() => pessoas.id, { onDelete: "cascade" }).notNull(),
  // 'principal' | 'cobranca' | 'entrega' | 'outro'
  tipo: varchar("tipo", { length: 20 }).default("principal").notNull(),
  logradouro: varchar("logradouro", { length: 255 }),
  numero: varchar("numero", { length: 60 }),
  complemento: varchar("complemento", { length: 200 }),
  bairro: varchar("bairro", { length: 100 }),
  cidade: varchar("cidade", { length: 100 }),
  codigoMunicipio: varchar("codigo_municipio", { length: 10 }),
  uf: varchar("uf", { length: 2 }),
  codigoUf: varchar("codigo_uf", { length: 5 }),
  cep: varchar("cep", { length: 10 }),
  pais: varchar("pais", { length: 50 }).default("Brasil"),
  codigoPais: varchar("codigo_pais", { length: 10 }),
  isPrincipal: integer("is_principal").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxEnderecoPessoa: index("idx_endereco_pessoa").on(t.pessoaId),
}));

export const contatos = pgTable("contatos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pessoaId: varchar("pessoa_id").references(() => pessoas.id, { onDelete: "cascade" }).notNull(),
  // 'telefone' | 'celular' | 'whatsapp' | 'email' | 'site'
  tipo: varchar("tipo", { length: 20 }).notNull(),
  valor: varchar("valor", { length: 255 }).notNull(),
  isPrincipal: integer("is_principal").default(0),
  isValidado: integer("is_validado").default(0),
  ultimoBounce: timestamp("ultimo_bounce"),
  bounceCount: integer("bounce_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxContatoPessoa: index("idx_contato_pessoa").on(t.pessoaId),
  idxContatoTipoValor: index("idx_contato_tipo_valor").on(t.tipo, t.valor),
  // Garante "no máximo 1 principal por (pessoa, tipo)" no nível do banco
  uqContatoPrincipalTipo: uniqueIndex("uq_contato_principal_tipo")
    .on(t.pessoaId, t.tipo)
    .where(sql`is_principal = 1`),
}));

export const pessoaPapeis = pgTable("pessoa_papeis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pessoaId: varchar("pessoa_id").references(() => pessoas.id, { onDelete: "cascade" }).notNull(),
  tenantId: varchar("tenant_id").notNull(),
  // 'cliente' | 'fornecedor' | 'colaborador' | 'transportadora' | 'credor' | 'prospect' | 'parceiro'
  tipoPapel: varchar("tipo_papel", { length: 30 }).notNull(),
  // 'ativo' | 'inativo' | 'pendente'
  status: varchar("status", { length: 20 }).default("ativo").notNull(),
  dataInicio: date("data_inicio").defaultNow(),
  dataFim: date("data_fim"),
  // metadata flexível por tipo de papel — ex.:
  //   cliente:    { limiteCredito, tabelaPreco, vendedorPadrao, categoria, frequenciaCompraDias, valorMinimoPedido }
  //   fornecedor: { prazoMedioPagamento, tipoFornecimento, ratingQualidade, ratingPrazo, isCritico }
  //   colaborador:{ cargo, departamento, dataAdmissao, salario, tipoContratacao, gestorId, skills }
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  // Garante "no máximo 1 papel ativo por (pessoa, tipo)" — evita 2x cliente
  uqPessoaPapelAtivo: uniqueIndex("uq_pessoa_papel_ativo")
    .on(t.pessoaId, t.tipoPapel)
    .where(sql`status = 'ativo'`),
  idxPapelTenantTipo: index("idx_papel_tenant_tipo").on(t.tenantId, t.tipoPapel),
}));

// ----- Insert schemas (Zod) -----
export const insertPessoaSchema = createInsertSchema(pessoas).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertEnderecoSchema = createInsertSchema(enderecos).omit({
  id: true, createdAt: true,
});
export const insertContatoSchema = createInsertSchema(contatos).omit({
  id: true, createdAt: true, ultimoBounce: true, bounceCount: true,
});
export const insertPessoaPapelSchema = createInsertSchema(pessoaPapeis).omit({
  id: true, createdAt: true, updatedAt: true,
});

// ----- Types -----
export type Pessoa = typeof pessoas.$inferSelect;
export type InsertPessoa = z.infer<typeof insertPessoaSchema>;
export type Endereco = typeof enderecos.$inferSelect;
export type InsertEndereco = z.infer<typeof insertEnderecoSchema>;
export type Contato = typeof contatos.$inferSelect;
export type InsertContato = z.infer<typeof insertContatoSchema>;
export type PessoaPapel = typeof pessoaPapeis.$inferSelect;
export type InsertPessoaPapel = z.infer<typeof insertPessoaPapelSchema>;

// ----- Relations -----
export const pessoasRelations = relations(pessoas, ({ many }) => ({
  enderecos: many(enderecos),
  contatos: many(contatos),
  papeis: many(pessoaPapeis),
}));
export const enderecosRelations = relations(enderecos, ({ one }) => ({
  pessoa: one(pessoas, { fields: [enderecos.pessoaId], references: [pessoas.id] }),
}));
export const contatosRelations = relations(contatos, ({ one }) => ({
  pessoa: one(pessoas, { fields: [contatos.pessoaId], references: [pessoas.id] }),
}));
export const pessoaPapeisRelations = relations(pessoaPapeis, ({ one }) => ({
  pessoa: one(pessoas, { fields: [pessoaPapeis.pessoaId], references: [pessoas.id] }),
}));

// =============================================================================
// MÓDULO RECOVERY (Recuperação de Empresas) — Sprint 1: Fundação
// =============================================================================
// Princípio crítico: dívidas em negociação NUNCA viram conta a pagar
// automaticamente. Só após acordo homologado + parcela liberada (Sprint 3).
// Por isso o módulo é fisicamente separado do Control (AP/AR).

// Processo de recuperação (uma empresa em recuperação tem 1 processo ativo)
export const recoveryProcesses = pgTable("recovery_processes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Empresa em recuperação (cliente do consultor): aponta para Pessoas (PJ)
  clientePessoaId: varchar("cliente_pessoa_id").references(() => pessoas.id),
  // Nome amigável caso ainda não exista pessoa cadastrada
  nomeProcesso: varchar("nome_processo", { length: 255 }).notNull(),
  // 'judicial' | 'extrajudicial' | 'preventiva' | 'reestruturacao_amigavel'
  tipoRecuperacao: varchar("tipo_recuperacao", { length: 30 }).notNull().default("extrajudicial"),
  // 'diagnostico' | 'negociacao' | 'acordo_homologado' | 'em_cumprimento' | 'concluido' | 'inadimplente' | 'arquivado'
  status: varchar("status", { length: 30 }).notNull().default("diagnostico"),
  numeroProcessoJudicial: varchar("numero_processo_judicial", { length: 100 }),
  varaJudicial: varchar("vara_judicial", { length: 255 }),
  comarca: varchar("comarca", { length: 255 }),
  dataInicio: date("data_inicio").defaultNow(),
  dataLimiteHomologacao: date("data_limite_homologacao"),
  dataConclusao: date("data_conclusao"),
  // Totais consolidados (preenchidos por triggers/recálculos no app)
  valorTotalDividas: numeric("valor_total_dividas", { precision: 16, scale: 2 }).default("0"),
  valorAcordosFechados: numeric("valor_acordos_fechados", { precision: 16, scale: 2 }).default("0"),
  valorPago: numeric("valor_pago", { precision: 16, scale: 2 }).default("0"),
  // Buffer de segurança no caixa projetado (default 15% — usado na Sprint 3)
  bufferCaixa: numeric("buffer_caixa", { precision: 5, scale: 4 }).default("0.1500"),
  responsavelId: varchar("responsavel_id").references(() => users.id),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
  updatedById: varchar("updated_by_id").references(() => users.id),
}, (t) => ({
  idxRecoveryTenantStatus: index("idx_recovery_tenant_status").on(t.tenantId, t.status),
  idxRecoveryCliente: index("idx_recovery_cliente").on(t.clientePessoaId),
}));

// Credores de um processo (cada dívida individual)
export const recoveryCreditors = pgTable("recovery_creditors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  processId: varchar("process_id").references(() => recoveryProcesses.id, { onDelete: "cascade" }).notNull(),
  // Vínculo opcional com Pessoas (se o credor já estiver cadastrado)
  credorPessoaId: varchar("credor_pessoa_id").references(() => pessoas.id),
  // Identificação livre quando não há pessoa cadastrada
  credorNome: varchar("credor_nome", { length: 255 }).notNull(),
  credorDocumento: varchar("credor_documento", { length: 30 }), // CNPJ/CPF
  // 'banco' | 'fornecedor' | 'tributos' | 'trabalhista' | 'utility' | 'judicial' | 'outro'
  tipoCredor: varchar("tipo_credor", { length: 30 }).notNull().default("fornecedor"),
  // Detalhe livre: "Cartão BNDES", "ICMS-ST out/24", "Reclamatória 0001234-56", etc.
  tipoDebito: varchar("tipo_debito", { length: 100 }),
  // Documento que comprova a dívida (NF, contrato, processo trabalhista, etc.)
  numeroDocumento: varchar("numero_documento", { length: 100 }),
  valorOriginal: numeric("valor_original", { precision: 16, scale: 2 }).notNull().default("0"),
  juros: numeric("juros", { precision: 16, scale: 2 }).default("0"),
  multas: numeric("multas", { precision: 16, scale: 2 }).default("0"),
  correcaoMonetaria: numeric("correcao_monetaria", { precision: 16, scale: 2 }).default("0"),
  // Total atualizado (original + juros + multas + correção); pode ser informado pelo importador
  valorAtualizado: numeric("valor_atualizado", { precision: 16, scale: 2 }).default("0"),
  dataVencimentoOriginal: date("data_vencimento_original"),
  diasAtraso: integer("dias_atraso").default(0),
  // 'pendente' | 'em_negociacao' | 'acordo_proposto' | 'acordo_aceito' | 'acordo_homologado' | 'recusado' | 'judicializado'
  statusNegociacao: varchar("status_negociacao", { length: 30 }).notNull().default("pendente"),
  // 'critica' | 'alta' | 'media' | 'baixa'
  prioridade: varchar("prioridade", { length: 20 }).notNull().default("media"),
  garantias: text("garantias"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxCreditorProcess: index("idx_creditor_process").on(t.processId),
  idxCreditorTenant: index("idx_creditor_tenant").on(t.tenantId),
  idxCreditorTipo: index("idx_creditor_tipo").on(t.tenantId, t.tipoCredor),
  idxCreditorStatus: index("idx_creditor_status").on(t.tenantId, t.statusNegociacao),
}));

// Ações/atividades dentro de um processo (reuniões, propostas, decisões)
export const recoveryActions = pgTable("recovery_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  processId: varchar("process_id").references(() => recoveryProcesses.id, { onDelete: "cascade" }).notNull(),
  creditorId: varchar("creditor_id").references(() => recoveryCreditors.id, { onDelete: "set null" }),
  // 'reuniao' | 'proposta' | 'contraproposta' | 'documento' | 'email' | 'ligacao' | 'decisao_judicial' | 'audiencia' | 'pagamento' | 'outro'
  tipoAcao: varchar("tipo_acao", { length: 30 }).notNull(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  // 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
  status: varchar("status", { length: 20 }).notNull().default("pendente"),
  responsavelId: varchar("responsavel_id").references(() => users.id),
  dataPrevista: timestamp("data_prevista"),
  dataConcluida: timestamp("data_concluida"),
  resultado: text("resultado"),
  anexos: jsonb("anexos").$type<Array<{ nome: string; url: string; tipo?: string }>>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
}, (t) => ({
  idxActionProcess: index("idx_recovery_action_process").on(t.processId),
  idxActionTenantStatus: index("idx_recovery_action_tenant_status").on(t.tenantId, t.status),
}));

// Timeline (toneraud administrativo) — eventos automáticos + manuais
export const recoveryTimeline = pgTable("recovery_timeline", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  processId: varchar("process_id").references(() => recoveryProcesses.id, { onDelete: "cascade" }).notNull(),
  // 'process_created' | 'status_changed' | 'creditor_added' | 'creditor_imported' | 'creditor_status_changed'
  // | 'action_created' | 'action_completed' | 'note' | 'milestone' | 'agreement_homologated' | 'payment_recorded'
  eventType: varchar("event_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  payload: jsonb("payload").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
}, (t) => ({
  idxTimelineProcess: index("idx_recovery_timeline_process").on(t.processId, t.createdAt),
  idxTimelineTenant: index("idx_recovery_timeline_tenant").on(t.tenantId, t.createdAt),
}));

// ----- Insert schemas (Zod) -----
export const insertRecoveryProcessSchema = createInsertSchema(recoveryProcesses).omit({
  id: true, createdAt: true, updatedAt: true,
  valorTotalDividas: true, valorAcordosFechados: true, valorPago: true,
});
export const insertRecoveryCreditorSchema = createInsertSchema(recoveryCreditors).omit({
  id: true, createdAt: true, updatedAt: true, diasAtraso: true,
});
export const insertRecoveryActionSchema = createInsertSchema(recoveryActions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertRecoveryTimelineSchema = createInsertSchema(recoveryTimeline).omit({
  id: true, createdAt: true,
});

// ----- Types -----
export type RecoveryProcess = typeof recoveryProcesses.$inferSelect;
export type InsertRecoveryProcess = z.infer<typeof insertRecoveryProcessSchema>;
export type RecoveryCreditor = typeof recoveryCreditors.$inferSelect;
export type InsertRecoveryCreditor = z.infer<typeof insertRecoveryCreditorSchema>;
export type RecoveryAction = typeof recoveryActions.$inferSelect;
export type InsertRecoveryAction = z.infer<typeof insertRecoveryActionSchema>;
export type RecoveryTimeline = typeof recoveryTimeline.$inferSelect;
export type InsertRecoveryTimeline = z.infer<typeof insertRecoveryTimelineSchema>;

// ----- Relations -----
export const recoveryProcessesRelations = relations(recoveryProcesses, ({ one, many }) => ({
  cliente: one(pessoas, { fields: [recoveryProcesses.clientePessoaId], references: [pessoas.id] }),
  responsavel: one(users, { fields: [recoveryProcesses.responsavelId], references: [users.id] }),
  creditors: many(recoveryCreditors),
  actions: many(recoveryActions),
  events: many(recoveryTimeline),
}));

export const recoveryCreditorsRelations = relations(recoveryCreditors, ({ one, many }) => ({
  process: one(recoveryProcesses, { fields: [recoveryCreditors.processId], references: [recoveryProcesses.id] }),
  credor: one(pessoas, { fields: [recoveryCreditors.credorPessoaId], references: [pessoas.id] }),
  actions: many(recoveryActions),
}));

export const recoveryActionsRelations = relations(recoveryActions, ({ one }) => ({
  process: one(recoveryProcesses, { fields: [recoveryActions.processId], references: [recoveryProcesses.id] }),
  creditor: one(recoveryCreditors, { fields: [recoveryActions.creditorId], references: [recoveryCreditors.id] }),
  responsavel: one(users, { fields: [recoveryActions.responsavelId], references: [users.id] }),
}));

export const recoveryTimelineRelations = relations(recoveryTimeline, ({ one }) => ({
  process: one(recoveryProcesses, { fields: [recoveryTimeline.processId], references: [recoveryProcesses.id] }),
  createdBy: one(users, { fields: [recoveryTimeline.createdById], references: [users.id] }),
}));

// =============================================================================
// MÓDULO RECOVERY — Sprint 2: Negociação (Cenários + Propostas + CET/TIR)
// =============================================================================
// Cada processo tem 1..N cenários de negociação. Um cenário descreve uma
// estratégia agregada (ex: "parcelar 78x com 6 reduzidas"). As propostas são
// concretas, por credor, e referenciam um cenário. CET/TIR são calculados
// server-side (server/recovery/cetCalculator.ts) e armazenados aqui.
export const recoveryScenarios = pgTable("recovery_scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  processId: varchar("process_id").references(() => recoveryProcesses.id, { onDelete: "cascade" }).notNull(),
  // Identificação
  nome: varchar("nome", { length: 200 }).notNull(),
  descricao: text("descricao"),
  // 'parcelamento' | 'desconto_a_vista' | 'conversao_cotas' | 'cessao_ativos' | 'hibrido' | 'entrada_reduzida'
  tipoCenario: varchar("tipo_cenario", { length: 30 }).notNull().default("parcelamento"),
  // Parâmetros financeiros agregados
  valorTotalDivida: numeric("valor_total_divida", { precision: 16, scale: 2 }).notNull().default("0"),
  valorTotalProposto: numeric("valor_total_proposto", { precision: 16, scale: 2 }).notNull().default("0"),
  descontoPct: numeric("desconto_pct", { precision: 7, scale: 4 }).default("0"),
  numParcelas: integer("num_parcelas").default(1),
  intervaloDias: integer("intervalo_dias").default(30),
  carenciaMeses: integer("carencia_meses").default(0),
  // Bloco de parcelas reduzidas iniciais (caso Santander: 6 a R$800 + 72 a R$2700)
  hasReducedInitial: boolean("has_reduced_initial").default(false),
  reducedCount: integer("reduced_count").default(0),
  reducedAmount: numeric("reduced_amount", { precision: 16, scale: 2 }).default("0"),
  normalAmount: numeric("normal_amount", { precision: 16, scale: 2 }).default("0"),
  primeiraParcelaData: date("primeira_parcela_data"),
  // Taxa informada pelo credor (a.m.) e CET real calculado pelo simulador
  taxaPropostaMensal: numeric("taxa_proposta_mensal", { precision: 7, scale: 4 }),
  cetMensal: numeric("cet_mensal", { precision: 7, scale: 4 }),
  cetAnual: numeric("cet_anual", { precision: 7, scale: 4 }),
  totalPagoNominal: numeric("total_pago_nominal", { precision: 16, scale: 2 }),
  totalJurosPagos: numeric("total_juros_pagos", { precision: 16, scale: 2 }),
  // Score de viabilidade calculado (0..1) — quanto mais alto, mais viável
  viabilityScore: numeric("viability_score", { precision: 5, scale: 4 }),
  // Snapshot do impacto no fluxo de caixa (array de meses)
  cashFlowImpact: jsonb("cash_flow_impact").$type<Array<{ month: string; amount: number; cumulative: number }>>().default([]),
  // Workflow: 'rascunho' | 'em_analise' | 'aprovado_interno' | 'enviado_credores' | 'aceito_credores' | 'homologado' | 'rejeitado'
  status: varchar("status", { length: 30 }).notNull().default("rascunho"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
  updatedById: varchar("updated_by_id").references(() => users.id),
}, (t) => ({
  idxScenarioProcess: index("idx_scenario_process").on(t.processId),
  idxScenarioTenantStatus: index("idx_scenario_tenant_status").on(t.tenantId, t.status),
}));

// Proposta concreta para um credor específico, vinculada a um cenário.
// Um cenário gera N propostas (uma por credor envolvido).
export const recoveryProposals = pgTable("recovery_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  scenarioId: varchar("scenario_id").references(() => recoveryScenarios.id, { onDelete: "cascade" }).notNull(),
  creditorId: varchar("creditor_id").references(() => recoveryCreditors.id, { onDelete: "cascade" }).notNull(),
  // Desnormalizado para facilitar queries por processo
  processId: varchar("process_id").references(() => recoveryProcesses.id, { onDelete: "cascade" }).notNull(),
  // Valores da proposta
  valorOriginal: numeric("valor_original", { precision: 16, scale: 2 }).notNull(),
  valorProposto: numeric("valor_proposto", { precision: 16, scale: 2 }).notNull(),
  descontoPct: numeric("desconto_pct", { precision: 7, scale: 4 }).default("0"),
  numParcelas: integer("num_parcelas").default(1),
  intervaloDias: integer("intervalo_dias").default(30),
  carenciaMeses: integer("carencia_meses").default(0),
  primeiraParcelaData: date("primeira_parcela_data"),
  taxaPropostaMensal: numeric("taxa_proposta_mensal", { precision: 7, scale: 4 }),
  cetMensal: numeric("cet_mensal", { precision: 7, scale: 4 }),
  // Justificativa enviada ao credor
  justificativa: text("justificativa"),
  // Workflow: 'rascunho' | 'enviada' | 'aceita' | 'recusada' | 'contraproposta' | 'homologada' | 'cancelada'
  status: varchar("status", { length: 20 }).notNull().default("rascunho"),
  // Resposta do credor
  respostaCredor: text("resposta_credor"),
  contraPropostaValor: numeric("contra_proposta_valor", { precision: 16, scale: 2 }),
  contraPropostaParcelas: integer("contra_proposta_parcelas"),
  contraPropostaDetalhes: text("contra_proposta_detalhes"),
  // Histórico de negociação
  rounds: integer("rounds").default(0),
  ultimaInteracaoData: timestamp("ultima_interacao_data"),
  proximaAcaoData: date("proxima_acao_data"),
  proximaAcaoTipo: varchar("proxima_acao_tipo", { length: 50 }),
  enviadaEm: timestamp("enviada_em"),
  respondidaEm: timestamp("respondida_em"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
  updatedById: varchar("updated_by_id").references(() => users.id),
}, (t) => ({
  idxProposalScenario: index("idx_proposal_scenario").on(t.scenarioId),
  idxProposalCreditor: index("idx_proposal_creditor").on(t.creditorId),
  idxProposalProcess: index("idx_proposal_process").on(t.processId),
  idxProposalTenantStatus: index("idx_proposal_tenant_status").on(t.tenantId, t.status),
}));

export const insertRecoveryScenarioSchema = createInsertSchema(recoveryScenarios).omit({
  id: true, createdAt: true, updatedAt: true,
  cetMensal: true, cetAnual: true, totalPagoNominal: true, totalJurosPagos: true,
  viabilityScore: true, cashFlowImpact: true,
  approvedById: true, approvedAt: true,
});
export const insertRecoveryProposalSchema = createInsertSchema(recoveryProposals).omit({
  id: true, createdAt: true, updatedAt: true,
  cetMensal: true, rounds: true,
  enviadaEm: true, respondidaEm: true, ultimaInteracaoData: true,
});

export type RecoveryScenario = typeof recoveryScenarios.$inferSelect;
export type InsertRecoveryScenario = z.infer<typeof insertRecoveryScenarioSchema>;
export type RecoveryProposal = typeof recoveryProposals.$inferSelect;
export type InsertRecoveryProposal = z.infer<typeof insertRecoveryProposalSchema>;

export const recoveryScenariosRelations = relations(recoveryScenarios, ({ one, many }) => ({
  process: one(recoveryProcesses, { fields: [recoveryScenarios.processId], references: [recoveryProcesses.id] }),
  approvedBy: one(users, { fields: [recoveryScenarios.approvedById], references: [users.id] }),
  proposals: many(recoveryProposals),
}));

export const recoveryProposalsRelations = relations(recoveryProposals, ({ one }) => ({
  scenario: one(recoveryScenarios, { fields: [recoveryProposals.scenarioId], references: [recoveryScenarios.id] }),
  creditor: one(recoveryCreditors, { fields: [recoveryProposals.creditorId], references: [recoveryCreditors.id] }),
  process: one(recoveryProcesses, { fields: [recoveryProposals.processId], references: [recoveryProcesses.id] }),
}));

// =============================================================================
// Recovery Sprint 3 — Parcelas (acordos homologados)
// =============================================================================
export const recoveryInstallments = pgTable("recovery_installments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  processId: varchar("process_id").notNull().references(() => recoveryProcesses.id, { onDelete: "cascade" }),
  scenarioId: varchar("scenario_id").notNull().references(() => recoveryScenarios.id, { onDelete: "restrict" }),
  creditorId: varchar("creditor_id").notNull().references(() => recoveryCreditors.id, { onDelete: "restrict" }),
  proposalId: varchar("proposal_id").references(() => recoveryProposals.id, { onDelete: "set null" }),
  numero: integer("numero").notNull(), // 1..N dentro do conjunto da proposta
  dueDate: date("due_date").notNull(),
  valor: numeric("valor", { precision: 16, scale: 2 }).notNull(),
  // pendente | agendado | pago | atrasado | renegociado | cancelado
  status: varchar("status", { length: 20 }).notNull().default("pendente"),
  paidAmount: numeric("paid_amount", { precision: 16, scale: 2 }),
  paidDate: date("paid_date"),
  paymentMethod: varchar("payment_method", { length: 50 }),
  // Vínculo com o Control (lancamentos_financeiros)
  controlApId: varchar("control_ap_id"),
  isReleasedToControl: boolean("is_released_to_control").notNull().default(false),
  releasedAt: timestamp("released_at"),
  releasedById: varchar("released_by_id").references(() => users.id),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdById: varchar("created_by_id").references(() => users.id),
  updatedById: varchar("updated_by_id").references(() => users.id),
}, (t) => ({
  idxInstallTenantProcess: index("idx_install_tenant_process").on(t.tenantId, t.processId, t.dueDate),
  idxInstallCreditor: index("idx_install_creditor").on(t.creditorId),
  idxInstallScenario: index("idx_install_scenario").on(t.scenarioId),
  idxInstallStatus: index("idx_install_tenant_status").on(t.tenantId, t.status),
  idxInstallReleased: index("idx_install_released").on(t.tenantId, t.isReleasedToControl),
}));

export const insertRecoveryInstallmentSchema = createInsertSchema(recoveryInstallments).omit({
  id: true, createdAt: true, updatedAt: true,
  controlApId: true, isReleasedToControl: true, releasedAt: true, releasedById: true,
  paidAmount: true, paidDate: true, paymentMethod: true,
});

export type RecoveryInstallment = typeof recoveryInstallments.$inferSelect;
export type InsertRecoveryInstallment = z.infer<typeof insertRecoveryInstallmentSchema>;

export const recoveryInstallmentsRelations = relations(recoveryInstallments, ({ one }) => ({
  process: one(recoveryProcesses, { fields: [recoveryInstallments.processId], references: [recoveryProcesses.id] }),
  scenario: one(recoveryScenarios, { fields: [recoveryInstallments.scenarioId], references: [recoveryScenarios.id] }),
  creditor: one(recoveryCreditors, { fields: [recoveryInstallments.creditorId], references: [recoveryCreditors.id] }),
  proposal: one(recoveryProposals, { fields: [recoveryInstallments.proposalId], references: [recoveryProposals.id] }),
  releasedBy: one(users, { fields: [recoveryInstallments.releasedById], references: [users.id] }),
}));

// ============================================================================
// Dev Center — Fase 2: Module Planner (planejador de módulo em PT)
// ============================================================================
// O usuário descreve em PT o que quer ("controlar honorários por consultor"),
// o agente lê o código atual do Consult e devolve um plano técnico estruturado
// (tabelas, endpoints, páginas, agentes, dependências) que ele edita item a
// item. Aprovar dispara o pipeline da Fase 1 (target='consult') no Dev Center.
//
// `planJson` segue o contrato ModulePlanContract (ver server/modulePlanner/planner.ts):
// {
//   summary: string,
//   tables: [{ name, description, columns: [{ name, type, notes? }], relations? }],
//   endpoints: [{ method, path, description }],
//   pages: [{ route, name, description }],
//   agents: [{ name, role, skills: string[] }],
//   dependencies: [{ module, reason }],
//   similarModule: { name, route, reason } | null,
// }
export const modulePlans = pgTable("module_plans", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId:         varchar("tenant_id").notNull(),
  title:            varchar("title", { length: 300 }).notNull(),
  // Texto livre em PT informado pelo usuário (entrada do agente).
  descriptionInput: text("description_input").notNull(),
  // Plano estruturado retornado/editado.
  planJson:         jsonb("plan_json").notNull(),
  // draft | proposed | approved | generated
  status:           varchar("status", { length: 20 }).notNull().default("draft"),
  // Run do Dev Center criada quando o plano foi aprovado (FK SET NULL para preservar
  // o histórico do plano caso a run seja removida).
  pipelineRunId:    varchar("pipeline_run_id").references(() => idePipelineRuns.id, { onDelete: "set null" }),
  // Versão atualmente exibida (incrementa a cada save/analyze).
  currentVersion:   integer("current_version").notNull().default(1),
  createdById:      varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById:      varchar("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxModulePlanTenant: index("idx_module_plan_tenant").on(t.tenantId, t.updatedAt),
  idxModulePlanStatus: index("idx_module_plan_status").on(t.tenantId, t.status),
}));

// Versionamento: cada análise/edição/aprovação cria uma linha aqui com snapshot
// completo do planJson + autor + label de origem ('analyze' | 'edit' | 'approve').
export const modulePlanVersions = pgTable("module_plan_versions", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId:       varchar("plan_id").notNull().references(() => modulePlans.id, { onDelete: "cascade" }),
  tenantId:     varchar("tenant_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  // 'analyze' (resposta do agente) | 'edit' (salvo manual) | 'approve' (snapshot final) | 'revert'
  source:       varchar("source", { length: 20 }).notNull(),
  planJson:     jsonb("plan_json").notNull(),
  createdById:  varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow(),
}, (t) => ({
  // Unique para impedir versões duplicadas em corrida (compare-and-set no app layer
  // garante consistência; este índice é a rede de segurança do banco).
  uqModulePlanVer: uniqueIndex("uq_module_plan_ver").on(t.planId, t.versionNumber),
  idxModulePlanVerTenant: index("idx_module_plan_ver_tenant").on(t.tenantId),
}));

export const insertModulePlanSchema = createInsertSchema(modulePlans).omit({
  id: true, createdAt: true, updatedAt: true, currentVersion: true, pipelineRunId: true,
});
export const insertModulePlanVersionSchema = createInsertSchema(modulePlanVersions).omit({
  id: true, createdAt: true,
});

export type ModulePlan = typeof modulePlans.$inferSelect;
export type InsertModulePlan = z.infer<typeof insertModulePlanSchema>;
export type ModulePlanVersion = typeof modulePlanVersions.$inferSelect;
export type InsertModulePlanVersion = z.infer<typeof insertModulePlanVersionSchema>;

// ============================================================================
// Fase 4 — App Store interna (marketplace de módulos)
// ----------------------------------------------------------------------------
// Modelo Odoo + iOS: módulos base (Control/Societário/Recovery/Produção/Dev
// Center/BI/Cérebro/Intelligence) são imutáveis, da Arcádia. Tenants podem
// criar módulos via Module Planner (Fase 2) e publicar no marketplace para
// outros tenants instalarem com 1 clique.
//
// Restrições:
// - Toda tabela continua com tenant_id; pacotes não criam tabelas globais.
// - Instalador roda em transação por tenant; falha aborta a instalação.
// - Roteamento dinâmico de módulos instalados não bypassa
//   isAuthenticated + tenantContext.
// ============================================================================

// Apps publicáveis. owner_tenant_id é o tenant criador. Status segue o fluxo
// draft → in_review → published | rejected → archived. Slug é UNIQUE global
// (apps publicados são visíveis a todos os tenants).
export const marketplaceApps = pgTable("marketplace_apps", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // tenant_id satisfaz o invariante arquitetural "toda tabela de negócio tem
  // tenant_id". Para o marketplace_apps, tenant_id é semanticamente o tenant
  // dono (= owner_tenant_id) — mantemos os dois para compatibilidade com
  // queries de relatório por owner sem JOIN e para futura migração de modelo.
  tenantId:         varchar("tenant_id").notNull(),
  ownerTenantId:    varchar("owner_tenant_id").notNull(),
  // Slug único e estável para URL pública (ex: "honorarios-consultor").
  slug:             varchar("slug", { length: 80 }).notNull().unique(),
  title:            varchar("title", { length: 200 }).notNull(),
  shortDescription: varchar("short_description", { length: 280 }).notNull(),
  longDescription:  text("long_description"),
  category:         varchar("category", { length: 50 }).notNull().default("geral"),
  // draft (rascunho do owner) | in_review (aguardando superadmin) | published
  // | rejected (com reviewNotes) | archived (escondido do store)
  status:           varchar("status", { length: 20 }).notNull().default("draft"),
  // free | per_install | monthly. Pagamento real fora do MVP.
  billingModel:     varchar("billing_model", { length: 20 }).notNull().default("free"),
  priceCents:       integer("price_cents").notNull().default(0),
  // Origem do pacote: pipeline_run (Fase 1/2) ou módulo manual.
  sourceRunId:      varchar("source_run_id").references(() => idePipelineRuns.id, { onDelete: "set null" }),
  sourcePlanId:     varchar("source_plan_id").references(() => modulePlans.id, { onDelete: "set null" }),
  // URLs (object storage) de screenshots/ícone — array para a UI da App Store.
  iconUrl:          varchar("icon_url", { length: 500 }),
  screenshots:      jsonb("screenshots").default(sql`'[]'::jsonb`),
  // Versão atualmente publicada (FK para marketplace_app_versions). NULL até
  // 1ª publicação aprovada.
  currentVersionId: varchar("current_version_id"),
  installCount:     integer("install_count").notNull().default(0),
  ratingAvg:        numeric("rating_avg", { precision: 3, scale: 2 }),
  ratingCount:      integer("rating_count").notNull().default(0),
  // Notas do superadmin (rejeição ou observações).
  reviewNotes:      text("review_notes"),
  reviewedById:     varchar("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:       timestamp("reviewed_at"),
  submittedAt:      timestamp("submitted_at"),
  publishedAt:      timestamp("published_at"),
  createdById:      varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxMktAppOwner:    index("idx_mkt_app_owner").on(t.ownerTenantId),
  idxMktAppStatus:   index("idx_mkt_app_status").on(t.status),
  idxMktAppCategory: index("idx_mkt_app_category").on(t.category),
  idxMktAppTenant:   index("idx_mkt_app_tenant").on(t.tenantId),
}));

// Versões de cada app (semver). manifest_json descreve o pacote: rotas,
// tabelas (tenant-scoped), dependências, permissões. files_ref é o caminho
// no Git interno do owner (project-<runId> ou snapshot manual).
export const marketplaceAppVersions = pgTable("marketplace_app_versions", {
  id:            varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appId:         varchar("app_id").notNull().references(() => marketplaceApps.id, { onDelete: "cascade" }),
  // tenant_id (= owner_tenant_id) — invariante arquitetural de tenant em
  // toda tabela de negócio. Versão pertence ao tenant que criou o app.
  tenantId:      varchar("tenant_id").notNull(),
  // owner_tenant_id duplicado para queries de relatório por owner sem JOIN.
  ownerTenantId: varchar("owner_tenant_id").notNull(),
  // Semver: "1.0.0", "1.2.3-beta.1".
  version:       varchar("version", { length: 30 }).notNull(),
  // Manifest declarativo:
  // {
  //   tables: [{ name, columns:[...], tenantScoped: true, ddl: 'CREATE TABLE...' }],
  //   routes: [{ method, path, page? }],
  //   menu:   [{ title, url, icon? }],
  //   permissions: ['marketplace.module.<slug>.view', ...],
  //   dependencies: [{ module: 'control'|'societario'|..., minVersion? }],
  // }
  manifestJson:  jsonb("manifest_json").notNull(),
  // Caminho no Git interno do owner (ex: "project-<runId>") — usado para
  // copiar arquivos durante a instalação.
  filesRef:      varchar("files_ref", { length: 200 }),
  // Snapshot dos arquivos (para apps sem run vinculada ou para imutabilidade
  // pós-publicação). Map fileName → content.
  filesSnapshot: jsonb("files_snapshot"),
  // Diff de schema vs versão anterior (DDL para upgrade).
  schemaDiff:    jsonb("schema_diff"),
  changelog:     text("changelog"),
  // Revisão por versão (não no app): permite rejeitar updates sem derrubar
  // a versão atualmente publicada. Quando rejectedAt é set, a versão sai
  // da fila de revisão e fica arquivada com a justificativa.
  rejectedAt:    timestamp("rejected_at"),
  reviewNotes:   text("review_notes"),
  // submittedAt por VERSÃO: marca a intenção explícita do owner de submeter
  // esta versão à revisão. Versões criadas via POST /apps/:id/versions ficam
  // como rascunho (submittedAt IS NULL) e só entram na fila do superadmin
  // depois que o owner clica em "Enviar versão p/ revisão" (POST /submit).
  submittedAt:   timestamp("submitted_at"),
  publishedAt:   timestamp("published_at"),
  createdAt:     timestamp("created_at").defaultNow(),
}, (t) => ({
  uqMktVerAppVersion: uniqueIndex("uq_mkt_ver_app_version").on(t.appId, t.version),
  idxMktVerApp:       index("idx_mkt_ver_app").on(t.appId),
  idxMktVerOwner:     index("idx_mkt_ver_owner").on(t.ownerTenantId),
  idxMktVerTenant:    index("idx_mkt_ver_tenant").on(t.tenantId),
}));

// Instalações por tenant. UNIQUE (app_id, tenant_id) — 1 instalação por
// tenant por app. installed_version_id rastreia o que está rodando.
export const marketplaceInstallations = pgTable("marketplace_installations", {
  id:                 varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appId:              varchar("app_id").notNull().references(() => marketplaceApps.id, { onDelete: "cascade" }),
  tenantId:           varchar("tenant_id").notNull(),
  installedVersionId: varchar("installed_version_id").notNull().references(() => marketplaceAppVersions.id, { onDelete: "restrict" }),
  // installing | installed | failed | uninstalled. uninstalled mantém o
  // registro para histórico de cobrança.
  status:             varchar("status", { length: 20 }).notNull().default("installing"),
  errorMessage:       text("error_message"),
  installedById:      varchar("installed_by_id").references(() => users.id, { onDelete: "set null" }),
  installedAt:        timestamp("installed_at").defaultNow(),
  updatedAt:          timestamp("updated_at").defaultNow(),
  uninstalledAt:      timestamp("uninstalled_at"),
}, (t) => ({
  uqMktInstallAppTenant: uniqueIndex("uq_mkt_install_app_tenant").on(t.appId, t.tenantId),
  idxMktInstallTenant:   index("idx_mkt_install_tenant").on(t.tenantId),
  idxMktInstallApp:      index("idx_mkt_install_app").on(t.appId),
}));

// Reviews dos tenants instaladores (rating 1-5 + comentário opcional).
export const marketplaceReviews = pgTable("marketplace_reviews", {
  id:        varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appId:     varchar("app_id").notNull().references(() => marketplaceApps.id, { onDelete: "cascade" }),
  tenantId:  varchar("tenant_id").notNull(),
  userId:    varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  rating:    integer("rating").notNull(),
  comment:   text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uqMktReviewAppTenant: uniqueIndex("uq_mkt_review_app_tenant").on(t.appId, t.tenantId),
  idxMktReviewApp:      index("idx_mkt_review_app").on(t.appId),
}));

// Cobranças geradas por instalação (per_install) ou cron mensal (monthly).
// Placeholder de Stripe: status fica em pending até integração real.
export const marketplaceCharges = pgTable("marketplace_charges", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appId:          varchar("app_id").notNull().references(() => marketplaceApps.id, { onDelete: "cascade" }),
  installationId: varchar("installation_id").notNull().references(() => marketplaceInstallations.id, { onDelete: "cascade" }),
  // Tenant que paga (= installations.tenantId duplicado para relatórios).
  tenantId:       varchar("tenant_id").notNull(),
  // Tenant que recebe (= apps.ownerTenantId — para relatório do owner).
  ownerTenantId:  varchar("owner_tenant_id").notNull(),
  amountCents:    integer("amount_cents").notNull(),
  // install | monthly
  kind:           varchar("kind", { length: 20 }).notNull(),
  // pending | paid | failed | refunded
  status:         varchar("status", { length: 20 }).notNull().default("pending"),
  // YYYY-MM para cobrança mensal (idempotência).
  periodMonth:    varchar("period_month", { length: 7 }),
  createdAt:      timestamp("created_at").defaultNow(),
}, (t) => ({
  idxMktChargeOwner:     index("idx_mkt_charge_owner").on(t.ownerTenantId),
  idxMktChargeTenant:    index("idx_mkt_charge_tenant").on(t.tenantId),
  uqMktChargeMonthly:    uniqueIndex("uq_mkt_charge_monthly").on(t.installationId, t.periodMonth),
}));

export const insertMarketplaceAppSchema = createInsertSchema(marketplaceApps).omit({
  id: true, createdAt: true, updatedAt: true, currentVersionId: true,
  installCount: true, ratingAvg: true, ratingCount: true, reviewedAt: true,
  reviewedById: true, submittedAt: true, publishedAt: true,
});
export const insertMarketplaceAppVersionSchema = createInsertSchema(marketplaceAppVersions).omit({
  id: true, createdAt: true, publishedAt: true,
});
export const insertMarketplaceInstallationSchema = createInsertSchema(marketplaceInstallations).omit({
  id: true, installedAt: true, updatedAt: true, uninstalledAt: true,
});
export const insertMarketplaceReviewSchema = createInsertSchema(marketplaceReviews).omit({
  id: true, createdAt: true,
});
export const insertMarketplaceChargeSchema = createInsertSchema(marketplaceCharges).omit({
  id: true, createdAt: true,
});

export type MarketplaceApp = typeof marketplaceApps.$inferSelect;
export type InsertMarketplaceApp = z.infer<typeof insertMarketplaceAppSchema>;
export type MarketplaceAppVersion = typeof marketplaceAppVersions.$inferSelect;
export type InsertMarketplaceAppVersion = z.infer<typeof insertMarketplaceAppVersionSchema>;
export type MarketplaceInstallation = typeof marketplaceInstallations.$inferSelect;
export type InsertMarketplaceInstallation = z.infer<typeof insertMarketplaceInstallationSchema>;
export type MarketplaceReview = typeof marketplaceReviews.$inferSelect;
export type InsertMarketplaceReview = z.infer<typeof insertMarketplaceReviewSchema>;
export type MarketplaceCharge = typeof marketplaceCharges.$inferSelect;
export type InsertMarketplaceCharge = z.infer<typeof insertMarketplaceChargeSchema>;

// ─── PROD-4 — Central de Produção (PCP / Demandas) ─────────────────────────
export const demandasCentral = pgTable("demandas_central", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  projetoId: varchar("projeto_id"), // nullable — demanda pode não ter projeto
  titulo: varchar("titulo", { length: 300 }).notNull(),
  descricao: text("descricao"),
  tipo: varchar("tipo", { length: 30 }).notNull(), // 'projeto'|'modulo'|'documento'|'analise'|'bug'
  prioridade: varchar("prioridade", { length: 15 }).notNull().default('medio'), // critico|alto|medio|baixo
  assigneeType: varchar("assignee_type", { length: 10 }).notNull().default('human'), // 'human'|'agent'
  assigneeId: varchar("assignee_id"),
  agenteTask: varchar("agente_task", { length: 80 }),
  status: varchar("status", { length: 20 }).notNull().default('fila'), // fila|em_analise|em_execucao|revisao|concluido|cancelado
  resultadoJson: jsonb("resultado_json"),
  resolvidoAt: timestamp("resolvido_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxStatus: index("idx_demandas_central_tenant_status").on(t.tenantId, t.status),
  idxProjeto: index("idx_demandas_central_tenant_projeto").on(t.tenantId, t.projetoId),
}));

export const insertDemandaCentralSchema = createInsertSchema(demandasCentral).omit({
  id: true, createdAt: true, resolvidoAt: true, resultadoJson: true,
});
export type DemandaCentral = typeof demandasCentral.$inferSelect;
export type InsertDemandaCentral = z.infer<typeof insertDemandaCentralSchema>;

// ─── RH-1 — Módulo RH/DP (Recursos Humanos / Departamento Pessoal) ────────
// Multi-tenant. clienteId aponta para `clients` (a empresa cliente da
// consultoria que tem colaboradores em CLT/PJ). NÃO confundir com
// project_members (alocação em projetos pontuais).

export const hrDepartments = pgTable("hr_departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 100 }).notNull(),
  centroCustoId: varchar("centro_custo_id").references(() => centrosCusto.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_departments_tenant_cliente").on(t.tenantId, t.clienteId),
}));

export const hrPositions = pgTable("hr_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 100 }).notNull(),
  cboCode: varchar("cbo_code", { length: 10 }),
  // junior | pleno | senior | specialist
  level: varchar("level", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_positions_tenant_cliente").on(t.tenantId, t.clienteId),
}));

export const hrEmployees = pgTable("hr_employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  employeeCode: varchar("employee_code", { length: 20 }).notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  cpf: varchar("cpf", { length: 14 }).notNull(),
  rg: varchar("rg", { length: 20 }),
  ctpsNumber: varchar("ctps_number", { length: 20 }),
  ctpsSeries: varchar("ctps_series", { length: 10 }),
  admissionDate: date("admission_date").notNull(),
  terminationDate: date("termination_date"),
  // active | vacation | leave | terminated
  status: varchar("status", { length: 20 }).notNull().default("active"),
  positionId: varchar("position_id").notNull().references(() => hrPositions.id),
  departmentId: varchar("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
  workLocation: varchar("work_location", { length: 100 }),
  // clt | pj | apprentice | intern
  employmentType: varchar("employment_type", { length: 20 }).notNull().default("clt"),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  monthlyHours: integer("monthly_hours").notNull().default(220),
  workSchedule: jsonb("work_schedule"),
  cboCode: varchar("cbo_code", { length: 10 }),
  pisPasep: varchar("pis_pasep", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_employees_tenant_cliente").on(t.tenantId, t.clienteId),
  idxStatus: index("idx_hr_employees_tenant_status").on(t.tenantId, t.status),
  uqEmpCodigo: uniqueIndex("uq_hr_employees_cliente_codigo").on(t.clienteId, t.employeeCode),
  uqCpfCliente: uniqueIndex("uq_hr_employees_cliente_cpf").on(t.clienteId, t.cpf),
}));

export const hrSalaryHistory = pgTable("hr_salary_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  employeeId: varchar("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  effectiveDate: date("effective_date").notNull(),
  salary: numeric("salary", { precision: 12, scale: 2 }).notNull(),
  // admissao | reajuste | promocao | acordo | outro
  reason: varchar("reason", { length: 50 }).notNull().default("admissao"),
  notes: varchar("notes", { length: 300 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxEmployee: index("idx_hr_salary_employee").on(t.employeeId, t.effectiveDate),
}));

export const insertHrDepartmentSchema = createInsertSchema(hrDepartments).omit({ id: true, createdAt: true });
export const insertHrPositionSchema = createInsertSchema(hrPositions).omit({ id: true, createdAt: true });
export const insertHrEmployeeSchema = createInsertSchema(hrEmployees).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHrSalaryHistorySchema = createInsertSchema(hrSalaryHistory).omit({ id: true, createdAt: true });

export type HrDepartment = typeof hrDepartments.$inferSelect;
export type InsertHrDepartment = z.infer<typeof insertHrDepartmentSchema>;
export type HrPosition = typeof hrPositions.$inferSelect;
export type InsertHrPosition = z.infer<typeof insertHrPositionSchema>;
export type HrEmployee = typeof hrEmployees.$inferSelect;
export type InsertHrEmployee = z.infer<typeof insertHrEmployeeSchema>;
export type HrSalaryHistory = typeof hrSalaryHistory.$inferSelect;
export type InsertHrSalaryHistory = z.infer<typeof insertHrSalaryHistorySchema>;

// ─── Conta Corrente do Colaborador ──────────────────────────────────────────
// Lançamentos individuais de vales, salários, adiantamentos, repasses, bônus
// e ajustes. Saldo é calculado: SUM(credit) - SUM(debit).
//   credit = a pagar ao colaborador (salário, bônus, férias, 13º, repasse a fazer)
//   debit  = já pago / abate (vale, adiantamento, desconto, repasse efetuado)
export const hrEmployeeAccountEntries = pgTable("hr_employee_account_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  employeeId: varchar("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  // credit | debit
  direction: varchar("direction", { length: 10 }).notNull(),
  // salario | vale | adiantamento | repasse | bonus | comissao | ferias | decimo_terceiro | desconto | ajuste | outro
  category: varchar("category", { length: 30 }).notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // pendente | pago | conciliado
  status: varchar("status", { length: 20 }).notNull().default("pendente"),
  paymentMethod: varchar("payment_method", { length: 30 }),
  referenceMonth: varchar("reference_month", { length: 7 }), // YYYY-MM
  payrollEntryId: varchar("payroll_entry_id").references(() => hrPayrollEntries.id, { onDelete: "set null" }),
  controlTxId: varchar("control_tx_id"),
  notes: varchar("notes", { length: 500 }),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxEmployee: index("idx_hr_emp_account_employee").on(t.employeeId, t.date),
  idxTenant: index("idx_hr_emp_account_tenant").on(t.tenantId),
}));

export const insertHrEmployeeAccountEntrySchema = createInsertSchema(hrEmployeeAccountEntries).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type HrEmployeeAccountEntry = typeof hrEmployeeAccountEntries.$inferSelect;
export type InsertHrEmployeeAccountEntry = z.infer<typeof insertHrEmployeeAccountEntrySchema>;

// ─── Sprint RH-2 ────────────────────────────────────────────────────────────
// Folha de pagamento + integração Control. clienteId = empresa cliente do BPO.
// Status: draft → reviewed → approved (gera lancamentos_financeiros) → exported.

export const hrPayrollPeriods = pgTable("hr_payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  competence: varchar("competence", { length: 7 }).notNull(), // YYYY-MM
  // draft | reviewed | approved | exported
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // manual | dominio_import
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  totalGross: numeric("total_gross", { precision: 14, scale: 2 }).notNull().default("0"),
  totalDiscounts: numeric("total_discounts", { precision: 14, scale: 2 }).notNull().default("0"),
  totalNet: numeric("total_net", { precision: 14, scale: 2 }).notNull().default("0"),
  totalInssEmployee: numeric("total_inss_employee", { precision: 14, scale: 2 }).notNull().default("0"),
  totalFgts: numeric("total_fgts", { precision: 14, scale: 2 }).notNull().default("0"),
  totalIrrf: numeric("total_irrf", { precision: 14, scale: 2 }).notNull().default("0"),
  // Lista de IDs de lancamentos_financeiros gerados no approve (JSONB array de strings,
  // múltiplos quando há rateio por CC). Limpada no revert.
  controlTxIds: jsonb("control_tx_ids"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  // Sprint RH-4 — auditoria de exportações Domínio.
  exportedAt: timestamp("exported_at"),
  exportCount: integer("export_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_payroll_periods_tenant_cliente").on(t.tenantId, t.clienteId),
  uqClienteCompet: uniqueIndex("uq_hr_payroll_periods_cliente_compet").on(t.clienteId, t.competence),
}));

export const hrPayrollEntries = pgTable("hr_payroll_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  periodId: varchar("period_id").notNull().references(() => hrPayrollPeriods.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => hrEmployees.id),
  // Snapshots resolvidos no momento do lançamento (não seguem mudanças futuras).
  departmentId: varchar("department_id"),
  costCenterId: varchar("cost_center_id"),
  salaryBase: numeric("salary_base", { precision: 12, scale: 2 }).notNull(),
  totalGross: numeric("total_gross", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDiscounts: numeric("total_discounts", { precision: 12, scale: 2 }).notNull().default("0"),
  netSalary: numeric("net_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  inssBase: numeric("inss_base", { precision: 12, scale: 2 }).default("0"),
  inssValue: numeric("inss_value", { precision: 12, scale: 2 }).default("0"),
  fgtsBase: numeric("fgts_base", { precision: 12, scale: 2 }).default("0"),
  fgtsValue: numeric("fgts_value", { precision: 12, scale: 2 }).default("0"),
  irrfBase: numeric("irrf_base", { precision: 12, scale: 2 }).default("0"),
  irrfValue: numeric("irrf_value", { precision: 12, scale: 2 }).default("0"),
  // Trabalhando | Férias | Atestado | Afastamento | Outros
  situation: varchar("situation", { length: 50 }).default("Trabalhando"),
  // Array de rubricas: [{ code, description, type: 'provento'|'desconto', reference, value }]
  rubrics: jsonb("rubrics"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxPeriod: index("idx_hr_payroll_entries_period").on(t.periodId),
  idxEmployee: index("idx_hr_payroll_entries_employee").on(t.employeeId),
  uqPeriodEmployee: uniqueIndex("uq_hr_payroll_entries_period_employee").on(t.periodId, t.employeeId),
}));

export const hrTimesheetPeriods = pgTable("hr_timesheet_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  // manual | dominio_import
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  scheduledHours: numeric("scheduled_hours", { precision: 7, scale: 2 }).default("0"),
  workedHours: numeric("worked_hours", { precision: 7, scale: 2 }).default("0"),
  absenceHours: numeric("absence_hours", { precision: 7, scale: 2 }).default("0"),
  overtimeHours: numeric("overtime_hours", { precision: 7, scale: 2 }).default("0"),
  bankBalance: numeric("bank_balance", { precision: 7, scale: 2 }).default("0"),
  absentDays: integer("absent_days").default(0),
  // Array de registros diários:
  // { date, dayOfWeek, type: 'normal'|'holiday'|'absence'|'medical'|'vacation',
  //   in1, out1, in2, out2, worked, scheduled, balance, note }
  entries: jsonb("entries"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_timesheet_tenant_cliente").on(t.tenantId, t.clienteId),
  idxEmployee: index("idx_hr_timesheet_employee").on(t.employeeId, t.periodStart),
}));

export const insertHrPayrollPeriodSchema = createInsertSchema(hrPayrollPeriods).omit({
  id: true, createdAt: true, updatedAt: true, approvedAt: true, approvedBy: true,
  controlTxIds: true, exportedAt: true, exportCount: true,
});
export const insertHrPayrollEntrySchema = createInsertSchema(hrPayrollEntries).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertHrTimesheetPeriodSchema = createInsertSchema(hrTimesheetPeriods).omit({
  id: true, createdAt: true,
});

export type HrPayrollPeriod = typeof hrPayrollPeriods.$inferSelect;
export type InsertHrPayrollPeriod = z.infer<typeof insertHrPayrollPeriodSchema>;
export type HrPayrollEntry = typeof hrPayrollEntries.$inferSelect;
export type InsertHrPayrollEntry = z.infer<typeof insertHrPayrollEntrySchema>;
export type HrTimesheetPeriod = typeof hrTimesheetPeriods.$inferSelect;
export type InsertHrTimesheetPeriod = z.infer<typeof insertHrTimesheetPeriodSchema>;

// ─── Sprint RH-3 ────────────────────────────────────────────────────────────
// Parser IA — importação automática do Extrato Mensal Domínio.
// hr_import_previews: cache temporário do preview (TTL 2h) entre o parse e
// a confirmação. hr_rubric_mappings: de-para de códigos do Domínio para
// categorias internas (salary, inss, fgts, irrf, vacation, leave, etc.).

export const hrImportPreviews = pgTable("hr_import_previews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  clienteId: varchar("cliente_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  competence: varchar("competence", { length: 7 }).notNull(), // YYYY-MM
  sourceFile: varchar("source_file", { length: 500 }),
  // Tipo do documento detectado pelo classificador heurístico.
  // extrato_mensal | recibo | ponto | unknown
  docType: varchar("doc_type", { length: 30 }).default("unknown"),
  rawText: text("raw_text"),
  extractedData: jsonb("extracted_data"), // ExtratoData completo
  matchResults: jsonb("match_results"),   // MatchResult[] com edições do usuário
  // pending | reviewed | confirmed | expired
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  validationErrors: jsonb("validation_errors"), // erros e alertas
  expiresAt: timestamp("expires_at").notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxTenantCliente: index("idx_hr_import_previews_tenant_cliente").on(t.tenantId, t.clienteId),
  idxExpires: index("idx_hr_import_previews_expires").on(t.expiresAt),
}));

export const hrRubricMappings = pgTable("hr_rubric_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  dominioCode: varchar("dominio_code", { length: 10 }).notNull(),
  dominioDescription: varchar("dominio_description", { length: 200 }),
  // earning | discount | informative
  type: varchar("type", { length: 20 }).notNull(),
  // salary | vacation | leave | inss | fgts | irrf | alimony | advance | loan | other
  category: varchar("category", { length: 50 }).notNull(),
  affectsControl: boolean("affects_control").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uqTenantCode: uniqueIndex("uq_hr_rubric_mappings_tenant_code").on(t.tenantId, t.dominioCode),
  idxTenant: index("idx_hr_rubric_mappings_tenant").on(t.tenantId),
}));

export const insertHrImportPreviewSchema = createInsertSchema(hrImportPreviews).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertHrRubricMappingSchema = createInsertSchema(hrRubricMappings).omit({
  id: true, createdAt: true,
});

export type HrImportPreview = typeof hrImportPreviews.$inferSelect;
export type InsertHrImportPreview = z.infer<typeof insertHrImportPreviewSchema>;
export type HrRubricMapping = typeof hrRubricMappings.$inferSelect;
export type InsertHrRubricMapping = z.infer<typeof insertHrRubricMappingSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Escritório Agente (Browser Automation) — Hermes-style poderes em TS/Playwright
// ─────────────────────────────────────────────────────────────────────────

// Cofre de credenciais web por tenant (login em ERPs, portais gov, bancos...).
// A senha/segredos ficam em `encryptedSecret` (AES-256-GCM via cryptoService).
export const webCredentials = pgTable("web_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  // Identificador estável do sistema-alvo (ex.: 'erp_totvs_cortiart', 'sefaz_pr').
  system: varchar("system", { length: 120 }).notNull(),
  url: text("url"),
  username: varchar("username", { length: 200 }),
  // Payload criptografado: { password?, token?, extra? } — nunca em texto puro.
  encryptedSecret: text("encrypted_secret"),
  status: varchar("status", { length: 20 }).notNull().default("ok"),
  // 'ok' | 'exhausted' | 'dead'
  lastLoginAt: timestamp("last_login_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_web_credentials_tenant").on(t.tenantId),
  uniqueIndex("uq_web_credentials_tenant_system").on(t.tenantId, t.system),
]);

// Sessões de browser persistidas (cookies/state) para reuso de login.
export const browserSessions = pgTable("browser_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  agentSessionId: varchar("agent_session_id"),
  systemName: varchar("system_name", { length: 120 }),
  // storageState do Playwright (cookies + origins), criptografado.
  encryptedState: text("encrypted_state"),
  isActive: integer("is_active").default(1),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_browser_sessions_tenant").on(t.tenantId),
  index("idx_browser_sessions_system").on(t.tenantId, t.systemName),
]);

// Fila de aprovações humanas (HITL) — agente pausa antes de ações irreversíveis.
export const agentTaskApprovals = pgTable("agent_task_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  taskId: varchar("task_id"),
  agentSessionId: varchar("agent_session_id"),
  actionDescription: text("action_description").notNull(),
  actionPayload: jsonb("action_payload").$type<Record<string, any>>().default({}),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // 'pending' | 'approved' | 'rejected'
  requestedBy: varchar("requested_by"),
  resolvedBy: varchar("resolved_by"),
  requestedAt: timestamp("requested_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  index("idx_agent_approvals_tenant").on(t.tenantId),
  index("idx_agent_approvals_status").on(t.tenantId, t.status),
]);

// Biblioteca de skills/playbooks reutilizáveis (sequências de ações gravadas).
export const agentSkills = pgTable("agent_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  // Alvo reutilizável entre tenants com o mesmo sistema (ex.: 'totvs_protheus_v12').
  systemTarget: varchar("system_target", { length: 160 }),
  playbookSteps: jsonb("playbook_steps").$type<Array<Record<string, any>>>().default([]),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_agent_skills_tenant").on(t.tenantId),
  index("idx_agent_skills_target").on(t.systemTarget),
]);

export const browserSkills = pgTable("browser_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  scope: varchar("scope", { length: 32 }).default("tenant"),
  name: varchar("name", { length: 160 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  systemSlug: varchar("system_slug", { length: 160 }),
  steps: jsonb("steps").$type<Array<Record<string, any>>>().notNull().default([]),
  successRate: numeric("success_rate").default("0"),
  useCount: integer("use_count").default(0),
  status: varchar("status", { length: 32 }).default("active"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  source: varchar("source", { length: 32 }).default("agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_browser_skills_tenant").on(t.tenantId),
  index("idx_browser_skills_name").on(t.name),
]);

export const insertBrowserSkillSchema = createInsertSchema(browserSkills).omit({
  id: true, successRate: true, useCount: true, status: true, lastUsedAt: true,
  createdAt: true, updatedAt: true,
});

export type BrowserSkill = typeof browserSkills.$inferSelect;
export type InsertBrowserSkill = z.infer<typeof insertBrowserSkillSchema>;

export const insertWebCredentialSchema = createInsertSchema(webCredentials).omit({
  id: true, encryptedSecret: true, status: true, lastLoginAt: true,
  createdAt: true, updatedAt: true,
});
export const insertBrowserSessionSchema = createInsertSchema(browserSessions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertAgentTaskApprovalSchema = createInsertSchema(agentTaskApprovals).omit({
  id: true, status: true, resolvedBy: true, requestedAt: true, resolvedAt: true,
});
export const insertAgentSkillSchema = createInsertSchema(agentSkills).omit({
  id: true, successCount: true, failureCount: true, lastUsedAt: true,
  createdAt: true, updatedAt: true,
});

export type WebCredential = typeof webCredentials.$inferSelect;
export type InsertWebCredential = z.infer<typeof insertWebCredentialSchema>;
export type BrowserSession = typeof browserSessions.$inferSelect;
export type InsertBrowserSession = z.infer<typeof insertBrowserSessionSchema>;
export type AgentTaskApproval = typeof agentTaskApprovals.$inferSelect;
export type InsertAgentTaskApproval = z.infer<typeof insertAgentTaskApprovalSchema>;
export type AgentSkill = typeof agentSkills.$inferSelect;
export type InsertAgentSkill = z.infer<typeof insertAgentSkillSchema>;

// =====================================================================
//  EMPRESA-SETUP — Empresas do grupo (Matriz + Filiais)
// =====================================================================

export const tenantEmpresas = pgTable('tenant_empresas', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  razaoSocial: text('razao_social').notNull(),
  nomeFantasia: text('nome_fantasia'),
  cnpj: text('cnpj').notNull(),
  ie: text('ie'),
  im: text('im'),
  email: text('email'),
  phone: text('phone'),
  tipo: text('tipo').default('filial'),
  status: text('status').default('active'),
  cep: text('cep'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  complemento: text('complemento'),
  bairro: text('bairro'),
  cidade: text('cidade'),
  uf: text('uf').notNull().default('PR'),
  codigoIbge: text('codigo_ibge'),
  regimeTributario: text('regime_tributario'),
  ambienteFiscal: text('ambiente_fiscal').default('homologacao'),
  serieNfe: integer('serie_nfe').default(1),
  plusEmpresaId: integer('plus_empresa_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const insertTenantEmpresaSchema = createInsertSchema(tenantEmpresas).omit({ id: true, createdAt: true, updatedAt: true });
export type TenantEmpresa = typeof tenantEmpresas.$inferSelect;
export type InsertTenantEmpresa = z.infer<typeof insertTenantEmpresaSchema>;

// ========== CONTROL-MERGE: AP/AR + Contas Bancárias ==========

export const finBankAccounts = pgTable('fin_bank_accounts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  bankCode: varchar('bank_code', { length: 10 }),
  bankName: varchar('bank_name', { length: 100 }),
  agency: varchar('agency', { length: 20 }),
  accountNumber: varchar('account_number', { length: 30 }),
  accountDigit: varchar('account_digit', { length: 5 }),
  accountType: varchar('account_type', { length: 50 }).default('checking'),
  initialBalance: numeric('initial_balance', { precision: 15, scale: 2 }).default('0'),
  currentBalance: numeric('current_balance', { precision: 15, scale: 2 }).default('0'),
  isActive: boolean('is_active').default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const finPaymentMethods = pgTable('fin_payment_methods', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  defaultBankAccountId: integer('default_bank_account_id').references(() => finBankAccounts.id),
  fee: numeric('fee', { precision: 5, scale: 2 }).default('0'),
  daysToReceive: integer('days_to_receive').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const finPaymentPlans = pgTable('fin_payment_plans', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  installments: integer('installments').default(1),
  intervalDays: integer('interval_days').default(30),
  firstDueDays: integer('first_due_days').default(30),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).default('0'),
  interestPercent: numeric('interest_percent', { precision: 5, scale: 2 }).default('0'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const finCashFlowCategories = pgTable('fin_cash_flow_categories', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  parentId: integer('parent_id'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const finAccountsPayable = pgTable('fin_accounts_payable', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  empresaId: integer('empresa_id').references(() => tenantEmpresas.id, { onDelete: 'set null' }),
  documentNumber: varchar('document_number', { length: 100 }),
  pessoaId: varchar('pessoa_id').references(() => pessoas.id, { onDelete: 'set null' }),
  supplierName: varchar('supplier_name', { length: 256 }),
  categoryId: integer('category_id').references(() => finCashFlowCategories.id),
  description: text('description'),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  originalAmount: numeric('original_amount', { precision: 15, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0'),
  interestAmount: numeric('interest_amount', { precision: 15, scale: 2 }).default('0'),
  fineAmount: numeric('fine_amount', { precision: 15, scale: 2 }).default('0'),
  paidAmount: numeric('paid_amount', { precision: 15, scale: 2 }).default('0'),
  remainingAmount: numeric('remaining_amount', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending'),
  paymentMethodId: integer('payment_method_id').references(() => finPaymentMethods.id),
  bankAccountId: integer('bank_account_id').references(() => finBankAccounts.id),
  paidAt: timestamp('paid_at'),
  origemRefTipo: varchar('origem_ref_tipo', { length: 30 }),
  origemRefId: varchar('origem_ref_id', { length: 100 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const finAccountsReceivable = pgTable('fin_accounts_receivable', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  empresaId: integer('empresa_id').references(() => tenantEmpresas.id, { onDelete: 'set null' }),
  documentNumber: varchar('document_number', { length: 100 }),
  pessoaId: varchar('pessoa_id').references(() => pessoas.id, { onDelete: 'set null' }),
  customerName: varchar('customer_name', { length: 256 }),
  categoryId: integer('category_id').references(() => finCashFlowCategories.id),
  description: text('description'),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),
  originalAmount: numeric('original_amount', { precision: 15, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0'),
  interestAmount: numeric('interest_amount', { precision: 15, scale: 2 }).default('0'),
  fineAmount: numeric('fine_amount', { precision: 15, scale: 2 }).default('0'),
  receivedAmount: numeric('received_amount', { precision: 15, scale: 2 }).default('0'),
  remainingAmount: numeric('remaining_amount', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending'),
  paymentMethodId: integer('payment_method_id').references(() => finPaymentMethods.id),
  bankAccountId: integer('bank_account_id').references(() => finBankAccounts.id),
  receivedAt: timestamp('received_at'),
  origemRefTipo: varchar('origem_ref_tipo', { length: 30 }),
  origemRefId: varchar('origem_ref_id', { length: 100 }),
  projetoId: varchar('projeto_id', { length: 100 }),
  projetoCodigo: varchar('projeto_codigo', { length: 50 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const finTransactions = pgTable('fin_transactions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tenantId: varchar('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bankAccountId: integer('bank_account_id').references(() => finBankAccounts.id).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  categoryId: integer('category_id').references(() => finCashFlowCategories.id),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  balanceAfter: numeric('balance_after', { precision: 15, scale: 2 }),
  transactionDate: date('transaction_date').notNull(),
  description: text('description'),
  documentNumber: varchar('document_number', { length: 100 }),
  payableId: integer('payable_id').references(() => finAccountsPayable.id),
  receivableId: integer('receivable_id').references(() => finAccountsReceivable.id),
  reconciled: boolean('reconciled').default(false),
  reconciledAt: timestamp('reconciled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const insertFinBankAccountSchema = createInsertSchema(finBankAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFinPaymentMethodSchema = createInsertSchema(finPaymentMethods).omit({ id: true, createdAt: true });
export const insertFinPaymentPlanSchema = createInsertSchema(finPaymentPlans).omit({ id: true, createdAt: true });
export const insertFinCashFlowCategorySchema = createInsertSchema(finCashFlowCategories).omit({ id: true, createdAt: true });
export const insertFinAccountsPayableSchema = createInsertSchema(finAccountsPayable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFinAccountsReceivableSchema = createInsertSchema(finAccountsReceivable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFinTransactionSchema = createInsertSchema(finTransactions).omit({ id: true, createdAt: true });

export type FinBankAccount = typeof finBankAccounts.$inferSelect;
export type InsertFinBankAccount = z.infer<typeof insertFinBankAccountSchema>;
export type FinPaymentMethod = typeof finPaymentMethods.$inferSelect;
export type InsertFinPaymentMethod = z.infer<typeof insertFinPaymentMethodSchema>;
export type FinPaymentPlan = typeof finPaymentPlans.$inferSelect;
export type InsertFinPaymentPlan = z.infer<typeof insertFinPaymentPlanSchema>;
export type FinCashFlowCategory = typeof finCashFlowCategories.$inferSelect;
export type InsertFinCashFlowCategory = z.infer<typeof insertFinCashFlowCategorySchema>;
export type FinAccountsPayable = typeof finAccountsPayable.$inferSelect;
export type InsertFinAccountsPayable = z.infer<typeof insertFinAccountsPayableSchema>;
export type FinAccountsReceivable = typeof finAccountsReceivable.$inferSelect;
export type InsertFinAccountsReceivable = z.infer<typeof insertFinAccountsReceivableSchema>;
export type FinTransaction = typeof finTransactions.$inferSelect;
export type InsertFinTransaction = z.infer<typeof insertFinTransactionSchema>;
