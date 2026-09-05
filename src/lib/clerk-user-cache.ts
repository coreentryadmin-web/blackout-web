import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";

/**
 * Per-request / short-window Clerk `users.getUser` dedupe.
 *
 * Desk pages used to call getUser 3–5× per render (layout isAdminUser + requireTier
 * isAdminUser + canAccessTool → getUserProfile + userCanAccessTool → isAdminUser again
 * + loadUserToolAccess). Each call is ~100–300ms HTTPS to Clerk — the same bug class
 * tier-cache.ts already fixed for tier lookups.
 *
 * Why not React.cache()? It is unavailable under `tsx --test` (CJS interop:
 * `react.cache` is undefined), and market-api-auth / tier-cache are unit-tested that way.
 * A short TTL + in-flight Map collapses one page's fan-out the same way without
 * coupling unit tests to the RSC runtime.
 *
 * TTL is intentionally short (5s): long enough for layout+page+gate fan-out on one
 * navigation; short enough that admin/tool_access flips stay honest (tier-cache is 60s).
 */

type ClerkUser = Awaited<
  ReturnType<Awaited<ReturnType<typeof import("@clerk/nextjs/server").clerkClient>>["users"]["getUser"]>
>;

const inflight = new Map<string, Promise<ClerkUser>>();
const resolved = new Map<string, { user: ClerkUser; at: number }>();
const DEDUPE_TTL_MS = 5_000;
const MAX_RESOLVED = 2_000;

function setResolved(userId: string, user: ClerkUser): void {
  resolved.delete(userId);
  if (resolved.size >= MAX_RESOLVED) {
    const now = Date.now();
    for (const [k, v] of Array.from(resolved)) {
      if (!isWsUpdatedAtFresh(v.at, DEDUPE_TTL_MS, now)) resolved.delete(k);
    }
    while (resolved.size >= MAX_RESOLVED) {
      const oldest = resolved.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      resolved.delete(oldest);
    }
  }
  resolved.set(userId, { user, at: Date.now() });
}

export async function getClerkUserCached(userId: string): Promise<ClerkUser> {
  const hit = resolved.get(userId);
  if (hit && isWsUpdatedAtFresh(hit.at, DEDUPE_TTL_MS)) return hit.user;

  const pending = inflight.get(userId);
  if (pending) return pending;

  const p = (async () => {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const user = await (await clerkClient()).users.getUser(userId);
    setResolved(userId, user);
    return user;
  })();

  inflight.set(userId, p);
  try {
    return await p;
  } finally {
    inflight.delete(userId);
  }
}

/** Test/admin helper — drop cached Clerk users (e.g. after metadata writes). */
export function invalidateClerkUserCache(userId?: string): void {
  if (userId) {
    resolved.delete(userId);
    inflight.delete(userId);
    return;
  }
  resolved.clear();
  inflight.clear();
}
