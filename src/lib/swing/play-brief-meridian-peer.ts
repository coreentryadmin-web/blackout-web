/**
 * Meridian peer-earnings cohort for swing play brief — cached via Largo loader.
 */
import { loadMeridianPeerCohortForLargo } from "@/lib/largo/meridian-peer-cohort-for-largo";
import type { SwingMeridianCatalystSlice } from "./play-brief-meridian";
import type { SwingMeridianPeerAvailable, SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";

export type { SwingMeridianPeerAvailable, SwingMeridianPeerSlice } from "./play-brief-meridian-peer-core";
export { meridianPeerEarningsCoaching } from "./play-brief-meridian-peer-core";

/** Load peer cohort when ticker has an upcoming earnings catalyst in the Meridian window. */
export async function fetchMeridianPeerForBrief(
  meridian: SwingMeridianCatalystSlice | null,
  ticker: string,
): Promise<SwingMeridianPeerSlice | null> {
  if (!meridian?.items.length) return null;

  const earnings = meridian.items.find(
    (i) => i.kind === "earnings" && i.days_until >= 0 && i.days_until <= 14,
  );
  if (!earnings) return null;

  try {
    const cohort = await loadMeridianPeerCohortForLargo({
      id: earnings.id,
      kind: earnings.kind,
      ticker,
      date: earnings.date,
    });
    if (!cohort.available) return null;
    return cohort as SwingMeridianPeerAvailable;
  } catch {
    return null;
  }
}
