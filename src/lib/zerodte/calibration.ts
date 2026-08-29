// 0DTE gate-calibration analyzer (PR-C) — the evidence loop the calibration-mode
// gates were shipped FOR. G-4 (VIX regime) and G-6 (cross-system conflict) run in
// CALIBRATION mode (./gates.ts): they never block, they only pin a would-block
// verdict onto every committed row's gate_calibration_json. This module closes the
// loop: it buckets GRADED plays by each gate's pinned verdict and answers, with
// per-bucket n / wins / win rate / avg premium P&L, whether the gate's would-block
// bucket actually underperforms — i.e. whether the gate has EARNED enforcement.
//
// Why this exists (forensic priors, docs/audit/NIGHTHAWK-0DTE-DECISION.md):
// - F-1: day-open VIX 15-17 → 69.2% WR (n=13) vs 17-20 → 25.0% WR (n=12) — the
//   strongest split in the dataset, but LOW-N, which is exactly why G-4 ships as
//   calibration-first: thresholds graduate on evidence, never on vibes.
// - F-2: score 55-64 → 18.8% WR (n=16), below the 33% breakeven of the −50/+100
//   payoff — the evidence that set G-3's floor at 65. The score-band section here
//   keeps producing that same cut going forward so the floor can be re-argued from
//   data (it is NEVER auto-moved by this module).
// - F-5: the top conviction band inverts on three surfaces independently (e.g.
//   Slayer 85+ → 33.3% vs 75-84 → 63.6%) — why the bands split 75-84 vs 85+
//   instead of one "75+" bucket.
//
// Pure core (analyzeGateCalibration + helpers) with a thin data layer at the bottom
// (buildZeroDteCalibrationReport) — same split as ./record.ts / ./entry-context.ts.
// The pure core takes rows and returns a report; no clocks, no providers, no DB.

import type { ZeroDteSetupLogRow } from "@/lib/db";
import { discoveryOriginLabel, type DiscoveryOrigin } from "./board";
import { LOW_N_THRESHOLD, isGradedZeroDteRow, isZeroDteWin, officialPlanPnlPct, scoreForBanding } from "./record";
import { ZERODTE_SCORE_FLOOR } from "./gates";
import { TIER_APLUS_UNLOCK, tierFromEntryContext, type ZeroDteTier } from "./tiers";
import type { SkipCounterfactual } from "./skip-grading";
import { currentStrategyConfigHash } from "./strategy-version";
import { wilsonInterval, proportionDiffCI } from "./calibration-stats";

/** Methodology label served with every report — the honest-record rule (record.ts):
 *  plan-outcome grades on option premium, never blended with other methodologies. */
export const ZERODTE_CALIBRATION_METHODOLOGY =
  "0DTE gate calibration over GRADED ledger plays (plan-outcome grades on option premium, " +
  "stop -50% / trim +100% / hard exit 15:50 ET). Calibration-mode gates (G-4 VIX, G-6 conflict) " +
  "are bucketed by their pinned would-block verdict; a gate graduates to enforcing only when " +
  "its would-block bucket is large enough AND measurably worse than would-pass. Buckets under " +
  `n=${LOW_N_THRESHOLD} are low_n and never produce a recommendation. Blocked-value lines grade ` +
  "hard-gate SKIPs counterfactually (see skip-grading.ts) — premium basis only when the contract " +
  "path is real, underlying-direction basis otherwise, never fabricated premium P&L.";

// ── Graduation thresholds (deterministic, conservative) ─────────────────────────
/** A gate may graduate calibration → enforcing only once its would-block bucket has
 *  at least this many GRADED plays. 10, not LOW_N_THRESHOLD (5): the priors that
 *  motivated these gates were themselves n=12/n=13 cuts (F-1) that we explicitly
 *  refused to enforce on — the graduating evidence must be at least the same order,
 *  and it must be would-BLOCK evidence specifically (the bucket the gate would have
 *  removed), not total sample size. */
export const ENFORCE_MIN_BLOCK_N = 10;
/** The would-block bucket's win rate must be at least this many percentage points
 *  WORSE than would-pass. 15 pts is deliberately far above bucket noise at n≈10-20
 *  (one flipped play in an n=10 bucket moves its rate by 10 pts) and is roughly a
 *  third of the F-1 spread (69.2% vs 25.0% ≈ 44 pts) — a real regime split should
 *  clear it easily; a coin-flip difference never should. */
export const ENFORCE_MIN_DELTA_PTS = 15;
/** Float guard for the ">= 15 pts" comparison: win rates are ratios of small
 *  integers scaled by 100, so a mathematically-exact 15.0 delta can land at
 *  14.999999999999996 in IEEE754. The epsilon only forgives float dust, never a
 *  genuinely smaller delta (the next representable real-data delta below 15 at
 *  n<=1000 is orders of magnitude further away than 1e-9). */
const DELTA_EPSILON = 1e-9;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The row shape the analyzer needs — a structural subset of ZeroDteSetupLogRow so
 *  tests build fixtures without the full 30-field ledger row. */
export type CalibrationPlayRow = Pick<
  ZeroDteSetupLogRow,
  | "session_date"
  | "ticker"
  | "direction"
  | "score_max"
  | "plan_outcome"
  | "plan_pnl_pct"
  | "entry_context"
  | "gate_calibration_json"
>;

export type CalibrationBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
  /** n < LOW_N_THRESHOLD — UIs must badge these; recommendations never rest on them. */
  low_n: boolean;
  /** Wilson 95% score interval on the win rate, in PERCENTAGE points (WS-09). Makes the
   *  sample size visible in the number itself — a tight band at n=100, a wide one at n=10 —
   *  so a bucket is never read as its fragile point estimate. Null only when n=0 (nothing to
   *  bound). `lo` is the graduation-relevant bound: a floor is cleared only when even the
   *  pessimistic end of the interval clears it. */
  win_rate_ci_pct: { lo: number; hi: number; mid: number } | null;
};

export type CalibrationGateKey = "g4_vix" | "g6_conflict";

export type GateRecommendation = {
  gate: CalibrationGateKey;
  verdict: "enforce" | "keep_calibrating" | "insufficient_data";
  evidence: {
    would_block: CalibrationBucket;
    would_pass: CalibrationBucket;
    /** would_pass win rate minus would_block win rate, percentage points — positive
     *  means the gate's block verdict is catching genuinely worse plays. Null until
     *  both buckets have at least one graded play. */
    delta_win_rate_pts: number | null;
    /** Rows graded but carrying no usable verdict for this gate (pre-column rows,
     *  or G-4 with day-open VIX unavailable) — reported, never silently dropped. */
    no_verdict_n: number;
    min_block_n: number;
    min_delta_pts: number;
    reason: string;
  };
};

export type BlockedValueLine = {
  gate_failed: string;
  /** Counterfactually graded skips (verdict != ungradeable). */
  n: number;
  ungradeable: number;
  would_have_won: number;
  would_have_won_rate_pct: number | null;
  by_basis: { premium: number; underlying: number };
  low_n: boolean;
  /** Top ungradeable reasons for THIS gate, most-frequent first (cap {@link UNGRADEABLE_REASON_CAP}).
   *  Added 2026-08-29: a live run against production found EVERY gate's `n` at 0 and `ungradeable`
   *  covering the full row count (e.g. score_floor 72/72, opening_window 61/61) — the report answers
   *  "did this gate cost us winners" with "we don't know" for literally every gate, and until now the
   *  `reason` string skip-grading.ts already writes onto every ungradeable verdict (gradeSkippedPlay's
   *  `ungradeable()` helper) was read off the DB, held in `GradedSkipInput.counterfactual`, and then
   *  silently discarded here — the operator-facing report had no way to tell "no underlying bars" from
   *  "no direction on the row" from "blocked after the hard exit", so the SAME silent-absence-as-fact
   *  trap this codebase's own CLAUDE.md names elsewhere (empty GSC domain-property query, absent AWS
   *  creds) was live inside its own calibration tool. */
  ungradeable_reasons: Array<{ reason: string; n: number }>;
};

/** Cap on how many distinct ungradeable reasons surface per gate — a long tail of one-off parse
 *  quirks would otherwise bury the handful of reasons that actually explain the bulk of a gate's
 *  ungradeable count. */
const UNGRADEABLE_REASON_CAP = 5;

