import "server-only";

import { sharedCacheGet } from "@/lib/shared-cache";
import type { ZeroDteBoardPayload } from "@/lib/platform/zerodte-service";

const BOARD_SNAPSHOT_KEY = "zerodte:board:snapshot:v1";

/** Today's converged Night Hawk board snapshot (cache-read only). */
export async function readMeridianBoardSnapshot(): Promise<ZeroDteBoardPayload | null> {
  const snap = await sharedCacheGet<ZeroDteBoardPayload>(BOARD_SNAPSHOT_KEY).catch(() => null);
  return snap?.available ? snap : null;
}

/** Tickers on today's Night Hawk board (cache-read only). */
export async function readMeridianBoardTickers(): Promise<string[]> {
  const snap = await readMeridianBoardSnapshot();
  if (!snap) return [];
  const tickers = new Set<string>();
  for (const s of snap.setups ?? []) {
    const t = String((s as { ticker?: string }).ticker ?? "").trim().toUpperCase();
    if (t) tickers.add(t);
  }
  for (const row of snap.ledger ?? []) {
    const t = String((row as { ticker?: string }).ticker ?? "").trim().toUpperCase();
    if (t) tickers.add(t);
  }
  return [...tickers].sort();
}
