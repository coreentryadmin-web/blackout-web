/**
 * Per-ticker data fusion bundle for Swing Engine V2 Tier-1 enrich.
 *
 * Extends swing-ingest reads with cross-product positioning (P2) and BIE echo.
 * P1 ships the type contract + null-honest assembly hook; GEX/Vector/DP wired in P2.
 */

import type { PlayDirection } from "../../horizon-fanout";
import type { FlowAccumulationSignal } from "@/features/nighthawk/lib/flow-accumulation";
import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import type { SwingDiscoveryPath } from "../discovery";
import type { SwingCatalystNewsItem, SwingEarningsWindows } from "../swing-catalyst";

/** Which Tier-0 origins fired for this ticker. */
export type SwingOriginKind = SwingDiscoveryPath | "POSITIONING" | "CATALYST" | "BANGER" | "VECTOR";

export interface SwingPositioningRead {
  netGexSign: "positive" | "negative" | "neutral" | null;
  flipDistancePct: number | null;
  wallIntegrity: number | null;
  nearestWallStrike: number | null;
  source: "thermal" | "vector" | null;
}

export interface SwingDataFusionBundle {
  ticker: string;
  direction: PlayDirection | null;
  origins: SwingOriginKind[];
  accumulation: FlowAccumulationSignal | null;
  mover: BreakoutMover | null;
  spyCloses: number[];
  asOf: string;
  sessionDay: string;
  intendedDte: number;
  /** Existing swing-ingest outputs (populated by assembleSwingDataFusion). */
  catalystNews: SwingCatalystNewsItem[] | null;
  earningsWindows: SwingEarningsWindows | null;
  ivRank: number | null;
  /** P2 — null until positioning origin ships. */
  positioning: SwingPositioningRead | null;
  /** P2 — null until dark pool rail ships. */
  darkPoolBias: number | null;
  /** P2 — null until BIE bundle wired. */
  ecosystemScore: number | null;
}

export interface AssembleSwingDataFusionArgs {
  ticker: string;
  paths: SwingDiscoveryPath[];
  accumulation: FlowAccumulationSignal | null;
  mover: BreakoutMover | null;
  spyCloses: number[];
  asOf: string;
  sessionDay: string;
  intendedDte: number;
  catalystNews?: SwingCatalystNewsItem[] | null;
  earningsWindows?: SwingEarningsWindows | null;
  ivRank?: number | null;
}

/**
 * Build the V2 fusion bundle from Tier-1 inputs. P1: passthrough + placeholder nulls
 * for P2 reads so downstream modules can depend on the shape now.
 */
export function assembleSwingDataFusion(args: AssembleSwingDataFusionArgs): SwingDataFusionBundle {
  const direction =
    args.accumulation?.direction === "bull"
      ? "LONG"
      : args.accumulation?.direction === "bear"
        ? "SHORT"
        : args.mover && args.mover.gain < 0
          ? "SHORT"
          : args.mover
            ? "LONG"
            : null;

  return {
    ticker: args.ticker.toUpperCase(),
    direction,
    origins: [...args.paths],
    accumulation: args.accumulation,
    mover: args.mover,
    spyCloses: args.spyCloses,
    asOf: args.asOf,
    sessionDay: args.sessionDay,
    intendedDte: args.intendedDte,
    catalystNews: args.catalystNews ?? null,
    earningsWindows: args.earningsWindows ?? null,
    ivRank: args.ivRank ?? null,
    positioning: null,
    darkPoolBias: null,
    ecosystemScore: null,
  };
}

/** True when both FLOW and STRUCTURE paths fired — eligible for lowered flow floor in V2. */
export function isCorroboratedTierZero(paths: readonly SwingDiscoveryPath[]): boolean {
  const set = new Set(paths);
  return set.has("FLOW") && set.has("STRUCTURE");
}
