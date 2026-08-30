/**
 * Live multiproduct board: real-time aggregated opportunity board across all products.
 *
 * Answers: "Give me the top N setups to work on RIGHT NOW across all products"
 *
 * Assembles a unified opportunity board by:
 * 1. Fetching live plays/setups from each product
 * 2. Normalizing to common fields (direction, entry, target, confidence)
 * 3. Ranking by selected metric (edge, confidence, urgency)
 * 4. Limiting to fit under transport cap
 */

export interface MultiproductBoardInput {
  metric: "edge" | "confidence" | "urgency" | "score"; // default "score"
  limit?: number; // default 5, max 10
  hours_ahead?: number; // default 0 (current), max 6 (look-ahead)
}

export interface UnifiedSetup {
  rank: number;
  product: string; // "nighthawk", "thermal", "vector", "spx", "helix", "meridian"
  ticker: string;
  setup_type: string; // "0DTE call", "earnings flow", "sector momentum", "gamma flip", etc.
  direction: "bull" | "bear" | "neutral";
  entry_level: number;
  target_level: number | null;
  stop_level: number;
  edge_pct: number | null; // realized or expected, null if unmeasured
  confidence: number; // 0-1
  expires_at_et: string; // ISO string
  live: boolean; // is this actively trading?
  rationale: string; // one-line reason it's ranking high
  freshness_minutes: number;
}

export interface LiveMultiproductBoardResult {
  as_of_et: string;
  refresh_interval_sec: number;
  metric: string;
  setups: UnifiedSetup[];
  truncated: boolean;
  shown: number;
  total_available: number;
  note: string;
}

/**
 * Assemble the live multiproduct board by fetching and aggregating all products.
 *
 * The board is live: each product's data is fetched fresh, normalized, and ranked.
 * Results are bounded by limit (default 5, max 10) to fit under transport cap.
 */
export async function assembleMultiproductBoard(
  input: MultiproductBoardInput,
  tools: Record<string, any>
): Promise<LiveMultiproductBoardResult> {
  const limit = Math.min(input.limit ?? 5, 10);
  const metric = input.metric ?? "score";
  const hoursAhead = input.hours_ahead ?? 0;

  const setups: UnifiedSetup[] = [];

  // Fetch from each product in parallel
  const [nh, thermal, vector, spx, helix] = await Promise.allSettled([
    fetchNightHawkSetups(tools),
    fetchThermalSetups(tools),
    fetchVectorSetups(tools),
    fetchSpxSetups(tools),
    fetchHelixSetups(tools),
  ]);

  // Collect results, skipping errors
  if (nh.status === "fulfilled") setups.push(...(nh.value || []));
  if (thermal.status === "fulfilled") setups.push(...(thermal.value || []));
  if (vector.status === "fulfilled") setups.push(...(vector.value || []));
  if (spx.status === "fulfilled") setups.push(...(spx.value || []));
  if (helix.status === "fulfilled") setups.push(...(helix.value || []));

  const totalAvailable = setups.length;

  // Rank by requested metric
  setups.sort((a, b) => {
    const scoreA = computeMetricScore(a, metric);
    const scoreB = computeMetricScore(b, metric);
    return scoreB - scoreA;
  });

  // Apply limit
  const truncated = setups.length > limit;
  const keptSetups = setups.slice(0, limit);
  keptSetups.forEach((s, i) => (s.rank = i + 1));

  return {
    as_of_et: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    refresh_interval_sec: 60,
    metric,
    setups: keptSetups,
    truncated,
    shown: keptSetups.length,
    total_available: totalAvailable,
    note:
      totalAvailable === 0
        ? "No live setups found. Market may be closed or no signals active."
        : truncated
          ? `Showing top ${limit} of ${totalAvailable} setups.`
          : `All ${totalAvailable} setups shown.`,
  };
}

// ============ Per-Product Fetchers ============

async function fetchNightHawkSetups(tools: any): Promise<UnifiedSetup[]> {
  try {
    const plays = await tools.get_nighthawk_edition?.();
    if (!plays?.plays?.length) return [];

    return plays.plays.slice(0, 3).map((play: any) => ({
      rank: 0,
      product: "nighthawk",
      ticker: play.ticker,
      setup_type: `0DTE ${play.direction}`,
      direction: play.direction === "call" ? "bull" : "bear",
      entry_level: play.entry_price ?? 0,
      target_level: play.target_price ?? null,
      stop_level: play.stop_price ?? play.entry_price! * 0.98,
      edge_pct: play.edge_pct ?? null,
      confidence: play.win_rate_pct ? play.win_rate_pct / 100 : 0.5,
      expires_at_et: play.expires_at_et ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      live: true,
      rationale: `0DTE setup, ${play.win_rate_pct?.toFixed(0)}% WR`,
      freshness_minutes: 0,
    }));
  } catch {
    return [];
  }
}

