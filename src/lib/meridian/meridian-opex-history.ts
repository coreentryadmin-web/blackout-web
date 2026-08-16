import "server-only";

import { priorOpexDates } from "@/features/meridian/lib/meridian-timeline";
import { maxPainForExpiryFromHeatmap } from "@/lib/meridian/meridian-gex-reads";
import { spxReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { roundFloats } from "@/lib/round-floats";
import type { MeridianOpexHistoryRow } from "@/features/meridian/lib/meridian-types";

/** Prior monthly OpEx sessions with SPX reaction. */
export async function loadMeridianOpexHistory(beforeYmd: string): Promise<MeridianOpexHistoryRow[]> {
  const dates = priorOpexDates(beforeYmd, 6);
  const reactions = await spxReactionsForDates(dates);
  return roundFloats(
    dates.map((date) => {
      const rx = reactions.get(date);
      return {
        date,
        spx_session_pct: rx?.session_change_pct ?? null,
        spx_next_day_pct: rx?.next_day_change_pct ?? null,
        max_pain: null,
      };
    })
  );
}

/** Enrich with max pain when SPX heatmap is already in memory. */
export async function loadMeridianOpexHistoryWithHeatmap(
  beforeYmd: string,
  hm: { max_pain_by_expiry?: Record<string, number | null> } | null
): Promise<MeridianOpexHistoryRow[]> {
  const base = await loadMeridianOpexHistory(beforeYmd);
  if (!hm) return base;
  return base.map((row) => ({
    ...row,
    max_pain: maxPainForExpiryFromHeatmap(hm as never, row.date),
  }));
}
