import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { normalizeVectorTicker, isVectorTickerAllowed } from "./vector-ticker";

/**
 * DYNAMIC UNIVERSE — "open it once and the platform keeps it warm" (user-directed, 2026-07-13;
 * generalized beyond Vector 2026-08-01 — see below). Despite the module path, this is now a
 * PLATFORM-WIDE shared ticker set, not a Vector-only concept — every product below writes and
 * reads the same underlying Redis map.
 *
 * The static ~22-name universe is the only set the 5-min recorder cron covered, so any other
 * ticker's rail existed only while someone was actively viewing it — the next morning it started
 * from scratch ("first thing I see is one bead"). This module makes every VIEWED ticker part of
 * the recorded universe automatically:
 *
 *  - `touchDynamicUniverse(ticker)` (via `registerVectorUniverseView`) fires when a member opens
 *    the ticker on **Vector**, **Thermal** (gex-heatmap route), **Helix** (flows filter/stream),
 *    or asks **Largo** for a ticker's GEX heatmap (`get_gex_heatmap` tool) — debounced per
 *    process, fire-and-forget. Night Hawk is deliberately NOT wired in here: its ticker universe
 *    is discovery-driven (flow/breakout/pin scanners), not a member opening a specific symbol, so
 *    a per-viewer "touch" has nothing to attach to — if Night Hawk ever needs its board's active
 *    tickers kept warm, that should be a bulk union of discovery output, not this per-view path.
 *  - The recorder cron unions `listDynamicUniverseTickers()` into its ticker set, so a name viewed
 *    today is recorded from TOMORROW'S OPENING BELL onward, viewer or not.
 *  - `warmDynamicTickerSessionWall` (via `registerVectorUniverseView`) also seeds TODAY's bead rail
 *    on first open so dynamic names do not start with an empty morning rail.
 *  - Thermal `heatmap-warm` uses the SAME union (`listSharedUniverseTickers`) so a viewed name's
 *    GEX matrix stays cache-hot for every consumer — one shared sticky universe, not N lists.
 *  - Retention: names not viewed for RETENTION_DAYS drop out (a one-time curiosity must not tax
 *    the cron forever — reopening re-adds instantly). Capacity: newest CAP names by last-view
 *    (recording is Polygon-cache work per ticker per 5 min; the cap bounds cron runtime).
 *  - Membership in this set is a warm-cache/background-recording concern ONLY — it never gates
 *    whether a member can see a ticker's live GEX/VEX matrix. /api/market/gex-heatmap serves any
 *    syntactically valid ticker on demand (cold-fetching from Polygon if not cache-warm)
 *    regardless of universe membership.
 *
 * Storage is one shared-Redis map (ticker → lastViewedMs) so all replicas and the cron task see
 * the same set. Concurrent touches do read-modify-write and can lose a race — acceptable: the
 * loser's ticker is re-added on its next touch, and nothing here is a source of truth for money.
 */
const KEY = "vector:universe:dynamic";
/** Redis TTL — comfortably beyond retention so the map never silently vanishes mid-window. */
const KEY_TTL_SEC = 45 * 24 * 3600;
export const DYNAMIC_UNIVERSE_RETENTION_DAYS = 14;
// 100, not 30 (user-directed): many members will be opening names. Recording is Polygon-cache
// work per ticker per 5 min; at 100 the cron still fits its window because fetchGexHeatmap is
// Redis-cache-first (warm names are near-free). Chunked cron processing is queued as hardening.
export const DYNAMIC_UNIVERSE_CAP = 100;
/** Per-process debounce: a hot ticker with many viewers touches Redis at most once per window. */
const TOUCH_DEBOUNCE_MS = 10 * 60 * 1000;

type DynamicMap = Record<string, number>;

const lastTouch = new Map<string, number>();

/** Static-universe membership (uppercased) — static names never need dynamic tracking. */
function isStatic(ticker: string): boolean {
  return vectorUniverseTickers().includes(ticker);
}

/**
 * Prune helper (pure, tested): drop entries older than retention, then keep the newest `cap`
 * by last-view. Exported for tests.
 */
export function pruneDynamicUniverse(
  map: DynamicMap,
  nowMs: number,
  opts: { retentionMs?: number; cap?: number } = {}
): DynamicMap {
  const retentionMs = opts.retentionMs ?? DYNAMIC_UNIVERSE_RETENTION_DAYS * 24 * 3600 * 1000;
  const cap = opts.cap ?? DYNAMIC_UNIVERSE_CAP;
  const fresh = Object.entries(map).filter(
    ([t, at]) => typeof at === "number" && Number.isFinite(at) && nowMs - at <= retentionMs && t
  );
  fresh.sort((a, b) => b[1] - a[1]); // newest first
  return Object.fromEntries(fresh.slice(0, cap));
}

