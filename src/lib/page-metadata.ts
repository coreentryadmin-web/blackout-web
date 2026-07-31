import type { Metadata } from "next";
import { SITE } from "@/lib/site";

/** Public marketing/legal page — canonical URL plus matching OG/Twitter copy. */
export function publicPageMetadata(title: string, description: string, path: string): Metadata {
  const url = path === "/" ? SITE.url : `${SITE.url}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
    },
    twitter: {
      title,
      description,
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
