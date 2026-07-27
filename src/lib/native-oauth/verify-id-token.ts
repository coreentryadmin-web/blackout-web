/**
 * Verify a Google or Apple ID token (a signed JWT) using the provider's JWKS.
 *
 * Native OAuth flow (Sign in with Google / Sign in with Apple on iOS) returns
 * an `identityToken` (Apple) or `id_token` (Google) — both are RS256/ES256 JWTs
 * signed by the provider with a key published at a well-known JWKS URL. Anyone
 * can fetch the JWKS and verify the signature, which proves the token was
 * minted by the provider and hasn't been tampered with. That's what lets our
 * `/api/auth/native-oauth/complete` endpoint accept a token from the iOS app
 * and trust the identity inside it.
 *
 * Uses `jose` (already a dep for Clerk JWT handling) — its `createRemoteJWKSet`
 * transparently caches JWKS responses and rotates on `kid` change, so we don't
 * fetch on every request.
 *
 * SECURITY NOTES:
 *   - Verify issuer + audience explicitly — a valid token from a DIFFERENT
 *     Google/Apple app must NOT authenticate our members. `audience` is the
 *     iOS bundle/client-id we allow for THIS app.
 *   - Enforce `nonce` when supplied — protects against replay + token swap
 *     between the app and the backend. The client sends `rawNonce`; the token
 *     contains its SHA-256 hash (per Apple's rules); we compare.
 *   - Enforce `email_verified` — an unverified email cannot be trusted for
 *     account matching. Apple only issues tokens for verified Apple IDs so
 *     this is a Google-focused check.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";

type Verified = {
  provider: "google" | "apple";
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const APPLE_ISSUER = "https://appleid.apple.com";

/** Google iOS OAuth client IDs allowed to sign in members. Comma-separated env value. */
function googleAudiences(): Set<string> {
  const raw = process.env.NATIVE_OAUTH_GOOGLE_IOS_CLIENT_IDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Apple Services IDs (Client IDs) allowed to sign in members. Comma-separated. */
function appleAudiences(): Set<string> {
  const raw = process.env.NATIVE_OAUTH_APPLE_CLIENT_IDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** SHA-256 hex of the raw nonce, matching how Apple derives the JWT `nonce` claim. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function verifyGoogleIdToken(
  idToken: string,
  { rawNonce }: { rawNonce?: string } = {}
): Promise<Verified> {
  const allowed = googleAudiences();
  if (allowed.size === 0) throw new Error("NATIVE_OAUTH_GOOGLE_IOS_CLIENT_IDS not configured");

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    // `jose` accepts a Set or string[]; iterate for readable errors.
    issuer: Array.from(GOOGLE_ISSUERS),
    audience: Array.from(allowed),
  });
  if (payload.email_verified !== true) {
    throw new Error("google identity token has unverified email");
  }
  if (typeof payload.email !== "string" || !payload.email) {
    throw new Error("google identity token missing email");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("google identity token missing sub");
  }
  if (rawNonce != null) {
    // Google puts the nonce verbatim in the token (unlike Apple's sha256 hash).
    if (payload.nonce !== rawNonce) throw new Error("google identity token nonce mismatch");
  }
  return {
    provider: "google",
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

export async function verifyAppleIdToken(
  idToken: string,
  { rawNonce }: { rawNonce?: string } = {}
): Promise<Verified> {
  const allowed = appleAudiences();
  if (allowed.size === 0) throw new Error("NATIVE_OAUTH_APPLE_CLIENT_IDS not configured");

  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience: Array.from(allowed),
  });
  // Apple always issues tokens for verified Apple IDs — `email_verified` on
  // the payload is a string "true"/"false" in some builds, boolean in others.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (typeof payload.email === "string" && !emailVerified) {
    throw new Error("apple identity token has unverified email");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("apple identity token missing sub");
  }
  if (rawNonce != null) {
    // Apple hashes the nonce with SHA-256 hex before placing it in the JWT
    // (per developer.apple.com/documentation/sign_in_with_apple SIWA guide).
    if (payload.nonce !== sha256Hex(rawNonce)) {
      throw new Error("apple identity token nonce mismatch");
    }
  }
  // First-time Sign in with Apple sends the email in the token; subsequent
  // logins may omit it (Apple's "private relay" quirk — client should also
  // cache/store the email during first-touch handoff). We tolerate empty
  // email here and let the caller decide (either match by `sub` alone, or
  // reject if it's the first sign-in and email is required).
  return {
    provider: "apple",
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : "",
    emailVerified,
    name: null,
  };
}
