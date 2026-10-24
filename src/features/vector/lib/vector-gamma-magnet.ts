import type { VectorWalls } from "@/lib/api";
import { fmtPriceLevel } from "@/lib/fmt-money";
import type { VectorRegimePosture } from "./vector-regime";

/**
 * Gamma magnet — the dealer-hedging center of mass the price is drawn toward (or
 * pivots on). Pure + client-derivable from the walls the chart already has, so it
 * adds no server plumbing.
 *
 * Physics, stated honestly per regime (this is why `posture` matters):
 *  - LONG gamma  → dealers hedge AGAINST moves (buy dips / sell rips), so price is
 *    genuinely PINNED toward the gamma center of mass — a magnet.
 *  - SHORT gamma → dealers hedge WITH moves (sell dips / buy rips), so the same
 *    center of mass is not a magnet at all: it's a PIVOT that, once broken,
 *    ACCELERATES away. Calling it a "magnet" there would be a lie about the flow.
 *  - transition/unknown → report the level as a neutral center of mass, no claim.
 *
 * The magnet strike is the wall-strength (`pct`)-weighted mean of the call+put
 * walls — the concentration of dealer gamma. Not a made-up number: it's the
 * center of mass of the SAME strength values the beads render.
 */

export type GammaMagnetPull = "up" | "down" | "at";

export type GammaMagnet = {
  /** Strength-weighted center of mass of the gamma walls (rounded to cents). */
  strike: number;
  /**
   * Signed distance as a PERCENT of spot (`((strike - spot) / spot) * 100`), positive = magnet
   * above spot. Percent, NOT a fraction — matching `WallProximity.distancePct`,
   * `flipDistancePct` and `spx-session.ts`'s `distancePct`, which is the repo-wide meaning of
   * a `*Pct` distance field.
   *
   * This was a FRACTION until 2026-08-21 and was the only `distancePct` in the repo that was.
   * Two things broke because of it. (1) `VectorFullState` carries BOTH this and
   * `proximity.distancePct` under the same key name, 100x apart in scale, so
   * `get_vector_full_state` handed the model two same-named numbers on different scales with
   * nothing to tell them apart. (2) `roundFloats(dp=2)` at the BIE boundary quantized the
   * fraction to zero — a magnet 0.20% away (SPX, spot 7737.83) served as literally `0`.
   * Fixing the UNIT rather than adding a `keyDp` override was the only option available:
   * `roundFloats` matches on the immediate key, so one `distancePct` entry cannot serve a
   * fraction and a percent in the same payload.
   */
  distancePct: number;
  /** Which way the magnet sits relative to spot ("at" when within the dead-band). */
  pull: GammaMagnetPull;
  posture: VectorRegimePosture;
  /** Desk-terminal one-liner, phrased by regime (pin vs pivot). */
  callout: string;
};

/** Within ~0.15% of the magnet counts as sitting on it (no meaningful pull direction).
 *  Expressed in PERCENT units to match `distancePct` above (was 0.0015 when that field was a
 *  fraction — the two must always be on the same scale or the dead-band silently changes width). */
const AT_BAND_PCT = 0.15;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function deriveGammaMagnet(input: {
  spot: number | null | undefined;
  walls: VectorWalls | null | undefined;
  posture?: VectorRegimePosture;
}): GammaMagnet | null {
  const spot = input.spot;
  if (!(typeof spot === "number" && spot > 0)) return null;

  const levels = [
    ...(input.walls?.callWalls ?? []),
    ...(input.walls?.putWalls ?? []),
  ].filter(
    (w) =>
      w != null &&
      Number.isFinite(w.strike) &&
      w.strike > 0 &&
      Number.isFinite(w.pct) &&
      w.pct > 0
  );
  if (levels.length === 0) return null;

  let weight = 0;
  let weightedStrike = 0;
  for (const w of levels) {
    weight += w.pct;
    weightedStrike += w.strike * w.pct;
  }
  if (!(weight > 0)) return null;

  const strike = weightedStrike / weight;
  const distancePct = ((strike - spot) / spot) * 100;
  const pull: GammaMagnetPull =
    Math.abs(distancePct) <= AT_BAND_PCT ? "at" : distancePct > 0 ? "up" : "down";
  const posture = input.posture ?? "unknown";

  return {
    strike: round2(strike),
    distancePct,
    pull,
    posture,
    // BUG FIX (2026-10-24, Ask Largo fan-out audit, live repro BMNR): this used to pass
    // `Math.round(strike)` — the level rounded to the nearest WHOLE DOLLAR — into the callout
    // while `distancePct` (above) stays computed from the un-rounded, cents-precision `strike`.
    // Whenever the weighted-mean magnet strike wasn't already near-integer (the ordinary case,
    // since it's a weighted average of call+put wall strikes), the callout's level and its own
    // quoted percent described two DIFFERENT numbers in one sentence: live repro BMNR, spot
    // 22.41, callout read "gamma pivot 31 (+36.86%)" — (31-22.41)/22.41 = +38.33%, not +36.86%;
    // +36.86% is the percent for the REAL strike, 30.67, which is exactly what `GammaMagnet.strike`
    // (two lines up) and every narrative consumer (`fmtPriceLevel(m.strike)`, play-brief-narrative*
    // .ts) already render. Pass the SAME cents-precision strike this field itself carries, so the
    // level named in the sentence is never a different number than the percent beside it.
    callout: buildCallout(round2(strike), distancePct, pull, posture),
  };
}

function buildCallout(
  level: number,
  distancePct: number,
  pull: GammaMagnetPull,
  posture: VectorRegimePosture
): string {
  const levelStr = fmtPriceLevel(level);
  // distancePct is already a percent — no *100 here (it was needed while the field was a fraction).
  const dist = `${distancePct >= 0 ? "+" : ""}${distancePct.toFixed(2)}%`;
  if (posture === "long") {
    return pull === "at"
      ? `gamma magnet ${levelStr} — spot pinned at the dealer-hedging center of mass`
      : `gamma magnet ${levelStr} (${dist}) — long-gamma hedging pulls spot ${pull}`;
  }
  if (posture === "short") {
    return pull === "at"
      ? `gamma pivot ${levelStr} — short gamma: a break here accelerates, it won't hold`
      : `gamma pivot ${levelStr} (${dist}) — short gamma amplifies a move away, won't hold`;
  }
  return `gamma center of mass ${levelStr} (${dist})`;
}
