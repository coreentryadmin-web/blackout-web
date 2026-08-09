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
 */
import { NextResponse } from "next/server";
import { verifyGoogleIdToken, verifyAppleIdToken } from "@/lib/native-oauth/verify-id-token";
import { mintClerkSessionFromNativeOAuth } from "@/lib/native-oauth/clerk-bridge";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

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

function bad(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com";
}

/** Split a "cookie1=..; cookie2=.." string into a Set-Cookie header array. */
function splitCookieHeader(joined: string): string[] {
  return joined
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((kv) => {
      const [name, value] = kv.split("=");
      // Match Clerk's own cookie attributes: domain-wide (works across the
      // WebView + web), HttpOnly (Clerk sets __session HttpOnly too),
      // Secure, SameSite=Lax so it survives the redirect chain.
      // Path=/ so every route including SSE endpoints sees it.
      return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`;
    });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad(400, "invalid_body", "JSON body required");
  }

  if (body.provider !== "google" && body.provider !== "apple") {
    return bad(400, "invalid_provider", "provider must be 'google' or 'apple'");
  }
  if (typeof body.idToken !== "string" || !body.idToken) {
    return bad(400, "missing_id_token", "idToken required");
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
