// Leaf module — NO server-only imports. play-constraints.ts is pulled into CLIENT
// component bundles (PlaybookPlayRow), so the shared level parser must not drag
// play-outcomes' Polygon/db chain (api-telemetry-persist is "server-only") with it.
// play-outcomes re-exports these so grading and publish-time geometry validation
// keep using literally the same parser.
import type { PlaybookPlay } from "./types";

/** Default max stop distance from spot (fraction). Prevents dossier S/R from producing absurd
 *  risk plans (e.g., support at -18% for a LONG = unactionable stop). Scaled up by ATR when available. */
const DEFAULT_MAX_STOP_PCT = 0.08;
/** Default max target distance from spot (fraction). Scaled up by ATR when available. */
const DEFAULT_MAX_TARGET_PCT = 0.12;
/** Absolute ceilings even for high-vol names. */
const HARD_MAX_STOP_PCT = 0.15;
const HARD_MAX_TARGET_PCT = 0.25;
/** Minimum R:R ratio (target_dist / stop_dist). When the ratio falls below this, the stop
 *  is tightened to maintain at least this R:R. */
const MIN_RR_RATIO = 0.75;

function volatilityAdjustedCaps(spot: number, atr?: number | null): { maxStopPct: number; maxTargetPct: number } {
  if (atr == null || !Number.isFinite(atr) || atr <= 0 || spot <= 0) {
    return { maxStopPct: DEFAULT_MAX_STOP_PCT, maxTargetPct: DEFAULT_MAX_TARGET_PCT };
  }
  const atrPct = atr / spot;
  // 1.5× ATR for stop, 2.5× ATR for target, but never below defaults or above hard ceilings
  return {
    maxStopPct: Math.min(HARD_MAX_STOP_PCT, Math.max(DEFAULT_MAX_STOP_PCT, atrPct * 1.5)),
    maxTargetPct: Math.min(HARD_MAX_TARGET_PCT, Math.max(DEFAULT_MAX_TARGET_PCT, atrPct * 2.5)),
  };
}

export type ParsedPlayLevels = {
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
};

