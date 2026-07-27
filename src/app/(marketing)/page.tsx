export const dynamic = "force-dynamic";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignHome } from "@/components/landing/RedesignHome";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";
import { isIosAppShellFromHeaders } from "@/lib/ios-app-shell-server";

const LANDING_REDIRECT_SCRIPT =
  "try{var h=location.hash.slice(1);if(h==='faq')location.replace('/faq');else if(h==='pricing')location.replace('/pricing')}catch(e){}";

/**
 * blackouttrades.com homepage. Redesigned 2026-07 ("lights on" trading-terminal): a live
 * GEX-wall hero canvas, the unified-terminal module grid (from MARKETING_PRODUCTS), and a
 * one-price membership block. Content is server-rendered; RedesignHome mounts a single client
 * FX layer for the canvas/reveal/ticker. Chrome (nav/footer) stays with MarketingPageShell;
 * the shell's ambient chart backdrop is off (showChart=false) since the hero has its own canvas.
 */
export default async function LandingPage() {
  const [signedIn, iosApp] = await Promise.all([
    activeClerkUserIdFromRequestCookies().then(Boolean),
    isIosAppShellFromHeaders(),
  ]);

  return (
    <MarketingPageShell showChart={false}>
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      {/* iosApp=true means the request came from the Capacitor WKWebView
          (BlackOutiOSApp UA). RedesignHome swaps the pricing table for the
          neutral membership note SERVER-SIDE, so App Store review never
          receives pricing markup in the HTML at all (3.1.1 durable form —
          .hide-in-ios-app remains as the CSS fallback). CF cache rule
          f261edb0 is expression-guarded to bypass this route on the same UA
          so the edge doesn't cross-serve the web variant to the app. */}
      <RedesignHome signedIn={signedIn} iosApp={iosApp} />
    </MarketingPageShell>
  );
}
