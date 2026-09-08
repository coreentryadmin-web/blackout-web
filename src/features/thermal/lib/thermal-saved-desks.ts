/**
 * Saved Thermal desk layouts — browser-local presets (ticker, lens, compare, expiry scope).
 * No server round-trip; survives refresh on the same device/browser profile.
 */

import type { ThermalComparePresetId } from "./thermal-compare-presets";
import type { ThermalLens } from "./thermal-desk-state";

export type ThermalSavedDesk = {
  id: string;
  name: string;
  ticker: string;
  lens: ThermalLens;
  compare: boolean;
  compareSet: ThermalComparePresetId | null;
  expiryScope: string;
  pairView: "pair-a" | "pair-b" | "pair-c" | "pair-d";
  savedAt: string;
};

const STORAGE_KEY = "blackout:thermal:saved-desks:v1";
export const THERMAL_SAVED_DESK_SLOTS = 5;

function readRaw(): ThermalSavedDesk[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ThermalSavedDesk[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(desks: ThermalSavedDesk[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(desks.slice(0, THERMAL_SAVED_DESK_SLOTS)));
  } catch {
    /* quota / private mode */
  }
}

export function listThermalSavedDesks(): ThermalSavedDesk[] {
  return readRaw().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function upsertThermalSavedDesk(desk: Omit<ThermalSavedDesk, "id" | "savedAt"> & { id?: string }): ThermalSavedDesk[] {
  const now = new Date().toISOString();
  const entry: ThermalSavedDesk = {
    id: desk.id ?? `desk-${Date.now()}`,
    name: desk.name.trim().slice(0, 32) || desk.ticker,
    ticker: desk.ticker.toUpperCase(),
    lens: desk.lens,
    compare: desk.compare,
    compareSet: desk.compareSet,
    expiryScope: desk.expiryScope,
    pairView: desk.pairView,
    savedAt: now,
  };
  const rest = readRaw().filter((d) => d.id !== entry.id);
  const next = [entry, ...rest].slice(0, THERMAL_SAVED_DESK_SLOTS);
  writeRaw(next);
  return next;
}

export function deleteThermalSavedDesk(id: string): ThermalSavedDesk[] {
  const next = readRaw().filter((d) => d.id !== id);
  writeRaw(next);
  return next;
}

export function defaultSavedDeskName(ticker: string, lens: ThermalLens): string {
  return `${ticker} · ${lens.toUpperCase()}`;
}
