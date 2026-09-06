/**
 * Meridian peer-earnings cohort for swing play brief — cached via Largo loader.
 */
import { loadMeridianPeerCohortForLargo } from "@/lib/largo/meridian-peer-cohort-for-largo";
import { type SwingMeridianCatalystSlice } from "./play-brief-meridian";
import { pickEarningsForSwingPeer } from "./play-brief-meridian-peer-core";
import type { SwingMeridianPeerAvailable, SwingMeridianPeerSlice, SwingMeridianPeerUnavailable } from "./play-brief-meridian-peer-core";

export type { SwingMeridianPeerAvailable, SwingMeridianPeerUnavailable, SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";
export { meridianPeerEarningsCoaching } from "./play-brief-meridian-peer-core";

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
    return {
      available: false,
      error: "fetch_failed",
      note: "Meridian peer cohort load threw — NOT evidence that no peers exist.",
    };
  }
}
