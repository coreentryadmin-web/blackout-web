import type { GexWalls } from "@/lib/providers/gex-wall-levels";

/**
 * Wall-proximity intelligence — turns the static walls into a live "what matters
 * right now" read. When spot approaches a major GEX wall (or the gamma flip),
 * that level is the one the member should be watching: in long gamma a wall is a
 * magnet/resistance dealers defend; the gamma flip is the regime hinge. This
 * derives the single nearest significant level within a proximity band and a
 * plain-English callout for it — the dynamic pulse of the desk terminal.
 *
 * Pure + Date-free → deterministic and unit-testable.
 */

export type WallProximitySide = "call" | "put" | "flip";

export type WallProximity = {
  strike: number;
  side: WallProximitySide;
  /** Signed distance as a % of spot: positive = level is above spot. */
  distancePct: number;
  /** How close: within a third of the band = "at", within two thirds = "testing", else "near". */
  nearness: "near" | "testing" | "at";
  callout: string;
};

const DEFAULT_BAND_PCT = 0.5;

// BUG FIX (2026-08-27, measured live during RTH): with plain thresholds, `nearness` (and the
// band membership itself) is a hard boundary re-evaluated fresh on every poll. A ticker sitting
// right at a wall for an extended stretch (SPY/QQQ/IWM/SPX all did, in the session that surfaced
// this) has its spot ticking back and forth across that boundary by sub-tenth-percent amounts —
// not a regime change, just quote noise — and each crossing flips `nearness`, which feeds
// `computeConviction`'s testing/at bump (vector-play-engine.ts), which sits right under the A/B
// grade cutoff. Measured: NVDA's play flipped grade B -> A between two reads 25s apart on a 0.06%
// spot move (229.51 -> 229.65), nowhere near a real wall test or break. Two members opening the
// same ticker a few seconds apart could see different grades on an identical setup, purely from
// which side of the boundary their poll landed on.
// Fix: hysteresis. ENTERING a tighter state (near -> testing -> at) still uses the plain
// threshold — a level should register as "at" or "testing" promptly the first time. LEAVING one
// requires crossing back out past a WIDER threshold, so a level already classified "at" doesn't
// downgrade until spot has moved meaningfully away, not just ticked across the exact boundary.
// Requires the caller to pass its own last read back in as `prev` — this module stays pure/
// Date-free, so the caller (VectorChart.tsx) owns the ref, not this file.
const HYSTERESIS_EXIT_MARGIN = 0.25;

