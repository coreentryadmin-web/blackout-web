import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { runPolygonPool } from "@/lib/providers/polygon-rate-limiter";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeBeadRailGexWalls,
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import {
  listSharedUniverseTickers,
  removeDynamicUniverseTicker,
  touchDynamicUniverse,
} from "./vector-dynamic-universe";
import { isVectorTickerAllowed, normalizeVectorTicker } from "./vector-ticker";
import { roundFloats } from "@/lib/round-floats";
import { strikeTotalsForHorizonFromCells } from "./vector-narrowed-walls-from-cells";
import { horizonsForTick } from "./vector-narrowed-write-cadence";
import { isCompleteBuild, mergeUniverseSnapshot } from "./vector-universe-merge";
import { bucketWallSampleTime, buildWallHistorySample } from "./vector-wall-sample";
import { wallTrailSampleSecForTicker } from "./vector-wall-sample-server";
import { writeWallHistorySample, type WallWriteSource } from "./vector-wall-write";
import { VECTOR_WALL_NODES_PER_SIDE } from "./vector-bar-timeframes";
import { buildNarrowedHorizonWallSamples } from "./vector-snapshot";

/**
 * Options for the universe build. `recordWallHistory` makes the build ALSO
 * persist a per-ticker wall-history sample (the bead-rail source the chart
 * reads) — see the recorder note on {@link buildVectorUniverseSnapshot}. Only
 * the RTH-gated cron passes it; the inline scanner-poll rebuild must not, or it
 * would stamp off-hours/weekend samples onto the session rail.
 */
export type VectorUniverseBuildOpts = {
  recordWallHistory?: boolean;
  /** ET session date (YYYY-MM-DD) the recorded samples are filed under. */
  sessionYmd?: string;
  /** Observability tag for durable wall writes when recordWallHistory is set. */
  wallWriteSource?: import("./vector-wall-write").WallWriteSource;
};

export type VectorUniverseRow = {
  ticker: string;
  spot: number | null;
  gammaFlip: number | null;
  /** Why gammaFlip is null (e.g. 'net_short_everywhere') — omitted/null when a flip was found or
   *  the upstream heatmap didn't report a reason. Same field the canonical GEX heatmap route and
   *  Thermal's regime strip already forward; the universe row previously discarded it, so a null
   *  flip here read as unexplained where the equivalent Thermal/Largo reads already explain it. */
  flipReason: string | null;
  vexFlip: number | null;
  topCallWall: number | null;
  topPutWall: number | null;
  topCallPct: number | null;
  topPutPct: number | null;
  asOf: number | null;
};

export type VectorUniverseSnapshot = {
  /**
   * Fan-out completeness for the build that produced this snapshot. Optional because snapshots
   * persisted before this field existed are still readable; absent is treated as "unknown", which
   * routes through the safe (merging) path rather than the replacing one.
   */
  attempted?: number;
  produced?: number;
  /**
   * Of `produced`, how many rows actually resolved a usable (non-null) spot. Optional for the
   * same "readable before this field existed" reason as `attempted`/`produced` — absent routes
   * through the safe (merging) path. Distinct from `produced`: a ticker whose `fetchGexHeatmap`
   * call blocked past its budget and fell back to spot:null still PRODUCES a row (fan-out
   * completeness), but that row carries no usable data — see `isCompleteBuild`'s doc comment in
   * vector-universe-merge.ts for the live incident this distinction exists to fix.
   */
  producedWithSpot?: number;
  updatedAt: number;
  rows: VectorUniverseRow[];
};

const REDIS_KEY = "vector:universe:snapshot";
/**
 * Serve-stale: the snapshot carries updatedAt for consumers to age-gate, so
 * expiry must not race the 5-min cron (the old 300s TTL was a knife-edge that
 * regularly expired between runs, and after the cron's 21:00 UTC stop EVERY
 * scanner poll from every open tab rebuilt the 21-ticker fan-out inline all
 * evening). 48h keeps weekend reads cache-only; staleness is disclosed, not
 * hidden via expiry.
 */
const TTL_SEC = 48 * 60 * 60;

