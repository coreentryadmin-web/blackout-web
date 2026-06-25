// Cross-replica idempotency guard for incoming webhooks, keyed on the provider's
// unique message id (e.g. the svix `webhook-id` header Clerk sends). A re-delivered
// webhook (same id) must not double-process.
//
// Mirrors the Redis SET NX EX pattern in membership-sync-limit.ts: one atomic claim
// per message id, with a TTL so the dedupe set self-prunes.
//
// FAIL-OPEN on a Redis outage: if Redis is absent or errors we ALLOW processing.
// The downstream work here (syncWhopMembershipForEmail → Clerk publicMetadata write)
// is itself idempotent — re-writing the same tier for the same user is a harmless
// no-op — so the cost of a missed-dedupe is a duplicate idempotent sync, whereas the
// cost of fail-closed would be DROPPING a first-ever delivery during a Redis blip
// (the exact "paid user stuck on free" failure this whole feature exists to kill).

// 24h is comfortably longer than svix's retry window, so a retried delivery within
// that window is still recognised as a duplicate.
const DEDUPE_TTL_SEC = Number(process.env.WEBHOOK_DEDUPE_TTL_SEC ?? 24 * 60 * 60);

function key(namespace: string, messageId: string): string {
  return `webhook-dedupe:${namespace}:${messageId}`;
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
      const { makeRedis } = await import("./make-redis");
      const client = await makeRedis("webhook-dedupe", url, { maxRetriesPerRequest: 1 });
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

/**
 * Atomically claim a webhook message id for first-time processing.
 *
 * @returns `true` if THIS caller claimed it (proceed with processing),
 *          `false` if it was already claimed (a duplicate delivery — skip).
 *
 * FAILS OPEN (returns `true`) when Redis is absent or errors, so a Redis outage
 * never drops a first delivery. The downstream sync is idempotent, so the only
 * downside of a fail-open is re-running an already-applied, no-op sync.
 */
export async function claimWebhookOnce(namespace: string, messageId: string): Promise<boolean> {
  if (!messageId) return true; // no id to dedupe on → never block processing
  const redis = await getRedis();
  if (!redis) return true; // fail-open: no Redis configured
  try {
    // SET NX EX — atomic: 'OK' means WE claimed it (first delivery), null means
    // some replica already processed this exact message id (duplicate).
    const claimed = await redis.set(key(namespace, messageId), "1", "EX", DEDUPE_TTL_SEC, "NX");
    return claimed === "OK";
  } catch (err) {
    // fail-open: a Redis outage must not drop a first-ever webhook delivery.
    console.warn("[webhook-dedupe] redis claim failed, allowing processing:", err);
    return true;
  }
}

/**
 * Release a previously-claimed message id so a svix RETRY can re-process it.
 *
 * Call this when processing of a freshly-claimed delivery FAILS: otherwise the claim
 * would poison-pill the id (the retry would be deduped-out and the work lost). Releasing
 * lets the next delivery of the same id go through. Best-effort and never throws — a
 * Redis outage here just leaves the (TTL-bounded) claim in place to expire on its own.
 */
export async function releaseWebhookClaim(namespace: string, messageId: string): Promise<void> {
  if (!messageId) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(key(namespace, messageId));
  } catch (err) {
    console.warn("[webhook-dedupe] redis release failed (claim will expire via TTL):", err);
  }
}
