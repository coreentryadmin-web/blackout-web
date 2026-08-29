/**
 * HELIX score calibration — session-relative tier + percentile.
 *
 * The raw score (premium/1M×60 + sweep + 0DTE) is a notability heuristic, not a
 * validated directional rank (see helix-score-signal.mjs). This layer adds honest
 * session context: where this print sits vs today's tape, without inventing conviction.
 */
export type HelixScoreTier = "common" | "notable" | "rare";

export type HelixCalibrationStatus = "session" | "uncalibrated";

export type HelixScoreContext = {
  tier: HelixScoreTier;
  /** Session percentile (0–100). Higher = more notable vs today's tape. Null when uncalibrated. */
  percentile: number | null;
  calibrationStatus: HelixCalibrationStatus;
  sessionSampleSize: number;
};

export const HELIX_SCORE_CALIBRATION_MIN_SAMPLES = 8;

/** Sorted ascending scores for percentile lookup. */
export function helixScoreDistribution(scores: readonly number[]): number[] {
  return scores.filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
}

function tierFromPercentile(percentile: number): HelixScoreTier {
  if (percentile >= 90) return "rare";
  if (percentile >= 65) return "notable";
  return "common";
}

/** Heuristic tier when session sample is too thin — never fabricates a percentile. */
function tierFromAbsoluteScore(score: number): HelixScoreTier {
  if (score >= 85) return "rare";
  if (score >= 70) return "notable";
  return "common";
}

/**
 * Session percentile for one print's score. Uses mid-rank for ties so equal scores
 * share a band instead of jumping a full rank.
 */
export function helixScorePercentile(score: number, distribution: readonly number[]): number | null {
  if (!(score > 0) || distribution.length < HELIX_SCORE_CALIBRATION_MIN_SAMPLES) return null;
  const below = distribution.filter((s) => s < score).length;
  const equal = distribution.filter((s) => s === score).length;
  return Math.round(((below + equal * 0.5) / distribution.length) * 100);
}

export function helixScoreContextForPrint(
  score: number,
  distribution: readonly number[],
  minSamples = HELIX_SCORE_CALIBRATION_MIN_SAMPLES
): HelixScoreContext {
  const sample = distribution.filter((s) => s > 0);
  const percentile = helixScorePercentile(score, sample);
  if (percentile == null || sample.length < minSamples) {
    return {
      tier: tierFromAbsoluteScore(score),
      percentile: null,
      calibrationStatus: "uncalibrated",
      sessionSampleSize: sample.length,
    };
  }
  return {
    tier: tierFromPercentile(percentile),
    percentile,
    calibrationStatus: "session",
    sessionSampleSize: sample.length,
  };
}

export function helixScoreTierLabel(tier: HelixScoreTier): string {
  switch (tier) {
    case "rare":
      return "Rare";
    case "notable":
      return "Notable";
    default:
      return "Common";
  }
}

export function helixScoreTierTone(tier: HelixScoreTier): { text: string; border: string; bg: string } {
  switch (tier) {
    case "rare":
      return { text: "#facc15", border: "rgba(250,204,21,0.35)", bg: "rgba(250,204,21,0.08)" };
    case "notable":
      return { text: "#a3e635", border: "rgba(0,230,118,0.28)", bg: "rgba(0,230,118,0.06)" };
    default:
      return { text: "#7dd3fc", border: "rgba(125,211,252,0.2)", bg: "rgba(125,211,252,0.04)" };
  }
}

export function helixScoreContextHint(ctx: HelixScoreContext, score: number): string {
  const base =
    "Notability heuristic (size + sweep/0DTE flags). Not a validated directional rank.";
  if (ctx.calibrationStatus === "session" && ctx.percentile != null) {
    return `${base} Session: top ${100 - ctx.percentile}% (${helixScoreTierLabel(ctx.tier).toLowerCase()}, score ${score.toFixed(1)}, n=${ctx.sessionSampleSize}).`;
  }
  return `${base} Session sample too thin (n=${ctx.sessionSampleSize}) — tier from absolute score only.`;
}
