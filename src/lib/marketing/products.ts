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
    tag: "Evening playbook + 0DTE Command",
    audience: "Overnight & intraday 0DTE traders",
    accent: "#ff6b2b",
    headline: "The evening playbook, then a live 0DTE scanner all session.",
    lede: "A graded overnight playbook after the close, plus 0DTE Command — a continuously running intraday scanner that tracks setups through the session.",
    heroBlurb: "Graded evening playbook with A–F log, plus 0DTE Command's live intraday scanner.",
    bullets: [
      "Transparent A–F play log with full thesis trail",
      "0DTE Command scans and tracks setups all session, not just at the open",
      "Alerts when gates clear — not noise for noise's sake",
    ],
    stat: { k: "A–F", v: "graded play log" },
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
    lede: "Cross-ticker GEX ladders, regime detection, and confluence zones — ranked setups from the same verification engine as the desk, across the entire scanner universe.",
    heroBlurb: "Cross-ticker gamma radar — GEX ladders, wall integrity, and confluence zones, live.",
    bullets: [
      "Universe screener ranked by regime, wall dominance, and confluence",
      "Per-ticker GEX ladder, gamma magnet, and wall-integrity scoring",
      "Session replay and alerts on flip crosses and wall breaks",
    ],
    stat: { k: "Live", v: "universe scan" },
    learnHref: "/learn/vector-scanner-guide",
    href: "/vector",
    launchStatus: "live",
  },
] as const;

export function marketingProductById(id: string): MarketingProduct | undefined {
  return MARKETING_PRODUCTS.find((p) => p.id === id);
}

export function marketingProductLearnHref(id: MarketingProductId): string {
  return marketingProductById(id)?.learnHref ?? "/learn";
}

/**
 * Capitalized number word for small counts (1-9), used ONLY for the homepage's stylized
 * "Six engines. One edge." headline — so that heading derives from MARKETING_PRODUCTS.length
 * instead of a hardcoded word that silently drifts whenever a module is added or removed
 * (see the 2026-09 finding: the homepage said "Six engines" and "6 live engines" while the
 * manifest below it was already missing a real 7th entry — Meridian — for want of a
 * screenshot asset). Falls back to the numeral for anything outside 1-9.
 */
const SMALL_NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
] as const;

export function capitalizedNumberWord(n: number): string {
  return SMALL_NUMBER_WORDS[n] ?? String(n);
}
