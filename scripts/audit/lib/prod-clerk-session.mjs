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

/**
 * Merge freshly-issued `name=value` cookies into an existing jar IN PLACE, replacing any prior
 * entry with the same name. Clerk rotates `__client` on the token endpoint, so a jar that only
 * ever appends (or never updates) goes stale and the session silently stops refreshing.
 */
export function mergeCookies(jar, incoming) {
  for (const c of incoming) {
    const name = c.split("=")[0];
    const at = jar.findIndex((existing) => existing.split("=")[0] === name);
    if (at >= 0) jar[at] = c;
    else jar.push(c);
  }
  return jar;
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
/**
 * Mint a live session for a temp Clerk user.
 *
 * `publicMetadata` defaults to admin+premium — the shape every existing audit harness needs, so
 * they are unaffected. It is a parameter so an entitlement check can mint a NON-admin member and
 * verify what that member can actually reach. Verifying a gate with an admin credential proves
 * nothing about the gate.
 *
 * `email` is overridable for the same reason: Clerk enforces uniqueness on the address, so two
 * users with different tiers cannot share one.
 */
export async function mintClerkPremiumSession({
  appUrl,
  publicMetadata = { role: "admin", tier: "premium" },
  email: emailOverride = null,
}) {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret || !publishableKey) {
    return { skip: true, reason: "CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set" };
  }
  const email = emailOverride || process.env.AUDIT_EMAIL || "claude-audit-temp@blackouttrades.com";
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
      publicMetadata,
    });
    userId = created.userId;
    if (!userId) return { skip: true, reason: created.error ?? "could not create or adopt a temp Clerk user" };

    /**
     * Full sign-in for `userId`: mint a ticket, exchange it, take a first JWT.
     *
     * Extracted so `refresh()` can REDO it. Everything it produces (the client-cookie jar, the
     * session id, the pinned `__client_uat`) is state that Clerk can invalidate as a SET — when it
     * does, rotating the token alone cannot recover, because the token endpoint is exactly what
     * stopped working. Re-establishing is the only way back.
     *
     * Reuses the SAME Clerk user. CLAUDE.md's "authenticate once per run" warning is about FAPI
     * rate-limiting rapid sign-in cycles; this fires only on demonstrated failure and is throttled
     * by `MIN_REESTABLISH_MS` below, so a long run performs a handful, not one per request.
     */
    const establish = async () => {
      const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
      const ticket = (await tokenRes.json().catch(() => null))?.token;
      if (!ticket) return { error: "sign_in_tokens mint failed" };

      const signInRes = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
        method: "POST",
        headers: { Origin: appUrl, Referer: `${appUrl}/`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ strategy: "ticket", ticket }),
      });
      // MUTABLE jar: `refresh()` rotates these in place (see the WHY on refresh below). It was a
      // `const` snapshot, which is what made long-running sessions die at ~72s.
      const cookies = collectSetCookies(signInRes);
      const signInJson = await signInRes.json().catch(() => null);
      const sid = signInJson?.response?.created_session_id;
      if (!sid) return { error: "FAPI ticket exchange did not return created_session_id" };

      // Pinned once per establishment (not recomputed per-request) — see data-validator.mjs's own
      // comment on session-token-iat-before-client-uat for why recomputing this
      // per call would intermittently 401 every request after the first.
      const uat = Math.floor(Date.now() / 1000);
      const mintRes = await fetch(`${fapi}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, {
        method: "POST",
        headers: {
          Origin: appUrl,
          Referer: `${appUrl}/`,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookies.join("; "),
        },
      });
      const firstJwt = (await mintRes.json().catch(() => null))?.jwt;
      if (!firstJwt) return { error: "session token mint failed" };
      return { cookies, sessionId: sid, clientUat: uat, jwt: firstJwt, ticket };
    };

    const first = await establish();
    if (first.error) return { skip: true, reason: first.error };

    // Mutable across re-establishment. `let`, not `const`: a re-established session replaces the
    // jar, the session id AND the pinned uat together — they are only valid as a matched set.
    let clientCookies = first.cookies;
    let sessionId = first.sessionId;
    let clientUat = first.clientUat;
    // Kept for `signInUrl` (a browser hand-off used by the UI harnesses). Re-establishing mints a
    // NEW ticket, so this tracks the latest rather than the first — a stale ticket is single-use
    // and would hand a caller a sign-in link that silently fails.
    let ticket = first.ticket;
    const jwt = first.jwt;

    /**
     * Floor between re-establishments. Guards the one way this recovery could make things worse:
     * if the FAPI sign-in path is itself rate-limited or down, an unthrottled retry would hammer it
     * once per request and turn a degraded run into an abusive one. A run needing more than one
     * re-establish per minute has a real outage behind it, and should surface as 401s rather than
     * quietly retry forever.
     */
    const MIN_REESTABLISH_MS = 60_000;
    let lastEstablishedAt = Date.now();

    /**
     * Re-mint the session JWT. This is the SAME call the browser's Clerk client makes on a timer.
     *
     * MEASURED 2026-08-09: the minted `__session` JWT is dead ~72s after issue, and continuous
     * requests do NOT extend it — 200 at t+61s, 401 at t+72s, still 401 at t+194s under load. A
     * fixed lifetime, not an idle timeout. Every long-running audit was therefore unauthenticated
     * for its remainder, and because a 401 surfaces as an empty panel it looked like a PRODUCT
     * fault: the "GEX ladder unavailable" state chased in #1961 was this, not a bug.
     *
     * Not FAPI-rate-limit relevant in the way sign-in is: this re-uses the EXISTING session's
     * cookies rather than performing a fresh ticket exchange, so it is not the "authenticate once
     * per run" path CLAUDE.md warns about. Still, call it on a timer measured in tens of seconds,
     * not per request.
     *
     * `__client_uat` stays PINNED at its original value — see the comment above; recomputing it
     * per call intermittently 401s every request after the first.
     */
    const refresh = async () => {
      const r = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
        method: "POST",
        headers: {
          Origin: appUrl,
          Referer: `${appUrl}/`,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: clientCookies.join("; "),
        },
      });
      // ROTATE the client cookies from the response before reading the JWT.
      //
      // WHY: Clerk rotates the `__client` cookie on this endpoint. The original implementation
      // captured the sign-in cookies ONCE and replayed them forever, so after ~50s the replayed
      // `__client` was stale, FAPI stopped issuing, and refresh() returned null — silently, since
      // it fails open. Every long-running audit then ran on the ORIGINAL JWT until it died at ~72s
      // and 401'd for the rest of the run. MEASURED 2026-08-17: refresh OK at t=0, null at t=50s,
      // while three back-to-back calls at t=0 all succeeded — i.e. time-based staleness of the
      // client cookie, not a per-call limit. This had already been mis-read as a product failure
      // three separate times (thermal validator sectors, force-rebuild "IWM 0/5", the Vector
      // board poll), which is why the rotation is done here rather than worked around per-harness.
      mergeCookies(clientCookies, collectSetCookies(r));
      const next = (await r.json().catch(() => null))?.jwt;
      if (next) return { jwt: next, cookieHeader: `__session=${next}; __client_uat=${clientUat}` };

      /**
       * TOKEN ENDPOINT STOPPED ISSUING — RE-ESTABLISH RATHER THAN FAIL OPEN.
       *
       * Returning null here (the previous behaviour) is unrecoverable by construction: every
       * caller's cookie jar keeps the dead JWT, so the run 401s for its entire remainder. The
       * cookie rotation above fixed the common cause of this, but not all of them — Clerk can drop
       * the SESSION itself, and no amount of rotating a token against a dead session revives it.
       *
       * MEASURED 2026-08-20: a paired Largo audit died at the 5th of 20 scenarios (~200s in). The
       * first four graded normally and the remaining 32 calls returned 401 in 70-900ms, which the
       * rollup then averaged into "latency median 0.5s, shapeFails 16" — a healthy system reported
       * as broken and fast. That is the third time this failure mode has been mis-read as a product
       * fault (thermal validator sectors, force-rebuild "IWM 0/5", now this), which is why the
       * recovery belongs HERE and not in each harness.
       */
      if (Date.now() - lastEstablishedAt < MIN_REESTABLISH_MS) {
        console.warn(
          `[clerk-session] refresh returned no JWT; re-establish throttled (${Math.round((MIN_REESTABLISH_MS - (Date.now() - lastEstablishedAt)) / 1000)}s left)`
        );
        return null;
      }
      const fresh = await establish();
      if (fresh.error) {
        // NEVER SILENT. The previous version returned null here with no log, which is the very
        // fail-open pattern this whole block exists to remove — reintroduced one level down. It
        // made the two failures indistinguishable from outside: "re-establish never ran" and
        // "re-establish ran and failed" both presented as a run that simply 401s forever.
        // MEASURED 2026-08-20: refresh went NULL at t=90s and stayed null; the app 401'd from
        // t=150s; and the success log never appeared — which proved nothing, because the failure
        // path had no log either.
        console.warn(`[clerk-session] re-establish FAILED: ${fresh.error}`);
        lastEstablishedAt = Date.now(); // throttle retries after a real failure, not just successes
        return null;
      }
      clientCookies = fresh.cookies;
      sessionId = fresh.sessionId;
      clientUat = fresh.clientUat;
      ticket = fresh.ticket;
      lastEstablishedAt = Date.now();
      console.warn("[clerk-session] token endpoint stopped issuing — re-established the session");
      return { jwt: fresh.jwt, cookieHeader: `__session=${fresh.jwt}; __client_uat=${clientUat}` };
    };

    return {
      skip: false,
      userId,
      refresh,
      cookieHeader: `__session=${jwt}; __client_uat=${clientUat}`,
      get signInUrl() { return `${appUrl}/sign-in?__clerk_ticket=${ticket}`; },
      cleanup: async () => {
        await deleteAuditClerkUser(secret, userId);
      },
    };
  } catch (e) {
    return { skip: true, reason: `Clerk auth flow failed: ${e.message}` };
  }
}
