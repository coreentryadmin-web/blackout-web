// Single shared factory for building one CONNECTED ioredis client.
//
// This consolidates the byte-identical connect body that was duplicated across
// seven call sites (shared-cache, redis-pubsub publisher + subscriber,
// uw-shared-cache, uw-rate-limiter, api-telemetry-redis, membership-sync-limit).
//
// IMPORTANT — what this factory does and does NOT own:
//   * It owns: the `new Redis(url, opts)` construction, the MANDATORY 'error'
//     listener (without it ioredis throws on the EventEmitter when a connection
//     drops post-connect, crashing the whole process/replica), and `connect()`.
//   * It does NOT own: enablement (callers gate on REDIS_URL themselves), the
//     init-promise dedup, ready flags, last-failed-at backoff windows, the
//     pub/sub publisher vs subscriber separation, or the subscriber's 'message'
//     listener. Those are per-module state machines and stay exactly where they
//     are. This factory is a leaf: build + wire 'error' + connect, then return.
//
// It throws on failure so each caller's existing try/catch keeps setting its own
// backoff / failed-at state unchanged.
//
// Alias-free on purpose: ioredis is imported dynamically here (never statically
// bundled into the request path when REDIS_URL is unset) and this module has no
// `@/` imports, so any unit test that imports a caller of makeRedis resolves
// cleanly under tsx --test.

type RedisInstance = import("ioredis").default;

export type MakeRedisOptions = {
  /** Per-site value: 1 for caches/limiters/telemetry/membership, 2 for pub/sub. */
  maxRetriesPerRequest: number;
  /** Connect timeout in ms. Defaults to the project-wide 2_000 used everywhere. */
  connectTimeoutMs?: number;
};

/**
 * Build and connect a single ioredis client.
 * @param label short module tag used in the 'error' log line (e.g. "shared-cache").
 * @param url   the REDIS_URL the caller already resolved + trimmed.
 * @param opts  per-site connection options (maxRetriesPerRequest is required).
 * @returns a connected ioredis client. Throws if the connect fails.
 */
export async function makeRedis(
  label: string,
  url: string,
  opts: MakeRedisOptions
): Promise<RedisInstance> {
  const mod = await import("ioredis");
  const Redis = mod.default;
  const client = new Redis(url, {
    maxRetriesPerRequest: opts.maxRetriesPerRequest,
    lazyConnect: true,
    connectTimeout: opts.connectTimeoutMs ?? 2_000,
  });
  // Without an 'error' listener, ioredis throws on the EventEmitter when the
  // connection drops post-connect — which crashes the whole process/replica.
  client.on("error", (err) =>
    console.warn(`[${label}] redis error:`, err instanceof Error ? err.message : err)
  );
  await client.connect();
  return client;
}
