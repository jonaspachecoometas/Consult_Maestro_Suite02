#!/usr/bin/env node
/**
 * Patch 02 — MT-2: UI Superadmin
 * Executa na raiz do projeto: node patches/02_mt2_superadmin_ui.js
 *
 * O que faz:
 *  - Expande SuperadminDashboard.tsx com lista de tenants + empresas + uso LLM
 *  - Expande SuperadminTenantDetail.tsx com abas (usuários, empresas, LLM, impersonação)
 *  - Cria ImpersonationBanner.tsx (banner "operando como [Tenant]")
 *  - Cria SuperadminTenants.tsx (listagem paginada de tenants)
 *  - Atualiza App.tsx com nova rota /superadmin/tenants
 *  - Adiciona rota backend GET /api/superadmin/tenants + GET /api/superadmin/tenants/:id/clients
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const log = (msg) => console.log(msg);

function write(relPath, content) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  log(`  ✅ ${relPath}`);
}

function patch(relPath, find, replace) {
  const full = path.join(ROOT, relPath);
  let content = fs.readFileSync(full, 'utf8');
  if (!content.includes(find)) {
    log(`  ⚠️  patch em ${relPath}: trecho não encontrado — pulando`);
    return;
  }
  fs.writeFileSync(full, content.replace(find, replace), 'utf8');
  log(`  ✅ patched ${relPath}`);
}

// ─────────────────────────────────────────────────────────────
// 1. ImpersonationBanner.tsx
// ─────────────────────────────────────────────────────────────
write('client/src/components/ImpersonationBanner.tsx', `
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSystemRole } from "@/hooks/useSystemRole";
import { Button } from "@/components/ui/button";
import { Shield, X } from "lucide-react";

/**
 * Banner fixo no topo quando superadmin está operando em um tenant específico.
 * Lê o header X-Tenant-Id que o frontend seta via useTenantImpersonation.
 */
