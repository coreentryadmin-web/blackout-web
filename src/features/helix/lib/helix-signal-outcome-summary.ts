import type { HelixSignalOutcomeRow } from "@/lib/db";

/**
 * Tier 2 item #10 (follow-through tracker). Pure summary logic over the ledger
 * helix-signal-outcomes-job.ts writes — kept separate from the API route so it's
 * independently unit-testable without a DB.
 *
 * Below this many GRADED (non-pending) rows, no win-rate is shown — matches the
 * repo's own established threshold (signal-accuracy.ts's
 * MIN_SAMPLE_FOR_RECOMMENDATION) for "don't claim a verdict off a handful of
 * samples." This is the concrete implementation of the audit's sequencing-risk
 * finding: Tier 3's conviction scores must never ship ahead of real evidence, and
 * this is the first UI surface where that discipline has to hold.
 */
export const MIN_GRADED_SAMPLE_FOR_WIN_RATE = 10;

/**
 * The graded distribution of ONE population of firings — the whole ledger, or one signal type.
 * Shared so the aggregate and every per-type row are computed by the identical code and can never
 * disagree about how a rate or a bucket is derived.
 */
export type HelixOutcomeDistribution = {
  gradedCount: number;
  pendingCount: number;
  /** Firings that CONTINUED in the signal's own direction. Kept under this name because the
   *  existing tracker panel reads it; it is a continuation count, not a P&L "win". */
  winCount: number;
  /** null when gradedCount < MIN_GRADED_SAMPLE_FOR_WIN_RATE — never a fabricated 0%. */
  winRatePct: number | null;
  /** The full graded distribution. `winRatePct` alone cannot express it, and the missing half
   *  changes the read: live 2026-08-20, 40 graded split 25 continued / 12 flat / 3 reversed, so
   *  "62.5%" implied 37.5% went wrong when only 7.5% actually reversed and 30% went nowhere.
   *  A signal that rarely reverses but often stalls is a different instrument from one that is
   *  wrong a third of the time, and the two were indistinguishable in the payload. */
  continuedCount: number;
  flatCount: number;
  reversedCount: number;
  /** Graded rows whose outcome is none of continued/flat/reversed — 0 today. Present so an
   *  unrecognised grade can never be silently absorbed into one of the three real buckets. */
  otherCount: number;
  /**
   * The fired_at span of the GRADED rows this rate is computed over — oldest and newest, as the
   * raw ledger timestamp (kept verbatim; the ET-session projection happens at the model boundary,
   * where the timezone helpers live). NULL when nothing graded carries a parseable time.
   *
   * WHY: a rate is a number with no time until it names the window it covers. The follow-through
   * ledger holds the 50 most-recent rows, and a signal cannot be graded until forward bars exist,
   * so early in a session EVERY graded row is from a PRIOR session — measured live 2026-08-21 at
   * 09:40 ET, all 40 graded fires were 2026-08-20 14:00–16:30 ET (17h+ old). The payload stamped
   * `as_of` = NOW beside "62.5% continuation", so the rate read as current when it was entirely
   * yesterday's afternoon. The COUNT scope (rows_summarized) was already disclosed; the TIME scope
   * was not, and the newest 20 shown rows cannot reveal the oldest bound. These two fields make the
   * rate's window statable: "62.5% over 40 fires between <oldest> and <newest>".
   */
  gradedOldestFiredAt: string | null;
  gradedNewestFiredAt: string | null;
  /**
   * Graded rows that made a DIRECTIONAL claim and could therefore have been wrong.
   *
   * WHY THIS EXISTS, and it is the sharpest scope gap left in this payload. `gradeOutcome`
   * (helix-signal-outcomes-job.ts) branches on `bullish` / `bearish` and lets EVERYTHING ELSE fall
   * through to `return "continued"` — a branch written for velocity spikes, which carry an explicit
   * `direction: null` because they are a magnitude signal. But split-flow rows pass their own
   * `direction` straight through, and that can be `mixed` or `undetermined`. Executed against the
   * real function: `undetermined` grades **continued at +1% AND at −1%**. A firing that explicitly
   * REFUSED to state a direction is therefore scored as a correct directional call on any move past
   * the flat threshold, in either direction. It cannot ever be `reversed`.
   *
   * Those rows land in the same `split_flow` bucket as genuine directional predictions, and
   * `winCount` is `continuedCount`, so the continuation rate is inflated by firings that were
   * structurally incapable of losing.
   *
   * The size of it is not marginal after #2723. Replayed over a live session, `undetermined` is now
   * the PLURALITY of split-flow firings — **162 of 333 (48.6%)** — with **SPX 67/67 and SPY 65/65**
   * every one undetermined, because the index feed carries no aggressor side at all (`ask_pct` on
   * 0 of 3500 rows). So roughly half the split-flow ledger would be unlosable by construction.
   */
  directionalGradedCount: number;
  /** Graded rows that made NO directional claim — `null` (velocity, honestly non-directional) or a
   *  refusal (`mixed` / `undetermined`). Reported rather than hidden: these are exactly the rows
   *  the rate above cannot be wrong about. */
  unfalsifiableGradedCount: number;
  /**
   * Continuation rate over ONLY the rows that could have been reversed.
   *
   * This is the number to quote when asking "is this signal right?" — `winRatePct` answers a
   * different question, "how often did price continue after any firing", and the two diverge
   * exactly as far as the unfalsifiable share is large. Null below the same sample floor, never a
   * fabricated 0%.
   */
  directionalWinRatePct: number | null;
};

