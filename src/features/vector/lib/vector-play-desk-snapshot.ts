import type { VectorPlayEmit } from "@/features/vector/lib/vector-play-engine";
import type { VectorRegime } from "@/features/vector/lib/vector-regime";
import type { GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import type { WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import type { WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";

/** Play-engine desk state exported from VectorPageShell for Compare's focused play strip. */
export type VectorPlayDeskSnapshot = {
  playEmit: VectorPlayEmit | null;
  regime: VectorRegime;
  expectedMove: string[];
  confluence: string[] | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
  magnet: GammaMagnet | null;
  proximity: WallProximity | null;
  chartReplayMode: boolean;
};
