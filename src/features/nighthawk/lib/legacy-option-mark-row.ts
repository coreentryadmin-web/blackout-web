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

/** Merge WS tick + REST snapshot into one mark row. REST observedAtMs counts as fresh when WS is absent. */
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
    snap?.observedAtMs != null && Number.isFinite(snap.observedAtMs)
      ? snap.observedAtMs
      : snap?.quoteUpdatedMs != null && Number.isFinite(snap.quoteUpdatedMs)
        ? snap.quoteUpdatedMs
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
