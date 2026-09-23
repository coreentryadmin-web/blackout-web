// Score-signal analysis — PHASE 1 (completed-trade) + PHASE 2 (early-read) diagnosis (2026-09-23,
// operator directive, continuing the wrong-direction investigation after the 04:45Z finding was
// corrected: the vast majority of "wrong_direction"-tagged rows are still-OPEN positions carrying
// an early one-session directional read, not final decided losses — only 9 of ~110 graded rows in
// 90 days are truly DECIDED (outcome IN {target, stop}); analytics.ts's own decidedRows() confirms
// this independently).
//
// TWO STRICTLY SEPARATE ANALYSES, NEVER BLENDED:
//  - PHASE 1 (`analyzePhase1CompletedTrades`): the TRUE decided population only (outcome IN
//    {target, stop}, not pulled). This is the only population that can honestly be called
//    "realized trade profitability". At n≈9 over 90 days, every output here is explicitly labeled
//    low-sample/directional-only — this function refuses to compute a bucketed win-rate verdict at
//    that n (see LOW_N_FLOOR_PHASE1) and reports raw per-row evidence instead, exactly the shape
//    the operator asked for ("do not make production changes based on these 9 trades").
//  - PHASE 2 (`analyzePhase2EarlyRead`): the broader ONE-SESSION DIRECTIONAL READ population —
//    every row that received a real debrief classification of "did the tape move with or against
//    the play", decided OR still-open alike. debrief.ts's own classifyFailureMode already encodes
//    this exact question for open rows (case 6: wrong_direction = closed against entry this
//    session, target_unreachable = moved with the play or flat) — this reuses that existing
//    semantic split rather than inventing a new one. EARLY-FAVORABLE = {clean_win, lucky_win,
//    gap_win, target_unreachable}; EARLY-ADVERSE = {wrong_direction, stopped_normal,
//    gap_through_stop}. This is a genuinely different, WEAKER claim than "predicts the trade's
//    final outcome" — every Phase 2 output is labeled as such, and Phase 2 never claims to speak
//    to realized profitability.
//
// DISCLOSED DATA GAPS (not fabricated, not worked around): contract-level liquidity/bid-ask
// spread/IV were never pinned to publish_context historically — "contract quality" here can only
// use entry_premium (contract $ cost) and DTE (parsed from the options_play string, calendar days
// to expiry) as proxies. "Momentum" uses tech_score, which is honestly a technical-setup composite,
// not a raw momentum figure. These gaps are exactly what PHASE 3 (see the accompanying write-up,
// not this file) needs to close going forward.
//
// Pure module: no I/O. Reuses `DebriefAggregateRow` (debrief-aggregate.ts) as its input shape —
// the SAME rows `direction-failure-diagnosis.ts` and the debrief report itself already fetch via
// db.fetchNighthawkOutcomeAnalytics(days). No new DB query.

import type { DebriefAggregateRow } from "./debrief-aggregate";
import { readPinnedDebriefTag, readPinnedTierAssignment, pinnedTargetAtrMultiple } from "./debrief-aggregate";
import { GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";
import { parseOptionsContract } from "./option-contract-parse";

// ── Shared per-row feature extraction (independent of direction-failure-diagnosis.ts on purpose —
//    see that module's own header for the "each audit tool owns its extraction" precedent this
//    codebase already follows) ─────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function confluence(publishContext: unknown): Record<string, unknown> | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const c = (publishContext as Record<string, unknown>).confluence;
  return c != null && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
}

function topLevel(publishContext: unknown): Record<string, unknown> | null {
  return publishContext != null && typeof publishContext === "object" && !Array.isArray(publishContext)
    ? (publishContext as Record<string, unknown>)
    : null;
}

/** Calendar days from `editionFor` (the play's own anchor date) to the parsed contract's expiry.
 *  Mirrors src/lib/zerodte/board.ts's calendarDteBetween — reimplemented locally (2 lines) rather
 *  than imported, so this Legacy-only diagnostic module's static import graph never reaches
 *  zerodte/board.ts's own (much larger, 0DTE-provider-heavy) dependency chain. */
