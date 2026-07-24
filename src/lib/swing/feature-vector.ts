// src/lib/swing/feature-vector.ts — the LONGITUDINAL swing feature vector (PR-14). Pure. Evidence-only.
//
// WHY A DISTINCT SWING VECTOR (not the 0DTE one): a 0DTE setup is a single same-day snapshot — one
// SetupFeatureVector pinned at commit is the whole story. A swing thesis LIVES ACROSS SESSIONS, so its
// feature row is not a single stamp: it is RECOMPUTED PER SNAPSHOT (commit, every EOD, every management
// tick), so the intelligence layer can learn from the TRAJECTORY — "the thesis that stalled two sessions
// then died" vs "the one that kept making highs". Each row therefore carries BOTH the static thesis part
// (archetype/sub-lane one-hot, the 7 pillar scores, evidence score — pinned at commit, echoed on every
// snapshot so a row is self-describing) AND the dynamic longitudinal part (dte_remaining, running MFE/MAE,
// option mark/return, thesis_state, snapshot index) which changes every recompute. Joined to the graded
// outcome and stacked over a position's snapshot series, it is what the trajectory studies in
// feature-store.ts read.
//
// SAME DISCIPLINE AS zerodte/feature-vector.ts (deliberately mirrored, distinct schema): flat (maps
// straight to JSONB + to a positional numeric vector for distance/binning), versioned (`v`) so the schema
// can evolve without orphaning old graded rows, and NULL-SAFE — a missing feed is `null` via `numOrNull`,
// NEVER a fabricated 0. A null feature is honest; a 0 is a lie that a downstream standardizer reads as a
// real value. `numOrNull` is module-private in zerodte/feature-vector.ts, so it is replicated here rather
// than imported.
//
// PURE & deterministic — no IO. The DB column + the snapshot-write hook that persists this live in the
// (HELD) ledger PRs; this slice only defines and builds the vector, unit-tested in isolation.

import type { SwingPillarSignals } from "./swing-pillars";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";

/** Bump when the vector's shape changes so old graded/snapshot rows stay interpretable. */
export const SWING_FEATURE_VECTOR_VERSION = 1;

/** Replicated (zerodte/feature-vector.ts keeps its copy private): null unless a real finite number. */
const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

/** One-hot cell: null when the category is unknown (never a fabricated 0 that reads as "definitely not"). */
const oneHot = <T>(value: T | null | undefined, member: T): 0 | 1 | null =>
  value == null ? null : value === member ? 1 : 0;

export interface SwingFeatureInputs {
  ticker: string;
  /** Position direction; null when the name isn't a directional swing. */
  direction?: "long" | "short" | null;
  // ── static thesis part (pinned at commit, echoed on every snapshot) ──
  archetype?: SwingArchetype | null;
  // ── full classification metadata (captured for later mis/secondary-classification analysis) ──
  // Only `archetype` (the PRIMARY) is authoritative — it is what scoring/gating/calibration partition on.
  // These three are METADATA ONLY: no downstream bucketing/graduation reads them (see calibration.ts, which
  // keys off `archetype`). We persist them so a later study can see the runners-up and how close the call was,
  // instead of throwing that away the moment the winner is picked. `classificationMetaFromVerdict` (archetype.ts)
  // produces them from the classifier's verdict.
  /** Ranked secondary archetypes (runners-up), primary excluded. */
  archetypeSecondary?: SwingArchetype[] | null;
  /** Per-archetype fit-score map (grounded fits only). */
  archetypeScores?: Record<string, number> | null;
  /** Classification decisiveness margin (topFit − runner-up fit). */
  classificationMargin?: number | null;
  subLane?: SwingSubLane | null;
  /** Dossier composite evidence score (0–100). */
  evidenceScore?: number | null;
  /** The 7 pillar sub-scores (0–1 each); a missing pillar stays null, never 0. */
  pillars?: SwingPillarSignals | null;
  /** How many of the 7 pillars were grounded. */
  presentPillars?: number | null;
  /** Dossier data-quality degraded flag. */
  dataQualityDegraded?: boolean | null;
  /**
   * UW implied-vol rank (0–100) for the name at commit. EOD data (UW recomputes once/session), so it
   * is fetched via the now-cached fetchUwIvRank at the persist call site — NOT recomputed per snapshot.
   * CAPTURE-ONLY metadata (like the archetype secondary fields): it feeds the feature row for later
   * study but is NOT bucketed by calibration/graduation. Honest-null when the feed is missing — never 0.
   *
   * TODO(swing-ledger persist hook): this vector is not yet invoked by any production persist path (the
   * snapshot-write hook lives in the HELD ledger PRs — see the module header). When that hook lands, pass
   * the swing dossier's already-resolved IV rank here — `resolveIvRank` in features/nighthawk/lib/dossier.ts
   * already computes it (Polygon VIX percentile for index proxies, the now-cached fetchUwIvRank for single
   * names), so the wiring is a single null-safe field pass, no new UW IO on the vector-build path.
   */
  ivRank?: number | null;
  // ── dynamic longitudinal part (recomputed every snapshot) ──
  /** Calendar DTE left on the contract at this snapshot. */
  dteRemaining?: number | null;
  /** Running max favorable / adverse underlying excursion so far (%, signed: MFE ≥ 0, MAE ≤ 0). */
  runningMfe?: number | null;
  runningMae?: number | null;
  /** Underlying + option marks at this snapshot. */
  underlyingPx?: number | null;
  optionMark?: number | null;
  /** Entry option premium — for the running option return; null when unknown (return then null). */
  entryPremium?: number | null;
  /** Management state-machine thesis read at this snapshot ("intact"/"warn"/"break"/…). */
  thesisState?: string | null;
  /** Which recompute produced this row ("commit"/"eod"/"tick"/"event"/…). */
  snapshotKind?: string | null;
  /** 0-based index of this snapshot in the position's ordered series. */
  snapshotSeq?: number | null;
  /** Distinct session days elapsed since commit. */
  sessionsElapsed?: number | null;
}

