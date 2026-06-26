// PROD-2 — Cron diário 08:00: para cada reunião agendada do dia, gera pauta
// (se ainda vazia) e tenta notificar via MCP Hub (WhatsApp/email) — best-effort.

import { db } from "../db";
import { reunioesProjeto } from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { gerarPauta } from "./reunioesService";

export async function processarReunioesDoDia(): Promise<{
  reunioesAvaliadas: number;
  pautasGeradas: number;
  notificacoesEnviadas: number;
}> {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);

  const reunioes = await db.select().from(reunioesProjeto)
    .where(and(
      gte(reunioesProjeto.data, inicio),
      lte(reunioesProjeto.data, fim),
      eq(reunioesProjeto.status, "agendada"),
    ));

  let pautas = 0;
  let notificadas = 0;
  for (const r of reunioes) {
    try {
      const pautaAtual = (r.pautaJson as any[] | null) || [];
      if (pautaAtual.length === 0) {
        await gerarPauta(r.tenantId, r.id);
        pautas++;
      }
      // TODO: integração MCP Hub (WhatsApp/email) — best-effort
      // Atualmente apenas registra no log. Wiring real virá quando MCP estiver pronto.
      console.log(`[reunioes-cron] reunião ${r.id} (tenant ${r.tenantId}) — pauta pronta, notificação não enviada (MCP off)`);
    } catch (err: any) {
      console.warn(`[reunioes-cron] falha em ${r.id}:`, err?.message);
    }
  }
  return {
    reunioesAvaliadas: reunioes.length,
    pautasGeradas: pautas,
    notificacoesEnviadas: notificadas,
  };
}

let cronStarted = false;
export function startReunioesCron(): void {
  if (cronStarted) return;
  cronStarted = true;
  import("node-cron").then(({ default: cron }) => {
    cron.schedule("0 8 * * *", async () => {
      try {
        const r = await processarReunioesDoDia();
        console.log(`[reunioes-cron] ${r.reunioesAvaliadas} reuniões hoje, ${r.pautasGeradas} pautas geradas`);
      } catch (e) {
        console.error("[reunioes-cron] erro:", e);
      }
    });
    console.log("[reunioes-cron] iniciado (08:00 diário)");
  }).catch((e) => console.error("[reunioes-cron] não foi possível iniciar:", e));
}
