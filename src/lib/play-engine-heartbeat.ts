import { dbConfigured, getMeta, setMeta } from "@/lib/db";

export type PlayEngineTickSource = "cron" | "admin_live" | "evaluate";

const HEARTBEAT_META_KEY = "spx_play_engine_heartbeat";

let lastTickAt: string | null = null;
let lastSource: PlayEngineTickSource | null = null;
let tickCount = 0;

// EDGE-11 fix: record the moment this process started so the admin panel can
// distinguish "0 ticks since the last deploy" from "this engine has never
// ticked". The value is stable for the lifetime of the process.
const processStartedAt = new Date().toISOString();

// EDGE-11 fix: track whether we have already hydrated tickCount from the DB
// after startup so recordPlayEngineTick() picks up the persisted value before
// incrementing rather than starting from 0.
let initialized = false;

type HeartbeatPayload<Source extends string> = {
  last_tick_at: string;
  last_source: Source;
  tick_count: number;
  last_restart_at?: string;
};

function buildHeartbeat() {
  const now = Date.now();
  const ageMs = lastTickAt ? now - new Date(lastTickAt).getTime() : null;
  return {
    last_tick_at: lastTickAt,
    last_source: lastSource,
    tick_count: tickCount,
    last_restart_at: processStartedAt,
    age_ms: ageMs,
    stale: ageMs != null && ageMs > 5 * 60_000,
    critical_stale: ageMs != null && ageMs > 10 * 60_000,
  };
}

function applyHeartbeatPayload(payload: HeartbeatPayload<PlayEngineTickSource>): void {
  lastTickAt = payload.last_tick_at;
  lastSource = payload.last_source;
  tickCount = payload.tick_count;
}

// EDGE-11 fix: read the last persisted tick_count from the DB so that after a
// restart we continue from the stored value instead of resetting to 0.
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true; // mark eagerly so concurrent callers don't double-read
  if (!dbConfigured()) return;
  try {
    const raw = await getMeta(HEARTBEAT_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HeartbeatPayload<PlayEngineTickSource>;
      if (parsed.last_tick_at) applyHeartbeatPayload(parsed);
    }
  } catch (err) {
    console.warn("[play-engine-heartbeat] init hydration failed:", err);
  }
}

