/**
 * Pure evaluation helpers for the 0DTE confluence_floor (G-12) outcome backtest
 * (`zerodte-confluence-floor-outcome-backtest.mjs`).
 *
 * WHY THIS EXISTS. `docs/audit/0DTE-RESEARCH.md`'s E3 (2026-07-24, 25 sessions, REAL option
 * premium under the shipped -50/+100 payoff) found a genuinely monotonic EV ladder by confirmation
 * count (VWAP-side + market-aligned, the axis `confluence.ts`'s `confirmations` field measures):
 * 0-conf -12.5% EV (n=4), 1-conf 0.0% EV (n=49), 2-conf +15.9% EV (n=22, 41% win) — verdict
 * CONFIRMED edge. On 2026-09-08 the STANDARD floor (`ZERODTE_CONFLUENCE_MIN`) was deliberately
 * loosened from 2 to 1 for volume reasons — E3's own numbers say that trades edge for volume ON
 * PURPOSE (1-conf measured flat, not negative), but the live floor has sat on that bucket for
 * over a week with no re-check under CURRENT conditions, and no confluence-specific re-check tool
 * has ever existed (unlike score_floor, which got one — `zerodte-score-floor-outcome-backtest.mjs`,
 * `score-floor-backtest-eval.mjs`).
 *
 * BUCKETS. Straddle BOTH live floors: the standard floor (`ZERODTE_CONFLUENCE_MIN=1`) and the
 * early-window floor (`ZERODTE_CONFLUENCE_MIN_EARLY=2`, confluence.ts:34-43,
 * `EARLY_ENTRY_WINDOW_END_ET_MINUTES`). `confirmations` (confluence.ts's `ZeroDteConfluence.
 * confirmations`) is 0/1/2 by construction (VWAP-side + market-aligned, each contributing at most
 * 1) — three fixed buckets, chosen before looking at any result, matching E3's own axis exactly so
 * this run is directly comparable to it.
 *
 * SCOPE. Same favorable-first UNDERLYING-continuation proxy `score-floor-backtest-eval.mjs`'s
 * `gradeDirection` uses (imported unchanged here) — NOT exact option premium P&L. This is a
 * DELIBERATE deviation from E3's own stronger premium-basis methodology: E3 graded a specific
 * resolved OCC contract's minute bars under PLAN_RULES; reconstructing that per-setup here (chain
 * fetch + contract pick + premium bars for every graded setup across dozens of sessions) is a much
 * larger, slower, more rate-limited build than the underlying proxy, and this repo's OWN score_floor
 * re-check (E6, `zerodte-score-floor-outcome-backtest.mjs`) already made the identical practical
 * trade-off for the same reason. Documented here so a reader never mistakes this run's numbers for
 * E3's original premium-basis ones — they answer "does confirmation count still rank a favorable
 * continuation" (a necessary, not sufficient, condition for "does it still rank real premium EV"),
 * not a re-run of E3 itself.
 */
export { gradeDirection } from "./score-floor-backtest-eval.mjs";
import { scoreSeparation } from "./helix-score-eval.mjs";
export { scoreSeparation };

/** The three E3-axis buckets, ascending by confirmation count — order matters for
 *  `scoreSeparation`'s Spearman calculation (same contract as every sibling eval lib). */
export const CONFLUENCE_BUCKETS = [
  { label: "0-conf", value: 0 },
  { label: "1-conf (standard floor)", value: 1 },
  { label: "2-conf (early-window floor / E3 edge bucket)", value: 2 },
];

export function bucketForConfirmations(confirmations) {
  if (typeof confirmations !== "number" || !Number.isFinite(confirmations)) return null;
  const b = CONFLUENCE_BUCKETS.find((c) => c.value === Math.trunc(confirmations));
  return b?.label ?? null;
}

/**
 * Aggregate graded rows `{confirmations, earlyWindow, origin, graded: {win,maxRet}|null}` into
 * per-confirmation-bucket stats. `splitBy` optionally further splits each bucket (e.g.
 * "earlyWindow" or "origin") for the early/standard-window and FLOW/BREAKOUT/PIN cuts the live
 * floors and admission rules actually differ on — omit for the flat, all-rows summary.
 */
export function summarizeByConfluenceBucket(rows, splitBy = null) {
  const out = new Map();
  for (const r of rows ?? []) {
    const b = bucketForConfirmations(r.confirmations);
    if (!b || !r.graded) continue;
    const splitKey = splitBy ? String(r[splitBy] ?? "unknown") : "all";
    const key = `${b}::${splitKey}`;
    const cur = out.get(key) ?? { bucket: b, split: splitKey, n: 0, wins: 0, sumMaxRet: 0 };
    cur.n++;
    if (r.graded.win) cur.wins++;
    cur.sumMaxRet += r.graded.maxRet;
    out.set(key, cur);
  }
  return CONFLUENCE_BUCKETS.flatMap((b) =>
    Array.from(out.values())
      .filter((c) => c.bucket === b.label)
      .sort((a, c) => a.split.localeCompare(c.split))
  ).map((c) => ({
    ...c,
    winRate: c.n > 0 ? (c.wins / c.n) * 100 : null,
    avgMaxRetPct: c.n > 0 ? (c.sumMaxRet / c.n) * 100 : null,
  }));
}

/**
 * The E3 headline: does the 2-conf bucket (E3's own +15.9% EV edge bucket, also today's
 * early-window floor) actually beat the 1-conf bucket (today's STANDARD floor, the one E3 itself
 * measured flat at 0.0% EV)? Returns null when either band is absent (n=0).
 */
export function edgeBucketComparison(summary) {
  const standard = summary.find((s) => s.bucket === "1-conf (standard floor)" && s.split === "all");
  const edge = summary.find((s) => s.bucket === "2-conf (early-window floor / E3 edge bucket)" && s.split === "all");
  if (!standard || !edge || standard.winRate == null || edge.winRate == null) return null;
  return { standard, edge, deltaPp: edge.winRate - standard.winRate };
}

/**
 * Does the 2026-09-08 loosening's own justification hold: is 1-conf still measuring ~flat (not
 * negative) relative to 0-conf, the population G-12 blocked both before AND after the loosening?
 * Returns null when either band is absent (n=0).
 */
export function looseningJustificationCheck(summary) {
  const blocked = summary.find((s) => s.bucket === "0-conf" && s.split === "all");
  const admitted = summary.find((s) => s.bucket === "1-conf (standard floor)" && s.split === "all");
  if (!blocked || !admitted || blocked.winRate == null || admitted.winRate == null) return null;
  return { blocked, admitted, deltaPp: admitted.winRate - blocked.winRate };
}
