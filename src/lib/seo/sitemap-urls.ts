import { SITE } from "@/lib/site";
import { LEARN_ARTICLES } from "@/lib/learn/articles";
import { LEARN_NAV } from "@/lib/learn/nav";

export type SitemapEntry = {
  path: string;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

/** Canonical public paths for sitemap.xml + IndexNow pings. */
export function publicSitemapEntries(): SitemapEntry[] {
  const marketing: SitemapEntry[] = [
    { path: "/", changeFrequency: "weekly", priority: 1.0 },
    { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
    { path: "/vs/others", changeFrequency: "monthly", priority: 0.7 },
    { path: "/tools/gamma-snapshot", changeFrequency: "daily", priority: 0.8 },
    { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
    { path: "/why-blackout", changeFrequency: "monthly", priority: 0.8 },
    { path: "/methodology", changeFrequency: "weekly", priority: 0.85 },
    { path: "/about", changeFrequency: "monthly", priority: 0.7 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
    { path: "/learn", changeFrequency: "weekly", priority: 0.8 },
  ];

  const curriculum: SitemapEntry[] = LEARN_NAV.map((item) => ({
    path: `/learn/${item.slug}`,
    changeFrequency: "monthly" as const,
    priority: item.slug === "getting-started" ? 0.8 : 0.7,
  }));

  const articles: SitemapEntry[] = LEARN_ARTICLES.map((a) => ({
    path: a.path,
    changeFrequency: "monthly" as const,
    priority: a.type === "pillar" ? 0.8 : 0.7,
  }));

  // Dealer-gamma research (/research/gamma-levels/*) is intentionally ABSENT until the operator
  // resolves the open vendor redistribution question. Routes exist (noindex via research layout)
  // but are not submitted — see docs/agents/SEO-SEARCH-AUTHORITY.md § HARD CONSTRAINT.

  const legal: SitemapEntry[] = [
    { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/disclaimer", changeFrequency: "yearly", priority: 0.2 },
    { path: "/refund-policy", changeFrequency: "yearly", priority: 0.2 },
    { path: "/cookie-policy", changeFrequency: "yearly", priority: 0.2 },
  ];

  return [...marketing, ...curriculum, ...articles, ...legal];
}

export function absolutePublicUrls(): string[] {
  return publicSitemapEntries().map((e) => `${SITE.url}${e.path}`);
}

/** Full public URL set for IndexNow (marketing + learn + legal). */
export function indexNowUrls(): string[] {
  return absolutePublicUrls();
}

/** @deprecated Use indexNowUrls — kept for callers that only ping learn paths. */
export function learnIndexNowUrls(): string[] {
  const paths = ["/learn", ...LEARN_NAV.map((n) => `/learn/${n.slug}`), ...LEARN_ARTICLES.map((a) => a.path)];
  return paths.map((p) => `${SITE.url}${p}`);
}
