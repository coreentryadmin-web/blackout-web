/**
 * WS-21 — dead-letter path for unprocessable flow messages.
 *
 * When an ingest message can't be processed (malformed JSON, a parse/persist throw, a poison row in
 * a reconciliation backfill) it must NOT abort ingestion of the surrounding good messages, and it
 * must NOT be silently swallowed. This is a best-effort dead-letter queue: a bounded in-process ring
 * of the most recent poison messages plus a warn log, so operators can see what got rejected and
 * why. It is deliberately dependency-free and NEVER throws — the DLQ existing to protect ingest can
 * never itself break ingest.
 *
 * Best-effort by design: the ring is per-process and bounded (memory-safe under a flood). A durable
 * sink (a `flow_dlq` table) can be attached later via {@link setDlqSink} without touching callers;
 * until then the warn log + ring are the record. Pure/alias-free so it is unit-testable under
 * `tsx --test`.
 */

export type DeadLetter = {
  /** ms when the message was dead-lettered. */
  at: number;
  /** Source channel / stage (e.g. "flow_alerts", "flow_alerts:parse", "reconcile"). */
  channel: string;
  /** Why it was unprocessable (bounded). */
  reason: string;
  /** The offending payload, stringified + bounded (never the live object reference). */
  raw: string;
};

const RING_MAX = 200;
const RAW_MAX_CHARS = 2_000;
const REASON_MAX_CHARS = 500;

const ring: DeadLetter[] = [];
let total = 0;

/** Optional durable sink — best-effort, never awaited on the hot path, never allowed to throw. */
type DlqSink = (entry: DeadLetter) => void;
let sink: DlqSink | null = null;

/** Attach/detach a best-effort durable sink (e.g. a `flow_dlq` table writer). Never called inline. */
export function setDlqSink(next: DlqSink | null): void {
  sink = next;
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular / non-serializable — fall back to a coarse description rather than throwing.
    try {
      return String(value);
    } catch {
      return "[unstringifiable]";
    }
  }
}

/**
 * Route one unprocessable message to the dead-letter queue. Best-effort and NEVER throws — a
 * failure to record a poison message must never propagate into the ingest path that called it.
 */
export function deadLetter(channel: string, raw: unknown, reason: string, now: number = Date.now()): void {
  try {
    const entry: DeadLetter = {
      at: now,
      channel: String(channel).slice(0, 120),
      reason: String(reason).slice(0, REASON_MAX_CHARS),
      raw: safeStringify(raw).slice(0, RAW_MAX_CHARS),
    };
    ring.push(entry);
    while (ring.length > RING_MAX) ring.shift();
    total += 1;
    console.warn(`[flow-dlq] ${entry.channel}: ${entry.reason}`);
    if (sink) {
      try {
        sink(entry);
      } catch {
        /* durable sink is best-effort — swallow */
      }
    }
  } catch {
    /* the DLQ must never break ingest — swallow everything */
  }
}

/** Snapshot the current ring (newest last). Copy, so callers can't mutate the buffer. */
export function getDeadLetters(): DeadLetter[] {
  return [...ring];
}

/** Compact stats for admin health. */
export function deadLetterStats(): { total: number; buffered: number; newest_at: number | null } {
  return {
    total,
    buffered: ring.length,
    newest_at: ring.length ? ring[ring.length - 1].at : null,
  };
}

/** Drain + reset the ring (test/inspection helper; does NOT reset the lifetime `total`). */
export function drainDeadLetters(): DeadLetter[] {
  const out = [...ring];
  ring.length = 0;
  return out;
}

/**
 * Run `fn` and, if it throws, dead-letter `raw` with the error and return false — the caller keeps
 * going. Returns true when `fn` completed cleanly. This is the wrapper ingest loops use so a poison
 * message is captured without aborting the surrounding good messages.
 */
export function withDeadLetter(channel: string, raw: unknown, fn: () => void, now: number = Date.now()): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    deadLetter(channel, raw, err instanceof Error ? err.message : String(err), now);
    return false;
  }
}
