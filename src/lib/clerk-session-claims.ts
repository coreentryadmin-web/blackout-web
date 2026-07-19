import { parseTier, type Tier } from "@/lib/tiers";

export type SessionClaims = Record<string, unknown> | null | undefined;

/** True when the session JWT includes tier and/or role (Dashboard claims configured). */
export function sessionClaimsHaveAuthFields(claims: SessionClaims): boolean {
  if (!claims || typeof claims !== "object") return false;
  return Object.prototype.hasOwnProperty.call(claims, "tier") ||
    Object.prototype.hasOwnProperty.call(claims, "role");
}

/** Tier from session JWT; null → caller should fall back to Clerk Backend getUser. */
export function tierFromSessionClaims(claims: SessionClaims): Tier | null {
  if (!claims || !Object.prototype.hasOwnProperty.call(claims, "tier")) return null;
  return parseTier(claims.tier);
}

/** Role from session JWT; null → caller should fall back to getUser. Empty/missing value = member. */
export function roleFromSessionClaims(
  claims: SessionClaims
): "admin" | "member" | null {
  if (!claims || !Object.prototype.hasOwnProperty.call(claims, "role")) return null;
  const raw = claims.role;
  if (raw === null || raw === undefined || raw === "") return "member";
  if (typeof raw !== "string") return null;
  const r = raw.toLowerCase();
  if (r === "admin") return "admin";
  return "member";
}
