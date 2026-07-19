import { dbQuery, dbConfigured } from "@/lib/db";
import type { Tier } from "@/lib/tiers";

export type AdminUserRole = "admin" | "member";

export function parseAdminUserRole(value: unknown): AdminUserRole | undefined {
  if (value === "admin") return "admin";
  if (value === "member" || value === "" || value == null) return "member";
  return undefined;
}

/** Prevent admins from locking themselves out via ban, demotion, or delete. */
export function assertAdminSelfGuard(
  actorUserId: string,
  targetUserId: string,
  action: "ban" | "demote" | "delete"
): string | null {
  if (actorUserId !== targetUserId) return null;
  if (action === "ban") return "You cannot ban your own account";
  if (action === "delete") return "You cannot delete your own account";
  return "You cannot remove your own admin role";
}

/** Postgres-backed tier listing when Clerk metadata filter is unavailable. */
export async function listClerkUserIdsByDbTier(
  tier: string,
  limit: number,
  offset: number
): Promise<{ ids: string[]; total: number }> {
  if (!dbConfigured()) return { ids: [], total: 0 };
  const [rows, countRow] = await Promise.all([
    dbQuery<{ clerk_user_id: string }>(
      `SELECT clerk_user_id FROM users
       WHERE tier = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [tier, limit, offset]
    ),
    dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE tier = $1`,
      [tier]
    ),
  ]);
  return {
    ids: rows.rows.map((r) => r.clerk_user_id),
    total: parseInt(countRow.rows[0]?.count ?? "0", 10),
  };
}

/** Keep Postgres users row aligned with Clerk metadata for admin search/reporting. */
export async function upsertAdminUserRow(input: {
  clerkUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  tier?: Tier | null;
  whopUserId?: string | null;
}): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await dbQuery(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, tier, whop_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             first_name = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name = COALESCE(EXCLUDED.last_name, users.last_name),
             tier = COALESCE(EXCLUDED.tier, users.tier),
             whop_user_id = COALESCE(EXCLUDED.whop_user_id, users.whop_user_id),
             updated_at = NOW()`,
      [
        input.clerkUserId,
        input.email ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.tier ?? null,
        input.whopUserId ?? null,
      ]
    );
  } catch (err) {
    console.warn("[admin-users] Postgres upsert failed:", err);
  }
}
