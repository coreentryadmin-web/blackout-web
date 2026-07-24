// src/lib/swing/swing-ingest.ts — the per-candidate multi-day READ ASSEMBLER for swing discovery (PR-11).
//
// WHY THIS EXISTS (the missing `swingSignalsFromReads` caller): swing-signals.ts, archetype.ts and
// dossier.ts are all PURE — they take a name's already-fetched multi-day reads and turn them into a
// direction, an archetype and a scored dossier. Nothing built those reads. This module is that Tier-1
// enrich step: given a name that a Tier-0 screen surfaced, it assembles the `SwingDossierInput` the dossier
// builder consumes — the multi-day flow accumulation read, the ~10-session name/SPY returns (momentum +
// relative strength), and the daily EMA trend-stack — and folds in the structure/archetype evidence the
// breakout screen already computed.
//
// NULL-HONESTY: a feed we can't ground stays null and its pillar/archetype-fit drops out — NEVER a
// fabricated 0. A name with too few daily bars to compute a 50-EMA simply carries `undefined` stack flags
// (absent), and a name with no directional flow carries a null accumulation read (that is the FM#1
// flow-less structure-only path — it STILL yields a dossier, just without the FLOW pillar).
//
// DIRECTION-SIGNING is delegated to the canonical `swingSignalsFromReads` (the one adapter, SEV-2): the
// pillar inputs are pre-signed here from that adapter so a SHORT's down-move reads as strength, exactly as
// the dossier's own archetype path signs internally — the two never disagree about the trade side.
//
// The pure core (`assembleSwingDossierInput`) is IO-free and deterministic over fetched arrays; the thin
// `ingestSwingReads` shell fetches the name's daily closes via an INJECTED fetcher (testable without live
// providers). The discovery shell fetches SPY once and passes its closes in, so we never re-fetch the index.

import type { SwingDossierInput } from "./dossier";
import type { SwingReads } from "../swing-signals";
import { swingSignalsFromReads } from "../swing-signals";
import type { FlowAccumulationSignal } from "@/features/nighthawk/lib/flow-accumulation";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context";
import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import { emaFromCloses } from "../providers/ma-math";
import type { ArchetypeReadExtras } from "./archetype";

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** ~10-session lookback for the momentum / relative-strength returns (the swing thesis is a multi-day move). */
export const SWING_RETURN_LOOKBACK_SESSIONS = 10;
/** Daily bars needed to compute a trustworthy 50-EMA + its slope (need > 50 plus a slope window). */
const MIN_BARS_FOR_STACK = 55;
/** How many bars back the 50-EMA slope is measured over (rising vs a week ago). */
const EMA_SLOPE_WINDOW = 5;

/**
 * Percentage return over the last `n` sessions from an ascending daily-closes array. Null when the array is
 * too short or the reference close is non-positive (honest absence, never a fabricated 0% "flat").
 */
export function pctReturnOverSessions(closes: number[], n: number): number | null {
  if (!Array.isArray(closes) || closes.length <= n) return null;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - n];
  if (!(past > 0) || !Number.isFinite(last)) return null;
  return ((last - past) / past) * 100;
}

/** The daily EMA trend-stack (stated BULLISH — the direction-signer inverts it for a SHORT). Flags are left
 *  `undefined` (absent) when there aren't enough bars, so trendStackScore never reads a fabricated stance. */
export function emaStackFromCloses(closes: number[]): {
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
} {
  if (!Array.isArray(closes) || closes.length < MIN_BARS_FOR_STACK) return {};
  const last = closes[closes.length - 1];
  const ema20 = emaFromCloses(closes, 20);
  const ema50 = emaFromCloses(closes, 50);
  const ema50Prior = emaFromCloses(closes.slice(0, -EMA_SLOPE_WINDOW), 50);
  return {
    priceAboveEma20: ema20 != null && Number.isFinite(last) ? last > ema20 : undefined,
    ema20AboveEma50: ema20 != null && ema50 != null ? ema20 > ema50 : undefined,
    ema50Rising: ema50 != null && ema50Prior != null ? ema50 > ema50Prior : undefined,
  };
}

