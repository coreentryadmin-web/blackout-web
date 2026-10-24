/**
 * Post-auth return URLs for primary → staging satellite handoff.
 *
 * Open-redirect rule: only same-app relative paths (leading `/`, not `//`) or
 * absolute URLs whose origin is the staging satellite. Absolute attacker URLs
 * and protocol-relative URLs (`//evil.com`) must never leave BlackOut.
 */

const STAGING_ORIGIN = "https://staging.blackouttrades.com";

/**
 * Next.js `searchParams` yields a `string[]` for a repeated query key (e.g.
 * `?redirect_url=a&redirect_url=b`) even though route `Props` types commonly
 * (and incorrectly) declare it as a bare `string` — `tsc` cannot catch the
 * mismatch since the declared type is just wrong, not unsound given its own
 * premise. A `.trim()` on the array crashes with a real, live-observed
 * `TypeError: a?.trim is not a function` on `/sign-up` and `/sign-in`. Always
 * take the first value, same as `URLSearchParams.get()` already does for the
 * one caller (middleware) that isn't reading from `searchParams` directly.
 */
function firstRedirectParam(raw: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

/** True for `/dashboard`, `/flows?x=1`; false for `https://…`, `//evil.com`, bare paths. */
export function isSafeAppRelativePath(raw: string): boolean {
  return raw.startsWith("/") && !raw.startsWith("//");
}

/** Strip failed-sync noise; only allow returns to staging. */
export function clerkSanitizeStagingReturnUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  if (isSafeAppRelativePath(trimmed)) {
    return `${STAGING_ORIGIN}${trimmed}`;
  }

  // Protocol-relative (`//evil.com`) and other non-absolute junk — reject.
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;

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

/** Default path after sign-in when no redirect_url is provided (unified marketing home). */
export const CLERK_DEFAULT_POST_AUTH_PATH = "/";

/** Path on staging for satellite redirect helper (must start with /). */
export function clerkStagingReturnPath(raw: string | undefined | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "/";
  if (isSafeAppRelativePath(trimmed)) {
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

/** Post-auth destination: explicit redirect_url wins; otherwise the unified marketing home. */
export function clerkPostAuthReturnPath(raw: string | string[] | undefined | null): string {
  const trimmed = firstRedirectParam(raw)?.trim();
  if (!trimmed) return CLERK_DEFAULT_POST_AUTH_PATH;
  return clerkStagingReturnPath(trimmed);
}

export function clerkIsClerkSyncFailed(url: URL): boolean {
  return url.searchParams.get("__clerk_synced") === "false";
}
