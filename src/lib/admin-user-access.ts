import { parseTier } from "@/lib/tiers";

/** Admin directory access bucket — how the user experiences the product. */
export type AdminUserAccessLabel = "admin" | "premium" | "community" | "free";

export type AdminUserAccessInfo = {
  accessLabel: AdminUserAccessLabel;
  /** Can open /dashboard and premium desk routes (tier gate or admin bypass). */
  deskAccess: boolean;
  /** One-line explanation for admin UI tooltips. */
  accessSummary: string;
};

export function classifyAdminUserAccess(input: {
  tier: string;
  membershipKind?: string | null;
  role?: string | null;
  emailAdmin?: boolean;
}): AdminUserAccessInfo {
  // Normalize through parseTier (not a raw literal comparison) so the legacy tier aliases
  // "pro"/"elite" land as "premium" here too — parseTier has always coerced those for the
  // member-facing desk gate (tier-cache.ts's resolveUserTier), so a legacy member has REAL
  // premium access on the live site right now; this label must agree, or the admin dashboard
  // is the one place that misreports a real paying member as "free" with no desk access.
  const tier = parseTier(input.tier);
  const kind = input.membershipKind ?? "";
  const isAdmin = input.role === "admin" || Boolean(input.emailAdmin);

  if (isAdmin) {
    return {
      accessLabel: "admin",
      deskAccess: true,
      accessSummary: "Admin — full desk + admin console (tier bypass)",
    };
  }

  if (tier === "premium") {
    return {
      accessLabel: "premium",
      deskAccess: true,
      accessSummary: "Premium — full web desk (HELIX, SPX, Largo, etc.)",
    };
  }

  // Community can be signaled either by the Whop membershipKind (the normal webhook path,
  // where `tier` metadata itself often stays "free") or by `tier` directly (an admin manually
  // setting tier=community via the Edit/Create User modal, which never touches membershipKind) —
  // real desk access (tierAtLeast in src/lib/tiers.ts) is granted purely off `tier`, so this label
  // must recognize that path too, not just the webhook-driven membershipKind one.
  if (tier === "community" || kind === "community") {
    return {
      accessLabel: "community",
      deskAccess: true,
      accessSummary: "SPX Slayer ($49) — SPX desk only",
    };
  }

  return {
    accessLabel: "free",
    deskAccess: false,
    accessSummary: "Free signup — marketing site + /upgrade only",
  };
}

export const ADMIN_ACCESS_LABELS: Record<
  AdminUserAccessLabel,
  { title: string; short: string }
> = {
  admin: { title: "Admin", short: "Admin" },
  premium: { title: "Premium", short: "Premium" },
  community: { title: "Community", short: "Community" },
  free: { title: "Free", short: "Free" },
};