function calendarDteBetween(editionFor: string, expiryYmd: string): number | null {
  const a = Date.parse(`${editionFor}T12:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** DTE parsed from the pinned `options_play` string, anchored to the play's OWN edition_for date
 *  (never real "now" — an old row re-parsed today would otherwise roll the bare "Mon DD" expiry
 *  label a year forward; see option-contract-parse.ts's own documented year-inference bug). */
function dteFromRow(row: DebriefAggregateRow, publishContext: unknown): number | null {
  const top = topLevel(publishContext);
  const optionsPlay = top && typeof top.options_play === "string" ? top.options_play : null;
  if (!optionsPlay) return null;
  const referenceDate = new Date(`${row.edition_for}T12:00:00Z`);
  if (!Number.isFinite(referenceDate.getTime())) return null;
  const parsed = parseOptionsContract(optionsPlay, referenceDate);
  if (!parsed?.expiryYmd) return null;
  return calendarDteBetween(row.edition_for, parsed.expiryYmd);
}

export type ScoreSignalEvidence = {
  ticker: string;
  edition_for: string;
  direction: string | null;
  conviction: string | null;
  tier: string | null;
  outcome: string | null;
  debrief_tag: string | null;
  total_score: number | null;
  flow_score: number | null;
  tech_score: number | null;
  pos_score: number | null;
  smart_money_score: number | null;
  flow_dominance_pct: number | null;
  target_atr_multiple: number | null;
  over_target_atr_gate: boolean;
  dte: number | null;
  entry_premium: number | null;
  gate_promoted: boolean;
};

function extractEvidence(row: DebriefAggregateRow): ScoreSignalEvidence {
  const conf = confluence(row.publish_context ?? null);
  const top = topLevel(row.publish_context ?? null);
  const tierAssignment = readPinnedTierAssignment(row.publish_context ?? null);
  const targetAtr = pinnedTargetAtrMultiple(row.publish_context ?? null);
  const totalScore = num(conf?.total_score);
  const flowScore = num(conf?.flow_score);
  const flowDominancePct =
    totalScore != null && totalScore > 0 && flowScore != null ? Math.round((flowScore / totalScore) * 1000) / 10 : null;

  return {
    ticker: row.ticker,
    edition_for: row.edition_for,
    direction: row.direction,
    conviction: row.conviction,
    tier: tierAssignment?.tier ?? null,
    outcome: row.outcome,
    debrief_tag: readPinnedDebriefTag(row.debrief ?? null),
    total_score: totalScore,
    flow_score: flowScore,
    tech_score: num(conf?.tech_score),
    pos_score: num(conf?.pos_score),
    smart_money_score: num(conf?.smart_money_score),
    flow_dominance_pct: flowDominancePct,
    target_atr_multiple: targetAtr,
    over_target_atr_gate: targetAtr != null && targetAtr > GATE_TARGET_MAX_ATR_MULTIPLE,
    dte: dteFromRow(row, row.publish_context ?? null),
    entry_premium: top ? num(top.entry_premium) : null,
    gate_promoted: top ? top.gate_promoted === true : false,
  };
}

// ── Generic bucket + verdict engine (mirrors scripts/audit/lib/helix-score-eval.mjs's
//    scoreSeparation exactly — same RANKS/SPREAD-WITHOUT-ORDER/INVERTED/FLAT discipline, ported to
//    TS: a spread alone is never evidence of a ranking; both a real spread AND a monotonic
//    Spearman trend are required, and buckets below minN are excluded and NAMED, never silently
//    dropped) ──────────────────────────────────────────────────────────────────────────────────

export type BucketSummary = { bucket: string; ordinal: number; n: number; rate_pct: number | null };
export type BucketVerdict = {
  verdict: "INSUFFICIENT DATA" | "FLAT" | "RANKS" | "INVERTED" | "SPREAD WITHOUT ORDER";
  spread_pp: number | null;
  rho: number | null;
  best: BucketSummary | null;
  worst: BucketSummary | null;
  usable_buckets: number;
  excluded: string[];
};

export function bucketVerdict(summary: BucketSummary[], minN: number): BucketVerdict {
  const usable = summary.filter((s) => s.n >= minN && s.rate_pct != null);
  const excluded = summary.filter((s) => s.n < minN).map((s) => `${s.bucket}(n=${s.n})`);
  if (usable.length < 2) {
    return { verdict: "INSUFFICIENT DATA", spread_pp: null, rho: null, best: null, worst: null, usable_buckets: usable.length, excluded };
  }
  const rates = usable.map((s) => s.rate_pct!);
  const spread = Math.max(...rates) - Math.min(...rates);

  const n = usable.length;
  const scoreRanks = usable.map((_, i) => i + 1);
  const sorted = [...rates].sort((a, b) => a - b);
  const rateRanks = rates.map((r) => {
    const first = sorted.indexOf(r);
    const last = sorted.lastIndexOf(r);
    return (first + last) / 2 + 1;
  });
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ms = mean(scoreRanks);
  const mr = mean(rateRanks);
  let numCov = 0;
  let ds = 0;
  let dr = 0;
  for (let i = 0; i < n; i++) {
    numCov += (scoreRanks[i]! - ms) * (rateRanks[i]! - mr);
    ds += (scoreRanks[i]! - ms) ** 2;
    dr += (rateRanks[i]! - mr) ** 2;
  }
  const rho = ds > 0 && dr > 0 ? numCov / Math.sqrt(ds * dr) : 0;
  const verdict: BucketVerdict["verdict"] =
    spread < 5 ? "FLAT" : rho >= 0.6 ? "RANKS" : rho <= -0.6 ? "INVERTED" : "SPREAD WITHOUT ORDER";

  return {
    verdict,
    spread_pp: Math.round(spread * 10) / 10,
    rho: Math.round(rho * 1000) / 1000,
    best: usable.reduce((a, b) => (b.rate_pct! > a.rate_pct! ? b : a)),
    worst: usable.reduce((a, b) => (b.rate_pct! < a.rate_pct! ? b : a)),
    usable_buckets: n,
    excluded,
  };
}

/** Quantile bucketing over a numeric feature — equal population per bucket rather than a fixed
 *  absolute range, same reasoning swing-score-calibration.mjs already documents for a modest
 *  sample: a literal fixed-range split is dishonest at low n. Rows with a null feature value are
 *  excluded from bucketing (never coerced into bucket 1). Returns at most `targetBuckets`, shrunk
 *  when the population can't support `minPerBucket` in each. */
export function quantileBuckets<T>(
  rows: T[],
  feature: (r: T) => number | null,
  targetBuckets: number,
  minPerBucket: number
): { bucket: string; ordinal: number; rows: T[] }[] {
  const withValue = rows
    .map((r) => ({ r, v: feature(r) }))
    .filter((x): x is { r: T; v: number } => x.v != null)
    .sort((a, b) => a.v - b.v);
  if (withValue.length === 0) return [];
  const maxBuckets = Math.max(1, Math.min(targetBuckets, Math.floor(withValue.length / minPerBucket)));
  const k = Math.max(1, maxBuckets);
  const out: { bucket: string; ordinal: number; rows: T[] }[] = [];
  const perBucket = Math.ceil(withValue.length / k);
  for (let i = 0; i < k; i++) {
    const slice = withValue.slice(i * perBucket, (i + 1) * perBucket);
    if (slice.length === 0) continue;
    const lo = slice[0]!.v;
    const hi = slice[slice.length - 1]!.v;
    out.push({ bucket: `${round1(lo)}–${round1(hi)}`, ordinal: i + 1, rows: slice.map((s) => s.r) });
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── PHASE 1 — completed-trade analysis (TRUE decided population only) ─────────────────────────

export type Phase1Report = {
  methodology: string;
  window_days: number;
  n_decided: number;
  low_n: true; // structurally always true at this population size — see LOW_N_FLOOR_PHASE1
  wins: ScoreSignalEvidence[];
  losses: ScoreSignalEvidence[];
  win_mean: { total_score: number | null; flow_score: number | null; tech_score: number | null; flow_dominance_pct: number | null };
  loss_mean: { total_score: number | null; flow_score: number | null; tech_score: number | null; flow_dominance_pct: number | null };
};

const LOW_N_FLOOR_PHASE1 = 10;

function meanOf(values: Array<number | null>): number | null {
  const usable = values.filter((v): v is number => v != null);
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((a, b) => a + b, 0) / usable.length) * 100) / 100;
}

/** PHASE 1: the true decided (outcome IN {target, stop}, not pulled) population only. Never
 *  computes a bucketed verdict — at n well under LOW_N_FLOOR_PHASE1 that would fabricate
 *  precision the sample cannot support — reports raw per-row evidence and simple two-group means
 *  instead, explicitly labeled low_n: true always. */
export function analyzePhase1CompletedTrades(rows: DebriefAggregateRow[], windowDays: number): Phase1Report {
  const decided = rows.filter((r) => (r.outcome === "target" || r.outcome === "stop") && r.pulled !== true);
  const evidence = decided.map(extractEvidence);
  const wins = evidence.filter((e) => e.outcome === "target");
  const losses = evidence.filter((e) => e.outcome === "stop");
  return {
    methodology:
      "TRUE decided trades only (outcome IN {target, stop}, never pulled) -- the only population " +
      "that can honestly be called realized trade profitability. Never bucketed (sample too thin " +
      "for a bucket verdict to mean anything) -- raw per-row evidence + simple win/loss group " +
      "means only, explicitly directional evidence, not a statistically defensible finding.",
    window_days: windowDays,
    n_decided: decided.length,
    low_n: true,
    wins,
    losses,
    win_mean: {
      total_score: meanOf(wins.map((w) => w.total_score)),
      flow_score: meanOf(wins.map((w) => w.flow_score)),
      tech_score: meanOf(wins.map((w) => w.tech_score)),
      flow_dominance_pct: meanOf(wins.map((w) => w.flow_dominance_pct)),
    },
    loss_mean: {
      total_score: meanOf(losses.map((l) => l.total_score)),
      flow_score: meanOf(losses.map((l) => l.flow_score)),
      tech_score: meanOf(losses.map((l) => l.tech_score)),
      flow_dominance_pct: meanOf(losses.map((l) => l.flow_dominance_pct)),
    },
  };
}

// ── PHASE 2 — early-read signal analysis (broader one-session directional population) ─────────

const EARLY_FAVORABLE_TAGS = new Set(["clean_win", "lucky_win", "gap_win", "target_unreachable"]);
const EARLY_ADVERSE_TAGS = new Set(["wrong_direction", "stopped_normal", "gap_through_stop"]);

export type Phase2Report = {
  methodology: string;
  window_days: number;
  n_early_read: number;
  n_favorable: number;
  n_adverse: number;
  low_n: boolean;
  by_total_score: { summary: BucketSummary[]; verdict: BucketVerdict };
  by_flow_dominance: { summary: BucketSummary[]; verdict: BucketVerdict };
  by_target_atr_gate: { under_gate: BucketSummary; over_gate: BucketSummary };
  by_dte: { weekly_lte_10: BucketSummary; longer_gt_10: BucketSummary };
  interaction_high_flow_dominance: { summary: BucketSummary[]; verdict: BucketVerdict };
  interaction_low_flow_dominance: { summary: BucketSummary[]; verdict: BucketVerdict };
};

const PHASE2_MIN_N = 8;

function summarizeFavorableRate<T extends { early_favorable: boolean }>(
  buckets: { bucket: string; ordinal: number; rows: T[] }[]
): BucketSummary[] {
  return buckets.map((b) => ({
    bucket: b.bucket,
    ordinal: b.ordinal,
    n: b.rows.length,
    rate_pct: b.rows.length > 0 ? Math.round((b.rows.filter((r) => r.early_favorable).length / b.rows.length) * 1000) / 10 : null,
  }));
}

/** PHASE 2: every row that received a real one-session directional read (decided OR still-open
 *  alike) -- reuses debrief.ts's own classifyFailureMode semantics rather than inventing a new
 *  split. Explicitly measures "did the tape move with or against the play in its first session",
 *  NEVER "was this trade ultimately profitable" -- a genuinely different, weaker claim, kept
 *  structurally separate from Phase 1's output (different function, different report shape, never
 *  merged into one number). */
export function analyzePhase2EarlyRead(rows: DebriefAggregateRow[], windowDays: number): Phase2Report {
  const withTag = rows
    .filter((r) => r.pulled !== true && r.outcome !== "unfilled")
    .map((r) => ({ row: r, evidence: extractEvidence(r) }))
    .filter((x) => x.evidence.debrief_tag != null && (EARLY_FAVORABLE_TAGS.has(x.evidence.debrief_tag) || EARLY_ADVERSE_TAGS.has(x.evidence.debrief_tag)))
    .map((x) => ({ ...x.evidence, early_favorable: EARLY_FAVORABLE_TAGS.has(x.evidence.debrief_tag!) }));

  const nFavorable = withTag.filter((r) => r.early_favorable).length;
  const nAdverse = withTag.length - nFavorable;

  const scoreBuckets = quantileBuckets(withTag, (r) => r.total_score, 3, PHASE2_MIN_N);
  const scoreSummary = summarizeFavorableRate(scoreBuckets);
  const flowDomBuckets = quantileBuckets(withTag, (r) => r.flow_dominance_pct, 3, PHASE2_MIN_N);
  const flowDomSummary = summarizeFavorableRate(flowDomBuckets);

  const underGate = withTag.filter((r) => r.target_atr_multiple != null && !r.over_target_atr_gate);
  const overGate = withTag.filter((r) => r.over_target_atr_gate);
  const weekly = withTag.filter((r) => r.dte != null && r.dte <= 10);
  const longer = withTag.filter((r) => r.dte != null && r.dte > 10);

  const favRate = (rs: typeof withTag): number | null =>
    rs.length > 0 ? Math.round((rs.filter((r) => r.early_favorable).length / rs.length) * 1000) / 10 : null;

  // Interaction: does the score-bucket pattern change once you condition on flow-dominance?
  const median = (() => {
    const vals = withTag.map((r) => r.flow_dominance_pct).filter((v): v is number => v != null).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)]! : null;
  })();
  const highFlow = median != null ? withTag.filter((r) => r.flow_dominance_pct != null && r.flow_dominance_pct >= median) : [];
  const lowFlow = median != null ? withTag.filter((r) => r.flow_dominance_pct != null && r.flow_dominance_pct < median) : [];
  const highFlowScoreBuckets = quantileBuckets(highFlow, (r) => r.total_score, 3, PHASE2_MIN_N);
  const lowFlowScoreBuckets = quantileBuckets(lowFlow, (r) => r.total_score, 3, PHASE2_MIN_N);
  const highFlowSummary = summarizeFavorableRate(highFlowScoreBuckets);
  const lowFlowSummary = summarizeFavorableRate(lowFlowScoreBuckets);

  return {
    methodology:
      "EARLY-READ population: every row with a real one-session directional debrief tag " +
      "(decided OR still-open), classified EARLY-FAVORABLE {clean_win,lucky_win,gap_win," +
      "target_unreachable} vs EARLY-ADVERSE {wrong_direction,stopped_normal,gap_through_stop} -- " +
      "reuses debrief.ts's own classifyFailureMode semantics, does not invent a new split. This " +
      "measures whether the FIRST SESSION moved with or against the play, NOT final trade " +
      "profitability -- never compare this rate directly to Phase 1's win rate, they answer " +
      "different questions over different populations.",
    window_days: windowDays,
    n_early_read: withTag.length,
    n_favorable: nFavorable,
    n_adverse: nAdverse,
    low_n: withTag.length < PHASE2_MIN_N * 2,
    by_total_score: { summary: scoreSummary, verdict: bucketVerdict(scoreSummary, PHASE2_MIN_N) },
    by_flow_dominance: { summary: flowDomSummary, verdict: bucketVerdict(flowDomSummary, PHASE2_MIN_N) },
    by_target_atr_gate: {
      under_gate: { bucket: "under_gate (<=2.0x ATR)", ordinal: 1, n: underGate.length, rate_pct: favRate(underGate) },
      over_gate: { bucket: "over_gate (>2.0x ATR)", ordinal: 2, n: overGate.length, rate_pct: favRate(overGate) },
    },
    by_dte: {
      weekly_lte_10: { bucket: "weekly (dte<=10)", ordinal: 1, n: weekly.length, rate_pct: favRate(weekly) },
      longer_gt_10: { bucket: "longer (dte>10)", ordinal: 2, n: longer.length, rate_pct: favRate(longer) },
    },
    interaction_high_flow_dominance: { summary: highFlowSummary, verdict: bucketVerdict(highFlowSummary, PHASE2_MIN_N) },
    interaction_low_flow_dominance: { summary: lowFlowSummary, verdict: bucketVerdict(lowFlowSummary, PHASE2_MIN_N) },
  };
}
