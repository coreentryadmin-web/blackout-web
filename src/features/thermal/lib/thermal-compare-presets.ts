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
  | "healthcare"
  | "macro";

export type ThermalComparePreset = {
  id: ThermalComparePresetId;
  /** Short desk label for the dropdown / rail. */
  label: string;
  /** Three to seven tickers — one nearest-expiry column each. */
  tickers: readonly string[];
};

/**
 * Curated liquid options names per theme (not dynamic discovery — cache-friendly).
 *
 * SELECTION RULE: this is a dealer-GAMMA grid, so a name earns a column by having an options chain
 * deep enough for gamma to be signal rather than noise — not by being a famous company. Membership
 * was set against whole-chain open interest + day volume measured 2026-08-13 (paginated; a
 * single-page sample saturates at the 250-contract cap and tells you nothing).
 *
 * Every ticker here must also be on the UW overlay allowlist — heatmap-allowlist.test.ts fails CI
 * otherwise, which is what stops the two lists drifting the way they did when the grid first
 * shipped with four presets at 0/5 overlay coverage.
 */
export const THERMAL_COMPARE_PRESETS: readonly ThermalComparePreset[] = [
  {
    id: "indices",
    label: "Indices",
    // IWM was missing on the first cut despite 863k day volume / 9.9M open interest — on par with
    // the other index legs, and it is the third leg the iron-condor engine already trades.
    tickers: ["SPY", "SPX", "QQQ", "IWM"],
  },
  {
    id: "macro",
    label: "Macro",
    // Rates / gold / bitcoin — the biggest block of options flow no preset covered. TLT (612k) and
    // GLD (488k) each out-trade every name in Energy, Financials and Healthcare.
    tickers: ["TLT", "GLD", "IBIT"],
  },
  {
    id: "semis",
    label: "Semis",
    // INTC (626k day vol) was absent while AVGO (140k) was present.
    tickers: ["NVDA", "AMD", "AVGO", "MU", "SMCI", "INTC", "TSM"],
  },
  {
    id: "ai",
    label: "AI",
    // The AI INFRASTRUCTURE + software layer, deliberately disjoint from Semis. This preset used to
    // be NVDA/AMD/SMCI/PLTR/ARM — three of five names shared with Semis, so switching between the
    // two themes left most of the grid unchanged and the second preset earned nothing.
    tickers: ["PLTR", "ORCL", "ANET", "VRT", "ARM"],
  },
  {
    id: "space",
    label: "Space",
    // PL dropped: 14.7k day vol on a 776-contract chain, the second-thinnest name on the board.
    // BA stays — it is aerospace rather than pure space, but it is liquid (56k) and the pure-play
    // defense alternatives are all thinner (LMT 17.5k, RTX 15.8k, NOC 5.3k).
    tickers: ["RKLB", "ASTS", "LUNR", "BA"],
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
    // Uniformly thin (XOM 42k best, COP 18k worst) — but that is the SECTOR, not the picking.
    // There is nothing more liquid to swap in, so this is kept with its limits understood.
    tickers: ["XOM", "CVX", "OXY", "SLB", "COP"],
  },
  {
    id: "financials",
    label: "Financials",
    // V belongs here: GICS moved Visa/Mastercard from Information Technology into Financials in 2023.
    tickers: ["JPM", "GS", "BAC", "MS", "V"],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    // Renamed from "Biotech", which none of these are: UNH is a health INSURER, and LLY/MRK/ABBV are
    // big pharma. Only GILD is arguably biotech and it is the least-traded name on the whole board
    // (10.5k day vol). Swapping in real biotechs would make it worse, not better — VRTX 8.5k,
    // REGN 9.4k, BIIB 7.5k, AMGN 15.9k are all thinner still. The names are right; the label was wrong.
    tickers: ["LLY", "UNH", "MRK", "ABBV", "GILD"],
  },
] as const;

export const THERMAL_COMPARE_DEFAULT_PRESET_ID: ThermalComparePresetId = "semis";

/** Single source of truth for heatmap-warm / boot-seed / prefetch union. */
export function comparePresetWarmTickers(): string[] {
  return [
    ...new Set(THERMAL_COMPARE_PRESETS.flatMap((p) => p.tickers.map((t) => t.toUpperCase()))),
  ];
}

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
  return parseThermalComparePresetId(raw) != null;
}

/**
 * Preset ids that have been RENAMED, mapped to their current id.
 *
 * `compareSet` is a URL parameter, so it is in members' bookmarks, shared links and browser
 * history. Renaming "biotech" -> "healthcare" without this would silently drop those links to the
 * default preset — the reader sees Semis, assumes they mis-copied the link, and the rename looks
 * like a bug. Cheap to keep; delete only when the old links are demonstrably gone.
 */
const LEGACY_PRESET_IDS: Record<string, ThermalComparePresetId> = {
  biotech: "healthcare",
};

export function parseThermalComparePresetId(
  raw: string | null | undefined,
): ThermalComparePresetId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const id = (LEGACY_PRESET_IDS[key] ?? key) as ThermalComparePresetId;
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

/**
 * Legacy compare default — the classic SPY / SPX / QQQ triple.
 *
 * PINNED as a literal, NOT derived from the Indices preset, because its consumers are not the
 * compare grid. `thermalCompareForLargo` (lib/largo/product-reads.ts) fans out one getGexPositioning
 * call per entry, on a path that has already been trimmed once for timing out Largo turns at ~120s.
 * While this was `presets.find("indices").tickers`, adding IWM to a UI preset silently made a Largo
 * tool do more upstream work — a grid decision reaching into an unrelated subsystem with nothing in
 * between to notice. `isThermalCompareTicker` reads it too.
 *
 * The presets are free to grow; this triple is a separate, deliberate contract. Change it only for
 * its own reasons.
 */
export const THERMAL_COMPARE_TICKERS = ["SPY", "SPX", "QQQ"] as const;
