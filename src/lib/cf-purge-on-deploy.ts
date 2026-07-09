// One-shot Cloudflare edge-cache purge fired once per deploy.
//
// WHY: the public marketing pages (/, /upgrade, /learn*) are statically generated
// AND edge-cached by a Cloudflare Cache Rule with "Ignore cache-control header,
// Edge TTL 2h" (the origin sends `no-store` via Clerk middleware, so without that
// override they'd never cache). The 2h edge TTL means a fresh deploy can serve the
// PREVIOUS build's HTML for up to two hours. This module purges those exact URLs at
// boot so new copy goes live immediately after each deploy.
//
// SAFETY / SCOPE:
//   * NO-OP unless CF_API_TOKEN + CF_ZONE_ID are both set → safe to ship before the
//     token exists; it simply does nothing until configured.
//   * Cross-replica dedup via Redis SET NX EX keyed on the deploy id (commit SHA /
//     deployment id) — only the FIRST replica to boot a new deploy actually purges,
//     mirroring the leader-election pattern in ws/polygon-socket.ts. Without Redis it
//     falls back to a per-process guard (at worst one purge per replica per deploy,
//     which is harmless — purge is idempotent).
//   * If there is no deploy id to key on, it does nothing (never purges on every
//     boot — that would defeat the cache).
//   * Purges the **entire zone** once per deploy. Marketing-only file purges do not
//     clear stale /_next/static/* 404s edge-cached during rolling ECS deploys (which
//     break sign-in hydration when webpack chunks 404 at the edge).
//
// Called from /api/health on ECS boot and ensureDataSockets() on first market request.

const PURGE_LOCK_TTL_SEC = 3_600; // 1h: comfortably longer than a rolling deploy

function deployId(): string | null {
  // Railway exposes the commit SHA and a per-deployment id; ECS images bake
  // GITHUB_SHA as CF_PURGE_DEPLOY_ID in deploy/Dockerfile.
  return (
    process.env.CF_PURGE_DEPLOY_ID?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    process.env.RAILWAY_DEPLOYMENT_ID?.trim() ||
    null
  );
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
      const client = await makeRedis("cf-purge-on-deploy", url, { maxRetriesPerRequest: 1 });
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

// Per-process guard so a Redis-less replica purges at most once per boot.
const PROCESS_GUARD = "__blackoutCfPurgeFired" as const;

/**
 * Claims the purge for this deploy. Returns true if THIS replica should run the
 * purge, false if another replica already did (or will). Fails toward "claim" only
 * when there is no Redis (per-process guard prevents repeat purges in that case).
 */
async function claimPurge(id: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) {
    const g = globalThis as typeof globalThis & { [PROCESS_GUARD]?: boolean };
    if (g[PROCESS_GUARD]) return false;
    g[PROCESS_GUARD] = true;
    return true;
  }
  try {
    // SET NX EX — atomic claim. 'OK' = we won and own the purge for this deploy.
    const claimed = await redis.set(`cf:purge:deploy:${id}`, "1", "EX", PURGE_LOCK_TTL_SEC, "NX");
    return claimed === "OK";
  } catch (err) {
    console.warn("[cf-purge-on-deploy] redis claim failed, skipping purge:", err);
    return false; // a Redis error must not trigger a purge storm across replicas
  }
}

/**
 * Fire-and-forget: purge the entire Cloudflare zone once per deploy.
 * Safe to call unconditionally at boot — it self-gates on configuration and dedup.
 */
export async function maybePurgeCloudflareOnDeploy(): Promise<void> {
  const token = process.env.CF_API_TOKEN?.trim();
  const zoneId = process.env.CF_ZONE_ID?.trim();
  if (!token || !zoneId) return; // not configured → no-op (safe pre-token)

  const id = deployId();
  if (!id) {
    console.warn("[cf-purge-on-deploy] no deploy id (CF_PURGE_DEPLOY_ID / GITHUB_SHA) — skipping");
    return;
  }

  if (!(await claimPurge(id))) return; // another replica owns this deploy's purge

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Full purge: rolling deploys can edge-cache 404s for missing hashed JS/CSS;
      // marketing-only file purge leaves sign-in broken until manual purge.
      body: JSON.stringify({ purge_everything: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[cf-purge-on-deploy] purge failed: ${res.status} ${text.slice(0, 300)}`);
      return;
    }
    console.log(`[cf-purge-on-deploy] purged entire zone for deploy ${id}`);
  } catch (err) {
    console.warn("[cf-purge-on-deploy] purge request error:", err);
  }
}
