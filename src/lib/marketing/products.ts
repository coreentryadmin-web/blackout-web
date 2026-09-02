import type { MarketingModuleId } from "@/lib/images";
import {
  MANIFEST_PRODUCT_ORDER,
  PRODUCT_MANIFEST,
  manifestModulesHeadline,
  manifestPremiumIncludes,
  manifestProductCount,
  type ProductLaunchStatus,
} from "@/lib/marketing/product-manifest";

export type MarketingProductId = MarketingModuleId;

export type MarketingProduct = {
  id: MarketingProductId;
  label: string;
  tag: string;
  audience: string;
  accent: string;
  headline: string;
  lede: string;
  heroBlurb: string;
  bullets: string[];
  stat: { k: string; v: string };
  learnHref: string;
  href: string;
  launchStatus: "live" | "soon";
  index: number;
};

const ACCENTS: Record<MarketingProductId, string> = {
  spx: "#a3e635",
  helix: "#22d3ee",
  thermal: "#bf5fff",
  largo: "#ffd23f",
  hawk: "#ff6b2b",
  vector: "#7c5cff",
  meridian: "#38bdf8",
};

const HEADLINES: Record<MarketingProductId, string> = {
  spx: "Read SPX structure before the tape moves.",
  helix: "Institutional prints — streamed live on the tape.",
  thermal: "See where dealers are pinned across the surface.",
  largo: "Ask the desk — get structure, not chat fluff.",
  hawk: "Intraday scanner with evening prep.",
  vector: "Broaden the hunt beyond SPX.",
  meridian: "Earnings prints with positioning context.",
};

const STATS: Record<MarketingProductId, { k: string; v: string }> = {
  spx: { k: "8s", v: "matrix refresh in RTH" },
  helix: { k: "Live", v: "options flow stream" },
  thermal: { k: "Multi", v: "ticker presets" },
  largo: { k: "BIE", v: "structure-first AI" },
  hawk: { k: "Live", v: "0DTE command" },
  vector: { k: "Live", v: "universe scan" },
  meridian: { k: "Live", v: "earnings desk" },
};

function toLaunchStatus(s: ProductLaunchStatus): "live" | "soon" {
  return s === "live" ? "live" : "soon";
}

function buildMarketingProduct(id: MarketingProductId, index: number): MarketingProduct {
  const m = PRODUCT_MANIFEST[id];
  return {
    id,
    index,
    label: m.label,
    tag: m.tag,
    audience: m.audience,
    accent: ACCENTS[id],
    headline: HEADLINES[id],
    lede: m.lifecycle,
    heroBlurb: m.positioning,
    bullets: [...m.capabilities],
    stat: STATS[id],
    learnHref: m.learnHref,
    href: m.href,
    launchStatus: toLaunchStatus(m.launchStatus),
  };
}

export const MARKETING_PRODUCTS: readonly MarketingProduct[] = MANIFEST_PRODUCT_ORDER.map((id, i) =>
  buildMarketingProduct(id, i + 1)
);

export const LIVE_MARKETING_PRODUCTS = MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live");

export function marketingProductCount(): number {
  return manifestProductCount();
}

export function premiumPricingPerks(): string[] {
  return manifestPremiumIncludes();
}

export function marketingModulesHeadline(): string {
  return manifestModulesHeadline();
}

export function marketingProductById(id: string): MarketingProduct | undefined {
  return MARKETING_PRODUCTS.find((p) => p.id === id);
}

export function marketingProductLearnHref(id: MarketingProductId): string {
  return marketingProductById(id)?.learnHref ?? "/learn";
}

export { PRODUCT_MANIFEST, manifestSchemaFeatureList } from "@/lib/marketing/product-manifest";
