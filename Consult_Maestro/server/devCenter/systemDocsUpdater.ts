import { promises as fs } from "fs";
import * as path from "path";

/**
 * Append-only updater para `replit.md` e `docs/MAPEAMENTO_SISTEMA.md` do
 * Arcádia Consult. Idempotente por `runId` (marcador HTML).
 *
 * Comportamento opt-in: só altera arquivos quando CONSULT_UPDATE_DOCS=1
 * (default off). Caso contrário, apenas retorna `applied: false`.
 */
export interface SystemDocUpdate {
  runId: string;
  title: string;
  summary?: string;
  target: string;
  commitSha?: string;
  deployedAt: Date;
}

export interface SystemDocFileResult {
  applied: boolean;
  reason: string;
  filePath: string;
}

export interface SystemDocsResult {
  applied: boolean;
  reason: string;
  marker: string;
  filePath: string; // legado: caminho de replit.md
  files: SystemDocFileResult[];
}

const CONSULT_ROOT = process.env.CONSULT_ROOT || process.cwd();

function buildEntry(update: SystemDocUpdate, marker: string, kind: "main" | "map"): string {
  const heading =
    kind === "main"
      ? `### Dev Center — ${update.title}`
      : `### [${update.target}] ${update.title}`;
  return (
    `\n\n${marker}\n` +
    `${heading}\n` +
    `- **Target**: ${update.target}\n` +
    `- **Run**: ${update.runId}\n` +
    (update.commitSha ? `- **Commit**: ${update.commitSha.slice(0, 12)}\n` : "") +
    `- **Deployed em**: ${update.deployedAt.toISOString()}\n` +
    (update.summary ? `- **Resumo**: ${update.summary}\n` : "")
  );
}

async function updateSingleDoc(
  filePath: string,
  marker: string,
  entry: string,
  insertBeforeHeader?: string,
): Promise<SystemDocFileResult> {
  let current: string;
  try {
    current = await fs.readFile(filePath, "utf8");
  } catch {
    return { applied: false, reason: `arquivo não encontrado`, filePath };
  }
  if (current.includes(marker)) {
    return { applied: false, reason: "marcador já presente (idempotente)", filePath };
  }
  let next: string;
  if (insertBeforeHeader) {
    const idx = current.indexOf(insertBeforeHeader);
    if (idx > 0) {
      next = current.slice(0, idx) + entry + "\n" + current.slice(idx);
    } else {
      next = current.trimEnd() + entry + "\n";
    }
  } else {
    next = current.trimEnd() + entry + "\n";
  }
  await fs.writeFile(filePath, next, "utf8");
  return { applied: true, reason: "atualizado", filePath };
}

export async function updateSystemDocs(update: SystemDocUpdate): Promise<SystemDocsResult> {
  const replitPath = path.join(CONSULT_ROOT, "replit.md");
  const mapPath = path.join(CONSULT_ROOT, "docs", "MAPEAMENTO_SISTEMA.md");
  const marker = `<!-- devcenter:run:${update.runId} -->`;

  const enabled = process.env.CONSULT_UPDATE_DOCS === "1";
  if (!enabled) {
    return {
      applied: false,
      reason: "desabilitado (CONSULT_UPDATE_DOCS != 1)",
      marker,
      filePath: replitPath,
      files: [
        { applied: false, reason: "desabilitado", filePath: replitPath },
        { applied: false, reason: "desabilitado", filePath: mapPath },
      ],
    };
  }

  const entryReplit = buildEntry(update, marker, "main");
  const entryMap = buildEntry(update, marker, "map");

  const replitResult = await updateSingleDoc(
    replitPath,
    marker,
    entryReplit,
    "## External Dependencies",
  );
  const mapResult = await updateSingleDoc(mapPath, marker, entryMap);

  const anyApplied = replitResult.applied || mapResult.applied;
  return {
    applied: anyApplied,
    reason: anyApplied ? "atualizado" : "nenhum arquivo alterado",
    marker,
    filePath: replitPath,
    files: [replitResult, mapResult],
  };
}
