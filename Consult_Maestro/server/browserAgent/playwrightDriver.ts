/**
 * playwrightDriver — wrapper sobre Playwright (Chromium headless).
 *
 * Lança um único Chromium (Nix `chromium` via executablePath) e mantém sessões
 * isoladas por taskId (cada uma é um BrowserContext próprio = cookies isolados).
 * Implementa navigate/click/type/select/snapshot/extract usando refs @eN do
 * módulo accessibilityTree. É a tradução TS do tools/browser_tool.py do Hermes.
 *
 * Sem dependência de banco — persistência de cookies fica no sessionStore.
 */
import { execSync } from "child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser, BrowserContext, Page } from "playwright";
import { snapshotPage, locatorForRef, type PageSnapshot } from "./accessibilityTree";

const PRIVATE_RANGES_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivateIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateIp(mapped[1]);
  if (isIP(ip) === 4) return PRIVATE_RANGES_V4.some((r) => r.test(ip));
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
  }
  return false;
}

/**
 * Guarda anti-SSRF: bloqueia navegação para hosts internos/privados, impedindo
 * que tools/usuários sondem serviços internos (localhost, RFC1918, metadata).
 * Defina ALLOW_PRIVATE_BROWSER=1 para liberar em ambientes de teste internos.
 */
async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Protocolo não permitido (use http/https)");
  }
  const allowPrivate = process.env.ALLOW_PRIVATE_BROWSER === "1";
  if (allowPrivate) return;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "ln" || host.endsWith(".localhost")) {
    throw new Error("Endereço não permitido (privado/local)");
  }
  const ip = isIP(host) ? host : (await dnsLookup(host).catch(() => null))?.address;
  if (!ip) throw new Error("Host não resolvido");
  if (isPrivateIp(ip)) {
    throw new Error("Endereço não permitido (privado/local)");
  }
}

let browserPromise: Promise<Browser> | null = null;
let resolvedChromium: string | null | undefined;

function resolveChromiumPath(): string | undefined {
  if (resolvedChromium !== undefined) return resolvedChromium ?? undefined;
  const fromEnv = process.env.CHROMIUM_BIN || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (fromEnv) {
    resolvedChromium = fromEnv;
    return fromEnv;
  }
  try {
    const p = execSync(
      "which chromium || which chromium-browser || which google-chrome-stable",
      { encoding: "utf8" },
    ).trim();
    resolvedChromium = p || null;
  } catch {
    resolvedChromium = null;
  }
  return resolvedChromium ?? undefined;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      const executablePath = resolveChromiumPath();
      const browser = await chromium.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

interface Session {
  context: BrowserContext;
  page: Page;
  snapshot?: PageSnapshot;
  lastUsed: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 15 * 60 * 1000;
const NAV_TIMEOUT = 30_000;
const ACT_TIMEOUT = 15_000;

function sweep() {
  const now = Date.now();
  for (const [id, s] of Array.from(sessions.entries())) {
    if (now - s.lastUsed > SESSION_TTL_MS) {
      s.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

async function getSession(taskId: string, storageState?: any): Promise<Session> {
  sweep();
  let s = sessions.get(taskId);
  if (!s) {
    const browser = await getBrowser();
    const context = await browser.newContext({
      storageState: storageState || undefined,
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) ArcadiaAgent/1.0 Chrome/125",
    });
    const page = await context.newPage();
    s = { context, page, lastUsed: Date.now() };
    sessions.set(taskId, s);
  }
  s.lastUsed = Date.now();
  return s;
}

async function ensureSnapshot(s: Session): Promise<PageSnapshot> {
  if (!s.snapshot) s.snapshot = await snapshotPage(s.page);
  return s.snapshot;
}

export async function navigate(taskId: string, url: string, storageState?: any) {
  await assertSafeUrl(url);
  const s = await getSession(taskId, storageState);
  await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  s.snapshot = undefined;
  return { url: s.page.url(), title: await s.page.title() };
}

export async function snapshot(taskId: string) {
  const s = await getSession(taskId);
  const snap = await snapshotPage(s.page);
  s.snapshot = snap;
  return { url: s.page.url(), title: await s.page.title(), snapshot: snap.text };
}

export async function click(taskId: string, ref: string) {
  const s = await getSession(taskId);
  const snap = await ensureSnapshot(s);
  const loc = locatorForRef(s.page, snap, ref);
  if (!loc)
    return { error: `Ref ${ref} não encontrado no snapshot atual. Rode browser_snapshot novamente.` };
  await loc.click({ timeout: ACT_TIMEOUT });
  await s.page.waitForLoadState("domcontentloaded", { timeout: ACT_TIMEOUT }).catch(() => {});
  s.snapshot = undefined;
  return { ok: true, url: s.page.url() };
}

export async function type(
  taskId: string,
  ref: string,
  text: string,
  submit?: boolean,
) {
  const s = await getSession(taskId);
  const snap = await ensureSnapshot(s);
  const loc = locatorForRef(s.page, snap, ref);
  if (!loc) return { error: `Ref ${ref} não encontrado. Rode browser_snapshot.` };
  await loc.fill(text, { timeout: ACT_TIMEOUT });
  if (submit) {
    await loc.press("Enter");
    await s.page.waitForLoadState("domcontentloaded", { timeout: ACT_TIMEOUT }).catch(() => {});
    s.snapshot = undefined;
  }
  return { ok: true };
}

export async function select(taskId: string, ref: string, value: string) {
  const s = await getSession(taskId);
  const snap = await ensureSnapshot(s);
  const loc = locatorForRef(s.page, snap, ref);
  if (!loc) return { error: `Ref ${ref} não encontrado. Rode browser_snapshot.` };
  await loc.selectOption(value, { timeout: ACT_TIMEOUT });
  return { ok: true };
}

export async function extract(taskId: string, maxChars = 8000) {
  const s = await getSession(taskId);
  const text = await s.page.evaluate(() => document.body.innerText);
  const clean = (text || "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: s.page.url(),
    title: await s.page.title(),
    truncated: clean.length > maxChars,
    content: clean.slice(0, maxChars),
  };
}

export async function getStorageState(taskId: string): Promise<any | null> {
  const s = sessions.get(taskId);
  if (!s) return null;
  return await s.context.storageState();
}

export async function closeSession(taskId: string) {
  const s = sessions.get(taskId);
  if (s) {
    await s.context.close().catch(() => {});
    sessions.delete(taskId);
  }
}

export function getChromiumPath(): string | undefined {
  return resolveChromiumPath();
}

export async function isBrowserAvailable(): Promise<{
  ok: boolean;
  chromiumPath?: string;
  error?: string;
}> {
  const path = resolveChromiumPath();
  if (!path)
    return {
      ok: false,
      error:
        "Chromium não encontrado. Instale o pacote Nix 'chromium' ou defina CHROMIUM_BIN.",
    };
  try {
    await getBrowser();
    return { ok: true, chromiumPath: path };
  } catch (e: any) {
    return { ok: false, chromiumPath: path, error: e?.message ?? String(e) };
  }
}