/**
 * Build the universe scanner rows — and, when `recordWallHistory` is set,
 * persist a full per-ticker wall-history sample as a SIDE EFFECT of the same
 * heatmap fetch.
 *
 * Why here: the chart's bead rails ("strength per time" dots) are drawn from
 * `vector:wall-history:{ticker}:{ymd}`. The live SSE hub, the 5s in-process
 * vector-bead-recorder-leader, and this 5-min cron all write samples; this build
 * already fetches the full GEX/VEX walls for every universe ticker and records
 * from that same heatmap read.
 */
async function buildVectorUniverseRow(
  raw: string,
  opts: {
    recordWallHistory?: boolean;
    sessionYmd?: string;
    nowSec?: number;
    /** Universe recorder uses 5s buckets; live/active paths use 15s for non-oracle. */
    bucketScope?: import("./vector-wall-sample").WallTrailSampleScope;
    /** 0DTE/weekly/monthly rails. Now derived from the matrix in hand — no extra upstream reads. */
    recordNarrowedHorizons?: boolean;
    /**
     * Monotonic sweep counter, used ONLY to decide which narrowed horizons write this tick.
     * Defaults to 0, which writes all three — a caller that does not track ticks gets the seed
     * behaviour rather than silently dropping the slow rails forever.
     */
    narrowedTickIndex?: number;
    wallWriteSource?: WallWriteSource;
  } = {}
): Promise<{ row: VectorUniverseRow; historyRecorded: boolean } | null> {
  const {
    recordWallHistory = false,
    sessionYmd,
    nowSec = Math.floor(Date.now() / 1000),
    bucketScope = "universe",
    recordNarrowedHorizons = true,
    narrowedTickIndex = 0,
    wallWriteSource = bucketScope === "live" ? "bead-recorder-active" : "bead-recorder-universe",
  } = opts;
  const ticker = normalizeVectorTicker(raw);
  const hm = await fetchGexHeatmap(ticker);
  // `hm.spot` can come back literally 0 (a halted/delisted ticker, or a provider placeholder for
  // "no price") rather than nullish, so a plain `?? null` lets a real zero leak into the row as
  // `spot: 0` while every downstream computation already treats <= 0 the same as absent (the
  // `spot != null && spot > 0` guard immediately below, gexWalls, etc.) — a member-visible field
  // saying "0" when every other consumer of the same value already reads it as "no real spot".
  const spot = hm?.spot != null && hm.spot > 0 ? hm.spot : null;
  // Self-heal: a dead dynamic entry (dead before touchDynamicUniverse's spot>0 write-guard
  // existed, or one whose chain stopped resolving later) never gets removed by age-based pruning
  // alone. Fire-and-forget, never blocks the row — see removeDynamicUniverseTicker's own comment.
  if (!(spot != null && spot > 0)) {
    void removeDynamicUniverseTicker(ticker);
  }
  // GEX (gamma) lens is side-constrained by spot — a call wall below spot or a put wall above it
  // is not a real resistance/support read, the exact "wrong side of spot" bug PR #2417 fixed for
  // the canonical gex-heatmap route but not here (2026-09-04 audit finding). VEX (vanna) has no
  // inherent above/below-spot geometry (see gex-wall-levels.ts's NAMING doc) and stays unconstrained.
  const gexWalls =
    hm?.gex?.strike_totals && spot != null && spot > 0
      ? computeGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals), {
          maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
          spot,
        })
      : { callWalls: [], putWalls: [] };
  // Bead rail: unconstrained Sep-3 ranking — overlay/scanner use gexWalls above.
  const beadRailGexWalls = hm?.gex?.strike_totals
    ? computeBeadRailGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals), {
        maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
      })
    : { callWalls: [], putWalls: [] };
  const vexWalls = hm?.vex?.strike_totals
    ? computeGexWalls(mapFromStrikeTotalsRecord(hm.vex.strike_totals), {
        maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
      })
    : { callWalls: [], putWalls: [] };

  let historyRecorded = false;

  if (recordWallHistory && sessionYmd) {
    const sampleTime = bucketWallSampleTime(nowSec, wallTrailSampleSecForTicker(ticker, bucketScope));
    const sample = buildWallHistorySample({
      time: sampleTime,
      gexWalls: beadRailGexWalls,
      gammaFlip: hm?.gex?.flip ?? null,
      vexWalls,
      vexFlip: hm?.vex?.flip ?? null,
    });
    // The blended rail and the three narrowed rails are SEPARATE storage keys. Narrowed horizons
    // cost three extra scoped reads per ticker — fine on the 5-min cron or a live viewer, but they
    // were blowing the 5s universe sweep past its tick budget (measured 56s for 83 tickers on
    // 2026-08-12), which dropped ticks and thinned NVDA/AMD/META rails to 10–30s effective cadence.
    const writes: Promise<import("./vector-wall-write").WallWriteResult>[] = [];
    if (sample) {
      writes.push(
        writeWallHistorySample({
          source: wallWriteSource,
          sessionYmd,
          ticker,
          sample,
        })
      );
    }

    // NARROWED RAILS — derived from the matrix already in hand, and cadence-gated.
    //
    // Two halves, and #2273/#2274 is the reason they are separated. Its READ half was right and is
    // restored here: a narrowed horizon is a SUBSET OF EXPIRY COLUMNS of the matrix fetched above,
    // so `strikeTotalsForHorizonFromCells` sums it in memory and runs it through the SAME
    // computeGexWalls reduction as the blended rail — zero network, zero cache, zero provider. The
    // old `buildNarrowedHorizonWallSamples` cost SIX scoped upstream reads per ticker, which is
    // what kept these rails off the 5s sweep in the first place.
    //
    // Its WRITE half is what got reverted, and is not repeated. Writing all three every tick took
    // each ticker from one rail write to four (~122 -> ~488 per 5s tick); a rail write is a
    // read-modify-write of the WHOLE session rail plus a durable enqueue, on a payload that grows
    // all session. The sweep overran and the blended rail everyone depends on regressed to 10-25s.
    // Here 0DTE writes every tick (the rail the 5s requirement is about) while weekly/monthly write
    // every Nth — see vector-narrowed-write-cadence for the budget and its stated trade-off.
    if (recordNarrowedHorizons && hm?.gex?.cells && hm?.expiries?.length) {
      const todayYmd = todayEtYmd();
      for (const horizon of horizonsForTick(narrowedTickIndex)) {
        const totals = strikeTotalsForHorizonFromCells(hm.gex.cells, hm.expiries, horizon, todayYmd);
        // No expiry column in range is a real answer for this horizon on this chain — record
        // nothing rather than a zeroed wall set, which would render as "no gamma anywhere".
        if (!totals) continue;
        // Same spot-constraint as the main gexWalls computation above (2026-09-04 audit
        // follow-up to #3495) — this narrowed-horizon reduction feeds the durable
        // 0dte/weekly/monthly wall-history rails via writeWallHistorySample below, so an
        // unconstrained call here persisted "wrong side of spot" walls into history even
        // after the live rail was fixed.
        const horizonWalls = computeBeadRailGexWalls(totals, {
          maxPerSide: VECTOR_WALL_NODES_PER_SIDE,
        });
        const horizonSample = buildWallHistorySample({
          time: sampleTime,
          gexWalls: horizonWalls,
          gammaFlip: hm?.gex?.flip ?? null,
          vexWalls,
          vexFlip: hm?.vex?.flip ?? null,
        });
        // buildWallHistorySample returns null when a sample carries nothing worth storing; a null
        // here must be skipped, not written, or the rail gains an empty bucket that reads as a
        // real observation of "no walls".
        if (!horizonSample) continue;
        writes.push(
          writeWallHistorySample({
            source: wallWriteSource,
            sessionYmd,
            ticker,
            sample: horizonSample,
            horizon,
          })
        );
      }
    }
    if (writes.length > 0) {
      const settled = await Promise.allSettled(writes);
      historyRecorded = settled.some(
        (r) => r.status === "fulfilled" && r.value.written === true
      );
    }
  }

  const asOfMs = hm?.asof ? Date.parse(hm.asof) : NaN;
  return {
    row: {
      ticker,
      spot,
      gammaFlip: hm?.gex?.flip ?? null,
      flipReason: hm?.gex?.flip_reason ?? null,
      vexFlip: hm?.vex?.flip ?? null,
      topCallWall: gexWalls.callWalls[0]?.strike ?? null,
      topPutWall: gexWalls.putWalls[0]?.strike ?? null,
      topCallPct: gexWalls.callWalls[0]?.pct ?? null,
      topPutPct: gexWalls.putWalls[0]?.pct ?? null,
      asOf: Number.isFinite(asOfMs) ? asOfMs : null,
    },
    historyRecorded,
  };
}

