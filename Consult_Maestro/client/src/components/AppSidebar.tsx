import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  Grid3X3,
  RefreshCcw,
  GitBranch,
  FileText,
  CheckSquare,
  Settings,
  LogOut,
  ChevronDown,
  UserCog,
  UsersRound,
  Database,
  HelpCircle,
  Target,
  TrendingUp,
  Headphones,
  BookOpen,
  Brain,
  Bot,
  Users2,
  LayoutPanelTop,
  ListTodo,
  Zap,
  Clock,
  BarChart3,
  Network,
  Building2,
  Shield,
  Briefcase,
  Plus,
  Globe,
  Plug,
  KanbanSquare,
  Wallet,
  LifeBuoy,
  Sparkles,
  Code2,
  HardDrive,
  Rocket,
  Wand2,
  Package,
  Cpu,
  DollarSign,
  Scale,
} from "lucide-react";
import { useAgentContext } from "@/contexts/AgentContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useSystemRole } from "@/hooks/useSystemRole";
import { usePermissions } from "@/hooks/usePermissions";
import { getRoleLabel, getSystemRoleLabel } from "@/lib/authUtils";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { EmpresaSelector } from "@/components/EmpresaSelector";

const soeNavItems = [
  { title: "CFO — Financeiro",    slug: "soe-financeiro", icon: DollarSign },
  { title: "PM — Projetos",       slug: "soe-projetos",   icon: FolderKanban },
  { title: "RH — Pessoas",        slug: "soe-rh",         icon: UsersRound },
  { title: "Sales — Comercial",   slug: "soe-crm",        icon: TrendingUp },
  { title: "Legal — Societário",  slug: "soe-juridico",   icon: Scale },
];

const mainNavItems = [
  { title: "Início", url: "/", icon: LayoutDashboard, module: "dashboard" },
  { title: "CRM", url: "/crm", icon: TrendingUp, module: "crm" },
  { title: "Pessoas", url: "/pessoas", icon: UsersRound, module: "clientes" },
  { title: "Demandas", url: "/demandas", icon: KanbanSquare, module: "projetos" },
  { title: "Societário", url: "/societario", icon: Building2, module: "clientes" },
  { title: "Control", url: "/control", icon: Wallet, module: "clientes" },
  { title: "Recovery", url: "/recovery", icon: LifeBuoy, module: "clientes" },
  { title: "RH / DP", url: "/hr/colaboradores", icon: UserCog, module: "clientes" },
  { title: "Projetos", url: "/projetos", icon: FolderKanban, module: "projetos" },
];

const diagnosticNavItems = [
  { title: "Canvas BMC", url: "/canvas", icon: Grid3X3, module: "canvas" },
  { title: "Análise SWOT", url: "/swot", icon: Target, module: "swot" },
  { title: "PDCA", url: "/pdca", icon: RefreshCcw, module: "pdca" },
  { title: "Processos", url: "/processos", icon: GitBranch, module: "processos" },
  { title: "Requisitos ERP", url: "/erp-aderencia", icon: Database, module: "erp" },
  { title: "Tarefas", url: "/tarefas", icon: CheckSquare, module: "tarefas" },
  { title: "Relatórios", url: "/relatorios", icon: FileText, module: "relatorios" },
];

// Tipo dos itens de navegação. `adminOnly` esconde o item para non-admins
// (superadmin/partner/tenant_admin); usado por features privilegiadas como o
// Planejador de Módulo, que dispara LLM e pipeline.
type NavItem = {
  title: string;
  url: string;
  icon: typeof Sparkles;
  module: string;
  adminOnly?: boolean;
};

const intelligenceNavItems: NavItem[] = [
  { title: "Super Agente", url: "/super-agente", icon: Sparkles, module: "dashboard" },
  { title: "Escritório Agente", url: "/escritorio-agente", icon: Globe, module: "dashboard" },
  { title: "BI Consultivo", url: "/bi", icon: BarChart3, module: "dashboard" },
  { title: "Cérebro", url: "/inteligencia", icon: Brain, module: "dashboard" },
  { title: "Construtor de Agentes", url: "/agentes", icon: Bot, module: "dashboard" },
  { title: "Workspace IDE", url: "/workspace", icon: Code2, module: "dashboard", adminOnly: true },
  { title: "Dev Center IDE", url: "/dev-center", icon: Code2, module: "dashboard" },
  { title: "Explorador de Código", url: "/explorador-codigo", icon: FileText, module: "dashboard", adminOnly: true },
  { title: "Planejador de Módulo", url: "/planejador", icon: Wand2, module: "dashboard", adminOnly: true },
  { title: "App Store", url: "/app-store", icon: Package, module: "dashboard" },
  { title: "Publicar Módulo", url: "/app-store/publicar", icon: Rocket, module: "dashboard", adminOnly: true },
  { title: "Prompt Studio", url: "/dev-center/prompts", icon: Wand2, module: "dashboard" },
  { title: "Browser Skills", url: "/dev-center/browser-skills", icon: Globe, module: "dashboard" },
  { title: "Infraestrutura", url: "/dev-center/infra", icon: HardDrive, module: "dashboard" },
  { title: "Configurar novo servidor", url: "/dev-center/onboarding", icon: Rocket, module: "dashboard" },
  { title: "Integrações", url: "/integracoes", icon: Plug, module: "dashboard" },
  { title: "Datasets", url: "/datasets", icon: Database, module: "dashboard" },
];

