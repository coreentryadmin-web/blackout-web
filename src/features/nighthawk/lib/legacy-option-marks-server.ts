/**
 * Server-side option mark fetch for Legacy live-sync and EOD grading.
 * Mirrors /api/market/nighthawk/legacy-marks (WS-first, REST snapshot fallback).
 */
import { fetchOptionsUnifiedSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { getLiveOptionMarkSync } from "@/lib/ws/options-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { LEGACY_QUOTE_STALE_MS } from "@/lib/zerodte/marks-math";
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
    // Same fix as /api/market/nighthawk/legacy-marks/route.ts (found 2026-09-16, live audit):
    // this is the WS-freshness gate feeding the legacy-live-sync cron directly — a WS tick 5-30s
    // old used to be discarded here (ZERODTE_MARK_STALE_MS=5s) and fall through to a REST
    // snapshot that can be equally or more stale, so a real position's mark could read stale
    // (and get skipped for peak/trough tracking by runLegacyLiveSync's noQuote branch) even with
    // a genuinely <30s-old WS tick available. This module is Legacy-only — gate on
    // LEGACY_QUOTE_STALE_MS, the same bar buildLegacyOptionMarkRow's own staleness check uses.
    const ws =
      getLiveOptionMarkSync(occ, LEGACY_QUOTE_STALE_MS) ??
      getLiveOptionMarkSync(legacyOccForSnapshot(occ), LEGACY_QUOTE_STALE_MS);
    const snap = lookupLegacyOptionSnapshot(snaps, occ);
    const row = buildLegacyOptionMarkRow(occ, ws, snap, now);
    if (!opts?.includeStale && row.stale) continue;
    if (row.mark == null || !Number.isFinite(row.mark) || row.mark <= 0) continue;
    out.set(occ, { occ, mark: row.mark, bid: row.bid, ask: row.ask, stale: row.stale });
  }
  return out;
}
