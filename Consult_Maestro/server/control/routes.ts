import type { Express } from "express";
import { db } from "../db";
import {
  planosContas, centrosCusto, contasBancarias, lancamentosFinanceiros, periodosCompetencia,
  clients,
  gruposParcelamento, templatesRecorrencia, tiposDocumento,
  orcamentosMensais,
  insertCentroCustoSchema, insertContaBancariaSchema, insertLancamentoFinanceiroSchema, insertPeriodoCompetenciaSchema,
  insertTemplateRecorrenciaSchema, insertTipoDocumentoSchema,
} from "@shared/schema";
import { and, eq, desc, asc, sql, gte, lte, inArray, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant } from "../tenantContext";
import { seedPlanoContasIfNeeded } from "./seedPlanoContas";
import { attachSprint45Routes } from "./routesNovas";
import { parseValorBR } from "@shared/parse-valor";
import { getProjectedCashFlow } from "./cashFlowProjection";
import {
  createCentroCusto as svcCreateCC,
  updateCentroCusto as svcUpdateCC,
  importBulkCentrosCusto,
  calcOrcamentoUtilizado,
  type ImportRow,
} from "./centroCustoService";
import { getRateios, setRateios } from "./rateioService";
import { conciliarLancamento, desconciliarLancamento, getExtratoConta } from "./conciliacaoService";
import { criarLancamentoParcelado, alterarGrupoParcelamento } from "./parcelamentoService";
import { transferirEntreContas, definirSaldoInicial } from "./transferenciasService";
import { processarRecorrencias, processarTemplate } from "./recorrenciaEngine";
import { statusCalcSql } from "./statusCalc";
import { getMatriz as orcMatriz, upsertBatch as orcUpsert, getComparativo as orcComparativo } from "./orcamentoService";
import { getFluxoCaixaMensal, getFluxoCaixaDiario } from "./fluxoCaixaService";
import { getDreComAv } from "./dreService";
import { getPmpPmr, getPmpPmrHistorico } from "./kpiAvancadoService";
import { getPivot } from "./carteiraPivotService";
import { listCarteiras, aprovarLancamento, getExerciciosDisponiveis } from "./carteiraService";

// Chain padrão: precisa rodar tenantContext explicitamente porque essas rotas
// são registradas antes do app.use(tenantContext) global.
const auth = [isAuthenticated, tenantContext, requireTenant];

// Helpers ────────────────────────────────────────────────────────────────────
async function clienteBelongsToTenant(clienteId: string, tenantId: string): Promise<boolean> {
  const [c] = await db.select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clienteId), eq(clients.tenantId, tenantId)))
    .limit(1);
  return !!c;
}

async function planoContaBelongsToTenant(id: string, tenantId: string): Promise<boolean> {
  const [r] = await db.select({ id: planosContas.id }).from(planosContas)
    .where(and(eq(planosContas.id, id), eq(planosContas.tenantId, tenantId))).limit(1);
  return !!r;
}

async function centroCustoBelongsToCliente(id: string, tenantId: string, clienteId: string): Promise<boolean> {
  const [r] = await db.select({ id: centrosCusto.id }).from(centrosCusto)
    .where(and(eq(centrosCusto.id, id), eq(centrosCusto.tenantId, tenantId), eq(centrosCusto.clienteId, clienteId))).limit(1);
  return !!r;
}

async function contaBancariaBelongsToCliente(id: string, tenantId: string, clienteId: string): Promise<boolean> {
  const [r] = await db.select({ id: contasBancarias.id }).from(contasBancarias)
    .where(and(eq(contasBancarias.id, id), eq(contasBancarias.tenantId, tenantId), eq(contasBancarias.clienteId, clienteId))).limit(1);
  return !!r;
}

/** Valida cross-tenant/cross-cliente nas FKs do lançamento. */
async function validateLancamentoRefs(
  data: { planoContaId?: string | null; centroCustoId?: string | null; contaBancariaId?: string | null },
  tenantId: string,
  clienteId: string,
): Promise<string | null> {
  if (data.planoContaId && !(await planoContaBelongsToTenant(data.planoContaId, tenantId))) {
    return "Plano de conta inválido para este tenant";
  }
  if (data.centroCustoId && !(await centroCustoBelongsToCliente(data.centroCustoId, tenantId, clienteId))) {
    return "Centro de custo inválido para este cliente";
  }
  if (data.contaBancariaId && !(await contaBancariaBelongsToCliente(data.contaBancariaId, tenantId, clienteId))) {
    return "Conta bancária inválida para este cliente";
  }
  return null;
}