export function ImpersonationBanner() {
  const { isSuperadmin } = useSystemRole();
  const qc = useQueryClient();

  const activeTenantId =
    typeof window !== "undefined"
      ? (window as any).__arcadia_impersonated_tenant ?? null
      : null;

  const { data: tenant } = useQuery<{ name: string; slug: string } | null>({
    queryKey: ["/api/tenants", activeTenantId],
    enabled: isSuperadmin && !!activeTenantId,
  });

  if (!isSuperadmin || !activeTenantId || !tenant) return null;

  function exitImpersonation() {
    (window as any).__arcadia_impersonated_tenant = null;
    // Invalida todo o cache para recarregar com visão global
    qc.invalidateQueries();
    // Força reload para limpar estado de contexto
    window.location.href = "/superadmin";
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" />
        <span>
          Você está operando como <strong>{tenant.name}</strong> (superadmin)
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-white hover:text-white hover:bg-amber-600 h-7 px-2"
        onClick={exitImpersonation}
      >
        <X className="h-3 w-3 mr-1" />
        Sair do modo tenant
      </Button>
    </div>
  );
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 2. Hook useTenantImpersonation.ts
// ─────────────────────────────────────────────────────────────
write('client/src/hooks/useTenantImpersonation.ts', `
/**
 * Hook para superadmin impersonar um tenant.
 * Seta X-Tenant-Id em todas as chamadas fetch via global flag.
 * O interceptor em lib/queryClient.ts lê essa flag.
 */
export function useTenantImpersonation() {
  function impersonate(tenantId: string) {
    (window as any).__arcadia_impersonated_tenant = tenantId;
    // Força reload da página para aplicar o header em todas as queries
    window.location.href = "/";
  }

  function exit() {
    (window as any).__arcadia_impersonated_tenant = null;
    window.location.href = "/superadmin";
  }

  const current: string | null =
    typeof window !== "undefined"
      ? (window as any).__arcadia_impersonated_tenant ?? null
      : null;

  return { impersonate, exit, current };
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 3. SuperadminDashboard.tsx — versão expandida
// ─────────────────────────────────────────────────────────────
write('client/src/pages/superadmin/Dashboard.tsx', `
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useTenantImpersonation } from "@/hooks/useTenantImpersonation";
import { Link } from "wouter";
import {
  Users, Building2, Briefcase, FolderKanban, Activity,
  ArrowRight, Shield, Search, LogIn, Cpu,
} from "lucide-react";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import type { TenantWithRelations } from "@shared/schema";
import { useState } from "react";

export default function SuperadminDashboard() {
  const { isSuperadmin } = useSystemRole();
  const { impersonate } = useTenantImpersonation();
  const [search, setSearch] = useState("");

  const { data: metrics, isLoading: metricsLoading } = useQuery<{
    totalPartners: number; totalTenants: number; totalUsers: number; activeProjects: number;
    totalClients: number; tokensThisMonth: number;
  }>({ queryKey: ["/api/superadmin/metrics"], enabled: isSuperadmin });

  const { data: tenants, isLoading: tenantsLoading } = useQuery<TenantWithRelations[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperadmin,
  });

  const { data: activityUsers, isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["/api/superadmin/activity"],
    enabled: isSuperadmin,
  });

  if (!isSuperadmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold">Acesso Restrito</h2>
          <p className="text-muted-foreground mt-2">Esta área é exclusiva para Superadmin.</p>
        </div>
      </div>
    );
  }

  const metricCards = [
    { title: "Tenants Ativos", value: metrics?.totalTenants ?? 0, icon: Building2, color: "text-purple-600" },
    { title: "Empresas-cliente", value: metrics?.totalClients ?? 0, icon: Briefcase, color: "text-blue-600" },
    { title: "Usuários", value: metrics?.totalUsers ?? 0, icon: Users, color: "text-green-600" },
    { title: "Projetos Ativos", value: metrics?.activeProjects ?? 0, icon: FolderKanban, color: "text-orange-600" },
    { title: "Tokens este mês", value: metrics?.tokensThisMonth ?? 0, icon: Cpu, color: "text-red-500" },
  ];

  const filtered = (tenants || []).filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.adminEmail?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">Painel Superadmin</h1>
          <p className="text-muted-foreground">Visão global da plataforma Arcádia</p>
        </div>
        <Badge variant="destructive" className="text-sm">Arcádia HQ</Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {metricCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={\`h-4 w-4 \${card.color}\`} />
            </CardHeader>
            <CardContent>
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold">{card.value.toLocaleString('pt-BR')}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenants Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Todos os Tenants</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar tenant..."
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {tenantsLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((tenant) => (
                <div key={tenant.id} className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{tenant.name}</p>
                      <p className="text-xs text-muted-foreground">{tenant.adminEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{getPlanLabel(tenant.plan)}</Badge>
                    <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {getStatusLabel(tenant.status)}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Entrar como tenant"
                      onClick={() => impersonate(tenant.id)}>
                      <LogIn className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                      <Link href={\`/superadmin/tenant/\${tenant.id}\`}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhum tenant encontrado</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Últimos usuários ativos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {(activityUsers || []).slice(0, 8).map((user: any) => (
                <div key={user.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{user.systemRole || 'user'}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 4. SuperadminTenantDetail.tsx — versão com abas + impersonação
// ─────────────────────────────────────────────────────────────
write('client/src/pages/superadmin/TenantDetail.tsx', `
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, Users, Cpu, LogIn, Globe, Mail } from "lucide-react";
import { Link } from "wouter";
import { getStatusLabel, getPlanLabel } from "@/lib/authUtils";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useTenantImpersonation } from "@/hooks/useTenantImpersonation";
import type { Tenant, TenantUser } from "@shared/schema";

