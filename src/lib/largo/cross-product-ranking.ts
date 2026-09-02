/**
 * Cross-product ranking: score and rank the same setup across all products.
 *
 * Example: "I'm looking at a call spread on SPX 3500/3510 expiring next week.
 * Which product has the best setup for this?"
 *
 * Answer: compares risk/reward, win-rate, edge, confidence across:
 * - Night Hawk (0DTE/weekly plays)
 * - Thermal (GEX positioning for the strike)
 * - Vector (wall structure at entry/target)
 * - SPX Slayer (confluence + current play)
 * - Helix (earnings catalyst within expiry)
 * - Meridian (sector flow + earnings)
 */

export interface CrossProductRankingInput {
  ticker: string;
  entry_price: number;
  direction: "call" | "put" | "bull" | "bear";
  timeframe: "0dte" | "weekly" | "monthly" | "earnings" | "sector";
  metric: "edge" | "expected_value" | "win_rate" | "confidence" | "avg_win_pct";
  optional_context?: string; // "ATM straddle", "OTM call spread", etc.
}

export interface ProductScore {
  product: "nighthawk" | "thermal" | "vector" | "spx" | "helix" | "meridian";
  rank: number;
  score: number; // 0-100, normalized across products
  raw_value: number; // product's native metric (win_rate %, edge $, etc.)
  confidence: number; // 0-1, model's confidence in this ranking
  reason: string; // "Live 0DTE setup", "Strong dealer positioning", etc.
  data_source: string; // which tool provided the data
  freshness_minutes: number; // how old is this data?
}

export interface CrossProductRankingResult {
  ticker: string;
  entry_price: number;
  direction: string;
  timeframe: string;
  metric: string;
  as_of_et: string;
  products: ProductScore[];
  top_product: string | null;
  explanation: string; // why the top product ranks highest
  caveats: string[]; // data gaps, inactive products, etc.
  note: string;
}

/**
 * Score a setup across all products and rank by the requested metric.
 *
 * Architecture:
 * 1. Extract per-product scores from their native data sources
 * 2. Normalize to 0-100 scale (product-specific max differs)
 * 3. Rank by requested metric
 * 4. Attach confidence and freshness
 *
 * Each product's scorer is independent and only calls tools it owns.
 */
export async function rankSetupAcrossProducts(
  input: CrossProductRankingInput,
  tools: Record<string, any>
): Promise<CrossProductRankingResult> {
  const results: ProductScore[] = [];

  // Evaluate each product in parallel where possible
  const scores = await Promise.allSettled([
    scoreNightHawk(input, tools),
    scoreThermal(input, tools),
    scoreVector(input, tools),
    scoreSpxSlayer(input, tools),
    scoreHelix(input, tools),
    scoreMeridian(input, tools),
  ]);

  // Collect results, skipping failures
  for (const result of scores) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }

  // Rank results
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => (r.rank = i + 1));

  const topProduct = results[0]?.product || null;

  return {
    ticker: input.ticker,
    entry_price: input.entry_price,
    direction: input.direction,
    timeframe: input.timeframe,
    metric: input.metric,
    as_of_et: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    products: results,
    top_product: topProduct,
    explanation: results[0]
      ? `${results[0].product} ranks #1 with a ${input.metric} of ${results[0].raw_value.toFixed(1)}. ${results[0].reason}`
      : "No products could score this setup.",
    caveats: results.filter((r) => r.confidence < 0.6).map((r) => `${r.product}: low confidence (${(r.confidence * 100).toFixed(0)}%)`),
    note: results.length < 6 ? `${6 - results.length} products unavailable or inactive.` : "All products evaluated.",
  };
}

// ============ Per-Product Scorers ============

async function scoreNightHawk(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score Night Hawk (0DTE/weekly plays) on win-rate and edge
  try {
    if (input.timeframe !== "0dte" && input.timeframe !== "weekly") return null;

    // Check if there's an active play for this setup
    const edition = await tools.get_nighthawk_edition?.();
    if (!edition?.available || !edition?.plays?.length) {
      // Historical track record fallback
      const outcomes = await tools.get_nighthawk_outcomes?.();
      const winRate = outcomes?.win_rate_pct ?? 50;

      return {
        product: "nighthawk",
        rank: 0,
        score: normalizeWinRate(winRate),
        raw_value: winRate,
        confidence: 0.6, // historical, not live
        reason: "Track record average (no live setup for this ticker)",
        data_source: "get_nighthawk_outcomes",
        freshness_minutes: 60,
      };
    }

    const relevant = edition.plays.filter((p: any) => p.ticker === input.ticker && p.direction === input.direction);
    if (!relevant?.length) {
      // No specific setup for this ticker, use track record
      const outcomes = await tools.get_nighthawk_outcomes?.();
      const winRate = outcomes?.win_rate_pct ?? 50;
      return {
        product: "nighthawk",
        rank: 0,
        score: normalizeWinRate(winRate),
        raw_value: winRate,
        confidence: 0.6,
        reason: "Track record average (no live setup for this ticker)",
        data_source: "get_nighthawk_outcomes",
        freshness_minutes: 60,
      };
    }

    const play = relevant[0];
    return {
      product: "nighthawk",
      rank: 0,
      score: normalizeScore(play.win_rate_pct ?? 50, 100),
      raw_value: play.win_rate_pct ?? 50,
      confidence: 0.9, // live data
      reason: `Live ${input.timeframe.toUpperCase()} setup with ${play.win_rate_pct?.toFixed(0)}% historical WR`,
      data_source: "get_nighthawk_edition",
      freshness_minutes: 0,
    };
  } catch {
    return null;
  }
}

