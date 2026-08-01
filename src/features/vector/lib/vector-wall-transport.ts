import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import {
  DOMINANT_WALLS_PER_BUCKET,
  type WallHistorySample,
} from "./vector-wall-history";
import type { VectorSeedProps } from "./vector-seed-props";

/**
 * Wall depth shipped over HTTP/SSE — matches the bead renderer's dominance filter
 * (top-N per side per bucket). The recorder persists VECTOR_WALL_NODES_PER_SIDE (20)
 * for integrity/ladder reads, but trails only draw DOMINANT_WALLS_PER_BUCKET (3).
 * Shipping all 20 × 5760 samples × dual GEX/VEX lenses was ~50MB on /vector SSR.
 */
export const VECTOR_TRANSPORT_WALLS_PER_SIDE = DOMINANT_WALLS_PER_BUCKET;

/** SSE attach frame: full session timeline, but never more than this many samples. */
export const VECTOR_SSE_FULL_FRAME_MAX_SAMPLES = 1920;

function trimWallsSide(walls: GexWalls, maxPerSide: number): GexWalls {
  return {
    callWalls: walls.callWalls.slice(0, maxPerSide),
    putWalls: walls.putWalls.slice(0, maxPerSide),
  };
}

/** One history row with ladder depth capped for wire size. */
export function trimWallHistorySampleForTransport(
  sample: WallHistorySample,
  maxPerSide = VECTOR_TRANSPORT_WALLS_PER_SIDE
): WallHistorySample {
  return {
    ...sample,
    walls: trimWallsSide(sample.walls, maxPerSide),
    vexWalls: sample.vexWalls ? trimWallsSide(sample.vexWalls, maxPerSide) : sample.vexWalls,
  };
}

export function trimWallHistoryForTransport(
  history: WallHistorySample[],
  opts?: { maxPerSide?: number; maxSamples?: number }
): WallHistorySample[] {
  const maxPerSide = opts?.maxPerSide ?? VECTOR_TRANSPORT_WALLS_PER_SIDE;
  let out = history.map((s) => trimWallHistorySampleForTransport(s, maxPerSide));
  const maxSamples = opts?.maxSamples;
  if (maxSamples != null && maxSamples > 0 && out.length > maxSamples) {
    out = out.slice(out.length - maxSamples);
  }
  return out;
}

/** Client seed API + SSE attach — trim wall rails, keep bars/walls/flips intact. */
export function trimVectorSeedForTransport(seed: VectorSeedProps): VectorSeedProps {
  return {
    ...seed,
    initialWallHistory: trimWallHistoryForTransport(seed.initialWallHistory),
    initialHorizonWallHistory: trimWallHistoryForTransport(seed.initialHorizonWallHistory),
  };
}
