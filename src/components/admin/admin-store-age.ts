import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

/** Age label for admin ops tiles — clamps negative age and flags clock-skewed timestamps. */
export function storeAge(updatedAt: number | null): { label: string; ok: boolean | null } {
  if (updatedAt == null || updatedAt === 0) return { label: "No data", ok: null };
  const rawAgeMs = Date.now() - updatedAt;
  if (rawAgeMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) {
    return { label: "clock skew", ok: false };
  }
  const ageMs = Math.max(0, rawAgeMs);
  const s = Math.floor(ageMs / 1000);
  if (s < 10) return { label: "just now", ok: true };
  if (s < 60) return { label: `${s}s ago`, ok: true };
  const m = Math.floor(s / 60);
  if (m < 5) return { label: `${m}m ago`, ok: true };
  if (m < 15) return { label: `${m}m ago`, ok: false };
  return { label: `${m}m ago`, ok: false };
}

/** Relative age for ISO audit/incident timestamps — flags clock-skewed future values. */
export function timeAgoIso(iso: string | null): string {
  if (!iso) return "—";
  const rawAgeMs = Date.now() - new Date(iso).getTime();
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
