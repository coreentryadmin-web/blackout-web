/**
 * Thermal Discord cadence — full snapshot vs text-only pulse, with wall-shift upgrade.
 *
 * Schedule (every 15m RTH):
 * - :00 / :30 → full snapshot (embed + matrix PNG)
 * - :15 / :45 → pulse (embed only) when walls are quiet since last post; upgrade to full if walls moved
 */
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import type { ThermalCardColumn } from "@/lib/thermal-discord-card";
import type { ThermalDiscordPostMode } from "@/lib/thermal-discord-embed";

export const THERMAL_DISCORD_WALLS_KEY = "thermal-discord:walls:v1";
export const THERMAL_DISCORD_WALLS_TTL_SEC = 24 * 60 * 60;

/** Minimum strike move (pts) to treat walls as "active" on pulse ticks. */
export const THERMAL_WALL_MOVE_PTS = 2;

export type ThermalWallSnapshot = Record<
  string,
  {
    call_wall: number | null;
    put_wall: number | null;
  }
>;

export function etMinuteSlot(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return minute % 60;
}

/** Base cadence from clock — :00/:30 full, :15/:45 pulse. Other minutes default to full (safe). */
export function thermalDiscordBaseMode(now: Date = new Date()): ThermalDiscordPostMode {
  const minute = etMinuteSlot(now);
  if (minute === 15 || minute === 45) return "pulse";
  return "full";
}

export function extractWallSnapshot(columns: ThermalCardColumn[]): ThermalWallSnapshot {
  const out: ThermalWallSnapshot = {};
  for (const col of columns) {
    const h = col.heatmap;
    if (!h?.gex) continue;
    out[col.ticker.toUpperCase()] = {
      call_wall: Number.isFinite(h.gex.call_wall as number) ? Number(h.gex.call_wall) : null,
      put_wall: Number.isFinite(h.gex.put_wall as number) ? Number(h.gex.put_wall) : null,
    };
  }
  return out;
}

/**
 * BUG FIX (2026-11-01): a wall APPEARING or VANISHING between ticks is a real structural
 * change — the exact thing the pulse->full upgrade exists to catch — but the original
 * `prev == null || next == null => false` guard treated EITHER side being null as "nothing
 * to compare" and silently reported "not moved". That conflates two different states: a
 * genuinely unresolvable prior snapshot (no real `prev` to compare against at all, already
 * handled by `thermalWallsShifted`'s own `!prev` early-return above) with a wall that WAS a
 * real strike last tick and is NOW null (the GEX engine lost its king node / wall read), or
 * vice versa. The latter is exactly as "did the picture change" as a >=2pt strike move, so a
 * member watching the 15-minute pulse would silently miss a wall disappearing or a brand-new
 * wall forming — the pulse stays text-only when the embed should upgrade to a full snapshot.
 * A genuine null->null (wall absent both ticks — a quiet/no-gamma name) still correctly
 * reports "not moved", since nothing actually changed.
 */
function wallStrikeMoved(prev: number | null | undefined, next: number | null | undefined): boolean {
  const prevVal = prev ?? null;
  const nextVal = next ?? null;
  if (prevVal === null && nextVal === null) return false;
  if (prevVal === null || nextVal === null) return true;
  return Math.abs(nextVal - prevVal) >= THERMAL_WALL_MOVE_PTS;
}

/** True when any ticker's call/put wall strike moved vs the last posted snapshot. */
export function thermalWallsShifted(
  columns: ThermalCardColumn[],
  prev: ThermalWallSnapshot | null | undefined
): boolean {
  if (!prev || !Object.keys(prev).length) return false;

  for (const col of columns) {
    const t = col.ticker.toUpperCase();
    const before = prev[t];
    const h = col.heatmap;
    if (!before || !h?.gex) continue;

    const call = Number.isFinite(h.gex.call_wall as number) ? Number(h.gex.call_wall) : null;
    const put = Number.isFinite(h.gex.put_wall as number) ? Number(h.gex.put_wall) : null;

    if (wallStrikeMoved(before.call_wall, call)) return true;
    if (wallStrikeMoved(before.put_wall, put)) return true;
  }
  return false;
}

/**
 * Resolve post mode: pulse ticks upgrade to full when walls shifted since last post.
 * `forceFull` bypasses pulse (smoke tests / manual force).
 */
export function resolveThermalDiscordMode(
  columns: ThermalCardColumn[],
  prevWalls: ThermalWallSnapshot | null | undefined,
  now: Date = new Date(),
  forceFull = false
): ThermalDiscordPostMode {
  if (forceFull) return "full";
  const base = thermalDiscordBaseMode(now);
  if (base === "full") return "full";
  return thermalWallsShifted(columns, prevWalls) ? "full" : "pulse";
}

export async function loadThermalWallSnapshot(): Promise<ThermalWallSnapshot | null> {
  return sharedCacheGet<ThermalWallSnapshot>(THERMAL_DISCORD_WALLS_KEY);
}

export async function saveThermalWallSnapshot(snapshot: ThermalWallSnapshot): Promise<void> {
  await sharedCacheSet(THERMAL_DISCORD_WALLS_KEY, snapshot, THERMAL_DISCORD_WALLS_TTL_SEC);
}
