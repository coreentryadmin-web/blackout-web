/**
 * Audit HTTP fetch — tries CRON bearer first, falls back to a temp Clerk session
 * when the cloud agent's CRON_SECRET is stale/mismatched (common in Cursor Cloud).
 */
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";

let clerkSession = null;
let clerkSessionPromise = null;

async function ensureClerkSession(appUrl) {
  if (clerkSession && !clerkSession.skip) return clerkSession;
  if (!clerkSessionPromise) {
    clerkSessionPromise = mintClerkPremiumSession({ appUrl }).then((session) => {
      clerkSession = session;
      return session;
    });
  }
  return clerkSessionPromise;
}

/** Release any minted Clerk session (call in finally). */
export async function releaseAuditFetchSession() {
  if (clerkSession && !clerkSession.skip && clerkSession.cleanup) {
    await clerkSession.cleanup();
  }
  clerkSession = null;
  clerkSessionPromise = null;
}

/**
 * Fetch JSON from a member/cron API route. Tries Bearer CRON_SECRET first; on 401/403
 * retries once with a temp admin Clerk cookie.
 */
export async function auditFetchJson(appUrl, path, { cronSecret = process.env.CRON_SECRET, timeoutMs = 90_000, retries = 2 } = {}) {
  const url = `${appUrl.replace(/\/$/, "")}${path}`;
  const headers = { Accept: "application/json" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (cronSecret?.trim()) {
      const r = await fetch(url, {
        headers: { ...headers, Authorization: `Bearer ${cronSecret.trim()}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return { status: r.status, json: await r.json(), via: "cron" };
      if (r.status !== 401 && r.status !== 403) {
        if ((r.status === 504 || r.status === 524) && attempt < retries) continue;
        return { status: r.status, json: await r.json().catch(() => null), via: "cron" };
      }
    }

    const session = await ensureClerkSession(appUrl);
    if (session.skip) {
      return { status: 401, json: null, via: "none", reason: session.reason };
    }

    const r = await fetch(url, {
      headers: { ...headers, Cookie: session.cookieHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return { status: r.status, json: await r.json(), via: "clerk" };
    if ((r.status === 504 || r.status === 524) && attempt < retries) continue;
    return { status: r.status, json: await r.json().catch(() => null), via: "clerk" };
  }

  return { status: 504, json: null, via: "none" };
}
