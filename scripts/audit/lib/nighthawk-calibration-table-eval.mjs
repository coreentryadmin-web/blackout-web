/**
 * Pure helpers for scripts/audit/nighthawk-calibration-table.mjs (NH-R6).
 *
 * Kept separate from the .mjs driver (which does DB/dynamic-import IO) so the exact
 * comparison math each provisional constant's row rests on has a plain `node --test`
 * regression test with no DB/network — same split as merge-precedence-eval.mjs.
 */

/** Display label + the ONE boolean UIs would actually flip on (mirrors Swing's
 *  `scoreFloorGraduated: false` pattern) for a calibration.ts-style verdict string. */
export function displayVerdict(verdict) {
  if (verdict === "enforce") return { label: "GRADUATED", graduated: true };
  if (verdict === "keep_calibrating") return { label: "HOLD", graduated: false };
  return { label: "INSUFFICIENT_DATA", graduated: false };
}

/**
 * NH-R9 (CONTESTED_MIN_MAGNITUDE): the contested gate is a HARD BLOCK (cortex-gate.ts),
 * so it never reaches the committed ledger as a would-block/would-pass pair the way the
 * CALIBRATION-mode gates (G-4/G-6) do — its only evidence is the counterfactually-graded
 * `cortex_contested` rejections (skip-grading.ts, surfaced by calibration.ts's existing
 * `blocked_value` line for that gate_failed code). This applies the SAME graduation ladder
 * `recommendGate` uses (n>=minBlockN, baseline not low_n, delta>=minDeltaPts) to that one
 * blocked-value line against the aggregate committed win rate as the would-pass baseline —
 * it does not invent a new threshold, just re-targets the existing one at skip-grading data
 * recommendGate itself cannot read (it's keyed on gate_calibration_json, not blocked_value).
 */
export function contestedGateVerdict({
  blockedLine,
  baseline,
  lowNThreshold,
  minBlockN,
  minDeltaPts,
  epsilon = 1e-9,
}) {
  const n = blockedLine?.n ?? 0;
  const wouldBlockWr = blockedLine?.would_have_won_rate_pct ?? null;
  const baselineN = baseline?.n ?? 0;
  const baselineWr = baseline?.win_rate_pct ?? null;
  const baselineLowN = baselineN < lowNThreshold;

  if (n < minBlockN) {
    return {
      verdict: "insufficient_data",
      reason: `cortex_contested blocked ${n} gradeable candidate(s) — graduation requires n>=${minBlockN} counterfactually-graded blocks (same bar recommendGate applies to G-4/G-6).`,
    };
  }
  if (baselineLowN || wouldBlockWr == null || baselineWr == null) {
    return {
      verdict: "insufficient_data",
      reason: `baseline (all graded committed plays) has n=${baselineN} — too thin to compare the contested-block rate against.`,
    };
  }
  const delta = baselineWr - wouldBlockWr;
  if (delta >= minDeltaPts - epsilon) {
    return {
      verdict: "enforce",
      reason:
        `committed baseline ran ${baselineWr}% WR (n=${baselineN}) vs the cortex_contested-blocked candidates' ` +
        `${wouldBlockWr}% would-have-won rate (n=${n}) — ${Math.round(delta * 10) / 10} pts worse, clearing the ` +
        `${minDeltaPts}-pt bar. The contested block has earned its keep.`,
    };
  }
  return {
    verdict: "keep_calibrating",
    reason:
      `Delta is ${Math.round(delta * 10) / 10} pts (baseline ${baselineWr}% vs blocked-would-have-won ${wouldBlockWr}%) ` +
      `— under the ${minDeltaPts}-pt bar. Not enough demonstrated harm to call the contested block earned yet.`,
  };
}

/**
 * NH-R11 (FAMILY_SUPPORT_CAPS["dealer-positioning"]): a committed row's `entry_context.cortex.supports`
 * is already POST-cap (compose.ts scales the family's items down in place before the verdict is
 * returned) — so this can only read whether the persisted family sum SATURATES at the cap (a proxy
 * for "the cap fired"), never the true pre-cap magnitude the cap suppressed. Returns null when the
 * row carries no readable Cortex support evidence (abstained, pre-wire-in, or a decayed/absent read).
 */
export function dealerFamilySupportSum(cortex, familyMap, family = "dealer-positioning") {
  if (!cortex || cortex.abstained !== false || !Array.isArray(cortex.supports)) return null;
  let sum = 0;
  let any = false;
  for (const s of cortex.supports) {
    if (!s || typeof s.weight !== "number" || !Number.isFinite(s.weight)) continue;
    if (familyMap[s.source] !== family) continue;
    sum += s.weight;
    any = true;
  }
  return any ? sum : 0;
}

/** saturated = family sum at/above the cap (within epsilon — the proxy for "the cap fired");
 *  unsaturated = a readable sum below it; no_read = no usable Cortex support evidence at all. */
export function familyCapBucket(familySum, cap, epsilon = 1e-9) {
  if (familySum == null) return "no_read";
  return familySum >= cap - epsilon ? "saturated" : "unsaturated";
}
