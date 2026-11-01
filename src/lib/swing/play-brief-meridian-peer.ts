/**
 * Meridian peer-earnings cohort for swing play brief — cached via Largo loader.
 */
import { loadMeridianPeerCohortForLargo } from "@/lib/largo/meridian-peer-cohort-for-largo";
import { type SwingMeridianCatalystSlice } from "./play-brief-meridian";
import { pickEarningsForSwingPeer } from "./play-brief-meridian-peer-core";
import type { SwingMeridianPeerAvailable, SwingMeridianPeerSlice, SwingMeridianPeerUnavailable } from "./play-brief-meridian-peer-core";

export type { SwingMeridianPeerAvailable, SwingMeridianPeerUnavailable, SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";
export { meridianPeerEarningsCoaching } from "./play-brief-meridian-peer-core";

/**
 * The ONE "we tried and failed" sentinel for this read — shared by this function's own internal
 * catch below AND, as of the fix this comment documents, `play-brief-context.ts`'s OUTER
 * `withBriefSourceTimeout(...)` race around the call to this function. See
 * `play-brief-meridian.ts`'s sibling `meridianUnavailableSlice()` for the full gap this closes —
 * identical shape, one call site over: the outer race's own `.catch(() => null)` could collapse a
 * TIMEOUT to a bare `null`, which reads IDENTICAL to this function's own, legitimate, far-more-common
 * `null` ("no earnings catalyst within the Meridian window to look peers up for" — the two early
 * returns above) — a real fetch failure must not be allowed to hide behind that same honest-absence
 * value. Exported so `play-brief-context.ts`'s outer catch can converge on the exact same shape
 * instead of re-deriving (and risking drifting from) it.
 */
export function meridianPeerUnavailableSlice(): SwingMeridianPeerUnavailable {
  return {
    available: false,
    error: "fetch_failed",
    note: "Meridian peer cohort load threw — NOT evidence that no peers exist.",
  };
}

/** Load peer cohort when ticker has an upcoming earnings catalyst in the Meridian window. */
export async function fetchMeridianPeerForBrief(
  meridian: SwingMeridianCatalystSlice | null,
  ticker: string,
): Promise<SwingMeridianPeerSlice | null> {
  if (!meridian?.items.length) return null;

  const earnings = pickEarningsForSwingPeer(meridian.items, ticker);
  if (!earnings) return null;

  try {
    const cohort = await loadMeridianPeerCohortForLargo({
      id: earnings.id,
      kind: earnings.kind,
      ticker,
      date: earnings.date,
    });
    if (!cohort.available) return cohort as SwingMeridianPeerUnavailable;
    return cohort as SwingMeridianPeerAvailable;
  } catch {
    return meridianPeerUnavailableSlice();
  }
}
