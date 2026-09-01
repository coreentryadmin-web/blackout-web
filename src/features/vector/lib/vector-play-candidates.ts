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
import type { PlayPlatformFlowPrint, PlayPlatformInputs } from "./vector-play-platform";
import { flowDirection } from "@/features/helix/lib/helix-flow-aggression";
import type { VectorContractPick } from "./vector-contract-picks";
import type { VectorRegimePosture } from "./vector-regime";
import type { ConfluenceZone } from "./vector-confluence";
import { buildVectorPickEvidence, type VectorPickEvidenceSection } from "./vector-pick-evidence";
import { rangeMeanReference } from "./vector-play-engine";
import type { PlayTechnicals, VectorPlay, VectorPlayStyle } from "./vector-play-engine";
import { effectivePickBias } from "./vector-pick-effective-bias";
import type { VectorPickEnrichmentData } from "./vector-pick-types";
import { strikeGexFromTotals, topGexPinStrikes } from "./strike-gex-lookup";
import { vectorPickOcc } from "./vector-pick-occ";

/** Sub-$0.12 premiums make %-from-entry meaningless and dominated by spread noise (2026-09-01 audit). */
export const MIN_VECTOR_PICK_PREMIUM = 0.12;

export type VectorPickActionStatus = "still_buy" | "caution" | "dont_buy";

export type VectorPlayPickContext = {
  play: VectorPlay;
  spot: number;
  callWall?: number | null;
  putWall?: number | null;
  magnetStrike?: number | null;
  gammaFlip?: number | null;
  regimePosture?: VectorRegimePosture | null;
  technicals?: PlayTechnicals | null;
  confluenceZones?: readonly ConfluenceZone[] | null;
  platformInputs?: PlayPlatformInputs | null;
  /** Server-enriched desk context (GEX matrix, catalysts). Omitted in unit tests. */
  enrichment?: VectorPickEnrichmentData | null;
};

export type VectorRankedPick = VectorContractPick & {
  reasons: string[];
  role: string;
  rank: number;
  dte: number;
  evidence: VectorPickEvidenceSection[];
  /** Desk-visible quality lane — whale + A-grade + strong rank. */
  tier: VectorPickTier;
};

export type VectorPickTier = "elite" | "standard";

const FLOW_WHALE = 500_000;
const FLOW_MEGA = 2_000_000;
const FLOW_CONFIRM = 200_000;
const MIN_SHOW_SCORE = 52;
/** HELIX whale anchors can surface with a lower internal rank bar — the print IS the signal. */
const MIN_SHOW_SCORE_WHALE = 44;
const DEFAULT_MAX_PICKS = 3;
/** Deep pool ranked for live backfill when top slots go Don't buy. */
export const VECTOR_CANDIDATE_POOL_SIZE = 8;

export type RankVectorPlayCandidatesOptions = {
  /** How many ranked picks to return (default 3; use VECTOR_CANDIDATE_POOL_SIZE for backfill pool). */
  limit?: number;
  /** OCC symbols to omit — used after a pick invalidates so the next rank can surface. */
  excludeOccs?: readonly string[];
};

/** Minimum internal rank score required to surface a pick (whale role gets a lower bar). */
export function minRankScoreToShow(role: string, flowPremiumAtStrike: number): number {
  if (role === "flow-whale" && flowPremiumAtStrike >= FLOW_WHALE) return MIN_SHOW_SCORE_WHALE;
  return MIN_SHOW_SCORE;
}

