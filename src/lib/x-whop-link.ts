import type { PostType } from "@/lib/x-content-types";

const WHOP_BASE = "https://whop.com/blackout-2d9c";

/** Trackable Whop link for X → subscription attribution. */
export function whopMarketingUrl(postType?: PostType): string {
  const campaign = postType ?? "desk";
  const params = new URLSearchParams({
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: campaign,
  });
  return `${WHOP_BASE}?${params}`;
}

/** Short footer line for tweets (no https — saves chars). */
export function xPostFooterLine(postType?: PostType): string {
  const url = whopMarketingUrl(postType).replace(/^https:\/\//, "");
  return `@BlackOutTrade ${url}`;
}
