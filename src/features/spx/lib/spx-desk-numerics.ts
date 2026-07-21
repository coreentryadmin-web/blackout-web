// Pure numeric helpers for the SPX desk lanes, extracted from spx-desk.ts so they are unit-testable
// WITHOUT importing that module's heavy, `server-only` dependency chain. No runtime imports here —
// the SpxDeskPulse import is type-only (erased at compile), so this module pulls nothing server-side.
import type { SpxDeskPulse } from "./spx-desk";

/** Round price-like desk numerics at the data layer (deep sweep #21). */
export function roundDeskNum(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Snapshot-age threshold beyond which dealer-gamma data is considered stale (default 30s). */
export const GEX_STALE_MS = (() => {
  const raw = process.env.SPX_GEX_STALE_SEC?.trim();
  const sec = raw ? Number(raw) : 30;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 30_000;
})();

/**
 * GEX is stale when its snapshot age exceeds GEX_STALE_MS (or the age is unknown). BOTH the
 * canonical and the fallback desk-GEX snapshot paths derive the "GEX stale" pill from this single
 * helper. Regression it guards (audit 2026-07-21): the canonical path hardcoded `gex_stale: false`
 * while still reporting a real `gex_age_ms`, so when the UW positioning snapshot lagged (observed
 * live at ~183s during RTH — 6× the 30s threshold) the desk served minutes-old dealer gamma flagged
 * as fresh and the pill never warned. Deriving both paths from the age closes that.
 */
export function gexStaleFromAge(ageMs: number | null): boolean {
  return ageMs == null || ageMs > GEX_STALE_MS;
}

/**
 * Round the price-class numerics on the fast pulse lane at the data layer (repo policy: round once,
 * at the source). buildSpxDeskFull already rounds via roundDeskNum; the pulse lane returned every
 * numeric RAW, so it leaked unrounded floats (observed live every sample: vwap 7500.4571055…,
 * ema20 7490.6383…, lod 7467.860000000001, sma200 6994.99535…) that the merged header ribbon then
 * rendered. Applied to a COPY at return time only — `regime` / `above_vwap` are computed upstream
 * from the RAW ema/vwap, so display rounding never shifts a derived flag.
 */
export function roundPulseNumerics(p: SpxDeskPulse): SpxDeskPulse {
  return {
    ...p,
    price: roundDeskNum(p.price) ?? p.price,
    spx_change_pct: roundDeskNum(p.spx_change_pct) ?? p.spx_change_pct,
    vix: roundDeskNum(p.vix),
    vix_change_pct: roundDeskNum(p.vix_change_pct),
    lod: roundDeskNum(p.lod),
    hod: roundDeskNum(p.hod),
    vwap: roundDeskNum(p.vwap),
    pdh: roundDeskNum(p.pdh),
    pdl: roundDeskNum(p.pdl),
    prior_close: roundDeskNum(p.prior_close),
    gap_pct: roundDeskNum(p.gap_pct),
    ema20: roundDeskNum(p.ema20),
    ema50: roundDeskNum(p.ema50),
    ema200: roundDeskNum(p.ema200),
    sma50: roundDeskNum(p.sma50),
    sma200: roundDeskNum(p.sma200),
    tick: roundDeskNum(p.tick),
    trin: roundDeskNum(p.trin),
    add: roundDeskNum(p.add),
  };
}
