// ── MOMENTUM discovery — IO orchestration ──────────────────────────────────────────
// The provider-touching half of the MOMENTUM source (the pure half is momentum-signal-source.ts
// + momentum-signal.ts). Dynamic-imported from scan.ts ONLY when the source is flag-enabled, so
// the flow-only board never loads this provider graph.
//
// UNLIKE BREAKOUT/PIN, this is NOT a whole-market/curated-universe screen — the scan list IS the
// operator's fixed 10-name universe (ticker-universe.ts), so there is no breadth snapshot to
// fetch and no dynamic chain-fetch cap to size: every universe name gets a real minute-bar read
// every cycle, and only names that CLEAR the two-independent-confirmations detection gate
// (momentum-signal.ts) ever cost a chain fetch.
//
// TWO-PHASE PER TICKER (budget discipline, cheap-before-expensive):
//   1. Fetch today's real minute bars (ONE Polygon aggs call). Pre-check `evaluateMomentumSignal`
//      with an EMPTY chain — the detection gate (momentum confirmed + RVOL floor) is computed
//      from bars/RVOL alone and never touches the chain argument, so this cheaply answers
//      "would this ticker even qualify" with ZERO chain-fetch cost for the (expected-common) case
//      it doesn't.
//   2. Only for a ticker that cleared step 1: fetch the real same-day option chain
//      (resolveTickerChainRows), filter to TODAY's expiry only (the operator's spec is explicitly
//      same-day-expiration), and re-run `evaluateMomentumSignal` with the real chain to get the
//      final ranked candidates + hard-reject diagnostics.
//
// SPXW is in DEFAULT_ZERODTE_TICKER_UNIVERSE only as the raw-UW-flow-alert option-root SPELLING
// for SPX (see ticker-universe.ts's own header) — it is not a separate underlying instrument.
// This module has no flow-alert input at all (it reads bars/chain directly), so it scans "SPX"
// once and never "SPXW" as a second, redundant underlying.
//
// RVOL is sourced from the SAME real wiring layer the commit-time shadow signal already uses
// (relative-volume-source.ts's `computeRelativeVolumeShadow`) — no second RVOL implementation.
// The real time-of-day-profile-aware ratio is preferred; the flat-proration baseline is the
// fallback when a profile hasn't been built yet for that ticker (see that module's own header).
//
// The OPENING-RANGE high/low (the `referenceLevel` momentum-acceleration.ts needs for its
// key-level-break confirmation) is read off the SAME real minute bars via the EXISTING
// `computeIntradayRead` (intraday.ts) — reused, not reinvented. Before the opening range has
// even formed (first 30 minutes of the session), `or_high`/`or_low` are null, so this module
// correctly reports "not yet detectable" rather than fabricating a reference level.

import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { polygonSpotTicker, type EnrichedZeroDteSetup } from "./board";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { computeIntradayRead } from "./intraday";
import { evaluateMomentumSignal, type MomentumSignalChainRow } from "./momentum-signal";
import type { MomentumBar } from "./momentum-acceleration";
import { buildMomentumSetup } from "./momentum-signal-source";
import { computeRelativeVolumeShadow } from "./relative-volume-source";
import { resolveZeroDteTickerUniverse } from "./ticker-universe";

/** RTH commit window in ET minutes-since-midnight: [9:30, 15:30) — same convention as
 *  breakout-discovery.ts's own (unexported) constants; duplicated here deliberately rather than
 *  widening that file's public surface for two integers. */
const RTH_OPEN_ET_MINUTES = 9 * 60 + 30;
const RTH_CUTOFF_ET_MINUTES = 15 * 60 + 30;

/** The real underlying symbols this module scans, derived from the shared 0DTE ticker universe
 *  with the SPXW spelling-alias collapsed into SPX (see this file's header). Exported so a test
 *  can assert the dedup without re-deriving it. */
export function momentumScanUniverse(includeTickers?: Set<string> | null): string[] {
  const set = includeTickers ?? resolveZeroDteTickerUniverse();
  return [...set].filter((t) => t !== "SPXW");
}

