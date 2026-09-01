import type { ContractCandidate, ContractCandidateInput, ExpressionDecision, MergedThesis } from "./types";

const MAX_SPREAD_PCT = 15;
const MIN_OI = 10;

function mid(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && bid > 0 && ask > 0) return (bid + ask) / 2;
  if (ask != null && ask > 0) return ask;
  if (bid != null && bid > 0) return bid;
  return null;
}

function spreadPct(bid: number | null, ask: number | null): number | null {
  const m = mid(bid, ask);
  if (m == null || m <= 0 || bid == null || ask == null || ask <= bid) return null;
  return ((ask - bid) / m) * 100;
}

export type ContractEngineInput = {
  thesis: MergedThesis;
  chain: ContractCandidateInput[];
  spot: number;
  iv_rank_0dte?: number | null;
};

/** Rank contracts across DTE for optimal expression — separate from discovery. */
export function rankContractsForThesis(input: ContractEngineInput): ContractCandidate[] {
  const { thesis, chain, spot, iv_rank_0dte } = input;
  const side: "call" | "put" = thesis.direction === "long" ? "call" : "put";
  const candidates: ContractCandidate[] = [];

  for (const row of chain) {
    if (row.side !== side) continue;
    const bid = row.bid;
    const ask = row.ask;
    const sp = spreadPct(bid, ask);
    if (sp != null && sp > MAX_SPREAD_PCT) continue;
    if (row.oi < MIN_OI && (bid == null || ask == null)) continue;

    let score = 50;
    const reasons: string[] = [];

    if (sp != null) {
      const spreadCredit = Math.max(0, 25 - sp);
      score += spreadCredit;
      reasons.push(`spread ${sp.toFixed(1)}%`);
    }

    if (row.oi >= 100) {
      score += Math.min(15, Math.log10(row.oi) * 5);
      reasons.push(`OI ${row.oi}`);
    }

    if (row.dte === 0 && iv_rank_0dte != null && iv_rank_0dte >= 85) {
      score -= 18;
      reasons.push("0DTE IV rich");
    } else if (row.dte >= 2 && row.dte <= 5 && iv_rank_0dte != null && iv_rank_0dte >= 80) {
      score += 12;
      reasons.push("vol favors 3–5 DTE");
    }

    if (spot > 0) {
      const otm =
        side === "call" ? ((row.strike - spot) / spot) * 100 : ((spot - row.strike) / spot) * 100;
      if (otm >= 0 && otm <= 3) {
        score += 8;
        reasons.push("near ATM");
      } else if (otm > 6) {
        score -= 10;
      }
    }

    if (row.dte >= 0 && row.dte <= 7) score += 4;

    score = Math.max(0, Math.min(100, Math.round(score)));

    candidates.push({
      ...row,
      score,
      spread_pct: sp,
      reasons,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function pickBestExpression(input: ContractEngineInput): ExpressionDecision {
  const ranked = rankContractsForThesis(input);
  if (ranked.length === 0) {
    return {
      horizon: "NONE",
      dte_target: null,
      contract: null,
      contract_score: 0,
      alternatives: [],
      vol_rationale: null,
      rationale: "No liquid contract passed spread/OI floors",
    };
  }

  const best = ranked[0]!;
  const alts = ranked.slice(0, 5);
  const volNote =
    input.iv_rank_0dte != null && best.dte >= 2 && input.iv_rank_0dte >= 80
      ? `0DTE IV rank ${input.iv_rank_0dte} — picked ${best.dte} DTE over front expiry`
      : null;

  return {
    horizon: best.dte <= 4 ? "ZERO_DTE" : "SWING",
    dte_target: best.dte,
    contract: best,
    contract_score: best.score,
    alternatives: alts,
    vol_rationale: volNote,
    rationale: `${best.expiry} ${best.strike}${best.side === "call" ? "C" : "P"} · score ${best.score}`,
  };
}

/** Convert breakout chain rows to contract engine inputs for one side. */
export function chainRowsToCandidates(
  rows: Array<{
    expiry: string;
    strike: number;
    dte: number;
    call_bid: number | null;
    call_ask: number | null;
    call_oi: number;
    put_bid: number | null;
    put_ask: number | null;
    put_oi: number;
  }>,
  side: "call" | "put"
): ContractCandidateInput[] {
  return rows.map((r) => ({
    expiry: r.expiry,
    strike: r.strike,
    dte: r.dte,
    side,
    bid: side === "call" ? r.call_bid : r.put_bid,
    ask: side === "call" ? r.call_ask : r.put_ask,
    oi: side === "call" ? r.call_oi : r.put_oi,
  }));
}
