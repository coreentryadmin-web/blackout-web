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
        // This loader never looks at a chain at all — the heatmap variant below is the only one
        // that can resolve max pain. Say "not attempted" rather than leaving a bare null that
        // reads the same as "looked and found nothing".
        max_pain_basis: null,
        max_pain_unavailable: {
          reason: "max_pain_not_requested_on_this_path",
          what_is_missing:
            "This loader resolves reactions only. Max pain comes from loadMeridianOpexHistoryWithHeatmap, which needs an SPX heatmap.",
          retryable: true,
        },
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
      //
      // WHAT THIS DOES AND DOES NOT RESTORE. Strict yields null for every settled expiry, because
      // `fetchGexHeatmap` PRUNES settled expiries out of `max_pain_by_expiry` by design (verified
      // live 2026-08-21: 54 keys, earliest 2026-08-21, all six prior OpEx dates absent). So
      // `pin_held` stays null, `buildOpexPinAccuracy` still grades 0 rows, and the pin-accuracy
      // headline still reads "insufficient graded history". This fix replaces a WRONG number with
      // an honest absence; it does not resurrect the metric. Doing that needs max pain snapshotted
      // from open interest AT the expiry — the live chain cannot answer a question about a
      // settlement that has already happened.
      const max_pain = hm ? maxPainForExpiryStrict(hm as never, row.date) : row.max_pain;
      const spx_close = await spxCloseOnDate(row.date);
      const pin_held = opexPinHeld(spx_close, max_pain);
      return {
        ...row,
        max_pain,
        spx_close,
        pin_held,
        // A bare null cannot be told apart from "there was no pin". Say which it is, and say
        // that it will never resolve on a retry — otherwise a reader (or a future Largo tool
        // reading this payload) can take the blank for a finding.
        max_pain_basis: max_pain != null ? ("expiry_open_interest" as const) : null,
        max_pain_unavailable:
          max_pain != null
            ? null
            : {
                reason: "settled_expiry_not_in_live_chain",
                what_is_missing:
                  "Max pain for a settled expiry requires that expiry's open interest as it stood at settlement. The live SPX chain prunes settled expiries, and historical OI is not stored.",
                retryable: false,
              },
      };
    })
  );
  // NOT rounded here. `buildMeridianOpexDetail` (meridian-event-brief.ts) already wraps the whole
  // payload — `prior_opex` included — in a deep `roundFloats`, so the IEEE-754 noise never reached
  // the wire. Rounding again HERE would also land ahead of `buildOpexPinAccuracy`, which re-derives
  // each verdict from these rows: rounding inside a compute path changes the calculation, which is
  // the one thing round-floats.ts is explicit about not doing.
  return enriched;
}
