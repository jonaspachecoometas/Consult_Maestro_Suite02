import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2,
  Users,
  User,
  Crown,
  Handshake,
  ShieldCheck,
  LayoutDashboard,
  TrendingUp,
  FolderKanban,
  Grid3X3,
  RefreshCcw,
  GitBranch,
  FileText,
  BarChart3,
  Target,
  Database,
  Headphones,
  BookOpen,
  LayoutPanelTop,
  CheckSquare,
  ChevronRight,
  Globe,
  Lock,
  Unlock,
  UserCog,
  Building,
  Network,
  Zap,
} from "lucide-react";

const LEVEL_COLORS = {
  superadmin: { bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800", badge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", dot: "bg-purple-500", text: "text-purple-700 dark:text-purple-300" },
  partner: { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", badge: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300" },
  tenant: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  user: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
};

const ACCESS = {
  full: { label: "Acesso Total", color: "text-emerald-600 dark:text-emerald-400", icon: Unlock },
  partial: { label: "Acesso Parcial", color: "text-amber-600 dark:text-amber-400", icon: ShieldCheck },
  none: { label: "Sem Acesso", color: "text-red-400 dark:text-red-500", icon: Lock },
};

const modules = [
  {
    icon: LayoutDashboard,
    name: "Dashboard",
    description: "Visão geral de métricas e projetos ativos",
    superadmin: "full", partner: "full", tenant: "full", user: "full",
  },
  {
    icon: TrendingUp,
    name: "CRM",
    description: "Leads, oportunidades, propostas e contratos",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: Users,
    name: "Clientes",
    description: "Cadastro e gestão de clientes",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: FolderKanban,
    name: "Projetos",
    description: "Gestão completa de projetos de consultoria",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: Grid3X3,
    name: "Canvas BMC",
    description: "Business Model Canvas em 4 níveis diagnósticos",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: GitBranch,
    name: "Processos",
    description: "Mapeamento AS-IS/TO-BE com fluxogramas",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: RefreshCcw,
    name: "PDCA",
    description: "Ciclos de melhoria contínua integrados",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: Target,
    name: "SWOT",
    description: "Análise SWOT geral e setorial com PDCA",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: Database,
    name: "ERP Aderência",
    description: "Avaliação de aderência a sistemas ERP",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: LayoutPanelTop,
    name: "Produção / Scrum",
    description: "Backlog, sprints, squads e timesheet",
    superadmin: "full", partner: "full", tenant: "full", user: "full",
  },
  {
    icon: BarChart3,
    name: "Relatórios",
    description: "Geração de relatórios customizados por projeto",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
  {
    icon: Headphones,
    name: "Suporte",
    description: "Tickets, atendimento e base de conhecimento",
    superadmin: "full", partner: "full", tenant: "full", user: "full",
  },
  {
    icon: BookOpen,
    name: "Base de Conhecimento",
    description: "Artigos, tutoriais e treinamentos",
    superadmin: "full", partner: "full", tenant: "full", user: "full",
  },
  {
    icon: CheckSquare,
    name: "Tarefas",
    description: "Gestão de tarefas individuais e por projeto",
    superadmin: "full", partner: "full", tenant: "full", user: "full",
  },
  {
    icon: UserCog,
    name: "Equipe & Usuários",
    description: "Gestão de usuários, roles e acessos",
    superadmin: "full", partner: "full", tenant: "full", user: "none",
  },
  {
    icon: FileText,
    name: "Documentação",
    description: "Histórico rico por projeto com editor Word-like",
    superadmin: "full", partner: "full", tenant: "full", user: "partial",
  },
];

const hierarchy = [
  {
    level: "superadmin",
    icon: Crown,
    title: "Superadmin",
    subtitle: "Arcádia (Time de desenvolvimento)",
    description: "Visão global irrestrita de toda a plataforma. Gerencia parceiros, monitora todos os tenants, acessa logs de auditoria e configura o ambiente da plataforma.",
    capabilities: [
      "Cadastrar e gerenciar parceiros",
      "Visualizar qualquer tenant em modo auditoria",
      "Métricas globais da plataforma",
      "Configurações sistêmicas",
      "Log de acessos e atividade",
    ],
    count: "1 instância",
  },
  {
    level: "partner",
    icon: Handshake,
    title: "Parceiro",
    subtitle: "Consultores, Contadores, Advogados...",
    description: "Cria e gerencia os workspaces (tenants) dos seus clientes. Tem visão consolidada de todos os seus clientes e pode atuar como admin em qualquer tenant que administra.",
    capabilities: [
      "Criar tenants para clientes",
      "Convidar admin do tenant",
      "Visão consolidada de status dos projetos",
      "Entrar em qualquer tenant como admin",
      "Relatórios de uso dos clientes",
    ],
    count: "N parceiros",
  },
  {
    level: "tenant",
    icon: Building2,
    title: "Admin de Tenant",
    subtitle: "Dono da empresa cliente",
    description: "Gerencia seu próprio workspace completo. Pode criar sub-tenants para filiais/multiEmpresa e convida usuários internos com diferentes roles.",
    capabilities: [
      "Acesso completo ao sistema",
      "Criar sub-tenants (filiais / multiEmpresa)",
      "Convidar e gerenciar equipe",
      "Configurações da empresa (logo, dados)",
      "Alternar entre empresas do grupo",
    ],
    count: "1 por empresa",
  },
  {
    level: "user",
    icon: User,
    title: "Usuário do Tenant",
    subtitle: "Gerente / Técnico",
    description: "Colaboradores internos da empresa cliente com acesso às ferramentas conforme seu papel — gerentes têm visão mais ampla, técnicos atuam em projetos específicos.",
    capabilities: [
      "Acesso a projetos designados",
      "Tarefas e backlog Scrum",
      "Suporte e base de conhecimento",
      "Portal do cliente",
      "Visibilidade conforme role",
    ],
    count: "N por tenant",
  },
];

const flowSteps = [
  { icon: Crown, label: "Arcádia", sub: "Superadmin", color: "bg-purple-500" },
  { icon: Handshake, label: "Parceiro", sub: "Cadastra cliente", color: "bg-blue-500" },
  { icon: Building2, label: "Tenant", sub: "Empresa cliente", color: "bg-emerald-500" },
  { icon: Building, label: "Sub-tenant", sub: "Filial / Empresa do grupo", color: "bg-teal-500" },
  { icon: User, label: "Usuário", sub: "Equipe da empresa", color: "bg-amber-500" },
];

const valueProps = [
  {
    icon: Network,
    title: "Mapa Estratégico Vivo",
    description: "Não é um manual — é um ambiente estratégico onde cada diagnóstico (Canvas, SWOT, Processos) se conecta em ações concretas via PDCA.",
  },
  {
    icon: Zap,
    title: "Automações e Implementações",
    description: "A plataforma mapeia as necessidades e guia a empresa até a implementação real: ERP, processos otimizados, projetos executados.",
  },
  {
    icon: Globe,
    title: "Ecossistema de Parceiros",
    description: "Consultores, contadores, advogados e especialistas atuam juntos no mesmo ambiente, cada um com sua visão, todos colaborando pela evolução do cliente.",
  },
  {
    icon: ShieldCheck,
    title: "Isolamento e Segurança",
    description: "Multi-tenancy garante que cada empresa veja apenas seus dados. Nenhum dado vaza entre tenants, com controle granular de acessos por role.",
  },
];

export default function SystemMap() {
  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Network className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Mapa do Sistema</h1>
              <p className="text-sm text-muted-foreground">Arcádia Consulting Platform — Visão geral da arquitetura e módulos</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {/* Proposta de Valor */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Proposta de Valor</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {valueProps.map((vp) => (
              <Card key={vp.title} className="border bg-card">
                <CardContent className="p-5">
                  <div className="p-2 rounded-lg bg-primary/10 w-fit mb-3">
                    <vp.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm mb-1">{vp.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{vp.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Hierarquia de Acesso */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Hierarquia de Acesso</h2>

          {/* Flow visual */}
          <div className="flex items-center gap-2 mb-6 p-4 rounded-xl bg-muted/40 border overflow-x-auto">
            {flowSteps.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2 flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-10 h-10 rounded-full ${step.color} flex items-center justify-center shadow-sm`}>
                    <step.icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-foreground whitespace-nowrap">{step.label}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{step.sub}</span>
                </div>
                {i < flowSteps.length - 1 && (
                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-[-12px]" />
                )}
              </div>
            ))}
          </div>

          {/* Level cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hierarchy.map((item) => {
              const colors = LEVEL_COLORS[item.level as keyof typeof LEVEL_COLORS];
              return (
                <Card key={item.level} className={`border-2 ${colors.border} ${colors.bg}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${colors.badge}`}>
                          <item.icon className={`h-5 w-5 ${colors.text}`} />
                        </div>
                        <div>
                          <CardTitle className="text-base text-foreground">{item.title}</CardTitle>
                          <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${colors.badge} border-0 whitespace-nowrap`}>
                        {item.count}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{item.description}</p>
                    <ul className="space-y-1">
                      {item.capabilities.map((cap) => (
                        <li key={cap} className="flex items-center gap-2 text-xs text-foreground">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.dot}`} />
                          {cap}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Módulos e Acesso por Papel */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Módulos da Plataforma</h2>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Unlock className="h-3 w-3 text-emerald-500" /> Total</span>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-amber-500" /> Parcial</span>
              <span className="flex items-center gap-1"><Lock className="h-3 w-3 text-red-400" /> Sem acesso</span>
            </div>
          </div>

          {/* Table header */}
          <div className="rounded-xl border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] bg-muted/50 border-b px-4 py-3 text-xs font-semibold text-muted-foreground gap-4">
              <span>Módulo</span>
              <span className="w-20 text-center text-purple-600 dark:text-purple-400">Superadmin</span>
              <span className="w-16 text-center text-blue-600 dark:text-blue-400">Parceiro</span>
              <span className="w-16 text-center text-emerald-600 dark:text-emerald-400">Tenant</span>
              <span className="w-16 text-center text-amber-600 dark:text-amber-400">Usuário</span>
            </div>
            {modules.map((mod, i) => {
              const AccessIcon = ({ level }: { level: string }) => {
                const a = ACCESS[level as keyof typeof ACCESS];
                return <a.icon className={`h-4 w-4 ${a.color} mx-auto`} />;
              };
              return (
                <div
                  key={mod.name}
                  className={`grid grid-cols-[1fr_auto_auto_auto_auto] px-4 py-3 gap-4 items-center text-sm border-b last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "bg-background" : "bg-muted/10"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded bg-muted">
                      <mod.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground text-sm">{mod.name}</div>
                      <div className="text-xs text-muted-foreground">{mod.description}</div>
                    </div>
                  </div>
                  <div className="w-20 text-center"><AccessIcon level={mod.superadmin} /></div>
                  <div className="w-16 text-center"><AccessIcon level={mod.partner} /></div>
                  <div className="w-16 text-center"><AccessIcon level={mod.tenant} /></div>
                  <div className="w-16 text-center"><AccessIcon level={mod.user} /></div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Fluxo CRM → Projeto */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Fluxo Principal: Lead → Projeto</h2>
          <div className="p-5 rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: "Lead", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
                null,
                { label: "Oportunidade", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
                null,
                { label: "Proposta", color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" },
                null,
                { label: "Aprovação", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
                null,
                { label: "Contrato", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
                null,
                { label: "Projeto", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
                null,
                { label: "Diagnóstico Canvas / SWOT / Processos", color: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
                null,
                { label: "Plano de Ação PDCA", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
                null,
                { label: "Implementação Scrum", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
              ].map((step, i) =>
                step === null ? (
                  <ChevronRight key={i} className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <span key={step.label} className={`px-3 py-1.5 rounded-full text-xs font-medium ${step.color}`}>
                    {step.label}
                  </span>
                )
              )}
            </div>
          </div>
        </section>

        {/* Roadmap Multi-tenant */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Roadmap: Evolução Multi-tenant</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                phase: "Fase 1 — Em andamento",
                status: "in_progress",
                items: [
                  "Schema multi-tenant (parceiros, tenants, tenant_users)",
                  "Middleware de isolamento por tenant_id",
                  "APIs de parceiros e tenants",
                  "Expansão do role enum (superadmin)",
                ],
              },
              {
                phase: "Fase 2 — Planejada",
                status: "planned",
                items: [
                  "Dashboard Superadmin (Arcádia)",
                  "Dashboard Parceiro com visão de clientes",
                  "Dashboard Tenant Admin",
                  "Sub-tenants (multiEmpresa/filiais)",
                  "Seletor de contexto e sidebar adaptativa",
                  "Fluxo de convite e onboarding",
                ],
              },
              {
                phase: "Fase 3 — Futura",
                status: "future",
                items: [
                  "Billing por tenant (assinaturas)",
                  "SSO por tenant (domínio customizado)",
                  "White-label para parceiros",
                  "App mobile",
                  "Automações via API/webhooks",
                  "Marketplace de templates de diagnóstico",
                ],
              },
            ].map((phase) => (
              <Card key={phase.phase} className={`border ${phase.status === "in_progress" ? "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" : phase.status === "planned" ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20" : "border-dashed"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${phase.status === "in_progress" ? "bg-blue-500 animate-pulse" : phase.status === "planned" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                    <CardTitle className="text-sm text-foreground">{phase.phase}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="space-y-1.5">
                    {phase.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <div className="w-1 h-1 rounded-full bg-muted-foreground/50 flex-shrink-0 mt-1.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Footer info */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          Arcádia Consulting Platform · Ambiente estratégico para consultoria, diagnóstico e implementação
        </div>
      </div>
    </div>
  );
}
