import { LEARN_ARTICLES, getArticle } from "@/lib/learn/articles";
import { GUIDE_SEO, isLearnGuideSlug } from "@/lib/learn/guide-seo";
import type { SitemapEntry } from "@/lib/seo/sitemap-urls";

/** Default publish/modify dates for long-form learn articles (batch SEO ship). */
export const ARTICLE_DATE_PUBLISHED = "2026-07-31";
export const ARTICLE_DATE_MODIFIED = "2026-08-03";

const MARKETING_DATES: Record<string, string> = {
  "/": "2026-08-02",
  "/pricing": "2026-08-01",
  "/faq": "2026-07-31",
  "/why-blackout": "2026-07-28",
  "/about": "2026-08-01",
  "/contact": "2026-07-27",
  "/learn": "2026-08-03",
};

const LEGAL_DATE = "2026-07-27";

/** Honest last-modified for sitemap.xml (avoid stamping every URL with `now`). */
export function sitemapLastModified(path: string): Date {
  if (path.startsWith("/learn/")) {
    const slug = path.slice("/learn/".length);
    if (isLearnGuideSlug(slug)) {
      return new Date(`${GUIDE_SEO[slug].dateModified}T12:00:00Z`);
    }
    if (getArticle(slug)) {
      return new Date(`${ARTICLE_DATE_MODIFIED}T12:00:00Z`);
    }
  }

  if (MARKETING_DATES[path]) {
    return new Date(`${MARKETING_DATES[path]}T12:00:00Z`);
  }

  if (
    path === "/terms" ||
    path === "/privacy" ||
    path === "/disclaimer" ||
    path === "/refund-policy" ||
    path === "/cookie-policy"
  ) {
    return new Date(`${LEGAL_DATE}T12:00:00Z`);
  }

  return new Date(`${ARTICLE_DATE_MODIFIED}T12:00:00Z`);
}

export function feedPubDateForArticle(slug: string): string {
  if (isLearnGuideSlug(slug)) {
    return new Date(`${GUIDE_SEO[slug].dateModified}T12:00:00Z`).toUTCString();
  }
  const article = getArticle(slug);
  if (article) {
    return new Date(`${ARTICLE_DATE_MODIFIED}T12:00:00Z`).toUTCString();
  }
  return new Date(`${ARTICLE_DATE_MODIFIED}T12:00:00Z`).toUTCString();
}

/** RSS includes every public learn article (pillar, article, glossary). */
export function feedArticles() {
  return LEARN_ARTICLES;
}

export function withSitemapDates(entries: SitemapEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    lastModified: sitemapLastModified(entry.path),
  }));
}