/**
 * Record one wall-history bucket (blended + narrowed horizons) for a single ticker.
 * Shared by the 5s universe bead recorder and the 5-min universe snapshot cron.
 */
export async function recordVectorUniverseWallSample(
  raw: string,
  opts: {
    sessionYmd: string;
    nowSec?: number;
    /** Monotonic sweep counter — gates which narrowed horizons write on this tick. */
    narrowedTickIndex?: number;
    bucketScope?: import("./vector-wall-sample").WallTrailSampleScope;
    wallWriteSource?: WallWriteSource;
  }
): Promise<boolean> {
  const bucketScope = opts.bucketScope ?? "universe";
  const built = await buildVectorUniverseRow(raw, {
    recordWallHistory: true,
    sessionYmd: opts.sessionYmd,
    nowSec: opts.nowSec ?? Math.floor(Date.now() / 1000),
    bucketScope,
    wallWriteSource: opts.wallWriteSource,
    narrowedTickIndex: opts.narrowedTickIndex,
    // Narrowed rails are ON for the 5s universe sweep now.
    //
    // This used to read `bucketScope === "live"`, which left 0dte/weekly/monthly to the 5-minute
    // cron plus whoever happened to be viewing a ticker — measured 2026-08-18 as a 300s median gap
    // on every un-viewed name's 0DTE rail (SPY 27 samples in 90 minutes) while SPX, being viewed,
    // sat at 5s. The exclusion existed because deriving them cost six scoped upstream reads per
    // ticker; they are now summed from the matrix this row already fetched, so the read is free and
    // the write is cadence-gated.
    recordNarrowedHorizons: true,
  });
  return built?.historyRecorded ?? false;
}

