import crypto from "crypto";

/**
 * Intelligence Layer cache — Fase 3 BI Multi-Fonte.
 *
 * Backend é selecionado em runtime:
 * - Default: `MemoryCache` (in-memory, escopado ao processo).
 * - Quando `process.env.REDIS_URL` estiver definido E o pacote
 *   `ioredis` estiver disponível, troca-se automaticamente para
 *   `RedisCache` mantendo o mesmo contrato `BiCache`. Assim, em
 *   ambientes multi-instância o cache vira compartilhado sem que o
 *   resto do BI precise mudar uma linha.
 * - Se `REDIS_URL` está setado mas `ioredis` não está instalado,
 *   o app loga um aviso e cai para `MemoryCache` (degradação
 *   graciosa em vez de crash).
 *
 * Chave canônica: `tenantId + ':' + namespace + ':' + sha256(payload)`.
 * O prefixo por tenant garante isolamento na invalidação
 * (`invalidateTenantCache`), inclusive num Redis compartilhado.
 */

export interface BiCache {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delByPrefix(prefix: string): Promise<number>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

class MemoryCache implements BiCache {
  private map = new Map<string, Entry>();
  private maxEntries = 5_000;

  async get<T>(key: string): Promise<T | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.map.size >= this.maxEntries) {
      // simple FIFO eviction
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  }

  async delByPrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  scanStream(opts: { match: string; count: number }): NodeJS.ReadableStream;
  del(...keys: string[]): Promise<number>;
}

class RedisCache implements BiCache {
  constructor(private client: RedisLike) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw == null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
  }

  async delByPrefix(prefix: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const stream = this.client.scanStream({ match: `${prefix}*`, count: 200 });
      const keys: string[] = [];
      stream.on("data", (k: string[] | string) => {
        const arr = Array.isArray(k) ? k : [k];
        for (const x of arr) keys.push(String(x));
      });
      stream.on("end", async () => {
        if (keys.length === 0) return resolve(0);
        try {
          await this.client.del(...keys);
          resolve(keys.length);
        } catch (e) { reject(e); }
      });
      stream.on("error", reject);
    });
  }
}

async function chooseBackend(): Promise<BiCache> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("[bi/cache] backend=MemoryCache (REDIS_URL não definida)");
    return new MemoryCache();
  }
  try {
    const mod: { default: new (url: string) => RedisLike } = await import("ioredis" as string) as never;
    const Redis = (mod as unknown as { default?: new (url: string) => RedisLike }).default
      ?? (mod as unknown as new (url: string) => RedisLike);
    const client = new Redis(url);
    console.log("[bi/cache] backend=RedisCache (REDIS_URL detectada)");
    return new RedisCache(client);
  } catch (err) {
    console.warn(
      "[bi/cache] REDIS_URL definida mas pacote 'ioredis' indisponível;" +
      " caindo para MemoryCache. Instale 'ioredis' para habilitar o cache compartilhado.",
      err instanceof Error ? err.message : err,
    );
    return new MemoryCache();
  }
}

let _backendPromise: Promise<BiCache> | null = null;
function getBackend(): Promise<BiCache> {
  if (!_backendPromise) _backendPromise = chooseBackend();
  return _backendPromise;
}

export const biCache: BiCache = {
  async get<T>(key: string): Promise<T | null> {
    const b = await getBackend();
    return b.get<T>(key);
  },
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const b = await getBackend();
    return b.set<T>(key, value, ttlSeconds);
  },
  async delByPrefix(prefix: string): Promise<number> {
    const b = await getBackend();
    return b.delByPrefix(prefix);
  },
};

export function biCacheKey(
  tenantId: string,
  namespace: string,
  payload: unknown,
): string {
  const body = JSON.stringify(payload ?? null);
  const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);
  return `${tenantId}:${namespace}:${hash}`;
}

/**
 * Invalida todas as entradas de cache de um tenant (chamado após ETL).
 * Funciona idêntico em MemoryCache (filtra Map) e RedisCache (SCAN+DEL).
 */
export async function invalidateTenantCache(tenantId: string): Promise<number> {
  return biCache.delByPrefix(`${tenantId}:`);
}
