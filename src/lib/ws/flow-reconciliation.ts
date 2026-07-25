/**
 * WS-21 — reconnect gap reconciliation.
 *
 * When the UW WebSocket drops and reconnects, any frames delivered during the outage were never
 * seen in-process. On reconnect we backfill that gap from the REST API, starting from
 * `last_confirmed_provider_ts − overlap_buffer` (a deliberate overlap so a boundary print that
 * straddled the disconnect instant is not missed), and dedupe by `alert_id` so the overlap — and
 * any frame the live socket ALSO redelivers — is not double-counted.
 *
 * Pure + injectable (the REST fetch, the dedup, and the per-row processor are all passed in) so it
 * is unit-testable under `tsx --test` with no network / DB. Reuses the same `FlowDedup` contract as
 * the live socket path, so a `seen()` hit here means exactly what it means there.
 */

import type { FlowDedup } from "@/lib/flow-dedup";

/**
 * Overlap buffer: re-fetch this much BEFORE the last confirmed provider timestamp. Sized to cover
 * clock skew + a print that landed right at the disconnect boundary. The dedup makes the overlap
 * free (re-seen rows are dropped), so erring wide is strictly safer than risking a missed alert.
 */
export const DEFAULT_OVERLAP_BUFFER_MS = 5 * 60_000;

/**
 * Compute the start of the REST backfill window. When we have never confirmed a provider timestamp
 * (cold process), bound the backfill to `overlapBufferMs` before `now` rather than refetching all of
 * history — the live socket + the existing flow-ingest cron cover steady state; this is a gap fill.
 */
export function computeBackfillWindowStartMs(
  lastConfirmedProviderTs: number | null,
  overlapBufferMs: number = DEFAULT_OVERLAP_BUFFER_MS,
  now: number = Date.now()
): number {
  if (lastConfirmedProviderTs == null || !Number.isFinite(lastConfirmedProviderTs)) {
    return now - overlapBufferMs;
  }
  return Math.max(0, lastConfirmedProviderTs - overlapBufferMs);
}

/** Minimum shape a backfilled row must expose for reconciliation. Callers extend it freely. */
export type ReconcileRow = {
  /** Canonical alert id — the SAME key the live path and DB ON-CONFLICT dedupe on. */
  alert_id: string;
  /** Provider event time (ms) if known — advances the confirmed cursor. Null when absent. */
  provider_ts: number | null;
};

export type ReconcileResult = {
  /** Rows the REST fetch returned. */
  fetched: number;
  /** Rows that were NOT already seen — the genuine gap fill (`process` was invoked for these). */
  backfilled: number;
  /** Rows dropped as already-seen duplicates (overlap / live-redelivery). */
  duplicates: number;
  /** Rows whose `process` threw (counted, isolated — never aborts the reconcile). */
  errored: number;
  /** Newest provider_ts observed across fetched rows (for advancing the confirmed cursor). */
  newestProviderTs: number | null;
};

/**
 * Reconcile the disconnect gap: fetch REST rows since `windowStartMs`, dedupe by `alert_id`, and
 * invoke `process` exactly once per genuinely-new row. Never throws — a per-row `process` failure is
 * isolated and counted so one poison row can't strand the whole backfill (that row can be routed to
 * the DLQ by the caller's `process`). Idempotent under the passed `dedup`: running twice over the
 * same rows backfills them the first time and reports them all as duplicates the second.
 */
export async function reconcileGap<T extends ReconcileRow>(opts: {
  windowStartMs: number;
  fetchSince: (sinceMs: number) => Promise<T[]>;
  dedup: FlowDedup;
  process: (row: T) => Promise<void> | void;
  now?: number;
}): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now();
  const rows = await opts.fetchSince(opts.windowStartMs);
  let backfilled = 0;
  let duplicates = 0;
  let errored = 0;
  let newestProviderTs: number | null = null;

  for (const row of rows) {
    if (row.provider_ts != null && Number.isFinite(row.provider_ts)) {
      if (newestProviderTs == null || row.provider_ts > newestProviderTs) {
        newestProviderTs = row.provider_ts;
      }
    }
    // Dedupe on the canonical id BEFORE processing — a seen() hit is a row the durable layer would
    // also reject, so skipping it can only ever suppress a true duplicate, never a distinct alert.
    if (opts.dedup.seen(row.alert_id, now)) {
      duplicates += 1;
      continue;
    }
    try {
      await opts.process(row);
      backfilled += 1;
    } catch {
      // Isolated: a single unprocessable row must not abort the gap fill. Counted so the caller
      // can surface it; the caller's `process` is expected to route the row to the DLQ.
      errored += 1;
    }
  }

  return { fetched: rows.length, backfilled, duplicates, errored, newestProviderTs };
}
