import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxSignalFactor } from "@/features/spx/lib/spx-signals";

/** Canonical news-sentiment patterns — imported by spx-play-confirmations.ts as well. */
export const BEAR_NEWS =
  /\b(crash|plunge|selloff|sell-off|hawkish|hot cpi|inflation surge|war|recession|downgrade|lawsuit|probe|tariff)\b/i;
export const BULL_NEWS =
  /\b(rally|surge|soar|dovish|rate cut|beat estimates|record high|stimulus|ceasefire)\b/i;

// BUG FIX (2026-11-01, five-engine-largo-cycle-59 audit): BEAR_NEWS/BULL_NEWS classified a
// headline's sentiment by testing for the literal presence of a keyword ANYWHERE in the title,
// with no check for an adjacent negating/reversal phrase. Live repro: "S&P 500 Index Rally Hits a
// Wall Amid AI Jitters as Key Valuation Metric Dips" matched BULL_NEWS on "Rally" and was
// classified "bullish", even though the headline's actual content is a stalling/cautionary read —
// "Rally Hits a Wall" is not confirming bullish evidence. REVERSAL_PHRASE + isNegatedByReversal()
// void a keyword match when a reversal phrase immediately follows it, scoped to a short window
// right after the match (not the whole headline) so an unrelated reversal elsewhere in a longer
// headline can't suppress a real, unrelated signal. matchesBullNews/matchesBearNews are the single
// shared chokepoint for this check — spx-play-confirmations.ts's own `newsSentiment()` uses the
// same two functions rather than re-testing BEAR_NEWS/BULL_NEWS directly, so this fix covers both
// call sites instead of just the one the live audit happened to trip over.
const REVERSAL_PHRASE =
  /\b(hits? a wall|stalls?|stalled|stalling|fades?|faded|fading|stumbles?|stumbled|stumbling|reverses?|reversed|reversal|loses? steam|losing steam|runs? out of steam|peters? out|petered out|cools?|cooled|cooling)\b/i;

/** How far past a matched keyword to look for a reversal phrase that voids it. */
const REVERSAL_WINDOW_CHARS = 24;

/**
 * True when `keyword` matches `title` but that specific match is immediately followed (within a
 * short window) by a reversal phrase that negates the keyword's naive polarity.
 */
function isNegatedByReversal(title: string, keyword: RegExp): boolean {
  const match = keyword.exec(title);
  if (!match || match.index == null) return false;
  const afterStart = match.index + match[0].length;
  const window = title.slice(afterStart, afterStart + REVERSAL_WINDOW_CHARS);
  return REVERSAL_PHRASE.test(window);
}

/** True when `title` carries real bullish evidence — matches BULL_NEWS and isn't reversed. */
export function matchesBullNews(title: string): boolean {
  return BULL_NEWS.test(title) && !isNegatedByReversal(title, BULL_NEWS);
}

/** True when `title` carries real bearish evidence — matches BEAR_NEWS and isn't reversed. */
export function matchesBearNews(title: string): boolean {
  return BEAR_NEWS.test(title) && !isNegatedByReversal(title, BEAR_NEWS);
}

function newsSentiment(headlines: SpxDeskPayload["news_headlines"]): "bullish" | "bearish" | "neutral" {
  let bull = 0;
  let bear = 0;
  for (const h of headlines.slice(0, 5)) {
    const t = h.title ?? "";
    if (matchesBearNews(t)) bear += 1;
    if (matchesBullNews(t)) bull += 1;
  }
  if (bear > bull) return "bearish";
  if (bull > bear) return "bullish";
  return "neutral";
}

function factorOpposes(direction: "long" | "short", factor: SpxSignalFactor): boolean {
  return (direction === "long" && factor.weight < 0) || (direction === "short" && factor.weight > 0);
}

function isHardOpposingFactor(factor: SpxSignalFactor): boolean {
  const label = factor.label;
  return (
    label === "Market tide" ||
    label === "Dark pool" ||
    label === "IV rank" ||
    label.includes("γ") ||
    label.includes("GEX resistance") ||
    label.includes("GEX support")
  );
}

function gexOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  // gamma_flip!=null guard (regression 2026-10-17), scoped to the regime clause ONLY: spx-desk.ts
  // falls back to a stale sticky gamma_regime whenever the live flip resolves "unknown" (gamma_flip
  // null), and above_gamma_flip defaults to false in that same case — so an unguarded read here
  // would treat a leftover prior-cycle "amplification" label as a live GEX conflict with zero
  // current evidence behind it. The real γ-regime signal factor (spx-signals.ts) already guards the
  // identical read on `gamma_flip != null`; this mirrors that established pattern. The gex_walls
  // proximity check below is an independent signal (derived from the strike ladder, not from
  // gamma_flip/gamma_regime) and must keep firing regardless of flip state.
  const regimeOpposed = desk.gamma_flip != null && desk.gamma_regime === "amplification";
  if (direction === "long") {
    return (
      (regimeOpposed && !desk.above_gamma_flip) ||
      Boolean(desk.gex_walls?.some((w) => w.kind === "resistance" && Math.abs(desk.price - w.strike) <= 12))
    );
  }
  return (
    (regimeOpposed && desk.above_gamma_flip) ||
    Boolean(desk.gex_walls?.some((w) => w.kind === "support" && Math.abs(desk.price - w.strike) <= 12))
  );
}

function tideOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const tide = desk.tide_bias;
  if (!tide || tide === "neutral") return false;
  return tide !== (direction === "long" ? "bullish" : "bearish");
}

function newsOpposed(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  const news = newsSentiment(desk.news_headlines ?? []);
  return (direction === "long" && news === "bearish") || (direction === "short" && news === "bullish");
}

function vixExtremeAgainst(desk: SpxDeskPayload, direction: "long" | "short"): boolean {
  if (desk.vix == null) return false;
  if (direction === "long" && desk.vix > 28) return true;
  if (direction === "short" && desk.vix < 14) return true;
  return false;
}

function newsAlreadyScored(factors: SpxSignalFactor[]): boolean {
  return factors.some((f) => f.label === "News risk" || f.label.startsWith("News"));
}

// BUG FIX (2026-11-01, five-engine-largo-cycle-60 audit): same bug class as gexAlreadyScored
// above (PR #7114) — this guard used to suppress the vixExtremeAgainst() +2 bonus whenever ANY
// VIX-family factor existed in `factors`, regardless of which SIDE it agreed with. desk.vix
// (absolute VIX level) and the "VIX curve" factor (spx-signals.ts, built from vix_term's
// vix9d/vix3m term-structure shape) are independent metrics from independent inputs — "VIX curve"
// can carry a POSITIVE weight (contango, agreeing with a long) at the exact same time desk.vix is
// extreme (>28) and genuinely OPPOSES that long. Live repro: vix=30 (long opposed) + an agreeing
// "VIX curve" contango factor (weight +4) -> the old broad guard read "a VIX-family factor
// exists" as "the VIX-extreme conflict is already counted" and dropped a real, independent
// conflict (weighted_conflicts 2 -> 0). Fixed the same way as gexAlreadyScored: require the
// EXISTING factor to actually OPPOSE `direction` (factorOpposes), not merely exist.
// "IV rank" is unaffected by this fix: spx-signals.ts only ever pushes it as an OPPOSING factor
// (high IV rank fades a long, low IV rank squeezes a short — see the uw_iv_rank block above), so
// "exists" and "exists and opposes" were already equivalent for it; no behavior change there.
function vixAlreadyScored(factors: SpxSignalFactor[], direction: "long" | "short"): boolean {
  return factors.some(
    (f) => (f.label.includes("VIX") || f.label === "IV rank") && factorOpposes(direction, f)
  );
}

export function computeWeightedConflicts(
  desk: SpxDeskPayload,
  score: number,
  factors: SpxSignalFactor[]
): { conflicts: number; weighted_conflicts: number } {
  const bullFactors = factors.filter((f) => f.weight > 0).length;
  const bearFactors = factors.filter((f) => f.weight < 0).length;
  const conflicts =
    score > 0 ? bearFactors : score < 0 ? bullFactors : Math.min(bullFactors, bearFactors);
  const direction: "long" | "short" | null = score > 0 ? "long" : score < 0 ? "short" : null;
  if (!direction) return { conflicts, weighted_conflicts: conflicts };

  let weighted = 0;
  for (const f of factors) {
    if (!factorOpposes(direction, f)) continue;
    weighted += isHardOpposingFactor(f) ? 2 : 1;
  }

  if (newsOpposed(desk, direction) && !newsAlreadyScored(factors)) {
    weighted += 2;
  }
  if (tideOpposed(desk, direction) && !factors.some((f) => f.label === "Market tide")) {
    weighted += 2;
  }
  // BUG FIX (2026-11-01, SPX Slayer audit): this guard used to suppress the +2 bonus whenever
  // ANY GEX/γ-labeled factor existed in `factors`, regardless of which SIDE it agreed with.
  // computeSpxConfluence's mutual-exclusivity fix (ISSUE-01, spx-signals.ts) scores ONLY the
  // nearer of two in-range GEX walls when price sits between a support wall and a resistance
  // wall both within 12pts — the farther, genuinely-opposing wall is dropped entirely and never
  // reaches `factors`. So "GEX support" (agreeing with a long) could be the only GEX factor
  // present while a real, nearby, unscored resistance wall (gexOpposed()'s wall-proximity check)
  // opposed that same long — and the old broad guard read the agreeing factor's mere presence as
  // "already counted", silently dropping the real conflict from weighted_conflicts. The guard
  // must check whether an EXISTING factor actually OPPOSES `direction` (factorOpposes, already
  // used by the main loop above) — not merely whether a same-family factor exists at all.
  const gexAlreadyScored = factors.some(
    (f) => (f.label.includes("GEX") || f.label.includes("γ")) && factorOpposes(direction, f)
  );
  if (gexOpposed(desk, direction) && !gexAlreadyScored) {
    weighted += 2;
  }
  if (vixExtremeAgainst(desk, direction) && !vixAlreadyScored(factors, direction)) {
    weighted += 2;
  }

  // weighted_conflicts is the desk-adjusted opposition score only — do NOT max() with the
  // raw opposing-factor count. That double-penalized A-grade setups (conflicts ≤ 2 for grade A)
  // whenever soft counter-trend factors stacked, blocking entry with "Tape's mixed" at threshold 4.
  return { conflicts, weighted_conflicts: weighted };
}
