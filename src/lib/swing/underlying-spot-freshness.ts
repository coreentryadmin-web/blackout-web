// src/lib/swing/underlying-spot-freshness.ts — pure, testable freshness gate for the underlying
// spot the active-refresh cron feeds into `structuralStopBroken` (manage.ts), the single
// highest-precedence GATE rung that fires an unconditional EXIT "at ANY premium P&L" (deep-dive Q38).
//
// WHY: `loadUnderlyingSpot` (swing-active-refresh/route.ts) used to trust ANY finite positive `.p`
// from Polygon's `/v2/last/trade` as the live spot. A hard outage (network error, non-200) already
// fails closed — the catch/invalid-shape path returns null and the position is skipped for that
// tick. But a feed that stays UP and keeps returning 200 with an OLD cached last-trade (rather than
// erroring) is indistinguishable from a genuinely live one under that check alone: finite, positive,
// no error. That silently feeds a stale price into the one rung explicitly designed to override
// every other consideration and force an immediate real-money exit.
//
// FIX: also check the trade's own SIP timestamp (`t`, nanoseconds — verified live against
// `/v2/last/trade/NVDA`, field `t`). The active-refresh cron only fires during RTH on a 15-minute
// cadence, and every position it holds carries a real options market, so a genuinely live feed
// always shows a trade newer than one full cron interval — anything older signals a degraded feed
// serving a stale tape, not real illiquidity. Reuses the same clock-skew-tolerant freshness helper
// (`isWsUpdatedAtFresh`) already used across the freshness-guard fixes landed the same day.

import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";

/** See file header — one full active-refresh cron interval (the route runs every 15 minutes during RTH). */
export const SWING_UNDERLYING_TRADE_STALE_MS = 15 * 60_000;

/**
 * Derive a trustworthy underlying spot from Polygon's `/v2/last/trade` `results` object.
 * Returns null when the price is missing/invalid, when the trade timestamp is missing/invalid
 * (an unrecognized response shape must not be trusted either), or when the trade is older than
 * `staleMs` — a stale-but-200-OK read must read the same as a hard outage to callers.
 */
export function spotFromLastTradeResult(
  trade: unknown,
  now: number = Date.now(),
  staleMs: number = SWING_UNDERLYING_TRADE_STALE_MS
): number | null {
  if (!trade || typeof trade !== "object") return null;
  const rec = trade as Record<string, unknown>;

  const p = Number(rec.p);
  if (!Number.isFinite(p) || p <= 0) return null;

  const tNs = Number(rec.t);
  if (!Number.isFinite(tNs) || tNs <= 0) return null;
  const tMs = tNs / 1e6;

  if (!isWsUpdatedAtFresh(tMs, staleMs, now)) return null;
  return p;
}
