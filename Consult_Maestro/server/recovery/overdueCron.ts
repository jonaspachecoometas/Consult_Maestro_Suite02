/**
 * overdueCron.ts — Sprint 3 + 4 Recovery
 *
 * Cron diário (06:00) com DUAS passagens:
 *   1) PARCELAS atrasadas (>10 dias do vencimento sem pagamento)
 *      - status → 'atrasado'
 *      - timeline 'inadimplencia_detectada'
 *      - notification (warning)
 *      - decrementa viability_score do processo
 *   2) AÇÕES atrasadas (Sprint 4): dataPrevista < today AND status NOT IN
 *      ('concluida','cancelada')
 *      - status → 'atrasada' (se ainda não estiver)
 *      - timeline 'acao_vencida'
 *      - notification (warning)
 *
 * Função `runOverdueCheck` é exportada para teste manual e para uso em ambientes
 * sem node-cron (ex.: Replit, onde o processo pode ser sleep).
 */
import cron from "node-cron";
import { db } from "../db";
import {
  recoveryInstallments,
  recoveryProcesses,
  recoveryTimeline,
  recoveryActions,
} from "@shared/schema";
import { and, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { createRecoveryNotification } from "./notifications";

const OVERDUE_THRESHOLD_DAYS = 10;
const VIABILITY_DECREMENT = 0.05;

export interface OverdueCheckResult {
  scanned: number;
  marked: number;
  affectedProcesses: number;
  actionsScanned: number;
  actionsMarked: number;
  actionsAffectedProcesses: number;
}

export async function runOverdueCheck(opts: { thresholdDays?: number; tenantId?: string } = {}): Promise<OverdueCheckResult> {
  const threshold = opts.thresholdDays ?? OVERDUE_THRESHOLD_DAYS;
  const cutoff = new Date(Date.now() - threshold * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // ───────── PASSAGEM 1: PARCELAS ─────────
  const conds = [
    inArray(recoveryInstallments.status, ["pendente", "agendado"]),
    lt(recoveryInstallments.dueDate, cutoff),
  ];
  if (opts.tenantId) conds.push(eq(recoveryInstallments.tenantId, opts.tenantId));
  const candidates = await db.select().from(recoveryInstallments).where(and(...conds));

  const byProcess = new Map<string, { tenantId: string; count: number }>();

  if (candidates.length > 0) {
    const ids = candidates.map((c) => c.id);
    await db.update(recoveryInstallments)
      .set({ status: "atrasado", updatedAt: new Date() })
      .where(inArray(recoveryInstallments.id, ids));

    for (const c of candidates) {
      const cur = byProcess.get(c.processId) ?? { tenantId: c.tenantId, count: 0 };
      cur.count += 1;
      byProcess.set(c.processId, cur);
    }

    for (const [processId, info] of byProcess.entries()) {
      await db.insert(recoveryTimeline).values({
        tenantId: info.tenantId,
        processId,
        eventType: "inadimplencia_detectada",
        title: `${info.count} parcela(s) inadimplente(s)`,
        description: `Parcelas com mais de ${threshold} dias de atraso foram marcadas como atrasadas pelo monitor automático.`,
        payload: { count: info.count, thresholdDays: threshold, installmentIds: candidates.filter((c) => c.processId === processId).map((c) => c.id) },
      });

      await db.execute(sql`
        UPDATE recovery_processes
        SET viability_score = GREATEST(0, COALESCE(viability_score, 0) - ${VIABILITY_DECREMENT}),
            status = CASE WHEN status = 'em_cumprimento' THEN 'inadimplente' ELSE status END,
            updated_at = NOW()
        WHERE id = ${processId} AND tenant_id = ${info.tenantId}
      `);

      await createRecoveryNotification({
        tenantId: info.tenantId,
        userId: null,
        title: `Inadimplência detectada (${info.count} parcela(s))`,
        body: `O monitor automático identificou ${info.count} parcela(s) com mais de ${threshold} dias de atraso. Viabilidade do processo foi reduzida.`,
        type: "warning",
        sourceType: "recovery_process",
        sourceId: processId,
      });
    }
  }

  // ───────── PASSAGEM 2: AÇÕES VENCIDAS (Sprint 4) ─────────
  const actionConds: any[] = [
    notInArray(recoveryActions.status, ["concluida", "cancelada", "atrasada"]),
    lt(recoveryActions.dataPrevista, today),
  ];
  if (opts.tenantId) actionConds.push(eq(recoveryActions.tenantId, opts.tenantId));
  const actionCandidates = await db.select().from(recoveryActions).where(and(...actionConds));

  const actionsByProcess = new Map<string, { tenantId: string; titles: string[] }>();
  if (actionCandidates.length > 0) {
    const actionIds = actionCandidates.map((a) => a.id);
    await db.update(recoveryActions)
      .set({ status: "atrasada", updatedAt: new Date() })
      .where(inArray(recoveryActions.id, actionIds));

    for (const a of actionCandidates) {
      const cur = actionsByProcess.get(a.processId) ?? { tenantId: a.tenantId, titles: [] };
      cur.titles.push(a.titulo);
      actionsByProcess.set(a.processId, cur);
    }

    for (const [processId, info] of actionsByProcess.entries()) {
      const titles = info.titles.slice(0, 5).join("; ");
      const more = info.titles.length > 5 ? ` (+${info.titles.length - 5})` : "";
      await db.insert(recoveryTimeline).values({
        tenantId: info.tenantId,
        processId,
        eventType: "acao_vencida",
        title: `${info.titles.length} ação(ões) vencida(s)`,
        description: `${titles}${more}`,
        payload: {
          count: info.titles.length,
          actionIds: actionCandidates.filter((a) => a.processId === processId).map((a) => a.id),
        },
      });

      await createRecoveryNotification({
        tenantId: info.tenantId,
        userId: null,
        title: `Ações vencidas (${info.titles.length})`,
        body: `${info.titles.length} ação(ões) com prazo vencido foram marcadas como atrasadas: ${titles}${more}.`,
        type: "warning",
        sourceType: "recovery_action",
        sourceId: processId,
      });
    }
  }

  return {
    scanned: candidates.length,
    marked: candidates.length,
    affectedProcesses: byProcess.size,
    actionsScanned: actionCandidates.length,
    actionsMarked: actionCandidates.length,
    actionsAffectedProcesses: actionsByProcess.size,
  };
}

let started = false;

export function startRecoveryOverdueCron(): void {
  if (started) return;
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RECOVERY_CRON === "1") {
    console.log("[recovery] overdue cron disabled (test/disabled)");
    return;
  }
  cron.schedule("0 6 * * *", async () => {
    try {
      const result = await runOverdueCheck();
      if (result.marked > 0 || result.actionsMarked > 0) {
        console.log(`[recovery] overdue cron: ${result.marked} parcela(s) em ${result.affectedProcesses} processo(s); ${result.actionsMarked} ação(ões) em ${result.actionsAffectedProcesses} processo(s)`);
      }
    } catch (e: any) {
      console.error("[recovery] overdue cron error:", e);
    }
  });
  started = true;
  console.log("[recovery] overdue cron iniciado (06:00 diário)");
}
