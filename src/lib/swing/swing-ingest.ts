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
import type { PlayDirection } from "../horizon-fanout";
import type { FlowAccumulationSignal } from "@/features/nighthawk/lib/flow-accumulation";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context";
import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import { emaFromCloses } from "../providers/ma-math";
import { trendStackScore } from "../horizon-scorers";
import type { ArchetypeReadExtras } from "./archetype";
import {
  deriveCatalystReads,
  contractQualityFromIvRank,
  freshestCatalystAgeDays,
  parseEarningsWindows,
  type SwingCatalystNewsItem,
  type SwingEarningsWindows,
} from "./swing-catalyst";
import {
  resolveGroupBenchmark,
  industryGroupRs01,
  type GroupBenchmark,
} from "./industry-group-rs";
import { getSector } from "../sector-map";

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * REGIME (pillar F) from the broad market: SPY's own daily EMA trend-stack as a risk-on/off read, then
 * DIRECTION-ALIGNED to the trade — a risk-on tape is a tailwind for a LONG and a headwind for a SHORT, so a
 * SHORT's favorable regime is risk-OFF (1 − riskOn). Neutral / no-direction uses the raw risk-on read.
 *
 * Coarse v1 on purpose (SPY-trend proxy, reusing the SPY closes already fetched once per scan — zero extra
 * IO). NULL-HONEST: when there isn't enough SPY history for a trend stack the read is absent (null), never a
 * fabricated 0/1. TODO (richer regime): fold in breadth / VIX term / the `market_regime` detector table for a
 * true risk-on/off read instead of SPY's price stack alone.
 */
