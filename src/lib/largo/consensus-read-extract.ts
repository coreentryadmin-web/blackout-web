/**
 * CONSENSUS READ EXTRACTOR — normalizes 6 product systems into unified market read.
 *
 * Each product independently answers "what direction?" from its own perspective:
 * - HELIX: "tape is bullish" (call sweeps > put sweeps)
 * - THERMAL: "gamma is positive" (dealer wants up)
 * - VECTOR: "walls are up" (structure bullish)
 * - SPX_SLAYER: "confluence on long side" (multi-factor agreement)
 * - NIGHT_HAWK: "0DTE plays are bullish" (positions net long)
 * - MERIDIAN: "earnings reaction bullish" (post-print move)
 *
 * This layer:
 * 1. Extracts directional read from EACH tool result (without modifying)
 * 2. Normalizes strength to 0-10 scale per system
 * 3. Aggregates into consensus matrix
 * 4. Detects CONFLICTS (bullish consensus but bearish on this system)
 * 5. Surfaces disagreements without reconciling them
 *
 * WHY THIS MATTERS. Cross-product disagreement IS INFORMATION. When Helix says "bullish"
 * and Thermal says "bearish", that conflict is actionable — it means setup is contested.
 * A system that averages them into "neutral" has destroyed the signal and misled the trader.
 */

import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";

export type SystemDirectionalRead = {
  /** Which product system made this read. */
  system: "SPX_SLAYER" | "HELIX" | "THERMAL" | "VECTOR" | "NIGHT_HAWK" | "MERIDIAN";
  /** The directional stance from this system. */
  direction: "bullish" | "bearish" | "neutral" | "mixed";
  /**
   * Confidence in that direction, normalized to 0-10.
   * 0: no opinion / conflicted
   * 5: neutral / balanced / mixed signals
   * 10: strong / high conviction
   */
  strength: number;
  /** What observation drives this read (e.g., "call sweeps 2.5:1", "positive gamma at spot"). */
  basis: string;
  /** Supporting observations (when system has multiple signals). */
  evidence?: string[];
  /** Any contradictions WITHIN this system (e.g., flow bullish but technicals bearish). */
  internalConflict?: string;
  /** When this data was generated. */
  asOf: string; // ISO timestamp
  /** ET session date anchor (YYYY-MM-DD). */
  sessionDate?: string;
  /** How fresh the underlying data is. */
  freshness: "live" | "recent" | "stale" | "unknown";
};

export type ConsensusMatrix = {
  /** Individual reads from each system consulted. */
  reads: SystemDirectionalRead[];
  /** Aggregated agreement/conflict summary. */
  agreement: {
    /** How many systems had an opinion. */
    voting: number;
    /** How many said bullish. */
    bullish: number;
    /** How many said bearish. */
    bearish: number;
    /** How many said neutral. */
    neutral: number;
    /** Composite verdict from majority. */
    verdict: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish" | "conflicted";
    /** The direction of the majority (or null if true tie/conflict). */
    direction: "bullish" | "bearish" | "neutral" | null;
    /** Weighted average strength across all systems. */
    averageStrength: number;
  };
  /** Which system pairs contradict (bullish vs bearish). */
  contradictions: {
    pair: [string, string];
    stronger: string; // which system has higher strength
    why: string; // brief explanation of the conflict
  }[];
};

/**
 * Extract directional read from HELIX tape result.
 * Expected shape: flow prints, call vs put, sweep data.
 */
function extractHelixRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  // Helix reports call/put sweeps and volumes
  const callVolume = result.call_volume ?? result.calls_premium ?? 0;
  const putVolume = result.put_volume ?? result.puts_premium ?? 0;
  const callPrints = result.call_prints ?? 0;
  const putPrints = result.put_prints ?? 0;

  const totalVolume = callVolume + putVolume;
  const totalPrints = callPrints + putPrints;

  if (totalVolume === 0 && totalPrints === 0) {
    return {
      system: "HELIX",
      direction: "neutral",
      strength: 0,
      basis: "No flow detected",
      asOf: new Date().toISOString(),
      sessionDate: etSessionDate(Date.now()) ?? undefined,
      freshness: "unknown",
    };
  }

  const callRatio = totalVolume > 0 ? callVolume / totalVolume : 0.5;
  const printRatio = totalPrints > 0 ? callPrints / totalPrints : callRatio;

  // Strength based on how skewed the ratio is (0-10)
  const ratio = Math.max(callRatio, printRatio);
  const strength = Math.round((Math.abs(ratio - 0.5) * 2) * 10);

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  if (callRatio > 0.6) direction = "bullish";
  else if (callRatio < 0.4) direction = "bearish";

  const basis =
    callRatio > 0.6
      ? `Calls ${Math.round(callRatio * 100)}% of flow`
      : `Puts ${Math.round((1 - callRatio) * 100)}% of flow`;

  return {
    system: "HELIX",
    direction,
    strength: Math.min(strength, 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    sessionDate: etSessionDate(Date.now()) ?? undefined,
    freshness: result.freshness ?? "live",
  };
}

