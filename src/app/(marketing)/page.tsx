import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignHome } from "@/components/landing/RedesignHome";
import { FAQPageJsonLd, WebPageJsonLd } from "@/components/seo/JsonLd";
import { HOME_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { publicPageMetadata } from "@/lib/page-metadata";
import { buildPublicGexSnapshot } from "@/lib/public-gex-snapshot";

export const revalidate = 3600;

export const metadata: Metadata = publicPageMetadata(
  "BlackOut — Live Dealer Gamma & 0DTE SPX Options Flow",
  "BlackOut gives options traders live dealer gamma, 0DTE flow, and A–F graded SPX setups. See what the desks see and trade before the crowd moves.",
  "/"
);

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
  const initialGamma = await buildPublicGexSnapshot("SPX");

  return (
    <MarketingPageShell showChart={false}>
      <FAQPageJsonLd items={selectFaqItems(HOME_FAQ_IDS).map((i) => ({ question: i.q, answer: i.a }))} />
      <WebPageJsonLd
        title="BlackOut — Live Dealer Gamma & 0DTE SPX Options Flow"
        description="BlackOut gives options traders live dealer gamma, 0DTE flow, and A–F graded SPX setups. See what the desks see and trade before the crowd moves."
        path="/"
      />
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <RedesignHome initialGamma={initialGamma} />
    </MarketingPageShell>
  );
}
