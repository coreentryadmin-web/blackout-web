import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 1,
  completed: 2,
  past_due: 3,
  canceling: 4,
};

/** Deterministic membership ordering: ACTIVE/TRIALING first, then most-recently-created. */
export function sortMemberships(memberships: MembershipListResponse[]): MembershipListResponse[] {
  return [...memberships].sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] ?? 99;
    const bPriority = STATUS_PRIORITY[b.status] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aTs = Date.parse((a as unknown as { created_at?: string }).created_at ?? "") || 0;
    const bTs = Date.parse((b as unknown as { created_at?: string }).created_at ?? "") || 0;
    return bTs - aTs;
  });
}