/** Elite = A-grade setup + HELIX whale or wall pin + strong contract rank. */
export function classifyVectorPickTier(input: {
  playGrade: VectorPlay["grade"];
  playConviction: number;
  role: string;
  rankScore: number;
  flowPremiumAtStrike: number;
  atKeyLevel: boolean;
}): VectorPickTier {
  const whale = input.role === "flow-whale" && input.flowPremiumAtStrike >= FLOW_WHALE;
  const megaWhale = input.flowPremiumAtStrike >= FLOW_MEGA;
  const highGrade = input.playGrade === "A" && input.playConviction >= 68;
  const strongRank = input.rankScore >= 78;

  if (megaWhale && input.playGrade !== "C" && input.rankScore >= 70) return "elite";
  if (highGrade && (whale || input.atKeyLevel) && strongRank) return "elite";
  if (whale && input.rankScore >= 72 && input.playGrade !== "C") return "elite";
  return "standard";
}

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
  const askOk = ask != null && Number.isFinite(ask) && ask > 0;
  const bidOk = bid != null && Number.isFinite(bid) && bid > 0;
  if (askOk && bidOk) {
    const mid = (ask! + bid!) / 2;
    if ((ask! - bid!) / mid > 1.0) return null;
    return mid;
  }
  if (askOk) return ask!;
  // Ask can go dark on a thin/wide-quoted contract while the bid is still live — a real,
  // executable (sell-the-put-to-open-adjacent, or the ask simply hasn't refreshed) contract that
  // was previously invisible to every liquidity tier including the catch-all `anyQuoted` bucket.
  if (bidOk) return bid!;
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
    if (premium == null || premium < MIN_VECTOR_PICK_PREMIUM) continue;
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

// A print's option TYPE matching the recommended contract's side is not confirmation on its own —
// a SOLD call at this strike is bearish, not support for buying more calls there. Both helpers below
// require the aggressor-aware `flowDirection` (bullish for a long/call pick, bearish for a
// short/put pick) rather than the raw option_type, mirroring the fix already applied in HELIX
// (helix-flow-aggression.ts) and in vector-play-platform.ts's summarizeSessionFlowBias.

