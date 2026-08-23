/**
 * DESK READ DECISION FRAMEWORK — evaluates PLAY vs WAIT vs NO_TRADE conditions.
 *
 * This is the core trader decision layer: given evidence from all systems, what's the
 * RIGHT CALL? Not the model's guess, but an evaluation of whether conditions favor
 * entry, waiting, or standing aside.
 *
 * The framework:
 * 1. Evaluates consensus strength and agreement
 * 2. Checks structural support (walls, levels, technicals)
 * 3. Detects regime alignment (is the play WITH or AGAINST the market?)
 * 4. Surfaces missing evidence (which systems were NOT consulted?)
 * 5. Returns condition + trigger + invalidation
 *
 * CRITICAL: This does NOT invent conviction. If evidence is insufficient, that's what
 * NO_TRADE means — not a rejection, but an honest "we can't see enough to commit."
 */

import type { ConsensusMatrix, SystemDirectionalRead } from "@/lib/largo/consensus-read-extract";

export type DeskReadState = "PLAY" | "WAIT" | "NO_TRADE";

export type DeskReadDecision = {
  state: DeskReadState;
  ticker: string;
  /** One-line summary of the decision. */
  headline: string;
  /** The market condition that creates this decision. */
  thesis: string;
  /** What condition must be met to act. */
  trigger?: string;
  /** What invalidates this decision. */
  invalidation?: string;
  /** Why this state was chosen (for transparency). */
  reasoning: string;
  /** Which systems have strong opinions. */
  strongOpinions: string[];
  /** Which systems conflict or have no opinion. */
  weakOpinions: string[];
  /** Evidence gaps that would strengthen confidence. */
  missingEvidence?: string[];
  /** Confidence that this decision is sound (0-1). */
  confidence: number;
};

export type DecisionContext = {
  /** Multi-system consensus matrix. */
  consensus: ConsensusMatrix;
  /** Price levels (floor, gate, king). */
  levels?: { floor: number; gate: number; king: number };
  /** What levels are SUPPORTED by evidence (walls, volume, technicals). */
  levelSupport?: Record<string, string>; // e.g., { "gate": "call wall" }
  /** Current market regime (bullish tape, negative gamma, uptrend). */
  regime?: string;
  /** Whether this play is WITH or AGAINST the regime. */
  regimeAlignment?: "aligned" | "counter" | "neutral";
  /** Flow character (which tickers are accumulating). */
  tapeBias?: "bullish" | "bearish" | "mixed";
  /** Current spot price. */
  spot?: number;
  /** Whether this is a high-impact event day (earnings, macro). */
  isEventDay?: boolean;
};

/**
 * Evaluate whether conditions merit action.
 *
 * PLAY: Strong consensus (≥3 systems bullish), structural support, regime aligned
 * WAIT: Mixed signals but one clear trigger (wait for gate, wait for confluence, wait for flow)
 * NO_TRADE: Insufficient evidence, strong conflict, missing data, or counter-regime
 */
export function evaluateDeskRead(context: DecisionContext, ticker: string): DeskReadDecision {
  const { consensus, levels, regime, regimeAlignment, tapeBias, spot, isEventDay } = context;

  // Short-circuit: no data
  if (consensus.reads.length === 0) {
    return {
      state: "NO_TRADE",
      ticker,
      headline: "Insufficient data",
      thesis: "No product systems consulted",
      reasoning: "Cannot evaluate without market reads",
      strongOpinions: [],
      weakOpinions: [],
      missingEvidence: ["All major systems needed"],
      confidence: 0,
    };
  }

  // Extract strong vs weak opinions
  const strongSystems = consensus.reads.filter((r) => r.strength >= 7).map((r) => r.system);
  const weakSystems = consensus.reads.filter((r) => r.strength < 5).map((r) => r.system);

  // Assess consensus quality
  const isConflicted = consensus.agreement.verdict === "conflicted";
  const consensusStrength = consensus.agreement.averageStrength;
  const bullishVote = consensus.agreement.bullish;
  const bearishVote = consensus.agreement.bearish;
  const neutralVote = consensus.agreement.neutral;
  const totalVotes = consensus.agreement.voting;

  // ── PLAY Conditions ──
  // Strong consensus + structural support + regime aligned
  if (!isConflicted && bullishVote >= 3 && bullishVote > bearishVote && consensusStrength >= 7) {
    // Further validate with structural support
    const hasLevelSupport = levels && spot ? validateLevelSupport(context, "bullish") : false;
    const isRegimeAligned = regimeAlignment !== "counter";

    if ((hasLevelSupport || !levels) && isRegimeAligned) {
      return {
        state: "PLAY",
        ticker,
        headline: `🟢 ${ticker} — PLAY`,
        thesis: `${bullishVote}-system consensus bullish${consensusStrength >= 9 ? " (strong)" : ""}`,
        trigger: levels ? `Break and hold above ${levels.gate}` : "Continuation of bullish flow",
        invalidation: levels ? `Close below ${levels.floor}` : "Reversal of consensus",
        reasoning: buildPlayReasoning(consensus, strongSystems),
        strongOpinions: strongSystems,
        weakOpinions: weakSystems,
        confidence: Math.min(0.9, consensusStrength / 10),
      };
    }
  }

  // ── WAIT Conditions ──
  // Mixed signals but one clear condition resolves it
  if ((isConflicted || (bullishVote <= 2 && bearishVote <= 2)) && levels) {
    // "Wait for gate" — consensus is unclear, but if it breaks a level, thesis is proven
    const clearer = findClearingCondition(context);
    if (clearer) {
      return {
        state: "WAIT",
        ticker,
        headline: `🟡 ${ticker} — WAIT`,
        thesis: `Mixed signals until ${clearer.condition} resolves`,
        trigger: clearer.trigger,
        invalidation: clearer.invalidation,
        reasoning: buildWaitReasoning(consensus, clearer),
        strongOpinions: strongSystems,
        weakOpinions: weakSystems,
        missingEvidence: identifyMissingEvidence(consensus),
        confidence: 0.4,
      };
    }
  }

  // ── NO_TRADE Conditions ──
  // Default: insufficient evidence, strong conflict, or counter-regime
  const reasons: string[] = [];
  const missing: string[] = [];

  if (isConflicted) {
    reasons.push(`Systems conflict: ${consensus.contradictions.map((c) => c.why).join("; ")}`);
  }

  if (regimeAlignment === "counter") {
    reasons.push("Play is counter-regime (risk of regime reversal)");
  }

  if (consensus.reads.length < 2) {
    missing.push("Need at least 2 product systems");
  }

  if (bullishVote === 0 && bearishVote === 0) {
    reasons.push("All systems neutral — no conviction");
  }

  if (isEventDay && !regimeAlignment) {
    reasons.push("Event day + uncertain regime = stand aside");
  }

  const missingEvidenceList = identifyMissingEvidence(consensus);
  if (missingEvidenceList.length > 0) {
    missing.push(...missingEvidenceList);
  }

  return {
    state: "NO_TRADE",
    ticker,
    headline: `🔴 ${ticker} — NO_TRADE`,
    thesis: reasons.length > 0 ? reasons[0] : "Insufficient conviction",
    reasoning:
      reasons.length > 0
        ? `${reasons.join("; ")}. Wait for clarity.`
        : "Systems do not provide sufficient conviction for entry.",
    strongOpinions: strongSystems,
    weakOpinions: weakSystems,
    missingEvidence: missing,
    confidence: 0.0,
  };
}

