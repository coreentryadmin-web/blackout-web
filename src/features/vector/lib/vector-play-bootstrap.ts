import type { VectorWalls } from "@/lib/api";
import type { VectorDarkPoolLevel } from "./vector-dark-pool-levels";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import { deriveGammaMagnet } from "./vector-gamma-magnet";
import { deriveVectorRegime } from "./vector-regime";
import { deriveWallProximity } from "./vector-wall-proximity";
import {
  buildVectorPlay,
  vectorPlayBieBucketKey,
  type VectorPlayEmit,
  type VectorPlayInput,
} from "./vector-play-engine";

/**
 * First-frame suggested play from SSR/client seed (bars + walls + flip) — before VectorChart
 * finishes mounting lightweight-charts and before the first SSE tick. Without this the play
 * rail stays blank for 5–15s on cold ticker loads (on-demand names, SPX index) even though
 * bootstrap data is already on the page.
 */
export function bootstrapVectorPlayEmit(opts: {
  ticker: string;
  horizon: VectorDteHorizon;
  timeframeMin: number;
  spot: number | null | undefined;
  walls: VectorWalls | null | undefined;
  gammaFlip: number | null | undefined;
  darkPoolLevels?: readonly VectorDarkPoolLevel[];
}): VectorPlayEmit | null {
  const spot = opts.spot;
  if (spot == null || !(spot > 0)) return null;

  const walls = opts.walls ?? null;
  const flip = opts.gammaFlip ?? null;
  const regime = deriveVectorRegime({
    spot,
    gammaFlip: flip,
    topCallWall: walls?.callWalls?.[0]?.strike ?? null,
    topPutWall: walls?.putWalls?.[0]?.strike ?? null,
  });
  const magnet = deriveGammaMagnet({ spot, walls, posture: regime.posture });
  const proximity = deriveWallProximity({
    spot,
    walls,
    gammaFlip: flip,
    prev: null,
  });

  const playInput: VectorPlayInput = {
    ticker: opts.ticker,
    horizon: opts.horizon,
    timeframeMin: opts.timeframeMin,
    spot,
    regime: { posture: regime.posture },
    gexWalls: walls,
    gammaFlip: flip,
    magnet,
    proximity,
    expectedMove: null,
    maxPain: null,
    confluenceZones: [],
    wallIntegrity: null,
    technicals: null,
    platformInputs: null,
    dataAgeMs: null,
    bie: null,
  };

  const play = buildVectorPlay(playInput);
  if (!play) return null;

  return {
    play,
    spot,
    callWall: walls?.callWalls?.[0]?.strike ?? null,
    putWall: walls?.putWalls?.[0]?.strike ?? null,
    magnetStrike: magnet?.strike ?? null,
    gammaFlip: flip,
    regimePosture: regime.posture,
    technicals: null,
    confluenceZones: [],
    darkPoolLevels: [...(opts.darkPoolLevels ?? [])],
    bieBucket: vectorPlayBieBucketKey(playInput),
  };
}
