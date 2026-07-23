/**
 * 0DTE FLOW QUALITY ENGINE — a dedicated 0–100 read on the ONE thing that is the engine's primary
 * trigger: institutional options flow.
 *
 * The live engine already GATES on flow (gross ≥ $750k, aggression ≥ 0.30, dominance ≥ 0.65, ≤2% ITM).
 * Gates answer "is this flow real enough to look at?" — a binary. This answers the richer question the
 * gates can't: "HOW GOOD is this flow?" — on a continuous 0–100 scale, from signals the gates throw away.
 *
 * It reads, from the SAME print tape the aggregator already collects (premium, aggressor side, sweep
 * flag, strike, expiry, size, timestamp), the seven things that separate a real accumulation from a
 * single loud print:
 *   1. premiumDepth   — how much conviction capital ($ gross), log-scaled
 *   2. aggression     — at-the-ask share (paying up = conviction, not income harvesting)
 *   3. sweepIntensity — sweep-$ share + REPEATED sweeps (urgency, taking every offer)
 *   4. concentration  — same-strike / same-expiry clustering (one bet, not a spread)
 *   5. persistence    — buying SUSTAINED over time, not one blip (one print means little)
 *   6. momentum       — is the flow ACCELERATING or fading? (net-premium slope)
 *   7. institutional  — count of block-size prints (real size behind it)
 *
 * Plus a `momentum` sub-read — "MACD for options flow": premium/min, sweeps/min, net-premium slope,
 * rolling aggression/dominance, and an accelerating flag. This is what makes "twenty minutes of building
 * beats one print" measurable, and it is the seed for continuous-confidence exits.
 *
 * CALIBRATION-FIRST: the component WEIGHTS below are principled but PROVISIONAL. This score is evidence,
 * not a new gate — it gets logged per setup and graduated against real graded outcomes (which components
 * actually predict wins) before it ever sizes risk. Pure & deterministic → unit-testable with synthetic tapes.
 */

/** One options-flow print off the tape (the subset the aggregator already has per row). */
export interface FlowPrint {
  /** Premium in USD for this print. */
  premiumUsd: number;
  /** Aggressor side as ask-percentage 0–100 (≥60 = bought at the ask); null when the tape omits it. */
  askPct: number | null;
  /** True when this print was a sweep (swept multiple exchanges — urgency). */
  isSweep: boolean;
  strike: number;
  /** Expiry YYYY-MM-DD. */
  expiryYmd: string;
  side: "call" | "put";
  /** Epoch ms of the print. */
  tsMs: number;
  /** Contracts traded (for the block/institutional read); optional. */
  size?: number;
}

/** The "MACD for flow" sub-read — is conviction building or fading, and how fast. */
export interface FlowMomentum {
  /** Span of the tape in minutes (last − first print). */
  spanMin: number;
  /** Gross premium per minute over the span. */
  premiumPerMin: number;
  /** Sweeps per minute over the span. */
  sweepsPerMin: number;
  /** Net-premium slope: (recent-half $/min) − (earlier-half $/min). Positive = accelerating. */
  netPremiumSlopePerMin: number;
  /** Aggression share in the recent window (0–1). */
  rollingAggression: number;
  /** Dominant-side share in the recent window (0–1). */
  rollingDominance: number;
  /** True when the recent half is buying faster than the earlier half. */
  accelerating: boolean;
}

/** The seven weighted components (each already scaled to its cap). */
export interface FlowQualityComponents {
  premiumDepth: number; // 0–20
  aggression: number; // 0–18
  sweepIntensity: number; // 0–16
  persistence: number; // 0–16
  concentration: number; // 0–14
  momentum: number; // 0–12
  institutional: number; // 0–4
}

export interface FlowQuality {
  /** The composite 0–100 flow-quality score. */
  score: number;
  components: FlowQualityComponents;
  momentum: FlowMomentum;
  /** Aggression-weighted dominant side + its dominance share (0–1) — mirrors the engine's direction read. */
  dominantSide: "call" | "put";
  dominance: number;
  /** One-line human summary. */
  reason: string;
}

