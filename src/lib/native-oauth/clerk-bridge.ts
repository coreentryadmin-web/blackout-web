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
 * The verified native-OAuth identity plus the untrusted first-touch email, as the account resolver
 * needs to see it. `tokenEmail` is the email from the SIGNATURE-VERIFIED provider token (may be "");
 * `fallbackEmail` is the UNVERIFIED value the client relays on Apple's email-bearing first-touch.
 * Keeping them separate is the whole point — collapsing them is what allowed the takeover.
 */
export type NativeIdentity = {
  provider: "google" | "apple";
  sub: string;
  name: string | null;
  tokenEmail: string;
  tokenEmailVerified: boolean;
  fallbackEmail: string;
};

/** The Clerk Backend operations the resolver needs, abstracted so its decision tree is unit-testable
 *  without a live Clerk (or a live Apple-signed token). The real adapter is {@link clerkUsersApi}. */
export interface ClerkUsersApi {
  findByExternalId(externalId: string): Promise<{ id: string } | null>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  create(input: {
    email: string;
    externalId: string;
    name: string | null;
    provider: "google" | "apple";
    sub: string;
  }): Promise<{ id: string } | null>;
  bindExternalId(userId: string, externalId: string): Promise<void>;
}

/** The stable per-provider identity key. Clerk `external_id` is the join column the resolver trusts. */
export function externalIdFor(provider: "google" | "apple", sub: string): string {
  return `${provider}:${sub}`;
}

/**
 * Resolve (or create) the Clerk user for a verified native-OAuth identity — the account-takeover fix.
 *
 * THE RULE: an EXISTING account may be selected only when it is provably bound to the verified
 * provider identity (`provider:sub`, via Clerk `external_id`). An unverified, client-supplied
 * `fallbackEmail` may seed a BRAND-NEW account but must never select or link an existing one.
 *
 * The pre-fix bridge looked accounts up by email — and the route fed it `verified.email ||
 * fallbackEmail`, so a signed Apple token with no email claim (Apple's documented "subsequent
 * authorization" behaviour) let an attacker pass a victim's email as `fallbackEmail` and be minted
 * the victim's session (CWE-639, account takeover). The docblocks claimed a `sub`-based match that
 * never existed. This restores that intent for real.
 *
 * Pure w.r.t. its `api` collaborator so the decision tree is exercised directly in tests.
 */
export async function resolveNativeOAuthUser(
  api: ClerkUsersApi,
  ident: NativeIdentity
): Promise<{ id: string; created: boolean }> {
  const externalId = externalIdFor(ident.provider, ident.sub);

  // (1) Provably the same identity — the ONLY trustworthy way to select an existing account. This is
  //     also the normal path for every returning user (the sub is stable across logins).
  const bound = await api.findByExternalId(externalId);
  if (bound) return { id: bound.id, created: false };

  // (2) First contact from this identity. A VERIFIED token email is a trustworthy join key, so we
  //     may adopt a pre-existing account under it (e.g. a web signup linking iOS Apple) and bind it.
  const verifiedEmail = ident.tokenEmail && ident.tokenEmailVerified ? ident.tokenEmail : "";
  if (verifiedEmail) {
    const existing = await api.findByEmail(verifiedEmail);
    if (existing) {
      await api.bindExternalId(existing.id, externalId); // future logins match by sub, not email
      return { id: existing.id, created: false };
    }
    const created = await api.create({ email: verifiedEmail, externalId, name: ident.name, provider: ident.provider, sub: ident.sub });
    if (created) return { id: created.id, created: true };
    const later = await api.findByEmail(verifiedEmail);
    if (later) {
      await api.bindExternalId(later.id, externalId);
      return { id: later.id, created: false };
    }
    throw new Error("native-oauth: clerk user creation failed (verified email)");
  }

  // (3) No verified email — only an UNVERIFIED fallbackEmail (Apple relay first-touch). We may create
  //     a NEW account seeded with it, but MUST NOT select or link an existing account — that is the
  //     takeover. Any collision fails closed.
  const seed = ident.fallbackEmail.trim().toLowerCase();
  if (!seed) {
    throw new Error("native-oauth: unbound identity with no verified email — refusing to sign in");
  }
  const collision = await api.findByEmail(seed);
  if (collision) {
    throw new Error("native-oauth: refusing to bind an unverified email to an existing account");
  }
  const created = await api.create({ email: seed, externalId, name: ident.name, provider: ident.provider, sub: ident.sub });
  if (created) return { id: created.id, created: true };
  // Creation failed with no collision on our read. Do NOT fall back to a by-email match (that would
  // reopen the hole). Only accept a concurrent create of the SAME identity.
  const raced = await api.findByExternalId(externalId);
  if (raced) return { id: raced.id, created: false };
  throw new Error("native-oauth: clerk user creation failed (fallback email)");
}

/** Real Clerk Backend adapter for {@link resolveNativeOAuthUser}. */
function clerkUsersApi(secret: string): ClerkUsersApi {
  const auth = { Authorization: `Bearer ${secret}` };
  const firstId = async (res: Response): Promise<{ id: string } | null> => {
    const rows = (await res.json().catch(() => [])) as Array<{ id?: string }>;
    return Array.isArray(rows) && rows[0]?.id ? { id: rows[0].id } : null;
  };
  return {
    async findByExternalId(externalId) {
      const res = await fetch(`${CLERK_API}/users?external_id=${encodeURIComponent(externalId)}&limit=1`, { headers: auth });
      return firstId(res);
    },
    async findByEmail(email) {
      const res = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}&limit=1`, { headers: auth });
      return firstId(res);
    },
    async create({ email, externalId, name, provider, sub }) {
      // Split "First Last" best-effort; Clerk accepts individual name fields.
      const parts = (name ?? "").trim().split(/\s+/);
      const firstName = parts[0] || undefined;
      const lastName = parts.slice(1).join(" ") || undefined;
      const res = await fetch(`${CLERK_API}/users`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          email_address: [email],
          external_id: externalId, // the identity binding future logins match on
          first_name: firstName,
          last_name: lastName,
          skip_password_requirement: true,
          unsafe_metadata: { native_oauth: { provider, sub, attached_at: new Date().toISOString() } },
        }),
      });
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      return created?.id ? { id: created.id } : null;
    },
    async bindExternalId(userId, externalId) {
      await fetch(`${CLERK_API}/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ external_id: externalId }),
      });
    },
  };
}

/**
 * Full bridge for a native-OAuth identity the caller has already signature-verified. Resolves the
 * Clerk user via {@link resolveNativeOAuthUser} (identity-bound, takeover-safe), mints a session, and
 * returns the `Cookie:` header value the route should set (Set-Cookie splitting is at the route).
 *
 * Takes the FULL identity — the verified token email and the untrusted fallbackEmail kept apart — so
 * the resolver can enforce that only a verified email (or the bound `sub`) selects an existing
 * account. Do NOT pre-collapse them into one `email` before calling; that collapse was the bug.
 */
export async function mintClerkSessionFromNativeOAuth(
  ident: NativeIdentity,
  { appUrl }: { appUrl: string }
): Promise<BridgedSession> {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY not configured");
  if (!publishableKey) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not configured");

  const fapi = fapiHost(publishableKey);
  const { id: userId, created } = await resolveNativeOAuthUser(clerkUsersApi(secret), ident);

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
