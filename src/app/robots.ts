import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Private / auth-gated paths that no crawler should index.
 * Marketing pages (/pricing, /upgrade, /learn/*, /why-blackout, etc.) are
 * intentionally ABSENT — they must remain crawlable for SEO.
 */
// Trailing-slash rules only match sub-paths, not the bare route (per the robots.txt
// spec: `Disallow: /fish/` does NOT match `/fish`). Next.js serves every one of these
// routes without a trailing slash (no `trailingSlash` override in next.config.mjs), so
// each bare path needs its own explicit entry alongside the sub-path form.
const DISALLOWED_ROOTS = [
  "/api",
  "/admin",
  "/dashboard",
  "/terminal",
  "/vector",
  "/nighthawk",
  "/flows",
  "/heatmap",
  "/grid",
  "/account",
  "/sign-in",
  "/sign-up",
  "/native-signin",
  "/embed",
  "/offline",
  "/track-record",
  "/_next",
];

const DISALLOWED_PATHS = DISALLOWED_ROOTS.flatMap((root) => [root, `${root}/`]);

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
