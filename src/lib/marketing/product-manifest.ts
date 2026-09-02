import type { MarketingModuleId } from "@/lib/images";

/**
 * Canonical public product-capability manifest — ONE source for homepage cards,
 * pricing bullets, FAQ, onboarding, plan matrix, structured data, and Academy cross-links.
 * Never describe Night Hawk as swing-only; never label Vector "Soon" when status is live.
 */

export type ProductLaunchStatus = "live" | "beta" | "planned";

export type ProductManifestEntry = {
  id: MarketingModuleId;
  label: string;
  launchStatus: ProductLaunchStatus;
  /** Short tag under module name on homepage carousel */
  tag: string;
  audience: string;
  /** One-sentence public positioning (entity/SEO) */
  positioning: string;
  /** Lifecycle / architecture — how the product actually works today */
  lifecycle: string;
  /** Canonical capability bullets — pricing, schema, comparison surfaces */
  capabilities: readonly string[];
  /** FAQ "What is X?" answer body */
  faqAnswer: string;
  /** Premium plan include line (plan matrix / pricing FAQ) */
  planInclude: string;
  learnHref: string;
  href: string;
};

/** Defensible data-freshness copy — never "zero delay". */
export const MARKETING_DATA_FRESHNESS = {
  helix: "Streamed live options flow — quote age shown on every read",
  platform: "Streamed live across flow, gamma, and desk surfaces — quote age on every read",
  comparison: "Streamed live — quote age shown on every read",
} as const;

export const PRODUCT_MANIFEST: Record<MarketingModuleId, ProductManifestEntry> = {
  spx: {
    id: "spx",
    label: "SPX Slayer",
    launchStatus: "live",
    tag: "0DTE command desk",
    audience: "0DTE traders",
    positioning: "Live SPX 0DTE gamma matrix, dealer walls, and graded play alerts.",
    lifecycle:
      "RTH command desk for SPX/SPXW — GEX/VEX/DEX/CHARM lenses, spot ladder, and BIE-graded play alerts refreshed every session cycle.",
    capabilities: [
      "GEX / VEX / DEX / CHARM lenses on the 0DTE ladder",
      "Spot row, king strikes, and cross-validated positioning",
      "Trade alerts gated by the BIE verification stack",
    ],
    faqAnswer:
      "The primary 0DTE desk. Live SPX with VWAP, gamma exposure and market internals, plus a graded play card: letter grade (A–F), numeric score, confidence read, an 11-point confirmation checklist, a suggested strike with entry / target / stop — and the invalidation level.",
    planInclude: "SPX Slayer desk (live SPX/SPXW)",
    learnHref: "/learn/spx-slayer-gex-matrix-guide",
    href: "/dashboard",
  },
  helix: {
    id: "helix",
    label: "HELIX",
    launchStatus: "live",
    tag: "Institutional flow tape",
    audience: "Flow hunters",
    positioning: "Institutional options flow streamed live with premium filters and anomaly scoring.",
    lifecycle:
      "Websocket options-flow tape with sweep/block detection, premium-tier filters, and session accumulation — feeds SPX Slayer confluence and Night Hawk scanner gates.",
    capabilities: [
      "Live websocket tape with premium-tier filters",
      "Top prints, sweeps, and block detection",
      "Feeds SPX Slayer confluence and Night Hawk scanner",
    ],
    faqAnswer:
      "Live options flow filtered down to what moves the desk, not a firehose: repeated-hit strike stacks, sweeps versus blocks, call/put pressure, premium and fill counts. The engine merges the live feed with the full session's flow so the big prints never slip past.",
    planInclude: "HELIX live options-flow tape",
    learnHref: "/learn/helix-flow-scanner-guide",
    href: "/flows",
  },
  thermal: {
    id: "thermal",
    label: "BlackOut Thermal",
    launchStatus: "live",
    tag: "Dealer gamma matrix",
    audience: "Gamma readers",
    positioning: "Full-screen dealer gamma heatmap across strikes and expiries.",
    lifecycle:
      "Multi-ticker GEX/VEX/DEX/CHARM matrix with cross-validation against the live SPX rail — the macro view of dealer positioning.",
    capabilities: [
      "Multi-ticker presets with GEX / VEX / DEX / CHARM lenses",
      "Cross-validated against the live SPX rail",
      "Charm and delta shifts when positioning rotates",
    ],
    faqAnswer:
      "A dealer-positioning heatmap. It maps GEX, VEX, DEX and CHARM by strike: the gamma walls that pin or repel price, the flip level where the regime turns, and where dealer flow concentrates. You read market structure before the first trade goes on.",
    planInclude: "Thermal heatmaps (GEX/VEX/DEX/CHARM)",
    learnHref: "/learn/thermal-heatmap-reading-guide",
    href: "/heatmap",
  },
  largo: {
    id: "largo",
    label: "Largo",
    launchStatus: "live",
    tag: "Desk intelligence",
    audience: "Desk operators",
    positioning: "Structure-first desk AI grounded in every tool's live data.",
    lifecycle:
      "Routes through BlackOut Intelligence on every ask — flow, gamma, regime, and cross-tool context in one terminal.",
    capabilities: [
      "Structure-first answers with invalidation and sizing",
      "Routes through BlackOut Intelligence on every ask",
      "SPX, flow, and cross-tool context in one terminal",
    ],
    faqAnswer:
      "Largo is your BlackOut Intelligence desk analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English and it answers grounded in live data and shows its work.",
    planInclude: "Largo AI desk analyst",
    learnHref: "/learn/largo-ai-terminal-guide",
    href: "/terminal",
  },
  hawk: {
    id: "hawk",
    label: "Night Hawk",
    launchStatus: "live",
    tag: "0DTE command desk",
    audience: "Intraday traders",
    positioning:
      "Intraday 0DTE Command scanner with graded play lifecycle and Evening Edition prep for the next session.",
    lifecycle:
      "0DTE Command runs during RTH as an always-on, multi-ticker intraday scanner with Cortex gates on every commit. Evening Edition publishes post-close prep for the next session. One desk for the full session arc — not a swing-only product.",
    capabilities: [
      "0DTE Command: whole-market intraday scanner",
      "Thesis health and Cortex gates on every commit",
      "Evening Edition prep for the next session",
      "Graded play log with full thesis trail",
    ],
    faqAnswer:
      "Night Hawk is the 0DTE command desk: 0DTE Command scans the whole market intraday with Cortex thesis health on every commit, tracks graded plays through their lifecycle, and publishes Evening Edition prep after the close so you walk into the next session with structure — not a blank chart.",
    planInclude: "Night Hawk 0DTE Command + Evening Edition",
    learnHref: "/learn/night-hawk-0dte-command-guide",
    href: "/nighthawk",
  },
  vector: {
    id: "vector",
    label: "Vector",
    launchStatus: "live",
    tag: "Universe radar",
    audience: "Universe scanners",
    positioning: "Cross-ticker gamma and flow universe screener with ranked setups.",
    lifecycle:
      "Production universe screener with nearest-flip, most-pinned, and most-explosive presets; GEX ladders, wall-integrity scoring, gamma magnet, confluence zones, GEX-shift leaders, alerts, and session replay.",
    capabilities: [
      "Universe screener presets (nearest flip, most pinned, most explosive)",
      "GEX ladders, wall integrity, gamma magnet, confluence zones",
      "GEX-shift leaders, alerts, and session replay",
    ],
    faqAnswer:
      "Vector is the cross-ticker universe desk: ranked gamma and flow setups from the same BIE verification engine as SPX Slayer, with universe screener presets, GEX ladders, wall-integrity scoring, confluence zones, alerts, and replay.",
    planInclude: "Vector universe scanner",
    learnHref: "/learn/vector-scanner-guide",
    href: "/vector",
  },
  meridian: {
    id: "meridian",
    label: "Meridian",
    launchStatus: "live",
    tag: "Earnings intelligence",
    audience: "Event traders",
    positioning: "Earnings calendar with estimates, reactions, and cross-tool positioning context.",
    lifecycle:
      "Timeline of upcoming and recent earnings with estimate revisions, reaction history, and Thermal/flow context per print.",
    capabilities: [
      "Timeline of upcoming and recent earnings events",
      "Estimate revisions and beat-rate history",
      "Positioning and flow context tied to each print",
    ],
    faqAnswer:
      "Meridian is the earnings desk: calendar, estimate revisions, reaction history, and cross-tool positioning and flow context for every major print — not a generic screener.",
    planInclude: "Meridian earnings desk",
    learnHref: "/meridian",
    href: "/meridian",
  },
};

