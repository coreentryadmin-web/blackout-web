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
  software: ["PLTR", "CRM", "NOW", "SNOW", "ADBE", "ORCL", "CRWD", "NET", "DDOG", "PANW", "MDB", "ZS", "SHOP"],
  "ev-auto": ["TSLA", "RIVN", "LCID", "F", "GM"],
  financials: ["JPM", "GS", "BAC", "MS", "WFC", "C", "SCHW", "BLK", "AXP", "V", "MA"],
  energy: ["XOM", "CVX", "OXY", "SLB", "COP", "MPC", "PSX", "DVN", "HAL"],
  "crypto-equity": ["COIN", "MARA", "RIOT", "MSTR", "CLSK", "HUT", "CIFR", "BITF", "WULF", "IREN"],
  "china-adr": ["BABA", "PDD", "NIO", "JD", "BIDU", "LI", "XPEV", "FUTU"],
  consumer: ["NKE", "SBUX", "MCD", "DIS", "WMT", "COST", "TGT", "LULU", "CMG"],
  healthcare: ["LLY", "UNH", "PFE", "JNJ", "MRNA", "ABBV", "TMO", "AMGN"],
  "ai-power": ["VST", "CEG", "NEE", "GEV", "OKLO", "SMR", "ASTS"],
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
