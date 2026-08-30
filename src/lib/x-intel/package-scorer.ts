/**
 * Score a proposed attachment package before publishing (0–100).
 * Story relevance 25 · Visual impact 20 · Product diversity 15 · Panel novelty 15 ·
 * Information density 10 · Readability 10 · Differentiation 5
 */

import type { XIntelFranchise } from "@/lib/x-intel/franchises";
import type { XIntelVisualMemoryEntry } from "@/lib/x-intel/visual-memory";
import { visualNoveltyPenalty, signatureSimilarity } from "@/lib/x-intel/visual-memory";
import type { CaptureCatalogEntry } from "@/lib/x-intel/capture-catalog";

export type PackageAttachmentPlan = {
  catalog_id: string;
  entry: CaptureCatalogEntry;
  params: Record<string, string | number | boolean>;
  role: "PRICE" | "BLACKOUT_SIGNAL" | "CONFIRMATION";
};

export type PackageScoreBreakdown = {
  story_relevance: number;
  visual_impact: number;
  product_diversity: number;
  panel_novelty: number;
  information_density: number;
  readability: number;
  differentiation: number;
  total: number;
  pass: boolean;
};

const MIN_PUBLISH_SCORE = 55;

/** Map franchise → preferred story tags for relevance scoring. */
const FRANCHISE_TAGS: Partial<Record<XIntelFranchise, string[]>> = {
  WHALE_WATCH: ["whale", "flow", "prints", "stack"],
  GAMMA_SHIFT: ["gamma", "walls", "regime", "profile", "depth"],
  BLACKOUT_CONFLUENCE: ["compare", "conflict", "explain"],
  EARNINGS_WAR_ROOM: ["earnings", "positioning", "estimates", "history"],
  SIGNAL_CONFLICT: ["conflict", "reconcile"],
  LEVEL_THAT_MATTERS: ["structure", "walls", "level", "pin"],
  NIGHT_HAWK_STRIKE: ["0dte", "play", "board"],
  MARKET_PULSE: ["breadth", "net_premium", "indices", "macro"],
};

export function scoreAttachmentPackage(opts: {
  franchise: XIntelFranchise | null;
  story_tags: string[];
  attachments: PackageAttachmentPlan[];
  recent_memory: ReadonlyArray<XIntelVisualMemoryEntry>;
}): PackageScoreBreakdown {
  const { franchise, story_tags, attachments, recent_memory } = opts;

  // Story relevance (0–25)
  const wantTags = new Set([
    ...story_tags,
    ...(franchise ? (FRANCHISE_TAGS[franchise] ?? []) : []),
  ]);
  let tagHits = 0;
  for (const a of attachments) {
    for (const t of a.entry.story_tags) {
      if (wantTags.has(t)) tagHits += 1;
    }
    if (franchise && a.entry.franchises.includes(franchise)) tagHits += 2;
  }
  const story_relevance = Math.min(25, Math.round((tagHits / Math.max(attachments.length * 2, 1)) * 25));

  // Visual impact (0–20) — diverse visualizations score higher
  const viz = new Set(attachments.map((a) => a.entry.visualization));
  const visual_impact = Math.min(20, 8 + viz.size * 4);

  // Product diversity (0–15)
  const products = new Set(attachments.map((a) => a.entry.product));
  const product_diversity = products.size >= 3 ? 15 : products.size === 2 ? 10 : 4;

  // Panel novelty (0–15) — average novelty penalty across attachments
  let noveltySum = 0;
  for (const a of attachments) {
    const sig = {
      view_id: a.entry.view_id,
      surface: a.entry.product,
      page: a.entry.path,
      panel: a.entry.visualization,
      visualization: a.entry.visualization,
      ticker: String(a.params.ticker ?? ""),
      timeframe: String(a.params.timeframe ?? a.params.horizon ?? ""),
      filters: Object.fromEntries(
        Object.entries(a.params).map(([k, v]) => [k, String(v)]),
      ),
      composition: a.catalog_id,
    };
    noveltySum += visualNoveltyPenalty(sig, recent_memory);
  }
  const panel_novelty = Math.round((noveltySum / attachments.length) * 15);

  // Information density (0–10) — more panels / drilldowns / tabs
  const denseRecipes = new Set([
    "helix_contract_drilldown",
    "helix_ticker_drawer",
    "meridian_event_tab",
    "helix_analytics_overlay",
    "thermal_depth",
    "thermal_profile",
  ]);
  const densityHits = attachments.filter((a) => denseRecipes.has(a.entry.recipe)).length;
  const information_density = Math.min(10, 4 + densityHits * 3);

  // Readability (0–10) — penalize duplicate visualization on same product
  let readability = 10;
  for (let i = 0; i < attachments.length; i++) {
    for (let j = i + 1; j < attachments.length; j++) {
      const sim = signatureSimilarity(
        {
          view_id: attachments[i]!.entry.view_id,
          surface: attachments[i]!.entry.product,
          page: attachments[i]!.entry.path,
          panel: attachments[i]!.entry.visualization,
          visualization: attachments[i]!.entry.visualization,
          ticker: String(attachments[i]!.params.ticker ?? ""),
          timeframe: "",
          filters: {},
          composition: attachments[i]!.catalog_id,
        },
        {
          view_id: attachments[j]!.entry.view_id,
          surface: attachments[j]!.entry.product,
          page: attachments[j]!.entry.path,
          panel: attachments[j]!.entry.visualization,
          visualization: attachments[j]!.entry.visualization,
          ticker: String(attachments[j]!.params.ticker ?? ""),
          timeframe: "",
          filters: {},
          composition: attachments[j]!.catalog_id,
        },
      );
      if (sim > 0.75) readability -= 4;
    }
  }
  readability = Math.max(0, readability);

  // Differentiation (0–5) — cross-product stories
  const differentiation = products.size >= 2 && viz.size >= 2 ? 5 : products.size >= 2 ? 3 : 1;

  const total =
    story_relevance +
    visual_impact +
    product_diversity +
    panel_novelty +
    information_density +
    readability +
    differentiation;

  return {
    story_relevance,
    visual_impact,
    product_diversity,
    panel_novelty,
    information_density,
    readability,
    differentiation,
    total,
    pass: total >= MIN_PUBLISH_SCORE,
  };
}

export { MIN_PUBLISH_SCORE };
