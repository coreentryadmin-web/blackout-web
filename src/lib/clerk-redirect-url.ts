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
