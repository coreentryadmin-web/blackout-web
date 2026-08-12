import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  computeGexWalls,
  mapFromStrikeTotalsRecord,
} from "@/lib/providers/gex-wall-levels";
import { listSharedUniverseTickers, touchDynamicUniverse } from "./vector-dynamic-universe";
import { isVectorTickerAllowed, normalizeVectorTicker } from "./vector-ticker";
import { roundFloats } from "@/lib/round-floats";
import { bucketWallSampleTime, buildWallHistorySample } from "./vector-wall-sample";
import { wallTrailSampleSecForTicker } from "./vector-wall-sample-server";
import { appendSessionWallSample } from "./vector-wall-persist";
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
  } = {}
): Promise<VectorUniverseRow | null> {
  const {
    recordWallHistory = false,
    sessionYmd,
    nowSec = Math.floor(Date.now() / 1000),
    bucketScope = "universe",
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

  if (recordWallHistory && sessionYmd) {
    const sampleTime = bucketWallSampleTime(nowSec, wallTrailSampleSecForTicker(ticker, bucketScope));
    const sample = buildWallHistorySample({
      time: sampleTime,
      gexWalls,
      gammaFlip: hm?.gex?.flip ?? null,
      vexWalls,
      vexFlip: hm?.vex?.flip ?? null,
    });
    // The blended rail and the three narrowed rails are SEPARATE storage keys, so they were being
    // written one after another — four sequential Redis round-trips per ticker, times ~122 tickers
    // per sweep. Writing them together removes that serial tail; they cannot conflict because each
    // targets its own (ticker, horizon) rail.
    const writes: Promise<unknown>[] = [];
    if (sample) writes.push(appendSessionWallSample(sessionYmd, sample, ticker));

    if (spot && spot > 0) {
      const narrowed = await buildNarrowedHorizonWallSamples(ticker, sampleTime, {
        walls: gexWalls,
        flip: hm?.gex?.flip ?? null,
      });
      for (const r of narrowed) {
        if (r.sample) writes.push(appendSessionWallSample(sessionYmd, r.sample, ticker, r.horizon));
        else if (r.source === "error") {
          console.warn(
            `[vector-universe] ${ticker} ${r.horizon} narrowed-wall recording threw: ${r.reason ?? "unknown"}`
          );
        }
      }
    }
    // allSettled, not all: one rail failing must not abort the others or reject this ticker's
    // whole sample. appendSessionWallSample already swallows and logs its own errors, so this is
    // belt-and-braces against an unexpected throw.
    if (writes.length > 0) await Promise.allSettled(writes);
  }

  const asOfMs = hm?.asof ? Date.parse(hm.asof) : NaN;
  return {
    ticker,
    spot,
    gammaFlip: hm?.gex?.flip ?? null,
    vexFlip: hm?.vex?.flip ?? null,
    topCallWall: gexWalls.callWalls[0]?.strike ?? null,
    topPutWall: gexWalls.putWalls[0]?.strike ?? null,
    topCallPct: gexWalls.callWalls[0]?.pct ?? null,
    topPutPct: gexWalls.putWalls[0]?.pct ?? null,
    asOf: Number.isFinite(asOfMs) ? asOfMs : null,
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
  }
): Promise<boolean> {
  const row = await buildVectorUniverseRow(raw, {
    recordWallHistory: true,
    sessionYmd: opts.sessionYmd,
    nowSec: opts.nowSec ?? Math.floor(Date.now() / 1000),
    bucketScope: opts.bucketScope ?? "universe",
  });
  return row != null;
}

export async function buildVectorUniverseSnapshot(
  opts: VectorUniverseBuildOpts = {}
): Promise<VectorUniverseSnapshot> {
  const { recordWallHistory = false, sessionYmd } = opts;
  // Shared sticky universe with Thermal heatmap-warm: static allowlist ∪ dynamic (≤100 / 14d).
  // Dynamic names are Polygon-cache-first once warm; `registerVectorUniverseView` also appends a
  // single row immediately after a Thermal/Helix/Vector view so the scanner does not wait for the
  // next full rebuild.
  const tickers = await listSharedUniverseTickers();
  const rows: VectorUniverseRow[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  const results = await Promise.allSettled(
    tickers.map((raw) =>
      buildVectorUniverseRow(raw, { recordWallHistory, sessionYmd, nowSec })
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) rows.push(r.value);
  }

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return roundFloats({ updatedAt: Date.now(), rows });
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

    const row = await buildVectorUniverseRow(ticker);
    if (!row) return;

    const mergedRows = [...(snap?.rows ?? []).filter((r) => r.ticker !== ticker), row];
    mergedRows.sort((a, b) => a.ticker.localeCompare(b.ticker));
    await persistVectorUniverseSnapshot(roundFloats({ updatedAt: Date.now(), rows: mergedRows }));
  })().finally(() => {
    appendInFlight.delete(ticker);
  });

  appendInFlight.set(ticker, p);
  return p;
}

/**
 * A member opened a ticker on Thermal, Helix, Vector, or asked Largo for its GEX heatmap — track
 * it in the (platform-wide, despite the module name) dynamic universe and surface it in the
 * scanner snapshot on the next poll (~5s) without waiting for the cron rebuild.
 */
export function registerVectorUniverseView(rawTicker: string): void {
  void (async () => {
    try {
      await touchDynamicUniverse(rawTicker);
      await ensureTickerInUniverseSnapshot(rawTicker);
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
    await persistVectorUniverseSnapshot(snap);
    return snap;
  })().finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, p);
  return p;
}
