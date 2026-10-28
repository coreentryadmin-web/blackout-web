// ── MOMENTUM (early-entry) discovery — IO orchestration ────────────────────────────
// The provider-touching half of the MOMENTUM origin. Dynamic-imported from scan.ts ONLY when the
// source is flag-enabled, so the flow-only board never loads this provider graph.
//
// 2026-10-25, 2ND ITERATION — operator's own words: "My goal for NIGHTHAWK is to catch the setup
// BEFORE the major move, selecting calls or puts around $1.00-$3.00 premium that have a realistic
// path to running hard into the money... Separate WATCH from ENTRY." This REPLACES this file's
// prior internals (a bare momentum-acceleration+RVOL detector targeting sub-$1.00 contracts
// toward a $20 lotto-style target — momentum-signal.ts, still present, still tested, no longer
// called from here) with the early-entry pipeline: developing-pressure detection
// (early-entry-pressure.ts) -> a real WATCH/ENTRY/EXPIRED/INVALIDATED state machine
// (early-entry-state.ts) -> a $1.00-$3.00 contract screen with an explicit "already extended"
// rejection (early-entry-contract-select.ts) -> the final alert/NO_TRADE assembly
// (early-entry-alert.ts) -> the board bridge (early-entry-source.ts). The origin tag
// (discovery_origin: ["MOMENTUM"]) and every already-audited piece of board plumbing it rides on
// (board.ts's DiscoveryOrigin union/DISCOVERY_ORIGIN_ORDER, discovery-health.ts's MOMENTUM lane,
// why-now.ts's "momentum" reason, gates.ts's strictest-floor fallthrough) are UNCHANGED — only
// what feeds that origin changed, so none of that already-reviewed plumbing had to be re-audited.
//
// UNLIKE BREAKOUT/PIN, this is NOT a whole-market/curated-universe screen — the scan list IS the
// operator's fixed 10-name universe (ticker-universe.ts).
//
// THREE-PHASE PER TICKER (budget discipline, cheap-before-expensive):
//   1. Fetch today's real minute bars (ONE Polygon aggs call) + the real trailing avg daily
//      volume (relative-volume-source.ts's existing wiring, reused for its `avg_daily_volume`
//      field only). Build a per-minute RVOL series IN MEMORY from the real bars' own cumulative
//      volume (flat proration — `computeRelativeVolume`'s real, shipped fallback when no
//      time-of-day profile is supplied; see that function's own header) — this needs no extra
//      network call per minute, only the one avg-daily-volume fetch already made.
//   2. Classify BOTH directions ("long" against a tested resistance, "short" against a tested
//      support) against that bars+RVOL series via `classifySetup` — pure, no chain fetch yet.
//      Only a ticker whose best classification is ENTRY ever proceeds to step 3 (a WATCH is
//      real and reported, but not yet a tradeable candidate — see this file's own WATCH handling
//      below); EXPIRED/INVALIDATED/NO_SETUP never do.
//   3. Only for an ENTRY-classified ticker: fetch the real same-day option chain
//      (resolveTickerChainRows), filter to TODAY's expiry, and run `selectEarlyEntryContract` +
//      `buildEarlyEntryAlert` to get the final alert (or an honest NO_TRADE for that ticker).
//
// SPXW is in DEFAULT_ZERODTE_TICKER_UNIVERSE only as the raw-UW-flow-alert option-root SPELLING
// for SPX — this module has no flow-alert input, so it scans "SPX" once, never "SPXW" too.
//
// WATCH SETUPS ARE REAL BUT NOT YET SURFACED IN A DEDICATED UI (disclosed gap, not silently
// dropped): `watches` on the outcome carries every real WATCH-state read this pass, logged via
// console.info every cycle so they are observable in ops logs today; a dedicated watch-list
// surface on the member-facing board is a follow-up, not built in this pass.

