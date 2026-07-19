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
    accent: "#00e676",
    headline: "Read SPX structure before the tape moves.",
    lede: "Live 0DTE gamma matrix, dealer walls, and graded play alerts — the anchor of the BlackOut desk.",
    heroBlurb: "0DTE gamma matrix, spot ladder, and graded play alerts — refreshed every RTH cycle.",
    bullets: [
      "GEX / VEX / DEX / CHARM lenses on the 0DTE ladder",
      "Spot row, king strikes, and cross-validated positioning",
      "Trade alerts gated by the same BIE verification stack",
    ],
    stat: { k: "8s", v: "matrix refresh in RTH" },
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
    href: "/terminal",
    launchStatus: "live",
  },
  {
    id: "hawk",
    index: 5,
    label: "Night Hawk",
    tag: "Swing playbook",
    audience: "Swing traders",
    accent: "#ff6b2b",
    headline: "Overnight and swing setups with receipts.",
    lede: "Graded playbook, evening scanner, and push alerts when structure clears the gate.",
    heroBlurb: "Graded swing playbook with A–F log, evening scanner, and gated push alerts.",
    bullets: [
      "Transparent A–F play log with full thesis trail",
      "Evening scanner tied to HELIX anomalies",
      "Alerts when gates clear — not noise for noise's sake",
    ],
    stat: { k: "A–F", v: "graded play log" },
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
      "Ranked setups from BlackOut Intelligence",
      "Rolling out as desk coverage expands",
    ],
    stat: { k: "Soon", v: "universe scan" },
    href: "/pricing",
    launchStatus: "soon",
  },
] as const;

export function marketingProductById(id: string): MarketingProduct | undefined {
  return MARKETING_PRODUCTS.find((p) => p.id === id);
}

export function marketingProductHref(id: MarketingProductId): string {
  return marketingProductById(id)?.href ?? "/pricing";
}
