import { promises as fs } from "fs";
import * as path from "path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { GiteaBranch, GiteaCommit, GiteaCommitDetail, GiteaCommitFile } from "../infra/giteaClient";
import type { GitClient, PushableGitClient } from "./gitClient";

const ID_RE = /^[A-Za-z0-9_.-]+$/;

function sanitizeId(label: string, value: string): string {
  if (!value || !ID_RE.test(value)) {
    throw new Error(`InternalGit: ${label} inválido`);
  }
  return value;
}

function safeJoin(rootDir: string, relPath: string): string {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("InternalGit: caminho do arquivo vazio");
  }
  const cleaned = relPath.replace(/^\/+/, "");
  if (cleaned.split(/[\\/]/).some((seg) => seg === "..")) {
    throw new Error("InternalGit: caminho com '..' bloqueado");
  }
  if (/(^|[\\/])\.git([\\/]|$)/.test(cleaned)) {
    throw new Error("InternalGit: caminho dentro de .git/ bloqueado");
  }
  const abs = path.resolve(rootDir, cleaned);
  const rootAbs = path.resolve(rootDir);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error("InternalGit: caminho fora do repositório");
  }
  return abs;
}

const DEFAULT_AUTHOR = {
  name: process.env.INTERNAL_GIT_AUTHOR_NAME || "Arcadia DevCenter",
  email: process.env.INTERNAL_GIT_AUTHOR_EMAIL || "devcenter@arcadia.local",
};

export interface InternalGitOptions {
  defaultBranch?: string;
  description?: string;
}

// Idempotente: se filePath já começa com `<safeRepo>/`, não duplica o prefixo.
// Necessário porque getCommitDiff retorna filenames já scoped (ex.:
// `project-<runId>/docs/...`); ao usá-los em commitFile/getFileContent/deleteFile
// (revert), o caller pode passar tanto o relative quanto o já-scoped.
function scopePath(repo: string, filePath: string): string {
  const cleanedFile = filePath.replace(/^\/+/, "");
  if (!repo) return cleanedFile;
  const safeRepo = sanitizeId("repo", repo);
  if (cleanedFile === safeRepo || cleanedFile.startsWith(`${safeRepo}/`)) {
    return cleanedFile;
  }
  return `${safeRepo}/${cleanedFile}`;
}

export class InternalGit implements PushableGitClient {
  readonly repoDir: string;
  readonly defaultBranch: string;
  private _git: SimpleGit | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(repoDir: string, opts: InternalGitOptions = {}) {
    this.repoDir = repoDir;
    this.defaultBranch = opts.defaultBranch || "main";
  }

  private get git(): SimpleGit {
    if (!this._git) {
      throw new Error("InternalGit: chame ensureRepo() antes de usar");
    }
    return this._git;
  }

  async ensureRepo(description?: string): Promise<{ html_url: string; full_name: string }> {
    if (!this.initPromise) {
      this.initPromise = this.doInit(description);
    }
    await this.initPromise;
    const fullName = path.basename(this.repoDir);
    return {
      html_url: `internal://${fullName}`,
      full_name: fullName,
    };
  }

