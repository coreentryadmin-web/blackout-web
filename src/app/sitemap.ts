import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const marketing: MetadataRoute.Sitemap = [
    { url: SITE.url, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE.url}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE.url}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/why-blackout`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];

  const learn: MetadataRoute.Sitemap = [
    { url: `${SITE.url}/learn`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE.url}/learn/getting-started`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/learn/spx-slayer`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/helix-flows`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/largo-ai`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/night-hawk`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/heat-maps`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE.url}/learn/dealer-gamma-options-flow-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/learn/what-is-dealer-gamma-exposure`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/gamma-flip-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/call-wall-put-wall-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/what-is-gex`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/0dte-spx-options-strategy`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/is-0dte-gambling`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/how-to-read-options-flow`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/gamma-squeeze-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/options-trading-glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/iron-condor-strategy-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/what-is-dark-pool-trading`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/options-greeks-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/implied-volatility-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/unusual-options-activity-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/max-pain-options-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/delta-hedging-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/spx-slayer-dashboard-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/spx-slayer-play-grades-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/spx-slayer-gex-matrix-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/spx-slayer-lotto-power-hour`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/thermal-heatmap-reading-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/thermal-four-lenses-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/thermal-strike-selection-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/helix-flow-scanner-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/helix-flow-signals-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/helix-dark-pool-analysis`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/night-hawk-evening-edition-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/night-hawk-0dte-command-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/night-hawk-cortex-evidence-system`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/largo-ai-terminal-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/largo-ai-market-analysis-tips`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/learn/vector-scanner-guide`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
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
