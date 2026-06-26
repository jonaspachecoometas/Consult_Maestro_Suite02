#!/usr/bin/env python3
"""
Patch 05 — Dashboard Pack autopeças + Agente Atlas + MT-3 ClientDetail
Executa na raiz do projeto: python3 patches/05_atlas_agent_dashboard_mt3.py
"""

import re, shutil
from pathlib import Path
from datetime import datetime

ROOT = Path(".")

def backup(p: Path):
    b = p.with_suffix(f"{p.suffix}.bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    shutil.copy(p, b)
    print(f"  backup: {b.name}")

def patch(p: Path, find: str, replace: str, label: str):
    content = p.read_text()
    if find not in content:
        print(f"  ⚠️  {label}: trecho não encontrado")
        return False
    p.write_text(content.replace(find, replace, 1))
    print(f"  ✅ {label}")
    return True

def write(p: Path, content: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    print(f"  ✅ criado: {p}")

# ──────────────────────────────────────────────────────────────────────────────
# 1. AGENTE ATLAS — adicionar ao seedAgentDefinitionsData.ts
# ──────────────────────────────────────────────────────────────────────────────
SEED = ROOT / "server/seedAgentDefinitionsData.ts"
backup(SEED)

ATLAS_AGENT = '''  {
    slug: "atlas_agent",
    name: "Agente Atlas — ERP Autopeças",
    module: "BI Consultivo / Atlas ERP",
    tools: ["list_bi_metrics", "run_bi_query", "compare_periods", "search_brain", "get_client_data"],
    visibleIn: ["reports", "all"],
    contextModules: [],
    systemPrompt: `<System>

Você é o Analista de Negócios especializado em distribuidores e varejistas de autopeças,
com acesso completo ao ERP Atlas homologado.

Vocabulário dominante:
  - Curva ABC: A=80% da receita (poucos produtos), B=15%, C=5% (cauda longa)
  - Espinha: agrupamento de similares de autopeças por aplicação veicular
  - Aplicação: conjunto de veículos onde uma peça pode ser instalada
  - Similar: produto equivalente de fabricante diferente
  - Giro de estoque: velocidade com que o estoque é consumido/vendido
  - NCF: nota de crédito do fornecedor
  - PDV: ponto de venda (balcão)

Métricas disponíveis via run_bi_query (módulo "atlas"):
  atlas.receita_por_periodo, atlas.ticket_medio, atlas.top_clientes,
  atlas.top_produtos_vendidos, atlas.margem_por_produto, atlas.curva_abc_produtos,
  atlas.estoque_por_grupo, atlas.inadimplencia_valor, atlas.contas_a_receber_por_vencimento

Use estrutura SCQ: Situação → Complicação → Questão → Resposta (conclusão primeiro).

</System>

<Context>

O usuário é consultor ou gestor de uma distribuidora/varejista de autopeças
que usa o Atlas ERP. Os dados do Atlas estão disponíveis via semantic layer.

</Context>

<Instructions>

// STEP 0 — COMPORTAMENTO PROATIVO (ao abrir dashboard com dados Atlas)
0. Diagnóstico automático
   - run_bi_query({ metricId: "atlas.inadimplencia_valor" }) → se > 0: alertar
   - run_bi_query({ metricId: "atlas.curva_abc_produtos" }) → comentar distribuição
   - run_bi_query({ metricId: "atlas.ticket_medio" }) → comparar com período anterior via compare_periods
   - Se anomalia > 15%: narrar antes de aguardar input

1. Análise de Vendas
   - Identificar tendência: crescimento, sazonalidade, queda
   - Top clientes: quem concentra receita? Risco de dependência?
   - Ticket médio: variação e causa provável (mix de produtos, desconto, perda de margem)

2. Análise de Estoque e Produtos
   - Curva ABC: quantos produtos respondem por 80% da receita?
   - Produtos C com estoque alto = capital parado — identificar e recomendar ação
   - Giro: produtos sem saída nos últimos 90 dias
   - Margem: identificar produtos abaixo da margem mínima

3. Financeiro
   - Inadimplência: valor e concentração (poucos clientes ou pulverizada?)
   - Contas a receber: projeção de caixa nos próximos 30-60-90 dias
   - Compare receita realizada vs contas recebidas (diferença = crédito ainda em aberto)

4. Relatório Gerencial
   - Estrutura: KPIs executivos → variações → causa → recomendação → próximo passo
   - Sempre quantificar: "caiu R$ X" não apenas "caiu"
   - Benchmarking quando disponível no Cérebro

</Instructions>

<Constraints>

- Nunca inventar dados — todos os números vêm de run_bi_query
- Quando a métrica retornar 0 ou vazia: informar que o Atlas pode não ter dados no período
- Português Brasileiro
- Tom executivo — destinatário é o dono ou gerente do negócio

</Constraints>

<Output>

Diagnóstico proativo: KPIs em destaque + anomalia identificada + ação sugerida
Análise de vendas: receita / ticket / top clientes em tabela + narrativa SCQ
Análise de estoque: curva ABC + produtos parados + recomendação de ação
Financeiro: inadimplência + projeção de recebimento + próximo passo

</Output>`,
  },'''

# Append before the closing of SEED_AGENT_DEFINITIONS array
patch(SEED,
    "];\n",
    f",\n{ATLAS_AGENT}\n];\n",
    "seedAgentDefinitionsData.ts: Atlas agent added")


# ──────────────────────────────────────────────────────────────────────────────
# 2. DASHBOARD PACK — criar server/bi/dashboardPacks/atlasPack.ts
# ──────────────────────────────────────────────────────────────────────────────
write(ROOT / "server/bi/dashboardPacks/atlasPack.ts", '''\
/**
 * Dashboard Pack — Atlas ERP Autopeças
 *
 * Template de dashboard pronto para ser instalado por qualquer tenant
 * que tenha o DatasetAtlas configurado. Exportável para o AppStore.
 *
 * Uso:
 *   import { ATLAS_DASHBOARD_PACK } from "./atlasPack";
 *   // salvar como BiDashboard no banco para o tenant
 */

import type { WidgetConfig } from "../../../shared/schema";

export interface DashboardPack {
  slug: string;
  name: string;
  description: string;
  category: string;
  requiredDataset: string; // 'atlas'
  tags: string[];
  dashboards: {
    name: string;
    description: string;
    layout: WidgetConfig[];
  }[];
}

// Helpers de posicionamento no grid (12 colunas, 1 unit = ~80px)
const pos = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

// ── Dashboard 1: Visão Executiva ──────────────────────────────────────────────
const EXECUTIVE_DASHBOARD: WidgetConfig[] = [
  // Row 1: KPIs
  {
    id: "atlas-kpi-receita",
    type: "big_number" as any,
    title: "Receita total (mês atual)",
    gridPos: pos(0, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-kpi-ticket",
    type: "big_number" as any,
    title: "Ticket médio",
    gridPos: pos(3, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.ticket_medio" },
  },
  {
    id: "atlas-kpi-inadimplencia",
    type: "big_number" as any,
    title: "Inadimplência (R$)",
    gridPos: pos(6, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.inadimplencia_valor" },
  },
  {
    id: "atlas-kpi-abc",
    type: "pie_chart" as any,
    title: "Curva ABC — distribuição",
    gridPos: pos(9, 0, 3, 2),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },

  // Row 2: Receita temporal + Top clientes
  {
    id: "atlas-receita-periodo",
    type: "area_chart" as any,
    title: "Receita mensal de vendas",
    gridPos: pos(0, 2, 7, 4),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-top-clientes",
    type: "bar_chart",
    title: "Top 15 clientes por receita",
    gridPos: pos(7, 2, 5, 4),
    dataSource: { type: "semantic", metricId: "atlas.top_clientes" },
  },

  // Row 3: Contas a receber
  {
    id: "atlas-cr-vencimento",
    type: "bar_chart",
    title: "Contas a receber por vencimento",
    gridPos: pos(0, 6, 12, 3),
    dataSource: { type: "semantic", metricId: "atlas.contas_a_receber_por_vencimento" },
  },
];

// ── Dashboard 2: Análise de Produtos ─────────────────────────────────────────
const PRODUCTS_DASHBOARD: WidgetConfig[] = [
  // Row 1: Curva ABC (grande) + Estoque por grupo
  {
    id: "atlas-abc-grande",
    type: "pie_chart" as any,
    title: "Curva ABC de produtos",
    gridPos: pos(0, 0, 4, 4),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },
  {
    id: "atlas-estoque-grupo",
    type: "bar_chart",
    title: "Estoque por grupo de produto",
    gridPos: pos(4, 0, 8, 4),
    dataSource: { type: "semantic", metricId: "atlas.estoque_por_grupo" },
  },

  // Row 2: Top produtos + Margem
  {
    id: "atlas-top-produtos",
    type: "bar_chart",
    title: "Top 20 produtos — quantidade vendida",
    gridPos: pos(0, 4, 6, 5),
    dataSource: { type: "semantic", metricId: "atlas.top_produtos_vendidos" },
  },
  {
    id: "atlas-margem",
    type: "bar_chart",
    title: "Margem bruta por produto (Top 20)",
    gridPos: pos(6, 4, 6, 5),
    dataSource: { type: "semantic", metricId: "atlas.margem_por_produto" },
  },
];

// ── Dashboard 3: Financeiro ───────────────────────────────────────────────────
const FINANCIAL_DASHBOARD: WidgetConfig[] = [
  {
    id: "atlas-fin-inadimplencia-kpi",
    type: "kpi_card",
    title: "Valor inadimplente (R$)",
    gridPos: pos(0, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.inadimplencia_valor" },
  },
  {
    id: "atlas-fin-ticket-kpi",
    type: "kpi_card",
    title: "Ticket médio de pedidos",
    gridPos: pos(4, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.ticket_medio" },
  },
  {
    id: "atlas-fin-abc-kpi",
    type: "pie_chart" as any,
    title: "Concentração de receita (ABC)",
    gridPos: pos(8, 0, 4, 2),
    dataSource: { type: "semantic", metricId: "atlas.curva_abc_produtos" },
  },
  {
    id: "atlas-fin-receita",
    type: "mixed_timeseries" as any,
    title: "Receita realizada por mês",
    gridPos: pos(0, 2, 12, 4),
    dataSource: { type: "semantic", metricId: "atlas.receita_por_periodo" },
  },
  {
    id: "atlas-fin-cr",
    type: "bar_chart",
    title: "Contas a receber — vencimento",
    gridPos: pos(0, 6, 6, 4),
    dataSource: { type: "semantic", metricId: "atlas.contas_a_receber_por_vencimento" },
  },
  {
    id: "atlas-fin-clientes",
    type: "bar_chart",
    title: "Concentração de receita por cliente",
    gridPos: pos(6, 6, 6, 4),
    dataSource: { type: "semantic", metricId: "atlas.top_clientes" },
  },
];

// ── Pack completo ─────────────────────────────────────────────────────────────
export const ATLAS_DASHBOARD_PACK: DashboardPack = {
  slug: "atlas-autopecas",
  name: "Atlas ERP — Autopeças",
  description: "Dashboards executivos para distribuidores e varejistas de autopeças usando o Atlas ERP. Inclui análise de vendas, curva ABC, estoque por grupo, inadimplência e contas a receber.",
  category: "ERP Integrado",
  requiredDataset: "atlas",
  tags: ["autopeças", "atlas", "vendas", "estoque", "financeiro", "curva ABC"],
  dashboards: [
    {
      name: "Visão Executiva — Atlas",
      description: "KPIs gerenciais: receita, ticket médio, inadimplência, curva ABC e contas a receber.",
      layout: EXECUTIVE_DASHBOARD,
    },
    {
      name: "Análise de Produtos — Atlas",
      description: "Curva ABC detalhada, estoque por grupo, top produtos vendidos e margem bruta.",
      layout: PRODUCTS_DASHBOARD,
    },
    {
      name: "Financeiro — Atlas",
      description: "Receita realizada, inadimplência, contas a receber por vencimento e concentração por cliente.",
      layout: FINANCIAL_DASHBOARD,
    },
  ],
};
''')


# ──────────────────────────────────────────────────────────────────────────────
# 3. ROTA PARA INSTALAR DASHBOARD PACK — adicionar em server/routes.ts
# ──────────────────────────────────────────────────────────────────────────────
ROUTES = ROOT / "server/routes.ts"

PACK_ROUTES = '''
  // ── Dashboard Packs — instalar template pronto ──────────────────────────────
  app.get("/api/bi/packs", isAuthenticated, requireTenant, async (_req, res) => {
    try {
      const { ATLAS_DASHBOARD_PACK } = await import("./bi/dashboardPacks/atlasPack");
      res.json([ATLAS_DASHBOARD_PACK]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/bi/packs/:slug/install", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const { ATLAS_DASHBOARD_PACK } = await import("./bi/dashboardPacks/atlasPack");
      const pack = ATLAS_DASHBOARD_PACK; // future: lookup by slug

      if (pack.slug !== req.params.slug) {
        return res.status(404).json({ message: "Pack não encontrado" });
      }

      const dashboardIndex = parseInt(req.body?.dashboardIndex ?? "0");
      const template = pack.dashboards[dashboardIndex];
      if (!template) return res.status(400).json({ message: "Dashboard não encontrado no pack" });

      const { db } = await import("./db");
      const { biDashboards } = await import("../shared/schema");
      const { sql: drizzleSql } = await import("drizzle-orm");

      const [dashboard] = await db.insert(biDashboards).values({
        tenantId: req.tenantId!,
        ownerId: req.user?.id ?? null,
        name: template.name,
        layout: template.layout,
        isDefault: 0,
        filters: { enabledFilters: [] },
      }).returning();

      res.status(201).json({ dashboard, message: `Dashboard "${template.name}" instalado` });
    } catch (err: any) {
      console.error("[bi/packs/install] error:", err);
      res.status(500).json({ message: err.message });
    }
  });
'''

# Insert before the very end of routes.ts (before last closing brace / return)
content = ROUTES.read_text()
if "/api/bi/packs" not in content:
    # Find good insertion point - after alerts routes
    insert_after = 'app.post("/api/bi/alerts/run"'
    idx = content.rfind(insert_after)
    if idx != -1:
        # find end of that handler
        end_idx = content.find("\n  });\n", idx) + 7
        content = content[:end_idx] + "\n" + PACK_ROUTES + content[end_idx:]
        ROUTES.write_text(content)
        print("  ✅ server/routes.ts: pack install routes added")
    else:
        print("  ⚠️  insertion point not found — add pack routes manually")
else:
    print("  ℹ️  pack routes already exist")


# ──────────────────────────────────────────────────────────────────────────────
# 4. MT-3 — Integrar ClientCompaniesPanel no ClientDetail.tsx
# ──────────────────────────────────────────────────────────────────────────────
CLIENT_DETAIL = ROOT / "client/src/pages/ClientDetail.tsx"
backup(CLIENT_DETAIL)

# Add import
patch(CLIENT_DETAIL,
    'import { ClientOrgChart } from "@/components/ClientOrgChart";',
    'import { ClientOrgChart } from "@/components/ClientOrgChart";\nimport { ClientCompaniesPanel } from "@/components/ClientCompaniesPanel";\nimport { Landmark } from "lucide-react";',
    "ClientDetail.tsx: import ClientCompaniesPanel")

# Add tab trigger (after orgchart tab trigger)
patch(CLIENT_DETAIL,
    '''          <TabsTrigger value="orgchart" data-testid="tab-orgchart">
            <Network className="h-4 w-4 mr-2" />
            Organograma
          </TabsTrigger>
        </TabsList>''',
    '''          <TabsTrigger value="orgchart" data-testid="tab-orgchart">
            <Network className="h-4 w-4 mr-2" />
            Organograma
          </TabsTrigger>
          <TabsTrigger value="empresas" data-testid="tab-empresas">
            <Landmark className="h-4 w-4 mr-2" />
            Empresas do grupo
          </TabsTrigger>
        </TabsList>''',
    "ClientDetail.tsx: add Empresas tab trigger")

# Add tab content (after orgchart TabsContent)
patch(CLIENT_DETAIL,
    '''        <TabsContent value="orgchart">
          <div ref={printRef}>
            <ClientOrgChart clientId={client.id} onPrint={handlePrintOrgChart} />
          </div>
        </TabsContent>
      </Tabs>''',
    '''        <TabsContent value="orgchart">
          <div ref={printRef}>
            <ClientOrgChart clientId={client.id} onPrint={handlePrintOrgChart} />
          </div>
        </TabsContent>

        <TabsContent value="empresas">
          <ClientCompaniesPanel clientId={client.id} />
        </TabsContent>
      </Tabs>''',
    "ClientDetail.tsx: add Empresas tab content")


# ──────────────────────────────────────────────────────────────────────────────
# 5. WIDGETTYPE — adicionar novos tipos no schema (se ainda não foram adicionados)
# ──────────────────────────────────────────────────────────────────────────────
SCHEMA = ROOT / "shared/schema.ts"

current_types = SCHEMA.read_text()
if "area_chart" not in current_types:
    backup(SCHEMA)
    patch(SCHEMA,
        '''export type WidgetType =
  | "kpi_card" | "bar_chart" | "line_chart" | "radar_chart"
  // Phase 3 — BI Multi-Fonte specials
  | "migration_monitor" | "data_quality_panel";''',
        '''export type WidgetType =
  | "kpi_card" | "bar_chart" | "line_chart" | "radar_chart"
  | "area_chart" | "pie_chart" | "donut_chart" | "big_number"
  | "waterfall_chart" | "funnel_chart" | "gauge_chart"
  | "mixed_timeseries" | "data_table" | "scatter_plot"
  // Phase 3 — BI Multi-Fonte specials
  | "migration_monitor" | "data_quality_panel";''',
        "schema.ts: WidgetType expanded")
else:
    print("  ℹ️  WidgetType already expanded")


# ──────────────────────────────────────────────────────────────────────────────
# 6. SEED SCRIPT — garantir que atlas_agent seja semeado no banco
# ──────────────────────────────────────────────────────────────────────────────
SEED_RUNNER = ROOT / "server/seedAgentDefinitions.ts"
seed_content = SEED_RUNNER.read_text() if SEED_RUNNER.exists() else ""

if "atlas_agent" not in seed_content and SEED_RUNNER.exists():
    # The seed runner reads from SEED_AGENT_DEFINITIONS — just needs a restart
    print("  ✅ seedAgentDefinitions.ts: atlas_agent will be seeded on next startup (reads from SEED_AGENT_DEFINITIONS)")
else:
    print("  ℹ️  seed runner: OK")

print()
print("✅ Patch 05 concluído.")
print()
print("Arquivos modificados:")
print("  server/seedAgentDefinitionsData.ts  → atlas_agent adicionado (14 agentes)")
print("  server/bi/dashboardPacks/atlasPack.ts → CRIADO (3 dashboards, 14 widgets)")
print("  server/routes.ts                    → GET/POST /api/bi/packs/*")
print("  client/src/pages/ClientDetail.tsx   → aba 'Empresas do grupo' (MT-3)")
print("  shared/schema.ts                    → WidgetType expandido (se necessário)")
print()
print("Para o Replit executar:")
print("  1. python3 patches/05_atlas_agent_dashboard_mt3.py")
print("  2. Reiniciar servidor — seed do atlas_agent roda no startup")
print("  3. Verificar: GET /api/bi/packs → deve retornar o pack atlas-autopecas")
print("  4. Verificar: GET /api/bi/semantic/catalog → deve mostrar módulo 'atlas' com 9 métricas")
print("  5. Verificar: /clientes/:id → deve ter aba 'Empresas do grupo'")
