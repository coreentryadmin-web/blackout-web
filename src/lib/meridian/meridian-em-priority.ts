/**
 * Which earnings prints get the expected-move budget.
 *
 * THE DEFECT. `batchLoadEarningsExpectedMovePct` does `[...byTicker.entries()].slice(0, BATCH_CAP)`
 * — a hard cap of 36 applied to a Map in INSERTION order, which is calendar order, which is
 * unrelated to whether anyone cares about the name. Measured live on a 21-day timeline,
 * 2026-08-21:
 *
 *     154 earnings items · 36 attempted · 7 returned a value (4.5% of the lane)
 *     the 7 sat at positions 2, 17, 24, 26, 28, 30, 33 — every one inside the cap
 *
 * So the cap was the binding constraint, not data availability. Sampling six HIGH-IMPACT names
 * that fell beyond position 36 and calling the loader directly:
 *
 *     VEEV 15.2%   SJM 9.2%   NVDA 7.7%   NTNX 18.2%   HPQ 12.5%   DCI 10.3%
 *
 * Every one had a chain. **NVDA — the most-watched print of the window, high impact, five days
 * out — showed no implied move because it happened to sort past 36.** Meanwhile 29 of the 36 pulls
 * that were spent went to names with no chain at all. The budget was being spent almost exactly
 * backwards.
 *
 * THE FIX IS ORDERING, NOT A BIGGER CAP. 154 chain pulls per timeline load is not affordable and
 * raising the cap would trade a visible gap for a latency one. The same principle
 * `detailRefreshMsFor` already applies to polling applies here: spend the budget where it changes
 * a decision. Rank first, then cap.
 *
 * AND SAY WHAT WAS SKIPPED. Before this, `expected_move_pct: null` meant BOTH "this name has no
 * options chain" and "we never looked" — different facts, and only one of them is about the name.
 * `rankEarningsForExpectedMove` returns both halves so the caller can report coverage instead of
 * publishing an absence it created itself.
 */

export type EmCandidate = {
  ticker: string;
  report_date: string;
  /** Timeline impact bucket, when known. */
  impact?: string | null;
  /** Benzinga importance 0-5, when known. */
  importance?: number | null;
  /** ET days until the print. Nearer prints are worth more — the move is about to be resolved. */
  days_until?: number | null;
};

const IMPACT_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };

function impactScore(c: EmCandidate): number {
  const s = String(c.impact ?? "").trim().toLowerCase();
  return IMPACT_RANK[s] ?? -1;
}

/**
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so a bare coercion reads ABSENT as a real
 * reading — importance 0, or "reporting today". I wrote that bug into this file and the unknown-date
 * test caught it: `days_until: null` scored 0, which is the most urgent value there is, so a row
 * with no date outranked a confirmed mega-cap print for a scarce chain pull. The `== null` guard is
 * the whole fix, and it is the same one `meridian-timeline-for-largo.ts` needed for the same reason.
 */
function scoreOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function importanceScore(c: EmCandidate): number {
  // Unknown ranks BELOW a real 0 — "we do not know how important this is" is weaker evidence
  // than "we know it is unimportant", and the two must not collapse into one bucket.
  return scoreOrNull(c.importance) ?? -1;
}

function daysScore(c: EmCandidate): number {
  // Unknown sorts LAST rather than first: a row with no date is the one we know least about, and
  // handing it a scarce chain pull ahead of a confirmed mega-cap print is the bug in miniature.
  return scoreOrNull(c.days_until) ?? Number.POSITIVE_INFINITY;
}

/**
 * Rank candidates by decision value, dedupe by ticker, and split at `cap`.
 *
 * Order: impact desc, then Benzinga importance desc, then soonest, then ticker for determinism.
 * A stable total order matters more than the exact weights — an unstable one would make the
 * covered set flap between loads, so a name would gain and lose its implied move at random.
 */
export function rankEarningsForExpectedMove(
  candidates: readonly EmCandidate[] | null | undefined,
  cap: number
): { attempt: EmCandidate[]; skipped: EmCandidate[]; requested: number } {
  const byTicker = new Map<string, EmCandidate>();
  for (const c of candidates ?? []) {
    const t = String(c?.ticker ?? "").trim().toUpperCase();
    const d = String(c?.report_date ?? "").slice(0, 10);
    if (!t || !d) continue;
    // First occurrence wins, matching the previous behaviour for duplicate tickers — but the
    // ranking below then decides which SURVIVE the cap, which is the part that was wrong.
    if (!byTicker.has(t)) byTicker.set(t, { ...c, ticker: t, report_date: d });
  }

  const ordered = [...byTicker.values()].sort(
    (a, b) =>
      impactScore(b) - impactScore(a) ||
      importanceScore(b) - importanceScore(a) ||
      daysScore(a) - daysScore(b) ||
      a.ticker.localeCompare(b.ticker)
  );

  const n = Math.max(0, Math.trunc(cap) || 0);
  return { attempt: ordered.slice(0, n), skipped: ordered.slice(n), requested: ordered.length };
}

/** Coverage a caller can publish, so a skipped name is not mistaken for a name with no chain. */
export type EmCoverage = {
  requested: number;
  attempted: number;
  skipped: number;
  resolved: number;
  /** Present only when something was skipped — a note the reader needs and cannot derive. */
  note: string | null;
};

export function describeEmCoverage(
  requested: number,
  attempted: number,
  resolved: number
): EmCoverage {
  const skipped = Math.max(0, requested - attempted);
  return {
    requested,
    attempted,
    skipped,
    resolved,
    note:
      skipped > 0
        ? `Options-implied move was computed for the ${attempted} highest-impact, soonest prints of ${requested}. The other ${skipped} were NOT queried — a null expected_move_pct on those means "not looked up", not "this name has no options market".`
        : null,
  };
}
