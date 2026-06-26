/**
 * MCP Hub — Core tools registration (Sprint 1)
 *
 * Registers the 5 tools previously hardcoded in `superAgentService.TOOL_DEFS`:
 *   - list_projects
 *   - list_clients
 *   - get_project_detail
 *   - read_frappe_doc
 *   - search_brain
 *
 * After Sprint 1, the Super Agent enumerates and executes tools via the
 * registry instead of the local switch/case. Sprint 2+ will register
 * additional module-specific tools (Control, Societário, Recovery, …).
 *
 * Idempotent: safe to call multiple times — registry overwrites duplicates
 * and warns to stdout. Boot order: called from server/index.ts after
 * seedAgentDefinitions and before registerRoutes.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { projects, clients } from "@shared/schema";
import { toolRegistry } from "./toolRegistry";
import { getFrappeClientForTenant, getFrappeStatus } from "../frappeClient";

let coreRegistered = false;

export function registerCoreTools(): void {
  if (coreRegistered) {
    console.log("[mcp] core tools already registered, skipping");
    return;
  }

  // ── list_projects ─────────────────────────────────────────
  toolRegistry.register({
    name: "list_projects",
    module: "core",
    requiresConfirmation: false,
    description:
      "Lista demandas (type=compass) e projetos externos (type=external) do tenant atual. Use quando o usuário perguntar sobre projetos, demandas, status, prazos, ou pedir resumo do que está em andamento.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["compass", "external", "all"], description: "Filtra por tipo. 'compass' = demandas do Canvas, 'external' = projetos Scrum, 'all' = tudo. Default: 'all'." },
        status: { type: "string", description: "Filtra por status (backlog, diagnostico, proposta_enviada, aprovada, andamento, revisao, entregue, concluido). Opcional." },
        limit: { type: "number", description: "Máx 50. Default 20." },
      },
    },
    handler: async (input, ctx) => {
      const limit = Math.min(Number(input?.limit) || 20, 50);
      const conds: any[] = [eq(projects.tenantId, ctx.tenantId)];
      if (input?.type && input.type !== "all") conds.push(eq(projects.type, input.type));
      if (input?.status) conds.push(eq(projects.status, input.status));
      const rows = await db
        .select({
          id: projects.id,
          name: projects.name,
          type: projects.type,
          status: projects.status,
          clientId: projects.clientId,
          startDate: projects.startDate,
          dueDate: projects.dueDate,
        })
        .from(projects)
        .where(and(...conds))
        .limit(limit);
      return { count: rows.length, projects: rows };
    },
  });

  // ── list_clients ──────────────────────────────────────────
  toolRegistry.register({
    name: "list_clients",
    module: "core",
    requiresConfirmation: false,
    description:
      "Lista clientes do tenant atual com nome, setor e status. Use quando perguntarem sobre clientes, carteira, ou pedirem resumo de um cliente específico.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filtro de busca textual no nome (opcional)." },
        limit: { type: "number", description: "Máx 50. Default 20." },
      },
    },
    handler: async (input, ctx) => {
      const limit = Math.min(Number(input?.limit) || 20, 50);
      const rows = await db
        .select({
          id: clients.id,
          name: clients.name,
          company: clients.company,
          industry: clients.industry,
          email: clients.email,
        })
        .from(clients)
        .where(eq(clients.tenantId, ctx.tenantId))
        .limit(limit);
      const filtered = input?.search
        ? rows.filter((r: any) => (r.name || "").toLowerCase().includes(String(input.search).toLowerCase()))
        : rows;
      return { count: filtered.length, clients: filtered };
    },
  });

  // ── get_project_detail ────────────────────────────────────
  toolRegistry.register({
    name: "get_project_detail",
    module: "core",
    requiresConfirmation: false,
    description:
      "Retorna detalhes de UM projeto/demanda específico, incluindo cliente, status, datas, descrição. Use quando o usuário citar um projeto pelo nome ou ID.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "ID do projeto." },
      },
      required: ["projectId"],
    },
    handler: async (input, ctx) => {
      if (!input?.projectId) return { error: "projectId obrigatório" };
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, ctx.tenantId)));
      if (!row) return { error: "Projeto não encontrado neste tenant" };
      return { project: row };
    },
  });

  // ── read_frappe_doc ───────────────────────────────────────
  toolRegistry.register({
    name: "read_frappe_doc",
    module: "core",
    requiresConfirmation: false,
    description:
      "Consulta um DocType no Frappe/ERPNext do tenant (se configurado). Use quando precisar de dados do ERP: clientes Frappe, faturas, items, vendas, etc. Se o tenant não tem Frappe configurado, retorna erro — informe ao usuário.",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "Nome do DocType (ex: 'Customer', 'Sales Invoice', 'Item')." },
        filters: { type: "object", description: "Filtros opcionais Frappe (ex: {status: 'Paid'})." },
        limit: { type: "number", description: "Máx 20. Default 10." },
      },
      required: ["doctype"],
    },
    handler: async (input, ctx) => {
      const status = await getFrappeStatus(ctx.tenantId);
      if (!status.configured) return { error: "Tenant não tem Frappe configurado em Minha Empresa." };
      const doctype = String(input?.doctype || "");
      if (!doctype) return { error: "doctype obrigatório" };
      const limit = Math.min(Number(input?.limit) || 10, 20);
      const client = await getFrappeClientForTenant(ctx.tenantId);
      const result = await client.getList(doctype, { filters: input?.filters, limit });
      return { doctype, count: Array.isArray(result) ? result.length : 0, data: result };
    },
  });

  // ── search_brain ──────────────────────────────────────────
  toolRegistry.register({
    name: "search_brain",
    module: "core",
    requiresConfirmation: false,
    description:
      "Busca no Cérebro de Conhecimento do tenant (documentação, requisitos, metodologia, decisões e histórico já indexados). Use ANTES de responder perguntas sobre o projeto, cliente, requisitos ou metodologia para enriquecer a resposta com contexto real do tenant. O escopo é restrito ao tenant atual + itens globais.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta ou termos da busca (ex: 'requisitos do módulo de contas a pagar', 'metodologia BMC nível 3')." },
        limit: { type: "number", description: "Máx 10. Default 5." },
      },
      required: ["query"],
    },
    handler: async (input, ctx) => {
      const query = String(input?.query || "").trim();
      if (!query) return { error: "query obrigatório" };
      const topK = Math.min(Math.max(Number(input?.limit) || 5, 1), 10);
      const { searchKnowledge } = await import("../embeddingService");
      const matches = await searchKnowledge(query, { tenantId: ctx.tenantId, topK });
      const items = matches.map((m) => ({
        id: m.id,
        title: m.title,
        type: m.type,
        score: Math.round(m.score * 1000) / 1000,
        content: (m.content || "").slice(0, 1500),
      }));
      return { count: items.length, query, items };
    },
  });

  coreRegistered = true;
  console.log("[mcp] registered 5 core tools (list_projects, list_clients, get_project_detail, read_frappe_doc, search_brain)");
}
