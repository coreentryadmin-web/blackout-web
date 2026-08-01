import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const marketing: MetadataRoute.Sitemap = [
    { url: SITE.url, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE.url}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE.url}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];

  const learn: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/learn`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/learn/getting-started`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/learn/spx-slayer`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/helix-flows`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/largo-ai`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/night-hawk`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/heat-maps`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  const legal: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE.url}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE.url}/disclaimer`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE.url}/refund-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE.url}/cookie-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  return [...marketing, ...learn, ...legal];
}
