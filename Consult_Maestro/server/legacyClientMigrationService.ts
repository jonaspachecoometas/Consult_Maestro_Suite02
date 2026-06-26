// ============================================================================
// Migração: cadastro legado "clients" → "pessoas" (CRM 2.0).
// Idempotente: usa pessoas.legacyClientId. Se já existe pessoa para o mesmo
// (tenantId, legacyClientId), pula. NÃO mexe na tabela "clients" — só copia.
// ============================================================================
import { db } from "./db";
import {
  clients as clientsTable,
  pessoas,
  enderecos,
  contatos,
  pessoaPapeis,
  clientContacts,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const onlyDigits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");

function isValidEmail(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export interface MigrationSummary {
  total: number;
  created: number;
  skipped: number;
  enderecosCreated: number;
  contatosCreated: number;
  errors: Array<{ legacyClientId: string; name: string; error: string }>;
}

export async function migrateLegacyClientesToPessoas(
  tenantId: string,
  userId: string | null,
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    total: 0,
    created: 0,
    skipped: 0,
    enderecosCreated: 0,
    contatosCreated: 0,
    errors: [],
  };

  // 1) Buscar todos os clients do tenant
  const legacy = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.tenantId, tenantId));
  summary.total = legacy.length;
  if (!legacy.length) return summary;

  // 2) Mapear quem já tem pessoa criada (idempotência)
  const legacyIds = legacy.map((c) => c.id);
  const existing = await db
    .select({ id: pessoas.id, legacyClientId: pessoas.legacyClientId })
    .from(pessoas)
    .where(and(eq(pessoas.tenantId, tenantId), inArray(pessoas.legacyClientId, legacyIds)));
  const alreadyMigrated = new Set(existing.map((p) => p.legacyClientId).filter(Boolean) as string[]);

  // 3) Migrar cada cliente faltante
  for (const c of legacy) {
    if (alreadyMigrated.has(c.id)) {
      summary.skipped++;
      continue;
    }
    try {
      // Heurística PJ vs PF: se tem nome de empresa/razão, considerar PJ.
      const tipoPessoa = c.company && c.company.trim().length > 0 ? "PJ" : "PF";
      const nomeFantasia = (c.name || c.company || "Sem nome").trim().slice(0, 255);
      const razaoSocial = c.company ? c.company.trim().slice(0, 255) : null;

      // Sem CNPJ/CPF no legado → gerar placeholder único pra honrar NOT NULL +
      // unique(tenant, cnpj_cpf). Prefixo "LEG-" deixa claro que é vínculo legado.
      const cnpjCpf = `LEG-${c.id.slice(0, 16)}`;

      const [novaPessoa] = await db
        .insert(pessoas)
        .values({
          tenantId,
          tipoPessoa,
          nomeFantasia,
          razaoSocial,
          cnpjCpf,
          status: "ativo",
          observacoes: c.notes || null,
          legacyClientId: c.id,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: pessoas.id });

      // Papel "cliente" ativo
      await db.insert(pessoaPapeis).values({
        pessoaId: novaPessoa.id,
        tenantId,
        tipoPapel: "cliente",
        status: "ativo",
        metadata: { migratedFromLegacyClientId: c.id },
      });

      // Endereço (legado tem só campo `address` em texto livre)
      if (c.address && c.address.trim()) {
        await db.insert(enderecos).values({
          pessoaId: novaPessoa.id,
          tipo: "principal",
          logradouro: c.address.trim().slice(0, 255),
          isPrincipal: 1,
        });
        summary.enderecosCreated++;
      }

      // Contatos: email e telefone do próprio cliente
      const contatosToInsert: Array<{
        pessoaId: string;
        tipo: string;
        valor: string;
        isPrincipal: number;
      }> = [];
      if (isValidEmail(c.email)) {
        contatosToInsert.push({
          pessoaId: novaPessoa.id,
          tipo: "email",
          valor: c.email!.trim().toLowerCase(),
          isPrincipal: 1,
        });
      }
      const phoneDigits = onlyDigits(c.phone);
      if (phoneDigits.length >= 8) {
        contatosToInsert.push({
          pessoaId: novaPessoa.id,
          tipo: "telefone",
          valor: c.phone!.trim(),
          isPrincipal: 1,
        });
      }
      if (contatosToInsert.length) {
        await db.insert(contatos).values(contatosToInsert);
        summary.contatosCreated += contatosToInsert.length;
      }

      // Bônus: se a tabela legacy client_contacts tiver entradas pro cliente,
      // copiar email/telefone como contatos NÃO-principais (preserva histórico).
      const cc = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, c.id));
      const extras: typeof contatosToInsert = [];
      for (const ct of cc) {
        if (isValidEmail(ct.email)) {
          extras.push({
            pessoaId: novaPessoa.id,
            tipo: "email",
            valor: ct.email!.trim().toLowerCase(),
            isPrincipal: 0,
          });
        }
        const tel = onlyDigits(ct.phone);
        if (tel.length >= 8) {
          extras.push({
            pessoaId: novaPessoa.id,
            tipo: "telefone",
            valor: ct.phone!.trim(),
            isPrincipal: 0,
          });
        }
        const cel = onlyDigits(ct.mobile);
        if (cel.length >= 8) {
          extras.push({
            pessoaId: novaPessoa.id,
            tipo: "celular",
            valor: ct.mobile!.trim(),
            isPrincipal: 0,
          });
        }
      }
      if (extras.length) {
        await db.insert(contatos).values(extras);
        summary.contatosCreated += extras.length;
      }

      summary.created++;
    } catch (err: any) {
      summary.errors.push({
        legacyClientId: c.id,
        name: c.name || "(sem nome)",
        error: err?.message || String(err),
      });
    }
  }

  return summary;
}

export async function findPessoaByLegacyClientId(
  tenantId: string,
  legacyClientId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: pessoas.id })
    .from(pessoas)
    .where(and(eq(pessoas.tenantId, tenantId), eq(pessoas.legacyClientId, legacyClientId)))
    .limit(1);
  return row || null;
}
