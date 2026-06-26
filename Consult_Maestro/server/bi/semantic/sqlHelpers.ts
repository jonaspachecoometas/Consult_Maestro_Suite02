/**
 * Helpers usados pela Semantic Layer para montar SQL com segurança.
 * Como a layer concatena strings em vez de prepared statements
 * (necessário para `db.execute(sql.raw())` no Drizzle), todo valor que
 * entra precisa passar por `quoteIdent` ou `quoteLiteral`.
 */

const UUID_LIKE = /^[a-zA-Z0-9_-]{8,64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function quoteIdent(v: string): string {
  if (!UUID_LIKE.test(v)) {
    throw new Error(`SemanticLayer: identifier inválido: ${v}`);
  }
  return `'${v}'`;
}

export function quoteIsoDate(v: string): string {
  if (!ISO_DATE.test(v)) {
    throw new Error(`SemanticLayer: data inválida: ${v}`);
  }
  return `'${v}'`;
}

export function sourcesClause(column: string, sources?: string[]): string {
  if (!sources || sources.length === 0) return "";
  const ids = sources.filter((s) => UUID_LIKE.test(s));
  if (ids.length === 0) return "";
  return ` AND ${column} IN (${ids.map((s) => `'${s}'`).join(",")})`;
}

export function dateRangeClause(column: string, start?: string, end?: string): string {
  const parts: string[] = [];
  if (start && ISO_DATE.test(start)) parts.push(`${column} >= '${start}'::date`);
  if (end && ISO_DATE.test(end)) parts.push(`${column} <= '${end}'::date`);
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}
