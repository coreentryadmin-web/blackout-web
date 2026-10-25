// ── Night Hawk 0DTE ticker universe (operator directive, 2026-10-25) ───────────────────────────
// WHY THIS EXISTS: the operator explicitly asked to narrow the ENTIRE 0DTE desk's eligible
// universe — first "I only want the Mag 7s, SPX SPY and QQQ to come onto 0 DTE Desk", then
// restated with the exact, final ticker list: "Restrict both FLOW and BREAKOUT to AAPL, MSFT,
// NVDA, AMZN, GOOGL, META, TSLA, SPX, SPY, and QQQ." — away from its prior whole-market scope
// (FLOW screens every UW alert, BREAKOUT screens the whole grouped-daily market, PIN evaluates a
// 30-name curated list). This is the single source of truth all three discovery origins check, so
// a ticker not in this set can never reach the board regardless of which origin would otherwise
// have found it. The final list is GOOGL only (not GOOG) — the operator's exact enumeration, not
// an inference.
//
// TICKER-SPELLING TRAP (same one zerodte-swift-comparison.mjs's own correctness note documents —
// do not reintroduce it here): a raw UW flow alert for an SPX 0DTE print carries the ticker field
// as the real option ROOT, "SPXW", not "SPX". Both spellings are listed below so every consumer
// (FLOW's raw alert ticker, PIN's own `SPX`-keyed universe, any future caller) matches what it
// actually sees — harmless duplication, never a silent drop. This is a spelling alias for the
// SAME named underlying (SPX), not an addition to the operator's list.
export const DEFAULT_ZERODTE_TICKER_UNIVERSE = [
  // Mag 7 (per the operator's exact list — GOOGL only, not GOOG)
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
  // Index/ETF core (both SPX option-root spellings — see header)
  "SPX", "SPXW", "SPY", "QQQ",
] as const;

/** Resolve the 0DTE ticker universe: env override (ZERODTE_TICKER_UNIVERSE, comma-separated)
 *  else the default above. Mirrors `resolvePinUniverse`'s existing env-override pattern
 *  (pin-discovery.ts) so operators have one consistent way to widen/narrow either list without a
 *  code change. Returns a Set for O(1) membership checks at every discovery call site. */
export function resolveZeroDteTickerUniverse(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ZERODTE_TICKER_UNIVERSE;
  if (raw && raw.trim()) {
    const list = raw
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (list.length > 0) return new Set(list);
  }
  return new Set(DEFAULT_ZERODTE_TICKER_UNIVERSE);
}