const lancUpdateSchema = z.object({
  tipo: z.enum(["pagar", "receber"]).optional(),
  descricao: z.string().min(1).optional(),
  favorecido: z.string().optional().nullable(),
  documento: z.string().optional().nullable(),
  valor: z.union([z.number(), z.string()]).optional(),
  dataEmissao: z.string().optional().nullable(),
  dataVencimento: z.string().optional(),
  dataPagamento: z.string().optional().nullable(),
  status: z.enum(["previsto", "aprovado", "pago", "vencido", "cancelado", "inadimplente"]).optional(),
  planoContaId: z.string().optional().nullable(),
  centroCustoId: z.string().optional().nullable(),
  contaBancariaId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

// centroPatchSchema removido — validação agora vive em centroCustoService.updateCentroCusto
// para que regras de tipo=projeto (datas obrigatórias) e parent (mesmo cliente) sejam centralizadas.

const contaBancariaPatchSchema = z.object({
  banco: z.string().min(1).max(150).optional(),
  agencia: z.string().optional().nullable(),
  conta: z.string().optional().nullable(),
  tipo: z.enum(["cc", "cp", "investimento"]).optional(),
  saldoInicial: z.union([z.number(), z.string()]).optional(),
  saldoAtual: z.union([z.number(), z.string()]).optional(),
  ativo: z.boolean().optional(),
});

export function registerControlRoutes(app: Express) {
  // ────────── Workspace bootstrap (seed do plano de contas)
  app.post("/api/control/bootstrap", ...auth, async (req: any, res) => {
    try {
      const r = await seedPlanoContasIfNeeded(req.tenantId);
      res.json(r);
    } catch (e: any) {
      console.error("[control] bootstrap:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Plano de Contas (compartilhado por tenant)
  app.get("/api/control/planos-contas", ...auth, async (req: any, res) => {
    const rows = await db.select().from(planosContas)
      .where(eq(planosContas.tenantId, req.tenantId))
      .orderBy(asc(planosContas.codigo));
    res.json(rows);
  });

  // Cria conta no plano (CRUD completo)
  const planoCreateSchema = z.object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(300),
    natureza: z.enum(["ativo", "passivo", "patrimonio_liquido", "receita", "custo", "despesa", "resultado"]),
    nivel: z.number().int().min(1).max(8).default(1),
    parentId: z.string().optional().nullable(),
    naturezaDre: z.string().max(30).optional().nullable(),
    permiteLancamento: z.boolean().default(true),
    ativo: z.boolean().default(true),
    // Sprint C6 — extensão Domínio CFC / DRE
    codigoCfc: z.string().max(30).optional().nullable(),
    tipoConta: z.enum(["sintetica", "analitica"]).optional().nullable(),
    grupoDre: z.string().max(50).optional().nullable(),
  });
  app.post("/api/control/planos-contas", ...auth, async (req: any, res) => {
    try {
      const parsed = planoCreateSchema.parse(req.body);
      // Valida parent (se houver) — precisa estar no mesmo tenant
      if (parsed.parentId && !(await planoContaBelongsToTenant(parsed.parentId, req.tenantId))) {
        return res.status(400).json({ message: "Conta pai inválida para este tenant" });
      }
      // Verifica unicidade do código
      const [existe] = await db.select({ id: planosContas.id }).from(planosContas)
        .where(and(eq(planosContas.tenantId, req.tenantId), eq(planosContas.codigo, parsed.codigo)))
        .limit(1);
      if (existe) return res.status(409).json({ message: `Código '${parsed.codigo}' já existe` });

      const [row] = await db.insert(planosContas).values({
        tenantId: req.tenantId,
        codigo: parsed.codigo,
        descricao: parsed.descricao,
        natureza: parsed.natureza,
        nivel: parsed.nivel,
        parentId: parsed.parentId ?? null,
        naturezaDre: parsed.naturezaDre ?? null,
        permiteLancamento: parsed.permiteLancamento,
        ativo: parsed.ativo,
        // Sprint C6
        codigoCfc: parsed.codigoCfc ?? null,
        tipoConta: parsed.tipoConta ?? null,
        grupoDre: parsed.grupoDre ?? null,
      }).returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] plano create:", e);
      res.status(500).json({ message: e.message });
    }
  });

  const planoPatchSchema = planoCreateSchema.partial();
  app.patch("/api/control/planos-contas/:id", ...auth, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!(await planoContaBelongsToTenant(id, req.tenantId))) return res.status(404).json({ message: "Conta não encontrada" });
      const parsed = planoPatchSchema.parse(req.body);

      // Bloqueia auto-referência (parent = self) e ciclo direto
      if (parsed.parentId === id) return res.status(400).json({ message: "Conta não pode ser pai dela mesma" });
      if (parsed.parentId) {
        if (!(await planoContaBelongsToTenant(parsed.parentId, req.tenantId))) {
          return res.status(400).json({ message: "Conta pai inválida para este tenant" });
        }
        // Detecta ciclo: caminhar para cima a partir do novo parent procurando por id
        let cursor: string | null = parsed.parentId;
        const visitados = new Set<string>();
        while (cursor) {
          if (cursor === id) return res.status(400).json({ message: "Atribuir esse pai criaria um ciclo na hierarquia" });
          if (visitados.has(cursor)) break;
          visitados.add(cursor);
          const [p] = await db.select({ parentId: planosContas.parentId }).from(planosContas)
            .where(and(eq(planosContas.id, cursor), eq(planosContas.tenantId, req.tenantId))).limit(1);
          cursor = (p?.parentId as string | null) ?? null;
        }
      }

      // Se mudar codigo, valida unicidade
      if (parsed.codigo) {
        const [conflito] = await db.select({ id: planosContas.id }).from(planosContas)
          .where(and(eq(planosContas.tenantId, req.tenantId), eq(planosContas.codigo, parsed.codigo)))
          .limit(1);
        if (conflito && conflito.id !== id) return res.status(409).json({ message: `Código '${parsed.codigo}' já existe` });
      }

      const update: any = {};
      for (const k of Object.keys(parsed) as (keyof typeof parsed)[]) {
        const v = parsed[k];
        if (v !== undefined) update[k] = v;
      }
      const [row] = await db.update(planosContas).set(update)
        .where(and(eq(planosContas.id, id), eq(planosContas.tenantId, req.tenantId)))
        .returning();
      res.json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] plano patch:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/control/planos-contas/:id", ...auth, async (req: any, res) => {
    try {
      const { id } = req.params;
      if (!(await planoContaBelongsToTenant(id, req.tenantId))) return res.status(404).json({ message: "Conta não encontrada" });

      // Não pode excluir se houver lançamentos referenciando
      const [usado] = await db.select({ c: sql<number>`count(*)::int` }).from(lancamentosFinanceiros)
        .where(and(eq(lancamentosFinanceiros.tenantId, req.tenantId), eq(lancamentosFinanceiros.planoContaId, id)));
      if (Number(usado?.c || 0) > 0) {
        return res.status(409).json({ message: `Existem ${usado.c} lançamentos vinculados — desative ao invés de excluir` });
      }
      // Não pode excluir se tiver filhos
      const [filhos] = await db.select({ c: sql<number>`count(*)::int` }).from(planosContas)
        .where(and(eq(planosContas.tenantId, req.tenantId), eq(planosContas.parentId, id)));
      if (Number(filhos?.c || 0) > 0) {
        return res.status(409).json({ message: `Conta possui ${filhos.c} sub-contas — exclua ou re-aloque os filhos primeiro` });
      }

      await db.delete(planosContas).where(and(eq(planosContas.id, id), eq(planosContas.tenantId, req.tenantId)));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[control] plano delete:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Contagem de uso (lançamentos por conta) — para a UI mostrar quanto cada conta movimentou
  app.get("/api/control/planos-contas/uso", ...auth, async (req: any, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT plano_conta_id AS id, COUNT(*)::int AS qtd, COALESCE(SUM(valor),0)::float AS total
        FROM lancamentos_financeiros
        WHERE tenant_id = ${req.tenantId} AND plano_conta_id IS NOT NULL
        GROUP BY plano_conta_id
      `);
      res.json(rows.rows);
    } catch (e: any) {
      console.error("[control] plano uso:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Workspace overview por cliente (KPIs do dashboard)
  app.get("/api/control/clientes/:clienteId/overview", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });

      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      const agg = await db.execute(sql`
        WITH base AS (
          SELECT tipo, status, valor, data_vencimento, data_pagamento
          FROM lancamentos_financeiros
          WHERE tenant_id = ${req.tenantId} AND cliente_id = ${clienteId}
        )
        SELECT
          COALESCE(SUM(CASE WHEN tipo='pagar' AND status NOT IN ('pago','cancelado') AND data_vencimento <= ${today} THEN valor ELSE 0 END),0) AS a_pagar_vencidos,
          COALESCE(SUM(CASE WHEN tipo='pagar' AND status NOT IN ('pago','cancelado') AND data_vencimento BETWEEN ${today} AND ${in7} THEN valor ELSE 0 END),0) AS a_pagar_7d,
          COALESCE(SUM(CASE WHEN tipo='pagar' AND status NOT IN ('pago','cancelado') AND data_vencimento BETWEEN ${today} AND ${in30} THEN valor ELSE 0 END),0) AS a_pagar_30d,
          COALESCE(SUM(CASE WHEN tipo='receber' AND status NOT IN ('pago','cancelado') AND data_vencimento <= ${today} THEN valor ELSE 0 END),0) AS a_receber_vencidos,
          COALESCE(SUM(CASE WHEN tipo='receber' AND status NOT IN ('pago','cancelado') AND data_vencimento BETWEEN ${today} AND ${in7} THEN valor ELSE 0 END),0) AS a_receber_7d,
          COALESCE(SUM(CASE WHEN tipo='receber' AND status NOT IN ('pago','cancelado') AND data_vencimento BETWEEN ${today} AND ${in30} THEN valor ELSE 0 END),0) AS a_receber_30d,
          COALESCE(SUM(CASE WHEN status='pago' AND tipo='pagar' AND date_trunc('month', data_pagamento::timestamp) = date_trunc('month', now()) THEN valor ELSE 0 END),0) AS pago_mes,
          COALESCE(SUM(CASE WHEN status='pago' AND tipo='receber' AND date_trunc('month', data_pagamento::timestamp) = date_trunc('month', now()) THEN valor ELSE 0 END),0) AS recebido_mes,
          COUNT(*) FILTER (WHERE status='previsto') AS pendentes_aprovacao,
          COUNT(*) AS total_lancamentos
        FROM base;
      `);
      const k = (agg.rows[0] || {}) as any;

      const sal = await db.execute(sql`
        SELECT COALESCE(SUM(saldo_atual),0) AS saldo_total, COUNT(*) AS contas
        FROM contas_bancarias
        WHERE tenant_id = ${req.tenantId} AND cliente_id = ${clienteId} AND ativo = true;
      `);
      const s = (sal.rows[0] || {}) as any;

      res.json({
        aPagarVencidos: Number(k.a_pagar_vencidos || 0),
        aPagar7d: Number(k.a_pagar_7d || 0),
        aPagar30d: Number(k.a_pagar_30d || 0),
        aReceberVencidos: Number(k.a_receber_vencidos || 0),
        aReceber7d: Number(k.a_receber_7d || 0),
        aReceber30d: Number(k.a_receber_30d || 0),
        pagoMes: Number(k.pago_mes || 0),
        recebidoMes: Number(k.recebido_mes || 0),
        pendentesAprovacao: Number(k.pendentes_aprovacao || 0),
        totalLancamentos: Number(k.total_lancamentos || 0),
        saldoBancarioTotal: Number(s.saldo_total || 0),
        totalContasBancarias: Number(s.contas || 0),
      });
    } catch (e: any) {
      console.error("[control] overview:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Projeção de caixa (Sprint 3 Recovery)
  app.get("/api/control/clientes/:clienteId/cash-flow-projection", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const months = Math.max(1, Math.min(24, Number(req.query.months ?? 6)));
      const series = await getProjectedCashFlow(req.tenantId, clienteId, months);
      res.json({ series, months });
    } catch (e: any) {
      console.error("[control] cash-flow-projection:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Lançamentos Financeiros
  app.get("/api/control/clientes/:clienteId/lancamentos", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const { tipo, status, dataIni, dataFim, q, campoData } = req.query as any;

      const filters: any[] = [
        eq(lancamentosFinanceiros.tenantId, req.tenantId),
        eq(lancamentosFinanceiros.clienteId, clienteId),
      ];
      if (tipo && (tipo === "pagar" || tipo === "receber")) filters.push(eq(lancamentosFinanceiros.tipo, tipo));
      if (status) filters.push(eq(lancamentosFinanceiros.status, status));

      // Campo de data para o intervalo (vencimento padrão; permite emissao ou pagamento)
      const colMap: Record<string, any> = {
        vencimento: lancamentosFinanceiros.dataVencimento,
        emissao: lancamentosFinanceiros.dataEmissao,
        pagamento: lancamentosFinanceiros.dataPagamento,
      };
      const dataCol = colMap[String(campoData || "vencimento")] ?? lancamentosFinanceiros.dataVencimento;
      if (dataIni) filters.push(gte(dataCol, dataIni));
      if (dataFim) filters.push(lte(dataCol, dataFim));
      if (q) filters.push(sql`(${lancamentosFinanceiros.descricao} ILIKE ${"%" + q + "%"} OR ${lancamentosFinanceiros.favorecido} ILIKE ${"%" + q + "%"} OR ${lancamentosFinanceiros.documento} ILIKE ${"%" + q + "%"})`);

      // Sprint C7 — G6: status calculado virtual (pago/cancelado/atrasado/vence_hoje/em_dia)
      const rows = await db.select({
        id: lancamentosFinanceiros.id,
        tenantId: lancamentosFinanceiros.tenantId,
        clienteId: lancamentosFinanceiros.clienteId,
        tipo: lancamentosFinanceiros.tipo,
        descricao: lancamentosFinanceiros.descricao,
        favorecido: lancamentosFinanceiros.favorecido,
        documento: lancamentosFinanceiros.documento,
        valor: lancamentosFinanceiros.valor,
        dataEmissao: lancamentosFinanceiros.dataEmissao,
        dataVencimento: lancamentosFinanceiros.dataVencimento,
        dataPagamento: lancamentosFinanceiros.dataPagamento,
        status: lancamentosFinanceiros.status,
        statusCalc: statusCalcSql.as("status_calc"),
        planoContaId: lancamentosFinanceiros.planoContaId,
        centroCustoId: lancamentosFinanceiros.centroCustoId,
        contaBancariaId: lancamentosFinanceiros.contaBancariaId,
        origem: lancamentosFinanceiros.origem,
        criadoPorIa: lancamentosFinanceiros.criadoPorIa,
        criadoPor: lancamentosFinanceiros.criadoPor,
        aprovadoPor: lancamentosFinanceiros.aprovadoPor,
        aprovadoEm: lancamentosFinanceiros.aprovadoEm,
        observacoes: lancamentosFinanceiros.observacoes,
        grupoId: lancamentosFinanceiros.grupoId,
        recoveryInstallmentId: lancamentosFinanceiros.recoveryInstallmentId,
        grupoParcelamentoId: lancamentosFinanceiros.grupoParcelamentoId,
        numeroParcela: lancamentosFinanceiros.numeroParcela,
        totalParcelas: lancamentosFinanceiros.totalParcelas,
        templateRecorrenciaId: lancamentosFinanceiros.templateRecorrenciaId,
        origemRecorrencia: lancamentosFinanceiros.origemRecorrencia,
        tipoDocumentoId: lancamentosFinanceiros.tipoDocumentoId,
        createdAt: lancamentosFinanceiros.createdAt,
        updatedAt: lancamentosFinanceiros.updatedAt,
      }).from(lancamentosFinanceiros)
        .where(and(...filters))
        .orderBy(asc(lancamentosFinanceiros.dataVencimento), desc(lancamentosFinanceiros.createdAt))
        .limit(500);
      res.json(rows);
    } catch (e: any) {
      console.error("[control] lancamentos list:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/control/clientes/:clienteId/lancamentos", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const userId = req.user?.claims?.sub || req.user?.id;
      const parsed = insertLancamentoFinanceiroSchema.parse({
        ...req.body,
        tenantId: req.tenantId,
        clienteId,
        criadoPor: userId,
      });
      // Cross-tenant FK validation
      const fkErr = await validateLancamentoRefs(parsed as any, req.tenantId, clienteId);
      if (fkErr) return res.status(400).json({ message: fkErr });

      const [row] = await db.insert(lancamentosFinanceiros).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] lancamento create:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Import em massa de lançamentos (CSV/Planilha)
  // Recebe array de linhas com codigos (não IDs) para os FKs. Faz lookup
  // por código no contexto do tenant/cliente e cria tudo em uma transação.
  app.post("/api/control/clientes/:clienteId/lancamentos/import-massa", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const userId = req.user?.claims?.sub || req.user?.id;

      const linhaSchema = z.object({
        tipo: z.enum(["pagar", "receber"]),
        status: z.enum(["previsto", "aprovado", "pago"]).optional().default("previsto"),
        descricao: z.string().min(1).max(500),
        favorecido: z.string().optional().nullable(),
        documento: z.string().optional().nullable(),
        valor: z.union([z.number(), z.string()]).transform((v) => {
          const n = parseValorBR(v);
          if (!Number.isFinite(n) || n <= 0) throw new Error("Valor inválido");
          return n;
        }),
        dataEmissao: z.string().optional().nullable(),
        dataVencimento: z.string().min(8),
        planoContaCodigo: z.string().optional().nullable(),
        centroCustoCodigo: z.string().optional().nullable(),
        contaBancariaBanco: z.string().optional().nullable(),
        observacoes: z.string().optional().nullable(),
      });
      const bodySchema = z.object({ linhas: z.array(z.any()).min(1).max(2000) });
      const { linhas } = bodySchema.parse(req.body);

      // Pré-carrega lookups (em batch) para evitar N+1
      const [planos, centros, contas] = await Promise.all([
        db.select({ id: planosContas.id, codigo: planosContas.codigo, permite: planosContas.permiteLancamento })
          .from(planosContas).where(eq(planosContas.tenantId, req.tenantId)),
        db.select({ id: centrosCusto.id, codigo: centrosCusto.codigo })
          .from(centrosCusto).where(and(eq(centrosCusto.tenantId, req.tenantId), eq(centrosCusto.clienteId, clienteId))),
        db.select({ id: contasBancarias.id, banco: contasBancarias.banco })
          .from(contasBancarias).where(and(eq(contasBancarias.tenantId, req.tenantId), eq(contasBancarias.clienteId, clienteId))),
      ]);
      const mapPlano = new Map(planos.map((p) => [String(p.codigo).trim(), p]));
      const mapCentro = new Map(centros.map((c) => [String(c.codigo).trim(), c.id]));
      const mapConta = new Map(contas.map((c) => [String(c.banco).trim().toLowerCase(), c.id]));

      // Valida e normaliza cada linha (sem persistir ainda)
      const validas: any[] = [];
      const erros: { linha: number; motivo: string }[] = [];
      linhas.forEach((raw: any, idx: number) => {
        try {
          const r = linhaSchema.parse(raw);
          let planoContaId: string | null = null;
          if (r.planoContaCodigo) {
            const p = mapPlano.get(String(r.planoContaCodigo).trim());
            if (!p) throw new Error(`Plano de conta '${r.planoContaCodigo}' não encontrado`);
            if (p.permite === false) throw new Error(`Plano '${r.planoContaCodigo}' é sintético (não permite lançamento)`);
            planoContaId = p.id;
          }
          let centroCustoId: string | null = null;
          if (r.centroCustoCodigo) {
            const id = mapCentro.get(String(r.centroCustoCodigo).trim());
            if (!id) throw new Error(`Centro de custo '${r.centroCustoCodigo}' não encontrado`);
            centroCustoId = id;
          }
          let contaBancariaId: string | null = null;
          if (r.contaBancariaBanco) {
            const id = mapConta.get(String(r.contaBancariaBanco).trim().toLowerCase());
            if (!id) throw new Error(`Conta bancária '${r.contaBancariaBanco}' não encontrada`);
            contaBancariaId = id;
          }
          validas.push({
            tenantId: req.tenantId,
            clienteId,
            tipo: r.tipo,
            status: r.status ?? "previsto",
            descricao: r.descricao,
            favorecido: r.favorecido ?? null,
            documento: r.documento ?? null,
            valor: String(r.valor),
            dataEmissao: r.dataEmissao || null,
            dataVencimento: r.dataVencimento,
            planoContaId,
            centroCustoId,
            contaBancariaId,
            observacoes: r.observacoes ?? null,
            origem: "importacao",
            criadoPor: userId,
          });
        } catch (e: any) {
          const msg = e?.issues?.[0]?.message || e?.message || "Linha inválida";
          erros.push({ linha: idx + 2, motivo: msg }); // +2 = 1 (1-based) + 1 (header)
        }
      });

      if (validas.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha válida para importar", erros });
      }

      // Insere tudo em transação — atômico (ou tudo ou nada nas válidas)
      const inseridas = await db.transaction(async (tx) => {
        return await tx.insert(lancamentosFinanceiros).values(validas).returning({ id: lancamentosFinanceiros.id });
      });

      res.status(201).json({
        criados: inseridas.length,
        totalLinhas: linhas.length,
        erros,
      });
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Body inválido", issues: e.issues });
      console.error("[control] import-massa:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/control/lancamentos/:id", ...auth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const patch = lancUpdateSchema.parse(req.body);

      // Buscar lançamento atual para validar FKs E detectar transições de status
      // que precisam passar pelo conciliacaoService (saldo + extrato).
      const [current] = await db.select({
        clienteId: lancamentosFinanceiros.clienteId,
        status: lancamentosFinanceiros.status,
      })
        .from(lancamentosFinanceiros)
        .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
        .limit(1);
      if (!current) return res.status(404).json({ message: "Lançamento não encontrado" });

      const fkErr = await validateLancamentoRefs(patch, req.tenantId, current.clienteId);
      if (fkErr) return res.status(400).json({ message: fkErr });

      // Sprint C6.1 — Conciliação: se PATCH leva o lançamento para status="pago"
      // (ou já está pago e está mudando conta/data), delega ao service para que
      // saldo da conta seja atualizado e extrato gerado atomicamente.
      // ORDEM IMPORTANTE: aplicamos os campos não-conciliação ANTES de chamar
      // o service, para que valor/tipo/descricao novos sejam refletidos no
      // extrato e no cálculo do saldo.
      const transicaoParaPago = patch.status === "pago" && current.status !== "pago";
      const reconciliando = current.status === "pago" && (patch.contaBancariaId !== undefined || patch.dataPagamento !== undefined);
      if (transicaoParaPago || reconciliando) {
        const contaBancariaId = patch.contaBancariaId ?? undefined;
        if (!contaBancariaId) return res.status(400).json({ message: "Conta bancária obrigatória para conciliação" });
        const dataPagamento = patch.dataPagamento ?? new Date().toISOString().slice(0, 10);
        // 1) Aplica primeiro os campos não-conciliação (valor, tipo, descricao,
        //    favorecido, planoContaId, etc) — assim o service usa os novos valores.
        const { status, contaBancariaId: _c, dataPagamento: _d, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          await db.update(lancamentosFinanceiros)
            .set({ ...rest, updatedAt: new Date() } as any)
            .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)));
        }
        // 2) Concilia (lê o lançamento já atualizado, calcula saldo + extrato)
        const r = await conciliarLancamento(req.tenantId, req.params.id, { contaBancariaId, dataPagamento, userId });
        if (!r.ok) return res.status(r.status ?? 400).json({ message: r.error });
        const [row] = await db.select().from(lancamentosFinanceiros)
          .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)));
        return res.json(row);
      }

      // Saindo de "pago" para outro status → desconciliar (reverte saldo + extrato)
      // ORDEM: desconcilia primeiro (usa valor antigo do extrato para devolver
      // saldo correto), depois aplica novo valor/tipo se vier no mesmo PATCH.
      if (current.status === "pago" && patch.status && patch.status !== "pago") {
        const r = await desconciliarLancamento(req.tenantId, req.params.id);
        if ("ok" in r && !r.ok) return res.status(r.status ?? 400).json({ message: r.error });
        // O service já mudou status para "aprovado"/"previsto"; aplica restante do patch
        const { status, dataPagamento: _d, ...rest } = patch;
        const finalStatus = status; // permite override (ex: cancelado)
        await db.update(lancamentosFinanceiros)
          .set({ ...rest, ...(finalStatus ? { status: finalStatus } : {}), updatedAt: new Date() } as any)
          .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)));
        const [row] = await db.select().from(lancamentosFinanceiros)
          .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)));
        return res.json(row);
      }

      const update: any = { ...patch, updatedAt: new Date() };
      if (patch.status === "aprovado") {
        update.aprovadoPor = userId;
        update.aprovadoEm = new Date();
      }
      const [row] = await db.update(lancamentosFinanceiros)
        .set(update)
        .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
        .returning();
      res.json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] lancamento patch:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/control/lancamentos/:id/aprovar", ...auth, async (req: any, res) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    const [row] = await db.update(lancamentosFinanceiros)
      .set({ status: "aprovado", aprovadoPor: userId, aprovadoEm: new Date(), updatedAt: new Date() })
      .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
      .returning();
    if (!row) return res.status(404).json({ message: "Lançamento não encontrado" });
    res.json(row);
  });

  // Sprint C6.1 — endpoint dedicado de conciliação (cria extrato + atualiza saldo)
  const conciliarSchema = z.object({
    contaBancariaId: z.string().min(1),
    // Aceita YYYY-MM-DD (formato ISO usado em todo o módulo Control)
    dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
  });
  app.post("/api/control/lancamentos/:id/conciliar", ...auth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const { contaBancariaId, dataPagamento } = conciliarSchema.parse(req.body);
      const r = await conciliarLancamento(req.tenantId, req.params.id, { contaBancariaId, dataPagamento, userId });
      if (!r.ok) return res.status(r.status ?? 400).json({ message: r.error });
      res.json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] conciliar:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/control/lancamentos/:id/desconciliar", ...auth, async (req: any, res) => {
    try {
      const r: any = await desconciliarLancamento(req.tenantId, req.params.id);
      if (r && "ok" in r && r.ok === false) return res.status(r.status ?? 400).json({ message: r.error });
      res.json(r);
    } catch (e: any) {
      console.error("[control] desconciliar:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/control/lancamentos/:id/pagar", ...auth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const dataPagamento = (req.body?.dataPagamento as string) || new Date().toISOString().slice(0, 10);
      const contaBancariaId = req.body?.contaBancariaId as string | undefined;
      // Se conta foi informada → roda conciliação completa (saldo + extrato);
      // se não, mantém comportamento legado (só muda status — útil em fluxos
      // onde a conciliação é feita depois).
      if (contaBancariaId) {
        const r = await conciliarLancamento(req.tenantId, req.params.id, { contaBancariaId, dataPagamento, userId });
        if (!r.ok) return res.status(r.status ?? 400).json({ message: r.error });
        return res.json(r);
      }
      const [row] = await db.update(lancamentosFinanceiros)
        .set({ status: "pago", dataPagamento, updatedAt: new Date() })
        .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Lançamento não encontrado" });
      res.json(row);
    } catch (e: any) {
      console.error("[control] pagar:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Sprint C6.1 — Extrato bancário
  app.get("/api/control/contas-bancarias/:id/extrato", ...auth, async (req: any, res) => {
    try {
      const dataIni = req.query.inicio as string | undefined;
      const dataFim = req.query.fim as string | undefined;
      const data = await getExtratoConta(req.tenantId, req.params.id, { dataIni, dataFim });
      res.json(data);
    } catch (e: any) {
      // Distingue conta não encontrada (404) de erro interno (500)
      if (typeof e?.message === "string" && e.message.includes("não encontrada")) {
        return res.status(404).json({ message: e.message });
      }
      console.error("[control] extrato:", e);
      res.status(500).json({ message: e?.message ?? "Erro ao carregar extrato" });
    }
  });

  app.delete("/api/control/lancamentos/:id", ...auth, async (req: any, res) => {
    const r = await db.delete(lancamentosFinanceiros)
      .where(and(eq(lancamentosFinanceiros.id, req.params.id), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
      .returning({ id: lancamentosFinanceiros.id });
    if (!r.length) return res.status(404).json({ message: "Lançamento não encontrado" });
    res.json({ ok: true });
  });

  // ────────── Centros de Custo
  app.get("/api/control/clientes/:clienteId/centros-custo", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
    const rows = await db.select().from(centrosCusto)
      .where(and(eq(centrosCusto.tenantId, req.tenantId), eq(centrosCusto.clienteId, clienteId)))
      .orderBy(asc(centrosCusto.codigo));
    res.json(rows);
  });

  app.post("/api/control/clientes/:clienteId/centros-custo", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }
    const result = await svcCreateCC(req.tenantId, clienteId, req.body);
    if (result.error) return res.status(400).json({ message: result.error });
    res.status(201).json(result.row);
  });

  app.patch("/api/control/centros-custo/:id", ...auth, async (req: any, res) => {
    const result = await svcUpdateCC(req.tenantId, req.params.id, req.body);
    if (result.error) {
      const code = result.error === "Centro de custo não encontrado" ? 404 : 400;
      return res.status(code).json({ message: result.error });
    }
    res.json(result.row);
  });

  app.delete("/api/control/centros-custo/:id", ...auth, async (req: any, res) => {
    // Bloqueia delete se houver lançamentos (FK ON DELETE RESTRICT por padrão)
    // ou rateios apontando para o CC.
    try {
      const [{ count }] = await db.execute(sql`
        SELECT (
          (SELECT COUNT(*) FROM lancamentos_financeiros WHERE centro_custo_id = ${req.params.id} AND tenant_id = ${req.tenantId})
          + (SELECT COUNT(*) FROM rateios_cc WHERE centro_custo_id = ${req.params.id} AND tenant_id = ${req.tenantId})
        )::int AS count
      `).then((r: any) => r.rows ?? r);
      if (count > 0) {
        return res.status(409).json({ message: `Centro de custo possui ${count} lançamento(s)/rateio(s) vinculado(s). Inative-o em vez de excluir.` });
      }
      const r = await db.delete(centrosCusto)
        .where(and(eq(centrosCusto.id, req.params.id), eq(centrosCusto.tenantId, req.tenantId)))
        .returning({ id: centrosCusto.id });
      if (!r.length) return res.status(404).json({ message: "Centro de custo não encontrado" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Erro ao excluir CC" });
    }
  });

  // Sprint C6 — Import em lote de Centros de Custo. Body: { rows: ImportRow[] }
  app.post("/api/control/clientes/:clienteId/centros-custo/import", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }
    const rows: ImportRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: "Nenhuma linha enviada" });
    if (rows.length > 1000) return res.status(400).json({ message: "Máximo de 1000 linhas por import" });
    const report = await importBulkCentrosCusto(req.tenantId, clienteId, rows);
    res.json(report);
  });

  // Sprint C6 — Orçamento utilizado de um CC em um mês.
  app.get("/api/control/clientes/:clienteId/centros-custo/:ccId/orcamento", ...auth, async (req: any, res) => {
    const { clienteId, ccId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }
    if (!(await centroCustoBelongsToCliente(ccId, req.tenantId, clienteId))) {
      return res.status(404).json({ message: "Centro de custo não encontrado" });
    }
    const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
    const mes = parseInt(String(req.query.mes ?? new Date().getMonth() + 1), 10);
    if (isNaN(ano) || isNaN(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ message: "ano/mes inválidos" });
    }
    const data = await calcOrcamentoUtilizado(req.tenantId, clienteId, ccId, ano, mes);
    res.json({ ano, mes, ...data });
  });

  // Sprint C6 — Rateios de lançamento financeiro
  app.get("/api/control/lancamentos/:lancamentoId/rateios", ...auth, async (req: any, res) => {
    // Valida ownership do lançamento
    const [lanc] = await db.select({ id: lancamentosFinanceiros.id })
      .from(lancamentosFinanceiros)
      .where(and(eq(lancamentosFinanceiros.id, req.params.lancamentoId), eq(lancamentosFinanceiros.tenantId, req.tenantId)))
      .limit(1);
    if (!lanc) return res.status(404).json({ message: "Lançamento não encontrado" });
    const rows = await getRateios(req.tenantId, req.params.lancamentoId);
    res.json(rows);
  });

  app.put("/api/control/lancamentos/:lancamentoId/rateios", ...auth, async (req: any, res) => {
    const result = await setRateios(req.tenantId, req.params.lancamentoId, req.body?.items ?? []);
    if (!result.ok) {
      const code = result.error === "Lançamento não encontrado" ? 404 : 400;
      return res.status(code).json({ message: result.error });
    }
    res.json(result);
  });

  // ────────── Contas Bancárias
  app.get("/api/control/clientes/:clienteId/contas-bancarias", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
    const rows = await db.select().from(contasBancarias)
      .where(and(eq(contasBancarias.tenantId, req.tenantId), eq(contasBancarias.clienteId, clienteId)))
      .orderBy(asc(contasBancarias.banco));
    res.json(rows);
  });

  app.post("/api/control/clientes/:clienteId/contas-bancarias", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const parsed = insertContaBancariaSchema.parse({ ...req.body, tenantId: req.tenantId, clienteId });
      const saldoInicial = (parsed as any).saldoInicial ?? "0";
      const [row] = await db.insert(contasBancarias).values({ ...parsed, saldoAtual: saldoInicial } as any).returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/control/contas-bancarias/:id", ...auth, async (req: any, res) => {
    try {
      const patch = contaBancariaPatchSchema.parse(req.body);
      const [row] = await db.update(contasBancarias).set(patch as any)
        .where(and(eq(contasBancarias.id, req.params.id), eq(contasBancarias.tenantId, req.tenantId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Conta bancária não encontrada" });
      res.json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/control/contas-bancarias/:id", ...auth, async (req: any, res) => {
    const r = await db.delete(contasBancarias)
      .where(and(eq(contasBancarias.id, req.params.id), eq(contasBancarias.tenantId, req.tenantId)))
      .returning({ id: contasBancarias.id });
    if (!r.length) return res.status(404).json({ message: "Conta bancária não encontrada" });
    res.json({ ok: true });
  });

  // ────────── Relatório de Pagamentos (por período)
  app.get("/api/control/clientes/:clienteId/relatorio-pagamentos", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const periodo = (req.query.periodo as string) || "semana";
      const today = new Date();
      let dataIni = new Date();
      const dataFim = new Date();
      if (periodo === "dia") {
        dataIni = today;
      } else if (periodo === "semana") {
        dataIni = new Date(Date.now() - 0);
        dataFim.setDate(dataFim.getDate() + 7);
      } else {
        dataIni = today;
        dataFim.setDate(dataFim.getDate() + 30);
      }
      const ini = dataIni.toISOString().slice(0, 10);
      const fim = dataFim.toISOString().slice(0, 10);

      const rows = await db.select({
        id: lancamentosFinanceiros.id,
        tipo: lancamentosFinanceiros.tipo,
        descricao: lancamentosFinanceiros.descricao,
        favorecido: lancamentosFinanceiros.favorecido,
        valor: lancamentosFinanceiros.valor,
        dataVencimento: lancamentosFinanceiros.dataVencimento,
        status: lancamentosFinanceiros.status,
      }).from(lancamentosFinanceiros)
        .where(and(
          eq(lancamentosFinanceiros.tenantId, req.tenantId),
          eq(lancamentosFinanceiros.clienteId, clienteId),
          gte(lancamentosFinanceiros.dataVencimento, ini),
          lte(lancamentosFinanceiros.dataVencimento, fim),
          inArray(lancamentosFinanceiros.status, ["previsto", "aprovado", "vencido"]),
        ))
        .orderBy(asc(lancamentosFinanceiros.dataVencimento));

      const totalPagar = rows.filter((r) => r.tipo === "pagar").reduce((s, r) => s + Number(r.valor), 0);
      const totalReceber = rows.filter((r) => r.tipo === "receber").reduce((s, r) => s + Number(r.valor), 0);

      res.json({ periodo, dataIni: ini, dataFim: fim, totalPagar, totalReceber, saldoLiquido: totalReceber - totalPagar, lancamentos: rows });
    } catch (e: any) {
      console.error("[control] relatorio:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ────────── Períodos de Competência
  app.get("/api/control/clientes/:clienteId/periodos", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
    const rows = await db.select().from(periodosCompetencia)
      .where(and(eq(periodosCompetencia.tenantId, req.tenantId), eq(periodosCompetencia.clienteId, clienteId)))
      .orderBy(desc(periodosCompetencia.ano), desc(periodosCompetencia.mes));
    res.json(rows);
  });

  app.post("/api/control/clientes/:clienteId/periodos", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const parsed = insertPeriodoCompetenciaSchema.parse({ ...req.body, tenantId: req.tenantId, clienteId });
      const [row] = await db.insert(periodosCompetencia).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      if (e?.code === "23505") return res.status(409).json({ message: "Período já cadastrado" });
      res.status(500).json({ message: e.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C7 — G1 Parcelamento
  // ────────────────────────────────────────────────────────────────────
  const parcelarSchema = z.object({
    tipo: z.enum(["pagar", "receber"]),
    descricao: z.string().min(1).max(300),
    valor: z.coerce.number().positive("Valor deve ser maior que zero"),
    parcelas: z.coerce.number().int().min(2, "Mínimo 2 parcelas").max(360, "Máximo 360 parcelas"),
    primeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD"),
    planoContaId: z.string().nullable().optional(),
    centroCustoId: z.string().nullable().optional(),
    tipoDocumentoId: z.string().nullable().optional(),
    favorecido: z.string().nullable().optional(),
    documento: z.string().nullable().optional(),
    observacoes: z.string().nullable().optional(),
  });

  app.post("/api/control/clientes/:clienteId/lancamentos-parcelado", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const userId = req.user?.claims?.sub || req.user?.id || null;
      const input = parcelarSchema.parse(req.body);
      const fkErr = await validateLancamentoRefs(
        { planoContaId: input.planoContaId, centroCustoId: input.centroCustoId, contaBancariaId: null },
        req.tenantId,
        clienteId,
      );
      if (fkErr) return res.status(400).json({ message: fkErr });
      const r = await criarLancamentoParcelado(req.tenantId, clienteId, userId, input);
      res.status(201).json({ ok: true, grupoId: r.grupo.id, totalCriado: r.lancamentos.length });
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] parcelar:", e);
      res.status(400).json({ message: e?.message ?? "Erro ao criar parcelamento" });
    }
  });

  app.get("/api/control/grupos-parcelamento/:id", ...auth, async (req: any, res) => {
    const [grupo] = await db.select().from(gruposParcelamento)
      .where(and(eq(gruposParcelamento.id, req.params.id), eq(gruposParcelamento.tenantId, req.tenantId)))
      .limit(1);
    if (!grupo) return res.status(404).json({ message: "Grupo não encontrado" });
    const parcelas = await db.select({
      id: lancamentosFinanceiros.id,
      numeroParcela: lancamentosFinanceiros.numeroParcela,
      totalParcelas: lancamentosFinanceiros.totalParcelas,
      valor: lancamentosFinanceiros.valor,
      dataVencimento: lancamentosFinanceiros.dataVencimento,
      dataPagamento: lancamentosFinanceiros.dataPagamento,
      status: lancamentosFinanceiros.status,
      statusCalc: statusCalcSql.as("status_calc"),
    }).from(lancamentosFinanceiros)
      .where(and(
        eq(lancamentosFinanceiros.grupoParcelamentoId, req.params.id),
        eq(lancamentosFinanceiros.tenantId, req.tenantId),
      ))
      .orderBy(asc(lancamentosFinanceiros.numeroParcela));
    res.json({ grupo, parcelas });
  });

  const grupoPatchSchema = z.object({
    descricao: z.string().min(1).optional(),
    planoContaId: z.string().nullable().optional(),
    centroCustoId: z.string().nullable().optional(),
    tipoDocumentoId: z.string().nullable().optional(),
    favorecido: z.string().nullable().optional(),
  });
  app.patch("/api/control/grupos-parcelamento/:id", ...auth, async (req: any, res) => {
    try {
      const changes = grupoPatchSchema.parse(req.body);
      const r = await alterarGrupoParcelamento(req.tenantId, req.params.id, changes);
      res.json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      res.status(500).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C7 — G2 Recorrência (CRUD de templates + trigger manual)
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/control/clientes/:clienteId/templates-recorrencia", ...auth, async (req: any, res) => {
    const { clienteId } = req.params;
    if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }
    const rows = await db.select().from(templatesRecorrencia)
      .where(and(
        eq(templatesRecorrencia.tenantId, req.tenantId),
        eq(templatesRecorrencia.clienteId, clienteId),
      ))
      .orderBy(desc(templatesRecorrencia.ativa), asc(templatesRecorrencia.descricao));
    res.json(rows);
  });

  app.post("/api/control/clientes/:clienteId/templates-recorrencia", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const userId = req.user?.claims?.sub || req.user?.id || null;
      // valorFixo é decimal no schema (string esperada). Aceitamos number do
      // frontend e convertemos antes do parse.
      const body = { ...req.body };
      if (body.valorFixo !== undefined && body.valorFixo !== null) {
        body.valorFixo = String(body.valorFixo);
      }
      const parsed = insertTemplateRecorrenciaSchema.parse({
        ...body,
        tenantId: req.tenantId,
        clienteId,
        criadoPor: userId,
      });
      const fkErr = await validateLancamentoRefs(
        { planoContaId: (parsed as any).planoContaId, centroCustoId: (parsed as any).centroCustoId, contaBancariaId: (parsed as any).contaBancariaId },
        req.tenantId,
        clienteId,
      );
      if (fkErr) return res.status(400).json({ message: fkErr });
      const [row] = await db.insert(templatesRecorrencia).values(parsed as any).returning();
      // Já gera as primeiras ocorrências sem esperar o cron
      try { await processarTemplate(row, new Date(), new Date(Date.now() + 60 * 86400000)); } catch (e) { console.error("[control] geração inicial template:", e); }
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      res.status(500).json({ message: e?.message });
    }
  });

  const templatePatchSchema = z.object({
    descricao: z.string().min(1).optional(),
    valorFixo: z.union([z.number(), z.string()]).nullable().optional(),
    diaVencimento: z.coerce.number().int().min(1).max(28).nullable().optional(),
    frequencia: z.enum(["mensal", "quinzenal", "semanal", "anual"]).optional(),
    planoContaId: z.string().nullable().optional(),
    centroCustoId: z.string().nullable().optional(),
    contaBancariaId: z.string().nullable().optional(),
    tipoDocumentoId: z.string().nullable().optional(),
    favorecido: z.string().nullable().optional(),
    dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    ativa: z.boolean().optional(),
    observacoes: z.string().nullable().optional(),
  });
  app.patch("/api/control/templates-recorrencia/:id", ...auth, async (req: any, res) => {
    try {
      const patch = templatePatchSchema.parse(req.body);
      const setObj: Record<string, any> = { ...patch, updatedAt: new Date() };
      if (patch.valorFixo !== undefined && patch.valorFixo !== null) {
        setObj.valorFixo = String(patch.valorFixo);
      }
      const [row] = await db.update(templatesRecorrencia).set(setObj as any)
        .where(and(eq(templatesRecorrencia.id, req.params.id), eq(templatesRecorrencia.tenantId, req.tenantId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Template não encontrado" });
      res.json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      res.status(500).json({ message: e?.message });
    }
  });

  app.delete("/api/control/templates-recorrencia/:id", ...auth, async (req: any, res) => {
    // Soft-disable: apenas inativa para preservar lançamentos já gerados
    const [row] = await db.update(templatesRecorrencia)
      .set({ ativa: false, updatedAt: new Date() })
      .where(and(eq(templatesRecorrencia.id, req.params.id), eq(templatesRecorrencia.tenantId, req.tenantId)))
      .returning({ id: templatesRecorrencia.id });
    if (!row) return res.status(404).json({ message: "Template não encontrado" });
    res.json({ ok: true, inativado: true });
  });

  app.post("/api/control/templates-recorrencia/processar", ...auth, async (req: any, res) => {
    try {
      // Sprint C7 — defesa de isolamento: rota manual sempre escopada ao tenant
      // do chamador (cron continua processando todos via processarRecorrencias()).
      const r = await processarRecorrencias(req.tenantId);
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C7 — G4 Transferência entre contas
  // ────────────────────────────────────────────────────────────────────
  const transfSchema = z.object({
    origemId: z.string().min(1),
    destinoId: z.string().min(1),
    valor: z.coerce.number().positive("Valor deve ser maior que zero"),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    descricao: z.string().min(1).max(300),
  });
  app.post("/api/control/clientes/:clienteId/transferencias", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const input = transfSchema.parse(req.body);
      const userId = req.user?.claims?.sub || req.user?.id || null;
      const r = await transferirEntreContas(req.tenantId, clienteId, userId, input);
      res.status(201).json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] transferencia:", e);
      res.status(400).json({ message: e?.message ?? "Erro na transferência" });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C7 — G5 Saldo inicial com data
  // ────────────────────────────────────────────────────────────────────
  const saldoInicialSchema = z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    valor: z.coerce.number(),
  });
  app.post("/api/control/contas-bancarias/:id/saldo-inicial", ...auth, async (req: any, res) => {
    try {
      const input = saldoInicialSchema.parse(req.body);
      const userId = req.user?.claims?.sub || req.user?.id || null;
      const r = await definirSaldoInicial(req.tenantId, req.params.id, userId, input);
      res.json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] saldo-inicial:", e);
      res.status(400).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C7 — G11 Tipos de Documento
  // ────────────────────────────────────────────────────────────────────
  // Lista tipos do tenant + tipos globais (__global__) — todos ativos
  app.get("/api/control/tipos-documento", ...auth, async (req: any, res) => {
    const rows = await db.select().from(tiposDocumento)
      .where(and(
        eq(tiposDocumento.ativo, true),
        or(
          eq(tiposDocumento.tenantId, req.tenantId),
          eq(tiposDocumento.tenantId, "__global__"),
        ),
      ))
      .orderBy(asc(tiposDocumento.ordem), asc(tiposDocumento.nome));
    res.json(rows);
  });

  app.post("/api/control/tipos-documento", ...auth, async (req: any, res) => {
    try {
      const parsed = insertTipoDocumentoSchema.parse({
        ...req.body,
        tenantId: req.tenantId,
      });
      const [row] = await db.insert(tiposDocumento).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      if (e?.code === "23505") return res.status(409).json({ message: "Já existe tipo com este nome" });
      res.status(500).json({ message: e?.message });
    }
  });

  app.patch("/api/control/tipos-documento/:id", ...auth, async (req: any, res) => {
    try {
      // Não permite editar tipos globais (__global__)
      const [row] = await db.update(tiposDocumento)
        .set({ ativo: req.body?.ativo, nome: req.body?.nome, icone: req.body?.icone })
        .where(and(eq(tiposDocumento.id, req.params.id), eq(tiposDocumento.tenantId, req.tenantId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Tipo não encontrado (globais não podem ser editados)" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C8 — Orçamento mensal (Realizado × Previsto)
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/control/clientes/:clienteId/orcamento", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      if (isNaN(ano) || ano < 2000 || ano > 2100) return res.status(400).json({ message: "ano inválido" });
      const data = await orcMatriz(req.tenantId, clienteId, ano);
      res.json(data);
    } catch (e: any) {
      console.error("[control] orcamento matriz:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  const orcamentoBatchSchema = z.object({
    items: z.array(z.object({
      planoContaId: z.string().min(1),
      centroCustoId: z.string().nullable().optional(),
      ano: z.coerce.number().int().min(2000).max(2100),
      mes: z.coerce.number().int().min(1).max(12),
      valorPrevisto: z.union([z.number(), z.string()]),
      thresholdAlertaPct: z.union([z.number(), z.string()]).nullable().optional(),
    })).max(2000),
  });
  app.post("/api/control/clientes/:clienteId/orcamento", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const { items } = orcamentoBatchSchema.parse(req.body);
      // Valida ownership de planoContaId/centroCustoId via FK indireta (tenant)
      // — usamos um IN simples no plano_conta
      if (items.length === 0) return res.json({ ok: true, processados: 0 });
      const planoIds = Array.from(new Set(items.map((i) => i.planoContaId)));
      const planos = await db.select({ id: planosContas.id }).from(planosContas)
        .where(and(inArray(planosContas.id, planoIds), eq(planosContas.tenantId, req.tenantId)));
      if (planos.length !== planoIds.length) {
        return res.status(400).json({ message: "Algum planoContaId não pertence ao tenant" });
      }
      // Valida ownership de centroCustoId (tenant+cliente) — só os não-nulos.
      const ccIds = Array.from(new Set(items.map((i) => i.centroCustoId).filter(Boolean) as string[]));
      if (ccIds.length > 0) {
        const ccs = await db.select({ id: centrosCusto.id }).from(centrosCusto)
          .where(and(
            inArray(centrosCusto.id, ccIds),
            eq(centrosCusto.tenantId, req.tenantId),
            eq(centrosCusto.clienteId, clienteId),
          ));
        if (ccs.length !== ccIds.length) {
          return res.status(400).json({ message: "Algum centroCustoId não pertence ao cliente/tenant" });
        }
      }
      const userId = req.user?.claims?.sub || req.user?.id || null;
      const r = await orcUpsert(req.tenantId, clienteId, userId, items as any);
      res.json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ message: "Dados inválidos", issues: e.issues });
      console.error("[control] orcamento upsert:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/api/control/clientes/:clienteId/orcamento/comparativo", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const mesRaw = req.query.mes ? parseInt(String(req.query.mes), 10) : null;
      const mes = mesRaw && mesRaw >= 1 && mesRaw <= 12 ? mesRaw : null;
      const threshold = req.query.threshold ? Number(req.query.threshold) : 15;
      if (isNaN(ano)) return res.status(400).json({ message: "ano inválido" });
      const data = await orcComparativo(req.tenantId, clienteId, ano, mes, threshold);
      res.json(data);
    } catch (e: any) {
      console.error("[control] orcamento comparativo:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C9 — G7/G8 Fluxo de Caixa, G9 DRE com AV%, G10 PMP/PMR
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/control/clientes/:clienteId/fluxo-caixa-mensal", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const conta = req.query.conta ? String(req.query.conta) : undefined;
      if (isNaN(ano) || ano < 2000 || ano > 2100) return res.status(400).json({ message: "ano inválido" });
      const data = await getFluxoCaixaMensal(req.tenantId, clienteId, ano, conta);
      res.json(data);
    } catch (e: any) {
      console.error("[control] fluxo-caixa-mensal:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/api/control/clientes/:clienteId/fluxo-caixa-diario", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const mes = parseInt(String(req.query.mes ?? (new Date().getMonth() + 1)), 10);
      const conta = req.query.conta ? String(req.query.conta) : undefined;
      if (isNaN(ano) || isNaN(mes) || mes < 1 || mes > 12) {
        return res.status(400).json({ message: "ano/mes inválido" });
      }
      const data = await getFluxoCaixaDiario(req.tenantId, clienteId, ano, mes, conta);
      res.json(data);
    } catch (e: any) {
      console.error("[control] fluxo-caixa-diario:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/api/control/clientes/:clienteId/dre", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const mesRaw = req.query.mes ? parseInt(String(req.query.mes), 10) : null;
      const mes = mesRaw && mesRaw >= 1 && mesRaw <= 12 ? mesRaw : null;
      const threshold = req.query.threshold ? Number(req.query.threshold) : 15;
      if (isNaN(ano)) return res.status(400).json({ message: "ano inválido" });
      const data = await getDreComAv(req.tenantId, clienteId, ano, mes, threshold);
      res.json(data);
    } catch (e: any) {
      console.error("[control] dre:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/api/control/clientes/:clienteId/pmp-pmr", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const mesRaw = req.query.mes ? parseInt(String(req.query.mes), 10) : null;
      const mes = mesRaw && mesRaw >= 1 && mesRaw <= 12 ? mesRaw : null;
      const data = await getPmpPmr(req.tenantId, clienteId, ano, mes);
      res.json(data);
    } catch (e: any) {
      console.error("[control] pmp-pmr:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/api/control/clientes/:clienteId/pmp-pmr/historico", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }
      const meses = Math.max(2, Math.min(24, Number(req.query.meses ?? 6)));
      const data = await getPmpPmrHistorico(req.tenantId, clienteId, meses);
      res.json({ historico: data });
    } catch (e: any) {
      console.error("[control] pmp-pmr historico:", e);
      res.status(500).json({ message: e?.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C10 — G12 Pivot, G13 Carteiras, G14 Exercícios fiscais
  // ────────────────────────────────────────────────────────────────────
  app.get("/api/control/clientes/:clienteId/pivot-clientes", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const data = await getPivot(req.tenantId, clienteId, ano, "receber");
      res.json(data);
    } catch (e: any) { console.error("[control] pivot-clientes:", e); res.status(500).json({ message: e?.message }); }
  });

  app.get("/api/control/clientes/:clienteId/pivot-fornecedores", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const ano = parseInt(String(req.query.ano ?? new Date().getFullYear()), 10);
      const data = await getPivot(req.tenantId, clienteId, ano, "pagar");
      res.json(data);
    } catch (e: any) { console.error("[control] pivot-fornecedores:", e); res.status(500).json({ message: e?.message }); }
  });

  app.get("/api/control/clientes/:clienteId/exercicios", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const anos = await getExerciciosDisponiveis(req.tenantId, clienteId);
      res.json({ anos });
    } catch (e: any) { console.error("[control] exercicios:", e); res.status(500).json({ message: e?.message }); }
  });

  app.get("/api/control/clientes/:clienteId/carteiras", ...auth, async (req: any, res) => {
    try {
      const { clienteId } = req.params;
      if (!(await clienteBelongsToTenant(clienteId, req.tenantId))) return res.status(404).json({ message: "Cliente não encontrado" });
      const data = await listCarteiras(req.tenantId, clienteId);
      res.json({ carteiras: data });
    } catch (e: any) { console.error("[control] carteiras:", e); res.status(500).json({ message: e?.message }); }
  });

  app.post("/api/control/lancamentos/:id/aprovar", ...auth, async (req: any, res) => {
    try {
      const acao = String(req.body?.acao ?? "aprovar") === "rejeitar" ? "rejeitar" : "aprovar";
      const motivo = req.body?.motivo ? String(req.body.motivo) : undefined;
      const r = await aprovarLancamento(req.tenantId, req.params.id, acao, motivo);
      res.json(r);
    } catch (e: any) { console.error("[control] aprovar lancamento:", e); res.status(500).json({ message: e?.message }); }
  });

  // ────────────────────────────────────────────────────────────────────
  // Sprint C11 — G17 Templates CSV para download
  // ────────────────────────────────────────────────────────────────────
  const TEMPLATES: Record<string, { headers: string[]; rows: string[][] }> = {
    clientes: {
      headers: ["nome", "cpf_cnpj", "email", "telefone", "endereco"],
      rows: [
        ["Maria Silva", "123.456.789-00", "maria@email.com", "11 91234-5678", "Rua A, 100"],
        ["Empresa ACME LTDA", "12.345.678/0001-90", "contato@acme.com", "11 4002-8922", "Av Paulista, 1000"],
      ],
    },
    fornecedores: {
      headers: ["nome", "cnpj", "email", "telefone", "banco", "agencia", "conta"],
      rows: [
        ["Fornecedor Exemplo SA", "98.765.432/0001-10", "vendas@fornecedor.com", "11 3000-1000", "Itaú", "1234", "56789-0"],
      ],
    },
    centros_custo: {
      headers: ["codigo", "nome", "tipo", "responsavel"],
      rows: [
        ["CC-01", "Administração", "departamento", "João"],
        ["CC-08", "Projeto Diagnóstico", "projeto", "Pedro"],
      ],
    },
    plano_contas: {
      headers: ["codigo_cfc", "descricao", "tipo", "grupo_dre"],
      rows: [
        ["3.2.2.01.0001", "Salários", "analitica", "despesas_pessoal"],
        ["3.1.1.01.0001", "Receita de Serviços", "analitica", "receita_bruta"],
      ],
    },
    lancamentos_historico: {
      headers: ["tipo", "descricao", "valor", "vencimento", "data_pagamento", "plano_conta", "cc"],
      rows: [
        ["pagar", "Aluguel Maio", "5000.00", "2026-05-05", "2026-05-05", "3.2.2.03.0001", "CC-01"],
        ["receber", "NF 1234 Cliente Maria", "8500.00", "2026-05-10", "2026-05-12", "3.1.1.01.0001", "CC-08"],
      ],
    },
  };
  function csvEscape(v: string): string {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }
  app.get("/api/control/templates/:tipo", ...auth, async (req: any, res) => {
    const t = TEMPLATES[req.params.tipo];
    if (!t) return res.status(404).json({ message: "Template não encontrado" });
    const lines = [t.headers.join(","), ...t.rows.map((r) => r.map(csvEscape).join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=template_${req.params.tipo}.csv`);
    res.send("\uFEFF" + lines.join("\n") + "\n");
  });

  // Sprints 4 + 5: Grupos, Contabilidade, Conectores, Import, IBS/CBS,
  // Painel Fiscal, Fleuriet, Fechamento e Monitor NF-e
  attachSprint45Routes(app);
}
