import "server-only";

import { priorOpexDates } from "@/features/meridian/lib/meridian-timeline";
import { maxPainForExpiryStrict } from "@/lib/meridian/meridian-gex-reads";
import { spxReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { spxCloseOnDate } from "@/lib/meridian/meridian-intraday-reaction";
import { opexPinHeld } from "@/lib/meridian/meridian-analytics-core";
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
        spx_close: null,
        pin_held: null,
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
  const enriched = await Promise.all(
    base.map(async (row) => {
      // STRICT, never the whole-book fallback: every row here is a PAST OpEx, and the current
      // chain carries no strikes for an expiry that already settled. The fallback was handing
      // each row today's overall max pain — measured live 2026-08-21, all six prior rows
      // (2026-02-20 … 2026-07-17) read an identical `max_pain: 7685`. With `spx_close` fixed
      // below, that fallback would stop being a cosmetically-odd column and start producing
      // confidently WRONG `pin_held` verdicts, so the two must be fixed together.
      const max_pain = hm ? maxPainForExpiryStrict(hm as never, row.date) : row.max_pain;
      const spx_close = await spxCloseOnDate(row.date);
      const pin_held = opexPinHeld(spx_close, max_pain);
      return {
        ...row,
        max_pain,
        spx_close,
        pin_held,
      };
    })
  );
  // `loadMeridianOpexHistory` rounds its own rows, but the two fields ADDED here bypassed that
  // — and a raw Polygon index close carries IEEE-754 noise (live: 6506.4800000000005 for
  // 2026-03-20). Harmless while `spx_close` was permanently null; visible the moment it is not.
  return roundFloats(enriched);
}
