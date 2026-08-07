import { dbQuery } from "@/lib/db";
import { parseTier, type Tier } from "@/lib/tiers";
import { isAdminEmail } from "@/lib/admin-emails";
import { getClerkUserCached } from "@/lib/clerk-user-cache";

export type UserProfile = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  tier: Tier;
  role: string | null;
};

async function getUserRow(userId: string): Promise<{
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier: string | null;
} | null> {
  try {
    const result = await dbQuery<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      tier: string | null;
    }>(
      `SELECT email, first_name, last_name, tier FROM users WHERE clerk_user_id = $1 LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!userId) return null;

  const user = await getClerkUserCached(userId);
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  return {
    userId,
    email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    tier: parseTier(user.publicMetadata?.tier),
    role: String(user.publicMetadata?.role ?? "") || null,
  };
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  const profile = await getUserProfile(userId);
  if (!profile) return false;
  const role = String(profile.role ?? "").toLowerCase();
  if (role === "admin") return true;
  return isAdminEmail(profile.email);
}
