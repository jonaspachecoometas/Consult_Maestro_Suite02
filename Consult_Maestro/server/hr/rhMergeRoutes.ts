import type { Express } from "express";
import { pool } from "../db";
import { z } from "zod";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { runMigrationRhMerge } from "./migrationRhMerge";

const auth = [isAuthenticated, requireTenant] as const;

const beneficioSchema = z.object({
  codigo:             z.string().optional().nullable(),
  nome:               z.string().min(1),
  tipo:               z.enum(["vt","vr","va","plano_saude","plano_odonto","seguro_vida","outros"]).optional(),
  fornecedor:         z.string().optional().nullable(),
  valorEmpresa:       z.number().optional(),
  valorFuncionario:   z.number().optional(),
  percentualDesconto: z.number().optional(),
  status:             z.enum(["ativo","inativo"]).optional(),
});

const funcBeneficioSchema = z.object({
  funcionarioId:     z.string().min(1),
  beneficioId:       z.number().int().positive(),
  dataInicio:        z.string().optional().nullable(),
  dataFim:           z.string().optional().nullable(),
  valorPersonalizado:z.number().optional().nullable(),
});

const pontoSchema = z.object({
  funcionarioId: z.string().min(1),
  data:          z.string(), // YYYY-MM-DD
  entrada1:      z.string().optional().nullable(),
  saida1:        z.string().optional().nullable(),
  entrada2:      z.string().optional().nullable(),
  saida2:        z.string().optional().nullable(),
  justificativa: z.string().optional().nullable(),
  status:        z.enum(["normal","falta","atestado","folga"]).optional(),
});

const feriasSchema = z.object({
  funcionarioId:           z.string().min(1),
  periodoAquisitivoInicio: z.string(),
  periodoAquisitivoFim:    z.string(),
  diasDireito:             z.number().optional(),
  diasVendidos:            z.number().optional(),
  dataInicio:              z.string().optional().nullable(),
  dataFim:                 z.string().optional().nullable(),
  observacoes:             z.string().optional().nullable(),
});

function calcularHoras(entrada1?: string|null, saida1?: string|null, entrada2?: string|null, saida2?: string|null) {
  const toMin = (hm?: string|null) => {
    if (!hm) return null;
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + (m ?? 0);
  };
  let total = 0;
  const e1 = toMin(entrada1), s1 = toMin(saida1);
  if (e1 != null && s1 != null && s1 > e1) total += s1 - e1;
  const e2 = toMin(entrada2), s2 = toMin(saida2);
  if (e2 != null && s2 != null && s2 > e2) total += s2 - e2;
  return parseFloat((total / 60).toFixed(2));
}

