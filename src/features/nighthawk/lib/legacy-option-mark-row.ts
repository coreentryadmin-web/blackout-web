/**
 * Shared Legacy option mark assembly — WS-first, REST snapshot fallback.
 * Used by the legacy-marks API route, server live-sync, and unit tests.
 */
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";
import { isZeroDteMarkStale } from "@/lib/zerodte/marks-math";

export type LegacyOptionMarkRow = {
  occ: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  asof: string | null;
  stale: boolean;
};

type WsMark = { mark?: number | null; bid?: number | null; ask?: number | null; ts: number } | null;

/**
 * Merge WS tick + REST snapshot into one mark row.
 *
 * Bug fixed 2026-09-13 (live audit): the REST branch used to prefer `snap.observedAtMs` (our OWN
 * fetch clock — when this server successfully called the provider) over `snap.quoteUpdatedMs`
 * (the REAL market clock — `last_quote.last_updated`, when the quote itself last changed). A
 * successful fetch is not proof the underlying quote is fresh: a thinly-traded/far-dated Legacy
 * contract can go quiet for many minutes while every re-fetch still returns HTTP 200 with the same
 * old `last_quote`, restamping `observedAtMs` to "now" each time. Against `ZERODTE_MARK_STALE_MS`
 * (5s — shared with 0DTE), that made `stale` measure "did our request just succeed" instead of "is
 * this quote current," so a genuinely stale price rendered `stale: false` and `asof` read as "just
 * now" indefinitely. Now `quoteUpdatedMs` (the real quote clock) is preferred; `observedAtMs` is
 * used only as a fallback when the provider gives no `last_quote` timestamp at all.
 */
export function buildLegacyOptionMarkRow(
  occ: string,
  ws: WsMark,
  snap: OptionSnapshot | null | undefined,
  nowMs = Date.now()
): LegacyOptionMarkRow {
  const bid = ws?.bid ?? snap?.bid ?? null;
  const ask = ws?.ask ?? snap?.ask ?? null;
  const mark =
    ws?.mark ?? snap?.mark ?? (bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null);

  const wsAsofMs = ws != null && Number.isFinite(ws.ts) ? ws.ts : null;
  const snapAsofMs =
    snap?.quoteUpdatedMs != null && Number.isFinite(snap.quoteUpdatedMs)
      ? snap.quoteUpdatedMs
      : snap?.observedAtMs != null && Number.isFinite(snap.observedAtMs)
        ? snap.observedAtMs
        : null;
  const asofMs = wsAsofMs ?? snapAsofMs;
  const asof = asofMs != null ? new Date(asofMs).toISOString() : null;

  // Delegates to the shared isZeroDteMarkStale predicate ("every renderer must apply", marks-math.ts)
  // instead of reimplementing the age check inline — the inline copy previously carried its own
  // future-timestamp gap independently of the shared one.
  const stale =
    mark == null || !Number.isFinite(mark) || mark <= 0 || asofMs == null ||
    isZeroDteMarkStale(asofMs, nowMs);

  return { occ, mark, bid, ask, asof, stale };
}
