import "server-only";

// BLACKOUT Intelligence Engine — full Vector desk state for BIE/Largo.
//
// This is the Vector analogue of the SPX full-state pattern (spx_full_state /
// getSpxPlayState — see ecosystem-context.ts and load-spx-brief-intel.ts): ONE
// server-side composer that fans out over the SAME reads the Vector chart + desk
// terminal already surface, runs the SAME pure derivers, and attaches the SAME
// `buildVectorPlay` output, so BIE reasons over the entire live Vector surface for
// a ticker+horizon without a second, independently-drifting derivation.
//
// It deliberately REUSES the canonical serializable `VectorSnapshot` contract the
// pure play engine already exports (vector-play-engine.ts) rather than inventing a
// parallel shape — `VectorFullState` is that snapshot plus a small amount of
// desk-only context (options-flow markers, the full per-strike GEX ladder, and a
// compact heatmap-presence summary) that has no slot on the snapshot but that the
// desk brief cites. No new provider calls: every read here is an existing entry the
// stream/route layer already warms, all Redis-cached and fail-open.
//
// Discipline (mirrors fetchEcosystemContext): fail-open to null PER FIELD — a single
// read failing must never blank the whole state or throw — and round every float at
// this data boundary via roundFloats (several Vector reads serve unrounded floats).

