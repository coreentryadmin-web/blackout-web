import { dbQuery, dbConfigured } from "@/lib/db";
import { adminEmailAllowlist } from "@/lib/admin-emails";
import { isInternalAuditEmail } from "@/lib/internal-audit-email";
import type { Tier } from "@/lib/tiers";

export type AdminUserRole = "admin" | "member";

export type AdminUserListFilters = {
  tier?: string;
  role?: string;
  query?: string;
  /** Combined access bucket filter (admin / premium / community / free). */
  access?: string;
};

export type AdminUserListStats = {
  total: number;
  premium: number;
  admins: number;
  community: number;
  free: number;
};

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

/** Build WHERE clause fragments for admin user directory queries. */
export function buildAdminUserFilterSql(filters: AdminUserListFilters): {
  whereSql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const query = filters.query?.trim();
  if (query) {
    params.push(`%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const idx = params.length;
    clauses.push(
      `(email ILIKE $${idx} ESCAPE '\\'
        OR first_name ILIKE $${idx} ESCAPE '\\'
        OR last_name ILIKE $${idx} ESCAPE '\\'
        OR clerk_user_id ILIKE $${idx} ESCAPE '\\')`
    );
  }

  const tier = filters.tier?.trim();
  const access = filters.access?.trim();

  if (access === "admin") {
    const allow = adminEmailAllowlist();
    if (allow.length > 0) {
      params.push(allow.map((e) => e.toLowerCase()));
      const idx = params.length;
      clauses.push(`(role = 'admin' OR LOWER(email) = ANY($${idx}::text[]))`);
    } else {
      clauses.push(`role = 'admin'`);
    }
  } else if (access === "premium") {
    clauses.push(`tier = 'premium' AND COALESCE(role, '') <> 'admin'`);
  } else if (access === "community") {
    // Matches classifyAdminUserAccess's priority order: a premium-tier user with
    // membership_kind='community' is classified "premium" there (tier wins), so this
    // filter must exclude tier='premium' too, or it disagrees with the row's own badge.
    clauses.push(`membership_kind = 'community' AND COALESCE(tier, 'free') <> 'premium'`);
  } else if (access === "free") {
    clauses.push(
      `tier = 'free' AND COALESCE(membership_kind, 'free') NOT IN ('community', 'premium') AND COALESCE(role, '') <> 'admin'`
    );
  } else if (tier === "community") {
    clauses.push(`membership_kind = 'community' AND COALESCE(tier, 'free') <> 'premium'`);
  } else if (tier === "premium") {
    clauses.push(`tier = 'premium'`);
  } else if (tier === "free") {
    clauses.push(
      `tier = 'free' AND COALESCE(membership_kind, 'free') NOT IN ('community', 'premium')`
    );
  }

  const role = filters.role?.trim();
  if (role === "admin") {
    clauses.push(`role = 'admin'`);
  } else if (role === "member") {
    clauses.push(`COALESCE(role, '') <> 'admin'`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function shouldUseDbAdminUserList(filters: AdminUserListFilters): boolean {
  const tier = filters.tier?.trim();
  const role = filters.role?.trim();
  const access = filters.access?.trim();
  return Boolean(tier || role || access);
}

/** Postgres-backed user listing with accurate filter pagination. */
export async function listClerkUserIdsByDbFilters(
  filters: AdminUserListFilters,
  limit: number,
  offset: number
): Promise<{ ids: string[]; total: number }> {
  if (!dbConfigured()) return { ids: [], total: 0 };

  const { whereSql, params } = buildAdminUserFilterSql(filters);
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const [rows, countRow] = await Promise.all([
    dbQuery<{ clerk_user_id: string }>(
      `SELECT clerk_user_id FROM users
       ${whereSql}
       ORDER BY updated_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    ),
    dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users ${whereSql}`,
      params
    ),
  ]);

  return {
    ids: rows.rows.map((r) => r.clerk_user_id),
    total: parseInt(countRow.rows[0]?.count ?? "0", 10),
  };
}

type AdminUserStatsRow = {
  email: string | null;
  tier: string | null;
  role: string | null;
  membership_kind: string | null;
};

/**
 * Bucket raw `users` rows into the same counts `AdminUserListStats` reports, excluding rows
 * whose email is a recognized audit/test-harness account (`isInternalAuditEmail`) — the Clerk
 * webhook already skips the welcome email/ops-Discord/Whop-sync for these accounts but still
 * writes them into this Postgres mirror (`src/app/api/webhooks/clerk/route.ts`), so without this
 * exclusion they silently accumulate here and corrupt the dashboard's stat tiles: a real-prod
 * snapshot showed 1456/1600 rows counted as "admin" (an audit harness's default `publicMetadata`
 * is `{role:"admin", tier:"premium"}`), driving Premium/Free/Community to 0 even though the user
 * LIST underneath showed real `FREE`-access rows. Mirrors the bucket priority of the original SQL
 * (`role='admin'`-or-allowlisted wins over every other bucket; the remaining three are each
 * independently evaluated, matching `buildAdminUserFilterSql`'s own priority order).
 */
export function computeAdminUserListStats(
  rows: AdminUserStatsRow[],
  adminEmailsLower: string[]
): AdminUserListStats {
  let total = 0;
  let premium = 0;
  let admins = 0;
  let community = 0;
  let free = 0;

  for (const row of rows) {
    if (isInternalAuditEmail(row.email)) continue;
    total++;

    const isAdmin =
      row.role === "admin" ||
      (adminEmailsLower.length > 0 &&
        row.email != null &&
        adminEmailsLower.includes(row.email.toLowerCase()));
    if (isAdmin) {
      admins++;
      continue;
    }

    if (row.tier === "premium") premium++;
    if (row.membership_kind === "community" && (row.tier ?? "free") !== "premium") community++;
    if (row.tier === "free" && !["community", "premium"].includes(row.membership_kind ?? "free")) {
      free++;
    }
  }

  return { total, premium, admins, community, free };
}

/** Global user counts for admin dashboard stats (Postgres mirror of Clerk metadata). */
export async function getAdminUserListStats(): Promise<AdminUserListStats | null> {
  if (!dbConfigured()) return null;

  const { rows } = await dbQuery<AdminUserStatsRow>(
    `SELECT email, tier, role, membership_kind FROM users`
  );

  return computeAdminUserListStats(rows, adminEmailAllowlist());
}

/** Keep Postgres users row aligned with Clerk metadata for admin search/reporting. */
export async function upsertAdminUserRow(input: {
  clerkUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  tier?: Tier | null;
  whopUserId?: string | null;
  role?: AdminUserRole | string | null;
  membershipKind?: string | null;
}): Promise<void> {
  if (!dbConfigured()) return;

  const roleValue =
    input.role === "admin"
      ? "admin"
      : input.role === "member" || input.role === "" || input.role === null
        ? null
        : undefined;

  try {
    const roleProvided = "role" in input;
    const membershipKindProvided = "membershipKind" in input;

    await dbQuery(
      `INSERT INTO users (
         clerk_user_id, email, first_name, last_name, tier, whop_user_id, role, membership_kind
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             first_name = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name = COALESCE(EXCLUDED.last_name, users.last_name),
             tier = COALESCE(EXCLUDED.tier, users.tier),
             whop_user_id = COALESCE(EXCLUDED.whop_user_id, users.whop_user_id),
             role = ${roleProvided ? "EXCLUDED.role" : "users.role"},
             membership_kind = ${
               membershipKindProvided ? "EXCLUDED.membership_kind" : "users.membership_kind"
             },
             updated_at = NOW()`,
      [
        input.clerkUserId,
        input.email ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.tier ?? null,
        input.whopUserId ?? null,
        roleProvided ? roleValue ?? null : null,
        membershipKindProvided ? input.membershipKind ?? null : null,
      ]
    );
  } catch (err) {
    console.warn("[admin-users] Postgres upsert failed:", err);
  }
}