export type HelixSignalOutcomeSummary = HelixOutcomeDistribution & {
  /**
   * The same follow-through math, computed PER SIGNAL TYPE (split_flow / velocity_spike / …).
   *
   * WHY THIS EXISTS. The aggregate answers "how reliable is HELIX", but a member asks "which HELIX
   * signal do I trust — split_flow or velocity_spike?", and that was unanswerable from the payload:
   * the aggregate blends the types, and the row list the model also receives is capped (20 of up to
   * 50), so hand-counting it is the capped-slice trap that inverted the compare card. Each type here
   * carries its OWN denominator and its OWN sub-threshold null — a type with fewer than
   * MIN_GRADED_SAMPLE_FOR_WIN_RATE graded fires reports `winRatePct: null`, never a rate manufactured
   * off two samples, exactly as the aggregate does. Sorted most-graded-first (the type with the most
   * evidence leads), then by name for a stable order.
   */
  bySignalType: Array<{ signal_type: string } & HelixOutcomeDistribution>;
};

/** Min/max of a set of ledger timestamps, returned as the ORIGINAL strings (unparsed, so no
 *  timezone reinterpretation happens here — the model boundary owns the ET projection). Rows whose
 *  fired_at will not parse are skipped rather than poisoning the span to Invalid Date. */
function firedAtSpan(rows: HelixSignalOutcomeRow[]): { oldest: string | null; newest: string | null } {
  let oldest: string | null = null;
  let newest: string | null = null;
  let oldestMs = Infinity;
  let newestMs = -Infinity;
  for (const r of rows) {
    const raw = r.fired_at;
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    if (ms < oldestMs) { oldestMs = ms; oldest = raw; }
    if (ms > newestMs) { newestMs = ms; newest = raw; }
  }
  return { oldest, newest };
}

/** Distribution + continuation rate over one population. The rate is null below the min sample. */
function distributionOf(rows: HelixSignalOutcomeRow[]): HelixOutcomeDistribution {
  const graded = rows.filter((r) => r.outcome !== "pending");
  const continuedCount = graded.filter((r) => r.outcome === "continued").length;
  const flatCount = graded.filter((r) => r.outcome === "flat").length;
  const reversedCount = graded.filter((r) => r.outcome === "reversed").length;
  const gradedCount = graded.length;
  // The rate describes the GRADED rows, so its window is the graded rows' span — NOT the fetched
  // set's (whose newest rows are today's still-pending fires that the rate does not include).
  const span = firedAtSpan(graded);
  // A row could have been WRONG only if it named a side. `bullish`/`bearish` are the two values
  // `gradeOutcome` actually branches on; anything else — null, mixed, undetermined, or a value
  // nobody has added yet — falls through to "continued" and is unfalsifiable. Tested by inclusion
  // on the two real values rather than by excluding a list of known refusals, so a NEW refusal
  // value cannot silently join the falsifiable set.
  const directional = graded.filter((r) => r.direction === "bullish" || r.direction === "bearish");
  const directionalGradedCount = directional.length;
  const directionalContinued = directional.filter((r) => r.outcome === "continued").length;
  return {
    gradedCount,
    pendingCount: rows.length - gradedCount,
    winCount: continuedCount,
    winRatePct:
      gradedCount >= MIN_GRADED_SAMPLE_FOR_WIN_RATE
        ? Math.round((continuedCount / gradedCount) * 1000) / 10
        : null,
    continuedCount,
    flatCount,
    reversedCount,
    // Derived by subtraction rather than by a fourth filter, so the four buckets ALWAYS sum to
    // gradedCount even if the grader gains a new outcome value.
    otherCount: gradedCount - continuedCount - flatCount - reversedCount,
    gradedOldestFiredAt: span.oldest,
    gradedNewestFiredAt: span.newest,
    directionalGradedCount,
    // By subtraction, so the two always reconcile to gradedCount however `direction` grows.
    unfalsifiableGradedCount: gradedCount - directionalGradedCount,
    directionalWinRatePct:
      directionalGradedCount >= MIN_GRADED_SAMPLE_FOR_WIN_RATE
        ? Math.round((directionalContinued / directionalGradedCount) * 1000) / 10
        : null,
  };
}

export function summarizeHelixSignalOutcomes(rows: HelixSignalOutcomeRow[]): HelixSignalOutcomeSummary {
  const byType = new Map<string, HelixSignalOutcomeRow[]>();
  for (const r of rows) {
    // An empty/undefined signal_type becomes "unknown" rather than vanishing — a type we cannot
    // name is still a graded fire and must reconcile into the total, same principle as otherCount.
    const key = r.signal_type || "unknown";
    const bucket = byType.get(key);
    if (bucket) bucket.push(r);
    else byType.set(key, [r]);
  }
  const bySignalType = [...byType.entries()]
    .map(([signal_type, typeRows]) => ({ signal_type, ...distributionOf(typeRows) }))
    .sort((a, b) => b.gradedCount - a.gradedCount || a.signal_type.localeCompare(b.signal_type));
  return { ...distributionOf(rows), bySignalType };
}