function parseDecimal(text: unknown): number | null {
  if (text == null) return null;
  const m = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parsePlayLevels(play: PlaybookPlay): ParsedPlayLevels {
  const raw = String(play.entry_range ?? "");
  // mapClaudePlayToEdition joins "condition | $range" — strip the prose prefix so
  // numbers from the condition (e.g. "Break above 99") don't contaminate the band.
  const entryText = raw.includes("|") ? raw.slice(raw.lastIndexOf("|") + 1) : raw;
  const normalized = entryText.replace(/[–—]/g, "-");
  const entryParts = normalized
    .split("-")
    .map((p) => parseDecimal(p))
    .filter((n): n is number => n != null);

  let entry_range_low: number | null = null;
  let entry_range_high: number | null = null;
  if (entryParts.length >= 2) {
    entry_range_low = Math.min(entryParts[0]!, entryParts[1]!);
    entry_range_high = Math.max(entryParts[0]!, entryParts[1]!);
  } else if (entryParts.length === 1) {
    entry_range_low = entryParts[0]!;
    entry_range_high = entryParts[0]!;
  }

  return {
    entry_range_low,
    entry_range_high,
    target: parseDecimal(play.target),
    stop: parseDecimal(play.stop),
  };
}

export function computeRiskReward(play: {
  direction?: string;
  entry_range?: string | null;
  target?: string | null;
  stop?: string | null;
}): number | null {
  const parsed = parsePlayLevels(play as PlaybookPlay);
  if (parsed.entry_range_low == null || parsed.target == null || parsed.stop == null) return null;
  const mid = parsed.entry_range_high != null
    ? (parsed.entry_range_low + parsed.entry_range_high) / 2
    : parsed.entry_range_low;
  if (mid <= 0) return null;
  const isLong = play.direction !== "SHORT";
  const targetDist = isLong ? parsed.target - mid : mid - parsed.target;
  const stopDist = isLong ? mid - parsed.stop : parsed.stop - mid;
  if (stopDist <= 0) return null;
  const rr = targetDist / stopDist;
  return Number.isFinite(rr) && rr > 0 ? Number(rr.toFixed(2)) : null;
}

/** Format a stock price for member-visible entry/target/stop strings. */
export function formatStockLevel(n: number): string {
  return n.toFixed(2);
}

/**
 * Build entry/target/stop strings for ranked-pool or mechanical-fallback plays that
 * satisfy validatePlayGeometry's direction-aware gate. "Near $X" + stop=X (the prior
 * backfill shape) collapses entry mid to X and fails LONG geometry (stop not below mid).
 */
export function buildDirectionalStockLevels(params: {
  direction: "long" | "short";
  support?: number | null;
  resistance?: number | null;
  /** Current spot price. When provided, entries anchor near spot (overnight plays
   *  where members act at the next session's open, not at a pullback to support). */
  spot?: number | null;
  /** ATR-14 for the name — scales stop/target caps to match the name's volatility. */
  atr?: number | null;
}): { entry_range: string; target: string; stop: string } {
  const support = params.support != null && Number.isFinite(params.support) ? params.support : null;
  const resistance =
    params.resistance != null && Number.isFinite(params.resistance) ? params.resistance : null;
  const spot = params.spot != null && Number.isFinite(params.spot) && params.spot > 0 ? params.spot : null;

  // Spot-anchored path: overnight plays where the member acts at the next open.
  // Entry bands near spot, stop/target at real S/R but clamped so neither is absurdly
  // far from entry (a dossier support at -18% produces unactionable risk/reward).
  if (spot != null && support != null && resistance != null && resistance > support) {
    const { maxStopPct, maxTargetPct } = volatilityAdjustedCaps(spot, params.atr);
    const maxStopDist = spot * maxStopPct;
    const maxTargetDist = spot * maxTargetPct;
    if (params.direction === "long") {
      const rawStop = support;
      let stopDist = Math.min(spot - rawStop, maxStopDist);
      const rawTarget = resistance;
      const targetDist = Math.min(rawTarget - spot, maxTargetDist);
      const finalTargetDist = Math.max(targetDist, spot * 0.01);
      if (finalTargetDist < stopDist * MIN_RR_RATIO) {
        stopDist = finalTargetDist / MIN_RR_RATIO;
      }
      return {
        entry_range: `$${formatStockLevel(spot * 0.995)}-$${formatStockLevel(spot * 1.005)}`,
        target: formatStockLevel(spot + finalTargetDist),
        stop: formatStockLevel(Math.min(spot - stopDist, spot * 0.99)),
      };
    }
    if (params.direction === "short") {
      const rawStop = resistance;
      let stopDist = Math.min(rawStop - spot, maxStopDist);
      const rawTarget = support;
      const targetDist = Math.min(spot - rawTarget, maxTargetDist);
      const finalTargetDist = Math.max(targetDist, spot * 0.01);
      if (finalTargetDist < stopDist * MIN_RR_RATIO) {
        stopDist = finalTargetDist / MIN_RR_RATIO;
      }
      return {
        entry_range: `$${formatStockLevel(spot * 0.995)}-$${formatStockLevel(spot * 1.005)}`,
        target: formatStockLevel(spot - finalTargetDist),
        stop: formatStockLevel(Math.max(spot + stopDist, spot * 1.01)),
      };
    }
  }

  // Legacy pullback-entry path (no spot): entry near S/R boundaries.
  if (params.direction === "long" && support != null && resistance != null && resistance > support) {
    const lo = support * 0.998;
    const hi = support;
    const stop = support * 0.99;
    return {
      entry_range: `$${formatStockLevel(lo)}-$${formatStockLevel(hi)}`,
      target: formatStockLevel(resistance),
      stop: formatStockLevel(stop),
    };
  }

  if (params.direction === "short" && support != null && resistance != null && resistance > support) {
    const lo = resistance;
    const hi = resistance * 1.002;
    const stop = resistance * 1.01;
    return {
      entry_range: `$${formatStockLevel(lo)}-$${formatStockLevel(hi)}`,
      target: formatStockLevel(support),
      stop: formatStockLevel(stop),
    };
  }

  return {
    entry_range: support != null ? `Near $${formatStockLevel(support)}` : "See technical levels",
    target: resistance != null ? formatStockLevel(resistance) : "-",
    stop: support != null ? formatStockLevel(support) : "-",
  };
}
