// Code Explorer (Fase 5) — helpers de filesystem com guards de segurança.
// Funciona sobre o repo interno por tenant criado pelo InternalGit (Fase 1).
import { promises as fs } from "fs";
import * as path from "path";
import { repoDirForTenant, getInternalGitForTenant } from "../devCenter/internalGit";

export const MAX_FILE_BYTES = 1_000_000; // 1 MB — acima disso, devolvemos preview truncado.
export const MAX_SEARCH_RESULTS = 200;

// Diretórios e nomes bloqueados em QUALQUER profundidade (read/write/list/search/diff/history).
// Defesa-em-profundidade — InternalGit já bloqueia .git/ e `..`.
// Match é feito por segmento (ex.: "client/node_modules/x" também é bloqueado).
const BLOCKED_DIR_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".local",       // skills, sessões, secrets locais
  "dist",
  "build",
  ".cache",
  ".pnpm-store",
]);

// Nomes de arquivo sensíveis (em qualquer diretório).
const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".npmrc",
  ".pnpmrc",
]);

const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svg",
  "pdf", "zip", "gz", "tar", "rar", "7z", "exe", "dll", "so", "dylib",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "ttf", "woff", "woff2", "eot",
  "wasm", "node", "psd", "ai", "sketch", "fig",
]);

export function isPathBlocked(rel: string): boolean {
  const cleaned = (rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) return false;
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  // Qualquer segmento intermediário ou final que coincida com diretório bloqueado.
  for (const seg of segments) {
    if (BLOCKED_DIR_SEGMENTS.has(seg)) return true;
  }
  // Nome do arquivo (último segmento) — bloqueia .env, .env.* e nomes sensíveis em qualquer profundidade.
  const base = segments[segments.length - 1];
  if (BLOCKED_FILE_NAMES.has(base)) return true;
  if (/^\.env(\..+)?$/.test(base)) return true;
  return false;
}

export function isBinaryExt(filePath: string): boolean {
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return false;
  return BINARY_EXTS.has(m[1]);
}

// Heurística de binário por sniff dos primeiros bytes (procura NUL).
export function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

export interface TreeEntry {
  name: string;
  path: string; // relativo ao repo
  type: "dir" | "file";
  size?: number;
  blocked?: boolean;
}

// Garante que o repo do tenant existe (cria primeira vez se preciso).
export async function ensureTenantRepo(tenantId: string): Promise<{ repoDir: string }> {
  const t = await getInternalGitForTenant(tenantId);
  await t.client.ensureRepo("Repositório do Code Explorer (Fase 5)");
  return { repoDir: repoDirForTenant(tenantId) };
}

// Resolve caminho absoluto seguro dentro do repo do tenant.
export function safeResolve(tenantId: string, relPath: string): string {
  const root = repoDirForTenant(tenantId);
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.split("/").some((seg) => seg === "..")) {
    throw new Error("Caminho inválido (contém '..')");
  }
  const abs = path.resolve(root, cleaned);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error("Caminho fora do repositório");
  }
  return abs;
}

// Lista 1 nível do diretório (lazy load). Retorna entries ordenados (dirs antes).
export async function listDir(tenantId: string, relPath: string = ""): Promise<TreeEntry[]> {
  const { repoDir } = await ensureTenantRepo(tenantId);
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned && isPathBlocked(cleaned)) return [];
  const abs = safeResolve(tenantId, cleaned);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];
  const names = await fs.readdir(abs);
  const entries: TreeEntry[] = [];
  for (const name of names) {
    if (name === ".git") continue; // sempre escondido
    const childRel = cleaned ? `${cleaned}/${name}` : name;
    const childAbs = path.join(abs, name);
    const blocked = isPathBlocked(childRel);
    let type: "dir" | "file" = "file";
    let size: number | undefined;
    try {
      const s = await fs.lstat(childAbs);
      if (s.isSymbolicLink()) continue; // ignora symlinks por segurança
      type = s.isDirectory() ? "dir" : "file";
      size = s.isFile() ? s.size : undefined;
    } catch {
      continue;
    }
    entries.push({ name, path: childRel, type, size, blocked });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export interface FileReadResult {
  path: string;
  content: string | null;
  size: number;
  truncated: boolean;
  binary: boolean;
  blocked: boolean;
  ref?: string;
}

// Lê arquivo (HEAD ou ref específico via git show).
export async function readFile(
  tenantId: string,
  relPath: string,
  ref?: string,
): Promise<FileReadResult> {
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) throw new Error("Caminho vazio");
  if (isPathBlocked(cleaned)) {
    return { path: cleaned, content: null, size: 0, truncated: false, binary: false, blocked: true, ref };
  }
  if (isBinaryExt(cleaned)) {
    // size ainda útil para UI
    const abs = safeResolve(tenantId, cleaned);
    const s = await fs.stat(abs).catch(() => null);
    return {
      path: cleaned,
      content: null,
      size: s?.size ?? 0,
      truncated: false,
      binary: true,
      blocked: false,
      ref,
    };
  }

  if (ref) {
    // Lê via git show — usa o InternalGit para ref histórico.
    const t = await getInternalGitForTenant(tenantId);
    const content = await t.client.getFileContent("", "", cleaned, ref);
    if (content == null) {
      return { path: cleaned, content: null, size: 0, truncated: false, binary: false, blocked: false, ref };
    }
    const buf = Buffer.from(content, "utf8");
    const binary = looksBinary(buf);
    if (binary) {
      return { path: cleaned, content: null, size: buf.length, truncated: false, binary: true, blocked: false, ref };
    }
    if (buf.length > MAX_FILE_BYTES) {
      return {
        path: cleaned,
        content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"),
        size: buf.length,
        truncated: true,
        binary: false,
        blocked: false,
        ref,
      };
    }
    return { path: cleaned, content, size: buf.length, truncated: false, binary: false, blocked: false, ref };
  }

  await ensureTenantRepo(tenantId);
  const abs = safeResolve(tenantId, cleaned);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) {
    return { path: cleaned, content: null, size: 0, truncated: false, binary: false, blocked: false, ref };
  }
  if (!stat.isFile()) throw new Error("Não é um arquivo");
  // Sniff binário via head bytes.
  const fd = await fs.open(abs, "r");
  try {
    const head = Buffer.alloc(Math.min(8000, stat.size));
    if (head.length > 0) await fd.read(head, 0, head.length, 0);
    if (looksBinary(head)) {
      return { path: cleaned, content: null, size: stat.size, truncated: false, binary: true, blocked: false };
    }
    if (stat.size > MAX_FILE_BYTES) {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      await fd.read(buf, 0, MAX_FILE_BYTES, 0);
      return {
        path: cleaned,
        content: buf.toString("utf8"),
        size: stat.size,
        truncated: true,
        binary: false,
        blocked: false,
      };
    }
  } finally {
    await fd.close();
  }
  const content = await fs.readFile(abs, "utf8");
  return { path: cleaned, content, size: stat.size, truncated: false, binary: false, blocked: false };
}

