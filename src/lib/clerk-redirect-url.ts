/**
 * Post-auth return URLs for primary → staging satellite handoff.
 */

const STAGING_ORIGIN = "https://staging.blackouttrades.com";

/** Strip failed-sync noise; only allow returns to staging. */
export function clerkSanitizeStagingReturnUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return `${STAGING_ORIGIN}${trimmed}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.origin !== STAGING_ORIGIN) return null;
    url.searchParams.delete("__clerk_synced");
    url.searchParams.delete("__clerk_db_jwt");
    return url.toString();
  } catch {
    return null;
  }
}

/** Default path after sign-in when no redirect_url is provided. */
export const CLERK_DEFAULT_POST_AUTH_PATH = "/dashboard";

/** Path on staging for satellite redirect helper (must start with /). */
export function clerkStagingReturnPath(raw: string | undefined | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "/";
  if (trimmed.startsWith("/")) {
    try {
      const u = new URL(trimmed, STAGING_ORIGIN);
      u.searchParams.delete("__clerk_synced");
      return `${u.pathname}${u.search}`;
    } catch {
      return trimmed;
    }
  }
  const full = clerkSanitizeStagingReturnUrl(trimmed);
  if (!full) return "/";
  const u = new URL(full);
  return `${u.pathname}${u.search}`;
}

/**
 * Post-auth destination: explicit redirect_url wins; otherwise send users to the desk
 * (not the public marketing homepage — avoids sign-in ↔ / loops and duplicate "homepages").
 */
export function clerkPostAuthReturnPath(raw: string | undefined | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return CLERK_DEFAULT_POST_AUTH_PATH;
  return clerkStagingReturnPath(trimmed);
}

export function clerkIsClerkSyncFailed(url: URL): boolean {
  return url.searchParams.get("__clerk_synced") === "false";
}
