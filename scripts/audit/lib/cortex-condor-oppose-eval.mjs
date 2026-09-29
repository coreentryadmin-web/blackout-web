// Pure JS mirror of the Cortex constants + evidence shapes cortex-condor-oppose-measure.mjs
// classifies against — the same "copy, not a re-export, so a plain .mjs script avoids TS
// path-aliased imports" convention every other scripts/audit/lib/*.mjs helper here follows
// (see print-window-eval.mjs's own header for the precedent). Keep these in lockstep with the
// real sources named on each constant/function below — if the real value or detail-string
// changes, this mirror goes stale silently (the classification would then match nothing, which
// is a wrong-but-quiet failure mode, not a crash) — that risk is exactly why every constant below
// cites its exact source file/line, so a future diff of those files is the trigger to re-check.
//
// WHY THIS EXISTS (2026-09-17, Night Hawk 0DTE architecture deep-dive). scan.ts calls
// evaluateCortexForCommit(ticker, direction, ...) UNCONDITIONALLY for every gate-surviving setup,
// CONDOR included — passing the condor's nominal `direction` (condor.ts's own doc: "carries the
// pin's nominal fade side for provenance but is UNUSED by the neutral structure's gates/grader").
// gex-walls.ts's own file header states an assumption that is FALSE for a condor: "Every 0DTE
// Command commit is momentum-style by construction... so posture 'long' opposes any direction" —
// and its deriveGexWallsEvidence has an unconditional `if (gex.regimePosture === "long")` oppose
// (REGIME_STYLE_OPPOSE_WEIGHT) that fires in exactly the long-gamma/mean-reverting regime a
// condor is ONLY EVER sold in (condorSellRegime's own gate). This measures how often that fires
// on REAL committed condor rows, and whether it's material enough to matter — not a fix, not a
// hunch: evidence first, per this repo's own "measure before guessing" discipline
// (docs/audit/INTENTIONAL-DESIGN.md).

/** compose.ts:50 — conviction band floor for "A". */
export const CONVICTION_A_MIN_SCORE = 2;
/** compose.ts:55 — conviction band floor for "B" (below this is "C"). */
export const CONVICTION_B_MIN_SCORE = 0.75;
/** cortex-gate.ts:98 — the floor an active gex-walls oppose must clear to be "presence"-material
 *  for the OPPOSE_UNRESOLVED decision path. */
export const GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT = 0.2;
/** cortex-gate.ts:81 — THIN_EVIDENCE decision requires fewer than this many real sources. */
export const THIN_EVIDENCE_MIN_SOURCES = 2;
/** cortex-gate.ts:84 — THIN_EVIDENCE decision also requires the score under this floor. */
export const THIN_EVIDENCE_SCORE_FLOOR = 0.5;
/** gex-walls.ts:40 — the regime-style-mismatch oppose weight (BEFORE decay/caps — the persisted
 *  entry_context.cortex item carries the DECAYED effective weight, which this tool reads directly
 *  rather than re-deriving, so it never needs this constant for arithmetic — kept here only as
 *  the documented reference value for the write-up). */
export const REGIME_STYLE_OPPOSE_WEIGHT = 0.6;

/** The exact detail-string fragment gex-walls.ts:134 stamps on ITS regime-style oppose item —
 *  distinguishes it from a wallPathCheck oppose/veto (which uses a different detail template:
 *  "{direction} target path crosses dominant..."). Matching on this substring is how this tool
 *  tells the two gex-walls evidence shapes apart without re-deriving the wall geometry itself. */
const REGIME_OPPOSE_DETAIL_MARK = "mean-reversion regime opposes trend-following entries";

/** True for the SPECIFIC gex-walls evidence item that is the regime-style-mismatch oppose (the
 *  one this whole investigation is about) — never the wallPathCheck oppose/veto, which has a
 *  different detail template and is classified separately below. */
