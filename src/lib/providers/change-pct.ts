// Keeping `price` and `change_pct` describing the SAME instant.
//
// WHY THIS EXISTS: several call sites overlay a fresh WebSocket price on top of a cached REST
// snapshot and then pass that snapshot's `change_pct` straight through. The result is a quote
// whose two halves describe different moments — a price from *now* next to a day-change from
// whenever the snapshot was taken (serverCache is stale-while-revalidate up to 10 minutes, so
// that gap is not hypothetical). On a fast move the header can read a rising price beside a
// falling percentage, which is not a rendering glitch: the numbers genuinely disagree.
//
// The fix is not to drop the WS price — it is the fresher, better number. It is to re-derive the
// percentage against the same reference close the snapshot used, so both halves move together.
//
// This is the same "derive, don't transport" principle as
// `features/spx/lib/spx-change-anchor.ts` (the 2026-08-07 P0), generalized one step: that helper
// needs the prior close to already be in the payload, while these call sites often have only
// `price` + `change_pct`, so the reference has to be recovered before it can be derived from.

/**
 * Finite-number coercion with an explicit null guard. The guard is the whole point: `Number(null)`
 * is 0, and 0 is a meaningful value for BOTH fields here — a `change_pct` of null (unknown) would
 * otherwise be read as an unchanged day, which is exactly the false certainty this module exists
 * to remove.
 */
function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type SnapshotLike = {
  price?: number | null;
  /** Prior-session close, when the provider gives it directly. */
  prev_close?: number | null;
  change_pct?: number | null;
};

/**
 * Recover the reference close a snapshot's `change_pct` was measured against.
 *
 * Prefers an explicit `prev_close` (exact). Otherwise inverts the percentage:
 * `prev = price / (1 + change_pct/100)`. That inversion is only as precise as the provider's
 * rounding of `change_pct` (2dp), which is fine here — it is used to re-derive another 2dp
 * percentage, not to display a price.
 *
 * Returns null when there is no honest way to recover it, so callers can tell "unknown" from
 * "unchanged" rather than defaulting to a reference that manufactures a 0.00% day.
 */
export function referenceCloseFromSnapshot(snap: SnapshotLike | null | undefined): number | null {
  if (!snap) return null;

  const prev = num(snap.prev_close);
  if (prev != null && prev > 0) return prev;

  const price = num(snap.price);
  const pct = num(snap.change_pct);
  if (price == null || price <= 0 || pct == null) return null;

  // A −100% day would put the divisor at zero. Real instruments do not print it, but a garbled
  // upstream row can, and dividing by it yields Infinity — which then reads as a plausible-looking
  // huge percentage downstream instead of an obvious absence.
  const factor = 1 + pct / 100;
  if (!(factor > 0)) return null;

  const recovered = price / factor;
  return Number.isFinite(recovered) && recovered > 0 ? recovered : null;
}

/**
 * Re-derive `change_pct` for a fresher price against the snapshot's own reference close, so the
 * pair stays coherent.
 *
 * Returns null when the reference close cannot be recovered — the caller then keeps the snapshot's
 * original percentage (stale, but at least a real measurement) rather than inventing one. Rounded
 * to 2dp to match every provider path that produces `change_pct`.
 */
export function rebaseChangePct(
  freshPrice: number | null | undefined,
  snap: SnapshotLike | null | undefined
): number | null {
  const price = num(freshPrice);
  if (price == null || price <= 0) return null;

  const ref = referenceCloseFromSnapshot(snap);
  if (ref == null) return null;

  return Number((((price - ref) / ref) * 100).toFixed(2));
}

/**
 * Overlay a fresher price onto a snapshot, keeping the percentage coherent with it.
 *
 * Returns the snapshot untouched when the fresh price is unusable, so a dead WS tick can never
 * downgrade a good REST quote.
 */
export function withFreshPrice<T extends SnapshotLike>(snap: T, freshPrice: number | null | undefined): T {
  const price = num(freshPrice);
  if (price == null || price <= 0) return snap;

  const rebased = rebaseChangePct(price, snap);
  return rebased == null ? { ...snap, price } : { ...snap, price, change_pct: rebased };
}
