import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

function ageMsFromIso(iso: string, now: number): number | "clock_skew" | null {
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return null;
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return "clock_skew";
  return Math.max(0, rawAgeMs);
}

/** Age in ms for staleness checks — null when missing/invalid, treats clock skew as null (stale). */
export function adminAgeMsFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const age = ageMsFromIso(iso, now);
  if (age === "clock_skew" || age === null) return null;
  return age;
}

/** Human-readable relative time for admin panels — guards clock-skewed future ISO timestamps. */
export function timeAgoFromIso(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const age = ageMsFromIso(iso, now);
  if (age === null) return "—";
  if (age === "clock_skew") return "clock skew";
  const s = Math.floor(age / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact relative time for API live-feed rows. */
export function timeAgoCompactFromIso(iso: string, now = Date.now()): string {
  const age = ageMsFromIso(iso, now);
  if (age === "clock_skew") return "clock skew";
  if (age === null) return "—";
  const sec = Math.round(age / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

/** Ultra-compact relative time for SPX terminal feed lines. */
export function timeAgoTerminalFromIso(iso: string, now = Date.now()): string {
  const age = ageMsFromIso(iso, now);
  if (age === "clock_skew") return "skew";
  if (age === null) return "—";
  const sec = Math.round(age / 1000);
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
