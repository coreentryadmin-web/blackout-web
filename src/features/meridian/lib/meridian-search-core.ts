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