export async function recordPlayEngineTick(source: PlayEngineTickSource): Promise<void> {
  // EDGE-11 fix: hydrate from DB before the first increment so the count is
  // continuous across process restarts.
  await ensureInitialized();

  lastTickAt = new Date().toISOString();
  lastSource = source;
  tickCount += 1;

  if (!dbConfigured()) return;

  const payload: HeartbeatPayload<PlayEngineTickSource> = {
    last_tick_at: lastTickAt,
    last_source: source,
    tick_count: tickCount,
    last_restart_at: processStartedAt,
  };

  try {
    await setMeta(HEARTBEAT_META_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[play-engine-heartbeat] persist failed:", err);
  }
}

/** Load heartbeat from DB (cross-replica) with in-memory read-through cache. */
export async function loadPlayEngineHeartbeat() {
  if (dbConfigured()) {
    try {
      const raw = await getMeta(HEARTBEAT_META_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as HeartbeatPayload<PlayEngineTickSource>;
        if (parsed.last_tick_at) applyHeartbeatPayload(parsed);
      }
    } catch (err) {
      console.warn("[play-engine-heartbeat] load failed:", err);
    }
  }
  return buildHeartbeat();
}

/** Sync read of in-process cache — prefer loadPlayEngineHeartbeat for admin health. */
export function getPlayEngineHeartbeat() {
  return buildHeartbeat();
}

// ---------------------------------------------------------------------------
// NH-R10: generalized engine-heartbeat factory, reused (not shared state) by
// the Night Hawk 0DTE scan below.
//
// WHY A FACTORY INSTEAD OF PARAMETERIZING recordPlayEngineTick() ITSELF: the
// SPX functions above are read by admin-cron-health.ts and other established
// callers with today's exact signatures (`recordPlayEngineTick(source)` with
// no engine argument, module-level `lastTickAt`/`lastSource`/`tickCount`
// variables). Adding an `engineName` parameter to those functions — or
// collapsing their module-level state into a shared keyed map — risks a typo
// or refactor slip silently misfiling a tick under the wrong engine, which
// would corrupt the exact staleness signal this module exists to protect.
// Instead, `createEngineHeartbeat()` below packages the identical
// hydrate/tick/stale-threshold logic behind its own private closure state and
// its own meta key, so the Night Hawk 0DTE tracker below is a genuinely
// separate instance with zero shared mutable state — the SPX code path
// above is untouched byte-for-byte other than widening one internal type
// (`HeartbeatPayload`) to be generic over its `Source` union so both
// trackers can reuse the type shape.
// ---------------------------------------------------------------------------

type EngineHeartbeatSnapshot<Source extends string> = {
  last_tick_at: string | null;
  last_source: Source | null;
  tick_count: number;
  last_restart_at: string;
  age_ms: number | null;
  stale: boolean;
  critical_stale: boolean;
};

function createEngineHeartbeat<Source extends string>(metaKey: string) {
  let tickAt: string | null = null;
  let source: Source | null = null;
  let count = 0;
  let hydrated = false;
  const startedAt = new Date().toISOString();

  function snapshot(): EngineHeartbeatSnapshot<Source> {
    const now = Date.now();
    const ageMs = tickAt ? now - new Date(tickAt).getTime() : null;
    return {
      last_tick_at: tickAt,
      last_source: source,
      tick_count: count,
      last_restart_at: startedAt,
      age_ms: ageMs,
      stale: ageMs != null && ageMs > 5 * 60_000,
      critical_stale: ageMs != null && ageMs > 10 * 60_000,
    };
  }

  function apply(payload: HeartbeatPayload<Source>): void {
    tickAt = payload.last_tick_at;
    source = payload.last_source;
    count = payload.tick_count;
  }

  async function ensureHydrated(): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    if (!dbConfigured()) return;
    try {
      const raw = await getMeta(metaKey);
      if (raw) {
        const parsed = JSON.parse(raw) as HeartbeatPayload<Source>;
        if (parsed.last_tick_at) apply(parsed);
      }
    } catch (err) {
      console.warn(`[engine-heartbeat:${metaKey}] init hydration failed:`, err);
    }
  }

  async function recordTick(tickSource: Source): Promise<void> {
    await ensureHydrated();

    tickAt = new Date().toISOString();
    source = tickSource;
    count += 1;

    if (!dbConfigured()) return;

    const payload: HeartbeatPayload<Source> = {
      last_tick_at: tickAt,
      last_source: tickSource,
      tick_count: count,
      last_restart_at: startedAt,
    };

    try {
      await setMeta(metaKey, JSON.stringify(payload));
    } catch (err) {
      console.warn(`[engine-heartbeat:${metaKey}] persist failed:`, err);
    }
  }

  async function load(): Promise<EngineHeartbeatSnapshot<Source>> {
    if (dbConfigured()) {
      try {
        const raw = await getMeta(metaKey);
        if (raw) {
          const parsed = JSON.parse(raw) as HeartbeatPayload<Source>;
          if (parsed.last_tick_at) apply(parsed);
        }
      } catch (err) {
        console.warn(`[engine-heartbeat:${metaKey}] load failed:`, err);
      }
    }
    return snapshot();
  }

  function getSync(): EngineHeartbeatSnapshot<Source> {
    return snapshot();
  }

  return { recordTick, load, getSync };
}

export type ZeroDteScanTickSource = "cron" | "member_poll";

const ZERO_DTE_SCAN_HEARTBEAT_META_KEY = "zerodte_scan_heartbeat";

const zeroDteScanHeartbeat = createEngineHeartbeat<ZeroDteScanTickSource>(
  ZERO_DTE_SCAN_HEARTBEAT_META_KEY
);

/** Record one Night Hawk 0DTE scan cycle tick (call from warmZeroDteBoard's
 *  cron cadence — the always-on scanner tick, not the member-poll board route). */
export async function recordZeroDteScanTick(source: ZeroDteScanTickSource): Promise<void> {
  await zeroDteScanHeartbeat.recordTick(source);
}

/** Load the 0DTE scan heartbeat from DB (cross-replica) with in-memory read-through cache. */
export async function loadZeroDteScanHeartbeat(): Promise<EngineHeartbeatSnapshot<ZeroDteScanTickSource>> {
  return zeroDteScanHeartbeat.load();
}

/** Sync read of in-process cache — prefer loadZeroDteScanHeartbeat for admin health. */
export function getZeroDteScanHeartbeat(): EngineHeartbeatSnapshot<ZeroDteScanTickSource> {
  return zeroDteScanHeartbeat.getSync();
}
