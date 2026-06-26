import { promises as fs } from "fs";
import * as path from "path";

const CONSULT_ROOT = process.env.CONSULT_ROOT || process.cwd();
const MAX_FILE_CHARS = 6000;

const ANCHOR_FILES = [
  "replit.md",
  "package.json",
  "shared/schema.ts",
  "server/routes.ts",
  "server/storage.ts",
  "client/src/App.tsx",
] as const;

const CONVENTIONS = `### Convenções obrigatórias do Arcádia Consult

- Stack: React 18 + TypeScript + Vite (cliente) / Node + Express + Drizzle ORM + PostgreSQL (servidor).
- Multi-tenancy: TODA tabela de negócio inclui coluna \`tenant_id\` e índice por tenant.
- Toda rota protegida usa: \`isAuthenticated\`, \`tenantContext\` e \`requireTenant\` (ver server/auth/middleware).
- Validação de payloads SEMPRE com Zod (createInsertSchema do drizzle-zod). Nunca aceitar req.body cru.
- Storage: chamadas CRUD passam pela interface \`IStorage\` (server/storage.ts) — rotas finas.
- Frontend usa shadcn/ui (New York style), Wouter para rotas, TanStack Query v5 (object form), React Hook Form + Zod.
- Nunca escreva no schema.ts sem o consultor revisar — gere SOMENTE migrations Drizzle (.sql) ou propostas de patch em markdown.
- Nunca use fs.writeFileSync no runtime do servidor; toda escrita de arquivo deve ser assíncrona.
- Português (pt-BR) em UI, comentários e mensagens.
- Componentes interativos precisam de \`data-testid\`.
`;

export interface ConsultContextOptions {
  /** Limita arquivos extras a serem incluídos (relativos ao CONSULT_ROOT). */
  extraFiles?: string[];
}

/**
 * Monta um snippet textual com o contexto mínimo do Arcádia Consult para o
 * Arquiteto. Best-effort: arquivos ausentes são ignorados silenciosamente.
 *
 * Retorno típico cabe em ~30 KB (limitamos buildArchitectUser em 12 KB, então
 * cortamos cada arquivo em 6 KB e reduzimos depois).
 */
export async function readConsultContext(opts: ConsultContextOptions = {}): Promise<string> {
  const blocks: string[] = [CONVENTIONS];
  const files = [...ANCHOR_FILES, ...(opts.extraFiles ?? [])];
  for (const rel of files) {
    // proteção contra path traversal
    const safeRel = rel.replace(/^\/+/, "");
    if (safeRel.split(/[\\/]/).some((seg) => seg === "..")) continue;
    const abs = path.resolve(CONSULT_ROOT, safeRel);
    const rootAbs = path.resolve(CONSULT_ROOT);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) continue;
    try {
      const raw = await fs.readFile(abs, "utf8");
      const trimmed = raw.length > MAX_FILE_CHARS
        ? raw.slice(0, MAX_FILE_CHARS) + "\n... (truncado)"
        : raw;
      const lang = guessLang(safeRel);
      blocks.push(`### ${safeRel}\n\`\`\`${lang}\n${trimmed}\n\`\`\``);
    } catch {
      // arquivo ausente é normal — segue
    }
  }
  return `Contexto do Arcádia Consult (somente leitura — use como fonte da verdade para padrões e tipos).\n\n` +
    blocks.join("\n\n");
}

function guessLang(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": return "ts";
    case ".js": case ".jsx": return "js";
    case ".json": return "json";
    case ".md": return "markdown";
    case ".sql": return "sql";
    case ".py": return "python";
    default: return "";
  }
}
