/**
 * HELIX + Thermal side-by-side — deterministic parallel read, not model-merged prose.
 * Powers the compare card UI and the conflict chip on the status strip.
 *
 * Two card modes:
 * - `helix_thermal` — one ticker, HELIX flow vs Thermal gamma (SPX default)
 * - `peer_tickers` — 2–3 tickers, flow + gamma per name (earnings / peer days)
 */

import { roundFloats } from "@/lib/round-floats";

// Shapes and guards live in the CLIENT-SAFE module — see compare-card-types.ts for why a client
// component importing them from HERE breaks the webpack build. Re-exported so existing server
// callers keep their import paths unchanged.
import {
  DEFAULT_PEER_COMPARE_TICKERS,
  type CompareGammaPosture,
  type CompareVolatilityRegime,
  type LargoCompareCard,
  type HelixThermalCompareCard,
  type HelixThermalSide,
  type PeerTickerCompareCard,
  type PeerTickerRow,
} from "@/lib/largo/compare-card-types";

export type {
  CompareGammaPosture,
  CompareVolatilityRegime,
  HelixThermalSide,
  HelixThermalCompareCard,
  PeerTickerRow,
  PeerTickerCompareCard,
  LargoCompareCard,
} from "@/lib/largo/compare-card-types";
export {
  DEFAULT_PEER_COMPARE_TICKERS,
  isHelixThermalCompareCard,
  isPeerTickerCompareCard,
} from "@/lib/largo/compare-card-types";

function flowBiasFromPremiums(
  call: number | null | undefined,
  put: number | null | undefined
): HelixThermalSide["bias"] {
  const c = typeof call === "number" && Number.isFinite(call) ? call : 0;
  const p = typeof put === "number" && Number.isFinite(put) ? put : 0;
  const net = c - p;
  const total = c + p;
  if (total < 1) return "unknown";
  const ratio = net / total;
  if (ratio > 0.15) return "bullish";
  if (ratio < -0.15) return "bearish";
  return "neutral";
}

/**
 * Map dealer gamma posture onto the two axes it genuinely has.
 *
 * WHY THIS IS NOT A REGEX OVER `gamma_regime_read` ANY MORE
 * --------------------------------------------------------
 * It used to be, and it inverted the read on every ticker measured. The old form tested
 * `/positive|long gamma|support|pin/` FIRST and returned "bullish" on a hit — but
 * `gamma_regime_read` is PROSE that ends with a levels list ("… Resistance 780, support
 * 765."), so the word "support" matched on tapes that the very same sentence described as
 * "dealers are net short gamma at EVERY strike … moves accelerate". Live 2026-08-21,
 * SPY/SPX/QQQ all classified `bullish` off a short-gamma matrix — 3 of 3 inverted.
 *
 * The ordering was only the proximate cause. The real defect is that the prose was being
 * scraped at all: `GexPositioning` already carries `gamma_posture` as a TYPED enum
 * ("long" | "short" | null), set from `gex.regime.posture`, sitting directly beside the
 * prose the code was parsing. Reading the enum makes the classification exact and immune
 * to any future rewording of the sentence.
 *
 * And the axis itself was wrong. Dealer gamma is not directional: short gamma amplifies a
 * move in EITHER direction, so calling it "bearish" asserts a direction the matrix never
 * measured. The gamma side therefore never claims bullish/bearish. It reports:
 *   long  gamma -> bias "neutral" (dealers fade both ways: mean-reverting), vol "suppressing"
 *   short gamma -> bias "mixed"   (dealers hedge with the move: both ways), vol "amplifying"
 *   null        -> bias "unknown", vol null
 */
function thermalReadFromPosture(posture: CompareGammaPosture): {
  bias: HelixThermalSide["bias"];
  volatility_regime: CompareVolatilityRegime;
} {
  if (posture === "long") return { bias: "neutral", volatility_regime: "suppressing" };
  if (posture === "short") return { bias: "mixed", volatility_regime: "amplifying" };
  return { bias: "unknown", volatility_regime: null };
}

/**
 * Directional opposition between two sides. Only "bullish" vs "bearish" counts: every other
 * pairing either involves a non-directional read ("neutral"/"mixed") or an absent one
 * ("unknown"), and neither is a disagreement.
 *
 * Callers must NOT treat a `false` here as "the two sides agree" — see `describeConflict`,
 * which distinguishes "compared, no conflict" from "nothing to compare".
 */
function biasesConflict(a: HelixThermalSide["bias"], b: HelixThermalSide["bias"]): boolean {
  return (a === "bullish" && b === "bearish") || (a === "bearish" && b === "bullish");
}

/** A side carries a real directional reading (as opposed to absent or non-directional). */
function isDirectional(bias: HelixThermalSide["bias"]): boolean {
  return bias === "bullish" || bias === "bearish";
}

