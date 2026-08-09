/**
 * Mint a temp Clerk member at a SPECIFIC tier, with NO admin role by default.
 *
 * Split from prod-clerk-session.mjs (hardcoded admin+premium) because
 * requireTier() in auth-access.ts short-circuits to premium for admins — an
 * admin temp user passes every gate and proves nothing about tier enforcement.
 *
 * Same FAPI ticket-exchange flow, same one-user-per-run + delete-in-finally
 * discipline. No payment is taken; production tier is Whop-driven but resolves
 * through this same publicMetadata field, so the gate exercised is identical.
 */
// Minimal, fetch-based port of scripts/audit/data-validator.mjs's temp-user
// Clerk sign-in flow (mint sign_in_token -> FAPI ticket exchange -> session
// cookie), factored out into its own file so a SECOND validator
// (spx-bie-consistency-validator.mjs's opt-in Layer C) can reuse it without
// modifying data-validator.mjs itself — this file is purely additive.
//
// Deliberately narrower than data-validator.mjs's inline version: only what
// Layer C needs (one session, one query, then delete the user). No cookie-jar
// file on disk (data-validator.mjs's curl-based approach needs one; this
// fetch-based version threads Set-Cookie -> Cookie manually in memory).
//
// ONE temp user per call, ALWAYS deleted via the returned cleanup(). Secrets
// from env only — never hardcode/commit.
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";

function fapiHost(publishableKey) {
  try {
    const decoded = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (decoded.includes(".")) return `https://${decoded}`;
  } catch {
    /* fall through to default below */
  }
  return "https://clerk.blackouttrades.com";
}

function collectSetCookies(res) {
  // Node's fetch (undici) exposes multiple Set-Cookie headers via
  // getSetCookie(); older runtimes only expose the first via .get(). Both
  // paths are covered so this degrades gracefully rather than silently
  // dropping cookies on an older Node.
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

import { createAuditClerkUser, deleteAuditClerkUser } from "./clerk-audit-user.mjs";

/** Mints one temp admin/premium Clerk session against a live deployment.
 *  Returns `{ skip: true, reason }` if secrets aren't configured or any step
 *  fails (never throws) — callers should treat that as a SKIP, not a FAIL,
 *  matching every other fail-open probe in this audit toolkit. On success,
 *  returns `{ skip: false, cookieHeader, cleanup }` — cleanup() deletes the
 *  temp user and must always be called (e.g. in a `finally`). */
export async function mintTierSession({ appUrl, tier = "community", role = null }) {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret || !publishableKey) {
    return { skip: true, reason: "CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set" };
  }
  // Distinct e-mail per tier so a leftover premium temp user is never adopted
  // and silently re-used for a community run — that would fake a pass.
  const email = process.env.AUDIT_TIER_EMAIL || `claude-tier-${tier}@blackouttrades.com`;
  const fapi = fapiHost(publishableKey);
  const backend = (method, path, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  let userId = null;
  try {
    const created = await createAuditClerkUser({
      secret,
      email,
      publicMetadata: role ? { role, tier } : { tier },
    });
    userId = created.userId;
    if (!userId) return { skip: true, reason: created.error ?? "could not create or adopt a temp Clerk user" };

    const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
    const ticket = (await tokenRes.json().catch(() => null))?.token;
    if (!ticket) return { skip: true, reason: "sign_in_tokens mint failed" };

    const signInRes = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
      method: "POST",
      headers: { Origin: appUrl, Referer: `${appUrl}/`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ strategy: "ticket", ticket }),
    });
    const signInCookies = collectSetCookies(signInRes);
    const signInJson = await signInRes.json().catch(() => null);
    const sessionId = signInJson?.response?.created_session_id;
    if (!sessionId) return { skip: true, reason: "FAPI ticket exchange did not return created_session_id" };

    // Pinned once (not recomputed per-request) — see data-validator.mjs's own
    // comment on session-token-iat-before-client-uat for why recomputing this
    // per call would intermittently 401 every request after the first.
    const clientUat = Math.floor(Date.now() / 1000);
    const mintRes = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
      method: "POST",
      headers: {
        Origin: appUrl,
        Referer: `${appUrl}/`,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: signInCookies.join("; "),
      },
    });
    const jwt = (await mintRes.json().catch(() => null))?.jwt;
    if (!jwt) return { skip: true, reason: "session token mint failed" };

    return {
      skip: false,
      userId,
      cookieHeader: `__session=${jwt}; __client_uat=${clientUat}`,
      signInUrl: `${appUrl}/sign-in?__clerk_ticket=${ticket}`,
      cleanup: async () => {
        await deleteAuditClerkUser(secret, userId);
      },
    };
  } catch (e) {
    return { skip: true, reason: `Clerk auth flow failed: ${e.message}` };
  }
}
