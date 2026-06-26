/**
 * importService.ts — Importação em massa de credores Recovery.
 *
 * Aceita XLSX/XLS/CSV. Cabeçalhos esperados (case-insensitive, acentos
 * removidos; alguns sinônimos também aceitos):
 *
 *   credor_nome | nome | credor                  → credor_nome (obrigatório)
 *   credor_documento | cnpj | cpf | documento    → credor_documento
 *   tipo_credor | tipo                            → tipo_credor (banco|fornecedor|tributos|trabalhista|utility|judicial|outro)
 *   tipo_debito | debito                          → tipo_debito
 *   numero_documento | doc | nf                   → numero_documento
 *   valor_original | valor | principal            → valor_original (obrigatório)
 *   juros                                         → juros
 *   multas | multa                                → multas
 *   correcao_monetaria | correcao                 → correcao_monetaria
 *   valor_atualizado | total                      → valor_atualizado
 *   data_vencimento_original | vencimento | data  → data_vencimento_original
 *   prioridade                                    → prioridade (critica|alta|media|baixa)
 *   garantias                                     → garantias
 *   observacoes | obs                             → observacoes
 *
 * Estratégia: cada linha é uma INSERT independente. Se uma linha falhar,
 * registra o erro e segue. Total/criados/erros retornados ao final.
 */
import * as XLSX from "xlsx";
import { db } from "./../db";
import { recoveryCreditors, recoveryTimeline } from "@shared/schema";

export interface CreditorImportError {
  linha: number;
  identificacao: string;
  erro: string;
}
export interface CreditorImportResult {
  total: number;
  criados: number;
  erros: CreditorImportError[];
  duracaoMs: number;
}

const VAZIOS = new Set(["", "---", "--", "null", "undefined", "n/a", "n/d", "-"]);

function isVazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return VAZIOS.has(v.trim().toLowerCase());
  return false;
}

function txt(v: unknown): string | null {
  if (isVazio(v)) return null;
  return String(v).trim();
}

function normalizarChave(k: string): string {
  return k
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[\s\-./()]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const TIPO_CREDOR_VALIDOS = ["banco", "fornecedor", "tributos", "trabalhista", "utility", "judicial", "outro"];
const PRIORIDADES_VALIDAS = ["critica", "alta", "media", "baixa"];

function normalizarTipoCredor(v: unknown): string {
  const s = txt(v)?.toLowerCase() ?? "fornecedor";
  if (TIPO_CREDOR_VALIDOS.includes(s)) return s;
  // Sinônimos comuns
  if (/banco|financeira|cef|caixa|bndes|itau|santander|bradesco/.test(s)) return "banco";
  if (/fisco|imposto|receita|icms|iss|inss|pis|cofins|tribut|fgts/.test(s)) return "tributos";
  if (/trabalh|reclama|empregad|sindical/.test(s)) return "trabalhista";
  if (/luz|agua|energia|gas|telefon|internet|aluguel/.test(s)) return "utility";
  if (/judic|process/.test(s)) return "judicial";
  if (/forneced|materia|insumo|servic/.test(s)) return "fornecedor";
  return "outro";
}

function normalizarPrioridade(v: unknown): string {
  const s = txt(v)?.toLowerCase() ?? "media";
  if (PRIORIDADES_VALIDAS.includes(s)) return s;
  if (s.startsWith("crit") || s === "1") return "critica";
  if (s.startsWith("alt") || s === "2") return "alta";
  if (s.startsWith("baix") || s === "4") return "baixa";
  return "media";
}

/** Converte número BR/US (ex.: "1.234,56" ou "1234.56") em string numérica decimal "1234.56". */
function parseValor(v: unknown): string {
  if (isVazio(v)) return "0";
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  let s = String(v).trim();
  // Remove R$, espaços
  s = s.replace(/r\$\s*/i, "").replace(/\s+/g, "");
  // Heurística: se tem vírgula E ponto, ponto é milhar. Se só vírgula, vírgula é decimal.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : "0";
}

function converterData(v: unknown): string | null {
  if (isVazio(v)) return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 1) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

const SINONIMOS: Record<string, string> = {
  // credor_nome
  nome: "credor_nome",
  credor: "credor_nome",
  razao_social: "credor_nome",
  // documento
  cnpj: "credor_documento",
  cpf: "credor_documento",
  documento: "credor_documento",
  cnpj_cpf: "credor_documento",
  // tipo
  tipo: "tipo_credor",
  natureza: "tipo_credor",
  // tipo debito
  debito: "tipo_debito",
  descricao: "tipo_debito",
  // num doc
  doc: "numero_documento",
  nf: "numero_documento",
  numero_nf: "numero_documento",
  numero: "numero_documento",
  // valor
  valor: "valor_original",
  principal: "valor_original",
  saldo: "valor_original",
  saldo_devedor: "valor_atualizado",
  total: "valor_atualizado",
  // multa
  multa: "multas",
  correcao: "correcao_monetaria",
  atualizacao: "correcao_monetaria",
  // data
  vencimento: "data_vencimento_original",
  data_vencimento: "data_vencimento_original",
  data: "data_vencimento_original",
  // texto
  obs: "observacoes",
  observacao: "observacoes",
  garantia: "garantias",
};

function mapearLinha(rawRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const key = normalizarChave(k);
    const canon = SINONIMOS[key] ?? key;
    if (out[canon] === undefined) out[canon] = v;
  }
  return out;
}

