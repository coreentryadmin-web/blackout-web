export const dynamic = "force-dynamic";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignHome } from "@/components/landing/RedesignHome";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";

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
  const signedIn = Boolean(await activeClerkUserIdFromRequestCookies());

  return (
    <MarketingPageShell showChart={false}>
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <RedesignHome signedIn={signedIn} />
    </MarketingPageShell>
  );
}
