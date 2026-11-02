/**
 * Pick, per failing test name, the EARLIEST offset (in days) at which it fails — not simply the
 * first offset `test-date-bomb-scan.mjs` happened to encounter while walking its `runs` array.
 *
 * ROOT CAUSE THIS REPLACES. The scanner's main loop used to do:
 *
 *   for (const r of runs) {
 *     for (const [name, file] of r.failures) {
 *       if (baseline.failures.has(name)) continue;
 *       if (!candidates.has(name)) candidates.set(name, { days: r.offsetDays, file });
 *     }
 *   }
 *
 * `!candidates.has(name)` means "keep whichever offset got here FIRST", which is only the
 * earliest offset if `runs` is iterated in ascending `offsetDays` order. Nothing enforces that —
 * `runs` is built by pushing one result per entry of `OFFSET_DAYS`, which comes straight from
 * `--offsets=<csv>` with no sort. The documented default (`3,10,45,120,400`) happens to already be
 * ascending, so every run of this tool so far looked correct by accident. Pass
 * `--offsets=120,10,45` (a perfectly ordinary thing to type — there's no stated requirement to sort
 * it) and a test that fails at BOTH +10d and +120d gets reported as "fires within +120d": the
 * report understates how soon the bomb actually goes off by 110 days, which is exactly the
 * information this tool exists to get right (CI going red on a date nobody expects).
 *
 * FIX: track the minimum `offsetDays` seen for each name explicitly, independent of run order.
 */
export function selectEarliestBombCandidates(baselineFailureNames, runs) {
  const candidates = new Map(); // name -> { days, file }
  for (const r of runs) {
    if (r.offsetDays === 0 || !r.ran) continue;
    for (const [name, file] of r.failures) {
      if (baselineFailureNames.has(name)) continue; // already broken today — not this scan's finding
      const existing = candidates.get(name);
      if (!existing || r.offsetDays < existing.days) candidates.set(name, { days: r.offsetDays, file });
    }
  }
  return candidates;
}