export function regimeFromSpyTrend(spyCloses: number[], direction: PlayDirection | null): number | null {
  const stack = emaStackFromCloses(spyCloses);
  const hasStack =
    stack.priceAboveEma20 != null || stack.ema20AboveEma50 != null || stack.ema50Rising != null;
  if (!hasStack) return null; // not enough SPY history → honest absence, never a fabricated regime
  const riskOn01 = clamp01(trendStackScore(stack));
  return direction === "SHORT" ? 1 - riskOn01 : riskOn01;
}

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
  /** Ascending daily closes for SPY (relative-strength denominator AND the coarse REGIME read). */
  spyCloses: number[];
  /** The breakout-screen row when the structure screen surfaced this name (Tier-0 Path-B evidence). */
  mover?: BreakoutMover | null;
  /** Fetched catalyst context (Benzinga news + parsed earnings windows) → grounds the CATALYST pillar +
   *  the event-archetype extras. Absent (undefined/null) when no catalyst context was fetched → the pillar
   *  and extras stay null (honest absence), exactly as before this grounding shipped. */
  catalyst?: {
    /** Age (days) of the freshest in-window Benzinga catalyst headline, or null. From `freshestCatalystAgeDays`. */
    freshCatalystAgeDays?: number | null;
    /** Parsed next/last earnings windows for the name (from `parseEarningsWindows`). */
    earnings?: SwingEarningsWindows | null;
  } | null;
  /** UW EOD IV rank (0–100 or 0–1) → grounds the VOLATILITY pillar. Null/absent → the pillar stays null. */
  ivRank?: number | null;
  /** The name's SECTOR_ROTATION benchmark (resolved industry-group / sector ETF), or null when unresolvable.
   *  Provenance only — the RS is computed from `groupCloses`; this carries the label/kind for reasons/audits. */
  groupBenchmark?: GroupBenchmark | null;
  /** Ascending daily closes for `groupBenchmark.etf` — the industry-group RS denominator that grounds
   *  `sectorLeadership01`. Null/absent (no benchmark, or its closes couldn't be fetched) → the sector-rotation
   *  signal stays null and SECTOR_ROTATION simply won't fire (honest absence, never a coarse SPY-RS mislabel). */
  groupCloses?: number[] | null;
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

  // ── CATALYST + event-archetype extras (grounded from the fetched catalyst context; null when absent). ──
  // The DRIFT proxy is the DIRECTION-SIGNED 10-session return (a down-move is positive conviction for a
  // SHORT), exactly as the rel-strength pillar reads it, so a short's post-earnings drift scores correctly.
  const catReads = deriveCatalystReads({
    intendedDte: args.intendedDte ?? null,
    signedReturnPct10d: signed.returnPct10d,
    freshCatalystAgeDays: args.catalyst?.freshCatalystAgeDays ?? null,
    earnings: args.catalyst?.earnings ?? { nextEarnings: null, lastEarnings: null },
  });

  // ── VOLATILITY (from IV rank) + REGIME (from the SPY trend, direction-aligned). ──
  const contractQuality01 = contractQualityFromIvRank(args.ivRank);
  const regime01 = regimeFromSpyTrend(args.spyCloses, signed.direction);

  // ── SECTOR_ROTATION signal: the name's INDUSTRY-GROUP relative strength (name return vs its industry-group /
  // sector ETF), the grounded replacement for the coarse name-vs-SPY RS that used to MISLABEL this archetype
  // (in a broad rally everything beats SPY). Direction-signed exactly like the SPY rel-strength pillar. Null
  // (honest absence) when there's no benchmark / direction / enough history → SECTOR_ROTATION won't fire. The
  // REL_STRENGTH pillar's own SPY comparison is untouched; only the archetype LABEL stops keying off SPY RS.
  const sectorLeadership01 = industryGroupRs01({
    nameCloses: args.nameCloses,
    benchmarkCloses: args.groupCloses ?? null,
    direction: signed.direction,
    lookback: SWING_RETURN_LOOKBACK_SESSIONS,
  });

  return {
    ticker: args.ticker.toUpperCase(),
    asOf: args.asOf,
    intendedDte: args.intendedDte ?? null,
    reads,
    // Breakout-screen extras + the grounded event-archetype extras (catalyst / earnings-drift). A null extra
    // simply drops from its archetype's fit — POST_EARNINGS_DRIFT / EVENT_DRIVEN classify only when grounded.
    archetypeExtras: {
      ...ev.extras,
      catalystInWindow01: catReads.catalystInWindow01,
      earningsGapRecent01: catReads.earningsGapRecent01,
      postEarningsDrift01: catReads.postEarningsDrift01,
      // Industry-group RS → the SOLE SECTOR_ROTATION classifier signal (see the block above + archetype.ts).
      sectorLeadership01,
    },
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
    // VOLATILITY: contract quality from the UW EOD IV rank (inverse — cheap premium = high quality for a
    // 0.5–0.75Δ debit swing). Cluster present only when a rank grounded (else absent, never faked).
    volatility: contractQuality01 != null ? { contractQuality01 } : undefined,
    // CATALYST: fresh-news / pre-earnings strength, with the earnings-in-window binary hazard flagged so the
    // pillar scorer discounts it per the sub-lane's earningsHazard. Cluster present only when a catalyst grounded.
    catalyst:
      catReads.catalystStrength01 != null
        ? { catalystStrength01: catReads.catalystStrength01, earningsInWindow: catReads.earningsInWindow }
        : undefined,
    // REGIME: coarse SPY-trend risk-on/off, direction-aligned. Null when SPY history is too thin.
    regime01,
    // DATA_QUALITY (pillar G) stays absent: it is an honesty meta-pillar the dossier already tracks via
    // `dataQuality.degraded`/`missing`; grounding it as a real 0–1 feed-agreement read is a follow-up (TODO).
  };
}

/** The injected provider surface the ingest shell needs. `fetchDailyCloses` is required (the name's ascending
 *  daily closes); the catalyst/IV-rank fetchers are OPTIONAL — when omitted the CATALYST + VOLATILITY pillars
 *  and the event-archetype extras stay null (honest absence), so a caller that can't/won't wire the extra
 *  providers still gets the structure/rel-strength/flow/regime read. Testable with fakes; the cron route + the
 *  audit scan back them with the real Benzinga/UW readers. */
export interface SwingIngestDeps {
  fetchDailyCloses: (ticker: string, lookbackSessions: number) => Promise<number[]>;
  /** Recent Benzinga catalyst-channel news items for the name (polygon-news `fetchTickerNews`). */
  fetchCatalystNews?: (ticker: string) => Promise<SwingCatalystNewsItem[] | null>;
  /** The name's earnings feed rows (past + upcoming) — UW `fetchUwTickerEarningsHistory`; parsed into windows. */
  fetchEarningsRows?: (ticker: string) => Promise<Array<Record<string, unknown>> | null>;
  /** The name's UW EOD IV rank (0–100 or 0–1) — `fetchUwIvRank`. */
  fetchIvRank?: (ticker: string) => Promise<number | null>;
  /** Classify the name for SECTOR_ROTATION benchmark resolution — Polygon `/v3/reference/tickers/{ticker}`
   *  reference data (`sic_code`/`sic_description`/`type`; rate-limit-free, `fetchPolygonTickerDetails`).
   *  OPTIONAL + fail-soft: omitted or null → benchmark resolution falls back to the static sector-map (or
   *  null). SECTOR_ROTATION just won't fire for names it can't ground — it is NEVER a coarse SPY-RS mislabel. */
  fetchTickerClassification?: (ticker: string) => Promise<{
    sicCode?: string | null;
    sicDescription?: string | null;
    tickerType?: string | null;
  } | null>;
}

