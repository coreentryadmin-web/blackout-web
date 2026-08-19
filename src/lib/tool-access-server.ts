import "server-only";

import { cache } from "react";
import { auth } from "@/lib/auth-server";
import { isAdminUser, resolveAdminApi } from "@/lib/admin-access";
import { getClerkUserCached } from "@/lib/clerk-user-cache";
import {
  sessionClaimsHaveAuthFields,
  toolAccessModeFromSessionClaims,
} from "@/lib/clerk-session-claims";
import { isToolLaunched, type ToolKey } from "@/lib/tool-access";
import {
  parseToolAccessMap,
  resolveToolAccessForUser,
  type ToolAccessMap,
} from "@/lib/tool-user-access";

// Server-side launch gate = global launch flag + per-user overrides + admin bypass.

/** Per-request memo: same userId → one Clerk getUser for tool_access overrides. */
const loadUserToolAccess = cache(async (userId: string): Promise<ToolAccessMap> => {
  const user = await getClerkUserCached(userId);
  return parseToolAccessMap((user.publicMetadata as Record<string, unknown> | undefined)?.tool_access);
});

export async function userCanAccessTool(
  userId: string,
  key: ToolKey,
  sessionClaims?: Record<string, unknown> | null
): Promise<boolean> {
  // Pass claims through so the JWT member short-circuit in isAdminUser can fire.
  // When omitted, isAdminUser resolves auth() once (still no duplicate Clerk storms).
  if (await isAdminUser(userId, sessionClaims)) return true;
  const global = isToolLaunched(key);

  const jwtMode = toolAccessModeFromSessionClaims(sessionClaims, key);
  if (jwtMode !== null) {
    return resolveToolAccessForUser(key, global, { [key]: jwtMode });
  }

  // JWT tier/role configured but no tool_access claim → inherit (no per-user overrides in token).
  // Per-user block/grant overrides require tool_access in the session JWT or fall through to getUser.
  if (global && sessionClaimsHaveAuthFields(sessionClaims)) {
    return true;
  }

  const overrides = await loadUserToolAccess(userId);
  return resolveToolAccessForUser(key, global, overrides);
}

/**
 * PAGE gate. True if the current user may render this tool's page.
 * One auth() + JWT-aware isAdminUser / tool_access — does NOT call getAdminStatus
 * (that used to add a redundant getUserProfile Clerk round-trip just for email).
 */
export async function canAccessTool(key: ToolKey): Promise<boolean> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return isToolLaunched(key);
  return userCanAccessTool(
    userId,
    key,
    sessionClaims as Record<string, unknown> | null | undefined
  );
}

/** Desk/cron auth result from authorizeMarketDeskApi / authorizeCronOrTierApi. */
export type DeskApiAuth = { userId: string | null; via: "cron" | "user" };

export async function requireToolApiForDeskCaller(
  authCtx: DeskApiAuth,
  key: ToolKey
): Promise<Response | null> {
  if (authCtx.via === "cron") return null;
  if (!authCtx.userId) return requireToolApi(key);
  return requireToolApiForUser(authCtx.userId, key);
}

export async function requireToolApi(key: ToolKey): Promise<Response | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    if (isToolLaunched(key)) return null;
    return comingSoonResponse();
  }
  return requireToolApiForUser(
    userId,
    key,
    sessionClaims as Record<string, unknown> | null | undefined
  );
}

async function requireToolApiForUser(
  userId: string,
  key: ToolKey,
  sessionClaims?: Record<string, unknown> | null
): Promise<Response | null> {
  if (await userCanAccessTool(userId, key, sessionClaims)) return null;
  return comingSoonResponse();
}

export async function requireAnyToolApi(keys: ToolKey[]): Promise<Response | null> {
  const { userId, sessionClaims } = await auth();
  const claims = sessionClaims as Record<string, unknown> | null | undefined;
  if (!userId) {
    if (keys.some((k) => isToolLaunched(k))) return null;
    return comingSoonResponse();
  }
  if (await isAdminUser(userId, claims)) return null;
  for (const k of keys) {
    if (await userCanAccessTool(userId, k, claims)) return null;
  }
  return comingSoonResponse();
}

function comingSoonResponse(): Response {
  return new Response(
    JSON.stringify({ error: "coming_soon", message: "This tool is launching soon." }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

/** Admin API helper — load overrides for a target user. */
export async function getToolAccessForUserId(userId: string): Promise<ToolAccessMap> {
  return loadUserToolAccess(userId);
}

/** Persist overrides to Clerk publicMetadata.tool_access (compact — no inherit keys). */
export async function setToolAccessForUserId(
  userId: string,
  map: ToolAccessMap
): Promise<void> {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  // Write path: always fresh (admin mutation) — do not use the request read cache.
  const user = await client.users.getUser(userId);
  const meta = { ...(user.publicMetadata as Record<string, unknown>) };
  const compact = Object.fromEntries(
    Object.entries(map).filter(([, v]) => v === "grant" || v === "block")
  );
  if (Object.keys(compact).length === 0) {
    delete meta.tool_access;
  } else {
    meta.tool_access = compact;
  }
  await client.users.updateUserMetadata(userId, { publicMetadata: meta });
  // Drop the short-TTL getUser cache so the next gate sees the new tool_access map.
  const { invalidateClerkUserCache } = await import("@/lib/clerk-user-cache");
  invalidateClerkUserCache(userId);
}

/** resolveAdminApi remains for admin-only routes; export for tests that mock admin. */
export { resolveAdminApi } from "@/lib/admin-access";