export const MANIFEST_PRODUCT_ORDER: readonly MarketingModuleId[] = [
  "spx",
  "helix",
  "thermal",
  "largo",
  "hawk",
  "vector",
  "meridian",
];

export function manifestProductCount(): number {
  return MANIFEST_PRODUCT_ORDER.filter((id) => PRODUCT_MANIFEST[id].launchStatus === "live").length;
}

export function manifestPremiumIncludes(): string[] {
  return MANIFEST_PRODUCT_ORDER.filter((id) => PRODUCT_MANIFEST[id].launchStatus === "live").map(
    (id) => PRODUCT_MANIFEST[id].label
  );
}

export function manifestModulesHeadline(): string {
  const n = manifestProductCount();
  const word = n === 7 ? "Seven" : n === 6 ? "Six" : String(n);
  return `${word} products.`;
}

export function manifestPlatformSummary(): string {
  return MANIFEST_PRODUCT_ORDER.filter((id) => PRODUCT_MANIFEST[id].launchStatus === "live")
    .map((id) => PRODUCT_MANIFEST[id].label)
    .join(", ");
}

/** Schema.org featureList — entity clarity for crawlers and AI answer engines. */
export function manifestSchemaFeatureList(): string[] {
  return MANIFEST_PRODUCT_ORDER.flatMap((id) => {
    const p = PRODUCT_MANIFEST[id];
    if (p.launchStatus !== "live") return [];
    return [`${p.label}: ${p.positioning}`];
  });
}

/** Banned on public marketing surfaces — absolute latency claims we cannot defend. */
export const BANNED_PUBLIC_MARKETING_PHRASES = [
  "zero delay",
  "zero-delay",
  "not delayed screenshots",
  "tick by tick, not delayed",
  "tick-by-tick — zero delay",
  "overnight playbook",
  "swing playbook",
  "Soon universe",
  "rolling out",
  "six modules",
  "Six engines",
] as const;
