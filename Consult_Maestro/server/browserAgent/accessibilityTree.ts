/**
 * Accessibility-tree snapshot → texto com refs @eN para o LLM.
 *
 * O Playwright expõe `locator.ariaSnapshot()` (YAML-like), mas nesta versão ele
 * não emite refs estáveis. Aqui parseamos cada nó (role + nome acessível),
 * atribuímos um ref sequencial (@e1, @e2...) e guardamos um descritor que
 * permite reconstruir o locator via getByRole(role,{name}).nth(occurrence).
 *
 * É a tradução TS do "ariaSnapshot com refs" que o Hermes/Playwright-MCP usa
 * para o agente clicar/digitar em elementos pelo ref.
 */
import type { Page, Locator } from "playwright";

export interface RefDescriptor {
  role: string;
  name: string;
  /** N-ésima ocorrência de (role,name) na página — desambigua duplicados. */
  occurrence: number;
}

export interface PageSnapshot {
  text: string;
  refs: Map<string, RefDescriptor>;
}

// Captura "- <role> "<name>"" no início (após indentação e o hífen do YAML).
const LINE_RE = /^(\s*)-\s+([a-zA-Z][a-zA-Z0-9]*)(?:\s+"((?:[^"\\]|\\.)*)")?/;

export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const raw = await page.locator("body").ariaSnapshot();
  const lines = raw.split("\n");
  const refs = new Map<string, RefDescriptor>();
  const occ = new Map<string, number>();
  const out: string[] = [];
  let counter = 0;

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    const role = m[2];
    const name = (m[3] ?? "").replace(/\\"/g, '"');
    const key = `${role}||${name}`;
    const occurrence = occ.get(key) ?? 0;
    occ.set(key, occurrence + 1);
    counter += 1;
    const ref = `e${counter}`;
    refs.set(ref, { role, name, occurrence });
    out.push(`${line}  [@${ref}]`);
  }

  return { text: out.join("\n"), refs };
}

export function locatorForRef(
  page: Page,
  snapshot: PageSnapshot,
  ref: string,
): Locator | null {
  const clean = ref.replace(/^@/, "").trim();
  const d = snapshot.refs.get(clean);
  if (!d) return null;
  let base: Locator;
  try {
    base = d.name
      ? page.getByRole(d.role as any, { name: d.name, exact: true })
      : page.getByRole(d.role as any);
  } catch {
    base = page.getByText(d.name || "", { exact: false });
  }
  return base.nth(d.occurrence);
}
