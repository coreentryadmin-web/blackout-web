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

/**
 * True for `/dashboard`, `/flows?x=1`; false for `https://…`, `//evil.com`, bare paths.
 *
 * A literal prefix check alone (`startsWith("/") && !startsWith("//")`) is not enough: per the
 * WHATWG URL spec, a backslash is treated the same as a forward slash when resolving a relative
 * reference against a "special" (http/https) base — so `/\evil.com` and `/\/evil.com` both START
 * an authority (host) component exactly like `//evil.com` does, even though neither begins with
 * two literal `/` characters. Confirmed live: `new URL("/\\evil.com", "https://blackouttrades.com")`
 * resolves to origin `https://evil.com`, not `https://blackouttrades.com`. Every current caller of
 * this function happens to be shielded anyway (`clerkStagingReturnPath` always re-derives
 * `pathname + search` from the parsed URL, discarding whatever host the parser landed on) — but
 * that is a second, incidental layer, not something this function's own contract relies on, and
 * it is exported as a general-purpose "is this safe to redirect to" check. Resolve against a
 * sentinel base and require the host to be unchanged, so a backslash can never smuggle a new host
 * past this check regardless of what a future caller does with the result.
 */
export function isSafeAppRelativePath(raw: string): boolean {
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  try {
    const probe = new URL(raw, "http://same-origin.invalid");
    return probe.host === "same-origin.invalid";
  } catch {
    return false;
  }
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
