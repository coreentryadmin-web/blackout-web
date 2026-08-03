import type { MetadataRoute } from "next";
import { publicSitemapEntries } from "@/lib/seo/sitemap-urls";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return publicSitemapEntries().map((entry) => ({
    url: `${SITE.url}${entry.path}`,
    lastModified: now,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