import {
  buildVectorPlay,
  type VectorSnapshot,
  type VectorPlay,
} from "@/features/vector/lib/vector-play-engine";
import {
  VECTOR_DEFAULT_DTE_HORIZON,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
  getVectorVexWalls,
  getVectorVexFlip,
  getVectorDarkPoolLevels,
  getVectorWallHistory,
} from "@/features/vector/lib/vector-snapshot";
import { getHorizonStrikeTotals } from "@/features/vector/lib/vector-dte-walls-server";
import { getVectorMaxPainForHorizon } from "@/features/vector/lib/vector-max-pain-server";
import { getVectorExpectedMove } from "@/features/vector/lib/vector-expected-move-server";
import { getVectorGexHeatmap } from "@/features/vector/lib/vector-gex-heatmap-server";
import { computeServerTechnicals } from "@/features/vector/lib/vector-server-technicals";
import { getVectorFlowMarkers, type VectorFlowMarkers } from "@/features/vector/lib/vector-flow-markers-server";
import { buildGexLadder, type GexLadder } from "@/features/vector/lib/vector-gex-ladder";
import { eventsFromWallHistory, type VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";
import type { VectorDarkPoolLevel } from "@/features/vector/lib/vector-dark-pool-levels";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveGammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { deriveWallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { confluenceZones, type ConfluenceLevel } from "@/features/vector/lib/vector-confluence";
import { scoreTopWalls } from "@/features/vector/lib/vector-wall-integrity";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";
import { readVectorFullStateCache, writeVectorFullStateCache } from "@/lib/bie/vector-full-state-cache";
import { reportVectorAbsences, type VectorAbsenceReport } from "@/lib/bie/vector-absent-sections";
import { isEtCashRth } from "@/lib/et-market-hours";
import { describeVectorFreshness, type VectorFreshnessBlock } from "@/lib/bie/vector-state-freshness";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";

/** The default chart timeframe (minutes) a cached snapshot is computed at — the cron warms this TF;
 *  a reader asking for a different TF must recompute live (its technicals differ). */
export const VECTOR_FULL_STATE_DEFAULT_TIMEFRAME_MIN = 5;

/**
 * Compact presence summary of the strike×time GEX positioning heatmap. The full grid
 * (`GexHeatmapGrid`, ~strikes×times signed-GEX cells) is deliberately NOT carried on the
 * full state: it is large, has no citable scalar the desk brief quotes, and would bloat
 * every BIE turn's context. This tells a consumer the surface is live and its dimensions
 * without shipping the whole matrix — the same "know it exists, don't embed the JSON"
 * spirit the SPX full-state applies to its own heavy payloads.
 */
export type VectorHeatmapSummary = {
  available: boolean;
  /** Strike rows in the horizon-scoped grid. */
  strikeCount: number;
  /** Intraday time columns (the session's real spot path). */
  timeCount: number;
  /** Max |cell| across the grid — the colour-intensity normaliser. */
  maxAbs: number;
};

/**
 * The complete live Vector desk state for one (ticker, horizon). REUSES the canonical
 * `VectorSnapshot` contract (spot / regime / walls / flip / magnet / proximity / expected
 * move / max pain / confluence / wall integrity / technicals / the derived `play`) and
 * ADDS the desk-only context the snapshot has no slot for, so BIE sees EVERYTHING Vector
 * shows — the static structure AND the temporal wall dynamics (beads forming/growing/fading):
 *  - `asOf`          — when this state was assembled, as a UTC ISO instant.
 *  - `asOfEt` / `sessionDate` — the SAME instant on the market's clock, plus the ET trading
 *                      session it belongs to. Frozen with the measurement (see the type).
 *  - `flowMarkers`   — options-flow prints for the horizon's front expiry (feature #20).
 *  - `ladder`        — the full per-strike GEX ladder (king strikes + magnitudes), not just
 *                      the top walls the snapshot carries.
 *  - `heatmap`       — compact presence summary of the strike×time GEX surface (see above).
 *  - `wallHistory`   — the session's wall-history RAIL (the "beads": each sample's walls +
 *                      per-strike strength across ~15s buckets), so BIE can speak to walls
 *                      forming/holding/moving over time, not just the current snapshot.
 *  - `wallEvents`    — the "fadeness" narration derived FROM that rail (building / fading /
 *                      new / dissolved / shifted per strike) — what the tape is doing.
 *  - `vexWalls`/`vexFlip` — the VANNA (VEX) lens: dealer vanna walls + zero-vanna flip.
 *  - `darkPoolLevels`     — top institutional dark-pool strike levels.
 *
 * Every added field is null/empty when its read had nothing real — never fabricated.
 */
export type VectorFullState = VectorSnapshot & {
  /** When this state was assembled, as a UTC ISO instant. Machine-orderable, session-ambiguous. */
  asOf: string;
  /**
   * `asOf` on the MARKET's clock — the same instant, stamped ET.
   *
   * A bare UTC instant does not say which trading session it belongs to, and after ~20:00 ET its
   * calendar date is already tomorrow. This state is served to a model that is routinely asked
   * "is this today's tape?", so the instant travels with its session rather than requiring the
   * reader to convert an ISO string in its head. Contract C1 (`session-anchor.test.ts`).
   */
  asOfEt: string | null;
  /**
   * The ET trading-session date `asOf` falls in.
   *
   * PERSISTED with the snapshot rather than derived at read time, unlike the freshness block's
   * age. "How old is this?" is a fact about the READ and changes every second; "which session was
   * this measured in?" is a fact about the MEASUREMENT and is frozen the moment it is taken. A
   * cached snapshot re-served an hour later has a different age and the same session date, so the
   * two belong on opposite sides of the cache boundary.
   *
   * Null only when `Date.now()` produced something `etSessionDate` could not read.
   */
  sessionDate: string | null;
  flowMarkers: VectorFlowMarkers | null;
  ladder: GexLadder | null;
  heatmap: VectorHeatmapSummary | null;
  /** The wall-history rail — the "beads" over the session (walls + strength per ~15s sample). */
  wallHistory: WallHistorySample[];
  /** Wall-dynamics events derived from the rail — building / fading / new / gone / shift. */
  wallEvents: VectorWallEvent[];
  /** Dealer VANNA (VEX) walls — the second lens. */
  vexWalls: GexWalls | null;
  /** Zero-vanna flip. */
  vexFlip: number | null;
  /** Top institutional dark-pool strike levels. */
  darkPoolLevels: VectorDarkPoolLevel[];
};

/**
 * Assemble the full Vector desk state for a ticker + DTE horizon. One `Promise.all` over the
 * existing reads (spot from the SHARED `getGexPositioning` so it can never disagree with the
 * SPX/heatmap surface; horizon-scoped walls / flip / max-pain / expected-move / strike totals /
 * flow), then the pure derivers (regime → magnet/proximity/integrity → confluence), then
 * `buildVectorPlay` to attach the single concrete play. Returns null only when there is no live
 * spot for the ticker (no honest state to state); otherwise degrades field-by-field.
 *
 * `timeframeMin` drives the server-computed technicals (bar aggregation) and the play's
 * invalidation "close" reference label; defaults to a 5-minute intraday reference.
 *
 * This is the LIVE compute (the full fan-out). The cache-first entry point is `fetchVectorFullState`
 * below — it serves the cron-warmed snapshot when present and only calls this on a miss.
 */
export async function computeVectorFullState(
  ticker: string,
  horizon: VectorDteHorizon = VECTOR_DEFAULT_DTE_HORIZON,
  timeframeMin = VECTOR_FULL_STATE_DEFAULT_TIMEFRAME_MIN
): Promise<VectorFullState | null> {
  const t = normalizeVectorTicker(ticker);
  // Read the clock ONCE, before the fan-out, and stamp every time field below from it. Taken at
  // the START of the fan-out deliberately: it is the moment the underlying reads were issued, and
  // it errs OLD by the fan-out's duration (~0.7s target) rather than young — the safe direction
  // for a field whose whole job is to disclose staleness.
  const asOfMs = Date.now();

  try {
    // Fail-open PER read (mirrors fetchEcosystemContext): most of these already .catch()
    // internally and resolve to null, but wrapping again guarantees one slow/throwing read
    // can never reject the whole fan-out.
    const [positioning, gexWalls, gammaFlip, maxPainRes, expectedMove, strikeTotalsRes, flowMarkers, darkPoolLevels] =
      await Promise.all([
        getGexPositioning(t).catch(() => null),
        getVectorGexWallsForHorizon(t, horizon).catch(() => null),
        getVectorGammaFlipForHorizon(t, horizon).catch(() => null),
        getVectorMaxPainForHorizon(t, horizon).catch(() => null),
        getVectorExpectedMove(t, horizon).catch(() => null),
        getHorizonStrikeTotals(t, horizon).catch(() => null),
        getVectorFlowMarkers(t, horizon).catch(() => null),
        getVectorDarkPoolLevels(t).catch(() => [] as VectorDarkPoolLevel[]),
      ]);

    // VEX (vanna) lens + the wall-history rail are SYNCHRONOUS in-memory reads (no fetch) — the
    // same per-second stream state the chart renders. vexWalls/vexFlip give BIE the second lens;
    // the rail is the "beads" over the session, and eventsFromWallHistory narrates its dynamics.
    const vexWalls = getVectorVexWalls(t);
    const vexFlip = getVectorVexFlip(t);
    const wallHistory = getVectorWallHistory(t);
    // "Fadeness": building / fading / new / dissolved / shifted per strike, diffed across the rail
    // for the primary (gamma) lens — the same detector the desk terminal's wall-events feed uses.
    const wallEvents = eventsFromWallHistory(wallHistory, "gex");

    // Spot is the anchor for every deriver. Prefer the canonical positioning spot (SHARED with
    // SPX and the heatmap), then fall back to the spot the max-pain / expected-move reads
    // returned before giving up — a state with no spot at all is not a real desk read.
    const spot =
      num(positioning?.spot) ?? num(maxPainRes?.spot) ?? num(expectedMove?.spot) ?? null;
    if (spot == null) return null;

    // Second batch, parallelized, run once spot is known: the heaviest heatmap read (session spot
    // path + grid reconstruction, reduced to a compact summary) and the server-side chart technicals
    // (VWAP/EMA/RSI/MACD/structure over the timeframe's bars — the read the chart computes
    // client-side; now real server-side so BIE isn't blind to it).
    const [heatmapGrid, technicals] = await Promise.all([
      getVectorGexHeatmap(t, horizon, todayEtYmd()).catch(() => null),
      computeServerTechnicals(t, timeframeMin, spot).catch(() => null),
    ]);

    const topCallWall = num(gexWalls?.callWalls?.[0]?.strike);
    const topPutWall = num(gexWalls?.putWalls?.[0]?.strike);

    // Pure derivers — the exact functions the desk terminal already renders, so the BIE read can
    // never describe a different regime/magnet/proximity than a member sees on the chart.
    const regime = deriveVectorRegime({ spot, gammaFlip, topCallWall, topPutWall });
    const magnet = deriveGammaMagnet({ spot, walls: gexWalls, posture: regime.posture });
    const proximity = deriveWallProximity({ spot, walls: gexWalls, gammaFlip });
    // Wall integrity reads the SAME rail (persistence factor); an empty rail scores "unknown"
    // (neutral), never a fabricated "held all session" — see scoreWallIntegrity.
    const wallIntegrity = scoreTopWalls(gexWalls, wallHistory);

    const maxPain = num(maxPainRes?.maxPain);
    const ladder = strikeTotalsRes
      ? buildGexLadder(strikeTotalsRes.strikeTotals, strikeTotalsRes.spot)
      : null;

    // Confluence over the INDEPENDENT price levels this state has: dealer walls + flip + max pain,
    // PLUS the golden pocket (now that technicals are computed server-side). The pure engine only
    // ranks a cluster when ≥2 DISTINCT kinds agree, so a single wall repeated is never mislabeled
    // confluence. (HOD/LOD/PDH/PDL session levels remain a chart-only enrichment — the desk brief
    // cites the walls/flip/max-pain/golden-pocket agreement, which is the highest-signal cluster.)
    const confluenceLevels: ConfluenceLevel[] = [];
    for (const w of gexWalls?.callWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "call-wall" });
    for (const w of gexWalls?.putWalls ?? []) confluenceLevels.push({ price: w.strike, kind: "put-wall" });
    if (gammaFlip != null) confluenceLevels.push({ price: gammaFlip, kind: "gamma-flip" });
    if (maxPain != null) confluenceLevels.push({ price: maxPain, kind: "max-pain" });
    const gp = technicals?.goldenPocket;
    if (gp) confluenceLevels.push({ price: (gp.low + gp.high) / 2, kind: "golden-pocket" });
    for (const dp of darkPoolLevels.slice(0, 3)) {
      confluenceLevels.push({ price: dp.strike, kind: "dark-pool" });
    }
    const zones = confluenceZones(confluenceLevels, spot);

    const sessionFlows =
      flowMarkers?.prints?.map((p) => ({
        option_type: p.side === "call" ? "CALL" : "PUT",
        premium: p.premium,
        strike: p.strike,
      })) ?? [];

    const snapshot: VectorSnapshot = {
      ticker: t,
      horizon,
      timeframeMin,
      spot,
      regime: { posture: regime.posture },
      gexWalls: gexWalls ?? null,
      gammaFlip,
      magnet,
      proximity,
      // getVectorExpectedMove returns `ExpectedMove & { expiry }`; the extra field is harmless and
      // the object is a structural ExpectedMove.
      expectedMove: expectedMove ?? null,
      maxPain,
      confluenceZones: zones,
      wallIntegrity,
      // Real server-side chart technicals (VWAP / EMA stack / RSI / MACD / golden-pocket / structure),
      // computed from the SAME seed bars + summarizer the chart uses (vector-server-technicals.ts), so
      // BIE reads the same read a member sees. Null when there are no bars — buildVectorPlay still
      // degrades gracefully, keying the play off regime / proximity / walls / magnet.
      technicals,
      bie: null,
      platformInputs: {
        sessionFlows,
        darkPoolLevels,
      },
    };

    const play: VectorPlay | null = buildVectorPlay(snapshot);

    // roundFloats at the data boundary — several Vector reads serve unrounded floats (documented in
    // CLAUDE.md); rounding once here keeps every downstream brief number clean.
    //
    // VECTOR_FRACTION_DP is NOT optional here. The default dp=2 is right for the dollar-scale
    // majority of this payload (spot / strikes / wall levels / band bounds) and DESTROYS the
    // fraction-of-one fields: `expectedMove.movePct` is `move1 / spot`, so SPX's real 0.004006
    // (±31 pts on 7737.83) served as `0` and Largo answered "expected move 0.00%" while the
    // /vector page — which already passes this map — showed 0.40%. `atmIv` is a decimal vol and
    // loses up to half a vol point at 2dp. This is the same live defect fixed on
    // /api/market/vector/expected-move and /pin-forecast on 2026-08-07; the map was centralized
    // precisely so the next Vector read would inherit it, and this boundary never adopted it.
    // (`magnet.distancePct` needed no entry — it was rescaled to PERCENT at its source, because
    // roundFloats keys on the immediate key and `proximity.distancePct` in this very payload is
    // a percent, so no single override could have served both.)
    return roundFloats<VectorFullState>({
      ...snapshot,
      play,
      asOf: new Date(asOfMs).toISOString(),
      // All three from ONE `asOfMs`, never three separate clock reads: two `new Date()` calls
      // either side of a slow fan-out can straddle a session boundary and stamp a state whose
      // instant and session date disagree — a self-contradicting payload is worse than a bare one.
      asOfEt: etStamp(asOfMs),
      sessionDate: etSessionDate(asOfMs),
      flowMarkers: flowMarkers ?? null,
      ladder,
      heatmap: heatmapGrid
        ? {
            available: true,
            strikeCount: heatmapGrid.strikes.length,
            timeCount: heatmapGrid.times.length,
            maxAbs: heatmapGrid.maxAbs,
          }
        : null,
      wallHistory,
      wallEvents,
      vexWalls: vexWalls ?? null,
      vexFlip,
      darkPoolLevels: darkPoolLevels ?? [],
    }, 2, VECTOR_FRACTION_DP);
  } catch {
    return null; // whole-state failure is a no-surface, never a throw into the caller
  }
}

/**
 * Cache-first entry point — what every reader (get_ecosystem_context, the get_vector_full_state
 * Largo tool, composeVectorRead) calls. Serves the cron-warmed Redis snapshot for (ticker, horizon)
 * when present, so BIE reads the current Vector state instantly without paying the full fan-out on
 * the hot path. On a miss it computes live and self-warms the cache (so the first reader after an
 * expiry re-primes it even off-hours when the cron isn't running).
 *
 * The cache is keyed on (ticker, horizon) at the DEFAULT timeframe only: nearly all of the state
 * (walls / flip / regime / magnet / max-pain / expected-move / ladder / heatmap / flow / beads /
 * VEX / dark-pool) is timeframe-INDEPENDENT — only the technicals + the play's invalidation label
 * vary with the timeframe. So a request for a NON-default timeframe bypasses the cache and computes
 * live, guaranteeing its technicals are the right timeframe rather than the 5m snapshot's.
 */
export async function fetchVectorFullState(
  ticker: string,
  horizon: VectorDteHorizon = VECTOR_DEFAULT_DTE_HORIZON,
  timeframeMin: number = VECTOR_FULL_STATE_DEFAULT_TIMEFRAME_MIN
): Promise<(VectorFullState & VectorAbsenceReport & VectorFreshnessBlock) | null> {
  const cacheable = timeframeMin === VECTOR_FULL_STATE_DEFAULT_TIMEFRAME_MIN;

  if (cacheable) {
    const cached = await readVectorFullStateCache(ticker, horizon);
    // Compose both read-time labels: absence (which sections were unreadable) AND freshness
    // (how old this served snapshot is). Both are derived on the way OUT, never persisted.
    if (cached) return withReadContext(cached);
  }

  const live = await computeVectorFullState(ticker, horizon, timeframeMin);

  // Self-warm on a default-TF miss so the next reader hits cache even if the cron hasn't run
  // (off-hours, cold task). Fire-and-forget — a cache write must never delay or fail the read.
  //
  // NOTE the ordering: the cache is written the RAW `live` state, and the freshness block is
  // attached to a SEPARATE returned object. So nothing time-dependent is ever persisted — a stored
  // age would freeze at zero and describe every later read as instantaneous, which is this defect
  // inverted. That is what makes it safe to attach here rather than in a caller-side wrapper.
  if (live && cacheable) void writeVectorFullStateCache(ticker, horizon, live);

  return live ? withReadContext(live) : null;
}

/**
 * Attach the READ-time labelling — absence report AND freshness — on the way OUT, never on the
 * stored snapshot. Two lanes converged here (#2435 absence, #2427 freshness); both belong at this
 * single shared entry point and both are derived purely from the served state, so they compose
 * into ONE wrapper rather than two passes.
 *
 * WHY ON READ, NOT IN computeVectorFullState. (1) Both are derived from the state's own fields, so
 * a cache entry written before either existed still gets a correct report on read — no cache-shape
 * bump, no window where a field is missing. (2) The CACHED object stays exactly what the cron
 * writes (the raw desk state), so nothing time-dependent is ever persisted — a stored age would
 * freeze at zero and describe every later read as instantaneous, the freshness defect inverted.
 *
 * WHY THE SHARED ENTRY POINT. Every consumer ships this same un-aged, unlabelled snapshot — not
 * just the two Vector tools: get_ecosystem_context, the wall-dynamics reader, desk-scope-prefetch,
 * mini-panel, full-platform-snapshot, scenario-read, play-suggest-read, slash-prompts, the
 * /api/market/largo/{status,context} routes and Night Hawk's Cortex. Labelling in a caller-side
 * wrapper would have left a dozen surfaces serving a stale, unlabelled read.
 *
 * `isRth` is evaluated against the snapshot's OWN `asOf`, not "now": the bead-rail reason answers
 * "was the market open when this was MEASURED", which is what explains an empty rail; "now" would
 * mislabel a pre-open snapshot read after the bell.
 */
function withReadContext(
  state: VectorFullState
): VectorFullState & VectorAbsenceReport & VectorFreshnessBlock {
  const observedAt = Date.parse(state.asOf);
  return {
    ...state,
    ...reportVectorAbsences({
      gexWalls: state.gexWalls,
      gammaFlip: state.gammaFlip,
      maxPain: state.maxPain,
      expectedMove: state.expectedMove,
      ladder: state.ladder,
      heatmap: state.heatmap,
      technicals: state.technicals,
      flowMarkers: state.flowMarkers,
      vexWalls: state.vexWalls,
      darkPoolLevels: state.darkPoolLevels,
      wallHistory: state.wallHistory,
      play: state.play,
      isRth: isEtCashRth(Number.isFinite(observedAt) ? new Date(observedAt) : new Date()),
    }),
    ...describeVectorFreshness(state.asOf, Date.now()),
  };
}

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
