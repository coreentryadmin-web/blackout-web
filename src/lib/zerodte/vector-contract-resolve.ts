/**
 * Vector ↔ 0DTE contract attach — resolve the OCC/strike for a setup from Vector pulse
 * (fast path) or ranked Vector play candidates (multi-strike search when pulse lacks OCC).
 */
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import { rankVectorPlayCandidates } from "@/features/vector/lib/vector-play-candidates";
import { vectorPickOcc } from "@/features/vector/lib/vector-pick-occ";
import { buildOcc } from "@/lib/ws/options-socket";
import type { EnrichedZeroDteSetup } from "./board";
import { vectorPulseAlignsDirection } from "./vector-commit-boost";
import type { ZeroDteVectorPulse } from "./vector-crosslink";

export type VectorContractAttachSource = "vector_pulse" | "vector_rank" | "discovery";

export type VectorContractAttach = {
  occ: string;
  strike: number;
  source: VectorContractAttachSource;
};

/** When true, attachContractPlans may fetch chains and rank Vector candidates for FLOW/BREAKOUT. */
export function vectorRankContractsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ZERODTE_VECTOR_RANK_CONTRACTS?.trim();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return true;
}

function eligibleForVectorAttach(s: EnrichedZeroDteSetup, pulse: ZeroDteVectorPulse | null): boolean {
  if (!pulse || !vectorPulseAlignsDirection(s.direction, pulse)) return false;
  if (!pulse.is_winner && !pulse.is_runner) return false;
  const origin = s.discovery_origin ?? [];
  return origin.includes("FLOW") || origin.includes("BREAKOUT");
}

/** Fast path — attach from Vector pulse when OCC + strike are present. */
export function resolveVectorPulseContract(
  s: EnrichedZeroDteSetup,
  pulse: ZeroDteVectorPulse | null
): VectorContractAttach | null {
  if (!eligibleForVectorAttach(s, pulse) || !pulse?.occ || pulse.strike == null) return null;
  return { occ: pulse.occ, strike: pulse.strike, source: "vector_pulse" };
}

function syntheticVectorPlay(s: EnrichedZeroDteSetup): VectorPlay {
  const bias = s.direction === "long" ? "long" : "short";
  const score = Math.min(100, Math.max(55, Math.round(s.score)));
  return {
    style: "scalp",
    bias,
    setup: bias === "long" ? "momentum-long" : "momentum-short",
    conviction: score,
    grade: score >= 80 ? "A" : score >= 70 ? "B" : "C",
    headline: `${bias} 0DTE momentum`,
    thesis: "Vector-ranked contract attach for Night Hawk 0DTE",
    targets: [],
    starred: [],
  };
}

/**
 * Rank Vector play candidates on a fetched chain and return the best 0DTE-aligned pick.
 * Best-effort — null when chain missing or nothing clears the rank bar.
 */
export function rankVectorContractOnChain(
  s: EnrichedZeroDteSetup,
  pulse: ZeroDteVectorPulse | null,
  chain: { spot: number; rows: ChainStrikeRow[] } | null
): VectorContractAttach | null {
  if (!eligibleForVectorAttach(s, pulse) || !chain || !(chain.spot > 0)) return null;
  const picks = rankVectorPlayCandidates(
    { play: syntheticVectorPlay(s), spot: chain.spot },
    chain,
    s.ticker,
    { limit: 3 }
  );
  const side = s.direction === "long" ? "call" : "put";
  const aligned =
    picks.find((p) => p.side === side && p.dte <= 1) ??
    picks.find((p) => p.side === side) ??
    picks[0] ??
    null;
  if (!aligned) return null;
  const occ =
    aligned.occ ??
    vectorPickOcc(s.ticker, aligned.expiry, aligned.side, aligned.strike) ??
    null;
  if (!occ || !(aligned.strike > 0)) return null;
  return { occ, strike: aligned.strike, source: "vector_rank" };
}

/** Discovery fallback — build OCC from setup strike/expiry. */
export function discoveryContractOcc(s: EnrichedZeroDteSetup): VectorContractAttach | null {
  if (s.top_strike == null) return null;
  const occ = buildOcc(s.ticker, s.expiry, s.direction === "long" ? "call" : "put", s.top_strike);
  if (!occ) return null;
  return { occ, strike: s.top_strike, source: "discovery" };
}

/**
 * Resolve the contract to attach for one setup: pulse → rank → discovery.
 * `chain` is optional; when omitted and rank is enabled, caller should batch-fetch chains first.
 */
export function resolveZeroDteContractAttach(
  s: EnrichedZeroDteSetup,
  pulse: ZeroDteVectorPulse | null,
  chain: { spot: number; rows: ChainStrikeRow[] } | null
): VectorContractAttach | null {
  return (
    resolveVectorPulseContract(s, pulse) ??
    rankVectorContractOnChain(s, pulse, chain) ??
    discoveryContractOcc(s)
  );
}

/** Batch-fetch chains for setups that need Vector rank (no pulse OCC). */
export async function fetchChainsForVectorRank(
  setups: EnrichedZeroDteSetup[],
  vectorPulseByTicker: Record<string, ZeroDteVectorPulse>
): Promise<Map<string, { spot: number; rows: ChainStrikeRow[] }>> {
  const out = new Map<string, { spot: number; rows: ChainStrikeRow[] }>();
  const tickers = new Set<string>();
  for (const s of setups) {
    if (s.play_type === "CONDOR") continue;
    const pulse = vectorPulseByTicker[s.ticker.toUpperCase()] ?? null;
    if (resolveVectorPulseContract(s, pulse)) continue;
    if (!eligibleForVectorAttach(s, pulse)) continue;
    tickers.add(s.ticker.toUpperCase());
  }
  await Promise.all(
    [...tickers].map(async (tk) => {
      const chain = await resolveTickerChainRows(tk).catch(() => null);
      if (chain) out.set(tk, chain);
    })
  );
  return out;
}