function flowPremiumAtStrike(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined,
  strike: number,
  side: "call" | "put"
): number {
  if (!flows?.length) return 0;
  let best = 0;
  const wantDir = side === "call" ? "bullish" : "bearish";
  for (const f of flows) {
    if (flowDirection(f) !== wantDir) continue;
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
  const wantDir = direction === "long" ? "bullish" : "bearish";
  let best = 0;
  for (const f of flows) {
    if (flowDirection(f) !== wantDir) continue;
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
  const { play, spot, callWall, putWall, magnetStrike } = ctx;
  const flows = ctx.platformInputs?.sessionFlows;
  const specs: CandidateSpec[] = [];
  const king = num(ctx.enrichment?.gexKingStrike);
  const maxPain = num(ctx.enrichment?.maxPain) ?? num(magnetStrike);

  if (play.bias === "long") {
    const target =
      play.setup === "momentum-long"
        ? (num(callWall) ?? spot)
        : (num(putWall) ?? spot);
    specs.push({ direction: "long", targetStrike: target, role: "primary-long" });
    // GEX king as support pin when below spot — wall-aligned long leg (fade / support geometry).
    if (
      play.setup !== "momentum-long" &&
      king != null &&
      king < spot &&
      Math.abs(king - target) / spot > 0.004
    ) {
      specs.push({ direction: "long", targetStrike: king, role: "gex-king-pin" });
    }
  } else if (play.bias === "short") {
    const target =
      play.setup === "momentum-short"
        ? (num(putWall) ?? spot)
        : (num(callWall) ?? spot);
    specs.push({ direction: "short", targetStrike: target, role: "primary-short" });
    if (
      play.setup !== "momentum-short" &&
      king != null &&
      king > spot &&
      Math.abs(king - target) / spot > 0.004
    ) {
      specs.push({ direction: "short", targetStrike: king, role: "gex-king-pin" });
    }
  } else if (play.bias === "range") {
    const pw = num(putWall);
    const cw = num(callWall);
    if (pw != null) specs.push({ direction: "long", targetStrike: pw, role: "fade-dip" });
    if (cw != null) specs.push({ direction: "short", targetStrike: cw, role: "fade-rip" });
    const meanRef = rangeMeanReference(num(magnetStrike), maxPain, pw, cw);
    if (meanRef.price != null && spot > 0) {
      const dist = Math.abs(meanRef.price - spot) / spot;
      if (dist <= 0.025) {
        const dir = meanRef.price <= spot ? "long" : "short";
        specs.push({
          direction: dir,
          targetStrike: meanRef.price,
          role: "magnet-mean",
        });
      }
    }
  } else {
    return [];
  }

  // HELIX whale prints become explicit candidates at their strike/expiry.
  const seenFlow = new Set<string>();
  for (const f of flows ?? []) {
    const prem = num(f.premium);
    const strike = num(f.strike);
    if (prem == null || prem < FLOW_WHALE || strike == null) continue;
    // A whale print becomes a directional candidate from the aggressor-aware read, not raw option
    // type — a sold call is a short candidate, not a "buy this call" one. Undetermined (no
    // ask_pct, or midpoint) prints generate no candidate rather than guessing.
    const flowDir = flowDirection(f);
    const dir = flowDir === "bullish" ? "long" : flowDir === "bearish" ? "short" : null;
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

function distPctAtTarget(strike: number, targetStrike: number, spot: number): number {
  if (!(spot > 0)) return 1;
  return Math.abs(strike - targetStrike) / spot;
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
    score += 18;
    reasons.push(`HELIX whale print $${(flowAt / 1_000_000).toFixed(1)}M at this strike`);
    if (flowAt >= FLOW_MEGA) {
      score += 8;
      reasons.push("Mega-whale flow ($2M+) — highest-conviction HELIX anchor");
    }
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
  if (spec.role === "gex-king-pin") reasons.push("Strike at Thermal GEX king — largest net gamma node");
  if (spec.role === "magnet-mean") reasons.push("Strike at range mean-revert anchor (magnet / max pain)");

  const totals = ctx.enrichment?.strikeTotals;
  const strikeGex = strikeGexFromTotals(totals, contract.strike);
  const king = num(ctx.enrichment?.gexKingStrike);
  if (king != null && contract.strike === king) {
    score += 10;
    if (!reasons.some((r) => /GEX king/i.test(r))) {
      reasons.push("Contract strike is the GEX king node on Thermal");
    }
  } else if (strikeGex != null && totals) {
    const pins = topGexPinStrikes(totals, 3);
    if (pins.includes(contract.strike)) {
      score += 6;
      reasons.push("Strike sits on a top net-gamma pin in the matrix");
    }
  }

  const zone = ctx.confluenceZones?.find((z) => {
    if (!(spot > 0)) return false;
    return Math.abs(z.center - contract.strike) <= spot * 0.006;
  });
  if (zone) {
    score += 5;
    reasons.push(`Confluence stack (${zone.kinds.slice(0, 2).join(", ") || "multi-kind"}) at this strike`);
  }

  if (windowId === "0dte" && play.style !== "scalp") {
    score -= 4;
  }

  return { rankScore: Math.round(Math.min(100, Math.max(0, score))), reasons: [...new Set(reasons)] };
}

function pickKey(c: PickedContract): string {
  return `${c.side}-${c.strike}-${c.expiry}`;
}

function chainQuotesForContract(
  chain: EditionChainData,
  contract: PickedContract
): { bid: number | null; ask: number | null } {
  const row = chain.rows.find(
    (r) => r.strike === contract.strike && r.expiry === contract.expiry
  );
  if (!row) return { bid: null, ask: null };
  if (contract.side === "call") {
    return { bid: row.call_bid, ask: row.call_ask };
  }
  return { bid: row.put_bid, ask: row.put_ask };
}

/**
 * Rank up to 3 strong contract ideas for this ticker. Returns [] when the play is neutral or
 * nothing clears the minimum score bar — never fabricates weak/random strikes.
 */
export function rankVectorPlayCandidates(
  ctx: VectorPlayPickContext | null,
  chain: EditionChainData | null,
  ticker = "",
  options: RankVectorPlayCandidatesOptions = {}
): VectorRankedPick[] {
  if (!ctx || !chain) return [];
  const rankBias = effectivePickBias(ctx.play, ctx.spot, ctx.gammaFlip) ?? ctx.play.bias;
  if (rankBias === "neutral") return [];
  const ctxForRank =
    rankBias === ctx.play.bias ? ctx : { ...ctx, play: { ...ctx.play, bias: rankBias } };

  const maxPicks = options.limit ?? DEFAULT_MAX_PICKS;
  const excludeOccs = new Set(
    (options.excludeOccs ?? []).map((o) => o.trim().toUpperCase()).filter(Boolean)
  );
  const root = ticker.trim().toUpperCase();

  const specs = specsForContext(ctxForRank);
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
        contract = pickChainContract(chain, spec.direction, 0, spec.targetStrike);
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
      const { rankScore, reasons } = rankPick(ctxForRank, spec, contract, win.id);
      raw.push({ contract, spec, windowId: win.id, rankScore, reasons });
    }
  }

  raw.sort((a, b) => b.rankScore - a.rankScore);

  const out: VectorRankedPick[] = [];
  const seen = new Set<string>();
  const today = todayEtYmd();
  const playConviction = ctx.play.conviction;
  const flows = ctx.platformInputs?.sessionFlows;
  const spot = ctx.spot;

  for (const row of raw) {
    const key = pickKey(row.contract);
    if (seen.has(key)) continue;
    const flowAt = flowPremiumAtStrike(flows, row.contract.strike, row.contract.side);
    const atKeyLevel = distPctAtTarget(row.contract.strike, row.spec.targetStrike, spot) <= 0.004;
    const minScore = minRankScoreToShow(row.spec.role, flowAt);
    if (row.rankScore < minScore) continue;
    seen.add(key);
    const dte = dteOn(row.contract.expiry, today);
    const quotes = chainQuotesForContract(chain, row.contract);
    const occ = root ? vectorPickOcc(root, row.contract.expiry, row.contract.side, row.contract.strike) : null;
    if (occ && excludeOccs.has(occ.toUpperCase())) continue;
    const tier = classifyVectorPickTier({
      playGrade: ctx.play.grade,
      playConviction: playConviction,
      role: row.spec.role,
      rankScore: row.rankScore,
      flowPremiumAtStrike: flowAt,
      atKeyLevel,
    });
    out.push({
      side: row.contract.side,
      strike: row.contract.strike,
      expiry: row.contract.expiry,
      premium: row.contract.premium,
      occ,
      entryMid: row.contract.premium,
      entryBid: quotes.bid,
      entryAsk: quotes.ask,
      caveat: row.contract.caveat,
      confidence: playConviction,
      label: labelFor(row.contract),
      reasons: row.reasons,
      role: row.spec.role,
      rank: out.length + 1,
      dte,
      tier,
      evidence: buildVectorPickEvidence({
        side: row.contract.side,
        strike: row.contract.strike,
        expiry: row.contract.expiry,
        dte,
        premium: row.contract.premium,
        role: row.spec.role,
        targetStrike: row.spec.targetStrike,
        spot: ctx.spot,
        callWall: num(ctx.callWall),
        putWall: num(ctx.putWall),
        magnetStrike: num(ctx.magnetStrike),
        gammaFlip: num(ctx.gammaFlip),
        regimePosture: ctx.regimePosture ?? null,
        technicals: ctx.technicals ?? null,
        platformInputs: ctx.platformInputs ?? null,
        confluenceZones: ctx.confluenceZones ?? null,
        playStarred: ctx.play.starred ?? [],
        caveat: row.contract.caveat,
        gexKingStrike: num(ctx.enrichment?.gexKingStrike),
        strikeGex: strikeGexFromTotals(ctx.enrichment?.strikeTotals, row.contract.strike),
        catalysts: ctx.enrichment?.catalysts ?? [],
        newsHeadline: ctx.enrichment?.newsHeadline ?? null,
      }),
    });
    if (out.length >= maxPicks) break;
  }

  // Re-number ranks after filter
  out.forEach((p, i) => {
    p.rank = i + 1;
  });

  return out;
}
