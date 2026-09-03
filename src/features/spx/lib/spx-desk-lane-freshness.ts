import type { FreshnessStatus } from "@/components/ui/FreshnessChip";
import {
  SPX_FLOW_POLL_MS,
  SPX_FULL_DESK_POLL_MS,
  SPX_PULSE_REST_POLL_MS,
  SPX_PULSE_REST_SSE_POLL_MS,
} from "@/features/spx/lib/spx-desk-poll-ms";

export type SpxDeskLaneKey = "pulse" | "desk" | "flow";

export type SpxDeskLaneFreshnessLayer = {
  lane: SpxDeskLaneKey;
  label: string;
  status: FreshnessStatus;
  asOf: Date | null;
  title: string;
};

export type SpxDeskLaneFreshnessInput = {
  nowMs: number;
  sessionActive: boolean;
  pulsePolledAt?: string | null;
  deskPolledAt?: string | null;
  flowPolledAt?: string | null;
  pulseValidating?: boolean;
  deskValidating?: boolean;
  flowValidating?: boolean;
  pulseSseConnected?: boolean;
  feedStalled?: boolean;
};

const LANE_META: Record<
  SpxDeskLaneKey,
  { label: string; title: string; staleAfterMs: number }
> = {
  pulse: {
    label: "Pulse",
    title: "Fast SPX index lane — spot, session state, halts (~1–2s poll).",
    staleAfterMs: SPX_PULSE_REST_SSE_POLL_MS + 1_500,
  },
  desk: {
    label: "Desk",
    title: "Full desk rebuild — walls, VWAP, GEX, enrichment (~2s poll).",
    staleAfterMs: SPX_FULL_DESK_POLL_MS + 2_500,
  },
  flow: {
    label: "Flow",
    title: "UW flow tape + strike stacks overlay (~2s poll).",
    staleAfterMs: SPX_FLOW_POLL_MS + 2_500,
  },
};

function parsePolledAt(stamp?: string | null): Date | null {
  if (!stamp) return null;
  const t = new Date(stamp).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

function laneStatus(
  asOf: Date | null,
  validating: boolean,
  sessionActive: boolean,
  staleAfterMs: number,
  nowMs: number
): FreshnessStatus {
  if (!sessionActive) return asOf ? "cached" : "offline";
  if (validating && !asOf) return "syncing";
  if (!asOf) return validating ? "syncing" : "offline";
  const ageMs = nowMs - asOf.getTime();
  if (ageMs > staleAfterMs) return "stale";
  return "live";
}

/** Pure lane freshness model for the SPX header strip. */
export function spxDeskLaneFreshness(input: SpxDeskLaneFreshnessInput): SpxDeskLaneFreshnessLayer[] {
  const pulseStaleAfter = input.pulseSseConnected
    ? LANE_META.pulse.staleAfterMs
    : SPX_PULSE_REST_POLL_MS + 1_500;

  const layers: Array<{ lane: SpxDeskLaneKey; polledAt?: string | null; validating?: boolean; staleAfterMs: number }> =
    [
      {
        lane: "pulse",
        polledAt: input.pulsePolledAt,
        validating: input.pulseValidating,
        staleAfterMs: pulseStaleAfter,
      },
      {
        lane: "desk",
        polledAt: input.deskPolledAt,
        validating: input.deskValidating,
        staleAfterMs: LANE_META.desk.staleAfterMs,
      },
      {
        lane: "flow",
        polledAt: input.flowPolledAt,
        validating: input.flowValidating,
        staleAfterMs: LANE_META.flow.staleAfterMs,
      },
    ];

  return layers.map(({ lane, polledAt, validating, staleAfterMs }) => {
    const meta = LANE_META[lane];
    const asOf = parsePolledAt(polledAt);
    let status = laneStatus(
      asOf,
      Boolean(validating),
      input.sessionActive,
      staleAfterMs,
      input.nowMs
    );
    if (lane === "pulse" && input.feedStalled && status === "live") {
      status = "stale";
    }
    return {
      lane,
      label: meta.label,
      status,
      asOf,
      title: meta.title,
    };
  });
}
