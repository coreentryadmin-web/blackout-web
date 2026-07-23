/**
 * COMPOSITE CONFIDENCE — one scalar, not three knobs (design-review #6 + #7 + #9, unified).
 *
 * The review asked for regime confidence, a data-quality score, and time-aware calibration separately. But
 * three independent confidence signals that don't compose is how you get contradictory sizing — a 0.9 regime
 * read on a stale feed shouldn't size like a 0.9 read on clean data. So they collapse into ONE multiplier
 * that scales EV and position size:
 *
 *   confidence = geomean(present sub-confidences) × completeness
 *     · regime      — how DECISIVELY the day was classified (a marginal trend call ≠ a textbook one)
 *     · dataQuality — how trustworthy the INPUTS were (feed freshness / missing sources)
 *     · calibration — how FRESH + sufficient the calibration behind the score is
 *
 * Geometric mean (not arithmetic) so the weakest input drags the whole — "all must hold", the honest model
 * for confidence — without the harshness of a raw product. Missing sub-signals don't get a free pass: they're
 * excluded from the mean AND apply a completeness discount, so "we couldn't even assess data quality" LOWERS
 * confidence rather than silently assuming everything is fine (the exact trap the review flagged).
 *
 * The output multiplier is meant to scale EV / size, NOT the raw evidence score — a low-confidence day should
 * take smaller, fewer trades, not have its signal quietly rewritten. PURE & deterministic.
 */

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

export interface CompositeConfidenceInput {
  /** 0–1: how decisively the regime was classified. Null = not assessed. */
  regimeConfidence?: number | null;
  /** 0–1: input trustworthiness (see dataQualityScore). Null = not assessed. */
  dataQuality?: number | null;
  /** 0–1: freshness + sufficiency of the calibration behind the score. Null = not assessed. */
  calibrationFreshness?: number | null;
}

export interface CompositeConfidence {
  /** 0–1 composite — the multiplier for EV / size. */
  score: number;
  tier: ConfidenceTier;
  /** How many of the three sub-signals were actually assessed (drives the completeness discount). */
  assessed: number;
  /** The sub-values that were present (for the explainability trace). */
  components: { regime: number | null; dataQuality: number | null; calibration: number | null };
  /** Suggested position-size multiplier (== score; separated so a future non-linear map can slot in). */
  sizeMultiplier: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const val = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? clamp01(n) : null;

/** Completeness discount: fewer assessed sub-signals ⇒ we know less ⇒ trim confidence (never a free pass). */
const COMPLETENESS = [0.0, 0.8, 0.9, 1.0]; // index = # assessed (0..3)

function tierOf(score: number): ConfidenceTier {
  if (score >= 0.8) return "HIGH";
  if (score >= 0.6) return "MEDIUM";
  if (score >= 0.4) return "LOW";
  return "VERY_LOW";
}

/** Combine the three sub-confidences into one scalar (geometric mean of the present ones × completeness). */
export function compositeConfidence(input: CompositeConfidenceInput): CompositeConfidence {
  const regime = val(input.regimeConfidence);
  const dataQuality = val(input.dataQuality);
  const calibration = val(input.calibrationFreshness);
  const present = [regime, dataQuality, calibration].filter((n): n is number => n != null);

  let score: number;
  if (present.length === 0) {
    // Nothing assessed → we genuinely don't know. A conservative VERY_LOW floor (not a confident 1.0),
    // which forces an explicit assessment upstream rather than sizing off a silent assumption.
    score = 0.35;
  } else {
    const geomean = Math.exp(present.reduce((s, n) => s + Math.log(Math.max(n, 1e-6)), 0) / present.length);
    score = geomean * COMPLETENESS[present.length]!;
  }
  score = Math.round(clamp01(score) * 1000) / 1000;

  return {
    score,
    tier: tierOf(score),
    assessed: present.length,
    components: { regime, dataQuality, calibration },
    sizeMultiplier: score,
  };
}

// ── data-quality sub-score (review #7) ──────────────────────────────────────────────

export type FeedStatus = "ok" | "delayed" | "stale" | "unavailable";

/** Default health per status. `ok` = live/fresh; `delayed` = usable but lagging; `stale` = old; gone = 0. */
const STATUS_HEALTH: Record<FeedStatus, number> = { ok: 1.0, delayed: 0.6, stale: 0.3, unavailable: 0.0 };

export interface FeedHealth {
  name: string;
  /** Status → default health, unless `health` overrides it explicitly (e.g. a measured 0.98). */
  status?: FeedStatus;
  health?: number | null;
  /** Relative importance of this feed to the decision (default 1). A missing dark-pool feed on a flow-led
   *  0DTE trade should hurt more than delayed news. */
  weight?: number;
}

/**
 * Weighted data-quality composite from per-feed health — the review's "Flow 98% · Polygon 100% · Dark Pool
 * unavailable · News delayed → 87%". A missing critical feed drags it down instead of the engine silently
 * assuming everything is fine. Returns null when there's nothing to assess (so it stays "not assessed", not a
 * fake 1.0).
 */
export function dataQualityScore(feeds: FeedHealth[]): number | null {
  let wsum = 0;
  let hsum = 0;
  for (const f of feeds) {
    const w = f.weight != null && Number.isFinite(f.weight) && f.weight >= 0 ? f.weight : 1;
    const h =
      f.health != null && Number.isFinite(f.health)
        ? clamp01(f.health)
        : f.status
          ? STATUS_HEALTH[f.status]
          : null;
    if (h == null || w === 0) continue;
    wsum += w;
    hsum += w * h;
  }
  return wsum > 0 ? Math.round((hsum / wsum) * 1000) / 1000 : null;
}
