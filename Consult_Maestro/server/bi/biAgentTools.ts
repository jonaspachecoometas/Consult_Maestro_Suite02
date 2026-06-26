/**
 * MCP tools do Agente BI — conectam tool calls à Semantic Layer.
 * Registradas em server/mcp/registerAllTools.ts.
 */

import { z } from "zod";
import type { ToolContext } from "../mcp/toolRegistry";
import {
  listSemanticCatalogGrouped,
  listSemanticMetrics,
  runSemanticMetric,
} from "./semantic/index";

export const biTools = [
  {
    name: "list_bi_metrics",
    module: "bi" as const,
    description:
      "Lista métricas semânticas certificadas disponíveis para o tenant, agrupadas por módulo (control, crm, hr, scrum, societario, recovery, fiscal).",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Filtrar por módulo (opcional)." },
      },
    } as const,
    inputValidator: z.object({ module: z.string().optional() }),
    requiresConfirmation: false,
    handler: async (input: { module?: string }, _ctx: ToolContext) => {
      const catalog = listSemanticCatalogGrouped();
      const filtered = input.module ? catalog.filter((g) => g.module === input.module) : catalog;
      return {
        modules: filtered.map((g) => ({
          module: g.module,
          metrics: g.items.map((m) => ({
            id: m.id,
            label: m.label,
            description: m.description,
            defaultWidget: m.defaultWidget,
          })),
        })),
        total: filtered.reduce((s, g) => s + g.items.length, 0),
      };
    },
  },

  {
    name: "run_bi_query",
    module: "bi" as const,
    description:
      "Executa uma métrica semântica certificada e retorna dados prontos para gráfico. Use IDs vindos de list_bi_metrics (ex.: 'control.resultado_liquido', 'crm.pipeline_by_stage').",
    inputSchema: {
      type: "object",
      required: ["metricId"],
      properties: {
        metricId: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        clientNaturalKey: { type: "string" },
      },
    } as const,
    inputValidator: z.object({
      metricId: z.string().min(3),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      clientNaturalKey: z.string().optional(),
    }),
    requiresConfirmation: false,
    handler: async (
      input: { metricId: string; startDate?: string; endDate?: string; clientNaturalKey?: string },
      ctx: ToolContext,
    ) => {
      if (!ctx.tenantId) throw new Error("Tenant obrigatório");
      const result = await runSemanticMetric(input.metricId, {
        tenantId: ctx.tenantId,
        startDate: input.startDate,
        endDate: input.endDate,
        clientNaturalKey: input.clientNaturalKey,
      });
      return {
        metricId: input.metricId,
        rows: result.rows.slice(0, 100),
        rowCount: result.rows.length,
        cached: result.cached,
        ttlSeconds: result.ttlSeconds,
      };
    },
  },

  {
    name: "compare_periods",
    module: "bi" as const,
    description:
      "Compara a mesma métrica entre dois períodos e retorna o delta absoluto e percentual.",
    inputSchema: {
      type: "object",
      required: ["metricId", "currentStart", "currentEnd", "previousStart", "previousEnd"],
      properties: {
        metricId: { type: "string" },
        currentStart: { type: "string" },
        currentEnd: { type: "string" },
        previousStart: { type: "string" },
        previousEnd: { type: "string" },
      },
    } as const,
    inputValidator: z.object({
      metricId: z.string().min(3),
      currentStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      currentEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      previousStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      previousEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    requiresConfirmation: false,
    handler: async (
      input: { metricId: string; currentStart: string; currentEnd: string; previousStart: string; previousEnd: string },
      ctx: ToolContext,
    ) => {
      if (!ctx.tenantId) throw new Error("Tenant obrigatório");
      const [current, previous] = await Promise.all([
        runSemanticMetric(input.metricId, { tenantId: ctx.tenantId, startDate: input.currentStart, endDate: input.currentEnd }),
        runSemanticMetric(input.metricId, { tenantId: ctx.tenantId, startDate: input.previousStart, endDate: input.previousEnd }),
      ]);
      const sumCurrent = current.rows.reduce((s, r) => s + r.value, 0);
      const sumPrevious = previous.rows.reduce((s, r) => s + r.value, 0);
      const deltaAbs = sumCurrent - sumPrevious;
      const deltaPct = sumPrevious !== 0 ? (deltaAbs / Math.abs(sumPrevious)) * 100 : null;
      return {
        metricId: input.metricId,
        current: { total: sumCurrent, rows: current.rows.slice(0, 50) },
        previous: { total: sumPrevious, rows: previous.rows.slice(0, 50) },
        delta: {
          absolute: deltaAbs,
          percent: deltaPct !== null ? Math.round(deltaPct * 100) / 100 : null,
          direction: deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat",
        },
      };
    },
  },

  // ─── Catálogo de métricas semânticas exposto como listagem flat ──
  {
    name: "list_bi_metrics_flat",
    module: "bi" as const,
    description: "Lista todas as métricas semânticas em formato linear (sem agrupamento).",
    inputSchema: { type: "object", properties: {} } as const,
    requiresConfirmation: false,
    handler: async (_input: unknown, _ctx: ToolContext) => {
      const all = listSemanticMetrics();
      return { metrics: all, total: all.length };
    },
  },
] as const;
