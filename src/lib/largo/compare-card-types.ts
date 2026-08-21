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

/**
 * Dealer gamma posture, mirrored verbatim from `GexPositioning.gamma_posture`.
 * Carried as its OWN typed field rather than folded into `bias` because it does not
 * live on a directional axis — see `volatility_regime` below.
 */
export type CompareGammaPosture = "long" | "short" | null;

/**
 * What dealer hedging does to REALIZED VOLATILITY — the axis dealer gamma actually
 * lives on. Long gamma means dealers sell rallies and buy dips, damping moves toward
 * heavy strikes ("suppressing"); short gamma means they hedge WITH the move, so a push
 * in EITHER direction is amplified ("amplifying").
 *
 * This exists because the previous code projected gamma onto the same bullish/bearish
 * axis as order flow, which is a category error: "short gamma" is not bearish, it is
 * direction-agnostic vol expansion. Publishing it as `bearish` made the card assert a
 * direction the matrix never measured.
 */
export type CompareVolatilityRegime = "suppressing" | "amplifying" | null;

export type HelixThermalSide = {
  available: boolean;
  /**
   * DIRECTIONAL read, and only ever set from a genuinely directional measurement.
   * The FLOW side derives it from signed call-vs-put premium. The GAMMA side never
   * reports "bullish"/"bearish" — dealer gamma has no direction — so it reports
   * "neutral" (long gamma: mean-reverting), "mixed" (short gamma: amplifies both
   * ways) or "unknown". See `volatility_regime` for the gamma side's real axis.
   */
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
  /** Gamma side only — the typed posture straight off the positioning contract. */
  gamma_posture?: CompareGammaPosture;
  /** Gamma side only — what that posture does to realized vol. */
  volatility_regime?: CompareVolatilityRegime;
};

export type HelixThermalCompareCard = {
  kind: "helix_thermal";
  ticker: string;
  as_of: string;
  helix: HelixThermalSide;
  thermal: HelixThermalSide;
  /**
   * True ONLY when both sides produced a real, directional reading and those readings
   * oppose. Two absent sides are NOT agreement: when either side is unknown this is
   * `false` and `conflict_note` explains that nothing was compared, so a reader can
   * tell "we checked and they agree" from "we could not check".
   */
  conflict: boolean;
  conflict_note: string | null;
};

export type PeerTickerRow = {
  ticker: string;
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  /** True only when BOTH sides are known and directionally oppose — see HelixThermalCompareCard.conflict. */
  conflict: boolean;
  conflict_note: string | null;
};

export type PeerTickerCompareCard = {
  kind: "peer_tickers";
  tickers: string[];
  as_of: string;
  rows: PeerTickerRow[];
  /**
   * True when peers with a KNOWN flow bias point in opposite directions. Requires at
   * least two peers to have produced a directional reading — one lone bullish name
   * beside two unknowns is not divergence, it is one data point.
   */
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
