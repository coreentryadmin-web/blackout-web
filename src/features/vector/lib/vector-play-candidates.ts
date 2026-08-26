/**
 * VECTOR PLAY CANDIDATES — ranks 1–3 real option contracts for a ticker using the full play
 * context (bias, walls, spot, HELIX flow, style), searching ACROSS DTE buckets (0DTE, weekly,
 * monthly) instead of mirroring the chart's horizon toggle.
 *
 * Member-facing `confidence` on every pick is ONLY `play.conviction` — the one calibrated number
 * the Suggested Play already computed. An internal rank score (never serialized) orders picks;
 * differentiation is rank + role + reason bullets, not a second invented probability (Largo
 * product contract: omit or reuse real conviction, never fabricate a new one).
 */
import { pickChainContract } from "@/features/nighthawk/lib/deterministic-edition";
import type { ChainStrikeRow, EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import { GROUNDING_MIN_OI, tieredMinOi } from "@/features/nighthawk/lib/grounding";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { VectorPlay, VectorPlayStyle } from "./vector-play-engine";
import type { PlayPlatformFlowPrint, PlayPlatformInputs } from "./vector-play-platform";
import type { VectorContractPick } from "./vector-contract-picks";

export type VectorPlayPickContext = {
  play: VectorPlay;
  spot: number;
  callWall?: number | null;
  putWall?: number | null;
  magnetStrike?: number | null;
  platformInputs?: PlayPlatformInputs | null;
};

export type VectorRankedPick = VectorContractPick & {
  reasons: string[];
  role: string;
  rank: number;
  dte: number;
};

const FLOW_WHALE = 500_000;
const FLOW_CONFIRM = 200_000;
const MIN_SHOW_SCORE = 52;
const MAX_PICKS = 3;

/** DTE windows searched independently — best contract per window, then ranked globally. */
const DTE_WINDOWS: Array<{ id: string; minDte: number; maxDte: number }> = [
  { id: "0dte", minDte: 0, maxDte: 0 },
  { id: "weekly", minDte: 1, maxDte: 7 },
  { id: "monthly", minDte: 8, maxDte: 35 },
];

type PickedContract = {
  strike: number;
  side: "call" | "put";
  expiry: string;
  premium: number;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
};

type CandidateSpec = {
  direction: "long" | "short";
  targetStrike: number;
  role: string;
  /** When set, prefer this exact expiry (HELIX whale print). */
  preferExpiry?: string;
};

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dteOn(expiry: string, today: string): number {
  const ms =
    new Date(expiry.slice(0, 10) + "T12:00:00Z").getTime() -
    new Date(today.slice(0, 10) + "T12:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

function contractPremium(row: ChainStrikeRow, side: "call" | "put"): number | null {
  const ask = side === "call" ? row.call_ask : row.put_ask;
  const bid = side === "call" ? row.call_bid : row.put_bid;
  if (ask != null && Number.isFinite(ask) && ask > 0) {
    if (bid != null && Number.isFinite(bid) && bid > 0) {
      const mid = (ask + bid) / 2;
      if ((ask - bid) / mid > 1.0) return null;
      return mid;
    }
    return ask;
  }
  return null;
}

function contractOi(row: ChainStrikeRow, side: "call" | "put"): number {
  const oi = side === "call" ? row.call_oi : row.put_oi;
  return Number.isFinite(oi) ? oi : 0;
}

function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(Number(strike.toFixed(2)));
}

function expiryMmDd(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

function labelFor(contract: PickedContract): string {
  return `${formatStrike(contract.strike)}${contract.side === "call" ? "C" : "P"} ${expiryMmDd(contract.expiry)}`;
}

/**
 * Pick the most liquid contract near `targetStrike` inside a calendar-DTE window.
 * Uses the same OI/premium gates as Night Hawk's picker, sorted by strike distance to target.
 */
export function pickContractNearTarget(
  chain: EditionChainData,
  direction: "long" | "short",
  targetStrike: number,
  minDte: number,
  maxDte: number,
  preferExpiry?: string
): PickedContract | null {
  const side: "call" | "put" = direction === "long" ? "call" : "put";
  const spot = chain.spot;
  const minOi = spot > 0 ? tieredMinOi(spot) : GROUNDING_MIN_OI;
  const today = todayEtYmd();
  const minExpiry = addCalendarDaysYmd(today, minDte);
  const maxExpiry = addCalendarDaysYmd(today, maxDte);

  type Candidate = PickedContract & { dist: number };
  const strict: Candidate[] = [];
  const relaxedPremium: Candidate[] = [];
  const relaxedOi: Candidate[] = [];
  const anyQuoted: Candidate[] = [];

  for (const row of chain.rows) {
    if (preferExpiry && row.expiry !== preferExpiry) continue;
    if (!preferExpiry) {
      if (row.expiry < minExpiry || row.expiry > maxExpiry) continue;
    }
    const premium = contractPremium(row, side);
    if (premium == null) continue;
    const oi = contractOi(row, side);
    const entry: Candidate = {
      strike: row.strike,
      side,
      expiry: row.expiry,
      premium: Number(premium.toFixed(2)),
      dist: Math.abs(row.strike - targetStrike),
    };
    const oiOk = oi >= minOi;
    const premOk = premium <= MAX_OPTION_PREMIUM_PER_SHARE;
    if (oiOk && premOk) strict.push(entry);
    else if (oiOk && !premOk) relaxedPremium.push({ ...entry, caveat: "premium_high" });
    else if (!oiOk && premOk) relaxedOi.push({ ...entry, caveat: "low_liquidity" });
    else anyQuoted.push({ ...entry, caveat: "premium_high_low_liquidity" });
  }

  const sortFn = (a: Candidate, b: Candidate) =>
    a.dist - b.dist || a.expiry.localeCompare(b.expiry) || a.strike - b.strike;

  for (const pool of [strict, relaxedPremium, relaxedOi, anyQuoted]) {
    if (pool.length) {
      pool.sort(sortFn);
      const best = pool[0]!;
      return {
        strike: best.strike,
        side: best.side,
        expiry: best.expiry,
        premium: best.premium,
        caveat: best.caveat,
      };
    }
  }
  return null;
}

function flowPremiumAtStrike(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined,
  strike: number,
  side: "call" | "put"
): number {
  if (!flows?.length) return 0;
  let best = 0;
  const want = side === "call" ? "CALL" : "PUT";
  for (const f of flows) {
    if (f.option_type?.toUpperCase() !== want) continue;
    if (num(f.strike) !== strike) continue;
    const prem = num(f.premium);
    if (prem != null && prem > best) best = prem;
  }
  return best;
}

function largestFlowPremium(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined,
  direction: "long" | "short"
): number {
  if (!flows?.length) return 0;
  const want = direction === "long" ? "CALL" : "PUT";
  let best = 0;
  for (const f of flows) {
    if (f.option_type?.toUpperCase() !== want) continue;
    const prem = num(f.premium);
    if (prem != null && prem >= FLOW_CONFIRM && prem > best) best = prem;
  }
  return best;
}

function dteFitScore(style: VectorPlayStyle, dte: number): { pts: number; reason: string | null } {
  if (style === "scalp") {
    if (dte <= 1) return { pts: 9, reason: "0DTE matches scalp timeframe" };
    if (dte <= 7) return { pts: 5, reason: "Weekly expiry — still tradable for a quick scalp" };
    return { pts: 2, reason: "Longer DTE vs scalp style — lower time decay fit" };
  }
  if (style === "swing") {
    if (dte >= 5 && dte <= 14) return { pts: 9, reason: "Weekly window fits swing hold" };
    if (dte >= 1 && dte <= 4) return { pts: 6, reason: "Front-week expiry — usable for a short swing" };
    if (dte === 0) return { pts: 2, reason: "0DTE is tight for a swing hold" };
    return { pts: 5, reason: "Monthly+ swing — wider time window" };
  }
  // position
  if (dte >= 21) return { pts: 9, reason: "Monthly+ fits position timeframe" };
  if (dte >= 7) return { pts: 6, reason: "Weekly+ still workable for a position leg" };
  return { pts: 3, reason: "Short DTE vs position style" };
}

function specsForContext(ctx: VectorPlayPickContext): CandidateSpec[] {
  const { play, spot, callWall, putWall } = ctx;
  const flows = ctx.platformInputs?.sessionFlows;
  const specs: CandidateSpec[] = [];

  if (play.bias === "long") {
    const target = num(putWall) ?? spot;
    specs.push({ direction: "long", targetStrike: target, role: "primary-long" });
  } else if (play.bias === "short") {
    const target = num(callWall) ?? spot;
    specs.push({ direction: "short", targetStrike: target, role: "primary-short" });
  } else if (play.bias === "range") {
    const pw = num(putWall);
    const cw = num(callWall);
    if (pw != null) specs.push({ direction: "long", targetStrike: pw, role: "fade-dip" });
    if (cw != null) specs.push({ direction: "short", targetStrike: cw, role: "fade-rip" });
  } else {
    return [];
  }

  // HELIX whale prints become explicit candidates at their strike/expiry.
  const seenFlow = new Set<string>();
  for (const f of flows ?? []) {
    const prem = num(f.premium);
    const strike = num(f.strike);
    if (prem == null || prem < FLOW_WHALE || strike == null) continue;
    const side = f.option_type?.toUpperCase();
    const dir = side === "CALL" ? "long" : side === "PUT" ? "short" : null;
    if (!dir) continue;
    const key = `${dir}-${strike}-${f.expiry ?? ""}`;
    if (seenFlow.has(key)) continue;
    seenFlow.add(key);
    specs.push({
      direction: dir,
      targetStrike: strike,
      role: "flow-whale",
      preferExpiry: typeof f.expiry === "string" && f.expiry.length >= 10 ? f.expiry.slice(0, 10) : undefined,
    });
  }

  return specs;
}

function rangeProximityDelta(
  role: string,
  spot: number,
  putWall: number | null,
  callWall: number | null
): { delta: number; reason: string | null } {
  if (role === "fade-dip" && putWall != null && callWall != null) {
    const nearPut = Math.abs(spot - putWall);
    const nearCall = Math.abs(spot - callWall);
    if (nearPut < nearCall) {
      return { delta: 12, reason: "Spot closer to put wall — dip fade is the active range leg" };
    }
    return { delta: -10, reason: "Spot closer to call wall — dip fade is the secondary leg" };
  }
  if (role === "fade-rip" && putWall != null && callWall != null) {
    const nearPut = Math.abs(spot - putWall);
    const nearCall = Math.abs(spot - callWall);
    if (nearCall < nearPut) {
      return { delta: 12, reason: "Spot closer to call wall — rip fade is the active range leg" };
    }
    return { delta: -10, reason: "Spot closer to put wall — rip fade is the secondary leg" };
  }
  return { delta: 0, reason: null };
}

function rankPick(
  ctx: VectorPlayPickContext,
  spec: CandidateSpec,
  contract: PickedContract,
  windowId: string
): { rankScore: number; reasons: string[] } {
  const { play, spot } = ctx;
  const flows = ctx.platformInputs?.sessionFlows;
  const today = todayEtYmd();
  const dte = dteOn(contract.expiry, today);
  const reasons: string[] = [];

  let score = play.conviction * 0.42;

  if (play.grade === "A") {
    score += 4;
    reasons.push("Suggested Play grade A — setup quality is high");
  } else if (play.grade === "B") {
    score += 2;
  }

  const distPct = spot > 0 ? Math.abs(contract.strike - spec.targetStrike) / spot : 1;
  if (distPct <= 0.004) {
    score += 16;
    reasons.push(`Strike anchored at ${formatStrike(spec.targetStrike)} (${play.bias === "range" ? "range rail" : "key level"})`);
  } else if (distPct <= 0.012) {
    score += 10;
    reasons.push(`Strike near ${formatStrike(spec.targetStrike)} entry level`);
  } else {
    score += 3;
  }

  const flowAt = flowPremiumAtStrike(flows, contract.strike, contract.side);
  const flowDir = largestFlowPremium(flows, spec.direction);
  if (spec.role === "flow-whale" && flowAt >= FLOW_WHALE) {
    score += 14;
    reasons.push(`HELIX whale print $${(flowAt / 1_000_000).toFixed(1)}M at this strike`);
  } else if (flowAt >= FLOW_CONFIRM) {
    score += 8;
    reasons.push(`HELIX flow $${Math.round(flowAt / 1000)}K confirms this strike`);
  } else if (flowDir >= 1_000_000) {
    score += 4;
    reasons.push("Session HELIX flow aligns with direction");
  }

  const dteFit = dteFitScore(play.style, dte);
  score += dteFit.pts;
  if (dteFit.reason) reasons.push(dteFit.reason);

  if (play.bias === "range") {
    const prox = rangeProximityDelta(spec.role, spot, num(ctx.putWall), num(ctx.callWall));
    score += prox.delta;
    if (prox.reason) reasons.unshift(prox.reason);
  }

  if (!contract.caveat) {
    score += 7;
    reasons.push("Passes Night Hawk liquidity gates (OI + premium cap)");
  } else if (contract.caveat === "premium_high") {
    score += 3;
    reasons.push("Premium above standard cap — verify size");
  } else {
    score += 1;
    reasons.push("Thin open interest — use a limit order");
  }

  if (spec.role === "fade-dip") reasons.push("Call leg — buy the dip toward range mean");
  if (spec.role === "fade-rip") reasons.push("Put leg — sell the rip toward range mean");
  if (spec.role === "primary-long") reasons.push("Call leg — aligned with long Suggested Play bias");
  if (spec.role === "primary-short") reasons.push("Put leg — aligned with short Suggested Play bias");

  if (windowId === "0dte" && play.style !== "scalp") {
    score -= 4;
  }

  return { rankScore: Math.round(Math.min(100, Math.max(0, score))), reasons: [...new Set(reasons)] };
}

function pickKey(c: PickedContract): string {
  return `${c.side}-${c.strike}-${c.expiry}`;
}

/**
 * Rank up to 3 strong contract ideas for this ticker. Returns [] when the play is neutral or
 * nothing clears the minimum score bar — never fabricates weak/random strikes.
 */
export function rankVectorPlayCandidates(
  ctx: VectorPlayPickContext | null,
  chain: EditionChainData | null
): VectorRankedPick[] {
  if (!ctx || !chain || ctx.play.bias === "neutral") return [];

  const specs = specsForContext(ctx);
  if (!specs.length) return [];

  const raw: Array<{ contract: PickedContract; spec: CandidateSpec; windowId: string; rankScore: number; reasons: string[] }> =
    [];

  for (const spec of specs) {
    for (const win of DTE_WINDOWS) {
      let contract: PickedContract | null = null;
      if (spec.preferExpiry) {
        contract = pickContractNearTarget(
          chain,
          spec.direction,
          spec.targetStrike,
          0,
          400,
          spec.preferExpiry
        );
      } else if (win.id === "0dte") {
        contract = pickChainContract(chain, spec.direction, 0);
      } else {
        contract = pickContractNearTarget(
          chain,
          spec.direction,
          spec.targetStrike,
          win.minDte,
          win.maxDte
        );
      }
      if (!contract) continue;
      const { rankScore, reasons } = rankPick(ctx, spec, contract, win.id);
      raw.push({ contract, spec, windowId: win.id, rankScore, reasons });
    }
  }

  raw.sort((a, b) => b.rankScore - a.rankScore);

  const out: VectorRankedPick[] = [];
  const seen = new Set<string>();
  const today = todayEtYmd();
  const playConviction = ctx.play.conviction;

  for (const row of raw) {
    const key = pickKey(row.contract);
    if (seen.has(key)) continue;
    if (row.rankScore < MIN_SHOW_SCORE) continue;
    seen.add(key);
    out.push({
      side: row.contract.side,
      strike: row.contract.strike,
      expiry: row.contract.expiry,
      premium: row.contract.premium,
      caveat: row.contract.caveat,
      confidence: playConviction,
      label: labelFor(row.contract),
      reasons: row.reasons,
      role: row.spec.role,
      rank: out.length + 1,
      dte: dteOn(row.contract.expiry, today),
    });
    if (out.length >= MAX_PICKS) break;
  }

  // Re-number ranks after filter
  out.forEach((p, i) => {
    p.rank = i + 1;
  });

  return out;
}
