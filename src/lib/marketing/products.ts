import type { MarketingModuleId } from "@/lib/images";

export type MarketingProductId = MarketingModuleId;

export type MarketingProduct = {
  id: MarketingProductId;
  label: string;
  tag: string;
  /** Skylit-style audience chip — who this module is built for */
  audience: string;
  accent: string;
  headline: string;
  lede: string;
  /** Short line under hero module tabs */
  heroBlurb: string;
  bullets: string[];
  stat: { k: string; v: string };
  /** Public learn guide — homepage module cards link here for SEO/crawl. */
  learnHref: string;
  href: string;
  launchStatus: "live" | "soon";
  index: number;
};

export const MARKETING_PRODUCTS: readonly MarketingProduct[] = [
  {
    id: "spx",
    index: 1,
    label: "SPX Slayer",
    tag: "0DTE command desk",
    audience: "0DTE traders",
    accent: "#a3e635",
    headline: "Read SPX structure before the tape moves.",
    lede: "Live 0DTE gamma matrix, dealer walls, and graded play alerts — the anchor of the BlackOut desk.",
    heroBlurb: "0DTE gamma matrix, spot ladder, and graded play alerts — refreshed every RTH cycle.",
    bullets: [
      "GEX / VEX / DEX / CHARM lenses on the 0DTE ladder",
      "Spot row, king strikes, and cross-validated positioning",
      "Trade alerts gated by the same BIE verification stack",
    ],
    stat: { k: "8s", v: "matrix refresh in RTH" },
    learnHref: "/learn/spx-slayer-gex-matrix-guide",
    href: "/dashboard",
    launchStatus: "live",
  },
  {
    id: "helix",
    index: 2,
    label: "HELIX",
    tag: "Institutional flow tape",
    audience: "Flow hunters",
    accent: "#22d3ee",
    headline: "Institutional prints — tick by tick, not delayed screenshots.",
    lede: "Unusual options activity with premium filters, anomaly scoring, and deep contract context.",
    heroBlurb: "Tick-by-tick unusual options flow — sweeps, blocks, and anomaly scoring on live tape.",
    bullets: [
      "Live websocket tape with premium-tier filters",
      "Top prints, sweeps, and block detection",
      "Feeds SPX Slayer confluence and Night Hawk scanner",
    ],
    stat: { k: "Live", v: "options flow stream" },
    learnHref: "/learn/helix-flow-scanner-guide",
    href: "/flows",
    launchStatus: "live",
  },
  {
    id: "thermal",
    index: 3,
    label: "BlackOut Thermal",
    tag: "Dealer gamma matrix",
    audience: "Gamma readers",
    accent: "#bf5fff",
    headline: "See where dealers are pinned across the surface.",
    lede: "Full-screen GEX heatmap across strikes and expiries — the macro view of dealer positioning.",
    heroBlurb: "Full-screen dealer gamma heatmap — strikes, expiries, and charm rotation in one view.",
    bullets: [
      "Multi-ticker presets with GEX / VEX / DEX / CHARM lenses",
      "Cross-validated against the live SPX rail",
      "Charm and delta shifts when positioning rotates",
    ],
    stat: { k: "Multi", v: "ticker presets" },
    learnHref: "/learn/thermal-heatmap-reading-guide",
    href: "/heatmap",
    launchStatus: "live",
  },
  {
    id: "largo",
    index: 4,
    label: "Largo",
    tag: "Desk intelligence",
    audience: "Desk operators",
    accent: "#ffd23f",
    headline: "Ask the desk — get structure, not chat fluff.",
    lede: "Context-aware reads on flow, gamma, and regime — grounded in the same live feeds as your tools.",
    heroBlurb: "Structure-first desk AI — invalidation, sizing, and regime context from live feeds.",
    bullets: [
      "Structure-first answers with invalidation and sizing",
      "Routes through BlackOut Intelligence on every ask",
      "SPX, flow, and cross-tool context in one terminal",
    ],
    stat: { k: "BIE", v: "structure-first AI" },
    learnHref: "/learn/largo-ai-terminal-guide",
    href: "/terminal",
    launchStatus: "live",
  },
  {
    id: "hawk",
    index: 5,
    label: "Night Hawk",
    tag: "0DTE command desk",
    audience: "Intraday traders",
    accent: "#ff6b2b",
    headline: "Intraday scanner with evening prep.",
    lede: "0DTE Command during RTH, graded play lifecycle, Cortex thesis health, and Evening Edition prep — one desk for the full session arc.",
    heroBlurb: "Live 0DTE scanner + play lifecycle — evening preparation when the cash session ends.",
    bullets: [
      "0DTE Command: whole-market intraday scanner",
      "Thesis health and Cortex gates on every commit",
      "Evening Edition prep for the next session",
      "Graded play log with full thesis trail",
    ],
    stat: { k: "Live", v: "0DTE command" },
    learnHref: "/learn/night-hawk-0dte-command-guide",
    href: "/nighthawk",
    launchStatus: "live",
  },
  {
    id: "vector",
    index: 6,
    label: "Vector",
    tag: "Universe radar",
    audience: "Universe scanners",
    accent: "#7c5cff",
    headline: "Broaden the hunt beyond SPX.",
    lede: "Cross-ticker flow and gamma context — ranked setups from the same verification engine as the desk.",
    heroBlurb: "Cross-ticker flow and gamma radar — ranked setups from the same BIE engine.",
    bullets: [
      "Multi-ticker flow and positioning context",
      "Wall integrity, confluence zones, and session replay",
      "Ranked setups from BlackOut Intelligence",
    ],
    stat: { k: "Live", v: "universe scan" },
    learnHref: "/learn/vector-scanner-guide",
    href: "/vector",
    launchStatus: "live",
  },
  {
    id: "meridian",
    index: 7,
    label: "Meridian",
    tag: "Earnings intelligence",
    audience: "Event traders",
    accent: "#38bdf8",
    headline: "Earnings prints with positioning context.",
    lede: "Calendar, estimates, reactions, and cross-tool intel for every major earnings event — not a generic screener.",
    heroBlurb: "Earnings calendar with estimate revisions, reaction history, and Thermal/flow context per print.",
    bullets: [
      "Timeline of upcoming and recent earnings events",
      "Estimate revisions and beat-rate history",
      "Positioning and flow context tied to each print",
    ],
    stat: { k: "Live", v: "earnings desk" },
    learnHref: "/meridian",
    href: "/meridian",
    launchStatus: "live",
  },
] as const;

/** Live products only — drives homepage counts and pricing copy (never hardcode "6 engines"). */
export const LIVE_MARKETING_PRODUCTS = MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live");

export function marketingProductCount(): number {
  return LIVE_MARKETING_PRODUCTS.length;
}

/** Product names for Premium pricing bullets — one line per desk surface. */
export function premiumPricingPerks(): string[] {
  return LIVE_MARKETING_PRODUCTS.map((p) => p.label);
}

export function marketingModulesHeadline(): string {
  const n = marketingProductCount();
  const word = n === 7 ? "Seven" : n === 6 ? "Six" : String(n);
  return `${word} products.`;
}

export function marketingProductById(id: string): MarketingProduct | undefined {
  return MARKETING_PRODUCTS.find((p) => p.id === id);
}

export function marketingProductLearnHref(id: MarketingProductId): string {
  return marketingProductById(id)?.learnHref ?? "/learn";
}