const supportNavItems = [
  { title: "Tickets", url: "/suporte", icon: Headphones, module: "suporte" },
  { title: "Base de Conhecimento", url: "/conhecimento", icon: BookOpen, module: "suporte" },
];

const productionNavItems = [
  { title: "Central de Produção", url: "/producao", icon: LayoutPanelTop, module: "producao" },
  { title: "Projetos", url: "/producao/projetos", icon: FolderKanban, module: "producao" },
  { title: "Backlog", url: "/producao/backlog", icon: ListTodo, module: "producao" },
  { title: "Sprints", url: "/producao/sprints", icon: Zap, module: "producao" },
  { title: "Squads", url: "/producao/squads", icon: Users2, module: "producao" },
  { title: "Colaboradores", url: "/colaboradores", icon: UsersRound, module: "colaboradores" },
  { title: "Timesheet", url: "/producao/timesheet", icon: Clock, module: "producao" },
  { title: "Relatórios", url: "/producao/relatorios", icon: BarChart3, module: "producao" },
];

const superadminNavItems = [
  { title: "Painel Geral", url: "/superadmin", icon: Shield },
  { title: "Agências", url: "/superadmin/parceiros", icon: Briefcase },
  { title: "Todos os Tenants", url: "/superadmin/tenants", icon: Building2 },
  { title: "Log de Atividade", url: "/superadmin/atividade", icon: Globe },
  { title: "Mapa do Sistema", url: "/mapa-sistema", icon: Network },
  { title: "Revisão Marketplace", url: "/superadmin/marketplace", icon: Package },
  { title: "Orquestrador LLM", url: "/admin/llm-orchestrator", icon: Zap },
];

const partnerNavItems = [
  { title: "Visão Geral", url: "/partner", icon: LayoutDashboard },
  { title: "Tenants", url: "/partner/tenants", icon: Building2 },
  { title: "Novo Tenant", url: "/partner/novo-tenant", icon: Plus },
];

