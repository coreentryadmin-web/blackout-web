/**
 * REGIME CLASSIFIER for the Banger adversarial real-bar validation (operator directive 2026-09-27:
 * "Bull, bear, sideways, high-volatility and low-volatility regimes"). A COPY, not an import, of the
 * SPY EMA-trend-stack shape already used in production (`src/lib/swing/swing-ingest.ts`'s
 * `emaStackFromCloses`/`regimeFromSpyTrend`) — reused for methodological consistency with the rest of
 * this repo's audit tooling (`swing-loss-taxonomy-segment.mjs`/`swing-regime-gate-recall-probe.mjs`
 * independently reconstruct the identical stack for the same reason), not imported directly because
 * production's file pulls in unrelated swing-only dependencies (sector-map, structure-levels) an
 * audit script for a completely different product (Banger/0DTE-style weeklies) has no business
 * depending on.
 *
 * NULL-HONEST: fewer than MIN_BARS_FOR_STACK closes returns an ABSENT classification, never a
 * fabricated label — same discipline as production's own comment on this exact point.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

const MIN_BARS_FOR_STACK = 55; // 50-EMA + a slope window, same threshold production uses.
const EMA_SLOPE_WINDOW = 5;

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Standard EMA over an ascending closes array; null if too short. */
export function emaFromCloses(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/** The bullish-stated EMA trend stack (undefined flags when there isn't enough history). */
export function emaStackFromCloses(closes) {
  if (!Array.isArray(closes) || closes.length < MIN_BARS_FOR_STACK) return {};
  const last = closes[closes.length - 1];
  const ema20 = emaFromCloses(closes, 20);
  const ema50 = emaFromCloses(closes, 50);
  const ema50Prior = emaFromCloses(closes.slice(0, -EMA_SLOPE_WINDOW), 50);
  return {
    priceAboveEma20: ema20 != null && finite(last) ? last > ema20 : undefined,
    ema20AboveEma50: ema20 != null && ema50 != null ? ema20 > ema50 : undefined,
    ema50Rising: ema50 != null && ema50Prior != null ? ema50 > ema50Prior : undefined,
  };
}

/**
 * Coarse 3-way label from the trend stack: BULL requires all three flags bullish; BEAR requires all
 * three bearish; anything mixed (e.g. price above EMA20 but EMA50 falling) is SIDEWAYS -- a
 * deliberately conservative "only the unambiguous cases get a directional label" rule, since a
 * regime segmentation that forces every mixed day into bull-or-bear would manufacture false
 * separation. Returns null (absent) when there isn't enough history, never a fabricated label.
 */
export function classifyRegimeLabel(closesAscendingUpToAndIncludingDate) {
  const stack = emaStackFromCloses(closesAscendingUpToAndIncludingDate);
  const hasStack = stack.priceAboveEma20 != null || stack.ema20AboveEma50 != null || stack.ema50Rising != null;
  if (!hasStack) return null;
  const flags = [stack.priceAboveEma20, stack.ema20AboveEma50, stack.ema50Rising];
  if (flags.every((f) => f === true)) return "BULL";
  if (flags.every((f) => f === false)) return "BEAR";
  return "SIDEWAYS";
}

/**
 * Builds a date -> regime-label map from an ascending {t, c} daily-bar series, using ONLY bars
 * up to and including each date (never a future bar) -- the caller-side no-look-ahead guard this
 * shared style of reconstruction always needs, same discipline as
 * `swing-cadence-gap-recall-probe.mjs`'s own future-leak guard.
 */
export function buildRegimeByDateMap(spyBarsAscending) {
  const map = new Map();
  const closes = [];
  for (const b of spyBarsAscending) {
    if (!finite(b.c)) continue;
    closes.push(b.c);
    const dateKey = new Date(b.t).toISOString().slice(0, 10);
    map.set(dateKey, classifyRegimeLabel(closes));
  }
  return map;
}

/**
 * Volatility quantile bucketing (HIGH / LOW split at the median VIX-close over the observed window)
 * from a date -> vixClose map, applied to a set of dates. Median split rather than a fixed VIX level
 * because Banger's real closed population spans one ~7-8 week window (per this study's own data-
 * availability finding) -- an absolute VIX threshold picked from a longer history would be
 * arbitrary here; a within-sample median is honest about what it is (a RELATIVE split over this
 * exact window, not a universal vol regime call).
 */
export function classifyVolLabel(vixCloseForDate, medianVix) {
  if (!finite(vixCloseForDate) || !finite(medianVix)) return null;
  return vixCloseForDate >= medianVix ? "HIGH_VOL" : "LOW_VOL";
}

export function median(values) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[m - 1] + v[m]) / 2 : v[m];
}
