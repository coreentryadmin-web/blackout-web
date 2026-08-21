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

/**
 * How fresh the reading behind a side is. `getGexPositioning` is a documented STRICT CACHE
 * READER — it never hits a second upstream — so "cached" is the honest steady-state value for
 * the gamma side, not a degraded one.
 *
 * Carried because `age_seconds` alone is not freshness: the gamma side's age is the age of the
 * MATRIX COMPUTATION, and a matrix recomputed 300 seconds ago can be modelling a price that
 * settled four and a half hours earlier. A reader given only the age lands straight back in the
 * bug this card was fixed for.
 */
export type CompareFreshness = "live" | "delayed" | "cached" | "snapshot" | "stale" | null;

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
  /**
   * Flow side only — the ANALYSED span of the prints summed, oldest to newest, in hours. This is
   * EVIDENCE (the tape's own print timestamps), NOT the requested lookback. On an index name the
   * 500-print limit binds long before the 168h window does — measured live 2026-08-20, a 168h /
   * limit-500 request came back with 500 rows spanning 54 minutes — so reporting the request here
   * let a model say "over the last 7 days SPX leads net premium" about under an hour of tape. The
   * requested bound is an intent; only the prints are evidence. Null when no print carried a usable
   * time (all ingest-stamped, or empty tape) — never zero. See window_hours_requested for the intent.
   */
  window_hours?: number | null;
  /** Flow side only — the REQUESTED lookback (intent), kept beside window_hours as provenance. */
  window_hours_requested?: number | null;
  /**
   * Flow side only — TRUE when the print limit bound before the window did, so window_hours is a
   * fraction of window_hours_requested. The tell that this population is "the most recent N prints",
   * not "the whole requested window" — read it before quoting window_hours as a lookback.
   */
  window_limit_reached?: boolean | null;
  /** Gamma side only — when the underlying matrix was computed (NOT when this card was built). */
  matrix_asof?: string | null;
  /** Gamma side only — that matrix time as an ET wall-clock stamp. */
  matrix_asof_et?: string | null;
  /** Gamma side only — the ET SESSION that matrix belongs to. Never derive it from a UTC date. */
  matrix_session_date?: string | null;
  /** How fresh this side's reading is — see CompareFreshness for why age alone is not enough. */
  freshness?: CompareFreshness;
  /**
   * Age of THIS side's reading in whole seconds. On the gamma side this is the age of the matrix
   * COMPUTATION, not of the price it models — read it with `freshness` and `market_session`.
   */
  age_seconds?: number | null;
};

/**
 * The non-directional relationship between the two sides.
 *
 * Replaces a field that was removed rather than leaving the card silent. The old flow-vs-gamma
 * "conflict" flag asserted a DIRECTION conflict against a gamma read that has no direction, so
 * every `true` it produced was manufactured. But the real relationship is meaningful and was
 * simply never expressed: bullish flow entering an AMPLIFYING (short-gamma) regime is a
 * materially higher-variance position than the same flow entering a SUPPRESSING one, because the
 * tape accelerates in both directions rather than being faded back toward heavy strikes.
 *
 * Null whenever either side is unknown — the same "nothing was compared" honesty the conflict
 * flag now carries.
 */
export type CompareRegimeInteraction = {
  flow_bias: "bullish" | "bearish" | "neutral";
  volatility_regime: "suppressing" | "amplifying";
  /** One line naming the interaction, never a direction call on the gamma side. */
  read: string;
} | null;

export type HelixThermalCompareCard = {
  kind: "helix_thermal";
  ticker: string;
  /**
   * When this CARD was built, as an ET wall-clock stamp ("2026-08-21 09:31 ET").
   *
   * NOT a UTC ISO instant. A UTC instant rolls its calendar DATE at 20:00 ET, so for the last
   * four hours of every trading day anything resolving "which session is this" from it is a full
   * session ahead — the defect class fixed in #2418 (bars) and #2420 (Helix expiry). Null only
   * when the stamp cannot be formatted, never a silently wrong date.
   */
  as_of: string | null;
  /** The ET SESSION this card belongs to (YYYY-MM-DD) — the anchor `as_of` alone cannot give. */
  session_date?: string | null;
  /** Machine-orderable UTC instant, kept alongside the ET stamp for consumers that sort on it. */
  as_of_utc?: string;
  /** ET cash-session phase when the card was built (OPEN / PRE-MARKET / AFTER-HOURS / CLOSED). */
  market_session?: string;
  helix: HelixThermalSide;
  thermal: HelixThermalSide;
  /** Non-directional flow-vs-regime interaction — see CompareRegimeInteraction. */
  regime_interaction?: CompareRegimeInteraction;
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
  /** Non-directional flow-vs-regime interaction for this peer — see CompareRegimeInteraction. */
  regime_interaction?: CompareRegimeInteraction;
};

export type PeerTickerCompareCard = {
  kind: "peer_tickers";
  tickers: string[];
  /** ET wall-clock stamp — see HelixThermalCompareCard.as_of for why this is not a UTC ISO. */
  as_of: string | null;
  /** The ET SESSION this card belongs to (YYYY-MM-DD). */
  session_date?: string | null;
  /** Machine-orderable UTC instant, kept alongside the ET stamp. */
  as_of_utc?: string;
  /** ET cash-session phase when the card was built (OPEN / PRE-MARKET / AFTER-HOURS / CLOSED). */
  market_session?: string;
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
