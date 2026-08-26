/**
 * VECTOR CONTRACT PICKS — public types + legacy entry for callers that only have bias/conviction.
 * Prefer `rankVectorPlayCandidates` with full `VectorPlayPickContext` for the ranked 1–3 system.
 */
import type { EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import type { VectorPlayBias } from "./vector-play-engine";
import type { VectorDteHorizon } from "./vector-dte-horizon";
import {
  rankVectorPlayCandidates,
  type VectorPlayPickContext,
  type VectorRankedPick,
} from "./vector-play-candidates";

export type VectorContractPick = {
  side: "call" | "put";
  strike: number;
  expiry: string;
  label: string;
  premium: number;
  /** Per-pick score 0–100 (not a copy of the whole play conviction when multiple legs rank). */
  confidence: number;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
  /** Evidence bullets shown in the detail drawer. */
  reasons?: string[];
  /** Candidate role: primary-long, fade-dip, flow-whale, etc. */
  role?: string;
  rank?: number;
  dte?: number;
};

export type { VectorPlayPickContext, VectorRankedPick };

/**
 * @deprecated Range bias used to emit call+put at the SAME conviction — use `rankVectorPlayCandidates`.
 * Kept for minimal GET callers; maps to a single-direction stub only.
 */
export function legsForBias(bias: VectorPlayBias): Array<"long" | "short"> {
  if (bias === "long") return ["long"];
  if (bias === "short") return ["short"];
  return [];
}

/** Primary entry — ranks 1–3 strong picks with per-contract scoring. */
export function buildRankedVectorPicks(
  ctx: VectorPlayPickContext | null,
  chain: EditionChainData | null
): VectorRankedPick[] {
  return rankVectorPlayCandidates(ctx, chain);
}

/** Legacy shim: bias-only input → ranked picks with synthetic play shell. */
export function buildVectorContractPicks(
  play: { bias: VectorPlayBias; conviction: number; style?: "scalp" | "swing" | "position"; grade?: "A" | "B" | "C"; headline?: string; thesis?: string; entryZone?: string; targets?: string[] } | null,
  chain: EditionChainData | null,
  _horizon: VectorDteHorizon
): VectorContractPick[] {
  if (!play || !chain || play.bias === "neutral") return [];
  const spot = chain.spot;
  if (!(spot > 0)) return [];

  const ctx: VectorPlayPickContext = {
    play: {
      style: play.style ?? "swing",
      bias: play.bias,
      conviction: play.conviction,
      grade: play.grade ?? "B",
      headline: play.headline ?? `${play.bias} setup`,
      thesis: play.thesis ?? "",
      entryZone: play.entryZone,
      targets: play.targets ?? [],
      starred: [],
    },
    spot,
    callWall: null,
    putWall: null,
    magnetStrike: null,
    platformInputs: null,
  };

  return rankVectorPlayCandidates(ctx, chain);
}