async function fetchThermalSetups(tools: any): Promise<UnifiedSetup[]> {
  try {
    const compare = await tools.get_thermal_compare?.();
    if (!compare?.active?.length) return [];

    return compare.active.slice(0, 2).map((setup: any) => ({
      rank: 0,
      product: "thermal",
      ticker: setup.ticker,
      setup_type: `${setup.type} gamma`,
      direction: setup.direction === "call" ? "bull" : "bear",
      entry_level: setup.entry_level ?? 0,
      target_level: setup.target_level ?? null,
      stop_level: setup.stop_level ?? setup.entry_level! * 0.98,
      edge_pct: null, // Thermal focuses on positioning, not edge
      confidence: setup.dealer_confidence ?? 0.6,
      expires_at_et: setup.expires_at_et ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      live: true,
      rationale: `Dealer ${setup.direction} positioning, ${setup.gamma_notional?.toFixed(0)}k gamma`,
      freshness_minutes: 1,
    }));
  } catch {
    return [];
  }
}

async function fetchVectorSetups(tools: any): Promise<UnifiedSetup[]> {
  try {
    const state = await tools.get_vector_full_state?.();
    if (!state?.walls?.length) return [];

    return state.walls.slice(0, 2).map((wall: any) => ({
      rank: 0,
      product: "vector",
      ticker: wall.ticker,
      setup_type: `${wall.direction} wall`,
      direction: wall.direction === "call" ? "bull" : "bear",
      entry_level: wall.level ?? 0,
      target_level: wall.target ?? null,
      stop_level: wall.stop ?? wall.level! * 0.97,
      edge_pct: null,
      confidence: wall.strength / 100, // 0-1
      expires_at_et: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      live: true,
      rationale: `Structural ${wall.direction} wall at ${wall.level.toFixed(2)}`,
      freshness_minutes: 0,
    }));
  } catch {
    return [];
  }
}

async function fetchSpxSetups(tools: any): Promise<UnifiedSetup[]> {
  try {
    const play = await tools.get_spx_play?.();
    if (!play) return [];

    return [
      {
        rank: 0,
        product: "spx",
        ticker: "SPX",
        setup_type: `SPX ${play.play_type}`,
        direction: play.direction === "call" ? "bull" : play.direction === "put" ? "bear" : "neutral",
        entry_level: play.entry_price ?? 0,
        target_level: play.target_price ?? null,
        stop_level: play.stop_price ?? play.entry_price! * 0.97,
        edge_pct: play.edge_pct ?? null,
        confidence: play.confluence_score ? play.confluence_score / 100 : 0.5,
        expires_at_et: play.expiry ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        live: play.live ?? true,
        rationale: `SPX ${play.play_type}, ${play.confluence_score?.toFixed(0)}% confluence`,
        freshness_minutes: 5,
      },
    ];
  } catch {
    return [];
  }
}

async function fetchHelixSetups(tools: any): Promise<UnifiedSetup[]> {
  try {
    const signals = await tools.get_helix_signal_outcomes?.();
    if (!signals?.active?.length) return [];

    return signals.active.slice(0, 2).map((signal: any) => ({
      rank: 0,
      product: "helix",
      ticker: signal.ticker,
      setup_type: `Earnings ${signal.reaction_type}`,
      direction: signal.direction === "call" ? "bull" : "bear",
      entry_level: signal.entry_price ?? 0,
      target_level: signal.target_price ?? null,
      stop_level: signal.stop_price ?? signal.entry_price! * 0.95,
      edge_pct: signal.historical_edge_pct ?? null,
      confidence: signal.confidence ?? 0.5,
      expires_at_et: signal.earnings_date,
      live: true,
      rationale: `Earnings signal, ${signal.reaction_type}, ${signal.historical_edge_pct?.toFixed(1)}% edge`,
      freshness_minutes: 60,
    }));
  } catch {
    return [];
  }
}

// ============ Ranking Helpers ============

function computeMetricScore(setup: UnifiedSetup, metric: string): number {
  switch (metric) {
    case "edge":
      return setup.edge_pct ?? 0;
    case "confidence":
      return setup.confidence * 100;
    case "urgency":
      // Urgency: sooner expiry = higher urgency
      const minutesUntilExpiry = (new Date(setup.expires_at_et).getTime() - Date.now()) / 60000;
      return Math.max(0, 100 - minutesUntilExpiry / 60); // decreases over time
    case "score":
    default:
      // Composite: (edge + confidence*50) weighted by freshness
      const baseScore = (setup.edge_pct ?? 50) + setup.confidence * 50;
      const freshnessWeight = Math.max(0.5, 1 - setup.freshness_minutes / 100); // older = lower weight
      return baseScore * freshnessWeight;
  }
}
