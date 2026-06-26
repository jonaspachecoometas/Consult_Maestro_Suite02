import {
  users,
  aiUsageLogs,
  clients,
  projects,
  projectMembers,
  projectFiles,
  canvasBlocks,
  canvasBlockQuestions,
  canvasPdcaItems,
  processes,
  processSteps,
  processStepFiles,
  processDiagrams,
  processDiagramVersions,
  processStepDiagnostics,
  processRecommendations,
  processKpis,
  processStepSystems,
  processStepPdca,
  reusableRecommendations,
  processTemplates,
  deliverables,
  tasks,
  clientContacts,
  collaborators,
  projectCollaborators,
  processCollaborators,
  erpRequirements,
  erpRequirementAttachments,
  erpParameterizationTopics,
  erpParameterizationItems,
  helpArticles,
  partners,
  tenants,
  tenantUsers,
  tenantInvitations,
  type User,
  type UpsertUser,
  type Client,
  type InsertClient,
  type Project,
  type InsertProject,
  type ProjectMember,
  type InsertProjectMember,
  type CanvasBlock,
  type InsertCanvasBlock,
  type ProjectFile,
  type InsertProjectFile,
  type CanvasBlockQuestion,
  type InsertCanvasBlockQuestion,
  type CanvasPdcaItem,
  type InsertCanvasPdcaItem,
  type Process,
  type InsertProcess,
  type ProcessStep,
  type InsertProcessStep,
  type ProcessStepFile,
  type InsertProcessStepFile,
  type ProcessDiagram,
  type InsertProcessDiagram,
  type ProcessDiagramVersion,
  type InsertProcessDiagramVersion,
  type ProcessStepDiagnostic,
  type InsertProcessStepDiagnostic,
  type ProcessRecommendation,
  type InsertProcessRecommendation,
  type ProcessKpi,
  type InsertProcessKpi,
  type ProcessStepSystem,
  type InsertProcessStepSystem,
  type ProcessStepPdca,
  type InsertProcessStepPdca,
  type ReusableRecommendation,
  type InsertReusableRecommendation,
  type ProcessTemplate,
  type InsertProcessTemplate,
  type Deliverable,
  type InsertDeliverable,
  type Task,
  type InsertTask,
  type ClientContact,
  type InsertClientContact,
  type Collaborator,
  type InsertCollaborator,
  type ProjectCollaborator,
  type InsertProjectCollaborator,
  type ProcessCollaborator,
  type InsertProcessCollaborator,
  type ErpRequirement,
  type InsertErpRequirement,
  type ErpRequirementAttachment,
  type InsertErpRequirementAttachment,
  type ErpParameterizationTopic,
  type InsertErpParameterizationTopic,
  type ErpParameterizationItem,
  type InsertErpParameterizationItem,
  type HelpArticle,
  type InsertHelpArticle,
  swotAnalyses,
  swotItems,
  type SwotAnalysis,
  type InsertSwotAnalysis,
  type SwotItem,
  type InsertSwotItem,
  reportConfigurations,
  type ReportConfiguration,
  type InsertReportConfiguration,
  crmPipelineStages,
  crmLeads,
  crmOpportunities,
  crmActivities,
  type CrmPipelineStage,
  type InsertCrmPipelineStage,
  type CrmLead,
  type InsertCrmLead,
  type CrmOpportunity,
  type InsertCrmOpportunity,
  type CrmActivity,
  type InsertCrmActivity,
  supportTypes,
  supportTickets,
  ticketComments,
  knowledgeCategories,
  knowledgeArticles,
  trainingContent,
  clientMemberships,
  contentAccessLog,
  clientPortalAccess,
  type SupportType,
  type InsertSupportType,
  type SupportTicket,
  type InsertSupportTicket,
  type SupportTicketWithRelations,
  type TicketComment,
  type InsertTicketComment,
  type KnowledgeCategory,
  type InsertKnowledgeCategory,
  type KnowledgeArticle,
  type InsertKnowledgeArticle,
  type KnowledgeArticleWithRelations,
  type TrainingContent,
  type InsertTrainingContent,
  type TrainingContentWithRelations,
  type ClientMembership,
  type InsertClientMembership,
  type ContentAccessLog,
  type InsertContentAccessLog,
  type ClientPortalAccess,
  type InsertClientPortalAccess,
  scrumInternalProjects,
  scrumTeams,
  scrumTeamMembers,
  scrumSprints,
  scrumBacklogItems,
  scrumTimesheets,
  scrumRework,
  scrumBacklogAttachments,
  type ScrumInternalProject,
  type InsertScrumInternalProject,
  type ScrumTeam,
  type InsertScrumTeam,
  type ScrumTeamMember,
  type InsertScrumTeamMember,
  type ScrumSprint,
  type InsertScrumSprint,
  type ScrumBacklogItem,
  type InsertScrumBacklogItem,
  type ScrumTimesheet,
  type InsertScrumTimesheet,
  type ScrumRework,
  type InsertScrumRework,
  type ScrumBacklogAttachment,
  type InsertScrumBacklogAttachment,
  crmProposals,
  crmProposalItems,
  crmContracts,
  crmContractMilestones,
  crmPartners,
  crmPartnerCommissions,
  type CrmProposal,
  type InsertCrmProposal,
  type CrmProposalItem,
  type InsertCrmProposalItem,
  type CrmContract,
  type InsertCrmContract,
  type CrmContractMilestone,
  type InsertCrmContractMilestone,
  type CrmPartner,
  type InsertCrmPartner,
  type CrmPartnerCommission,
  type InsertCrmPartnerCommission,
  partners,
  tenants,
  tenantUsers,
  inviteTokens,
  subTenants,
  type Partner,
  type InsertPartner,
  type PartnerWithStats,
  type Tenant,
  type InsertTenant,
  type TenantWithRelations,
  type TenantUser,
  type InsertTenantUser,
  type InviteToken,
  type InsertInviteToken,
  type SubTenant,
  type InsertSubTenant,
  rolePermissions,
  type RolePermission,
  type InsertRolePermission,
  partnerApiKeys,
  type PartnerApiKey,
  type InsertPartnerApiKey,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, and, desc, or, ilike, count, isNull, inArray, gte, sql, sql as drizzleSql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByProviderSub(providerSub: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  upsertOidcUser(user: { providerSub: string; email?: string; firstName?: string; lastName?: string; profileImageUrl?: string; provider: string }): Promise<User>;
  createUser(user: { email: string; firstName?: string; lastName?: string; role?: string }): Promise<User>;
  createLocalUser(user: { email: string; passwordHash: string; firstName?: string | null; lastName?: string | null; role?: string; isLocalAuth: number; isActive: number }): Promise<User>;
  updateUserLoginTime(id: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserDetails(id: string, data: { firstName?: string; lastName?: string; email?: string }): Promise<User | undefined>;
  updateUserStatus(id: string, isActive: number): Promise<User | undefined>;
  updateUserPassword(id: string, passwordHash: string): Promise<User | undefined>;

  // Client operations
  getClient(id: string): Promise<Client | undefined>;
  getAllClients(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Client[]>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<boolean>;

  // Project operations
  getProject(id: string): Promise<Project | undefined>;
  getAllProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Project[]>;
  /**
   * Lista projetos "de produção" — exclui demandas (type='compass').
   * Usado por todas as telas que NÃO são /demandas (Reports, BI, Super Agente,
   * Backlog, Sprints, Timesheet, Dashboard, etc).
   */
  getProductionProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Project[]>;
  getProjectsByClient(clientId: string, tenantId?: string | null): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Project Member operations
  getProjectMembers(projectId: string): Promise<(ProjectMember & { user?: User })[]>;
  addProjectMember(member: InsertProjectMember): Promise<ProjectMember>;
  removeProjectMember(projectId: string, userId: string): Promise<boolean>;

  // Canvas Block operations
  getCanvasBlocks(projectId: string): Promise<CanvasBlock[]>;
  getCanvasBlock(id: string): Promise<CanvasBlock | undefined>;
  createCanvasBlock(block: InsertCanvasBlock): Promise<CanvasBlock>;
  updateCanvasBlock(id: string, block: Partial<InsertCanvasBlock>): Promise<CanvasBlock | undefined>;
  deleteCanvasBlock(id: string): Promise<boolean>;

  // Canvas Block Question operations
  getCanvasBlockQuestions(blockId: string): Promise<CanvasBlockQuestion[]>;
  getCanvasBlockQuestion(id: string): Promise<CanvasBlockQuestion | undefined>;
  createCanvasBlockQuestion(question: InsertCanvasBlockQuestion): Promise<CanvasBlockQuestion>;
  updateCanvasBlockQuestion(id: string, question: Partial<InsertCanvasBlockQuestion>): Promise<CanvasBlockQuestion | undefined>;
  deleteCanvasBlockQuestion(id: string): Promise<boolean>;

  // Canvas PDCA operations
  getCanvasPdcaItems(projectId: string): Promise<CanvasPdcaItem[]>;
  getCanvasPdcaItem(id: string): Promise<CanvasPdcaItem | undefined>;
  createCanvasPdcaItem(item: InsertCanvasPdcaItem): Promise<CanvasPdcaItem>;
  updateCanvasPdcaItem(id: string, item: Partial<InsertCanvasPdcaItem>): Promise<CanvasPdcaItem | undefined>;
  deleteCanvasPdcaItem(id: string): Promise<boolean>;

  // Process Step PDCA operations (for TO-BE steps)
  getProcessStepPdcaItems(stepId: string): Promise<ProcessStepPdca[]>;
  getProcessStepPdcaItem(id: string): Promise<ProcessStepPdca | undefined>;
  createProcessStepPdcaItem(item: InsertProcessStepPdca): Promise<ProcessStepPdca>;
  updateProcessStepPdcaItem(id: string, item: Partial<InsertProcessStepPdca>): Promise<ProcessStepPdca | undefined>;
  deleteProcessStepPdcaItem(id: string): Promise<boolean>;
  getAllProcessPdcaItemsForProject(projectId: string): Promise<(ProcessStepPdca & { processName: string; stepName: string; processId: string })[]>;

  // Process operations
  getProcesses(projectId: string): Promise<Process[]>;
  getProcess(id: string): Promise<Process | undefined>;
  createProcess(process: InsertProcess): Promise<Process>;
  updateProcess(id: string, process: Partial<InsertProcess>): Promise<Process | undefined>;
  deleteProcess(id: string): Promise<boolean>;

  // Process Step operations
  getProcessSteps(processId: string): Promise<ProcessStep[]>;
  getProcessStep(id: string): Promise<ProcessStep | undefined>;
  createProcessStep(step: InsertProcessStep): Promise<ProcessStep>;
  updateProcessStep(id: string, step: Partial<InsertProcessStep>): Promise<ProcessStep | undefined>;
  deleteProcessStep(id: string): Promise<boolean>;

  // Deliverable operations
  getDeliverables(projectId: string): Promise<Deliverable[]>;
  getDeliverable(id: string): Promise<Deliverable | undefined>;
  createDeliverable(deliverable: InsertDeliverable): Promise<Deliverable>;
  updateDeliverable(id: string, deliverable: Partial<InsertDeliverable>): Promise<Deliverable | undefined>;
  deleteDeliverable(id: string): Promise<boolean>;

  // Task operations
  getAllTasks(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Task[]>;
  getTasks(projectId: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;

  // Process Diagram operations
  getProcessDiagram(processId: string): Promise<ProcessDiagram | undefined>;
  upsertProcessDiagram(diagram: InsertProcessDiagram): Promise<ProcessDiagram>;

  // Process Step File operations
  getProcessStepFiles(stepId: string): Promise<ProcessStepFile[]>;
  getProcessStepFile(id: string): Promise<ProcessStepFile | undefined>;
  createProcessStepFile(file: InsertProcessStepFile): Promise<ProcessStepFile>;
  deleteProcessStepFile(id: string): Promise<ProcessStepFile | undefined>;

  // Client Contact operations
  getClientContacts(clientId: string): Promise<ClientContact[]>;
  getClientContact(id: string): Promise<ClientContact | undefined>;
  createClientContact(contact: InsertClientContact): Promise<ClientContact>;
  updateClientContact(id: string, contact: Partial<InsertClientContact>): Promise<ClientContact | undefined>;
  deleteClientContact(id: string): Promise<boolean>;

  // Collaborator operations
  getCollaborators(clientId: string): Promise<Collaborator[]>;
  getAllCollaborators(): Promise<Collaborator[]>;
  getCollaborator(id: string): Promise<Collaborator | undefined>;
  createCollaborator(collaborator: InsertCollaborator): Promise<Collaborator>;
  updateCollaborator(id: string, collaborator: Partial<InsertCollaborator>): Promise<Collaborator | undefined>;
  deleteCollaborator(id: string): Promise<boolean>;

  // Project Collaborator operations
  getProjectCollaborators(projectId: string): Promise<(ProjectCollaborator & { collaborator?: Collaborator })[]>;
  addProjectCollaborator(data: InsertProjectCollaborator): Promise<ProjectCollaborator>;
  updateProjectCollaboratorPermission(projectId: string, collaboratorId: string, permission: string): Promise<ProjectCollaborator | undefined>;
  removeProjectCollaborator(projectId: string, collaboratorId: string): Promise<boolean>;
  getAvailableCollaboratorsForProject(projectId: string): Promise<Collaborator[]>;

  // Process Collaborator operations
  getProcessCollaborators(processId: string): Promise<(ProcessCollaborator & { collaborator?: Collaborator })[]>;
  setProcessCollaborator(data: InsertProcessCollaborator): Promise<ProcessCollaborator>;
  removeProcessCollaborator(processId: string, collaboratorId: string): Promise<boolean>;
  getProjectCollaboratorsForProcess(processId: string): Promise<(Collaborator & { participates: boolean; processCollaboratorId?: string })[]>;

  // Process Diagram Version operations
  getProcessDiagramVersions(processId: string): Promise<ProcessDiagramVersion[]>;
  createProcessDiagramVersion(version: InsertProcessDiagramVersion): Promise<ProcessDiagramVersion>;

  // Process Step Diagnostic operations (pain points & opportunities)
  getProcessStepDiagnostic(id: string): Promise<ProcessStepDiagnostic | undefined>;
  getProcessStepDiagnostics(stepId: string): Promise<ProcessStepDiagnostic[]>;
  getProcessDiagnostics(processId: string): Promise<ProcessStepDiagnostic[]>;
  createProcessStepDiagnostic(diagnostic: InsertProcessStepDiagnostic): Promise<ProcessStepDiagnostic>;
  updateProcessStepDiagnostic(id: string, diagnostic: Partial<InsertProcessStepDiagnostic>): Promise<ProcessStepDiagnostic | undefined>;
  deleteProcessStepDiagnostic(id: string): Promise<boolean>;

  // Process Recommendation operations
  getProcessRecommendation(id: string): Promise<ProcessRecommendation | undefined>;
  getProcessRecommendations(processId: string): Promise<ProcessRecommendation[]>;
  createProcessRecommendation(recommendation: InsertProcessRecommendation): Promise<ProcessRecommendation>;
  updateProcessRecommendation(id: string, recommendation: Partial<InsertProcessRecommendation>): Promise<ProcessRecommendation | undefined>;
  deleteProcessRecommendation(id: string): Promise<boolean>;

  // Process KPI operations
  getProcessKpi(id: string): Promise<ProcessKpi | undefined>;
  getProcessKpis(processId: string): Promise<ProcessKpi[]>;
  createProcessKpi(kpi: InsertProcessKpi): Promise<ProcessKpi>;
  updateProcessKpi(id: string, kpi: Partial<InsertProcessKpi>): Promise<ProcessKpi | undefined>;
  deleteProcessKpi(id: string): Promise<boolean>;

  // Process Step System mapping operations (ERP/CRM)
  getProcessStepSystem(id: string): Promise<ProcessStepSystem | undefined>;
  getProcessStepSystems(stepId: string): Promise<ProcessStepSystem[]>;
  createProcessStepSystem(system: InsertProcessStepSystem): Promise<ProcessStepSystem>;
  deleteProcessStepSystem(id: string): Promise<boolean>;

  // Reusable Recommendation Library operations
  getAllReusableRecommendations(): Promise<ReusableRecommendation[]>;
  createReusableRecommendation(recommendation: InsertReusableRecommendation): Promise<ReusableRecommendation>;
  updateReusableRecommendation(id: string, recommendation: Partial<InsertReusableRecommendation>): Promise<ReusableRecommendation | undefined>;
  deleteReusableRecommendation(id: string): Promise<boolean>;

  // Process Template operations
  getAllProcessTemplates(): Promise<ProcessTemplate[]>;
  getProcessTemplate(id: string): Promise<ProcessTemplate | undefined>;
  createProcessTemplate(template: InsertProcessTemplate): Promise<ProcessTemplate>;
  updateProcessTemplate(id: string, template: Partial<InsertProcessTemplate>): Promise<ProcessTemplate | undefined>;
  deleteProcessTemplate(id: string): Promise<boolean>;

  // Linked variant operations
  getLinkedVariant(processId: string): Promise<Process | undefined>;
  createToBeVariant(asIsProcessId: string): Promise<Process>;

  // ERP Requirements operations
  getErpRequirements(projectId: string): Promise<ErpRequirement[]>;
  getErpRequirement(id: string): Promise<ErpRequirement | undefined>;
  createErpRequirement(requirement: InsertErpRequirement): Promise<ErpRequirement>;
  updateErpRequirement(id: string, requirement: Partial<InsertErpRequirement>): Promise<ErpRequirement | undefined>;
  deleteErpRequirement(id: string): Promise<boolean>;

  // ERP Requirement Attachments operations
  getErpRequirementAttachments(requirementId: string): Promise<ErpRequirementAttachment[]>;
  getErpRequirementAttachment(id: string): Promise<ErpRequirementAttachment | undefined>;
  createErpRequirementAttachment(attachment: InsertErpRequirementAttachment): Promise<ErpRequirementAttachment>;
  deleteErpRequirementAttachment(id: string): Promise<boolean>;

  // ERP Parameterization Topics operations
  getErpParameterizationTopics(projectId: string): Promise<ErpParameterizationTopic[]>;
  getErpParameterizationTopic(id: string): Promise<ErpParameterizationTopic | undefined>;
  createErpParameterizationTopic(topic: InsertErpParameterizationTopic): Promise<ErpParameterizationTopic>;
  updateErpParameterizationTopic(id: string, topic: Partial<InsertErpParameterizationTopic>): Promise<ErpParameterizationTopic | undefined>;
  deleteErpParameterizationTopic(id: string): Promise<boolean>;

  // ERP Parameterization Items operations
  getErpParameterizationItems(topicId: string): Promise<ErpParameterizationItem[]>;
  getErpParameterizationItem(id: string): Promise<ErpParameterizationItem | undefined>;
  createErpParameterizationItem(item: InsertErpParameterizationItem): Promise<ErpParameterizationItem>;
  updateErpParameterizationItem(id: string, item: Partial<InsertErpParameterizationItem>): Promise<ErpParameterizationItem | undefined>;
  deleteErpParameterizationItem(id: string): Promise<boolean>;

  // Help Article operations
  getAllHelpArticles(): Promise<HelpArticle[]>;
  getHelpArticle(id: string): Promise<HelpArticle | undefined>;
  getHelpArticleBySlug(slug: string): Promise<HelpArticle | undefined>;
  getHelpArticlesByCategory(category: string): Promise<HelpArticle[]>;
  getHelpArticlesByModule(moduleKey: string): Promise<HelpArticle[]>;
  createHelpArticle(article: InsertHelpArticle): Promise<HelpArticle>;
  updateHelpArticle(id: string, article: Partial<InsertHelpArticle>): Promise<HelpArticle | undefined>;
  deleteHelpArticle(id: string): Promise<boolean>;
  searchHelpArticles(query: string): Promise<HelpArticle[]>;

  // SWOT Analysis operations
  getSwotAnalysesByProject(projectId: string): Promise<SwotAnalysis[]>;
  getSwotAnalysis(id: string): Promise<SwotAnalysis | undefined>;
  createSwotAnalysis(analysis: InsertSwotAnalysis): Promise<SwotAnalysis>;
  updateSwotAnalysis(id: string, analysis: Partial<InsertSwotAnalysis>): Promise<SwotAnalysis | undefined>;
  deleteSwotAnalysis(id: string): Promise<boolean>;

  // SWOT Item operations
  getSwotItems(analysisId: string): Promise<SwotItem[]>;
  getSwotItem(id: string): Promise<SwotItem | undefined>;
  createSwotItem(item: InsertSwotItem): Promise<SwotItem>;
  updateSwotItem(id: string, item: Partial<InsertSwotItem>): Promise<SwotItem | undefined>;
  deleteSwotItem(id: string): Promise<boolean>;
  getSwotItemsByProject(projectId: string): Promise<(SwotItem & { analysisName: string })[]>;

  // Report Configuration operations
  getReportConfigurations(projectId: string): Promise<ReportConfiguration[]>;
  getReportConfiguration(id: string): Promise<ReportConfiguration | undefined>;
  createReportConfiguration(config: InsertReportConfiguration): Promise<ReportConfiguration>;
  updateReportConfiguration(id: string, config: Partial<InsertReportConfiguration>): Promise<ReportConfiguration | undefined>;
  deleteReportConfiguration(id: string): Promise<boolean>;

  // CRM Pipeline Stage operations
  getAllCrmPipelineStages(): Promise<CrmPipelineStage[]>;
  getCrmPipelineStage(id: string): Promise<CrmPipelineStage | undefined>;
  createCrmPipelineStage(stage: InsertCrmPipelineStage): Promise<CrmPipelineStage>;
  updateCrmPipelineStage(id: string, stage: Partial<InsertCrmPipelineStage>): Promise<CrmPipelineStage | undefined>;
  deleteCrmPipelineStage(id: string): Promise<boolean>;

  // CRM Lead operations
  getAllCrmLeads(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<CrmLead[]>;
  getCrmLead(id: string): Promise<CrmLead | undefined>;
  createCrmLead(lead: InsertCrmLead): Promise<CrmLead>;
  updateCrmLead(id: string, lead: Partial<InsertCrmLead>): Promise<CrmLead | undefined>;
  deleteCrmLead(id: string): Promise<boolean>;

  // CRM Opportunity operations
  getAllCrmOpportunities(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<CrmOpportunity[]>;
  getCrmOpportunity(id: string): Promise<CrmOpportunity | undefined>;
  getCrmOpportunitiesByStage(stageId: string): Promise<CrmOpportunity[]>;
  createCrmOpportunity(opportunity: InsertCrmOpportunity): Promise<CrmOpportunity>;
  updateCrmOpportunity(id: string, opportunity: Partial<InsertCrmOpportunity>): Promise<CrmOpportunity | undefined>;
  deleteCrmOpportunity(id: string): Promise<boolean>;

  // CRM Activity operations
  getCrmActivities(filters: { leadId?: string; opportunityId?: string; clientId?: string }): Promise<CrmActivity[]>;
  getCrmActivity(id: string): Promise<CrmActivity | undefined>;
  createCrmActivity(activity: InsertCrmActivity): Promise<CrmActivity>;
  updateCrmActivity(id: string, activity: Partial<InsertCrmActivity>): Promise<CrmActivity | undefined>;
  deleteCrmActivity(id: string): Promise<boolean>;

  // Support Type operations
  getSupportTypes(): Promise<SupportType[]>;
  getSupportType(id: string): Promise<SupportType | undefined>;
  createSupportType(data: InsertSupportType): Promise<SupportType>;
  updateSupportType(id: string, data: Partial<InsertSupportType>): Promise<SupportType | undefined>;
  deleteSupportType(id: string): Promise<boolean>;

  // Support Ticket operations
  getSupportTickets(filters?: { clientId?: string; status?: string; assignedToId?: string; projectId?: string }): Promise<SupportTicket[]>;
  getSupportTicket(id: string): Promise<SupportTicketWithRelations | undefined>;
  createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket>;
  updateSupportTicket(id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket | undefined>;
  deleteSupportTicket(id: string): Promise<boolean>;

  // Ticket Comment operations
  getTicketComments(ticketId: string): Promise<TicketComment[]>;
  createTicketComment(data: InsertTicketComment): Promise<TicketComment>;
  deleteTicketComment(id: string): Promise<boolean>;

  // Knowledge Category operations
  getKnowledgeCategories(): Promise<KnowledgeCategory[]>;
  getKnowledgeCategory(id: string): Promise<KnowledgeCategory | undefined>;
  createKnowledgeCategory(data: InsertKnowledgeCategory): Promise<KnowledgeCategory>;
  updateKnowledgeCategory(id: string, data: Partial<InsertKnowledgeCategory>): Promise<KnowledgeCategory | undefined>;
  deleteKnowledgeCategory(id: string): Promise<boolean>;

  // Knowledge Article operations
  getKnowledgeArticles(filters?: { categoryId?: string; status?: string; accessLevel?: string }): Promise<KnowledgeArticle[]>;
  getKnowledgeArticle(id: string): Promise<KnowledgeArticleWithRelations | undefined>;
  createKnowledgeArticle(data: InsertKnowledgeArticle): Promise<KnowledgeArticle>;
  updateKnowledgeArticle(id: string, data: Partial<InsertKnowledgeArticle>): Promise<KnowledgeArticle | undefined>;
  deleteKnowledgeArticle(id: string): Promise<boolean>;

  // Training Content operations
  getTrainingContents(filters?: { categoryId?: string; accessLevel?: string }): Promise<TrainingContent[]>;
  getTrainingContent(id: string): Promise<TrainingContentWithRelations | undefined>;
  createTrainingContent(data: InsertTrainingContent): Promise<TrainingContent>;
  updateTrainingContent(id: string, data: Partial<InsertTrainingContent>): Promise<TrainingContent | undefined>;
  deleteTrainingContent(id: string): Promise<boolean>;

  // Client Membership operations
  getClientMemberships(clientId?: string): Promise<ClientMembership[]>;
  getClientMembership(id: string): Promise<ClientMembership | undefined>;
  createClientMembership(data: InsertClientMembership): Promise<ClientMembership>;
  updateClientMembership(id: string, data: Partial<InsertClientMembership>): Promise<ClientMembership | undefined>;
  deleteClientMembership(id: string): Promise<boolean>;

  // Client Portal Access operations
  getClientPortalAccess(clientContactId: string): Promise<ClientPortalAccess | undefined>;
  getClientPortalAccessById(id: string): Promise<ClientPortalAccess | undefined>;
  createClientPortalAccess(data: InsertClientPortalAccess): Promise<ClientPortalAccess>;
  updateClientPortalAccess(id: string, data: Partial<InsertClientPortalAccess>): Promise<ClientPortalAccess | undefined>;

  // Content Access Log operations
  logContentAccess(data: InsertContentAccessLog): Promise<ContentAccessLog>;
  getContentAccessLogs(filters: { clientId?: string; contentType?: string }): Promise<ContentAccessLog[]>;

  // Scrum Internal Project operations
  getScrumInternalProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<ScrumInternalProject[]>;
  getScrumInternalProject(id: string): Promise<ScrumInternalProject | undefined>;
  createScrumInternalProject(data: InsertScrumInternalProject): Promise<ScrumInternalProject>;
  updateScrumInternalProject(id: string, data: Partial<InsertScrumInternalProject>): Promise<ScrumInternalProject | undefined>;
  deleteScrumInternalProject(id: string): Promise<boolean>;

  // Scrum Team operations
  getScrumTeams(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<ScrumTeam[]>;
  getScrumTeam(id: string): Promise<ScrumTeam | undefined>;
  createScrumTeam(data: InsertScrumTeam): Promise<ScrumTeam>;
  updateScrumTeam(id: string, data: Partial<InsertScrumTeam>): Promise<ScrumTeam | undefined>;
  deleteScrumTeam(id: string): Promise<boolean>;

  // Scrum Team Member operations
  getScrumTeamMembers(teamId: string): Promise<ScrumTeamMember[]>;
  getScrumTeamMember(id: string): Promise<ScrumTeamMember | undefined>;
  createScrumTeamMember(data: InsertScrumTeamMember): Promise<ScrumTeamMember>;
  updateScrumTeamMember(id: string, data: Partial<InsertScrumTeamMember>): Promise<ScrumTeamMember | undefined>;
  deleteScrumTeamMember(id: string): Promise<boolean>;

  // Scrum Sprint operations
  getScrumSprints(projectId?: string, tenantId?: string | null): Promise<ScrumSprint[]>;
  getScrumSprint(id: string): Promise<ScrumSprint | undefined>;
  createScrumSprint(data: InsertScrumSprint): Promise<ScrumSprint>;
  updateScrumSprint(id: string, data: Partial<InsertScrumSprint>): Promise<ScrumSprint | undefined>;
  deleteScrumSprint(id: string): Promise<boolean>;

  // Scrum Backlog Item (PBI) operations
  getScrumBacklogItems(filters?: { projectId?: string; sprintId?: string; status?: string; assigneeId?: string; tenantId?: string | null }): Promise<ScrumBacklogItem[]>;
  getScrumBacklogItem(id: string): Promise<ScrumBacklogItem | undefined>;
  createScrumBacklogItem(data: InsertScrumBacklogItem): Promise<ScrumBacklogItem>;
  updateScrumBacklogItem(id: string, data: Partial<InsertScrumBacklogItem>): Promise<ScrumBacklogItem | undefined>;
  deleteScrumBacklogItem(id: string): Promise<boolean>;

  // Scrum Timesheet operations
  getScrumTimesheets(pbiId?: string, tenantId?: string | null): Promise<ScrumTimesheet[]>;
  getScrumTimesheet(id: string): Promise<ScrumTimesheet | undefined>;
  createScrumTimesheet(data: InsertScrumTimesheet): Promise<ScrumTimesheet>;
  updateScrumTimesheet(id: string, data: Partial<InsertScrumTimesheet>): Promise<ScrumTimesheet | undefined>;
  deleteScrumTimesheet(id: string): Promise<boolean>;

  // Scrum Rework operations
  getScrumReworks(originalPbiId?: string, tenantId?: string | null): Promise<ScrumRework[]>;
  getScrumRework(id: string): Promise<ScrumRework | undefined>;
  createScrumRework(data: InsertScrumRework): Promise<ScrumRework>;
  updateScrumRework(id: string, data: Partial<InsertScrumRework>): Promise<ScrumRework | undefined>;
  deleteScrumRework(id: string): Promise<boolean>;

  // Scrum Backlog Attachment operations
  getScrumBacklogAttachments(pbiId: string): Promise<ScrumBacklogAttachment[]>;
  getScrumBacklogAttachment(id: string): Promise<ScrumBacklogAttachment | undefined>;
  createScrumBacklogAttachment(data: InsertScrumBacklogAttachment): Promise<ScrumBacklogAttachment>;
  deleteScrumBacklogAttachment(id: string): Promise<boolean>;

  // CRM Proposal operations
  getAllCrmProposals(): Promise<CrmProposal[]>;
  getCrmProposal(id: string): Promise<CrmProposal | undefined>;
  getCrmProposalsByOpportunity(opportunityId: string): Promise<CrmProposal[]>;
  getCrmProposalsByClient(clientId: string): Promise<CrmProposal[]>;
  createCrmProposal(proposal: InsertCrmProposal): Promise<CrmProposal>;
  updateCrmProposal(id: string, proposal: Partial<InsertCrmProposal>): Promise<CrmProposal | undefined>;
  deleteCrmProposal(id: string): Promise<boolean>;
  getNextProposalNumber(): Promise<string>;

  // CRM Proposal Item operations
  getCrmProposalItems(proposalId: string): Promise<CrmProposalItem[]>;
  createCrmProposalItem(item: InsertCrmProposalItem): Promise<CrmProposalItem>;
  updateCrmProposalItem(id: string, item: Partial<InsertCrmProposalItem>): Promise<CrmProposalItem | undefined>;
  deleteCrmProposalItem(id: string): Promise<boolean>;

  // CRM Contract operations
  getAllCrmContracts(): Promise<CrmContract[]>;
  getCrmContract(id: string): Promise<CrmContract | undefined>;
  getCrmContractsByClient(clientId: string): Promise<CrmContract[]>;
  createCrmContract(contract: InsertCrmContract): Promise<CrmContract>;
  updateCrmContract(id: string, contract: Partial<InsertCrmContract>): Promise<CrmContract | undefined>;
  deleteCrmContract(id: string): Promise<boolean>;
  getNextContractNumber(): Promise<string>;

  // CRM Contract Milestone operations
  getCrmContractMilestones(contractId: string): Promise<CrmContractMilestone[]>;
  createCrmContractMilestone(milestone: InsertCrmContractMilestone): Promise<CrmContractMilestone>;
  updateCrmContractMilestone(id: string, milestone: Partial<InsertCrmContractMilestone>): Promise<CrmContractMilestone | undefined>;
  deleteCrmContractMilestone(id: string): Promise<boolean>;

  // CRM Partner operations
  getAllCrmPartners(): Promise<CrmPartner[]>;
  getCrmPartner(id: string): Promise<CrmPartner | undefined>;
  createCrmPartner(partner: InsertCrmPartner): Promise<CrmPartner>;
  updateCrmPartner(id: string, partner: Partial<InsertCrmPartner>): Promise<CrmPartner | undefined>;
  deleteCrmPartner(id: string): Promise<boolean>;

  // CRM Partner Commission operations
  getCrmPartnerCommissions(partnerId: string): Promise<CrmPartnerCommission[]>;
  createCrmPartnerCommission(commission: InsertCrmPartnerCommission): Promise<CrmPartnerCommission>;
  updateCrmPartnerCommission(id: string, commission: Partial<InsertCrmPartnerCommission>): Promise<CrmPartnerCommission | undefined>;
  deleteCrmPartnerCommission(id: string): Promise<boolean>;

  // Partners
  getAllPartners(): Promise<PartnerWithStats[]>;
  getPartner(id: string): Promise<Partner | undefined>;
  getPartnerByUserId(userId: string): Promise<Partner | undefined>;
  createPartner(partner: InsertPartner): Promise<Partner>;
  updatePartner(id: string, partner: Partial<InsertPartner>): Promise<Partner | undefined>;
  deletePartner(id: string): Promise<boolean>;
  // Tenants
  getAllTenants(): Promise<TenantWithRelations[]>;
  getTenant(id: string): Promise<Tenant | undefined>;
  getTenantBySlug(slug: string): Promise<Tenant | undefined>;
  getTenantsByPartner(partnerId: string): Promise<TenantWithRelations[]>;
  getSubTenants(parentTenantId: string): Promise<Tenant[]>;
  getTenantByUserId(userId: string): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, tenant: Partial<InsertTenant>): Promise<Tenant | undefined>;
  deleteTenant(id: string): Promise<boolean>;
  // SubTenants (separate table for branches)
  createSubTenant(data: InsertSubTenant): Promise<SubTenant>;
  updateSubTenant(id: string, data: Partial<InsertSubTenant>): Promise<SubTenant | undefined>;
  deleteSubTenant(id: string): Promise<boolean>;
  // TenantUsers
  getTenantUsers(tenantId: string): Promise<(TenantUser & { user?: User })[]>;
  getTenantUser(tenantId: string, userId: string): Promise<TenantUser | undefined>;
  addTenantUser(data: InsertTenantUser): Promise<TenantUser>;
  updateTenantUser(id: string, data: Partial<InsertTenantUser>): Promise<TenantUser | undefined>;
  removeTenantUser(id: string): Promise<boolean>;
  getUserTenants(userId: string): Promise<Tenant[]>;
  // InviteTokens
  createInviteToken(invite: InsertInviteToken): Promise<InviteToken>;
  getInviteByToken(token: string): Promise<InviteToken | undefined>;
  acceptInvite(token: string): Promise<InviteToken | undefined>;
  getInvitesByTenant(tenantId: string): Promise<InviteToken[]>;
  // Partner API keys (MCP Hub Sprint 4)
  createPartnerApiKey(input: InsertPartnerApiKey): Promise<PartnerApiKey>;
  listPartnerApiKeys(tenantId: string): Promise<PartnerApiKey[]>;
  getPartnerApiKeyByHash(hash: string): Promise<PartnerApiKey | undefined>;
  revokePartnerApiKey(id: string, tenantId: string): Promise<PartnerApiKey | undefined>;
  touchPartnerApiKeyUsage(id: string): Promise<void>;

  // Role Permissions
  getRolePermissions(tenantId: string): Promise<RolePermission[]>;
  upsertRolePermissions(tenantId: string, items: Array<{ role: string; module: string; canView: number; canCreate: number; canEdit: number; canDelete: number }>): Promise<void>;
  // Platform metrics
  getPlatformMetrics(): Promise<{ totalPartners: number; totalTenants: number; totalUsers: number; activeProjects: number; totalClients: number; tokensThisMonth: number; }>;
  updateUserSystemRole(id: string, systemRole: string): Promise<User | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.firstName);
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const validRoles: Array<'superadmin' | 'admin' | 'gerente' | 'tecnico'> = ['superadmin', 'admin', 'gerente', 'tecnico'];
    const safeRole: 'superadmin' | 'admin' | 'gerente' | 'tecnico' = validRoles.includes(role as 'superadmin' | 'admin' | 'gerente' | 'tecnico')
      ? (role as 'superadmin' | 'admin' | 'gerente' | 'tecnico')
      : 'tecnico';
    const [user] = await db
      .update(users)
      .set({ role: safeRole, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByProviderSub(providerSub: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.providerSub, providerSub));
    return user;
  }

  async upsertOidcUser(userData: { providerSub: string; email?: string; firstName?: string; lastName?: string; profileImageUrl?: string; provider: string }): Promise<User> {
    let existingUser = await this.getUserByProviderSub(userData.providerSub);
    
    if (!existingUser && userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }
    
    if (existingUser) {
      const [updated] = await db
        .update(users)
        .set({
          providerSub: userData.providerSub,
          provider: userData.provider,
          firstName: userData.firstName || existingUser.firstName,
          lastName: userData.lastName || existingUser.lastName,
          profileImageUrl: userData.profileImageUrl || existingUser.profileImageUrl,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();
      return updated;
    }
    
    const [newUser] = await db
      .insert(users)
      .values({
        email: userData.email || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        profileImageUrl: userData.profileImageUrl || null,
        providerSub: userData.providerSub,
        provider: userData.provider,
        isLocalAuth: 0,
        isActive: 1,
        lastLoginAt: new Date(),
      })
      .returning();
    return newUser;
  }

  async createUser(userData: { email: string; firstName?: string; lastName?: string; role?: string }): Promise<User> {
    const validRoles: Array<'superadmin' | 'admin' | 'gerente' | 'tecnico'> = ['superadmin', 'admin', 'gerente', 'tecnico'];
    const safeRole: 'superadmin' | 'admin' | 'gerente' | 'tecnico' = (userData.role && validRoles.includes(userData.role as 'superadmin' | 'admin' | 'gerente' | 'tecnico'))
      ? (userData.role as 'superadmin' | 'admin' | 'gerente' | 'tecnico')
      : 'tecnico';
    const [user] = await db
      .insert(users)
      .values({
        email: userData.email,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        role: safeRole,
      })
      .returning();
    return user;
  }

  async createLocalUser(userData: { email: string; passwordHash: string; firstName?: string | null; lastName?: string | null; role?: string; isLocalAuth: number; isActive: number }): Promise<User> {
    const validRoles: Array<'superadmin' | 'admin' | 'gerente' | 'tecnico'> = ['superadmin', 'admin', 'gerente', 'tecnico'];
    const role: 'superadmin' | 'admin' | 'gerente' | 'tecnico' = (userData.role && validRoles.includes(userData.role as 'superadmin' | 'admin' | 'gerente' | 'tecnico'))
      ? (userData.role as 'superadmin' | 'admin' | 'gerente' | 'tecnico')
      : 'tecnico';
    const [user] = await db
      .insert(users)
      .values({
        email: userData.email,
        passwordHash: userData.passwordHash,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        isLocalAuth: userData.isLocalAuth,
        isActive: userData.isActive,
        role,
      })
      .returning();
    return user;
  }

  async updateUserLoginTime(id: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUserDetails(id: string, data: { firstName?: string; lastName?: string; email?: string }): Promise<User | undefined> {
    const updateData: any = { updatedAt: new Date() };
    if (data.firstName !== undefined) updateData.firstName = data.firstName || null;
    if (data.lastName !== undefined) updateData.lastName = data.lastName || null;
    if (data.email !== undefined) updateData.email = data.email;
    
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserStatus(id: string, isActive: number): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ passwordHash, isLocalAuth: 1, provider: 'local', updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  // Client operations
  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async getAllClients(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Client[]> {
    if (tenantId) {
      return await db.select().from(clients).where(eq(clients.tenantId, tenantId)).orderBy(desc(clients.createdAt));
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined> {
    const [updatedClient] = await db
      .update(clients)
      .set({ ...client, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return updatedClient;
  }

  async deleteClient(id: string): Promise<boolean> {
    const result = await db.delete(clients).where(eq(clients.id, id));
    return true;
  }

  // Project operations
  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getAllProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Project[]> {
    if (tenantId) {
      return await db.select().from(projects).where(eq(projects.tenantId, tenantId)).orderBy(desc(projects.createdAt));
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProductionProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Project[]> {
    // Filtra demandas (type='compass') no nível do banco — fonte única de
    // verdade para "projetos de produção".
    const notCompass = ne(projects.type, 'compass');
    if (tenantId) {
      return await db.select().from(projects)
        .where(and(eq(projects.tenantId, tenantId), notCompass))
        .orderBy(desc(projects.createdAt));
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(projects).where(notCompass).orderBy(desc(projects.createdAt));
  }

  async getProjectsByClient(clientId: string, tenantId?: string | null): Promise<Project[]> {
    if (tenantId) {
      return await db.select().from(projects)
        .where(and(eq(projects.clientId, clientId), eq(projects.tenantId, tenantId)))
        .orderBy(desc(projects.createdAt));
    }
    return await db.select().from(projects).where(eq(projects.clientId, clientId)).orderBy(desc(projects.createdAt));
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updatedProject] = await db
      .update(projects)
      .set({ ...project, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updatedProject;
  }

  async deleteProject(id: string): Promise<boolean> {
    await db.delete(projects).where(eq(projects.id, id));
    return true;
  }

  // Project Member operations
  async getProjectMembers(projectId: string): Promise<(ProjectMember & { user?: User })[]> {
    const members = await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId));
    const result = await Promise.all(
      members.map(async (member) => {
        const user = await this.getUser(member.userId);
        return { ...member, user };
      })
    );
    return result;
  }

  async addProjectMember(member: InsertProjectMember): Promise<ProjectMember> {
    const [newMember] = await db.insert(projectMembers).values(member).returning();
    return newMember;
  }

  async removeProjectMember(projectId: string, userId: string): Promise<boolean> {
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return true;
  }

  // Canvas Block operations
  async getCanvasBlocks(projectId: string): Promise<CanvasBlock[]> {
    return await db.select().from(canvasBlocks).where(eq(canvasBlocks.projectId, projectId));
  }

  async getCanvasBlock(id: string): Promise<CanvasBlock | undefined> {
    const [block] = await db.select().from(canvasBlocks).where(eq(canvasBlocks.id, id));
    return block;
  }

  async createCanvasBlock(block: InsertCanvasBlock): Promise<CanvasBlock> {
    const [newBlock] = await db.insert(canvasBlocks).values(block).returning();
    return newBlock;
  }

  async updateCanvasBlock(id: string, block: Partial<InsertCanvasBlock>): Promise<CanvasBlock | undefined> {
    const [updatedBlock] = await db
      .update(canvasBlocks)
      .set({ ...block, updatedAt: new Date() })
      .where(eq(canvasBlocks.id, id))
      .returning();
    return updatedBlock;
  }

  async deleteCanvasBlock(id: string): Promise<boolean> {
    await db.delete(canvasBlocks).where(eq(canvasBlocks.id, id));
    return true;
  }

  // Canvas Block Question operations
  async getCanvasBlockQuestions(blockId: string): Promise<CanvasBlockQuestion[]> {
    return await db.select().from(canvasBlockQuestions)
      .where(eq(canvasBlockQuestions.blockId, blockId))
      .orderBy(canvasBlockQuestions.order);
  }

  async getCanvasBlockQuestion(id: string): Promise<CanvasBlockQuestion | undefined> {
    const [question] = await db.select().from(canvasBlockQuestions).where(eq(canvasBlockQuestions.id, id));
    return question;
  }

  async createCanvasBlockQuestion(question: InsertCanvasBlockQuestion): Promise<CanvasBlockQuestion> {
    const [newQuestion] = await db.insert(canvasBlockQuestions).values(question).returning();
    return newQuestion;
  }

  async updateCanvasBlockQuestion(id: string, question: Partial<InsertCanvasBlockQuestion>): Promise<CanvasBlockQuestion | undefined> {
    const [updated] = await db
      .update(canvasBlockQuestions)
      .set({ ...question, updatedAt: new Date() })
      .where(eq(canvasBlockQuestions.id, id))
      .returning();
    return updated;
  }

  async deleteCanvasBlockQuestion(id: string): Promise<boolean> {
    await db.delete(canvasBlockQuestions).where(eq(canvasBlockQuestions.id, id));
    return true;
  }

  // Canvas PDCA operations
  async getCanvasPdcaItems(projectId: string): Promise<CanvasPdcaItem[]> {
    return await db.select().from(canvasPdcaItems)
      .where(eq(canvasPdcaItems.projectId, projectId))
      .orderBy(desc(canvasPdcaItems.createdAt));
  }

  async getCanvasPdcaItem(id: string): Promise<CanvasPdcaItem | undefined> {
    const [item] = await db.select().from(canvasPdcaItems).where(eq(canvasPdcaItems.id, id));
    return item;
  }

  async createCanvasPdcaItem(item: InsertCanvasPdcaItem): Promise<CanvasPdcaItem> {
    const [newItem] = await db.insert(canvasPdcaItems).values(item).returning();
    return newItem;
  }

  async updateCanvasPdcaItem(id: string, item: Partial<InsertCanvasPdcaItem>): Promise<CanvasPdcaItem | undefined> {
    const [updated] = await db
      .update(canvasPdcaItems)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(canvasPdcaItems.id, id))
      .returning();
    return updated;
  }

  async deleteCanvasPdcaItem(id: string): Promise<boolean> {
    await db.delete(canvasPdcaItems).where(eq(canvasPdcaItems.id, id));
    return true;
  }

  // Process Step PDCA operations
  async getProcessStepPdcaItems(stepId: string): Promise<ProcessStepPdca[]> {
    return await db.select().from(processStepPdca)
      .where(eq(processStepPdca.stepId, stepId))
      .orderBy(desc(processStepPdca.createdAt));
  }

  async getProcessStepPdcaItem(id: string): Promise<ProcessStepPdca | undefined> {
    const [item] = await db.select().from(processStepPdca).where(eq(processStepPdca.id, id));
    return item;
  }

  async createProcessStepPdcaItem(item: InsertProcessStepPdca): Promise<ProcessStepPdca> {
    const [newItem] = await db.insert(processStepPdca).values(item).returning();
    return newItem;
  }

  async updateProcessStepPdcaItem(id: string, item: Partial<InsertProcessStepPdca>): Promise<ProcessStepPdca | undefined> {
    const [updated] = await db
      .update(processStepPdca)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(processStepPdca.id, id))
      .returning();
    return updated;
  }

  async deleteProcessStepPdcaItem(id: string): Promise<boolean> {
    await db.delete(processStepPdca).where(eq(processStepPdca.id, id));
    return true;
  }

  async getAllProcessPdcaItemsForProject(projectId: string): Promise<(ProcessStepPdca & { processName: string; stepName: string; processId: string })[]> {
    const results = await db
      .select({
        id: processStepPdca.id,
        stepId: processStepPdca.stepId,
        title: processStepPdca.title,
        description: processStepPdca.description,
        status: processStepPdca.status,
        responsible: processStepPdca.responsible,
        dueDate: processStepPdca.dueDate,
        priority: processStepPdca.priority,
        createdAt: processStepPdca.createdAt,
        updatedAt: processStepPdca.updatedAt,
        processName: processes.name,
        stepName: processSteps.name,
        processId: processes.id,
      })
      .from(processStepPdca)
      .innerJoin(processSteps, eq(processStepPdca.stepId, processSteps.id))
      .innerJoin(processes, eq(processSteps.processId, processes.id))
      .where(and(
        eq(processes.projectId, projectId),
        eq(processes.variantType, 'to_be')
      ))
      .orderBy(desc(processStepPdca.createdAt));
    
    return results;
  }

  // Process operations
  async getProcesses(projectId: string): Promise<Process[]> {
    return await db.select().from(processes).where(eq(processes.projectId, projectId));
  }

  async getProcess(id: string): Promise<Process | undefined> {
    const [process] = await db.select().from(processes).where(eq(processes.id, id));
    return process;
  }

  async createProcess(process: InsertProcess): Promise<Process> {
    const [newProcess] = await db.insert(processes).values(process).returning();
    return newProcess;
  }

  async updateProcess(id: string, process: Partial<InsertProcess>): Promise<Process | undefined> {
    const [updatedProcess] = await db
      .update(processes)
      .set({ ...process, updatedAt: new Date() })
      .where(eq(processes.id, id))
      .returning();
    return updatedProcess;
  }

  async deleteProcess(id: string): Promise<boolean> {
    await db.delete(processSteps).where(eq(processSteps.processId, id));
    await db.delete(processes).where(eq(processes.id, id));
    return true;
  }

  // Process Step operations
  async getProcessSteps(processId: string): Promise<ProcessStep[]> {
    return await db.select().from(processSteps).where(eq(processSteps.processId, processId)).orderBy(processSteps.order);
  }

  async getProcessStep(id: string): Promise<ProcessStep | undefined> {
    const [step] = await db.select().from(processSteps).where(eq(processSteps.id, id));
    return step;
  }

  async createProcessStep(step: InsertProcessStep): Promise<ProcessStep> {
    const [newStep] = await db.insert(processSteps).values(step).returning();
    return newStep;
  }

  async updateProcessStep(id: string, step: Partial<InsertProcessStep>): Promise<ProcessStep | undefined> {
    const [updated] = await db.update(processSteps).set({ ...step, updatedAt: new Date() }).where(eq(processSteps.id, id)).returning();
    return updated;
  }

  async deleteProcessStep(id: string): Promise<boolean> {
    await db.delete(processSteps).where(eq(processSteps.id, id));
    return true;
  }

  // Deliverable operations
  async getDeliverables(projectId: string): Promise<Deliverable[]> {
    return await db.select().from(deliverables).where(eq(deliverables.projectId, projectId));
  }

  async getDeliverable(id: string): Promise<Deliverable | undefined> {
    const [deliverable] = await db.select().from(deliverables).where(eq(deliverables.id, id));
    return deliverable;
  }

  async createDeliverable(deliverable: InsertDeliverable): Promise<Deliverable> {
    const [newDeliverable] = await db.insert(deliverables).values(deliverable).returning();
    return newDeliverable;
  }

  async updateDeliverable(id: string, deliverable: Partial<InsertDeliverable>): Promise<Deliverable | undefined> {
    const [updatedDeliverable] = await db
      .update(deliverables)
      .set({ ...deliverable, updatedAt: new Date() })
      .where(eq(deliverables.id, id))
      .returning();
    return updatedDeliverable;
  }

  async deleteDeliverable(id: string): Promise<boolean> {
    await db.delete(deliverables).where(eq(deliverables.id, id));
    return true;
  }

  // Task operations
  async getAllTasks(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<Task[]> {
    if (tenantId !== undefined && tenantId !== null) {
      return await db.select().from(tasks).where(eq(tasks.tenantId, tenantId)).orderBy(tasks.dueDate, tasks.order);
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(tasks).orderBy(tasks.dueDate, tasks.order);
  }

  async getTasks(projectId: string): Promise<Task[]> {
    return await db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(tasks.order);
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    return newTask;
  }

  async updateTask(id: string, task: Partial<InsertTask>): Promise<Task | undefined> {
    const [updatedTask] = await db
      .update(tasks)
      .set({ ...task, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    await db.delete(tasks).where(eq(tasks.id, id));
    return true;
  }

  // Process Diagram operations
  async getProcessDiagram(processId: string): Promise<ProcessDiagram | undefined> {
    const [diagram] = await db.select().from(processDiagrams).where(eq(processDiagrams.processId, processId));
    return diagram;
  }

  async upsertProcessDiagram(diagram: InsertProcessDiagram): Promise<ProcessDiagram> {
    const [result] = await db
      .insert(processDiagrams)
      .values(diagram)
      .onConflictDoUpdate({
        target: processDiagrams.processId,
        set: {
          nodes: diagram.nodes,
          edges: diagram.edges,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Process Step File operations
  async getProcessStepFiles(stepId: string): Promise<ProcessStepFile[]> {
    return await db.select().from(processStepFiles).where(eq(processStepFiles.stepId, stepId));
  }

  async getProcessStepFile(id: string): Promise<ProcessStepFile | undefined> {
    const [file] = await db.select().from(processStepFiles).where(eq(processStepFiles.id, id));
    return file;
  }

  async createProcessStepFile(file: InsertProcessStepFile): Promise<ProcessStepFile> {
    const [newFile] = await db.insert(processStepFiles).values(file).returning();
    return newFile;
  }

  async deleteProcessStepFile(id: string): Promise<ProcessStepFile | undefined> {
    const [deleted] = await db.delete(processStepFiles).where(eq(processStepFiles.id, id)).returning();
    return deleted;
  }

  // Client Contact operations
  async getClientContacts(clientId: string): Promise<ClientContact[]> {
    return await db.select().from(clientContacts).where(eq(clientContacts.clientId, clientId)).orderBy(desc(clientContacts.isPrimary), clientContacts.name);
  }

  async getClientContact(id: string): Promise<ClientContact | undefined> {
    const [contact] = await db.select().from(clientContacts).where(eq(clientContacts.id, id));
    return contact;
  }

  async createClientContact(contact: InsertClientContact): Promise<ClientContact> {
    const [newContact] = await db.insert(clientContacts).values(contact).returning();
    return newContact;
  }

  async updateClientContact(id: string, contact: Partial<InsertClientContact>): Promise<ClientContact | undefined> {
    const [updated] = await db.update(clientContacts).set({ ...contact, updatedAt: new Date() }).where(eq(clientContacts.id, id)).returning();
    return updated;
  }

  async deleteClientContact(id: string): Promise<boolean> {
    await db.delete(clientContacts).where(eq(clientContacts.id, id));
    return true;
  }

  // Collaborator operations
  async getCollaborators(clientId: string): Promise<Collaborator[]> {
    return await db.select().from(collaborators).where(eq(collaborators.clientId, clientId)).orderBy(collaborators.name);
  }

  async getAllCollaborators(): Promise<Collaborator[]> {
    return await db.select().from(collaborators).orderBy(collaborators.name);
  }

  async getCollaborator(id: string): Promise<Collaborator | undefined> {
    const [collaborator] = await db.select().from(collaborators).where(eq(collaborators.id, id));
    return collaborator;
  }

  async createCollaborator(collaborator: InsertCollaborator): Promise<Collaborator> {
    const [newCollaborator] = await db.insert(collaborators).values(collaborator).returning();
    return newCollaborator;
  }

  async updateCollaborator(id: string, collaborator: Partial<InsertCollaborator>): Promise<Collaborator | undefined> {
    const [updated] = await db.update(collaborators).set({ ...collaborator, updatedAt: new Date() }).where(eq(collaborators.id, id)).returning();
    return updated;
  }

  async deleteCollaborator(id: string): Promise<boolean> {
    await db.delete(collaborators).where(eq(collaborators.id, id));
    return true;
  }

  // Project Collaborator operations
  async getProjectCollaborators(projectId: string): Promise<(ProjectCollaborator & { collaborator?: Collaborator })[]> {
    const assignments = await db.select().from(projectCollaborators).where(eq(projectCollaborators.projectId, projectId));
    const result = await Promise.all(
      assignments.map(async (assignment) => {
        const collaborator = await this.getCollaborator(assignment.collaboratorId);
        return { ...assignment, collaborator };
      })
    );
    return result;
  }

  async addProjectCollaborator(data: InsertProjectCollaborator): Promise<ProjectCollaborator> {
    const [newAssignment] = await db.insert(projectCollaborators).values(data).returning();
    return newAssignment;
  }

  async updateProjectCollaboratorPermission(projectId: string, collaboratorId: string, permission: string): Promise<ProjectCollaborator | undefined> {
    const [updated] = await db
      .update(projectCollaborators)
      .set({ permission })
      .where(and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.collaboratorId, collaboratorId)))
      .returning();
    return updated;
  }

  async removeProjectCollaborator(projectId: string, collaboratorId: string): Promise<boolean> {
    await db
      .delete(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.collaboratorId, collaboratorId)));
    return true;
  }

  async getAvailableCollaboratorsForProject(projectId: string): Promise<Collaborator[]> {
    const project = await this.getProject(projectId);
    if (!project) return [];
    
    const existingAssignments = await db.select().from(projectCollaborators).where(eq(projectCollaborators.projectId, projectId));
    const assignedIds = existingAssignments.map(a => a.collaboratorId);
    
    const allCollaborators = await db.select().from(collaborators)
      .where(and(
        eq(collaborators.clientId, project.clientId),
        eq(collaborators.isActive, 1)
      ))
      .orderBy(collaborators.name);
    
    return allCollaborators.filter(c => !assignedIds.includes(c.id));
  }

  // Process Collaborator operations
  async getProcessCollaborators(processId: string): Promise<(ProcessCollaborator & { collaborator?: Collaborator })[]> {
    const assignments = await db.select().from(processCollaborators).where(eq(processCollaborators.processId, processId));
    const result = await Promise.all(assignments.map(async (a) => {
      const collaborator = await this.getCollaborator(a.collaboratorId);
      return { ...a, collaborator };
    }));
    return result;
  }

  async setProcessCollaborator(data: InsertProcessCollaborator): Promise<ProcessCollaborator> {
    const existing = await db.select().from(processCollaborators)
      .where(and(eq(processCollaborators.processId, data.processId), eq(processCollaborators.collaboratorId, data.collaboratorId)));
    if (existing.length > 0) {
      const [updated] = await db.update(processCollaborators)
        .set({ participates: data.participates, role: data.role })
        .where(and(eq(processCollaborators.processId, data.processId), eq(processCollaborators.collaboratorId, data.collaboratorId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(processCollaborators).values(data).returning();
    return created;
  }

  async removeProcessCollaborator(processId: string, collaboratorId: string): Promise<boolean> {
    await db.delete(processCollaborators)
      .where(and(eq(processCollaborators.processId, processId), eq(processCollaborators.collaboratorId, collaboratorId)));
    return true;
  }

  async getProjectCollaboratorsForProcess(processId: string): Promise<(Collaborator & { participates: boolean; processCollaboratorId?: string })[]> {
    const process = await db.select().from(processes).where(eq(processes.id, processId)).then(r => r[0]);
    if (!process) return [];

    const projCollabs = await db.select().from(projectCollaborators)
      .where(eq(projectCollaborators.projectId, process.projectId));
    const procCollabs = await db.select().from(processCollaborators)
      .where(eq(processCollaborators.processId, processId));

    const result = await Promise.all(projCollabs.map(async (pc) => {
      const collaborator = await this.getCollaborator(pc.collaboratorId);
      if (!collaborator) return null;
      const procCollab = procCollabs.find(p => p.collaboratorId === pc.collaboratorId);
      return {
        ...collaborator,
        participates: procCollab ? procCollab.participates === 1 : false,
        processCollaboratorId: procCollab?.id,
      };
    }));

    return result.filter(Boolean) as (Collaborator & { participates: boolean; processCollaboratorId?: string })[];
  }

  // Process Diagram Version operations
  async getProcessDiagramVersions(processId: string): Promise<ProcessDiagramVersion[]> {
    return await db.select().from(processDiagramVersions)
      .where(eq(processDiagramVersions.processId, processId))
      .orderBy(desc(processDiagramVersions.version));
  }

  async createProcessDiagramVersion(version: InsertProcessDiagramVersion): Promise<ProcessDiagramVersion> {
    const [newVersion] = await db.insert(processDiagramVersions).values(version).returning();
    return newVersion;
  }

  // Process Step Diagnostic operations
  async getProcessStepDiagnostic(id: string): Promise<ProcessStepDiagnostic | undefined> {
    const [diagnostic] = await db.select().from(processStepDiagnostics).where(eq(processStepDiagnostics.id, id));
    return diagnostic;
  }

  async getProcessStepDiagnostics(stepId: string): Promise<ProcessStepDiagnostic[]> {
    return await db.select().from(processStepDiagnostics).where(eq(processStepDiagnostics.stepId, stepId));
  }

  async getProcessDiagnostics(processId: string): Promise<ProcessStepDiagnostic[]> {
    const steps = await this.getProcessSteps(processId);
    const stepIds = steps.map(s => s.id);
    if (stepIds.length === 0) return [];
    
    const diagnostics: ProcessStepDiagnostic[] = [];
    for (const stepId of stepIds) {
      const stepDiagnostics = await this.getProcessStepDiagnostics(stepId);
      diagnostics.push(...stepDiagnostics);
    }
    return diagnostics;
  }

  async createProcessStepDiagnostic(diagnostic: InsertProcessStepDiagnostic): Promise<ProcessStepDiagnostic> {
    const [newDiagnostic] = await db.insert(processStepDiagnostics).values(diagnostic).returning();
    return newDiagnostic;
  }

  async updateProcessStepDiagnostic(id: string, diagnostic: Partial<InsertProcessStepDiagnostic>): Promise<ProcessStepDiagnostic | undefined> {
    const [updated] = await db.update(processStepDiagnostics)
      .set({ ...diagnostic, updatedAt: new Date() })
      .where(eq(processStepDiagnostics.id, id))
      .returning();
    return updated;
  }

  async deleteProcessStepDiagnostic(id: string): Promise<boolean> {
    await db.delete(processStepDiagnostics).where(eq(processStepDiagnostics.id, id));
    return true;
  }

  // Process Recommendation operations
  async getProcessRecommendation(id: string): Promise<ProcessRecommendation | undefined> {
    const [recommendation] = await db.select().from(processRecommendations).where(eq(processRecommendations.id, id));
    return recommendation;
  }

  async getProcessRecommendations(processId: string): Promise<ProcessRecommendation[]> {
    return await db.select().from(processRecommendations)
      .where(eq(processRecommendations.processId, processId))
      .orderBy(desc(processRecommendations.priority));
  }

  async createProcessRecommendation(recommendation: InsertProcessRecommendation): Promise<ProcessRecommendation> {
    const [newRecommendation] = await db.insert(processRecommendations).values(recommendation).returning();
    return newRecommendation;
  }

  async updateProcessRecommendation(id: string, recommendation: Partial<InsertProcessRecommendation>): Promise<ProcessRecommendation | undefined> {
    const [updated] = await db.update(processRecommendations)
      .set({ ...recommendation, updatedAt: new Date() })
      .where(eq(processRecommendations.id, id))
      .returning();
    return updated;
  }

  async deleteProcessRecommendation(id: string): Promise<boolean> {
    await db.delete(processRecommendations).where(eq(processRecommendations.id, id));
    return true;
  }

  // Process KPI operations
  async getProcessKpi(id: string): Promise<ProcessKpi | undefined> {
    const [kpi] = await db.select().from(processKpis).where(eq(processKpis.id, id));
    return kpi;
  }

  async getProcessKpis(processId: string): Promise<ProcessKpi[]> {
    return await db.select().from(processKpis).where(eq(processKpis.processId, processId));
  }

  async createProcessKpi(kpi: InsertProcessKpi): Promise<ProcessKpi> {
    const [newKpi] = await db.insert(processKpis).values(kpi).returning();
    return newKpi;
  }

  async updateProcessKpi(id: string, kpi: Partial<InsertProcessKpi>): Promise<ProcessKpi | undefined> {
    const [updated] = await db.update(processKpis)
      .set({ ...kpi, updatedAt: new Date() })
      .where(eq(processKpis.id, id))
      .returning();
    return updated;
  }

  async deleteProcessKpi(id: string): Promise<boolean> {
    await db.delete(processKpis).where(eq(processKpis.id, id));
    return true;
  }

  // Process Step System mapping operations
  async getProcessStepSystem(id: string): Promise<ProcessStepSystem | undefined> {
    const [system] = await db.select().from(processStepSystems).where(eq(processStepSystems.id, id));
    return system;
  }

  async getProcessStepSystems(stepId: string): Promise<ProcessStepSystem[]> {
    return await db.select().from(processStepSystems).where(eq(processStepSystems.stepId, stepId));
  }

  async createProcessStepSystem(system: InsertProcessStepSystem): Promise<ProcessStepSystem> {
    const [newSystem] = await db.insert(processStepSystems).values(system).returning();
    return newSystem;
  }

  async deleteProcessStepSystem(id: string): Promise<boolean> {
    await db.delete(processStepSystems).where(eq(processStepSystems.id, id));
    return true;
  }

  // Reusable Recommendation Library operations
  async getAllReusableRecommendations(): Promise<ReusableRecommendation[]> {
    return await db.select().from(reusableRecommendations).orderBy(reusableRecommendations.title);
  }

  async createReusableRecommendation(recommendation: InsertReusableRecommendation): Promise<ReusableRecommendation> {
    const [newRecommendation] = await db.insert(reusableRecommendations).values(recommendation).returning();
    return newRecommendation;
  }

  async updateReusableRecommendation(id: string, recommendation: Partial<InsertReusableRecommendation>): Promise<ReusableRecommendation | undefined> {
    const [updated] = await db.update(reusableRecommendations)
      .set({ ...recommendation, updatedAt: new Date() })
      .where(eq(reusableRecommendations.id, id))
      .returning();
    return updated;
  }

  async deleteReusableRecommendation(id: string): Promise<boolean> {
    await db.delete(reusableRecommendations).where(eq(reusableRecommendations.id, id));
    return true;
  }

  // Process Template operations
  async getAllProcessTemplates(): Promise<ProcessTemplate[]> {
    return await db.select().from(processTemplates).orderBy(processTemplates.name);
  }

  async getProcessTemplate(id: string): Promise<ProcessTemplate | undefined> {
    const [template] = await db.select().from(processTemplates).where(eq(processTemplates.id, id));
    return template;
  }

  async createProcessTemplate(template: InsertProcessTemplate): Promise<ProcessTemplate> {
    const [newTemplate] = await db.insert(processTemplates).values(template).returning();
    return newTemplate;
  }

  async updateProcessTemplate(id: string, template: Partial<InsertProcessTemplate>): Promise<ProcessTemplate | undefined> {
    const [updated] = await db.update(processTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(processTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteProcessTemplate(id: string): Promise<boolean> {
    await db.delete(processTemplates).where(eq(processTemplates.id, id));
    return true;
  }

  // Linked variant operations
  async getLinkedVariant(processId: string): Promise<Process | undefined> {
    const process = await this.getProcess(processId);
    if (!process?.linkedVariantId) return undefined;
    return await this.getProcess(process.linkedVariantId);
  }

  async createToBeVariant(asIsProcessId: string): Promise<Process> {
    const asIsProcess = await this.getProcess(asIsProcessId);
    if (!asIsProcess) throw new Error("AS-IS process not found");
    
    // Create TO-BE variant
    const toBeProcess = await this.createProcess({
      projectId: asIsProcess.projectId,
      name: `${asIsProcess.name} (TO-BE)`,
      description: asIsProcess.description,
      category: asIsProcess.category,
      status: 'identified',
      priority: asIsProcess.priority,
      isAutomatable: asIsProcess.isAutomatable,
      notes: asIsProcess.notes,
      variantType: 'to_be',
      linkedVariantId: asIsProcessId,
      version: 1,
    });
    
    // Update AS-IS to link to TO-BE
    await this.updateProcess(asIsProcessId, { linkedVariantId: toBeProcess.id });
    
    return toBeProcess;
  }

  // ERP Requirements operations
  async getErpRequirements(projectId: string): Promise<ErpRequirement[]> {
    return await db.select().from(erpRequirements)
      .where(eq(erpRequirements.projectId, projectId))
      .orderBy(erpRequirements.createdAt);
  }

  async getErpRequirement(id: string): Promise<ErpRequirement | undefined> {
    const [requirement] = await db.select().from(erpRequirements)
      .where(eq(erpRequirements.id, id));
    return requirement;
  }

  async createErpRequirement(requirement: InsertErpRequirement): Promise<ErpRequirement> {
    const [newRequirement] = await db.insert(erpRequirements)
      .values(requirement)
      .returning();
    return newRequirement;
  }

  async updateErpRequirement(id: string, requirement: Partial<InsertErpRequirement>): Promise<ErpRequirement | undefined> {
    const [updated] = await db.update(erpRequirements)
      .set({ ...requirement, updatedAt: new Date() })
      .where(eq(erpRequirements.id, id))
      .returning();
    return updated;
  }

  async deleteErpRequirement(id: string): Promise<boolean> {
    await db.delete(erpRequirements).where(eq(erpRequirements.id, id));
    return true;
  }

  // ERP Requirement Attachments operations
  async getErpRequirementAttachment(id: string): Promise<ErpRequirementAttachment | undefined> {
    const [attachment] = await db.select().from(erpRequirementAttachments)
      .where(eq(erpRequirementAttachments.id, id));
    return attachment;
  }

  async getErpRequirementAttachments(requirementId: string): Promise<ErpRequirementAttachment[]> {
    return await db.select().from(erpRequirementAttachments)
      .where(eq(erpRequirementAttachments.requirementId, requirementId))
      .orderBy(erpRequirementAttachments.createdAt);
  }

  async createErpRequirementAttachment(attachment: InsertErpRequirementAttachment): Promise<ErpRequirementAttachment> {
    const [newAttachment] = await db.insert(erpRequirementAttachments)
      .values(attachment)
      .returning();
    return newAttachment;
  }

  async deleteErpRequirementAttachment(id: string): Promise<boolean> {
    await db.delete(erpRequirementAttachments).where(eq(erpRequirementAttachments.id, id));
    return true;
  }

  // ERP Parameterization Topics operations
  async getErpParameterizationTopics(projectId: string): Promise<ErpParameterizationTopic[]> {
    return await db.select().from(erpParameterizationTopics)
      .where(eq(erpParameterizationTopics.projectId, projectId))
      .orderBy(erpParameterizationTopics.order);
  }

  async getErpParameterizationTopic(id: string): Promise<ErpParameterizationTopic | undefined> {
    const [topic] = await db.select().from(erpParameterizationTopics)
      .where(eq(erpParameterizationTopics.id, id));
    return topic;
  }

  async createErpParameterizationTopic(topic: InsertErpParameterizationTopic): Promise<ErpParameterizationTopic> {
    const [newTopic] = await db.insert(erpParameterizationTopics)
      .values(topic)
      .returning();
    return newTopic;
  }

  async updateErpParameterizationTopic(id: string, topic: Partial<InsertErpParameterizationTopic>): Promise<ErpParameterizationTopic | undefined> {
    const [updated] = await db.update(erpParameterizationTopics)
      .set({ ...topic, updatedAt: new Date() })
      .where(eq(erpParameterizationTopics.id, id))
      .returning();
    return updated;
  }

  async deleteErpParameterizationTopic(id: string): Promise<boolean> {
    await db.delete(erpParameterizationTopics).where(eq(erpParameterizationTopics.id, id));
    return true;
  }

  // ERP Parameterization Items operations
  async getErpParameterizationItems(topicId: string): Promise<ErpParameterizationItem[]> {
    return await db.select().from(erpParameterizationItems)
      .where(eq(erpParameterizationItems.topicId, topicId))
      .orderBy(erpParameterizationItems.order);
  }

  async getErpParameterizationItem(id: string): Promise<ErpParameterizationItem | undefined> {
    const [item] = await db.select().from(erpParameterizationItems)
      .where(eq(erpParameterizationItems.id, id));
    return item;
  }

  async createErpParameterizationItem(item: InsertErpParameterizationItem): Promise<ErpParameterizationItem> {
    const [newItem] = await db.insert(erpParameterizationItems)
      .values(item)
      .returning();
    return newItem;
  }

  async updateErpParameterizationItem(id: string, item: Partial<InsertErpParameterizationItem>): Promise<ErpParameterizationItem | undefined> {
    const [updated] = await db.update(erpParameterizationItems)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(erpParameterizationItems.id, id))
      .returning();
    return updated;
  }

  async deleteErpParameterizationItem(id: string): Promise<boolean> {
    await db.delete(erpParameterizationItems).where(eq(erpParameterizationItems.id, id));
    return true;
  }

  // Help Article operations
  async getAllHelpArticles(): Promise<HelpArticle[]> {
    return await db.select().from(helpArticles)
      .where(eq(helpArticles.isPublished, 1))
      .orderBy(helpArticles.category, helpArticles.order);
  }

  async getHelpArticle(id: string): Promise<HelpArticle | undefined> {
    const [article] = await db.select().from(helpArticles)
      .where(eq(helpArticles.id, id));
    return article;
  }

  async getHelpArticleBySlug(slug: string): Promise<HelpArticle | undefined> {
    const [article] = await db.select().from(helpArticles)
      .where(eq(helpArticles.slug, slug));
    return article;
  }

  async getHelpArticlesByCategory(category: string): Promise<HelpArticle[]> {
    return await db.select().from(helpArticles)
      .where(and(
        eq(helpArticles.category, category),
        eq(helpArticles.isPublished, 1)
      ))
      .orderBy(helpArticles.order);
  }

  async getHelpArticlesByModule(moduleKey: string): Promise<HelpArticle[]> {
    return await db.select().from(helpArticles)
      .where(and(
        eq(helpArticles.moduleKey, moduleKey),
        eq(helpArticles.isPublished, 1)
      ))
      .orderBy(helpArticles.order);
  }

  async createHelpArticle(article: InsertHelpArticle): Promise<HelpArticle> {
    const [newArticle] = await db.insert(helpArticles)
      .values(article)
      .returning();
    return newArticle;
  }

  async updateHelpArticle(id: string, article: Partial<InsertHelpArticle>): Promise<HelpArticle | undefined> {
    const [updated] = await db.update(helpArticles)
      .set({ ...article, updatedAt: new Date() })
      .where(eq(helpArticles.id, id))
      .returning();
    return updated;
  }

  async deleteHelpArticle(id: string): Promise<boolean> {
    await db.delete(helpArticles).where(eq(helpArticles.id, id));
    return true;
  }

  async searchHelpArticles(query: string): Promise<HelpArticle[]> {
    const allArticles = await db.select().from(helpArticles)
      .where(eq(helpArticles.isPublished, 1));
    const lowerQuery = query.toLowerCase();
    return allArticles.filter(article => 
      article.title.toLowerCase().includes(lowerQuery) ||
      article.content.toLowerCase().includes(lowerQuery) ||
      (article.summary && article.summary.toLowerCase().includes(lowerQuery))
    );
  }

  // SWOT Analysis operations
  async getSwotAnalysesByProject(projectId: string): Promise<SwotAnalysis[]> {
    return await db.select().from(swotAnalyses)
      .where(eq(swotAnalyses.projectId, projectId))
      .orderBy(desc(swotAnalyses.createdAt));
  }

  async getSwotAnalysis(id: string): Promise<SwotAnalysis | undefined> {
    const [analysis] = await db.select().from(swotAnalyses)
      .where(eq(swotAnalyses.id, id));
    return analysis;
  }

  async createSwotAnalysis(analysis: InsertSwotAnalysis): Promise<SwotAnalysis> {
    const [newAnalysis] = await db.insert(swotAnalyses)
      .values(analysis)
      .returning();
    return newAnalysis;
  }

  async updateSwotAnalysis(id: string, analysis: Partial<InsertSwotAnalysis>): Promise<SwotAnalysis | undefined> {
    const [updated] = await db.update(swotAnalyses)
      .set({ ...analysis, updatedAt: new Date() })
      .where(eq(swotAnalyses.id, id))
      .returning();
    return updated;
  }

  async deleteSwotAnalysis(id: string): Promise<boolean> {
    await db.delete(swotAnalyses).where(eq(swotAnalyses.id, id));
    return true;
  }

  // SWOT Item operations
  async getSwotItems(analysisId: string): Promise<SwotItem[]> {
    return await db.select().from(swotItems)
      .where(eq(swotItems.analysisId, analysisId))
      .orderBy(swotItems.order);
  }

  async getSwotItem(id: string): Promise<SwotItem | undefined> {
    const [item] = await db.select().from(swotItems)
      .where(eq(swotItems.id, id));
    return item;
  }

  async createSwotItem(item: InsertSwotItem): Promise<SwotItem> {
    const [newItem] = await db.insert(swotItems)
      .values(item)
      .returning();
    return newItem;
  }

  async updateSwotItem(id: string, item: Partial<InsertSwotItem>): Promise<SwotItem | undefined> {
    const [updated] = await db.update(swotItems)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(swotItems.id, id))
      .returning();
    return updated;
  }

  async deleteSwotItem(id: string): Promise<boolean> {
    await db.delete(swotItems).where(eq(swotItems.id, id));
    return true;
  }

  async getSwotItemsByProject(projectId: string): Promise<(SwotItem & { analysisName: string })[]> {
    const analyses = await this.getSwotAnalysesByProject(projectId);
    if (analyses.length === 0) return [];
    
    const allItems: (SwotItem & { analysisName: string })[] = [];
    for (const analysis of analyses) {
      const items = await this.getSwotItems(analysis.id);
      for (const item of items) {
        allItems.push({ ...item, analysisName: analysis.name });
      }
    }
    return allItems;
  }

  // Report Configuration operations
  async getReportConfigurations(projectId: string): Promise<ReportConfiguration[]> {
    return await db.select().from(reportConfigurations)
      .where(eq(reportConfigurations.projectId, projectId))
      .orderBy(desc(reportConfigurations.createdAt));
  }

  async getReportConfiguration(id: string): Promise<ReportConfiguration | undefined> {
    const [config] = await db.select().from(reportConfigurations)
      .where(eq(reportConfigurations.id, id));
    return config;
  }

  async createReportConfiguration(config: InsertReportConfiguration): Promise<ReportConfiguration> {
    const [newConfig] = await db.insert(reportConfigurations)
      .values(config)
      .returning();
    return newConfig;
  }

  async updateReportConfiguration(id: string, config: Partial<InsertReportConfiguration>): Promise<ReportConfiguration | undefined> {
    const [updated] = await db.update(reportConfigurations)
      .set({ ...config, updatedAt: new Date() })
      .where(eq(reportConfigurations.id, id))
      .returning();
    return updated;
  }

  async deleteReportConfiguration(id: string): Promise<boolean> {
    await db.delete(reportConfigurations).where(eq(reportConfigurations.id, id));
    return true;
  }

  // CRM Pipeline Stage operations
  async getAllCrmPipelineStages(): Promise<CrmPipelineStage[]> {
    return await db.select().from(crmPipelineStages).orderBy(crmPipelineStages.order);
  }

  async getCrmPipelineStage(id: string): Promise<CrmPipelineStage | undefined> {
    const [stage] = await db.select().from(crmPipelineStages).where(eq(crmPipelineStages.id, id));
    return stage;
  }

  async createCrmPipelineStage(stage: InsertCrmPipelineStage): Promise<CrmPipelineStage> {
    const [newStage] = await db.insert(crmPipelineStages).values(stage).returning();
    return newStage;
  }

  async updateCrmPipelineStage(id: string, stage: Partial<InsertCrmPipelineStage>): Promise<CrmPipelineStage | undefined> {
    const [updated] = await db.update(crmPipelineStages)
      .set({ ...stage, updatedAt: new Date() })
      .where(eq(crmPipelineStages.id, id))
      .returning();
    return updated;
  }

  async deleteCrmPipelineStage(id: string): Promise<boolean> {
    await db.delete(crmPipelineStages).where(eq(crmPipelineStages.id, id));
    return true;
  }

  // CRM Lead operations
  async getAllCrmLeads(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<CrmLead[]> {
    if (tenantId) {
      return await db.select().from(crmLeads).where(eq(crmLeads.tenantId, tenantId)).orderBy(desc(crmLeads.createdAt));
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(crmLeads).orderBy(desc(crmLeads.createdAt));
  }

  async getCrmLead(id: string): Promise<CrmLead | undefined> {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id));
    return lead;
  }

  async createCrmLead(lead: InsertCrmLead): Promise<CrmLead> {
    const [newLead] = await db.insert(crmLeads).values(lead).returning();
    return newLead;
  }

  async updateCrmLead(id: string, lead: Partial<InsertCrmLead>): Promise<CrmLead | undefined> {
    const [updated] = await db.update(crmLeads)
      .set({ ...lead, updatedAt: new Date() })
      .where(eq(crmLeads.id, id))
      .returning();
    return updated;
  }

  async deleteCrmLead(id: string): Promise<boolean> {
    await db.delete(crmLeads).where(eq(crmLeads.id, id));
    return true;
  }

  // CRM Opportunity operations
  async getAllCrmOpportunities(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<CrmOpportunity[]> {
    if (tenantId) {
      return await db.select().from(crmOpportunities).where(eq(crmOpportunities.tenantId, tenantId)).orderBy(desc(crmOpportunities.createdAt));
    }
    if (!opts?.allowGlobal) return [];
    return await db.select().from(crmOpportunities).orderBy(desc(crmOpportunities.createdAt));
  }

  async getCrmOpportunity(id: string): Promise<CrmOpportunity | undefined> {
    const [opportunity] = await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, id));
    return opportunity;
  }

  async getCrmOpportunitiesByStage(stageId: string): Promise<CrmOpportunity[]> {
    return await db.select().from(crmOpportunities)
      .where(eq(crmOpportunities.stageId, stageId))
      .orderBy(desc(crmOpportunities.createdAt));
  }

  async createCrmOpportunity(opportunity: InsertCrmOpportunity): Promise<CrmOpportunity> {
    const [newOpportunity] = await db.insert(crmOpportunities).values(opportunity).returning();
    return newOpportunity;
  }

  async updateCrmOpportunity(id: string, opportunity: Partial<InsertCrmOpportunity>): Promise<CrmOpportunity | undefined> {
    const [updated] = await db.update(crmOpportunities)
      .set({ ...opportunity, updatedAt: new Date() })
      .where(eq(crmOpportunities.id, id))
      .returning();
    return updated;
  }

  async deleteCrmOpportunity(id: string): Promise<boolean> {
    await db.delete(crmOpportunities).where(eq(crmOpportunities.id, id));
    return true;
  }

  // CRM Activity operations
  async getCrmActivities(filters: { leadId?: string; opportunityId?: string; clientId?: string }): Promise<CrmActivity[]> {
    if (filters.leadId) {
      return await db.select().from(crmActivities)
        .where(eq(crmActivities.leadId, filters.leadId))
        .orderBy(desc(crmActivities.createdAt));
    }
    if (filters.opportunityId) {
      return await db.select().from(crmActivities)
        .where(eq(crmActivities.opportunityId, filters.opportunityId))
        .orderBy(desc(crmActivities.createdAt));
    }
    if (filters.clientId) {
      return await db.select().from(crmActivities)
        .where(eq(crmActivities.clientId, filters.clientId))
        .orderBy(desc(crmActivities.createdAt));
    }
    return await db.select().from(crmActivities).orderBy(desc(crmActivities.createdAt));
  }

  async getCrmActivity(id: string): Promise<CrmActivity | undefined> {
    const [activity] = await db.select().from(crmActivities).where(eq(crmActivities.id, id));
    return activity;
  }

  async createCrmActivity(activity: InsertCrmActivity): Promise<CrmActivity> {
    const [newActivity] = await db.insert(crmActivities).values(activity).returning();
    return newActivity;
  }

  async updateCrmActivity(id: string, activity: Partial<InsertCrmActivity>): Promise<CrmActivity | undefined> {
    const [updated] = await db.update(crmActivities)
      .set({ ...activity, updatedAt: new Date() })
      .where(eq(crmActivities.id, id))
      .returning();
    return updated;
  }

  async deleteCrmActivity(id: string): Promise<boolean> {
    await db.delete(crmActivities).where(eq(crmActivities.id, id));
    return true;
  }

  // Support Type operations
  async getSupportTypes(): Promise<SupportType[]> {
    return await db.select().from(supportTypes).orderBy(supportTypes.name);
  }

  async getSupportType(id: string): Promise<SupportType | undefined> {
    const [supportType] = await db.select().from(supportTypes).where(eq(supportTypes.id, id));
    return supportType;
  }

  async createSupportType(data: InsertSupportType): Promise<SupportType> {
    const [supportType] = await db.insert(supportTypes).values(data).returning();
    return supportType;
  }

  async updateSupportType(id: string, data: Partial<InsertSupportType>): Promise<SupportType | undefined> {
    const [updated] = await db.update(supportTypes)
      .set(data)
      .where(eq(supportTypes.id, id))
      .returning();
    return updated;
  }

  async deleteSupportType(id: string): Promise<boolean> {
    await db.delete(supportTypes).where(eq(supportTypes.id, id));
    return true;
  }

  // Support Ticket operations
  async getSupportTickets(filters?: { clientId?: string; status?: string; assignedToId?: string; projectId?: string }): Promise<SupportTicket[]> {
    let query = db.select().from(supportTickets);
    if (filters?.clientId) {
      query = query.where(eq(supportTickets.clientId, filters.clientId)) as any;
    }
    if (filters?.status) {
      query = query.where(eq(supportTickets.status, filters.status as any)) as any;
    }
    if (filters?.assignedToId) {
      query = query.where(eq(supportTickets.assignedToId, filters.assignedToId)) as any;
    }
    if (filters?.projectId) {
      query = query.where(eq(supportTickets.projectId, filters.projectId)) as any;
    }
    return await query.orderBy(desc(supportTickets.createdAt));
  }

  async getSupportTicket(id: string): Promise<SupportTicketWithRelations | undefined> {
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!ticket) return undefined;

    const [client, project, supportType, assignedTo, createdBy, comments] = await Promise.all([
      ticket.clientId ? this.getClient(ticket.clientId) : undefined,
      ticket.projectId ? this.getProject(ticket.projectId) : undefined,
      ticket.supportTypeId ? this.getSupportType(ticket.supportTypeId) : undefined,
      ticket.assignedToId ? this.getUser(ticket.assignedToId) : undefined,
      ticket.createdById ? this.getUser(ticket.createdById) : undefined,
      this.getTicketComments(id),
    ]);

    return {
      ...ticket,
      client,
      project,
      supportType,
      assignedTo,
      createdBy,
      comments,
    };
  }

  async createSupportTicket(data: InsertSupportTicket): Promise<SupportTicket> {
    const [ticket] = await db.insert(supportTickets).values(data).returning();
    return ticket;
  }

  async updateSupportTicket(id: string, data: Partial<InsertSupportTicket>): Promise<SupportTicket | undefined> {
    const [updated] = await db.update(supportTickets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(supportTickets.id, id))
      .returning();
    return updated;
  }

  async deleteSupportTicket(id: string): Promise<boolean> {
    await db.delete(supportTickets).where(eq(supportTickets.id, id));
    return true;
  }

  // Ticket Comment operations
  async getTicketComments(ticketId: string): Promise<TicketComment[]> {
    return await db.select().from(ticketComments)
      .where(eq(ticketComments.ticketId, ticketId))
      .orderBy(ticketComments.createdAt);
  }

  async createTicketComment(data: InsertTicketComment): Promise<TicketComment> {
    const [comment] = await db.insert(ticketComments).values(data).returning();
    return comment;
  }

  async deleteTicketComment(id: string): Promise<boolean> {
    await db.delete(ticketComments).where(eq(ticketComments.id, id));
    return true;
  }

  // Knowledge Category operations
  async getKnowledgeCategories(): Promise<KnowledgeCategory[]> {
    return await db.select().from(knowledgeCategories).orderBy(knowledgeCategories.name);
  }

  async getKnowledgeCategory(id: string): Promise<KnowledgeCategory | undefined> {
    const [category] = await db.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, id));
    return category;
  }

  async createKnowledgeCategory(data: InsertKnowledgeCategory): Promise<KnowledgeCategory> {
    const [category] = await db.insert(knowledgeCategories).values(data).returning();
    return category;
  }

  async updateKnowledgeCategory(id: string, data: Partial<InsertKnowledgeCategory>): Promise<KnowledgeCategory | undefined> {
    const [updated] = await db.update(knowledgeCategories)
      .set(data)
      .where(eq(knowledgeCategories.id, id))
      .returning();
    return updated;
  }

  async deleteKnowledgeCategory(id: string): Promise<boolean> {
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
    return true;
  }

  // Knowledge Article operations
  async getKnowledgeArticles(filters?: { categoryId?: string; status?: string; accessLevel?: string }): Promise<KnowledgeArticle[]> {
    let query = db.select().from(knowledgeArticles);
    if (filters?.categoryId) {
      query = query.where(eq(knowledgeArticles.categoryId, filters.categoryId)) as any;
    }
    if (filters?.status) {
      query = query.where(eq(knowledgeArticles.status, filters.status as any)) as any;
    }
    if (filters?.accessLevel) {
      query = query.where(eq(knowledgeArticles.accessLevel, filters.accessLevel)) as any;
    }
    return await query.orderBy(desc(knowledgeArticles.createdAt));
  }

  async getKnowledgeArticle(id: string): Promise<KnowledgeArticleWithRelations | undefined> {
    const [article] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id));
    if (!article) return undefined;

    const [category, author] = await Promise.all([
      article.categoryId ? this.getKnowledgeCategory(article.categoryId) : undefined,
      article.authorId ? this.getUser(article.authorId) : undefined,
    ]);

    return { ...article, category, author };
  }

  async createKnowledgeArticle(data: InsertKnowledgeArticle): Promise<KnowledgeArticle> {
    const [article] = await db.insert(knowledgeArticles).values(data).returning();
    return article;
  }

  async updateKnowledgeArticle(id: string, data: Partial<InsertKnowledgeArticle>): Promise<KnowledgeArticle | undefined> {
    const [updated] = await db.update(knowledgeArticles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(knowledgeArticles.id, id))
      .returning();
    return updated;
  }

  async deleteKnowledgeArticle(id: string): Promise<boolean> {
    await db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, id));
    return true;
  }

  // Training Content operations
  async getTrainingContents(filters?: { categoryId?: string; accessLevel?: string }): Promise<TrainingContent[]> {
    let query = db.select().from(trainingContent);
    if (filters?.categoryId) {
      query = query.where(eq(trainingContent.categoryId, filters.categoryId)) as any;
    }
    if (filters?.accessLevel) {
      query = query.where(eq(trainingContent.accessLevel, filters.accessLevel)) as any;
    }
    return await query.orderBy(desc(trainingContent.createdAt));
  }

  async getTrainingContent(id: string): Promise<TrainingContentWithRelations | undefined> {
    const [content] = await db.select().from(trainingContent).where(eq(trainingContent.id, id));
    if (!content) return undefined;

    const category = content.categoryId ? await this.getKnowledgeCategory(content.categoryId) : undefined;
    return { ...content, category };
  }

  async createTrainingContent(data: InsertTrainingContent): Promise<TrainingContent> {
    const [content] = await db.insert(trainingContent).values(data).returning();
    return content;
  }

  async updateTrainingContent(id: string, data: Partial<InsertTrainingContent>): Promise<TrainingContent | undefined> {
    const [updated] = await db.update(trainingContent)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(trainingContent.id, id))
      .returning();
    return updated;
  }

  async deleteTrainingContent(id: string): Promise<boolean> {
    await db.delete(trainingContent).where(eq(trainingContent.id, id));
    return true;
  }

  // Client Membership operations
  async getClientMemberships(clientId?: string): Promise<ClientMembership[]> {
    if (clientId) {
      return await db.select().from(clientMemberships)
        .where(eq(clientMemberships.clientId, clientId))
        .orderBy(desc(clientMemberships.createdAt));
    }
    return await db.select().from(clientMemberships).orderBy(desc(clientMemberships.createdAt));
  }

  async getClientMembership(id: string): Promise<ClientMembership | undefined> {
    const [membership] = await db.select().from(clientMemberships).where(eq(clientMemberships.id, id));
    return membership;
  }

  async createClientMembership(data: InsertClientMembership): Promise<ClientMembership> {
    const [membership] = await db.insert(clientMemberships).values(data).returning();
    return membership;
  }

  async updateClientMembership(id: string, data: Partial<InsertClientMembership>): Promise<ClientMembership | undefined> {
    const [updated] = await db.update(clientMemberships)
      .set(data)
      .where(eq(clientMemberships.id, id))
      .returning();
    return updated;
  }

  async deleteClientMembership(id: string): Promise<boolean> {
    await db.delete(clientMemberships).where(eq(clientMemberships.id, id));
    return true;
  }

  // Client Portal Access operations
  async getClientPortalAccess(clientContactId: string): Promise<ClientPortalAccess | undefined> {
    const [access] = await db.select().from(clientPortalAccess)
      .where(eq(clientPortalAccess.clientContactId, clientContactId));
    return access;
  }

  async getClientPortalAccessById(id: string): Promise<ClientPortalAccess | undefined> {
    const [access] = await db.select().from(clientPortalAccess)
      .where(eq(clientPortalAccess.id, id));
    return access;
  }

  async createClientPortalAccess(data: InsertClientPortalAccess): Promise<ClientPortalAccess> {
    const [access] = await db.insert(clientPortalAccess).values(data).returning();
    return access;
  }

  async updateClientPortalAccess(id: string, data: Partial<InsertClientPortalAccess>): Promise<ClientPortalAccess | undefined> {
    const [updated] = await db.update(clientPortalAccess)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientPortalAccess.id, id))
      .returning();
    return updated;
  }

  // Content Access Log operations
  async logContentAccess(data: InsertContentAccessLog): Promise<ContentAccessLog> {
    const [log] = await db.insert(contentAccessLog).values(data).returning();
    return log;
  }

  async getContentAccessLogs(filters: { clientId?: string; contentType?: string }): Promise<ContentAccessLog[]> {
    let query = db.select().from(contentAccessLog);
    if (filters.clientId) {
      query = query.where(eq(contentAccessLog.clientId, filters.clientId)) as any;
    }
    if (filters.contentType) {
      query = query.where(eq(contentAccessLog.contentType, filters.contentType)) as any;
    }
    return await query.orderBy(desc(contentAccessLog.accessedAt));
  }

  // Scrum Internal Project operations
  async getScrumInternalProjects(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<ScrumInternalProject[]> {
    // Quando tenantId fornecido, retorna projetos do tenant + projetos legados (tenantId NULL).
    // Sem tenantId, retorna todos somente se allowGlobal=true (superadmin global).
    if (tenantId === undefined) {
      if (!opts?.allowGlobal) return [];
      return await db.select().from(scrumInternalProjects).orderBy(desc(scrumInternalProjects.createdAt));
    }
    if (tenantId === null) {
      return await db.select().from(scrumInternalProjects)
        .where(isNull(scrumInternalProjects.tenantId))
        .orderBy(desc(scrumInternalProjects.createdAt));
    }
    return await db.select().from(scrumInternalProjects)
      .where(or(eq(scrumInternalProjects.tenantId, tenantId), isNull(scrumInternalProjects.tenantId)))
      .orderBy(desc(scrumInternalProjects.createdAt));
  }

  async getScrumInternalProject(id: string): Promise<ScrumInternalProject | undefined> {
    const [project] = await db.select().from(scrumInternalProjects).where(eq(scrumInternalProjects.id, id));
    return project;
  }

  async createScrumInternalProject(data: InsertScrumInternalProject): Promise<ScrumInternalProject> {
    const [project] = await db.insert(scrumInternalProjects).values(data).returning();
    return project;
  }

  async updateScrumInternalProject(id: string, data: Partial<InsertScrumInternalProject>): Promise<ScrumInternalProject | undefined> {
    const [updated] = await db.update(scrumInternalProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scrumInternalProjects.id, id))
      .returning();
    return updated;
  }

  async deleteScrumInternalProject(id: string): Promise<boolean> {
    await db.delete(scrumInternalProjects).where(eq(scrumInternalProjects.id, id));
    return true;
  }

  // Scrum Team operations
  async getScrumTeams(tenantId?: string | null, opts?: { allowGlobal?: boolean }): Promise<ScrumTeam[]> {
    // Sem param: retorna tudo somente se allowGlobal=true (superadmin global).
    if (tenantId === undefined) {
      if (!opts?.allowGlobal) return [];
      return await db.select().from(scrumTeams).orderBy(scrumTeams.name);
    }
    if (tenantId === null) {
      return await db.select().from(scrumTeams)
        .where(isNull(scrumTeams.tenantId))
        .orderBy(scrumTeams.name);
    }
    return await db.select().from(scrumTeams)
      .where(or(eq(scrumTeams.tenantId, tenantId), isNull(scrumTeams.tenantId)))
      .orderBy(scrumTeams.name);
  }

  async getScrumTeam(id: string): Promise<ScrumTeam | undefined> {
    const [team] = await db.select().from(scrumTeams).where(eq(scrumTeams.id, id));
    return team;
  }

  async createScrumTeam(data: InsertScrumTeam): Promise<ScrumTeam> {
    const [team] = await db.insert(scrumTeams).values(data).returning();
    return team;
  }

  async updateScrumTeam(id: string, data: Partial<InsertScrumTeam>): Promise<ScrumTeam | undefined> {
    const [updated] = await db.update(scrumTeams)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scrumTeams.id, id))
      .returning();
    return updated;
  }

  async deleteScrumTeam(id: string): Promise<boolean> {
    await db.delete(scrumTeams).where(eq(scrumTeams.id, id));
    return true;
  }

  // Scrum Team Member operations
  async getScrumTeamMembers(teamId: string): Promise<ScrumTeamMember[]> {
    return await db.select().from(scrumTeamMembers).where(eq(scrumTeamMembers.teamId, teamId));
  }

  async getScrumTeamMember(id: string): Promise<ScrumTeamMember | undefined> {
    const [member] = await db.select().from(scrumTeamMembers).where(eq(scrumTeamMembers.id, id));
    return member;
  }

  async createScrumTeamMember(data: InsertScrumTeamMember): Promise<ScrumTeamMember> {
    const [member] = await db.insert(scrumTeamMembers).values(data).returning();
    return member;
  }

  async updateScrumTeamMember(id: string, data: Partial<InsertScrumTeamMember>): Promise<ScrumTeamMember | undefined> {
    const [updated] = await db.update(scrumTeamMembers)
      .set(data)
      .where(eq(scrumTeamMembers.id, id))
      .returning();
    return updated;
  }

  async deleteScrumTeamMember(id: string): Promise<boolean> {
    await db.delete(scrumTeamMembers).where(eq(scrumTeamMembers.id, id));
    return true;
  }

  // Scrum Sprint operations
  // Sprints derivam tenancy via internal_project. Quando tenantId é fornecido,
  // filtra apenas sprints cujos projetos pertencem ao tenant (ou são legados sem tenantId).
  async getScrumSprints(projectId?: string, tenantId?: string | null): Promise<ScrumSprint[]> {
    if (projectId) {
      return await db.select().from(scrumSprints)
        .where(eq(scrumSprints.internalProjectId, projectId))
        .orderBy(desc(scrumSprints.startDate));
    }
    if (tenantId !== undefined) {
      // Carrega IDs de internalProjects acessíveis (tenant atual + legados null).
      // Sprints órfãs (internalProjectId NULL) NÃO são incluídas para evitar vazamento.
      const accessibleProjects = await this.getScrumInternalProjects(tenantId);
      const ids = accessibleProjects.map((p) => p.id);
      if (ids.length === 0) return [];
      return await db.select().from(scrumSprints)
        .where(inArray(scrumSprints.internalProjectId, ids))
        .orderBy(desc(scrumSprints.startDate));
    }
    return await db.select().from(scrumSprints).orderBy(desc(scrumSprints.startDate));
  }

  async getScrumSprint(id: string): Promise<ScrumSprint | undefined> {
    const [sprint] = await db.select().from(scrumSprints).where(eq(scrumSprints.id, id));
    return sprint;
  }

  async createScrumSprint(data: InsertScrumSprint): Promise<ScrumSprint> {
    const [sprint] = await db.insert(scrumSprints).values(data).returning();
    return sprint;
  }

  async updateScrumSprint(id: string, data: Partial<InsertScrumSprint>): Promise<ScrumSprint | undefined> {
    const [updated] = await db.update(scrumSprints)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scrumSprints.id, id))
      .returning();
    return updated;
  }

  async deleteScrumSprint(id: string): Promise<boolean> {
    await db.delete(scrumSprints).where(eq(scrumSprints.id, id));
    return true;
  }

  // Scrum Backlog Item (PBI) operations
  async getScrumBacklogItems(filters?: { projectId?: string; sprintId?: string; status?: string; assigneeId?: string; tenantId?: string | null }): Promise<ScrumBacklogItem[]> {
    let query = db.select().from(scrumBacklogItems);
    if (filters?.tenantId !== undefined) {
      // Inclui PBIs legados (tenantId NULL) junto com os do tenant solicitado,
      // mantendo compatibilidade com itens criados antes do isolamento por tenant.
      if (filters.tenantId === null) {
        query = query.where(isNull(scrumBacklogItems.tenantId)) as any;
      } else {
        query = query.where(or(eq(scrumBacklogItems.tenantId, filters.tenantId), isNull(scrumBacklogItems.tenantId))) as any;
      }
    }
    if (filters?.projectId) {
      query = query.where(eq(scrumBacklogItems.internalProjectId, filters.projectId)) as any;
    }
    if (filters?.sprintId) {
      query = query.where(eq(scrumBacklogItems.sprintId, filters.sprintId)) as any;
    }
    if (filters?.status) {
      query = query.where(eq(scrumBacklogItems.status, filters.status as any)) as any;
    }
    if (filters?.assigneeId) {
      query = query.where(eq(scrumBacklogItems.assigneeId, filters.assigneeId)) as any;
    }
    return await query.orderBy(scrumBacklogItems.priority, scrumBacklogItems.backlogOrder);
  }

  async getScrumBacklogItem(id: string): Promise<ScrumBacklogItem | undefined> {
    const [item] = await db.select().from(scrumBacklogItems).where(eq(scrumBacklogItems.id, id));
    return item;
  }

  async createScrumBacklogItem(data: InsertScrumBacklogItem): Promise<ScrumBacklogItem> {
    const [item] = await db.insert(scrumBacklogItems).values(data).returning();
    return item;
  }

  async updateScrumBacklogItem(id: string, data: Partial<InsertScrumBacklogItem>): Promise<ScrumBacklogItem | undefined> {
    const [updated] = await db.update(scrumBacklogItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scrumBacklogItems.id, id))
      .returning();
    return updated;
  }

  async deleteScrumBacklogItem(id: string): Promise<boolean> {
    await db.delete(scrumBacklogItems).where(eq(scrumBacklogItems.id, id));
    return true;
  }

  // Scrum Timesheet operations
  // Timesheets derivam tenancy via PBI (scrum_backlog_items.tenant_id).
  async getScrumTimesheets(pbiId?: string, tenantId?: string | null): Promise<ScrumTimesheet[]> {
    if (pbiId) {
      return await db.select().from(scrumTimesheets)
        .where(eq(scrumTimesheets.pbiId, pbiId))
        .orderBy(desc(scrumTimesheets.date));
    }
    if (tenantId !== undefined) {
      // Filtra timesheets cujo PBI pertença ao tenant (ou seja legado NULL).
      const rows = await db
        .select({ ts: scrumTimesheets })
        .from(scrumTimesheets)
        .innerJoin(scrumBacklogItems, eq(scrumTimesheets.pbiId, scrumBacklogItems.id))
        .where(
          tenantId === null
            ? isNull(scrumBacklogItems.tenantId)
            : or(eq(scrumBacklogItems.tenantId, tenantId), isNull(scrumBacklogItems.tenantId)),
        )
        .orderBy(desc(scrumTimesheets.date));
      return rows.map((r) => r.ts);
    }
    return await db.select().from(scrumTimesheets).orderBy(desc(scrumTimesheets.date));
  }

  async getScrumTimesheet(id: string): Promise<ScrumTimesheet | undefined> {
    const [timesheet] = await db.select().from(scrumTimesheets).where(eq(scrumTimesheets.id, id));
    return timesheet;
  }

  async createScrumTimesheet(data: InsertScrumTimesheet): Promise<ScrumTimesheet> {
    const [timesheet] = await db.insert(scrumTimesheets).values(data).returning();
    return timesheet;
  }

  async updateScrumTimesheet(id: string, data: Partial<InsertScrumTimesheet>): Promise<ScrumTimesheet | undefined> {
    const [updated] = await db.update(scrumTimesheets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scrumTimesheets.id, id))
      .returning();
    return updated;
  }

  async deleteScrumTimesheet(id: string): Promise<boolean> {
    await db.delete(scrumTimesheets).where(eq(scrumTimesheets.id, id));
    return true;
  }

  // Scrum Rework operations
  // Reworks derivam tenancy via PBI original (scrum_backlog_items.tenant_id).
  async getScrumReworks(originalPbiId?: string, tenantId?: string | null): Promise<ScrumRework[]> {
    if (originalPbiId) {
      return await db.select().from(scrumRework)
        .where(eq(scrumRework.originalPbiId, originalPbiId))
        .orderBy(desc(scrumRework.createdAt));
    }
    if (tenantId !== undefined) {
      const rows = await db
        .select({ rw: scrumRework })
        .from(scrumRework)
        .innerJoin(scrumBacklogItems, eq(scrumRework.originalPbiId, scrumBacklogItems.id))
        .where(
          tenantId === null
            ? isNull(scrumBacklogItems.tenantId)
            : or(eq(scrumBacklogItems.tenantId, tenantId), isNull(scrumBacklogItems.tenantId)),
        )
        .orderBy(desc(scrumRework.createdAt));
      return rows.map((r) => r.rw);
    }
    return await db.select().from(scrumRework).orderBy(desc(scrumRework.createdAt));
  }

  async getScrumRework(id: string): Promise<ScrumRework | undefined> {
    const [rework] = await db.select().from(scrumRework).where(eq(scrumRework.id, id));
    return rework;
  }

  async createScrumRework(data: InsertScrumRework): Promise<ScrumRework> {
    const [rework] = await db.insert(scrumRework).values(data).returning();
    return rework;
  }

  async updateScrumRework(id: string, data: Partial<InsertScrumRework>): Promise<ScrumRework | undefined> {
    const [updated] = await db.update(scrumRework)
      .set(data)
      .where(eq(scrumRework.id, id))
      .returning();
    return updated;
  }

  async deleteScrumRework(id: string): Promise<boolean> {
    await db.delete(scrumRework).where(eq(scrumRework.id, id));
    return true;
  }

  // Scrum Backlog Attachment operations
  async getScrumBacklogAttachments(pbiId: string): Promise<ScrumBacklogAttachment[]> {
    return await db.select().from(scrumBacklogAttachments)
      .where(eq(scrumBacklogAttachments.pbiId, pbiId))
      .orderBy(desc(scrumBacklogAttachments.createdAt));
  }

  async getScrumBacklogAttachment(id: string): Promise<ScrumBacklogAttachment | undefined> {
    const [attachment] = await db.select().from(scrumBacklogAttachments)
      .where(eq(scrumBacklogAttachments.id, id));
    return attachment;
  }

  async createScrumBacklogAttachment(data: InsertScrumBacklogAttachment): Promise<ScrumBacklogAttachment> {
    const [attachment] = await db.insert(scrumBacklogAttachments).values(data).returning();
    return attachment;
  }

  async deleteScrumBacklogAttachment(id: string): Promise<boolean> {
    await db.delete(scrumBacklogAttachments).where(eq(scrumBacklogAttachments.id, id));
    return true;
  }

  // Project Files operations (File Manager)
  async getProjectFiles(projectId: string, folder?: string): Promise<ProjectFile[]> {
    if (folder) {
      return await db.select().from(projectFiles)
        .where(and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.folder, folder)
        ))
        .orderBy(desc(projectFiles.createdAt));
    }
    return await db.select().from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(desc(projectFiles.createdAt));
  }

  async getProjectFile(id: string): Promise<ProjectFile | undefined> {
    const [file] = await db.select().from(projectFiles)
      .where(eq(projectFiles.id, id));
    return file;
  }

  async createProjectFile(data: InsertProjectFile): Promise<ProjectFile> {
    const [file] = await db.insert(projectFiles).values(data).returning();
    return file;
  }

  async updateProjectFile(id: string, data: Partial<InsertProjectFile>): Promise<ProjectFile | undefined> {
    const [updated] = await db.update(projectFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectFiles.id, id))
      .returning();
    return updated;
  }

  async deleteProjectFile(id: string): Promise<boolean> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
    return true;
  }

  async getProjectFileFolders(projectId: string): Promise<string[]> {
    const files = await db.select({ folder: projectFiles.folder })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    
    const folderSet = new Set<string>();
    files.forEach(f => folderSet.add(f.folder || '/'));
    return Array.from(folderSet).sort();
  }

  // CRM Proposal operations
  async getAllCrmProposals(): Promise<CrmProposal[]> {
    return await db.select().from(crmProposals).orderBy(desc(crmProposals.createdAt));
  }

  async getCrmProposal(id: string): Promise<CrmProposal | undefined> {
    const [proposal] = await db.select().from(crmProposals).where(eq(crmProposals.id, id));
    return proposal;
  }

  async getCrmProposalsByOpportunity(opportunityId: string): Promise<CrmProposal[]> {
    return await db.select().from(crmProposals)
      .where(eq(crmProposals.opportunityId, opportunityId))
      .orderBy(desc(crmProposals.createdAt));
  }

  async getCrmProposalsByClient(clientId: string): Promise<CrmProposal[]> {
    return await db.select().from(crmProposals)
      .where(eq(crmProposals.clientId, clientId))
      .orderBy(desc(crmProposals.createdAt));
  }

  async createCrmProposal(proposal: InsertCrmProposal): Promise<CrmProposal> {
    const [newProposal] = await db.insert(crmProposals).values(proposal).returning();
    return newProposal;
  }

  async updateCrmProposal(id: string, proposal: Partial<InsertCrmProposal>): Promise<CrmProposal | undefined> {
    const [updated] = await db.update(crmProposals)
      .set({ ...proposal, updatedAt: new Date() })
      .where(eq(crmProposals.id, id))
      .returning();
    return updated;
  }

  async deleteCrmProposal(id: string): Promise<boolean> {
    await db.delete(crmProposals).where(eq(crmProposals.id, id));
    return true;
  }

  async getNextProposalNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PRO-${year}-`;
    
    const allProposals = await db.select({ number: crmProposals.number })
      .from(crmProposals)
      .orderBy(desc(crmProposals.number));
    
    let maxNum = 0;
    for (const p of allProposals) {
      if (p.number && p.number.startsWith(prefix)) {
        const numPart = parseInt(p.number.replace(prefix, ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
  }

  // CRM Proposal Item operations
  async getCrmProposalItems(proposalId: string): Promise<CrmProposalItem[]> {
    return await db.select().from(crmProposalItems)
      .where(eq(crmProposalItems.proposalId, proposalId))
      .orderBy(crmProposalItems.orderIndex);
  }

  async createCrmProposalItem(item: InsertCrmProposalItem): Promise<CrmProposalItem> {
    const [newItem] = await db.insert(crmProposalItems).values(item).returning();
    return newItem;
  }

  async updateCrmProposalItem(id: string, item: Partial<InsertCrmProposalItem>): Promise<CrmProposalItem | undefined> {
    const [updated] = await db.update(crmProposalItems)
      .set({ ...item, updatedAt: new Date() })
      .where(eq(crmProposalItems.id, id))
      .returning();
    return updated;
  }

  async deleteCrmProposalItem(id: string): Promise<boolean> {
    await db.delete(crmProposalItems).where(eq(crmProposalItems.id, id));
    return true;
  }

  // CRM Contract operations
  async getAllCrmContracts(): Promise<CrmContract[]> {
    return await db.select().from(crmContracts).orderBy(desc(crmContracts.createdAt));
  }

  async getCrmContract(id: string): Promise<CrmContract | undefined> {
    const [contract] = await db.select().from(crmContracts).where(eq(crmContracts.id, id));
    return contract;
  }

  async getCrmContractsByClient(clientId: string): Promise<CrmContract[]> {
    return await db.select().from(crmContracts)
      .where(eq(crmContracts.clientId, clientId))
      .orderBy(desc(crmContracts.createdAt));
  }

  async createCrmContract(contract: InsertCrmContract): Promise<CrmContract> {
    const [newContract] = await db.insert(crmContracts).values(contract).returning();
    return newContract;
  }

  async updateCrmContract(id: string, contract: Partial<InsertCrmContract>): Promise<CrmContract | undefined> {
    const [updated] = await db.update(crmContracts)
      .set({ ...contract, updatedAt: new Date() })
      .where(eq(crmContracts.id, id))
      .returning();
    return updated;
  }

  async deleteCrmContract(id: string): Promise<boolean> {
    await db.delete(crmContracts).where(eq(crmContracts.id, id));
    return true;
  }

  async getNextContractNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CTR-${year}-`;
    const allContracts = await db.select({ number: crmContracts.number })
      .from(crmContracts)
      .orderBy(desc(crmContracts.number));
    
    let maxNum = 0;
    for (const c of allContracts) {
      if (c.number && c.number.startsWith(prefix)) {
        const numPart = parseInt(c.number.replace(prefix, ''), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
  }

  // CRM Contract Milestone operations
  async getCrmContractMilestones(contractId: string): Promise<CrmContractMilestone[]> {
    return await db.select().from(crmContractMilestones)
      .where(eq(crmContractMilestones.contractId, contractId))
      .orderBy(crmContractMilestones.dueDate);
  }

  async createCrmContractMilestone(milestone: InsertCrmContractMilestone): Promise<CrmContractMilestone> {
    const [newMilestone] = await db.insert(crmContractMilestones).values(milestone).returning();
    return newMilestone;
  }

  async updateCrmContractMilestone(id: string, milestone: Partial<InsertCrmContractMilestone>): Promise<CrmContractMilestone | undefined> {
    const [updated] = await db.update(crmContractMilestones)
      .set({ ...milestone, updatedAt: new Date() })
      .where(eq(crmContractMilestones.id, id))
      .returning();
    return updated;
  }

  async deleteCrmContractMilestone(id: string): Promise<boolean> {
    await db.delete(crmContractMilestones).where(eq(crmContractMilestones.id, id));
    return true;
  }

  // CRM Partner operations
  async getAllCrmPartners(): Promise<CrmPartner[]> {
    return await db.select().from(crmPartners).orderBy(crmPartners.name);
  }

  async getCrmPartner(id: string): Promise<CrmPartner | undefined> {
    const [partner] = await db.select().from(crmPartners).where(eq(crmPartners.id, id));
    return partner;
  }

  async createCrmPartner(partner: InsertCrmPartner): Promise<CrmPartner> {
    const [newPartner] = await db.insert(crmPartners).values(partner).returning();
    return newPartner;
  }

  async updateCrmPartner(id: string, partner: Partial<InsertCrmPartner>): Promise<CrmPartner | undefined> {
    const [updated] = await db.update(crmPartners)
      .set({ ...partner, updatedAt: new Date() })
      .where(eq(crmPartners.id, id))
      .returning();
    return updated;
  }

  async deleteCrmPartner(id: string): Promise<boolean> {
    await db.delete(crmPartners).where(eq(crmPartners.id, id));
    return true;
  }

  // CRM Partner Commission operations
  async getCrmPartnerCommissions(partnerId: string): Promise<CrmPartnerCommission[]> {
    return await db.select().from(crmPartnerCommissions)
      .where(eq(crmPartnerCommissions.partnerId, partnerId))
      .orderBy(desc(crmPartnerCommissions.createdAt));
  }

  async createCrmPartnerCommission(commission: InsertCrmPartnerCommission): Promise<CrmPartnerCommission> {
    const [newCommission] = await db.insert(crmPartnerCommissions).values(commission).returning();
    return newCommission;
  }

  async updateCrmPartnerCommission(id: string, commission: Partial<InsertCrmPartnerCommission>): Promise<CrmPartnerCommission | undefined> {
    const [updated] = await db.update(crmPartnerCommissions)
      .set({ ...commission, updatedAt: new Date() })
      .where(eq(crmPartnerCommissions.id, id))
      .returning();
    return updated;
  }

  async deleteCrmPartnerCommission(id: string): Promise<boolean> {
    await db.delete(crmPartnerCommissions).where(eq(crmPartnerCommissions.id, id));
    return true;
  }

  // Multi-tenant: Platform Partners
  async getAllPartners(): Promise<PartnerWithStats[]> {
    const allPartners = await db.select().from(partners).orderBy(desc(partners.createdAt));
    const result: PartnerWithStats[] = [];
    for (const p of allPartners) {
      const tenantCountResult = await db.select({ count: count() }).from(tenants).where(eq(tenants.partnerId, p.id));
      const tenantCount = tenantCountResult[0]?.count || 0;
      result.push({ ...p, tenantCount: Number(tenantCount) });
    }
    return result;
  }

  async getPartner(id: string): Promise<Partner | undefined> {
    const [partner] = await db.select().from(partners).where(eq(partners.id, id));
    return partner;
  }

  async getPartnerByUserId(userId: string): Promise<Partner | undefined> {
    const [partner] = await db.select().from(partners).where(eq(partners.userId, userId));
    return partner;
  }
  async createPartner(partner: InsertPartner): Promise<Partner> {
    const [newPartner] = await db.insert(partners).values(partner).returning();
    return newPartner;
  }

  async updatePartner(id: string, partner: Partial<InsertPartner>): Promise<Partner | undefined> {
    const [updated] = await db.update(partners)
      .set({ ...partner, updatedAt: new Date() })
      .where(eq(partners.id, id))
      .returning();
    return updated;
  }

  async deletePartner(id: string): Promise<boolean> {
    await db.delete(partners).where(eq(partners.id, id));
    return true;
  }

  // Multi-tenant: Tenants
  async getAllTenants(): Promise<TenantWithRelations[]> {
    const allTenants = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
    const result: TenantWithRelations[] = [];
    for (const t of allTenants) {
      const userCountResult = await db.select({ count: count() }).from(tenantUsers).where(eq(tenantUsers.tenantId, t.id));
      const subCountResult = await db.select({ count: count() }).from(tenants).where(eq(tenants.parentTenantId, t.id));
      let partner: Partner | undefined;
      if (t.partnerId) {
        const [p] = await db.select().from(partners).where(eq(partners.id, t.partnerId));
        partner = p;
      }
      result.push({
        ...t,
        partner,
        userCount: Number(userCountResult[0]?.count || 0),
        subTenantCount: Number(subCountResult[0]?.count || 0),
      });
    }
    return result;
  }

  async getTenantsByPartner(partnerId: string): Promise<TenantWithRelations[]> {
    const partnerTenants = await db.select().from(tenants).where(eq(tenants.partnerId, partnerId)).orderBy(desc(tenants.createdAt));
    const result: TenantWithRelations[] = [];
    for (const t of partnerTenants) {
      const userCountResult = await db.select({ count: count() }).from(tenantUsers).where(eq(tenantUsers.tenantId, t.id));
      const subCountResult = await db.select({ count: count() }).from(tenants).where(eq(tenants.parentTenantId, t.id));
      result.push({
        ...t,
        userCount: Number(userCountResult[0]?.count || 0),
        subTenantCount: Number(subCountResult[0]?.count || 0),
      });
    }
    return result;
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

  async getTenantBySlug(slug: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    return tenant;
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const [newTenant] = await db.insert(tenants).values(tenant).returning();
    return newTenant;
  }

  async updateTenant(id: string, tenant: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [updated] = await db.update(tenants)
      .set({ ...tenant, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return updated;
  }

  async deleteTenant(id: string): Promise<boolean> {
    await db.delete(tenants).where(eq(tenants.id, id));
    return true;
  }

  async getSubTenants(parentTenantId: string): Promise<Tenant[]> {
    return await db.select().from(tenants).where(eq(tenants.parentTenantId, parentTenantId));
  }

  async createSubTenant(data: InsertSubTenant): Promise<SubTenant> {
    const [newSubTenant] = await db.insert(subTenants).values(data).returning();
    return newSubTenant;
  }

  async updateSubTenant(id: string, data: Partial<InsertSubTenant>): Promise<SubTenant | undefined> {
    const [updated] = await db.update(subTenants)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subTenants.id, id))
      .returning();
    return updated;
  }

  async deleteSubTenant(id: string): Promise<boolean> {
    await db.delete(subTenants).where(eq(subTenants.id, id));
    return true;
  }

  async getTenantByUserId(userId: string): Promise<Tenant | undefined> {
    const [tu] = await db.select().from(tenantUsers).where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.isActive, 1)));
    if (!tu) return undefined;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tu.tenantId));
    return tenant;
  }

  // Multi-tenant: Tenant Users
  async getTenantUsers(tenantId: string): Promise<(TenantUser & { user?: User })[]> {
    const tUsers = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, tenantId));
    const result: (TenantUser & { user?: User })[] = [];
    for (const tu of tUsers) {
      const [user] = await db.select().from(users).where(eq(users.id, tu.userId));
      result.push({ ...tu, user });
    }
    return result;
  }

  async getTenantUser(tenantId: string, userId: string): Promise<TenantUser | undefined> {
    const [tu] = await db.select().from(tenantUsers).where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)));
    return tu;
  }

  async addTenantUser(tenantUser: InsertTenantUser): Promise<TenantUser> {
    const [newTu] = await db.insert(tenantUsers).values(tenantUser).returning();
    return newTu;
  }

  async updateTenantUser(id: string, data: Partial<InsertTenantUser>): Promise<TenantUser | undefined> {
    const [updated] = await db.update(tenantUsers).set(data).where(eq(tenantUsers.id, id)).returning();
    return updated;
  }

  async removeTenantUser(id: string): Promise<boolean> {
    await db.delete(tenantUsers).where(eq(tenantUsers.id, id));
    return true;
  }

  // Multi-tenant: Invite Tokens
  async createInviteToken(invite: InsertInviteToken): Promise<InviteToken> {
    const [newInvite] = await db.insert(inviteTokens).values(invite).returning();
    return newInvite;
  }

  async getInviteByToken(token: string): Promise<InviteToken | undefined> {
    const [invite] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token));
    return invite;
  }

  async acceptInvite(token: string): Promise<InviteToken | undefined> {
    const [updated] = await db.update(inviteTokens)
      .set({ acceptedAt: new Date() })
      .where(eq(inviteTokens.token, token))
      .returning();
    return updated;
  }

  async getInvitesByTenant(tenantId: string): Promise<InviteToken[]> {
    return await db.select().from(inviteTokens).where(eq(inviteTokens.tenantId, tenantId)).orderBy(desc(inviteTokens.createdAt));
  }

  // Platform Metrics
  async getPlatformMetrics(): Promise<{ totalPartners: number; totalTenants: number; totalUsers: number; activeProjects: number; totalClients: number; tokensThisMonth: number }> {
    const [partnerCount] = await db.select({ count: count() }).from(partners);
    const [tenantCount] = await db.select({ count: count() }).from(tenants);
    const [userCount] = await db.select({ count: count() }).from(users);
    const [projectCount] = await db.select({ count: count() }).from(projects);
    const [clientCount] = await db.select({ count: count() }).from(clients);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [tokenSum] = await db
      .select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.tokensInput}) + SUM(${aiUsageLogs.tokensOutput}), 0)` })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, startOfMonth));
    return {
      totalPartners: Number(partnerCount?.count || 0),
      totalTenants: Number(tenantCount?.count || 0),
      totalUsers: Number(userCount?.count || 0),
      activeProjects: Number(projectCount?.count || 0),
      totalClients: Number(clientCount?.count || 0),
      tokensThisMonth: Number(tokenSum?.total || 0),
    };
  }

  async updateUserSystemRole(id: string, systemRole: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ systemRole: systemRole as any, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  // Partner API Keys (MCP Hub Sprint 4)
  async createPartnerApiKey(input: InsertPartnerApiKey): Promise<PartnerApiKey> {
    const [row] = await db.insert(partnerApiKeys).values(input).returning();
    return row;
  }

  async listPartnerApiKeys(tenantId: string): Promise<PartnerApiKey[]> {
    return await db
      .select()
      .from(partnerApiKeys)
      .where(eq(partnerApiKeys.tenantId, tenantId))
      .orderBy(desc(partnerApiKeys.createdAt));
  }

  async getPartnerApiKeyByHash(hash: string): Promise<PartnerApiKey | undefined> {
    const [row] = await db
      .select()
      .from(partnerApiKeys)
      .where(eq(partnerApiKeys.keyHash, hash))
      .limit(1);
    return row;
  }

  async revokePartnerApiKey(id: string, tenantId: string): Promise<PartnerApiKey | undefined> {
    const [row] = await db
      .update(partnerApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(partnerApiKeys.id, id), eq(partnerApiKeys.tenantId, tenantId)))
      .returning();
    return row;
  }

  async touchPartnerApiKeyUsage(id: string): Promise<void> {
    await db
      .update(partnerApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(partnerApiKeys.id, id));
  }

  // Role Permissions
  async getRolePermissions(tenantId: string): Promise<RolePermission[]> {
    return await db.select().from(rolePermissions).where(eq(rolePermissions.tenantId, tenantId));
  }

  async upsertRolePermissions(tenantId: string, items: Array<{ role: string; module: string; canView: number; canCreate: number; canEdit: number; canDelete: number }>): Promise<void> {
    for (const item of items) {
      await db.execute(drizzleSql`
        INSERT INTO role_permissions (id, tenant_id, role, module, can_view, can_create, can_edit, can_delete, updated_at)
        VALUES (gen_random_uuid(), ${tenantId}, ${item.role}::user_role, ${item.module}, ${item.canView}, ${item.canCreate}, ${item.canEdit}, ${item.canDelete}, NOW())
        ON CONFLICT (tenant_id, role, module)
        DO UPDATE SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete, updated_at = NOW()
      `);
    }
  }
}

export const storage = new DatabaseStorage();
