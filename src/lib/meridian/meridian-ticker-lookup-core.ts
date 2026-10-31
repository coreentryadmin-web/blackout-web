/**
 * Pure selection logic behind Meridian's ticker-earnings lookup — split out of
 * `meridian-ticker-lookup.ts` (which imports `"server-only"` and therefore cannot be loaded
 * directly by a plain `tsx --test` run) so the selection rule itself is unit-testable.
 */
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

/**
 * The next NOT-YET-REPORTED earnings row for this ticker, from a `date.gte=today`-filtered
 * candidate list.
 *
 * BUG THIS FIXES (live-reachable, not theoretical): the previous selection was
 * `rows.find((r) => r.date >= today && r.actual_eps == null) ?? rows[0] ?? null` — whenever
 * NO row satisfied `actual_eps == null` (every earnings date Benzinga currently has on file
 * for this ticker has already reported — the common case right after a same-day BMO print,
 * before the next quarter's date has been calendared), it silently fell back to `rows[0]`,
 * the OLDEST of those already-reported rows, and returned it as `found: true` with a message
 * like "AAPL reports 2026-10-31" — describing an earnings print that already happened as
 * upcoming. `days_until` for that row is 0 (today), so the message reads as "reports today"
 * even though the number was already out.
 *
 * This isn't just the admin lookup route: `vector-pick-enrichment.ts` calls
 * `loadMeridianTickerLookup` for every Vector desk pick and surfaces the result verbatim as
 * an "earnings" catalyst card on the trade setup — so a trader opening a position right after
 * a ticker's BMO print could be shown a stale "earnings today" catalyst for a risk that had
 * already resolved, with no signal that it is stale.
 *
 * The fix is to return null (genuinely "no upcoming earnings found") rather than guess — the
 * same honest-absence discipline this module already uses for the "no rows at all" case.
 */
export function pickUpcomingEarningsRow(
  rows: readonly BenzingaStructuredEarnings[],
  today: string
): BenzingaStructuredEarnings | null {
  return rows.find((r) => r.date >= today && r.actual_eps == null) ?? null;
}