/** Outcome of a momentum discovery pass. `setups` is ALWAYS present (possibly empty — a
 *  genuinely quiet universe this cycle is a real, honest zero, not an absence). */
export type MomentumDiscoveryOutcome = {
  status: "ok" | "skip_off_hours";
  setups: EnrichedZeroDteSetup[];
};

/** Injectable IO seam — real providers by default; tests substitute hermetic fakes. */
export type MomentumDiscoveryDeps = {
  fetchMinuteBars: (symbol: string, from: string, to: string) => Promise<unknown[]>;
  resolveChain: typeof resolveTickerChainRows;
  computeRvolShadow: typeof computeRelativeVolumeShadow;
};

const DEFAULT_DEPS: MomentumDiscoveryDeps = {
  fetchMinuteBars: (symbol, from, to) => fetchAggBars(symbol, 1, "minute", from, to, "1000"),
  resolveChain: resolveTickerChainRows,
  computeRvolShadow: computeRelativeVolumeShadow,
};

function toMomentumBars(raw: unknown[]): MomentumBar[] {
  const out: MomentumBar[] = [];
  for (const b of raw) {
    const r = b as { t?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown };
    if (
      typeof r.t !== "number" || !Number.isFinite(r.t) ||
      typeof r.h !== "number" || !Number.isFinite(r.h) ||
      typeof r.l !== "number" || !Number.isFinite(r.l) ||
      typeof r.c !== "number" || !Number.isFinite(r.c)
    ) continue;
    out.push({ t: r.t, h: r.h, l: r.l, c: r.c, v: typeof r.v === "number" ? r.v : undefined });
  }
  return out;
}

/** Build the per-side MOMENTUM chain rows for TODAY's expiry only (the operator's spec is
 *  explicitly same-day-expiration) from a resolved chain's strike rows. A ticker with no listed
 *  contract expiring today (common for a single name without a true daily 0DTE) yields an empty
 *  array — never a fabricated same-day row. */
export function todayExpiryChainRows(
  rows: ReadonlyArray<{
    expiry: string;
    strike: number;
    call_bid: number | null;
    call_ask: number | null;
    call_oi: number;
    call_iv: number | null;
    put_bid: number | null;
    put_ask: number | null;
    put_oi: number;
    put_iv: number | null;
  }>,
  todayYmd: string
): MomentumSignalChainRow[] {
  const out: MomentumSignalChainRow[] = [];
  for (const r of rows) {
    if (r.expiry.slice(0, 10) !== todayYmd) continue;
    out.push({ strike: r.strike, side: "call", bid: r.call_bid, ask: r.call_ask, oi: r.call_oi, iv: r.call_iv });
    out.push({ strike: r.strike, side: "put", bid: r.put_bid, ask: r.put_ask, oi: r.put_oi, iv: r.put_iv });
  }
  return out;
}

/** Minutes remaining in the regular session from `nowEtMinutes` to the 16:00 ET close, floored
 *  at 0 (never negative — after the close there is no time left, not negative time). */
function minutesRemainingInSession(nowEtMinutes: number): number {
  return Math.max(0, 16 * 60 - nowEtMinutes);
}

/**
 * Discover MOMENTUM-origin setups for the live board. Best-effort per ticker throughout: a
 * failed fetch for one name never sinks the pass — it is simply absent from `setups` this cycle,
 * same discipline as breakout-discovery.ts / pin-discovery.ts degrading to a flow-only board on
 * any throw.
 */
