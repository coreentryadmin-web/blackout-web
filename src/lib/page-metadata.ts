import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const TWITTER_SITE = `@${SITE.social.x.handle}`;

type OgImageOpts = {
  kicker?: string;
  /** Article type shown as a category badge on the OG image ("article", "pillar", "glossary"). */
  articleType?: "article" | "pillar" | "glossary";
};

/**
 * Builds the same per-page `/api/og` image URL that `publicPageMetadata` puts in
 * OpenGraph/Twitter tags. Exported so callers that need the identical image outside
 * a `<head>` context (e.g. ArticleJsonLd's structured-data `image` field) can't drift
 * from what the page's own social-preview image actually is.
 */
export function buildOgImageUrl(title: string, description: string, opts?: OgImageOpts): string {
  const ogParams = new URLSearchParams({ title, description });
  if (opts?.articleType) ogParams.set("type", opts.articleType);
  else if (opts?.kicker) ogParams.set("kicker", opts.kicker);

  return `${SITE.url}/api/og?${ogParams.toString()}`;
}

/** Public marketing/legal page — canonical URL plus matching OG/Twitter copy + per-page OG image. */
export function publicPageMetadata(
  title: string,
  description: string,
  path: string,
  opts?: OgImageOpts & {
    ogType?: "website" | "article";
  },
): Metadata {
  const url = path === "/" ? SITE.url : `${SITE.url}${path}`;
  const ogImageUrl = buildOgImageUrl(title, description, opts);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: opts?.ogType ?? "website",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      site: TWITTER_SITE,
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

/** Authenticated app surface — excluded from search indexes. */
export function noindexPageMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}