/**
 * Extract directional read from THERMAL GEX result.
 * Expected shape: gamma positioning, call/put walls.
 *
 * DEALER GAMMA IS NOT A DIRECTIONAL MEASUREMENT — this function used to assert otherwise, twice
 * over. Short gamma amplifies a move in EITHER direction and long gamma dampens a move in EITHER
 * direction, so folding either onto a bullish/bearish axis states something the matrix never
 * measured. This is the exact live P0 (#2422) that `contract/product-adapters.ts::thermalContribution`
 * was written to fix — Thermal casts NO directional vote there, on purpose — but the identical
 * anti-pattern shipped again here, in the module that actually feeds the live adaptive-response
 * orchestrator's consensus matrix and PLAY/WAIT/NO_TRADE gate (`desk-read-decision.ts`).
 *
 * It also read the WRONG field. The real payload (`GexPositioning`, `get_positioning`/
 * `get_gex_heatmap`) carries `gamma_posture: "long" | "short" | null` — there is no `gamma_flip`
 * string field; `flip` is a numeric strike level. So `result.gamma_flip === "positive"` never
 * matched real data at all (silently voting "neutral" in production) while still matching any
 * test/fixture payload built with that shape, which is how the bug passed review and how the
 * repo's own `consensus-read-extract.test.ts` came to assert `{ gamma_flip: "positive" }` counts
 * as a real bullish vote (see the updated test alongside this fix).
 *
 * The corrected mapping mirrors the ALREADY-ESTABLISHED convention in
 * `helix-thermal-compare.ts::thermalReadFromPosture` (also documented in `tool-defs.ts`'s
 * `get_helix_thermal_compare` description): long gamma -> "neutral" (dealers dampen both ways,
 * mean-reverting), short gamma -> "mixed" (dealers amplify both ways) — never "bullish"/"bearish".
 * Wall proximity is reported as evidence in `basis`, not folded into direction — a call wall
 * sitting above spot is a level, not a vote.
 */
function extractThermalRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  const posture: "long" | "short" | null = result.gamma_posture ?? result.regime?.posture ?? null;
  const callWall = result.call_wall ?? result.call_wall_strike ?? null;
  const putWall = result.put_wall ?? result.put_wall_strike ?? null;
  const spotPrice = result.spot ?? result.current_price ?? 0;

  let direction: "bullish" | "bearish" | "neutral" | "mixed" = "neutral";
  let strength = 0;
  let basis = "No dealer gamma posture available";

  if (posture === "long") {
    direction = "neutral";
    strength = 6;
    basis = "Long gamma (dealers dampen moves both ways — mean-reverting)";
  } else if (posture === "short") {
    direction = "mixed";
    strength = 6;
    basis = "Short gamma (dealers amplify moves both ways)";
  }

  // Wall proximity is EVIDENCE, never a directional vote — described in basis only.
  if (callWall && spotPrice && callWall > spotPrice * 1.01) {
    basis += "; call wall above spot";
  } else if (putWall && spotPrice && putWall < spotPrice * 0.99) {
    basis += "; put wall below spot";
  }

  return {
    system: "THERMAL",
    direction,
    strength: Math.min(strength, 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    freshness: result.freshness ?? "recent",
  };
}

/**
 * Extract directional read from VECTOR technical state.
 * Expected shape: walls, beads, magnet, structure (HH/HL/LH/LL).
 */
function extractVectorRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  const structure = result.structure ?? result.market_structure ?? null;
  const bias = result.bias ?? null;
  const magnet = result.magnet ?? result.magnet_level ?? null;
  const spotPrice = result.spot ?? result.current_price ?? 0;

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let strength = 5;
  let basis = "Structure neutral";

  // Market structure (higher high/higher low = uptrend)
  if (structure === "HH" || structure === "higher_high") {
    direction = "bullish";
    strength = 7;
    basis = "Higher highs/higher lows (uptrend)";
  } else if (structure === "LL" || structure === "lower_low") {
    direction = "bearish";
    strength = 7;
    basis = "Lower lows/lower highs (downtrend)";
  }

  // Bias refinement
  if (bias === "bullish" || bias === "long") {
    direction = "bullish";
    strength = Math.max(strength, 6);
    basis += "; bullish bias";
  } else if (bias === "bearish" || bias === "short") {
    direction = "bearish";
    strength = Math.max(strength, 6);
    basis += "; bearish bias";
  }

  // Magnet position (is price attracted up or down?)
  if (magnet && spotPrice && magnet > spotPrice * 1.005) {
    strength = Math.max(strength, 7);
    basis += "; magnet above";
  } else if (magnet && spotPrice && magnet < spotPrice * 0.995) {
    strength = Math.max(strength, 7);
    basis += "; magnet below";
  }

  return {
    system: "VECTOR",
    direction,
    strength: Math.min(strength, 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    freshness: result.freshness ?? "recent",
  };
}

