// Per-user server-side cooldown for POST /api/membership/sync.
// Fail-OPEN: if Redis is unavailable or errors, the sync is always allowed —
// a Redis outage must never block legitimate membership syncs.

const COOLDOWN_SEC = Number(process.env.MEMBERSHIP_SYNC_COOLDOWN_SEC ?? 45);

function key(userId: string): string {
  return `membership-sync:${userId}`;
}

let _redisClient: import("ioredis").default | null = null;
let _connectingPromise: Promise<import("ioredis").default | null> | null = null;

async function getRedis(): Promise<import("ioredis").default | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (_redisClient) return _redisClient;
  if (_connectingPromise) return _connectingPromise;
  _connectingPromise = (async () => {
    try {
      const mod = await import("ioredis");
      const Redis = mod.default;
      const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 2_000,
      });
      // Required: without an 'error' listener ioredis throws on the EventEmitter
      // when the connection drops post-connect, crashing the replica.
      client.on("error", (err) =>
        console.warn("[membership-sync-limit] redis error:", err instanceof Error ? err.message : err)
      );
      await client.connect();
      _redisClient = client;
      return _redisClient;
    } catch {
      return null;
    } finally {
      _connectingPromise = null;
    }
  })();
  return _connectingPromise;
}

export type SyncSlot = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Atomically claims a per-user sync slot. Returns ok:true if the caller may proceed,
 * or ok:false (with retryAfterSec) if the user is still within the cooldown window.
 * FAILS OPEN (ok:true) when Redis is absent or errors.
 */
export async function acquireMembershipSyncSlot(userId: string): Promise<SyncSlot> {
  const redis = await getRedis();
  if (!redis) return { ok: true }; // fail-open: no Redis configured
  try {
    // SET NX EX — atomic: 'OK' means we claimed the slot, null means it is held.
    const claimed = await redis.set(key(userId), "1", "EX", COOLDOWN_SEC, "NX");
    if (claimed === "OK") return { ok: true };
    const ttl = await redis.ttl(key(userId));
    return { ok: false, retryAfterSec: ttl > 0 ? ttl : COOLDOWN_SEC };
  } catch (err) {
    // fail-open: a Redis outage must not block legitimate syncs
    console.warn("[membership-sync-limit] redis check failed, allowing sync:", err);
    return { ok: true };
  }
}
