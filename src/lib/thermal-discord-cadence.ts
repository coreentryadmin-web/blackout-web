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

function wallStrikeMoved(prev: number | null | undefined, next: number | null | undefined): boolean {
  if (prev == null || next == null) return false;
  return Math.abs(next - prev) >= THERMAL_WALL_MOVE_PTS;
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
