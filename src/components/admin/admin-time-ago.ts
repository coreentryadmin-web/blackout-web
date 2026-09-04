import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

type AgeResult = { kind: "age"; ms: number } | { kind: "invalid" } | { kind: "skew" };

function classifyAge(iso: string | null, now: number): AgeResult {
  if (!iso) return { kind: "invalid" };
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return { kind: "invalid" };
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return { kind: "skew" };
  return { kind: "age", ms: Math.max(0, rawAgeMs) };
}

/** Human-readable relative time for admin panels — guards clock-skewed future ISO timestamps. */
export function timeAgoFromIso(iso: string | null, now = Date.now()): string {
  const age = classifyAge(iso, now);
  if (age.kind === "invalid") return "—";
  if (age.kind === "skew") return "clock skew";
  const s = Math.floor(age.ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact terminal-style relative time — same future guard as timeAgoFromIso. */
export function timeAgoCompactFromIso(iso: string | null, now = Date.now()): string {
  const age = classifyAge(iso, now);
  if (age.kind === "invalid") return "—";
  if (age.kind === "skew") return "skew";
  const sec = Math.round(age.ms / 1000);
  if (sec < 3) return "now";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return new Date(iso!).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Non-negative whole seconds since ISO, or null when invalid / clock-skewed future. */
export function secondsSinceIso(iso: string | null, now = Date.now()): number | null {
  const age = classifyAge(iso, now);
  if (age.kind !== "age") return null;
  return Math.round(age.ms / 1000);
}
