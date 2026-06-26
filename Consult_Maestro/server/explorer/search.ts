// Code Explorer (Fase 5) — busca global no repo do tenant via ripgrep.
// ripgrep já respeita .gitignore e ignora binários por padrão. Adicionamos
// glob excludes extras para os padrões da blocklist.
import { spawn } from "child_process";
import { ensureTenantRepo, isPathBlocked } from "./fileService";

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  pathGlob?: string;
}

const EXCLUDE_GLOBS = [
  "!.env",
  "!.env.*",
  "!**/.env",
  "!**/.env.*",
  "!**/.npmrc",
  "!**/.pnpmrc",
  "!.git",
  "!**/.git",
  "!node_modules",
  "!**/node_modules",
  "!.local",
  "!**/.local",
  "!dist",
  "!**/dist",
  "!build",
  "!**/build",
  "!.cache",
  "!**/.cache",
  "!.pnpm-store",
  "!**/.pnpm-store",
  "!*.lock",
];

// Tokens proibidos no pathGlob fornecido pelo usuário.
// Mesmo se a lib aceitar, recusamos qualquer glob que tente "alcançar"
// um diretório/arquivo da blocklist — defesa-em-profundidade contra
// override das exclusões pelo include do usuário.
const FORBIDDEN_GLOB_TOKENS = [
  ".git",
  "node_modules",
  ".local",
  "dist",
  "build",
  ".cache",
  ".pnpm-store",
  ".env",
  ".npmrc",
  ".pnpmrc",
];

export async function searchRepo(
  tenantId: string,
  opts: SearchOptions,
): Promise<{ hits: SearchHit[]; truncated: boolean; durationMs: number }> {
  const query = (opts.query ?? "").trim();
  if (!query) return { hits: [], truncated: false, durationMs: 0 };
  if (query.length > 500) throw new Error("Query muito longa");

  const { repoDir } = await ensureTenantRepo(tenantId);
  const max = Math.min(Math.max(opts.maxResults ?? 200, 1), 500);

  const args: string[] = [
    "--json",
    "--max-count=10",       // até 10 ocorrências por arquivo
    "--max-columns=300",    // evita preview gigante
    "--max-filesize=1M",
    "--no-heading",
  ];
  if (!opts.regex) args.push("--fixed-strings");
  if (!opts.caseSensitive) args.push("--ignore-case");

  // Aplica include do usuário ANTES dos excludes — em ripgrep, o último
  // glob a casar vence; queremos que excludes da blocklist sempre vençam.
  if (opts.pathGlob) {
    // Sanitiza glob — só permite alfanumérico, /, *, ?, ., -, _.
    if (!/^[A-Za-z0-9*?./_\-]+$/.test(opts.pathGlob)) {
      throw new Error("Glob inválido");
    }
    const lower = opts.pathGlob.toLowerCase();
    const segments = lower.split("/").filter(Boolean);
    for (const seg of segments) {
      for (const tok of FORBIDDEN_GLOB_TOKENS) {
        // Match:
        //   exato (".env", "node_modules", "dist")
        //   prefix dotted (".env.local", ".env.*", ".env.production")
        //   suffix dotted ("*.env" como segmento)
        //   wildcards adjacentes ("*node_modules", "node_modules*", "*.env", "node_modules.*")
        if (
          seg === tok ||
          seg.startsWith(tok + ".") ||
          seg.endsWith("." + tok) ||
          seg === "*" + tok ||
          seg === tok + "*" ||
          seg === "*." + tok ||
          seg === tok + ".*"
        ) {
          throw new Error("Glob aponta para caminho bloqueado");
        }
      }
    }
    args.push("-g", opts.pathGlob);
  }
  for (const g of EXCLUDE_GLOBS) args.push("-g", g);
  args.push("--", query, ".");

  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd: repoDir });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timeout = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, 15_000);
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killed) return reject(new Error("Busca excedeu o tempo limite"));
      // rg exit code: 0=hits, 1=no hits, 2=error
      if (code === 2) return reject(new Error(stderr.trim() || "Erro na busca"));
      const hits: SearchHit[] = [];
      let truncated = false;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== "match") continue;
          const filePath = obj.data?.path?.text ?? "";
          const lineNumber = obj.data?.line_number ?? 0;
          const submatches = obj.data?.submatches ?? [];
          const lines = obj.data?.lines?.text ?? "";
          const nlIdx = lines.indexOf("\n");
          const previewLine = nlIdx >= 0 ? lines.slice(0, nlIdx) : lines;
          const column = submatches[0]?.start ?? 0;
          // Defesa-em-profundidade: descarta qualquer hit cujo path
          // bata com a blocklist, mesmo que o rg tenha aceito.
          if (filePath && isPathBlocked(filePath)) continue;
          hits.push({
            path: filePath,
            line: lineNumber,
            column: column + 1,
            preview: previewLine.slice(0, 300),
          });
          if (hits.length >= max) {
            truncated = true;
            try { child.kill("SIGTERM"); } catch { /* ignore */ }
            break;
          }
        } catch {
          /* ignora linhas inválidas */
        }
      }
      resolve({ hits, truncated, durationMs: Date.now() - started });
    });
  });
}
