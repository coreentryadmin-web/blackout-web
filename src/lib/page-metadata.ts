import type { Metadata } from "next";
import { SITE } from "@/lib/site";

/** Public marketing/legal page — canonical URL plus matching OG/Twitter copy + per-page OG image. */
export function publicPageMetadata(
  title: string,
  description: string,
  path: string,
  opts?: {
    kicker?: string;
    ogType?: "website" | "article";
    /** Article type shown as a category badge on the OG image ("article", "pillar", "glossary"). */
    articleType?: "article" | "pillar" | "glossary";
  },
): Metadata {
  const url = path === "/" ? SITE.url : `${SITE.url}${path}`;

  const ogParams = new URLSearchParams({ title, description });
  if (opts?.articleType) ogParams.set("type", opts.articleType);
  else if (opts?.kicker) ogParams.set("kicker", opts.kicker);

  const ogImageUrl = `${SITE.url}/api/og?${ogParams.toString()}`;

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
