import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

/** Human-readable relative time for admin panels — guards clock-skewed future ISO timestamps. */
export function timeAgoFromIso(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return "—";
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return "clock skew";
  const diff = Math.max(0, rawAgeMs);
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