  private async doInit(description?: string): Promise<void> {
    await fs.mkdir(this.repoDir, { recursive: true });
    this._git = simpleGit({ baseDir: this.repoDir });
    // `checkIsRepo()` walks up parent dirs and may return true because the
    // workspace itself is a git repo. We need to know if THIS exact dir owns
    // its own `.git/` (file or dir, supporting both real repos and worktrees).
    const ownGit = path.join(this.repoDir, ".git");
    const hasOwnGit = await fs.access(ownGit).then(() => true).catch(() => false);
    if (!hasOwnGit) {
      await this.git.init(["-b", this.defaultBranch]);
      await this.git.addConfig("user.name", DEFAULT_AUTHOR.name);
      await this.git.addConfig("user.email", DEFAULT_AUTHOR.email);
      const gitignorePath = path.join(this.repoDir, ".gitignore");
      await fs.writeFile(
        gitignorePath,
        "node_modules/\n.env\n.env.*\n*.log\n.DS_Store\ndist/\nbuild/\n",
        "utf8",
      );
      const readmePath = path.join(this.repoDir, "README.md");
      const readme =
        `# ${path.basename(this.repoDir)}\n\n` +
        (description ? description + "\n\n" : "") +
        `_Repositório interno gerenciado pelo Dev Center da Arcádia (1 repo por tenant)._\n`;
      await fs.writeFile(readmePath, readme, "utf8");
      await this.git.add([".gitignore", "README.md"]);
      await this.git.commit("chore: inicializa repositório interno");
    } else {
      await this.git.addConfig("user.name", DEFAULT_AUTHOR.name).catch(() => {});
      await this.git.addConfig("user.email", DEFAULT_AUTHOR.email).catch(() => {});
    }
  }