/**
 * Resolve the conflict flag AND the note together, so the payload can never say `false`
 * without saying WHY it is false.
 *
 * The bug this closes: with both sides cold the card served `conflict: false,
 * conflict_note: null` — indistinguishable from a genuine all-clear. A reader (member or
 * model) takes that as "flow and gamma were checked and they agree", when in fact neither
 * side produced a reading. Two absences are not an agreement.
 *
 * Note the gamma side is never directional by construction now, so a flow-vs-gamma
 * DIRECTION conflict can no longer fire on the helix_thermal card. That is the honest
 * outcome, not a regression: the old `true`s were manufactured by the inverted prose
 * classifier. The conflict machinery is retained because `peer_tickers` rows compare two
 * FLOW biases against each other, where opposition is real and directional.
 */
function describeConflict(
  aLabel: string,
  a: HelixThermalSide,
  bLabel: string,
  b: HelixThermalSide
): { conflict: boolean; conflict_note: string | null } {
  if (!isDirectional(a.bias) || !isDirectional(b.bias)) {
    const missing = [!isDirectional(a.bias) ? aLabel : null, !isDirectional(b.bias) ? bLabel : null]
      .filter(Boolean)
      .join(" and ");
    return {
      conflict: false,
      conflict_note: `Not compared — ${missing} has no directional reading`,
    };
  }
  if (biasesConflict(a.bias, b.bias)) {
    return {
      conflict: true,
      conflict_note: `${aLabel} reads ${a.bias} while ${bLabel} reads ${b.bias}`,
    };
  }
  return { conflict: false, conflict_note: `${aLabel} and ${bLabel} both read ${a.bias}` };
}

function flowSummary(bias: HelixThermalSide["bias"]): string {
  if (bias === "bullish") return "Net call premium leads on the tape";
  if (bias === "bearish") return "Net put premium leads on the tape";
  if (bias === "neutral") return "Flow is balanced call vs put";
  return "Insufficient flow in window";
}

function gammaSummary(gammaRegime: string | null, flip: number | null | undefined): string {
  if (gammaRegime != null && String(gammaRegime).trim()) return String(gammaRegime);
  if (flip != null) return `Flip ${flip}`;
  return "Positioning unavailable";
}

type FlowTapeRow = { ticker?: string; premium?: number; option_type?: string };

/**
 * The subset of `GexPositioning` this card reads. Declared structurally (rather than
 * importing the full server-only type) so the PURE derivation below can be unit-tested
 * without dragging the provider graph — and so a test can feed it a REAL captured
 * production snapshot verbatim.
 */
export type ComparePositioningInput = {
  gamma_posture?: "long" | "short" | null;
  gamma_regime_read?: string | null;
  flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  spot?: number | null;
} | null;

/**
 * PURE derivation: positioning snapshot + flow rows -> the two compare sides.
 *
 * Split out of `fetchTickerFlowAndGamma` so the classification can be tested against real
 * captured payloads with no network, no DB and no module mocking. That matters here
 * specifically: the `@/` tsconfig alias does not resolve under
 * `--experimental-test-module-mocks` (same tsx resolver-hook interaction that bit #2073),
 * so a test that tried to mock the aliased dynamic imports below could not run at all.
 * Keeping the judgement pure sidesteps that entirely.
 */
export function compareSidesFrom(
  pos: ComparePositioningInput,
  flow: { rows: readonly FlowTapeRow[]; available: boolean }
): {
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  conflict: boolean;
  conflict_note: string | null;
} {
  let callPrem = 0;
  let putPrem = 0;
  for (const row of flow.rows) {
    const prem = Number(row.premium ?? 0);
    if (!Number.isFinite(prem)) continue;
    if (/call/i.test(String(row.option_type ?? ""))) callPrem += prem;
    else if (/put/i.test(String(row.option_type ?? ""))) putPrem += prem;
  }

  const flowBias = flowBiasFromPremiums(callPrem, putPrem);
  const gammaRegime = pos?.gamma_regime_read ?? null;
  // Structured posture off the positioning contract — NOT a regex over `gamma_regime_read`.
  // See thermalReadFromPosture() for the inversion that cost us.
  const gammaPosture: CompareGammaPosture = pos?.gamma_posture ?? null;
  const { bias: gammaBias, volatility_regime } = thermalReadFromPosture(gammaPosture);

  const flowSide: HelixThermalSide = {
    available: flow.available,
    bias: flowBias,
    summary: flowSummary(flowBias),
    net_premium: callPrem - putPrem,
    call_premium: callPrem || null,
    put_premium: putPrem || null,
    print_count: flow.rows.length || null,
  };

  const gamma: HelixThermalSide = {
    available: pos != null,
    bias: gammaBias,
    summary: gammaSummary(gammaRegime != null ? String(gammaRegime) : null, pos?.flip),
    flip: pos?.flip ?? null,
    call_wall: pos?.call_wall ?? null,
    put_wall: pos?.put_wall ?? null,
    spot: pos?.spot ?? null,
    gamma_regime: gammaRegime != null ? String(gammaRegime) : null,
    gamma_posture: gammaPosture,
    volatility_regime,
  };

  const { conflict, conflict_note } = describeConflict("Flow", flowSide, "gamma", gamma);

  return { flow: flowSide, gamma, conflict, conflict_note };
}

