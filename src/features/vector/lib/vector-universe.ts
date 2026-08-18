import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import { listSharedUniverseTickers, touchDynamicUniverse } from "./vector-dynamic-universe";
import { isVectorTickerAllowed, normalizeVectorTicker } from "./vector-ticker";
import { roundFloats } from "@/lib/round-floats";
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
    /** 0DTE/weekly/monthly rails — expensive (3 extra scoped reads). Off on the 5s universe sweep. */
    recordNarrowedHorizons?: boolean;
    wallWriteSource?: WallWriteSource;
  } = {}
): Promise<{ row: VectorUniverseRow; historyRecorded: boolean } | null> {
  const {
    recordWallHistory = false,
    sessionYmd,
    nowSec = Math.floor(Date.now() / 1000),
    bucketScope = "universe",
    recordNarrowedHorizons = true,
    wallWriteSource = bucketScope === "live" ? "bead-recorder-active" : "bead-recorder-universe",
  } = opts;
  const ticker = normalizeVectorTicker(raw);
  const hm = await fetchGexHeatmap(ticker);
  const spot = hm?.spot ?? null;
  const gexWalls = hm?.gex?.strike_totals
    ? computeGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals), {
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
      gexWalls,
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

    if (recordNarrowedHorizons && spot && spot > 0) {
      const narrowed = await buildNarrowedHorizonWallSamples(ticker, sampleTime, {
        walls: gexWalls,
        flip: hm?.gex?.flip ?? null,
      });
      for (const r of narrowed) {
        if (r.sample) {
          writes.push(
            writeWallHistorySample({
              source: wallWriteSource,
              sessionYmd,
              ticker,
              sample: r.sample,
              horizon: r.horizon,
            })
          );
        } else if (r.source === "error") {
          console.warn(
            `[vector-universe] ${ticker} ${r.horizon} narrowed-wall recording threw: ${r.reason ?? "unknown"}`
          );
        }
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
    // 5s universe sweep: blended rail only — narrowed horizons stay on the 5-min cron + live viewers.
    recordNarrowedHorizons: bucketScope === "live",
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

  const results = await Promise.allSettled(
    tickers.map((raw) =>
      buildVectorUniverseRow(raw, {
        recordWallHistory,
        sessionYmd,
        nowSec,
        recordNarrowedHorizons: true,
        wallWriteSource,
      })
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) rows.push(r.value.row);
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  // Carry the COMPLETENESS of the fan-out, not just its survivors. Without this the caller cannot
  // tell "the universe is 4 tickers" from "17 of 21 lookups failed" — and it used to persist the
  // second as though it were the first. See vector-universe-merge.ts for the measured incident.
  return {
    ...roundFloats({ updatedAt: Date.now(), rows }),
    attempted: tickers.length,
    produced: rows.length,
  };
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
    const latest = (await loadVectorUniverseSnapshot()) ?? snap;
    const merged = mergeUniverseSnapshot(latest, [built.row], Date.now());
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
    if (isCompleteBuild(snap.attempted ?? 0, snap.produced ?? snap.rows.length)) {
      await persistVectorUniverseSnapshot(snap);
      return snap;
    }

    const previous = await loadVectorUniverseSnapshot();
    const merged = mergeUniverseSnapshot(previous, snap.rows, Date.now());
    const out = { ...snap, updatedAt: Date.now(), rows: merged.rows };
    console.warn(
      `[vector-universe] incomplete build ${snap.produced ?? snap.rows.length}/${snap.attempted ?? 0} — ` +
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
