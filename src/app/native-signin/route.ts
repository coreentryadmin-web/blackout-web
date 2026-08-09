import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";

/** Absolute app URL from the configured public site origin — never from the request Host, which on
 *  ECS is often the container bind address (0.0.0.0) that ASWebAuthenticationSession/Safari reject. */
function publicSiteUrl(path: string): URL {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com";
  return new URL(path.startsWith("/") ? path : `/${path}`, base);
}

/**
 * Native iOS sign-in bridge.
 *
 * FLOW
 *   iOS app opens this URL in an ASWebAuthenticationSession (system-managed
 *   Safari sheet, cookies shared with Safari but scoped to the app). If
 *   there's no active Clerk session → 302 to /sign-in?redirect_url=/native-signin
 *   so Clerk shows its sign-in UI; on success it lands the user back here.
 *   Once signed in, we read the Clerk `__session` cookie and hand it to the
 *   app via a custom URL scheme: `blackout-trades://auth?token=<jwt>`. iOS
 *   sniffs the callback URL scheme and closes the sheet immediately.
 *
 *   The app then stores the token in Keychain and injects it back into
 *   URLSession's cookie store as `__session=<jwt>`, so subsequent API calls
 *   are authenticated with zero client-side changes — same Clerk session
 *   the web uses.
 *
 * WHY A ROUTE HANDLER (not a page.tsx)
 *   We need full control of `<head>` for a `<meta http-equiv="refresh">`.
 *   Root layout wraps `page.tsx` output, and Next.js `Metadata` doesn't
 *   support arbitrary http-equiv tags. A route handler returns raw HTML.
 *
 * WHY META-REFRESH (not a server 302 to the URL scheme)
 *   Browsers drop server-side redirects to non-http(s) schemes as a
 *   security measure. A meta-refresh + JS fallback + a visible link makes
 *   sure ASWebAuthenticationSession's URL-scheme sniffer fires reliably.
 *
 * SECURITY
 *   Custom URL schemes can technically be intercepted by any app that
 *   registers the same one. Acceptable for TestFlight / internal testing.
 *   Follow-up: upgrade to Universal Links (AASA on blackouttrades.com) so
 *   only our verified bundle can receive the callback.
 *
 *   The session cookie IS a Clerk JWT with the same authority as the web
 *   session. Never logged, never persisted server-side by this route.
 */

/** iOS URL scheme — must match `CFBundleURLTypes` in project.yml exactly. */
const NATIVE_URL_SCHEME = "blackout-trades";

/** Read the active Clerk session cookie value. Clerk may write plain
 * `__session` or suffixed `__session_<publishableKeySuffix>`; the plain
 * one wins if both are present. */
function readActiveSessionCookieValue(jar: Awaited<ReturnType<typeof cookies>>): string | null {
  const direct = jar.get("__session")?.value;
  if (direct) return direct;
  for (const c of jar.getAll()) {
    if (c.name.startsWith("__session_") && c.name !== "__session") {
      if (c.value) return c.value;
    }
  }
  return null;
}

function renderRedirectHtml(callback: string): string {
  const escaped = callback.replace(/"/g, "&quot;");
  const jsSafe = JSON.stringify(callback);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Signing in…</title>
<meta http-equiv="refresh" content="0; url=${escaped}">
<style>
  html,body{margin:0;padding:0;background:#0A0A0A;color:#F5F5F5;font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;box-sizing:border-box}
  .kicker{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#7A7A7A;margin-bottom:16px}
  .h{font-size:22px;font-weight:500;margin-bottom:10px}
  .p{color:#B3B3B3;font-size:14px;max-width:360px;line-height:1.5;margin-bottom:24px}
  .btn{background:#4ADE80;color:#0A0A0A;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;font-size:15px;display:inline-block}
</style>
</head>
<body>
  <div class="kicker">BlackOut · native sign-in</div>
  <div class="h">Handing session to the app…</div>
  <div class="p">You'll be redirected in a moment. If nothing happens, tap the button below.</div>
  <a class="btn" href="${escaped}">Open in BlackOut app</a>
  <script>setTimeout(function(){window.location=${jsSafe};},100);</script>
</body>
</html>`;
}

export async function GET(_req: NextRequest) {
  // Never build redirect URLs from `_req.url` — on ECS the Host is often the
  // container bind address (0.0.0.0), which ASWebAuthenticationSession / Safari
  // refuse ("restricted network port"). Same rule as OAuth redirects.
  const signInBridge = publicSiteUrl("/sign-in?redirect_url=/native-signin");

  const userId = await activeClerkUserIdFromRequestCookies();
  if (!userId) {
    return NextResponse.redirect(signInBridge, { status: 302 });
  }

  const jar = await cookies();
  const token = readActiveSessionCookieValue(jar);
  if (!token) {
    // "Signed in" per Clerk but no __session cookie in this request — race
    // or misconfiguration. Send them through sign-in again; fails safe.
    return NextResponse.redirect(signInBridge, { status: 302 });
  }

  const callback = `${NATIVE_URL_SCHEME}://auth?token=${encodeURIComponent(token)}`;
  return new NextResponse(renderRedirectHtml(callback), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never let a CDN cache the token-bearing page.
      "cache-control": "no-store, private, must-revalidate",
      "referrer-policy": "no-referrer",
    },
  });
}