// Escreve + commita. Retorna { sha, noop }.
export async function writeFile(
  tenantId: string,
  relPath: string,
  content: string,
  message: string,
): Promise<{ sha: string | null; noop: boolean }> {
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) throw new Error("Caminho vazio");
  if (isPathBlocked(cleaned)) throw new Error("Caminho bloqueado por política");
  if (isBinaryExt(cleaned)) throw new Error("Edição de arquivos binários não suportada");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error(`Arquivo excede o limite de ${MAX_FILE_BYTES} bytes`);
  }
  const t = await getInternalGitForTenant(tenantId);
  await t.client.ensureRepo();
  const result = await t.client.commitFile("", "", cleaned, content, message);
  if (!result) return { sha: null, noop: true };
  return { sha: result.commit.sha, noop: false };
}

// Diff de um arquivo entre 2 refs (ou 1 ref vs HEAD se ref2 omitido).
// Retorna o conteúdo bruto dos dois lados para alimentar um Monaco DiffEditor.
// `ref2` opcional → compara `ref1` (antigo) com HEAD (atual em disco).
export interface DiffResult {
  path: string;
  ref1: string;
  ref2: string;
  left: string;
  right: string;
  binary: boolean;
}
export async function diffFile(
  tenantId: string,
  relPath: string,
  ref1: string,
  ref2?: string,
): Promise<DiffResult> {
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) throw new Error("Caminho vazio");
  if (isPathBlocked(cleaned)) throw new Error("Caminho bloqueado por política");
  if (isBinaryExt(cleaned)) {
    return { path: cleaned, ref1, ref2: ref2 ?? "HEAD", left: "", right: "", binary: true };
  }
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref1)) throw new Error("ref1 inválido");
  if (ref2 && !/^[A-Za-z0-9._/-]{1,200}$/.test(ref2)) throw new Error("ref2 inválido");
  await ensureTenantRepo(tenantId);
  const repoDir = repoDirForTenant(tenantId);
  const { simpleGit } = await import("simple-git");
  const git = simpleGit({ baseDir: repoDir });
  const showAt = async (ref: string): Promise<string> => {
    try {
      return await git.raw(["show", `${ref}:${cleaned}`]);
    } catch {
      return ""; // arquivo não existia naquele ref
    }
  };
  const left = await showAt(ref1);
  const right = ref2 ? await showAt(ref2) : await showAt("HEAD");
  return { path: cleaned, ref1, ref2: ref2 ?? "HEAD", left, right, binary: false };
}

// History de um arquivo (git log -- file). Reaproveita listCommits + path filter manual.
export async function fileHistory(
  tenantId: string,
  relPath: string,
  limit: number = 50,
): Promise<Array<{ sha: string; message: string; authorName: string; authorEmail: string; date: string }>> {
  const cleaned = (relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || isPathBlocked(cleaned)) return [];
  await ensureTenantRepo(tenantId);
  const repoDir = repoDirForTenant(tenantId);
  // Usa simple-git diretamente — InternalGit listCommits filtra por subdir, não por arquivo.
  const { simpleGit } = await import("simple-git");
  const git = simpleGit({ baseDir: repoDir });
  const args = ["log", `--max-count=${Math.max(1, Math.min(limit, 200))}`, "--pretty=format:%H%x1F%s%x1F%an%x1F%ae%x1F%aI", "--", cleaned];
  let raw = "";
  try {
    raw = await git.raw(args);
  } catch {
    return [];
  }
  const out: Array<{ sha: string; message: string; authorName: string; authorEmail: string; date: string }> = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [sha, msg, an, ae, date] = line.split("\u001F");
    if (!sha) continue;
    out.push({ sha, message: msg ?? "", authorName: an ?? "", authorEmail: ae ?? "", date: date ?? "" });
  }
  return out;
}
