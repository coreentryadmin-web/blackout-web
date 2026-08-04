/**
 * ENGINE B — WHOLE-MARKET BANGER DISCOVERY (pure screen).
 * ============================================================================
 * Ported FAITHFULLY from scripts/audit/market-banger-scan.mjs's `screenMovers`/`nearestFriday` so the
 * research tool and the live production discovery path can never drift onto two different definitions
 * of "banger." See docs/audit/0DTE-RESEARCH.md for the evidence (ANET 0.36->23.3x, PANW 8.4x, JOBY
 * 5.8x — whole-market breakout screens surface these constantly; the exit, not the find, is the edge —
 * src/lib/zerodte/scale-out.ts is that exit).
 *
 * ZERO CAPS (operator direct instruction, 2026-08-04): unlike market-banger-scan.mjs's research
 * `--top=25` slice, `screenBangerMovers` here does NOT truncate to a top-N — every row clearing the
 * gain/volume/price/close-strength bar is returned. The commit orchestrator (commit.ts) attempts a
 * contract + position for EVERY qualifying name, not just a top slice. This mirrors FINDINGS
 * 2026-07-25's discovery-recall-probe finding that a top-N $-volume cap on Engine A's breakout screen
 * silently drops real winners; Engine B does not repeat that mistake.
 */

/** One day's grouped-daily row shape (Polygon `/v2/aggs/grouped/locale/us/market/stocks/{date}`). */
export type GroupedDailyRow = {
  T: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type BangerMover = {
  ticker: string;
  close: number;
  gain: number;
  vol: number;
  dollar: number;
  closeStrength: number;
};

export type BangerScreenConfig = {
  priceMin: number;
  priceMax: number;
  minVol: number;
  minGain: number;
  /** Max fraction of the day's range given back off the high at the close (closed-strong filter). */
  maxCloseGiveback: number;
};

export const DEFAULT_BANGER_SCREEN_CONFIG: BangerScreenConfig = {
  priceMin: 5,
  priceMax: 400,
  minVol: 1_000_000,
  minGain: 0.05,
  maxCloseGiveback: 0.5,
};

/**
 * Whole-market screen -> ranked movers, sorted by dollar-volume desc. NO top-N slice — every
 * qualifying row is returned (zero caps; see file header). Faithful port of `screenMovers` in
 * scripts/audit/market-banger-scan.mjs.
 */
export function screenBangerMovers(
  results: readonly GroupedDailyRow[],
  config: BangerScreenConfig = DEFAULT_BANGER_SCREEN_CONFIG,
): BangerMover[] {
  const { priceMin, priceMax, minVol, minGain, maxCloseGiveback } = config;
  return results
    .filter((x) => {
      if (!x || typeof x.T !== "string" || !x.T) return false;
      if (![x.o, x.h, x.l, x.c, x.v].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
      if (!(x.o > 0)) return false;
      if (x.c < priceMin || x.c > priceMax) return false;
      if (x.v < minVol) return false;
      if ((x.c - x.o) / x.o < minGain) return false;
      const range = Math.max(1e-9, x.h - x.l);
      if ((x.h - x.c) / range > maxCloseGiveback) return false;
      return true;
    })
    .map((x) => ({
      ticker: x.T.toUpperCase(),
      close: x.c,
      gain: (x.c - x.o) / x.o,
      vol: x.v,
      dollar: x.v * x.c,
      closeStrength: (x.c - x.l) / Math.max(1e-9, x.h - x.l),
    }))
    .sort((a, b) => b.dollar - a.dollar);
}

/** YYYY-MM-DD for a Date, UTC. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Nearest Friday at least `minAhead` calendar days after `dateStr` — the weekly-expiry resolver.
 * Faithful port of `nearestFriday` in scripts/audit/market-banger-scan.mjs.
 */
export function nearestWeeklyExpiry(dateStr: string, minAhead = 4): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minAhead);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}
