/**
 * Merge SPX Slayer execution levels with Vector suggested-play levels for the embedded chart.
 *
 * Priority: committed/open Slayer risk always wins; else an actionable Slayer idea; else Vector's
 * structure-based idea when the desk is flat/scanning.
 */
import type { VectorPlayEmit } from "@/features/vector/lib/vector-play-engine";
import {
  playPayloadToLevelsInput,
  type PlayLevelsInput,
  type SpxPlayLevelsSource,
} from "@/features/vector/lib/vector-play-levels";

function finite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Map Vector's fused play into dotted chart lines when Slayer has nothing actionable yet. */
export function vectorEmitToPlayLevelsInput(emit: VectorPlayEmit | null): PlayLevelsInput {
  const empty: PlayLevelsInput = {
    state: "none",
    direction: null,
    entry: null,
    stop: null,
    target: null,
    invalidation: null,
  };
  if (!emit?.play || !(emit.spot > 0)) return empty;

  const { play, spot, callWall, putWall, magnetStrike, gammaFlip } = emit;
  if (play.setup === "stand-aside") return empty;

  const direction =
    play.bias === "long" ? "long" : play.bias === "short" ? "short" : null;
  if (!direction) return empty;

  // Skip very low-conviction reads — don't draw phantom levels on a weak C-grade flicker.
  if (play.grade === "C" && play.conviction < 52) return empty;

  const entry = spot;
  let stop: number | null = null;
  let target: number | null = null;

  if (direction === "long") {
    stop =
      finite(putWall) ??
      (gammaFlip != null && gammaFlip < spot ? finite(gammaFlip) : null);
    target = finite(callWall) ?? finite(magnetStrike);
  } else {
    stop =
      finite(callWall) ??
      (gammaFlip != null && gammaFlip > spot ? finite(gammaFlip) : null);
    target = finite(putWall) ?? finite(magnetStrike);
  }

  if (target == null && stop == null) return empty;

  return {
    state: "idea",
    direction,
    entry,
    stop,
    target,
    invalidation: stop,
  };
}

export function mergeSpxChartPlayLevels(
  slayer: PlayLevelsInput,
  vector: PlayLevelsInput
): PlayLevelsInput {
  if (slayer.state === "open" || slayer.state === "idea") return slayer;
  if (vector.state === "idea") return vector;
  return slayer;
}

/** Slayer payload + Vector emit → chart overlay input. */
export function resolveSpxChartPlayLevels(
  slayerPlay: SpxPlayLevelsSource,
  vectorEmit: VectorPlayEmit | null
): PlayLevelsInput {
  return mergeSpxChartPlayLevels(
    playPayloadToLevelsInput(slayerPlay),
    vectorEmitToPlayLevelsInput(vectorEmit)
  );
}
