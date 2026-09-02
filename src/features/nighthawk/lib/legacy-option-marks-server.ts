/**
 * Server-side option mark fetch for Legacy live-sync and EOD grading.
 * Mirrors /api/market/nighthawk/legacy-marks (WS-first, REST snapshot fallback).
 */
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";

export type LegacyServerOptionMark = {
  occ: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  stale: boolean;
};

/** Fetch live option marks for up to 24 OCCs. Missing/stale marks are omitted from the map. */
export async function fetchLegacyOptionMarksServer(
  occs: string[],
  opts?: { includeStale?: boolean }
): Promise<Map<string, LegacyServerOptionMark>> {
  const unique = [...new Set(occs.map((o) => o.trim().toUpperCase()).filter(Boolean))].slice(0, 24);
  if (!unique.length) return new Map();

  ensureDataSockets();

  let snaps = new Map<string, OptionSnapshot>();
  try {
    snaps = await fetchOptionsUnifiedSnapshot(unique);
  } catch {
    snaps = new Map();
  }

  const now = Date.now();
  const out = new Map<string, LegacyServerOptionMark>();
  for (const occ of unique) {
    const ws = getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS);
    const snap = snaps.get(occ);
    const bid = ws?.bid ?? snap?.bid ?? null;
    const ask = ws?.ask ?? snap?.ask ?? null;
    const mark = ws?.mark ?? snap?.mark ?? (bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null);
    const asofMs = ws != null ? ws.ts : NaN;
    const stale = !Number.isFinite(asofMs) || now - asofMs > ZERODTE_MARK_STALE_MS;
    if (!opts?.includeStale && stale) continue;
    if (mark == null || !Number.isFinite(mark) || mark <= 0) continue;
    out.set(occ, { occ, mark, bid, ask, stale });
  }
  return out;
}