export type CalibrationReport = {
  methodology: string;
  window: { since: string; through: string; days: number };
  total_rows: number;
  graded_plays: number;
  gates: GateRecommendation[];
  /** Per-band record over graded plays — EVIDENCE for moving G-3's floor, which is
   *  never auto-moved (the verdict on the floor stays a human/PR decision). */
  score_bands: CalibrationBucket[];
  score_floor: { current: number; note: string };
  /** What the hard gates blocked, graded counterfactually — a gate that blocks
   *  winners shows up here (LOW-N discipline identical to the buckets above). */
  blocked_value: BlockedValueLine[];
  /** Measured record of the merit tiers (PR-F) — where A+ is earned or withheld
   *  and where a mis-weighted tier function gets caught (tier_inversion). */
  tier_record: TierRecordAnalysis;
  /** Graded record by multi-day accumulation alignment (aligned / misaligned / no_signal) — evidence
   *  for whether the flow-accumulation signal predicts wins before it ever gates. */
  accumulation_alignment: CalibrationBucket[];
  /** Graded record by confluence tier (triple / double / weak / no_read) — the "double" bucket is the
   *  +15.9% EV research finding; this is where it earns (or fails to earn) enforcement. */
  confluence_tiers: CalibrationBucket[];
  /** Graded record by discovery-origin set (FLOW / BREAKOUT / FLOW+BREAKOUT / …) — Phase 3a. Answers
   *  "does BREAKOUT pay?" and "does FLOW+BREAKOUT beat FLOW alone?" on real outcomes. Non-gating. */
  origin_bands: CalibrationBucket[];
  /** Graded record by play_type (DIRECTIONAL / CONDOR) — Phase 4. The condor's own graduation ledger:
   *  its structurally-high (negative-skew) win rate must be measured as its own bucket, with real
   *  realized credit/loss, before it sizes real risk. Non-gating (evidence only). */
  play_type_bands: CalibrationBucket[];
  /** CROSSED (origin × play_type) cohorts (WS-07) — the interaction the marginals hide. Each cell carries
   *  a Wilson CI, a forward-time holdout (earlier/later stability + OOS decay), and a recommend-only
   *  production-graduation verdict evaluated on THAT cell. Non-gating (evidence only). */
  origin_playtype_bands: OriginPlayTypeCell[];
  /** Per-source Cortex false-veto analysis (WS-17) — the would-have-won rate among each veto source's
   *  blocked candidates, attributed to the exact source. Non-gating diagnostic. */
  cortex_veto_analysis: CortexVetoAnalysis;
  /** Coded graduation verdicts for the positive evidence signals (confluence double, accumulation
   *  alignment) — the same enforce/keep_calibrating/insufficient_data ladder the gates use, so a signal
   *  can only enter scoring once the live ledger clears the n>=10 / delta>=15pt bar. Non-gating. */
  signal_recommendations: SignalRecommendation[];
  /** Graduation verdict for the whole-market BANGER scale-out exit (EV-based: realized-under-scale-out
   *  vs hold-to-expiry over the pinned banger grades). Gates when the live managed exit may activate;
   *  insufficient_data until the basis-correct banger ledger accrues n>=10 gradeable rows. Non-gating. */
  scale_out_recommendation: ScaleOutRecommendation;
  /** Version-cohort summary (design Q12) — which strategy versions the analyzed population spans, so
   *  the operator can SEE when a scorer/gate/exit/grader change split the ledger. The bands ABOVE are
   *  computed over the homogeneous cohort (current-hash + legacy rows by default); this reports the
   *  whole partition, including any different-known-hash rows held apart. */
  version_cohort: VersionCohortSummary;
  available: boolean;
};

// ── Strategy-version homogeneity (design Q12 — INTEGRITY) ──────────────────────────
// Every band/gate/signal above aggregates GRADED plays into evidence. A play graded
// under an OLD scorer/gate/Cortex/governor/selector/exit/grader is NOT the same
// experiment as one graded under the current logic — blending two DISTINCT KNOWN
// versions corrupts the evidence. Each freshly committed row carries a frozen
// `strategy_config_hash` (scan.ts, from strategy-version.ts).
//
// TRANSITION RULE (why legacy rides with current). The whole existing ledger is
// pre-stamp (null hash) — stamping ships in THIS change. Excluding null-hash rows would
// blank calibration on rollout (every gate would drop to insufficient_data until a fresh
// stamped population accrues), so that is NOT behavior-neutral and NOT what we want. The
// default analysis set is therefore rows whose hash is the CURRENT manifest hash OR null
// (legacy) — the legacy rows were graded under essentially today's logic, so folding them
// in is the conservative, evidence-preserving choice. What the default NEVER blends is a
// DIFFERENT, KNOWN (non-null) hash: the moment a real version bump produces a second
// distinct hash, those rows split off automatically. Because calibration runs over a
// bounded window, once the window rolls past the stamping cutover every row carries a
// hash and the guarantee becomes exact. Cross-version aggregation (blend ALL known
// versions too) stays an EXPLICIT opt-in: analyzeGateCalibration({ crossVersion: true }).

/** How the report's bands were aggregated: the default homogeneous cohort (current hash
 *  + legacy/unstamped rows) or every graded row regardless of version (explicit opt-in). */
export type CalibrationAggregation = "current_and_legacy" | "cross_version";

export type VersionCohortSummary = {
  aggregation: CalibrationAggregation;
  /** The current manifest's hash — the cohort the default report is built on. */
  current_hash: string;
  /** Graded rows stamped with the current hash (part of the default analysis population). */
  n_current: number;
  /** Graded rows stamped with a DIFFERENT, KNOWN (non-null) hash — a real version bump
   *  split them off. EXCLUDED from the default bands; visible here so the split is never
   *  silent. Only these are held apart by default. */
  n_older: number;
  /** Graded rows with NO hash (legacy, pre-stamp). INCLUDED in the default analysis set
   *  (see the transition rule above) — excluding them would discard all existing evidence
   *  and blank calibration on rollout. Counted here so their share is always visible. */
  n_unversioned: number;
  /** Per older-hash breakdown (largest first), so the operator can see how many
   *  distinct prior strategy versions the ledger spans and how big each is. */
  older_hashes: Array<{ hash: string; n: number }>;
};

/** Read a row's frozen strategy_config_hash off entry_context. Null = legacy/unstamped
 *  (pre-Q12) — cohorted as "unversioned" and folded into the default set per the
 *  transition rule, never mistaken for a DIFFERENT known version. */
export function readStrategyConfigHash(ec: Record<string, unknown> | null | undefined): string | null {
  const h = ec?.strategy_config_hash;
  return typeof h === "string" && h.length > 0 ? h : null;
}

/** Partition graded rows into version cohorts and pick the analysis set. When
 *  crossVersion is false (default) the analysis set is the homogeneous cohort — rows
 *  whose hash is the current manifest hash OR null (legacy), per the transition rule —
 *  and rows carrying a DIFFERENT known hash are excluded. When true the analysis set is
 *  every graded row (blended, explicit). The summary always reports the full partition
 *  regardless, so the excluded population is never invisible. */
export function partitionByVersion(
  graded: CalibrationPlayRow[],
  currentHash: string,
  crossVersion: boolean
): { analysis: CalibrationPlayRow[]; summary: VersionCohortSummary } {
  const current: CalibrationPlayRow[] = [];
  const legacy: CalibrationPlayRow[] = [];
  const older = new Map<string, CalibrationPlayRow[]>();
  for (const r of graded) {
    const h = readStrategyConfigHash(r.entry_context);
    if (h == null) legacy.push(r);
    else if (h === currentHash) current.push(r);
    else older.set(h, [...(older.get(h) ?? []), r]);
  }
  const olderHashes = Array.from(older.entries())
    .map(([hash, rows]) => ({ hash, n: rows.length }))
    .sort((a, b) => b.n - a.n || a.hash.localeCompare(b.hash));
  const nOlder = olderHashes.reduce((sum, o) => sum + o.n, 0);
  const summary: VersionCohortSummary = {
    aggregation: crossVersion ? "cross_version" : "current_and_legacy",
    current_hash: currentHash,
    n_current: current.length,
    n_older: nOlder,
    n_unversioned: legacy.length,
    older_hashes: olderHashes,
  };
  // Default homogeneous set = current-hash rows + legacy (null-hash) rows; a different
  // KNOWN hash is the only thing excluded by default. crossVersion blends everything.
  const analysis = crossVersion ? graded : [...current, ...legacy];
  return { analysis, summary };
}

// ── Merit-tier record analysis (PR-F) ─────────────────────────────────────────────
// The tier function (./tiers.ts) was seeded from the SAME forensic priors that
// produced the score-band inversion finding (F-5) — so it gets the SAME treatment
// the scorers got: its buckets are continuously measured against graded outcomes,
// and if a lower tier outperforms a higher one the report says so in a machine-
// readable flag instead of letting the mis-weighting hide. This is also the ONLY
// place "A+" can come from: the display promotion is computed here from the A
// bucket's measured record against TIER_APLUS_UNLOCK, never at entry time.

/** A lower tier's win rate must beat a higher tier's by MORE than this many
 *  percentage points to flag an inversion. 10 pts = one flipped play at the n=10
 *  minimum — anything under that is bucket noise, not a broken weight function. */
export const TIER_INVERSION_DELTA_PTS = 10;
/** Both buckets need at least this many graded plays before an inversion can be
 *  called. Same bar as ENFORCE_MIN_BLOCK_N and TIER_APLUS_UNLOCK.minGraded: the
 *  F-5 inversion cuts were themselves LOW-N and we refused to act on any single
 *  one — a claim that the tier weights are provably wrong needs the same order of
 *  evidence as a claim that they are provably right. */
export const TIER_INVERSION_MIN_N = 10;

/** Assignable-tier bucket order, best → worst — F never appears here (skips never
 *  reach the graded ledger) and A+ is a display promotion, not a bucket. */
const TIER_ORDER: readonly ZeroDteTier[] = ["A", "B", "C"];

export type TierRecordBucket = CalibrationBucket & { tier: ZeroDteTier };

export type TierInversion = {
  /** The tier that SHOULD have won (ranked higher by the entry function). */
  higher: ZeroDteTier;
  /** The tier that actually beat it on the record. */
  lower: ZeroDteTier;
  /** lower's win rate minus higher's, percentage points (rounded for display;
   *  the flag itself is computed on unrounded rates). */
  delta_pts: number;
};

export type TierRecordAnalysis = {
  /** All three assignable tiers, always present (n=0 buckets included) — stable
   *  machine-readable shape, same rule as score_bands. */
  tiers: TierRecordBucket[];
  /** Graded rows with no pinned entry_context (pre-C-2) — tierFromEntryContext
   *  refuses to tier zero evidence, so they are counted here, never dumped into
   *  the C bucket where they would read as a measurement of the tier function. */
  untiered_n: number;
  /** TRUE when any lower tier's WR beats a higher tier's by >TIER_INVERSION_DELTA_PTS
   *  at n>=TIER_INVERSION_MIN_N each — the tier weights are then provably wrong,
   *  the same class of finding as the F-5 score-band inversion that seeded them. */
  tier_inversion: boolean;
  inversions: TierInversion[];
  /** The A+ unlock — the product's honesty spine. UIs display A+ ONLY when this
   *  says so (tiers.ts displayTierFor); the entry-time function cannot mint it. */
  aplus: {
    unlocked: boolean;
    min_graded: number;
    min_win_rate_pct: number;
    a_graded: number;
    a_win_rate_pct: number | null;
    note: string;
  };
};