// ── weights / thresholds (PROVISIONAL — graduate on graded outcomes) ─────────────────────────────
const W = { premiumDepth: 20, aggression: 18, sweepIntensity: 16, persistence: 16, concentration: 14, momentum: 12, institutional: 4 };
const PREMIUM_FLOOR = 250_000; // below this, premiumDepth → 0 (the tape is thin)
const PREMIUM_CEIL = 20_000_000; // $20M+ premium → full premiumDepth
const BLOCK_PREMIUM = 500_000; // a single print ≥ $500k counts as an institutional block
const RECENT_WINDOW_MS = 10 * 60 * 1000; // "rolling" = last 10 minutes of the tape

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Aggression weight for one print by aggressor side (mirrors the live engine's aggressionWeight). */
function aggrWeight(askPct: number | null): number {
  if (askPct == null || !Number.isFinite(askPct)) return 0.5;
  if (askPct >= 60) return 1.0;
  if (askPct >= 45) return 0.6;
  return 0.15;
}

/** Compute the flow-quality read for one ticker's print tape. Empty tape → a zeroed, safe result. */
export function computeFlowQuality(prints: FlowPrint[]): FlowQuality {
  const rows = prints.filter((p) => p && Number.isFinite(p.premiumUsd) && p.premiumUsd > 0 && Number.isFinite(p.tsMs));
  const zero: FlowQuality = {
    score: 0,
    components: { premiumDepth: 0, aggression: 0, sweepIntensity: 0, persistence: 0, concentration: 0, momentum: 0, institutional: 0 },
    momentum: { spanMin: 0, premiumPerMin: 0, sweepsPerMin: 0, netPremiumSlopePerMin: 0, rollingAggression: 0, rollingDominance: 0, accelerating: false },
    dominantSide: "call",
    dominance: 0,
    reason: "no flow",
  };
  if (rows.length === 0) return zero;

  const gross = rows.reduce((s, p) => s + p.premiumUsd, 0);
  const callAggr = rows.filter((p) => p.side === "call").reduce((s, p) => s + p.premiumUsd * aggrWeight(p.askPct), 0);
  const putAggr = rows.filter((p) => p.side === "put").reduce((s, p) => s + p.premiumUsd * aggrWeight(p.askPct), 0);
  const aggrTotal = callAggr + putAggr;
  const dominantSide: "call" | "put" = callAggr >= putAggr ? "call" : "put";
  const dominance = aggrTotal > 0 ? Math.max(callAggr, putAggr) / aggrTotal : 0;

  // ── momentum sub-read ──
  const first = Math.min(...rows.map((p) => p.tsMs));
  const last = Math.max(...rows.map((p) => p.tsMs));
  const spanMin = (last - first) / 60_000;
  const effSpan = Math.max(spanMin, 0.5); // rate denominator floor so a single burst doesn't divide to Infinity
  const sweepCount = rows.filter((p) => p.isSweep).length;
  const mid = first + (last - first) / 2;
  const earlierGross = rows.filter((p) => p.tsMs < mid).reduce((s, p) => s + p.premiumUsd, 0);
  const recentGross = rows.filter((p) => p.tsMs >= mid).reduce((s, p) => s + p.premiumUsd, 0);
  const halfSpanMin = Math.max(spanMin / 2, 0.5);
  const earlierRate = earlierGross / halfSpanMin;
  const recentRate = recentGross / halfSpanMin;
  const recentRows = rows.filter((p) => p.tsMs >= last - RECENT_WINDOW_MS);
  const recentAggrTotal = recentRows.reduce((s, p) => s + p.premiumUsd * aggrWeight(p.askPct), 0);
  const recentGrossW = recentRows.reduce((s, p) => s + p.premiumUsd, 0);
  const recentCallAggr = recentRows.filter((p) => p.side === "call").reduce((s, p) => s + p.premiumUsd * aggrWeight(p.askPct), 0);
  const recentPutAggr = recentRows.filter((p) => p.side === "put").reduce((s, p) => s + p.premiumUsd * aggrWeight(p.askPct), 0);
  const enoughToJudgeMomentum = rows.length >= 3 && spanMin >= 2;
  const momentum: FlowMomentum = {
    spanMin: Math.round(spanMin * 10) / 10,
    premiumPerMin: Math.round(gross / effSpan),
    sweepsPerMin: Math.round((sweepCount / effSpan) * 100) / 100,
    netPremiumSlopePerMin: enoughToJudgeMomentum ? Math.round(recentRate - earlierRate) : 0,
    rollingAggression: recentGrossW > 0 ? Math.round((recentAggrTotal / recentGrossW) * 100) / 100 : 0,
    rollingDominance: recentAggrTotal > 0 ? Math.round((Math.max(recentCallAggr, recentPutAggr) / (recentCallAggr + recentPutAggr)) * 100) / 100 : 0,
    accelerating: enoughToJudgeMomentum && recentRate > earlierRate,
  };

  // ── components ──
  // 1. premiumDepth — log-scaled gross between the floor and ceiling.
  const depth = gross <= PREMIUM_FLOOR ? 0 : clamp((Math.log10(gross) - Math.log10(PREMIUM_FLOOR)) / (Math.log10(PREMIUM_CEIL) - Math.log10(PREMIUM_FLOOR)), 0, 1) * W.premiumDepth;

  // 2. aggression — aggression-weighted share of gross, scaled from the 0.30 gate up to ~0.85.
  const aggrShare = gross > 0 ? aggrTotal / gross : 0;
  const aggression = clamp((aggrShare - 0.3) / (0.85 - 0.3), 0, 1) * W.aggression;

  // 3. sweepIntensity — sweep-$ share (0–12) + repeated-sweep urgency bonus (0–4).
  const sweepPrem = rows.filter((p) => p.isSweep).reduce((s, p) => s + p.premiumUsd, 0);
  const sweepShare = gross > 0 ? sweepPrem / gross : 0;
  const sweepIntensity = clamp(sweepShare, 0, 1) * (W.sweepIntensity - 4) + clamp(sweepCount / 6, 0, 1) * 4;

  // 4. persistence — sustained over time (0–8) AND breadth of prints (0–8). A single whale print → 0.
  const persistence = clamp(spanMin / 20, 0, 1) * 8 + clamp(rows.length / 15, 0, 1) * 8;

  // 5. concentration — premium Herfindahl on the dominant side across strikes (0.7) + expiries (0.3).
  const domRows = rows.filter((p) => p.side === dominantSide);
  const domGross = domRows.reduce((s, p) => s + p.premiumUsd, 0) || 1;
  const hhi = (keyOf: (p: FlowPrint) => string) => {
    const m = new Map<string, number>();
    for (const p of domRows) m.set(keyOf(p), (m.get(keyOf(p)) || 0) + p.premiumUsd);
    let h = 0;
    for (const v of m.values()) h += (v / domGross) ** 2;
    return h; // 1 = all one bucket (max conviction), →0 = spread
  };
  // A lone print is trivially "concentrated" (HHI=1) but proves no clustering — need ≥2 to measure it.
  const concentration = domRows.length >= 2 ? (hhi((p) => String(p.strike)) * 0.7 + hhi((p) => p.expiryYmd) * 0.3) * W.concentration : 0;

  // 6. momentum — accelerating net-premium (0–8) + rising rolling aggression (0–4).
  const accelRatio = earlierRate > 0 ? recentRate / earlierRate - 1 : recentRate > 0 ? 1 : 0;
  const momentumScore = enoughToJudgeMomentum
    ? clamp(accelRatio, 0, 1) * 8 + clamp((momentum.rollingAggression - 0.5) / 0.4, 0, 1) * 4
    : 0;

  // 7. institutional — count of block-size prints.
  const blockCount = rows.filter((p) => p.premiumUsd >= BLOCK_PREMIUM).length;
  const institutional = clamp(blockCount / 4, 0, 1) * W.institutional;

  const components: FlowQualityComponents = {
    premiumDepth: round1(depth),
    aggression: round1(aggression),
    sweepIntensity: round1(sweepIntensity),
    persistence: round1(persistence),
    concentration: round1(concentration),
    momentum: round1(momentumScore),
    institutional: round1(institutional),
  };
  const score = clamp(Math.round(Object.values(components).reduce((s, v) => s + v, 0)), 0, 100);

  return {
    score,
    components,
    momentum,
    dominantSide,
    dominance: Math.round(dominance * 100) / 100,
    reason: `${dominantSide} ${Math.round(dominance * 100)}% dom · $${(gross / 1e6).toFixed(1)}M · ${rows.length} prints/${momentum.spanMin}m · ${momentum.accelerating ? "accelerating" : "steady"}`,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
