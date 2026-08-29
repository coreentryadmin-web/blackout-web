// Fitting functions for multiple market data Largo tools that exceed 16k transport cap.
// Product-first design: all native data available to products; fitting applied only at Largo boundary.

// ============ get_market_oi_change ============
export interface OiChangeFittedResult {
  changes?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

export function fitMarketOiChangeForModel(raw: any[], maxShown = 20): { fitted: OiChangeFittedResult } {
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

export function fitGroupGreekFlowForModel(raw: any[], maxShown = 15): { fitted: GroupGreekFlowFittedResult } {
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

// ============ get_screener ============
export interface ScreenerFittedResult {
  candidates?: any[];
  shown: number;
  truncated: boolean;
  max_shown: number;
}

export function fitScreenerForModel(raw: any[], maxShown = 15): { fitted: ScreenerFittedResult } {
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
