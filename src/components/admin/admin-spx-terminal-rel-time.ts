import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

/** Compact relative stamp for the SPX admin terminal feed (seconds/minutes, then ET clock). */
export function formatAdminSpxTerminalRel(iso: string, nowMs = Date.now()): string {
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return "—";
  const rawSec = Math.round((nowMs - atMs) / 1000);
  if (rawSec < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS / 1000) return "skew";
  const sec = Math.max(0, rawSec);
  if (sec < 3) return "now";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
