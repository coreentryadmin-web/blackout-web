import { redirect } from "next/navigation";
import { tierAtLeast, type Tier } from "@/lib/tiers";
import { resolveUserTier, TierUnavailableError } from "@/lib/tier-cache";
import { getSession } from "@/lib/auth-server";
import { adminFromJwtRole } from "@/lib/admin-from-jwt";
import { roleFromSessionClaims, tierFromSessionClaims } from "@/lib/clerk-session-claims";
import type { ToolKey } from "@/lib/tool-access";

export async function requireAuth(): Promise<string> {
  const { userId } = await getSession();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function getUserTier(
  userId: string,
  sessionClaims?: Record<string, unknown> | null
): Promise<Tier> {
  if (!userId) {
    console.warn("[auth-access] getUserTier called with empty userId — treating as free.");
    return "free";
  }
  try {
    return await resolveUserTier(userId, sessionClaims);
  } catch (err) {
    if (!(err instanceof TierUnavailableError)) throw err;
    console.warn("[auth-access] tier unavailable; denying (treating as free) to avoid over-grant.");
    return "free";
  }
}

export async function requireTier(minTier: Tier) {
  const { userId, sessionClaims } = await getSession();
  if (!userId) redirect("/sign-in");

  // JWT fast path — most signed-in members carry tier/role in session claims. Skip Clerk
  // Backend getUser on every page navigation when the token already proves access.
  const jwtAdmin = adminFromJwtRole(roleFromSessionClaims(sessionClaims));
  if (jwtAdmin === true) {
    return { userId, tier: "premium" as Tier, sessionClaims };
  }

  const jwtTier = tierFromSessionClaims(sessionClaims);
  if (jwtTier === "premium" || jwtTier === "community") {
    if (tierAtLeast(jwtTier, minTier)) return { userId, tier: jwtTier, sessionClaims };
    redirect("/upgrade");
  }

  const { isAdminUser } = await import("@/lib/admin-access");
  if (await isAdminUser(userId, sessionClaims)) {
    return { userId, tier: "premium" as Tier, sessionClaims };
  }
  const tier = await getUserTier(userId, sessionClaims);

  if (!tierAtLeast(tier, minTier)) {
    redirect("/upgrade");
  }

  return { userId, tier, sessionClaims };
}

/**
 * One session read + tier gate + tool launch gate. Returns null when the tool is coming soon
 * (caller renders ComingSoon). Redirects on sign-in / upgrade like requireTier.
 */
export async function requireDeskTool(
  minTier: Tier,
  toolKey: ToolKey
): Promise<{ userId: string; tier: Tier } | null> {
  const { userId, tier, sessionClaims } = await requireTier(minTier);
  const { userCanAccessTool } = await import("@/lib/tool-access-server");
  if (!(await userCanAccessTool(userId, toolKey, sessionClaims))) return null;
  return { userId, tier };
}
