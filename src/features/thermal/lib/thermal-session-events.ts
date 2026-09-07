/**
 * Session event helpers for the Thermal desk timeline — pure formatting over server `GexEvent[]`.
 */

export type ThermalSessionEvent = {
  type: string;
  severity: "info" | "warn";
  message: string;
  at: string;
  level?: number;
  direction?: string;
};

export function eventStrike(e: ThermalSessionEvent): number | null {
  const level = e.level;
  if (level != null && Number.isFinite(level)) return level;
  return null;
}

export function sortSessionEventsNewestFirst(events: ThermalSessionEvent[]): ThermalSessionEvent[] {
  return [...events].sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
    return tb - ta;
  });
}

/** Relative "just now" / "12m ago" from an ISO timestamp. */
export function fmtSessionEventAge(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

export function sessionEventGlyph(type: string, direction?: string): string {
  if (type === "wall_broken" || type === "flip_crossed") return "⚡";
  const d = (direction ?? "").toLowerCase();
  if (d.includes("above") || d.includes("long") || d.includes("positive") || d.includes("up")) {
    return "▲";
  }
  if (d.includes("below") || d.includes("short") || d.includes("negative") || d.includes("down")) {
    return "▼";
  }
  return "•";
}
