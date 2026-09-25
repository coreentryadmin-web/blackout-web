/**
 * TICKER → SECTOR / THEME map for the Allocation Engine's duplicate-thesis clustering.
 *
 * The allocation layer clusters by (sector, direction) so NVDA/AMD/SMCI all-bullish reads as one semis
 * thesis, not three edges. That needs a ticker→theme lookup. This is a curated static map of the liquid,
 * high-flow options universe the 0DTE board actually surfaces — deliberately THEME-grained (not raw GICS):
 * "semis", "crypto-equity", "china-adr" cluster the way a trader's RISK does, which is what concentration is
 * really about. Unknown tickers return null → the Allocation Engine keys them by ticker (their own cluster),
 * so an unmapped name is NEVER falsely merged into a shared thesis.
 *
 * PURE. Extend as new names show up on the board; a later slice can fall back to a live Polygon/UW sector
 * lookup for the long tail, but this covers the names that actually cluster in practice.
 */

const SECTORS: Record<string, string[]> = {
  "index-etf": ["SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "RUT"],
  semis: ["NVDA", "AMD", "SMCI", "MU", "AVGO", "TSM", "INTC", "ARM", "MRVL", "QCOM", "ASML", "LRCX", "AMAT", "TXN", "ON", "NXPI"],
  megatech: ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META"],
  // PLTU is a leveraged single-stock ETF tracking PLTR itself — same bet, different wrapper.
  software: ["PLTR", "PLTU", "CRM", "NOW", "SNOW", "ADBE", "ORCL", "CRWD", "NET", "DDOG", "PANW", "MDB", "ZS", "SHOP"],
  "ev-auto": ["TSLA", "RIVN", "LCID", "F", "GM"],
  financials: ["JPM", "GS", "BAC", "MS", "WFC", "C", "SCHW", "BLK", "AXP", "V", "MA"],
  energy: ["XOM", "CVX", "OXY", "SLB", "COP", "MPC", "PSX", "DVN", "HAL"],
  // MSTU/MSTX are leveraged single-stock ETFs tracking MSTR itself — same bet, different wrapper.
  // GLXY (Galaxy Digital) and SBET (crypto-treasury) are crypto-holdings proxies in the same risk
  // bucket as COIN/MARA/etc.
  // Extended 2026-09-20 (Ask Largo standing mandate, live repro: a 2026-09-18 Banger-promoted swing
  // batch of 36 positions was, per checkPortfolioOverlap's own "Book overlap" evidence line, reporting
  // only 11 same-direction crypto-equity positions when the live book actually held ~25+ crypto-price-
  // correlated names — every one of the additions below was live and committed at the time this was
  // found). GEMI (Gemini Space Station), BKKT (Bakkt), ABTC (American Bitcoin Corp) and BLSH (Bullish)
  // are crypto exchanges/custodians — same risk bucket as COIN. BMNR (Bitmine Immersion) and BTDR
  // (Bitdeer) are bitcoin miners — same risk bucket as MARA/RIOT/CLSK/HUT/IREN. ETH, ETHE, ETHU, ETHA
  // are direct Ethereum trust/ETF wrappers and IBIT, GBTC, BITO, BITX are direct Bitcoin trust/ETF
  // wrappers — not equities, but an EVEN MORE direct crypto-price read than the mining/holding equities
  // already in this bucket, so they belong in the same concentration cluster, not their own isolated
  // one. Deliberately conservative: left out names with only partial/ambiguous crypto correlation
  // (HOOD, CRCL, APLD, BULL) rather than over-reaching this pass.
  "crypto-equity": [
    "COIN", "MARA", "RIOT", "MSTR", "CLSK", "HUT", "CIFR", "BITF", "WULF", "IREN", "MSTU", "MSTX", "GLXY", "SBET",
    "GEMI", "BKKT", "ABTC", "BLSH", "BMNR", "BTDR",
    "ETH", "ETHE", "ETHU", "ETHA", "IBIT", "GBTC", "BITO", "BITX",
  ],
  "china-adr": ["BABA", "PDD", "NIO", "JD", "BIDU", "LI", "XPEV", "FUTU"],
  // Added 2026-09-25 (Ask Largo standing mandate, live finding): a real committed book held RGTI+QBTS+IONQ
  // concurrently LONG (same TACTICAL/BREAKOUT batch) — all unmapped, so checkPortfolioOverlap reported no
  // concentration for a genuinely correlated 3-name basket (each resolved to its own isolated cluster).
  // Same gap shape/fix as the 2026-09-20 crypto-equity extension above. RGTI (Rigetti), QBTS (D-Wave),
  // IONQ (IonQ) and QUBT (Quantum Computing Inc) are the four liquid, options-active pure-play quantum-
  // computing names that trade as one basket-level bet — deliberately conservative (per the crypto-equity
  // precedent's own note), leaving out names with only partial/ambiguous quantum exposure.
  "quantum-computing": ["RGTI", "QBTS", "IONQ", "QUBT"],
  consumer: ["NKE", "SBUX", "MCD", "DIS", "WMT", "COST", "TGT", "LULU", "CMG"],
  healthcare: ["LLY", "UNH", "PFE", "JNJ", "MRNA", "ABBV", "TMO", "AMGN"],
  "ai-power": ["VST", "CEG", "NEE", "GEV", "OKLO", "SMR", "ASTS"],
  // Single-stock leveraged ETFs whose underlying has no existing themed peer — each pair is its OWN
  // cluster (never merged with an unrelated leveraged-ETF pair) so RBLU only overlaps with RBLX, etc.
  roblox: ["RBLX", "RBLU"],
  gamestop: ["GME", "GMEU"],
  sofi: ["SOFI", "SOFX"],
};

// Inverted once at module load: TICKER → sector.
const TICKER_TO_SECTOR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [sector, tickers] of Object.entries(SECTORS)) for (const t of tickers) m[t] = sector;
  return m;
})();

/** Theme/sector for a ticker, or null when unmapped (→ its own cluster, never a false shared thesis). */
export function sectorFor(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  return TICKER_TO_SECTOR[ticker.trim().toUpperCase()] ?? null;
}

/** The full inverted map (for tooling / coverage checks). */
export const KNOWN_SECTORS = Object.freeze({ ...TICKER_TO_SECTOR });
