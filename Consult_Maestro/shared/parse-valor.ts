/**
 * Parser e formatador de valor monetário em pt-BR / en-US.
 * Usado em frontend (preview/validação) e backend (persistência) — fonte única de verdade.
 *
 * Aceita:
 *  - number: retorna direto
 *  - "1500"           → 1500
 *  - "1500.00"        → 1500
 *  - "1500,00"        → 1500
 *  - "1.500,00"       → 1500     (BR: ponto milhar, vírgula decimal)
 *  - "1,500.00"       → 1500     (US: vírgula milhar, ponto decimal)
 *  - "1.500"          → 1500     (BR milhar — desambiguado pela regra abaixo)
 *  - "1,500"          → 1500     (US milhar)
 *  - "1.5"            → 1.5      (decimal)
 *  - "1.50"           → 1.5      (decimal)
 *  - "R$ 12.345,67"   → 12345.67
 *
 * Heurística:
 *  - Remove "R$" e espaços.
 *  - Se há ambos . e ,, o ÚLTIMO é o decimal.
 *  - Se há apenas UM separador (. ou ,) e EXATAMENTE 3 dígitos depois,
 *    trata como milhar (não decimal). Ex: "1.500" → 1500.
 *  - Caso contrário, separador único é decimal.
 *
 * Retorna NaN se inválido. NÃO faz fallback silencioso para 0.
 */
export function parseValorBR(v: unknown): number {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const raw = String(v).trim().replace(/\s/g, "").replace(/^R\$\s*/i, "");
  if (!raw) return NaN;

  // Sinal opcional
  let s = raw;
  let sign = 1;
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); }
  else if (s.startsWith("+")) { s = s.slice(1); }

  // Apenas dígitos, "." e ","
  if (!/^[\d.,]+$/.test(s)) return NaN;

  const ultPonto = s.lastIndexOf(".");
  const ultVirgula = s.lastIndexOf(",");

  let normalizado: string;
  if (ultPonto === -1 && ultVirgula === -1) {
    normalizado = s;
  } else if (ultPonto !== -1 && ultVirgula !== -1) {
    // Ambos presentes: o último é o decimal
    if (ultVirgula > ultPonto) {
      normalizado = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalizado = s.replace(/,/g, "");
    }
  } else {
    // Apenas um separador
    const sep = ultPonto !== -1 ? "." : ",";
    const idx = ultPonto !== -1 ? ultPonto : ultVirgula;
    const digitsAfter = s.length - idx - 1;
    const ocorrencias = (s.match(new RegExp(`\\${sep}`, "g")) || []).length;
    if (ocorrencias > 1) {
      // Múltiplos separadores iguais (ex: "1.234.567") → todos são milhar
      normalizado = s.replace(new RegExp(`\\${sep}`, "g"), "");
    } else if (digitsAfter === 3) {
      // Único separador com 3 dígitos depois → milhar (ex: "1.500" → 1500)
      normalizado = s.replace(sep, "");
    } else {
      // Decimal (ex: "1.5", "1.50", "1500.00", "0,99")
      normalizado = sep === "," ? s.replace(",", ".") : s;
    }
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return NaN;
  return sign * n;
}

const FMT_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatValorBR(v: unknown): string {
  const n = parseValorBR(v);
  return Number.isFinite(n) ? FMT_BRL.format(n) : "";
}