/** The flat, versioned longitudinal feature row. Numeric where possible; small categorical strings otherwise. */
export interface SwingFeatureVector {
  v: number;
  // identity / context
  ticker: string;
  side: "long" | "short" | null;
  archetype: string | null;
  // full classification metadata — PURE CAPTURE for later analysis. Calibration keys off `archetype`/`primary`
  // ONLY; secondary/scores/margin are never bucketed on (asserted in calibration.test.ts). Deliberately NOT in
  // SWING_NUMERIC_FEATURE_KEYS / SWING_CATEGORICAL_FEATURE_KEYS — a ranked list + a variable-key map aren't
  // standardizable scalar features; they ride the JSONB feature-vector blob as metadata only.
  /** The primary archetype — mirrors `archetype`; the authoritative label calibration partitions on. */
  primary: string | null;
  /** Ranked secondary archetypes (runners-up), primary excluded; [] when none grounded. */
  secondary: string[];
  /** Per-archetype fit-score map (grounded fits only); {} when nothing was classifiable. */
  archetype_scores: Record<string, number>;
  /** Classification decisiveness margin (topFit − runner-up fit); null when unknown. */
  classification_margin: number | null;
  sub_lane: string | null;
  // archetype one-hot (null throughout when archetype unknown)
  arch_breakout: 0 | 1 | null;
  arch_pullback_continuation: 0 | 1 | null;
  arch_mean_reversion: 0 | 1 | null;
  arch_failed_breakdown: 0 | 1 | null;
  arch_post_earnings_drift: 0 | 1 | null;
  arch_flow_accumulation: 0 | 1 | null;
  arch_sector_rotation: 0 | 1 | null;
  arch_event_driven: 0 | 1 | null;
  // sub-lane one-hot (null throughout when sub-lane unknown)
  lane_tactical: 0 | 1 | null;
  lane_standard: 0 | 1 | null;
  lane_extended: 0 | 1 | null;
  // static thesis evidence
  evidence_score: number | null;
  present_pillars: number | null;
  dq_degraded: 0 | 1 | null;
  /** UW IV rank (0–100) at commit; EOD-cadence, honest-null when unavailable. Capture-only (not gated). */
  iv_rank: number | null;
  // pillar sub-scores (0–1; null when the pillar wasn't grounded)
  pil_structure: number | null;
  pil_rel_strength: number | null;
  pil_flow: number | null;
  pil_volatility: number | null;
  pil_catalyst: number | null;
  pil_regime: number | null;
  pil_data_quality: number | null;
  // dynamic longitudinal
  dte_remaining: number | null;
  running_mfe: number | null;
  running_mae: number | null;
  underlying_px: number | null;
  option_mark: number | null;
  /** (option_mark / entryPremium − 1) × 100; null unless both marks are real (never a fabricated 0). */
  option_return_pct: number | null;
  snapshot_seq: number | null;
  sessions_elapsed: number | null;
  thesis_state: string | null;
  snapshot_kind: string | null;
}

/**
 * Build the flat, versioned longitudinal row from the static thesis part + one snapshot's dynamic part.
 * Called ONCE PER SNAPSHOT — the caller passes the pinned thesis fields (unchanged across the series) plus
 * the per-snapshot dynamic reads, so each persisted row is self-describing and the trajectory studies can
 * reconstruct the arc from the stacked rows. Every optional feed collapses to null, never 0.
 */
