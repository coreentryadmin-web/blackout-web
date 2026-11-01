import type { MeridianTimelineItem } from "./meridian-types";

/** Normalize user input for ticker / text matching. */
export function normalizeMeridianSearchQuery(raw: string): string {
  return raw.trim().toUpperCase();
}

/** True when the query looks like a US equity ticker (letters only, 1–5 chars). */
export function isTickerLikeQuery(query: string): boolean {
  const q = normalizeMeridianSearchQuery(query);
  return q.length >= 1 && q.length <= 5 && /^[A-Z]+$/.test(q);
}

/** Client-side filter — ticker prefix, title, or subtitle contains query. */
export function filterMeridianTimelineItems(
  items: readonly MeridianTimelineItem[],
  rawQuery: string
): MeridianTimelineItem[] {
  const q = normalizeMeridianSearchQuery(rawQuery);
  if (!q) return [...items];
  return items.filter((item) => {
    const ticker = item.ticker?.toUpperCase() ?? "";
    const title = item.title.toUpperCase();
    const subtitle = item.subtitle?.toUpperCase() ?? "";
    return (
      ticker.startsWith(q) ||
      ticker.includes(q) ||
      title.includes(q) ||
      subtitle.includes(q)
    );
  });
}

/**
 * Find the timeline row id for an earnings ticker, or `null` when the window has none.
 *
 * THE SINGLE LOOKUP every "click a ticker, open its earnings event" control must share, rather
 * than each caller re-deriving `earnings:${ticker}:${date}` by hand. `allItems` here is already
 * the OPTIONABLE-FILTERED set `loadMeridianEarningsTimeline` serves — prints on names with no
 * listed options chain never become a timeline row at all (see that loader's own comment) — but
 * three OTHER server payloads (`earnings_week`, `estimate_revision_timeline`,
 * `recent_earnings_revisions`) are built from the raw, unfiltered Benzinga window and can legally
 * name a ticker that filter dropped. A caller that hand-builds the id anyway (`earnings:${ticker}:
 * ${date}`) and navigates unconditionally sends the reader to a selected id with no matching row —
 * the detail pane renders "Select a catalyst", a dead click that looks like a broken button, not
 * an absence. Returning `null` here lets every caller no-op instead, the same contract
 * `MeridianDesk`'s own `selectEarningsTicker` already documents for the analytics-panel clicks.
 *
 * Lives here, not in `meridian-timeline.ts`, because that module transitively imports
 * `server-only` (via `meridian-benzinga-earnings-core.ts` → `uw-earnings.ts`) — this file is this
 * desk's existing client-safe home for pure `MeridianTimelineItem[]` lookups, the same reason
 * `filterMeridianTimelineItems` above lives here instead.
 */
export function findEarningsTimelineItemId(
  items: readonly MeridianTimelineItem[],
  ticker: string
): string | null {
  const target = ticker.trim().toUpperCase();
  if (!target) return null;
  const match = items.find(
    (it) => it.kind === "earnings" && (it.ticker ?? "").toUpperCase() === target
  );
  return match?.id ?? null;
}
