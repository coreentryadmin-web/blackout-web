/**
 * Pure evaluation helpers for the 0DTE score_floor outcome backtest
 * (`zerodte-score-floor-outcome-backtest.mjs`).
 *
 * WHY THESE BANDS. `zerodte-gate-compound-funnel.mjs` measured (2026-09-08 off-hours n=15,
 * 2026-09-09 RTH n=26) that `score_floor` (gates.ts G-3, `ZERODTE_SCORE_FLOOR = 65`) is the
 * dominant ISOLATED-rejection gate on FLOW-origin 0DTE setups (84.6% isolated failure at RTH) —
 * and left as its own "next question, not yet answered": is 65 itself miscalibrated, or does the
 * score formula genuinely underscore setups that are actually tradeable? The bands below are fixed
 * BEFORE looking at any result and are chosen to straddle 65 exactly, so "55-64 (blocked today)"
 * vs "65-74 (clears today)" is the direct head-to-head that question needs — same discipline as
 * `cortex-oppose-magnitude-ab.mjs`'s four fixed bands (set before results) and
 * `helix-score-eval.mjs`'s `SCORE_BUCKETS` (chosen to isolate a saturation/threshold point, not
 * picked after seeing the data).
 *
 * SCOPE. This measures whether `score` ranks FAVORABLE-FIRST underlying continuation — the same
 * proxy `discovery-recall-probe.mjs`/`merge-precedence-ab.mjs` use (long: HIGH reaches
 * entry·(1+fav) before LOW reaches entry·(1-adv); short: mirrored). It is NOT exact option P&L —
 * no strike, no premium decay, no exit-management rule — so a flat/inverted result is evidence the
 * raw evidence `score` does not rank outcome, not proof the shipped 0DTE engine is unprofitable
 * (which also runs Cortex, the governor, and 10+ other gates this measures separately in
 * `zerodte-gate-compound-funnel.mjs`, never jointly with this backtest).
 *
 * `scoreSeparation` (the RANKS / SPREAD WITHOUT ORDER / INVERTED / FLAT verdict, requiring both a
 * real spread AND a monotonic Spearman trend, never a spread alone) is imported UNCHANGED from
 * `helix-score-eval.mjs` — it is bucket-shape-agnostic (takes any ordered {bucket,n,winRate} array)
 * and re-deriving it here would risk the two verdict languages drifting apart.
 */
export { scoreSeparation } from "./helix-score-eval.mjs";

/** Straddles ZERODTE_SCORE_FLOOR=65 exactly: "55-64" is the population score_floor blocks today,
 *  "65-74" is the population it lets straight through. Every other band brackets the rest of the
 *  0-100 range the real score formula (board.ts) can produce. */
export const SCORE_BUCKETS = [
  { label: "0-39", min: 0, max: 39.999 },
  { label: "40-54", min: 40, max: 54.999 },
  { label: "55-64 (blocked today)", min: 55, max: 64.999 },
  { label: "65-74 (clears today)", min: 65, max: 74.999 },
  { label: "75-84", min: 75, max: 84.999 },
  { label: "85-100", min: 85, max: 100 },
];

export function bucketForScore(score) {
  // Number(null)===0 / Number("")===0, so a plain Number()+isFinite guard buckets an ABSENT score
  // into "0-39" — a setup nobody scored counted as a setup scored zero. Reject non-numbers first,
  // before coercion (same absence-as-measurement trap helix-score-eval.mjs documents and guards).
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return SCORE_BUCKETS.find((b) => score >= b.min && score <= b.max)?.label ?? null;
}

/**
 * Favorable-first proxy generalized to direction — the SAME rule `merge-precedence-ab.mjs`'s
 * module-local `gradeDirection` uses, factored out here (entry/close window + fav/adv passed in,
 * not module-level consts) so it is unit-testable in isolation and reusable across a multi-session
 * loop where the entry/close UTC-minute window is recomputed per calendar day.
 *
 * long: WINS if HIGH reaches entry·(1+fav) before LOW reaches entry·(1-adv).
 * short: mirrored on LOW/HIGH — WINS if LOW reaches entry·(1-fav) before HIGH reaches entry·(1+adv).
 * Same-bar ambiguity (both levels touched in one bar) grades LOSS — pessimistic, not a coin flip.
 *
 * Returns `{ win, maxRet }` (maxRet = best favorable excursion actually reached, signed positive)
 * or `null` when there are fewer than 2 usable RTH-window bars (never fabricates a coin-flip row).
 */
export function gradeDirection(bars, direction, { entryUtcMin, closeUtcMin, fav, adv }) {
  const rth = (bars ?? [])
    .filter(
      (b) =>
        Number.isFinite(b?.t) &&
        Number.isFinite(b?.h) &&
        Number.isFinite(b?.l) &&
        Number.isFinite(b?.c)
    )
    .sort((a, b) => a.t - b.t)
    .filter((b) => {
      const d = new Date(b.t);
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      return m >= entryUtcMin && m <= closeUtcMin;
    });
  if (rth.length < 2) return null;
  const entry = rth[0].c;
  if (!(entry > 0)) return null;
  const long = direction === "long";
  const favLevel = long ? entry * (1 + fav) : entry * (1 - fav);
  const advLevel = long ? entry * (1 - adv) : entry * (1 + adv);
  let maxRet = 0;
  for (let i = 1; i < rth.length; i++) {
    const b = rth[i];
    const f = long ? (b.h - entry) / entry : (entry - b.l) / entry;
    maxRet = Math.max(maxRet, f);
    const hitFav = long ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = long ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { win: true, maxRet };
    if (hitAdv && !hitFav) return { win: false, maxRet };
    if (hitFav && hitAdv) return { win: false, maxRet }; // same-bar ambiguity → pessimistic
  }
  return { win: false, maxRet }; // never reached favorable → time-stop loss
}

/**
 * Aggregate graded rows `{score, graded: {win,maxRet}|null}` into per-bucket stats, returned in
 * SCORE_BUCKETS order (ascending score) — `scoreSeparation`'s Spearman calculation assumes the
 * array it receives is already in ascending score-band order, same contract as
 * `helix-score-eval.mjs`'s `summarizeByBucket`.
 */
export function summarizeByBucket(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const b = bucketForScore(r.score);
    if (!b || !r.graded) continue;
    const cur = out.get(b) ?? { bucket: b, n: 0, wins: 0, sumMaxRet: 0 };
    cur.n++;
    if (r.graded.win) cur.wins++;
    cur.sumMaxRet += r.graded.maxRet;
    out.set(b, cur);
  }
  return SCORE_BUCKETS.map((b) => out.get(b.label))
    .filter(Boolean)
    .map((c) => ({
      ...c,
      winRate: c.n > 0 ? (c.wins / c.n) * 100 : null,
      avgMaxRetPct: c.n > 0 ? (c.sumMaxRet / c.n) * 100 : null,
    }));
}

/**
 * The headline comparison this whole backtest exists to answer: does the population score_floor
 * lets through today (65-74) actually grade better than the population it blocks (55-64)? Returns
 * null when either band is absent (n=0) — never fabricates a delta from a missing side.
 */
export function crossFloorComparison(summary) {
  const below = summary.find((s) => s.bucket.startsWith("55-64"));
  const above = summary.find((s) => s.bucket.startsWith("65-74"));
  if (!below || !above || below.winRate == null || above.winRate == null) return null;
  return { below, above, deltaPp: above.winRate - below.winRate };
}
