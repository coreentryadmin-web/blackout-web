/**
 * SWING EARLY-TRIM A/B — pure counterfactual comparison, no IO.
 *
 * WHY THIS EXISTS. `SWING_SCALE_OUT_POLICY` (src/lib/swing/exit-policy.ts) has exactly ONE trim
 * rung, at +100% premium gain, banking 50%. Swing's real live management (`evaluateSwingManagement`,
 * manage-sync.ts) is NOT a pure mechanical price ladder like 0DTE's `evaluateExitState` — it also
 * gates on thesis-break, catalyst shift, regime shift, flow decay, relative-strength loss, and vol
 * collapse, none of which are reconstructable from historical option bars alone. A faithful replay
 * of the REAL decision engine against past dates is therefore not attemptable offline without
 * fabricating those qualitative inputs — which this repo's own discipline forbids (never guess a
 * missing signal).
 *
 * What IS answerable honestly from data already served by `GET /api/market/swing/record`: does the
 * *mechanical* trim ladder itself (entry/peak-premium-only, exactly the same math
 * `buildTerminalExitLadder` already uses to decide `fired`) sit at a level real swing trades ever
 * reach? And if a second, EARLIER rung existed, would banking part of the gain there — leaving the
 * runner to close at the SAME real final P&L already recorded — have improved the aggregate outcome?
 *
 * The counterfactual assumption this rests on: taking an earlier partial off the table does not
 * change the underlying's future price path, so "the runner still closes at the real recorded
 * exitPnlPct" is a legitimate, honest simplification — not a re-derivation of what management WOULD
 * have decided under a different policy (which this module explicitly does NOT claim to model).
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

/**
 * Blended P&L for one closed position under a given trim-rung policy.
 * @param {{ entryPremium: number|null, peakPremium: number|null, exitPnlPct: number|null }} row
 * @param {{ triggerPct: number, fraction: number }[]} trims - rungs in ANY order; sorted internally.
 * @returns {number|null} blended P&L pct, or null when the row lacks a re-priceable basis.
 */
export function blendedPnlUnderPolicy(row, trims) {
  const entry = row.entryPremium;
  if (!(entry > 0) || row.peakPremium == null || !Number.isFinite(row.peakPremium)) return null;
  if (row.exitPnlPct == null || !Number.isFinite(row.exitPnlPct)) return null;
  const ordered = [...trims].sort((a, b) => a.triggerPct - b.triggerPct);
  let remaining = 1;
  let realized = 0;
  for (const t of ordered) {
    const level = entry * (1 + t.triggerPct / 100);
    if (row.peakPremium >= level) {
      realized += t.fraction * t.triggerPct;
      remaining -= t.fraction;
    }
  }
  realized += remaining * row.exitPnlPct;
  return Math.round(realized * 100) / 100;
}

/**
 * Paired comparison of two trim policies over the same population — one closed chain replayed
 * under both, so the difference is a paired delta (far more powerful than treating the two
 * policies as independent samples of different trades, which they are not).
 * @param {{ ticker: string, entryPremium: number|null, peakPremium: number|null, exitPnlPct: number|null }[]} rows
 */
export function comparePolicies(rows, currentTrims, candidateTrims) {
  const paired = [];
  for (const row of rows) {
    const current = blendedPnlUnderPolicy(row, currentTrims);
    const candidate = blendedPnlUnderPolicy(row, candidateTrims);
    if (current == null || candidate == null) continue;
    paired.push({ ticker: row.ticker, current, candidate, delta: Math.round((candidate - current) * 100) / 100 });
  }
  const n = paired.length;
  if (n === 0) {
    return { n: 0, meanCurrent: null, meanCandidate: null, meanDelta: null, ci: null, verdict: "NO DATA", paired };
  }
  const meanCurrent = paired.reduce((a, p) => a + p.current, 0) / n;
  const meanCandidate = paired.reduce((a, p) => a + p.candidate, 0) / n;
  const meanDelta = paired.reduce((a, p) => a + p.delta, 0) / n;
  const variance = n > 1 ? paired.reduce((a, p) => a + (p.delta - meanDelta) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(variance / n);
  const ci = { lo: meanDelta - 1.96 * stderr, hi: meanDelta + 1.96 * stderr };
  const verdict = n < 2 ? "INSUFFICIENT N" : ci.lo > 0 ? "CANDIDATE SEPARATED (better)" : ci.hi < 0 ? "CURRENT SEPARATED (better)" : "INCONCLUSIVE";
  return {
    n,
    meanCurrent: Math.round(meanCurrent * 100) / 100,
    meanCandidate: Math.round(meanCandidate * 100) / 100,
    meanDelta: Math.round(meanDelta * 100) / 100,
    ci: { lo: Math.round(ci.lo * 100) / 100, hi: Math.round(ci.hi * 100) / 100 },
    verdict,
    paired,
  };
}

/** How many rows never reach a given trigger level at all — the "is this rung even reachable"
 *  question, reported alongside the P&L comparison so a verdict is never read without it. */
export function reachRate(rows, triggerPct) {
  const withBasis = rows.filter((r) => r.entryPremium > 0 && r.peakPremium != null);
  const reached = withBasis.filter((r) => r.peakPremium >= r.entryPremium * (1 + triggerPct / 100));
  return { n: withBasis.length, reached: reached.length, pct: withBasis.length ? Math.round((reached.length / withBasis.length) * 1000) / 10 : null };
}