export async function buildVectorUniverseSnapshot(
  opts: VectorUniverseBuildOpts = {}
): Promise<VectorUniverseSnapshot> {
  const { recordWallHistory = false, sessionYmd, wallWriteSource } = opts;
  // Shared sticky universe with Thermal heatmap-warm: static allowlist ∪ dynamic (≤100 / 14d).
  // Dynamic names are Polygon-cache-first once warm; `registerVectorUniverseView` also appends a
  // single row immediately after a Thermal/Helix/Vector view so the scanner does not wait for the
  // next full rebuild.
  const tickers = await listSharedUniverseTickers();
  const rows: VectorUniverseRow[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  // Bounded fan-out (2026-09-04 audit finding): the raw Promise.allSettled this replaced fired
  // every universe ticker's fetchGexHeatmap at once (~85-100 tickers). Each cold ticker's chain
  // build shares the SAME app-wide Polygon admission limiter as live desk/GEX/pulse traffic, and
  // fetchGexHeatmap caps how long ONE caller blocks on a cold/inflight build at 3s
  // (gexHeatmapMaxBlockMs) before falling back to stale-or-null — so a ticker with no recent
  // cache entry that gets stuck queuing behind dozens of concurrent siblings silently serves
  // null instead of its real (available) data. Reproduced live: the snapshot served
  // spot:null/gammaFlip:null for DIA/AAOI/DRAM/ZS/NOK while a solo GET
  // /api/market/gex-heatmap?ticker=<T> for each (no contention) returned available:true with a
  // real spot price seconds later. Same root-cause shape, same fix, as the already-fixed
  // vector-dark-pool-warm incident (FINDINGS.md 2026-09-02) on the UW side.
  const results = await runPolygonPool(
    tickers.map((raw) => async () => {
      try {
        const value = await buildVectorUniverseRow(raw, {
          recordWallHistory,
          sessionYmd,
          nowSec,
          recordNarrowedHorizons: true,
          wallWriteSource,
        });
        return { status: "fulfilled" as const, value };
      } catch (reason) {
        return { status: "rejected" as const, reason };
      }
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) rows.push(r.value.row);
  }

  // Retry pass for rows whose spot didn't resolve on the first attempt (2026-09-12 audit
  // finding). `isCompleteBuild`'s own bar only asks whether every ticker produced A row
  // (attempted === produced) — it says nothing about whether that row's PRICE resolved, and a
  // "complete" build can still be a majority-null one. Live-measured off-hours (cold caches):
  // GET /api/market/vector/universe served spot:null for 35 of 64 rows — every one of them a
  // STATIC allowlist name (`HEATMAP_EXTRA_LIQUID_TICKERS`: GOOG, BAC, GS, INTC, ORCL, TSM, UNH, V,
  // COIN, ...) that is not one of the ~11 UI preset chips, so none of them get direct member-view
  // traffic to keep their `fetchGexHeatmap` cache warm between cron ticks — while every preset
  // chip (SPY/QQQ/NVDA/TSLA/AAPL/...) resolved fine. A solo `GET /api/market/gex-heatmap` for
  // several of the null names (GOOG/BAC/COIN) reproduced the same `available:false` on a first,
  // uncontended call, then resolved with a real, current spot on a retry ~2-4s later — the build
  // that missed `fetchGexHeatmap`'s own live-request-tuned 3s block cap (`gexHeatmapMaxBlockMs`)
  // keeps running in the background (`heatmapInflight` is a shared, not-cancelled promise) and
  // finishes shortly after. This build has no such latency constraint (fire-and-forget cron with
  // a 180s route budget, or an inline scanner-poll rebuild nobody is holding a request open for),
  // so re-attempting just the null rows costs nothing on the common path (by the time the WHOLE
  // first pass across the universe has run, the earlier ticker's own background build has very
  // likely already finished and warmed the cache — this retry is then a cheap cache read, not a
  // second cold build) and self-heals the majority of these without touching the shared,
  // widely-used `fetchGexHeatmap`/`gexHeatmapMaxBlockMs` block-cap tuning at all.
  await retryNullSpotRows(rows, nowSec);

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  // Carry the COMPLETENESS of the fan-out, not just its survivors. Without this the caller cannot
  // tell "the universe is 4 tickers" from "17 of 21 lookups failed" — and it used to persist the
  // second as though it were the first. See vector-universe-merge.ts for the measured incident.
  //
  // `producedWithSpot` carries the SAME distinction one level deeper (2026-09-20 audit finding):
  // `rows.length` counts every ticker that returned A row object, even one with spot:null from a
  // block-cap timeout — see isCompleteBuild's doc comment in vector-universe-merge.ts.
  const producedWithSpot = rows.filter((r) => r.spot != null).length;
  return {
    ...roundFloats({ updatedAt: Date.now(), rows }),
    attempted: tickers.length,
    produced: rows.length,
    producedWithSpot,
  };
}

/**
 * Re-attempt, bounded and in place, every row whose spot came back null on the first pass — see
 * the call site's comment for the full incident this exists to fix. Deliberately does NOT pass
 * `recordWallHistory` (never re-records a bead-rail sample here): this only refreshes the row's
 * displayed price fields, and re-recording risks a duplicate/out-of-bucket wall-history write for
 * a tick already attempted once. A ticker that is genuinely, permanently unresolvable (no real
 * chain — the `NOSPOT`-shaped case) simply retries to another null and is left as first-built;
 * only a row that ACTUALLY resolves this time replaces the original.
 */
async function retryNullSpotRows(rows: VectorUniverseRow[], nowSec: number): Promise<void> {
  const pending = rows
    .map((row, index) => ({ ticker: row.ticker, index }))
    .filter(({ index }) => rows[index].spot == null);
  if (pending.length === 0) return;

  const retried = await runPolygonPool(
    pending.map(({ ticker }) => async () => {
      try {
        const built = await buildVectorUniverseRow(ticker, { recordWallHistory: false, nowSec });
        return built?.row ?? null;
      } catch {
        return null;
      }
    })
  );

  retried.forEach((row, i) => {
    if (row && row.spot != null) rows[pending[i].index] = row;
  });
}

const appendInFlight = new Map<string, Promise<void>>();

/**
 * Append one ticker to the warmed scanner snapshot when it is not already present.
 * Fire-and-forget helper for view registration — never throws into the hot path.
 */
export async function ensureTickerInUniverseSnapshot(rawTicker: string): Promise<void> {
  if (!isVectorTickerAllowed(rawTicker)) return;
  const ticker = normalizeVectorTicker(rawTicker);
  const existing = appendInFlight.get(ticker);
  if (existing) return existing;

  const p = (async () => {
    const snap = await loadVectorUniverseSnapshot();
    if (snap?.rows.some((r) => r.ticker === ticker)) return;

    const built = await buildVectorUniverseRow(ticker);
    if (!built) return;

    // Re-read immediately before writing, and merge through the same rule. `appendInFlight` only
    // dedups within ONE process; with several ECS tasks appending concurrently the old
    // load -> append -> store lost whichever write landed first. Re-reading narrows the window, and
    // merging means the loser contributes its row instead of erasing everyone else's.
    //
    // BUG FIX (2026-09-12 audit finding): this used to call mergeUniverseSnapshot with its DEFAULT
    // maxAgeMs (UNIVERSE_ROW_MAX_AGE_MS, 15 minutes) — a threshold tuned for the RTH cron's own
    // 5-minute rebuild cadence (three missed cron ticks = genuinely stale). But THIS call site fires
    // on a completely different, member-view-driven cadence that has no relationship to the cron at
    // all — a member (or Largo's get_gex_heatmap tool) can open any ticker at any hour, including
    // every evening after the cron's RTH gate stops firing and all weekend when it does not run at
    // all. Passing the cron's 15-minute threshold here meant a SINGLE ticker view, any time more than
    // 15 minutes had passed since the last full cron rebuild, expired the ENTIRE stored roster (every
    // row older than 15 minutes) and replaced it with just the one freshly-touched ticker.
    //
    // Reproduced live 2026-09-12 (Saturday, cron correctly RTH-gated off since Friday 20:00 UTC):
    // GET /api/market/vector/universe served only 5 rows (O, OR, ORC, ORCL, SPX — evidently a
    // handful of names opened piecemeal over the weekend) where the last complete cron build had
    // persisted 84. Every desk sharing this snapshot (Vector's own scanner table, Thermal's
    // heatmap-warm, Largo's Vector tool) was reading a near-empty universe any time it happened to
    // load between cron cycles. This is NOT the already-fixed "incomplete fan-out replaces a healthy
    // roster" bug (that one was about buildVectorUniverseSnapshot's OWN completeness gate, guarded by
    // isCompleteBuild) — it is the single-ticker append path silently applying the SAME pruning rule
    // outside the cadence it was calibrated for.
    //
    // Fix: this call's only job is to ADD one missing ticker, never to police the rest of the
    // roster's freshness — that pruning is already done correctly, on the right cadence, by the
    // cron's own refreshVectorUniverseSnapshot() merge (line ~538, unchanged). So this call passes an
    // effectively-unbounded maxAgeMs: no previously-stored row is ever expired here purely for being
    // "old" — the FUTURE_STAMP_TOLERANCE_MS clock-skew guard inside mergeUniverseSnapshot still
    // applies unchanged (it does not depend on maxAgeMs), so a bad future-dated row still gets
    // dropped, only genuine staleness-based pruning is deferred to the cron.
    const latest = (await loadVectorUniverseSnapshot()) ?? snap;
    const merged = mergeUniverseSnapshot(latest, [built.row], Date.now(), Number.POSITIVE_INFINITY);
    await persistVectorUniverseSnapshot(roundFloats({ updatedAt: Date.now(), rows: merged.rows }));
  })().finally(() => {
    appendInFlight.delete(ticker);
  });

  appendInFlight.set(ticker, p);
  return p;
}

function isStaticUniverseTicker(ticker: string): boolean {
  return vectorUniverseTickers().includes(ticker);
}

const sessionWarmInFlight = new Map<string, Promise<void>>();

/**
 * Seed today's bead rail when a dynamic ticker is opened for the first time.
 * Static allowlist names are already on the 5s universe recorder — skip them.
 * Deduped once per ticker per ET session so hot revisits do not fan out heatmap builds.
 */
export async function warmDynamicTickerSessionWall(rawTicker: string): Promise<void> {
  if (!isVectorTickerAllowed(rawTicker)) return;
  const ticker = normalizeVectorTicker(rawTicker);
  if (!ticker || isStaticUniverseTicker(ticker)) return;

  const sessionYmd = todayEtYmd();
  const dedupeKey = `vector:universe:session-warm:${ticker}:${sessionYmd}`;
  const inflightKey = `${ticker}:${sessionYmd}`;
  const existing = sessionWarmInFlight.get(inflightKey);
  if (existing) return existing;

  const p = (async () => {
    const already = await sharedCacheGet<boolean>(dedupeKey);
    if (already) return;

    const recorded = await recordVectorUniverseWallSample(ticker, {
      sessionYmd,
      bucketScope: "live",
      wallWriteSource: "dynamic-ticker-warm",
    });
    if (recorded) {
      await sharedCacheSet(dedupeKey, true, 24 * 3600);
    }
  })().finally(() => {
    sessionWarmInFlight.delete(inflightKey);
  });

  sessionWarmInFlight.set(inflightKey, p);
  return p;
}

/**
 * A member opened a ticker on Thermal, Helix, Vector, or asked Largo for its GEX heatmap — track
 * it in the (platform-wide, despite the module name) dynamic universe, surface it in the
 * scanner snapshot on the next poll (~5s), and seed today's bead rail for dynamic names.
 */
export function registerVectorUniverseView(rawTicker: string): void {
  void (async () => {
    try {
      await touchDynamicUniverse(rawTicker);
      await Promise.all([
        ensureTickerInUniverseSnapshot(rawTicker),
        warmDynamicTickerSessionWall(rawTicker),
      ]);
    } catch {
      /* best-effort: universe tracking must never disturb desk hot paths */
    }
  })();
}

export async function persistVectorUniverseSnapshot(snap: VectorUniverseSnapshot): Promise<void> {
  await sharedCacheSet(REDIS_KEY, snap, TTL_SEC);
}

export async function loadVectorUniverseSnapshot(): Promise<VectorUniverseSnapshot | null> {
  return sharedCacheGet<VectorUniverseSnapshot>(REDIS_KEY);
}

// In-flight dedup: a cache miss with N concurrent scanner polls must not fan
// out N × 21 heatmap builds. Keyed by build kind ("plain" | "record") so the
// non-recording scanner build and the recording cron build dedup separately.
const refreshInFlight = new Map<string, Promise<VectorUniverseSnapshot>>();

export async function refreshVectorUniverseSnapshot(
  opts: VectorUniverseBuildOpts = {}
): Promise<VectorUniverseSnapshot> {
  // In-flight dedup keys on the recorder intent: a scanner poll (no recording)
  // must not be able to satisfy — and thereby cancel the side effect of — the
  // cron's recording build by winning the race. Distinct keys keep at most one
  // build of each kind in flight.
  const key = opts.recordWallHistory ? "record" : "plain";
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const snap = await buildVectorUniverseSnapshot(opts);

    // A COMPLETE build is the roster and replaces outright. An INCOMPLETE one is a set of
    // OBSERVATIONS: merge it over what is stored, so a bad fan-out refreshes fewer rows instead of
    // deleting the universe. Measured on prod 2026-08-18 — an incomplete build persisted a
    // FOUR-ticker roster over a healthy 64-ticker one and it was served, ageing, for minutes.
    const producedWithSpot = snap.producedWithSpot ?? snap.produced ?? snap.rows.length;
    if (isCompleteBuild(snap.attempted ?? 0, snap.produced ?? snap.rows.length, producedWithSpot)) {
      await persistVectorUniverseSnapshot(snap);
      return snap;
    }

    const previous = await loadVectorUniverseSnapshot();
    const merged = mergeUniverseSnapshot(previous, snap.rows, Date.now());
    const out = { ...snap, updatedAt: Date.now(), rows: merged.rows };
    console.warn(
      `[vector-universe] incomplete build ${snap.produced ?? snap.rows.length}/${snap.attempted ?? 0} ` +
        `(${producedWithSpot} with usable spot) — ` +
        `merged (refreshed ${merged.refreshed}, carried ${merged.carried}, expired ${merged.expired}) ` +
        `-> ${merged.rows.length} rows`
    );
    await persistVectorUniverseSnapshot(out);
    return out;
  })().finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, p);
  return p;
}
