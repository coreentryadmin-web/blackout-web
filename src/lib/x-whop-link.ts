import type { PostType } from "@/lib/x-content-types";

const WHOP_BASE = "https://whop.com/blackout-2d9c";
const SITE_PRICING = "https://blackouttrades.com/pricing";

function utmParams(campaign: string): URLSearchParams {
  return new URLSearchParams({
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: campaign,
  });
}

/** Trackable Whop checkout (legacy deep link). */
export function whopMarketingUrl(postType?: PostType): string {
  const campaign = postType ?? "desk";
  return `${WHOP_BASE}?${utmParams(campaign)}`;
}

/** Primary X → site funnel (pricing + sign-up path). */
export function siteMarketingUrl(postType?: PostType): string {
  const campaign = postType ?? "desk";
  return `${SITE_PRICING}?${utmParams(campaign)}`;
}

/** Short footer line for tweets (no https — saves chars). Site first for discovery. */
export function xPostFooterLine(postType?: PostType): string {
  const url = siteMarketingUrl(postType).replace(/^https:\/\//, "");
  return `@BlackOutTrade ${url}`;
}
