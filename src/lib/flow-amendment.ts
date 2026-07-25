/**
 * WS-22 — amended / corrected UW print reconciliation.
 *
 * UW can re-send a print for the SAME underlying event with revised fields (a corrected premium,
 * size, or price), or explicitly flag a print as amending an earlier one. Treated naively, the
 * amendment lands as a brand-new row (its own alert_id) and the underlying event is counted TWICE —
 * once at the original premium, once at the revised premium — inflating every downstream aggregate.
 *
 * This module keeps a per-event ledger keyed by the STABLE identity of the underlying event (not the
 * per-message alert_id): applying an amendment SUPERSEDES the prior version rather than adding to it,
 * so aggregation reads the LATEST amendment only. Idempotent — re-applying the same amendment is a
 * no-op. Pure + alias-free so it is unit-testable under `tsx --test`.
 */

export type AmendableEvent = {
  /** Per-message id (unique per delivery, including each amendment). */
  alert_id: string;
  /**
   * Stable identity of the underlying event across amendments. When the provider gives one (a
   * corrected print carrying the original's id / a shared event key), pass it; otherwise identity
   * falls back to `amends_id` then `alert_id` (see {@link amendmentIdentity}).
   */
  event_key?: string | null;
  /** The earlier alert_id this message amends, when the provider marks the linkage explicitly. */
  amends_id?: string | null;
  /** Provider revision counter, when present — higher = newer. Absent → `received_at` orders. */
  version?: number | null;
  /** Delivery/receipt time (ms) — the tiebreak ordering when `version` is absent. */
  received_at?: number | null;
  /** The revisable value the aggregate sums. */
  premium: number;
};

/**
 * The stable identity of an underlying event. Prefer the provider's explicit event key, then the
 * amends-linkage, then the message id (a print with no amendment linkage is its own event).
 */
export function amendmentIdentity(e: AmendableEvent): string {
  return e.event_key ?? e.amends_id ?? e.alert_id;
}

/** True when `next` is an amendment of the SAME underlying event as `prev`. */
export function isAmendmentOf(prev: AmendableEvent, next: AmendableEvent): boolean {
  return amendmentIdentity(prev) === amendmentIdentity(next);
}

/** Ordering rank of a version for a stored event (undefined version → -Infinity, receipt orders). */
function versionRank(e: AmendableEvent): number {
  return e.version != null && Number.isFinite(e.version) ? e.version : Number.NEGATIVE_INFINITY;
}

function receiptRank(e: AmendableEvent): number {
  return e.received_at != null && Number.isFinite(e.received_at) ? e.received_at : 0;
}

export type AmendmentAction = "insert" | "supersede" | "duplicate" | "ignore_stale";

export interface AmendmentLedger {
  /**
   * Apply an event/amendment. Returns what happened:
   *  - "insert"       — first time this identity was seen.
   *  - "supersede"    — a strictly-newer amendment replaced the stored version.
   *  - "duplicate"    — same identity + same alert_id + same version already stored (idempotent).
   *  - "ignore_stale" — an older (or equal-version, different-id) amendment; stored version kept.
   */
  apply(e: AmendableEvent): { action: AmendmentAction; identity: string };
  /** The latest amendment per identity (one row per underlying event). */
  latest(): AmendableEvent[];
  /** Sum of `premium` over the latest amendments — the correct, non-double-counted aggregate. */
  aggregatePremium(): number;
  /** Number of distinct underlying events tracked. */
  size(): number;
  /** The stored latest amendment for one identity, or null. */
  get(identity: string): AmendableEvent | null;
}

export function makeAmendmentLedger(): AmendmentLedger {
  const latestByIdentity = new Map<string, AmendableEvent>();

  return {
    apply(e: AmendableEvent): { action: AmendmentAction; identity: string } {
      const identity = amendmentIdentity(e);
      const prev = latestByIdentity.get(identity);
      if (!prev) {
        latestByIdentity.set(identity, e);
        return { action: "insert", identity };
      }

      // Idempotency: the exact same amendment re-delivered (same id + same version) is a no-op.
      if (prev.alert_id === e.alert_id && versionRank(prev) === versionRank(e)) {
        return { action: "duplicate", identity };
      }

      const prevV = versionRank(prev);
      const nextV = versionRank(e);
      // Prefer explicit version ordering; fall back to receipt time when versions are equal/absent.
      const newer =
        nextV > prevV || (nextV === prevV && receiptRank(e) > receiptRank(prev));
      if (newer) {
        latestByIdentity.set(identity, e);
        return { action: "supersede", identity };
      }
      return { action: "ignore_stale", identity };
    },
    latest(): AmendableEvent[] {
      return Array.from(latestByIdentity.values());
    },
    aggregatePremium(): number {
      let sum = 0;
      for (const e of latestByIdentity.values()) {
        if (Number.isFinite(e.premium)) sum += e.premium;
      }
      return sum;
    },
    size(): number {
      return latestByIdentity.size;
    },
    get(identity: string): AmendableEvent | null {
      return latestByIdentity.get(identity) ?? null;
    },
  };
}

/**
 * Detect amendment metadata on a raw UW flow payload. WIDENING-ONLY / conservative: returns
 * `event_key`/`amends_id`/`version` ONLY when the provider actually carries a recognized field, so a
 * plain (non-amended) print is unaffected and keeps its own alert_id as its identity. Never throws.
 */
export function detectAmendmentFromRaw(raw: Record<string, unknown>): {
  event_key: string | null;
  amends_id: string | null;
  version: number | null;
  amended: boolean;
} {
  const str = (v: unknown): string | null =>
    v == null || v === "" ? null : String(v);
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const event_key = str(raw.event_key ?? raw.event_id ?? raw.original_alert_id);
  const amends_id = str(raw.amends_alert_id ?? raw.amends_id ?? raw.supersedes_id ?? raw.corrects_id);
  const version = num(raw.version ?? raw.revision ?? raw.amendment_seq);
  const amended =
    raw.amended === true ||
    raw.corrected === true ||
    raw.is_amendment === true ||
    amends_id != null ||
    (version != null && version > 0);
  return { event_key, amends_id, version, amended };
}
