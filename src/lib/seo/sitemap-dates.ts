import { LEARN_ARTICLES, getArticle } from "@/lib/learn/articles";
import { GUIDE_SEO, isLearnGuideSlug } from "@/lib/learn/guide-seo";
import { ARTICLE_DATES } from "@/lib/learn/article-dates";
import { MARKETING_DATES } from "@/lib/seo/marketing-dates";
import type { SitemapEntry } from "@/lib/seo/sitemap-urls";

/**
 * Fallback publish/modify dates — used only if a slug is somehow missing from
 * ARTICLE_DATES (shouldn't happen; the generator covers every LEARN_ARTICLES
 * entry, see scripts/seo/generate-article-dates.mjs). Kept so a stale
 * generated file degrades to a sane date instead of crashing.
 */
export const ARTICLE_DATE_PUBLISHED = "2026-07-31";
export const ARTICLE_DATE_MODIFIED = "2026-08-03";

/** Real per-article dates derived from git history — see article-dates.ts. */
export function getArticleDates(slug: string): { datePublished: string; dateModified: string } {
  return (
    ARTICLE_DATES[slug] ?? {
      datePublished: ARTICLE_DATE_PUBLISHED,
      dateModified: ARTICLE_DATE_MODIFIED,
    }
  );
}

const LEGAL_DATE = "2026-07-27";

/** Honest last-modified for sitemap.xml (avoid stamping every URL with `now`). */
export function sitemapLastModified(path: string): Date {
  if (path.startsWith("/learn/")) {
    const slug = path.slice("/learn/".length);
    if (isLearnGuideSlug(slug)) {
      return new Date(`${GUIDE_SEO[slug].dateModified}T12:00:00Z`);
    }
    if (getArticle(slug)) {
      return new Date(`${getArticleDates(slug).dateModified}T12:00:00Z`);
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

/**
 * RSS `<item><pubDate>` — per the RSS 2.0 spec this is WHEN THE ITEM WAS PUBLISHED, not when it
 * was last edited. The per-article/per-guide SEO metadata already tracks both dates separately
 * (`datePublished`/`dateModified` — see `src/app/(marketing)/learn/[slug]/page.tsx`'s structured
 * data, which correctly uses both), but this feed read `dateModified` for the item-level pubDate.
 *
 * BUG this fixes: because every edit to an article bumps its `dateModified` (see
 * `scripts/seo/generate-article-dates.mjs`), a routine content fix on a MONTHS-old article (e.g.
 * "dealer-gamma-options-flow-guide": published 2026-07-31, last edited 2026-09-01) moved that
 * item's RSS `<pubDate>` forward by over a month — misrepresenting an edit as a brand-new post. An
 * aggregator/reader that notifies subscribers on a pubDate change (common behavior, since RSS 2.0
 * has no standard "updated" field the way Atom does) would then re-announce old content as new
 * every time it was merely corrected, and any reader sorting strictly by `<pubDate>` would rank a
 * months-old article above a genuinely newer one that happened not to need an edit yet.
 *
 * Use `feedLastModifiedForArticle` (below) for the channel-level `<lastBuildDate>` instead — that
 * one legitimately wants "most recent change across the whole feed", which IS `dateModified`.
 */
export function feedPubDateForArticle(slug: string): string {
  if (isLearnGuideSlug(slug)) {
    return new Date(`${GUIDE_SEO[slug].datePublished}T12:00:00Z`).toUTCString();
  }
  return new Date(`${getArticleDates(slug).datePublished}T12:00:00Z`).toUTCString();
}

/**
 * Channel-level freshness signal (`<lastBuildDate>`) — unlike an item's own `<pubDate>` above,
 * this legitimately wants the most recent EDIT across the whole feed, since the feed's rendered
 * content really did change on that date even for an already-published article.
 */
export function feedLastModifiedForArticle(slug: string): string {
  if (isLearnGuideSlug(slug)) {
    return new Date(`${GUIDE_SEO[slug].dateModified}T12:00:00Z`).toUTCString();
  }
  return new Date(`${getArticleDates(slug).dateModified}T12:00:00Z`).toUTCString();
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
