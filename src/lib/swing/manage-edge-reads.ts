// src/lib/swing/manage-edge-reads.ts — live management edge reads for held swing positions (deep-dive Q16).
//
// WHY: manage.ts consumes `thesisBroken`, `catalystShift`, `regimeShift`, `flowDecayed`, and
// `relStrengthLost`, but active-refresh never populated them — rungs #2/#5/#6/#8/#9 were permanently dark.
// This module is the PURE derivation: compare commit-pinned pillar evidence (feature_vector) to fresh
// live reads (when available) plus thesis-progress stagnation proxies. NULL-HONEST: every field stays
// null when its inputs are too thin to evaluate — never a fabricated signal.

import type { SwingArchetype } from "./taxonomy";
import { relStrengthSignal } from "./swing-pillars";
import { regimeFromSpyTrend, pctReturnOverSessions, SWING_RETURN_LOOKBACK_SESSIONS } from "./swing-ingest";

const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

/** Commit-time pillar sub-scores echoed on every snapshot (0–1 each; null when absent). */
export interface ManageEdgeCommitPillars {
  flow?: number | null;
  relStrength?: number | null;
  catalyst?: number | null;
  regime?: number | null;
}

/** Fresh pillar recompute from daily bars (flow omitted — no live accumulation in the refresh path). */
export interface ManageEdgeLivePillars {
  relStrength?: number | null;
  regime?: number | null;
}

export interface ManageEdgeReadsInput {
  archetype?: SwingArchetype | string | null;
  direction: "long" | "short";
  sessionsHeld?: number | null;
  thesisProgress01?: number | null;
  commit?: ManageEdgeCommitPillars | null;
  live?: ManageEdgeLivePillars | null;
}

export interface ManageEdgeReads {
  thesisBroken?: boolean | null;
  thesisBreakReason?: string;
  catalystShift?: boolean | null;
  regimeShift?: boolean | null;
  flowDecayed?: boolean | null;
  relStrengthLost?: boolean | null;
}

const STRONG_PILLAR = 0.55;
const WEAK_PILLAR = 0.35;
const FLOW_DECAY_DROP = 0.2;
const STAGNANT_PROGRESS = 0.25;

/** Rehydrate commit pillars from the position's pinned feature_vector. */
export function commitPillarsFromFeatureVector(
  pinned: Record<string, unknown> | null | undefined,
): ManageEdgeCommitPillars | null {
  if (!pinned || typeof pinned !== "object") return null;
  const num = (k: string): number | null => {
    const v = pinned[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const pillars: ManageEdgeCommitPillars = {
    flow: num("pil_flow"),
    relStrength: num("pil_rel_strength"),
    catalyst: num("pil_catalyst"),
    regime: num("pil_regime"),
  };
  return Object.values(pillars).some((v) => v != null) ? pillars : null;
}

/** Recompute regime + rel-strength pillars from fresh daily closes (SPY fetched once per cron tick). */
export function liveManageEdgePillars(args: {
  nameCloses: number[];
  spyCloses: number[];
  direction: "long" | "short";
}): ManageEdgeLivePillars {
  const playDir = args.direction === "short" ? "SHORT" : "LONG";
  const nameReturn = pctReturnOverSessions(args.nameCloses, SWING_RETURN_LOOKBACK_SESSIONS);
  const spyReturn = pctReturnOverSessions(args.spyCloses, SWING_RETURN_LOOKBACK_SESSIONS);
  return {
    relStrength: relStrengthSignal({ nameReturnPct: nameReturn, spyReturnPct: spyReturn }),
    regime: regimeFromSpyTrend(args.spyCloses, playDir),
  };
}

function isEventArchetype(archetype: string | null | undefined): boolean {
  return archetype === "EVENT_DRIVEN" || archetype === "POST_EARNINGS_DRIFT";
}

/**
 * Derive the management edge reads for one held position. Pure + deterministic.
 * Returns honest nulls when inputs are too thin — manage.ts skips those rungs.
 */
export function deriveManageEdgeReads(input: ManageEdgeReadsInput): ManageEdgeReads {
  const arch = input.archetype ?? null;
  const sessions = numOrNull(input.sessionsHeld);
  const progress = numOrNull(input.thesisProgress01);
  const commit = input.commit ?? null;
  const live = input.live ?? null;

  const out: ManageEdgeReads = {};

  // ── flow_decay (#8): seeded on a strong FLOW pillar that has stalled ──
  const commitFlow = numOrNull(commit?.flow);
  if (commitFlow != null && commitFlow >= STRONG_PILLAR && sessions != null && progress != null) {
    out.flowDecayed = sessions >= 3 && progress < STAGNANT_PROGRESS;
  }

  // ── rel_strength_loss (#9): leadership faded vs commit baseline ──
  const commitRs = numOrNull(commit?.relStrength);
  const liveRs = numOrNull(live?.relStrength);
  if (commitRs != null && commitRs >= STRONG_PILLAR) {
    if (liveRs != null) {
      out.relStrengthLost = liveRs < WEAK_PILLAR || liveRs < commitRs - FLOW_DECAY_DROP;
    } else if (sessions != null && progress != null && sessions >= 4 && progress < STAGNANT_PROGRESS) {
      out.relStrengthLost = true;
    }
  }

  // ── regime_shift (#6): broad tape flipped against the thesis ──
  const commitRegime = numOrNull(commit?.regime);
  const liveRegime = numOrNull(live?.regime);
  if (commitRegime != null && commitRegime >= STRONG_PILLAR && liveRegime != null) {
    out.regimeShift = liveRegime < WEAK_PILLAR;
  }

  // ── catalyst_shift (#5): event thesis failed to follow through ──
  const commitCat = numOrNull(commit?.catalyst);
  if (isEventArchetype(arch) && commitCat != null && commitCat >= STRONG_PILLAR && sessions != null && progress != null) {
    out.catalystShift = sessions >= 2 && progress < 0.15;
  }

  // ── thesis_stop (#2): archetype-specific invalidation ──
  if (arch === "POST_EARNINGS_DRIFT" && sessions != null && progress != null) {
    if (sessions >= 5 && progress < 0.15) {
      out.thesisBroken = true;
      out.thesisBreakReason = "post-earnings drift failed to materialize — exit, not roll";
    }
  } else if (arch === "EVENT_DRIVEN" && sessions != null && progress != null && commitCat != null && commitCat >= STRONG_PILLAR) {
    if (sessions >= 4 && progress < 0.1) {
      out.thesisBroken = true;
      out.thesisBreakReason = "event catalyst did not follow through — exit, not roll";
    }
  } else if (arch === "FLOW_ACCUMULATION" && out.flowDecayed === true && progress != null && progress < 0.2) {
    out.thesisBroken = true;
    out.thesisBreakReason = "accumulation flow decayed with stalled thesis — exit, not roll";
  } else if (arch === "FAILED_BREAKDOWN" && sessions != null && progress != null && sessions >= 3 && progress < 0) {
    out.thesisBroken = true;
    out.thesisBreakReason = "failed-breakdown reclaim stalled negative — exit, not roll";
  }

  return out;
}
