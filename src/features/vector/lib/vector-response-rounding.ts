/**
 * Per-key decimal-place overrides for the Vector API's `roundFloats` calls.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every Vector read wraps its payload in `roundFloats(...)` with the default `dp = 2`. That is
 * correct for the dollar-scale majority of those payloads (spot, strikes, wall levels, band bounds,
 * bar OHLC) and WRONG for the handful of fields that are *fractions of one*, because 2dp quantizes
 * them to the nearest 1% — which for a small fraction means quantizing them to ZERO.
 *
 * Caught live 2026-08-07 09:47 ET on `GET /api/market/vector/expected-move`:
 *
 *   SPX  spot 7737.83  1σ movePts 31    true movePct 0.004006  ->  SERVED movePct 0     (renders 0.00%)
 *   NVDA spot 222.06   1σ movePts 2.71  true movePct 0.012204  ->  SERVED movePct 0.01  (renders 1.00%, true 1.22%)
 *   ASTS spot 69.78    1σ movePts 2.55  true movePct 0.036544  ->  SERVED movePct 0.04  (renders 4.00%, true 3.65%)
 *
 * i.e. a member reading SPX saw the self-contradictory line "1σ expected move: ±31 pts (0.00%)".
 * `movePct` is a FRACTION (`move1 / spot`, vector-expected-move.ts:89, asserted to 1e-12 by
 * vector-expected-move.test.ts) — it was never a percentage, so 2dp destroys it outright.
 *
 * This is the exact hazard `round-floats.ts` documents in its own header ("the 2dp default would
 * quantize it to 0.00 and DESTROY the number") and the reason `keyDp` was added — it simply was not
 * used at these call sites. Centralizing the map here rather than inlining an object literal per
 * route means the next Vector read that serves a fraction inherits the right precision instead of
 * re-discovering this bug.
 *
 * SCOPE NOTE: `roundFloats` matches on the IMMEDIATE key a number sits under, so these names only
 * need to be unique within a single Vector payload, not repo-wide. Dollar-scale siblings in the
 * same payload (spot / movePts / low / high / strike) deliberately keep the 2dp default — they are
 * prices and 2dp is the right precision for them.
 */
export const VECTOR_FRACTION_DP = {
  /** expected-move: 1σ move as a fraction of spot. SPX's is ~0.004 — 2dp is a hard zero. */
  movePct: 6,
  /** expected-move: annualized ATM IV as a decimal (0.15 = 15%). 2dp loses a full vol point. */
  atmIv: 4,
  /**
   * expected-move: time to expiry in DAYS, and fractional for 0DTE — the engine's own doc requires
   * "the FRACTION OF THE TRADING DAY REMAINING … NOT 0", and `computeExpectedMove` returns null on
   * `!(dteDays > 0)`. At 2dp every intraday value collapses to exactly the input the engine defines
   * as invalid, so the payload contradicts itself: a non-null band alongside `dteDays: 0`.
   *
   * Caught LIVE 2026-08-21 01:23 UTC on `GET /api/market/vector/expected-move?ticker=SPX`:
   *   served dteDays 0  ·  true 0.00069445 (60s to expiry)  ·  band still present (±210.8 pts)
   * Recovered from the served payload as (movePct / atmIv)^2 * 365 — the engine's own formula.
   *
   * Weekly/monthly horizons are whole days and pass through untouched (roundFloats short-circuits
   * on integers); 6dp is ~0.09s of resolution, far finer than the quantity is ever known to.
   */
  dteDays: 6,
  /** pin-forecast: confidence 0..1. The core already emits it at toFixed(3); 2dp threw that away. */
  pinPct: 3,
  /** pin-forecast: magnet strength as a fraction of chain OI. Small on a diffuse book. */
  strengthPct: 3,
  /** pin-forecast: per-scenario probability 0..1. A 0.4%-probability tail rounded to 0 reads as impossible. */
  p: 4,
  /** pin-forecast: driver weight 0..1 — the ordering key for the click-to-explain list. */
  weight: 3,
} as const;
