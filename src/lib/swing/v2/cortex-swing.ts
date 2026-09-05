/**
 * Swing Cortex commit preflight (P3) — swing horizon via fetch.ts (monthly Vector grid).
 *
 * Design §9: evaluateCortexForCommit({ horizon: "swing", dteWindow: [5, 15] }).
 * Vector scope maps to "monthly" (≤35 DTE) so the 5–15 DTE window is fully covered.
 */

import type { PlayDirection } from "@/lib/horizon-fanout";
import {
  cortexGateBlocks,
  evaluateCortexForCommit,
  type CortexCommitDeps,
  type ZeroDteCortexAssessment,
} from "@/lib/zerodte/cortex-gate";

export interface SwingCortexPreflightResult {
  blocked: boolean;
  blockedBy: string[];
  reason: string;
  assessment: ZeroDteCortexAssessment;
}

export interface SwingCortexPreflightDeps {
  evaluate?: (
    ticker: string,
    direction: "long" | "short",
    now: Date,
    deps?: CortexCommitDeps,
    opts?: { failClosedOnVetoBlind?: boolean; horizon?: "swing" },
  ) => Promise<ZeroDteCortexAssessment>;
}

/** Map Cortex blocks to swing G-S14 commit tokens. */
export function swingCortexBlockedByFromAssessment(
  assessment: ZeroDteCortexAssessment | null,
): SwingCortexPreflightResult {
  const blocks = cortexGateBlocks(assessment);
  if (blocks.length === 0) {
    return {
      blocked: false,
      blockedBy: [],
      reason: "",
      assessment:
        assessment ?? { decision: "ABSTAIN", abstained: true, reason: "no cortex assessment" },
    };
  }
  const blockedBy = blocks.map((b) => `gate:G-S14:${b.code}`);
  const reason = blocks.map((b) => b.reason).join(" | ");
  return {
    blocked: true,
    blockedBy,
    reason,
    assessment: assessment!,
  };
}

/** Async preflight for one swing commit candidate. Fail-soft: errors → ABSTAIN (no block). */
export async function evaluateSwingCortexForCommit(
  ticker: string,
  direction: PlayDirection,
  nowMs: number,
  deps: SwingCortexPreflightDeps = {},
): Promise<SwingCortexPreflightResult> {
  const dir = direction === "LONG" ? "long" : "short";
  const evaluate = deps.evaluate ?? evaluateCortexForCommit;
  const assessment = await evaluate(
    ticker,
    dir,
    new Date(nowMs),
    {},
    { failClosedOnVetoBlind: true, horizon: "swing" },
  );
  return swingCortexBlockedByFromAssessment(assessment);
}
