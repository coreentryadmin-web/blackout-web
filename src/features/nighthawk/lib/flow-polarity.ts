/**
 * LEGACY vs SIGNED-AGGRESSION flow polarity.
 *
 * Legacy `scoreFlowQuality` assigns direction by CALL vs PUT weighted premium — a large
 * bid-side put print still counts as SHORT weight. The 0DTE accumulation engine signs by
 * aggression instead (ask-call / bid-put → bullish; ask-put / bid-call → bearish).
 *
 * This module is MEASUREMENT ONLY — it does not change Legacy scoring. Use it to quantify
 * how often the two polarity models disagree before any scorer change.
 */

function tradeSide(r: Record<string, unknown>): "A" | "B" | "M" | null {
  // Mirror scorer.ts flowTradeSide field priority so the probe measures the same inputs.
  const raw = String(r.side ?? r.trade_side ?? r.tag_side ?? "").toUpperCase().trim();
  if (raw === "A" || raw === "ASK" || raw.startsWith("ASK")) return "A";
  if (raw === "B" || raw === "BID" || raw.startsWith("BID")) return "B";
  if (raw === "M" || raw === "MID" || raw.startsWith("MID")) return "M";
  const askPct = Number(r.ask_side_pct);
  if (Number.isFinite(askPct) && askPct >= 60) return "A";
  const bidPct = Number(r.bid_side_pct);
  if (Number.isFinite(bidPct) && bidPct >= 60) return "B";
  const prem = premium(r);
  const askPrem = Number(r.total_ask_side_prem);
  const bidPrem = Number(r.total_bid_side_prem);
  if (prem > 0 && Number.isFinite(askPrem) && askPrem / prem >= 0.6) return "A";
  if (prem > 0 && Number.isFinite(bidPrem) && bidPrem / prem >= 0.6) return "B";
  return null;
}

function premium(r: Record<string, unknown>): number {
  const n = Number(r.total_premium ?? r.premium ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isCall(r: Record<string, unknown>): boolean {
  return String(r.type ?? r.option_type ?? "").toLowerCase().startsWith("c");
}

/** Call/put premium polarity — mirrors Legacy scoreFlowQuality direction (no skew flip). */
export function legacyCallPutDirection(
  flows: Record<string, unknown>[]
): { direction: "long" | "short"; callPrem: number; putPrem: number; margin: number } {
  let callPrem = 0;
  let putPrem = 0;
  for (const r of flows) {
    const prem = premium(r);
    if (prem <= 0) continue;
    if (isCall(r)) callPrem += prem;
    else putPrem += prem;
  }
  const total = callPrem + putPrem;
  const direction: "long" | "short" = callPrem >= putPrem ? "long" : "short";
  const margin = total > 0 ? Math.abs(callPrem - putPrem) / total : 1;
  return { direction, callPrem, putPrem, margin };
}

/**
 * Signed-aggression polarity (0DTE accumulation semantics):
 *   ask-call / bid-put → bullish
 *   ask-put / bid-call → bearish
 * Mid / unknown side is split 50/50 (neither bullish nor bearish credit).
 */
export function signedAggressionDirection(
  flows: Record<string, unknown>[]
): { direction: "long" | "short"; bullishPrem: number; bearishPrem: number; margin: number } {
  let bullishPrem = 0;
  let bearishPrem = 0;
  for (const r of flows) {
    const prem = premium(r);
    if (prem <= 0) continue;
    const call = isCall(r);
    const side = tradeSide(r);
    let askShare = 0.5;
    if (side === "A") askShare = 1;
    else if (side === "B") askShare = 0;
    else {
      const askPct = Number(r.ask_side_pct);
      if (Number.isFinite(askPct) && askPct >= 0 && askPct <= 100) askShare = askPct / 100;
      else {
        const askPrem = Number(r.total_ask_side_prem ?? r.ask_side_premium);
        if (Number.isFinite(askPrem) && askPrem >= 0 && askPrem <= prem) askShare = askPrem / prem;
      }
    }
    const bidShare = 1 - askShare;
    if (call) {
      bullishPrem += prem * askShare;
      bearishPrem += prem * bidShare;
    } else {
      bearishPrem += prem * askShare;
      bullishPrem += prem * bidShare;
    }
  }
  const total = bullishPrem + bearishPrem;
  const direction: "long" | "short" = bullishPrem >= bearishPrem ? "long" : "short";
  const margin = total > 0 ? Math.abs(bullishPrem - bearishPrem) / total : 1;
  return { direction, bullishPrem, bearishPrem, margin };
}

export type FlowPolarityCompare = {
  legacy_direction: "long" | "short";
  signed_direction: "long" | "short";
  disagree: boolean;
  legacy_margin: number;
  signed_margin: number;
  /** Bid-side put premium as a share of total put premium (the classic misread bucket). */
  bid_put_share_of_puts: number;
  put_premium: number;
  call_premium: number;
};

export function compareFlowPolarity(flows: Record<string, unknown>[]): FlowPolarityCompare {
  const legacy = legacyCallPutDirection(flows);
  const signed = signedAggressionDirection(flows);

  let putPrem = 0;
  let bidPutPrem = 0;
  for (const r of flows) {
    const prem = premium(r);
    if (prem <= 0 || isCall(r)) continue;
    putPrem += prem;
    const side = tradeSide(r);
    if (side === "B") bidPutPrem += prem;
    else if (side == null || side === "M") {
      const askPct = Number(r.ask_side_pct);
      if (Number.isFinite(askPct) && askPct <= 40) bidPutPrem += prem * ((100 - askPct) / 100);
      else if (!Number.isFinite(askPct)) bidPutPrem += prem * 0.5;
    }
  }

  return {
    legacy_direction: legacy.direction,
    signed_direction: signed.direction,
    disagree: legacy.direction !== signed.direction,
    legacy_margin: legacy.margin,
    signed_margin: signed.margin,
    bid_put_share_of_puts: putPrem > 0 ? bidPutPrem / putPrem : 0,
    put_premium: putPrem,
    call_premium: legacy.callPrem,
  };
}

/** Counterfactual: how many scored plays clear a given publish floor. */
export function countClearingScoreFloor(
  scored: Array<{ score?: number | null }>,
  floor: number
): { clearing: number; total: number; clearing_frac: number } {
  const total = scored.length;
  const clearing = scored.filter((s) => (s.score ?? 0) >= floor).length;
  return { clearing, total, clearing_frac: total > 0 ? clearing / total : 0 };
}
