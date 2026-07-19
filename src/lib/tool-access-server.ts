import "server-only";

import { auth } from "@/lib/auth-server";
import { getAdminStatus, isAdminUser, resolveAdminApi } from "@/lib/admin-access";
import { isToolLaunched, type ToolKey } from "@/lib/tool-access";
import {
  parseToolAccessMap,
  resolveToolAccessForUser,
  type ToolAccessMap,
} from "@/lib/tool-user-access";

// Server-side launch gate = global launch flag + per-user overrides + admin bypass.

async function loadUserToolAccess(userId: string): Promise<ToolAccessMap> {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const user = await (await clerkClient()).users.getUser(userId);
  return parseToolAccessMap((user.publicMetadata as Record<string, unknown> | undefined)?.tool_access);
}

export async function userCanAccessTool(userId: string, key: ToolKey): Promise<boolean> {
  if (await isAdminUser(userId)) return true;
  const global = isToolLaunched(key);
  const overrides = await loadUserToolAccess(userId);
  return resolveToolAccessForUser(key, global, overrides);
}

/**
 * PAGE gate. True if the current user may render this tool's page.
 */
export async function canAccessTool(key: ToolKey): Promise<boolean> {
  const { admin, userId } = await getAdminStatusWithId();
  if (admin) return true;
  if (!userId) return isToolLaunched(key);
  return userCanAccessTool(userId, key);
}

async function getAdminStatusWithId(): Promise<{
  admin: boolean;
  email: string | null;
  userId: string | null;
}> {
  const { userId } = await auth();
  if (!userId) return { admin: false, email: null, userId: null };
  const { admin, email } = await getAdminStatus();
  return { admin, email, userId };
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
  const { userId } = await auth();
  if (!userId) {
    if (isToolLaunched(key)) return null;
    return comingSoonResponse();
  }
  return requireToolApiForUser(userId, key);
}

async function requireToolApiForUser(userId: string, key: ToolKey): Promise<Response | null> {
  if (await userCanAccessTool(userId, key)) return null;
  return comingSoonResponse();
}

export async function requireAnyToolApi(keys: ToolKey[]): Promise<Response | null> {
  const { userId } = await auth();
  if (!userId) {
    if (keys.some((k) => isToolLaunched(k))) return null;
    return comingSoonResponse();
  }
  if (await isAdminUser(userId)) return null;
  for (const k of keys) {
    if (await userCanAccessTool(userId, k)) return null;
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
}

/** resolveAdminApi remains for admin-only routes; export for tests that mock admin. */
export { resolveAdminApi } from "@/lib/admin-access";
