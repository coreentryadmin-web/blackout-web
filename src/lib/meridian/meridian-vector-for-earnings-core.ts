import type {
  MeridianEarningsVectorFlowPrint,
  MeridianEarningsVectorRead,
  MeridianEarningsVectorWallEvent,
} from "@/features/meridian/lib/meridian-types";
import type { VectorFlowMarkers } from "@/features/vector/lib/vector-flow-markers-server";
import type { VectorRegimePosture } from "@/features/vector/lib/vector-regime";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";
import { fmtPremium } from "@/lib/fmt-money";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

export type MeridianVectorDeskInputs = {
  horizon: string | null;
  spot: number | null;
  expiry: string | null;
  move_pct: number | null;
  bands: MeridianEarningsVectorRead["bands"];
  regime: VectorRegimePosture | null | undefined;
  gexWalls: GexWalls | null | undefined;
  gammaFlip: number | null | undefined;
  maxPain: number | null | undefined;
  wallHistory: WallHistorySample[] | null | undefined;
  wallEvents: VectorWallEvent[] | null | undefined;
  flowMarkers: VectorFlowMarkers | null | undefined;
  freshness_note: string | null;
};

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function describeMeridianVectorRegime(posture: VectorRegimePosture | null | undefined): string | null {
  switch (posture) {
    case "long":
      return "Long gamma · mean-revert";
    case "short":
      return "Short gamma · momentum";
    case "transition":
      return "At gamma flip";
    default:
      return null;
  }
}

function shapeWallEvents(events: VectorWallEvent[] | null | undefined): MeridianEarningsVectorWallEvent[] {
  if (!events?.length) return [];
  return events.slice(0, 6).map((ev) => {
    const stamp = Number.isFinite(ev.time) ? etStamp(ev.time) : null;
    return {
      message: ev.message,
      severity: ev.severity,
      time_label: stamp ? stamp.slice(11, 16) : null,
    };
  });
}

function shapeFlowPrints(markers: VectorFlowMarkers | null | undefined): MeridianEarningsVectorFlowPrint[] {
  if (!markers?.available || !markers.prints.length) return [];
  return markers.prints.slice(0, 6).map((p) => {
    const stamp = Number.isFinite(p.tsMs) ? etStamp(p.tsMs) : null;
    return {
      premium_label: fmtPremium(p.premium),
      option_type: p.side ?? null,
      strike: num(p.strike),
      executed_at: stamp ? stamp.slice(11, 16) : null,
    };
  });
}

/** Map live Vector desk reads → Meridian Positioning inline card (beads + flow, not just EM bands). */
export function shapeMeridianVectorDeskRead(input: MeridianVectorDeskInputs): MeridianEarningsVectorRead {
  const callWall = num(input.gexWalls?.callWalls?.[0]?.strike);
  const putWall = num(input.gexWalls?.putWalls?.[0]?.strike);
  const beadSamples = input.wallHistory?.length ?? 0;
  const recentEvents = shapeWallEvents(input.wallEvents);
  const recentFlow = shapeFlowPrints(input.flowMarkers);
  const regimeLabel = describeMeridianVectorRegime(input.regime);

  const hasStructure = callWall != null || putWall != null || num(input.gammaFlip) != null;
  const hasTape = recentEvents.length > 0 || recentFlow.length > 0 || beadSamples > 0;
  const available = hasStructure || hasTape || input.move_pct != null;

  return {
    available,
    horizon: input.horizon,
    expiry: input.expiry,
    move_pct: input.move_pct,
    spot: input.spot,
    bands: input.bands,
    regime: regimeLabel,
    call_wall: callWall,
    put_wall: putWall,
    gamma_flip: num(input.gammaFlip),
    max_pain: num(input.maxPain),
    bead_samples: beadSamples,
    recent_events: recentEvents,
    recent_flow: recentFlow,
    freshness_note: input.freshness_note,
  };
}
