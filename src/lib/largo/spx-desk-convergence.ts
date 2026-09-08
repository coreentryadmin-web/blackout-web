/**
 * SPX desk convergence — Vector suggested play vs Slayer execution in one read.
 * Mirrors the SpxVectorPlayRail on /dashboard without requiring two tool calls.
 */
import { sanitizeSpxPlayPayloadForLargo } from "@/lib/largo/spx-confidence-boundary";
import { gateRulesForLargo } from "@/lib/largo/gate-rules";
import { vectorFullStateForLargo } from "@/lib/largo/product-reads";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import {
  computeDeskAlignment,
  slayerSuggestedBias,
  vectorSuggestedBias,
} from "@/lib/largo/spx-desk-convergence-core";
import { spxMatrixUiStateForLargo } from "@/lib/largo/spx-matrix-ui-for-largo";
import { deskConvergenceLaneFreshness } from "@/lib/largo/spx-desk-convergence-lane-freshness";

export type { DeskAlignment, DeskPlayBias } from "@/lib/largo/spx-desk-convergence-core";
export { computeDeskAlignment, slayerSuggestedBias, vectorSuggestedBias } from "@/lib/largo/spx-desk-convergence-core";

function summarizeVector(vector: Awaited<ReturnType<typeof vectorFullStateForLargo>>) {
  if (!vector || (vector as { available?: boolean }).available === false) {
    const v = vector as { available?: false; reason?: string; ticker?: string | null };
    return {
      available: false as const,
      reason: v?.reason ?? "no_live_vector_state",
      ticker: v?.ticker ?? "SPX",
    };
  }
  const v = vector as VectorFullState;
  const play = v.play;
  return {
    available: true as const,
    spot: v.spot,
    regime: v.regime?.posture ?? null,
    gamma_flip: v.gammaFlip,
    call_wall: v.gexWalls?.callWalls?.[0]?.strike ?? null,
    put_wall: v.gexWalls?.putWalls?.[0]?.strike ?? null,
    suggested_play: play
      ? {
          bias: play.bias,
          setup: play.setup,
          grade: play.grade,
          conviction: play.conviction,
          headline: play.headline,
        }
      : null,
    as_of: v.asOf,
  };
}

function summarizeSlayer(play: SpxPlayPayload | null) {
  if (!play?.available) {
    return { available: false as const, note: "SPX play engine unavailable" };
  }
  return {
    available: true as const,
    phase: play.phase,
    action: play.action,
    direction: play.direction,
    grade: play.grade,
    score: play.score,
    headline: play.headline,
    gates_passed: play.gates?.passed ?? null,
    gate_blocks: play.gates?.blocks?.slice(0, 6) ?? [],
    signal_committed: play.signal_committed ?? false,
    open_play: play.open_play
      ? {
          direction: play.open_play.direction,
          entry_price: play.open_play.entry_price,
          stop: play.open_play.stop,
          target: play.open_play.target,
        }
      : null,
    session_phase: play.session_phase ?? null,
  };
}

export async function spxDeskConvergenceForLargo() {
  const { marketPlatform } = await import("@/lib/platform");
  const { fetchGexHeatmap } = await import("@/lib/providers/polygon-options-gex");
  const { loadMergedSpxDesk } = await import("@/features/spx/lib/spx-desk-loader");
  const [rawPlay, vector, gate_rules, heatmap, deskBundle] = await Promise.all([
    marketPlatform.spx.getSpxPlayState(),
    vectorFullStateForLargo("SPX"),
    gateRulesForLargo(),
    fetchGexHeatmap("SPX").catch(() => null),
    loadMergedSpxDesk().catch(() => null),
  ]);
  const slayerPlay = sanitizeSpxPlayPayloadForLargo(rawPlay) as SpxPlayPayload | null;
  const slayerBias = slayerSuggestedBias(slayerPlay);
  const vectorBias =
    vector && (vector as { available?: boolean }).available !== false
      ? vectorSuggestedBias(vector as VectorFullState)
      : vectorSuggestedBias(null);
  const alignment = computeDeskAlignment(slayerBias, vectorBias);

  return {
    as_of: new Date().toISOString(),
    as_of_et: etStamp(Date.now()),
    alignment,
    slayer_bias: slayerBias,
    vector_bias: vectorBias,
    narrative:
      alignment === "aligned"
        ? "Vector suggested play and Slayer execution agree on direction."
        : alignment === "divergent"
          ? "Vector and Slayer point opposite ways — cite both and say which layer is execution (Slayer commits)."
          : alignment === "vector_leads"
            ? "Vector has a directional idea while Slayer is flat/scanning — suggested play only, not a desk commit."
            : alignment === "slayer_leads"
              ? "Slayer has posture or an open play while Vector is neutral/stand-aside."
              : "Both layers are flat or neutral.",
    vector: summarizeVector(vector),
    slayer: summarizeSlayer(slayerPlay),
    gate_rules,
    matrix_ui: spxMatrixUiStateForLargo(heatmap),
    lane_freshness: deskBundle ? deskConvergenceLaneFreshness(deskBundle) : null,
  };
}
