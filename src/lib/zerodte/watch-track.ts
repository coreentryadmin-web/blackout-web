/**
 * WATCH-only hypothetical track — how far a candidate has moved since the desk flagged it,
 * WITHOUT implying a committed position. Uses the same premium math as pinnedLivePnlPct but
 * anchors to the flow fill / entry band (0DTE) or underlying at flag (Swings).
 */
import { pinnedLivePnlPct } from "./marks-math";

/** Plan fields that ground a WATCH track anchor for a 0DTE setup. */
export type WatchPlanRef = {
  flow_avg_fill?: number | null;
  entry_max?: number | null;
};

/** Grounded reference premium for a WATCH 0DTE setup — flow fill first, then entry max. */
export function watchReferencePremium(plan: WatchPlanRef | null | undefined): number | null {
  const fill = plan?.flow_avg_fill;
  if (typeof fill === "number" && Number.isFinite(fill) && fill > 0) return fill;
  const max = plan?.entry_max;
  if (typeof max === "number" && Number.isFinite(max) && max > 0) return max;
  return null;
}

/** Hypothetical premium move % since the WATCH anchor — null when ungrounded. */
export function watchTrackPct(referencePremium: number | null, mark: number | null): number | null {
  return pinnedLivePnlPct(referencePremium, mark);
}

/** Underlying % move since flag for a swing WATCH (stock-level proxy). */
export function watchUnderlyingTrackPct(
  direction: "long" | "short" | "LONG" | "SHORT",
  flagPx: number | null,
  spot: number | null,
): number | null {
  if (flagPx == null || !(flagPx > 0) || spot == null || !(spot > 0)) return null;
  const raw = ((spot - flagPx) / flagPx) * 100;
  const dir = String(direction).toLowerCase();
  const signed = dir === "short" ? -raw : raw;
  return Math.round(signed * 100) / 100;
}
