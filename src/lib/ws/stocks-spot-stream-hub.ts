/**
 * Support module for the generalized stock/ETF spot-price SSE stream
 * (/api/market/stocks/spot-stream). Pure/testable pieces live here so
 * route.ts stays a thin ReadableStream wrapper (mirrors the split already
 * used for Vector — see features/vector/lib/vector-stream-hub.ts).
 *
 * Design note (PR 2/3 of the sub-second-spot project): unlike Vector, this
 * endpoint is NOT one-ticker-per-connection. A single connection carries
 * whatever tickers ARE currently on that viewer's screen (per-viewer dynamic
 * subscription, not a broadcast-to-everyone-of-all-8000-tickers model) —
 * see docs/audit/FINDINGS.md for why a full-universe broadcast was rejected.
 */
import { getStockLiveCandle } from "./stock-candle-store";

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

/** Max distinct tickers one SSE connection may subscribe to at once. */
export const MAX_TICKERS_PER_STREAM = 60;

export type ParsedTickerList = { tickers: string[]; error?: string };

/**
 * Validate + normalize the `?tickers=A,B,C` query param. Pure and testable —
 * no request/response objects touched.
 */
export function parseTickerList(raw: string | null, max: number = MAX_TICKERS_PER_STREAM): ParsedTickerList {
  if (!raw || raw.trim() === "") return { tickers: [], error: "Missing tickers" };
  const seen = new Set<string>();
  const tickers: string[] = [];
  for (const part of raw.split(",")) {
    const sym = part.trim().toUpperCase();
    if (!sym) continue;
    if (!TICKER_RE.test(sym)) return { tickers: [], error: `Invalid ticker: ${sym}` };
    if (!seen.has(sym)) {
      seen.add(sym);
      tickers.push(sym);
    }
  }
  if (tickers.length === 0) return { tickers: [], error: "Missing tickers" };
  if (tickers.length > max) return { tickers: [], error: `Too many tickers (max ${max})` };
  return { tickers };
}

export type SpotQuote = { price: number; changePct: number | null; asof: string };
export type SpotFrame = { type: "quotes"; quotes: Record<string, SpotQuote>; ts: number };

/**
 * Build one frame's worth of quote data for the given tickers, reading
 * straight from stock-candle-store (which is already the site's single
 * source of truth for WS-fed spot prices — see quote/route.ts). A ticker
 * with no live candle yet (freshly demanded, REST seed still in flight, or
 * genuinely untraded) is simply omitted from `quotes` for this frame; the
 * client keeps its last-known value until the ticker appears.
 */
export function buildSpotFrame(tickers: string[], now: number = Date.now()): SpotFrame {
  const quotes: Record<string, SpotQuote> = {};
  for (const ticker of tickers) {
    const candle = getStockLiveCandle(ticker);
    if (candle.current && candle.current.close > 0) {
      quotes[ticker] = {
        price: candle.current.close,
        changePct: candle.changePct,
        asof: new Date(candle.updatedAt).toISOString(),
      };
    }
  }
  return { type: "quotes", quotes, ts: now };
}

/** Encode a frame as an SSE `data: ...\n\n` message. */
export function encodeSpotFrame(frame: SpotFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

// --- Connection cap (same atomic claim-before-construct pattern as Vector) ---

let totalStreams = 0;

export function tryAcquireSpotStreamConnection(maxStreams: number): boolean {
  if (totalStreams >= maxStreams) return false;
  totalStreams += 1;
  return true;
}

export function releaseSpotStreamConnection(): void {
  totalStreams = Math.max(0, totalStreams - 1);
}

export function spotStreamConnectionCount(): number {
  return totalStreams;
}

/** Test-only reset. */
export function _resetSpotStreamHubForTest(): void {
  totalStreams = 0;
}
