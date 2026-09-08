/**
 * Server-side option mark fetch for Legacy live-sync and EOD grading.
 * Mirrors /api/market/nighthawk/legacy-marks (WS-first, REST snapshot fallback).
 */
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { ZERODTE_MARK_STALE_MS } from "@/lib/zerodte/marks-math";
import { buildLegacyOptionMarkRow } from "@/features/nighthawk/lib/legacy-option-mark-row";
import {
  legacyOccForSnapshot,
  lookupLegacyOptionSnapshot,
} from "@/features/nighthawk/lib/legacy-play-contract";

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
    snaps = await fetchOptionsUnifiedSnapshot(unique.map(legacyOccForSnapshot));
  } catch {
    snaps = new Map();
  }

  const now = Date.now();
  const out = new Map<string, LegacyServerOptionMark>();
  for (const occ of unique) {
    const ws =
      getLiveOptionMarkSync(occ, ZERODTE_MARK_STALE_MS) ??
      getLiveOptionMarkSync(legacyOccForSnapshot(occ), ZERODTE_MARK_STALE_MS);
    const snap = lookupLegacyOptionSnapshot(snaps, occ);
    const row = buildLegacyOptionMarkRow(occ, ws, snap, now);
    if (!opts?.includeStale && row.stale) continue;
    if (row.mark == null || !Number.isFinite(row.mark) || row.mark <= 0) continue;
    out.set(occ, { occ, mark: row.mark, bid: row.bid, ask: row.ask, stale: row.stale });
  }
  return out;
}
