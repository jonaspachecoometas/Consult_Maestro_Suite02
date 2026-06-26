/**
 * MCP Hub — HTTP endpoints (Sprint 2)
 *
 * Exposes the tool registry over HTTP for:
 *   - the agent UI ("what tools can I see/run for this tenant?")
 *   - direct invocation by the frontend (e.g. confirmation modal that runs a
 *     tool the LLM proposed) and by future internal callers
 *
 * Sprint 2 only allows access via authenticated user session (`isAuthenticated`
 * + `tenantContext` already attached upstream). Sprint 4 will add a public
 * partner API key path.
 *
 * Endpoints (mounted under `/api/mcp`):
 *   GET  /tools                — list tools registered for the tenant
 *   POST /tools/:name          — execute a tool. Body: { input, userConfirmed?, projectId? }
 *
 * For tools with `requiresConfirmation: true` the executor returns a
 * `__requires_confirmation` sentinel when `userConfirmed !== true`, so the
 * UI can render a confirm dialog and re-POST with `userConfirmed: true`.
 */

import type { Express, Response } from "express";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { toolRegistry, type ToolContext } from "./toolRegistry";

function getUserId(req: any): string | null {
  if (req.user?.isLocalAuth && req.user?.id) return req.user.id;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  if (req.user?.dbUserId) return req.user.dbUserId;
  return null;
}

export function registerMcpRoutes(app: Express) {
  // ── GET /api/mcp/tools ─────────────────────────────────────────────────
  // Lista as tools visíveis para o tenant atual (Sprint 2: todas; o filtro
  // por escopo de partner key entra no Sprint 4).
  app.get(
    "/api/mcp/tools",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const defs = toolRegistry.listForAgent(tenantId);
        res.json({
          count: defs.length,
          tools: defs.map((t) => ({
            name: t.name,
            module: t.module,
            description: t.description,
            requiresConfirmation: t.requiresConfirmation,
            inputSchema: t.inputSchema,
          })),
        });
      } catch (e: any) {
        // Sprint 2 — log full error internally; never leak runtime/DB messages
        // to the caller (could expose schema, file paths, secrets in stack).
        console.error("[mcp] GET /tools failed:", e?.message ?? e, e?.stack);
        res.status(500).json({ message: "Erro interno ao listar tools" });
      }
    },
  );

  // ── POST /api/mcp/tools/:name ──────────────────────────────────────────
  // Executa uma tool. Para tools com confirmação, o frontend repete o POST
  // com `userConfirmed: true` no body.
  app.post(
    "/api/mcp/tools/:name",
    isAuthenticated,
    requireTenant,
    async (req: any, res: Response) => {
      try {
        const tenantId = req.tenantId as string;
        const userId = getUserId(req);
        const name = String(req.params.name || "").trim();
        if (!name) return res.status(400).json({ message: "Nome da tool obrigatório" });

        const tool = toolRegistry.get(name);
        if (!tool) return res.status(404).json({ message: `Tool '${name}' não registrada` });

        const body = req.body || {};
        // Aceitamos tanto `{ input: {...} }` quanto o shape "plano" para
        // ergonomia: se não vier `input`, usamos o body inteiro menos os
        // campos de controle.
        const input = body.input ?? (() => {
          const { userConfirmed, projectId, ...rest } = body;
          return rest;
        })();

        const ctx: ToolContext = {
          tenantId,
          userId,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
          userConfirmed: body.userConfirmed === true,
        };

        // Validação centralizada: `toolRegistry.execute` chama `inputValidator`
        // (Zod) ANTES do handler quando a tool declara um. O handler vira
        // single-purpose (lógica de negócio); validação 400 é uniforme entre
        // este endpoint, o Super Agent loop e qualquer caller futuro.
        const result = await toolRegistry.execute(name, input, ctx);

        // Sentinel de confirmação → 202 Accepted (a UI re-envia com userConfirmed=true).
        if (result && typeof result === "object" && (result as any).__requires_confirmation) {
          return res.status(202).json(result);
        }
        // Erros vêm como `{ error }` (contrato non-throwing do registry):
        //  - "Input inválido: ..." → falha de schema (Zod)
        //  - "Cliente não encontrado", etc. → falha de domínio
        // Em ambos casos retornamos 400 com a mensagem para o caller.
        if (result && typeof result === "object" && (result as any).error) {
          return res.status(400).json({ message: (result as any).error });
        }
        res.json(result);
      } catch (e: any) {
        // Sprint 2 — log full error internally; resposta genérica para o cliente.
        console.error(`[mcp] POST /tools/${req.params.name} failed:`, e?.message ?? e, e?.stack);
        res.status(500).json({ message: "Erro interno ao executar tool" });
      }
    },
  );
}
