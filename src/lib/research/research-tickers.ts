/**
 * Which tickers get a public research page.
 *
 * ONE SOURCE, READ BY THREE PLACES — the route's validity check, the index hub, and the sitemap.
 * When those drift, the failure is quiet and expensive in both directions: a sitemap entry with
 * no route is a crawl error on every pass, and a route with no sitemap entry is a page nothing
 * ever finds. Keeping them on one list is the only arrangement where they cannot disagree.
 *
 * The set is the STATIC heatmap allowlist — the names whose dealer-gamma rails the recorder cron
 * covers from the opening bell every session, so a 60-session window is actually populated.
 *
 * NOT the dynamic universe. `listDynamicUniverseTickers()` grows and shrinks with what members
 * happen to open, and a URL that appears because someone looked at a symbol last Tuesday and
 * 404s a fortnight later when it ages out is precisely the churn that gets a site's programmatic
 * section treated as unstable. Public URLs have to be durable, so they come from the fixed list.
 */

import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";

/**
 * Manual escape hatch, deliberately EMPTY.
 *
 * It exists so a symbol can be pulled from the public set without editing the heatmap allowlist
 * (which is load-bearing for the overlay budget and should not be edited for SEO reasons). It is
 * empty because nothing has been MEASURED as needing exclusion, and guessing which rails are thin
 * would put a fabricated rationale in the one file three other places trust.
 *
 * The real thin-data defence is the coverage floor: a ticker without enough recorded sessions
 * fails `isPublishable` and its route 404s. That check reads actual data, which an exclusion list
 * written from intuition cannot. Add a symbol here only with a coverage number to justify it.
 */
const EXCLUDED = new Set<string>();

/** Alphabetical so the hub and the sitemap have a stable, reviewable order. */
export function researchTickers(): string[] {
  return vectorUniverseTickers()
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && !EXCLUDED.has(t))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .sort();
}

/** Route guard — anything off this list 404s rather than triggering a data fetch. */
export function isResearchTicker(ticker: string | null | undefined): boolean {
  const t = String(ticker ?? "").trim().toUpperCase();
  return t.length > 0 && researchTickers().includes(t);
}

/** Canonical public path for a ticker's research page. Lowercase — URLs are not shouted. */
export function researchTickerPath(ticker: string): string {
  return `/research/gamma-levels/${ticker.trim().toLowerCase()}`;
}