export function isRegimeStyleOppose(item) {
  return (
    !!item &&
    item.source === "gex-walls" &&
    item.stance === "opposes" &&
    typeof item.detail === "string" &&
    item.detail.includes(REGIME_OPPOSE_DETAIL_MARK)
  );
}

/** True for a gex-walls VETO (wallPathCheck's blockingWall path) — a hard block, so this should
 *  never appear on a row that actually committed (a veto blocks the commit outright); if it ever
 *  does, that is itself a finding (a relief mechanism or a wiring gap let a vetoed row through). */
export function isWallPathVeto(item) {
  return !!item && item.source === "gex-walls" && item.stance === "veto";
}

/** True for a REAL (non-zero-weight) gex-walls wallPathCheck SUPPORT — excludes the "no dominant
 *  wall... regime style compatible" filler item deriveGexWallsEvidence emits when neither the
 *  block nor the support path fired (that filler is `stance:"supports", weight:0`, structurally
 *  distinct from a genuine same-side-wall support). */
export function isWallPathSupport(item) {
  return !!item && item.source === "gex-walls" && item.stance === "supports" && (item.weight ?? 0) > 0;
}

/** compose.ts's own banding (mirrored verbatim, catalyst-news upgrade / veto floor NOT modeled —
 *  see the tool's own header disclosure): score>=A floor -> "A", score>=B floor -> "B", else "C". */
export function convictionBandFor(score) {
  if (score >= CONVICTION_A_MIN_SCORE) return "A";
  if (score >= CONVICTION_B_MIN_SCORE) return "B";
  return "C";
}

/**
 * Classify one committed condor row's persisted `entry_context.cortex` blob against the
 * regime-style-oppose / wallPathCheck questions. `cortex` is the raw pinned blob (or null/absent
 * for an ABSTAIN/pre-wiring row). Pure; never fetches, never fabricates a fact the blob doesn't
 * carry. Returns null when there is nothing to classify (no cortex blob, or abstained).
 */
export function classifyCondorCortexRow(cortex) {
  if (!cortex || typeof cortex !== "object" || cortex.abstained) return null;
  const opposes = Array.isArray(cortex.opposes) ? cortex.opposes : [];
  const supports = Array.isArray(cortex.supports) ? cortex.supports : [];
  const vetoes = Array.isArray(cortex.vetoes) ? cortex.vetoes : [];
  const score = typeof cortex.score === "number" ? cortex.score : null;

  const regimeOppose = opposes.find(isRegimeStyleOppose) ?? null;
  const wallVeto = [...vetoes, ...opposes].find(isWallPathVeto) ?? null; // veto is its own array; defensive union
  const wallSupport = supports.find(isWallPathSupport) ?? null;

  const scoreWithoutRegimeOppose = score != null && regimeOppose ? Math.round((score + regimeOppose.weight) * 100) / 100 : score;
  const actualBand = score != null ? convictionBandFor(score) : null;
  const counterfactualBand = scoreWithoutRegimeOppose != null ? convictionBandFor(scoreWithoutRegimeOppose) : null;
  const bandSuppressed = actualBand != null && counterfactualBand != null && actualBand !== counterfactualBand;

  const regimeOpposeMaterial =
    regimeOppose != null && regimeOppose.weight >= GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT;

  return {
    has_regime_oppose: regimeOppose != null,
    regime_oppose_weight: regimeOppose?.weight ?? null,
    regime_oppose_material: regimeOpposeMaterial,
    has_wall_path_veto: wallVeto != null,
    has_wall_path_support: wallSupport != null,
    wall_path_support_weight: wallSupport?.weight ?? null,
    score,
    score_without_regime_oppose: scoreWithoutRegimeOppose,
    conviction_band: actualBand,
    counterfactual_band_without_regime_oppose: counterfactualBand,
    band_suppressed_by_regime_oppose: bandSuppressed,
    decision: typeof cortex.decision === "string" ? cortex.decision : null,
  };
}
