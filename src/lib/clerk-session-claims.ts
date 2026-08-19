import { parseTier, type Tier } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";
import { parseToolAccessMap, type ToolAccessMode } from "@/lib/tool-user-access";

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

/** True when JWT carries publicMetadata.tool_access (Clerk session claim configured). */
export function sessionClaimsHaveToolAccessField(claims: SessionClaims): boolean {
  if (!claims || typeof claims !== "object") return false;
  return Object.prototype.hasOwnProperty.call(claims, "tool_access");
}

/**
 * Per-tool override from JWT; null → no tool_access claim (caller may fall back to getUser).
 * When claim exists but key absent, returns inherit.
 */
export function toolAccessModeFromSessionClaims(
  claims: SessionClaims,
  key: ToolKey
): ToolAccessMode | null {
  if (!sessionClaimsHaveToolAccessField(claims)) return null;
  const map = parseToolAccessMap((claims as Record<string, unknown>).tool_access);
  return map[key] ?? "inherit";
}
