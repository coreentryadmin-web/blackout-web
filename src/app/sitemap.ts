import type { MetadataRoute } from "next";
import { withSitemapDates } from "@/lib/seo/sitemap-dates";
import { publicSitemapEntries } from "@/lib/seo/sitemap-urls";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return withSitemapDates(publicSitemapEntries()).map((entry) => ({
    url: `${SITE.url}${entry.path}`,
    lastModified: entry.lastModified,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
