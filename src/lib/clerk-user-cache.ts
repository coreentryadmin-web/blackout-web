import { cache } from "react";

/**
 * Per-request Clerk `users.getUser` dedupe.
 *
 * Desk pages used to call getUser 3–5× per render (layout isAdminUser + requireTier
 * isAdminUser + canAccessTool → getAdminStatus/getUserProfile + userCanAccessTool →
 * isAdminUser again + loadUserToolAccess). Each call is ~100–300ms HTTPS to Clerk —
 * the same bug class tier-cache.ts already fixed for tier lookups.
 *
 * React `cache()` scopes to a single RSC/request: identical userId → one Backend call.
 * Cross-request caching stays in tier-cache / JWT fast-paths (never grant admin/premium
 * from a long-lived process Map without the existing TTL/invalidation story).
 *
 * No `server-only` import: tier-cache / market-api-auth are exercised under `tsx --test`
 * (alias-free Node), and `server-only` throws outside the Next RSC graph.
 */
export const getClerkUserCached = cache(async (userId: string) => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  return (await clerkClient()).users.getUser(userId);
});
