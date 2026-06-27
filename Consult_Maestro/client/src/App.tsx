import { Switch, Route } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAgentSoe } from "@/components/FloatingAgentSoe";
import { AgentContextProvider } from "@/contexts/AgentContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Lazy load pages for code splitting
const NotFound = lazy(() => import("@/pages/not-found"));
const Landing = lazy(() => import("@/pages/Landing"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Pessoas = lazy(() => import("@/pages/Pessoas"));
const PessoaDetalhe = lazy(() => import("@/pages/PessoaDetalhe"));
const ClientesLegacyRedirect = lazy(() => import("@/pages/ClientesLegacyRedirect"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectForm = lazy(() => import("@/pages/ProjectForm"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Canvas = lazy(() => import("@/pages/Canvas"));
const Demandas = lazy(() => import("@/pages/Demandas"));
const Pdca = lazy(() => import("@/pages/Pdca"));
const Processes = lazy(() => import("@/pages/Processes"));
const ProcessDetail = lazy(() => import("@/pages/ProcessDetail"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Reports = lazy(() => import("@/pages/Reports"));
const Usuarios = lazy(() => import("@/pages/Usuarios"));
const Collaborators = lazy(() => import("@/pages/Collaborators"));
const OrgChart = lazy(() => import("@/pages/OrgChart"));
const ErpAdherence = lazy(() => import("@/pages/ErpAdherence"));
const Help = lazy(() => import("@/pages/Help"));
const Swot = lazy(() => import("@/pages/Swot"));
const Crm = lazy(() => import("@/pages/Crm"));
const CrmKanban = lazy(() => import("@/pages/CrmKanban"));
const Support = lazy(() => import("@/pages/Support"));
const SupportTypes = lazy(() => import("@/pages/SupportTypes"));
const TicketDetail = lazy(() => import("@/pages/TicketDetail"));
const KnowledgeBase = lazy(() => import("@/pages/KnowledgeBase"));
const KnowledgeBrain = lazy(() => import("@/pages/KnowledgeBrain"));
const AgentBuilder = lazy(() => import("@/pages/AgentBuilder"));
const BiBuilder = lazy(() => import("@/pages/BiBuilder"));
const BiPublic = lazy(() => import("@/pages/BiPublic"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const Societario = lazy(() => import("@/pages/Societario"));
const SocietarioDetail = lazy(() => import("@/pages/SocietarioDetail"));
const PipelineSocietario = lazy(() => import("@/pages/societario/Pipeline"));
const ProcessoSocietarioDetail = lazy(() => import("@/pages/societario/ProcessoDetail"));
const PipelineSocietarioDashboard = lazy(() => import("@/pages/societario/Dashboard"));
const PipelineSocietarioConfigs = lazy(() => import("@/pages/societario/PipelineConfigs"));
const Control = lazy(() => import("@/pages/Control"));
const ControlDetalhe = lazy(() => import("@/pages/ControlDetalhe"));
const ControlCentrosCusto = lazy(() => import("@/pages/control/CentrosCusto"));
const ControlRecorrencias = lazy(() => import("@/pages/control/Recorrencias"));
const ControlOrcamento = lazy(() => import("@/pages/control/Orcamento"));
const ControlFluxoCaixaMensal = lazy(() => import("@/pages/control/FluxoCaixaMensal"));
const ControlFluxoCaixaDiario = lazy(() => import("@/pages/control/FluxoCaixaDiario"));
const ControlDRE = lazy(() => import("@/pages/control/DRE"));
const ControlPivotCarteira = lazy(() => import("@/pages/control/PivotCarteira"));
const ControlCarteiras = lazy(() => import("@/pages/control/Carteiras"));
const ControlSetupWizard = lazy(() => import("@/pages/control/SetupWizard"));
const ControlCalendario = lazy(() => import("@/pages/control/Calendario"));
const Recovery = lazy(() => import("@/pages/Recovery"));
const RecoveryProcessDetail = lazy(() => import("@/pages/RecoveryProcessDetail"));
const RecoveryScenarioDetail = lazy(() => import("@/pages/RecoveryScenarioDetail"));
const SuperAgent = lazy(() => import("@/pages/SuperAgent"));
const EscritorioAgente = lazy(() => import("@/pages/EscritorioAgente"));
const DevCenter = lazy(() => import("@/pages/DevCenter"));
const InfraManager = lazy(() => import("@/pages/devcenter/InfraManager"));
const OnboardingWizard = lazy(() => import("@/pages/devcenter/OnboardingWizard"));
const PromptStudio = lazy(() => import("@/pages/devcenter/PromptStudio"));
const BrowserSkills = lazy(() => import("@/pages/devcenter/BrowserSkills"));
const Planejador = lazy(() => import("@/pages/Planejador"));
const AppStore = lazy(() => import("@/pages/AppStore"));
const AppStoreDetail = lazy(() => import("@/pages/AppStoreDetail"));
const AppStorePublish = lazy(() => import("@/pages/AppStorePublish"));
const MarketplaceReview = lazy(() => import("@/pages/superadmin/MarketplaceReview"));
const CodeExplorer = lazy(() => import("@/pages/CodeExplorer"));
const WorkspaceIDE = lazy(() => import("@/pages/WorkspaceIDE"));
const PortalDashboard = lazy(() => import("@/pages/portal/PortalDashboard"));
const PortalTickets = lazy(() => import("@/pages/portal/PortalTickets"));
const PortalArticles = lazy(() => import("@/pages/portal/PortalArticles"));
const PortalTraining = lazy(() => import("@/pages/portal/PortalTraining"));
const Scrum = lazy(() => import("@/pages/Scrum"));
const ScrumProjects = lazy(() => import("@/pages/ScrumProjects"));
const ScrumBacklog = lazy(() => import("@/pages/ScrumBacklog"));
const ScrumSprints = lazy(() => import("@/pages/ScrumSprints"));
const ScrumSquads = lazy(() => import("@/pages/ScrumSquads"));
const ScrumTimesheet = lazy(() => import("@/pages/ScrumTimesheet"));
const SprintPlanning = lazy(() => import("@/pages/SprintPlanning"));
const ScrumReports = lazy(() => import("@/pages/ScrumReports"));
const HistoricoReunioes = lazy(() => import("@/pages/producao/HistoricoReunioes"));
const ReuniaoAtiva = lazy(() => import("@/pages/producao/ReuniaoAtiva"));
const AcoesReunioes = lazy(() => import("@/pages/producao/AcoesReunioes"));
const RelatorioProjeto = lazy(() => import("@/pages/producao/RelatorioProjeto"));
const CentralProducao = lazy(() => import("@/pages/producao/CentralProducao"));
const HrEmployees = lazy(() => import("@/pages/hr/EmployeesPage"));
const HrEmployeeForm = lazy(() => import("@/pages/hr/EmployeeFormPage"));
const HrEmployeeAccount = lazy(() => import("@/pages/hr/EmployeeAccountPage"));
const HrPositionsDepartments = lazy(() => import("@/pages/hr/PositionsDepartmentsPage"));
const HrPayroll = lazy(() => import("@/pages/hr/PayrollPage"));
const HrTimesheet = lazy(() => import("@/pages/hr/TimesheetPage"));
const HrImport = lazy(() => import("@/pages/hr/ImportPage"));
const HrReports = lazy(() => import("@/pages/hr/ReportsPage"));
const SystemMap = lazy(() => import("@/pages/SystemMap"));
const Invite = lazy(() => import("@/pages/Invite"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Profile = lazy(() => import("@/pages/Profile"));
const ConfiguracoesIndex = lazy(() => import("@/pages/configuracoes/Index"));
const ConfiguracoesIntegracoes = lazy(() => import("@/pages/configuracoes/Integracoes"));
const DatasetHub = lazy(() => import("@/pages/DatasetHub"));
const AtlasDashboard = lazy(() => import("@/pages/AtlasDashboard"));
const AtlasExplorer = lazy(() => import("@/pages/AtlasExplorer"));
const ConfiguracoesApiKeys = lazy(() => import("@/pages/configuracoes/ApiKeys"));
const ConfiguracoesIaUso = lazy(() => import("@/pages/configuracoes/IaUso"));

// Superadmin pages
const SuperadminDashboard = lazy(() => import("@/pages/superadmin/Dashboard"));
const SuperadminPartners = lazy(() => import("@/pages/superadmin/Partners"));
const SuperadminTenantDetail = lazy(() => import("@/pages/superadmin/TenantDetail"));
const LlmOrchestrator = lazy(() => import("@/pages/superadmin/LlmOrchestrator"));

// Partner pages
const PartnerDashboard = lazy(() => import("@/pages/partner/Dashboard"));
const PartnerTenantsList = lazy(() => import("@/pages/partner/TenantsList"));
const PartnerTenantDetail = lazy(() => import("@/pages/partner/TenantDetail"));
const PartnerNewTenant = lazy(() => import("@/pages/partner/NewTenant"));

// Tenant admin pages
const TenantSettings = lazy(() => import("@/pages/tenant/Settings"));
const TenantTeam = lazy(() => import("@/pages/tenant/Team"));
const TenantSubTenants = lazy(() => import("@/pages/tenant/SubTenants"));
const TenantPermissions = lazy(() => import("@/pages/tenant/Permissions"));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedRouter() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/crm" component={Crm} />
                <Route path="/crm/kanban" component={CrmKanban} />
                {/* Cadastro legado /clientes substituído por /pessoas (CRM 2.0).
                    As rotas antigas redirecionam para preservar links existentes. */}
                <Route path="/clientes" component={ClientesLegacyRedirect} />
                <Route path="/clientes/novo" component={ClientesLegacyRedirect} />
                <Route path="/clientes/:id/editar" component={ClientesLegacyRedirect} />
                <Route path="/clientes/:id" component={ClientesLegacyRedirect} />
                <Route path="/pessoas" component={Pessoas} />
                <Route path="/pessoas/:id" component={PessoaDetalhe} />
                <Route path="/projetos" component={Projects} />
                <Route path="/projetos/novo" component={ProjectForm} />
                <Route path="/projetos/:id" component={ProjectDetail} />
                <Route path="/projetos/:id/editar" component={ProjectForm} />
                <Route path="/canvas" component={Canvas} />
                <Route path="/canvas/:projectId" component={Canvas} />
                <Route path="/demandas" component={Demandas} />
                <Route path="/pdca" component={Pdca} />
                <Route path="/pdca/:projectId" component={Pdca} />
                <Route path="/processos" component={Processes} />
                <Route path="/processos/:projectId" component={Processes} />
                <Route path="/processo/:id" component={ProcessDetail} />
                <Route path="/tarefas" component={Tasks} />
                <Route path="/relatorios" component={Reports} />
                <Route path="/relatorios/:projectId" component={Reports} />
                <Route path="/equipe" component={Usuarios} />
                <Route path="/colaboradores" component={Collaborators} />
                <Route path="/organograma" component={OrgChart} />
                <Route path="/erp-aderencia" component={ErpAdherence} />
                <Route path="/swot" component={Swot} />
                <Route path="/swot/:projectId" component={Swot} />
                <Route path="/ajuda" component={Help} />
                <Route path="/ajuda/:slug" component={Help} />
                <Route path="/suporte" component={Support} />
                <Route path="/suporte/tipos" component={SupportTypes} />
                <Route path="/suporte/tickets/:id" component={TicketDetail} />
                <Route path="/conhecimento" component={KnowledgeBase} />
                <Route path="/inteligencia" component={KnowledgeBrain} />
                <Route path="/agentes" component={AgentBuilder} />
                <Route path="/bi" component={BiBuilder} />
                <Route path="/integracoes" component={Integrations} />
                <Route path="/datasets" component={DatasetHub} />
                <Route path="/datasets/atlas" component={AtlasDashboard} />
                <Route path="/datasets/atlas/explorer" component={AtlasExplorer} />
                <Route path="/configuracoes" component={ConfiguracoesIndex} />
                <Route path="/configuracoes/integracoes" component={ConfiguracoesIntegracoes} />
                <Route path="/configuracoes/api-keys" component={ConfiguracoesApiKeys} />
                <Route path="/configuracoes/ia" component={ConfiguracoesIaUso} />
                <Route path="/societario" component={Societario} />
                <Route path="/societario/pipeline">{() => <PipelineSocietario />}</Route>
                <Route path="/societario/pipeline/:id" component={ProcessoSocietarioDetail} />
                <Route path="/societario/dashboard">{() => <PipelineSocietarioDashboard />}</Route>
                <Route path="/societario/configuracoes/pipelines">{() => <PipelineSocietarioConfigs />}</Route>
                <Route path="/societario/:id" component={SocietarioDetail} />
                <Route path="/control" component={Control} />
                <Route path="/control/:clienteId/centros-custo" component={ControlCentrosCusto} />
                <Route path="/control/:clienteId/recorrencias" component={ControlRecorrencias} />
                <Route path="/control/:clienteId/orcamento" component={ControlOrcamento} />
                <Route path="/control/:clienteId/fluxo-caixa-mensal" component={ControlFluxoCaixaMensal} />
                <Route path="/control/:clienteId/fluxo-caixa-diario" component={ControlFluxoCaixaDiario} />
                <Route path="/control/:clienteId/dre" component={ControlDRE} />
                <Route path="/control/:clienteId/pivot" component={ControlPivotCarteira} />
                <Route path="/control/:clienteId/carteiras" component={ControlCarteiras} />
                <Route path="/control/:clienteId/setup" component={ControlSetupWizard} />
                <Route path="/control/:clienteId/calendario" component={ControlCalendario} />
                <Route path="/control/:clienteId" component={ControlDetalhe} />
                <Route path="/recovery" component={Recovery} />
                <Route path="/recovery/scenarios/:id" component={RecoveryScenarioDetail} />
                <Route path="/recovery/:id" component={RecoveryProcessDetail} />
                <Route path="/super-agente" component={SuperAgent} />
                <Route path="/escritorio-agente" component={EscritorioAgente} />
                <Route path="/dev-center" component={DevCenter} />
                <Route path="/dev-center/infra" component={InfraManager} />
                <Route path="/dev-center/onboarding" component={OnboardingWizard} />
                <Route path="/dev-center/prompts" component={PromptStudio} />
                <Route path="/dev-center/browser-skills" component={BrowserSkills} />
                <Route path="/planejador" component={Planejador} />
                <Route path="/app-store" component={AppStore} />
                <Route path="/app-store/publicar" component={AppStorePublish} />
                <Route path="/app-store/:slug" component={AppStoreDetail} />
                <Route path="/superadmin/marketplace" component={MarketplaceReview} />
                <Route path="/explorador-codigo" component={CodeExplorer} />
                <Route path="/workspace" component={WorkspaceIDE} />
                <Route path="/dev-center/:runId" component={DevCenter} />
                <Route path="/portal" component={PortalDashboard} />
                <Route path="/portal/tickets" component={PortalTickets} />
                <Route path="/portal/artigos" component={PortalArticles} />
                <Route path="/portal/treinamentos" component={PortalTraining} />
                <Route path="/producao" component={CentralProducao} />
                <Route path="/producao/scrum" component={Scrum} />
                <Route path="/producao/projetos" component={ScrumProjects} />
                <Route path="/producao/backlog" component={ScrumBacklog} />
                <Route path="/producao/sprints" component={ScrumSprints} />
                <Route path="/producao/sprints/:id" component={ScrumSprints} />
                <Route path="/producao/sprints/:id/planning" component={SprintPlanning} />
                <Route path="/producao/squads" component={ScrumSquads} />
                <Route path="/producao/timesheet" component={ScrumTimesheet} />
                <Route path="/producao/relatorios" component={ScrumReports} />
                <Route path="/producao/projetos/:id/reunioes" component={HistoricoReunioes} />
                <Route path="/producao/reunioes/:id" component={ReuniaoAtiva} />
                <Route path="/producao/projetos/:id/acoes" component={AcoesReunioes} />
                <Route path="/producao/projetos/:id/relatorio" component={RelatorioProjeto} />
                <Route path="/hr/colaboradores" component={HrEmployees} />
                <Route path="/hr/colaboradores/novo" component={HrEmployeeForm} />
                <Route path="/hr/colaboradores/:id/conta-corrente" component={HrEmployeeAccount} />
                <Route path="/hr/colaboradores/:id" component={HrEmployeeForm} />
                <Route path="/hr/cargos-departamentos" component={HrPositionsDepartments} />
                <Route path="/hr/folha" component={HrPayroll} />
                <Route path="/hr/ponto" component={HrTimesheet} />
                <Route path="/hr/importar" component={HrImport} />
                <Route path="/hr/relatorios" component={HrReports} />
                <Route path="/mapa-sistema" component={SystemMap} />
                <Route path="/onboarding" component={Onboarding} />
                <Route path="/perfil" component={Profile} />

                {/* Superadmin routes */}
                <Route path="/superadmin" component={SuperadminDashboard} />
                <Route path="/superadmin/parceiros" component={SuperadminPartners} />
                <Route path="/superadmin/tenants" component={SuperadminPartners} />
                <Route path="/superadmin/tenant/:id" component={SuperadminTenantDetail} />
                <Route path="/superadmin/atividade" component={SuperadminDashboard} />
                <Route path="/admin/llm-orchestrator" component={LlmOrchestrator} />

                {/* Partner routes */}
                <Route path="/partner" component={PartnerDashboard} />
                <Route path="/partner/tenants" component={PartnerTenantsList} />
                <Route path="/partner/novo-tenant" component={PartnerNewTenant} />
                <Route path="/partner/tenant/:id" component={PartnerTenantDetail} />

                {/* Tenant Admin routes */}
                <Route path="/minha-empresa" component={TenantSettings} />
                <Route path="/minha-empresa/equipe" component={TenantTeam} />
                <Route path="/minha-empresa/filiais" component={TenantSubTenants} />
                <Route path="/minha-empresa/perfis" component={TenantPermissions} />

                <Route component={NotFound} />
              </Switch>
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        <FloatingAgentSoe />
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/bi/public/:token" component={BiPublic} />
            <Route path="/convite/:token" component={Invite} />
            <Route component={Landing} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/bi/public/:token" component={BiPublic} />
          <Route path="/convite/:token" component={Invite} />
          <Route component={AuthenticatedRouter} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AgentContextProvider>
          <TooltipProvider>
            <ErrorBoundary>
              <ImpersonationBanner />
              <Router />
              <Toaster />
            </ErrorBoundary>
          </TooltipProvider>
        </AgentContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
