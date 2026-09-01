import type { HelixDteFilter } from "@/features/helix/lib/helix-table-columns";
import {
  HELIX_DEFAULT_MIN_PREMIUM,
} from "@/features/helix/lib/helix-flow-limits";
import type { HelixTypeFilter } from "@/features/helix/components/HelixCommandBar";

export type HelixDirectionFilter = "all" | "bullish" | "bearish";

export type HelixTapeFilterState = {
  minPremium: number;
  typeFilter: HelixTypeFilter;
  whalesOnly: boolean;
  dteFilter: HelixDteFilter;
  indicesOnly: boolean;
  directionFilter: HelixDirectionFilter;
  openingOnly: boolean;
};

export const HELIX_DEFAULT_TAPE_FILTERS: HelixTapeFilterState = {
  minPremium: HELIX_DEFAULT_MIN_PREMIUM,
  typeFilter: "ALL",
  whalesOnly: false,
  dteFilter: "all",
  indicesOnly: false,
  directionFilter: "all",
  openingOnly: false,
};

export type HelixFilterPreset = {
  id: string;
  label: string;
  hint: string;
  tone?: "gold" | "ember" | "sky" | "purple" | "green";
  filters: Partial<HelixTapeFilterState>;
};

export const HELIX_FILTER_PRESETS: HelixFilterPreset[] = [
  {
    id: "whale-hunt",
    label: "Whale hunt",
    hint: "$1M+ prints only",
    tone: "purple",
    filters: { minPremium: 1_000_000, whalesOnly: true, directionFilter: "all", openingOnly: false },
  },
  {
    id: "index-0dte",
    label: "Index 0DTE",
    hint: "SPX/SPY/QQQ/IWM same-day",
    tone: "sky",
    filters: { indicesOnly: true, dteFilter: "0dte", typeFilter: "ALL" },
  },
  {
    id: "bull-flow",
    label: "Bull flow",
    hint: "Aggression-aware bullish reads",
    tone: "green",
    filters: { directionFilter: "bullish", minPremium: 500_000, typeFilter: "ALL" },
  },
  {
    id: "bear-flow",
    label: "Bear flow",
    hint: "Aggression-aware bearish reads",
    tone: "ember",
    filters: { directionFilter: "bearish", minPremium: 500_000, typeFilter: "ALL" },
  },
  {
    id: "new-pos",
    label: "New OI",
    hint: "Provably opening prints only",
    tone: "gold",
    filters: { openingOnly: true },
  },
];

/** Whether a preset's filter slice matches the live tape state (ignores ticker/watchlist). */
export function helixPresetMatches(
  preset: HelixFilterPreset,
  state: HelixTapeFilterState
): boolean {
  for (const [key, value] of Object.entries(preset.filters) as [keyof HelixTapeFilterState, unknown][]) {
    if (state[key] !== value) return false;
  }
  return true;
}

/** Apply a preset on top of defaults — caller merges into React state. */
export function applyHelixFilterPreset(preset: HelixFilterPreset): HelixTapeFilterState {
  return { ...HELIX_DEFAULT_TAPE_FILTERS, ...preset.filters };
}
