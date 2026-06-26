/**
 * SOE-00 — eventBus.ts
 * Outbox transacional para eventos de domínio do SOE.
 */

import { pool } from '../db';
import type { PoolClient } from "pg";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface SoeEventInput {
  tenantId:       string;
  eventType:      string;
  aggregateType:  string;
  aggregateId:    string;
  payload:        Record<string, any>;
  createdById?:   string | null;
  scheduledAt?:   Date;
}

export interface SoeEvent {
  id:              string;
  tenantId:        string;
  eventType:       string;
  aggregateType:   string;
  aggregateId:     string;
  payload:         Record<string, any>;
  idempotencyKey:  string;
  status:          'pending' | 'processing' | 'processed' | 'failed' | 'dead_letter';
  attempts:        number;
  maxAttempts:     number;
  lastError:       string | null;
  scheduledAt:     Date;
  processedAt:     Date | null;
  createdById:     string | null;
  createdAt:       Date;
}

export type SoeEventHandler = (event: SoeEvent) => Promise<void>;

// ─── Registry de consumers ────────────────────────────────────────────────────

const handlers = new Map<string, SoeEventHandler[]>();

export function registerHandler(eventType: string, handler: SoeEventHandler): void {
  const existing = handlers.get(eventType) ?? [];
  handlers.set(eventType, [...existing, handler]);
}

// ─── Publicação (dentro de transação existente) ───────────────────────────────

export async function publishEvent(
  client: PoolClient,
  input: SoeEventInput
): Promise<void> {
  const idempotencyKey = `${input.aggregateType}:${input.aggregateId}:${input.eventType}`;

  await client.query(
    `INSERT INTO soe_events (
       tenant_id, event_type, aggregate_type, aggregate_id,
       payload, idempotency_key, status, scheduled_at, created_by_id
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.tenantId,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      idempotencyKey,
      input.scheduledAt ?? new Date(),
      input.createdById ?? null,
    ]
  );
}

export async function publishEventStandalone(input: SoeEventInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await publishEvent(client, input);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─── Worker de processamento ──────────────────────────────────────────────────

const WORKER_POLL_MS  = 2_000;
const WORKER_BATCH    = 10;
const LOCK_DURATION_S = 30;

let workerRunning = false;
let workerTimer: ReturnType<typeof setTimeout> | null = null;

export function startEventWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  console.log("[SOE EventWorker] Iniciado.");
  scheduleNextTick();
}

export function stopEventWorker(): void {
  workerRunning = false;
  if (workerTimer) clearTimeout(workerTimer);
  console.log("[SOE EventWorker] Parado.");
}

function scheduleNextTick(): void {
  if (!workerRunning) return;
  workerTimer = setTimeout(async () => {
    await processBatch();
    scheduleNextTick();
  }, WORKER_POLL_MS);
}

async function processBatch(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<SoeEvent>(
      `UPDATE soe_events
       SET status       = 'processing',
           attempts     = attempts + 1,
           locked_until = NOW() + INTERVAL '${LOCK_DURATION_S} seconds'
       WHERE id IN (
         SELECT id FROM soe_events
         WHERE status IN ('pending', 'failed')
           AND scheduled_at <= NOW()
           AND (locked_until IS NULL OR locked_until < NOW())
           AND attempts < max_attempts
         ORDER BY scheduled_at ASC
         LIMIT ${WORKER_BATCH}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
    );

    for (const row of rows) {
      await processEvent(row);
    }

    await client.query(
      `UPDATE soe_events
       SET status = 'dead_letter'
       WHERE status = 'failed'
         AND attempts >= max_attempts`
    );
  } catch (e: any) {
    console.error("[SOE EventWorker] Erro no batch:", e.message);
  } finally {
    client.release();
  }
}

async function processEvent(event: SoeEvent): Promise<void> {
  const eventHandlers = handlers.get(event.eventType) ?? [];

  if (eventHandlers.length === 0) {
    await markProcessed(event.id);
    return;
  }

  try {
    for (const handler of eventHandlers) {
      await handler(event);
    }
    await markProcessed(event.id);
  } catch (e: any) {
    await markFailed(event.id, e.message);
    console.error(
      `[SOE EventWorker] Falha no evento ${event.eventType} (${event.id}): ${e.message}`
    );
  }
}

async function markProcessed(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE soe_events
     SET status = 'processed', processed_at = NOW(), locked_until = NULL
     WHERE id = $1`,
    [eventId]
  );
}

async function markFailed(eventId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE soe_events
     SET status = 'failed', last_error = $2, locked_until = NULL
     WHERE id = $1`,
    [eventId, error.slice(0, 2000)]
  );
}

// ─── Utilitários de consulta ──────────────────────────────────────────────────

export async function getEventsForAggregate(
  tenantId: string,
  aggregateType: string,
  aggregateId: string,
  limit = 50
): Promise<SoeEvent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM soe_events
     WHERE tenant_id = $1
       AND aggregate_type = $2
       AND aggregate_id = $3
     ORDER BY created_at DESC
     LIMIT $4`,
    [tenantId, aggregateType, aggregateId, limit]
  );
  return rows;
}

export async function getPendingEvents(
  tenantId: string,
  status: 'pending' | 'failed' | 'dead_letter' = 'pending',
  limit = 100
): Promise<SoeEvent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM soe_events
     WHERE tenant_id = $1 AND status = $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [tenantId, status, limit]
  );
  return rows;
}

export async function replayEvent(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE soe_events
     SET status = 'pending', attempts = 0, last_error = NULL, scheduled_at = NOW()
     WHERE id = $1`,
    [eventId]
  );
}
