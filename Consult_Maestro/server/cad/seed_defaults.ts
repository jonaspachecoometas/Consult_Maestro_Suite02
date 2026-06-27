/**
 * CAD-01 — Seed de defaults: condições de pagamento e tabela de preço VAREJO.
 * Idempotente — usa ON CONFLICT DO NOTHING.
 */

import { pool } from '../db';

interface SeedCondicao {
  codigo: string;
  nome: string;
  tipo: string;
  parcelas: { sequencia: number; dias: number; percentual: number; forma_pagamento?: string }[];
}

const CONDICOES: SeedCondicao[] = [
  { codigo: 'AV', nome: 'À Vista', tipo: 'a_vista', parcelas: [] },
  {
    codigo: '30DD', nome: '30 DD', tipo: 'parcelado',
    parcelas: [{ sequencia: 1, dias: 30, percentual: 100 }],
  },
  {
    codigo: '30-60', nome: '30/60', tipo: 'parcelado',
    parcelas: [
      { sequencia: 1, dias: 30, percentual: 50 },
      { sequencia: 2, dias: 60, percentual: 50 },
    ],
  },
  {
    codigo: '30-60-90', nome: '30/60/90', tipo: 'parcelado',
    parcelas: [
      { sequencia: 1, dias: 30, percentual: 33.34 },
      { sequencia: 2, dias: 60, percentual: 33.33 },
      { sequencia: 3, dias: 90, percentual: 33.33 },
    ],
  },
  {
    codigo: '2X', nome: '2x Cartão', tipo: 'parcelado',
    parcelas: [
      { sequencia: 1, dias: 30, percentual: 50, forma_pagamento: '03' },
      { sequencia: 2, dias: 60, percentual: 50, forma_pagamento: '03' },
    ],
  },
  {
    codigo: '3X', nome: '3x Cartão', tipo: 'parcelado',
    parcelas: [
      { sequencia: 1, dias: 30, percentual: 33.34, forma_pagamento: '03' },
      { sequencia: 2, dias: 60, percentual: 33.33, forma_pagamento: '03' },
      { sequencia: 3, dias: 90, percentual: 33.33, forma_pagamento: '03' },
    ],
  },
  {
    codigo: '12X', nome: '12x Cartão', tipo: 'parcelado',
    parcelas: Array.from({ length: 12 }, (_, i) => ({
      sequencia: i + 1,
      dias: (i + 1) * 30,
      percentual: i === 0 ? 8.44 : i === 11 ? 8.3 : parseFloat((100 / 12).toFixed(2)),
      forma_pagamento: '03',
    })),
  },
];

export async function seedCad01Defaults(tenantId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of CONDICOES) {
      const existing = await client.query(
        `SELECT id FROM soe_condicoes_pagamento WHERE tenant_id = $1 AND codigo = $2`,
        [tenantId, c.codigo]
      );

      let cid: string;
      if ((existing.rowCount ?? 0) > 0) {
        cid = existing.rows[0].id;
      } else {
        const isPadrao = c.codigo === 'AV';
        const { rows } = await client.query(
          `INSERT INTO soe_condicoes_pagamento
             (tenant_id, codigo, nome, tipo, padrao)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [tenantId, c.codigo, c.nome, c.tipo, isPadrao]
        );
        cid = rows[0].id;

        for (const p of c.parcelas) {
          await client.query(
            `INSERT INTO soe_condicao_parcelas
               (condicao_pagamento_id, sequencia, dias, percentual, forma_pagamento)
             VALUES ($1,$2,$3,$4,$5)`,
            [cid, p.sequencia, p.dias, p.percentual, p.forma_pagamento ?? null]
          );
        }
      }
    }

    // Tabela de preço padrão VAREJO
    const existeVarejo = await client.query(
      `SELECT id FROM soe_tabelas_preco WHERE tenant_id = $1 AND codigo = 'VAREJO'`,
      [tenantId]
    );
    if ((existeVarejo.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO soe_tabelas_preco
           (tenant_id, codigo, nome, descricao, padrao, tipo_cliente)
         VALUES ($1,'VAREJO','Tabela Varejo','Tabela de preço padrão para varejo',true,'varejo')`,
        [tenantId]
      );
    }

    await client.query('COMMIT');
    console.log(`[CAD-01] Seed defaults executado para tenant ${tenantId}.`);
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('[CAD-01] Erro no seed:', e.message);
    throw e;
  } finally {
    client.release();
  }
}