/** Sessions of daily history to pull per name (enough for a 50-EMA + slope + the 10-session return). */
export const SWING_INGEST_LOOKBACK_SESSIONS = 90;

/**
 * Tier-1 IO shell: fetch the name's daily closes (+ its catalyst context / IV rank when those fetchers are
 * wired) and assemble its dossier input. SPY closes are passed in (fetched ONCE by the discovery shell).
 * Returns null when the name has no usable daily history — a name we can't ground at all is dropped, not
 * carried as a hollow all-null dossier.
 *
 * FAIL-SOFT enrichment: the catalyst/IV-rank providers each degrade to null on any error (the underlying
 * readers already fail-open), so a Benzinga/UW hiccup only drops the CATALYST/VOLATILITY pillars for that
 * name — it NEVER drops the name or throws out of the scan. The `nowMs` for catalyst freshness is derived
 * from `asOf` so the same scan timestamp anchors every recency read.
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

  // Enrich with catalyst context + IV rank when the fetchers are wired. Each is independently fail-soft: a
  // provider error yields null for that read only, never a dropped candidate. Fetched in parallel per name.
  const nowMs = Date.parse(args.asOf);
  // SECTOR_ROTATION needs a directional lean (the RS is direction-signed), so only a bull/bear flow name can
  // ever carry it. Gate the classifier + benchmark IO on that: a neutral / flow-less (structure-only) candidate
  // skips the extra reference call and benchmark-closes fetch entirely (it could never classify SECTOR_ROTATION).
  const hasDirection = args.accumulation?.direction === "bull" || args.accumulation?.direction === "bear";
  const [newsItems, earningsRows, ivRank, classification] = await Promise.all([
    deps.fetchCatalystNews?.(args.ticker).catch(() => null) ?? Promise.resolve(null),
    deps.fetchEarningsRows?.(args.ticker).catch(() => null) ?? Promise.resolve(null),
    deps.fetchIvRank?.(args.ticker).catch(() => null) ?? Promise.resolve(null),
    hasDirection
      ? (deps.fetchTickerClassification?.(args.ticker).catch(() => null) ?? Promise.resolve(null))
      : Promise.resolve(null),
  ]);

  // SECTOR_ROTATION benchmark: resolve the name's industry-group / sector ETF (finest-first; the static
  // sector-map is the zero-IO fallback even when the classifier is absent) and fetch its daily closes — the
  // industry-group RS denominator for `sectorLeadership01`. Fully fail-soft: a null benchmark or a failed
  // closes fetch just leaves the sector-rotation signal null (SECTOR_ROTATION won't fire), never a mislabel.
  const groupBenchmark = hasDirection
    ? resolveGroupBenchmark({
        ticker: args.ticker,
        sicCode: classification?.sicCode ?? null,
        sicDescription: classification?.sicDescription ?? null,
        tickerType: classification?.tickerType ?? null,
        sectorLabel: getSector(args.ticker),
      })
    : null;
  let groupCloses: number[] | null = null;
  if (groupBenchmark) {
    const closes = await deps
      .fetchDailyCloses(groupBenchmark.etf, args.lookbackSessions ?? SWING_INGEST_LOOKBACK_SESSIONS)
      .catch(() => null);
    groupCloses = Array.isArray(closes) && closes.length > 0 ? closes : null;
  }

  const hasCatalystDeps = deps.fetchCatalystNews != null || deps.fetchEarningsRows != null;
  const catalyst = hasCatalystDeps
    ? {
        freshCatalystAgeDays: Number.isFinite(nowMs)
          ? freshestCatalystAgeDays(newsItems, nowMs)
          : null,
        earnings: parseEarningsWindows(earningsRows, nowMs),
      }
    : null;

  return assembleSwingDossierInput({
    ticker: args.ticker,
    asOf: args.asOf,
    intendedDte: args.intendedDte ?? null,
    accumulation: args.accumulation,
    flowWindowDays: args.flowWindowDays,
    nameCloses,
    spyCloses: args.spyCloses,
    mover: args.mover,
    catalyst,
    ivRank,
    groupBenchmark,
    groupCloses,
  });
}
