/**
 * POST /api/auth/native-oauth/complete
 *
 * Called by the iOS Capacitor app after the native Sign in with Google /
 * Apple sheet returns an identity token. Verifies the token against the
 * provider's JWKS (issuer + audience + optional nonce), bridges into a
 * Clerk session, and sets the `__session` + `__client_uat` cookies.
 *
 * SECURITY MODEL
 *   - Endpoint is PUBLIC (unauthenticated) because it IS the sign-in path.
 *   - Trust flows from: provider signs token → we verify signature/aud/iss →
 *     we trust email/sub. The identity token can ONLY be produced by an app
 *     with the correct client-id + signing key at the provider — so pinning
 *     the audience env var to the iOS bundle-scoped client-id is the gate.
 *   - Cookies are set on `.blackouttrades.com` (Clerk's expected scope), which
 *     lets the WKWebView pick them up transparently on the next request.
 *   - Never accepts a raw `email` from the client — the email comes from the
 *     signed identity token payload, so a member can't sign in as someone
 *     else by tampering with the request body.
 *
 * ABUSE BOUNDS. Being the public sign-in path doesn't exempt it from the
 * per-IP rate limit + body/field-size bounds every other public route here
 * carries (email-capture, telemetry/client-error) — this was previously the
 * one public mutating route that skipped both. Without a size bound, an
 * arbitrarily large `idToken` still reaches `jwtVerify()`'s base64-decode +
 * JSON.parse of the header/payload before signature verification can reject
 * it; without a rate limit, that unbounded-ish work (plus every verified
 * attempt's Clerk Backend round-trips) has no per-caller ceiling.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleIdToken, verifyAppleIdToken } from "@/lib/native-oauth/verify-id-token";
import { mintClerkSessionFromNativeOAuth } from "@/lib/native-oauth/clerk-bridge";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { checkIpRateLimit, getClientIp, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { splitCookieHeader } from "./cookie-split";

export const runtime = "nodejs";
// Bridge writes cookies + hits Clerk Backend — never cache.
export const dynamic = "force-dynamic";

type Body = {
  provider?: "google" | "apple";
  idToken?: string;
  rawNonce?: string;
  // First-touch Apple relay email (Apple sends the email in the FIRST auth
  // and only the FIRST — subsequent tokens omit it). Client is expected to
  // pass it through on the first-touch call.
  fallbackEmail?: string;
  fallbackName?: string;
};

// Whole-body cap: generous for a real RS256/ES256 identity token (typically
// 1-2KB; a few extra KB of claims is still well inside this) while bounding
// the work done before signature verification can reject a hostile body.
const MAX_BODY_BYTES = 16_000;
// Per-field caps, checked after parsing so a request that's small overall but
// has one implausibly long field (e.g. a padded idToken) is still rejected
// before it reaches jwtVerify()/Clerk rather than relying on the whole-body
// cap alone.
const MAX_ID_TOKEN_LEN = 8_000;
const MAX_NONCE_LEN = 256;
const MAX_EMAIL_LEN = 254; // RFC 5321 max mailbox length.
const MAX_NAME_LEN = 200;

// Rate-limited distinctly from the other public telemetry/capture routes
// (which bound a cheap write): each call here does real signature
// verification (JWKS fetch/verify) and, on success, Clerk Backend round
// trips, so the ceiling is tighter — generous for a real device's retries,
// bounded against scripted abuse.
const RATE_LIMIT = 10;
const RATE_WINDOW_SECS = 60;

function bad(status: number, code: string, message: string, extraHeaders?: HeadersInit) {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: extraHeaders }
  );
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "public:native-oauth-complete", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);
  if (!rl.ok) {
    return bad(429, "rate_limited", "Too many sign-in attempts", rlHeaders);
  }

  // Hard cap BEFORE any parsing/verification work — same discipline as
  // telemetry/client-error: a public, unauthenticated route must never let
  // an oversized body do meaningful work, rate limit or not.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return bad(413, "body_too_large", "Request body too large", rlHeaders);
  }

  let body: Body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return bad(413, "body_too_large", "Request body too large", rlHeaders);
    }
    body = JSON.parse(raw) as Body;
  } catch {
    return bad(400, "invalid_body", "JSON body required", rlHeaders);
  }

  if (body.provider !== "google" && body.provider !== "apple") {
    return bad(400, "invalid_provider", "provider must be 'google' or 'apple'", rlHeaders);
  }
  if (typeof body.idToken !== "string" || !body.idToken || body.idToken.length > MAX_ID_TOKEN_LEN) {
    return bad(400, "missing_id_token", "idToken required", rlHeaders);
  }
  if (body.rawNonce != null && (typeof body.rawNonce !== "string" || body.rawNonce.length > MAX_NONCE_LEN)) {
    return bad(400, "invalid_nonce", "rawNonce too long", rlHeaders);
  }
  if (body.fallbackEmail != null && (typeof body.fallbackEmail !== "string" || body.fallbackEmail.length > MAX_EMAIL_LEN)) {
    return bad(400, "invalid_fallback_email", "fallbackEmail too long", rlHeaders);
  }
  if (body.fallbackName != null && (typeof body.fallbackName !== "string" || body.fallbackName.length > MAX_NAME_LEN)) {
    return bad(400, "invalid_fallback_name", "fallbackName too long", rlHeaders);
  }

  try {
    const verified =
      body.provider === "google"
        ? await verifyGoogleIdToken(body.idToken, { rawNonce: body.rawNonce })
        : await verifyAppleIdToken(body.idToken, { rawNonce: body.rawNonce });

    // Pass the VERIFIED token email and the UNTRUSTED client-relayed fallbackEmail through
    // SEPARATELY — never pre-collapse them into one `email`. The bridge binds account selection to
    // the verified provider identity (`provider:sub`) and only lets a VERIFIED email (or the bound
    // sub) select an existing account; an unverified fallbackEmail may seed a new account but never
    // sign into an existing one. Collapsing them here (`verified.email || fallbackEmail`) was the
    // account-takeover: a signed Apple token with no email claim let a caller pass a victim's email
    // as fallbackEmail and be minted the victim's session.
    const session = await mintClerkSessionFromNativeOAuth(
      {
        provider: verified.provider,
        sub: verified.sub,
        name: verified.name ?? body.fallbackName ?? null,
        tokenEmail: verified.email,
        tokenEmailVerified: verified.emailVerified,
        fallbackEmail: body.fallbackEmail ?? "",
      },
      { appUrl: appUrl() }
    );

    const res = NextResponse.json({
      ok: true,
      wasNewUser: session.wasNewUser,
      redirectTo: "/dashboard",
    }, { headers: NO_STORE_HEADERS });
    for (const cookie of splitCookieHeader(session.cookieHeader)) {
      res.headers.append("Set-Cookie", cookie);
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Verification failures are 401 (untrusted identity); config / bridge
    // failures are 500. Don't leak the specific reason to the client — a
    // rejected token could be a legitimate misconfig OR an attacker probing.
    const isVerify = /identity token|jwt|jwks|audience|issuer|nonce/i.test(message);
    return bad(
      isVerify ? 401 : 500,
      isVerify ? "verify_failed" : "bridge_failed",
      isVerify ? "identity token could not be verified" : "sign-in bridge failed"
    );
  }
}
