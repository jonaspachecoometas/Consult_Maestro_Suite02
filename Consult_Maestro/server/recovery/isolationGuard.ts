/**
 * isolationGuard.ts — Núcleo do isolamento Recovery × Control (AP/AR).
 *
 * REGRA INVIOLÁVEL: dívidas listadas como credores em um processo de
 * recuperação ATIVO (status ∈ {diagnostico, negociacao}) NUNCA podem virar
 * conta a pagar normal no Control. Apenas após:
 *   1) Acordo homologado (status = acordo_homologado / em_cumprimento)
 *   2) Parcela do acordo liberada (Sprint 3)
 *   3) Buffer de caixa respeitado
 *
 * Sprint 1 expõe utilitários puros para serem consumidos na Sprint 3 pelo
 * Control e por automações. Aqui não há side-effects.
 */
import { db } from "../db";
import { recoveryProcesses, recoveryCreditors, recoveryInstallments } from "@shared/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

const ACTIVE_STATUSES = ["diagnostico", "negociacao", "acordo_homologado", "em_cumprimento", "inadimplente"];
const BLOCKING_CREDITOR_STATUSES = ["pendente", "em_negociacao", "acordo_proposto", "acordo_aceito", "recusado"];

/** Verifica se um tenant tem ao menos um processo de recuperação ativo. */
export async function tenantHasActiveRecovery(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: recoveryProcesses.id })
    .from(recoveryProcesses)
    .where(and(eq(recoveryProcesses.tenantId, tenantId), inArray(recoveryProcesses.status, ACTIVE_STATUSES)))
    .limit(1);
  return !!row;
}

/**
 * Retorna true se a pessoa (credor) está vinculada a algum credor em processo
 * de recuperação ativo cujo status ainda BLOQUEIA AP normal.
 *
 * IMPORTANTE: na Sprint 1 NÃO existe ainda o conceito de "parcela liberada"
 * (será introduzido na Sprint 3 com a tabela `recovery_payments`). Portanto,
 * por padrão de segurança, qualquer credor em processo ativo (incluindo
 * acordo_homologado/em_cumprimento) BLOQUEIA AP normal. A Sprint 3 vai
 * adicionar a checagem de parcela liberada para liberação granular.
 */
export async function isCreditorInRecovery(tenantId: string, pessoaId: string): Promise<boolean> {
  if (!tenantId || !pessoaId) return false;
  const rows = await db
    .select({ creditorId: recoveryCreditors.id })
    .from(recoveryCreditors)
    .innerJoin(recoveryProcesses, eq(recoveryCreditors.processId, recoveryProcesses.id))
    .where(
      and(
        eq(recoveryCreditors.tenantId, tenantId),
        eq(recoveryCreditors.credorPessoaId, pessoaId),
        inArray(recoveryProcesses.status, ACTIVE_STATUSES),
      ),
    );
  if (rows.length === 0) return false;

  // Sprint 3: granularidade real. Se TODOS os credores ativos do credor possuem
  // ao menos uma parcela do acordo gerada E todas estão pagas, libera AP normal.
  // Senão, mantém bloqueio.
  const creditorIds = rows.map((r) => r.creditorId);
  const [agg] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      pagas: sql<number>`SUM(CASE WHEN ${recoveryInstallments.status} = 'pago' THEN 1 ELSE 0 END)::int`,
    })
    .from(recoveryInstallments)
    .where(and(
      eq(recoveryInstallments.tenantId, tenantId),
      inArray(recoveryInstallments.creditorId, creditorIds),
    ));
  const total = Number(agg?.total ?? 0);
  const pagas = Number(agg?.pagas ?? 0);
  // Bloqueia se ainda não há parcelas geradas OU se há parcelas em aberto
  if (total === 0) return true;
  if (pagas < total) return true;
  return false; // todas pagas → libera
}

/** Lista todos os credores ativos (em recuperação) de um tenant. */
export async function listActiveRecoveryCreditorPessoaIds(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ pessoaId: recoveryCreditors.credorPessoaId })
    .from(recoveryCreditors)
    .innerJoin(recoveryProcesses, eq(recoveryCreditors.processId, recoveryProcesses.id))
    .where(
      and(
        eq(recoveryCreditors.tenantId, tenantId),
        inArray(recoveryProcesses.status, ACTIVE_STATUSES),
        // Sprint 1: lista todos os credores em processo ativo (sem filtro por status
        // de negociação). Sprint 3 vai refinar excluindo os com parcela já liberada.
      ),
    );
  return Array.from(new Set(rows.map((r) => r.pessoaId).filter((x): x is string => !!x)));
}

export const RECOVERY_ACTIVE_STATUSES = ACTIVE_STATUSES;
export const RECOVERY_BLOCKING_CREDITOR_STATUSES = BLOCKING_CREDITOR_STATUSES;
