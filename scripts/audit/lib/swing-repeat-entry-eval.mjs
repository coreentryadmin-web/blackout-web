/**
 * SWING REPEAT-ENTRY OUTCOME — pure eval, no IO. Built after a live repro (Ask Largo standing
 * mandate, 2026-10-26, PR #4076 comment): GOOG stopped out 3 times in a 10-day window across 3
 * DIFFERENT archetype classifiers (PULLBACK_CONTINUATION 10-12, SECTOR_ROTATION 10-15,
 * EVENT_DRIVEN 10-21), each new entry trigger sitting below the previous position's own
 * invalidation level — three independent discovery paths each called a LONG bottom on a declining
 * name. That is one anecdote; this module answers the real question on the full closed
 * population: does win rate actually degrade on the 2nd/3rd same-ticker-same-direction attempt
 * within a short window, or was GOOG a 3-instance coincidence?
 *
 * ATTEMPT-SEQUENCE DERIVATION. Groups closed chains by (ticker, direction), sorts by committedAt
 * ascending, and assigns each row an ATTEMPT NUMBER within its own cluster: the sequence resets to
 * 1 whenever the gap between this row's committedAt and the PREVIOUS row's own exitAt exceeds
 * `windowDays` (default 14, matching the window named in the #4076 research question) — i.e.
 * "attempt 2" means "we re-entered the same name/side within N days of our last exit on it," not
 * merely "the Nth time ever." A long-dormant name re-entered months later is correctly a FRESH
 * attempt 1, not attempt 4 — the gate this module is testing a case FOR has to distinguish a real
 * back-to-back retry from an unrelated later, independent setup.
 *
 * Reuses `classifyLossBucket`'s WIN/BAD_EXIT/BAD_ENTRY/VARIANCE taxonomy (same mechanical rule,
 * same file, same fixture shape) so this composes with the sibling
 * `swing-loss-taxonomy-segment-eval.mjs` tool and its `segmentTaxonomy`/`flagDivergentSegments`
 * helpers rather than reinventing a second WIN/LOSS rule or a second Simpson's-paradox flag.
 *
 * PURE AND TOTAL: no IO, no clock (committedAt/exitAt come from the row, never Date.now()), no
 * throw. A row missing ticker/direction/a parseable committedAt is dropped from sequencing
 * (attemptNumber/attemptLabel null) rather than guessed into a cluster.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Assigns `attemptNumber`/`attemptLabel` ("1st"/"2nd"/"3rd+") to every row based on its position in
 * its own (ticker, direction) cluster, gapped by `windowDays`. Returns NEW objects — never mutates
 * the input rows.
 * @param {Array<{ticker: string, direction: "LONG"|"SHORT", committedAt: string|null, exitAt?: string|null}>} rows
 * @param {{windowDays?: number}} [opts]
 * @returns {Array<object & {attemptNumber: number|null, attemptLabel: "1st"|"2nd"|"3rd+"|null}>}
 */
export function withAttemptSequence(rows, { windowDays = 14 } = {}) {
  const groups = new Map();
  for (const r of rows ?? []) {
    if (typeof r?.ticker !== "string" || !r.ticker.trim()) continue;
    if (r.direction !== "LONG" && r.direction !== "SHORT") continue;
    const committedMs = typeof r.committedAt === "string" ? Date.parse(r.committedAt) : NaN;
    if (!Number.isFinite(committedMs)) continue;
    const key = `${r.ticker.trim().toUpperCase()}|${r.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row: r, committedMs });
  }

  const attemptByRow = new Map();
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.committedMs - b.committedMs);
    let attempt = 0;
    let prevExitMs = null;
    for (const { row, committedMs } of entries) {
      const gapDays = prevExitMs != null ? (committedMs - prevExitMs) / MS_PER_DAY : null;
      attempt = attempt === 0 || gapDays == null || gapDays > windowDays ? 1 : attempt + 1;
      attemptByRow.set(row, attempt);
      const exitMs = typeof row.exitAt === "string" ? Date.parse(row.exitAt) : NaN;
      if (Number.isFinite(exitMs)) prevExitMs = exitMs;
    }
  }

  return (rows ?? []).map((r) => {
    const attempt = attemptByRow.get(r) ?? null;
    const attemptLabel = attempt == null ? null : attempt >= 3 ? "3rd+" : attempt === 2 ? "2nd" : "1st";
    return { ...r, attemptNumber: attempt, attemptLabel };
  });
}