export function buildSwingFeatureVector(input: SwingFeatureInputs): SwingFeatureVector {
  const arch = input.archetype ?? null;
  const lane = input.subLane ?? null;
  const p = input.pillars ?? null;
  const entry = numOrNull(input.entryPremium);
  const mark = numOrNull(input.optionMark);
  const optionReturnPct =
    entry != null && entry > 0 && mark != null ? (mark / entry - 1) * 100 : null;

  return {
    v: SWING_FEATURE_VECTOR_VERSION,
    ticker: input.ticker.toUpperCase(),
    side: input.direction ?? null,
    archetype: arch,
    // full classification metadata: `primary` mirrors `archetype` (the calibration key); secondary/scores/margin
    // are captured verbatim for later mis-classification study and are NOT read by any bucketing/graduation path.
    primary: arch,
    secondary: input.archetypeSecondary ?? [],
    archetype_scores: input.archetypeScores ?? {},
    classification_margin: numOrNull(input.classificationMargin),
    sub_lane: lane,
    // archetype one-hot
    arch_breakout: oneHot(arch, "BREAKOUT"),
    arch_pullback_continuation: oneHot(arch, "PULLBACK_CONTINUATION"),
    arch_mean_reversion: oneHot(arch, "MEAN_REVERSION"),
    arch_failed_breakdown: oneHot(arch, "FAILED_BREAKDOWN"),
    arch_post_earnings_drift: oneHot(arch, "POST_EARNINGS_DRIFT"),
    arch_flow_accumulation: oneHot(arch, "FLOW_ACCUMULATION"),
    arch_sector_rotation: oneHot(arch, "SECTOR_ROTATION"),
    arch_event_driven: oneHot(arch, "EVENT_DRIVEN"),
    // sub-lane one-hot
    lane_tactical: oneHot(lane, "TACTICAL"),
    lane_standard: oneHot(lane, "STANDARD"),
    lane_extended: oneHot(lane, "EXTENDED"),
    // static thesis evidence
    evidence_score: numOrNull(input.evidenceScore),
    present_pillars: numOrNull(input.presentPillars),
    dq_degraded: input.dataQualityDegraded == null ? null : input.dataQualityDegraded ? 1 : 0,
    // EOD IV rank captured from the (now-cached) UW feed at the persist call site; honest-null, not gated.
    iv_rank: numOrNull(input.ivRank),
    // pillar sub-scores — null throughout when a pillar wasn't grounded, never a fabricated 0
    pil_structure: numOrNull(p?.STRUCTURE),
    pil_rel_strength: numOrNull(p?.REL_STRENGTH),
    pil_flow: numOrNull(p?.FLOW),
    pil_volatility: numOrNull(p?.VOLATILITY),
    pil_catalyst: numOrNull(p?.CATALYST),
    pil_regime: numOrNull(p?.REGIME),
    pil_data_quality: numOrNull(p?.DATA_QUALITY),
    // dynamic longitudinal
    dte_remaining: numOrNull(input.dteRemaining),
    running_mfe: numOrNull(input.runningMfe),
    running_mae: numOrNull(input.runningMae),
    underlying_px: numOrNull(input.underlyingPx),
    option_mark: mark,
    option_return_pct: numOrNull(optionReturnPct),
    snapshot_seq: numOrNull(input.snapshotSeq),
    sessions_elapsed: numOrNull(input.sessionsElapsed),
    thesis_state: input.thesisState ?? null,
    snapshot_kind: input.snapshotKind ?? null,
  };
}

/**
 * The numeric feature keys — the columns the probability/similarity layers standardize + compare. Order is
 * stable so a downstream vector is positional. (Distance itself lives in the similarity slice, standardized
 * by these features' empirical distribution over the accumulated store — same note as the 0DTE module.)
 */
export const SWING_NUMERIC_FEATURE_KEYS = [
  "arch_breakout", "arch_pullback_continuation", "arch_mean_reversion", "arch_failed_breakdown",
  "arch_post_earnings_drift", "arch_flow_accumulation", "arch_sector_rotation", "arch_event_driven",
  "lane_tactical", "lane_standard", "lane_extended",
  "evidence_score", "present_pillars", "dq_degraded",
  "pil_structure", "pil_rel_strength", "pil_flow", "pil_volatility", "pil_catalyst", "pil_regime",
  "pil_data_quality",
  "dte_remaining", "running_mfe", "running_mae", "underlying_px", "option_mark", "option_return_pct",
  "snapshot_seq", "sessions_elapsed",
  // APPENDED at the END — this list is positional (a downstream vector reads it by index), so new keys
  // only ever go last; never reorder. iv_rank is captured feature metadata, standardizable as a scalar,
  // but NOT bucketed by calibration/graduation (honest-null when the EOD feed is missing).
  "iv_rank",
] as const satisfies ReadonlyArray<keyof SwingFeatureVector>;

/** The categorical feature keys — compared by exact match / one-hot in the downstream layers. */
export const SWING_CATEGORICAL_FEATURE_KEYS = [
  "side", "archetype", "sub_lane", "thesis_state", "snapshot_kind",
] as const satisfies ReadonlyArray<keyof SwingFeatureVector>;

/**
 * Raw numeric sub-vector in SWING_NUMERIC_FEATURE_KEYS order. Nulls (and any non-finite slip-through) become
 * `null` entries — NOT 0 — so a downstream standardizer skips a missing feature rather than treating it as a
 * real zero.
 */
export function numericVector(v: SwingFeatureVector): Array<number | null> {
  return SWING_NUMERIC_FEATURE_KEYS.map((k) => {
    const val = v[k];
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  });
}
