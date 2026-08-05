/**
 * Thermal Discord breach state — spot snapshots + per-ticker/kind side dedup (SPY, SPX, QQQ).
 * Prevents re-firing the same flip/wall side; seeds cleanly at each cash session open.
 */
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { todayEt } from "@/lib/et-date";
import type { ThermalCardColumn } from "@/lib/thermal-discord-card";
import type { ThermalBreachEvent, ThermalBreachKind } from "@/lib/thermal-discord-extras";

export const THERMAL_SPOT_META_KEY = "thermal-discord:spot-meta:v1";
export const THERMAL_BREACH_STATE_KEY = "thermal-discord:breach-state:v1";
export const THERMAL_SPOT_META_TTL_SEC = 48 * 60 * 60;
export const THERMAL_BREACH_STATE_TTL_SEC = 48 * 60 * 60;

export type ThermalSpotSnapshot = Record<string, number>;
export type ThermalBreachSide = "above" | "below";
export type ThermalBreachState = Record<
  string,
  Partial<Record<ThermalBreachKind, ThermalBreachSide>>
>;

export type ThermalSpotMeta = {
  sessionDate: string;
  spots: ThermalSpotSnapshot;
  updatedAt: string;
};

export function extractSpotSnapshot(columns: ThermalCardColumn[]): ThermalSpotSnapshot {
  const out: ThermalSpotSnapshot = {};
  for (const col of columns) {
    const spot = col.heatmap?.spot;
    if (!Number.isFinite(spot as number)) continue;
    out[col.ticker.toUpperCase()] = Number(spot);
  }
  return out;
}

export function sideFromBreachEvent(event: ThermalBreachEvent): ThermalBreachSide {
  return event.direction === "crossed_above" ? "above" : "below";
}

/**
 * Stateful dedup: alert only when the side (above/below) changes for ticker+kind.
 * Flip re-cross below after above → new alert; holding same side → silent.
 */
export function filterNewBreachAlerts(
  events: ThermalBreachEvent[],
  state: ThermalBreachState
): { alerts: ThermalBreachEvent[]; state: ThermalBreachState } {
  const next: ThermalBreachState = { ...state };
  const alerts: ThermalBreachEvent[] = [];

  for (const ev of events) {
    const ticker = ev.ticker.toUpperCase();
    const side = sideFromBreachEvent(ev);
    const prev = next[ticker]?.[ev.kind];
    if (prev === side) continue;

    alerts.push(ev);
    next[ticker] = { ...next[ticker], [ev.kind]: side };
  }

  return { alerts, state: next };
}

/** First RTH tick of a new session — seed spots, skip breach compares (no overnight gap false crosses). */
export function shouldSeedSessionSpots(meta: ThermalSpotMeta | null, sessionDate: string): boolean {
  return meta == null || meta.sessionDate !== sessionDate;
}

export async function loadThermalSpotMeta(): Promise<ThermalSpotMeta | null> {
  return sharedCacheGet<ThermalSpotMeta>(THERMAL_SPOT_META_KEY);
}

export async function saveThermalSpotMeta(meta: ThermalSpotMeta): Promise<void> {
  await sharedCacheSet(THERMAL_SPOT_META_KEY, meta, THERMAL_SPOT_META_TTL_SEC);
}

export async function loadThermalBreachState(): Promise<ThermalBreachState> {
  return (await sharedCacheGet<ThermalBreachState>(THERMAL_BREACH_STATE_KEY)) ?? {};
}

export async function saveThermalBreachState(state: ThermalBreachState): Promise<void> {
  await sharedCacheSet(THERMAL_BREACH_STATE_KEY, state, THERMAL_BREACH_STATE_TTL_SEC);
}

/** Reset breach side memory at cash open — allows fresh flip/wall alerts each session. */
export async function resetThermalBreachStateForSession(): Promise<void> {
  await sharedCacheSet(THERMAL_BREACH_STATE_KEY, {}, THERMAL_BREACH_STATE_TTL_SEC);
}

export function priorSpotsForBreaches(meta: ThermalSpotMeta | null, sessionDate: string): ThermalSpotSnapshot {
  if (!meta || meta.sessionDate !== sessionDate) return {};
  return meta.spots;
}

export async function persistSpotSnapshotAfterTick(
  columns: ThermalCardColumn[],
  sessionDate: string = todayEt()
): Promise<ThermalSpotMeta> {
  const meta: ThermalSpotMeta = {
    sessionDate,
    spots: extractSpotSnapshot(columns),
    updatedAt: new Date().toISOString(),
  };
  await saveThermalSpotMeta(meta);
  return meta;
}
