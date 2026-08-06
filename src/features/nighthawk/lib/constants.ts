export const INDEX_TICKERS = ["SPY", "QQQ", "IWM", "XLF", "XLE", "XLK", "SMH", "XBI", "GLD", "TLT"] as const;

export const INDEX_SET = new Set<string>([
  ...INDEX_TICKERS,
  "SPX",
  "SPXW",
  "NDX",
  "RUT",
  "VIX",
  "UVXY",
]);

export const INDEX_ETF_PLAYS = ["SPY", "QQQ", "IWM", "XLF", "XLE", "XLK"] as const;

/**
 * Leveraged / inverse ETFs and VIX ETPs — excluded from single-name candidate
 * discovery (audit MEDIUM: no security-type filter existed, so a 3× semi ETF with
 * unusual option premium became a full "stock" candidate and was scored by machinery
 * built for single names — fundamentals/insider/congress all N/A). Index products
 * proper live in INDEX_SET; this set covers the geared/derivative wrappers.
 */
export const LEVERAGED_ETP_SET = new Set<string>([
  "TQQQ", "SQQQ", "SOXL", "SOXS", "SPXL", "SPXS", "SPXU", "UPRO", "SDS", "SSO",
  "QLD", "QID", "TNA", "TZA", "FAS", "FAZ", "LABU", "LABD", "TECL", "TECS",
  "NUGT", "DUST", "JNUG", "JDST", "YINN", "YANG", "ERX", "ERY", "DRN", "DRV",
  "TMF", "TMV", "BOIL", "KOLD", "UCO", "SCO", "DPST", "WEBL", "WEBS", "BULZ", "BERZ",
  "UVXY", "SVXY", "VXX", "UVIX", "SVIX", "VIXY", "VIXM",
  "TSLL", "TSLQ", "TSLS", "NVDL", "NVDD", "NVDS", "MSTU", "MSTZ", "MSTX", "CONL", "AMDL", "AMZU", "GGLL", "METU", "FBL",
]);

/** Minimum underlying price for a single-name candidate (penny/garbage-runner floor).
 *  Raised from $2 to $5 — $2-$4 names have unreliable options chains and whipsaw. */
export const CANDIDATE_MIN_UNDERLYING_PRICE = 5;

export const SECTOR_WATCH = [
  { key: "technology", label: "Technology" },
  { key: "financial", label: "Financials" },
  { key: "energy", label: "Energy" },
  { key: "healthcare", label: "Healthcare" },
  { key: "consumer", label: "Consumer" },
] as const;

// Raised 60→90 (2026-08-05, discovery-architecture redesign): paired with the new confluence
// admission requirement in extractMultiSourceCandidates (single-lane names beyond a protected
// top slice now need source_count>=2 to enter the pool) — a wider net BEFORE the stricter filter,
// so raising the cap alone never dilutes the pool; it only gives the stricter filter more real
// candidates to choose from. Live evidence motivating this (docs/audit/FINDINGS.md 2026-08-05):
// a night with a similar-sized raw candidate count (54 vs 60) collapsed from 5 published plays to
// 1 — the funnel was selectivity-starved, not candidate-starved, so the fix pairs MORE raw
// candidates with SMARTER admission, not a bigger pool alone. Dossier-stage UW fan-out is still
// paced by the rate limiter (uw-rate-limiter.ts), so the cap belongs there, not here.
export const MAX_CANDIDATES = 90;
/** Candidate pool: weighted-premium leaders + unusual-flow movers. */
export const CANDIDATE_PREMIUM_SLOTS = 28;
export const CANDIDATE_UNUSUAL_SLOTS = 12;
export const CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS = 30;
/** Floor for 30d avg premium — avoids divide-by-zero on thin history. */
export const CANDIDATE_MIN_BASELINE_PREMIUM = 75_000;
export const MAX_DOSSIER_STOCKS = 40;
/** Legacy volume-first synthesis cap. Global-strongest mode uses MAX_DOSSIER_STOCKS instead. */
export const EDITION_SYNTHESIS_POOL = 18;
/** Final play count shown in the UI (PlaybookBoard renders 5 slots). */
export const EDITION_TARGET_PLAYS = 5;
/** Minimum plays before ops pages on a thin edition — backfill from ranked pool when below. */
export const EDITION_MIN_PUBLISH_PLAYS = 3;
/** PR-N28: minimum composite score to publish a play. Measured overnight track record:
 *  below-40 plays (C conviction) underperform consistently. The prime band is 40-55.
 *  Raised from 35→42 based on 0% WR on current-methodology cohort (0 wins, 2 losses,
 *  10 opens out of 12 scoreable — the floor was admitting garbage). Better to publish
 *  3 strong plays than 5 where half are noise. */
