/**
 * Swing Cortex commit preflight (P3) — reuses 0DTE readers until swing horizon lands in fetch.ts.
 *
 * Design §9: evaluateCortexForCommit({ horizon: "SWING", dteWindow: [4, 15] }).
 * Interim: same readers as 0DTE with failClosedOnVetoBlind for multi-day holds.
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
    opts?: { failClosedOnVetoBlind?: boolean },
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
      assessment: assessment ?? { decision: "PASS", abstained: false, reason: "no assessment" },
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
  const assessment = await evaluate(ticker, dir, new Date(nowMs), {}, { failClosedOnVetoBlind: true });
  return swingCortexBlockedByFromAssessment(assessment);
}
