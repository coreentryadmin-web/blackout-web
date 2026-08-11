// GET /api/social/tiktok/callback — finish the TikTok authorisation grant (admin only).
//
// TikTok redirects the operator's browser here with `?code=&state=`. This is the ONLY place a
// TikTok token enters the system: the code is exchanged server-side and the resulting token set is
// written to `social_tokens`, from which `currentAccessToken()` serves every later publish.
//
// WHY THE RESPONSE IS DELIBERATELY BORING. It renders a plain confirmation and never echoes the
// code, the token, or the raw error body — a TikTok error payload can carry the client secret back
// in some shapes, and a browser page is the easiest place in the stack for a secret to end up in
// somebody's screenshot.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import {
  TIKTOK_STATE_COOKIE,
  exchangeCode,
  saveTokens,
  stateMatches,
  tiktokOauthConfigured,
} from "@/lib/social/tiktok-oauth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, detail: string, status: number): NextResponse {
  const body = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px/1.5 system-ui;margin:3rem auto;max-width:34rem;color:#111">
<h1 style="font-size:1.25rem">${title}</h1><p>${detail}</p></body>`;
  return new NextResponse(body, {
    status,
    headers: { ...NO_STORE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!tiktokOauthConfigured()) return page("Not configured", "TikTok client credentials are missing.", 503);

  const q = req.nextUrl.searchParams;

  // TikTok reports a declined consent by redirecting here with an error instead of a code.
  const oauthError = q.get("error");
  if (oauthError) return page("Authorisation declined", "TikTok did not grant access. Nothing was stored.", 400);

  const code = q.get("code");
  const state = q.get("state");
  const cookieState = req.cookies.get(TIKTOK_STATE_COOKIE)?.value;
  if (!stateMatches(cookieState, state)) {
    return page("State mismatch", "This link did not originate from a connect request. Start again.", 400);
  }
  if (!code) return page("Missing code", "TikTok returned no authorisation code.", 400);

  try {
    const tokens = await exchangeCode(code, Date.now());
    await saveTokens("tiktok", tokens);
    const res = page(
      "TikTok connected",
      `Account <code>${tokens.openId.slice(0, 8)}…</code> is linked. Scopes: ${tokens.scopes ?? "unknown"}.`,
      200
    );
    // Single-use: the state has done its job, and leaving it live is a replay window for nothing.
    res.cookies.set(TIKTOK_STATE_COOKIE, "", { path: "/api/social/tiktok", maxAge: 0 });
    return res;
  } catch {
    // The thrown message is already scrubbed of the response body, but it can still name the
    // status; the operator gets the actionable half and the detail stays in the server logs.
    return page("Exchange failed", "TikTok rejected the authorisation code. Try connecting again.", 502);
  }
}
