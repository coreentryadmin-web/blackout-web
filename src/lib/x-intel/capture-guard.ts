/**
 * CAPTURE GUARD — what a screenshot may be taken FROM.
 *
 * CLIENT-SAFE and dependency-free: pure string work, no `pg`, no `server-only`. It is imported by
 * a Playwright `.mjs` harness, by the queue store, and (later) by the admin panel, and it must be
 * exactly ONE rule in exactly one place. A second copy of this list is the drift bug it exists to
 * prevent.
 *
 * ── WHY THIS IS ENFORCED IN CODE AND NOT BY CARE ───────────────────────────────────────────────
 *
 * `scripts/audit/lib/clerk-audit-user.mjs` stamps every temp user with
 * `DEFAULT_AUDIT_METADATA = { role: "admin", tier: "premium" }`. So the browser that captures
 * BLACKOUT surfaces for a PUBLIC X post is an ADMIN browser by default — it can load `/admin`,
 * admin APIs, and every admin-gated panel. A privileged frame is not an unlikely accident here; it
 * is the standing capability of the capture session.
 *
 * THE REALISTIC LEAK IS NOT A TYPO. Nobody is going to point the harness at `/admin`. What happens
 * is that the short-lived Clerk session (~60s `exp`) expires mid-run, the desk route bounces to
 * `/sign-in` or `/account`, and the harness screenshots the bounce — believing it captured a desk.
 * That is why the check runs against the page's URL AT SCREENSHOT TIME rather than against the URL
 * that was requested: those two are not the same string the moment a redirect is involved, and the
 * redirect is the failure mode.
 *
 * ── DENY FIRST, THEN ALLOW ─────────────────────────────────────────────────────────────────────
 *
 * Both lists, in that order, and the verdict is a REFUSAL rather than a warning:
 *
 * - The DENYLIST names what must never be captured. It is first so that a route which somehow
 *   appears on both can only ever resolve to "no".
 * - The ALLOWLIST names the surfaces this lane publishes. Anything not on it is refused. That is
 *   what makes an unknown route — a new admin page, a redirect somewhere unexpected, a route added
 *   after this file was written — fail CLOSED. A denylist alone can only refuse what it already
 *   knows about, which is precisely the wrong default when the cost of being wrong is a permanent
 *   public leak.
 *
 * The allowlist doubles as the surface inventory for the capture config table in step 3.
 */

/** Hosts a capture may come from. A frame from anywhere else cannot be vouched for. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "blackouttrades.com",
  "www.blackouttrades.com",
]);

/**
 * Never capturable. Checked first, and matched on the path PREFIX so that `/admin` and
 * `/admin/anything` are both covered while a desk route that merely contains the word is not.
 */
const DENY: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /^\/admin(\/|$)/i, why: "admin console" },
  { re: /^\/api\/admin(\/|$)/i, why: "admin API" },
  { re: /^\/api\/cron(\/|$)/i, why: "cron endpoint" },
  { re: /^\/api\/debug(\/|$)/i, why: "debug output" },
  { re: /^\/api\/webhooks(\/|$)/i, why: "webhook endpoint" },
  { re: /^\/sign-in(\/|$)/i, why: "auth screen" },
  { re: /^\/sign-up(\/|$)/i, why: "auth screen" },
  { re: /^\/account(\/|$)/i, why: "personal account page" },
  { re: /^\/settings(\/|$)/i, why: "personal settings page" },
  { re: /^\/billing(\/|$)/i, why: "billing page" },
  { re: /^\/checkout(\/|$)/i, why: "checkout page" },
];

/**
 * The surfaces this lane may publish a frame of. Real route names — there is no `/night-hawk` and
 * no `/swings`; see `docs/audit/LIVE-UI-CONNECTION.md`.
 *
 * Adding a route here is a decision to publish pictures of it. Anything absent is refused, so this
 * list is the allowlist for the whole lane, not a convenience.
 */
export const CAPTURABLE_SURFACE_PATHS: ReadonlyArray<{ re: RegExp; surface: string }> = [
  { re: /^\/vector(\/|$)/i, surface: "vector" },
  { re: /^\/flows(\/|$)/i, surface: "helix" },
  { re: /^\/heatmap(\/|$)/i, surface: "thermal" },
  { re: /^\/nighthawk(\/|$)/i, surface: "nighthawk" },
  { re: /^\/terminal(\/|$)/i, surface: "largo" },
  { re: /^\/meridian(\/|$)/i, surface: "meridian" },
  { re: /^\/dashboard(\/|$)/i, surface: "spx_slayer" },
  { re: /^\/track-record(\/|$)/i, surface: "track_record" },
];

/**
 * Query keys that expose internal state on an otherwise public route. `sim` is included because
 * `?sim=1` renders the ADMIN 0DTE SIMULATOR board (see `docs/audit/ZERODTE-SIMULATOR.md`) — a
 * synthetic session that looks exactly like a real one. Publishing a simulated play as live market
 * intelligence would be a fabricated claim with a real screenshot attached, which is worse than a
 * leak: it is a lie the evidence appears to support.
 */
const DENY_QUERY_KEYS = ["debug", "__debug", "trace", "sim", "impersonate"];

export type CaptureVerdict =
  | { ok: true; surface: string }
  | { ok: false; reason: string };

/**
 * Whether a frame from this URL may be captured and published.
 *
 * Refuses anything it cannot positively classify — an unparseable URL, a relative path, a foreign
 * host, a route not on the allowlist. A source that cannot be cleared must never degrade into an
 * allowed one, and `about:blank` (what Playwright shows before a navigation, and after a crash) is
 * refused by exactly the same rule rather than needing its own case.
 */
export function checkCaptureUrl(rawUrl: unknown): CaptureVerdict {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, reason: "no source URL — refusing to capture an unidentified page" };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `unparseable source URL: ${rawUrl.slice(0, 120)}` };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: `source URL must be https (got "${url.protocol}")` };
  }

  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: `refusing capture from a non-BLACKOUT host: ${url.hostname}` };
  }

  // Deny first — a route on both lists can only ever resolve to "no".
  for (const { re, why } of DENY) {
    if (re.test(url.pathname)) {
      return { ok: false, reason: `refusing capture from ${why}: ${url.pathname}` };
    }
  }

  for (const key of DENY_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      return {
        ok: false,
        reason: `refusing capture from a URL carrying "?${key}=" — internal or simulated state: ${url.pathname}${url.search}`,
      };
    }
  }

  const match = CAPTURABLE_SURFACE_PATHS.find((s) => s.re.test(url.pathname));
  if (!match) {
    return {
      ok: false,
      reason: `refusing capture from a route that is not an allowlisted BLACKOUT surface: ${url.pathname}`,
    };
  }

  return { ok: true, surface: match.surface };
}

/**
 * Throwing form, for the capture harness. Deliberately throws rather than returning a flag: a
 * caller that forgets to read a boolean silently captures the frame anyway, and the whole point is
 * that the refusal cannot be skipped by omission.
 */
export function assertCapturableUrl(rawUrl: unknown, context = "capture"): string {
  const verdict = checkCaptureUrl(rawUrl);
  if (!verdict.ok) {
    throw new Error(`[capture-guard] ${context}: ${verdict.reason}`);
  }
  return verdict.surface;
}