  private async checkout(branch: string): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.all.includes(branch)) {
      if (branches.current !== branch) await this.git.checkout(branch);
    } else {
      await this.git.checkoutLocalBranch(branch);
    }
  }

  // ─── Métodos do GitClient (assinatura compatível com GiteaClient) ─────────

  async commitFile(
    _owner: string,
    repo: string,
    filePath: string,
    content: string,
    message: string,
    branch?: string,
  ): Promise<{ commit: { sha: string } } | null> {
    await this.ensureRepo();
    const targetBranch = branch || this.defaultBranch;
    await this.checkout(targetBranch);
    const scoped = scopePath(repo, filePath);
    const abs = safeJoin(this.repoDir, scoped);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    await this.git.add([abs]);
    const status = await this.git.status();
    if (
      status.staged.length === 0 &&
      status.created.length === 0 &&
      status.modified.length === 0 &&
      status.deleted.length === 0
    ) {
      // No-op (conteúdo idêntico) — assinatura compat com GiteaClient.
      return null;
    }
    const commit = await this.git.commit(message);
    return { commit: { sha: commit.commit } };
  }

  async deleteFile(
    _owner: string,
    repo: string,
    filePath: string,
    message: string,
    branch?: string,
  ): Promise<{ commit: { sha: string } } | null> {
    await this.ensureRepo();
    const targetBranch = branch || this.defaultBranch;
    await this.checkout(targetBranch);
    const scoped = scopePath(repo, filePath);
    const abs = safeJoin(this.repoDir, scoped);
    const exists = await fs.stat(abs).then(() => true).catch(() => false);
    if (!exists) return null;
    await this.git.rm([abs]);
    const commit = await this.git.commit(message);
    return { commit: { sha: commit.commit } };
  }

  async getFileContent(
    _owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ): Promise<string | null> {
    await this.ensureRepo();
    const scoped = scopePath(repo, filePath);
    if (ref) {
      try {
        return await this.git.show([`${ref}:${scoped}`]);
      } catch {
        return null;
      }
    }
    try {
      const abs = safeJoin(this.repoDir, scoped);
      return await fs.readFile(abs, "utf8");
    } catch {
      return null;
    }
  }

  async listCommits(_owner: string, repo: string, branch?: string): Promise<GiteaCommit[]> {
    await this.ensureRepo();
    const args = ["log", "--max-count=100", "--pretty=format:%H%x1F%s%x1F%an%x1F%ae%x1F%aI"];
    if (branch) {
      sanitizeId("branch", branch.replace(/\//g, "_"));
      args.push(branch);
    }
    if (repo) {
      const safeRepo = sanitizeId("repo", repo);
      args.push("--", `${safeRepo}/`);
    }
    let raw = "";
    try {
      raw = await this.git.raw(args);
    } catch {
      return [];
    }
    const out: GiteaCommit[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [sha, msg, an, ae, date] = line.split("\u001F");
      if (!sha) continue;
      out.push({
        sha,
        message: msg ?? "",
        authorName: an ?? "",
        authorEmail: ae ?? "",
        date: date ?? new Date().toISOString(),
        htmlUrl: undefined,
      });
    }
    return out;
  }

  async listBranches(_owner: string, _repo: string): Promise<GiteaBranch[]> {
    await this.ensureRepo();
    const b = await this.git.branchLocal();
    const out: GiteaBranch[] = [];
    for (const name of b.all) {
      try {
        const sha = (await this.git.revparse([name])).trim();
        out.push({ name, commit: { sha } });
      } catch {
        /* ignora */
      }
    }
    return out;
  }

  async createBranch(
    _owner: string,
    _repo: string,
    name: string,
    fromBranch?: string,
  ): Promise<GiteaBranch> {
    await this.ensureRepo();
    sanitizeId("branch", name.replace(/\//g, "_"));
    const base = fromBranch || this.defaultBranch;
    await this.checkout(base);
    await this.git.checkoutLocalBranch(name);
    const sha = (await this.git.revparse([name])).trim();
    return { name, commit: { sha } };
  }

  async getCommitDiff(_owner: string, _repo: string, sha: string): Promise<GiteaCommitDetail> {
    await this.ensureRepo();
    const safeSha = sha.replace(/[^A-Za-z0-9]/g, "");
    if (!safeSha) throw new Error("SHA inválido");
    const showRaw = await this.git.show([
      "--name-status",
      "--no-color",
      "--format=%H%n%P%n%an%n%ae%n%aI%n%B%x00",
      safeSha,
    ]);
    const headerEnd = showRaw.indexOf("\u0000");
    const headerBlock = headerEnd >= 0 ? showRaw.slice(0, headerEnd) : showRaw;
    const filesBlock = headerEnd >= 0 ? showRaw.slice(headerEnd + 1) : "";
    const lines = headerBlock.split("\n");
    const sha2 = lines[0] || safeSha;
    const parents = (lines[1] || "").trim().split(/\s+/).filter(Boolean);
    const authorName = lines[2] || "";
    const authorEmail = lines[3] || "";
    const date = lines[4] || new Date().toISOString();
    const message = lines.slice(5).join("\n").trim();

    const files: GiteaCommitFile[] = [];
    const fileLines = filesBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const ln of fileLines) {
      const parts = ln.split(/\t+/);
      if (parts.length < 2) continue;
      const statusChar = parts[0][0];
      const filename = parts[parts.length - 1];
      const status =
        statusChar === "A" ? "added" :
        statusChar === "D" ? "removed" :
        statusChar === "R" ? "renamed" :
        statusChar === "C" ? "copied" : "modified";
      let patch: string | null = null;
      let additions = 0;
      let deletions = 0;
      try {
        patch = await this.git.show([safeSha, "--", filename]);
        const numstat = await this.git.raw(["show", "--numstat", "--format=", safeSha, "--", filename]);
        const m = numstat.trim().split(/\s+/);
        if (m.length >= 2) {
          additions = Number(m[0]) || 0;
          deletions = Number(m[1]) || 0;
        }
      } catch {
        /* ignora */
      }
      files.push({ filename, status, additions, deletions, patch });
    }

    return { sha: sha2, message, authorName, authorEmail, date, files, parents };
  }

  async addRemoteAndPush(
    remoteName: string,
    remoteUrl: string,
    branch?: string,
  ): Promise<{ pushed: boolean; remote: string; branch: string; sha?: string }> {
    await this.ensureRepo();
    const safeRemote = sanitizeId("remoteName", remoteName);
    const targetBranch = branch || this.defaultBranch;
    sanitizeId("branch", targetBranch.replace(/\//g, "_"));
    const remotes = await this.git.getRemotes(true);
    const existing = remotes.find((r) => r.name === safeRemote);
    if (existing) {
      await this.git.removeRemote(safeRemote);
    }
    await this.git.addRemote(safeRemote, remoteUrl);
    let sha: string | undefined;
    try {
      sha = (await this.git.revparse(["HEAD"])).trim();
      try {
        await this.git.push(safeRemote, targetBranch, ["--force-with-lease"]);
      } catch (err: any) {
        // Sanitiza qualquer ocorrência da URL completa (com credencial embutida)
        // para evitar vazamento de token via mensagem de erro do git.
        throw new Error(scrubGitError(err?.message ?? String(err), remoteUrl));
      }
      return { pushed: true, remote: safeRemote, branch: targetBranch, sha };
    } finally {
      // Sempre remove o remote para não deixar credenciais persistidas em .git/config.
      await this.git.removeRemote(safeRemote).catch(() => {});
    }
  }
}

// Remove qualquer credencial de URL (user:pass@host) e oculta a URL bruta
// passada para o git, mantendo apenas o host quando possível.
function scrubGitError(raw: string, sensitiveUrl: string): string {
  let msg = String(raw ?? "");
  // 1) Substitui ocorrências exatas da URL fornecida (mascarada).
  try {
    const u = new URL(sensitiveUrl);
    const safe = `${u.protocol}//${u.hostname}${u.pathname}`;
    if (sensitiveUrl) msg = msg.split(sensitiveUrl).join(safe);
    if (u.password) msg = msg.split(u.password).join("[REDACTED]");
    if (u.username) msg = msg.split(`${u.username}:`).join("[REDACTED]:");
  } catch { /* sensitiveUrl pode não ser parseável; continua */ }
  // 2) Regex genérica para qualquer https://user:pass@host nos logs.
  msg = msg.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, (m) => {
    try {
      const sub = new URL(m + "x");
      return `${sub.protocol}//[REDACTED]@`;
    } catch {
      return "https://[REDACTED]@";
    }
  });
  return msg;
}

/**
 * Resolve o diretório do repositório interno **por tenant** (1 repo / tenant).
 * Substitui repoDirForRun (Fase 1 — single tenant repo, projetos viram subdirs).
 */
export function repoDirForTenant(tenantId: string): string {
  const t = sanitizeId("tenantId", tenantId);
  const base = process.env.REPOS_BASE_PATH || path.join(process.cwd(), ".local", "arcadia-repos");
  return path.join(base, t);
}

/**
 * Mantida apenas para compat — agora retorna o mesmo path tenant-level.
 * @deprecated use repoDirForTenant.
 */
export function repoDirForRun(tenantId: string, _runId: string): string {
  return repoDirForTenant(tenantId);
}

/**
 * Factory tenant-scoped: 1 InternalGit por tenant. O nome do "repo" virtual
 * (sub-diretório dentro do repo) é passado nas chamadas a commitFile/etc.
 */
export async function getInternalGitForTenant(tenantId: string): Promise<{
  client: InternalGit;
  baseUrl: string;
  owner: string;
  repoUrl: string;
}> {
  const dir = repoDirForTenant(tenantId);
  const client = new InternalGit(dir);
  return {
    client,
    baseUrl: "internal",
    owner: "arcadia",
    repoUrl: `internal://${tenantId}`,
  };
}

/**
 * Compat com o código existente: devolve o mesmo client tenant-scoped, mas
 * preenche `repo='project-<runId>'` para namespacing dos arquivos da run.
 */
export async function getInternalGitForRun(tenantId: string, runId: string): Promise<{
  client: InternalGit;
  baseUrl: string;
  owner: string;
  repo: string;
  repoUrl: string;
}> {
  const t = await getInternalGitForTenant(tenantId);
  const repoName = `project-${sanitizeId("runId", runId)}`;
  return {
    client: t.client,
    baseUrl: t.baseUrl,
    owner: t.owner,
    repo: repoName,
    repoUrl: `internal://${tenantId}/${repoName}`,
  };
}