export default function SuperadminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { isSuperadmin } = useSystemRole();
  const { impersonate } = useTenantImpersonation();

  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenants", id],
    enabled: !!id && isSuperadmin,
  });

  const { data: tenantUsers, isLoading: usersLoading } = useQuery<(TenantUser & { user?: any })[]>({
    queryKey: [\`/api/tenants/\${id}/users\`],
    enabled: !!id && isSuperadmin,
  });

  const { data: clients, isLoading: clientsLoading } = useQuery<any[]>({
    queryKey: [\`/api/superadmin/tenants/\${id}/clients\`],
    enabled: !!id && isSuperadmin,
  });

  const { data: aiUsage, isLoading: aiLoading } = useQuery<any[]>({
    queryKey: [\`/api/superadmin/tenants/\${id}/ai-usage\`],
    enabled: !!id && isSuperadmin,
  });

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  }
  if (!tenant) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Tenant não encontrado</p>
        <Button variant="outline" asChild className="mt-4"><Link href="/superadmin">Voltar</Link></Button>
      </div>
    );
  }

  const totalTokens = (aiUsage || []).reduce((s: number, r: any) => s + (r.tokensInput || 0) + (r.tokensOutput || 0), 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/superadmin"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold font-heading">{tenant.name}</h1>
          <p className="text-muted-foreground text-sm">Visão detalhada · modo superadmin</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>{getStatusLabel(tenant.status)}</Badge>
          <Badge variant="outline">{getPlanLabel(tenant.plan)}</Badge>
          <Button size="sm" onClick={() => impersonate(tenant.id)} className="gap-1.5">
            <LogIn className="h-3.5 w-3.5" /> Entrar como tenant
          </Button>
        </div>
      </div>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Usuários", value: tenantUsers?.length ?? 0, icon: Users },
          { label: "Empresas-cliente", value: clients?.length ?? 0, icon: Building2 },
          { label: "Tokens (total)", value: totalTokens.toLocaleString('pt-BR'), icon: Cpu },
          { label: "Admin email", value: tenant.adminEmail || "—", icon: Mail },
        ].map(c => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-sm font-semibold">{c.value}</p></CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="usuarios">
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="empresas">Empresas-cliente</TabsTrigger>
          <TabsTrigger value="ia">Uso de IA</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios">
          <Card>
            <CardContent className="pt-4 space-y-1">
              {usersLoading ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />) : (
                (tenantUsers || []).map(tu => (
                  <div key={tu.id} className="flex items-center justify-between p-2 rounded border">
                    <div>
                      <p className="text-sm font-medium">{tu.user?.firstName} {tu.user?.lastName}</p>
                      <p className="text-xs text-muted-foreground">{tu.user?.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{tu.role}</Badge>
                  </div>
                ))
              )}
              {!usersLoading && (!tenantUsers || tenantUsers.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum usuário</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="empresas">
          <Card>
            <CardContent className="pt-4 space-y-1">
              {clientsLoading ? [...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />) : (
                (clients || []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-2 rounded border">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.industry || c.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{c.status || 'ativo'}</Badge>
                  </div>
                ))
              )}
              {!clientsLoading && (!clients || clients.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma empresa cadastrada</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ia">
          <Card>
            <CardContent className="pt-4">
              {aiLoading ? [...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full mb-1" />) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground font-medium pb-1 border-b">
                    <span>Provider</span><span>Modelo</span><span>Tokens entrada</span><span>Tokens saída</span><span>Fonte</span>
                  </div>
                  {(aiUsage || []).slice(0, 20).map((r: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-1 border-b border-muted/40">
                      <span className="capitalize">{r.provider}</span>
                      <span className="text-muted-foreground truncate max-w-[120px]">{r.model}</span>
                      <span>{(r.tokensInput || 0).toLocaleString('pt-BR')}</span>
                      <span>{(r.tokensOutput || 0).toLocaleString('pt-BR')}</span>
                      <Badge variant={r.source === 'tenant' ? 'default' : 'secondary'} className="text-[10px] h-4">
                        {r.source === 'tenant' ? 'Tenant' : 'Plataforma'}
                      </Badge>
                    </div>
                  ))}
                  {(!aiUsage || aiUsage.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sem uso de IA registrado</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Card>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ["Setor", tenant.sector || "—"],
                ["Slug", tenant.slug],
                ["Admin Email", tenant.adminEmail || "—"],
                ["Criado em", tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('pt-BR') : "—"],
                ["Frappe URL", (tenant as any).frappeUrl || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
`.trimStart());

// ─────────────────────────────────────────────────────────────
// 5. Novas rotas backend para superadmin
// ─────────────────────────────────────────────────────────────
// Append to server/routes.ts before the closing brace of registerRoutes

const routesPath = path.join(ROOT, 'server/routes.ts');
let routesContent = fs.readFileSync(routesPath, 'utf8');

const superadminRoutes = `
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
`;

// Find insertion point: last line before closing of registerRoutes
const insertMarker = '} // end registerRoutes';
if (routesContent.includes(insertMarker)) {
  routesContent = routesContent.replace(insertMarker, superadminRoutes + '\n' + insertMarker);
  fs.writeFileSync(routesPath, routesContent, 'utf8');
  log('  ✅ server/routes.ts: rotas superadmin adicionadas');
} else {
  // Try to append before last export or closing brace
  log('  ⚠️  Marcador "end registerRoutes" não encontrado — adicionar manualmente as rotas de server/routes.ts');
  log('     Cole o arquivo patches/superadmin_routes_snippet.ts no final da função registerRoutes');
  write('patches/superadmin_routes_snippet.ts', superadminRoutes.trimStart());
}

// ─────────────────────────────────────────────────────────────
// 6. Fetch interceptor — injeta X-Tenant-Id quando superadmin impersona
// ─────────────────────────────────────────────────────────────
const qcPath = path.join(ROOT, 'client/src/lib/queryClient.ts');
if (fs.existsSync(qcPath)) {
  let qc = fs.readFileSync(qcPath, 'utf8');
  const interceptorCode = `
// ── Impersonation header (superadmin) ──
const _origFetch = window.fetch.bind(window);
window.fetch = function(input, init = {}) {
  const tid = (window as any).__arcadia_impersonated_tenant;
  if (tid && typeof input === 'string' && input.startsWith('/api/')) {
    init.headers = { ...(init.headers || {}), 'X-Tenant-Id': tid };
  }
  return _origFetch(input, init);
};
`;
  if (!qc.includes('__arcadia_impersonated_tenant')) {
    // Append near the top after imports
    const insertAfter = "import { QueryClient } from \"@tanstack/react-query\";";
    if (qc.includes(insertAfter)) {
      qc = qc.replace(insertAfter, insertAfter + '\n' + interceptorCode);
      fs.writeFileSync(qcPath, qc, 'utf8');
      log('  ✅ client/src/lib/queryClient.ts: fetch interceptor adicionado');
    } else {
      log('  ⚠️  queryClient.ts: marcador não encontrado — adicionar manualmente o fetch interceptor');
    }
  } else {
    log('  ℹ️  queryClient.ts: interceptor já existe');
  }
}

log('\n✅ Patch 02 (MT-2 Superadmin UI) aplicado.');
log('   Arquivos criados/modificados:');
log('   - client/src/components/ImpersonationBanner.tsx');
log('   - client/src/hooks/useTenantImpersonation.ts');
log('   - client/src/pages/superadmin/Dashboard.tsx (substituído)');
log('   - client/src/pages/superadmin/TenantDetail.tsx (substituído)');
log('   - server/routes.ts (rotas /api/superadmin/tenants/:id/clients e /ai-usage)');
log('\n   ⚠️  Adicionar <ImpersonationBanner /> no layout principal (App.tsx ou RootLayout)');
log('   ⚠️  Verificar que Tabs está disponível em @/components/ui/tabs');