/** Project a per-ticker multi-day flow accumulation signal onto the SwingReads accumulation shape. The swing
 *  DIRECTION comes FROM this read (accumulation.direction), so `aligned` (a 0DTE concept) is left null. */
export function accumulationReadFromSignal(sig: FlowAccumulationSignal): ZeroDteFlowAccumulation {
  return {
    direction: sig.direction,
    strength: sig.strength,
    days: sig.magnet?.days ?? 0,
    net_signed_premium: sig.netSignedPremium,
    magnet_strike: sig.magnet?.strike ?? null,
    magnet_side: sig.magnet?.side ?? null,
    aligned: null,
  };
}

/** Breakout-screen evidence → the archetype extras + structure blend it grounds. The breakout screen already
 *  computed gain (proximity/quality proxy) and close-strength (volume-confirmed follow-through) — reuse them
 *  rather than re-deriving. Only the LONG-directional breakout reads map cleanly; a SHORT's structure comes
 *  from the (inverted) EMA stack, so the breakout extras stay null for shorts (honest absence). */
function moverEvidence(
  mover: BreakoutMover | null | undefined,
  direction: "bull" | "bear" | "neutral" | null,
): { extras: ArchetypeReadExtras; breakoutQuality01: number | null; volumeConfirm01: number | null } {
  if (!mover || direction === "bear") {
    return { extras: {}, breakoutQuality01: null, volumeConfirm01: null };
  }
  // gain of ~10%+ saturates the "near range extreme / clean break" proxy; close-strength IS the follow-through.
  const breakoutQuality01 = isNum(mover.gain) ? clamp01(mover.gain / 0.1) : null;
  const volumeConfirm01 = isNum(mover.close_strength) ? clamp01(mover.close_strength) : null;
  return {
    extras: {
      nearRangeExtreme01: breakoutQuality01,
      breakoutQuality01,
      volumeExpansion01: volumeConfirm01,
    },
    breakoutQuality01,
    volumeConfirm01,
  };
}

/** Inputs the assembler works over (all already fetched by the shell — this function is PURE). */
export interface SwingReadsAssemblyArgs {
  ticker: string;
  asOf: string;
  /** The DTE the thesis intends to trade — resolves the sub-lane (drives Pillar D/E lane-sensitivity). */
  intendedDte?: number | null;
  /** Multi-day flow accumulation for the name (null on the flow-less structure-only path — FM#1). */
  accumulation: FlowAccumulationSignal | null;
  /** Sessions in the flow window (denominator for accumulation persistence). */
  flowWindowDays: number;
  /** Ascending daily closes for the name. */
  nameCloses: number[];
  /** Ascending daily closes for SPY (relative-strength denominator). */
  spyCloses: number[];
  /** The breakout-screen row when the structure screen surfaced this name (Tier-0 Path-B evidence). */
  mover?: BreakoutMover | null;
}

/**
 * Assemble the one `SwingDossierInput` for a name from its fetched multi-day reads. PURE + deterministic.
 *
 * The pillar inputs (structure booleans, rel-strength returns) are PRE-SIGNED via the canonical
 * `swingSignalsFromReads` so a SHORT expresses its conviction as a positive score — the dossier builder then
 * re-signs internally for the archetype path from the same `reads`, so score and label agree on the side.
 */
