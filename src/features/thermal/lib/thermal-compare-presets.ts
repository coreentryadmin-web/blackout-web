/**
 * Thermal compare-grid sector/theme bundles — each preset is 3–7 liquid names shown
 * side-by-side on a single nearest-expiry (0DTE when listed) heat column.
 */

export const THERMAL_COMPARE_PRESET_SIZE = 7;

export type ThermalComparePresetId =
  | "indices"
  | "semis"
  | "ai"
  | "space"
  | "mega"
  | "crypto"
  | "energy"
  | "financials"
  | "biotech";

export type ThermalComparePreset = {
  id: ThermalComparePresetId;
  /** Short desk label for the dropdown / rail. */
  label: string;
  /** Three to seven tickers — one nearest-expiry column each. */
  tickers: readonly string[];
};

/** Curated liquid options names per theme (not dynamic discovery — cache-friendly). */
export const THERMAL_COMPARE_PRESETS: readonly ThermalComparePreset[] = [
  {
    id: "indices",
    label: "Indices",
    tickers: ["SPY", "SPX", "QQQ"],
  },
  {
    id: "semis",
    label: "Semis",
    tickers: ["NVDA", "AMD", "AVGO", "MU", "SMCI"],
  },
  {
    id: "ai",
    label: "AI",
    tickers: ["NVDA", "AMD", "SMCI", "PLTR", "ARM"],
  },
  {
    id: "space",
    label: "Space",
    tickers: ["RKLB", "ASTS", "LUNR", "BA", "PL"],
  },
  {
    id: "mega",
    label: "Mag 7",
    tickers: ["NVDA", "AAPL", "MSFT", "GOOG", "AMZN", "META", "TSLA"],
  },
  {
    id: "crypto",
    label: "Crypto",
    tickers: ["COIN", "MSTR", "HOOD", "MARA", "RIOT"],
  },
  {
    id: "energy",
    label: "Energy",
    tickers: ["XOM", "CVX", "OXY", "SLB", "COP"],
  },
  {
    id: "financials",
    label: "Financials",
    tickers: ["JPM", "GS", "BAC", "MS", "V"],
  },
  {
    id: "biotech",
    label: "Biotech",
    tickers: ["LLY", "UNH", "MRK", "ABBV", "GILD"],
  },
] as const;

export const THERMAL_COMPARE_DEFAULT_PRESET_ID: ThermalComparePresetId = "semis";

const PRESET_BY_ID = new Map<ThermalComparePresetId, ThermalComparePreset>(
  THERMAL_COMPARE_PRESETS.map((p) => [p.id, p]),
);

const TICKER_TO_PRESET = new Map<string, ThermalComparePresetId>();
for (const preset of THERMAL_COMPARE_PRESETS) {
  for (const t of preset.tickers) {
    if (!TICKER_TO_PRESET.has(t)) TICKER_TO_PRESET.set(t, preset.id);
  }
}
// Mag 7 lists GOOG; members often search GOOGL — same book for grid routing.
if (!TICKER_TO_PRESET.has("GOOGL")) TICKER_TO_PRESET.set("GOOGL", "mega");

export function isThermalComparePresetId(raw: string | null | undefined): raw is ThermalComparePresetId {
  if (!raw) return false;
  return PRESET_BY_ID.has(raw.trim().toLowerCase() as ThermalComparePresetId);
}

export function parseThermalComparePresetId(
  raw: string | null | undefined,
): ThermalComparePresetId | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase() as ThermalComparePresetId;
  return PRESET_BY_ID.has(id) ? id : null;
}

export function thermalComparePreset(id: ThermalComparePresetId): ThermalComparePreset {
  return PRESET_BY_ID.get(id)!;
}

/** Best preset for the active ticker — falls back to Semis. */
export function resolveComparePresetIdForTicker(ticker: string | null | undefined): ThermalComparePresetId {
  const t = (ticker ?? "").trim().toUpperCase();
  if (!t) return THERMAL_COMPARE_DEFAULT_PRESET_ID;
  return TICKER_TO_PRESET.get(t) ?? THERMAL_COMPARE_DEFAULT_PRESET_ID;
}

/** Active ticker first when it belongs to the preset — faster eyeball to the name you searched. */
export function orderComparePresetTickers(
  preset: ThermalComparePreset,
  activeTicker?: string | null,
): string[] {
  const list = [...preset.tickers];
  const active = (activeTicker ?? "").trim().toUpperCase();
  if (!active || !list.includes(active)) return list;
  return [active, ...list.filter((t) => t !== active)];
}

/** Legacy compare default — classic SPY / SPX / QQQ triple. */
export const THERMAL_COMPARE_TICKERS = THERMAL_COMPARE_PRESETS.find((p) => p.id === "indices")!.tickers;
