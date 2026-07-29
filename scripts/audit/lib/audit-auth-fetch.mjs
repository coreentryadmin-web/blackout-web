/**
 * Authenticated fetch for audit probes — CRON bearer first, Clerk session fallback.
 * Cloud-agent CRON_SECRET often mismatches prod Secrets Manager; Clerk temp-user
 * auth is the authoritative member-path fallback (same as zerodte-logic-audit).
 */
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";

/** @type {{ cookieHeader: string, cleanup?: () => Promise<void> } | null} */
let clerkSessionCache = null;
/** Serialize concurrent mints — Promise.all cross-endpoint probes must not race. */
let clerkMintPromise = null;

async function clerkHeaders(base) {
  if (clerkSessionCache) return clerkSessionCache;
  if (!clerkMintPromise) {
    clerkMintPromise = (async () => {
      const session = await mintClerkPremiumSession({ appUrl: base });
      if (session.skip) return null;
      clerkSessionCache = { cookieHeader: session.cookieHeader, cleanup: session.cleanup };
      return clerkSessionCache;
    })().finally(() => {
      clerkMintPromise = null;
    });
  }
  return clerkMintPromise;
}

/** Release the cached Clerk temp user (call at end of long audit scripts). */
export async function releaseAuditClerkSession() {
  if (clerkMintPromise) await clerkMintPromise.catch(() => {});
  if (!clerkSessionCache) return;
  await clerkSessionCache.cleanup?.();
  clerkSessionCache = null;
}

/**
 * @param {string} base - e.g. https://blackouttrades.com
 * @param {string} path - e.g. /api/market/zerodte/board
 * @returns {Promise<{ ok: boolean, status: number, json: unknown, via: 'cron'|'clerk'|null }>}
 */
export async function fetchAuditJson(base, path) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const cron = process.env.CRON_SECRET?.trim();
  if (cron) {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" },
    });
    if (r.ok) return { ok: true, status: r.status, json: await r.json(), via: "cron" };
  }
  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await clerkHeaders(base);
      if (!session) break;
      const r = await fetch(url, {
        headers: { Cookie: session.cookieHeader, Accept: "application/json" },
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, status: r.status, json, via: "clerk" };
      if (r.status === 401 && attempt === 0) {
        await releaseAuditClerkSession();
        continue;
      }
      return { ok: false, status: r.status, json, via: "clerk" };
    }
  }
  return { ok: false, status: cron ? 401 : 0, json: null, via: null };
}