/**
 * Record that a member opened `ticker` on Vector. Fire-and-forget; never throws.
 *
 * `isVectorTickerAllowed` (vector-ticker.ts) is a SYNTAX gate only, by design — Vector serves any
 * well-formed symbol on demand so a member can look up a name outside the preset universe. That
 * design is correct for the live, on-demand view, but this function feeds a DIFFERENT, higher-
 * stakes path: the cron-recorded, every-member-visible shared universe. A one-time typo view (a
 * real live incident: "NFLIX" for NFLX) satisfied the syntax gate and got pinned into this map
 * forever, since nothing here ever asked whether the symbol has real options data — the 5-min
 * recorder cron then kept re-warming a name that will never produce one, and every member's
 * `/api/market/vector/universe` served a permanent dead row. This confirms the ticker resolves to
 * a REAL, optionable symbol (a positive spot from the live matrix) before writing it into the
 * shared map — `fetchGexHeatmap` is Redis-cache-first, so this costs nothing extra once a ticker
 * is warm, and the debounce below still applies to failed lookups so a repeatedly-opened typo
 * isn't re-validated on every view.
 *
 * P2 FOLLOW-UP (2026-09-02, live monitor): the FIRST fix here (#3348, merged the same morning)
 * checked `hm?.spot == null`, which never actually fires. `GexHeatmap.spot` is typed `number`, not
 * `number | null` — a ticker `fetchGexHeatmap` cannot price returns `emptyHeatmap()`
 * (polygon-options-gex.ts), whose `spot` field is `ctx?.spot ?? 0`, i.e. the real "unresolvable"
 * sentinel is `0`, never `null`/`undefined`. `hm` itself is only `null`/`undefined` on a total
 * fetch failure (not configured, or `resolveOptionsRoot` can't even parse a root) — an outcome
 * `.catch(() => null)` above already produces the same way. So the `== null` guard could only ever
 * catch that total-failure case; every "syntactically valid, no real chain" ticker — exactly the
 * NFLIX-typo shape this fix exists to stop — sailed through with `hm.spot === 0`, which is not
 * `null`, and got pinned anyway. Confirmed live: `/api/market/vector/universe` was still serving
 * dead rows (`spot: 0`) for "NFLIX", plus two more (`LAST`, `SOX`) that are NOT in the static
 * allowlist, so they can only have entered through this same broken guard — including possibly
 * AFTER #3348 shipped, since nothing about that fix could have blocked a fresh spot:0 write either.
 * Every other `.spot` consumer in the codebase (vector-screener.ts, vector-play-engine.ts,
 * vector-play-bootstrap.ts, watch-track.ts, condor-render.ts, …) already guards `spot <= 0`
 * alongside the null check — this was the one call site that didn't, now brought in line.
 */
export async function touchDynamicUniverse(rawTicker: string): Promise<void> {
  try {
    if (!isVectorTickerAllowed(rawTicker)) return;
    const ticker = normalizeVectorTicker(rawTicker);
    if (!ticker || isStatic(ticker)) return;
    const now = Date.now();
    const prev = lastTouch.get(ticker);
    if (prev != null && now - prev < TOUCH_DEBOUNCE_MS) return;
    lastTouch.set(ticker, now);
    const hm = await fetchGexHeatmap(ticker).catch(() => null);
    if (!hm || !(hm.spot > 0)) return;
    const map = (await sharedCacheGet<DynamicMap>(KEY)) ?? {};
    map[ticker] = now;
    await sharedCacheSet(KEY, pruneDynamicUniverse(map, now), KEY_TTL_SEC);
  } catch {
    /* best-effort: universe tracking must never disturb the live stream */
  }
}

/** The dynamic names the recorder cron should union into its ticker set. Never throws. */
export async function listDynamicUniverseTickers(): Promise<string[]> {
  try {
    const map = (await sharedCacheGet<DynamicMap>(KEY)) ?? {};
    return Object.keys(pruneDynamicUniverse(map, Date.now()));
  } catch {
    return [];
  }
}

/**
 * Self-heal: drop a dynamic entry that no longer resolves to a real, optionable chain.
 *
 * `touchDynamicUniverse` validates `spot > 0` before WRITING a new entry (see its own comment for
 * the live "NFLIX"/"LAST"/"SOX" incident that guard was built to stop), but that guard only ever
 * blocked NEW dead writes. An entry pinned BEFORE that fix — or one whose underlying chain later
 * stopped resolving for some other reason — has no removal path: `pruneDynamicUniverse` only drops
 * entries by AGE (retention/cap), never by whether the ticker still prices. So a dead row can sit
 * in every member's `/api/market/vector/universe` response, permanently spot:0, for up to
 * `DYNAMIC_UNIVERSE_RETENTION_DAYS` (14 days) — confirmed live 2026-09-03: "NFLIX"/"LAST"/"SOX"
 * were still being served with `spot: 0` well after the write-side fix (#3348/P2-followup) shipped,
 * because nothing ever removed the already-bad entries the earlier fix could not have prevented.
 *
 * Called from the universe row builder (vector-universe.ts) whenever a DYNAMIC ticker's freshly
 * fetched matrix fails to resolve a real spot — the same `spot > 0` test `touchDynamicUniverse`
 * already applies on write, now also applied on read so a dead entry self-heals within one cycle
 * instead of waiting out the retention window. No-ops for static-allowlist tickers (never dynamic,
 * never removable this way) and is best-effort/fire-and-forget like every other function here.
 */
export async function removeDynamicUniverseTicker(rawTicker: string): Promise<void> {
  try {
    const ticker = normalizeVectorTicker(rawTicker);
    if (!ticker || isStatic(ticker)) return;
    const map = (await sharedCacheGet<DynamicMap>(KEY)) ?? {};
    if (!(ticker in map)) return;
    delete map[ticker];
    await sharedCacheSet(KEY, map, KEY_TTL_SEC);
  } catch {
    /* best-effort: universe tracking must never disturb the live stream */
  }
}

/**
 * Shared Thermal + Vector warm/record universe: static allowlist ∪ dynamic (≤100, 14d).
 * Pure merge helper also exported for tests — never invents tickers beyond the two inputs.
 */
export function mergeSharedUniverseTickers(
  staticTickers: readonly string[],
  dynamicTickers: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...staticTickers, ...dynamicTickers]) {
    const t = String(raw ?? "").trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * One shared sticky universe for Thermal matrix warm + Vector bead recording.
 * Static allowlist always included; dynamic names are member-viewed (cap 100 / 14d).
 */
export async function listSharedUniverseTickers(): Promise<string[]> {
  const dynamic = await listDynamicUniverseTickers();
  return mergeSharedUniverseTickers(vectorUniverseTickers(), dynamic);
}
