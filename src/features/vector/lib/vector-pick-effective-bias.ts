import type { PlaySetup, VectorPlay, VectorPlayBias } from "./vector-play-engine";

/** Spot must clear the flip by this fraction before pivot picks commit to a side. */
export const PIVOT_PICK_COMMIT_EPS = 0.0008;

/**
 * Contract-pick ranking needs a directional bias. Pivot plays stay `neutral` in the play
 * card (long above / short below), but once spot commits past the flip we rank the
 * matching side — otherwise the PLYS panel vanishes while the SCALP rail is visible.
 */
export function effectivePickBias(
  play: VectorPlay,
  spot: number | null | undefined,
  gammaFlip: number | null | undefined
): VectorPlayBias | null {
  if (play.bias !== "neutral") return play.bias;
  if (play.setup !== "pivot") return null;
  const flip = gammaFlip;
  if (flip == null || !(spot != null && spot > 0)) return null;
  const dist = Math.abs(spot - flip) / flip;
  if (dist < PIVOT_PICK_COMMIT_EPS) return null;
  return spot > flip ? "long" : "short";
}

export function pivotPickWaitingCopy(
  play: VectorPlay,
  gammaFlip: number | null | undefined
): string | null {
  if (play.setup !== "pivot" || play.bias !== "neutral") return null;
  const lvl =
    gammaFlip != null && Number.isFinite(gammaFlip)
      ? gammaFlip.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "the gamma flip";
  return `Spot is on ${lvl} — contract picks rank once price commits above or below the flip.`;
}
