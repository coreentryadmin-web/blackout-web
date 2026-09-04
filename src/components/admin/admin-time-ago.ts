import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

export type IsoAgeResult =
  | { kind: "ok"; sec: number }
  | { kind: "clock-skew" }
  | { kind: "invalid" };

/** Clamped age in seconds from an ISO timestamp — flags clock-skewed future values. */
export function isoAgeSec(iso: string | null, now = Date.now()): IsoAgeResult {
  if (!iso) return { kind: "invalid" };
  const atMs = new Date(iso).getTime();
  if (!Number.isFinite(atMs)) return { kind: "invalid" };
  const rawAgeMs = now - atMs;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) return { kind: "clock-skew" };
  return { kind: "ok", sec: Math.max(0, Math.round(rawAgeMs / 1000)) };
}

/** Human-readable relative time for admin panels — guards clock-skewed future ISO timestamps. */
export function timeAgoFromIso(iso: string | null, now = Date.now()): string {
  const age = isoAgeSec(iso, now);
  if (age.kind === "invalid") return "—";
  if (age.kind === "clock-skew") return "clock skew";
  const s = age.sec;
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact terminal-style relative time (no "ago" suffix) — same future guard as timeAgoFromIso. */
export function timeAgoCompactFromIso(iso: string, now = Date.now()): string {
  const age = isoAgeSec(iso, now);
  if (age.kind === "clock-skew") return "clock skew";
  if (age.kind === "invalid") return "—";
  const sec = age.sec;
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

/** Age in ms for staleness checks — null when missing/invalid or clock-skewed (treat as stale). */
export function adminAgeMsFromIso(iso: string | null | undefined, now = Date.now()): number | null {
  const age = isoAgeSec(iso ?? null, now);
  if (age.kind !== "ok") return null;
  return age.sec * 1000;
}

/** Open-duration label for incident tiles — returns null when MTTA is present. */
export function openDurationLabelFromIso(
  openedAt: string,
  now = Date.now()
): string {
  const age = isoAgeSec(openedAt, now);
  if (age.kind === "clock-skew") return " · open clock skew";
  if (age.kind === "invalid") return " · open —";
  return ` · open ${age.sec}s`;
}
