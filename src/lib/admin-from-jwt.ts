/**
 * Pure JWT → admin decision (no I/O).
 *
 * - `"admin"` → true (trust session claims)
 * - `"member"` → false (trust session claims; ADMIN_EMAILS users must carry role:admin
 *   in Clerk publicMetadata so the JWT reflects it — same trust model as tier-cache.ts
 *   for premium/community)
 * - `null` (role claim absent / Dashboard claims not configured) → null → caller hits Clerk
 */
export function adminFromJwtRole(role: "admin" | "member" | null): boolean | null {
  if (role === "admin") return true;
  if (role === "member") return false;
  return null;
}
