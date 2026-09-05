/**
 * Swing scan rejection ledger — near-miss / cap-drop visibility (Swing Engine V2 P1).
 *
 * Analogue of zerodte/rejections.ts: makes "why didn't ticker X surface" answerable.
 */

import { dbConfigured, getMeta, setMeta, insertSwingScanRejection } from "@/lib/db";
import type { SwingCappedOutEntry } from "../discovery";
import { todayEtYmd } from "@/lib/providers/spx-session";

const SWING_REJECTION_CURSOR_KEY = "swing_scan_rejection_cursor";

type CursorEntry = { date: string; key: string };

function rejectionStateKey(gate: string, ticker: string): string {
  return JSON.stringify({ gate, ticker });
}

async function loadCursor(today: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await getMeta(SWING_REJECTION_CURSOR_KEY);
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
    for (const [ticker, entry] of Object.entries(parsed)) {
      if (entry?.date === today && typeof entry.key === "string") map.set(ticker, entry.key);
    }
  } catch {
    // corrupt — treat as empty
  }
  return map;
}

async function saveCursor(today: string, map: Map<string, string>): Promise<void> {
  const obj: Record<string, CursorEntry> = {};
  for (const [ticker, key] of map.entries()) obj[ticker] = { date: today, key };
  await setMeta(SWING_REJECTION_CURSOR_KEY, JSON.stringify(obj));
}

export interface PersistSwingCapRejectionsArgs {
  sessionDay: string;
  scanPhase: string | null;
  cappedOut: SwingCappedOutEntry[];
  tier0PoolSize: number;
  tier1Cap: number;
}

/**
 * Persist tier-1 cap drops to swing_scan_rejections (throttled per ticker per gate per session).
 */
export async function persistSwingCapRejections(args: PersistSwingCapRejectionsArgs): Promise<number> {
  if (!dbConfigured() || args.cappedOut.length === 0) return 0;

  const today = args.sessionDay || todayEtYmd();
  const cursor = await loadCursor(today);
  let written = 0;

  for (const entry of args.cappedOut) {
    const ticker = entry.ticker.toUpperCase();
    const gate = "tier1_cap";
    const key = rejectionStateKey(gate, ticker);
    if (cursor.get(ticker) === key) continue;

    await insertSwingScanRejection({
      session_date: today,
      scan_phase: args.scanPhase,
      ticker,
      gate_failed: gate,
      score: null,
      origins: null,
      reason: entry.reason,
      rank: entry.tier0Rank,
      tier0_pool_size: args.tier0PoolSize,
      tier1_cap: args.tier1Cap,
    });
    cursor.set(ticker, key);
    written += 1;
  }

  if (written > 0) await saveCursor(today, cursor);
  return written;
}
