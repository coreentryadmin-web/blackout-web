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
import { directionFromCallPct } from "@/lib/largo/contract/product-adapters";

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
 * Extract directional read from HELIX tape analytics (`get_helix_tape_analytics` — the ONLY
 * HELIX tool that carries a directional field; see extractConsensusFromTools).
 *
 * 2026-09-04 audit finding — FIXED. This used to read invented field names (`call_volume`/
 * `calls_premium`/`call_prints`/`put_prints`) that exist on NEITHER real HELIX tool payload
 * (`get_flow_tape`'s `FlowTapeSummary` nests skew under `pull_skew`; `get_helix_derived` has no
 * call/put split at all), so every real call silently fell through to the hardcoded
 * `{strength:0, basis:"No flow detected"}` default — a textbook C3 violation (absence presented
 * as a measured reading).
 *
 * The naive fix — read `pull_skew.call_pct` and call it done — would have introduced a SECOND,
 * worse C3 violation: `call_pct` is a raw call/put PREMIUM SHARE, not a direction. A bought call
 * is bullish but a SOLD call is bearish, so a name can be 100% call premium and measurably
 * bearish (measured live 2026-08-23: CG was exactly that, 100% call premium at 100% readable and
 * BEARISH — the real incident `product-adapters.ts::directionFromCallPct`'s own doc comment
 * documents as the P0 this exact pattern already caused once). The authoritative field is
 * `session.direction` (aggressor-aware — bought vs sold), which only `get_helix_tape_analytics`
 * carries (via `directionFields`/`sessionFlowSkew`, helix-tape-analytics.ts). This mirrors
 * `helixContribution` (product-adapters.ts), the already-correct, already-battle-tested reference
 * for this exact rule: prefer `session.direction`, fall back to `directionFromCallPct` ONLY when
 * `direction` is entirely absent (an older/partial shape) — never when it reads "undetermined",
 * which is itself a real "no measurable direction" answer, not an invitation to guess from share.
 */
function extractHelixRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;
  // A genuine read failure (available:false) casts no vote at all — rule 3, missing evidence
  // degrades, never upgrades to a fabricated neutral. Distinct from a quiet-but-real tape below.
  if (result.available === false) return null;

  if (result.empty_reason) {
    return {
      system: "HELIX",
      direction: "neutral",
      strength: 0,
      basis: "No flow detected",
      asOf: result.as_of ?? new Date().toISOString(),
      sessionDate: result.session_date ?? etSessionDate(Date.now()) ?? undefined,
      freshness: "unknown",
    };
  }

  // No `session` block at all (malformed/partial payload) degrades to the same "no measurable
  // direction" neutral the direction==null branch below returns — evidence gaps degrade, they
  // are not excluded from voting entirely (matching extractThermalRead/extractVectorRead's own
  // graceful-degradation posture for an unrecognized shape).
  const session = result.session && typeof result.session === "object" ? result.session : {};

  const callPct = typeof session.call_pct === "number" && Number.isFinite(session.call_pct) ? session.call_pct : null;
  const rawDirection = session.direction;
  const direction: "bullish" | "bearish" | "neutral" | null =
    typeof rawDirection === "string"
      ? rawDirection === "bullish"
        ? "bullish"
        : rawDirection === "bearish"
          ? "bearish"
          : rawDirection === "mixed"
            ? "neutral"
            : null // "undetermined" (or an unrecognized value) — a real "no measurable direction" answer
      : directionFromCallPct(callPct);

  if (direction == null) {
    return {
      system: "HELIX",
      direction: "neutral",
      strength: 0,
      basis: "No measurable call/put direction on the tape",
      asOf: result.as_of ?? new Date().toISOString(),
      sessionDate: result.session_date ?? undefined,
      freshness: "unknown",
    };
  }

  const alertCount = typeof session.alert_count === "number" ? session.alert_count : null;
  // Strength reflects CONFIDENCE in the direction read, not skew magnitude: `direction_readable_pct`
  // is the share of premium whose aggressor side could actually be read, and
  // `direction_minority_evidence` flags a verdict resting on a minority of premium (the tool's own
  // description requires stating that share alongside the direction).
  const readablePct =
    typeof session.direction_readable_pct === "number" ? session.direction_readable_pct : null;
  let strength = readablePct != null ? Math.round(Math.min(100, Math.max(0, readablePct)) / 10) : 5;
  if (session.direction_minority_evidence === true) strength = Math.min(strength, 3);

  const basis =
    callPct != null
      ? `${direction} (${callPct}% call share${alertCount != null ? `, ${alertCount} prints` : ""})`
      : `${direction} (aggressor-read direction, no measurable call share)`;

  return {
    system: "HELIX",
    direction,
    strength: Math.min(Math.max(strength, 0), 10),
    basis,
    asOf: result.as_of ?? new Date().toISOString(),
    sessionDate: result.session_date ?? etSessionDate(Date.now()) ?? undefined,
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
 * Extract directional read from VECTOR full-state (`get_vector_full_state` — see
 * extractConsensusFromTools for why `get_vector_pulse` is no longer fed through this).
 *
 * 2026-09-04 audit finding — FIXED. This used to read `result.structure`/`result.market_structure`
 * (no such top-level field exists on `VectorSnapshot`/`VectorFullState`, vector-play-engine.ts) and
 * `result.bias` at the TOP level (the real field is nested at `result.play.bias`, `VectorPlay.bias`
 * — never top-level), and treated `magnet` as a raw number (`magnet > spotPrice*1.005`) when the
 * real `magnet` field is a `GammaMagnet` OBJECT (`{strike, distancePct, pull, posture, callout}`,
 * vector-gamma-magnet.ts) — an object-vs-number comparison that coerces to `NaN` and is always
 * false even when magnet IS present. So every real call silently fell through to the hardcoded
 * `{strength:5, direction:"neutral", basis:"Structure neutral"}` default, regardless of the play's
 * real posture/magnet.
 *
 * `regime.posture` (dealer gamma posture) is DELIBERATELY not read as direction here — that is the
 * identical anti-pattern this file's own `extractThermalRead` was already fixed for (see its doc
 * comment, PR #2422): dealer gamma is not a directional measurement, short gamma amplifies moves
 * in EITHER direction. The real actionable directional signal on this payload is the derived
 * play's own bias (`VectorPlay.bias`, "long"|"short"|"range"|"neutral") — an ACTUAL trade thesis,
 * not dealer posture. Magnet PULL (`GammaMagnet.pull`, "up"|"down"|"at" — the field's own honest
 * direction indicator) is kept as STRENGTH evidence only, never a direction override, matching how
 * wall proximity is evidence-only for Thermal.
 */
function extractVectorRead(result: any): SystemDirectionalRead | null {
  if (!result || typeof result !== "object") return null;
  // Honest UNAVAILABLE envelope (no live spot / provider failure) casts no vote — rule 3.
  if (result.available === false) return null;

  const bias: "long" | "short" | "range" | "neutral" | null =
    result.play && typeof result.play === "object" ? (result.play.bias ?? null) : null;
  const magnet = result.magnet && typeof result.magnet === "object" ? result.magnet : null;

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let strength = 5;
  let basis = "No actionable Vector play bias";

  if (bias === "long") {
    direction = "bullish";
    strength = 7;
    basis = "Vector play bias: long";
  } else if (bias === "short") {
    direction = "bearish";
    strength = 7;
    basis = "Vector play bias: short";
  } else if (bias === "range") {
    direction = "neutral";
    strength = 5;
    basis = "Vector play bias: range (mean-revert)";
  }

  // Gamma magnet pull — a real directional-pull field (GammaMagnet.pull), used as STRENGTH
  // evidence only, never a direction override (same "evidence, not a vote" posture as Thermal's
  // wall proximity).
  if (magnet?.pull === "up") {
    strength = Math.max(strength, 7);
    basis += "; magnet pulling up";
  } else if (magnet?.pull === "down") {
    strength = Math.max(strength, 7);
    basis += "; magnet pulling down";
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
  //
  // 2026-09-04 audit finding: extractHelixRead now reads ONLY `get_helix_tape_analytics` —
  // the ONE HELIX tool that carries the aggressor-aware `session.direction` field this read is
  // built on. `get_flow_tape` (FlowTapeSummary) and `get_helix_derived` (stacked_hits/top_prints/
  // velocity_spikes/split_flow) carry no comparable directional field at all — feeding either
  // through this extractor is exactly the mismatched-shape bug being fixed here, not a second
  // legitimate read to keep.
  const helixTape = extractHelixRead(toolResults.get_helix_tape_analytics);
  if (helixTape) validReads.push(helixTape);

  const thermalPos = extractThermalRead(toolResults.get_positioning);
  if (thermalPos) validReads.push(thermalPos);
  const thermalGex = extractThermalRead(toolResults.get_gex_heatmap);
  if (thermalGex) validReads.push(thermalGex);

  // 2026-09-04 audit finding: extractVectorRead now reads ONLY `get_vector_full_state` (the
  // snapshot carrying `play.bias`/`magnet`). `get_vector_pulse` returns a DIFFERENTIAL signals
  // log (regime flips, magnet shifts, wall-integrity changes — buildPulseSignalsForState,
  // vector-pulse-brief.ts), a structurally different shape with no `play`/`magnet`/`spot` fields
  // to read — the same mismatched-shape bug, not a second legitimate read to keep.
  const vectorFull = extractVectorRead(toolResults.get_vector_full_state);
  if (vectorFull) validReads.push(vectorFull);

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
