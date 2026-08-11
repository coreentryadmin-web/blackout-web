// GET /api/social/tiktok/connect — start the TikTok authorisation grant (admin only).
//
// Visited once by an operator in a browser. Everything durable happens in the callback; this route
// only mints the CSRF state, parks it in an httpOnly cookie, and redirects to TikTok's consent
// screen. Admin-gated because the token it eventually produces publishes AS the brand account.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import {
  TIKTOK_STATE_COOKIE,
  TIKTOK_STATE_TTL_S,
  newOauthState,
  tiktokAuthorizeUrl,
  tiktokOauthConfigured,
} from "@/lib/social/tiktok-oauth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!tiktokOauthConfigured()) {
    return NextResponse.json(
      { error: "TikTok client credentials are not configured" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  const state = newOauthState();
  const url = tiktokAuthorizeUrl(state);
  if (!url) {
    return NextResponse.json({ error: "Could not build authorize URL" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const res = NextResponse.redirect(url, { status: 302, headers: NO_STORE_HEADERS });
  res.cookies.set(TIKTOK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    // LAX, NOT STRICT. TikTok redirects the browser back to us cross-site; under `strict` the
    // cookie would not be sent on that navigation and every callback would fail state validation.
    sameSite: "lax",
    path: "/api/social/tiktok",
    maxAge: TIKTOK_STATE_TTL_S,
  });
  return res;
}
