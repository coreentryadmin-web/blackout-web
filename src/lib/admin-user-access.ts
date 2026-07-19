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
  const tier = input.tier === "premium" ? "premium" : "free";
  const kind = input.membershipKind ?? "";
  const isAdmin = input.role === "admin" || Boolean(input.emailAdmin);

  if (isAdmin) {
    return {
      accessLabel: "admin",
      deskAccess: true,
      accessSummary: "Admin — full desk + admin console (tier bypass)",
    };
  }

  if (kind === "community" && tier !== "premium") {
    return {
      accessLabel: "community",
      deskAccess: false,
      accessSummary: "Community ($75) — Discord only, no web desk",
    };
  }

  if (tier === "premium") {
    return {
      accessLabel: "premium",
      deskAccess: true,
      accessSummary: "Premium — full web desk (HELIX, SPX, Largo, etc.)",
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