export const MIN_PUBLISH_SCORE = 42;
/** PR-N31 / 2026-07-29 precision: lower floor for the diversity/hedge slot.
 *  Was 20 — live 2026-07-30 edition shipped AI@26 + SNDQ@20 with empty "mixed ·"
 *  theses as hedge filler. Raised 20→35: still below the organic 42 floor so a real
 *  minority-view hedge can clear, but noise-level scores no longer occupy a slot.
 *  Prefer a clean 3-play all-LONG/SHORT book over a 5-play book with garbage hedges. */
export const DIVERSITY_HEDGE_FLOOR = 35;
/** PR-N33 / 2026-07-29 precision: forced contrarian path floor. Raised 25→35 to match
 *  the diversity hedge floor — forced re-scores with discounted flow must still show
 *  genuine tech/positioning support. Below 35 the play is rounding noise, not a hedge.
 *  Carries a gate_warning when published. */
export const FORCED_CONTRARIAN_FLOOR = 35;
/** Overshoot sent through synthesis + critic — critic cuts weak plays with no backfill. */
export const EDITION_SYNTHESIS_OVERSHOOT = 9;
/** Stock tickers to prefetch option chains for (buffer above 5 final plays).
 *  Raised from 28 to 40 — matches MAX_DOSSIER_STOCKS so every dossier'd candidate
 *  gets a chain lookup. The narrower 28 meant candidates ranked 29-60 could never get
 *  a real contract, even when higher-ranked names failed premium/OI gates. */
export const EDITION_CHAIN_PREFETCH = 40;
export const MIN_STOCK_FLOW_PREMIUM = 100_000;
export const MIN_HOT_CHAIN_PREMIUM = 500_000;
/** Market-wide flow tape — higher limit captures late-session event volume. */
export const MARKET_FLOW_ALERT_LIMIT = 450;
export const DOSSIER_BATCH_SIZE = Math.max(
  1,
  Math.floor(Number(process.env.NH_DOSSIER_BATCH_SIZE ?? 2))
);
export const DOSSIER_FETCH_TIMEOUT_MS = 8000;
export const DOSSIER_INTER_BATCH_MS = 800;
/** Hard cap per ticker so one hung UW/Polygon call cannot stall the whole 60-name stage. */
export const DOSSIER_TICKER_WALL_MS = Math.max(
  15_000,
  Math.floor(Number(process.env.NH_DOSSIER_TICKER_WALL_MS ?? 45_000))
);

/** Max option entry premium per share — 1 standard contract (100 shares) ≤ $3,500.
 *  Raised from $20 to $35 (PR-N15): the $20 cap blocked every ATM option on stocks above
 *  ~$250, silently eliminating the strongest institutional-flow names from the playbook. */
export const MAX_OPTION_PREMIUM_PER_SHARE = 35;
export const MAX_OPTION_COST_PER_CONTRACT = MAX_OPTION_PREMIUM_PER_SHARE * 100;

export const PLAYBOOK_PREMIUM_CAP_LINE = `Entry option premium MUST be ≤ $${MAX_OPTION_PREMIUM_PER_SHARE}/share (≤ $${MAX_OPTION_COST_PER_CONTRACT.toLocaleString()} per 1-lot contract). If no suitable contract exists under this cap, skip the ticker and substitute the next-ranked candidate.`;

