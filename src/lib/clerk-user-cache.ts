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

import { isWsUpdatedAtFresh } from "@/lib/ws/timestamp-freshness";

type ClerkUser = Awaited<
  ReturnType<Awaited<ReturnType<typeof import("@clerk/nextjs/server").clerkClient>>["users"]["getUser"]>
>;

const inflight = new Map<string, Promise<ClerkUser>>();
const resolved = new Map<string, { user: ClerkUser; at: number }>();
const DEDUPE_TTL_MS = 5_000;
const MAX_RESOLVED = 2_000;

// The real fetch, isolated behind an overridable reference so tests can swap it without
// trying to mock the bare "@clerk/nextjs/server" specifier through tsx's CJS-transpiled
// dynamic import — which does not route through node:test's --experimental-test-module-mocks
// hooks (verified: a plain .mjs module's `await import(bareSpecifier)` picks up a
// `mock.module()` override, but the identical call from inside a tsx-compiled .ts module does
// not — tsx emits a literal `await import(...)` either way, but only the untransformed ESM
// case is seen by the mock registry). See clerk-user-cache-invalidate-race.test.ts.
let fetchClerkUser: (userId: string) => Promise<ClerkUser> = async (userId) => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  return (await clerkClient()).users.getUser(userId);
};

/** Test-only: swap the underlying Clerk fetch (e.g. to simulate a slow in-flight read). */
export function __setFetchClerkUserForTest(fn: typeof fetchClerkUser): void {
  fetchClerkUser = fn;
}

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

// Bumped by every invalidateClerkUserCache() call. Guards against the race documented below:
// an admin write (e.g. setToolAccessForUserId) does `updateUserMetadata(...)` then
// `invalidateClerkUserCache(userId)` so the NEXT read sees the change. But
// invalidateClerkUserCache can only clear what is already sitting in the cache — it cannot
// reach back and stop a fetch that started EARLIER (and therefore read Clerk's state from
// BEFORE the write) from completing afterward. Without this guard, that in-flight fetch's
// `setResolved(userId, user)` call resurrects the exact pre-write staleness the invalidate was
// made to clear, for up to another DEDUPE_TTL_MS (5s) — e.g. a just-revoked tool_access block
// or just-granted admin role reads as the old value for several more seconds even though the
// caller explicitly invalidated right after writing.
let invalidationSeq = 0;

export async function getClerkUserCached(userId: string): Promise<ClerkUser> {
  const hit = resolved.get(userId);
  if (hit && isWsUpdatedAtFresh(hit.at, DEDUPE_TTL_MS)) return hit.user;

  const pending = inflight.get(userId);
  if (pending) return pending;

  const seqAtStart = invalidationSeq;
  const p = (async () => {
    const user = await fetchClerkUser(userId);
    // Only cache this result if nothing invalidated the cache while this fetch was in
    // flight — otherwise this would be writing back data that is already known-stale.
    if (invalidationSeq === seqAtStart) setResolved(userId, user);
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
  invalidationSeq++;
  if (userId) {
    resolved.delete(userId);
    inflight.delete(userId);
    return;
  }
  resolved.clear();
  inflight.clear();
}
