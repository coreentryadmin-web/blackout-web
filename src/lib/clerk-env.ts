/**
 * Clerk redirect allowlist — primary app must allow post-auth return to staging satellite.
 */
export function clerkAllowedRedirectOrigins(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (site.includes("staging.")) {
    return [site];
  }
  return ["https://staging.blackouttrades.com"];
}