function validateLevelSupport(context: DecisionContext, direction: "bullish" | "bearish"): boolean {
  const { levels, consensus, spot } = context;
  if (!levels || !spot) return false;

  // Check if gate level is supported by structural evidence (walls, order flow, technicals)
  const hasWallSupport = consensus.reads.some(
    (r) => r.system === "THERMAL" && r.basis.toLowerCase().includes("wall")
  );
  const hasStructureSupport = consensus.reads.some(
    (r) => r.system === "VECTOR" && r.basis.toLowerCase().includes("structure")
  );
  const hasFlowSupport = consensus.reads.some(
    (r) => r.system === "HELIX" && r.direction === direction && r.strength >= 6
  );

  // At least 2 of 3 supports
  return [hasWallSupport, hasStructureSupport, hasFlowSupport].filter(Boolean).length >= 2;
}

function findClearingCondition(
  context: DecisionContext
): { condition: string; trigger: string; invalidation: string } | null {
  const { levels, consensus, spot } = context;
  if (!levels || !spot) return null;

  // Common wait conditions for options traders:
  // 1. "Wait for gate" — price must reclaim this level
  // 2. "Wait for volume confirmation" — one system bullish, waiting for flow
  // 3. "Wait for regime shift" — bearish but looking for mean reversion

  const closeToGate = Math.abs(spot - levels.gate) < levels.gate * 0.01;
  if (closeToGate) {
    return {
      condition: "price action at gate",
      trigger: `Close above ${levels.gate}`,
      invalidation: `Close below ${levels.floor}`,
    };
  }

  const hasFlowWaiting = consensus.reads.some((r) => r.system === "HELIX" && r.strength <= 4);
  if (hasFlowWaiting) {
    return {
      condition: "flow confirmation",
      trigger: "Bullish prints stack 2:1+",
      invalidation: "Continued put flow",
    };
  }

  return null;
}

function identifyMissingEvidence(consensus: ConsensusMatrix): string[] {
  const missing: string[] = [];
  const systems = new Set(consensus.reads.map((r) => r.system));

  if (!systems.has("HELIX")) missing.push("Flow tape not consulted");
  if (!systems.has("THERMAL")) missing.push("Gamma regime not consulted");
  if (!systems.has("VECTOR")) missing.push("Technical structure not consulted");
  if (!systems.has("NIGHT_HAWK")) missing.push("0DTE board not consulted");

  return missing;
}

function buildPlayReasoning(consensus: ConsensusMatrix, strongSystems: string[]): string {
  const systemNames = strongSystems.map((s) => s.replace(/_/g, " ").toLowerCase());
  const basis = consensus.reads
    .filter((r) => strongSystems.includes(r.system))
    .map((r) => r.basis)
    .join("; ");

  return `${systemNames.join(" + ")} in agreement: ${basis}. Setup is constructive.`;
}

function buildWaitReasoning(
  consensus: ConsensusMatrix,
  clearer: { condition: string; trigger: string; invalidation: string }
): string {
  return `Mixed signals until ${clearer.condition} resolves. If ${clearer.trigger}, thesis confirmed. If ${clearer.invalidation}, stand down.`;
}
