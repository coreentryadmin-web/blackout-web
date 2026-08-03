import { SITE } from "@/lib/site";
import { appendUtmParams, type AttributionParams } from "@/lib/analytics/utm";

/** Build a shareable Academy URL with UTM params for X/Discord posts. */
export function academyShareUrl(
  path: string,
  campaign: string,
  source: "x" | "discord" | "newsletter" = "x",
): string {
  const base = `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
  const utm: AttributionParams = {
    utm_source: source,
    utm_medium: "social",
    utm_campaign: campaign,
  };
  return appendUtmParams(base, utm);
}

/** Ready-to-post X copy for Academy articles (operator can paste + post). */
export const ACADEMY_X_POSTS: { path: string; campaign: string; text: string }[] = [
  {
    path: "/learn/what-is-gex",
    campaign: "academy-gex",
    text: "Positive GEX = chop. Negative GEX = trend days. Here's how to read dealer gamma exposure in plain English →",
  },
  {
    path: "/learn/dealer-gamma-options-flow-guide",
    campaign: "academy-dealer-gamma",
    text: "The complete map to dealer gamma, options flow, and the levels desks actually trade — free guide →",
  },
  {
    path: "/learn/how-to-trade-spx-options",
    campaign: "academy-spx-options",
    text: "How to trade SPX options without guessing — regime, walls, and 0DTE structure first →",
  },
  {
    path: "/learn/0dte-spx-options-strategy",
    campaign: "academy-0dte",
    text: "0DTE SPX is not a coin flip if you read dealer positioning first. Structured guide →",
  },
  {
    path: "/learn/how-to-read-options-flow",
    campaign: "academy-flow",
    text: "Options flow is not noise — here's how to separate institutional signal from hedging →",
  },
  {
    path: "/learn/market-maker-hedging-explained",
    campaign: "academy-mm-hedging",
    text: "Market makers hedge every options trade — that's what creates gamma flip, walls, and SPX pins →",
  },
  {
    path: "/learn/best-0dte-trading-strategies",
    campaign: "academy-0dte-strategies",
    text: "The best 0DTE strategy depends on dealer gamma that day — four structured plays →",
  },
];

export function formatXPost(entry: (typeof ACADEMY_X_POSTS)[number]): string {
  const url = academyShareUrl(entry.path, entry.campaign, "x");
  return `${entry.text}\n\n${url}`;
}