function absPct(spot: number, strike: number): number {
  return (Math.abs(strike - spot) / spot) * 100;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Is `prev` a read of the SAME level this candidate represents? Wall strikes are discrete and
 *  should match exactly between polls of the same book; the gamma flip is a continuously
 *  recomputed value, so use a tight tolerance (5bps of spot) rather than exact equality there —
 *  otherwise the flip's hysteresis would never engage since it never lands on the same float twice. */
function sameLevel(
  prev: WallProximity | null | undefined,
  side: WallProximitySide,
  strike: number,
  spot: number
): boolean {
  if (!prev || prev.side !== side) return false;
  return (Math.abs(prev.strike - strike) / spot) * 100 < 0.05;
}

function classifyNearness(
  dist: number,
  band: number,
  prevNearness: WallProximity["nearness"] | null | undefined
): WallProximity["nearness"] {
  const atIn = band / 3;
  const testingIn = (band * 2) / 3;
  if (prevNearness === "at") {
    const atOut = atIn * (1 + HYSTERESIS_EXIT_MARGIN);
    if (dist <= atOut) return "at";
    return dist <= testingIn ? "testing" : "near";
  }
  if (prevNearness === "testing") {
    if (dist <= atIn) return "at";
    const testingOut = testingIn * (1 + HYSTERESIS_EXIT_MARGIN);
    return dist <= testingOut ? "testing" : "near";
  }
  return dist <= atIn ? "at" : dist <= testingIn ? "testing" : "near";
}

/**
 * Nearest significant level to spot within `bandPct`, or null when spot is in
 * open space (no level close enough to matter). Considers the top call wall, top
 * put wall, and the gamma flip; picks whichever is closest.
 */
export function deriveWallProximity(input: {
  spot: number | null | undefined;
  walls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  bandPct?: number;
  /** The caller's last `deriveWallProximity` result for this same (ticker, horizon), if any —
   *  enables the exit hysteresis above. Omit (or pass null) for a fresh/first read: falls back
   *  to plain thresholds, matching the pre-fix behavior exactly. */
  prev?: WallProximity | null;
}): WallProximity | null {
  const { spot, walls, gammaFlip, prev } = input;
  const band = input.bandPct ?? DEFAULT_BAND_PCT;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;

  const candidates: Array<{ strike: number; side: WallProximitySide }> = [];
  const call = walls?.callWalls?.[0]?.strike;
  const put = walls?.putWalls?.[0]?.strike;
  if (call != null && Number.isFinite(call)) candidates.push({ strike: call, side: "call" });
  if (put != null && Number.isFinite(put)) candidates.push({ strike: put, side: "put" });
  if (gammaFlip != null && Number.isFinite(gammaFlip) && gammaFlip > 0)
    candidates.push({ strike: gammaFlip, side: "flip" });

  // A level already being tracked (same side + strike as `prev`) gets the widened exit band too,
  // so it doesn't drop OUT of the band entirely on the same kind of sub-tick noise.
  const exitBand = band * (1 + HYSTERESIS_EXIT_MARGIN);
  let best: { strike: number; side: WallProximitySide; dist: number } | null = null;
  for (const c of candidates) {
    const dist = absPct(spot, c.strike);
    const tracking = sameLevel(prev, c.side, c.strike, spot);
    if (dist > (tracking ? exitBand : band)) continue;
    if (!best || dist < best.dist) best = { ...c, dist };
  }
  if (!best) return null;

  const signed = ((best.strike - spot) / spot) * 100;
  const trackingBest = sameLevel(prev, best.side, best.strike, spot);
  const nearness = classifyNearness(best.dist, band, trackingBest ? prev!.nearness : null);
  const above = signed >= 0;

  let callout: string;
  if (best.side === "flip") {
    callout = `${fmt(best.strike)} gamma flip ${above ? "overhead" : "below"} (${best.dist.toFixed(2)}% away) — a cross flips the regime; expect the sharpest moves here.`;
  } else if (best.side === "call") {
    // `above` (signed >= 0) means the call-wall STRIKE is at/above spot — spot is testing it from
    // below. `!above` means spot has broken THROUGH and is now above the wall — resistance
    // cleared, not "back under" it. The prior wording said "back under the call wall ... lost
    // magnet" in exactly that case, describing spot as below a wall it had actually broken above
    // (inverted bias) — the call-wall mirror of the put-wall fix immediately below.
    callout = above
      ? `Testing ${fmt(best.strike)} call wall (${best.dist.toFixed(2)}% below) — dealers sell into strength; resistance unless it breaks on volume.`
      : `Cleared the ${fmt(best.strike)} call wall (${best.dist.toFixed(2)}% below spot) — resistance gave way; dealers stop capping, watch for continuation higher.`;
  } else {
    // `above` (signed >= 0) means the put-wall STRIKE is at/above spot — i.e. spot has fallen to or
    // through its largest-negative-gamma support. That is support BREAKING, not a reclaim: the prior
    // "reclaimed support, dip-buy zone" wording printed a bullish dip-buy at the exact moment the put
    // wall was lost (spot under it), inverting the directional bias. Mirror the flip/call cautions
    // instead. `!above` (spot still above the wall) is the intact-support case and stays a support read.
    callout = !above
      ? `Testing ${fmt(best.strike)} put wall (${best.dist.toFixed(2)}% below) — dealers buy weakness; support unless it breaks on volume.`
      : `Lost the ${fmt(best.strike)} put wall (${best.dist.toFixed(2)}% overhead) — support gave way; dealers stop cushioning, watch for continuation lower.`;
  }

  return { strike: best.strike, side: best.side, distancePct: signed, nearness, callout };
}
