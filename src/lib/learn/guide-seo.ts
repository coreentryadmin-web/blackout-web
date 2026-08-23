import type { LearnSlug } from "@/lib/learn/nav";

export type GuideSeo = {
  metaTitle: string;
  metaDescription: string;
  datePublished: string;
  dateModified: string;
  breadcrumb: string;
};

/** SEO metadata for curriculum chapter routes (was duplicated across 7 page.tsx files). */
export const GUIDE_SEO: Record<LearnSlug, GuideSeo> = {
  "getting-started": {
    metaTitle: "Getting Started With BlackOut — Trader's Quick Guide",
    metaDescription:
      "New to BlackOut? Start here. Learn how the platform scans, grades, and logs setups, and how to read your first dealer gamma and options flow signals.",
    datePublished: "2026-01-15",
    dateModified: "2026-08-01",
    breadcrumb: "Getting Started",
  },
  "spx-slayer": {
    metaTitle: "SPX Slayer Guide — Trading 0DTE SPX Options",
    metaDescription:
      "Learn how SPX Slayer's 0DTE desk works: gamma matrices, tick-by-tick data, and A–F graded SPX alerts, and how to act on the setups that survive screening.",
    datePublished: "2026-01-15",
    dateModified: "2026-08-01",
    breadcrumb: "SPX Slayer",
  },
  "helix-flows": {
    metaTitle: "HELIX Guide — Reading Institutional Options Flow",
    metaDescription:
      "Learn to read institutional options order flow with HELIX: premium filters, anomaly detection, and how to spot the unusual activity that moves markets.",
    datePublished: "2026-01-15",
    dateModified: "2026-08-01",
    breadcrumb: "HELIX",
  },
  "largo-ai": {
    metaTitle: "Largo Guide — Your AI Market Structure Analyst",
    metaDescription:
      "Learn how Largo, BlackOut's AI desk analyst, delivers structure-focused market context so you understand what the positioning data is actually telling you.",
    datePublished: "2026-03-01",
    dateModified: "2026-08-01",
    breadcrumb: "Largo",
  },
  "night-hawk": {
    metaTitle: "Night Hawk Guide — Swing Trading Setups Explained",
    metaDescription:
      "Learn how Night Hawk grades swing trading setups and runs its evening scanner to surface the next day's best opportunities after the market closes.",
    datePublished: "2026-04-01",
    dateModified: "2026-08-01",
    breadcrumb: "Night Hawk",
  },
  "heat-maps": {
    metaTitle: "Dealer Gamma Heatmap Guide — Flip, Call & Put Walls",
    metaDescription:
      "Learn to read a dealer gamma heatmap: find the gamma flip, call wall, and put wall, and understand how dealer positioning drives intraday SPX moves.",
    datePublished: "2026-01-15",
    dateModified: "2026-08-01",
    breadcrumb: "Thermal",
  },
  glossary: {
    metaTitle: "BlackOut Glossary — Dealer Greeks, Gamma Flip, and 0DTE Terms",
    metaDescription:
      "BlackOut platform glossary: dealer Greeks (CHARM, DEX, VEX), King node, gamma flip, call/put walls, and Night Hawk and SPX Slayer terms explained simply.",
    datePublished: "2026-01-15",
    dateModified: "2026-08-01",
    breadcrumb: "Glossary",
  },
};

export function isLearnGuideSlug(slug: string): slug is LearnSlug {
  return slug in GUIDE_SEO;
}
