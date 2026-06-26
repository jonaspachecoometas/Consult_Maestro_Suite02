/**
 * Pipeline Societário — cron diário Sprint 3.
 * Roda lembrar_documentos_pendentes em todos os processos não-manual com
 * uploads pendentes >3 dias. Throttle por tarefa garantido pela skill.
 */
import cron from "node-cron";
import { runLembretesDiarios } from "./skills";

let started = false;

export function startPipelineLembretesCron(): void {
  if (started) return;
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_PIPELINE_LEMBRETES === "1") {
    console.log("[pipeline] lembretes cron disabled (test/disabled)");
    return;
  }
  cron.schedule("10 6 * * *", async () => {
    try {
      const r = await runLembretesDiarios();
      if (r.sent > 0) {
        console.log(`[pipeline] lembretes diários: ${r.sent}/${r.scanned} processo(s) notificado(s)`);
      }
    } catch (e: any) {
      console.error("[pipeline] lembretes cron error:", e);
    }
  });
  started = true;
  console.log("[pipeline] lembretes cron iniciado (06:10 diário)");
}
