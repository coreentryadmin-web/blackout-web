/**
 * Pure helpers for `swing-pre-entry-drift-probe.mjs` — see that script's header for the full WHY.
 * Deliberately network/DB-free so the classification/ratio math is unit-testable in isolation and
 * never silently reimplemented/drifted inside the live harness itself.
 */

/**
 * Find a closed position's REAL discovery timestamp by joining `GET /api/market/swing/record`'s
 * `closedDeck.positionId` against `GET /api/admin/swing/accumulation-export`'s
 * `promoted_position_id` — the join this probe rests on (see the harness header for why
 * `closedDeck.firstSeenAt` itself cannot be used: live-verified to equal `committedAt` byte-for-
 * byte on every sampled position, i.e. it is stamped at position-row creation, not true discovery).
 * `accumRows` may contain multiple rows per ticker (the conflict key is ticker/direction/archetype,
 * so a thesis that got reclassified mid-accumulation has more than one row) and non-promoted
 * (still-pending/rejected) rows — this returns the SPECIFIC row whose `promoted_position_id`
 * matches, or null when no accumulation row was ever promoted to this position (a real, disclosed
 * gap — e.g. a Legacy-morning-confirm-promoted play that never went through the FLOW/STRUCTURE
 * accumulation store at all).
 */
export function findRealFirstSeenAt(accumRows, positionId) {
  const hit = accumRows.find((r) => r.promoted_position_id === positionId);
  return hit?.first_seen_at ?? null;
}

/**
 * Sign-aligned % price move, LONG/SHORT vocabulary (the `SwingClosedDeckSource.direction` field's
 * own values, not the "bull"/"bear" vocabulary the FLOW accumulation engine uses elsewhere in this
 * toolkit) — a SHORT position's favorable move is a PRICE DECLINE, so its raw pct is sign-flipped
 * the same way `gradeForgoneMove` (swing-cadence-gap-eval.mjs) flips for "bear". Never fabricates a
 * result from missing/invalid prices — returns null instead.
 */
export function signAlignedMovePct({ fromPrice, toPrice, direction }) {
  if (
    fromPrice == null || !Number.isFinite(fromPrice) || fromPrice <= 0 ||
    toPrice == null || !Number.isFinite(toPrice) || toPrice <= 0
  ) {
    return null;
  }
  const rawPct = ((toPrice - fromPrice) / fromPrice) * 100;
  return direction === "SHORT" ? -rawPct : rawPct;
}

/**
 * Classify + (where well-posed) quantify how much of a closed position's total favorable underlying
 * excursion — from its FIRST DISCOVERY (`firstSeenAt`, when the ticker became a candidate) through
 * its own post-entry MFE — had already happened BEFORE it was actually committed (entered):
 *   - "no_pre_entry_drift": the underlying had NOT already moved favorably (sign-aligned) between
 *     discovery and commit — a "fresh" entry, not a late/chasing one. driftFraction 0 by convention
 *     (there is nothing pre-entry to attribute).
 *   - "no_post_entry_capture": the position never had a favorable underlying excursion AFTER entry
 *     at all (even though it may have drifted favorably before) — driftFraction is NOT computable
 *     (the denominator would be non-positive), reported as null rather than a divide-by-zero
 *     fabrication.
 *   - "measurable": both legs were genuinely favorable — driftFraction =
 *     preEntryMovePct / (preEntryMovePct + postEntryMovePct), a clean value in (0, 1). A HIGH
 *     fraction means most of the eventual favorable move had already happened before the trade was
 *     ever entered (a late/chasing entry, less room left to run); a LOW fraction means the position
 *     captured most of its own move after commit (an early entry).
 */
export function classifyPreEntryDrift({ preEntryMovePct, postEntryMovePct }) {
  if (preEntryMovePct == null || postEntryMovePct == null) {
    return { bucket: "insufficient_data", driftFraction: null };
  }
  if (preEntryMovePct <= 0) {
    return { bucket: "no_pre_entry_drift", driftFraction: 0 };
  }
  if (postEntryMovePct <= 0) {
    return { bucket: "no_post_entry_capture", driftFraction: null };
  }
  return { bucket: "measurable", driftFraction: preEntryMovePct / (preEntryMovePct + postEntryMovePct) };
}

/**
 * The underlying's own most-favorable (sign-aligned) close within a window of daily bars — the
 * underlying-price analogue of an option position's MFE. `bars` are Polygon daily aggs (`{t, c}`,
 * ascending by time); returns null when no bar falls at-or-after `fromMs` and at-or-before `toMs`
 * (never guesses a peak from bars outside the real post-entry window).
 */
export function mostFavorableCloseInWindow(bars, { fromMs, toMs, direction }) {
  let best = null;
  for (const b of bars) {
    if (b.t == null || !Number.isFinite(b.c)) continue;
    if (b.t < fromMs || b.t > toMs) continue;
    if (best == null) { best = b.c; continue; }
    best = direction === "SHORT" ? Math.min(best, b.c) : Math.max(best, b.c);
  }
  return best;
}

/**
 * Last daily-bar close at or before `targetMs` (falls back to the first bar if the target predates
 * every bar returned — the same "no guess past the edge of real data" convention
 * `swing-cadence-gap-recall-probe.mjs`'s own `priceAt` uses). Returns null on an empty bar set.
 */
export function closeAtOrBefore(bars, targetMs) {
  let best = null;
  for (const b of bars) {
    if (b.t == null || !Number.isFinite(b.c)) continue;
    if (b.t <= targetMs && (best == null || b.t > best.t)) best = b;
  }
  return best?.c ?? bars[0]?.c ?? null;
}
