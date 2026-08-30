import "server-only";

import { stockReactionsForPrints } from "@/lib/meridian/meridian-reaction";
import { loadMeridianEarningsPrintHistory } from "@/lib/meridian/meridian-earnings-history";
import {
  groupPrintKeysByTicker,
  printKeysFromUwRows,
  stampMeridianReactionsOnUwRows,
  type MeridianReactionStamp,
  type UwEarningsRow,
} from "@/lib/largo/meridian-earnings-for-largo-core";

/**
 * Attach Meridian timing-aware reactions to UW earnings rows.
 *
 * UW `reaction` is close-to-close on the report date's session; Meridian anchors BMO/AMC prints
 * to the correct session. The desk and `get_earnings.print_history` use Meridian — these tools
 * must not disagree when Largo picks the UW path by keyword overlap.
 */
export async function attachMeridianReactionsToUwRows(
  rows: readonly UwEarningsRow[]
): Promise<UwEarningsRow[]> {
  const keys = printKeysFromUwRows(rows);
  if (!keys.length) return [...rows];

  const byTicker = groupPrintKeysByTicker(keys);
  const reactionsByTickerDate = new Map<string, Map<string, MeridianReactionStamp>>();

  await Promise.all(
    [...byTicker.entries()].map(async ([ticker, printKeys]) => {
      const reactions = await stockReactionsForPrints(ticker, printKeys);
      const stamped = new Map<string, MeridianReactionStamp>();
      for (const [ymd, rx] of reactions.entries()) {
        stamped.set(ymd, {
          reaction_pct: rx.reaction_pct,
          reaction_basis: rx.reaction_basis,
          reaction_measure: rx.reaction_measure,
          reaction_settled: rx.reaction_settled,
        });
      }
      reactionsByTickerDate.set(ticker, stamped);
    })
  );

  return stampMeridianReactionsOnUwRows(rows, reactionsByTickerDate);
}

/** Per-ticker earnings history shaped like the desk History tab. */
export async function loadLargoMeridianEarningsHistory(ticker: string, limit = 12) {
  return loadMeridianEarningsPrintHistory(ticker, limit);
}
