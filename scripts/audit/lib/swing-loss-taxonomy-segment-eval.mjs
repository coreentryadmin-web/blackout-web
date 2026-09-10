/**
 * SWING LOSS-TAXONOMY SEGMENTATION — pure eval, no IO. (Night Hawk Swings v6 item 1: does the
 * aggregate loss taxonomy this lane already built (5 BAD_EXIT / 3 BAD_ENTRY / 3 VARIANCE, n=31,
 * journaled 2026-09-10) conceal a Simpson's-paradox-shaped concentration once split by archetype /
 * sub-lane / regime, or is it genuinely spread evenly?)
 *
 * MECHANICAL CLASSIFIER, DISCLOSED. The original 11-row taxonomy in the durable journal was built
 * by eye. To segment the FULL closed population (not just those 11 examples) this needs a
 * reproducible rule, so `classifyLossBucket` below applies one, stated plainly:
 *   - exitPnlPct >= 0                          -> WIN (not part of the loss taxonomy)
 *   - exitPnlPct < 0 and mfePct >= 10           -> BAD_EXIT   (real edge existed, wasn't banked)
 *   - exitPnlPct < 0 and mfePct <  5            -> BAD_ENTRY  (never had real edge)
 *   - exitPnlPct < 0 and 5 <= mfePct < 10       -> VARIANCE   (ambiguous middle, not forced either way)
 * where mfePct = (peakPremium - entryPremium) / entryPremium * 100 (mechanical peak-vs-entry, same
 * basis `buildTerminalExitLadder` already uses elsewhere in this lane's tooling). This is NOT a
 * byte-for-byte reproduction of the hand-curated 11-row list (IGV's known +14.6% MFE sits above the
 * 10% BAD_EXIT floor here on purpose, to keep it classified the same way the manual pass called it) —
 * it is a fresh, disclosed, uniform rule applied to every row so segmentation isn't cherry-picked.
 * A row missing any of the three inputs is UNCLASSIFIABLE, dropped from the count, never guessed.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** @returns {"WIN"|"BAD_EXIT"|"BAD_ENTRY"|"VARIANCE"|null} */
export function classifyLossBucket(row) {
  const { entryPremium, peakPremium, exitPnlPct } = row ?? {};
  if (!isNum(entryPremium) || entryPremium <= 0 || !isNum(peakPremium) || !isNum(exitPnlPct)) return null;
  if (exitPnlPct >= 0) return "WIN";
  const mfePct = ((peakPremium - entryPremium) / entryPremium) * 100;
  if (mfePct >= 10) return "BAD_EXIT";
  if (mfePct < 5) return "BAD_ENTRY";
  return "VARIANCE";
}

/**
 * Segment classified rows by a dimension key (e.g. row.archetype), reporting per-segment bucket
 * counts + the segment's own loss rate, alongside the aggregate for comparison. Segments below
 * `minN` are still reported (named, with their real n) but flagged `thin: true` rather than silently
 * dropped — the caller decides whether to act on a thin segment, this module never hides one.
 * @param {Array<{key: string|null, bucket: string|null}>} classified
 */
export function segmentTaxonomy(classified, { minN = 5 } = {}) {
  const usable = classified.filter((r) => r.bucket != null && r.key != null);
  const aggregate = tally(usable.map((r) => r.bucket));
  const byKey = new Map();
  for (const r of usable) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r.bucket);
  }
  const segments = [...byKey.entries()]
    .map(([key, buckets]) => {
      const counts = tally(buckets);
      const n = buckets.length;
      const losses = (counts.BAD_EXIT ?? 0) + (counts.BAD_ENTRY ?? 0) + (counts.VARIANCE ?? 0);
      const lossRatePct = n > 0 ? Math.round((losses / n) * 1000) / 10 : null;
      return { key, n, counts, lossRatePct, thin: n < minN };
    })
    .sort((a, b) => b.n - a.n);
  const aggN = usable.length;
  const aggLosses = (aggregate.BAD_EXIT ?? 0) + (aggregate.BAD_ENTRY ?? 0) + (aggregate.VARIANCE ?? 0);
  const aggregateLossRatePct = aggN > 0 ? Math.round((aggLosses / aggN) * 1000) / 10 : null;
  return {
    totalN: aggN,
    droppedUnclassifiable: classified.length - usable.length,
    aggregate,
    aggregateLossRatePct,
    segments,
  };
}

function tally(buckets) {
  const out = { WIN: 0, BAD_EXIT: 0, BAD_ENTRY: 0, VARIANCE: 0 };
  for (const b of buckets) out[b] = (out[b] ?? 0) + 1;
  return out;
}

/**
 * Simpson's-paradox flag: a segment whose own loss rate diverges from the aggregate by more than
 * `deltaPp` percentage points AND clears `minN` is named as a real divergence worth a closer look;
 * everything else (thin, or close to aggregate) is left alone. Never asserts causation — only flags
 * where the aggregate number could be masking a segment-level story.
 */
export function flagDivergentSegments(segmentResult, { deltaPp = 20, minN = 5 } = {}) {
  const { aggregateLossRatePct, segments } = segmentResult;
  if (aggregateLossRatePct == null) return [];
  return segments
    .filter((s) => !s.thin && s.n >= minN && s.lossRatePct != null)
    .map((s) => ({ ...s, deltaFromAggregatePp: Math.round((s.lossRatePct - aggregateLossRatePct) * 10) / 10 }))
    .filter((s) => Math.abs(s.deltaFromAggregatePp) >= deltaPp);
}