/** I/O wrapper: fetch the flow tape + GEX positioning, then hand both to the pure derivation. */
async function fetchTickerFlowAndGamma(ticker: string): Promise<{
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  conflict: boolean;
  conflict_note: string | null;
}> {
  const t = String(ticker).trim().toUpperCase();
  const [{ marketPlatform }, { getGexPositioning }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/providers/gex-positioning"),
  ]);

  const [flowRes, pos] = await Promise.all([
    marketPlatform.flows.getFlowTapeSummary({ limit: 50, ticker: t }).catch(() => null),
    getGexPositioning(t).catch(() => null),
  ]);

  // `getFlowTapeSummary` already scoped the tape with an exact `ticker = $1` in
  // fetchRecentFlows, so every returned row IS this ticker — no further filtering here.
  // (A 4-char-prefix re-filter used to sit at this spot. It was a no-op for exactly that
  // reason, and its `scoped.length ? scoped : recent` fallback was unreachable.)
  const recent = (flowRes as { recent?: FlowTapeRow[] } | null)?.recent;

  return compareSidesFrom(pos, {
    rows: Array.isArray(recent) ? recent : [],
    available: flowRes != null,
  });
}

/** Run HELIX flow + Thermal GEX in parallel for one ticker (default SPX). */
export async function helixThermalCompareForLargo(ticker = "SPX"): Promise<HelixThermalCompareCard> {
  const t = String(ticker).trim().toUpperCase() || "SPX";
  const { flow, gamma } = await fetchTickerFlowAndGamma(t);

  // Re-describe with the member-facing product names. Previously this branch rebuilt only the
  // CONFLICT note and fell through to the generic note otherwise, so a non-conflict card kept
  // saying nothing at all about whether a comparison had even happened.
  const { conflict, conflict_note } = describeConflict("HELIX flow", flow, "Thermal gamma", gamma);

  return roundFloats({
    kind: "helix_thermal",
    ticker: t,
    as_of: new Date().toISOString(),
    helix: flow,
    thermal: gamma,
    conflict,
    conflict_note,
  });
}

/** Flow + gamma side-by-side for 2–3 peer tickers (earnings / sector days). */
export async function peerTickerCompareForLargo(
  tickers: readonly string[]
): Promise<PeerTickerCompareCard> {
  const normalized = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))].slice(
    0,
    3
  );
  const list = normalized.length >= 2 ? normalized : [...DEFAULT_PEER_COMPARE_TICKERS];

  const snapshots = await Promise.all(
    list.map(async (ticker) => {
      const snap = await fetchTickerFlowAndGamma(ticker).catch(() => null);
      return { ticker, snap };
    })
  );

  const rows: PeerTickerRow[] = snapshots.map(({ ticker, snap }) => {
    if (!snap) {
      // A thrown snapshot is an ABSENCE, not an all-clear — carry the same explicit
      // "nothing was compared" note the live path produces rather than a bare null.
      return {
        ticker,
        flow: { available: false, bias: "unknown", summary: "Flow unavailable" },
        gamma: { available: false, bias: "unknown", summary: "Positioning unavailable" },
        conflict: false,
        conflict_note: "Not compared — flow and gamma both unavailable",
      };
    }
    return {
      ticker,
      flow: snap.flow,
      gamma: snap.gamma,
      conflict: snap.conflict,
      conflict_note: snap.conflict_note,
    };
  });

  // Divergence needs at least TWO peers that actually produced a directional reading, pointing
  // opposite ways. `uniqueFlow.size >= 2` alone was already close, but the note it produced said
  // nothing when divergence was false — so "all three peers bullish" and "we could not read any
  // of them" both served `peer_divergence: false, peer_divergence_note: null`. Same absence-as-
  // finding bug as the conflict flag: always say which case this is.
  const directional = rows.map((r) => r.flow.bias).filter(isDirectional);
  const uniqueFlow = new Set(directional);
  const peerDivergence = uniqueFlow.size >= 2;
  const roster = rows.map((r) => `${r.ticker} ${r.flow.bias}`).join(", ");
  const peerDivergenceNote = peerDivergence
    ? `Peer flow diverges — ${roster}`
    : directional.length >= 2
      ? `Peer flow agrees — ${roster}`
      : `Not compared — fewer than two peers have a directional flow reading (${roster})`;

  return roundFloats({
    kind: "peer_tickers",
    tickers: list,
    as_of: new Date().toISOString(),
    rows,
    peer_divergence: peerDivergence,
    peer_divergence_note: peerDivergenceNote,
  });
}