export function registerRhMergeRoutes(app: Express) {

  app.post("/api/rh/migrate", ...auth, async (_req, res) => {
    const result = await runMigrationRhMerge();
    res.json(result);
  });

  // ─── Benefícios (catálogo) ────────────────────────────────────────────────

  app.get("/api/rh/beneficios", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { status, tipo } = req.query;
    const conditions = ["tenant_id = $1"];
    const params: any[] = [tenantId];
    let i = 2;
    if (status) { conditions.push(`status = $${i}`); params.push(status); i++; }
    if (tipo)   { conditions.push(`tipo = $${i}`);   params.push(tipo);   i++; }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM people_beneficios WHERE ${conditions.join(" AND ")} ORDER BY nome`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rh/beneficios", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = beneficioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO people_beneficios
          (tenant_id, codigo, nome, tipo, fornecedor,
           valor_empresa, valor_funcionario, percentual_desconto, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tenantId, d.codigo ?? null, d.nome, d.tipo ?? null, d.fornecedor ?? null,
         d.valorEmpresa ?? 0, d.valorFuncionario ?? 0, d.percentualDesconto ?? 0,
         d.status ?? "ativo"]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/rh/beneficios/:id", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = beneficioSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;
    const map: Record<string, any> = {
      codigo: d.codigo, nome: d.nome, tipo: d.tipo, fornecedor: d.fornecedor,
      valor_empresa: d.valorEmpresa, valor_funcionario: d.valorFuncionario,
      percentual_desconto: d.percentualDesconto, status: d.status,
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { fields.push(`${col} = $${i}`); params.push(val); i++; }
    }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo" });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id, tenantId);
    try {
      const { rows } = await pool.query(
        `UPDATE people_beneficios SET ${fields.join(",")} WHERE id = $${i} AND tenant_id = $${i+1} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Benefício não encontrado" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Benefícios por funcionário ───────────────────────────────────────────

  app.get("/api/rh/funcionarios/:funcionarioId/beneficios", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT fb.*, b.nome, b.tipo, b.fornecedor,
           b.valor_empresa, b.valor_funcionario, b.percentual_desconto
         FROM people_funcionario_beneficios fb
         JOIN people_beneficios b ON b.id = fb.beneficio_id
         WHERE fb.funcionario_id = $1 AND fb.tenant_id = $2
         ORDER BY b.tipo, b.nome`,
        [req.params.funcionarioId, tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rh/funcionarios/:funcionarioId/beneficios", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = funcBeneficioSchema.safeParse({ ...req.body, funcionarioId: req.params.funcionarioId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const { rows } = await pool.query(`
        INSERT INTO people_funcionario_beneficios
          (tenant_id, funcionario_id, beneficio_id, data_inicio, data_fim, valor_personalizado, status)
        VALUES ($1,$2,$3,$4,$5,$6,'ativo')
        ON CONFLICT (funcionario_id, beneficio_id) DO UPDATE
        SET data_inicio = EXCLUDED.data_inicio, data_fim = EXCLUDED.data_fim,
            valor_personalizado = EXCLUDED.valor_personalizado, status = 'ativo'
        RETURNING *`,
        [tenantId, d.funcionarioId, d.beneficioId,
         d.dataInicio ?? null, d.dataFim ?? null, d.valorPersonalizado ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/rh/funcionarios/:funcionarioId/beneficios/:beneficioId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      await pool.query(
        `UPDATE people_funcionario_beneficios SET status = 'inativo'
         WHERE funcionario_id = $1 AND beneficio_id = $2 AND tenant_id = $3`,
        [req.params.funcionarioId, req.params.beneficioId, tenantId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Ponto ───────────────────────────────────────────────────────────────

  app.post("/api/rh/ponto/registrar", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = pontoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    const horasTrabalhadas = calcularHoras(d.entrada1, d.saida1, d.entrada2, d.saida2);
    const horasExtras = Math.max(0, horasTrabalhadas - 8);
    try {
      const { rows } = await pool.query(`
        INSERT INTO people_ponto
          (tenant_id, funcionario_id, data, entrada1, saida1, entrada2, saida2,
           horas_trabalhadas, horas_extras, justificativa, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (funcionario_id, data) DO UPDATE
        SET entrada1 = EXCLUDED.entrada1, saida1 = EXCLUDED.saida1,
            entrada2 = EXCLUDED.entrada2, saida2 = EXCLUDED.saida2,
            horas_trabalhadas = EXCLUDED.horas_trabalhadas,
            horas_extras = EXCLUDED.horas_extras,
            justificativa = EXCLUDED.justificativa, status = EXCLUDED.status
        RETURNING *`,
        [tenantId, d.funcionarioId, d.data, d.entrada1 ?? null, d.saida1 ?? null,
         d.entrada2 ?? null, d.saida2 ?? null, horasTrabalhadas, horasExtras,
         d.justificativa ?? null, d.status ?? "normal"]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/rh/ponto/:funcionarioId", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { from, to, status } = req.query;
    const conditions = ["tenant_id = $1", "funcionario_id = $2"];
    const params: any[] = [tenantId, req.params.funcionarioId];
    let i = 3;
    if (from)   { conditions.push(`data >= $${i}`);   params.push(from);   i++; }
    if (to)     { conditions.push(`data <= $${i}`);   params.push(to);     i++; }
    if (status) { conditions.push(`status = $${i}`);  params.push(status); i++; }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM people_ponto WHERE ${conditions.join(" AND ")} ORDER BY data DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/rh/ponto/relatorio", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { mes, ano } = req.query;
    const mesNum = parseInt(mes as string ?? new Date().getMonth() + 1 + "");
    const anoNum = parseInt(ano as string ?? new Date().getFullYear() + "");
    try {
      const { rows } = await pool.query(
        `SELECT
           funcionario_id,
           COUNT(*) AS dias_registrados,
           SUM(CASE WHEN status = 'falta' THEN 1 ELSE 0 END) AS faltas,
           SUM(CASE WHEN status = 'atestado' THEN 1 ELSE 0 END) AS atestados,
           COALESCE(SUM(horas_trabalhadas), 0) AS total_horas,
           COALESCE(SUM(horas_extras), 0) AS total_extras
         FROM people_ponto
         WHERE tenant_id = $1
           AND EXTRACT(MONTH FROM data) = $2
           AND EXTRACT(YEAR  FROM data) = $3
         GROUP BY funcionario_id
         ORDER BY funcionario_id`,
        [tenantId, mesNum, anoNum]
      );
      res.json({ mes: mesNum, ano: anoNum, relatorio: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Férias ───────────────────────────────────────────────────────────────

  app.post("/api/rh/ferias/solicitar", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const parsed = feriasSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const d = parsed.data;
    let diasGozados = 0;
    if (d.dataInicio && d.dataFim) {
      const ms = new Date(d.dataFim).getTime() - new Date(d.dataInicio).getTime();
      diasGozados = Math.round(ms / 86400000) + 1;
    }
    try {
      const { rows } = await pool.query(`
        INSERT INTO people_ferias
          (tenant_id, funcionario_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim,
           dias_direito, dias_gozados, dias_vendidos, data_inicio, data_fim, observacoes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente') RETURNING *`,
        [tenantId, d.funcionarioId, d.periodoAquisitivoInicio, d.periodoAquisitivoFim,
         d.diasDireito ?? 30, diasGozados, d.diasVendidos ?? 0,
         d.dataInicio ?? null, d.dataFim ?? null, d.observacoes ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/rh/ferias", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const { funcionarioId, status } = req.query;
    const conditions = ["tenant_id = $1"];
    const params: any[] = [tenantId];
    let i = 2;
    if (funcionarioId) { conditions.push(`funcionario_id = $${i}`); params.push(funcionarioId); i++; }
    if (status)        { conditions.push(`status = $${i}`);          params.push(status);        i++; }
    try {
      const { rows } = await pool.query(
        `SELECT * FROM people_ferias WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`,
        params
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/rh/ferias/:id/aprovar", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    try {
      const { rows } = await pool.query(`
        UPDATE people_ferias
        SET status = 'programada', aprovado_por = $1, aprovado_em = NOW(), updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND status = 'pendente' RETURNING *`,
        [userId, req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Férias não encontradas ou já processadas" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/rh/ferias/:id/rejeitar", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    const userId   = (req as any).user?.id as string;
    const { motivo } = req.body;
    try {
      const { rows } = await pool.query(`
        UPDATE people_ferias
        SET status = 'rejeitado', aprovado_por = $1, aprovado_em = NOW(),
            observacoes = COALESCE($2, observacoes), updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 AND status = 'pendente' RETURNING *`,
        [userId, motivo ?? null, req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Férias não encontradas ou já processadas" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/rh/ferias/:id/iniciar", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(`
        UPDATE people_ferias SET status = 'em_gozo', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'programada' RETURNING *`,
        [req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Férias não encontradas ou não programadas" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/rh/ferias/:id/concluir", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(`
        UPDATE people_ferias SET status = 'concluida', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'em_gozo' RETURNING *`,
        [req.params.id, tenantId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Férias não encontradas ou não em gozo" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/rh/ferias/vencidas", ...auth, async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM people_ferias
         WHERE tenant_id = $1
           AND status NOT IN ('concluida','rejeitado')
           AND periodo_aquisitivo_fim < CURRENT_DATE - INTERVAL '1 year'
         ORDER BY periodo_aquisitivo_fim`,
        [tenantId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
