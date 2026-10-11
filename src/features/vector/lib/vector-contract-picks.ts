/**
 * VECTOR CONTRACT PICKS — public types + entry for the ranked 1–3 system.
 * Use `rankVectorPlayCandidates` with full `VectorPlayPickContext`.
 */
import type { EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import {
  rankVectorPlayCandidates,
  VECTOR_CANDIDATE_POOL_SIZE,
  type RankVectorPlayCandidatesOptions,
  type VectorPlayPickContext,
  type VectorRankedPick,
} from "./vector-play-candidates";

export type VectorContractPick = {
  side: "call" | "put";
  strike: number;
  expiry: string;
  label: string;
  premium: number;
  /** 0–100 — always `play.conviction`; rank/reasons differentiate picks, not a second score. */
  confidence: number;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
  /** Evidence for rank order — not a second confidence model. */
  reasons?: string[];
  role?: string;
  rank?: number;
  dte?: number;
  evidence?: import("./vector-pick-evidence").VectorPickEvidenceSection[];
  occ?: string | null;
  entryMid?: number;
  entryBid?: number | null;
  entryAsk?: number | null;
  liveBid?: number | null;
  liveAsk?: number | null;
  liveMid?: number | null;
  liveDelta?: number | null;
  liveGamma?: number | null;
  liveTheta?: number | null;
  liveIv?: number | null;
  actionStatus?: "still_buy" | "caution" | "dont_buy";
  actionReason?: string;
  premiumPctFromEntry?: number | null;
  setupInvalidated?: boolean;
  /** Elite whale / A-grade wall pins — surfaced in PLYS + Night Hawk winners board. */
  tier?: "elite" | "standard";
};

export type { VectorPlayPickContext, VectorRankedPick };

/** Primary entry — ranks strong picks with per-contract scoring. */
export function buildRankedVectorPicks(
  ctx: VectorPlayPickContext | null,
  chain: EditionChainData | null,
  ticker = "",
  options?: RankVectorPlayCandidatesOptions
): VectorRankedPick[] {
  return rankVectorPlayCandidates(ctx, chain, ticker, options);
}

export { VECTOR_CANDIDATE_POOL_SIZE, type RankVectorPlayCandidatesOptions };
