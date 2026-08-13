/**
 * CLIENT-SAFE types + guards for the Largo compare card.
 *
 * Split out of helix-thermal-compare.ts because that module is a SERVER module: it reaches
 * `@/lib/platform` to fetch the flow tape and GEX matrix, which transitively pulls in the cron
 * dispatch chain and `import { after } from "next/server"`. `after` does not exist in the client
 * bundle, so a client component importing anything from that file — even a two-line pure type
 * guard — drags the whole graph in and the webpack build fails with:
 *
 *   ./src/app/api/cron/swing-active-refresh/route.ts
 *   ...
 *   ./src/lib/largo/helix-thermal-compare.ts
 *   ./src/features/largo/components/LargoCompareCard.tsx
 *
 * `tsc --noEmit` passes on that import because TYPES erase — the failure only appears when the
 * bundler resolves the runtime module, which is why this class of bug reaches CI green-looking
 * locally. A `import type { … }` would also have erased; it was the VALUE import of the two
 * guards that pulled the graph.
 *
 * Same remedy as public-gex-snapshot-types.ts (#2126): pure shapes and predicates live in their
 * own module that imports nothing, and both the server builder and the client component import
 * from here.
 */

export type HelixThermalSide = {
  available: boolean;
  bias: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  summary: string;
  net_premium?: number | null;
  call_premium?: number | null;
  put_premium?: number | null;
  flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  spot?: number | null;
  gamma_regime?: string | null;
  print_count?: number | null;
};

export type HelixThermalCompareCard = {
  kind: "helix_thermal";
  ticker: string;
  as_of: string;
  helix: HelixThermalSide;
  thermal: HelixThermalSide;
  /** True when flow bias and gamma regime point different directions. */
  conflict: boolean;
  conflict_note: string | null;
};

export type PeerTickerRow = {
  ticker: string;
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  /** True when flow bias and gamma regime disagree for this ticker. */
  conflict: boolean;
  conflict_note: string | null;
};

export type PeerTickerCompareCard = {
  kind: "peer_tickers";
  tickers: string[];
  as_of: string;
  rows: PeerTickerRow[];
  /** True when flow biases diverge across peers (not all same direction). */
  peer_divergence: boolean;
  peer_divergence_note: string | null;
};

export type LargoCompareCard = HelixThermalCompareCard | PeerTickerCompareCard;

export const DEFAULT_PEER_COMPARE_TICKERS = ["NVDA", "AMD", "SMH"] as const;

export function isHelixThermalCompareCard(card: LargoCompareCard): card is HelixThermalCompareCard {
  return card.kind === "helix_thermal";
}

export function isPeerTickerCompareCard(card: LargoCompareCard): card is PeerTickerCompareCard {
  return card.kind === "peer_tickers";
}
