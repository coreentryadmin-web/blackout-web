/**
 * Authenticated HTTP for RTH audit scripts — tries CRON bearer first, falls back
 * to a disposable Clerk premium session when the cloud agent's CRON_SECRET is stale.
 */
import { isAuthFailureStatus } from "./auth-status.mjs";
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";

/**
 * @param {{ base: string, cronSecret?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ fetchJson: (path: string, opts?: RequestInit) => Promise<unknown>, authVia: string, cleanup: () => Promise<void> }>}
 */
export async function createAuditHttpClient({ base, cronSecret = process.env.CRON_SECRET?.trim() ?? "", timeoutMs = 120_000 }) {
  const appUrl = base.replace(/\/$/, "");
  let cookieHeader = null;
  let cleanup = async () => {};

  async function probeCron() {
    if (!cronSecret) return false;
    try {
      const r = await fetch(`${appUrl}/api/market/spx/desk`, {
        headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  let authVia = "cron";
  if (!(await probeCron())) {
    const clerk = await mintClerkPremiumSession({ appUrl });
    if (clerk.skip) {
      throw new Error(
        clerk.reason ||
          "CRON_SECRET rejected and Clerk fallback unavailable — set CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
      );
    }
    cookieHeader = clerk.cookieHeader;
    cleanup = clerk.cleanup;
    authVia = "clerk";
  }

  function authHeaders() {
    if (authVia === "cron") {
      return { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" };
    }
    return { Cookie: cookieHeader, Accept: "application/json" };
  }

  async function fetchJson(path, opts = {}) {
    const url = `${appUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      ...authHeaders(),
      ...(opts.headers || {}),
    };

    const r = await fetch(url, {
      ...opts,
      headers,
      signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (isAuthFailureStatus(r.status)) {
      throw new Error(`HTTP ${r.status} ${path} (auth via ${authVia})`);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
    return r.json();
  }

  return { fetchJson, authVia, authHeaders, cleanup };
}