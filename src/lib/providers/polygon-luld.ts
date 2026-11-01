/**
 * Massive/Polygon stocks LULD (Limit Up–Limit Down) WebSocket normalizer.
 * @see https://massive.com/docs/stocks/ws_stocks_luld
 */

export type LuldBandEvent = {
  symbol: string;
  high_band: number | null;
  low_band: number | null;
  indicator: number;
  /** null = band update only; true/false = explicit halt/resume */
  active: boolean | null;
  ts: number;
};

/**
 * Map SIP LULD indicator codes to halt state.
 * 1/2 = band approach (informational); 3/5/6 = pause/halt; 4 = reopen.
 */
export function luldIndicatorHaltState(indicator: number): boolean | null {
  if (indicator === 3 || indicator === 5 || indicator === 6) return true;
  if (indicator === 4) return false;
  return null;
}

/**
 * Normalize a raw LULD WS timestamp (whatever magnitude the upstream actually sends) to epoch ms.
 *
 * BUG FIX: the previous boundary order treated ANY value greater than 1e12 — which is exactly the
 * order of magnitude of a PLAIN MILLISECOND epoch today (~1.7e12) — as needing a ÷1000 "microseconds
 * to ms" conversion. That silently shrinks a correct ms timestamp by 1000x into a seconds-scale
 * number, so every downstream `new Date(ts)` (luld-halts-store.ts's `applyLuldHaltEvents` builds
 * `halted_at: new Date(ev.ts).toISOString()` directly from this value) would render a halt as having
 * started in January 1970 instead of now. Massive's own LULD docs (massive.com/docs/stocks/ws_stocks_luld)
 * literally document the `t` field as "Unix MS" — live sample traffic is actually nanosecond-scale (a
 * separate, already-handled documented-vs-actual mismatch, same shape as this repo's other
 * doc-says-one-thing-wire-says-another provider gotchas), but that makes a genuine millisecond value
 * from this field, or from the `timestamp` fallback name, the DOCUMENTED case, not a hypothetical one —
 * and the old logic mishandled exactly that case.
 *
 * Boundaries are coarse ORDER-OF-MAGNITUDE checks (not exact cutovers), matching this repo's sibling
 * ns/ms disambiguation in `option-trades.ts`'s `tradeMs` and `uw-socket.ts`'s own `ts > 1e12 ? ts : ts *
 * 1000` rule (which keeps an already-ms value as-is — the exact behavior this function restores):
 * seconds ~1e9, ms ~1e12, microseconds ~1e15, nanoseconds ~1e18.
 */
export function luldMsFromRawTimestamp(tsRaw: number, now: number): number {
  if (!Number.isFinite(tsRaw) || tsRaw <= 0) return now;
  if (tsRaw > 1e17) return Math.floor(tsRaw / 1_000_000); // nanoseconds -> ms
  if (tsRaw > 1e14) return Math.floor(tsRaw / 1_000); // microseconds -> ms
  if (tsRaw > 1e11) return Math.floor(tsRaw); // already milliseconds — keep as-is
  return Math.floor(tsRaw * 1000); // seconds -> ms
}

/** Normalize batched Massive stocks WS messages into LULD band/halt events. */
export function normalizeLuldWsMessages(raw: unknown): LuldBandEvent[] {
  const msgs = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: LuldBandEvent[] = [];
  const now = Date.now();
  for (const msg of msgs) {
    if (!msg || typeof msg !== "object") continue;
    const row = msg as Record<string, unknown>;
    const ev = String(row.ev ?? "");
    if (ev !== "LULD") continue;
    const symbol = String(row.T ?? row.sym ?? row.ticker ?? "").toUpperCase();
    if (!symbol) continue;
    const indicator = Number(row.i ?? row.indicators ?? 0);
    const high = Number(row.h ?? row.high ?? NaN);
    const low = Number(row.l ?? row.low ?? NaN);
    const tsRaw = Number(row.t ?? row.timestamp ?? 0);
    const ts = luldMsFromRawTimestamp(tsRaw, now);
    out.push({
      symbol,
      high_band: Number.isFinite(high) ? high : null,
      low_band: Number.isFinite(low) ? low : null,
      indicator: Number.isFinite(indicator) ? indicator : 0,
      active: luldIndicatorHaltState(Number.isFinite(indicator) ? indicator : 0),
      ts,
    });
  }
  return out;
}