/**
 * Extract directional read from SPX_SLAYER engine state.
 * Expected shape: play direction, confluence, phase, gates.
 */
function extractSpxRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  const playDir = result.direction ?? result.bias ?? null;
  const confluence = result.confluence ?? result.confluence_count ?? 0;
  const gatesPassed = result.gates_passed ?? 0;
  const gatesTotal = result.gates_total ?? 5;

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let strength = 5;
  let basis = "SPX engine neutral";

  if (playDir === "long" || playDir === "bullish") {
    direction = "bullish";
    strength = 7;
    basis = "SPX engine bullish";
  } else if (playDir === "short" || playDir === "bearish") {
    direction = "bearish";
    strength = 7;
    basis = "SPX engine bearish";
  }

  // Confluence increases strength
  if (confluence && confluence >= 3) {
    strength = Math.min(10, strength + (confluence - 2));
    basis += `; ${confluence} confluence factors`;
  }

  // Gate passage (phase progress)
  if (gatesTotal > 0) {
    const gateRate = gatesPassed / gatesTotal;
    if (gateRate > 0.7) {
      strength = Math.max(strength, 8);
      basis += "; advanced phase";
    } else if (gateRate < 0.3) {
      strength = Math.min(strength, 4);
      basis += "; early phase";
    }
  }

  return {
    system: "SPX_SLAYER",
    direction,
    strength: Math.min(strength, 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    freshness: result.freshness ?? "recent",
  };
}

/**
 * Extract directional read from NIGHT_HAWK 0DTE board.
 * Expected shape: plays list, majority direction, setup count.
 */
function extractNightHawkRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  const plays = result.plays ?? result.board ?? [];
  if (!Array.isArray(plays) || plays.length === 0) {
    return {
      system: "NIGHT_HAWK",
      direction: "neutral",
      strength: 0,
      basis: "No 0DTE plays on board",
      asOf: new Date().toISOString(),
      freshness: "unknown",
    };
  }

  const bullishCount = plays.filter((p: any) => p.direction === "long" || p.direction === "bullish").length;
  const bearishCount = plays.filter((p: any) => p.direction === "short" || p.direction === "bearish").length;

  const direction = bullishCount > bearishCount ? "bullish" : bullishCount < bearishCount ? "bearish" : "neutral";
  const strength = Math.round((Math.abs(bullishCount - bearishCount) / plays.length) * 10);

  const basis =
    direction === "bullish"
      ? `${bullishCount}/${plays.length} 0DTE plays bullish`
      : `${bearishCount}/${plays.length} 0DTE plays bearish`;

  return {
    system: "NIGHT_HAWK",
    direction,
    strength: Math.min(Math.max(strength, 1), 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    sessionDate: etSessionDate(Date.now()) ?? undefined,
    freshness: result.freshness ?? "live",
  };
}

/**
 * Extract directional read from MERIDIAN earnings events.
 * Expected shape: reaction events, direction, magnitude.
 */
function extractMeridianRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;

  const reactions = result.reactions ?? result.events ?? [];
  if (!Array.isArray(reactions) || reactions.length === 0) {
    return {
      system: "MERIDIAN",
      direction: "neutral",
      strength: 0,
      basis: "No earnings reactions in window",
      asOf: new Date().toISOString(),
      freshness: "unknown",
    };
  }

  // Recent reactions (last reaction dominates)
  const recent = reactions.slice(-3);
  const bullCount = recent.filter((r: any) => r.reaction > 0 || r.direction === "up").length;
  const bearCount = recent.filter((r: any) => r.reaction < 0 || r.direction === "down").length;

  const direction = bullCount > bearCount ? "bullish" : bearCount > bullCount ? "bearish" : "neutral";
  const strength = Math.round((Math.abs(bullCount - bearCount) / recent.length) * 10);

  const basis =
    recent.length > 0
      ? `Recent earnings reactions ${direction === "bullish" ? "beat" : "missed"}`
      : "Earnings reactions neutral";

  return {
    system: "MERIDIAN",
    direction,
    strength: Math.min(Math.max(strength, 1), 10),
    basis,
    asOf: result.asOf ?? new Date().toISOString(),
    freshness: result.freshness ?? "recent",
  };
}