export function assembleSwingDossierInput(args: SwingReadsAssemblyArgs): SwingDossierInput {
  const stack = emaStackFromCloses(args.nameCloses);
  const returnPct10d = pctReturnOverSessions(args.nameCloses, SWING_RETURN_LOOKBACK_SESSIONS);
  const spyReturnPct10d = pctReturnOverSessions(args.spyCloses, SWING_RETURN_LOOKBACK_SESSIONS);

  const reads: SwingReads = {
    accumulation: args.accumulation ? accumulationReadFromSignal(args.accumulation) : null,
    flowWindowDays: args.flowWindowDays,
    returnPct10d,
    spyReturnPct10d,
    ...stack,
  };

  // Canonical direction-signing: the pillar inputs read the ALIGNED (signed) values so a short's down-move
  // and bearish stack score as strength — never the raw long-biased values (which score every short at ~0).
  // When there is NO direction (the flow-less structure-only path — FM#1), `swingSignalsFromReads` returns
  // the no-swing shell (stack/returns dropped), so we fall back to the RAW stack: with no side to align to,
  // the bullish stance IS the natural reading, and the STRUCTURE pillar must still ground (else a pure
  // breakout would carry an empty structure and lose its own defining evidence).
  const signed = swingSignalsFromReads(reads);
  const dir = args.accumulation?.direction ?? null;
  const ev = moverEvidence(args.mover, dir);

  return {
    ticker: args.ticker.toUpperCase(),
    asOf: args.asOf,
    intendedDte: args.intendedDte ?? null,
    reads,
    archetypeExtras: ev.extras,
    structure: {
      priceAboveEma20: signed.priceAboveEma20 ?? stack.priceAboveEma20,
      ema20AboveEma50: signed.ema20AboveEma50 ?? stack.ema20AboveEma50,
      ema50Rising: signed.ema50Rising ?? stack.ema50Rising,
      breakoutQuality01: ev.breakoutQuality01,
      volumeConfirm01: ev.volumeConfirm01,
    },
    relStrength: {
      nameReturnPct: signed.returnPct10d,
      spyReturnPct: signed.spyReturnPct10d,
    },
    flow: {
      accumAlignedDays: signed.accumAlignedDays,
      accumTotalDays: signed.accumTotalDays,
      // Aggression: how much of the magnet build swept / was opening (share ∈ [0,1]), blended.
      aggression01: args.accumulation?.magnet
        ? clamp01((args.accumulation.magnet.sweepRatio + args.accumulation.magnet.openingRatio) / 2)
        : null,
    },
    // VOLATILITY / CATALYST / REGIME / DATA_QUALITY pillars need providers PR-11 doesn't wire (IV term,
    // earnings-in-window, macro regime) — left absent (null) so they drop from the score, never faked.
  };
}

/** The injected provider surface the ingest shell needs — the name's ascending daily closes. Testable with a
 *  fake; the real script backs it with polygon.fetchStockDailyBars. */
export interface SwingIngestDeps {
  fetchDailyCloses: (ticker: string, lookbackSessions: number) => Promise<number[]>;
}

/** Sessions of daily history to pull per name (enough for a 50-EMA + slope + the 10-session return). */
export const SWING_INGEST_LOOKBACK_SESSIONS = 90;

/**
 * Tier-1 IO shell: fetch the name's daily closes and assemble its dossier input. SPY closes are passed in
 * (fetched ONCE by the discovery shell). Returns null when the name has no usable daily history — a name we
 * can't ground at all is dropped, not carried as a hollow all-null dossier.
 */
export async function ingestSwingReads(
  deps: SwingIngestDeps,
  args: {
    ticker: string;
    asOf: string;
    intendedDte?: number | null;
    accumulation: FlowAccumulationSignal | null;
    flowWindowDays: number;
    spyCloses: number[];
    mover?: BreakoutMover | null;
    lookbackSessions?: number;
  },
): Promise<SwingDossierInput | null> {
  const nameCloses = await deps.fetchDailyCloses(
    args.ticker,
    args.lookbackSessions ?? SWING_INGEST_LOOKBACK_SESSIONS,
  );
  if (!Array.isArray(nameCloses) || nameCloses.length === 0) return null;

  return assembleSwingDossierInput({
    ticker: args.ticker,
    asOf: args.asOf,
    intendedDte: args.intendedDte ?? null,
    accumulation: args.accumulation,
    flowWindowDays: args.flowWindowDays,
    nameCloses,
    spyCloses: args.spyCloses,
    mover: args.mover,
  });
}