import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { polygonSpotTicker, type EnrichedZeroDteSetup } from "./board";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { computeRelativeVolume } from "./relative-volume";
import type { PressureBar } from "./early-entry-pressure";
import { classifySetup, type RatedBar, type SetupClassification } from "./early-entry-state";
import { selectEarlyEntryContract, type EarlyEntryChainRow } from "./early-entry-contract-select";
import { buildEarlyEntryAlert, type EarlyEntryWatchAlert } from "./early-entry-alert";
import { buildEarlyEntrySetup } from "./early-entry-source";
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
 *  genuinely quiet universe this cycle is a real, honest zero, not an absence). `watches` is
 *  real, diagnostic-only developing-setup state (see this file's header). */
export type MomentumDiscoveryOutcome = {
  status: "ok" | "skip_off_hours";
  setups: EnrichedZeroDteSetup[];
  watches: EarlyEntryWatchAlert[];
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

function toPressureBars(raw: unknown[]): PressureBar[] {
  const out: PressureBar[] = [];
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
  return out.sort((a, b) => a.t - b.t);
}

/** Build the per-side chain rows for TODAY's expiry only (the operator's spec is explicitly
 *  same-day-expiration) from a resolved chain's strike rows. A ticker with no listed contract
 *  expiring today (common for a single name without a true daily 0DTE) yields an empty array —
 *  never a fabricated same-day row. */
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
): EarlyEntryChainRow[] {
  const out: EarlyEntryChainRow[] = [];
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

/** Build a per-minute RVOL-rated bar series from real bars + a real trailing avg daily volume —
 *  flat proration (no time-of-day profile), the real shipped fallback `computeRelativeVolume`
 *  itself defines when no profile is supplied. Pure given real inputs; no extra network call. */
export function rateByRvol(bars: PressureBar[], avgDailyVolume: number | null): RatedBar[] {
  let cumVol = 0;
  return bars.map((bar) => {
    cumVol += bar.v ?? 0;
    const ratio =
      avgDailyVolume != null
        ? computeRelativeVolume({ cumulativeVolumeToday: cumVol, avgDailyVolume, nowMs: bar.t }).ratio
        : null;
    return { bar, rvolRatio: ratio };
  });
}

/** Rank classifications by how actionable they are, for picking the single best direction to
 *  pursue per ticker: ENTRY > WATCH > everything else (EXPIRED/INVALIDATED/NO_SETUP are all
 *  equally "nothing to show" for this pass). Pure. */
function actionabilityRank(state: SetupClassification["state"]): number {
  if (state === "ENTRY") return 2;
  if (state === "WATCH") return 1;
  return 0;
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
    return { status: "skip_off_hours", setups: [], watches: [] };
  }

  const universe = momentumScanUniverse(opts.includeTickers).filter((t) => !excludeTickers.has(t.toUpperCase()));
  const minutesRemaining = minutesRemainingInSession(nowEtMinutes);

  type BestClassification = { ticker: string; rated: RatedBar[]; best: SetupClassification | null };
  const classified: BestClassification[] = await Promise.all(
    universe.map(async (ticker): Promise<BestClassification> => {
      try {
        const sym = polygonSpotTicker(ticker);
        const [rawBars, rvolShadow] = await Promise.all([
          fetchMinuteBars(sym, today, today).catch(() => []),
          computeRvolShadow(ticker, nowMs).catch(() => null),
        ]);
        const bars = toPressureBars(rawBars);
        const rated = rateByRvol(bars, rvolShadow?.avg_daily_volume ?? null);
        const longClassification = classifySetup({ rated, direction: "long" });
        const shortClassification = classifySetup({ rated, direction: "short" });
        const best =
          actionabilityRank(longClassification.state) >= actionabilityRank(shortClassification.state)
            ? longClassification
            : shortClassification;
        return { ticker, rated, best: best.state === "NO_SETUP" ? null : best };
      } catch (err) {
        console.warn(`[zerodte-momentum] classification failed for ${ticker} -- SKIP this ticker:`, err);
        return { ticker, rated: [], best: null };
      }
    })
  );

  const watches: EarlyEntryWatchAlert[] = [];
  const entryCandidates = classified.filter((c) => c.best?.state === "ENTRY");
  for (const c of classified) {
    if (c.best?.state === "WATCH") {
      const result = buildEarlyEntryAlert({
        ticker: c.ticker, classification: c.best, candidates: [], rejections: [],
        spotNow: c.rated[c.rated.length - 1]?.bar.c ?? 0, minutesRemaining,
      });
      if (result.state === "WATCH") watches.push(result);
    }
  }

  const setups: EnrichedZeroDteSetup[] = [];
  await Promise.all(
    entryCandidates.map(async ({ ticker, rated, best }) => {
      const classification = best!;
      try {
        const chainResult = await resolveChain(ticker).catch(() => null);
        if (!chainResult || !(chainResult.spot > 0) || chainResult.rows.length === 0) return;
        const chainRows = todayExpiryChainRows(chainResult.rows, today);
        if (chainRows.length === 0) return; // no true same-day 0DTE listed for this name today

        const watchBar = rated.find((r) => r.bar.t === classification.watch_detected_at_ms);
        const spotAtWatch = watchBar?.bar.c ?? chainResult.spot;

        const { candidates, rejections } = selectEarlyEntryContract({
          direction: classification.direction,
          spotAtWatch,
          spotNow: chainResult.spot,
          minutesRemaining,
          chain: chainRows,
        });
        const alert = buildEarlyEntryAlert({
          ticker, classification, candidates, rejections, spotNow: chainResult.spot, minutesRemaining,
        });
        if (alert.state !== "ENTRY") return; // NO_TRADE for this ticker -- never fabricate a setup
        setups.push(
          buildEarlyEntrySetup({
            alert, candidate: candidates[0]!, pressure: classification.pressure, todayYmd: today,
          })
        );
      } catch (err) {
        console.warn(`[zerodte-momentum] chain pass failed for ${ticker} -- SKIP this ticker:`, err);
      }
    })
  );

  console.info(
    `[zerodte-momentum] universe=${universe.length} entry_candidates=${entryCandidates.length} ` +
      `watches=${watches.length} setups=${setups.length}`
  );
  return { status: "ok", setups, watches };
}
