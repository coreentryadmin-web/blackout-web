/**
 * Bridge a verified native OAuth identity (Google/Apple ID token payload) into
 * a Clerk session.
 *
 * Flow (matches how the audit script mints a temp session — see
 * scripts/audit/lib/prod-clerk-session.mjs for the tested path):
 *
 *   1. Look up an existing Clerk user by email.
 *   2. If missing, create the user with `skip_password_requirement: true` so
 *      Clerk doesn't demand a password the OAuth-bearing member never has.
 *   3. Mint a `sign_in_tokens` ticket via Backend API for that user_id.
 *   4. Exchange the ticket at Clerk FAPI `/v1/client/sign_ins?strategy=ticket`
 *      → gets a `created_session_id` + intermediate cookies.
 *   5. Mint the actual `__session` JWT at `/v1/client/sessions/{sid}/tokens`.
 *   6. Return the cookies for the response to set on the caller's browser.
 *
 * SECURITY:
 *   - Called ONLY from the server-side endpoint that has already verified the
 *     provider's identity token (jwtVerify against Google/Apple JWKS + audience
 *     + optional nonce). This module trusts the `email`/`sub` it receives.
 *   - Requires `CLERK_SECRET_KEY` — Backend API auth. Never expose to the
 *     client. Reads from env; throws if missing so a mis-configured deploy
 *     fails fast instead of silently ceding sessions.
 *   - No password path — the user auth-strategy is either the provider's
 *     token or (later) Clerk's OTP. We deliberately never mint a password.
 */

const CLERK_API = "https://api.clerk.com/v1";
const CJS = "5.57.0"; // Match the version the site's Clerk JS loader uses.

function fapiHost(publishableKey: string): string {
  try {
    const decoded = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (decoded.includes(".")) return `https://${decoded}`;
  } catch {
    // fall through
  }
  return "https://clerk.blackouttrades.com";
}

function collectSetCookies(res: Response): string[] {
  const anyRes = res.headers as unknown as { getSetCookie?: () => string[]; get: (k: string) => string | null };
  const raw =
    typeof anyRes.getSetCookie === "function"
      ? anyRes.getSetCookie()
      : ([anyRes.get("set-cookie")].filter(Boolean) as string[]);
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

export type BridgedSession = {
  cookieHeader: string;
  userId: string;
  wasNewUser: boolean;
};

/**
 * Ensure a Clerk user exists for this email; return their id.
 * Creates with `skip_password_requirement` so the OAuth user has no password.
 */
async function ensureClerkUser(
  secret: string,
  { email, name, provider, sub }: { email: string; name: string | null; provider: "google" | "apple"; sub: string }
): Promise<{ id: string; created: boolean }> {
  // Look up first — cheaper and avoids race with form_identifier_exists.
  const lookup = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}&limit=1`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const existing = (await lookup.json().catch(() => [])) as Array<{ id?: string }>;
  if (Array.isArray(existing) && existing[0]?.id) {
    return { id: existing[0].id, created: false };
  }

  // Not found — create. Split "First Last" naming best-effort; Clerk requires
  // BOTH first_name + last_name empty OR both provided (or accepts individual).
  const parts = (name ?? "").trim().split(/\s+/);
  const firstName = parts[0] || undefined;
  const lastName = parts.slice(1).join(" ") || undefined;

  const createRes = await fetch(`${CLERK_API}/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [email],
      first_name: firstName,
      last_name: lastName,
      skip_password_requirement: true,
      // Note the native-OAuth path so downstream reporting can tell the
      // source. Kept in `unsafe_metadata` (client-visible per Clerk docs) so
      // future client-side flows (Whop link, admin dashboards) can read it.
      unsafe_metadata: { native_oauth: { provider, sub, attached_at: new Date().toISOString() } },
    }),
  });
  const created = (await createRes.json().catch(() => null)) as { id?: string; errors?: unknown } | null;
  if (created?.id) return { id: created.id, created: true };

  // Race — someone else made the account since our lookup. Re-query.
  const secondLookup = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}&limit=1`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const later = (await secondLookup.json().catch(() => [])) as Array<{ id?: string }>;
  if (Array.isArray(later) && later[0]?.id) return { id: later[0].id, created: false };

  throw new Error(
    `clerk user creation failed for ${email}: ${JSON.stringify(created?.errors ?? "no response body")}`
  );
}

/**
 * Full bridge: verify caller has already validated `verified.email/sub`.
 * Returns the `Cookie:` header value the API endpoint should set on the
 * client response (Set-Cookie splitting is handled at the route level).
 */
export async function mintClerkSessionFromNativeOAuth(
  verified: { provider: "google" | "apple"; email: string; sub: string; name: string | null },
  { appUrl }: { appUrl: string }
): Promise<BridgedSession> {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY not configured");
  if (!publishableKey) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not configured");
  if (!verified.email) {
    // Apple relay email — sub-only sign-in is possible via oauth_accounts on
    // Clerk, but for the first-touch bridge we require an email. The client
    // component sends the Apple `email` field from the first-touch OAuth
    // callback; subsequent logins reuse the same user by sub.
    throw new Error("native-oauth verify returned empty email — cannot bridge yet");
  }

  const fapi = fapiHost(publishableKey);
  const { id: userId, created } = await ensureClerkUser(secret, {
    email: verified.email,
    name: verified.name,
    provider: verified.provider,
    sub: verified.sub,
  });

  const tokenRes = await fetch(`${CLERK_API}/sign_in_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  const ticketJson = (await tokenRes.json().catch(() => null)) as { token?: string } | null;
  const ticket = ticketJson?.token;
  if (!ticket) throw new Error("clerk sign_in_tokens mint failed");

  const signInRes = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: {
      Origin: appUrl,
      Referer: `${appUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ strategy: "ticket", ticket }),
  });
  const intermediateCookies = collectSetCookies(signInRes);
  const signInJson = (await signInRes.json().catch(() => null)) as
    | { response?: { created_session_id?: string } }
    | null;
  const sessionId = signInJson?.response?.created_session_id;
  if (!sessionId) throw new Error("clerk FAPI ticket exchange did not create a session");

  const mintRes = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: {
      Origin: appUrl,
      Referer: `${appUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: intermediateCookies.join("; "),
    },
  });
  const mintJson = (await mintRes.json().catch(() => null)) as { jwt?: string } | null;
  const jwt = mintJson?.jwt;
  if (!jwt) throw new Error("clerk session token mint failed");

  // __client_uat pinned once per bridge — recomputing it per subsequent
  // request has been observed to intermittently 401 (see the audit script's
  // note on session-token iat < client_uat).
  const clientUat = Math.floor(Date.now() / 1000);
  return {
    cookieHeader: `__session=${jwt}; __client_uat=${clientUat}`,
    userId,
    wasNewUser: created,
  };
}
