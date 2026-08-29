// Fitting functions for multiple market data Largo tools that exceed 16k transport cap.
// Product-first design: all native data available to products; fitting applied only at Largo boundary.

// ============ get_market_oi_change ============
export interface OiChangeFittedResult {
  changes?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

// MEASURED live (fetchUwMarketOiChange, 2026-08-29): ~635 bytes/entry, not the ~300 originally
// estimated — the 20-entry cap this shipped with (#3155) still truncated, and 15-entry cap
// (#3159) also still truncated when measured in production. Reduced to 8 to account for JSON
// overhead + wrapper overhead.
export function fitMarketOiChangeForModel(raw: any[], maxShown = 8): { fitted: OiChangeFittedResult } {
  const shown = Math.min(raw?.length || 0, maxShown);
  const changes = raw?.slice(0, shown);
  return {
    fitted: {
      changes: changes?.length > 0 ? changes : undefined,
      shown,
      truncated: (raw?.length || 0) > maxShown,
      max_shown: maxShown,
    },
  };
}

// ============ get_market_stats ============
export interface MarketStatsFittedResult {
  indices?: any;
  breadth?: any;
  shown: number;
  truncated: boolean;
}

export function fitMarketStatsForModel(raw: any): { fitted: MarketStatsFittedResult } {
  // Keep only core indices (SPY, SPX, QQQ, IWM, VIX) and breadth; shed extended stats
  const fitted: MarketStatsFittedResult = {
    shown: 1,
    truncated: false,
  };

  if (raw?.indices) {
    // Cap to major indices only
    const majorIndices = ["SPY", "SPX", "QQQ", "IWM", "VIX"];
    fitted.indices = typeof raw.indices === "object" && !Array.isArray(raw.indices)
      ? Object.fromEntries(
          Object.entries(raw.indices)
            .filter(([key]) => majorIndices.includes(key))
        )
      : raw.indices;
  }

  if (raw?.breadth) {
    fitted.breadth = raw.breadth;
  }

  return { fitted };
}

// ============ get_group_greek_flow ============
export interface GroupGreekFlowFittedResult {
  groups?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

export function fitGroupGreekFlowForModel(raw: any[], maxShown = 8): { fitted: GroupGreekFlowFittedResult } {
  const shown = Math.min(raw?.length || 0, maxShown);
  const groups = raw?.slice(0, shown);
  return {
    fitted: {
      groups: groups?.length > 0 ? groups : undefined,
      shown,
      truncated: (raw?.length || 0) > maxShown,
      max_shown: maxShown,
    },
  };
}

// ============ get_group_greek_flow raw rows ============
// The un-summarized per-contract/per-ticker rows behind the group summary. MEASURED live
// (fetchUwGroupGreekFlow, 2026-08-29): group="mag7" (the tool's own default) returns 391 rows /
// ~277KB — 17x the 16k transport cap on its own, before anything else in the payload. Average
// ~708 bytes/row; 15 rows leaves headroom for the rest of the response under the cap.
// However, live production probe (2026-08-29 21:30 ET) confirmed 15-row cap still truncates.
// Reduced to 8 rows to account for JSON overhead.
export interface GroupGreekFlowRowsFittedResult {
  rows?: Record<string, unknown>[];
  rows_shown: number;
  rows_truncated: boolean;
  rows_max_shown: number;
}

export function fitGroupGreekFlowRowsForModel(
  raw: Record<string, unknown>[],
  maxShown = 8
): GroupGreekFlowRowsFittedResult {
  const shown = Math.min(raw?.length || 0, maxShown);
  const rows = raw?.slice(0, shown);
  return {
    rows: rows?.length > 0 ? rows : undefined,
    rows_shown: shown,
    rows_truncated: (raw?.length || 0) > maxShown,
    rows_max_shown: maxShown,
  };
}

// ============ get_screener ============
export interface ScreenerFittedResult {
  candidates?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

// MEASURED live (fetchUwScreenerStocks, 2026-08-29): ~1956 bytes/entry with technicals attached
// (the PR that shipped this cap estimated ~300-400) — the 15-entry cap still truncated by a wide
// margin, and 6-entry cap (#3159) also still truncated when measured in production. Reduced to 3
// entries to account for JSON overhead + wrapper overhead.
export function fitScreenerForModel(raw: any[], maxShown = 3): { fitted: ScreenerFittedResult } {
  const shown = Math.min(raw?.length || 0, maxShown);
  const candidates = raw?.slice(0, shown);
  return {
    fitted: {
      candidates: candidates?.length > 0 ? candidates : undefined,
      shown,
      truncated: (raw?.length || 0) > maxShown,
      max_shown: maxShown,
    },
  };
}
