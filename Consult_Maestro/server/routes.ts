import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./portableAuth";
import { setupLocalAuth } from "./localAuth";
import { tenantContext, requireTenant, requireSuperadmin, requireTenantAdmin, requireTenantAdminOrPartner } from "./tenantContext";
import {
  listTenantAiConfigs,
  upsertTenantAiConfig,
  deleteTenantAiConfig,
  testProviderConnection,
  AI_PROVIDERS,
  type AiProvider,
} from "./aiConfigService";
import {
  listSessions as listSuperAgentSessions,
  createSession as createSuperAgentSession,
  getSession as getSuperAgentSession,
  getMessages as getSuperAgentMessages,
  deleteSession as deleteSuperAgentSession,
  sendMessage as sendSuperAgentMessage,
  updateSession as updateSuperAgentSession,
} from "./superAgentService";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { registerSocietarioRoutes } from "./societario/routes";
import { registerControlRoutes } from "./control/routes";
import { registerProducaoRoutes } from "./producao/routes";
import { registerHrRoutes } from "./hr/routes";
import { registerHrPayrollRoutes } from "./hr/payrollRoutes";
import { registerHrImportRoutes } from "./hr/importRoutes";
import { registerHrExportRoutes } from "./hr/exportRoutes";
import { registerHrReportRoutes } from "./hr/reportRoutes";
import { registerRecoveryRoutes } from "./recovery/routes";
import { registerIdeRoutes } from "./ide/routes";
import { registerExplorerRoutes } from "./explorer/routes";
import { registerPromptRoutes } from "./ide/promptRoutes";
import { registerModulePlannerRoutes } from "./modulePlanner/routes";
import { registerMarketplaceRoutes } from "./marketplace/routes";
import { registerMarketplaceDynamicRouter } from "./marketplace/dynamicRouter";
import { registerInfraRoutes } from "./infra/routes";
import { registerMcpRoutes } from "./mcp/server";
import { registerOauthRoutes } from "./mcp/oauthRoutes";
import { registerBrowserAgentRoutes } from "./browserAgent/routes";
import { registerApiKeyRoutes } from "./mcp/apiKeyRoutes";
import { registerIaUsageRoutes } from "./mcp/iaUsageRoutes";
import { registerAdminLlmRoutes } from "./mcp/adminLlmRoutes";
import { buildPublicMcpRouter } from "./mcp/publicRouter";
import { buildSwaggerSpec } from "./mcp/swaggerSpec";
import swaggerUi from "swagger-ui-express";
import {
  insertClientSchema,
  insertProjectSchema,
  insertCanvasBlockSchema,
  insertCanvasBlockQuestionSchema,
  insertCanvasPdcaItemSchema,
  insertProcessSchema,
  insertProcessStepSchema,
  insertProcessStepPdcaSchema,
  insertProcessDiagramSchema,
  insertDeliverableSchema,
  insertTaskSchema,
  insertProjectMemberSchema,
  insertProcessStepFileSchema,
  insertClientContactSchema,
  insertCollaboratorSchema,
  insertProjectCollaboratorSchema,
  insertProcessDiagramVersionSchema,
  insertProcessStepDiagnosticSchema,
  insertProcessRecommendationSchema,
  insertProcessKpiSchema,
  insertProcessStepSystemSchema,
  insertReusableRecommendationSchema,
  insertProcessTemplateSchema,
  insertErpRequirementSchema,
  insertErpRequirementAttachmentSchema,
  insertErpParameterizationTopicSchema,
  insertErpParameterizationItemSchema,
  insertSwotAnalysisSchema,
  insertSwotItemSchema,
  insertReportConfigurationSchema,
  insertCrmPipelineStageSchema,
  insertCrmLeadSchema,
  insertCrmOpportunitySchema,
  insertCrmActivitySchema,
  insertSupportTypeSchema,
  insertSupportTicketSchema,
  insertTicketCommentSchema,
  insertKnowledgeCategorySchema,
  insertKnowledgeArticleSchema,
  insertTrainingContentSchema,
  insertClientMembershipSchema,
  insertClientPortalAccessSchema,
  insertScrumInternalProjectSchema,
  insertScrumTeamSchema,
  insertScrumTeamMemberSchema,
  insertScrumSprintSchema,
  insertScrumBacklogItemSchema,
  insertScrumTimesheetSchema,
  insertScrumReworkSchema,
  insertScrumBacklogAttachmentSchema,
  insertProjectFileSchema,
  insertCrmProposalSchema,
  insertCrmProposalItemSchema,
  insertCrmContractSchema,
  insertCrmContractMilestoneSchema,
  insertCrmPartnerSchema,
  insertCrmPartnerCommissionSchema,
  insertPartnerSchema,
  insertTenantSchema,
  insertTenantUserSchema,
  insertInviteTokenSchema,
  insertDataSourceSchema,
  insertAutomationRuleSchema,
  dataSources,
  dataSnapshots,
  syncJobs,
  automationRules,
  notifications,
} from "@shared/schema";
import { encryptConfig, decryptConfig } from "./cryptoService";
import { invalidateTenantCache as invalidateBiTenantCache } from "./bi/cache";
import {
  fetchFromSource,
  saveSnapshot,
  runSync,
  ConnectorError,
} from "./connectorService";
import { sendNotification } from "./notificationService";
import { runRuleNow } from "./automationService";
import multer from "multer";
import { uploadFileToSession, listFilesForSession, deleteFile as deleteSuperAgentFile } from "./superAgentFiles";
import * as XLSX from "xlsx";

const integrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Helper function to get authenticated user ID from request (works for both local and OIDC auth).
// IMPORTANT: prioritize dbUserId (UUID interno) sobre claims.sub (providerSub do OIDC).
// O middleware tenantContext faz lookup/upsert e popula req.user.dbUserId quando a sessão
// OIDC só tinha claims.sub — assim getAuthUserId aqui retorna o UUID correto para FKs.
function getAuthUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) {
    return req.user.id;
  }
  if (req.user?.dbUserId) {
    return req.user.dbUserId;
  }
  if (req.user?.claims?.sub) {
    return req.user.claims.sub;
  }
  return null;
}

function checkTenantAccess(req: any, resource: { tenantId?: string | null } | null | undefined): boolean {
  if (!resource) return false;
  if (req.isSuperadmin) return true;
  if (!req.tenantId) return false;
  if (resource.tenantId === null || resource.tenantId === undefined) return false;
  return resource.tenantId === req.tenantId;
}

