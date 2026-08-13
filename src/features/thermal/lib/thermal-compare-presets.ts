/**
 * Thermal compare-grid sector/theme bundles — each preset is 5–6 liquid names shown
 * side-by-side on a single 0DTE (or nearest expiry) heat column so members can scan
 * dealer positioning across a thesis (Semis, AI, Space, …) without leaving the desk.
 */

export type ThermalComparePresetId =
  | "semis"
  | "ai"
  | "space"
  | "mega"
  | "crypto"
  | "energy"
  | "financials"
  | "biotech"
  | "indices";

export type ThermalComparePreset = {
  id: ThermalComparePresetId;
  /** Short desk label for the dropdown / rail. */
  label: string;
  /** Up to six tickers — single-expiry columns stay narrow enough to fit. */
  tickers: readonly string[];
};

/** Curated liquid options names per theme (not dynamic discovery — cache-friendly). */
export const THERMAL_COMPARE_PRESETS: readonly ThermalComparePreset[] = [
  {
    id: "semis",
    label: "Semis",
    tickers: ["NVDA", "AMD", "AVGO", "MU", "SMCI", "ARM"],
  },
  {
    id: "ai",
    label: "AI",
    tickers: ["NVDA", "AMD", "SMCI", "PLTR", "ARM", "AVGO"],
  },
  {
    id: "space",
    label: "Space",
    tickers: ["RKLB", "ASTS", "LUNR", "BA", "PL", "LMT"],
  },
  {
    id: "mega",
    label: "Mega cap",
    tickers: ["NVDA", "AAPL", "MSFT", "META", "AMZN", "GOOGL"],
  },
  {
    id: "crypto",
    label: "Crypto",
    tickers: ["COIN", "MSTR", "HOOD", "MARA", "RIOT", "CLSK"],
  },
  {
    id: "energy",
    label: "Energy",
    tickers: ["XOM", "CVX", "OXY", "SLB", "COP", "MPC"],
  },
  {
    id: "financials",
    label: "Financials",
    tickers: ["JPM", "GS", "BAC", "MS", "V", "MA"],
  },
  {
    id: "biotech",
    label: "Biotech",
    tickers: ["LLY", "UNH", "MRK", "ABBV", "GILD", "MRNA"],
  },
  {
    id: "indices",
    label: "Indices",
    tickers: ["SPY", "SPX", "QQQ"],
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

/** @deprecated Use preset tickers — kept for legacy callers/tests. */
export const THERMAL_COMPARE_TICKERS = THERMAL_COMPARE_PRESETS.find((p) => p.id === "indices")!.tickers;