/**
 * Build consensus matrix from tool results.
 *
 * CRITICAL: This does NOT modify tool results. Each system's read is extracted ONCE,
 * and disagreements are surfaced, not reconciled. The trader sees the conflict and
 * makes their own decision.
 */
export function extractConsensusFromTools(toolResults: Record<string, any>): ConsensusMatrix {
  const validReads: SystemDirectionalRead[] = [];

  // Each tool result → try to extract a read. Only push successful extractions.
  const helixFlow = extractHelixRead(toolResults.get_flow_tape);
  if (helixFlow) validReads.push(helixFlow);
  const helixDerived = extractHelixRead(toolResults.get_helix_derived);
  if (helixDerived) validReads.push(helixDerived);

  const thermalPos = extractThermalRead(toolResults.get_positioning);
  if (thermalPos) validReads.push(thermalPos);
  const thermalGex = extractThermalRead(toolResults.get_gex_heatmap);
  if (thermalGex) validReads.push(thermalGex);

  const vectorFull = extractVectorRead(toolResults.get_vector_full_state);
  if (vectorFull) validReads.push(vectorFull);
  const vectorPulse = extractVectorRead(toolResults.get_vector_pulse);
  if (vectorPulse) validReads.push(vectorPulse);

  const spxStruct = extractSpxRead(toolResults.get_spx_structure);
  if (spxStruct) validReads.push(spxStruct);
  const spxPlay = extractSpxRead(toolResults.get_spx_play);
  if (spxPlay) validReads.push(spxPlay);

  const nighthawk = extractNightHawkRead(toolResults.get_zerodte_plays);
  if (nighthawk) validReads.push(nighthawk);

  const meridianTimeline = extractMeridianRead(toolResults.get_meridian_timeline);
  if (meridianTimeline) validReads.push(meridianTimeline);
  const meridianEvent = extractMeridianRead(toolResults.get_meridian_event);
  if (meridianEvent) validReads.push(meridianEvent);

  if (validReads.length === 0) {
    return {
      reads: [],
      agreement: {
        voting: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        verdict: "neutral",
        direction: null,
        averageStrength: 0,
      },
      contradictions: [],
    };
  }

  // Aggregate agreement
  const bullishCount = validReads.filter((r) => r.direction === "bullish").length;
  const bearishCount = validReads.filter((r) => r.direction === "bearish").length;
  const neutralCount = validReads.filter((r) => r.direction === "neutral").length;
  const voting = validReads.length;

  // Determine verdict
  let verdict: ConsensusMatrix["agreement"]["verdict"];
  let direction: "bullish" | "bearish" | "neutral" | null = null;

  if (bullishCount > bearishCount && bullishCount > neutralCount) {
    if (bullishCount === voting) verdict = "strong_bullish";
    else verdict = "bullish";
    direction = "bullish";
  } else if (bearishCount > bullishCount && bearishCount > neutralCount) {
    if (bearishCount === voting) verdict = "strong_bearish";
    else verdict = "bearish";
    direction = "bearish";
  } else if (bullishCount + bearishCount > 0 && Math.abs(bullishCount - bearishCount) <= 1) {
    // A near-even split needs at least one bullish AND one bearish vote to be a real conflict —
    // unanimous (or all-but-one) neutral also satisfies `abs(0-0) <= 1` but is agreement, not
    // disagreement. Reporting that as "conflicted" fabricates the exact fake cross-product
    // disagreement this module's own header says it must never invent.
    verdict = "conflicted";
    direction = null;
  } else {
    verdict = "neutral";
    direction = "neutral";
  }

  // Average strength
  const avgStrength = Math.round(validReads.reduce((sum, r) => sum + r.strength, 0) / validReads.length);

  // Find contradictions (bullish/bearish pairs with significant strength gap)
  const contradictions: ConsensusMatrix["contradictions"] = [];
  for (let i = 0; i < validReads.length; i++) {
    for (let j = i + 1; j < validReads.length; j++) {
      const r1 = validReads[i];
      const r2 = validReads[j];
      if (
        (r1.direction === "bullish" && r2.direction === "bearish") ||
        (r1.direction === "bearish" && r2.direction === "bullish")
      ) {
        const stronger = r1.strength >= r2.strength ? r1.system : r2.system;
        contradictions.push({
          pair: [r1.system, r2.system],
          stronger,
          why: `${r1.system} (${r1.direction}) vs ${r2.system} (${r2.direction})`,
        });
      }
    }
  }

  return {
    reads: validReads,
    agreement: {
      voting,
      bullish: bullishCount,
      bearish: bearishCount,
      neutral: neutralCount,
      verdict,
      direction,
      averageStrength: avgStrength,
    },
    contradictions,
  };
}
