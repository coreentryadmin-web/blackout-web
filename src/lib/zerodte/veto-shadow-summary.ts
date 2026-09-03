/**
 * Cortex veto shadow calibration — live read of gate-blocked names Vector tracked positively.
 * Does NOT change commits; surfaces calibration signal on the member board.
 */
import type { DiscoveryFunnelHint } from "./discovery-funnel-hint";
import type { ZeroDteSessionBoardStats } from "./session-board-stats";
import type { ZeroDteVectorNearMiss } from "./vector-near-miss";

export type VetoShadowSummary = {
  /** Gate-blocked candidates this scan cycle. */
  gate_blocked_scan: number;
  /** Distinct cortex-family blocks in today's funnel sample. */
  cortex_blocks_funnel: number;
  /** Near-misses where Vector tagged winner (+50%). */
  vector_winner_misses: number;
  /** Near-misses in Vector runner band (+15–49%). */
  vector_runner_misses: number;
  /** Top cortex gate code from funnel (if any). */
  top_cortex_gate: string | null;
  /** One-liner for the strip. */
  summary: string | null;
};

const CORTEX_GATE_PREFIXES = ["cortex_", "cortex_veto"];

function isCortexGate(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toLowerCase();
  return CORTEX_GATE_PREFIXES.some((p) => c.startsWith(p)) || c.includes("gex_walls");
}

/** Pure summary from board-local reads (no extra DB round trip). */
export function buildVetoShadowSummary(
  nearMisses: readonly ZeroDteVectorNearMiss[],
  funnel: DiscoveryFunnelHint | null | undefined,
  sessionStats: ZeroDteSessionBoardStats | null | undefined
): VetoShadowSummary | null {
  if (!sessionStats || sessionStats.scanned === 0) return null;
  const winnerMisses = nearMisses.filter((m) => m.vector_band === "winner");
  const runnerMisses = nearMisses.filter((m) => m.vector_band === "runner");
  const cortexFunnel =
    funnel?.top_gate && isCortexGate(funnel.top_gate) ? funnel.top_gate_n : 0;
  const topCortex =
    funnel?.top_gate && isCortexGate(funnel.top_gate) ? funnel.top_gate : null;

  let summary: string | null = null;
  if (winnerMisses.length > 0) {
    summary = `${winnerMisses.length} Vector winner${winnerMisses.length === 1 ? "" : "s"} gate-blocked today`;
  } else if (runnerMisses.length > 0) {
    summary = `${runnerMisses.length} Vector runner${runnerMisses.length === 1 ? "" : "s"} blocked — watch calibration`;
  } else if (cortexFunnel > 0 && topCortex) {
    summary = `Cortex vetoes leading funnel (${cortexFunnel}× ${funnel?.top_gate_label ?? topCortex})`;
  } else if (sessionStats.gate_blocked > 0) {
    summary = `${sessionStats.gate_blocked} blocked · ${sessionStats.commit_ready} ready to commit`;
  }

  return {
    gate_blocked_scan: sessionStats.gate_blocked,
    cortex_blocks_funnel: cortexFunnel,
    vector_winner_misses: winnerMisses.length,
    vector_runner_misses: runnerMisses.length,
    top_cortex_gate: topCortex,
    summary,
  };
}
