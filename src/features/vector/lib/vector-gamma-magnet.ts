import type { VectorWalls } from "@/lib/api";
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
    callout: buildCallout(Math.round(strike), distancePct, pull, posture),
  };
}

function buildCallout(
  level: number,
  distancePct: number,
  pull: GammaMagnetPull,
  posture: VectorRegimePosture
): string {
  // distancePct is already a percent — no *100 here (it was needed while the field was a fraction).
  const dist = `${distancePct >= 0 ? "+" : ""}${distancePct.toFixed(2)}%`;
  if (posture === "long") {
    return pull === "at"
      ? `gamma magnet ${level} — spot pinned at the dealer-hedging center of mass`
      : `gamma magnet ${level} (${dist}) — long-gamma hedging pulls spot ${pull}`;
  }
  if (posture === "short") {
    return pull === "at"
      ? `gamma pivot ${level} — short gamma: a break here accelerates, it won't hold`
      : `gamma pivot ${level} (${dist}) — short gamma amplifies a move away, won't hold`;
  }
  return `gamma center of mass ${level} (${dist})`;
}
