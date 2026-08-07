import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Private / auth-gated paths that no crawler should index.
 * Marketing pages (/pricing, /upgrade, /learn/*, /why-blackout, etc.) are
 * intentionally ABSENT — they must remain crawlable for SEO.
 */
const DISALLOWED_PATHS = [
  "/api/",
  "/admin/",
  "/dashboard/",
  "/terminal/",
  "/vector/",
  "/nighthawk/",
  "/flows/",
  "/heatmap/",
  "/grid/",
  "/account/",
  "/sign-in/",
  "/sign-up/",
  "/native-signin/",
  "/embed/",
  "/offline/",
  "/_next/",
];

/**
 * AI crawlers to explicitly welcome. A separate rule per bot (with allow "/")
 * makes the intent unambiguous — some AI bots default-off when only a wildcard
 * rule is present.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "Applebot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default rule for all bots (Google, Bing, etc.)
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED_PATHS,
      },
      // Explicit allow for AI crawlers — keeps public content available for
      // AI search & retrieval while still respecting the same disallow list.
      ...AI_CRAWLERS.map((bot) => ({
        userAgent: bot,
        allow: "/",
        disallow: DISALLOWED_PATHS,
      })),
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
