import type { ApiProviderId } from "@/lib/api-telemetry-types";
import { getProviderHealthSummary } from "@/lib/api-telemetry";

const TELEMETRY_TTL_SEC = 120;
const INSTANCE_SET_KEY = "telemetry:instances";

type InstanceTelemetryPayload = {
  instance_id: string;
  updated_at: string;
  rate_limits: Partial<Record<ApiProviderId, number>>;
  providers: Partial<
    Record<
      ApiProviderId,
      {
        calls_5m: number;
        errors_5m: number;
        last_at: string | null;
        last_status: number | null;
        last_ok: boolean;
      }
    >
  >;
};

// Back-off state: when redisClient() keeps returning null (no REDIS_URL or Redis
// persistently down) we skip the expensive buildInstancePayload() work for an
// increasing number of ticks instead of churning on every call.
let consecutiveMisses = 0;
let ticksToSkip = 0;
const MAX_BACKOFF_TICKS = 30; // caller cadence is on-demand (admin dashboard / market-health), not a fixed timer

// Singleton Redis client — created once and reused across all flush calls.
let _redisClient: import("ioredis").default | null = null;
let _redisClientInit: Promise<import("ioredis").default | null> | null = null;

function instanceId(): string {
  return (
    process.env.RAILWAY_REPLICA_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `pid-${process.pid}`
  );
}

function telemetryInstanceKey(id: string): string {
  return `telemetry:instance:${id}`;
}

async function redisClient() {
  if (_redisClient) return _redisClient;
  if (_redisClientInit) return _redisClientInit;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  _redisClientInit = (async () => {
    try {
      const { makeRedis } = await import("./make-redis");
      const client = await makeRedis("api-telemetry-redis", url, { maxRetriesPerRequest: 1 });
      _redisClient = client;
      return client;
    } catch {
      _redisClientInit = null; // allow retry on next call
      return null;
    }
  })();

  return _redisClientInit;
}

function buildInstancePayload(): InstanceTelemetryPayload {
  const health = getProviderHealthSummary(5 * 60_000);
  const providers: InstanceTelemetryPayload["providers"] = {};

  for (const [provider, row] of Object.entries(health.by_provider)) {
    providers[provider as ApiProviderId] = {
      calls_5m: row.calls_5m,
      errors_5m: row.errors_5m,
      last_at: row.last_at,
      last_status: row.last_status,
      last_ok: row.last_ok,
    };
  }

  return {
    instance_id: instanceId(),
    updated_at: new Date().toISOString(),
    rate_limits: health.rate_limits,
    providers,
  };
}

export async function flushTelemetryToRedis(): Promise<void> {
  // Back-off: while Redis has been persistently unavailable, skip whole calls so
  // we neither rebuild the payload nor re-attempt a connect on every invocation.
  if (ticksToSkip > 0) {
    ticksToSkip -= 1;
    return;
  }

  const client = await redisClient();
  if (!client) {
    consecutiveMisses += 1;
    // Exponential-ish back-off, capped: skip 1,2,4,... up to MAX_BACKOFF_TICKS.
    ticksToSkip = Math.min(2 ** Math.min(consecutiveMisses - 1, 5), MAX_BACKOFF_TICKS);
    return;
  }
  consecutiveMisses = 0;
  ticksToSkip = 0;

  const id = instanceId();
  const payload = buildInstancePayload();
  const key = `blackout:${telemetryInstanceKey(id)}`;

  try {
    await client.set(key, JSON.stringify(payload), "EX", TELEMETRY_TTL_SEC);
    await client.sadd(`blackout:${INSTANCE_SET_KEY}`, id);
    await client.expire(`blackout:${INSTANCE_SET_KEY}`, TELEMETRY_TTL_SEC * 2);
  } catch {
    /* ignore */
  }
}

export async function readCrossInstanceTelemetry(): Promise<{
  instances_reporting: number;
  rate_limits: Partial<Record<ApiProviderId, number>>;
  providers: Partial<Record<ApiProviderId, { calls_5m: number; errors_5m: number }>>;
} | null> {
  const client = await redisClient();
  if (!client) return null;

  try {
    const ids = await client.smembers(`blackout:${INSTANCE_SET_KEY}`);
    if (!ids.length) return null;

    const keys = ids.map((id) => `blackout:${telemetryInstanceKey(id)}`);
    const rawRows = await client.mget(...keys);

    const rate_limits: Partial<Record<ApiProviderId, number>> = {};
    const providers: Partial<Record<ApiProviderId, { calls_5m: number; errors_5m: number }>> = {};
    let reporting = 0;

    for (const raw of rawRows) {
      if (!raw) continue;
      try {
        const row = JSON.parse(raw) as InstanceTelemetryPayload;
        reporting += 1;
        for (const [provider, count] of Object.entries(row.rate_limits ?? {})) {
          const p = provider as ApiProviderId;
          rate_limits[p] = (rate_limits[p] ?? 0) + (count ?? 0);
        }
        for (const [provider, stats] of Object.entries(row.providers ?? {})) {
          const p = provider as ApiProviderId;
          const prev = providers[p] ?? { calls_5m: 0, errors_5m: 0 };
          providers[p] = {
            calls_5m: prev.calls_5m + (stats?.calls_5m ?? 0),
            errors_5m: prev.errors_5m + (stats?.errors_5m ?? 0),
          };
        }
      } catch {
        /* skip bad row */
      }
    }

    // The instance SET has a longer TTL (2x) than each instance's own data key, specifically
    // so a brief flush gap doesn't drop an instance from the roster mid-expiry. But that means
    // there is a real window where every id in the set still resolves (smembers succeeds) while
    // every one of their data keys has already expired (e.g. a Redis blip longer than one data
    // key's TTL but shorter than the set's) — every `raw` above is null, nothing ever runs the
    // `reporting += 1` line, and this would otherwise return a NON-null object with empty
    // `providers`/`rate_limits` maps. Callers (deriveClusterCallsByProvider1m,
    // admin-api-dashboard.ts, market-health.ts) all treat `null` as "no cluster data, fall back
    // to local" but treat a present-but-empty object as real cluster data showing zero usage —
    // the exact opposite of what's true here, and it silently zeroes out genuine local telemetry
    // (e.g. real-time rate-quota headroom) right when Redis itself is unstable. Report the same
    // "no data" signal (null) as the zero-ids case just above, instead of a hollow success.
    if (reporting === 0) return null;

    return { instances_reporting: reporting, rate_limits, providers };
  } catch {
    return null;
  }
}
