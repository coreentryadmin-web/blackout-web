/**
 * Lightweight live signature for swing play-brief refresh — mirrors fields the
 * marks SSE lane can push without composing a full brief server-side.
 */
import type { ZeroDteLiveMarkRow } from "@/lib/zerodte/live-marks";

export function liveMarkBriefSig(
  row: Pick<ZeroDteLiveMarkRow, "mark" | "live_pnl_pct" | "live_pnl_pct_exec" | "status" | "stale">,
): string {
  if (row.stale) return "";
  return JSON.stringify({
    mark: row.mark,
    pnl: row.live_pnl_pct,
    pnlExec: row.live_pnl_pct_exec,
    status: row.status,
  });
}