/** Rows that also carry entry_context — what retroactive tiering reads. */
export type TierPlayRow = Pick<
  ZeroDteSetupLogRow,
  "plan_outcome" | "plan_pnl_pct" | "entry_context"
>;

/**
 * Per-tier measured record over GRADED plays, tiered retroactively from each row's
 * pinned entry_context (tierFromEntryContext — no backfill needed). Pure and
 * deterministic; LOW-N discipline identical to every other bucket in this module.
 */
export function analyzeTierRecord(rows: TierPlayRow[]): TierRecordAnalysis {
  const graded = rows.filter(isGradedZeroDteRow);
  const byTier = new Map<ZeroDteTier, TierPlayRow[]>(TIER_ORDER.map((t) => [t, []]));
  let untiered = 0;
  for (const r of graded) {
    const assigned = tierFromEntryContext(r.entry_context);
    if (assigned == null) untiered += 1;
    else byTier.get(assigned.tier)!.push(r);
  }
  const buckets: TierRecordBucket[] = TIER_ORDER.map((t) => ({
    tier: t,
    ...bucketOf(`tier ${t}`, byTier.get(t)!),
  }));

  // Monotonicity: every (higher, lower) pair, on UNROUNDED rates (same rationale
  // as the graduation delta). Strictly MORE than 10 pts — an exact-10 delta is the
  // one-flipped-play noise bound, and IEEE754 can render a true 10.0 as
  // 10.000000000000007 (e.g. 60% - 50% from n=10 buckets), so the epsilon forgives
  // float dust in the OTHER direction here: it keeps exact-10 from falsely firing.
  const inversions: TierInversion[] = [];
  for (let hi = 0; hi < TIER_ORDER.length; hi += 1) {
    for (let lo = hi + 1; lo < TIER_ORDER.length; lo += 1) {
      const higher = byTier.get(TIER_ORDER[hi]!)!;
      const lower = byTier.get(TIER_ORDER[lo]!)!;
      if (higher.length < TIER_INVERSION_MIN_N || lower.length < TIER_INVERSION_MIN_N) continue;
      const hiWr = rawWinRatePct(higher);
      const loWr = rawWinRatePct(lower);
      if (hiWr == null || loWr == null) continue;
      const delta = loWr - hiWr;
      if (delta > TIER_INVERSION_DELTA_PTS + DELTA_EPSILON) {
        inversions.push({ higher: TIER_ORDER[hi]!, lower: TIER_ORDER[lo]!, delta_pts: round1(delta) });
      }
    }
  }

  // A+ unlock: measured record of the A bucket vs TIER_APLUS_UNLOCK, on the
  // unrounded rate (a rounded 80.0 hiding a true 79.96 must not unlock). The
  // epsilon only forgives float dust on a mathematically-exact 80 (e.g. 8/10),
  // never a genuinely lower rate.
  const aRows = byTier.get("A")!;
  const aWr = rawWinRatePct(aRows);
  const unlocked =
    aRows.length >= TIER_APLUS_UNLOCK.minGraded &&
    aWr != null &&
    aWr >= TIER_APLUS_UNLOCK.minWinRatePct - DELTA_EPSILON;

  return {
    tiers: buckets,
    untiered_n: untiered,
    tier_inversion: inversions.length > 0,
    inversions,
    aplus: {
      unlocked,
      min_graded: TIER_APLUS_UNLOCK.minGraded,
      min_win_rate_pct: TIER_APLUS_UNLOCK.minWinRatePct,
      a_graded: aRows.length,
      a_win_rate_pct: aWr != null ? round1(aWr) : null,
      note: unlocked
        ? `A+ EARNED: the A bucket ran ${round1(aWr!)}% WR over ${aRows.length} graded plays ` +
          `(bar: ${TIER_APLUS_UNLOCK.minWinRatePct}% at n>=${TIER_APLUS_UNLOCK.minGraded}). Display may promote tier-A plays to A+.`
        : `A+ withheld: the A bucket has ${aRows.length} graded plays at ` +
          `${aWr != null ? `${round1(aWr)}%` : "n/a"} WR — the bar is ${TIER_APLUS_UNLOCK.minWinRatePct}% at ` +
          `n>=${TIER_APLUS_UNLOCK.minGraded}. A+ is earned from the record, never asserted at entry.`,
    },
  };
}

// ── Pure core ────────────────────────────────────────────────────────────────────

/** Extract the pinned would-block verdict for one calibration gate off a row's
 *  gate_calibration_json. Null = no usable verdict (row predates the column, blob
 *  malformed, or G-4 recorded tier "unknown" because day-open VIX was unavailable —
 *  gates.ts logs that honestly as would_block:false, but for CALIBRATION it is a
 *  non-observation, not a pass vote, so it must not dilute the would-pass bucket). */
export function gateVerdictOf(row: CalibrationPlayRow, gate: CalibrationGateKey): boolean | null {
  const blob = row.gate_calibration_json;
  if (blob == null || typeof blob !== "object") return null;
  const g = (blob as Record<string, unknown>)[gate];
  if (g == null || typeof g !== "object") return null;
  const rec = g as Record<string, unknown>;
  if (gate === "g4_vix" && rec.tier === "unknown") return null;
  return typeof rec.would_block === "boolean" ? rec.would_block : null;
}

/** The fields bucket math actually reads — lets the tier analysis reuse the exact
 *  same bucket/rate helpers on its narrower row shape (no casts). Carries entry_context
 *  too so the OFFICIAL (executable, WS-10) lane can be read with a mid fallback. */
type GradablePlayRow = Pick<ZeroDteSetupLogRow, "plan_pnl_pct" | "entry_context">;

