import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-access";
import { isAdminEmail } from "@/lib/admin-emails";
import { auth, getSession } from "@/lib/auth-server";
import { roleFromSessionClaims } from "@/lib/clerk-session-claims";
import { adminFromJwtRole } from "@/lib/admin-from-jwt";
import { getClerkUserCached } from "@/lib/clerk-user-cache";
import { getUserProfile, isUserAdmin } from "@/lib/user-directory";

export { isAdminEmail } from "@/lib/admin-emails";

/**
 * Resolve whether `userId` is an admin.
 *
 * Fast path: when session JWT carries `role`, trust it (admin OR member) — never hit
 * Clerk Backend for the common member case. Slow path: role claim absent → one
 * request-memoized getUser (see clerk-user-cache.ts).
 *
 * Pass `sessionClaims` when the caller already has them (layout / requireTier /
 * market-api-auth). When omitted, we resolve claims via auth() once (also cheap /
 * request-stable) so call sites like userCanAccessTool still get the JWT short-circuit.
 */
export async function isAdminUser(
  userId: string,
  sessionClaims?: Record<string, unknown> | null
): Promise<boolean> {
  let claims = sessionClaims;
  if (claims === undefined) {
    const session = await auth();
    claims = session.sessionClaims as Record<string, unknown> | null | undefined;
  }

  const fromJwt = adminFromJwtRole(roleFromSessionClaims(claims));
  if (fromJwt !== null) return fromJwt;

  const user = await getClerkUserCached(userId);
  const role = String(user.publicMetadata?.role ?? "").toLowerCase();
  if (role === "admin") return true;

  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
  return isAdminEmail(email);
}

export async function requireAdmin(): Promise<{ userId: string; email: string | null }> {
  const userId = await requireAuth();
  const { sessionClaims } = await getSession();
  const profile = await getUserProfile(userId);
  const email = profile?.email ?? null;

  if (!(await isAdminUser(userId, sessionClaims))) {
    redirect("/dashboard");
  }

  return { userId, email };
}

export async function getAdminStatus(): Promise<{ admin: boolean; email: string | null }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { admin: false, email: null };
  const profile = await getUserProfile(userId);
  if (!profile) return { admin: false, email: null };
  const admin = await isAdminUser(userId, sessionClaims);
  return { admin, email: profile.email };
}

export async function resolveAdminApi(): Promise<{
  actor: { userId: string; email: string | null } | null;
  denied: Response | null;
}> {
  const { userId } = await auth();
  if (!userId) {
    return {
      actor: null,
      denied: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const profile = await getUserProfile(userId);
  const email = profile?.email ?? null;
  const { sessionClaims } = await getSession();
  const isAdmin = await isAdminUser(userId, sessionClaims);

  if (!isAdmin) {
    return {
      actor: null,
      denied: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return { actor: { userId, email }, denied: null };
}

export async function requireAdminApi(): Promise<Response | null> {
  const { denied } = await resolveAdminApi();
  return denied;
}

export async function getAdminApiActor(): Promise<{ userId: string; email: string | null } | null> {
  const { actor } = await resolveAdminApi();
  return actor;
}