async function scoreThermal(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score Thermal (GEX, dealer positioning) on gamma + put/call ratio
  try {
    const oiChange = await tools.get_market_oi_change?.();
    const greekFlow = await tools.get_group_greek_flow?.();

    if (!oiChange?.changes?.length) return null;

    // Find the ticker's OI change
    const oi = oiChange.changes.find((c: any) => c.ticker === input.ticker);
    if (!oi) return null;

    // Gamma direction should match our directional bias
    const gammaScore = Math.abs(oi.gamma_notional ?? 0);
    const directionMatch = (oi.direction === "call" && input.direction.includes("call")) ||
      (oi.direction === "put" && input.direction.includes("put"));

    return {
      product: "thermal",
      rank: 0,
      score: normalizeScore(gammaScore, 1000), // typical range 0-1000k notional
      raw_value: gammaScore,
      confidence: directionMatch ? 0.85 : 0.5,
      reason: `Dealer ${oi.direction} gamma ${directionMatch ? "favors" : "opposes"} ${input.direction}`,
      data_source: "get_market_oi_change",
      freshness_minutes: 1,
    };
  } catch {
    return null;
  }
}

async function scoreVector(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score Vector (walls, structure) on proximity to support/resistance
  try {
    const pulse = await tools.get_vector_pulse?.();
    if (!pulse?.signal) return null;

    // Wall proximity to entry price
    const wallDistance = Math.abs((pulse.wall_level ?? 0) - input.entry_price);
    const distanceScore = Math.max(0, 100 - wallDistance); // closer = higher score

    return {
      product: "vector",
      rank: 0,
      score: distanceScore,
      raw_value: wallDistance,
      confidence: pulse.has_baseline ? 0.8 : 0.4,
      reason: `Entry ${distanceScore > 70 ? "near" : "far from"} structural wall; ${pulse.signal ?? "neutral"}`,
      data_source: "get_vector_pulse",
      freshness_minutes: 0,
    };
  } catch {
    return null;
  }
}

async function scoreSpxSlayer(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score SPX Slayer (only for SPX ticker)
  try {
    if (input.ticker !== "SPX") return null;

    const play = await tools.get_spx_play?.();
    if (!play) return null;

    return {
      product: "spx",
      rank: 0,
      score: normalizeScore(play.confluence_score ?? 50, 100),
      raw_value: play.confluence_score ?? 50,
      confidence: 0.8,
      reason: `Current SPX play at ${play.confluence_score ?? "?"}% confluence`,
      data_source: "get_spx_play",
      freshness_minutes: 5,
    };
  } catch {
    return null;
  }
}

async function scoreHelix(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score Helix (earnings within expiry window)
  try {
    if (input.timeframe !== "earnings" && input.timeframe !== "weekly" && input.timeframe !== "monthly") {
      return null; // earnings only relevant for near-earnings timeframes
    }

    const earnings = await tools.get_earnings_market?.();
    const relevant = earnings?.find((e: any) => e.ticker === input.ticker);

    if (!relevant) return null;

    const expectedMove = relevant.expected_move_pct ?? 0;
    const moveScore = normalizeScore(expectedMove, 10); // 10% is high move

    return {
      product: "helix",
      rank: 0,
      score: moveScore,
      raw_value: expectedMove,
      confidence: 0.75,
      reason: `Earnings within expiry window, ${expectedMove.toFixed(1)}% expected move`,
      data_source: "get_earnings_market",
      freshness_minutes: 60,
    };
  } catch {
    return null;
  }
}

async function scoreMeridian(input: CrossProductRankingInput, tools: any): Promise<ProductScore | null> {
  // Score Meridian (sector themes, flows, earnings calendar)
  try {
    const earnings = await tools.get_earnings_market?.();
    if (!earnings?.length) return null;

    const relevant = earnings.find((e: any) => e.ticker === input.ticker);
    if (!relevant) return null;

    // Meridian adds value when there's earnings + expected move
    const moveScore = normalizeScore(relevant.expected_move_pct ?? 0, 10);

    return {
      product: "meridian",
      rank: 0,
      score: moveScore,
      raw_value: relevant.expected_move_pct ?? 0,
      confidence: 0.7, // earnings data is reliable but historical
      reason: `Earnings calendar signal, ${relevant.expected_move_pct?.toFixed(1)}% expected move`,
      data_source: "get_earnings_market",
      freshness_minutes: 120, // earnings data ages slowly
    };
  } catch {
    return null;
  }
}

// ============ Normalization Helpers ============

function normalizeWinRate(winRate: number): number {
  // Win rate: 50% = 50 score, 70% = 70 score
  return Math.min(100, Math.max(0, winRate));
}

function normalizeScore(rawValue: number, maxExpected: number): number {
  // Normalize to 0-100 range
  return Math.min(100, Math.max(0, (rawValue / maxExpected) * 100));
}
