import type { MergedSpxDeskBundle } from "@/features/spx/lib/spx-desk-loader";
import { spxDeskLaneFreshness } from "@/features/spx/lib/spx-desk-lane-freshness";

export type DeskConvergenceLaneFreshness = {
  lane: "pulse" | "desk" | "flow";
  label: string;
  status: string;
  as_of: string | null;
};

/** Server-side lane freshness for Largo — mirrors SpxDeskLaneFreshness header strip. */
export function deskConvergenceLaneFreshness(
  bundle: MergedSpxDeskBundle,
  nowMs: number = Date.now()
): DeskConvergenceLaneFreshness[] {
  return spxDeskLaneFreshness({
    nowMs,
    sessionActive: Boolean(bundle.merged.market_open),
    pulsePolledAt: bundle.pulse?.polled_at ?? bundle.merged.polled_at ?? null,
    deskPolledAt: bundle.desk?.polled_at ?? bundle.merged.polled_at ?? null,
    flowPolledAt: bundle.flow?.polled_at ?? null,
    feedStalled: Boolean(bundle.merged.feed_stalled),
  }).map((layer) => ({
    lane: layer.lane,
    label: layer.label,
    status: layer.status,
    as_of: layer.asOf?.toISOString() ?? null,
  }));
}