const tenantAdminNavItems = [
  { title: "Minha Empresa", url: "/minha-empresa", icon: Building2 },
  { title: "Usuários", url: "/minha-empresa/equipe", icon: Users },
  { title: "Filiais", url: "/minha-empresa/filiais", icon: Network },
  { title: "Perfis de Acesso", url: "/minha-empresa/perfis", icon: Shield },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { systemRole, isSuperadmin, isPartner, isTenantAdmin } = useSystemRole();
  const { canView } = usePermissions();
  const { openWithMessage } = useAgentContext();

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  };

  const renderNavItems = (items: { title: string; url: string; icon: any }[], isActiveCheck?: (url: string) => boolean) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton 
          asChild 
          isActive={isActiveCheck ? isActiveCheck(item.url) : (location === item.url || (item.url !== "/" && location.startsWith(item.url)))}
        >
          <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/ /g, '-')}`}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          {isPartner ? (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-600 text-white font-heading font-bold text-sm">
                RT
              </div>
              <div className="flex flex-col">
                <span className="font-heading font-semibold text-base">Retaguarda</span>
                <span className="text-xs text-muted-foreground">Portal do Parceiro</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-heading font-bold">
                AC
              </div>
              <div className="flex flex-col">
                <span className="font-heading font-semibold text-base">Arcádia</span>
                <span className="text-xs text-muted-foreground">Consulting Platform</span>
              </div>
            </>
          )}
        </div>

        {/* Tenant Switcher for tenant admins */}
        {isTenantAdmin && (
          <div className="mt-3 border-t border-sidebar-border pt-3">
            <TenantSwitcher />
          </div>
        )}
        {/* Seletor de empresa ativa (visível quando tenant tem 2+ empresas) */}
        <div className="mt-2">
          <EmpresaSelector />
        </div>
      </SidebarHeader>

      <SidebarContent className="p-2">
        {/* SUPERADMIN SECTION */}
        {isSuperadmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Plataforma
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItems(superadminNavItems)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* PARTNER SECTION — Retaguar (visible to partners AND superadmin) */}
        {(isPartner || isSuperadmin) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Retaguarda
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItems(partnerNavItems)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* TENANT ADMIN SECTION */}
        {isTenantAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItems(tenantAdminNavItems)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* STANDARD ADMIN/GERENTE ADMIN SECTION */}
        {(user?.role === 'admin' || user?.role === 'gerente') && !isSuperadmin && !isPartner && !isTenantAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.startsWith('/equipe')}>
                    <Link href="/equipe" data-testid="link-nav-equipe">
                      <UserCog className="h-4 w-4" />
                      <span>Equipe</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {user?.role === 'admin' && (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === '/configuracoes'}>
                        <Link href="/configuracoes" data-testid="link-nav-configuracoes">
                          <Settings className="h-4 w-4" />
                          <span>Configurações</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith('/configuracoes/integracoes')} className="pl-8 text-xs">
                        <Link href="/configuracoes/integracoes" data-testid="link-nav-configuracoes-integracoes">
                          <Plug className="h-3.5 w-3.5" />
                          <span>Integrações</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith('/configuracoes/api-keys')} className="pl-8 text-xs">
                        <Link href="/configuracoes/api-keys" data-testid="link-nav-configuracoes-api-keys">
                          <Plug className="h-3.5 w-3.5" />
                          <span>API Keys</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith('/configuracoes/ia')} className="pl-8 text-xs">
                        <Link href="/configuracoes/ia" data-testid="link-nav-configuracoes-ia">
                          <Plug className="h-3.5 w-3.5" />
                          <span>IA — Integrações</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* MAIN SECTION — filtered by permissions for regular users */}
        {(() => {
          const visibleMain = mainNavItems.filter(item => canView(item.module));
          if (visibleMain.length === 0) return null;
          return (
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                Início
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {renderNavItems(visibleMain, (url) => location === url || (url !== "/" && location.startsWith(url)))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}

        {(() => {
          const visibleDiag = diagnosticNavItems.filter(item => canView(item.module));
          if (visibleDiag.length === 0) return null;
          return (
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                Diagnóstico
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {renderNavItems(visibleDiag, (url) => location.startsWith(url))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}

        {canView('producao') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Produção
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItems(productionNavItems, (url) => location === url || (url !== "/producao" && location.startsWith(url)))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(() => {
          const visibleIntel = intelligenceNavItems.filter((item) => {
            if (!canView(item.module)) return false;
            // Itens marcados adminOnly só aparecem para superadmin/partner/tenant_admin
            // (mesma regra do middleware requireTenantAdminOrPartner no backend
            // e do guard de role na própria página /planejador).
            if (item.adminOnly && !(isSuperadmin || isPartner || isTenantAdmin)) return false;
            return true;
          });
          if (visibleIntel.length === 0) return null;
          return (
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                Inteligência
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {renderNavItems(visibleIntel, (url) => location.startsWith(url))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })()}

        {/* SOE — Sistema Operacional de Escritório */}
        {canView('dashboard') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              SOE — Agentes
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {soeNavItems.map((item) => (
                  <SidebarMenuItem key={item.slug}>
                    <SidebarMenuButton
                      onClick={() => openWithMessage(`@${item.slug} `)}
                      className="cursor-pointer"
                      data-testid={`button-soe-agent-${item.slug}`}
                    >
                      <item.icon className="h-4 w-4 text-primary" />
                      <span className="text-sm">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {canView('suporte') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
              Suporte
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderNavItems(supportNavItems, (url) => location === url || (url !== "/" && location.startsWith(url)))}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.startsWith('/ajuda')}>
                    <Link href="/ajuda" data-testid="link-nav-ajuda">
                      <HelpCircle className="h-4 w-4" />
                      <span>Ajuda</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button 
              className="flex w-full items-center gap-3 rounded-md p-2 hover-elevate active-elevate-2"
              data-testid="button-user-menu"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || 'Usuário'} />
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {getInitials(user?.firstName, user?.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col items-start text-left">
                <span className="text-sm font-medium">
                  {user?.firstName || 'Usuário'} {user?.lastName || ''}
                </span>
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {getRoleLabel(user?.role || 'tecnico')}
                  </Badge>
                  {systemRole !== 'user' && (
                    <Badge variant="secondary" className="text-xs">
                      {getSystemRoleLabel(systemRole)}
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href="/perfil" data-testid="link-perfil">
                <span>Meu Perfil</span>
              </Link>
            </DropdownMenuItem>
            {isSuperadmin && (
              <DropdownMenuItem asChild>
                <Link href="/superadmin" data-testid="link-superadmin-panel">
                  <Shield className="h-4 w-4 mr-2" />
                  <span>Painel Superadmin</span>
                </Link>
              </DropdownMenuItem>
            )}
            {isPartner && (
              <DropdownMenuItem asChild>
                <Link href="/partner" data-testid="link-partner-panel">
                  <Briefcase className="h-4 w-4 mr-2" />
                  <span>Retaguarda</span>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/api/logout" data-testid="button-logout" className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                <span>Sair</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
