/**
 * timeline.ts — Sprint 4 Recovery (Toneraud)
 *
 * Endpoints:
 *   GET    /api/recovery/processes/:id/timeline           (filtros: eventType CSV, creditorId, from, to, search, limit, offset)
 *   POST   /api/recovery/processes/:id/timeline           (insert manual de evento)
 *   GET    /api/recovery/processes/:id/timeline/export.pdf (mesmos filtros)
 *   POST   /api/recovery/processes/:id/timeline/upload-url  (URL assinada de upload)
 *   POST   /api/recovery/timeline/:eventId/attachments       (anexa arquivo já uploadado)
 *   GET    /api/recovery/timeline/:eventId/attachments/:idx/download
 *   DELETE /api/recovery/timeline/:eventId/attachments/:idx
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  recoveryTimeline,
  recoveryProcesses,
  pessoas,
  insertRecoveryTimelineSchema,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, desc, eq, gte, lte, ilike, or, inArray, sql } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage";
import { PDFDocument, StandardFonts, PageSizes, rgb, type PDFFont } from "pdf-lib";

function getUserId(req: any): string | null {
  return req?.user?.claims?.sub || req?.user?.id || null;
}

async function ensureProcess(id: string, tenantId: string) {
  const [p] = await db
    .select()
    .from(recoveryProcesses)
    .where(and(eq(recoveryProcesses.id, id), eq(recoveryProcesses.tenantId, tenantId)))
    .limit(1);
  return p ?? null;
}

async function ensureTimelineEvent(id: string, tenantId: string) {
  const [e] = await db
    .select()
    .from(recoveryTimeline)
    .where(and(eq(recoveryTimeline.id, id), eq(recoveryTimeline.tenantId, tenantId)))
    .limit(1);
  return e ?? null;
}

function buildTimelineFilters(processId: string, tenantId: string, q: any) {
  const conds: any[] = [
    eq(recoveryTimeline.tenantId, tenantId),
    eq(recoveryTimeline.processId, processId),
  ];
  if (q.eventType) {
    const types = String(q.eventType).split(",").map((s) => s.trim()).filter(Boolean);
    if (types.length === 1) conds.push(eq(recoveryTimeline.eventType, types[0]));
    else if (types.length > 1) conds.push(inArray(recoveryTimeline.eventType, types));
  }
  if (q.creditorId) {
    conds.push(sql`${recoveryTimeline.payload}->>'creditorId' = ${String(q.creditorId)}`);
  }
  if (q.from) {
    const d = new Date(String(q.from));
    if (!isNaN(d.getTime())) conds.push(gte(recoveryTimeline.createdAt, d));
  }
  if (q.to) {
    const d = new Date(String(q.to));
    if (!isNaN(d.getTime())) conds.push(lte(recoveryTimeline.createdAt, d));
  }
  if (q.search && String(q.search).trim()) {
    const like = `%${String(q.search).trim()}%`;
    conds.push(or(ilike(recoveryTimeline.title, like), ilike(recoveryTimeline.description, like))!);
  }
  return conds;
}

export function registerTimelineRoutes(app: Express) {
  // ── LIST com filtros + paginação
  app.get(
    "/api/recovery/processes/:id/timeline",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const proc = await ensureProcess(req.params.id, tenantId);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
        const offset = Math.max(0, Number(req.query.offset ?? 0));
        const conds = buildTimelineFilters(proc.id, tenantId, req.query);
        const rows = await db
          .select()
          .from(recoveryTimeline)
          .where(and(...conds))
          .orderBy(desc(recoveryTimeline.createdAt))
          .limit(limit)
          .offset(offset);
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(recoveryTimeline)
          .where(and(...conds));
        res.json({ items: rows, total: Number(count), limit, offset });
      } catch (e: any) {
        console.error("[recovery] list timeline:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // ── INSERT manual de evento (anotação interna do operador)
  app.post(
    "/api/recovery/processes/:id/timeline",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const userId = getUserId(req);
        const proc = await ensureProcess(req.params.id, tenantId);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        const parsed = insertRecoveryTimelineSchema.parse({
          ...req.body,
          tenantId,
          processId: proc.id,
          createdById: userId ?? undefined,
        });
        const [row] = await db.insert(recoveryTimeline).values(parsed as any).returning();
        res.status(201).json(row);
      } catch (e: any) {
        console.error("[recovery] insert timeline:", e);
        res.status(400).json({ message: e.message });
      }
    },
  );

  // ── EXPORT PDF (respeita filtros)
  app.get(
    "/api/recovery/processes/:id/timeline/export.pdf",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const proc = await ensureProcess(req.params.id, tenantId);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        const conds = buildTimelineFilters(proc.id, tenantId, req.query);
        const rows = await db
          .select()
          .from(recoveryTimeline)
          .where(and(...conds))
          .orderBy(desc(recoveryTimeline.createdAt))
          .limit(2000);

        let clienteNome = "";
        if (proc.clientePessoaId) {
          const [p] = await db
            .select()
            .from(pessoas)
            .where(and(eq(pessoas.id, proc.clientePessoaId), eq(pessoas.tenantId, tenantId)))
            .limit(1);
          clienteNome = p?.razaoSocial || p?.nomeFantasia || "";
        }

        const pdf = await renderTimelinePdf(proc, clienteNome, rows, req.query);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="toneraud-${String(proc.id).slice(0, 8)}.pdf"`,
        );
        res.send(Buffer.from(pdf));
      } catch (e: any) {
        console.error("[recovery] export timeline pdf:", e);
        if (!res.headersSent) res.status(500).json({ message: e.message });
      }
    },
  );

  // ── ANEXOS: solicitar URL assinada de upload
  app.post(
    "/api/recovery/processes/:id/timeline/upload-url",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const proc = await ensureProcess(req.params.id, tenantId);
        if (!proc) return res.status(404).json({ message: "Processo não encontrado" });
        const svc = new ObjectStorageService();
        const url = await svc.getObjectEntityUploadURL();
        res.json({ uploadURL: url });
      } catch (e: any) {
        console.error("[recovery] upload-url:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // ── ANEXOS: registrar anexo em um evento
  app.post(
    "/api/recovery/timeline/:eventId/attachments",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const event = await ensureTimelineEvent(req.params.eventId, tenantId);
        if (!event) return res.status(404).json({ message: "Evento não encontrado" });

        const { uploadURL, name, size, mime } = req.body || {};
        if (!uploadURL || !name) {
          return res.status(400).json({ message: "uploadURL e name são obrigatórios" });
        }

        const svc = new ObjectStorageService();
        const path = svc.normalizeObjectEntityPath(String(uploadURL));

        const newAttachment = {
          path,
          name: String(name).slice(0, 255),
          size: Number(size) || 0,
          mime: String(mime || "application/octet-stream").slice(0, 100),
          uploadedAt: new Date().toISOString(),
        };

        // Update atômico (concorrência-seguro): jsonb_set + concat operador "||" no SQL
        // Evita lost-update em uploads simultâneos.
        const result: any = await db.execute(sql`
          UPDATE recovery_timeline
          SET payload = jsonb_set(
            COALESCE(payload, '{}'::jsonb),
            '{attachments}',
            COALESCE(payload->'attachments', '[]'::jsonb) || ${JSON.stringify(newAttachment)}::jsonb
          )
          WHERE id = ${event.id} AND tenant_id = ${tenantId}
          RETURNING payload->'attachments' AS attachments
        `);
        const attachments = (result as any).rows?.[0]?.attachments ?? [];
        res.json({ ok: true, attachments });
      } catch (e: any) {
        console.error("[recovery] attach:", e);
        res.status(500).json({ message: e.message });
      }
    },
  );

  // ── ANEXOS: download (autenticado, escopa por tenant via evento)
  app.get(
    "/api/recovery/timeline/:eventId/attachments/:idx/download",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const event = await ensureTimelineEvent(req.params.eventId, tenantId);
        if (!event) return res.status(404).json({ message: "Evento não encontrado" });
        const idx = Number(req.params.idx);
        const attachments = ((event.payload as any)?.attachments) || [];
        const att = attachments[idx];
        if (!att) return res.status(404).json({ message: "Anexo não encontrado" });

        const svc = new ObjectStorageService();
        // path foi salvo via normalize (entityId puro). API espera /objects/<entityId>.
        const objectPath = att.path?.startsWith?.("/objects/")
          ? att.path
          : `/objects/${String(att.path || "").replace(/^\/+/, "")}`;
        const file = await svc.getObjectEntityFile(objectPath);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        );
        await svc.downloadObject(file, res, 0);
      } catch (e: any) {
        console.error("[recovery] download attach:", e);
        if (!res.headersSent) res.status(500).json({ message: e.message });
      }
    },
  );

  // ── ANEXOS: delete (remove do array + best-effort delete no blob)
  // Concorrência-segura via transação com SELECT ... FOR UPDATE no row.
  app.delete(
    "/api/recovery/timeline/:eventId/attachments/:idx",
    isAuthenticated,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenantId as string;
        const idx = Number(req.params.idx);
        if (!Number.isFinite(idx) || idx < 0) {
          return res.status(400).json({ message: "Índice inválido" });
        }

        let removedPath: string | null = null;
        let attachments: any[] = [];

        await db.transaction(async (tx) => {
          // Lock pessimista no row para evitar race condition
          const lockResult: any = await tx.execute(sql`
            SELECT id, payload
            FROM recovery_timeline
            WHERE id = ${req.params.eventId} AND tenant_id = ${tenantId}
            FOR UPDATE
          `);
          const row = (lockResult as any).rows?.[0];
          if (!row) {
            const err: any = new Error("Evento não encontrado");
            err.statusCode = 404;
            throw err;
          }
          const payload: any = row.payload || {};
          const arr = Array.isArray(payload.attachments) ? [...payload.attachments] : [];
          if (idx >= arr.length) {
            const err: any = new Error("Anexo não encontrado");
            err.statusCode = 404;
            throw err;
          }
          const removed = arr.splice(idx, 1)[0];
          removedPath = removed?.path ?? null;
          payload.attachments = arr;
          await tx
            .update(recoveryTimeline)
            .set({ payload })
            .where(and(eq(recoveryTimeline.id, req.params.eventId), eq(recoveryTimeline.tenantId, tenantId)));
          attachments = arr;
        });

        // Best-effort delete do blob fora da transação (não bloqueia resposta se falhar)
        if (removedPath) {
          try {
            const svc = new ObjectStorageService();
            const objectPath = String(removedPath).startsWith("/objects/")
              ? String(removedPath)
              : `/objects/${String(removedPath).replace(/^\/+/, "")}`;
            await svc.deleteObject(objectPath);
          } catch (e) {
            console.warn("[recovery] delete blob falhou (best-effort):", e);
          }
        }

        res.json({ ok: true, attachments });
      } catch (e: any) {
        console.error("[recovery] delete attach:", e);
        res.status(e.statusCode || 500).json({ message: e.message });
      }
    },
  );
}

// ───────────────────────────────────────────────────────────────────
//  PDF rendering
// ───────────────────────────────────────────────────────────────────

const MARGIN = 50;

const EVENT_TYPE_LABELS: Record<string, string> = {
  process_created: "Processo criado",
  status_changed: "Status alterado",
  creditor_added: "Credor adicionado",
  creditor_imported: "Credores importados",
  creditor_status_changed: "Status do credor alterado",
  action_created: "Ação criada",
  action_completed: "Ação concluída",
  acao_vencida: "Ação vencida",
  note: "Anotação",
  milestone: "Marco",
  scenario_created: "Cenário criado",
  scenario_approved: "Cenário aprovado",
  scenario_homologated: "Cenário homologado",
  proposal_sent: "Proposta enviada",
  proposal_accepted: "Proposta aceita",
  proposal_counter: "Contraproposta",
  agreement_homologated: "Acordo homologado",
  installment_released: "Parcela liberada",
  payment_recorded: "Pagamento registrado",
  inadimplencia_detectada: "Inadimplência detectada",
};

function eventTypeLabel(t: string): string {
  return EVENT_TYPE_LABELS[t] ?? t;
}

async function renderTimelinePdf(
  proc: any,
  clienteNome: string,
  rows: any[],
  filters: any,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(PageSizes.A4);
  let y = page.getHeight() - MARGIN;
  const W = page.getWidth();

  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) {
      page = doc.addPage(PageSizes.A4);
      y = page.getHeight() - MARGIN;
    }
  };
  const text = (
    s: string,
    opts: { bold?: boolean; size?: number; color?: any; x?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    ensure(size + 4);
    page.drawText(sanitize(s), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? rgb(0.15, 0.15, 0.2),
      maxWidth: W - 2 * MARGIN,
    });
    y -= size + 4;
  };

  // Header
  text("ARCÁDIA CONSULTING", { bold: true, size: 16, color: rgb(0.04, 0.32, 0.55) });
  text("Toneraud — Relatório de Eventos do Processo de Recuperação", {
    size: 10,
    color: rgb(0.4, 0.4, 0.5),
  });
  y -= 4;
  text(`Processo: ${proc.nomeProcesso ?? proc.id}`, { size: 9 });
  if (clienteNome) text(`Cliente: ${clienteNome}`, { size: 9 });
  text(`Tipo: ${proc.tipoRecuperacao ?? "—"}  ·  Status: ${proc.status ?? "—"}`, { size: 9 });
  text(
    `Documento gerado em: ${new Date().toLocaleString("pt-BR")}  ·  ${rows.length} evento(s)`,
    { size: 8, color: rgb(0.5, 0.5, 0.5) },
  );

  const fparts: string[] = [];
  if (filters?.eventType) fparts.push(`Tipos: ${filters.eventType}`);
  if (filters?.creditorId) fparts.push(`Credor: ${String(filters.creditorId).slice(0, 8)}`);
  if (filters?.from) fparts.push(`De: ${filters.from}`);
  if (filters?.to) fparts.push(`Até: ${filters.to}`);
  if (filters?.search) fparts.push(`Busca: "${filters.search}"`);
  if (fparts.length) {
    text(`Filtros aplicados — ${fparts.join("  ·  ")}`, { size: 8, color: rgb(0.5, 0.5, 0.5) });
  }
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: W - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.04, 0.32, 0.55),
  });
  y -= 12;

  for (const r of rows) {
    ensure(40);
    const dt = r.createdAt ? new Date(r.createdAt).toLocaleString("pt-BR") : "—";
    text(`[${dt}]  ${eventTypeLabel(r.eventType).toUpperCase()}`, {
      bold: true,
      size: 9,
      color: rgb(0.04, 0.32, 0.55),
    });
    text(r.title || "(sem título)", { size: 10 });
    if (r.description) {
      const lines = wrapText(r.description, font, 9, W - 2 * MARGIN);
      for (const ln of lines) text(ln, { size: 9, color: rgb(0.3, 0.3, 0.3) });
    }
    const atts = (r.payload as any)?.attachments;
    if (Array.isArray(atts) && atts.length) {
      text(`Anexos: ${atts.length}`, { size: 8, color: rgb(0.4, 0.4, 0.6) });
    }
    y -= 6;
  }

  if (rows.length === 0) {
    text("Nenhum evento corresponde aos filtros aplicados.", {
      size: 10,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const total = doc.getPageCount();
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i);
    p.drawText(`Arcádia Consulting — Recovery — Toneraud — ${i + 1}/${total}`, {
      x: MARGIN,
      y: 20,
      size: 7,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
  return doc.save();
}

/** pdf-lib (Helvetica) só renderiza WinANSI. Sanitiza chars fora desse set. */
function sanitize(s: string): string {
  return String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitize(text);
  const words = safe.replace(/\r/g, "").split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    const wlen = font.widthOfTextAtSize(test, size);
    if (wlen > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  const final: string[] = [];
  for (const ln of lines) final.push(...ln.split("\n"));
  return final;
}