// EXPORTED (additive, PR-16): the swing calibration wrappers (src/lib/swing/calibration.ts) reuse this
// bucket math + the recommendSignal ladder VERBATIM so the swing lane graduates on the SAME n>=10 /
// delta>=15pt bar as 0DTE — no second, drift-prone copy of the graduation math. Logic/signature unchanged.
export function bucketOf(label: string, rows: GradablePlayRow[]): CalibrationBucket {
  const wins = rows.filter(isZeroDteWin).length;
  // avg P&L on the OFFICIAL (executable, WS-10) lane — the same number isZeroDteWin scores wins
  // on — so a bucket's win rate and avg return can never come from two different lanes.
  const pnls = rows.map((r) => officialPlanPnlPct(r)).filter((p): p is number => p != null);
  // Wilson CI (WS-09) attached to EVERY bucket, in percentage points. n=0 → null (no
  // observation to bound); the swing lane reuses this helper verbatim, so it inherits
  // the interval too — one CI implementation, no drift.
  const ci = wilsonInterval(wins, rows.length);
  return {
    label,
    n: rows.length,
    wins,
    losses: rows.length - wins,
    win_rate_pct: rows.length > 0 ? round1((wins / rows.length) * 100) : null,
    avg_pnl_pct: pnls.length ? round2(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
    low_n: rows.length < LOW_N_THRESHOLD,
    win_rate_ci_pct:
      ci.mid == null ? null : { lo: round1(ci.lo * 100), hi: round1(ci.hi * 100), mid: round1(ci.mid * 100) },
  };
}

// ── Calibration-first evidence buckets: multi-day accumulation alignment + confluence tier ─────────
// Both signals ship as EVIDENCE ONLY on the board (flow-accumulation-context.ts, confluence.ts) —
// pinned into each row's entry_context but never gating. Bucketing GRADED outcomes by each answers,
// with the exact same n / win-rate / avg-PnL math as every other bucket, whether they actually
// predict wins — the prerequisite for either graduating into scoring. Reads are defensive: an
// absent/old blob simply lands in the no-signal bucket, never a fabricated verdict.

function readAlignment(ec: Record<string, unknown> | null | undefined): boolean | null {
  const fa = (ec?.flow_accumulation ?? null) as { aligned?: unknown } | null;
  return fa && typeof fa.aligned === "boolean" ? fa.aligned : null;
}

function readConfluenceTier(ec: Record<string, unknown> | null | undefined): "triple" | "double" | "weak" | null {
  const c = (ec?.confluence ?? null) as { tier?: unknown } | null;
  return c?.tier === "triple" || c?.tier === "double" || c?.tier === "weak" ? c.tier : null;
}

/** Graded record bucketed by whether today's direction agreed with multi-day accumulation. */
export function analyzeAccumulationAlignment(graded: CalibrationPlayRow[]): CalibrationBucket[] {
  const aligned: CalibrationPlayRow[] = [];
  const misaligned: CalibrationPlayRow[] = [];
  const noSignal: CalibrationPlayRow[] = [];
  for (const r of graded) {
    const a = readAlignment(r.entry_context);
    (a === true ? aligned : a === false ? misaligned : noSignal).push(r);
  }
  return [bucketOf("aligned", aligned), bucketOf("misaligned", misaligned), bucketOf("no_signal", noSignal)];
}

// ── Discovery-origin band (Phase 3a, docs/audit/0DTE-UNIFICATION-DESIGN.md §1a) ─────────────
// The origin SET is pinned in each row's entry_context.discovery_origin at commit. Bucketing
// GRADED outcomes by it — with the exact same n / win-rate / avg-PnL math as every other band —
// is the whole point of the provenance work: it lets the operator answer, per origin and on REAL
// outcomes, "does BREAKOUT pay?" and "does FLOW+BREAKOUT beat FLOW alone?" before any corroboration
// boost is ever hand-wired. Reads defensively: a pre-3a row with no origin blob lands in the
// "no_origin" bucket, never a fabricated verdict. Non-gating (evidence, exactly like the two bands
// above); a source graduates through the same recommendSignal ladder once its band clears n>=10.

/** The origin labels always emitted (stable machine-readable shape), best/simplest first. PIN
 *  arrived in Phase 3b (§1a); its combinations (FLOW+PIN, BREAKOUT+PIN, FLOW+BREAKOUT+PIN) are
 *  emitted dynamically when observed — an unrecognized label is still appended so nothing is dropped. */
export const CALIBRATION_ORIGIN_BANDS = [
  "FLOW",
  "BREAKOUT",
  "PIN",
  "FLOW+BREAKOUT",
  "FLOW+PIN",
  "no_origin",
] as const;

/** Canonical origin label off a row's entry_context.discovery_origin (defensive — an absent/garbage
 *  blob → "no_origin"). Reuses board.ts's one label function so the calibration slice and the
 *  persisted feature-vector label can never drift. */
export function readOriginLabel(ec: Record<string, unknown> | null | undefined): string {
  const raw = (ec?.discovery_origin ?? null) as unknown;
  if (!Array.isArray(raw)) return "no_origin";
  const origins = raw.filter(
    (o): o is DiscoveryOrigin => o === "FLOW" || o === "BREAKOUT" || o === "PIN"
  );
  return discoveryOriginLabel(origins);
}

/** Graded record bucketed by discovery-origin set (FLOW / BREAKOUT / FLOW+BREAKOUT / …). */
export function analyzeOriginBands(graded: CalibrationPlayRow[]): CalibrationBucket[] {
  const byLabel = new Map<string, CalibrationPlayRow[]>();
  for (const r of graded) {
    const label = readOriginLabel(r.entry_context);
    byLabel.set(label, [...(byLabel.get(label) ?? []), r]);
  }
  // Always emit the canonical bands (n=0 included) for a stable shape, then any other observed
  // label (future PIN combinations) appended in sorted order so nothing is silently dropped.
  const labels = [
    ...CALIBRATION_ORIGIN_BANDS,
    ...Array.from(byLabel.keys())
      .filter((l) => !CALIBRATION_ORIGIN_BANDS.includes(l as (typeof CALIBRATION_ORIGIN_BANDS)[number]))
      .sort(),
  ];
  return labels.map((label) => bucketOf(label, byLabel.get(label) ?? []));
}

// ── Play-type band (Phase 4, docs/audit/0DTE-UNIFICATION-DESIGN.md §1c) ─────────────────────
// play_type is pinned in each row's entry_context at commit (DIRECTIONAL / CONDOR). Bucketing GRADED
// outcomes by it — same n / win-rate / avg-PnL math as every other band — is how the condor SELL
// engine graduates on its OWN ledger evidence (real credits + breach fills) before it ever sizes real
// risk: a condor's win rate is structurally high (negative skew), so it must be measured as its own
// bucket, never blended into the directional record. Non-gating (evidence only). Reads defensively —
// a pre-Phase-4 row with no play_type lands in DIRECTIONAL (its true structure; the condor path did
// not exist), never a fabricated verdict.
export const CALIBRATION_PLAY_TYPE_BANDS = ["DIRECTIONAL", "CONDOR"] as const;

/** Canonical play_type label off a row's entry_context.play_type (absent/garbage → DIRECTIONAL, which
 *  is what every pre-Phase-4 row actually was). */
export function readPlayTypeLabel(ec: Record<string, unknown> | null | undefined): string {
  return ec?.play_type === "CONDOR" ? "CONDOR" : "DIRECTIONAL";
}

/** Graded record bucketed by play_type (DIRECTIONAL / CONDOR) — the condor's own graduation ledger. */
export function analyzePlayTypeBands(graded: CalibrationPlayRow[]): CalibrationBucket[] {
  const byLabel = new Map<string, CalibrationPlayRow[]>();
  for (const r of graded) {
    const label = readPlayTypeLabel(r.entry_context);
    byLabel.set(label, [...(byLabel.get(label) ?? []), r]);
  }
  return CALIBRATION_PLAY_TYPE_BANDS.map((label) => bucketOf(label, byLabel.get(label) ?? []));
}

// ── Crossed origin × play_type cohorts (Hardening WS-07) ────────────────────────────────────
// The marginal origin_bands ("does BREAKOUT pay?") and play_type_bands ("does the condor pay?")
// each hide a Simpson's-paradox trap: a PIN marginal can look fine while its DIRECTIONAL-FADE cell
// carries it and its CONDOR cell quietly bleeds (or vice-versa). The crossed cohort measures the
// INTERACTION on real outcomes — one cell per (origin × structure) — so a weak sub-strategy can't
// hide inside a healthy marginal. Keyed on the SAME two label readers the marginals use
// (readOriginLabel × the crossed play-type refinement below), so the crossed and marginal slices
// can never disagree about what a row is. Non-gating evidence, exactly like every band above.

/** The crossed play-type label. Identical to readPlayTypeLabel EXCEPT a PIN-origin directional
 *  play is named DIRECTIONAL_FADE: pin-source.ts builds ONLY the directional-fade discovery origin
 *  (spot pinned near a wall → fade toward the pin), never momentum, so a pure-PIN directional play
 *  IS a fade by construction. Refining the label here (a deterministic function of origin+play_type,
 *  never a fabricated field) keeps the PIN×CONDOR-vs-PIN×fade contrast legible in the cell key. Mixed
 *  origins (e.g. FLOW+PIN) keep the plain DIRECTIONAL label — the fade edge is not the sole driver. */
export function readCrossedPlayTypeLabel(ec: Record<string, unknown> | null | undefined): string {
  const playType = readPlayTypeLabel(ec);
  if (playType === "CONDOR") return "CONDOR";
  return readOriginLabel(ec) === "PIN" ? "DIRECTIONAL_FADE" : "DIRECTIONAL";
}

/** The crossed cells ALWAYS emitted (stable machine-readable shape, n=0 included) — the four the
 *  design calls for at minimum. Any other observed (origin × structure) combination is appended
 *  dynamically in sorted order so nothing is ever silently dropped. */
export const CALIBRATION_ORIGIN_PLAYTYPE_CELLS = [
  { origin: "FLOW", play_type: "DIRECTIONAL" },
  { origin: "BREAKOUT", play_type: "DIRECTIONAL" },
  { origin: "PIN", play_type: "DIRECTIONAL_FADE" },
  { origin: "PIN", play_type: "CONDOR" },
] as const;

const crossedKey = (origin: string, playType: string): string => `${origin} × ${playType}`;

/** A crossed cohort cell — a CalibrationBucket (with its Wilson CI) plus the forward-time holdout
 *  (WS-09) and the recommend-only production-graduation verdict evaluated ON THIS cell. */
export type OriginPlayTypeCell = CalibrationBucket & {
  origin: string;
  play_type: string;
  /** EARLIER-vs-LATER stability split by session_date (WS-09) — see forwardHoldout. */
  holdout: ForwardHoldout;
  /** Recommend-only production verdict for this exact crossed cell — n≥75 AND Wilson lower bound
   *  clears the floor AND forward-holdout stability AND no significant OOS decay. Verdict strings
   *  only; a human/PR still graduates. */
  recommendation: CrossedGraduation;
};

// ── Forward time holdout (Hardening WS-09) ──────────────────────────────────────────────────
// A cohort's win rate over the whole window can be a mirage: an edge that worked in the FIRST
// half and decayed to noise in the SECOND half still prints a healthy blended rate. We split each
// cohort's graded rows by SESSION_DATE at the median into EARLIER vs LATER and check the two halves
// agree. The split is by TIME, never random: 0DTE outcomes are a time series (regime drifts, the
// scorer/gates evolve, the market adapts to a published edge), so a random split would leak future
// sessions into the "training" half and mask exactly the decay we are hunting. A median session-date
// cut is the honest out-of-sample proxy available inside a bounded calibration window.

/** Minimum graded rows in EACH half before the holdout can assess stability. Below this the split is
 *  too thin to compare — the cell is reported unstable-by-insufficiency, never falsely "stable". */
export const HOLDOUT_MIN_PER_HALF = 3;

export type ForwardHoldout = {
  /** The session_date boundary: LATER = rows with session_date >= this; EARLIER = the rest. Null
   *  when there aren't at least two distinct session dates to split on. */
  split_date: string | null;
  earlier: CalibrationBucket;
  later: CalibrationBucket;
  /** later win rate − earlier win rate, percentage points (null when either half is empty). Negative
   *  = the edge decayed out of sample. */
  decay_pts: number | null;
  /** 95% CI on the decay (later − earlier), percentage points. Null when either half is empty. */
  decay_ci_pct: { lo: number; hi: number } | null;
  /** TRUE when both halves have >= HOLDOUT_MIN_PER_HALF graded rows AND there is no SIGNIFICANT
   *  out-of-sample decay (the decay CI's upper bound stays >= 0 — we cannot conclude the later
   *  period is worse). Stability is a REQUIREMENT for production graduation, never a gate on trading. */
  stable: boolean;
  reason: string;
};

/** Split a cohort's graded rows by session_date at the median and measure earlier/later agreement.
 *  Pure: sorts by session_date, cuts at the median date, buckets each half with the standard math. */
export function forwardHoldout(rows: CalibrationPlayRow[]): ForwardHoldout {
  const dates = Array.from(new Set(rows.map((r) => r.session_date))).sort();
  if (dates.length < 2) {
    const only = bucketOf("earlier", rows);
    return {
      split_date: null,
      earlier: only,
      later: bucketOf("later", []),
      decay_pts: null,
      decay_ci_pct: null,
      stable: false,
      reason:
        `only ${dates.length} distinct session date(s) — need at least 2 to split a forward holdout; ` +
        `stability is unproven (not the same as stable).`,
    };
  }
  // Median-date cut: LATER = the top half of distinct dates, EARLIER = the bottom half. Splitting on
  // the distinct-date median (not the row median) keeps whole sessions on one side — a session is the
  // atomic unit of a regime, and splitting mid-session would blend the same day's plays across halves.
  const splitDate = dates[Math.floor(dates.length / 2)]!;
  const earlierRows = rows.filter((r) => r.session_date < splitDate);
  const laterRows = rows.filter((r) => r.session_date >= splitDate);
  const earlier = bucketOf("earlier", earlierRows);
  const later = bucketOf("later", laterRows);
  const diff = proportionDiffCI(earlier.wins, earlier.n, later.wins, later.n);
  const decayPts = earlier.n > 0 && later.n > 0 ? round1(diff.diff * 100) : null;
  const decayCi =
    earlier.n > 0 && later.n > 0 ? { lo: round1(diff.lo * 100), hi: round1(diff.hi * 100) } : null;
  const enoughPerHalf = earlier.n >= HOLDOUT_MIN_PER_HALF && later.n >= HOLDOUT_MIN_PER_HALF;
  // No SIGNIFICANT decay = the decay CI's upper bound stays at/above 0 (we can't conclude later<earlier).
  const noSignificantDecay = decayCi != null && decayCi.hi >= 0;
  const stable = enoughPerHalf && noSignificantDecay;
  return {
    split_date: splitDate,
    earlier,
    later,
    decay_pts: decayPts,
    decay_ci_pct: decayCi,
    stable,
    reason: !enoughPerHalf
      ? `holdout halves too thin (earlier n=${earlier.n}, later n=${later.n}; need >=${HOLDOUT_MIN_PER_HALF} each) — stability unproven.`
      : noSignificantDecay
        ? `earlier ${earlier.win_rate_pct}% vs later ${later.win_rate_pct}% (decay ${decayPts} pts, CI [${decayCi!.lo}, ${decayCi!.hi}]) — no significant out-of-sample decay; stable.`
        : `later ${later.win_rate_pct}% is significantly below earlier ${earlier.win_rate_pct}% (decay ${decayPts} pts, CI upper ${decayCi!.hi} < 0) — the edge decayed out of sample.`,
  };
}

// ── Production graduation on the crossed cell (Hardening WS-09) — RECOMMEND ONLY ─────────────
/** A crossed cell needs at least this many graded plays before a "production" recommendation is even
 *  considered — far above ENFORCE_MIN_BLOCK_N (10). A per-strategy production call is a much bigger
 *  commitment than a single gate graduating, and a crossed cell is a slice of an already-sliced
 *  population, so it must clear a genuinely large sample first. */
export const PRODUCTION_MIN_N = 75;
/** The win-rate FLOOR the Wilson lower bound must clear, percentage points. 33.3% is the breakeven of
 *  the −50% / +100% directional payoff (a +100/−50 bet needs >1/3 wins to be EV-positive). Condor cells
 *  have a different payoff geometry and their own floor lives with the condor ledger — this default is
 *  the DIRECTIONAL breakeven and the recommendation names the assumption. Recommend-only either way. */
export const PRODUCTION_WILSON_FLOOR_PCT = 33.3;

export type CrossedGraduation = {
  verdict: "graduate_to_production" | "keep_calibrating" | "insufficient_data";
  checks: { n_ok: boolean; wilson_lb_ok: boolean; stable: boolean; no_decay: boolean };
  min_n: number;
  floor_pct: number;
  wilson_lb_pct: number | null;
  reason: string;
};

/** The recommend-only production verdict for one crossed cell. "graduate_to_production" requires ALL of:
 *  n>=PRODUCTION_MIN_N, the Wilson LOWER bound clears the floor (not the point estimate — the pessimistic
 *  end must clear it), forward-holdout stability, and no significant OOS decay. Anything short with data
 *  is keep_calibrating; too-small is insufficient_data. Returns strings only — a human/PR graduates. */
export function recommendCrossedCell(cell: CalibrationBucket, holdout: ForwardHoldout): CrossedGraduation {
  const wilsonLb = cell.win_rate_ci_pct?.lo ?? null;
  const nOk = cell.n >= PRODUCTION_MIN_N;
  const wilsonLbOk = wilsonLb != null && wilsonLb >= PRODUCTION_WILSON_FLOOR_PCT - DELTA_EPSILON;
  const stable = holdout.stable;
  // "No decay" is subsumed by stability (stable already requires no significant decay), but it is
  // surfaced as its own check so the report shows WHICH requirement failed.
  const noDecay = holdout.decay_ci_pct != null && holdout.decay_ci_pct.hi >= 0;
  const checks = { n_ok: nOk, wilson_lb_ok: wilsonLbOk, stable, no_decay: noDecay };

  let verdict: CrossedGraduation["verdict"];
  let reason: string;
  if (!nOk) {
    verdict = "insufficient_data";
    reason = `crossed cell has n=${cell.n} graded plays — a production recommendation requires n>=${PRODUCTION_MIN_N} (a slice of an already-sliced population needs a genuinely large sample before it sizes production risk).`;
  } else if (wilsonLbOk && stable && noDecay) {
    verdict = "graduate_to_production";
    reason = `n=${cell.n}, Wilson lower bound ${wilsonLb}% clears the ${PRODUCTION_WILSON_FLOOR_PCT}% floor, and the forward holdout is stable (${holdout.reason}) — this crossed cohort has EARNED a production recommendation. Recommend-only: a human/PR graduates it.`;
  } else {
    verdict = "keep_calibrating";
    const failed: string[] = [];
    if (!wilsonLbOk) failed.push(`Wilson lower bound ${wilsonLb ?? "n/a"}% is under the ${PRODUCTION_WILSON_FLOOR_PCT}% floor`);
    if (!stable) failed.push(`forward holdout not stable (${holdout.reason})`);
    else if (!noDecay) failed.push(`significant out-of-sample decay (${holdout.reason})`);
    reason = `n=${cell.n} is large enough, but: ${failed.join("; ")}. Not graduated; keep pinning evidence.`;
  }
  return { verdict, checks, min_n: PRODUCTION_MIN_N, floor_pct: PRODUCTION_WILSON_FLOOR_PCT, wilson_lb_pct: wilsonLb, reason };
}

/** Graded record crossed by (origin × play_type) with a Wilson CI, forward holdout, and recommend-only
 *  production verdict on EACH cell. The four canonical cells are always present (stable shape); any other
 *  observed combination is appended in sorted order so nothing is dropped. */
export function analyzeOriginPlayTypeBands(graded: CalibrationPlayRow[]): OriginPlayTypeCell[] {
  const byKey = new Map<string, CalibrationPlayRow[]>();
  for (const r of graded) {
    const origin = readOriginLabel(r.entry_context);
    const playType = readCrossedPlayTypeLabel(r.entry_context);
    byKey.set(crossedKey(origin, playType), [...(byKey.get(crossedKey(origin, playType)) ?? []), r]);
  }
  const canonicalKeys = new Set(CALIBRATION_ORIGIN_PLAYTYPE_CELLS.map((c) => crossedKey(c.origin, c.play_type)));
  const extra = Array.from(byKey.keys()).filter((k) => !canonicalKeys.has(k)).sort();
  const ordered: Array<{ origin: string; play_type: string; key: string }> = [
    ...CALIBRATION_ORIGIN_PLAYTYPE_CELLS.map((c) => ({ origin: c.origin, play_type: c.play_type, key: crossedKey(c.origin, c.play_type) })),
    // Recover origin/play_type from an observed key by splitting on the " × " separator.
    ...extra.map((k) => {
      const [origin, playType] = k.split(" × ");
      return { origin: origin ?? k, play_type: playType ?? "", key: k };
    }),
  ];
  return ordered.map(({ origin, play_type, key }) => {
    const rows = byKey.get(key) ?? [];
    const bucket = bucketOf(key, rows);
    const holdout = forwardHoldout(rows);
    return { ...bucket, origin, play_type, holdout, recommendation: recommendCrossedCell(bucket, holdout) };
  });
}

/** Graded record bucketed by confluence tier — the "double" bucket is the +15.9% EV research finding. */
export function analyzeConfluenceTiers(graded: CalibrationPlayRow[]): CalibrationBucket[] {
  const triple: CalibrationPlayRow[] = [];
  const double: CalibrationPlayRow[] = [];
  const weak: CalibrationPlayRow[] = [];
  const noRead: CalibrationPlayRow[] = [];
  for (const r of graded) {
    const t = readConfluenceTier(r.entry_context);
    (t === "triple" ? triple : t === "double" ? double : t === "weak" ? weak : noRead).push(r);
  }
  return [bucketOf("triple", triple), bucketOf("double", double), bucketOf("weak", weak), bucketOf("no_read", noRead)];
}

/** Unrounded win rate for the graduation delta — the rounded display rate loses up
 *  to 0.05 pts per bucket, enough to flip a boundary case at the 15-pt line. */
export function rawWinRatePct(rows: GradablePlayRow[]): number | null {
  if (rows.length === 0) return null;
  return (rows.filter(isZeroDteWin).length / rows.length) * 100;
}

function recommendGate(gate: CalibrationGateKey, graded: CalibrationPlayRow[]): GateRecommendation {
  const withVerdict = graded.filter((r) => gateVerdictOf(r, gate) != null);
  const blockRows = withVerdict.filter((r) => gateVerdictOf(r, gate) === true);
  const passRows = withVerdict.filter((r) => gateVerdictOf(r, gate) === false);
  const wouldBlock = bucketOf("would_block", blockRows);
  const wouldPass = bucketOf("would_pass", passRows);
  const rawBlockWr = rawWinRatePct(blockRows);
  const rawPassWr = rawWinRatePct(passRows);
  const delta = rawBlockWr != null && rawPassWr != null ? rawPassWr - rawBlockWr : null;

  // Graduation ladder, most-restrictive check first. LOW-N discipline is absolute:
  // a low_n bucket on EITHER side never produces an enforce/keep verdict — the same
  // rule record.ts applies to the member-facing record ("never let a 2-sample
  // bucket read like a track record"), applied to gate policy.
  let verdict: GateRecommendation["verdict"];
  let reason: string;
  if (wouldBlock.n < ENFORCE_MIN_BLOCK_N || wouldPass.low_n || delta == null) {
    verdict = "insufficient_data";
    reason =
      wouldBlock.n < ENFORCE_MIN_BLOCK_N
        ? `would_block has n=${wouldBlock.n} graded plays — graduation requires n>=${ENFORCE_MIN_BLOCK_N} (the F-1 priors this gate rests on were themselves n=12/13 and deliberately NOT enforced).`
        : `would_pass has n=${wouldPass.n} (< ${LOW_N_THRESHOLD}) — no baseline to compare the block bucket against.`;
  } else if (delta >= ENFORCE_MIN_DELTA_PTS - DELTA_EPSILON) {
    verdict = "enforce";
    reason =
      `would_block ran ${wouldBlock.win_rate_pct}% WR (n=${wouldBlock.n}) vs would_pass ` +
      `${wouldPass.win_rate_pct}% (n=${wouldPass.n}) — ${round1(delta)} pts worse, clearing the ` +
      `${ENFORCE_MIN_DELTA_PTS}-pt graduation bar. The gate has earned enforcement.`;
  } else {
    verdict = "keep_calibrating";
    reason =
      `Delta is ${round1(delta)} pts (would_pass ${wouldPass.win_rate_pct}% vs would_block ` +
      `${wouldBlock.win_rate_pct}%) — under the ${ENFORCE_MIN_DELTA_PTS}-pt bar. The gate has not ` +
      `demonstrated enough harm to justify blocking real commits; keep pinning verdicts.`;
  }

  return {
    gate,
    verdict,
    evidence: {
      would_block: wouldBlock,
      would_pass: wouldPass,
      delta_win_rate_pts: delta != null ? round1(delta) : null,
      no_verdict_n: graded.length - withVerdict.length,
      min_block_n: ENFORCE_MIN_BLOCK_N,
      min_delta_pts: ENFORCE_MIN_DELTA_PTS,
      reason,
    },
  };
}

/** Graduation verdict for a POSITIVE evidence signal (confluence tier, accumulation alignment, the
 *  scale-out exit) — the mirror of recommendGate for signals we'd ADD to scoring rather than gates we'd
 *  enforce. Same ladder, same LOW-N discipline: the signal-present bucket must clear n>=ENFORCE_MIN_BLOCK_N,
 *  the baseline must not be low_n, and the win-rate delta (signal_on − signal_off) must clear the
 *  ENFORCE_MIN_DELTA_PTS bar before the ledger says "enforce" (i.e. wire it into score). Until then it
 *  stays keep_calibrating/insufficient_data — the structural guard against eyeballing a small,
 *  single-window sample (e.g. the confluence "double" n=22 at 11:00) into the live score. Non-gating:
 *  this returns a verdict; a human/PR still does the wiring. */
export type SignalRecommendation = {
  signal: string;
  verdict: "enforce" | "keep_calibrating" | "insufficient_data";
  evidence: {
    signal_on: CalibrationBucket;
    signal_off: CalibrationBucket;
    delta_win_rate_pts: number | null;
    no_read_n: number;
    min_on_n: number;
    min_delta_pts: number;
    reason: string;
  };
};

export function recommendSignal(
  signal: string,
  onRows: CalibrationPlayRow[],
  offRows: CalibrationPlayRow[],
  noReadN: number
): SignalRecommendation {
  const signalOn = bucketOf("signal_on", onRows);
  const signalOff = bucketOf("signal_off", offRows);
  const rawOn = rawWinRatePct(onRows);
  const rawOff = rawWinRatePct(offRows);
  const delta = rawOn != null && rawOff != null ? rawOn - rawOff : null;

  let verdict: SignalRecommendation["verdict"];
  let reason: string;
  if (signalOn.n < ENFORCE_MIN_BLOCK_N || signalOff.low_n || delta == null) {
    verdict = "insufficient_data";
    reason =
      signalOn.n < ENFORCE_MIN_BLOCK_N
        ? `signal_on has n=${signalOn.n} graded plays — graduation into score requires n>=${ENFORCE_MIN_BLOCK_N} (the research finding this rests on was itself small-n and single-window; it is NOT enforced until the live ledger clears the bar).`
        : `signal_off has n=${signalOff.n} (< ${LOW_N_THRESHOLD}) — no baseline to measure the signal's edge against.`;
  } else if (delta >= ENFORCE_MIN_DELTA_PTS - DELTA_EPSILON) {
    verdict = "enforce";
    reason =
      `signal_on ran ${signalOn.win_rate_pct}% WR (n=${signalOn.n}) vs signal_off ${signalOff.win_rate_pct}% ` +
      `(n=${signalOff.n}) — ${round1(delta)} pts better, clearing the ${ENFORCE_MIN_DELTA_PTS}-pt bar. The ` +
      `signal has earned a place in scoring.`;
  } else {
    verdict = "keep_calibrating";
    reason =
      `Delta is ${round1(delta)} pts (signal_on ${signalOn.win_rate_pct}% vs signal_off ${signalOff.win_rate_pct}%) ` +
      `— under the ${ENFORCE_MIN_DELTA_PTS}-pt bar. Not enough demonstrated edge to move score; keep pinning evidence.`;
  }

  return {
    signal,
    verdict,
    evidence: {
      signal_on: signalOn,
      signal_off: signalOff,
      delta_win_rate_pts: delta != null ? round1(delta) : null,
      no_read_n: noReadN,
      min_on_n: ENFORCE_MIN_BLOCK_N,
      min_delta_pts: ENFORCE_MIN_DELTA_PTS,
      reason,
    },
  };
}

/** Coded graduation verdict for the confluence "double" tier (the +15.9% EV research finding, measured
 *  n=22 at 11:00) — double vs weak. Structurally keeps that small single-window sample OUT of the score
 *  until the live graded ledger clears the n>=10 / delta>=15pt bar. */
export function recommendConfluence(graded: CalibrationPlayRow[]): SignalRecommendation {
  const double: CalibrationPlayRow[] = [];
  const weak: CalibrationPlayRow[] = [];
  let noRead = 0;
  for (const r of graded) {
    const t = readConfluenceTier(r.entry_context);
    if (t === "double") double.push(r);
    else if (t === "weak") weak.push(r);
    else noRead++; // triple/no_read are not part of the double-vs-weak graduation comparison
  }
  return recommendSignal("confluence_double", double, weak, noRead);
}

/** Coded graduation verdict for multi-day accumulation alignment — aligned vs misaligned. */
export function recommendAccumulation(graded: CalibrationPlayRow[]): SignalRecommendation {
  const aligned: CalibrationPlayRow[] = [];
  const misaligned: CalibrationPlayRow[] = [];
  let noSignal = 0;
  for (const r of graded) {
    const a = readAlignment(r.entry_context);
    if (a === true) aligned.push(r);
    else if (a === false) misaligned.push(r);
    else noSignal++;
  }
  return recommendSignal("accumulation_aligned", aligned, misaligned, noSignal);
}

/** The banger scale-out must beat hold-to-expiry by at least this multiple (per $1 risked) before the
 *  live managed exit activates — the EV analog of the 15-pt win-rate bar, sized to the +26%/+50%
 *  realized-vs-hold gap the backtest showed while staying well above execution-cost noise. */
export const SCALE_OUT_MIN_DELTA_MULT = 0.15;

export type ScaleOutGradeReading = { real: number | null; hold: number | null; ungradeable: boolean };

/** Coerce a RAW banger scale-out grade blob ({scale_out_realized_mult, hold_mult, ungradeable}, produced
 *  by banger-scale-out-grade.ts) into the reader shape. Defensive — every field optional, ungradeable rows
 *  excluded from the rate (survivorship guard). Exported so the nighthawk-side reader (which pins the blob
 *  directly on nighthawk_play_outcomes.scale_out_grade, NOT wrapped in entry_context) shares one parser
 *  with the 0DTE-ledger reader — the graduation rule can never drift between the two ledgers. */
export function readScaleOutGradeBlob(
  s: Record<string, unknown> | null | undefined
): ScaleOutGradeReading | null {
  if (!s || typeof s !== "object") return null;
  const b = s as { scale_out_realized_mult?: unknown; hold_mult?: unknown; ungradeable?: unknown };
  return {
    real: typeof b.scale_out_realized_mult === "number" && Number.isFinite(b.scale_out_realized_mult) ? b.scale_out_realized_mult : null,
    hold: typeof b.hold_mult === "number" && Number.isFinite(b.hold_mult) ? b.hold_mult : null,
    ungradeable: b.ungradeable === true,
  };
}

/** The pinned banger scale-out grade blob nested under entry_context.scale_out (the 0DTE-ledger location,
 *  written by the outcomes sync). Thin wrapper over readScaleOutGradeBlob. */
function readScaleOutGrade(
  ec: Record<string, unknown> | null | undefined
): ScaleOutGradeReading | null {
  return readScaleOutGradeBlob((ec?.scale_out ?? null) as Record<string, unknown> | null);
}

export type ScaleOutRecommendation = {
  signal: "scale_out";
  verdict: "enforce" | "keep_calibrating" | "insufficient_data";
  evidence: {
    n_gradeable: number;
    n_ungradeable: number;
    mean_realized_mult: number | null;
    mean_hold_mult: number | null;
    delta_mult: number | null;
    min_n: number;
    min_delta_mult: number;
    reason: string;
  };
};

/** Coded graduation verdict for the whole-market BANGER scale-out exit (the +26%/+50% realized-vs-hold
 *  positive-skew lever). EV-based (mean realized multiple vs mean hold-to-expiry), not win-rate — the
 *  edge is skew, not hit-rate. enforce (activate the live managed exit) only once n>=10 gradeable banger
 *  rows show the scale-out beating hold by >= SCALE_OUT_MIN_DELTA_MULT per $1. Ungradeable (thin/expired
 *  weekly) rows are counted separately and excluded — never imputed. Non-gating: a human/PR still flips
 *  the live exit on; this is the evidence bar it must clear. */
export function recommendScaleOut(graded: CalibrationPlayRow[]): ScaleOutRecommendation {
  return recommendScaleOutFromGrades(graded.map((r) => readScaleOutGrade(r.entry_context)));
}

/** The PURE EV-based graduation, shared by BOTH the 0DTE-ledger reader (recommendScaleOut, reads
 *  entry_context.scale_out) and the nighthawk reader (reads the scale_out_grade column). Takes already-
 *  parsed grade readings so the banger exit graduates on ONE identical rule wherever the grades are pinned.
 *  enforce only once n>=ENFORCE_MIN_BLOCK_N gradeable rows beat hold by >= SCALE_OUT_MIN_DELTA_MULT/$1;
 *  ungradeable rows are counted separately and NEVER imputed (survivorship guard). Non-gating evidence. */
export function recommendScaleOutFromGrades(
  readings: Array<ScaleOutGradeReading | null>
): ScaleOutRecommendation {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const reals: number[] = [];
  const holds: number[] = [];
  let nUngr = 0;
  for (const g of readings) {
    if (!g) continue;
    if (g.ungradeable || g.real == null || g.hold == null) { nUngr++; continue; }
    reals.push(g.real);
    holds.push(g.hold);
  }
  const n = reals.length;
  const meanReal = n ? reals.reduce((a, b) => a + b, 0) / n : null;
  const meanHold = n ? holds.reduce((a, b) => a + b, 0) / n : null;
  const delta = meanReal != null && meanHold != null ? meanReal - meanHold : null;

  let verdict: ScaleOutRecommendation["verdict"];
  let reason: string;
  if (n < ENFORCE_MIN_BLOCK_N || delta == null) {
    verdict = "insufficient_data";
    reason = `only n=${n} gradeable banger rows (need n>=${ENFORCE_MIN_BLOCK_N}) — the scale-out exit stays ADVISORY (risk_note only) until the live ledger clears the bar.`;
  } else if (delta >= SCALE_OUT_MIN_DELTA_MULT - DELTA_EPSILON) {
    verdict = "enforce";
    reason = `scale-out realized ${r2(meanReal!)}× vs hold ${r2(meanHold!)}× over n=${n} — +${r2(delta)}×/$1, clearing the ${SCALE_OUT_MIN_DELTA_MULT}× bar. The managed scale-out exit has earned live activation.`;
  } else {
    verdict = "keep_calibrating";
    reason = `scale-out ${r2(meanReal!)}× vs hold ${r2(meanHold!)}× (+${r2(delta)}×) — under the ${SCALE_OUT_MIN_DELTA_MULT}× bar; keep grading before the exit goes live.`;
  }

  return {
    signal: "scale_out",
    verdict,
    evidence: {
      n_gradeable: n,
      n_ungradeable: nUngr,
      mean_realized_mult: meanReal != null ? r2(meanReal) : null,
      mean_hold_mult: meanHold != null ? r2(meanHold) : null,
      delta_mult: delta != null ? r2(delta) : null,
      min_n: ENFORCE_MIN_BLOCK_N,
      min_delta_mult: SCALE_OUT_MIN_DELTA_MULT,
      reason,
    },
  };
}

/** Score bands for the G-3 floor evidence. FINER than record.ts's member-facing
 *  3-band cut: F-5's finding is a top-band INVERSION (85+ underperforming 75-84 on
 *  three surfaces), which a single "75+" bucket would hide by construction. */
export const CALIBRATION_SCORE_BANDS = [
  "score <55",
  "score 55-64",
  "score 65-74",
  "score 75-84",
  "score 85+",
] as const;

export function calibrationScoreBand(score: number): (typeof CALIBRATION_SCORE_BANDS)[number] {
  if (score >= 85) return "score 85+";
  if (score >= 75) return "score 75-84";
  if (score >= 65) return "score 65-74";
  if (score >= 55) return "score 55-64";
  return "score <55";
}

/** One graded counterfactual skip as the analyzer consumes it — `counterfactual` is
 *  the raw JSONB payload; parsing is defensive (fail-soft on malformed blobs).
 *  `strategy_config_hash` (WS-17) is OPTIONAL: the current skip-grading fetch
 *  (skip-grading.ts fetchGradedSkips) does NOT project it, so it is undefined in
 *  production today and the per-source veto analysis collapses the hash dimension to
 *  "unknown". It is on the type so that when the rejection projection is widened to
 *  carry the frozen hash, the analysis keys on (source × hash) with ZERO further change
 *  here — and so a test can supply it. Never fabricated when absent. */
export type GradedSkipInput = {
  gate_failed: string;
  counterfactual: unknown;
  strategy_config_hash?: string | null;
};

function isSkipCounterfactual(v: unknown): v is SkipCounterfactual {
  if (v == null || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec.verdict === "string" &&
    ["would_have_won", "would_have_lost", "ungradeable"].includes(rec.verdict)
  );
}

function blockedValueLines(skips: GradedSkipInput[]): BlockedValueLine[] {
  const byGate = new Map<string, SkipCounterfactual[]>();
  for (const s of skips) {
    if (!s || typeof s.gate_failed !== "string" || !isSkipCounterfactual(s.counterfactual)) continue;
    byGate.set(s.gate_failed, [...(byGate.get(s.gate_failed) ?? []), s.counterfactual]);
  }
  return Array.from(byGate.entries())
    .map(([gate, cfs]) => {
      const graded = cfs.filter((c) => c.verdict !== "ungradeable");
      const won = graded.filter((c) => c.verdict === "would_have_won").length;
      const ungradeableCfs = cfs.filter((c) => c.verdict === "ungradeable");
      const reasonCounts = new Map<string, number>();
      for (const c of ungradeableCfs) {
        const r = c.reason ?? "(no reason recorded)";
        reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      }
      return {
        gate_failed: gate,
        n: graded.length,
        ungradeable: cfs.length - graded.length,
        would_have_won: won,
        would_have_won_rate_pct: graded.length > 0 ? round1((won / graded.length) * 100) : null,
        by_basis: {
          premium: graded.filter((c) => c.basis === "premium").length,
          underlying: graded.filter((c) => c.basis === "underlying").length,
        },
        low_n: graded.length < LOW_N_THRESHOLD,
        ungradeable_reasons: Array.from(reasonCounts.entries())
          .map(([reason, n]) => ({ reason, n }))
          .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
          .slice(0, UNGRADEABLE_REASON_CAP),
      };
    })
    // Most-material first (largest graded sample), name as the deterministic tiebreak.
    .sort((a, b) => b.n - a.n || a.gate_failed.localeCompare(b.gate_failed));
}

// ── Per-source Cortex false-veto analysis (Hardening WS-17) ─────────────────────────────────
// A Cortex veto is the ONLY unbounded hard-block in the stack (one loud opposing fact kills an
// entry — cortex-gate.ts). That asymmetry is precision-first BY DESIGN, but it means a mis-firing
// veto source silently forgoes winners with no ledger row to show for it. The skip-grading loop DOES
// grade those blocked candidates counterfactually (skip-grading.ts: would_have_won / would_have_lost),
// and each cortex-veto rejection carries its EXACT source in the rejection code (`cortex_veto:<source>`,
// stamped in cortex-gate.ts). Joining the two lets us estimate, PER SOURCE, the false-veto rate = the
// would-have-won share among that source's vetoed candidates. Attributing to the exact source (gex-walls
// vs flow-quality), not the aggregate "veto_blind", is the whole point: it says WHICH veto channel to
// re-tune. `cortex_veto_blind` (both veto sources dark — no attributable source) is kept as its own
// unattributable bucket, never folded into a real source.
//
// LIMITATION (honest, not fabricated): the current skip-grading fetch does not project the frozen
// strategy_config_hash onto graded skips, so the (source × hash) cross collapses the hash to "unknown"
// today. The keying is already (source × hash); the moment the projection carries the hash, real version
// splits appear here with no code change. We estimate the false-veto rate over the veto evidence that IS
// joinable — the counterfactual verdict already stored on each rejection — and never impute a hash.

/** Prefix on a per-source cortex-veto rejection code, e.g. "cortex_veto:gex-walls". */
const CORTEX_VETO_PREFIX = "cortex_veto:";
/** The unattributable veto-blind rejection code (both veto-capable sources failed to read). */
const CORTEX_VETO_BLIND_CODE = "cortex_veto_blind";
/** Sentinel used when the frozen strategy hash is not projected onto the graded skip (see LIMITATION). */
const UNKNOWN_STRATEGY_HASH = "unknown";

/** The cortex source a rejection code attributes to, or null when the code is not a cortex veto.
 *  "cortex_veto:<source>" → "<source>"; "cortex_veto_blind" → "veto_blind" (unattributable). */
export function cortexVetoSourceOf(gateFailed: string): string | null {
  if (gateFailed === CORTEX_VETO_BLIND_CODE) return "veto_blind";
  if (gateFailed.startsWith(CORTEX_VETO_PREFIX)) {
    const src = gateFailed.slice(CORTEX_VETO_PREFIX.length).trim();
    return src.length > 0 ? src : "veto_blind";
  }
  return null;
}

export type CortexVetoCell = {
  /** The EXACT cortex source (e.g. "gex-walls", "flow-quality"), or "veto_blind" for the
   *  unattributable both-sources-dark firewall block. */
  source: string;
  /** The frozen strategy_config_hash the vetoes were cast under, or "unknown" until skip-grading
   *  projects it (see the module LIMITATION note). */
  strategy_config_hash: string;
  /** Gradeable vetoed candidates (counterfactual verdict != ungradeable). */
  veto_count: number;
  ungradeable: number;
  /** Vetoed candidates that would_have_won — the false-veto numerator. */
  would_have_won: number;
  /** Estimated FALSE-VETO rate = would_have_won / veto_count, percentage points. A HIGH value means
   *  this source is vetoing plays that would have paid — the signal to re-tune it. Null when veto_count=0. */
  would_have_won_rate_pct: number | null;
  /** Wilson 95% CI on the false-veto rate (percentage points) — a 3/4 false-veto rate at n=4 is not the
   *  same evidence as 30/40; the CI keeps a tiny sample from reading as a verdict. Null when veto_count=0. */
  would_have_won_ci_pct: { lo: number; hi: number; mid: number } | null;
  low_n: boolean;
};

export type CortexVetoAnalysis = {
  cells: CortexVetoCell[];
  /** The joinability limitation, verbatim, so a report consumer never mistakes the collapsed hash for a
   *  real single-version population. */
  note: string;
  /** Total cortex-veto rejections seen (gradeable + ungradeable), across all sources. */
  total_veto_rejections: number;
};

/**
 * Per (cortex_source × strategy_config_hash) false-veto analysis over graded rejection rows whose block
 * was a cortex veto. Pure and deterministic; LOW-N discipline identical to blockedValueLines (ungradeable
 * counterfactuals are counted separately and excluded from the rate, never imputed). Non-gating evidence.
 */
export function analyzeCortexVetoes(skips: GradedSkipInput[]): CortexVetoAnalysis {
  const byCell = new Map<string, { source: string; hash: string; cfs: SkipCounterfactual[] }>();
  let totalVeto = 0;
  for (const s of skips) {
    if (!s || typeof s.gate_failed !== "string") continue;
    const source = cortexVetoSourceOf(s.gate_failed);
    if (source == null) continue; // not a cortex veto — belongs to blockedValueLines, not here
    if (!isSkipCounterfactual(s.counterfactual)) continue;
    totalVeto += 1;
    const hash = s.strategy_config_hash != null && s.strategy_config_hash.length > 0 ? s.strategy_config_hash : UNKNOWN_STRATEGY_HASH;
    const key = `${source} ${hash}`;
    const entry = byCell.get(key) ?? { source, hash, cfs: [] };
    entry.cfs.push(s.counterfactual);
    byCell.set(key, entry);
  }
  const cells: CortexVetoCell[] = Array.from(byCell.values())
    .map(({ source, hash, cfs }) => {
      const graded = cfs.filter((c) => c.verdict !== "ungradeable");
      const won = graded.filter((c) => c.verdict === "would_have_won").length;
      const ci = wilsonInterval(won, graded.length);
      return {
        source,
        strategy_config_hash: hash,
        veto_count: graded.length,
        ungradeable: cfs.length - graded.length,
        would_have_won: won,
        would_have_won_rate_pct: graded.length > 0 ? round1((won / graded.length) * 100) : null,
        would_have_won_ci_pct:
          ci.mid == null ? null : { lo: round1(ci.lo * 100), hi: round1(ci.hi * 100), mid: round1(ci.mid * 100) },
        low_n: graded.length < LOW_N_THRESHOLD,
      };
    })
    // Worst offenders first: highest false-veto count, then source name as the deterministic tiebreak.
    .sort((a, b) => b.would_have_won - a.would_have_won || b.veto_count - a.veto_count || a.source.localeCompare(b.source));
  return {
    cells,
    total_veto_rejections: totalVeto,
    note:
      "False-veto rate = would_have_won / vetoed-and-gradeable, attributed to the EXACT cortex source " +
      "(cortex_veto:<source>); cortex_veto_blind is the unattributable both-sources-dark bucket. " +
      "strategy_config_hash collapses to \"unknown\" until skip-grading projects the frozen hash onto graded " +
      "skips — the (source × hash) keying is already in place and needs no change here when it does.",
  };
}

/**
 * The pure analyzer. `rows` = ledger rows for the window (graded or not — ungraded
 * rows are counted but never bucketed); `gradedSkips` = rejection rows that already
 * carry a counterfactual verdict (skip-grading.ts). Deterministic: no clock, no IO.
 */
export function analyzeGateCalibration(input: {
  rows: CalibrationPlayRow[];
  gradedSkips?: GradedSkipInput[];
  window: { since: string; through: string; days: number };
  /** EXPLICIT opt-in (design Q12) to blend graded plays ACROSS strategy versions into
   *  one population. Default false → the bands are computed over the homogeneous cohort
   *  (current-hash + legacy rows; a different KNOWN hash is excluded). Cross-version
   *  aggregation is never automatic. */
  crossVersion?: boolean;
}): CalibrationReport {
  const allGraded = input.rows.filter(isGradedZeroDteRow);
  // Strategy-version homogeneity: partition the graded population by frozen config hash
  // and, by default, analyze the current-hash + legacy cohort so a REAL version bump
  // can't blend a different-known-version population into one band. `graded` below is the
  // chosen cohort; every downstream band/gate/signal reads it, so they all inherit the
  // same homogeneous (or, with crossVersion, explicitly blended) population.
  const { analysis: graded, summary: versionCohort } = partitionByVersion(
    allGraded,
    currentStrategyConfigHash(),
    input.crossVersion === true
  );

  // Score bands: ALL five bands always present (n=0 buckets included) so the
  // machine-readable shape is stable regardless of what the window contained.
  const bandRows = new Map<string, CalibrationPlayRow[]>(CALIBRATION_SCORE_BANDS.map((b) => [b, []]));
  for (const r of graded) {
    bandRows.get(calibrationScoreBand(scoreForBanding(r)))!.push(r);
  }
  const scoreBands = CALIBRATION_SCORE_BANDS.map((b) => bucketOf(b, bandRows.get(b)!));

  return {
    methodology: ZERODTE_CALIBRATION_METHODOLOGY,
    window: input.window,
    total_rows: input.rows.length,
    graded_plays: graded.length,
    gates: [recommendGate("g4_vix", graded), recommendGate("g6_conflict", graded)],
    score_bands: scoreBands,
    score_floor: {
      current: ZERODTE_SCORE_FLOOR,
      note:
        "Evidence only — G-3's floor is never auto-moved by this report. Banded per-play so the " +
        "F-2 cut (55-64 = 18.8% WR, below the 33% breakeven) stays continuously re-measurable, and " +
        "split 75-84 vs 85+ so the F-5 top-band inversion is visible if it persists.",
    },
    blocked_value: blockedValueLines(input.gradedSkips ?? []),
    // Retro-tiered off each row's pinned entry_context — measurable from day one,
    // no tier column or backfill required (PR-F; stamping is the follow-up PR).
    tier_record: analyzeTierRecord(graded),
    // Calibration-first evidence loop for the two board signals (accumulation + confluence): both are
    // pinned in entry_context and bucketed here so the ledger decides whether either graduates.
    accumulation_alignment: analyzeAccumulationAlignment(graded),
    confluence_tiers: analyzeConfluenceTiers(graded),
    origin_bands: analyzeOriginBands(graded),
    play_type_bands: analyzePlayTypeBands(graded),
    // Crossed (origin × play_type) cohorts with Wilson CIs + forward holdout + recommend-only production
    // verdict (WS-07/09) — the interaction a marginal band can't show. Reads the same homogeneous cohort.
    origin_playtype_bands: analyzeOriginPlayTypeBands(graded),
    // Per-source Cortex false-veto analysis (WS-17) over the graded rejection rows — attributed to the
    // EXACT veto source. Runs on the skips (rejections), independent of the graded-play cohort above.
    cortex_veto_analysis: analyzeCortexVetoes(input.gradedSkips ?? []),
    signal_recommendations: [recommendConfluence(graded), recommendAccumulation(graded)],
    scale_out_recommendation: recommendScaleOut(graded),
    version_cohort: versionCohort,
    available: graded.length > 0,
  };
}

// ── Thin data layer ──────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in ET for an epoch-ms instant (same Intl idiom as entry-context.ts's
 *  formatEtStamp — local 3-liner rather than an import that would widen this
 *  module's graph to the nighthawk feature layer). */
function etYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
// Same row budget rationale as the record route: the ledger caps out well under 15
// committed rows/session, so days*20 comfortably covers the window without an
// unbounded fetch.
const MAX_LEDGER_ROWS = 2000;

/**
 * Fetch + analyze. `nowMs` is a parameter (no Date.now() inside the lib — the route
 * supplies the clock). Fail-soft end to end: a DB/provider failure degrades to an
 * empty-input report (available:false), never a throw into the route.
 *
 * Dynamic RELATIVE imports keep this module's static graph pure (tests of the
 * analyzer never load pg/providers) — and CI's tsx ESM loader cannot resolve "@/"
 * aliases in dynamic import positions, so these MUST stay relative.
 */
export async function buildZeroDteCalibrationReport(opts: {
  days?: number;
  nowMs: number;
}): Promise<CalibrationReport> {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const through = etYmd(opts.nowMs);
  const since = etYmd(opts.nowMs - days * 24 * 60 * 60 * 1000);

  let rows: CalibrationPlayRow[] = [];
  let gradedSkips: GradedSkipInput[] = [];
  try {
    const db = await import("../db");
    if (db.dbConfigured()) {
      rows = await db.fetchZeroDteSetupLogRange(since, Math.min(MAX_LEDGER_ROWS, days * 20));
    }
  } catch {
    // Ledger unreadable — report over empty input (available:false), never a throw.
  }
  try {
    const skipMod = await import("./skip-grading");
    gradedSkips = await skipMod.fetchGradedSkips({ sinceYmd: since, throughYmd: through });
  } catch {
    // Skip grades unreadable — the gate buckets still stand on their own.
  }

  return analyzeGateCalibration({ rows, gradedSkips, window: { since, through, days } });
}
