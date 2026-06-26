/**
 * MCP Hub — Partner API Key service (Sprint 4)
 *
 * Generates random API keys for the public `/mcp/v1` endpoint and hashes them
 * with HMAC-SHA-256 (peppered with SESSION_SECRET) before persistence. The
 * plain key is shown ONCE to the user at creation time — never stored, never
 * logged.
 *
 * Why HMAC-SHA-256 instead of plain SHA-256:
 *  - Each key has 256 bits of entropy from `randomBytes(32)`, so brute-force is
 *    not feasible. The risk we mitigate is a DB dump leaking key hashes — with
 *    plain SHA-256, an attacker who guessed the key generator could pre-compute
 *    a rainbow table; with HMAC-SHA-256 keyed by the per-deploy SESSION_SECRET,
 *    that attack is impossible without also exfiltrating the secret.
 *  - We need deterministic hashing because the public router authenticates by
 *    looking the key up directly by `key_hash`. Bcrypt's random salt would
 *    force per-row bcrypt comparisons on every request.
 *
 * Format: `arc_<base64url-32bytes>` (44 chars total).
 *  - `arc_` prefix lets ops/users immediately recognise the secret type.
 *  - 32 random bytes → 256 bits of entropy.
 *  - base64url encoding keeps it URL/header friendly.
 *
 * keyPrefix: first 12 chars of the plain key (incl. `arc_`). Stored in clear
 * to give users a non-secret way to identify which key they are looking at
 * in the UI ("arc_aB3kQ…"). Never used for auth.
 */

import { createHmac, randomBytes } from "crypto";

export interface GeneratedApiKey {
  /** The plain text key. SHOW ONCE then discard. */
  plainKey: string;
  /** HMAC-SHA-256 hex digest, 64 chars. Persisted as `key_hash`. */
  hash: string;
  /** First 12 chars of the plain key (incl. `arc_` prefix). Stored to help users identify the key. */
  prefix: string;
}

const KEY_BYTES = 32;
const PLAIN_PREFIX = "arc_";
const PREFIX_VISIBLE_CHARS = 12;

function getPepper(): string {
  // SESSION_SECRET is required by the rest of the app — fail loudly if absent.
  const pepper = process.env.SESSION_SECRET;
  if (!pepper) {
    throw new Error("SESSION_SECRET is required for partner API key hashing");
  }
  return pepper;
}

export function generateApiKey(): GeneratedApiKey {
  const raw = randomBytes(KEY_BYTES).toString("base64url");
  const plainKey = `${PLAIN_PREFIX}${raw}`;
  const hash = hashApiKey(plainKey);
  const prefix = plainKey.slice(0, PREFIX_VISIBLE_CHARS);
  return { plainKey, hash, prefix };
}

export function hashApiKey(plainKey: string): string {
  return createHmac("sha256", getPepper()).update(plainKey, "utf8").digest("hex");
}

/** Validate the format of a key the client sent us, before doing the DB lookup. */
export function isValidKeyFormat(key: unknown): key is string {
  return typeof key === "string" && key.startsWith(PLAIN_PREFIX) && key.length >= PLAIN_PREFIX.length + 20;
}
