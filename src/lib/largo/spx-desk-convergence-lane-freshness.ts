import type { MergedSpxDeskBundle } from "@/features/spx/lib/spx-desk-loader";
import { spxDeskLaneFreshness } from "@/features/spx/lib/spx-desk-lane-freshness";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";

export type DeskConvergenceLaneFreshness = {
  lane: "pulse" | "desk" | "flow";
  label: string;
  status: string;
  as_of: string | null;
  /**
   * ET session date for `as_of` — Contract C1 (`session-anchor.test.ts`): a Largo-facing payload
   * that stamps a UTC instant must also carry an ET session anchor, since after ~20:00 ET the UTC
   * calendar date is already a day ahead of the real session. Additive, not a replacement for
   * `as_of` — see #2418/#2420/#2422 for the class of bug this guards against.
   */
  session_date: string | null;
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
    session_date: layer.asOf ? etSessionDate(layer.asOf.getTime()) : null,
  }));
}