export async function discoverMomentumSetups(opts: {
  today: string;
  nowEtMinutes: number;
  excludeTickers: Set<string>;
  /** When set, ONLY these tickers are eligible. null/undefined falls back to the real 0DTE-desk
   *  universe (ticker-universe.ts) — MOMENTUM's scan list IS this universe, so unlike
   *  BREAKOUT/PIN an omitted includeTickers is NOT "unrestricted whole-market". */
  includeTickers?: Set<string> | null;
  nowMs?: number;
  deps?: Partial<MomentumDiscoveryDeps>;
}): Promise<MomentumDiscoveryOutcome> {
  const { today, nowEtMinutes, excludeTickers } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const { fetchMinuteBars, resolveChain, computeRvolShadow } = { ...DEFAULT_DEPS, ...opts.deps };

  if (nowEtMinutes < RTH_OPEN_ET_MINUTES || nowEtMinutes >= RTH_CUTOFF_ET_MINUTES) {
    console.info("[zerodte-momentum] outside the RTH commit window -- SKIP");
    return { status: "skip_off_hours", setups: [] };
  }

  const universe = momentumScanUniverse(opts.includeTickers).filter((t) => !excludeTickers.has(t.toUpperCase()));
  const minutesRemaining = minutesRemainingInSession(nowEtMinutes);

  type Precheck = { ticker: string; bars: MomentumBar[]; rvolRatio: number | null; qualifies: boolean };
  const prechecks: Precheck[] = await Promise.all(
    universe.map(async (ticker): Promise<Precheck> => {
      try {
        const sym = polygonSpotTicker(ticker);
        const [rawBars, rvolShadow] = await Promise.all([
          fetchMinuteBars(sym, today, today).catch(() => []),
          computeRvolShadow(ticker, nowMs).catch(() => null),
        ]);
        const bars = toMomentumBars(rawBars);
        const rvolRatio = rvolShadow?.candidate.ratio ?? rvolShadow?.baseline.ratio ?? null;
        const intraday = computeIntradayRead(bars);
        const referenceLevel =
          intraday.or_high != null && intraday.or_low != null
            ? { high: intraday.or_high, low: intraday.or_low }
            : null;
        const precheck = evaluateMomentumSignal({
          ticker,
          bars,
          referenceLevel,
          rvolRatio,
          minutesRemaining,
          chain: [], // cheap detection-only pass -- see this file's header
          nowMs,
        });
        return { ticker, bars, rvolRatio, qualifies: precheck.detected };
      } catch (err) {
        console.warn(`[zerodte-momentum] precheck failed for ${ticker} -- SKIP this ticker:`, err);
        return { ticker, bars: [], rvolRatio: null, qualifies: false };
      }
    })
  );

  const qualifying = prechecks.filter((p) => p.qualifies);
  if (qualifying.length === 0) {
    return { status: "ok", setups: [] };
  }

  const setups: EnrichedZeroDteSetup[] = [];
  await Promise.all(
    qualifying.map(async ({ ticker, bars, rvolRatio }) => {
      try {
        const chainResult = await resolveChain(ticker).catch(() => null);
        if (!chainResult || !(chainResult.spot > 0) || chainResult.rows.length === 0) return;
        const chainRows = todayExpiryChainRows(chainResult.rows, today);
        if (chainRows.length === 0) return; // no true same-day 0DTE listed for this name today
        const intraday = computeIntradayRead(bars);
        const referenceLevel =
          intraday.or_high != null && intraday.or_low != null
            ? { high: intraday.or_high, low: intraday.or_low }
            : null;
        const result = evaluateMomentumSignal({
          ticker,
          bars,
          referenceLevel,
          rvolRatio,
          minutesRemaining,
          chain: chainRows,
          nowMs,
        });
        if (!result.detected || result.candidates.length === 0) return;
        const top = result.candidates[0]!;
        setups.push(
          buildMomentumSetup({
            ticker,
            candidate: top,
            momentum: result.momentum,
            rvolRatio: result.rvol_ratio,
            spot: chainResult.spot,
            todayYmd: today,
          })
        );
      } catch (err) {
        console.warn(`[zerodte-momentum] chain pass failed for ${ticker} -- SKIP this ticker:`, err);
      }
    })
  );

  console.info(
    `[zerodte-momentum] universe=${universe.length} qualifying=${qualifying.length} setups=${setups.length}`
  );
  return { status: "ok", setups };
}