async function assertProjectTenantAccess(req: any, res: any, projectId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return false;
  }
  if (!checkTenantAccess(req, project)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

// Garante que um scrum_internal_project pertence ao tenant do usuário.
// Ordem de checagem (a primeira que casar manda):
//   1. superadmin → sempre OK.
//   2. ip.tenantId definido → precisa bater com req.tenantId.
//   3. ip.clientProjectId definido → deriva tenancy do project linkado.
//   4. legado (tenantId=null E clientProjectId=null) → permite p/ qualquer usuário
//      com req.tenantId resolvido (registros antigos não tinham tenancy).
async function assertScrumInternalProjectTenantAccess(
  req: any, res: any, internalProjectId: string,
): Promise<boolean> {
  const ip = await storage.getScrumInternalProject(internalProjectId);
  if (!ip) {
    res.status(404).json({ message: "Internal project not found" });
    return false;
  }
  if (req.isSuperadmin) return true;
  if (ip.tenantId) {
    if (ip.tenantId === req.tenantId) return true;
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  if (ip.clientProjectId) {
    return assertProjectTenantAccess(req, res, ip.clientProjectId);
  }
  // Legado sem tenancy explícita → permite usuários autenticados com tenant resolvido.
  if (req.tenantId) return true;
  res.status(403).json({ message: "Forbidden" });
  return false;
}

// Garante que um time Scrum pertence ao tenant (tenantId direto na coluna; legado NULL).
async function assertScrumTeamTenantAccess(
  req: any, res: any, teamId: string,
): Promise<boolean> {
  const team = await storage.getScrumTeam(teamId);
  if (!team) {
    res.status(404).json({ message: "Scrum team not found" });
    return false;
  }
  if (req.isSuperadmin) return true;
  if (team.tenantId) {
    if (team.tenantId === req.tenantId) return true;
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  // Legado sem tenant explícito → permite quem tem tenant resolvido.
  if (req.tenantId) return true;
  res.status(403).json({ message: "Forbidden" });
  return false;
}

// Valida timesheet via PBI dono.
async function assertScrumTimesheetTenantAccess(
  req: any, res: any, timesheetId: string,
): Promise<boolean> {
  const ts = await storage.getScrumTimesheet(timesheetId);
  if (!ts) {
    res.status(404).json({ message: "Scrum timesheet not found" });
    return false;
  }
  return assertScrumBacklogItemTenantAccess(req, res, ts.pbiId);
}

// Valida rework via PBI original.
async function assertScrumReworkTenantAccess(
  req: any, res: any, reworkId: string,
): Promise<boolean> {
  const rw = await storage.getScrumRework(reworkId);
  if (!rw) {
    res.status(404).json({ message: "Scrum rework not found" });
    return false;
  }
  return assertScrumBacklogItemTenantAccess(req, res, rw.originalPbiId);
}

// Valida membro de time via time pai.
async function assertScrumTeamMemberTenantAccess(
  req: any, res: any, memberId: string,
): Promise<boolean> {
  const member = await storage.getScrumTeamMember(memberId);
  if (!member) {
    res.status(404).json({ message: "Scrum team member not found" });
    return false;
  }
  return assertScrumTeamTenantAccess(req, res, member.teamId);
}

// Garante que uma sprint pertence ao tenant via internal_project.
async function assertScrumSprintTenantAccess(
  req: any, res: any, sprintId: string,
): Promise<boolean> {
  const sprint = await storage.getScrumSprint(sprintId);
  if (!sprint) {
    res.status(404).json({ message: "Scrum sprint not found" });
    return false;
  }
  if (req.isSuperadmin) return true;
  if (!sprint.internalProjectId) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return assertScrumInternalProjectTenantAccess(req, res, sprint.internalProjectId);
}

async function assertCanvasBlockTenantAccess(req: any, res: any, blockId: string): Promise<boolean> {
  const block = await storage.getCanvasBlock(blockId);
  if (!block) {
    res.status(404).json({ message: "Canvas block not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, block.projectId);
}

async function assertProcessTenantAccess(req: any, res: any, processId: string): Promise<boolean> {
  const process = await storage.getProcess(processId);
  if (!process) {
    res.status(404).json({ message: "Process not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, process.projectId);
}

async function assertDeliverableTenantAccess(req: any, res: any, deliverableId: string): Promise<boolean> {
  const deliverable = await storage.getDeliverable(deliverableId);
  if (!deliverable) {
    res.status(404).json({ message: "Deliverable not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, deliverable.projectId);
}

async function assertTaskTenantAccess(req: any, res: any, taskId: string): Promise<boolean> {
  const task = await storage.getTask(taskId);
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, task.projectId);
}

async function assertProcessStepTenantAccess(req: any, res: any, stepId: string): Promise<boolean> {
  const step = await storage.getProcessStep(stepId);
  if (!step) {
    res.status(404).json({ message: "Process step not found" });
    return false;
  }
  return assertProcessTenantAccess(req, res, step.processId);
}

async function assertDiagnosticTenantAccess(req: any, res: any, diagnosticId: string): Promise<boolean> {
  const diagnostic = await storage.getProcessStepDiagnostic(diagnosticId);
  if (!diagnostic) {
    res.status(404).json({ message: "Diagnostic not found" });
    return false;
  }
  return assertProcessStepTenantAccess(req, res, diagnostic.stepId);
}

async function assertRecommendationTenantAccess(req: any, res: any, recommendationId: string): Promise<boolean> {
  const recommendation = await storage.getProcessRecommendation(recommendationId);
  if (!recommendation) {
    res.status(404).json({ message: "Recommendation not found" });
    return false;
  }
  return assertProcessTenantAccess(req, res, recommendation.processId);
}

async function assertKpiTenantAccess(req: any, res: any, kpiId: string): Promise<boolean> {
  const kpi = await storage.getProcessKpi(kpiId);
  if (!kpi) {
    res.status(404).json({ message: "KPI not found" });
    return false;
  }
  return assertProcessTenantAccess(req, res, kpi.processId);
}

async function assertSwotTenantAccess(req: any, res: any, swotId: string): Promise<boolean> {
  const analysis = await storage.getSwotAnalysis(swotId);
  if (!analysis) {
    res.status(404).json({ message: "SWOT analysis not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, analysis.projectId);
}

async function assertErpRequirementTenantAccess(req: any, res: any, requirementId: string): Promise<boolean> {
  const requirement = await storage.getErpRequirement(requirementId);
  if (!requirement) {
    res.status(404).json({ message: "ERP requirement not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, requirement.projectId);
}

async function assertReportTenantAccess(req: any, res: any, reportId: string): Promise<boolean> {
  const report = await storage.getReportConfiguration(reportId);
  if (!report) {
    res.status(404).json({ message: "Report not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, report.projectId);
}

async function assertSwotItemTenantAccess(req: any, res: any, itemId: string): Promise<boolean> {
  const item = await storage.getSwotItem(itemId);
  if (!item) {
    res.status(404).json({ message: "SWOT item not found" });
    return false;
  }
  return assertSwotTenantAccess(req, res, item.analysisId);
}

async function assertErpTopicTenantAccess(req: any, res: any, topicId: string): Promise<boolean> {
  const topic = await storage.getErpParameterizationTopic(topicId);
  if (!topic) {
    res.status(404).json({ message: "ERP topic not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, topic.projectId);
}

async function assertErpItemTenantAccess(req: any, res: any, itemId: string): Promise<boolean> {
  const item = await storage.getErpParameterizationItem(itemId);
  if (!item) {
    res.status(404).json({ message: "ERP item not found" });
    return false;
  }
  return assertErpTopicTenantAccess(req, res, item.topicId);
}

async function assertErpAttachmentTenantAccess(req: any, res: any, attachmentId: string): Promise<boolean> {
  const attachment = await storage.getErpRequirementAttachment(attachmentId);
  if (!attachment) {
    res.status(404).json({ message: "ERP attachment not found" });
    return false;
  }
  return assertErpRequirementTenantAccess(req, res, attachment.requirementId);
}

async function assertPdcaTenantAccess(req: any, res: any, pdcaId: string): Promise<boolean> {
  const item = await storage.getCanvasPdcaItem(pdcaId);
  if (!item) {
    res.status(404).json({ message: "PDCA item not found" });
    return false;
  }
  return assertProjectTenantAccess(req, res, item.projectId);
}

async function assertScrumBacklogItemTenantAccess(req: any, res: any, pbiId: string): Promise<boolean> {
  const item = await storage.getScrumBacklogItem(pbiId);
  if (!item) {
    res.status(404).json({ message: "Scrum backlog item not found" });
    return false;
  }
  if (!checkTenantAccess(req, item)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

async function assertCrmOpportunityTenantAccess(req: any, res: any, opportunityId: string): Promise<boolean> {
  const opportunity = await storage.getCrmOpportunity(opportunityId);
  if (!opportunity) {
    res.status(404).json({ message: "Opportunity not found" });
    return false;
  }
  if (!checkTenantAccess(req, opportunity)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth middleware
  await setupAuth(app);
  
  // Local auth (login/password)
  setupLocalAuth(app);

  // ── MCP Hub Sprint 4 — Public router /mcp/v1 + Swagger /api-docs ────────
  // Both são montados ANTES do `tenantContext` para não depender de sessão/cookies.
  // O publicRouter só autentica via header `X-MCP-Key` (SHA-256 lookup em
  // partner_api_keys). Tenant é resolvido pela própria key.
  app.use("/mcp/v1", buildPublicMcpRouter());
  try {
    const spec = buildSwaggerSpec();
    app.get("/api-docs.json", (_req, res) => res.json(spec));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "Arcádia MCP API" }));
  } catch (e: any) {
    console.error("[mcp/swagger] failed to mount /api-docs:", e?.message);
  }

  // Multi-tenant context middleware (runs on all authenticated routes)
  // IMPORTANT: precisa ser registrado ANTES de qualquer registerXxxRoutes que
  // dependa de req.tenantId via requireTenant — middlewares só rodam para
  // handlers registrados depois deles na cadeia do Express.
  app.use(tenantContext);

  // Módulo Societário (Sprint 1 — CRUD base)
  registerSocietarioRoutes(app);

  // Arcádia Control (Sprint 1 — Fundação financeira)
  registerControlRoutes(app);

  // ── Contábil Data Layer (smoke test) ────────────────────────────────────
  // Camada ACIMA do Control: consolida ERPNext > Atlas > Control > HR.
  // Endpoints completos virão nas tarefas de semântica/agentes; aqui só
  // expomos um smoke test para validar o data layer.
  {
    const { getLancamentos, getContabilDataSourceStatus } = await import("./bi/contabilDataLayer");
    app.get("/api/contabil/lancamentos", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const { startDate, endDate, clienteId, limit } = req.query as Record<string, string | undefined>;
        const data = await getLancamentos({
          tenantId: req.tenantId,
          clienteId: clienteId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          limit: limit ? Number(limit) : undefined,
        });
        res.json({ count: data.length, items: data });
      } catch (err: any) {
        console.error("[contabil] GET /api/contabil/lancamentos:", err?.message);
        res.status(500).json({ message: err?.message || "Erro ao consultar lançamentos" });
      }
    });
    app.get("/api/contabil/sources", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        res.json(await getContabilDataSourceStatus(req.tenantId));
      } catch (err: any) {
        console.error("[contabil] GET /api/contabil/sources:", err?.message);
        res.status(500).json({ message: err?.message || "Erro ao detectar fontes" });
      }
    });
  }

  // Central de Produção — Evolução (subprojetos, drive, calendário, agente scrum)
  registerProducaoRoutes(app);
  registerHrRoutes(app);
  registerHrPayrollRoutes(app);
  registerHrImportRoutes(app);
  registerHrExportRoutes(app);
  registerHrReportRoutes(app);

  // Módulo Recovery — Sprint 1 (Fundação: processos, credores, ações, timeline)
  registerRecoveryRoutes(app);

  // Dev Center IDE Autônoma — Sprint 1 (Architect → Dev → QA, deploy aprovação)
  registerIdeRoutes(app);
  registerPromptRoutes(app);

  // Dev Center — Fase 5 (Code Explorer: IDE web sobre o Git interno por tenant)
  registerExplorerRoutes(app);

  // Dev Center — Fase 2 (Module Planner: PT description → plano técnico → pipeline)
  registerModulePlannerRoutes(app);
  registerMarketplaceRoutes(app);
  registerMarketplaceDynamicRouter(app);

  // Dev Center Sprint 4 — Infraestrutura (Coolify)
  registerInfraRoutes(app);

  // MCP Hub Sprint 2 — endpoint /api/mcp/* (lista + executa tools do registry)
  registerMcpRoutes(app);

  // MCP Hub Sprint 3 — OAuth2 (Google primeiro): /api/oauth/google/* + /api/oauth/platform/google
  registerOauthRoutes(app);

  // Escritório Agente — Browser automation: /api/agent/* + /api/browser/*
  registerBrowserAgentRoutes(app);

  // MCP Hub Sprint 4 — Partner API keys management (auth user): /api/api-keys/*
  registerApiKeyRoutes(app);

  // MCP Hub Sprint 4 — Dashboard de uso de IA (ai_usage_logs): /api/ia/usage
  registerIaUsageRoutes(app);

  // Task #47 — Orquestrador LLM (superadmin only): /api/admin/llm/*
  registerAdminLlmRoutes(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      let user;
      
      if (req.user.isLocalAuth) {
        user = await storage.getUser(req.user.id);
      } else if (req.user.claims?.sub) {
        user = await storage.getUser(getAuthUserId(req));
        if (!user) {
          user = await storage.getUserByProviderSub(getAuthUserId(req));
        }
      } else if (req.user.dbUserId) {
        user = await storage.getUser(req.user.dbUserId);
      }
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Users routes
  // Global user list — superadmin only (prevents cross-tenant PII leakage)
  app.get("/api/users", isAuthenticated, requireSuperadmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/users/:id/role", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { role } = req.body;
      const user = await storage.updateUserRole(req.params.id, role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.post("/api/users", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { email, firstName, lastName, role } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      const userRole = currentUser?.role === "admin" ? (role || "tecnico") : "tecnico";
      
      const user = await storage.createUser({
        email,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        role: userRole,
      });

      // Set password if provided
      const rawPassword = req.body.password;
      if (rawPassword && rawPassword.length >= 6) {
        const { hashPassword } = await import("./localAuth");
        const hashed = await hashPassword(rawPassword);
        await storage.updateUserPassword(user.id, hashed);
      }
      
      res.status(201).json(user);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user details (admin only)
  app.patch("/api/users/:id", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { firstName, lastName, email } = req.body;
      const user = await storage.updateUserDetails(req.params.id, { firstName, lastName, email });
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Self-service: update own profile
  app.patch("/api/auth/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      const { firstName, lastName } = req.body;
      const user = await storage.updateUserDetails(userId, { firstName, lastName });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Erro ao atualizar perfil" });
    }
  });

  // Self-service: change own password (local auth only)
  app.post("/api/auth/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Senhas são obrigatórias" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Nova senha deve ter ao menos 6 caracteres" });
      }
      const user = await storage.getUser(userId);
      if (!user || !user.passwordHash) {
        return res.status(400).json({ message: "Conta não usa autenticação local" });
      }
      const { verifyPassword, hashPassword } = await import("./localAuth");
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Senha atual incorreta" });
      }
      const newHash = await hashPassword(newPassword);
      await storage.updateUserPassword(userId, newHash);
      res.json({ success: true, message: "Senha alterada com sucesso" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Erro ao alterar senha" });
    }
  });

  // Admin: reset password by email (for partner management)
  app.post("/api/auth/admin-reset-password-by-email", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { email, newPassword } = req.body;
      if (!email || !newPassword) {
        return res.status(400).json({ message: "email e newPassword são obrigatórios" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Senha deve ter ao menos 6 caracteres" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado para este email" });
      }
      const { hashPassword } = await import("./localAuth");
      const newHash = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, newHash);
      res.json({ success: true, message: "Senha redefinida com sucesso" });
    } catch (error) {
      console.error("Error resetting password by email:", error);
      res.status(500).json({ message: "Erro ao redefinir senha" });
    }
  });

  // Admin: reset any user's password (admin only)
  app.post("/api/auth/admin-reset-password", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { userId, newPassword } = req.body;
      if (!userId || !newPassword) {
        return res.status(400).json({ message: "userId e newPassword são obrigatórios" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Senha deve ter ao menos 6 caracteres" });
      }
      const { hashPassword } = await import("./localAuth");
      const newHash = await hashPassword(newPassword);
      await storage.updateUserPassword(userId, newHash);
      res.json({ success: true, message: "Senha redefinida com sucesso" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Erro ao redefinir senha" });
    }
  });

  // Toggle user active status (admin only)
  app.patch("/api/users/:id/status", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Prevent deactivating yourself
      if (req.params.id === currentUser.id) {
        return res.status(400).json({ message: "Cannot change your own status" });
      }
      
      const { isActive } = req.body;
      const user = await storage.updateUserStatus(req.params.id, isActive);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Reset user password (admin only, for local auth users)
  app.post("/api/users/:id/reset-password", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      if (!targetUser.isLocalAuth) {
        return res.status(400).json({ message: "Cannot reset password for non-local users" });
      }
      
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(newPassword, 10);
      const user = await storage.updateUserPassword(req.params.id, passwordHash);
      
      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Clients routes
  app.get("/api/clients", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const clients = await storage.getAllClients(tenantId, { allowGlobal: req.isSuperadmin });
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      if (!checkTenantAccess(req, client)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const tenantId = req.isSuperadmin ? (parsed.data.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
      const client = await storage.createClient({
        ...parsed.data,
        createdById: getAuthUserId(req),
        tenantId,
      });
      res.status(201).json(client);
    } catch (error) {
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getClient(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Client not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertClientSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const { tenantId: _ignoredClientTenantId, ...updateData } = parsed.data;
      const client = await storage.updateClient(req.params.id, updateData);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente" && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existing = await storage.getClient(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Client not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteClient(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // ==========================================================================
  // Pessoas (CRM 2.0) — cadastro centralizado de relacionamentos
  // ==========================================================================
  const pessoasUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  // Lista paginada de pessoas do tenant (filtros básicos)
  app.get("/api/pessoas", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoas, pessoaPapeis } = await import("@shared/schema");
      const { and, eq, desc, ilike, sql: dsql } = await import("drizzle-orm");

      const tenantId = req.tenantId as string;
      const search = String(req.query.search ?? "").trim();
      const papelFiltro = String(req.query.papel ?? "").trim();
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
      const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

      const where = [eq(pessoas.tenantId, tenantId)];
      if (search) {
        where.push(
          dsql`(${pessoas.nomeFantasia} ILIKE ${"%" + search + "%"} OR ${pessoas.cnpjCpf} ILIKE ${"%" + search.replace(/\D/g, "") + "%"})`,
        );
      }

      let baseQuery = db.select().from(pessoas).where(and(...where));
      if (papelFiltro) {
        baseQuery = db
          .select({
            id: pessoas.id,
            tenantId: pessoas.tenantId,
            tipoPessoa: pessoas.tipoPessoa,
            nomeFantasia: pessoas.nomeFantasia,
            razaoSocial: pessoas.razaoSocial,
            cnpjCpf: pessoas.cnpjCpf,
            rgIe: pessoas.rgIe,
            inscricaoMunicipal: pessoas.inscricaoMunicipal,
            dataNascimentoFundacao: pessoas.dataNascimentoFundacao,
            status: pessoas.status,
            observacoes: pessoas.observacoes,
            createdAt: pessoas.createdAt,
            updatedAt: pessoas.updatedAt,
            createdById: pessoas.createdById,
            updatedById: pessoas.updatedById,
          })
          .from(pessoas)
          .innerJoin(pessoaPapeis, eq(pessoaPapeis.pessoaId, pessoas.id))
          .where(and(...where, eq(pessoaPapeis.tipoPapel, papelFiltro), eq(pessoaPapeis.status, "ativo"))) as any;
      }

      const items = await baseQuery.orderBy(desc(pessoas.updatedAt)).limit(limit).offset(offset);
      res.json(items);
    } catch (error) {
      console.error("Error listing pessoas:", error);
      res.status(500).json({ message: "Failed to list pessoas" });
    }
  });

  // Contadores agregados por papel (para os 5 cards do topo da lista)
  app.get("/api/pessoas/counts", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoas, pessoaPapeis } = await import("@shared/schema");
      const { and, eq, sql: dsql } = await import("drizzle-orm");
      const tenantId = req.tenantId as string;

      const totalRow = await db
        .select({ n: dsql<number>`count(*)::int` })
        .from(pessoas)
        .where(eq(pessoas.tenantId, tenantId));
      const total = totalRow[0]?.n ?? 0;

      const porPapel = await db
        .select({
          tipoPapel: pessoaPapeis.tipoPapel,
          n: dsql<number>`count(distinct ${pessoaPapeis.pessoaId})::int`,
        })
        .from(pessoaPapeis)
        .where(and(eq(pessoaPapeis.tenantId, tenantId), eq(pessoaPapeis.status, "ativo")))
        .groupBy(pessoaPapeis.tipoPapel);

      const counts: Record<string, number> = { total };
      for (const row of porPapel) counts[row.tipoPapel] = row.n;
      res.json(counts);
    } catch (error) {
      console.error("Error counting pessoas:", error);
      res.status(500).json({ message: "Failed to count pessoas" });
    }
  });

  // Detalhe de uma pessoa (com endereços, contatos e papéis)
  app.get("/api/pessoas/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoas, enderecos, contatos, pessoaPapeis } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");

      const id = req.params.id;
      const [pessoa] = await db
        .select()
        .from(pessoas)
        .where(and(eq(pessoas.id, id), eq(pessoas.tenantId, req.tenantId)))
        .limit(1);
      if (!pessoa) return res.status(404).json({ message: "Pessoa não encontrada" });

      const [endsList, contsList, papsList] = await Promise.all([
        db.select().from(enderecos).where(eq(enderecos.pessoaId, id)),
        db.select().from(contatos).where(eq(contatos.pessoaId, id)),
        db.select().from(pessoaPapeis).where(eq(pessoaPapeis.pessoaId, id)),
      ]);
      res.json({ ...pessoa, enderecos: endsList, contatos: contsList, papeis: papsList });
    } catch (error) {
      console.error("Error fetching pessoa:", error);
      res.status(500).json({ message: "Failed to fetch pessoa" });
    }
  });

  // Importação em massa: aceita .xlsx ou .csv (campo: file)
  app.post(
    "/api/pessoas/import",
    isAuthenticated,
    requireTenantAdmin,
    pessoasUpload.single("file"),
    async (req: any, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "Arquivo não enviado (campo 'file' obrigatório)" });
        }
        const nome = String(req.file.originalname ?? "").toLowerCase();
        if (!nome.endsWith(".xlsx") && !nome.endsWith(".xls") && !nome.endsWith(".csv")) {
          return res.status(400).json({
            message: "Formato inválido. Envie um arquivo .xlsx, .xls ou .csv",
          });
        }
        const tenantId = req.tenantId as string;
        const userId = getAuthUserId(req);
        const { importarPessoas } = await import("./pessoaImportService");
        const result = await importarPessoas(tenantId, req.file.buffer, userId);
        res.json(result);
      } catch (error: any) {
        console.error("Error importing pessoas:", error);
        res.status(500).json({ message: "Failed to import pessoas", detail: String(error?.message ?? error) });
      }
    },
  );

  // ----- CRUD Pessoa -----
  // Helper local: confirma que a pessoa pertence ao tenant da request
  async function assertPessoaOwnership(pessoaId: string, tenantId: string) {
    const { db } = await import("./db");
    const { pessoas } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [p] = await db
      .select({ id: pessoas.id, tenantId: pessoas.tenantId })
      .from(pessoas)
      .where(eq(pessoas.id, pessoaId))
      .limit(1);
    if (!p) return { error: 404 as const, message: "Pessoa não encontrada" };
    if (p.tenantId !== tenantId) return { error: 403 as const, message: "Forbidden" };
    return { ok: true as const };
  }

  // Whitelists de PATCH (impedem mutação de campos sensíveis)
  const PESSOA_PATCH_FIELDS = new Set([
    "nomeFantasia", "razaoSocial", "tipoPessoa", "cnpjCpf", "rgIe", "inscricaoMunicipal",
    "dataNascimentoFundacao", "status", "observacoes",
    // Campos comerciais
    "codigoExterno", "pessoaGrupo", "vendedorPadrao", "categoria", "tabelaPreco",
    "limiteCredito", "periodicidadeVendaCompra", "valorMinimoCompra",
  ]);
  const ENDERECO_PATCH_FIELDS = new Set([
    "tipo", "logradouro", "numero", "complemento", "bairro", "cidade",
    "codigoMunicipio", "uf", "codigoUf", "cep", "pais", "codigoPais", "isPrincipal",
  ]);
  const CONTATO_PATCH_FIELDS = new Set([
    "tipo", "valor", "isPrincipal", "isValidado",
  ]);
  const PAPEL_PATCH_FIELDS = new Set([
    "status", "dataInicio", "dataFim", "metadata",
  ]);

  // GET /api/pessoas/by-legacy-client/:clientId — usado para redirecionar
  // /clientes/:legacyId → /pessoas/:novoId (mapeia o cadastro antigo)
  app.get("/api/pessoas/by-legacy-client/:clientId", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { findPessoaByLegacyClientId } = await import("./legacyClientMigrationService");
      const tenantId = req.tenantId as string;
      const found = await findPessoaByLegacyClientId(tenantId, req.params.clientId);
      if (!found) return res.status(404).json({ message: "Pessoa não encontrada para este cliente legado" });
      res.json(found);
    } catch (error: any) {
      console.error("Error in /api/pessoas/by-legacy-client:", error);
      res.status(500).json({ message: error.message || "Erro ao buscar pessoa" });
    }
  });

  // POST /api/pessoas/migrate-legacy-clientes — migra cadastro legado de clientes
  // do tenant para Pessoas. Idempotente. Apenas tenant_admin/superadmin.
  app.post("/api/pessoas/migrate-legacy-clientes", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const { migrateLegacyClientesToPessoas } = await import("./legacyClientMigrationService");
      const tenantId = req.tenantId as string;
      const userId = getAuthUserId(req);
      const result = await migrateLegacyClientesToPessoas(tenantId, userId);
      res.json(result);
    } catch (error: any) {
      console.error("Error migrating legacy clientes:", error);
      res.status(500).json({ message: error.message || "Erro ao migrar cadastro legado" });
    }
  });

  // POST /api/pessoas — cria nova pessoa
  app.post("/api/pessoas", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoas, insertPessoaSchema } = await import("@shared/schema");
      const tenantId = req.tenantId as string | null;
      if (!tenantId) {
        // Superadmin sem tenant selecionado: precisa enviar X-Tenant-Id ou trocar de tenant.
        return res.status(400).json({
          message: "Selecione um tenant antes de cadastrar a pessoa.",
        });
      }
      const userId = getAuthUserId(req);

      const parsed = insertPessoaSchema.safeParse({
        ...req.body,
        tenantId,
        cnpjCpf: String(req.body?.cnpjCpf ?? "").replace(/\D/g, ""),
        createdById: userId,
        updatedById: userId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }
      const doc = parsed.data.cnpjCpf;
      if (doc.length !== 11 && doc.length !== 14) {
        return res.status(400).json({ message: "CNPJ/CPF inválido (precisa ter 11 ou 14 dígitos)" });
      }
      try {
        const [novo] = await db.insert(pessoas).values(parsed.data).returning();
        res.status(201).json(novo);
      } catch (err: any) {
        if (String(err?.message ?? "").includes("uq_pessoa_tenant_cnpj")) {
          return res.status(409).json({ message: "Já existe uma pessoa com este CNPJ/CPF neste tenant" });
        }
        throw err;
      }
    } catch (error) {
      console.error("Error creating pessoa:", error);
      res.status(500).json({ message: "Failed to create pessoa" });
    }
  });

  // PATCH /api/pessoas/:id
  app.patch("/api/pessoas/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const own = await assertPessoaOwnership(req.params.id, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const { db } = await import("./db");
      const { pessoas } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const updates: Record<string, any> = {};
      for (const k of Object.keys(req.body ?? {})) {
        if (PESSOA_PATCH_FIELDS.has(k)) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      }
      if (typeof updates.cnpjCpf === "string") {
        const onlyDigits = updates.cnpjCpf.replace(/\D/g, "");
        if (onlyDigits.length !== 11 && onlyDigits.length !== 14) {
          return res.status(400).json({ message: "CNPJ/CPF inválido (precisa ter 11 ou 14 dígitos)" });
        }
        updates.cnpjCpf = onlyDigits;
      }
      if (typeof updates.dataNascimentoFundacao === "string" && updates.dataNascimentoFundacao.trim() === "") {
        updates.dataNascimentoFundacao = null;
      }
      updates.updatedAt = new Date();
      updates.updatedById = getAuthUserId(req) ?? null;

      try {
        const [atualizado] = await db
          .update(pessoas)
          .set(updates)
          .where(eq(pessoas.id, req.params.id))
          .returning();
        res.json(atualizado);
      } catch (err: any) {
        if (String(err?.message ?? "").includes("uq_pessoa_tenant_cnpj")) {
          return res.status(409).json({ message: "Já existe uma pessoa com este CNPJ/CPF neste tenant" });
        }
        throw err;
      }
    } catch (error) {
      console.error("Error updating pessoa:", error);
      res.status(500).json({ message: "Failed to update pessoa" });
    }
  });

  // DELETE /api/pessoas/:id — soft delete (status=inativo); ?hard=true remove fisicamente
  app.delete("/api/pessoas/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const own = await assertPessoaOwnership(req.params.id, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const { db } = await import("./db");
      const { pessoas } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const hard = String(req.query.hard ?? "").toLowerCase() === "true";
      if (hard) {
        if (req.tenantRole !== "admin" && req.tenantRole !== "superadmin" && !req.isSuperadmin) {
          return res.status(403).json({ message: "Apenas admin do tenant pode remover fisicamente" });
        }
        await db.delete(pessoas).where(eq(pessoas.id, req.params.id));
      } else {
        await db
          .update(pessoas)
          .set({ status: "inativo", updatedAt: new Date(), updatedById: getAuthUserId(req) ?? null })
          .where(eq(pessoas.id, req.params.id));
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting pessoa:", error);
      res.status(500).json({ message: "Failed to delete pessoa" });
    }
  });

  // ----- CRUD Endereço (sub-recurso de pessoa) -----
  app.post("/api/pessoas/:pessoaId/enderecos", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const own = await assertPessoaOwnership(req.params.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const { db } = await import("./db");
      const { enderecos, insertEnderecoSchema } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const parsed = insertEnderecoSchema.safeParse({ ...req.body, pessoaId: req.params.pessoaId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }

      // Se marcado como principal, desmarca os outros da mesma pessoa
      if (parsed.data.isPrincipal === 1) {
        await db
          .update(enderecos)
          .set({ isPrincipal: 0 })
          .where(eq(enderecos.pessoaId, req.params.pessoaId));
      }
      const [novo] = await db.insert(enderecos).values(parsed.data).returning();
      res.status(201).json(novo);
    } catch (error) {
      console.error("Error creating endereco:", error);
      res.status(500).json({ message: "Failed to create endereco" });
    }
  });

  app.patch("/api/enderecos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { enderecos } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [end] = await db.select().from(enderecos).where(eq(enderecos.id, req.params.id)).limit(1);
      if (!end) return res.status(404).json({ message: "Endereço não encontrado" });
      const own = await assertPessoaOwnership(end.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const updates: Record<string, any> = {};
      for (const k of Object.keys(req.body ?? {})) {
        if (ENDERECO_PATCH_FIELDS.has(k)) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      }
      if (updates.isPrincipal === 1) {
        await db
          .update(enderecos)
          .set({ isPrincipal: 0 })
          .where(eq(enderecos.pessoaId, end.pessoaId));
      }
      const [atualizado] = await db.update(enderecos).set(updates).where(eq(enderecos.id, req.params.id)).returning();
      res.json(atualizado);
    } catch (error) {
      console.error("Error updating endereco:", error);
      res.status(500).json({ message: "Failed to update endereco" });
    }
  });

  app.delete("/api/enderecos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { enderecos } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [end] = await db.select().from(enderecos).where(eq(enderecos.id, req.params.id)).limit(1);
      if (!end) return res.status(404).json({ message: "Endereço não encontrado" });
      const own = await assertPessoaOwnership(end.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      await db.delete(enderecos).where(eq(enderecos.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting endereco:", error);
      res.status(500).json({ message: "Failed to delete endereco" });
    }
  });

  // ----- CRUD Contato (sub-recurso de pessoa) -----
  app.post("/api/pessoas/:pessoaId/contatos", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const own = await assertPessoaOwnership(req.params.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const { db } = await import("./db");
      const { contatos, insertContatoSchema } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");

      const parsed = insertContatoSchema.safeParse({ ...req.body, pessoaId: req.params.pessoaId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }

      // Se marcado como principal, desmarca outros do MESMO TIPO da mesma pessoa
      if (parsed.data.isPrincipal === 1) {
        await db
          .update(contatos)
          .set({ isPrincipal: 0 })
          .where(and(eq(contatos.pessoaId, req.params.pessoaId), eq(contatos.tipo, parsed.data.tipo)));
      }
      const [novo] = await db.insert(contatos).values(parsed.data).returning();
      res.status(201).json(novo);
    } catch (error) {
      console.error("Error creating contato:", error);
      res.status(500).json({ message: "Failed to create contato" });
    }
  });

  app.patch("/api/contatos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { contatos } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");

      const [c] = await db.select().from(contatos).where(eq(contatos.id, req.params.id)).limit(1);
      if (!c) return res.status(404).json({ message: "Contato não encontrado" });
      const own = await assertPessoaOwnership(c.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const updates: Record<string, any> = {};
      for (const k of Object.keys(req.body ?? {})) {
        if (CONTATO_PATCH_FIELDS.has(k)) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      }
      // Reconcilia "no máximo 1 principal por (pessoa, tipo)" considerando estado FINAL:
      // se o contato terminar principal=1 (por update OU por já ser), desmarca os outros
      // do mesmo TIPO FINAL (cobre também troca de tipo de um contato já principal).
      const tipoFinal = updates.tipo ?? c.tipo;
      const principalFinal = updates.isPrincipal ?? c.isPrincipal;
      if (principalFinal === 1) {
        const { ne } = await import("drizzle-orm");
        await db
          .update(contatos)
          .set({ isPrincipal: 0 })
          .where(and(
            eq(contatos.pessoaId, c.pessoaId),
            eq(contatos.tipo, tipoFinal),
            ne(contatos.id, req.params.id),
          ));
      }
      const [atualizado] = await db.update(contatos).set(updates).where(eq(contatos.id, req.params.id)).returning();
      res.json(atualizado);
    } catch (error) {
      console.error("Error updating contato:", error);
      res.status(500).json({ message: "Failed to update contato" });
    }
  });

  app.delete("/api/contatos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { contatos } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [c] = await db.select().from(contatos).where(eq(contatos.id, req.params.id)).limit(1);
      if (!c) return res.status(404).json({ message: "Contato não encontrado" });
      const own = await assertPessoaOwnership(c.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      await db.delete(contatos).where(eq(contatos.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting contato:", error);
      res.status(500).json({ message: "Failed to delete contato" });
    }
  });

  // ----- CRUD Papel (sub-recurso de pessoa) -----
  app.post("/api/pessoas/:pessoaId/papeis", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const own = await assertPessoaOwnership(req.params.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const { db } = await import("./db");
      const { pessoaPapeis, insertPessoaPapelSchema } = await import("@shared/schema");

      const parsed = insertPessoaPapelSchema.safeParse({
        ...req.body,
        pessoaId: req.params.pessoaId,
        tenantId: req.tenantId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
      }
      try {
        const [novo] = await db.insert(pessoaPapeis).values(parsed.data).returning();
        res.status(201).json(novo);
      } catch (err: any) {
        if (String(err?.message ?? "").includes("uq_pessoa_papel_ativo")) {
          return res.status(409).json({
            message: `Esta pessoa já possui um papel ativo do tipo '${parsed.data.tipoPapel}'. Inative o existente antes de criar outro.`,
          });
        }
        throw err;
      }
    } catch (error) {
      console.error("Error creating papel:", error);
      res.status(500).json({ message: "Failed to create papel" });
    }
  });

  app.patch("/api/papeis/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoaPapeis } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [pap] = await db.select().from(pessoaPapeis).where(eq(pessoaPapeis.id, req.params.id)).limit(1);
      if (!pap) return res.status(404).json({ message: "Papel não encontrado" });
      const own = await assertPessoaOwnership(pap.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const updates: Record<string, any> = {};
      for (const k of Object.keys(req.body ?? {})) {
        if (PAPEL_PATCH_FIELDS.has(k)) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      }
      updates.updatedAt = new Date();

      try {
        const [atualizado] = await db.update(pessoaPapeis).set(updates).where(eq(pessoaPapeis.id, req.params.id)).returning();
        res.json(atualizado);
      } catch (err: any) {
        if (String(err?.message ?? "").includes("uq_pessoa_papel_ativo")) {
          return res.status(409).json({
            message: `Já existe outro papel ativo do tipo '${pap.tipoPapel}' para esta pessoa.`,
          });
        }
        throw err;
      }
    } catch (error) {
      console.error("Error updating papel:", error);
      res.status(500).json({ message: "Failed to update papel" });
    }
  });

  // DELETE /api/papeis/:id — soft delete (status=inativo); ?hard=true remove
  app.delete("/api/papeis/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { pessoaPapeis } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [pap] = await db.select().from(pessoaPapeis).where(eq(pessoaPapeis.id, req.params.id)).limit(1);
      if (!pap) return res.status(404).json({ message: "Papel não encontrado" });
      const own = await assertPessoaOwnership(pap.pessoaId, req.tenantId);
      if (!("ok" in own)) return res.status(own.error).json({ message: own.message });

      const hard = String(req.query.hard ?? "").toLowerCase() === "true";
      if (hard) {
        if (req.tenantRole !== "admin" && req.tenantRole !== "superadmin" && !req.isSuperadmin) {
          return res.status(403).json({ message: "Apenas admin do tenant pode remover fisicamente" });
        }
        await db.delete(pessoaPapeis).where(eq(pessoaPapeis.id, req.params.id));
      } else {
        await db
          .update(pessoaPapeis)
          .set({ status: "inativo", dataFim: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
          .where(eq(pessoaPapeis.id, req.params.id));
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting papel:", error);
      res.status(500).json({ message: "Failed to delete papel" });
    }
  });

  // Client Contacts routes
  app.get("/api/clients/:clientId/contacts", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const contacts = await storage.getClientContacts(req.params.clientId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching client contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.post("/api/clients/:clientId/contacts", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertClientContactSchema.safeParse({
        ...req.body,
        clientId: req.params.clientId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const contact = await storage.createClientContact(parsed.data);
      res.status(201).json(contact);
    } catch (error) {
      console.error("Error creating client contact:", error);
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  app.patch("/api/contacts/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertClientContactSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const contact = await storage.updateClientContact(req.params.id, parsed.data);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      console.error("Error updating contact:", error);
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  app.delete("/api/contacts/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteClientContact(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting contact:", error);
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // Collaborators routes
  app.get("/api/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const collaborators = await storage.getAllCollaborators();
      res.json(collaborators);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
      res.status(500).json({ message: "Failed to fetch collaborators" });
    }
  });

  app.get("/api/clients/:clientId/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const collaborators = await storage.getCollaborators(req.params.clientId);
      res.json(collaborators);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
      res.status(500).json({ message: "Failed to fetch collaborators" });
    }
  });

  app.get("/api/collaborators/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const collaborator = await storage.getCollaborator(req.params.id);
      if (!collaborator) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      res.json(collaborator);
    } catch (error) {
      console.error("Error fetching collaborator:", error);
      res.status(500).json({ message: "Failed to fetch collaborator" });
    }
  });

  app.post("/api/clients/:clientId/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCollaboratorSchema.safeParse({
        ...req.body,
        clientId: req.params.clientId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const collaborator = await storage.createCollaborator(parsed.data);
      res.status(201).json(collaborator);
    } catch (error) {
      console.error("Error creating collaborator:", error);
      res.status(500).json({ message: "Failed to create collaborator" });
    }
  });

  app.patch("/api/collaborators/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCollaboratorSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const collaborator = await storage.updateCollaborator(req.params.id, parsed.data);
      if (!collaborator) {
        return res.status(404).json({ message: "Collaborator not found" });
      }
      res.json(collaborator);
    } catch (error) {
      console.error("Error updating collaborator:", error);
      res.status(500).json({ message: "Failed to update collaborator" });
    }
  });

  app.delete("/api/collaborators/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCollaborator(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting collaborator:", error);
      res.status(500).json({ message: "Failed to delete collaborator" });
    }
  });

  // Projects routes
  // Comportamento:
  //   - Default (sem params): retorna TODOS os tipos (compat retroativa).
  //   - ?excludeType=compass[,...]: remove os tipos listados (filtro pós-fetch).
  //   - ?type=external,internal: mantém apenas os tipos listados (pós-fetch).
  //   - ?scope=production: usa o helper centralizado storage.getProductionProjects()
  //     que filtra type='compass' direto no SQL — fonte única de verdade
  //     usada por Reports, BI, Super Agente, Backlog, Sprints, Timesheet etc.
  //   - ?clientId=...: combinável com scope/excludeType/type.
  // Telas que querem apenas demandas (compass) usam /api/demandas.
  app.get("/api/projects", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const scope = (req.query.scope as string | undefined)?.trim();
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      let projects: Awaited<ReturnType<typeof storage.getAllProjects>>;
      if (clientId) {
        projects = await storage.getProjectsByClient(clientId, tenantId);
        if (scope === "production") {
          projects = projects.filter(p => p.type !== "compass");
        }
      } else if (scope === "production") {
        projects = await storage.getProductionProjects(tenantId, { allowGlobal: req.isSuperadmin });
      } else {
        projects = await storage.getAllProjects(tenantId, { allowGlobal: req.isSuperadmin });
      }
      const excludeType = (req.query.excludeType as string | undefined)?.trim();
      const typeFilter = (req.query.type as string | undefined)?.trim();
      let result = projects;
      if (excludeType) {
        const excludeSet = new Set(excludeType.split(",").map(s => s.trim()).filter(Boolean));
        if (excludeSet.size > 0) {
          result = result.filter(p => !excludeSet.has(p.type));
        }
      }
      if (typeFilter) {
        const includeSet = new Set(typeFilter.split(",").map(s => s.trim()).filter(Boolean));
        if (includeSet.size > 0) {
          result = result.filter(p => includeSet.has(p.type));
        }
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (!checkTenantAccess(req, project)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const tenantId = req.isSuperadmin ? (parsed.data.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
      const project = await storage.createProject({
        ...parsed.data,
        managerId: parsed.data.managerId || getAuthUserId(req),
        tenantId,
      });
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getProject(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertProjectSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const { tenantId: _ignoredProjectTenantId, ...updateData } = parsed.data;
      const project = await storage.updateProject(req.params.id, updateData);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente" && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existing = await storage.getProject(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // ===== Tenant AI Configs (Multi-Provider Phase 1 — Opção C: schema + UI) =====
  function isValidProvider(p: any): p is AiProvider {
    return typeof p === "string" && (AI_PROVIDERS as readonly string[]).includes(p);
  }

  app.get("/api/ai/config", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant ausente" });
      const configs = await listTenantAiConfigs(tenantId);
      res.json(configs);
    } catch (error) {
      console.error("Error listing AI configs:", error);
      res.status(500).json({ message: "Failed to list AI configs" });
    }
  });

  app.post("/api/ai/config", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant ausente" });
      const { provider, apiKey, model, baseUrl, isActive } = req.body ?? {};
      if (!isValidProvider(provider)) {
        return res.status(400).json({ message: "Provider inválido", allowed: AI_PROVIDERS });
      }
      // Normalize: undefined => keep, null/'' => clear, string => set. Never coerce null→"null".
      const norm = (v: any): string | null | undefined => {
        if (v === undefined) return undefined;
        if (v === null || v === "") return null;
        return String(v);
      };
      await upsertTenantAiConfig(tenantId, provider, {
        apiKey: norm(apiKey),
        model: norm(model),
        baseUrl: norm(baseUrl),
        isActive: typeof isActive === "boolean" ? isActive : undefined,
      });
      const updated = await listTenantAiConfigs(tenantId);
      res.json({ ok: true, configs: updated });
    } catch (error: any) {
      console.error("Error saving AI config:", error);
      res.status(500).json({ message: error?.message ?? "Failed to save AI config" });
    }
  });

  app.delete("/api/ai/config/:provider", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant ausente" });
      const provider = req.params.provider;
      if (!isValidProvider(provider)) {
        return res.status(400).json({ message: "Provider inválido", allowed: AI_PROVIDERS });
      }
      await deleteTenantAiConfig(tenantId, provider);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting AI config:", error);
      res.status(500).json({ message: "Failed to delete AI config" });
    }
  });

  app.post("/api/ai/config/test", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant ausente" });
      const { provider, apiKey, baseUrl } = req.body ?? {};
      if (!isValidProvider(provider)) {
        return res.status(400).json({ message: "Provider inválido", allowed: AI_PROVIDERS });
      }
      const result = await testProviderConnection(tenantId, provider, {
        apiKey: typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined,
        baseUrl: typeof baseUrl === "string" && baseUrl.length > 0 ? baseUrl : undefined,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error testing AI provider:", error);
      res.status(500).json({ ok: false, message: error?.message ?? "Falha no teste" });
    }
  });

  // ===== Super Agent (Phase 3 — contextual conversational agent with tools) =====
  app.get("/api/super-agent/sessions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      if (!tenantId || !userId) return res.status(400).json({ message: "Tenant/User ausente" });
      const projectId = typeof req.query.projectId === "string" && req.query.projectId.length > 0 ? req.query.projectId : undefined;
      const sessions = await listSuperAgentSessions(tenantId, userId, projectId);
      res.json(sessions);
    } catch (e: any) {
      console.error("[super-agent] list sessions error:", e);
      res.status(500).json({ message: e?.message ?? "Erro" });
    }
  });

  app.post("/api/super-agent/sessions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      if (!tenantId || !userId) return res.status(400).json({ message: "Tenant/User ausente" });
      const { projectId, title, agentId } = req.body ?? {};
      const session = await createSuperAgentSession(tenantId, userId, projectId ?? null, title, agentId ?? null);
      res.json(session);
    } catch (e: any) {
      console.error("[super-agent] create session error:", e);
      res.status(500).json({ message: e?.message ?? "Erro" });
    }
  });

  app.get("/api/super-agent/sessions/:id/messages", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      const session = await getSuperAgentSession(req.params.id, tenantId, userId);
      if (!session) return res.status(404).json({ message: "Sessão não encontrada" });
      const messages = await getSuperAgentMessages(req.params.id);
      res.json({ session, messages });
    } catch (e: any) {
      console.error("[super-agent] get messages error:", e);
      res.status(500).json({ message: e?.message ?? "Erro" });
    }
  });

  app.post("/api/super-agent/sessions/:id/messages", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      const { message } = req.body ?? {};
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ message: "message obrigatório" });
      }
      const session = await getSuperAgentSession(req.params.id, tenantId, userId);
      if (!session) return res.status(404).json({ message: "Sessão não encontrada" });
      const result = await sendSuperAgentMessage({
        sessionId: req.params.id,
        tenantId, userId,
        userMessage: message.trim(),
      });
      res.json(result);
    } catch (e: any) {
      console.error("[super-agent] send message error:", e);
      res.status(500).json({ message: e?.message ?? "Erro" });
    }
  });

  app.patch("/api/super-agent/sessions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      const { title, agentId } = req.body ?? {};
      const updated = await updateSuperAgentSession(req.params.id, tenantId, userId, { title, agentId });
      if (!updated) return res.status(404).json({ message: "Sessão não encontrada" });
      res.json(updated);
    } catch (e: any) {
      console.error("[super-agent] patch session error:", e);
      res.status(400).json({ message: e?.message ?? "Erro" });
    }
  });

  app.delete("/api/super-agent/sessions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.claims?.sub || req.user?.id;
      await deleteSuperAgentSession(req.params.id, tenantId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[super-agent] delete session error:", e);
      res.status(500).json({ message: e?.message ?? "Erro" });
    }
  });

  // SSE stream of a turn — POST with NDJSON-style "event:/data:" frames
  app.post("/api/super-agent/sessions/:id/messages-stream", isAuthenticated, requireTenant, async (req: any, res) => {
    const tenantId = req.tenantId;
    const userId = req.user?.claims?.sub || req.user?.id;
    const { message } = req.body ?? {};
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ message: "message obrigatório" });
    }
    const session = await getSuperAgentSession(req.params.id, tenantId, userId);
    if (!session) return res.status(404).json({ message: "Sessão não encontrada" });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    // initial heartbeat / open
    send("open", { ok: true });

    let closed = false;
    req.on("close", () => { closed = true; });

    try {
      await sendSuperAgentMessage({
        sessionId: req.params.id,
        tenantId, userId,
        userMessage: message.trim(),
        onStep: (ev) => {
          if (closed) return;
          send("step", ev);
        },
      });
      if (!closed) res.end();
    } catch (e: any) {
      console.error("[super-agent] stream error:", e);
      if (!closed) {
        send("step", { kind: "error", message: e?.message ?? "Erro interno" });
        res.end();
      }
    }
  });

  // ===== Super Agente — Fase 3: anexos de arquivos =====
  const superAgentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  });
  app.post(
    "/api/super-agent/sessions/:id/files",
    isAuthenticated, requireTenant,
    (req: any, res, next) => {
      superAgentUpload.single("file")(req, res, (err: any) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ message: "Arquivo excede limite de 15 MB" });
          }
          return res.status(400).json({ message: err.message || "Upload inválido" });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        const userId = req.user?.claims?.sub || req.user?.id;
        if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório" });
        const result = await uploadFileToSession({
          sessionId: req.params.id,
          tenantId, userId,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
        });
        res.json(result);
      } catch (e: any) {
        console.error("[super-agent] upload error:", e);
        const msg = e?.message || "Falha no upload";
        const code = msg.includes("não encontrada") ? 404 : 400;
        res.status(code).json({ message: msg });
      }
    }
  );

  app.get("/api/super-agent/sessions/:id/files", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const files = await listFilesForSession(req.params.id, req.tenantId, userId);
      res.json(files);
    } catch (e: any) {
      res.status(404).json({ message: e?.message || "Sessão não encontrada" });
    }
  });

  app.delete("/api/super-agent/files/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      await deleteSuperAgentFile(req.params.id, req.tenantId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(404).json({ message: e?.message || "Arquivo não encontrado" });
    }
  });

  // ===== Demandas (Kanban) — projects WHERE type='compass' =====
  const DEMANDA_STATUSES = ['backlog', 'diagnostico', 'proposta_enviada', 'aprovada', 'entregue', 'andamento', 'revisao', 'concluido'] as const;

  app.get("/api/demandas", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const all = await storage.getAllProjects(tenantId, { allowGlobal: req.isSuperadmin });
      const demandas = all.filter((p: any) => (p.type ?? 'compass') === 'compass');
      res.json(demandas);
    } catch (error) {
      console.error("Error fetching demandas:", error);
      res.status(500).json({ message: "Failed to fetch demandas" });
    }
  });

  app.patch("/api/demandas/:id/status", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getProject(req.params.id);
      if (!existing) return res.status(404).json({ message: "Demanda not found" });
      if (!checkTenantAccess(req, existing)) return res.status(403).json({ message: "Forbidden" });
      if ((existing as any).type && (existing as any).type !== 'compass') {
        return res.status(400).json({ message: "Not a demanda" });
      }
      const { status } = req.body ?? {};
      if (!DEMANDA_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status", allowed: DEMANDA_STATUSES });
      }
      const updated = await storage.updateProject(req.params.id, { status } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating demanda status:", error);
      res.status(500).json({ message: "Failed to update demanda status" });
    }
  });

  app.post("/api/demandas/:id/aprovar", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const demanda: any = await storage.getProject(req.params.id);
      if (!demanda) return res.status(404).json({ message: "Demanda not found" });
      if (!checkTenantAccess(req, demanda)) return res.status(403).json({ message: "Forbidden" });
      if ((demanda.type ?? 'compass') !== 'compass') {
        return res.status(400).json({ message: "Not a demanda" });
      }

      const createScrum = req.body?.createScrum === true;
      let externalProject: any = null;
      let scrumProject: any = null;

      if (createScrum) {
        // Idempotência reforçada: 1) tenta linkedProjectId, 2) busca por compassProjectId+type='external'
        if (demanda.linkedProjectId) {
          externalProject = await storage.getProject(demanda.linkedProjectId);
        }
        if (!externalProject) {
          const tenantId = req.isSuperadmin ? (demanda.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
          const allProjects = await storage.getAllProjects(tenantId, { allowGlobal: req.isSuperadmin });
          externalProject = allProjects.find((p: any) => p.compassProjectId === demanda.id && p.type === 'external') ?? null;
        }
        if (!externalProject) {
          const tenantId = req.isSuperadmin ? (demanda.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
          externalProject = await storage.createProject({
            name: `Projeto: ${demanda.name}`,
            description: demanda.description ?? null,
            clientId: demanda.clientId,
            managerId: demanda.managerId ?? getAuthUserId(req),
            tenantId,
            status: 'andamento',
            type: 'external',
            compassProjectId: demanda.id,
          } as any);
        }

        // Cria scrum_internal_projects vinculado ao external — idempotente: pula se já existe
        const scrumTenantId = req.isSuperadmin ? (externalProject.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
        const allScrum = await storage.getScrumInternalProjects(scrumTenantId, { allowGlobal: req.isSuperadmin });
        const existingScrum = allScrum.find((s: any) => s.clientProjectId === externalProject.id);
        if (existingScrum) {
          scrumProject = existingScrum;
        } else {
          try {
            scrumProject = await storage.createScrumInternalProject({
              name: externalProject.name,
              description: externalProject.description ?? null,
              clientProjectId: externalProject.id,
              isInternal: 0,
              status: 'active',
              createdById: getAuthUserId(req),
            } as any);
          } catch (e) {
            // Best-effort: external project + demanda update prevalecem; usuário pode tentar de novo
            console.warn("Scrum internal project creation skipped:", (e as any)?.message);
          }
        }
      }

      const updatedDemanda = await storage.updateProject(demanda.id, {
        status: 'aprovada',
        ...(externalProject ? { linkedProjectId: externalProject.id } : {}),
      } as any);

      res.json({ demanda: updatedDemanda, externalProject, scrumProject });
    } catch (error) {
      console.error("Error approving demanda:", error);
      res.status(500).json({ message: "Failed to approve demanda" });
    }
  });

  // Project Members routes
  app.get("/api/projects/:id/members", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.id)) return;
      const members = await storage.getProjectMembers(req.params.id);
      res.json(members);
    } catch (error) {
      console.error("Error fetching project members:", error);
      res.status(500).json({ message: "Failed to fetch project members" });
    }
  });

  app.post("/api/projects/:id/members", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.id)) return;
      const parsed = insertProjectMemberSchema.safeParse({
        ...req.body,
        projectId: req.params.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const member = await storage.addProjectMember(parsed.data);
      res.status(201).json(member);
    } catch (error) {
      console.error("Error adding project member:", error);
      res.status(500).json({ message: "Failed to add project member" });
    }
  });

  app.delete("/api/projects/:id/members/:userId", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.id)) return;
      await storage.removeProjectMember(req.params.id, req.params.userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing project member:", error);
      res.status(500).json({ message: "Failed to remove project member" });
    }
  });

  // Project Collaborators routes
  app.get("/api/projects/:id/collaborators", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.id)) return;
      const collaborators = await storage.getProjectCollaborators(req.params.id);
      res.json(collaborators);
    } catch (error) {
      console.error("Error fetching project collaborators:", error);
      res.status(500).json({ message: "Failed to fetch project collaborators" });
    }
  });

  app.get("/api/projects/:id/available-collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const collaborators = await storage.getAvailableCollaboratorsForProject(req.params.id);
      res.json(collaborators);
    } catch (error) {
      console.error("Error fetching available collaborators:", error);
      res.status(500).json({ message: "Failed to fetch available collaborators" });
    }
  });

  app.post("/api/projects/:id/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertProjectCollaboratorSchema.safeParse({
        ...req.body,
        projectId: req.params.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const collaborator = await storage.addProjectCollaborator(parsed.data);
      res.status(201).json(collaborator);
    } catch (error) {
      console.error("Error adding project collaborator:", error);
      res.status(500).json({ message: "Failed to add project collaborator" });
    }
  });

  // Create a new collaborator for the project's client and immediately link them to the project
  app.post("/api/projects/:id/collaborators/create-and-add", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const { name, position, department, email, phone, permission } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });
      const newCollab = await storage.createCollaborator({
        clientId: project.clientId,
        name: name.trim(),
        position: position || null,
        department: department || null,
        email: email || null,
        phone: phone || null,
        canParticipateInProjects: 1,
        isActive: 1,
      });
      const linked = await storage.addProjectCollaborator({
        projectId: req.params.id,
        collaboratorId: newCollab.id,
        permission: permission || 'view',
      });
      res.status(201).json({ collaborator: newCollab, link: linked });
    } catch (error) {
      console.error("Error creating and adding collaborator:", error);
      res.status(500).json({ message: "Failed to create collaborator" });
    }
  });

  app.patch("/api/projects/:id/collaborators/:collaboratorId", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const { permission } = req.body;
      if (!permission || !['view', 'edit'].includes(permission)) {
        return res.status(400).json({ message: "Invalid permission. Must be 'view' or 'edit'" });
      }
      const updated = await storage.updateProjectCollaboratorPermission(
        req.params.id,
        req.params.collaboratorId,
        permission
      );
      if (!updated) {
        return res.status(404).json({ message: "Project collaborator not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating project collaborator:", error);
      res.status(500).json({ message: "Failed to update project collaborator" });
    }
  });

  app.delete("/api/projects/:id/collaborators/:collaboratorId", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.removeProjectCollaborator(req.params.id, req.params.collaboratorId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing project collaborator:", error);
      res.status(500).json({ message: "Failed to remove project collaborator" });
    }
  });

  // Process Collaborators routes
  app.get("/api/processes/:id/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const collaborators = await storage.getProjectCollaboratorsForProcess(req.params.id);
      res.json(collaborators);
    } catch (error) {
      console.error("Error fetching process collaborators:", error);
      res.status(500).json({ message: "Failed to fetch process collaborators" });
    }
  });

  app.post("/api/processes/:id/collaborators", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const { collaboratorId, participates, role } = req.body;
      if (!collaboratorId) return res.status(400).json({ message: "collaboratorId is required" });
      const result = await storage.setProcessCollaborator({
        processId: req.params.id,
        collaboratorId,
        participates: participates === false ? 0 : 1,
        role: role || null,
      });
      res.json(result);
    } catch (error) {
      console.error("Error setting process collaborator:", error);
      res.status(500).json({ message: "Failed to set process collaborator" });
    }
  });

  app.delete("/api/processes/:id/collaborators/:collaboratorId", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.removeProcessCollaborator(req.params.id, req.params.collaboratorId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing process collaborator:", error);
      res.status(500).json({ message: "Failed to remove process collaborator" });
    }
  });

  // Canvas Blocks routes
  app.get("/api/projects/:projectId/canvas", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const blocks = await storage.getCanvasBlocks(req.params.projectId);
      res.json(blocks);
    } catch (error) {
      console.error("Error fetching canvas blocks:", error);
      res.status(500).json({ message: "Failed to fetch canvas blocks" });
    }
  });

  app.post("/api/projects/:projectId/canvas", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertCanvasBlockSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const block = await storage.createCanvasBlock(parsed.data);
      res.status(201).json(block);
    } catch (error) {
      console.error("Error creating canvas block:", error);
      res.status(500).json({ message: "Failed to create canvas block" });
    }
  });

  app.patch("/api/canvas/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertCanvasBlockTenantAccess(req, res, req.params.id)) return;
      const parsed = insertCanvasBlockSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const block = await storage.updateCanvasBlock(req.params.id, parsed.data);
      if (!block) {
        return res.status(404).json({ message: "Canvas block not found" });
      }
      res.json(block);
    } catch (error) {
      console.error("Error updating canvas block:", error);
      res.status(500).json({ message: "Failed to update canvas block" });
    }
  });

  app.delete("/api/canvas/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertCanvasBlockTenantAccess(req, res, req.params.id)) return;
      await storage.deleteCanvasBlock(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting canvas block:", error);
      res.status(500).json({ message: "Failed to delete canvas block" });
    }
  });

  // Canvas Block Questions routes
  app.get("/api/canvas/:blockId/questions", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const questions = await storage.getCanvasBlockQuestions(req.params.blockId);
      res.json(questions);
    } catch (error) {
      console.error("Error fetching canvas block questions:", error);
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  });

  app.post("/api/canvas/:blockId/questions", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCanvasBlockQuestionSchema.safeParse({
        ...req.body,
        blockId: req.params.blockId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const question = await storage.createCanvasBlockQuestion(parsed.data);
      res.status(201).json(question);
    } catch (error) {
      console.error("Error creating canvas block question:", error);
      res.status(500).json({ message: "Failed to create question" });
    }
  });

  app.patch("/api/canvas/questions/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCanvasBlockQuestionSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const question = await storage.updateCanvasBlockQuestion(req.params.id, parsed.data);
      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }
      res.json(question);
    } catch (error) {
      console.error("Error updating canvas block question:", error);
      res.status(500).json({ message: "Failed to update question" });
    }
  });

  app.delete("/api/canvas/questions/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCanvasBlockQuestion(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting canvas block question:", error);
      res.status(500).json({ message: "Failed to delete question" });
    }
  });

  // Canvas PDCA routes
  app.get("/api/projects/:projectId/pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const items = await storage.getCanvasPdcaItems(req.params.projectId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching PDCA items:", error);
      res.status(500).json({ message: "Failed to fetch PDCA items" });
    }
  });

  app.post("/api/projects/:projectId/pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertCanvasPdcaItemSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        createdById: req.user?.claims?.sub,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createCanvasPdcaItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating PDCA item:", error);
      res.status(500).json({ message: "Failed to create PDCA item" });
    }
  });

  app.patch("/api/pdca/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertPdcaTenantAccess(req, res, req.params.id)) return;
      const body = {
        ...req.body,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
      };
      const parsed = insertCanvasPdcaItemSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateCanvasPdcaItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "PDCA item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating PDCA item:", error);
      res.status(500).json({ message: "Failed to update PDCA item" });
    }
  });

  app.delete("/api/pdca/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertPdcaTenantAccess(req, res, req.params.id)) return;
      await storage.deleteCanvasPdcaItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting PDCA item:", error);
      res.status(500).json({ message: "Failed to delete PDCA item" });
    }
  });

  // Process PDCA aggregate route - gets all PDCA items from TO-BE process steps
  app.get("/api/projects/:projectId/process-pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const items = await storage.getAllProcessPdcaItemsForProject(req.params.projectId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching process PDCA items:", error);
      res.status(500).json({ message: "Failed to fetch process PDCA items" });
    }
  });

  // Process Step PDCA routes (for TO-BE steps)
  app.get("/api/process-steps/:stepId/pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const items = await storage.getProcessStepPdcaItems(req.params.stepId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching process step PDCA items:", error);
      res.status(500).json({ message: "Failed to fetch PDCA items" });
    }
  });

  app.post("/api/process-steps/:stepId/pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const parsed = insertProcessStepPdcaSchema.safeParse({
        ...req.body,
        stepId: req.params.stepId,
        createdById: req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createProcessStepPdcaItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating process step PDCA item:", error);
      res.status(500).json({ message: "Failed to create PDCA item" });
    }
  });

  app.patch("/api/process-step-pdca/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const pdcaItem = await storage.getProcessStepPdcaItem(req.params.id);
      if (!pdcaItem) return res.status(404).json({ message: "PDCA item not found" });
      if (!await assertProcessStepTenantAccess(req, res, pdcaItem.stepId)) return;
      const parsed = insertProcessStepPdcaSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateProcessStepPdcaItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "PDCA item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating process step PDCA item:", error);
      res.status(500).json({ message: "Failed to update PDCA item" });
    }
  });

  app.delete("/api/process-step-pdca/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const pdcaItem = await storage.getProcessStepPdcaItem(req.params.id);
      if (!pdcaItem) return res.status(404).json({ message: "PDCA item not found" });
      if (!await assertProcessStepTenantAccess(req, res, pdcaItem.stepId)) return;
      await storage.deleteProcessStepPdcaItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting process step PDCA item:", error);
      res.status(500).json({ message: "Failed to delete PDCA item" });
    }
  });

  // Processes routes
  app.get("/api/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.id)) return;
      const process = await storage.getProcess(req.params.id);
      res.json(process);
    } catch (error) {
      console.error("Error fetching process:", error);
      res.status(500).json({ message: "Failed to fetch process" });
    }
  });

  app.get("/api/projects/:projectId/processes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const processes = await storage.getProcesses(req.params.projectId);
      res.json(processes);
    } catch (error) {
      console.error("Error fetching processes:", error);
      res.status(500).json({ message: "Failed to fetch processes" });
    }
  });

  app.post("/api/projects/:projectId/processes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertProcessSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const process = await storage.createProcess(parsed.data);
      res.status(201).json(process);
    } catch (error) {
      console.error("Error creating process:", error);
      res.status(500).json({ message: "Failed to create process" });
    }
  });

  app.patch("/api/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.id)) return;
      const parsed = insertProcessSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const process = await storage.updateProcess(req.params.id, parsed.data);
      if (!process) {
        return res.status(404).json({ message: "Process not found" });
      }
      res.json(process);
    } catch (error) {
      console.error("Error updating process:", error);
      res.status(500).json({ message: "Failed to update process" });
    }
  });

  app.delete("/api/processes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.id)) return;
      await storage.deleteProcess(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting process:", error);
      res.status(500).json({ message: "Failed to delete process" });
    }
  });

  // Process Steps routes
  app.get("/api/processes/:processId/steps", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const steps = await storage.getProcessSteps(req.params.processId);
      res.json(steps);
    } catch (error) {
      console.error("Error fetching process steps:", error);
      res.status(500).json({ message: "Failed to fetch process steps" });
    }
  });

  app.post("/api/processes/:processId/steps", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const parsed = insertProcessStepSchema.safeParse({
        ...req.body,
        processId: req.params.processId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const step = await storage.createProcessStep(parsed.data);
      res.status(201).json(step);
    } catch (error) {
      console.error("Error creating process step:", error);
      res.status(500).json({ message: "Failed to create process step" });
    }
  });

  app.patch("/api/process-steps/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const step = await storage.getProcessStep(req.params.id);
      if (!step) return res.status(404).json({ message: "Process step not found" });
      if (!await assertProcessTenantAccess(req, res, step.processId)) return;
      const parsed = insertProcessStepSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const updated = await storage.updateProcessStep(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "Process step not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating process step:", error);
      res.status(500).json({ message: "Failed to update process step" });
    }
  });

  app.delete("/api/process-steps/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const step = await storage.getProcessStep(req.params.id);
      if (!step) return res.status(404).json({ message: "Process step not found" });
      if (!await assertProcessTenantAccess(req, res, step.processId)) return;
      await storage.deleteProcessStep(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting process step:", error);
      res.status(500).json({ message: "Failed to delete process step" });
    }
  });

  // Process Diagram routes
  app.get("/api/processes/:processId/diagram", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const diagram = await storage.getProcessDiagram(req.params.processId);
      if (!diagram) {
        return res.json({ processId: req.params.processId, nodes: [], edges: [] });
      }
      res.json(diagram);
    } catch (error) {
      console.error("Error fetching process diagram:", error);
      res.status(500).json({ message: "Failed to fetch process diagram" });
    }
  });

  app.put("/api/processes/:processId/diagram", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const parsed = insertProcessDiagramSchema.safeParse({
        ...req.body,
        processId: req.params.processId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const diagram = await storage.upsertProcessDiagram(parsed.data);
      res.json(diagram);
    } catch (error) {
      console.error("Error saving process diagram:", error);
      res.status(500).json({ message: "Failed to save process diagram" });
    }
  });

  // Process Diagram Version routes (history)
  app.get("/api/processes/:processId/diagram/versions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const versions = await storage.getProcessDiagramVersions(req.params.processId);
      res.json(versions);
    } catch (error) {
      console.error("Error fetching diagram versions:", error);
      res.status(500).json({ message: "Failed to fetch diagram versions" });
    }
  });

  app.post("/api/processes/:processId/diagram/versions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const parsed = insertProcessDiagramVersionSchema.safeParse({
        ...req.body,
        processId: req.params.processId,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const version = await storage.createProcessDiagramVersion(parsed.data);
      res.status(201).json(version);
    } catch (error) {
      console.error("Error creating diagram version:", error);
      res.status(500).json({ message: "Failed to create diagram version" });
    }
  });

  // Create TO-BE variant from AS-IS process
  app.post("/api/processes/:processId/create-to-be", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const toBeProcess = await storage.createToBeVariant(req.params.processId);
      res.status(201).json(toBeProcess);
    } catch (error) {
      console.error("Error creating TO-BE variant:", error);
      res.status(500).json({ message: "Failed to create TO-BE variant" });
    }
  });

  // Get linked variant (AS-IS <-> TO-BE)
  app.get("/api/processes/:processId/linked-variant", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const linkedVariant = await storage.getLinkedVariant(req.params.processId);
      res.json(linkedVariant || null);
    } catch (error) {
      console.error("Error fetching linked variant:", error);
      res.status(500).json({ message: "Failed to fetch linked variant" });
    }
  });

  // Process Step Diagnostics routes (pain points & opportunities)
  app.get("/api/process-steps/:stepId/diagnostics", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const diagnostics = await storage.getProcessStepDiagnostics(req.params.stepId);
      res.json(diagnostics);
    } catch (error) {
      console.error("Error fetching step diagnostics:", error);
      res.status(500).json({ message: "Failed to fetch step diagnostics" });
    }
  });

  app.get("/api/processes/:processId/diagnostics", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const diagnostics = await storage.getProcessDiagnostics(req.params.processId);
      res.json(diagnostics);
    } catch (error) {
      console.error("Error fetching process diagnostics:", error);
      res.status(500).json({ message: "Failed to fetch process diagnostics" });
    }
  });

  app.post("/api/process-steps/:stepId/diagnostics", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const parsed = insertProcessStepDiagnosticSchema.safeParse({
        ...req.body,
        stepId: req.params.stepId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const diagnostic = await storage.createProcessStepDiagnostic(parsed.data);
      res.status(201).json(diagnostic);
    } catch (error) {
      console.error("Error creating step diagnostic:", error);
      res.status(500).json({ message: "Failed to create step diagnostic" });
    }
  });

  app.patch("/api/diagnostics/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertDiagnosticTenantAccess(req, res, req.params.id)) return;
      const parsed = insertProcessStepDiagnosticSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const diagnostic = await storage.updateProcessStepDiagnostic(req.params.id, parsed.data);
      if (!diagnostic) {
        return res.status(404).json({ message: "Diagnostic not found" });
      }
      res.json(diagnostic);
    } catch (error) {
      console.error("Error updating diagnostic:", error);
      res.status(500).json({ message: "Failed to update diagnostic" });
    }
  });

  app.delete("/api/diagnostics/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertDiagnosticTenantAccess(req, res, req.params.id)) return;
      await storage.deleteProcessStepDiagnostic(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting diagnostic:", error);
      res.status(500).json({ message: "Failed to delete diagnostic" });
    }
  });

  // Process Recommendations routes
  app.get("/api/processes/:processId/recommendations", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const recommendations = await storage.getProcessRecommendations(req.params.processId);
      res.json(recommendations);
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  app.post("/api/processes/:processId/recommendations", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const parsed = insertProcessRecommendationSchema.safeParse({
        ...req.body,
        processId: req.params.processId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const recommendation = await storage.createProcessRecommendation(parsed.data);
      res.status(201).json(recommendation);
    } catch (error) {
      console.error("Error creating recommendation:", error);
      res.status(500).json({ message: "Failed to create recommendation" });
    }
  });

  app.patch("/api/recommendations/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertRecommendationTenantAccess(req, res, req.params.id)) return;
      const parsed = insertProcessRecommendationSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const recommendation = await storage.updateProcessRecommendation(req.params.id, parsed.data);
      if (!recommendation) {
        return res.status(404).json({ message: "Recommendation not found" });
      }
      res.json(recommendation);
    } catch (error) {
      console.error("Error updating recommendation:", error);
      res.status(500).json({ message: "Failed to update recommendation" });
    }
  });

  app.delete("/api/recommendations/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertRecommendationTenantAccess(req, res, req.params.id)) return;
      await storage.deleteProcessRecommendation(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting recommendation:", error);
      res.status(500).json({ message: "Failed to delete recommendation" });
    }
  });

  // Process KPIs routes
  app.get("/api/processes/:processId/kpis", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const kpis = await storage.getProcessKpis(req.params.processId);
      res.json(kpis);
    } catch (error) {
      console.error("Error fetching KPIs:", error);
      res.status(500).json({ message: "Failed to fetch KPIs" });
    }
  });

  app.post("/api/processes/:processId/kpis", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessTenantAccess(req, res, req.params.processId)) return;
      const parsed = insertProcessKpiSchema.safeParse({
        ...req.body,
        processId: req.params.processId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const kpi = await storage.createProcessKpi(parsed.data);
      res.status(201).json(kpi);
    } catch (error) {
      console.error("Error creating KPI:", error);
      res.status(500).json({ message: "Failed to create KPI" });
    }
  });

  app.patch("/api/kpis/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertKpiTenantAccess(req, res, req.params.id)) return;
      const parsed = insertProcessKpiSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const kpi = await storage.updateProcessKpi(req.params.id, parsed.data);
      if (!kpi) {
        return res.status(404).json({ message: "KPI not found" });
      }
      res.json(kpi);
    } catch (error) {
      console.error("Error updating KPI:", error);
      res.status(500).json({ message: "Failed to update KPI" });
    }
  });

  app.delete("/api/kpis/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertKpiTenantAccess(req, res, req.params.id)) return;
      await storage.deleteProcessKpi(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting KPI:", error);
      res.status(500).json({ message: "Failed to delete KPI" });
    }
  });

  // Process Step System mappings routes (ERP/CRM)
  app.get("/api/process-steps/:stepId/systems", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const systems = await storage.getProcessStepSystems(req.params.stepId);
      res.json(systems);
    } catch (error) {
      console.error("Error fetching step systems:", error);
      res.status(500).json({ message: "Failed to fetch step systems" });
    }
  });

  app.post("/api/process-steps/:stepId/systems", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const parsed = insertProcessStepSystemSchema.safeParse({
        ...req.body,
        stepId: req.params.stepId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const system = await storage.createProcessStepSystem(parsed.data);
      res.status(201).json(system);
    } catch (error) {
      console.error("Error creating step system:", error);
      res.status(500).json({ message: "Failed to create step system" });
    }
  });

  app.delete("/api/step-systems/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // step-system delete: look up step system to find stepId for tenant check
      const system = await storage.getProcessStepSystem(req.params.id);
      if (!system) return res.status(404).json({ message: "Step system not found" });
      if (!await assertProcessStepTenantAccess(req, res, system.stepId)) return;
      await storage.deleteProcessStepSystem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting step system:", error);
      res.status(500).json({ message: "Failed to delete step system" });
    }
  });

  // Reusable Recommendations Library routes
  app.get("/api/reusable-recommendations", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const recommendations = await storage.getAllReusableRecommendations();
      res.json(recommendations);
    } catch (error) {
      console.error("Error fetching reusable recommendations:", error);
      res.status(500).json({ message: "Failed to fetch reusable recommendations" });
    }
  });

  app.post("/api/reusable-recommendations", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertReusableRecommendationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const recommendation = await storage.createReusableRecommendation(parsed.data);
      res.status(201).json(recommendation);
    } catch (error) {
      console.error("Error creating reusable recommendation:", error);
      res.status(500).json({ message: "Failed to create reusable recommendation" });
    }
  });

  app.patch("/api/reusable-recommendations/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertReusableRecommendationSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const recommendation = await storage.updateReusableRecommendation(req.params.id, parsed.data);
      if (!recommendation) {
        return res.status(404).json({ message: "Reusable recommendation not found" });
      }
      res.json(recommendation);
    } catch (error) {
      console.error("Error updating reusable recommendation:", error);
      res.status(500).json({ message: "Failed to update reusable recommendation" });
    }
  });

  app.delete("/api/reusable-recommendations/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteReusableRecommendation(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting reusable recommendation:", error);
      res.status(500).json({ message: "Failed to delete reusable recommendation" });
    }
  });

  // Process Templates routes
  app.get("/api/process-templates", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const templates = await storage.getAllProcessTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching process templates:", error);
      res.status(500).json({ message: "Failed to fetch process templates" });
    }
  });

  app.get("/api/process-templates/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const template = await storage.getProcessTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Process template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error fetching process template:", error);
      res.status(500).json({ message: "Failed to fetch process template" });
    }
  });

  app.post("/api/process-templates", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertProcessTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const template = await storage.createProcessTemplate(parsed.data);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating process template:", error);
      res.status(500).json({ message: "Failed to create process template" });
    }
  });

  app.patch("/api/process-templates/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertProcessTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const template = await storage.updateProcessTemplate(req.params.id, parsed.data);
      if (!template) {
        return res.status(404).json({ message: "Process template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error updating process template:", error);
      res.status(500).json({ message: "Failed to update process template" });
    }
  });

  app.delete("/api/process-templates/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteProcessTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting process template:", error);
      res.status(500).json({ message: "Failed to delete process template" });
    }
  });

  // Deliverables routes
  app.get("/api/projects/:projectId/deliverables", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const deliverables = await storage.getDeliverables(req.params.projectId);
      res.json(deliverables);
    } catch (error) {
      console.error("Error fetching deliverables:", error);
      res.status(500).json({ message: "Failed to fetch deliverables" });
    }
  });

  app.post("/api/projects/:projectId/deliverables", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertDeliverableSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        createdById: getAuthUserId(req),
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const deliverable = await storage.createDeliverable(parsed.data);
      res.status(201).json(deliverable);
    } catch (error) {
      console.error("Error creating deliverable:", error);
      res.status(500).json({ message: "Failed to create deliverable" });
    }
  });

  app.patch("/api/deliverables/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertDeliverableTenantAccess(req, res, req.params.id)) return;
      const parsed = insertDeliverableSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const deliverable = await storage.updateDeliverable(req.params.id, parsed.data);
      if (!deliverable) {
        return res.status(404).json({ message: "Deliverable not found" });
      }
      res.json(deliverable);
    } catch (error) {
      console.error("Error updating deliverable:", error);
      res.status(500).json({ message: "Failed to update deliverable" });
    }
  });

  app.delete("/api/deliverables/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertDeliverableTenantAccess(req, res, req.params.id)) return;
      await storage.deleteDeliverable(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting deliverable:", error);
      res.status(500).json({ message: "Failed to delete deliverable" });
    }
  });

  // Tasks routes
  app.get("/api/tasks", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const tasks = await storage.getAllTasks(tenantId, { allowGlobal: req.isSuperadmin });
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching all tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/projects/:projectId/tasks", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const tasks = await storage.getTasks(req.params.projectId);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.post("/api/projects/:projectId/tasks", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertTaskSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const task = await storage.createTask(parsed.data);
      res.status(201).json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertTaskTenantAccess(req, res, req.params.id)) return;
      const parsed = insertTaskSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const task = await storage.updateTask(req.params.id, parsed.data);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertTaskTenantAccess(req, res, req.params.id)) return;
      await storage.deleteTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Process Step Files routes
  app.get("/api/process-steps/:stepId/files", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const files = await storage.getProcessStepFiles(req.params.stepId);
      res.json(files);
    } catch (error) {
      console.error("Error fetching process step files:", error);
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const storageKey = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ url: uploadURL, storageKey });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/process-steps/:stepId/files", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProcessStepTenantAccess(req, res, req.params.stepId)) return;
      const parsed = insertProcessStepFileSchema.safeParse({
        stepId: req.params.stepId,
        fileName: req.body.fileName,
        fileType: req.body.fileType,
        fileSize: req.body.fileSize,
        storageKey: req.body.storageKey,
        uploadedById: getAuthUserId(req),
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const file = await storage.createProcessStepFile(parsed.data);
      res.status(201).json(file);
    } catch (error) {
      console.error("Error creating process step file:", error);
      res.status(500).json({ message: "Failed to create file" });
    }
  });

  app.get("/objects/:objectPath(*)", isAuthenticated, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error downloading object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.delete("/api/process-step-files/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existingFile = await storage.getProcessStepFile(req.params.id);
      if (!existingFile) {
        return res.status(404).json({ message: "File not found" });
      }
      if (!await assertProcessStepTenantAccess(req, res, existingFile.stepId)) return;
      const file = await storage.deleteProcessStepFile(req.params.id);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObject(file.storageKey);
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting process step file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // ERP Adherence Requirements routes
  app.get("/api/projects/:projectId/erp-requirements", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const requirements = await storage.getErpRequirements(req.params.projectId);
      res.json(requirements);
    } catch (error) {
      console.error("Error fetching ERP requirements:", error);
      res.status(500).json({ message: "Failed to fetch ERP requirements" });
    }
  });

  app.post("/api/projects/:projectId/erp-requirements", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertErpRequirementSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const requirement = await storage.createErpRequirement(parsed.data);
      res.status(201).json(requirement);
    } catch (error) {
      console.error("Error creating ERP requirement:", error);
      res.status(500).json({ message: "Failed to create ERP requirement" });
    }
  });

  app.get("/api/erp-requirements/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.id)) return;
      const requirement = await storage.getErpRequirement(req.params.id);
      res.json(requirement);
    } catch (error) {
      console.error("Error fetching ERP requirement:", error);
      res.status(500).json({ message: "Failed to fetch ERP requirement" });
    }
  });

  app.patch("/api/erp-requirements/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.id)) return;
      const parsed = insertErpRequirementSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const requirement = await storage.updateErpRequirement(req.params.id, parsed.data);
      if (!requirement) {
        return res.status(404).json({ message: "ERP requirement not found" });
      }
      res.json(requirement);
    } catch (error) {
      console.error("Error updating ERP requirement:", error);
      res.status(500).json({ message: "Failed to update ERP requirement" });
    }
  });

  app.delete("/api/erp-requirements/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.id)) return;
      await storage.deleteErpRequirement(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting ERP requirement:", error);
      res.status(500).json({ message: "Failed to delete ERP requirement" });
    }
  });

  // ERP Requirement Attachments routes
  app.get("/api/erp-requirements/:requirementId/attachments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.requirementId)) return;
      const attachments = await storage.getErpRequirementAttachments(req.params.requirementId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching ERP requirement attachments:", error);
      res.status(500).json({ message: "Failed to fetch attachments" });
    }
  });

  app.post("/api/erp-requirements/:requirementId/attachments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.requirementId)) return;
      const parsed = insertErpRequirementAttachmentSchema.safeParse({
        ...req.body,
        requirementId: req.params.requirementId,
        uploadedById: req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const attachment = await storage.createErpRequirementAttachment(parsed.data);
      res.status(201).json(attachment);
    } catch (error) {
      console.error("Error creating ERP requirement attachment:", error);
      res.status(500).json({ message: "Failed to create attachment" });
    }
  });

  app.delete("/api/erp-attachments/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpAttachmentTenantAccess(req, res, req.params.id)) return;
      await storage.deleteErpRequirementAttachment(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting ERP requirement attachment:", error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // ERP Parameterization Topics routes
  app.get("/api/projects/:projectId/erp-topics", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const topics = await storage.getErpParameterizationTopics(req.params.projectId);
      res.json(topics);
    } catch (error) {
      console.error("Error fetching ERP parameterization topics:", error);
      res.status(500).json({ message: "Failed to fetch topics" });
    }
  });

  app.post("/api/projects/:projectId/erp-topics", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertErpParameterizationTopicSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const topic = await storage.createErpParameterizationTopic(parsed.data);
      res.status(201).json(topic);
    } catch (error) {
      console.error("Error creating ERP parameterization topic:", error);
      res.status(500).json({ message: "Failed to create topic" });
    }
  });

  app.patch("/api/erp-topics/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpTopicTenantAccess(req, res, req.params.id)) return;
      const parsed = insertErpParameterizationTopicSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const topic = await storage.updateErpParameterizationTopic(req.params.id, parsed.data);
      if (!topic) {
        return res.status(404).json({ message: "Topic not found" });
      }
      res.json(topic);
    } catch (error) {
      console.error("Error updating ERP parameterization topic:", error);
      res.status(500).json({ message: "Failed to update topic" });
    }
  });

  app.delete("/api/erp-topics/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpTopicTenantAccess(req, res, req.params.id)) return;
      await storage.deleteErpParameterizationTopic(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting ERP parameterization topic:", error);
      res.status(500).json({ message: "Failed to delete topic" });
    }
  });

  // ERP Parameterization Items routes
  app.get("/api/erp-topics/:topicId/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpTopicTenantAccess(req, res, req.params.topicId)) return;
      const items = await storage.getErpParameterizationItems(req.params.topicId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching ERP parameterization items:", error);
      res.status(500).json({ message: "Failed to fetch items" });
    }
  });

  app.post("/api/erp-topics/:topicId/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpTopicTenantAccess(req, res, req.params.topicId)) return;
      const parsed = insertErpParameterizationItemSchema.safeParse({
        ...req.body,
        topicId: req.params.topicId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createErpParameterizationItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating ERP parameterization item:", error);
      res.status(500).json({ message: "Failed to create item" });
    }
  });

  app.patch("/api/erp-items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpItemTenantAccess(req, res, req.params.id)) return;
      const updateData: any = { ...req.body };
      if (req.body.isCompleted === 1 && !req.body.completedAt) {
        updateData.completedAt = new Date();
        updateData.completedById = req.user?.claims?.sub;
      } else if (req.body.isCompleted === 0) {
        updateData.completedAt = null;
        updateData.completedById = null;
      }
      const parsed = insertErpParameterizationItemSchema.partial().safeParse(updateData);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateErpParameterizationItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "Item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating ERP parameterization item:", error);
      res.status(500).json({ message: "Failed to update item" });
    }
  });

  app.delete("/api/erp-items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpItemTenantAccess(req, res, req.params.id)) return;
      await storage.deleteErpParameterizationItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting ERP parameterization item:", error);
      res.status(500).json({ message: "Failed to delete item" });
    }
  });

  // File upload endpoint for ERP attachments (using object storage)
  app.post("/api/erp-attachments/upload", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { fileName, fileType, mimeType, fileSize, requirementId, fileData } = req.body;
      
      if (!fileName || !fileData || !requirementId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (!await assertErpRequirementTenantAccess(req, res, requirementId)) return;

      const objectStorage = new ObjectStorageService();
      const filePath = `.private/erp-attachments/${requirementId}/${Date.now()}-${fileName}`;
      
      const buffer = Buffer.from(fileData, 'base64');
      await objectStorage.upload(filePath, buffer, mimeType || 'application/octet-stream');
      
      const signedUrl = await objectStorage.getSignedUrl(filePath, 3600);
      
      const attachment = await storage.createErpRequirementAttachment({
        requirementId,
        fileName,
        fileType: fileType || 'other',
        fileUrl: filePath,
        fileSize: fileSize || buffer.length,
        mimeType: mimeType || 'application/octet-stream',
        uploadedById: req.user?.claims?.sub,
      });

      res.status(201).json({ ...attachment, signedUrl });
    } catch (error) {
      console.error("Error uploading ERP attachment:", error);
      res.status(500).json({ message: "Failed to upload attachment" });
    }
  });

  // Get all attachments for a project (for reports)
  app.get("/api/projects/:id/all-attachments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.id)) return;
      const projectId = req.params.id;
      const requirements = await storage.getErpRequirements(projectId);
      const objectStorage = new ObjectStorageService();
      
      const allAttachments: any[] = [];
      
      for (const req of requirements) {
        const attachments = await storage.getErpRequirementAttachments(req.id);
        for (const attachment of attachments) {
          try {
            const signedUrl = await objectStorage.getSignedUrl(attachment.fileUrl, 3600);
            allAttachments.push({ ...attachment, signedUrl, requirementName: req.requirement });
          } catch (error) {
            allAttachments.push({ ...attachment, signedUrl: null, requirementName: req.requirement });
          }
        }
      }
      
      res.json(allAttachments);
    } catch (error) {
      console.error("Error getting project attachments:", error);
      res.status(500).json({ message: "Failed to get project attachments" });
    }
  });

  // Get signed URL for viewing attachment
  app.get("/api/erp-attachments/:id/view", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpRequirementTenantAccess(req, res, req.params.id)) return;
      const attachments = await storage.getErpRequirementAttachments(req.params.id);
      const objectStorage = new ObjectStorageService();
      
      const attachmentsWithUrls = await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const signedUrl = await objectStorage.getSignedUrl(attachment.fileUrl, 3600);
            return { ...attachment, signedUrl };
          } catch (error) {
            return { ...attachment, signedUrl: null };
          }
        })
      );
      
      res.json(attachmentsWithUrls);
    } catch (error) {
      console.error("Error getting attachment URLs:", error);
      res.status(500).json({ message: "Failed to get attachment URLs" });
    }
  });

  // Get single attachment signed URL
  app.get("/api/erp-attachment/:attachmentId/signed-url", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertErpAttachmentTenantAccess(req, res, req.params.attachmentId)) return;
      const objectStorage = new ObjectStorageService();
      const { fileUrl } = req.query;
      
      if (!fileUrl || typeof fileUrl !== 'string') {
        return res.status(400).json({ message: "File URL required" });
      }
      
      const signedUrl = await objectStorage.getSignedUrl(fileUrl, 3600);
      res.json({ signedUrl });
    } catch (error) {
      console.error("Error getting signed URL:", error);
      res.status(500).json({ message: "Failed to get signed URL" });
    }
  });

  // Help Articles routes
  app.get("/api/help", async (req, res) => {
    try {
      const articles = await storage.getAllHelpArticles();
      res.json(articles);
    } catch (error) {
      console.error("Error fetching help articles:", error);
      res.status(500).json({ message: "Failed to fetch help articles" });
    }
  });

  app.get("/api/help/search", async (req, res) => {
    try {
      const query = req.query.q as string || "";
      if (!query) {
        const articles = await storage.getAllHelpArticles();
        return res.json(articles);
      }
      const articles = await storage.searchHelpArticles(query);
      res.json(articles);
    } catch (error) {
      console.error("Error searching help articles:", error);
      res.status(500).json({ message: "Failed to search help articles" });
    }
  });

  app.get("/api/help/category/:category", async (req, res) => {
    try {
      const articles = await storage.getHelpArticlesByCategory(req.params.category);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching help articles by category:", error);
      res.status(500).json({ message: "Failed to fetch help articles" });
    }
  });

  app.get("/api/help/module/:moduleKey", async (req, res) => {
    try {
      const articles = await storage.getHelpArticlesByModule(req.params.moduleKey);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching help articles by module:", error);
      res.status(500).json({ message: "Failed to fetch help articles" });
    }
  });

  app.get("/api/help/slug/:slug", async (req, res) => {
    try {
      const article = await storage.getHelpArticleBySlug(req.params.slug);
      if (!article) {
        return res.status(404).json({ message: "Help article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error fetching help article:", error);
      res.status(500).json({ message: "Failed to fetch help article" });
    }
  });

  app.get("/api/help/:id", async (req, res) => {
    try {
      const article = await storage.getHelpArticle(req.params.id);
      if (!article) {
        return res.status(404).json({ message: "Help article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error fetching help article:", error);
      res.status(500).json({ message: "Failed to fetch help article" });
    }
  });

  app.post("/api/help", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const article = await storage.createHelpArticle({
        ...req.body,
        createdById: getAuthUserId(req),
      });
      res.status(201).json(article);
    } catch (error) {
      console.error("Error creating help article:", error);
      res.status(500).json({ message: "Failed to create help article" });
    }
  });

  app.patch("/api/help/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const article = await storage.updateHelpArticle(req.params.id, req.body);
      if (!article) {
        return res.status(404).json({ message: "Help article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error updating help article:", error);
      res.status(500).json({ message: "Failed to update help article" });
    }
  });

  app.delete("/api/help/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteHelpArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting help article:", error);
      res.status(500).json({ message: "Failed to delete help article" });
    }
  });

  // SWOT Analysis routes
  app.get("/api/projects/:projectId/swot", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const analyses = await storage.getSwotAnalysesByProject(req.params.projectId);
      res.json(analyses);
    } catch (error) {
      console.error("Error fetching SWOT analyses:", error);
      res.status(500).json({ message: "Failed to fetch SWOT analyses" });
    }
  });

  app.get("/api/swot/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotTenantAccess(req, res, req.params.id)) return;
      const analysis = await storage.getSwotAnalysis(req.params.id);
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching SWOT analysis:", error);
      res.status(500).json({ message: "Failed to fetch SWOT analysis" });
    }
  });

  app.post("/api/projects/:projectId/swot", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertSwotAnalysisSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        createdById: getAuthUserId(req),
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const analysis = await storage.createSwotAnalysis(parsed.data);
      res.status(201).json(analysis);
    } catch (error) {
      console.error("Error creating SWOT analysis:", error);
      res.status(500).json({ message: "Failed to create SWOT analysis" });
    }
  });

  app.patch("/api/swot/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotTenantAccess(req, res, req.params.id)) return;
      const parsed = insertSwotAnalysisSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const analysis = await storage.updateSwotAnalysis(req.params.id, parsed.data);
      if (!analysis) {
        return res.status(404).json({ message: "SWOT analysis not found" });
      }
      res.json(analysis);
    } catch (error) {
      console.error("Error updating SWOT analysis:", error);
      res.status(500).json({ message: "Failed to update SWOT analysis" });
    }
  });

  app.delete("/api/swot/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotTenantAccess(req, res, req.params.id)) return;
      await storage.deleteSwotAnalysis(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting SWOT analysis:", error);
      res.status(500).json({ message: "Failed to delete SWOT analysis" });
    }
  });

  // SWOT Items routes
  app.get("/api/swot/:analysisId/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotTenantAccess(req, res, req.params.analysisId)) return;
      const items = await storage.getSwotItems(req.params.analysisId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching SWOT items:", error);
      res.status(500).json({ message: "Failed to fetch SWOT items" });
    }
  });

  app.get("/api/swot-items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotItemTenantAccess(req, res, req.params.id)) return;
      const item = await storage.getSwotItem(req.params.id);
      res.json(item);
    } catch (error) {
      console.error("Error fetching SWOT item:", error);
      res.status(500).json({ message: "Failed to fetch SWOT item" });
    }
  });

  app.post("/api/swot/:analysisId/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotTenantAccess(req, res, req.params.analysisId)) return;
      const parsed = insertSwotItemSchema.safeParse({
        ...req.body,
        analysisId: req.params.analysisId,
        createdById: req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createSwotItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating SWOT item:", error);
      res.status(500).json({ message: "Failed to create SWOT item" });
    }
  });

  app.patch("/api/swot-items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotItemTenantAccess(req, res, req.params.id)) return;
      const parsed = insertSwotItemSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateSwotItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "SWOT item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating SWOT item:", error);
      res.status(500).json({ message: "Failed to update SWOT item" });
    }
  });

  app.delete("/api/swot-items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertSwotItemTenantAccess(req, res, req.params.id)) return;
      await storage.deleteSwotItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting SWOT item:", error);
      res.status(500).json({ message: "Failed to delete SWOT item" });
    }
  });

  // Get all SWOT items for a project (for PDCA integration)
  app.get("/api/projects/:projectId/swot-pdca", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const items = await storage.getSwotItemsByProject(req.params.projectId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching SWOT PDCA items:", error);
      res.status(500).json({ message: "Failed to fetch SWOT PDCA items" });
    }
  });

  // Report Configuration routes
  app.get("/api/projects/:projectId/reports", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const configs = await storage.getReportConfigurations(req.params.projectId);
      res.json(configs);
    } catch (error) {
      console.error("Error fetching report configurations:", error);
      res.status(500).json({ message: "Failed to fetch report configurations" });
    }
  });

  app.get("/api/reports/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertReportTenantAccess(req, res, req.params.id)) return;
      const config = await storage.getReportConfiguration(req.params.id);
      res.json(config);
    } catch (error) {
      console.error("Error fetching report configuration:", error);
      res.status(500).json({ message: "Failed to fetch report configuration" });
    }
  });

  app.post("/api/projects/:projectId/reports", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const parsed = insertReportConfigurationSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        createdById: getAuthUserId(req),
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const config = await storage.createReportConfiguration(parsed.data);
      res.status(201).json(config);
    } catch (error) {
      console.error("Error creating report configuration:", error);
      res.status(500).json({ message: "Failed to create report configuration" });
    }
  });

  app.patch("/api/reports/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertReportTenantAccess(req, res, req.params.id)) return;
      const parsed = insertReportConfigurationSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const config = await storage.updateReportConfiguration(req.params.id, parsed.data);
      if (!config) {
        return res.status(404).json({ message: "Report configuration not found" });
      }
      res.json(config);
    } catch (error) {
      console.error("Error updating report configuration:", error);
      res.status(500).json({ message: "Failed to update report configuration" });
    }
  });

  app.delete("/api/reports/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertReportTenantAccess(req, res, req.params.id)) return;
      await storage.deleteReportConfiguration(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting report configuration:", error);
      res.status(500).json({ message: "Failed to delete report configuration" });
    }
  });

  // Report data aggregation endpoint (for preview and export)
  app.post("/api/projects/:projectId/reports/preview", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertProjectTenantAccess(req, res, req.params.projectId)) return;
      const { sections, filters } = req.body;
      const projectId = req.params.projectId;
      
      const project = await storage.getProject(projectId);
      const client = project?.clientId ? await storage.getClient(project.clientId) : null;
      
      const reportData: Record<string, any> = {
        project,
        client,
        generatedAt: new Date().toISOString(),
      };

      // Aggregate data based on selected sections
      if (sections?.includes('canvas')) {
        const canvasBlocks = await storage.getCanvasBlocks(projectId);
        const atualBlocks = canvasBlocks.filter(b => b.level === 'intencao');
        const canvasPdcaItems = await storage.getCanvasPdcaItems(projectId);
        reportData.canvas = {
          blocks: atualBlocks,
          pdcaItems: canvasPdcaItems,
          level: 'atual',
        };
      }
      
      if (sections?.includes('canvas_sistemico')) {
        const canvasBlocks = await storage.getCanvasBlocks(projectId);
        const sistemicoBlocks = canvasBlocks.filter(b => b.level === 'sistemico');
        const canvasPdcaItems = await storage.getCanvasPdcaItems(projectId);
        reportData.canvasSistemico = {
          blocks: sistemicoBlocks,
          pdcaItems: canvasPdcaItems,
          level: 'sistemico',
        };
      }
      
      if (sections?.includes('swot')) {
        const analyses = await storage.getSwotAnalysesByProject(projectId);
        const swotData = [];
        for (const analysis of analyses) {
          const items = await storage.getSwotItems(analysis.id);
          swotData.push({ 
            analysis, 
            items,
            // Group items by type for easier rendering
            strengths: items.filter(i => i.type === 'strength'),
            weaknesses: items.filter(i => i.type === 'weakness'),
            opportunities: items.filter(i => i.type === 'opportunity'),
            threats: items.filter(i => i.type === 'threat'),
          });
        }
        reportData.swot = swotData;
      }
      
      if (sections?.includes('processes')) {
        const processes = await storage.getProcesses(projectId);
        const processesWithDetails = [];
        for (const process of processes) {
          const steps = await storage.getProcessSteps(process.id);
          const diagram = await storage.getProcessDiagram(process.id);
          processesWithDetails.push({
            process,
            steps,
            diagrams: diagram ? [diagram] : [],
          });
        }
        reportData.processes = processesWithDetails;
      }
      
      if (sections?.includes('pdca')) {
        // Consolidated PDCA from all sources
        const canvasPdca = await storage.getCanvasPdcaItems(projectId);
        const swotItems = await storage.getSwotItemsByProject(projectId);
        const erpRequirements = await storage.getErpRequirements(projectId);
        
        reportData.pdca = {
          canvas: canvasPdca,
          swot: swotItems.filter(item => item.pdcaStatus && item.pdcaStatus !== 'plan'),
          erp: erpRequirements.filter(req => req.pdcaStatus && req.pdcaStatus !== 'plan'),
          summary: {
            total: canvasPdca.length + swotItems.length + erpRequirements.length,
            byStatus: {
              plan: canvasPdca.filter(i => i.status === 'plan').length + 
                    swotItems.filter(i => i.pdcaStatus === 'plan').length +
                    erpRequirements.filter(i => i.pdcaStatus === 'plan').length,
              do: canvasPdca.filter(i => i.status === 'do').length + 
                  swotItems.filter(i => i.pdcaStatus === 'do').length +
                  erpRequirements.filter(i => i.pdcaStatus === 'do').length,
              check: canvasPdca.filter(i => i.status === 'check').length + 
                     swotItems.filter(i => i.pdcaStatus === 'check').length +
                     erpRequirements.filter(i => i.pdcaStatus === 'check').length,
              act: canvasPdca.filter(i => i.status === 'act').length + 
                   swotItems.filter(i => i.pdcaStatus === 'act').length +
                   erpRequirements.filter(i => i.pdcaStatus === 'act').length,
              done: canvasPdca.filter(i => i.status === 'done').length + 
                    swotItems.filter(i => i.pdcaStatus === 'done').length +
                    erpRequirements.filter(i => i.pdcaStatus === 'done').length,
            }
          }
        };
      }
      
      if (sections?.includes('deliverables')) {
        reportData.deliverables = await storage.getDeliverables(projectId);
      }
      
      if (sections?.includes('tasks')) {
        reportData.tasks = await storage.getTasks(projectId);
      }
      
      if (sections?.includes('erp')) {
        const erpRequirements = await storage.getErpRequirements(projectId);
        // Group by module for better organization
        const byModule: Record<string, typeof erpRequirements> = {};
        for (const req of erpRequirements) {
          const module = req.erpModule || 'Geral';
          if (!byModule[module]) byModule[module] = [];
          byModule[module].push(req);
        }
        reportData.erpRequirements = {
          all: erpRequirements,
          byModule,
          summary: {
            total: erpRequirements.length,
            byStatus: {
              nativo: erpRequirements.filter(r => r.adherenceStatus === 'nativo').length,
              configuravel: erpRequirements.filter(r => r.adherenceStatus === 'configuravel').length,
              customizavel: erpRequirements.filter(r => r.adherenceStatus === 'customizavel').length,
              nao_atendido: erpRequirements.filter(r => r.adherenceStatus === 'nao_atendido').length,
            }
          }
        };
      }

      res.json(reportData);
    } catch (error) {
      console.error("Error generating report preview:", error);
      res.status(500).json({ message: "Failed to generate report preview" });
    }
  });

  // ===== CRM API Routes =====

  // Pipeline Stages
  app.get("/api/crm/pipeline-stages", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const stages = await storage.getAllCrmPipelineStages();
      res.json(stages);
    } catch (error) {
      console.error("Error fetching pipeline stages:", error);
      res.status(500).json({ message: "Failed to fetch pipeline stages" });
    }
  });

  app.post("/api/crm/pipeline-stages", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmPipelineStageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const stage = await storage.createCrmPipelineStage(parsed.data);
      res.status(201).json(stage);
    } catch (error) {
      console.error("Error creating pipeline stage:", error);
      res.status(500).json({ message: "Failed to create pipeline stage" });
    }
  });

  app.patch("/api/crm/pipeline-stages/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmPipelineStageSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const stage = await storage.updateCrmPipelineStage(req.params.id, parsed.data);
      if (!stage) {
        return res.status(404).json({ message: "Pipeline stage not found" });
      }
      res.json(stage);
    } catch (error) {
      console.error("Error updating pipeline stage:", error);
      res.status(500).json({ message: "Failed to update pipeline stage" });
    }
  });

  app.delete("/api/crm/pipeline-stages/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCrmPipelineStage(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting pipeline stage:", error);
      res.status(500).json({ message: "Failed to delete pipeline stage" });
    }
  });

  // CRM Leads
  app.get("/api/crm/leads", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const leads = await storage.getAllCrmLeads(tenantId, { allowGlobal: req.isSuperadmin });
      res.json(leads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.get("/api/crm/leads/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const lead = await storage.getCrmLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (!checkTenantAccess(req, lead)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(lead);
    } catch (error) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  app.post("/api/crm/leads", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertCrmLeadSchema.safeParse({
        ...req.body,
        assignedToId: req.body.assignedToId || req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const tenantId = req.isSuperadmin ? (parsed.data.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
      const lead = await storage.createCrmLead({ ...parsed.data, tenantId });
      res.status(201).json(lead);
    } catch (error) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  app.patch("/api/crm/leads/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getCrmLead(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertCrmLeadSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const { tenantId: _ignoredLeadTenantId, ...updateData } = parsed.data;
      const lead = await storage.updateCrmLead(req.params.id, updateData);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json(lead);
    } catch (error) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  app.delete("/api/crm/leads/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getCrmLead(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteCrmLead(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ message: "Failed to delete lead" });
    }
  });

  // Convert lead to client
  app.post("/api/crm/leads/:id/convert", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const lead = await storage.getCrmLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      if (!lead.tenantId) {
        return res.status(400).json({ message: "Lead has no tenant" });
      }

      // Create client from lead data
      const client = await storage.createClient({
        tenantId: lead.tenantId,
        name: lead.company || lead.name,
        email: lead.email,
        phone: lead.phone,
        industry: lead.industry,
        notes: lead.notes,
      });
      
      // Update lead as converted
      await storage.updateCrmLead(req.params.id, {
        status: 'converted',
        convertedToClientId: client.id,
      });
      
      res.json({ client, message: "Lead converted to client successfully" });
    } catch (error) {
      console.error("Error converting lead:", error);
      res.status(500).json({ message: "Failed to convert lead" });
    }
  });

  // CRM Opportunities
  app.get("/api/crm/opportunities", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const opportunities = await storage.getAllCrmOpportunities(tenantId, { allowGlobal: req.isSuperadmin });
      res.json(opportunities);
    } catch (error) {
      console.error("Error fetching opportunities:", error);
      res.status(500).json({ message: "Failed to fetch opportunities" });
    }
  });

  app.get("/api/crm/opportunities/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const opportunity = await storage.getCrmOpportunity(req.params.id);
      if (!opportunity) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      if (!checkTenantAccess(req, opportunity)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(opportunity);
    } catch (error) {
      console.error("Error fetching opportunity:", error);
      res.status(500).json({ message: "Failed to fetch opportunity" });
    }
  });

  app.post("/api/crm/opportunities", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertCrmOpportunitySchema.safeParse({
        ...req.body,
        assignedToId: req.body.assignedToId || req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const tenantId = req.isSuperadmin ? (parsed.data.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null);
      const opportunity = await storage.createCrmOpportunity({ ...parsed.data, tenantId });
      res.status(201).json(opportunity);
    } catch (error) {
      console.error("Error creating opportunity:", error);
      res.status(500).json({ message: "Failed to create opportunity" });
    }
  });

  app.patch("/api/crm/opportunities/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getCrmOpportunity(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertCrmOpportunitySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const { tenantId: _ignoredOpportunityTenantId, ...updateData } = parsed.data;
      const opportunity = await storage.updateCrmOpportunity(req.params.id, updateData);
      if (!opportunity) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      res.json(opportunity);
    } catch (error) {
      console.error("Error updating opportunity:", error);
      res.status(500).json({ message: "Failed to update opportunity" });
    }
  });

  app.delete("/api/crm/opportunities/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getCrmOpportunity(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      if (!checkTenantAccess(req, existing)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteCrmOpportunity(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting opportunity:", error);
      res.status(500).json({ message: "Failed to delete opportunity" });
    }
  });

  // Convert opportunity to project
  app.post("/api/crm/opportunities/:id/convert", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Verify tenant access before conversion
      if (!await assertCrmOpportunityTenantAccess(req, res, req.params.id)) return;

      const opportunity = await storage.getCrmOpportunity(req.params.id);
      if (!opportunity) {
        return res.status(404).json({ message: "Opportunity not found" });
      }
      
      if (!opportunity.clientId) {
        return res.status(400).json({ message: "Opportunity must have a client before converting to project" });
      }
      
      // Create project from opportunity data, propagating tenant context
      const project = await storage.createProject({
        name: opportunity.title,
        clientId: opportunity.clientId,
        description: opportunity.description,
        status: 'backlog',
        startDate: req.body.startDate || new Date().toISOString().split('T')[0],
        tenantId: req.isSuperadmin ? (opportunity.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      });
      
      // Update opportunity as won
      await storage.updateCrmOpportunity(req.params.id, {
        status: 'won',
        projectId: project.id,
      });
      
      res.json({ project, message: "Opportunity converted to project successfully" });
    } catch (error) {
      console.error("Error converting opportunity:", error);
      res.status(500).json({ message: "Failed to convert opportunity" });
    }
  });

  // CRM Activities
  app.get("/api/crm/activities", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const { leadId, opportunityId, clientId } = req.query;
      const activities = await storage.getCrmActivities({
        leadId: leadId as string,
        opportunityId: opportunityId as string,
        clientId: clientId as string,
      });
      res.json(activities);
    } catch (error) {
      console.error("Error fetching activities:", error);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  app.post("/api/crm/activities", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertCrmActivitySchema.safeParse({
        ...req.body,
        userId: req.body.userId || req.user?.claims?.sub,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const activity = await storage.createCrmActivity(parsed.data);
      res.status(201).json(activity);
    } catch (error) {
      console.error("Error creating activity:", error);
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  app.patch("/api/crm/activities/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmActivitySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const activity = await storage.updateCrmActivity(req.params.id, parsed.data);
      if (!activity) {
        return res.status(404).json({ message: "Activity not found" });
      }
      res.json(activity);
    } catch (error) {
      console.error("Error updating activity:", error);
      res.status(500).json({ message: "Failed to update activity" });
    }
  });

  app.delete("/api/crm/activities/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCrmActivity(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting activity:", error);
      res.status(500).json({ message: "Failed to delete activity" });
    }
  });

  // CRM Dashboard statistics
  app.get("/api/crm/stats", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.isSuperadmin ? null : req.tenantId;
      const leads = await storage.getAllCrmLeads(tenantId, { allowGlobal: req.isSuperadmin });
      const opportunities = await storage.getAllCrmOpportunities(tenantId, { allowGlobal: req.isSuperadmin });
      const stages = await storage.getAllCrmPipelineStages();
      
      const stats = {
        totalLeads: leads.length,
        leadsByStatus: leads.reduce((acc: Record<string, number>, lead) => {
          acc[lead.status] = (acc[lead.status] || 0) + 1;
          return acc;
        }, {}),
        totalOpportunities: opportunities.length,
        totalPipelineValue: opportunities.reduce((sum, opp) => sum + Number(opp.value || 0), 0),
        weightedPipelineValue: opportunities.reduce((sum, opp) => 
          sum + (Number(opp.value || 0) * (opp.probability || 0) / 100), 0
        ),
        opportunitiesByStage: opportunities.reduce((acc: Record<string, { count: number; value: number }>, opp) => {
          const stageId = opp.stageId || 'unassigned';
          if (!acc[stageId]) acc[stageId] = { count: 0, value: 0 };
          acc[stageId].count++;
          acc[stageId].value += Number(opp.value || 0);
          return acc;
        }, {}),
        stages,
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching CRM stats:", error);
      res.status(500).json({ message: "Failed to fetch CRM stats" });
    }
  });

  // Seed default pipeline stages if none exist
  app.post("/api/crm/pipeline-stages/seed", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const existingStages = await storage.getAllCrmPipelineStages();
      if (existingStages.length > 0) {
        return res.json({ message: "Pipeline stages already exist", stages: existingStages });
      }
      
      const defaultStages = [
        { name: 'Prospecção', color: '#6B7280', order: 1 },
        { name: 'Qualificação', color: '#3B82F6', order: 2 },
        { name: 'Proposta', color: '#F59E0B', order: 3 },
        { name: 'Negociação', color: '#8B5CF6', order: 4 },
        { name: 'Fechamento', color: '#10B981', order: 5 },
      ];
      
      const createdStages = [];
      for (const stage of defaultStages) {
        const created = await storage.createCrmPipelineStage(stage);
        createdStages.push(created);
      }
      
      res.status(201).json({ message: "Default pipeline stages created", stages: createdStages });
    } catch (error) {
      console.error("Error seeding pipeline stages:", error);
      res.status(500).json({ message: "Failed to seed pipeline stages" });
    }
  });

  // ============================================
  // SUPPORT & KNOWLEDGE BASE ROUTES
  // ============================================

  // Support Types routes
  app.get("/api/support/types", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const types = await storage.getSupportTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching support types:", error);
      res.status(500).json({ message: "Failed to fetch support types" });
    }
  });

  app.get("/api/support/types/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const type = await storage.getSupportType(req.params.id);
      if (!type) {
        return res.status(404).json({ message: "Support type not found" });
      }
      res.json(type);
    } catch (error) {
      console.error("Error fetching support type:", error);
      res.status(500).json({ message: "Failed to fetch support type" });
    }
  });

  app.post("/api/support/types", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertSupportTypeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const type = await storage.createSupportType(parsed.data);
      res.status(201).json(type);
    } catch (error) {
      console.error("Error creating support type:", error);
      res.status(500).json({ message: "Failed to create support type" });
    }
  });

  app.patch("/api/support/types/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertSupportTypeSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const type = await storage.updateSupportType(req.params.id, parsed.data);
      if (!type) {
        return res.status(404).json({ message: "Support type not found" });
      }
      res.json(type);
    } catch (error) {
      console.error("Error updating support type:", error);
      res.status(500).json({ message: "Failed to update support type" });
    }
  });

  app.delete("/api/support/types/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteSupportType(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting support type:", error);
      res.status(500).json({ message: "Failed to delete support type" });
    }
  });

  // Support Tickets routes
  app.get("/api/support/tickets", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.priority) filters.priority = req.query.priority as string;
      if (req.query.clientId) filters.clientId = req.query.clientId as string;
      if (req.query.assignedToId) filters.assignedToId = req.query.assignedToId as string;
      if (req.query.typeId) filters.typeId = req.query.typeId as string;
      
      const tickets = await storage.getSupportTickets(Object.keys(filters).length > 0 ? filters : undefined);
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ message: "Failed to fetch support tickets" });
    }
  });

  app.get("/api/support/tickets/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error) {
      console.error("Error fetching ticket:", error);
      res.status(500).json({ message: "Failed to fetch ticket" });
    }
  });

  app.post("/api/support/tickets", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertSupportTicketSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const ticket = await storage.createSupportTicket(parsed.data);
      res.status(201).json(ticket);
    } catch (error) {
      console.error("Error creating ticket:", error);
      res.status(500).json({ message: "Failed to create ticket" });
    }
  });

  app.patch("/api/support/tickets/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertSupportTicketSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const ticket = await storage.updateSupportTicket(req.params.id, parsed.data);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.json(ticket);
    } catch (error) {
      console.error("Error updating ticket:", error);
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  app.delete("/api/support/tickets/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteSupportTicket(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting ticket:", error);
      res.status(500).json({ message: "Failed to delete ticket" });
    }
  });

  // Ticket Comments routes
  app.get("/api/support/tickets/:ticketId/comments", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const comments = await storage.getTicketComments(req.params.ticketId);
      res.json(comments);
    } catch (error) {
      console.error("Error fetching ticket comments:", error);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  });

  app.post("/api/support/tickets/:ticketId/comments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertTicketCommentSchema.safeParse({
        ...req.body,
        ticketId: req.params.ticketId,
        userId: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const comment = await storage.createTicketComment(parsed.data);
      res.status(201).json(comment);
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

  app.delete("/api/support/tickets/:ticketId/comments/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteTicketComment(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  // Knowledge Base Categories routes
  app.get("/api/knowledge/categories", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const categories = await storage.getKnowledgeCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching knowledge categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.get("/api/knowledge/categories/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const category = await storage.getKnowledgeCategory(req.params.id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      console.error("Error fetching category:", error);
      res.status(500).json({ message: "Failed to fetch category" });
    }
  });

  app.post("/api/knowledge/categories", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertKnowledgeCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const category = await storage.createKnowledgeCategory(parsed.data);
      res.status(201).json(category);
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({ message: "Failed to create category" });
    }
  });

  app.patch("/api/knowledge/categories/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertKnowledgeCategorySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const category = await storage.updateKnowledgeCategory(req.params.id, parsed.data);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ message: "Failed to update category" });
    }
  });

  app.delete("/api/knowledge/categories/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteKnowledgeCategory(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Failed to delete category" });
    }
  });

  // Knowledge Base Articles routes
  app.get("/api/knowledge/articles", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.categoryId) filters.categoryId = req.query.categoryId as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.isPublic !== undefined) filters.isPublic = req.query.isPublic === 'true';
      
      const articles = await storage.getKnowledgeArticles(Object.keys(filters).length > 0 ? filters : undefined);
      res.json(articles);
    } catch (error) {
      console.error("Error fetching articles:", error);
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  app.get("/api/knowledge/articles/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const article = await storage.getKnowledgeArticle(req.params.id);
      if (!article) {
        return res.status(404).json({ message: "Article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error fetching article:", error);
      res.status(500).json({ message: "Failed to fetch article" });
    }
  });

  app.post("/api/knowledge/articles", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertKnowledgeArticleSchema.safeParse({
        ...req.body,
        authorId: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const article = await storage.createKnowledgeArticle(parsed.data);
      res.status(201).json(article);
    } catch (error) {
      console.error("Error creating article:", error);
      res.status(500).json({ message: "Failed to create article" });
    }
  });

  app.patch("/api/knowledge/articles/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertKnowledgeArticleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const article = await storage.updateKnowledgeArticle(req.params.id, parsed.data);
      if (!article) {
        return res.status(404).json({ message: "Article not found" });
      }
      res.json(article);
    } catch (error) {
      console.error("Error updating article:", error);
      res.status(500).json({ message: "Failed to update article" });
    }
  });

  app.delete("/api/knowledge/articles/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteKnowledgeArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting article:", error);
      res.status(500).json({ message: "Failed to delete article" });
    }
  });

  // Training Content routes
  app.get("/api/training", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.categoryId) filters.categoryId = req.query.categoryId as string;
      if (req.query.contentType) filters.contentType = req.query.contentType as string;
      if (req.query.status) filters.status = req.query.status as string;
      
      const contents = await storage.getTrainingContents(Object.keys(filters).length > 0 ? filters : undefined);
      res.json(contents);
    } catch (error) {
      console.error("Error fetching training contents:", error);
      res.status(500).json({ message: "Failed to fetch training contents" });
    }
  });

  app.get("/api/training/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const content = await storage.getTrainingContent(req.params.id);
      if (!content) {
        return res.status(404).json({ message: "Training content not found" });
      }
      res.json(content);
    } catch (error) {
      console.error("Error fetching training content:", error);
      res.status(500).json({ message: "Failed to fetch training content" });
    }
  });

  app.post("/api/training", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertTrainingContentSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const content = await storage.createTrainingContent(parsed.data);
      res.status(201).json(content);
    } catch (error) {
      console.error("Error creating training content:", error);
      res.status(500).json({ message: "Failed to create training content" });
    }
  });

  app.patch("/api/training/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertTrainingContentSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const content = await storage.updateTrainingContent(req.params.id, parsed.data);
      if (!content) {
        return res.status(404).json({ message: "Training content not found" });
      }
      res.json(content);
    } catch (error) {
      console.error("Error updating training content:", error);
      res.status(500).json({ message: "Failed to update training content" });
    }
  });

  app.delete("/api/training/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteTrainingContent(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting training content:", error);
      res.status(500).json({ message: "Failed to delete training content" });
    }
  });

  // Client Membership routes
  app.get("/api/client-memberships", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const memberships = await storage.getClientMemberships(clientId);
      res.json(memberships);
    } catch (error) {
      console.error("Error fetching client memberships:", error);
      res.status(500).json({ message: "Failed to fetch memberships" });
    }
  });

  app.get("/api/client-memberships/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const membership = await storage.getClientMembership(req.params.id);
      if (!membership) {
        return res.status(404).json({ message: "Membership not found" });
      }
      res.json(membership);
    } catch (error) {
      console.error("Error fetching membership:", error);
      res.status(500).json({ message: "Failed to fetch membership" });
    }
  });

  app.post("/api/client-memberships", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertClientMembershipSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const membership = await storage.createClientMembership(parsed.data);
      res.status(201).json(membership);
    } catch (error) {
      console.error("Error creating membership:", error);
      res.status(500).json({ message: "Failed to create membership" });
    }
  });

  app.patch("/api/client-memberships/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertClientMembershipSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const membership = await storage.updateClientMembership(req.params.id, parsed.data);
      if (!membership) {
        return res.status(404).json({ message: "Membership not found" });
      }
      res.json(membership);
    } catch (error) {
      console.error("Error updating membership:", error);
      res.status(500).json({ message: "Failed to update membership" });
    }
  });

  app.delete("/api/client-memberships/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteClientMembership(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting membership:", error);
      res.status(500).json({ message: "Failed to delete membership" });
    }
  });

  // Client Portal Access routes
  app.get("/api/portal/access/:clientContactId", isAuthenticated, async (req, res) => {
    try {
      const access = await storage.getClientPortalAccess(req.params.clientContactId);
      res.json(access);
    } catch (error) {
      console.error("Error fetching portal access:", error);
      res.status(500).json({ message: "Failed to fetch portal access" });
    }
  });

  app.post("/api/portal/access", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertClientPortalAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const access = await storage.createClientPortalAccess(parsed.data);
      res.status(201).json(access);
    } catch (error) {
      console.error("Error creating portal access:", error);
      res.status(500).json({ message: "Failed to create portal access" });
    }
  });

  app.patch("/api/portal/access/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertClientPortalAccessSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const access = await storage.updateClientPortalAccess(req.params.id, parsed.data);
      if (!access) {
        return res.status(404).json({ message: "Portal access not found" });
      }
      res.json(access);
    } catch (error) {
      console.error("Error updating portal access:", error);
      res.status(500).json({ message: "Failed to update portal access" });
    }
  });

  // Support Dashboard Statistics
  app.get("/api/support/stats", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const tickets = await storage.getSupportTickets();
      const types = await storage.getSupportTypes();
      
      const stats = {
        totalTickets: tickets.length,
        ticketsByStatus: tickets.reduce((acc: Record<string, number>, ticket) => {
          acc[ticket.status] = (acc[ticket.status] || 0) + 1;
          return acc;
        }, {}),
        ticketsByPriority: tickets.reduce((acc: Record<string, number>, ticket) => {
          acc[ticket.priority] = (acc[ticket.priority] || 0) + 1;
          return acc;
        }, {}),
        openTickets: tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length,
        resolvedTickets: tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length,
        types,
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Error fetching support stats:", error);
      res.status(500).json({ message: "Failed to fetch support stats" });
    }
  });

  // Client Portal API routes
  // Portal Dashboard - Get client's overview data
  app.get("/api/portal/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      const user = await storage.getUser(userId);
      
      // Get client's tickets
      const allTickets = await storage.getSupportTickets();
      const myTickets = allTickets.filter(t => t.reportedById === userId);
      
      // Get public articles
      const articles = await storage.getKnowledgeArticles();
      const publicArticles = articles.filter(a => a.status === 'published' && a.accessLevel === 'public');
      
      // Get active training content
      const trainings = await storage.getAllTrainingContent();
      const activeTrainings = trainings.filter(t => t.isActive === 1);
      
      res.json({
        user,
        ticketStats: {
          total: myTickets.length,
          open: myTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length,
          resolved: myTickets.filter(t => t.status === 'resolved' || t.status === 'closed').length,
        },
        recentTickets: myTickets.slice(0, 5),
        recentArticles: publicArticles.slice(0, 5),
        trainingCount: activeTrainings.length,
      });
    } catch (error) {
      console.error("Error fetching portal dashboard:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });

  // Portal Tickets - Get client's own tickets
  app.get("/api/portal/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      const allTickets = await storage.getSupportTickets();
      const myTickets = allTickets.filter(t => t.reportedById === userId);
      res.json(myTickets);
    } catch (error) {
      console.error("Error fetching portal tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  // Portal Create Ticket - Create a new support ticket
  app.post("/api/portal/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      const parsed = insertSupportTicketSchema.safeParse({
        ...req.body,
        reportedById: userId,
        status: 'open',
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const ticket = await storage.createSupportTicket(parsed.data);
      res.status(201).json(ticket);
    } catch (error) {
      console.error("Error creating portal ticket:", error);
      res.status(500).json({ message: "Failed to create ticket" });
    }
  });

  // Portal Articles - Get public articles only
  app.get("/api/portal/articles", isAuthenticated, async (req, res) => {
    try {
      const articles = await storage.getKnowledgeArticles();
      const publicArticles = articles.filter(a => a.status === 'published' && a.accessLevel === 'public');
      res.json(publicArticles);
    } catch (error) {
      console.error("Error fetching portal articles:", error);
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  // Portal Training - Get active training content
  app.get("/api/portal/training", isAuthenticated, async (req, res) => {
    try {
      const trainings = await storage.getAllTrainingContent();
      const activeTrainings = trainings.filter(t => t.isActive === 1);
      res.json(activeTrainings);
    } catch (error) {
      console.error("Error fetching portal training:", error);
      res.status(500).json({ message: "Failed to fetch training content" });
    }
  });

  // ============================================
  // SCRUM MODULE ROUTES (Central de Produção)
  // ============================================

  // Scrum Internal Projects
  app.get("/api/scrum/projects", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Superadmin vê todos; demais veem somente do tenant ativo + legados sem tenant.
      const projects = req.isSuperadmin
        ? await storage.getScrumInternalProjects(req.tenantId ?? undefined, { allowGlobal: true })
        : await storage.getScrumInternalProjects(req.tenantId ?? null);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching scrum projects:", error);
      res.status(500).json({ message: "Failed to fetch scrum projects" });
    }
  });

  app.get("/api/scrum/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumInternalProjectTenantAccess(req, res, req.params.id)) return;
      const project = await storage.getScrumInternalProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Scrum project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching scrum project:", error);
      res.status(500).json({ message: "Failed to fetch scrum project" });
    }
  });

  app.post("/api/scrum/projects", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const body = {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
        createdById: getAuthUserId(req),
        // Injeta tenantId do contexto (superadmin pode passar explícito no body).
        tenantId: req.isSuperadmin
          ? (req.body.tenantId ?? req.tenantId ?? null)
          : (req.tenantId ?? null),
      };
      const parsed = insertScrumInternalProjectSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const project = await storage.createScrumInternalProject(parsed.data);
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating scrum project:", error);
      res.status(500).json({ message: "Failed to create scrum project" });
    }
  });

  app.patch("/api/scrum/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumInternalProjectTenantAccess(req, res, req.params.id)) return;
      const body = {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
      };
      // Não-superadmin não pode mover projeto entre tenants via PATCH.
      if (!req.isSuperadmin) delete body.tenantId;
      const parsed = insertScrumInternalProjectSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const project = await storage.updateScrumInternalProject(req.params.id, parsed.data);
      if (!project) {
        return res.status(404).json({ message: "Scrum project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error updating scrum project:", error);
      res.status(500).json({ message: "Failed to update scrum project" });
    }
  });

  app.delete("/api/scrum/projects/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumInternalProjectTenantAccess(req, res, req.params.id)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteScrumInternalProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum project:", error);
      res.status(500).json({ message: "Failed to delete scrum project" });
    }
  });

  // Scrum Teams
  app.get("/api/scrum/teams", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Superadmin vê todos; demais veem apenas do tenant ativo + legados (tenantId NULL).
      const teams = req.isSuperadmin
        ? await storage.getScrumTeams(req.tenantId ?? undefined, { allowGlobal: true })
        : await storage.getScrumTeams(req.tenantId ?? null);
      // Fetch members and leader for each team
      const teamsWithRelations = await Promise.all(
        teams.map(async (team) => {
          const members = await storage.getScrumTeamMembers(team.id);
          const membersWithUsers = await Promise.all(
            members.map(async (member) => {
              const user = await storage.getUser(member.userId);
              return { ...member, user };
            })
          );
          const leader = team.leaderId ? await storage.getUser(team.leaderId) : undefined;
          return { ...team, members: membersWithUsers, leader };
        })
      );
      res.json(teamsWithRelations);
    } catch (error) {
      console.error("Error fetching scrum teams:", error);
      res.status(500).json({ message: "Failed to fetch scrum teams" });
    }
  });

  app.get("/api/scrum/teams/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamTenantAccess(req, res, req.params.id)) return;
      const team = await storage.getScrumTeam(req.params.id);
      if (!team) {
        return res.status(404).json({ message: "Scrum team not found" });
      }
      res.json(team);
    } catch (error) {
      console.error("Error fetching scrum team:", error);
      res.status(500).json({ message: "Failed to fetch scrum team" });
    }
  });

  app.post("/api/scrum/teams", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertScrumTeamSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
        // Injeta tenantId do contexto (superadmin pode passar explícito no body).
        tenantId: req.isSuperadmin
          ? (req.body.tenantId ?? req.tenantId ?? null)
          : (req.tenantId ?? null),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const team = await storage.createScrumTeam(parsed.data);
      res.status(201).json(team);
    } catch (error) {
      console.error("Error creating scrum team:", error);
      res.status(500).json({ message: "Failed to create scrum team" });
    }
  });

  app.patch("/api/scrum/teams/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamTenantAccess(req, res, req.params.id)) return;
      // Não-superadmin não pode mover time para outro tenant via PATCH.
      const body = { ...req.body };
      if (!req.isSuperadmin) delete body.tenantId;
      const parsed = insertScrumTeamSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const team = await storage.updateScrumTeam(req.params.id, parsed.data);
      if (!team) {
        return res.status(404).json({ message: "Scrum team not found" });
      }
      res.json(team);
    } catch (error) {
      console.error("Error updating scrum team:", error);
      res.status(500).json({ message: "Failed to update scrum team" });
    }
  });

  app.delete("/api/scrum/teams/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamTenantAccess(req, res, req.params.id)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteScrumTeam(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum team:", error);
      res.status(500).json({ message: "Failed to delete scrum team" });
    }
  });

  // Scrum Team Members
  app.get("/api/scrum/teams/:teamId/members", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamTenantAccess(req, res, req.params.teamId)) return;
      const members = await storage.getScrumTeamMembers(req.params.teamId);
      res.json(members);
    } catch (error) {
      console.error("Error fetching scrum team members:", error);
      res.status(500).json({ message: "Failed to fetch scrum team members" });
    }
  });

  app.post("/api/scrum/teams/:teamId/members", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamTenantAccess(req, res, req.params.teamId)) return;
      const parsed = insertScrumTeamMemberSchema.safeParse({
        ...req.body,
        teamId: req.params.teamId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const member = await storage.createScrumTeamMember(parsed.data);
      res.status(201).json(member);
    } catch (error) {
      console.error("Error creating scrum team member:", error);
      res.status(500).json({ message: "Failed to create scrum team member" });
    }
  });

  app.patch("/api/scrum/team-members/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamMemberTenantAccess(req, res, req.params.id)) return;
      // Bloqueia troca de teamId para fora do tenant.
      if (req.body.teamId) {
        if (!await assertScrumTeamTenantAccess(req, res, req.body.teamId)) return;
      }
      const parsed = insertScrumTeamMemberSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const member = await storage.updateScrumTeamMember(req.params.id, parsed.data);
      if (!member) {
        return res.status(404).json({ message: "Scrum team member not found" });
      }
      res.json(member);
    } catch (error) {
      console.error("Error updating scrum team member:", error);
      res.status(500).json({ message: "Failed to update scrum team member" });
    }
  });

  app.delete("/api/scrum/team-members/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTeamMemberTenantAccess(req, res, req.params.id)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteScrumTeamMember(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum team member:", error);
      res.status(500).json({ message: "Failed to delete scrum team member" });
    }
  });

  // Scrum Sprints
  app.get("/api/scrum/sprints", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      // Quando projectId for fornecido, valida tenant; caso contrário, filtra por tenant via storage.
      if (projectId) {
        if (!await assertScrumInternalProjectTenantAccess(req, res, projectId)) return;
        const sprints = await storage.getScrumSprints(projectId);
        return res.json(sprints);
      }
      const sprints = req.isSuperadmin
        ? await storage.getScrumSprints()
        : await storage.getScrumSprints(undefined, req.tenantId ?? null);
      res.json(sprints);
    } catch (error) {
      console.error("Error fetching scrum sprints:", error);
      res.status(500).json({ message: "Failed to fetch scrum sprints" });
    }
  });

  app.get("/api/scrum/sprints/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumSprintTenantAccess(req, res, req.params.id)) return;
      const sprint = await storage.getScrumSprint(req.params.id);
      if (!sprint) {
        return res.status(404).json({ message: "Scrum sprint not found" });
      }
      res.json(sprint);
    } catch (error) {
      console.error("Error fetching scrum sprint:", error);
      res.status(500).json({ message: "Failed to fetch scrum sprint" });
    }
  });

  app.post("/api/scrum/sprints", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Tenant isolation: valida que o internalProjectId pertence ao tenant do usuário
      if (req.body.internalProjectId) {
        if (!await assertScrumInternalProjectTenantAccess(req, res, req.body.internalProjectId)) return;
      } else if (!req.isSuperadmin) {
        return res.status(400).json({ message: "internalProjectId is required" });
      }
      const parsed = insertScrumSprintSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const sprint = await storage.createScrumSprint(parsed.data);
      res.status(201).json(sprint);
    } catch (error) {
      console.error("Error creating scrum sprint:", error);
      res.status(500).json({ message: "Failed to create scrum sprint" });
    }
  });

  app.patch("/api/scrum/sprints/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumSprintTenantAccess(req, res, req.params.id)) return;
      // Bloqueia mudança de internalProjectId para tenant alheio
      if (req.body.internalProjectId) {
        if (!await assertScrumInternalProjectTenantAccess(req, res, req.body.internalProjectId)) return;
      }
      const body = {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      };
      const parsed = insertScrumSprintSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const sprint = await storage.updateScrumSprint(req.params.id, parsed.data);
      if (!sprint) {
        return res.status(404).json({ message: "Scrum sprint not found" });
      }
      res.json(sprint);
    } catch (error) {
      console.error("Error updating scrum sprint:", error);
      res.status(500).json({ message: "Failed to update scrum sprint" });
    }
  });

  app.delete("/api/scrum/sprints/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumSprintTenantAccess(req, res, req.params.id)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente" && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteScrumSprint(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum sprint:", error);
      res.status(500).json({ message: "Failed to delete scrum sprint" });
    }
  });

  // Scrum Backlog Items (PBIs)
  app.get("/api/scrum/backlog", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const filters: Record<string, string | null> = {};
      // Enforce tenant isolation: non-superadmin users can only see their own tenant's items
      if (!req.isSuperadmin) {
        if (!req.tenantId) return res.status(403).json({ message: "Tenant context required" });
        filters.tenantId = req.tenantId;
      }
      if (req.query.projectId) filters.projectId = req.query.projectId as string;
      if (req.query.sprintId) filters.sprintId = req.query.sprintId as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.assigneeId) filters.assigneeId = req.query.assigneeId as string;
      const items = await storage.getScrumBacklogItems(filters);
      res.json(items);
    } catch (error) {
      console.error("Error fetching scrum backlog items:", error);
      res.status(500).json({ message: "Failed to fetch scrum backlog items" });
    }
  });

  app.get("/api/scrum/backlog/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumBacklogItemTenantAccess(req, res, req.params.id)) return;
      const item = await storage.getScrumBacklogItem(req.params.id);
      res.json(item);
    } catch (error) {
      console.error("Error fetching scrum backlog item:", error);
      res.status(500).json({ message: "Failed to fetch scrum backlog item" });
    }
  });

  app.post("/api/scrum/backlog", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Tenant isolation: bloqueia referências cruzadas a sprint/internalProject de outro tenant
      if (req.body.internalProjectId) {
        if (!await assertScrumInternalProjectTenantAccess(req, res, req.body.internalProjectId)) return;
      }
      if (req.body.sprintId) {
        if (!await assertScrumSprintTenantAccess(req, res, req.body.sprintId)) return;
      }
      const dataWithDates = {
        ...req.body,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        startedAt: req.body.startedAt ? new Date(req.body.startedAt) : undefined,
        completedAt: req.body.completedAt ? new Date(req.body.completedAt) : undefined,
        createdById: getAuthUserId(req),
        tenantId: req.isSuperadmin ? (req.body.tenantId ?? req.tenantId ?? null) : (req.tenantId ?? null),
      };
      const parsed = insertScrumBacklogItemSchema.safeParse(dataWithDates);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createScrumBacklogItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating scrum backlog item:", error);
      res.status(500).json({ message: "Failed to create scrum backlog item" });
    }
  });

  app.patch("/api/scrum/backlog/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumBacklogItemTenantAccess(req, res, req.params.id)) return;
      // Bloqueia mover PBI para sprint/internalProject de outro tenant
      if (req.body.internalProjectId) {
        if (!await assertScrumInternalProjectTenantAccess(req, res, req.body.internalProjectId)) return;
      }
      if (req.body.sprintId) {
        if (!await assertScrumSprintTenantAccess(req, res, req.body.sprintId)) return;
      }
      const dataWithDates = {
        ...req.body,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        startedAt: req.body.startedAt ? new Date(req.body.startedAt) : undefined,
        completedAt: req.body.completedAt ? new Date(req.body.completedAt) : undefined,
      };
      const parsed = insertScrumBacklogItemSchema.partial().safeParse(dataWithDates);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateScrumBacklogItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "Scrum backlog item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating scrum backlog item:", error);
      res.status(500).json({ message: "Failed to update scrum backlog item" });
    }
  });

  app.delete("/api/scrum/backlog/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Isolamento por tenant via item; mesmo padrão de PATCH /scrum/backlog/:id.
      // Qualquer membro do tenant pode excluir item do próprio tenant.
      if (!await assertScrumBacklogItemTenantAccess(req, res, req.params.id)) return;
      await storage.deleteScrumBacklogItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum backlog item:", error);
      res.status(500).json({ message: "Failed to delete scrum backlog item" });
    }
  });

  // Scrum Timesheets
  app.get("/api/scrum/timesheets", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const pbiId = req.query.pbiId as string | undefined;
      if (pbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, pbiId)) return;
      }
      const tenantFilter = req.isSuperadmin ? undefined : (req.tenantId ?? null);
      const timesheets = await storage.getScrumTimesheets(pbiId, tenantFilter);
      // Fetch PBI and user for each timesheet
      const timesheetsWithRelations = await Promise.all(
        timesheets.map(async (entry) => {
          const pbi = await storage.getScrumBacklogItem(entry.pbiId);
          const user = await storage.getUser(entry.userId);
          return { ...entry, pbi, user };
        })
      );
      res.json(timesheetsWithRelations);
    } catch (error) {
      console.error("Error fetching scrum timesheets:", error);
      res.status(500).json({ message: "Failed to fetch scrum timesheets" });
    }
  });

  app.post("/api/scrum/timesheets", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Valida que o PBI alvo pertence ao tenant do usuário (impede apontar hora em PBI alheio).
      if (req.body.pbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.pbiId)) return;
      }
      const parsed = insertScrumTimesheetSchema.safeParse({
        ...req.body,
        userId: getAuthUserId(req),
        date: req.body.date ? new Date(req.body.date) : undefined,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const timesheet = await storage.createScrumTimesheet(parsed.data);
      res.status(201).json(timesheet);
    } catch (error) {
      console.error("Error creating scrum timesheet:", error);
      res.status(500).json({ message: "Failed to create scrum timesheet" });
    }
  });

  app.patch("/api/scrum/timesheets/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTimesheetTenantAccess(req, res, req.params.id)) return;
      if (req.body.pbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.pbiId)) return;
      }
      const body = {
        ...req.body,
        date: req.body.date ? new Date(req.body.date) : undefined,
      };
      const parsed = insertScrumTimesheetSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const timesheet = await storage.updateScrumTimesheet(req.params.id, parsed.data);
      if (!timesheet) {
        return res.status(404).json({ message: "Scrum timesheet not found" });
      }
      res.json(timesheet);
    } catch (error) {
      console.error("Error updating scrum timesheet:", error);
      res.status(500).json({ message: "Failed to update scrum timesheet" });
    }
  });

  app.delete("/api/scrum/timesheets/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumTimesheetTenantAccess(req, res, req.params.id)) return;
      await storage.deleteScrumTimesheet(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum timesheet:", error);
      res.status(500).json({ message: "Failed to delete scrum timesheet" });
    }
  });

  // Scrum Rework
  app.get("/api/scrum/rework", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const originalPbiId = req.query.originalPbiId as string | undefined;
      if (originalPbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, originalPbiId)) return;
      }
      const tenantFilter = req.isSuperadmin ? undefined : (req.tenantId ?? null);
      const reworks = await storage.getScrumReworks(originalPbiId, tenantFilter);
      res.json(reworks);
    } catch (error) {
      console.error("Error fetching scrum reworks:", error);
      res.status(500).json({ message: "Failed to fetch scrum reworks" });
    }
  });

  app.post("/api/scrum/rework", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Valida que o PBI original pertence ao tenant (impede registrar retrabalho de PBI alheio).
      if (req.body.originalPbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.originalPbiId)) return;
      }
      if (req.body.reworkPbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.reworkPbiId)) return;
      }
      const parsed = insertScrumReworkSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const rework = await storage.createScrumRework(parsed.data);
      res.status(201).json(rework);
    } catch (error) {
      console.error("Error creating scrum rework:", error);
      res.status(500).json({ message: "Failed to create scrum rework" });
    }
  });

  app.patch("/api/scrum/rework/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumReworkTenantAccess(req, res, req.params.id)) return;
      if (req.body.originalPbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.originalPbiId)) return;
      }
      if (req.body.reworkPbiId) {
        if (!await assertScrumBacklogItemTenantAccess(req, res, req.body.reworkPbiId)) return;
      }
      const parsed = insertScrumReworkSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const rework = await storage.updateScrumRework(req.params.id, parsed.data);
      if (!rework) {
        return res.status(404).json({ message: "Scrum rework not found" });
      }
      res.json(rework);
    } catch (error) {
      console.error("Error updating scrum rework:", error);
      res.status(500).json({ message: "Failed to update scrum rework" });
    }
  });

  app.delete("/api/scrum/rework/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumReworkTenantAccess(req, res, req.params.id)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteScrumRework(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting scrum rework:", error);
      res.status(500).json({ message: "Failed to delete scrum rework" });
    }
  });

  // Scrum Backlog Attachments
  app.get("/api/scrum/backlog/:pbiId/attachments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      // Valida tenant do PBI antes de devolver anexos (anexos derivam tenancy do PBI).
      if (!await assertScrumBacklogItemTenantAccess(req, res, req.params.pbiId)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "gerente" && currentUser.role !== "tecnico")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const attachments = await storage.getScrumBacklogAttachments(req.params.pbiId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching backlog attachments:", error);
      res.status(500).json({ message: "Failed to fetch backlog attachments" });
    }
  });

  app.post("/api/scrum/backlog/:pbiId/attachments", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      if (!await assertScrumBacklogItemTenantAccess(req, res, req.params.pbiId)) return;
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "gerente" && currentUser.role !== "tecnico")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertScrumBacklogAttachmentSchema.safeParse({
        ...req.body,
        pbiId: req.params.pbiId,
        uploadedById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const attachment = await storage.createScrumBacklogAttachment(parsed.data);
      res.status(201).json(attachment);
    } catch (error) {
      console.error("Error creating backlog attachment:", error);
      res.status(500).json({ message: "Failed to create backlog attachment" });
    }
  });

  app.delete("/api/scrum/attachments/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "gerente" && currentUser.role !== "tecnico")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const attachment = await storage.getScrumBacklogAttachment(req.params.id);
      if (!attachment) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      // Valida tenant via PBI dono do anexo.
      if (!await assertScrumBacklogItemTenantAccess(req, res, attachment.pbiId)) return;
      const storageKey = attachment.storageKey;
      await storage.deleteScrumBacklogAttachment(req.params.id);
      if (storageKey) {
        try {
          const objectStorageService = new ObjectStorageService();
          await objectStorageService.deleteObject(storageKey);
        } catch (storageError) {
          console.error("Error deleting file from storage (orphan created):", storageError);
        }
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting backlog attachment:", error);
      res.status(500).json({ message: "Failed to delete backlog attachment" });
    }
  });

  // ======= PROJECT FILE MANAGER ROUTES =======
  
  // List project files
  app.get("/api/projects/:projectId/files", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const folder = req.query.folder as string | undefined;
      const files = await storage.getProjectFiles(req.params.projectId, folder);
      res.json(files);
    } catch (error) {
      console.error("Error fetching project files:", error);
      res.status(500).json({ message: "Failed to fetch project files" });
    }
  });

  // Get project folders
  app.get("/api/projects/:projectId/files/folders", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const folders = await storage.getProjectFileFolders(req.params.projectId);
      res.json(folders);
    } catch (error) {
      console.error("Error fetching project folders:", error);
      res.status(500).json({ message: "Failed to fetch project folders" });
    }
  });

  // Get single file metadata
  app.get("/api/project-files/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const file = await storage.getProjectFile(req.params.id);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      res.json(file);
    } catch (error) {
      console.error("Error fetching project file:", error);
      res.status(500).json({ message: "Failed to fetch project file" });
    }
  });

  // Get file download URL
  app.get("/api/project-files/:id/download", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const file = await storage.getProjectFile(req.params.id);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      const objectStorageService = new ObjectStorageService();
      const signedUrl = await objectStorageService.getSignedUrl(file.storageKey, 3600); // 1 hour
      res.json({ url: signedUrl, fileName: file.originalName, mimeType: file.mimeType });
    } catch (error) {
      console.error("Error generating download URL:", error);
      res.status(500).json({ message: "Failed to generate download URL" });
    }
  });

  // Upload file (base64)
  app.post("/api/projects/:projectId/files/upload", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { fileName, fileData, mimeType, fileSize, folder, description } = req.body;
      
      if (!fileName || !fileData) {
        return res.status(400).json({ message: "fileName and fileData are required" });
      }

      // Detect file type from mime type or extension
      const detectFileType = (mime: string, name: string): string => {
        const ext = name.split('.').pop()?.toLowerCase() || '';
        if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
        if (mime.includes('video') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return 'video';
        if (mime.includes('audio') || ['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext)) return 'audio';
        if (mime.includes('spreadsheet') || mime.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
        if (mime.includes('presentation') || mime.includes('powerpoint') || ['pptx', 'ppt'].includes(ext)) return 'presentation';
        if (mime.includes('document') || mime.includes('word') || ['docx', 'doc'].includes(ext)) return 'document';
        if (mime.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
        if (ext === 'ofx') return 'ofx';
        return 'other';
      };

      const parentProject = await storage.getProject(req.params.projectId);
      if (!parentProject) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (!parentProject.tenantId) {
        return res.status(400).json({ message: "Project has no tenant" });
      }

      const fileType = detectFileType(mimeType || '', fileName);
      const buffer = Buffer.from(fileData, 'base64');
      const uniqueFileName = `${Date.now()}-${fileName}`;
      const storagePath = `.private/project-files/${req.params.projectId}/${uniqueFileName}`;
      
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.upload(storagePath, buffer, mimeType || 'application/octet-stream');

      const parsed = insertProjectFileSchema.safeParse({
        tenantId: parentProject.tenantId,
        projectId: req.params.projectId,
        fileName: uniqueFileName,
        originalName: fileName,
        fileType,
        mimeType,
        fileSize: fileSize || buffer.length,
        storageKey: storagePath,
        folder: folder || '/',
        description: description || null,
        uploadedById: getAuthUserId(req),
      });

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const file = await storage.createProjectFile(parsed.data);
      res.status(201).json(file);
    } catch (error) {
      console.error("Error uploading project file:", error);
      res.status(500).json({ message: "Failed to upload project file" });
    }
  });

  // Update file metadata
  app.patch("/api/project-files/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const file = await storage.getProjectFile(req.params.id);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      const { folder, description } = req.body;
      const updated = await storage.updateProjectFile(req.params.id, { folder, description });
      res.json(updated);
    } catch (error) {
      console.error("Error updating project file:", error);
      res.status(500).json({ message: "Failed to update project file" });
    }
  });

  // Delete file
  app.delete("/api/project-files/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const file = await storage.getProjectFile(req.params.id);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      
      // Delete from object storage
      try {
        const objectStorageService = new ObjectStorageService();
        await objectStorageService.deleteObject(file.storageKey);
      } catch (storageError) {
        console.error("Error deleting file from storage (orphan created):", storageError);
      }
      
      await storage.deleteProjectFile(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project file:", error);
      res.status(500).json({ message: "Failed to delete project file" });
    }
  });

  // CRM Proposals
  app.get("/api/crm/proposals", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const opportunityId = req.query.opportunityId as string | undefined;
      const clientId = req.query.clientId as string | undefined;
      let proposals;
      if (opportunityId) {
        proposals = await storage.getCrmProposalsByOpportunity(opportunityId);
      } else if (clientId) {
        proposals = await storage.getCrmProposalsByClient(clientId);
      } else {
        proposals = await storage.getAllCrmProposals();
      }
      res.json(proposals);
    } catch (error) {
      console.error("Error fetching CRM proposals:", error);
      res.status(500).json({ message: "Failed to fetch CRM proposals" });
    }
  });

  app.get("/api/crm/proposals/next-number", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const proposalNumber = await storage.getNextProposalNumber();
      res.json({ proposalNumber });
    } catch (error) {
      console.error("Error getting next proposal number:", error);
      res.status(500).json({ message: "Failed to get next proposal number" });
    }
  });

  app.get("/api/crm/proposals/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const proposal = await storage.getCrmProposal(req.params.id);
      if (!proposal) {
        return res.status(404).json({ message: "Proposal not found" });
      }
      res.json(proposal);
    } catch (error) {
      console.error("Error fetching CRM proposal:", error);
      res.status(500).json({ message: "Failed to fetch CRM proposal" });
    }
  });

  app.post("/api/crm/proposals", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const proposalNumber = await storage.getNextProposalNumber();
      const body = { ...req.body };
      if (body.validUntil && typeof body.validUntil === 'string') {
        body.validUntil = new Date(body.validUntil);
      }
      if (body.sentAt && typeof body.sentAt === 'string') {
        body.sentAt = new Date(body.sentAt);
      }
      if (body.approvedAt && typeof body.approvedAt === 'string') {
        body.approvedAt = new Date(body.approvedAt);
      }
      if (body.rejectedAt && typeof body.rejectedAt === 'string') {
        body.rejectedAt = new Date(body.rejectedAt);
      }
      const parsed = insertCrmProposalSchema.safeParse({
        ...body,
        number: proposalNumber,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const proposal = await storage.createCrmProposal(parsed.data);
      res.status(201).json(proposal);
    } catch (error) {
      console.error("Error creating CRM proposal:", error);
      res.status(500).json({ message: "Failed to create CRM proposal" });
    }
  });

  app.patch("/api/crm/proposals/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.validUntil && typeof body.validUntil === 'string') {
        body.validUntil = new Date(body.validUntil);
      }
      if (body.sentAt && typeof body.sentAt === 'string') {
        body.sentAt = new Date(body.sentAt);
      }
      if (body.approvedAt && typeof body.approvedAt === 'string') {
        body.approvedAt = new Date(body.approvedAt);
      }
      if (body.rejectedAt && typeof body.rejectedAt === 'string') {
        body.rejectedAt = new Date(body.rejectedAt);
      }
      const parsed = insertCrmProposalSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const proposal = await storage.updateCrmProposal(req.params.id, parsed.data);
      if (!proposal) {
        return res.status(404).json({ message: "Proposal not found" });
      }
      res.json(proposal);
    } catch (error) {
      console.error("Error updating CRM proposal:", error);
      res.status(500).json({ message: "Failed to update CRM proposal" });
    }
  });

  app.delete("/api/crm/proposals/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteCrmProposal(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM proposal:", error);
      res.status(500).json({ message: "Failed to delete CRM proposal" });
    }
  });

  app.post("/api/crm/proposals/:id/convert-to-project", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const proposal = await storage.getCrmProposal(req.params.id);
      if (!proposal) {
        return res.status(404).json({ message: "Proposal not found" });
      }

      if (proposal.status !== 'approved') {
        return res.status(400).json({ message: "Only approved proposals can be converted to projects" });
      }

      if (!proposal.clientId) {
        return res.status(400).json({ message: "Proposal must have a client before converting to project" });
      }

      if (!proposal.tenantId) {
        return res.status(400).json({ message: "Proposal has no tenant" });
      }

      const project = await storage.createProject({
        tenantId: proposal.tenantId,
        name: proposal.title,
        description: proposal.description || '',
        clientId: proposal.clientId,
        status: 'backlog',
        managerId: getAuthUserId(req),
      });

      await storage.updateCrmProposal(proposal.id, {
        projectId: project.id,
      });

      res.json({ project, message: "Proposal converted to project successfully" });
    } catch (error) {
      console.error("Error converting proposal to project:", error);
      res.status(500).json({ message: "Failed to convert proposal to project" });
    }
  });

  // CRM Proposal Items
  app.get("/api/crm/proposals/:proposalId/items", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const items = await storage.getCrmProposalItems(req.params.proposalId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching CRM proposal items:", error);
      res.status(500).json({ message: "Failed to fetch CRM proposal items" });
    }
  });

  app.post("/api/crm/proposals/:proposalId/items", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmProposalItemSchema.safeParse({
        ...req.body,
        proposalId: req.params.proposalId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.createCrmProposalItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating CRM proposal item:", error);
      res.status(500).json({ message: "Failed to create CRM proposal item" });
    }
  });

  app.patch("/api/crm/proposal-items/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmProposalItemSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const item = await storage.updateCrmProposalItem(req.params.id, parsed.data);
      if (!item) {
        return res.status(404).json({ message: "Proposal item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error updating CRM proposal item:", error);
      res.status(500).json({ message: "Failed to update CRM proposal item" });
    }
  });

  app.delete("/api/crm/proposal-items/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCrmProposalItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM proposal item:", error);
      res.status(500).json({ message: "Failed to delete CRM proposal item" });
    }
  });

  // CRM Contracts
  app.get("/api/crm/contracts", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const contracts = clientId
        ? await storage.getCrmContractsByClient(clientId)
        : await storage.getAllCrmContracts();
      res.json(contracts);
    } catch (error) {
      console.error("Error fetching CRM contracts:", error);
      res.status(500).json({ message: "Failed to fetch CRM contracts" });
    }
  });

  app.get("/api/crm/contracts/next-number", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const contractNumber = await storage.getNextContractNumber();
      res.json({ contractNumber });
    } catch (error) {
      console.error("Error getting next contract number:", error);
      res.status(500).json({ message: "Failed to get next contract number" });
    }
  });

  app.get("/api/crm/contracts/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const contract = await storage.getCrmContract(req.params.id);
      if (!contract) {
        return res.status(404).json({ message: "Contract not found" });
      }
      res.json(contract);
    } catch (error) {
      console.error("Error fetching CRM contract:", error);
      res.status(500).json({ message: "Failed to fetch CRM contract" });
    }
  });

  app.post("/api/crm/contracts", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const contractNumber = await storage.getNextContractNumber();
      const body = { ...req.body };
      if (body.startDate && typeof body.startDate === 'string') {
        body.startDate = new Date(body.startDate);
      }
      if (body.endDate && typeof body.endDate === 'string') {
        body.endDate = new Date(body.endDate);
      }
      if (body.signedAt && typeof body.signedAt === 'string') {
        body.signedAt = new Date(body.signedAt);
      }
      if (body.cancelledAt && typeof body.cancelledAt === 'string') {
        body.cancelledAt = new Date(body.cancelledAt);
      }
      const parsed = insertCrmContractSchema.safeParse({
        ...body,
        number: contractNumber,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const contract = await storage.createCrmContract(parsed.data);
      res.status(201).json(contract);
    } catch (error) {
      console.error("Error creating CRM contract:", error);
      res.status(500).json({ message: "Failed to create CRM contract" });
    }
  });

  app.patch("/api/crm/contracts/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.startDate && typeof body.startDate === 'string') {
        body.startDate = new Date(body.startDate);
      }
      if (body.endDate && typeof body.endDate === 'string') {
        body.endDate = new Date(body.endDate);
      }
      if (body.signedAt && typeof body.signedAt === 'string') {
        body.signedAt = new Date(body.signedAt);
      }
      if (body.cancelledAt && typeof body.cancelledAt === 'string') {
        body.cancelledAt = new Date(body.cancelledAt);
      }
      const parsed = insertCrmContractSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const contract = await storage.updateCrmContract(req.params.id, parsed.data);
      if (!contract) {
        return res.status(404).json({ message: "Contract not found" });
      }
      res.json(contract);
    } catch (error) {
      console.error("Error updating CRM contract:", error);
      res.status(500).json({ message: "Failed to update CRM contract" });
    }
  });

  app.delete("/api/crm/contracts/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteCrmContract(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM contract:", error);
      res.status(500).json({ message: "Failed to delete CRM contract" });
    }
  });

  // CRM Contract Milestones
  app.get("/api/crm/contracts/:contractId/milestones", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const milestones = await storage.getCrmContractMilestones(req.params.contractId);
      res.json(milestones);
    } catch (error) {
      console.error("Error fetching CRM contract milestones:", error);
      res.status(500).json({ message: "Failed to fetch CRM contract milestones" });
    }
  });

  app.post("/api/crm/contracts/:contractId/milestones", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.dueDate && typeof body.dueDate === 'string') {
        body.dueDate = new Date(body.dueDate);
      }
      if (body.completedAt && typeof body.completedAt === 'string') {
        body.completedAt = new Date(body.completedAt);
      }
      const parsed = insertCrmContractMilestoneSchema.safeParse({
        ...body,
        contractId: req.params.contractId,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const milestone = await storage.createCrmContractMilestone(parsed.data);
      res.status(201).json(milestone);
    } catch (error) {
      console.error("Error creating CRM contract milestone:", error);
      res.status(500).json({ message: "Failed to create CRM contract milestone" });
    }
  });

  app.patch("/api/crm/contract-milestones/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.dueDate && typeof body.dueDate === 'string') {
        body.dueDate = new Date(body.dueDate);
      }
      if (body.completedAt && typeof body.completedAt === 'string') {
        body.completedAt = new Date(body.completedAt);
      }
      const parsed = insertCrmContractMilestoneSchema.partial().safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const milestone = await storage.updateCrmContractMilestone(req.params.id, parsed.data);
      if (!milestone) {
        return res.status(404).json({ message: "Contract milestone not found" });
      }
      res.json(milestone);
    } catch (error) {
      console.error("Error updating CRM contract milestone:", error);
      res.status(500).json({ message: "Failed to update CRM contract milestone" });
    }
  });

  app.delete("/api/crm/contract-milestones/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCrmContractMilestone(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM contract milestone:", error);
      res.status(500).json({ message: "Failed to delete CRM contract milestone" });
    }
  });

  // CRM Partners
  app.get("/api/crm/partners", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const partners = await storage.getAllCrmPartners();
      res.json(partners);
    } catch (error) {
      console.error("Error fetching CRM partners:", error);
      res.status(500).json({ message: "Failed to fetch CRM partners" });
    }
  });

  app.get("/api/crm/partners/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const partner = await storage.getCrmPartner(req.params.id);
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      res.json(partner);
    } catch (error) {
      console.error("Error fetching CRM partner:", error);
      res.status(500).json({ message: "Failed to fetch CRM partner" });
    }
  });

  app.post("/api/crm/partners", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertCrmPartnerSchema.safeParse({
        ...req.body,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const partner = await storage.createCrmPartner(parsed.data);
      res.status(201).json(partner);
    } catch (error) {
      console.error("Error creating CRM partner:", error);
      res.status(500).json({ message: "Failed to create CRM partner" });
    }
  });

  app.patch("/api/crm/partners/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmPartnerSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const partner = await storage.updateCrmPartner(req.params.id, parsed.data);
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      res.json(partner);
    } catch (error) {
      console.error("Error updating CRM partner:", error);
      res.status(500).json({ message: "Failed to update CRM partner" });
    }
  });

  app.delete("/api/crm/partners/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.role !== "admin" && currentUser?.role !== "gerente") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteCrmPartner(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM partner:", error);
      res.status(500).json({ message: "Failed to delete CRM partner" });
    }
  });

  // CRM Partner Commissions
  app.get("/api/crm/partners/:partnerId/commissions", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const commissions = await storage.getCrmPartnerCommissions(req.params.partnerId);
      res.json(commissions);
    } catch (error) {
      console.error("Error fetching CRM partner commissions:", error);
      res.status(500).json({ message: "Failed to fetch CRM partner commissions" });
    }
  });

  app.post("/api/crm/partners/:partnerId/commissions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const parsed = insertCrmPartnerCommissionSchema.safeParse({
        ...req.body,
        partnerId: req.params.partnerId,
        createdById: getAuthUserId(req),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const commission = await storage.createCrmPartnerCommission(parsed.data);
      res.status(201).json(commission);
    } catch (error) {
      console.error("Error creating CRM partner commission:", error);
      res.status(500).json({ message: "Failed to create CRM partner commission" });
    }
  });

  app.patch("/api/crm/partner-commissions/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      const parsed = insertCrmPartnerCommissionSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const commission = await storage.updateCrmPartnerCommission(req.params.id, parsed.data);
      if (!commission) {
        return res.status(404).json({ message: "Partner commission not found" });
      }
      res.json(commission);
    } catch (error) {
      console.error("Error updating CRM partner commission:", error);
      res.status(500).json({ message: "Failed to update CRM partner commission" });
    }
  });

  app.delete("/api/crm/partner-commissions/:id", isAuthenticated, requireTenant, async (req, res) => {
    try {
      await storage.deleteCrmPartnerCommission(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM partner commission:", error);
      res.status(500).json({ message: "Failed to delete CRM partner commission" });
    }
  });

  // ===== MULTI-TENANT MANAGEMENT APIS =====

  // Superadmin: Partner management
  app.get("/api/admin/partners", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const allPartners = await storage.getAllPartners();
      res.json(allPartners);
    } catch (error) {
      console.error("Error fetching partners:", error);
      res.status(500).json({ message: "Failed to fetch partners" });
    }
  });

  app.post("/api/admin/partners", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const { name, slug, email, phone, plan, notes } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ message: "name and slug are required" });
      }
      const partner = await storage.createPartner({
        name,
        slug,
        email: email || null,
        phone: phone || null,
        plan: plan || 'basic',
        notes: notes || null,
        createdById: getAuthUserId(req),
      });
      res.status(201).json(partner);
    } catch (error) {
      console.error("Error creating partner:", error);
      res.status(500).json({ message: "Failed to create partner" });
    }
  });

  app.patch("/api/admin/partners/:id", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const partner = await storage.updatePartner(req.params.id, req.body);
      if (!partner) return res.status(404).json({ message: "Partner not found" });
      res.json(partner);
    } catch (error) {
      console.error("Error updating partner:", error);
      res.status(500).json({ message: "Failed to update partner" });
    }
  });

  app.delete("/api/admin/partners/:id", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      await storage.deletePartner(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting partner:", error);
      res.status(500).json({ message: "Failed to delete partner" });
    }
  });

  // Superadmin: Global tenant view
  app.get("/api/admin/tenants", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const allTenants = await storage.getAllTenants();
      res.json(allTenants);
    } catch (error) {
      console.error("Error fetching tenants:", error);
      res.status(500).json({ message: "Failed to fetch tenants" });
    }
  });

  // Admin: Create user (superadmin only) — supports creating users with or without tenant
  app.post("/api/admin/users", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const { email, password, firstName, lastName, tenantId, tenantRole, role } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const validRoles = ['superadmin', 'admin', 'gerente', 'tecnico'];
      const validTenantRoles = ['admin', 'gerente', 'tecnico'];
      const userRole = role && validRoles.includes(role) ? role : 'tecnico';
      const assignedTenantRole = tenantRole && validTenantRoles.includes(tenantRole) ? tenantRole : 'tecnico';
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email already in use" });
      }
      const { hashPassword } = await import("./localAuth");
      const passwordHash = await hashPassword(password);
      const user = await storage.createLocalUser({
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        role: userRole,
        isLocalAuth: 1,
        isActive: 1,
      });
      if (tenantId) {
        const tenant = await storage.getTenant(tenantId);
        if (!tenant) {
          return res.status(404).json({ message: "Tenant not found" });
        }
        await storage.addTenantUser({
          tenantId,
          userId: user.id,
          role: assignedTenantRole,
          isActive: 1,
        });
      }
      res.status(201).json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName });
    } catch (error) {
      console.error("Error creating admin user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Partners: List tenants for a partner
  // Access: superadmin (any partner) or partner-linked user (own partner only)
  app.get("/api/partners/:id/tenants", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.isSuperadmin) {
        // Partner-level users may only see their own partner's tenants
        if (!req.partnerId || req.partnerId !== req.params.id) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      const tenantList = await storage.getTenantsByPartner(req.params.id);
      res.json(tenantList);
    } catch (error) {
      console.error("Error fetching partner tenants:", error);
      res.status(500).json({ message: "Failed to fetch partner tenants" });
    }
  });

  // Partners: Create tenant under partner
  // Access: superadmin (any partner) or partner-linked user (own partner only)
  app.post("/api/partners/:id/tenants", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.isSuperadmin) {
        // Partner-level users may only create tenants under their own partner
        if (!req.partnerId || req.partnerId !== req.params.id) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      const { name, slug, logoUrl, primaryColor, settings } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ message: "name and slug are required" });
      }
      const tenant = await storage.createTenant({
        name,
        slug,
        partnerId: req.params.id,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
        settings: settings || {},
        createdById: getAuthUserId(req),
      });
      res.status(201).json(tenant);
    } catch (error) {
      console.error("Error creating tenant:", error);
      res.status(500).json({ message: "Failed to create tenant" });
    }
  });

  // Sub-tenants: List sub-tenants (branches) under a parent tenant
  app.get("/api/tenants/:id/sub-tenants", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await storage.getSubTenants(req.params.id);
      res.json(result);
    } catch (error) {
      console.error("Error fetching sub-tenants:", error);
      res.status(500).json({ message: "Failed to fetch sub-tenants" });
    }
  });

  // Sub-tenants: Create sub-tenant (branch) under a parent tenant (superadmin or tenant admin)
  app.post("/api/tenants/:id/sub-tenants", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parentTenant = await storage.getTenant(req.params.id);
      if (!parentTenant) {
        return res.status(404).json({ message: "Parent tenant not found" });
      }
      const { name, slug, settings } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ message: "name and slug are required" });
      }
      const newSubTenant = await storage.createSubTenant({
        name,
        slug,
        parentTenantId: req.params.id,
        settings: settings || {},
        createdById: getAuthUserId(req),
      });
      res.status(201).json(newSubTenant);
    } catch (error) {
      console.error("Error creating sub-tenant:", error);
      res.status(500).json({ message: "Failed to create sub-tenant" });
    }
  });

  // Tenants: Get tenant details
  app.get("/api/tenants/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      if (req.isSuperadmin || currentUser?.systemRole === "superadmin") {
        return res.json(tenant);
      }
      if (currentUser?.systemRole === "partner") {
        const partner = await storage.getPartnerByUserId(currentUser.id);
        if (tenant.partnerId !== partner?.id) {
          return res.status(403).json({ message: "Forbidden" });
        }
        return res.json(tenant);
      }
      if (req.tenantId === req.params.id) {
        return res.json(tenant);
      }
      return res.status(403).json({ message: "Forbidden" });
    } catch (error) {
      console.error("Error fetching tenant:", error);
      res.status(500).json({ message: "Failed to fetch tenant" });
    }
  });

  // Tenants: Update tenant settings
  app.patch("/api/tenants/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const tenant = await storage.updateTenant(req.params.id, req.body);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant);
    } catch (error) {
      console.error("Error updating tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });

  // Tenants: List users
  app.get("/api/tenants/:id/users", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      const allowed =
        req.isSuperadmin ||
        currentUser?.systemRole === "superadmin" ||
        req.tenantId === req.params.id ||
        (currentUser?.systemRole === "partner" && await storage.getPartnerByUserId(currentUser.id).then(p => p?.id === tenant.partnerId));

      if (!allowed) return res.status(403).json({ message: "Forbidden" });

      const tuList = await storage.getTenantUsers(req.params.id);
      const enriched = await Promise.all(tuList.map(async (tu) => {
        const user = await storage.getUser(tu.userId);
        return { ...tu, user };
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching tenant users:", error);
      res.status(500).json({ message: "Failed to fetch tenant users" });
    }
  });

  // Tenants: Add user to tenant
  app.post("/api/tenants/:id/users", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { userId, role } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const existing = await storage.getTenantUser(req.params.id, userId);
      if (existing) return res.status(409).json({ message: "User already in tenant" });

      const tu = await storage.addTenantUser({
        tenantId: req.params.id,
        userId,
        role: role || 'tecnico',
        isActive: 1,
      });
      res.status(201).json(tu);
    } catch (error) {
      console.error("Error adding tenant user:", error);
      res.status(500).json({ message: "Failed to add tenant user" });
    }
  });

  // Tenants: Invitations - list (tenant admin only)
  app.get("/api/tenants/:id/invitations", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const invitations = await storage.getTenantInvitations(req.params.id);
      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  // Tenants: Invite user
  app.post("/api/tenants/:id/invitations", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      if (!req.isSuperadmin && req.tenantId !== req.params.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { email, role } = req.body;
      if (!email) return res.status(400).json({ message: "email is required" });

      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invitation = await storage.createTenantInvitation({
        tenantId: req.params.id,
        email,
        role: role || 'tecnico',
        token,
        invitedById: getAuthUserId(req),
        expiresAt,
      });
      res.status(201).json(invitation);
    } catch (error) {
      console.error("Error creating invitation:", error);
      res.status(500).json({ message: "Failed to create invitation" });
    }
  });

  // Accept invitation (public endpoint used during registration)
  app.post("/api/invitations/:token/accept", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // Security: verify the invitation is addressed to the authenticated user's email
      const invite = await storage.getTenantInvitationByToken(req.params.token);
      if (!invite) return res.status(400).json({ message: "Invalid or expired invitation" });
      if (invite.acceptedAt) return res.status(400).json({ message: "Invitation already accepted" });
      if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
        return res.status(400).json({ message: "Invitation expired" });
      }
      // Bind invitation to invitee email — prevents token-disclosure attacks
      const currentUser = await storage.getUser(userId);
      if (!currentUser || currentUser.email.toLowerCase() !== invite.email.toLowerCase()) {
        return res.status(403).json({ message: "This invitation was issued to a different email address" });
      }

      const tu = await storage.acceptTenantInvitation(req.params.token, userId);
      if (!tu) return res.status(400).json({ message: "Failed to accept invitation" });
      res.json(tu);
    } catch (error) {
      console.error("Error accepting invitation:", error);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // Current user: get their tenants
  app.get("/api/me/tenants", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const userTenants = await storage.getUserTenants(userId);
      res.json(userTenants);
    } catch (error) {
      console.error("Error fetching user tenants:", error);
      res.status(500).json({ message: "Failed to fetch user tenants" });
    }
  });


  // ===== MULTI-TENANT ROUTES =====

  // Superadmin: Platform metrics
  app.get("/api/superadmin/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const metrics = await storage.getPlatformMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching platform metrics:", error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  // Superadmin: Platform access log (returns recent users)
  app.get("/api/superadmin/activity", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const users = await storage.getAllUsers();
      const sortedUsers = [...users].sort((a, b) => {
        const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
        return bTime - aTime;
      });
      res.json(sortedUsers.slice(0, 50));
    } catch (error) {
      console.error("Error fetching activity:", error);
      res.status(500).json({ message: "Failed to fetch activity" });
    }
  });

  // Update user system role (superadmin only)
  app.patch("/api/superadmin/users/:id/system-role", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { systemRole } = req.body;
      const user = await storage.updateUserSystemRole(req.params.id, systemRole);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (error) {
      console.error("Error updating system role:", error);
      res.status(500).json({ message: "Failed to update system role" });
    }
  });

  // Partners CRUD (superadmin)
  app.get("/api/partners", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const partnerList = await storage.getAllPartners();
      res.json(partnerList);
    } catch (error) {
      console.error("Error fetching partners:", error);
      res.status(500).json({ message: "Failed to fetch partners" });
    }
  });

  app.get("/api/partners/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const partner = await storage.getPartner(req.params.id);
      if (!partner) return res.status(404).json({ message: "Partner not found" });
      res.json(partner);
    } catch (error) {
      console.error("Error fetching partner:", error);
      res.status(500).json({ message: "Failed to fetch partner" });
    }
  });

  app.post("/api/partners", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Auto-generate slug from name if not provided
      if (!req.body.slug && req.body.name) {
        const base = req.body.name
          .toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        req.body.slug = `${base}-${Date.now().toString(36)}`;
      }
      const parsed = insertPartnerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const partner = await storage.createPartner(parsed.data);
      // Create a user account for the partner with the provided password
      if (parsed.data.email) {
        let existingUser = await storage.getUserByEmail(parsed.data.email);
        if (!existingUser) {
          existingUser = await storage.createUser({
            email: parsed.data.email,
            firstName: parsed.data.name.split(' ')[0],
            role: 'admin',
          });
        }
        // Set password if provided
        const rawPassword = (req.body as any).password;
        if (rawPassword) {
          const { hashPassword } = await import("./localAuth");
          const hashed = await hashPassword(rawPassword);
          await storage.updateUserPassword(existingUser.id, hashed);
        }
        await storage.updateUserSystemRole(existingUser.id, 'partner');
        await storage.updatePartner(partner.id, { userId: existingUser.id });
      }
      res.status(201).json(partner);
    } catch (error) {
      console.error("Error creating partner:", error);
      res.status(500).json({ message: "Failed to create partner" });
    }
  });

  app.patch("/api/partners/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertPartnerSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const partner = await storage.updatePartner(req.params.id, parsed.data);
      if (!partner) return res.status(404).json({ message: "Partner not found" });
      res.json(partner);
    } catch (error) {
      console.error("Error updating partner:", error);
      res.status(500).json({ message: "Failed to update partner" });
    }
  });

  app.delete("/api/partners/:id", isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deletePartner(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting partner:", error);
      res.status(500).json({ message: "Failed to delete partner" });
    }
  });

  // Tenants (superadmin: all, partner: own)
  app.get("/api/tenants", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole === "superadmin") {
        const allTenants = await storage.getAllTenants();
        return res.json(allTenants);
      }
      if (currentUser?.systemRole === "partner") {
        const partner = await storage.getPartnerByUserId(currentUser.id);
        if (!partner) return res.json([]);
        const partnerTenants = await storage.getTenantsByPartner(partner.id);
        return res.json(partnerTenants);
      }
      return res.status(403).json({ message: "Forbidden" });
    } catch (error) {
      console.error("Error fetching tenants:", error);
      res.status(500).json({ message: "Failed to fetch tenants" });
    }
  });

  app.get("/api/tenants/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      if (currentUser?.systemRole === "superadmin") {
        return res.json(tenant);
      }
      if (currentUser?.systemRole === "partner") {
        const partner = await storage.getPartnerByUserId(currentUser.id);
        if (tenant.partnerId !== partner?.id) {
          return res.status(403).json({ message: "Forbidden" });
        }
        return res.json(tenant);
      }
      if (currentUser?.systemRole === "tenant_admin") {
        const userTenant = await storage.getTenantByUserId(currentUser.id);
        if (userTenant?.id !== req.params.id && userTenant?.id !== tenant.parentTenantId) {
          return res.status(403).json({ message: "Forbidden" });
        }
        return res.json(tenant);
      }
      return res.status(403).json({ message: "Forbidden" });
    } catch (error) {
      console.error("Error fetching tenant:", error);
      res.status(500).json({ message: "Failed to fetch tenant" });
    }
  });

  app.post("/api/tenants", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Auto-generate slug from name if not provided
      if (!req.body.slug && req.body.name) {
        const base = req.body.name
          .toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        req.body.slug = `${base}-${Date.now().toString(36)}`;
      }
      // Pull out admin fields before schema parse
      const { adminPassword, adminFirstName, adminLastName, ...tenantBody } = req.body;
      const parsed = insertTenantSchema.safeParse(tenantBody);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      let partnerId = parsed.data.partnerId;
      if (currentUser?.systemRole === "partner" && !partnerId) {
        const partner = await storage.getPartnerByUserId(currentUser.id);
        if (partner) partnerId = partner.id;
      }
      const tenant = await storage.createTenant({ ...parsed.data, partnerId });

      // If adminPassword provided, create the admin user directly
      if (adminPassword && parsed.data.adminEmail) {
        const { hashPassword } = await import("./localAuth");
        const hashed = await hashPassword(adminPassword);
        // Check if user with that email already exists
        let adminUser = await storage.getUserByEmail(parsed.data.adminEmail);
        if (!adminUser) {
          adminUser = await storage.createUser({
            email: parsed.data.adminEmail,
            firstName: adminFirstName || parsed.data.adminEmail.split("@")[0],
            lastName: adminLastName || null,
            role: "admin",
          });
        }
        // Set password and mark as local auth
        await storage.updateUserPassword(adminUser.id, hashed);
        // Update systemRole to tenant_admin
        await storage.updateUserSystemRole(adminUser.id, "tenant_admin");
        // Add user to tenant as admin
        const existingTU = await storage.getTenantUser(tenant.id, adminUser.id);
        if (!existingTU) {
          await storage.addTenantUser({ tenantId: tenant.id, userId: adminUser.id, role: "admin", isActive: 1 });
        }
        return res.status(201).json({ ...tenant, adminUserCreated: true });
      }

      res.status(201).json(tenant);
    } catch (error) {
      console.error("Error creating tenant:", error);
      res.status(500).json({ message: "Failed to create tenant" });
    }
  });

  app.patch("/api/tenants/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      if (currentUser?.systemRole === "tenant_admin") {
        const userTenant = await storage.getTenantByUserId(currentUser.id);
        if (userTenant?.id !== req.params.id) {
          return res.status(403).json({ message: "Forbidden" });
        }
      } else if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertTenantSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const updated = await storage.updateTenant(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });

  app.delete("/api/tenants/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteTenant(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting tenant:", error);
      res.status(500).json({ message: "Failed to delete tenant" });
    }
  });

  // Sub-tenants
  app.get("/api/tenants/:id/sub-tenants", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const subTenants = await storage.getSubTenants(req.params.id);
      res.json(subTenants);
    } catch (error) {
      console.error("Error fetching sub-tenants:", error);
      res.status(500).json({ message: "Failed to fetch sub-tenants" });
    }
  });

  // Tenant Users management
  app.get("/api/tenants/:id/users", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "partner" && currentUser?.systemRole !== "tenant_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const tenantUserList = await storage.getTenantUsers(req.params.id);
      res.json(tenantUserList);
    } catch (error) {
      console.error("Error fetching tenant users:", error);
      res.status(500).json({ message: "Failed to fetch tenant users" });
    }
  });

  app.post("/api/tenants/:id/users", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "tenant_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const parsed = insertTenantUserSchema.safeParse({ ...req.body, tenantId: req.params.id });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const tenantUser = await storage.addTenantUser(parsed.data);
      res.status(201).json(tenantUser);
    } catch (error) {
      console.error("Error adding tenant user:", error);
      res.status(500).json({ message: "Failed to add tenant user" });
    }
  });

  app.patch("/api/tenant-users/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "tenant_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updated = await storage.updateTenantUser(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Tenant user not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating tenant user:", error);
      res.status(500).json({ message: "Failed to update tenant user" });
    }
  });

  app.delete("/api/tenant-users/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "tenant_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.removeTenantUser(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing tenant user:", error);
      res.status(500).json({ message: "Failed to remove tenant user" });
    }
  });

  // Create member directly with password (no invite needed)
  app.post("/api/tenants/:id/members", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "tenant_admin" && currentUser?.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { firstName, lastName, email, password, role, subTenantId } = req.body;
      if (!firstName || !email || !password) {
        return res.status(400).json({ message: "firstName, email and password are required" });
      }
      const { hashPassword } = await import("./localAuth");
      const hashed = await hashPassword(password);
      let user = await storage.getUserByEmail(email);
      if (!user) {
        user = await storage.createUser({ email, firstName, lastName: lastName || null, role: role || 'tecnico' });
      }
      await storage.updateUserPassword(user.id, hashed);
      // Regular members get systemRole="user" — only the tenant creator gets "tenant_admin"
      if (!user.systemRole || user.systemRole === 'user') {
        await storage.updateUserSystemRole(user.id, "user");
      }
      const existing = await storage.getTenantUser(req.params.id, user.id);
      if (existing) {
        const updated = await storage.updateTenantUser(existing.id, { role: role || 'tecnico', isActive: 1, subTenantId: subTenantId || null });
        return res.json({ ...updated, user });
      }
      const tu = await storage.addTenantUser({
        tenantId: req.params.id,
        userId: user.id,
        role: role || 'tecnico',
        isActive: 1,
        subTenantId: subTenantId || null,
      });
      res.status(201).json({ ...tu, user });
    } catch (error) {
      console.error("Error creating tenant member:", error);
      res.status(500).json({ message: "Failed to create member" });
    }
  });

  // Reset a specific tenant member's password
  app.post("/api/tenant-users/:id/reset-password", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "tenant_admin" && currentUser?.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "password is required" });
      const { hashPassword } = await import("./localAuth");
      const hashed = await hashPassword(password);
      const { db } = await import("./db");
      const { tenantUsers } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");
      const [tu] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, req.params.id));
      if (!tu) return res.status(404).json({ message: "Tenant user not found" });
      await storage.updateUserPassword(tu.userId, hashed);
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Invite tokens
  app.get("/api/tenants/:id/invites", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const invites = await storage.getInvitesByTenant(req.params.id);
      res.json(invites);
    } catch (error) {
      console.error("Error fetching invites:", error);
      res.status(500).json({ message: "Failed to fetch invites" });
    }
  });

  app.post("/api/tenants/:id/invites", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (currentUser?.systemRole !== "superadmin" && currentUser?.systemRole !== "partner" && currentUser?.systemRole !== "tenant_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { email, role } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });
      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const invite = await storage.createInviteToken({
        token,
        email,
        tenantId: req.params.id,
        role: role || "tecnico",
        invitedBy: currentUser?.id,
        expiresAt,
      });
      res.status(201).json({ ...invite, inviteUrl: `/convite/${token}` });
    } catch (error) {
      console.error("Error creating invite:", error);
      res.status(500).json({ message: "Failed to create invite" });
    }
  });

  // Public invite lookup
  app.get("/api/invites/:token", async (req, res) => {
    try {
      const invite = await storage.getInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invite not found" });
      if (invite.acceptedAt) return res.status(410).json({ message: "Invite already accepted" });
      if (new Date() > invite.expiresAt) return res.status(410).json({ message: "Invite expired" });
      const tenant = await storage.getTenant(invite.tenantId);
      res.json({ invite, tenant });
    } catch (error) {
      console.error("Error fetching invite:", error);
      res.status(500).json({ message: "Failed to fetch invite" });
    }
  });

  // Accept invite
  app.post("/api/invites/:token/accept", isAuthenticated, async (req: any, res) => {
    try {
      const invite = await storage.getInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invite not found" });
      if (invite.acceptedAt) return res.status(410).json({ message: "Invite already accepted" });
      if (new Date() > invite.expiresAt) return res.status(410).json({ message: "Invite expired" });
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
      // Add user to tenant
      await storage.addTenantUser({
        tenantId: invite.tenantId,
        userId: currentUser.id,
        role: invite.role,
        isActive: 1,
      });
      // Update system role to tenant_admin if admin, else user
      const newSystemRole = invite.role === "admin" ? "tenant_admin" : "user";
      await storage.updateUserSystemRole(currentUser.id, newSystemRole);
      await storage.acceptInvite(req.params.token);
      res.json({ success: true, tenantId: invite.tenantId });
    } catch (error) {
      console.error("Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invite" });
    }
  });

  // Get current user's tenant
  app.get("/api/my-tenant", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
      const tenant = await storage.getTenantByUserId(currentUser.id);
      if (!tenant) return res.status(404).json({ message: "No tenant found" });
      const subTenants = await storage.getSubTenants(tenant.id);
      res.json({ tenant, subTenants });
    } catch (error) {
      console.error("Error fetching my tenant:", error);
      res.status(500).json({ message: "Failed to fetch tenant" });
    }
  });

  // Get current partner info
  app.get("/api/my-partner", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser || currentUser.systemRole !== "partner") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const partner = await storage.getPartnerByUserId(currentUser.id);
      if (!partner) return res.status(404).json({ message: "Partner not found" });
      const partnerTenants = await storage.getTenantsByPartner(partner.id);
      res.json({ partner, tenants: partnerTenants });
    } catch (error) {
      console.error("Error fetching my partner:", error);
      res.status(500).json({ message: "Failed to fetch partner" });
    }
  });

  // =========================================================
  // ROLE PERMISSIONS — per-tenant configurable module access
  // =========================================================

  const ALL_MODULES = ['dashboard','crm','clientes','projetos','colaboradores','canvas','swot','pdca','processos','erp','tarefas','relatorios','producao','suporte'];

  const DEFAULT_PERMISSIONS: Record<string, Record<string, {canView:number;canCreate:number;canEdit:number;canDelete:number}>> = {
    admin: Object.fromEntries(ALL_MODULES.map(m => [m, { canView:1, canCreate:1, canEdit:1, canDelete:1 }])),
    gerente: Object.fromEntries(ALL_MODULES.map(m => [m, { canView:1, canCreate:1, canEdit:1, canDelete:0 }])),
    tecnico: {
      dashboard:   { canView:1, canCreate:0, canEdit:0, canDelete:0 },
      projetos:    { canView:1, canCreate:0, canEdit:1, canDelete:0 },
      tarefas:     { canView:1, canCreate:1, canEdit:1, canDelete:0 },
      processos:   { canView:1, canCreate:0, canEdit:0, canDelete:0 },
      suporte:     { canView:1, canCreate:1, canEdit:0, canDelete:0 },
      crm:         { canView:0, canCreate:0, canEdit:0, canDelete:0 },
      clientes:    { canView:0, canCreate:0, canEdit:0, canDelete:0 },
      colaboradores:{ canView:1, canCreate:0, canEdit:0, canDelete:0 },
      canvas:      { canView:1, canCreate:0, canEdit:0, canDelete:0 },
      swot:        { canView:1, canCreate:0, canEdit:0, canDelete:0 },
      pdca:        { canView:1, canCreate:0, canEdit:0, canDelete:0 },
      erp:         { canView:0, canCreate:0, canEdit:0, canDelete:0 },
      relatorios:  { canView:0, canCreate:0, canEdit:0, canDelete:0 },
      producao:    { canView:1, canCreate:0, canEdit:0, canDelete:0 },
    },
  };

  // GET /api/my-permissions — returns merged (default + custom) permissions for current user
  app.get("/api/my-permissions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
      // Superadmin/partner bypass — return all-access
      if (currentUser.systemRole === "superadmin" || currentUser.systemRole === "partner") {
        return res.json(DEFAULT_PERMISSIONS.admin);
      }
      const role = (currentUser.role || 'tecnico') as string;
      const defaults = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.tecnico;
      // Try to find tenant-specific overrides
      const tenant = await storage.getTenantByUserId(currentUser.id);
      if (!tenant) return res.json(defaults);
      const customPerms = await storage.getRolePermissions(tenant.id);
      const rolePerms = customPerms.filter(p => p.role === role);
      if (rolePerms.length === 0) return res.json(defaults);
      // Merge: custom overrides defaults
      const merged = { ...defaults };
      for (const p of rolePerms) {
        merged[p.module] = { canView: p.canView ?? 0, canCreate: p.canCreate ?? 0, canEdit: p.canEdit ?? 0, canDelete: p.canDelete ?? 0 };
      }
      res.json(merged);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  // GET /api/tenants/:id/permissions — get all permissions for a tenant (for admin config page)
  app.get("/api/tenants/:id/permissions", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
      const isSuperadmin = currentUser.systemRole === "superadmin";
      const isTenantAdmin = currentUser.systemRole === "tenant_admin";
      if (!isSuperadmin && !isTenantAdmin) return res.status(403).json({ message: "Forbidden" });
      const customPerms = await storage.getRolePermissions(req.params.id);
      // Return full matrix merging defaults with custom
      const result: Record<string, Record<string, any>> = {};
      for (const role of ['admin','gerente','tecnico']) {
        result[role] = {};
        const defaults = DEFAULT_PERMISSIONS[role] || {};
        for (const module of ALL_MODULES) {
          const custom = customPerms.find(p => p.role === role && p.module === module);
          result[role][module] = custom
            ? { canView: custom.canView, canCreate: custom.canCreate, canEdit: custom.canEdit, canDelete: custom.canDelete }
            : (defaults[module] || { canView:0, canCreate:0, canEdit:0, canDelete:0 });
        }
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching tenant permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  // PUT /api/tenants/:id/permissions — bulk upsert permissions
  app.put("/api/tenants/:id/permissions", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(getAuthUserId(req));
      if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
      const isSuperadmin = currentUser.systemRole === "superadmin";
      const isTenantAdmin = currentUser.systemRole === "tenant_admin";
      if (!isSuperadmin && !isTenantAdmin) return res.status(403).json({ message: "Forbidden" });
      const { permissions } = req.body; // { role: { module: { canView, canCreate, canEdit, canDelete } } }
      const items: any[] = [];
      for (const [role, mods] of Object.entries(permissions as Record<string, any>)) {
        for (const [module, perms] of Object.entries(mods as Record<string, any>)) {
          items.push({ role, module, canView: perms.canView ? 1 : 0, canCreate: perms.canCreate ? 1 : 0, canEdit: perms.canEdit ? 1 : 0, canDelete: perms.canDelete ? 1 : 0 });
        }
      }
      await storage.upsertRolePermissions(req.params.id, items);
      res.json({ message: "Permissions updated" });
    } catch (error) {
      console.error("Error updating permissions:", error);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });

  // ───────────────── Knowledge Brain (RAG) + Agents ─────────────────
  const { db } = await import("./db");
  const { brainCategories, brainItems, agentLogs, insertBrainCategorySchema, insertBrainItemSchema } =
    await import("@shared/schema");
  const { eq, or, isNull, desc, and, sql: dsql } = await import("drizzle-orm");
  const { generateEmbedding, searchKnowledge } = await import("./embeddingService");
  const { runAgent, AGENT_REGISTRY } = await import("./agentService");

  function brainTenantFilter(req: any) {
    return req.tenantId
      ? or(isNull(brainItems.tenantId), eq(brainItems.tenantId, req.tenantId))
      : isNull(brainItems.tenantId);
  }

  // Resolve the tenantId to write to. Non-superadmins are pinned to their own
  // tenant — they cannot create global items or items in other tenants.
  function resolveWriteTenantId(req: any): string | null {
    if (req.isSuperadmin) {
      // Superadmin may explicitly target a tenant, or null (global)
      return req.body.tenantId === undefined ? (req.tenantId ?? null) : (req.body.tenantId ?? null);
    }
    if (!req.tenantId) {
      throw new Error("Tenant context required");
    }
    return req.tenantId;
  }

  // Returns true if the current request can mutate `row` (by tenant scope).
  function canMutateBrainRow(req: any, row: { tenantId?: string | null } | null): boolean {
    if (!row) return false;
    if (req.isSuperadmin) return true;
    if (row.tenantId === null || row.tenantId === undefined) return false; // globals are read-only for non-superadmin
    return row.tenantId === req.tenantId;
  }

  // List categories (tenant + globals)
  app.get("/api/brain/categories", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const where = req.tenantId
        ? or(isNull(brainCategories.tenantId), eq(brainCategories.tenantId, req.tenantId))
        : isNull(brainCategories.tenantId);
      const rows = await db.select().from(brainCategories).where(where).orderBy(brainCategories.name);
      res.json(rows);
    } catch (err: any) {
      console.error("[brain] categories list error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/brain/categories", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = resolveWriteTenantId(req);
      const data = insertBrainCategorySchema.parse({ ...req.body, tenantId });
      const [row] = await db.insert(brainCategories).values(data).returning();
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[brain] category create error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/brain/categories/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [row] = await db.select().from(brainCategories).where(eq(brainCategories.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Not found" });
      if (!canMutateBrainRow(req, row)) return res.status(403).json({ message: "Forbidden" });
      await db.delete(brainCategories).where(eq(brainCategories.id, req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List brain items (tenant + globals), optional category/type/q filter
  app.get("/api/brain/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantWhere = brainTenantFilter(req);
      const conds: any[] = [];
      if (tenantWhere) conds.push(tenantWhere);
      if (req.query.categoryId) conds.push(eq(brainItems.categoryId, String(req.query.categoryId)));
      if (req.query.type) conds.push(eq(brainItems.type, String(req.query.type)));
      const whereExpr = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

      const rows = whereExpr
        ? await db.select().from(brainItems).where(whereExpr).orderBy(desc(brainItems.updatedAt)).limit(500)
        : await db.select().from(brainItems).orderBy(desc(brainItems.updatedAt)).limit(500);
      // Strip embeddings to keep payload light
      const stripped = rows.map((r: any) => ({ ...r, embedding: undefined }));
      res.json(stripped);
    } catch (err: any) {
      console.error("[brain] items list error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Schedule a fire-and-forget embedding refresh that won't overwrite a newer version.
  function scheduleEmbedding(row: { id: string; title: string; content: string; tags: string | null; updatedAt: Date | null }) {
    const textForEmb = `${row.title}\n\n${row.content}\n\nTags: ${row.tags || ""}`;
    const snapshot = row.updatedAt;
    generateEmbedding(textForEmb)
      .then(async (emb) => {
        await db
          .update(brainItems)
          .set({
            embedding: emb.vector as any,
            embeddingProvider: emb.provider,
            embeddingDim: emb.dim,
          })
          .where(
            snapshot
              ? and(eq(brainItems.id, row.id), eq(brainItems.updatedAt, snapshot))
              : eq(brainItems.id, row.id),
          );
      })
      .catch((err) => console.warn("[brain] embedding failed for", row.id, err.message));
  }

  app.post("/api/brain/items", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = resolveWriteTenantId(req);
      const data = insertBrainItemSchema.parse({
        ...req.body,
        tenantId,
        createdBy: getAuthUserId(req),
      });
      const [created] = await db.insert(brainItems).values(data).returning();
      scheduleEmbedding(created as any);
      const { embedding, ...stripped } = created as any;
      res.status(201).json(stripped);
    } catch (err: any) {
      console.error("[brain] item create error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // Whitelist of mutable fields on PATCH — prevents tenantId/createdBy/embedding tampering.
  const brainItemPatchSchema = (await import("zod")).z.object({
    type: (await import("zod")).z.string().min(1).optional(),
    title: (await import("zod")).z.string().min(1).optional(),
    content: (await import("zod")).z.string().min(1).optional(),
    tags: (await import("zod")).z.string().nullable().optional(),
    categoryId: (await import("zod")).z.string().nullable().optional(),
  });

  app.patch("/api/brain/items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(brainItems).where(eq(brainItems.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!canMutateBrainRow(req, existing)) return res.status(403).json({ message: "Forbidden" });

      const patch = brainItemPatchSchema.parse(req.body);
      const [updated] = await db
        .update(brainItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(brainItems.id, req.params.id))
        .returning();

      if (patch.title || patch.content || patch.tags !== undefined) {
        scheduleEmbedding(updated as any);
      }
      const { embedding, ...stripped } = updated as any;
      res.json(stripped);
    } catch (err: any) {
      console.error("[brain] item patch error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/brain/items/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(brainItems).where(eq(brainItems.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!canMutateBrainRow(req, existing)) return res.status(403).json({ message: "Forbidden" });
      await db.delete(brainItems).where(eq(brainItems.id, req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Reindex (re-embed) all items the caller can see
  app.post("/api/brain/reindex", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantWhere = brainTenantFilter(req);
      const rows = tenantWhere
        ? await db.select().from(brainItems).where(tenantWhere)
        : await db.select().from(brainItems);
      let ok = 0;
      let failed = 0;
      for (const r of rows as any[]) {
        try {
          const textForEmb = `${r.title}\n\n${r.content}\n\nTags: ${r.tags || ""}`;
          const emb = await generateEmbedding(textForEmb);
          await db
            .update(brainItems)
            .set({
              embedding: emb.vector as any,
              embeddingProvider: emb.provider,
              embeddingDim: emb.dim,
            })
            .where(eq(brainItems.id, r.id));
          ok++;
        } catch {
          failed++;
        }
      }
      res.json({ total: rows.length, ok, failed });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Direct knowledge search (debug / preview)
  app.post("/api/brain/search", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { query, topK } = req.body || {};
      if (!query) return res.status(400).json({ message: "query is required" });
      const matches = await searchKnowledge(query, { tenantId: req.tenantId, topK });
      res.json(matches);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Run an agent (RAG + Claude). Supports built-in agents OR a customAgentId.
  app.post("/api/agents/run", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { agentType, prompt, projectId, useKnowledge, topK, systemPromptOverride, customAgentId } = req.body || {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "prompt is required" });
      }

      // Custom agent path
      if (customAgentId) {
        const { agentDefinitions } = await import("@shared/schema");
        const [def] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, customAgentId));
        if (!def) return res.status(404).json({ message: "Custom agent not found" });
        if (def.tenantId && def.tenantId !== req.tenantId && !req.isSuperadmin) {
          return res.status(403).json({ message: "Forbidden" });
        }
        if (projectId) {
          const project = await storage.getProject(projectId);
          if (!project) return res.status(404).json({ message: "Project not found" });
          if (!req.isSuperadmin && project.tenantId && project.tenantId !== req.tenantId) {
            return res.status(403).json({ message: "Forbidden: project belongs to another tenant" });
          }
        }
        const { runCustomAgent } = await import("./agentService");
        const result = await runCustomAgent({
          def,
          projectId: projectId ?? null,
          tenantId: req.tenantId ?? null,
          userId: getAuthUserId(req),
          prompt,
        });
        return res.json(result);
      }

      const result = await runAgent({
        agentType: agentType || "generic",
        prompt,
        projectId: projectId ?? null,
        tenantId: req.tenantId ?? null,
        userId: getAuthUserId(req),
        useKnowledge,
        topK,
        systemPromptOverride,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[agent] run error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/types", isAuthenticated, (_req, res) => {
    res.json(
      Object.values(AGENT_REGISTRY).map((a) => ({ type: a.type })),
    );
  });

  app.get("/api/agents/logs", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const where = req.tenantId
        ? eq(agentLogs.tenantId, req.tenantId)
        : isNull(agentLogs.tenantId);
      const rows = await db
        .select()
        .from(agentLogs)
        .where(where)
        .orderBy(desc(agentLogs.createdAt))
        .limit(100);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── AGENT DEFINITIONS (custom agent CRUD) ─────────────────────────
  const { agentDefinitions, agentDefinitionVersions, insertAgentDefinitionSchema, webCredentials, browserSkills } = await import("@shared/schema");
  const { z: zAgent } = await import("zod");
  const { toolRegistry: agentToolRegistry } = await import("./mcp/toolRegistry");

  const automationTriggerSchema = zAgent.object({
    id: zAgent.string().optional(),
    label: zAgent.string(),
    cron: zAgent.string(),
    skillName: zAgent.string(),
    active: zAgent.boolean(),
  });

  const agentDefPatchSchema = zAgent.object({
    name: zAgent.string().min(1).max(100).optional(),
    description: zAgent.string().nullable().optional(),
    slug: zAgent.string().min(1).max(80).optional(),
    systemPrompt: zAgent.string().min(1).optional(),
    contextModules: zAgent.array(zAgent.string()).optional(),
    visibleIn: zAgent.array(zAgent.string()).optional(),
    maxTokens: zAgent.number().int().min(200).max(8000).optional(),
    isActive: zAgent.number().int().min(0).max(1).optional(),
    b2cAvailable: zAgent.number().int().min(0).max(1).optional(),
    // Capacidades (Sprint Agent-Builder-V2) — todos opcionais p/ retrocompat
    allowedTools: zAgent.array(zAgent.string()).optional(),
    linkedCredentialIds: zAgent.array(zAgent.string()).optional(),
    enabledSkillNames: zAgent.array(zAgent.string()).optional(),
    llmModelOverride: zAgent.string().max(100).nullable().optional(),
    requiredApprovals: zAgent.array(zAgent.string()).optional(),
    allowedRoles: zAgent.array(zAgent.string()).optional(),
    automationTriggers: zAgent.array(automationTriggerSchema).optional(),
  });

  function canMutateAgentDef(req: any, row: { tenantId?: string | null } | null): boolean {
    if (!row) return false;
    if (req.isSuperadmin) return true;
    if (!row.tenantId) return false; // global = read-only for non-superadmin
    return row.tenantId === req.tenantId;
  }

  app.get("/api/agent-definitions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantClause = req.tenantId
        ? or(isNull(agentDefinitions.tenantId), eq(agentDefinitions.tenantId, req.tenantId))
        : isNull(agentDefinitions.tenantId);
      // Filtros opcionais por pack/category (Task #54 — AgentPickerForBi)
      const pack = typeof req.query.pack === "string" ? req.query.pack : null;
      const category = typeof req.query.category === "string" ? req.query.category : null;
      // Filtro opcional ?b2c=true — apenas agentes liberados para o cliente final
      const b2cOnly = req.query.b2c === "true" || req.query.b2c === "1";
      const clauses: any[] = [tenantClause];
      if (pack) clauses.push(eq(agentDefinitions.pack, pack));
      if (category) clauses.push(eq(agentDefinitions.category, category));
      if (b2cOnly) clauses.push(eq(agentDefinitions.b2cAvailable, 1));
      const where = clauses.length === 1 ? clauses[0] : and(...clauses);
      const rows = await db.select().from(agentDefinitions).where(where).orderBy(desc(agentDefinitions.createdAt));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Recursos disponíveis para configurar um agente (credenciais, skills, tools MCP).
  // Registrada ANTES de /:id para não ser capturada como id.
  app.get("/api/agent-definitions/resources", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [credentials, skills] = await Promise.all([
        db
          .select({ id: webCredentials.id, name: webCredentials.name, system: webCredentials.system, loginUrl: webCredentials.url })
          .from(webCredentials)
          .where(eq(webCredentials.tenantId, req.tenantId)),
        db
          .select({ id: browserSkills.id, name: browserSkills.name, title: browserSkills.title, scope: browserSkills.scope, systemSlug: browserSkills.systemSlug })
          .from(browserSkills)
          .where(and(
            eq(browserSkills.status, "active"),
            or(isNull(browserSkills.tenantId), eq(browserSkills.tenantId, req.tenantId), eq(browserSkills.scope, "system")),
          )),
      ]);
      const mcpTools = agentToolRegistry
        .listForAgent(req.tenantId)
        .map((t: any) => ({ name: t.name, description: t.description, module: t.module }));
      res.json({ credentials, skills, mcpTools });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agent-definitions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [row] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Not found" });
      if (row.tenantId && row.tenantId !== req.tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-definitions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = resolveWriteTenantId(req);
      const data = insertAgentDefinitionSchema.parse({
        ...req.body,
        tenantId,
        createdBy: getAuthUserId(req),
      });
      const [row] = await db.insert(agentDefinitions).values(data).returning();
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[agent-defs] create error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // Snapshot with retry on UNIQUE(agent_definition_id, version_number) conflict
  async function snapshotAgentDef(defId: string, def: any, userId: string | null, note?: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const [last] = await db
        .select({ v: agentDefinitionVersions.versionNumber })
        .from(agentDefinitionVersions)
        .where(eq(agentDefinitionVersions.agentDefinitionId, defId))
        .orderBy(desc(agentDefinitionVersions.versionNumber))
        .limit(1);
      const nextVersion = (last?.v ?? 0) + 1;
      try {
        await db.insert(agentDefinitionVersions).values({
          agentDefinitionId: defId,
          versionNumber: nextVersion,
          snapshot: def,
          changedBy: userId,
          changeNote: note ?? null,
        });
        return nextVersion;
      } catch (e: any) {
        // 23505 = unique_violation — concurrent snapshot used the same number; retry
        if (e?.code === "23505" && attempt < 4) continue;
        throw e;
      }
    }
    throw new Error("snapshotAgentDef: exceeded retry budget");
  }

  app.patch("/api/agent-definitions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!canMutateAgentDef(req, existing)) return res.status(403).json({ message: "Forbidden" });
      const { changeNote, ...rawPatch } = (req.body || {}) as any;
      const patch = agentDefPatchSchema.parse(rawPatch);
      // Save snapshot of previous state BEFORE applying changes
      await snapshotAgentDef(existing.id, existing, getAuthUserId(req), typeof changeNote === "string" ? changeNote : undefined);
      const [updated] = await db
        .update(agentDefinitions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(agentDefinitions.id, req.params.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[agent-defs] patch error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // Fork a global agent into the current tenant (creates an editable copy)
  app.post("/api/agent-definitions/:id/fork", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant context required to fork" });
      const [source] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!source) return res.status(404).json({ message: "Source agent not found" });
      // Allow forking globals OR another tenant's agent only if superadmin
      if (source.tenantId && source.tenantId !== tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Avoid duplicate fork — fast-path check, then insert protected by UNIQUE(tenant_id, parent_definition_id)
      const findExisting = async () => {
        const [row] = await db
          .select()
          .from(agentDefinitions)
          .where(and(eq(agentDefinitions.tenantId, tenantId), eq(agentDefinitions.parentDefinitionId, source.id)))
          .limit(1);
        return row;
      };
      const existingFork = await findExisting();
      if (existingFork) return res.json(existingFork);
      let forked: any;
      try {
        [forked] = await db
          .insert(agentDefinitions)
          .values({
            tenantId,
            parentDefinitionId: source.id,
            name: `${source.name} (customizado)`,
            description: source.description,
            slug: source.slug,
            systemPrompt: source.systemPrompt,
            contextModules: source.contextModules ?? [],
            visibleIn: source.visibleIn ?? [],
            maxTokens: source.maxTokens,
            isActive: source.isActive,
            pack: source.pack,
            category: source.category,
            biWidget: source.biWidget,
            biMetricIds: source.biMetricIds ?? [],
            b2cAvailable: source.b2cAvailable,
            // Capacidades (Sprint Agent-Builder-V2) — preservar no fork
            allowedTools: source.allowedTools ?? [],
            linkedCredentialIds: source.linkedCredentialIds ?? [],
            enabledSkillNames: source.enabledSkillNames ?? [],
            llmModelOverride: source.llmModelOverride ?? null,
            requiredApprovals: source.requiredApprovals ?? [],
            allowedRoles: source.allowedRoles ?? [],
            automationTriggers: source.automationTriggers ?? [],
            createdBy: getAuthUserId(req),
          })
          .returning();
      } catch (e: any) {
        // Concurrent fork: UNIQUE violation → fetch the winner and return it (idempotent)
        if (e?.code === "23505") {
          const winner = await findExisting();
          if (winner) return res.json(winner);
        }
        throw e;
      }
      // Initial version snapshot
      await snapshotAgentDef(forked.id, forked, getAuthUserId(req), "Fork inicial");
      res.status(201).json(forked);
    } catch (err: any) {
      console.error("[agent-defs] fork error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // List versions of an agent definition (tenant-scoped check)
  app.get("/api/agent-definitions/:id/versions", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [def] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!def) return res.status(404).json({ message: "Not found" });
      if (def.tenantId && def.tenantId !== req.tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const rows = await db
        .select()
        .from(agentDefinitionVersions)
        .where(eq(agentDefinitionVersions.agentDefinitionId, def.id))
        .orderBy(desc(agentDefinitionVersions.versionNumber));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Restore the agent definition to the snapshot of a given version (creates a new version with current state first)
  app.post("/api/agent-definitions/:id/restore/:versionId", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!canMutateAgentDef(req, existing)) return res.status(403).json({ message: "Forbidden" });
      const [version] = await db
        .select()
        .from(agentDefinitionVersions)
        .where(and(
          eq(agentDefinitionVersions.id, req.params.versionId),
          eq(agentDefinitionVersions.agentDefinitionId, existing.id),
        ));
      if (!version) return res.status(404).json({ message: "Version not found" });
      const snap = version.snapshot as any;
      // Snapshot current state before restore
      await snapshotAgentDef(existing.id, existing, getAuthUserId(req), `Restaurando v${version.versionNumber}`);
      const [updated] = await db
        .update(agentDefinitions)
        .set({
          name: snap.name,
          description: snap.description ?? null,
          slug: snap.slug ?? existing.slug,
          systemPrompt: snap.systemPrompt,
          contextModules: snap.contextModules ?? [],
          visibleIn: snap.visibleIn ?? [],
          maxTokens: snap.maxTokens ?? 2000,
          isActive: snap.isActive ?? 1,
          // Capacidades (Sprint Agent-Builder-V2) — restaurar do snapshot
          allowedTools: snap.allowedTools ?? [],
          linkedCredentialIds: snap.linkedCredentialIds ?? [],
          enabledSkillNames: snap.enabledSkillNames ?? [],
          llmModelOverride: snap.llmModelOverride ?? null,
          requiredApprovals: snap.requiredApprovals ?? [],
          allowedRoles: snap.allowedRoles ?? [],
          automationTriggers: snap.automationTriggers ?? [],
          updatedAt: new Date(),
        })
        .where(eq(agentDefinitions.id, existing.id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      console.error("[agent-defs] restore error:", err);
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/agent-definitions/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!canMutateAgentDef(req, existing)) return res.status(403).json({ message: "Forbidden" });
      await db.delete(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Test a custom agent without persisting log permanently (still logs but with status='test')
  app.post("/api/agent-definitions/:id/test", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const [def] = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, req.params.id));
      if (!def) return res.status(404).json({ message: "Not found" });
      if (def.tenantId && def.tenantId !== req.tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { prompt, projectId } = req.body || {};
      if (!prompt) return res.status(400).json({ message: "prompt is required" });
      if (projectId) {
        const project = await storage.getProject(projectId);
        if (!project) return res.status(404).json({ message: "Project not found" });
        if (!req.isSuperadmin && project.tenantId && project.tenantId !== req.tenantId) {
          return res.status(403).json({ message: "Forbidden: project belongs to another tenant" });
        }
      }
      const { runCustomAgent } = await import("./agentService");
      const result = await runCustomAgent({
        def,
        projectId: projectId ?? null,
        tenantId: req.tenantId ?? null,
        userId: getAuthUserId(req),
        prompt,
        isTest: true,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[agent-defs] test error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Phase 13 — BI Builder (metrics catalog, dashboards CRUD,
  // SQL agent + saved queries)
  // ════════════════════════════════════════════════════════════════
  {
    const { getMetricCatalog, runMetric, METRIC_CATALOG } = await import("./biMetrics");
    const { executeSandboxQuery, SandboxError } = await import("./sqlSandbox");
    const { sqlQueries, biDashboards, insertBiDashboardSchema } = await import("@shared/schema");
    const { and, eq: sqlEq, desc, sql } = await import("drizzle-orm");

    // Metric catalog
    app.get("/api/bi/metrics-catalog", isAuthenticated, requireTenant, async (_req, res) => {
      res.json(getMetricCatalog());
    });

    // Dashboards CRUD (must be registered BEFORE the generic :metricKey route)
    app.get("/api/bi/dashboards", isAuthenticated, requireTenant, async (req: any, res) => {
      // Superadmin sem tenant ativo: usa arcadiaTenantId via query ou primeiro tenant
      let tenantId = req.tenantId;
      if (!tenantId && req.isSuperadmin) {
        const qTid = (req.query?.arcadiaTenantId as string) || undefined;
        if (qTid) {
          tenantId = qTid;
        } else {
          const t: any = await db.execute(sql`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
          tenantId = (t.rows ?? t)[0]?.id ?? null;
        }
      }
      if (!tenantId) return res.json([]);
      const rows = await db.select().from(biDashboards)
        .where(sqlEq(biDashboards.tenantId, tenantId))
        .orderBy(desc(biDashboards.isDefault), desc(biDashboards.updatedAt));
      res.json(rows);
    });

    app.post("/api/bi/dashboards", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        // Superadmin: aceita tenantId via body.arcadiaTenantId; fallback para primeiro tenant
        let tenantId = req.tenantId;
        if (!tenantId && req.isSuperadmin) {
          if (req.body?.arcadiaTenantId) {
            tenantId = String(req.body.arcadiaTenantId);
          } else {
            const t: any = await db.execute(sql`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
            tenantId = (t.rows ?? t)[0]?.id ?? null;
          }
        }
        if (!tenantId) return res.status(400).json({ message: "Tenant required" });
        const userId = getAuthUserId(req);
        const parsed = insertBiDashboardSchema.parse({
          ...req.body,
          tenantId,
          ownerId: userId,
        });
        const [row] = await db.insert(biDashboards).values(parsed).returning();
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ message: err.message });
      }
    });

    app.patch("/api/bi/dashboards/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        const [existing] = await db.select().from(biDashboards)
          .where(sqlEq(biDashboards.id, req.params.id));
        if (!existing) return res.status(404).json({ message: "Not found" });
        if (existing.tenantId !== tenantId && !req.isSuperadmin) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const patch: any = {};
        if (req.body.name !== undefined) patch.name = req.body.name;
        if (req.body.layout !== undefined) patch.layout = req.body.layout;
        if (req.body.isDefault !== undefined) patch.isDefault = req.body.isDefault;
        if (req.body.filters !== undefined) patch.filters = req.body.filters;
        patch.updatedAt = new Date();
        const [row] = await db.update(biDashboards).set(patch)
          .where(sqlEq(biDashboards.id, req.params.id)).returning();
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ message: err.message });
      }
    });

    app.delete("/api/bi/dashboards/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const tenantId = req.tenantId;
      const [existing] = await db.select().from(biDashboards)
        .where(sqlEq(biDashboards.id, req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (existing.tenantId !== tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await db.delete(biDashboards).where(sqlEq(biDashboards.id, req.params.id));
      res.json({ ok: true });
    });

    // ───────────────────────────────────────────────────────────────
    //  Phase 3 — BI Multi-Fonte (Semantic Layer + analytics schema)
    // ───────────────────────────────────────────────────────────────
    {
      const semanticMod = await import("./bi/semantic");
      const etlMod = await import("./bi/etl/runEtl");

      app.get("/api/bi/semantic/catalog", isAuthenticated, requireTenant, async (_req: any, res) => {
        res.json(semanticMod.listSemanticMetrics());
      });

      app.get("/api/bi/semantic/dimensions", isAuthenticated, requireTenant, async (_req: any, res) => {
        res.json(semanticMod.listSemanticDimensions());
      });

      app.post("/api/bi/semantic/run", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          let tenantId = req.tenantId;
          // Superadmin: 1) body.arcadiaTenantId tem prioridade; 2) primeiro tenant como fallback
          if (req.isSuperadmin && req.body?.arcadiaTenantId) {
            tenantId = String(req.body.arcadiaTenantId);
          } else if (!tenantId && req.isSuperadmin) {
            const { db } = await import("./db");
            const { sql: ds } = await import("drizzle-orm");
            const t: any = await db.execute(ds`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
            tenantId = (t.rows ?? t)[0]?.id ?? null;
          }
          if (!tenantId) return res.status(400).json({ message: "Tenant required" });
          const metricId = String(req.body?.metricId || "").trim();
          if (!metricId) return res.status(400).json({ message: "metricId required" });
          const sources = Array.isArray(req.body?.sources)
            ? req.body.sources.filter((s: any) => typeof s === "string").slice(0, 16)
            : [];
          const filters = req.body?.filters || {};
          const result = await semanticMod.runSemanticMetric(metricId, {
            tenantId,
            sources: sources.length ? sources : undefined,
            startDate: typeof filters.startDate === "string" ? filters.startDate : undefined,
            endDate:   typeof filters.endDate   === "string" ? filters.endDate   : undefined,
            clientNaturalKey: typeof filters.clientNaturalKey === "string" ? filters.clientNaturalKey : undefined,
          });
          res.json(result);
        } catch (err: any) {
          console.error("[bi/semantic/run]", err);
          res.status(400).json({ message: err?.message || "Erro" });
        }
      });

      // ── BI Alerts CRUD + runner ─────────────────────────────────
      app.get("/api/bi/alerts", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          const { biAlerts } = await import("@shared/schema");
          const { db } = await import("./db");
          const { eq, desc } = await import("drizzle-orm");
          const rows = await db.select().from(biAlerts)
            .where(eq(biAlerts.tenantId, req.tenantId))
            .orderBy(desc(biAlerts.createdAt));
          res.json(rows);
        } catch (err: any) {
          console.error("[bi/alerts list]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.post("/api/bi/alerts", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          const { biAlerts, insertBiAlertSchema } = await import("@shared/schema");
          const { db } = await import("./db");
          const parsed = insertBiAlertSchema.safeParse({
            ...req.body,
            tenantId: req.tenantId,
            createdById: req.user?.id,
          });
          if (!parsed.success) {
            return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });
          }
          const [row] = await db.insert(biAlerts).values(parsed.data).returning();
          res.status(201).json(row);
        } catch (err: any) {
          console.error("[bi/alerts create]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.patch("/api/bi/alerts/:id", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          const { biAlerts } = await import("@shared/schema");
          const { db } = await import("./db");
          const { eq, and } = await import("drizzle-orm");
          const allowed: any = {};
          for (const k of ["name", "metricId", "condition", "threshold", "isActive", "notifyChannels"]) {
            if (req.body[k] !== undefined) allowed[k] = req.body[k];
          }
          allowed.updatedAt = new Date();
          const [row] = await db.update(biAlerts).set(allowed)
            .where(and(eq(biAlerts.id, req.params.id), eq(biAlerts.tenantId, req.tenantId)))
            .returning();
          if (!row) return res.status(404).json({ message: "Não encontrado" });
          res.json(row);
        } catch (err: any) {
          console.error("[bi/alerts update]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.delete("/api/bi/alerts/:id", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          const { biAlerts } = await import("@shared/schema");
          const { db } = await import("./db");
          const { eq, and } = await import("drizzle-orm");
          await db.delete(biAlerts)
            .where(and(eq(biAlerts.id, req.params.id), eq(biAlerts.tenantId, req.tenantId)));
          res.status(204).end();
        } catch (err: any) {
          console.error("[bi/alerts delete]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.post("/api/bi/alerts/run", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          const { runBiAlerts } = await import("./bi/alertsRunner");
          const out = await runBiAlerts(req.tenantId);
          res.json(out);
        } catch (err: any) {
          console.error("[bi/alerts/run]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.post("/api/bi/etl/run", isAuthenticated, requireTenantAdminOrPartner, async (req: any, res) => {
        try {
          const tenantId = req.tenantId;
          if (!tenantId) return res.status(400).json({ message: "Tenant required" });
          const out = await etlMod.runEtl(tenantId);
          res.json(out);
        } catch (err: any) {
          console.error("[bi/etl/run]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.get("/api/bi/etl/runs", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          if (!req.tenantId) return res.json([]);
          const rows = await etlMod.listEtlRuns(req.tenantId);
          res.json(rows);
        } catch (err: any) {
          console.error("[bi/etl/runs]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.get("/api/bi/migration-monitor", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          if (!req.tenantId) return res.json([]);
          const rows = await etlMod.listMigrationState(req.tenantId);
          res.json(rows);
        } catch (err: any) {
          console.error("[bi/migration-monitor]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });

      app.get("/api/bi/data-quality", isAuthenticated, requireTenant, async (req: any, res) => {
        try {
          if (!req.tenantId) return res.json([]);
          const rows = await etlMod.listDqFindings(req.tenantId);
          res.json(rows);
        } catch (err: any) {
          console.error("[bi/data-quality]", err);
          res.status(500).json({ message: err?.message || "Erro" });
        }
      });
    }

    // Run a single internal metric: /api/bi/projects-by-status (kept LAST in /api/bi/*)
    app.get("/api/bi/:metricKey", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const key = String(req.params.metricKey).replace(/-/g, "_");
        if (!METRIC_CATALOG.find((m) => m.key === key)) {
          return res.status(404).json({ message: "Unknown metric" });
        }
        const tenantId = req.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant required" });
        const filters = {
          startDate: req.query.startDate ? String(req.query.startDate) : undefined,
          endDate:   req.query.endDate   ? String(req.query.endDate)   : undefined,
          clientId:  req.query.clientId  ? String(req.query.clientId)  : undefined,
          projectId: req.query.projectId ? String(req.query.projectId) : undefined,
          status:    req.query.status    ? String(req.query.status)    : undefined,
        };
        const data = await runMetric(key, tenantId, filters);
        res.json(data);
      } catch (err: any) {
        console.error("[bi] metric error:", err);
        res.status(500).json({ message: err.message });
      }
    });

    // ── DASHBOARD SHARES (Phase 3b — F3) ──────────────────────────
    const { dashboardShares } = await import("@shared/schema");
    const { randomBytes } = await import("crypto");
    const bcrypt = (await import("bcryptjs")).default;

    // Create a public share link
    app.post("/api/bi/dashboards/:id/share", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const [dash] = await db.select().from(biDashboards)
          .where(and(sqlEq(biDashboards.id, req.params.id), sqlEq(biDashboards.tenantId, req.tenantId)));
        if (!dash) return res.status(404).json({ message: "Dashboard não encontrado" });

        const { password, expiresInDays } = req.body || {};
        const token = randomBytes(32).toString("hex");
        const expiresAt = expiresInDays
          ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
          : null;
        const passwordHash = password ? await bcrypt.hash(String(password), 10) : null;

        const [share] = await db.insert(dashboardShares).values({
          tenantId: req.tenantId,
          dashboardId: req.params.id,
          token,
          passwordHash: passwordHash ?? undefined,
          expiresAt: expiresAt ?? undefined,
          createdById: getAuthUserId(req),
        }).returning();

        res.json({
          token: share.token,
          url: `/bi/public/${share.token}`,
          expiresAt: share.expiresAt,
          hasPassword: !!password,
        });
      } catch (err: any) {
        console.error("[bi-share] create error:", err);
        res.status(500).json({ message: err.message });
      }
    });

    // List shares of a dashboard
    app.get("/api/bi/dashboards/:id/shares", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const rows = await db.select({
          id: dashboardShares.id,
          token: dashboardShares.token,
          expiresAt: dashboardShares.expiresAt,
          viewCount: dashboardShares.viewCount,
          lastViewedAt: dashboardShares.lastViewedAt,
          isActive: dashboardShares.isActive,
          createdAt: dashboardShares.createdAt,
          hasPassword: sql<boolean>`(password_hash IS NOT NULL)`,
        }).from(dashboardShares)
          .where(and(
            sqlEq(dashboardShares.dashboardId, req.params.id),
            sqlEq(dashboardShares.tenantId, req.tenantId),
          ));
        res.json(rows);
      } catch (err: any) {
        console.error("[bi-share] list error:", err);
        res.status(500).json({ message: err.message });
      }
    });

    // Revoke a share link
    app.delete("/api/bi/shares/:token", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        await db.update(dashboardShares)
          .set({ isActive: 0 })
          .where(and(
            sqlEq(dashboardShares.token, req.params.token),
            sqlEq(dashboardShares.tenantId, req.tenantId),
          ));
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[bi-share] revoke error:", err);
        res.status(500).json({ message: err.message });
      }
    });

    // Public dashboard endpoint — NO auth.
    app.get("/api/bi/public/:token", async (req: any, res) => {
      try {
        const [share] = await db.select().from(dashboardShares)
          .where(sqlEq(dashboardShares.token, req.params.token));
        if (!share || share.isActive === 0) return res.status(404).json({ error: "Link não encontrado" });
        if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
          return res.status(410).json({ error: "Link expirado" });
        }
        if (share.passwordHash) {
          const provided = req.headers["x-share-password"];
          if (!provided) return res.status(401).json({ error: "Senha necessária" });
          const ok = await bcrypt.compare(String(provided), share.passwordHash);
          if (!ok) return res.status(403).json({ error: "Senha incorreta" });
        }
        const [dash] = await db.select().from(biDashboards)
          .where(sqlEq(biDashboards.id, share.dashboardId));
        if (!dash) return res.status(404).json({ error: "Dashboard não encontrado" });

        // Track view
        await db.update(dashboardShares)
          .set({ viewCount: (share.viewCount || 0) + 1, lastViewedAt: new Date() })
          .where(sqlEq(dashboardShares.id, share.id));

        res.json({
          dashboard: {
            name: dash.name,
            layout: dash.layout || [],
            filters: dash.filters || { enabledFilters: [] },
          },
          tenantId: share.tenantId,
        });
      } catch (err: any) {
        console.error("[bi-share] public error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // Public metric proxy — uses tenant from share token, no user session.
    // Restricted to metric keys actually present in the shared dashboard's layout
    // so a token cannot be used to query arbitrary tenant metrics.
    app.get("/api/bi/public/:token/metrics/:metricKey", async (req: any, res) => {
      try {
        const [share] = await db.select().from(dashboardShares)
          .where(sqlEq(dashboardShares.token, req.params.token));
        if (!share || share.isActive === 0) return res.status(404).json({ error: "Link não encontrado" });
        if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
          return res.status(410).json({ error: "Link expirado" });
        }
        if (share.passwordHash) {
          const provided = req.headers["x-share-password"];
          if (!provided) return res.status(401).json({ error: "Senha necessária" });
          const ok = await bcrypt.compare(String(provided), share.passwordHash);
          if (!ok) return res.status(403).json({ error: "Senha incorreta" });
        }
        const key = String(req.params.metricKey).replace(/-/g, "_");
        if (!METRIC_CATALOG.find((m) => m.key === key)) {
          return res.status(404).json({ error: "Unknown metric" });
        }
        // Allowlist: extract metric keys from the shared dashboard's layout.
        const [dash] = await db.select().from(biDashboards)
          .where(sqlEq(biDashboards.id, share.dashboardId));
        if (!dash) return res.status(404).json({ error: "Dashboard não encontrado" });
        const layout = Array.isArray(dash.layout) ? (dash.layout as any[]) : [];
        const allowed = new Set<string>();
        for (const w of layout) {
          if (w?.metricKey) allowed.add(String(w.metricKey));
          if (Array.isArray(w?.metricKeys)) for (const k of w.metricKeys) allowed.add(String(k));
        }
        if (!allowed.has(key)) {
          return res.status(403).json({ error: "Métrica não compartilhada por este dashboard" });
        }
        const filters = {
          startDate: req.query.startDate ? String(req.query.startDate) : undefined,
          endDate:   req.query.endDate   ? String(req.query.endDate)   : undefined,
          clientId:  req.query.clientId  ? String(req.query.clientId)  : undefined,
          projectId: req.query.projectId ? String(req.query.projectId) : undefined,
          status:    req.query.status    ? String(req.query.status)    : undefined,
        };
        const data = await runMetric(key, share.tenantId, filters);
        res.json(data);
      } catch (err: any) {
        console.error("[bi-share] public metric error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // SQL Agent: NL → SQL → execute → save
    app.post("/api/sql/agent", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant required" });
        // Restrict to admin/superadmin/gerente — SQL access is privileged.
        const role = req.tenantRole;
        if (!req.isSuperadmin && role !== "admin" && role !== "gerente") {
          return res.status(403).json({ message: "Forbidden: requires admin or manager role" });
        }
        const prompt = String(req.body?.prompt || "").trim();
        if (!prompt) return res.status(400).json({ message: "Prompt required" });
        const { runSqlAgent } = await import("./agentService");
        const result = await runSqlAgent({
          prompt,
          tenantId,
          userId: getAuthUserId(req),
        });
        res.json(result);
      } catch (err: any) {
        const status = err instanceof SandboxError ? err.status : 500;
        console.error("[sql-agent] error:", err);
        res.status(status).json({ message: err.message });
      }
    });

    // BI Agent for a specific connector — analyzes its data and returns widget configs
    app.post("/api/bi/connector-agent", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant required" });
        const dataSourceId = String(req.body?.dataSourceId || "");
        const prompt = String(req.body?.prompt || "").trim();
        if (!dataSourceId) return res.status(400).json({ message: "dataSourceId required" });

        const [src] = await db.select().from(dataSources).where(sqlEq(dataSources.id, dataSourceId));
        if (!src || src.tenantId !== tenantId) {
          return res.status(404).json({ message: "Fonte não encontrada" });
        }
        const [snap] = await db.select().from(dataSnapshots)
          .where(and(sqlEq(dataSnapshots.dataSourceId, dataSourceId), sqlEq(dataSnapshots.tenantId, tenantId)))
          .orderBy(desc(dataSnapshots.syncedAt))
          .limit(1);
        const rows = Array.isArray(snap?.rows) ? (snap!.rows as any[]) : [];

        const { runConnectorBiAgent } = await import("./agentService");
        const result = await runConnectorBiAgent({
          dataSourceId,
          sourceName: src.name,
          rows,
          prompt: prompt || undefined,
          tenantId,
          userId: getAuthUserId(req),
        });
        res.json(result);
      } catch (err: any) {
        console.error("[connector-bi-agent] error:", err);
        res.status(500).json({ message: err?.message || "Erro" });
      }
    });

    // BI Agent: NL → multi-widget dashboard layout (internal metrics only)
    app.post("/api/bi/agent", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant required" });
        const prompt = String(req.body?.prompt || "").trim();
        if (!prompt) return res.status(400).json({ message: "Prompt required" });
        const { runBiAgent } = await import("./agentService");
        const result = await runBiAgent({
          prompt,
          tenantId,
          userId: getAuthUserId(req),
        });
        res.json(result);
      } catch (err: any) {
        console.error("[bi-agent] error:", err);
        res.status(500).json({ message: err.message });
      }
    });

    // List saved queries for the tenant
    app.get("/api/sql", isAuthenticated, requireTenant, async (req: any, res) => {
      const tenantId = req.tenantId;
      const rows = await db.select().from(sqlQueries)
        .where(sqlEq(sqlQueries.tenantId, tenantId))
        .orderBy(desc(sqlQueries.lastExecutedAt))
        .limit(50);
      res.json(rows);
    });

    // Re-execute a saved query and return rows
    app.get("/api/sql/:id/data", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const tenantId = req.tenantId;
        const [q] = await db.select().from(sqlQueries)
          .where(sqlEq(sqlQueries.id, req.params.id));
        if (!q) return res.status(404).json({ message: "Not found" });
        if (q.tenantId !== tenantId && !req.isSuperadmin) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const result = await executeSandboxQuery(q.querySql, {
          tenantId: q.tenantId,
          allowCrossTenant: req.isSuperadmin,
        });
        // Update execution metrics
        await db.update(sqlQueries).set({
          executionCount: (q.executionCount ?? 0) + 1,
          lastExecutedAt: new Date(),
        }).where(sqlEq(sqlQueries.id, q.id));
        res.json(result.rows);
      } catch (err: any) {
        const status = err instanceof SandboxError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    // Convert a saved query to a widget shell
    app.post("/api/sql/:id/to-widget", isAuthenticated, requireTenant, async (req: any, res) => {
      const tenantId = req.tenantId;
      const [q] = await db.select().from(sqlQueries)
        .where(sqlEq(sqlQueries.id, req.params.id));
      if (!q) return res.status(404).json({ message: "Not found" });
      if (q.tenantId !== tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const widget = {
        id: crypto.randomUUID(),
        type: req.body?.widgetType || "bar_chart",
        title: req.body?.title || q.name || "Análise SQL",
        gridPos: { x: 0, y: 99, w: 6, h: 4 },
        dataSource: {
          type: "sql_agent" as const,
          sqlQueryId: q.id,
          agentPrompt: q.agentPrompt || undefined,
          xAxisColumn: q.xAxisColumn || undefined,
          yAxisColumns: q.yAxisColumns || [],
        },
      };
      res.json(widget);
    });

    // Delete a saved query
    app.delete("/api/sql/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const tenantId = req.tenantId;
      const [q] = await db.select().from(sqlQueries)
        .where(sqlEq(sqlQueries.id, req.params.id));
      if (!q) return res.status(404).json({ message: "Not found" });
      if (q.tenantId !== tenantId && !req.isSuperadmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await db.delete(sqlQueries).where(sqlEq(sqlQueries.id, req.params.id));
      res.json({ ok: true });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  //  PHASE 4a — Central de Integração
  // ─────────────────────────────────────────────────────────────────
  {
    const { eq: e, and: a, desc: d } = await import("drizzle-orm");

    const handleConnErr = (res: any, err: any) => {
      const status = err instanceof ConnectorError ? err.status : 500;
      console.error("[integrations]", err);
      res.status(status).json({ message: err?.message || "Erro" });
    };

    // ── DATA SOURCES ────────────────────────────────────────────────
    app.get("/api/datasources", isAuthenticated, requireTenant, async (req: any, res) => {
      const rows = await db.select().from(dataSources)
        .where(e(dataSources.tenantId, req.tenantId))
        .orderBy(d(dataSources.createdAt));
      // never leak the encrypted blob to the frontend
      res.json(rows.map(({ configEncrypted, ...rest }) => rest));
    });

    app.post("/api/datasources", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        if (!req.tenantId) {
          return res.status(400).json({
            message: "Selecione um tenant ativo antes de criar fontes de dados (use o seletor de workspace no topo).",
          });
        }
        const { config = {}, configPublic = {}, ...rest } = req.body ?? {};
        const parsed = insertDataSourceSchema.partial({ configEncrypted: true }).parse({
          ...rest,
          tenantId: req.tenantId,
          configPublic,
        });
        const [row] = await db.insert(dataSources).values({
          ...parsed,
          tenantId: req.tenantId,
          configEncrypted: encryptConfig(config),
        } as any).returning();
        // Fase 3 BI — qualquer mudança em data_sources potencialmente
        // muda o catálogo semântico/ETL; invalida o cache do tenant.
        await invalidateBiTenantCache(req.tenantId).catch(() => {});
        const { configEncrypted, ...safe } = row;
        res.json(safe);
      } catch (err: any) {
        res.status(400).json({ message: err?.message || "Falha ao criar fonte" });
      }
    });

    app.patch("/api/datasources/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const [existing] = await db.select().from(dataSources)
        .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)));
      if (!existing) return res.status(404).json({ message: "Fonte não encontrada" });
      const { config, configPublic, name, type, scheduleCron, isActive } = req.body ?? {};
      const updates: any = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (scheduleCron !== undefined) updates.scheduleCron = scheduleCron;
      if (isActive !== undefined) updates.isActive = isActive;
      if (config !== undefined) updates.configEncrypted = encryptConfig(config);
      if (configPublic !== undefined) updates.configPublic = configPublic;
      const [row] = await db.update(dataSources).set(updates)
        .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)))
        .returning();
      await invalidateBiTenantCache(req.tenantId).catch(() => {});
      const { configEncrypted, ...safe } = row;
      res.json(safe);
    });

    app.delete("/api/datasources/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const [existing] = await db.select().from(dataSources)
        .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)));
      if (!existing) return res.status(404).json({ message: "Fonte não encontrada" });
      await db.delete(dataSources)
        .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)));
      await invalidateBiTenantCache(req.tenantId).catch(() => {});
      res.json({ ok: true });
    });

    // Test the connection without persisting a snapshot
    app.post("/api/datasources/:id/test", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const result = await fetchFromSource(req.params.id, req.tenantId);
        res.json({
          ok: true,
          rowCount: result.rowCount,
          columns: result.columns,
          sample: result.rows.slice(0, 5),
        });
      } catch (err) { handleConnErr(res, err); }
    });

    // Manual sync — persists a snapshot
    app.post("/api/datasources/:id/sync", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const out = await runSync(req.params.id, req.tenantId, "manual");
        res.json(out);
      } catch (err) { handleConnErr(res, err); }
    });

    // Latest snapshot data (used by BI widgets)
    app.get("/api/datasources/:id/data", isAuthenticated, requireTenant, async (req: any, res) => {
      const [src] = await db.select().from(dataSources)
        .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)));
      if (!src) return res.status(404).json({ message: "Fonte não encontrada" });
      const [snap] = await db.select().from(dataSnapshots)
        .where(a(
          e(dataSnapshots.dataSourceId, req.params.id),
          e(dataSnapshots.tenantId, req.tenantId),
        ))
        .orderBy(d(dataSnapshots.syncedAt))
        .limit(1);
      if (!snap) return res.json({ rows: [], columns: [], rowCount: 0, syncedAt: null });
      res.json({
        rows: snap.data ?? [],
        columns: snap.columns ?? [],
        rowCount: snap.rowCount ?? 0,
        syncedAt: snap.syncedAt,
      });
    });

    // Sync history
    app.get("/api/datasources/:id/jobs", isAuthenticated, requireTenant, async (req: any, res) => {
      const rows = await db.select().from(syncJobs)
        .where(a(e(syncJobs.dataSourceId, req.params.id), e(syncJobs.tenantId, req.tenantId)))
        .orderBy(d(syncJobs.createdAt))
        .limit(50);
      res.json(rows);
    });

    // Excel/CSV upload — parses, persists snapshot, returns preview
    app.post(
      "/api/datasources/:id/upload",
      isAuthenticated,
      requireTenant,
      integrationUpload.single("file"),
      async (req: any, res) => {
        try {
          const [src] = await db.select().from(dataSources)
            .where(a(e(dataSources.id, req.params.id), e(dataSources.tenantId, req.tenantId)));
          if (!src) return res.status(404).json({ message: "Fonte não encontrada" });
          if (src.type !== "excel_upload" && src.type !== "zip_upload")
            return res.status(400).json({ message: "Esta fonte não aceita upload" });
          if (!req.file) return res.status(400).json({ message: "Arquivo ausente" });

          let rows: Record<string, any>[] = [];
          if (src.type === "zip_upload") {
            const AdmZip = (await import("adm-zip")).default;
            const zip = new AdmZip(req.file.buffer);
            const entries = zip.getEntries().filter((e: any) => !e.isDirectory);
            const target = entries.find((e: any) => /\.(xlsx|xls|csv|json)$/i.test(e.entryName));
            if (!target) return res.status(400).json({ message: "ZIP não contém .xlsx/.xls/.csv/.json" });
            const buf = target.getData() as Buffer;
            const ext = target.entryName.toLowerCase();
            if (ext.endsWith(".json")) {
              const json = JSON.parse(buf.toString("utf-8"));
              rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : [json]);
            } else {
              const wb = XLSX.read(buf, { type: "buffer" });
              const sheetName = wb.SheetNames[0];
              if (!sheetName) return res.status(400).json({ message: "Planilha vazia no ZIP" });
              rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName], { defval: null });
            }
          } else {
            const wb = XLSX.read(req.file.buffer, { type: "buffer" });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) return res.status(400).json({ message: "Planilha vazia" });
            rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName], { defval: null });
          }
          const sliced = rows.slice(0, 5000);
          const columns = sliced[0] && typeof sliced[0] === "object" ? Object.keys(sliced[0]) : [];
          await saveSnapshot(req.params.id, req.tenantId, {
            rows: sliced,
            columns,
            rowCount: sliced.length,
            syncedAt: new Date(),
          });
          await db.update(dataSources).set({
            lastSyncAt: new Date(),
            lastSyncStatus: "success",
            updatedAt: new Date(),
          }).where(e(dataSources.id, req.params.id));
          res.json({ ok: true, rowCount: sliced.length, columns, sample: sliced.slice(0, 5) });
        } catch (err: any) {
          console.error("[upload]", err);
          res.status(500).json({ message: err?.message || "Falha no upload" });
        }
      },
    );

    // ── AUTOMATION RULES ───────────────────────────────────────────
    app.get("/api/automations", isAuthenticated, requireTenant, async (req: any, res) => {
      const rows = await db.select().from(automationRules)
        .where(e(automationRules.tenantId, req.tenantId))
        .orderBy(d(automationRules.createdAt));
      res.json(rows);
    });

    app.post("/api/automations", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const parsed = insertAutomationRuleSchema.parse({
          ...req.body,
          tenantId: req.tenantId,
        });
        const [row] = await db.insert(automationRules)
          .values({ ...parsed, tenantId: req.tenantId } as any)
          .returning();
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ message: err?.message || "Falha ao criar regra" });
      }
    });

    app.patch("/api/automations/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const [existing] = await db.select().from(automationRules)
        .where(a(e(automationRules.id, req.params.id), e(automationRules.tenantId, req.tenantId)));
      if (!existing) return res.status(404).json({ message: "Regra não encontrada" });
      const allowed: any = { updatedAt: new Date() };
      const { name, triggerType, triggerConfig, actionType, actionConfig, isActive } = req.body ?? {};
      if (name !== undefined) allowed.name = name;
      if (triggerType !== undefined) allowed.triggerType = triggerType;
      if (triggerConfig !== undefined) allowed.triggerConfig = triggerConfig;
      if (actionType !== undefined) allowed.actionType = actionType;
      if (actionConfig !== undefined) allowed.actionConfig = actionConfig;
      if (isActive !== undefined) allowed.isActive = isActive;
      const [row] = await db.update(automationRules).set(allowed)
        .where(a(e(automationRules.id, req.params.id), e(automationRules.tenantId, req.tenantId)))
        .returning();
      res.json(row);
    });

    app.delete("/api/automations/:id", isAuthenticated, requireTenant, async (req: any, res) => {
      const [existing] = await db.select().from(automationRules)
        .where(a(e(automationRules.id, req.params.id), e(automationRules.tenantId, req.tenantId)));
      if (!existing) return res.status(404).json({ message: "Regra não encontrada" });
      await db.delete(automationRules)
        .where(a(e(automationRules.id, req.params.id), e(automationRules.tenantId, req.tenantId)));
      res.json({ ok: true });
    });

    app.post("/api/automations/:id/run", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const out = await runRuleNow(req.params.id, req.tenantId);
        res.json(out);
      } catch (err: any) {
        res.status(400).json({ message: err?.message || "Falha ao executar" });
      }
    });

    // ── NOTIFICATIONS ──────────────────────────────────────────────
    app.get("/api/notifications", isAuthenticated, requireTenant, async (req: any, res) => {
      const rows = await db.select().from(notifications)
        .where(e(notifications.tenantId, req.tenantId))
        .orderBy(d(notifications.createdAt))
        .limit(100);
      res.json(rows);
    });

    app.post("/api/notifications/:id/read", isAuthenticated, requireTenant, async (req: any, res) => {
      const [existing] = await db.select().from(notifications)
        .where(a(e(notifications.id, req.params.id), e(notifications.tenantId, req.tenantId)));
      if (!existing) return res.status(404).json({ message: "Notificação não encontrada" });
      await db.update(notifications).set({ isRead: 1 })
        .where(a(e(notifications.id, req.params.id), e(notifications.tenantId, req.tenantId)));
      res.json({ ok: true });
    });

    app.post("/api/notifications/test", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const out = await sendNotification(req.tenantId, {
          channel: req.body?.channel || "inapp",
          recipients: req.body?.recipients || [],
          title: req.body?.title || "Notificação de teste",
          message: req.body?.message || "Esta é uma notificação de teste da Central de Integração.",
          type: "info",
        });
        res.json(out);
      } catch (err: any) {
        res.status(400).json({ message: err?.message || "Falha ao notificar" });
      }
    });
  }

  // ===========================================================================
  // FRAPPE / ERPNext backend integration (Phase 0)
  // ===========================================================================
  {
    const {
      FrappeClient,
      FrappeError,
      getFrappeClientForTenant,
      getFrappeStatus,
    } = await import("./frappeClient");
    const { encryptConfig } = await import("./cryptoService");
    const { tenants: tenantsTable } = await import("@shared/schema");
    const { eq: fEq } = await import("drizzle-orm");
    const crypto = await import("node:crypto");

    function tenantIdGuard(req: any, res: any): string | null {
      const id = req.params.id;
      if (!req.isSuperadmin && req.tenantId !== id) {
        res.status(403).json({ message: "Forbidden" });
        return null;
      }
      return id;
    }

    // Status (no secrets returned). Admin-only — config visibility is privileged.
    app.get("/api/tenants/:id/frappe", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
      const id = tenantIdGuard(req, res);
      if (!id) return;
      try {
        res.json(await getFrappeStatus(id));
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    });

    // Save / update Frappe credentials. Body: { url, apiKey, apiSecret, webhookSecret? }
    app.patch("/api/tenants/:id/frappe", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
      const id = tenantIdGuard(req, res);
      if (!id) return;
      try {
        const url = String(req.body?.url || "").trim();
        const apiKey = String(req.body?.apiKey || "").trim();
        const apiSecret = String(req.body?.apiSecret || "").trim();
        const webhookSecret = req.body?.webhookSecret ? String(req.body.webhookSecret).trim() : undefined;
        if (!url || !apiKey || !apiSecret) {
          return res.status(400).json({ message: "url, apiKey e apiSecret são obrigatórios" });
        }
        const encrypted = encryptConfig({ apiKey, apiSecret });
        await db.update(tenantsTable).set({
          frappeUrl: url,
          frappeCredentials: encrypted,
          ...(webhookSecret !== undefined ? { frappeWebhookSecret: webhookSecret || null } : {}),
        }).where(fEq(tenantsTable.id, id));
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    });

    app.delete("/api/tenants/:id/frappe", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
      const id = tenantIdGuard(req, res);
      if (!id) return;
      try {
        await db.update(tenantsTable).set({
          frappeUrl: null,
          frappeCredentials: null,
          frappeWebhookSecret: null,
        }).where(fEq(tenantsTable.id, id));
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    });

    // Test connection. Optional body { url, apiKey, apiSecret } for pre-save test;
    // otherwise tests stored credentials.
    app.post("/api/tenants/:id/frappe/test", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
      const id = tenantIdGuard(req, res);
      if (!id) return;
      try {
        let client;
        if (req.body?.url && req.body?.apiKey && req.body?.apiSecret) {
          client = new FrappeClient(String(req.body.url), String(req.body.apiKey), String(req.body.apiSecret));
        } else {
          client = await getFrappeClientForTenant(id);
        }
        const ping = await client.ping();
        res.json({ ok: true, ...ping });
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ ok: false, message: err.message });
      }
    });

    // ---- Proxy routes — tenant-scoped CRUD over the Frappe site ----
    app.get("/api/frappe/doctypes", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        res.json(await client.listDocTypes());
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    app.get("/api/frappe/:doctype", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        const fields = req.query.fields
          ? String(req.query.fields).split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
        const limit = req.query.limit ? Math.min(500, Number(req.query.limit) || 50) : 50;
        const filters = req.query.filters ? JSON.parse(String(req.query.filters)) : undefined;
        res.json(await client.getList(req.params.doctype, { fields, limit, filters }));
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    app.get("/api/frappe/:doctype/:name", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        res.json(await client.getDoc(req.params.doctype, req.params.name));
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    app.post("/api/frappe/:doctype", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        res.json(await client.insert(req.params.doctype, req.body || {}));
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    app.put("/api/frappe/:doctype/:name", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        res.json(await client.update(req.params.doctype, req.params.name, req.body || {}));
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    app.delete("/api/frappe/:doctype/:name", isAuthenticated, requireTenant, async (req: any, res) => {
      try {
        const client = await getFrappeClientForTenant(req.tenantId);
        await client.remove(req.params.doctype, req.params.name);
        res.json({ ok: true });
      } catch (err: any) {
        const status = err instanceof FrappeError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    });

    // Webhook receiver — Frappe pushes events here. Tenant in URL path; HMAC-SHA256
    // signature header validated against frappeWebhookSecret.
    // Header name: X-Frappe-Webhook-Signature (hex). Frappe sends this when configured.
    app.post("/api/webhooks/frappe/:tenantId", async (req: any, res) => {
      try {
        const tenantId = req.params.tenantId;
        const [t] = await db.select({
          frappeWebhookSecret: tenantsTable.frappeWebhookSecret,
        }).from(tenantsTable).where(fEq(tenantsTable.id, tenantId));
        if (!t) return res.status(404).json({ message: "tenant not found" });
        if (!t.frappeWebhookSecret) {
          return res.status(412).json({ message: "webhook secret não configurado" });
        }
        const sigHeader = String(
          req.headers["x-frappe-webhook-signature"] ||
          req.headers["x-hub-signature-256"] || "",
        ).replace(/^sha256=/, "");
        // HMAC over raw request bytes (captured by express.json verify hook in server/index.ts).
        // Reject if raw body is unavailable to prevent verification on reserialized JSON.
        const raw = (req as any).rawBody as Buffer | undefined;
        if (!raw) return res.status(400).json({ message: "raw body indisponível" });
        const expected = crypto.createHmac("sha256", t.frappeWebhookSecret).update(raw).digest("hex");
        if (!sigHeader ||
            sigHeader.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
          return res.status(401).json({ message: "assinatura inválida" });
        }
        // For now: log + acknowledge. Future phases route into automation engine.
        console.log("[frappe-webhook]", tenantId, req.body?.doctype, req.body?.name, req.body?.event);
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[frappe-webhook] error:", err);
        res.status(500).json({ message: err.message });
      }
    });
  }


// ── Superadmin: clients de um tenant específico
  app.get("/api/superadmin/tenants/:id/clients", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const clients = await storage.getAllClients(req.params.id, { allowGlobal: false });
      res.json(clients);
    } catch (error) {
      console.error("Error fetching tenant clients (superadmin):", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  // ── Superadmin: uso de IA de um tenant específico
  app.get("/api/superadmin/tenants/:id/ai-usage", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { aiUsageLogs } = await import("../shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const logs = await db
        .select()
        .from(aiUsageLogs)
        .where(eq(aiUsageLogs.tenantId, req.params.id))
        .orderBy(desc(aiUsageLogs.createdAt))
        .limit(100);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching AI usage (superadmin):", error);
      res.status(500).json({ message: "Failed to fetch AI usage" });
    }
  });

  // ─── DatasetHub — Atlas ERP ──────────────────────────────────────────────
  // Helper: resolve tenant (superadmin sem contexto → primeiro tenant)
  async function resolveAtlasTenant(req: any): Promise<string | null> {
    if (req.tenantId) return req.tenantId;
    if (req.isSuperadmin) {
      // 1. body.arcadiaTenantId / query.tenantId tem prioridade
      const explicit = req.body?.arcadiaTenantId ?? req.query?.tenantId;
      if (explicit) return String(explicit);
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const t: any = await db.execute(ds`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
      return (t.rows ?? t)[0]?.id ?? null;
    }
    return null;
  }

  // Helper para resolver tenant a partir do ID da conexão (usado em sync/delete)
  async function resolveTenantFromDataSource(req: any, dataSourceId: string): Promise<string | null> {
    if (req.isSuperadmin) {
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const r: any = await db.execute(ds`SELECT arcadia_tenant_id FROM analytics.atlas_data_sources WHERE id = ${dataSourceId} LIMIT 1`);
      return (r.rows ?? r)[0]?.arcadia_tenant_id ?? null;
    }
    return req.tenantId ?? null;
  }

  // ── Atlas Explorer — catálogo de tabelas ────────────────────────────────
  app.get("/api/atlas/catalog", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        const tablesRes = await client.query(`
          SELECT
            c.table_name,
            COUNT(c.column_name) AS column_count,
            COALESCE(s.n_live_tup, 0) AS row_estimate
          FROM information_schema.columns c
          LEFT JOIN pg_stat_user_tables s
                 ON s.schemaname = 'analytics' AND s.relname = c.table_name
          WHERE c.table_schema = 'analytics'
            AND c.table_name LIKE 'atlas_%'
          GROUP BY c.table_name, s.n_live_tup
          ORDER BY s.n_live_tup DESC NULLS LAST, c.table_name
        `);
        const colsRes = await client.query(`
          SELECT table_name, column_name, data_type, ordinal_position
          FROM information_schema.columns
          WHERE table_schema = 'analytics' AND table_name LIKE 'atlas_%'
          ORDER BY table_name, ordinal_position
        `);
        const colsByTable = new Map<string, any[]>();
        for (const r of colsRes.rows) {
          if (!colsByTable.has(r.table_name)) colsByTable.set(r.table_name, []);
          colsByTable.get(r.table_name)!.push({
            name: r.column_name, type: r.data_type, position: r.ordinal_position,
          });
        }
        const tables = tablesRes.rows.map((t: any) => ({
          name: `analytics.${t.table_name}`,
          displayName: t.table_name.replace("atlas_", "").replace(/_/g, " "),
          rowEstimate: parseInt(t.row_estimate) || 0,
          columnCount: parseInt(t.column_count) || 0,
          columns: colsByTable.get(t.table_name) ?? [],
        }));
        res.json({ tables, tenantId: req.tenantId });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Atlas Explorer — preview de tabela (paginação + sort) ───────────────
  app.get("/api/atlas/table/:tableName", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const raw = req.params.tableName;
      if (!/^atlas_[a-z_]+$/.test(raw)) {
        return res.status(400).json({ message: "Tabela inválida" });
      }
      const fullTable = `analytics.${raw}`;
      const tenantId = req.tenantId!;
      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        const { rows: cols } = await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'analytics' AND table_name = $1
           ORDER BY ordinal_position`,
          [raw],
        );
        if (cols.length === 0) {
          return res.status(404).json({ message: "Tabela não encontrada" });
        }
        const colNames = cols.map((c: any) => c.column_name);
        const hasArcadiaId = colNames.includes("arcadia_tenant_id");
        // Fail closed: superadmin pode ler sem filtro; demais perfis exigem arcadia_tenant_id presente
        if (!hasArcadiaId && !req.isSuperadmin) {
          return res.status(403).json({
            message: "Tabela sem coluna arcadia_tenant_id — acesso restrito ao superadmin",
          });
        }
        const whereClause = hasArcadiaId ? `WHERE arcadia_tenant_id = $1` : "";
        const params = hasArcadiaId ? [tenantId] : [];
        const fallbackSort = colNames.includes("id") ? "id" : colNames[0];
        const sortBy = colNames.includes(req.query.sortBy as string)
          ? (req.query.sortBy as string) : fallbackSort;
        const sortDir = req.query.sortDir === "desc" ? "DESC" : "ASC";
        const page = Math.max(0, parseInt(req.query.page as string) || 0);
        const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize as string) || 50));
        const countRes = await client.query(
          `SELECT COUNT(*) FROM ${fullTable} ${whereClause}`, params,
        );
        const totalRows = parseInt(countRes.rows[0].count);
        const dataRes = await client.query(
          `SELECT * FROM ${fullTable} ${whereClause}
           ORDER BY "${sortBy}" ${sortDir}
           LIMIT ${pageSize} OFFSET ${page * pageSize}`,
          params,
        );
        res.json({
          table: fullTable,
          columns: colNames,
          rows: dataRes.rows,
          totalRows, page, pageSize,
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Atlas Explorer — SQL ad-hoc (sandbox read-only) ─────────────────────
  app.post("/api/atlas/query", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { sql: querySql } = req.body;
      if (!querySql || typeof querySql !== "string") {
        return res.status(400).json({ message: "sql required" });
      }
      const role = req.tenantRole;
      if (!req.isSuperadmin && role !== "admin" && role !== "gerente") {
        return res.status(403).json({ message: "Requer perfil admin ou gerente" });
      }
      const { executeSandboxQuery, SandboxError } = await import("./sqlSandbox");
      const started = Date.now();
      try {
        const result = await executeSandboxQuery(querySql, {
          tenantId: req.tenantId!,
          allowCrossTenant: !!req.isSuperadmin,
        });
        res.json({
          rows: result.rows.slice(0, 1000),
          columns: result.columns,
          rowCount: result.rowCount,
          truncated: result.truncated,
          executionMs: Date.now() - started,
        });
      } catch (err: any) {
        const status = err instanceof SandboxError ? err.status : 500;
        res.status(status).json({ message: err.message });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Atlas Explorer — SQL via NL (delega ao SQL Agent) ──────────────────
  app.post("/api/atlas/sql-agent", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const role = req.tenantRole;
      if (!req.isSuperadmin && role !== "admin" && role !== "gerente") {
        return res.status(403).json({ message: "Requer perfil admin ou gerente" });
      }
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ message: "prompt required" });
      const { runSqlAgent } = await import("./agentService");
      const result = await runSqlAgent({
        prompt: `[Atlas ERP context] ${prompt}`,
        tenantId: req.tenantId!,
        userId: getAuthUserId(req) || undefined,
      } as any);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/atlas/data-sources", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = await resolveAtlasTenant(req);
      if (!tenantId) return res.json([]);
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const r = await db.execute(ds`
        SELECT id, mode, pg_host, pg_port, pg_database, pg_user, atlas_tenant_id,
               is_active, last_sync_at, last_sync_status, last_dump_filename,
               last_dump_processed_at, sync_rows_total, created_at, updated_at
          FROM analytics.atlas_data_sources
         WHERE arcadia_tenant_id = ${tenantId}
         ORDER BY created_at DESC
      `);
      res.json((r as any).rows ?? r);
    } catch (e: any) {
      console.error("[atlas/data-sources GET]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/atlas/data-sources", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const b = req.body || {};
      const mode = b.mode === "live" ? "live" : "dump";
      const atlasTid = b.atlasTenantId ?? b.atlasaTenantId ?? null;
      let pgPasswordEnc: string | null = null;
      if (b.pgPassword) {
        const { encryptConfig } = await import("./cryptoService");
        pgPasswordEnc = encryptConfig({ pwd: String(b.pgPassword) });
      }
      // Superadmin pode escolher tenant alvo explicitamente via body.arcadiaTenantId
      let tenantId: string | null = null;
      if (req.isSuperadmin && b.arcadiaTenantId) {
        tenantId = String(b.arcadiaTenantId);
      } else {
        tenantId = await resolveAtlasTenant(req);
      }
      if (!tenantId) return res.status(400).json({ message: "Nenhum tenant disponível. Crie um tenant antes de configurar a conexão Atlas." });
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const r = await db.execute(ds`
        INSERT INTO analytics.atlas_data_sources (
          arcadia_tenant_id, mode, pg_host, pg_port, pg_database, pg_user, pg_password_encrypted,
          pg_ssl, atlas_tenant_id, is_active
        ) VALUES (
          ${tenantId}, ${mode},
          ${b.pgHost ?? null}, ${b.pgPort ?? null}, ${b.pgDatabase ?? null},
          ${b.pgUser ?? null}, ${pgPasswordEnc},
          ${b.pgSsl === false ? false : true}, ${atlasTid}, 1
        )
        RETURNING id, mode, atlas_tenant_id, is_active, created_at
      `);
      res.json((r as any).rows?.[0] ?? r);
    } catch (e: any) {
      console.error("[atlas/data-sources POST]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/atlas/data-sources/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const tenantId = await resolveTenantFromDataSource(req, req.params.id);
      if (!tenantId) return res.status(400).json({ message: "Tenant não resolvido" });
      await db.execute(ds`
        DELETE FROM analytics.atlas_data_sources
         WHERE id = ${req.params.id} AND arcadia_tenant_id = ${tenantId}
      `);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/atlas/test-connection", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    const b = req.body || {};
    if (!b.pgHost || !b.pgDatabase) {
      return res.status(400).json({ ok: false, error: "pgHost e pgDatabase obrigatórios" });
    }
    try {
      const { Client } = await import("pg");
      const c = new Client({
        host: b.pgHost,
        port: b.pgPort || 5432,
        database: b.pgDatabase,
        user: b.pgUser,
        password: b.pgPassword,
        ssl: b.pgSsl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 8000,
      });
      await c.connect();
      const r = await c.query("SELECT version()");
      await c.end();
      res.json({ ok: true, version: r.rows[0]?.version });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/atlas/sync/live/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = await resolveTenantFromDataSource(req, req.params.id);
      if (!tenantId) return res.status(400).json({ message: "Tenant não resolvido" });
      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      const r: any = await db.execute(ds`
        SELECT id, pg_host, pg_port, pg_database, pg_user, pg_password_encrypted,
               pg_ssl, atlas_tenant_id
          FROM analytics.atlas_data_sources
         WHERE id = ${req.params.id} AND arcadia_tenant_id = ${tenantId}
         LIMIT 1
      `);
      const dsRow = (r.rows ?? r)[0];
      if (!dsRow) return res.status(404).json({ message: "Data source não encontrado" });

      let password = "";
      if (dsRow.pg_password_encrypted) {
        const { decryptConfig } = await import("./cryptoService");
        const p: any = decryptConfig(dsRow.pg_password_encrypted);
        password = p?.pwd ?? "";
      }

      const { syncAtlasLive } = await import("./bi/connectors/atlasLiveConnector");
      const sync = await syncAtlasLive({
        arcadiaTenantId: tenantId,
        atlasDataSourceId: dsRow.id,
        host: dsRow.pg_host,
        port: dsRow.pg_port || 5432,
        database: dsRow.pg_database,
        user: dsRow.pg_user,
        password,
        ssl: dsRow.pg_ssl !== false,
        atlaseTenantId: dsRow.atlas_tenant_id,
      });

      const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
      const etl = await runAtlasEtl(tenantId);

      res.json({ sync, etl });
    } catch (e: any) {
      console.error("[atlas/sync/live]", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Upload via presigned URL: cliente faz PUT direto para o object storage
  // (contorna o limite de 32MB do proxy de produção). Depois chama este
  // endpoint passando { storageKey, filename } para processar o dump.
  app.post("/api/atlas/sync/dump-finalize/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = await resolveTenantFromDataSource(req, req.params.id);
      if (!tenantId) return res.status(400).json({ message: "Tenant não resolvido" });
      const { storageKey, filename } = req.body ?? {};
      if (!storageKey || typeof storageKey !== "string") {
        return res.status(400).json({ message: "storageKey obrigatório" });
      }
      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs");
      const tmpDir = os.tmpdir();
      const name = (typeof filename === "string" && filename) || "atlas_dump";

      // Baixa do object storage para arquivo temporário
      const objectStorageService = new ObjectStorageService();
      const objectPath = storageKey.startsWith("/objects/") ? storageKey : `/objects/${storageKey}`;
      const file = await objectStorageService.getObjectEntityFile(objectPath);
      const localPath = path.join(tmpDir, `atlas_${Date.now()}_${name.replace(/[^\w.-]+/g, "_")}`);
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(localPath);
        file.createReadStream().on("error", reject).pipe(ws).on("finish", () => resolve()).on("error", reject);
      });
      const stat = fs.statSync(localPath);
      let filePath = localPath;

      // Descompacta zip/gz (mesma lógica do dump-upload)
      const lower = (s: string) => s.toLowerCase();
      if (lower(name).endsWith(".zip")) {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(filePath);
        const allEntries = zip.getEntries().filter((e: any) => !e.isDirectory);
        if (allEntries.length === 0) return res.status(400).json({ message: "ZIP está vazio" });
        let entry =
          allEntries.find((e: any) => lower(e.entryName).endsWith(".sql")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".dump")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".sql.gz")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".gz")) ||
          (allEntries.length === 1 ? allEntries[0] : null);
        if (!entry) {
          const list = allEntries.slice(0, 5).map((e: any) => e.entryName).join(", ");
          return res.status(400).json({ message: `ZIP não contém .sql/.dump. Encontrados: ${list}` });
        }
        const outName = entry.entryName.split("/").pop()!;
        zip.extractEntryTo(entry, tmpDir, false, true);
        filePath = path.join(tmpDir, outName);
        if (lower(outName).endsWith(".gz")) {
          const zlib = await import("zlib");
          const gunzipped = path.join(tmpDir, outName.replace(/\.gz$/i, ""));
          const buf = zlib.gunzipSync(fs.readFileSync(filePath));
          fs.writeFileSync(gunzipped, buf);
          fs.unlink(filePath, () => {});
          filePath = gunzipped;
        }
      } else if (lower(name).endsWith(".gz")) {
        const zlib = await import("zlib");
        const gunzipped = path.join(tmpDir, `atlas_${Date.now()}.sql`);
        const buf = zlib.gunzipSync(fs.readFileSync(filePath));
        fs.writeFileSync(gunzipped, buf);
        fs.unlink(filePath, () => {});
        filePath = gunzipped;
      }

      const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
      const importResult = await importAtlasDump({ filePath, arcadiaTenantId: tenantId });
      const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
      const etl = await runAtlasEtl(tenantId);

      fs.unlink(filePath, () => {});
      if (localPath !== filePath) fs.unlink(localPath, () => {});
      // Cleanup do objeto no storage (best-effort)
      objectStorageService.deleteObject(storageKey).catch(() => {});

      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      await db.execute(ds`
        UPDATE analytics.atlas_data_sources
           SET last_sync_at = NOW(), last_sync_status = 'success',
               last_dump_filename = ${name},
               last_dump_processed_at = NOW(),
               sync_rows_total = ${importResult.totalRows},
               updated_at = NOW()
         WHERE id = ${req.params.id} AND arcadia_tenant_id = ${tenantId}
      `);
      await db.execute(ds`
        INSERT INTO analytics.atlas_import_jobs (
          data_source_id, arcadia_tenant_id, status, source_kind, source_ref,
          file_bytes, tables, etl_result, finished_at
        ) VALUES (
          ${req.params.id}, ${tenantId}, 'success', 'upload', ${name},
          ${stat.size}, ${JSON.stringify(importResult.tables)}::jsonb,
          ${JSON.stringify(etl)}::jsonb, NOW()
        )
      `);

      res.json({ import: importResult, etl });
    } catch (e: any) {
      console.error("[atlas/sync/dump-finalize]", e);
      res.status(500).json({ message: e?.message ?? "Erro ao finalizar upload" });
    }
  });

  app.post("/api/atlas/sync/dump-upload/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = await resolveTenantFromDataSource(req, req.params.id);
      if (!tenantId) return res.status(400).json({ message: "Tenant não resolvido" });
      const multer = (await import("multer")).default;
      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs");
      const tmpDir = os.tmpdir();

      await new Promise<void>((resolve, reject) => {
        multer({ dest: tmpDir, limits: { fileSize: 600 * 1024 * 1024 } })
          .single("file")(req, res as any, (err) => (err ? reject(err) : resolve()));
      });

      if (!req.file) return res.status(400).json({ message: "Arquivo não enviado" });

      let filePath = req.file.path;
      const name = req.file.originalname || "";
      if (name.toLowerCase().endsWith(".zip") || req.file.mimetype === "application/zip" || req.file.mimetype === "application/x-zip-compressed") {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(filePath);
        const allEntries = zip.getEntries().filter((e: any) => !e.isDirectory);
        if (allEntries.length === 0) {
          return res.status(400).json({ message: "ZIP está vazio" });
        }
        // Prioriza .sql, depois .dump, .sql.gz; senão usa o único arquivo
        const lower = (s: string) => s.toLowerCase();
        let entry =
          allEntries.find((e: any) => lower(e.entryName).endsWith(".sql")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".dump")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".sql.gz")) ||
          allEntries.find((e: any) => lower(e.entryName).endsWith(".gz")) ||
          (allEntries.length === 1 ? allEntries[0] : null);
        if (!entry) {
          const list = allEntries.slice(0, 5).map((e: any) => e.entryName).join(", ");
          return res.status(400).json({ message: `ZIP não contém .sql/.dump. Encontrados: ${list}` });
        }
        const outName = entry.entryName.split("/").pop()!;
        zip.extractEntryTo(entry, tmpDir, false, true);
        filePath = path.join(tmpDir, outName);
        // Descompacta .gz se necessário
        if (lower(outName).endsWith(".gz")) {
          const zlib = await import("zlib");
          const gunzipped = path.join(tmpDir, outName.replace(/\.gz$/i, ""));
          const buf = zlib.gunzipSync(fs.readFileSync(filePath));
          fs.writeFileSync(gunzipped, buf);
          fs.unlink(filePath, () => {});
          filePath = gunzipped;
        }
      } else if (name.toLowerCase().endsWith(".gz")) {
        const zlib = await import("zlib");
        const gunzipped = path.join(tmpDir, `atlas_${Date.now()}.sql`);
        const buf = zlib.gunzipSync(fs.readFileSync(filePath));
        fs.writeFileSync(gunzipped, buf);
        fs.unlink(filePath, () => {});
        filePath = gunzipped;
      }

      const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
      const importResult = await importAtlasDump({ filePath, arcadiaTenantId: tenantId });
      const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
      const etl = await runAtlasEtl(tenantId);

      fs.unlink(filePath, () => {});
      if (req.file.path !== filePath) fs.unlink(req.file.path, () => {});

      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      await db.execute(ds`
        UPDATE analytics.atlas_data_sources
           SET last_sync_at = NOW(), last_sync_status = 'success',
               last_dump_filename = ${name},
               last_dump_processed_at = NOW(),
               sync_rows_total = ${importResult.totalRows},
               updated_at = NOW()
         WHERE id = ${req.params.id} AND arcadia_tenant_id = ${tenantId}
      `);
      await db.execute(ds`
        INSERT INTO analytics.atlas_import_jobs (
          data_source_id, arcadia_tenant_id, status, source_kind, source_ref,
          file_bytes, tables, etl_result, finished_at
        ) VALUES (
          ${req.params.id}, ${tenantId}, 'success', 'upload', ${name},
          ${req.file.size ?? null}, ${JSON.stringify(importResult.tables)}::jsonb,
          ${JSON.stringify(etl)}::jsonb, NOW()
        )
      `);

      res.json({ import: importResult, etl });
    } catch (e: any) {
      console.error("[atlas/sync/dump-upload]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/atlas/sync/dump-url/:id", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
    try {
      const tenantId = await resolveTenantFromDataSource(req, req.params.id);
      if (!tenantId) return res.status(400).json({ message: "Tenant não resolvido" });
      const { url } = req.body || {};
      if (!url || typeof url !== "string") return res.status(400).json({ message: "url required" });
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ message: "URL deve ser http ou https" });
      }
      // bloquear SSRF para hosts internos
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host.startsWith("169.254.") || host.startsWith("10.") || host.startsWith("192.168.")) {
        return res.status(400).json({ message: "Host privado/local bloqueado" });
      }

      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs");
      const tmpFile = path.join(os.tmpdir(), `atlas_url_${Date.now()}.bin`);

      async function download(u: string, dest: string, hops = 0): Promise<void> {
        if (hops > 5) throw new Error("Excesso de redirecionamentos");
        const p = new URL(u);
        const mod = p.protocol === "https:" ? await import("https") : await import("http");
        await new Promise<void>((resolve, reject) => {
          const file = fs.createWriteStream(dest);
          (mod as any).default.get(u, (resp: any) => {
            if (resp.statusCode === 301 || resp.statusCode === 302 || resp.statusCode === 307) {
              file.close();
              fs.unlink(dest, () => {});
              download(resp.headers.location!, dest, hops + 1).then(resolve, reject);
              return;
            }
            if ((resp.statusCode ?? 0) >= 400) {
              reject(new Error(`HTTP ${resp.statusCode}`));
              return;
            }
            resp.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
          }).on("error", reject);
        });
      }

      await download(url, tmpFile);

      let filePath = tmpFile;
      const headBytes = fs.readFileSync(tmpFile).slice(0, 2).toString("binary");
      if (headBytes === "PK" || url.toLowerCase().includes(".zip")) {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(tmpFile);
        const entry = zip.getEntries().find((e: any) => e.entryName.endsWith(".sql"));
        if (entry) {
          zip.extractEntryTo(entry, os.tmpdir(), false, true);
          filePath = path.join(os.tmpdir(), entry.entryName.split("/").pop()!);
        }
      }

      const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
      const importResult = await importAtlasDump({ filePath, arcadiaTenantId: tenantId });
      const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
      const etl = await runAtlasEtl(tenantId);

      fs.unlink(tmpFile, () => {});
      if (filePath !== tmpFile) fs.unlink(filePath, () => {});

      const { db } = await import("./db");
      const { sql: ds } = await import("drizzle-orm");
      await db.execute(ds`
        UPDATE analytics.atlas_data_sources
           SET last_sync_at = NOW(), last_sync_status = 'success',
               last_dump_filename = ${parsed.pathname.split("/").pop() || url},
               last_dump_processed_at = NOW(),
               sync_rows_total = ${importResult.totalRows},
               updated_at = NOW()
         WHERE id = ${req.params.id} AND arcadia_tenant_id = ${tenantId}
      `);
      await db.execute(ds`
        INSERT INTO analytics.atlas_import_jobs (
          data_source_id, arcadia_tenant_id, status, source_kind, source_ref,
          tables, etl_result, finished_at
        ) VALUES (
          ${req.params.id}, ${tenantId}, 'success', 'url', ${url},
          ${JSON.stringify(importResult.tables)}::jsonb,
          ${JSON.stringify(etl)}::jsonb, NOW()
        )
      `);

      res.json({ import: importResult, etl });
    } catch (e: any) {
      console.error("[atlas/sync/dump-url]", e);
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