function parseBuffer(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
}

export async function importarCreditores(
  tenantId: string,
  processId: string,
  buffer: Buffer,
  userId: string | null,
): Promise<CreditorImportResult> {
  const start = Date.now();
  const rows = parseBuffer(buffer);
  const result: CreditorImportResult = { total: rows.length, criados: 0, erros: [], duracaoMs: 0 };

  for (let i = 0; i < rows.length; i++) {
    const linha = i + 2; // +2 = +1 (1-indexed) +1 (header)
    try {
      const m = mapearLinha(rows[i]);
      const credorNome = txt(m.credor_nome);
      if (!credorNome) {
        result.erros.push({ linha, identificacao: "?", erro: "credor_nome (ou nome) é obrigatório" });
        continue;
      }
      const valorOriginal = parseValor(m.valor_original);
      const valorAtualizado = parseValor(m.valor_atualizado ?? m.valor_original);
      await db.insert(recoveryCreditors).values({
        tenantId,
        processId,
        credorNome,
        credorDocumento: txt(m.credor_documento),
        tipoCredor: normalizarTipoCredor(m.tipo_credor),
        tipoDebito: txt(m.tipo_debito),
        numeroDocumento: txt(m.numero_documento),
        valorOriginal: valorOriginal,
        juros: parseValor(m.juros),
        multas: parseValor(m.multas),
        correcaoMonetaria: parseValor(m.correcao_monetaria),
        valorAtualizado: valorAtualizado,
        dataVencimentoOriginal: converterData(m.data_vencimento_original),
        prioridade: normalizarPrioridade(m.prioridade),
        garantias: txt(m.garantias),
        observacoes: txt(m.observacoes),
        statusNegociacao: "pendente",
      } as any);
      result.criados++;
    } catch (err: any) {
      const ident = String((rows[i] as any)?.credor_nome ?? (rows[i] as any)?.nome ?? "?");
      result.erros.push({ linha, identificacao: ident, erro: err?.message ?? String(err) });
    }
  }

  // Registra evento na timeline
  if (result.criados > 0) {
    try {
      await db.insert(recoveryTimeline).values({
        tenantId,
        processId,
        eventType: "creditor_imported",
        title: `Importação em massa: ${result.criados} credores`,
        description: `Foram importados ${result.criados} credores de uma planilha (${result.erros.length} erros).`,
        payload: { criados: result.criados, erros: result.erros.length, total: result.total },
        createdById: userId ?? undefined,
      } as any);
    } catch {
      /* não bloqueia o resultado */
    }
  }

  result.duracaoMs = Date.now() - start;
  return result;
}
