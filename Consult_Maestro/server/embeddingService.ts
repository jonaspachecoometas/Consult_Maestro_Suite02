import OpenAI from "openai";

const PROVIDER = process.env.EMBEDDING_PROVIDER || "openai"; // 'openai' | 'local'

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    // Prefer a direct OPENAI_API_KEY (which supports /embeddings) over the
    // Replit AI proxy (which doesn't). Only fall back to the proxy if no
    // direct key is configured.
    const directKey = process.env.OPENAI_API_KEY;
    if (directKey) {
      openai = new OpenAI({ apiKey: directKey });
    } else {
      openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
    }
  }
  return openai;
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  dim: number;
}

// Some hosted proxies (e.g. Replit AI proxy) don't expose /embeddings.
// Once we detect this, we stop trying and fall back to keyword search system-wide.
let embeddingDisabled = false;
let embeddingDisabledReason = "";

export function isEmbeddingDisabled(): boolean {
  return embeddingDisabled;
}

export function getEmbeddingStatus(): { enabled: boolean; provider: string; reason?: string } {
  return {
    enabled: !embeddingDisabled,
    provider: PROVIDER,
    reason: embeddingDisabled ? embeddingDisabledReason : undefined,
  };
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (embeddingDisabled) {
    throw new Error(`Embeddings disabled: ${embeddingDisabledReason}`);
  }
  const safe = (text || "").slice(0, 8000);
  if (!safe) {
    throw new Error("Empty text passed to generateEmbedding");
  }

  if (PROVIDER === "openai") {
    try {
      const resp = await getOpenAI().embeddings.create({
        model: "text-embedding-3-small",
        input: safe,
      });
      const vector = resp.data[0].embedding;
      return { vector, provider: "openai:text-embedding-3-small", dim: vector.length };
    } catch (err: any) {
      const msg = err?.message || String(err);
      // Replit proxy returns 'POST /embeddings is not supported'
      if (
        msg.includes("not supported") ||
        msg.includes("Not Found") ||
        err?.status === 404 ||
        err?.status === 405
      ) {
        embeddingDisabled = true;
        embeddingDisabledReason = msg.slice(0, 200);
        console.warn(
          "[embedding] disabling embeddings system-wide (provider does not support /embeddings). Falling back to keyword search.",
        );
      }
      throw err;
    }
  }

  if (PROVIDER === "local") {
    throw new Error(
      "EMBEDDING_PROVIDER=local is configured but no local model is wired. Install @xenova/transformers and update embeddingService.ts.",
    );
  }

  throw new Error(`Unknown EMBEDDING_PROVIDER: ${PROVIDER}`);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface KnowledgeMatch {
  id: string;
  title: string;
  type: string;
  content: string;
  score: number;
}

/**
 * Search the brain for items relevant to `query`. Filters by tenant (and globals).
 * Returns top K items by cosine similarity. Falls back to LIKE match if no embeddings exist.
 */
export async function searchKnowledge(
  query: string,
  opts: { tenantId?: string | null; topK?: number } = {},
): Promise<KnowledgeMatch[]> {
  const { db } = await import("./db");
  const { brainItems } = await import("@shared/schema");
  const { or, isNull, eq, sql } = await import("drizzle-orm");
  const topK = opts.topK ?? Number(process.env.KNOWLEDGE_TOP_K || 5);

  const tenantFilter = opts.tenantId
    ? or(isNull(brainItems.tenantId), eq(brainItems.tenantId, opts.tenantId))
    : isNull(brainItems.tenantId);

  const rows = await db.select().from(brainItems).where(tenantFilter).limit(500);
  if (rows.length === 0) return [];

  const withEmb = rows.filter((r: any) => Array.isArray(r.embedding) && r.embedding.length > 0);

  // Fallback path: keyword/token overlap scoring (used when embeddings are
  // disabled OR when no items have been embedded yet).
  if (withEmb.length === 0 || embeddingDisabled) {
    const tokens = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const scored = rows.map((r: any) => {
      const hay = `${r.title} ${r.content} ${r.tags || ""}`.toLowerCase();
      let hits = 0;
      for (const t of tokens) if (hay.includes(t)) hits++;
      return {
        id: r.id as string,
        title: r.title as string,
        type: r.type as string,
        content: r.content as string,
        score: tokens.length === 0 ? 0 : hits / tokens.length,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, topK);
  }

  const queryEmb = await generateEmbedding(query);
  const scored = withEmb.map((r: any) => ({
    id: r.id as string,
    title: r.title as string,
    type: r.type as string,
    content: r.content as string,
    score: cosineSimilarity(queryEmb.vector, r.embedding as number[]),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Bump usage_count for the returned items (fire-and-forget)
  const topIds = scored.slice(0, topK).map((s) => s.id);
  if (topIds.length > 0) {
    db.execute(
      sql`UPDATE brain_items SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id = ANY(${topIds})`,
    ).catch(() => {});
  }
  return scored.slice(0, topK);
}
