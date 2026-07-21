import type { PostType } from "@/lib/x-content-types";
import { xDeskPostIncludeUrl } from "@/lib/x-marketing-env";

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

/**
 * Short footer for desk autopost.
 * PPU default: no URL in tweet ($0.015/post) — profile bio has pricing link.
 * Set X_DESK_POST_INCLUDE_URL=1 for in-post link ($0.20/post on pay-per-use).
 */
export function xPostFooterLine(
  postType?: PostType,
  opts?: { includeUrl?: boolean },
): string {
  const includeUrl = opts?.includeUrl ?? xDeskPostIncludeUrl();
  if (includeUrl) {
    const url = siteMarketingUrl(postType).replace(/^https:\/\//, "");
    return `@BlackOutTrade ${url}`;
  }
  return "@BlackOutTrade · link in bio";
}
