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

/** G-S14 token when Cortex preflight throws or returns an unrecoverable error. */
export const SWING_CORTEX_UNAVAILABLE_TOKEN = "gate:G-S14:cortex_unavailable";

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

/** Build a fail-closed block when Cortex preflight cannot complete. */
export function swingCortexUnavailableResult(reason: string): SwingCortexPreflightResult {
  return {
    blocked: true,
    blockedBy: [SWING_CORTEX_UNAVAILABLE_TOKEN],
    reason,
    assessment: { decision: "ABSTAIN", abstained: true, reason },
  };
}

/** Async preflight for one swing commit candidate. Fail-closed on thrown errors (Q29). */
export async function evaluateSwingCortexForCommit(
  ticker: string,
  direction: PlayDirection,
  nowMs: number,
  deps: SwingCortexPreflightDeps = {},
): Promise<SwingCortexPreflightResult> {
  const dir = direction === "LONG" ? "long" : "short";
  const evaluate = deps.evaluate ?? evaluateCortexForCommit;
  try {
    const assessment = await evaluate(
      ticker,
      dir,
      new Date(nowMs),
      {},
      { failClosedOnVetoBlind: true, horizon: "swing" },
    );
    return swingCortexBlockedByFromAssessment(assessment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return swingCortexUnavailableResult(`Cortex preflight error — commit blocked (G-S14 fail-closed): ${msg}`);
  }
}
