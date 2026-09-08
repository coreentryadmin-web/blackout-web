import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignHome } from "@/components/landing/RedesignHome";
import { FAQPageJsonLd, WebPageJsonLd } from "@/components/seo/JsonLd";
import { HOME_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { publicPageMetadata } from "@/lib/page-metadata";
import { readPublicGexSnapshotSeed } from "@/lib/public-gex-snapshot";

export const revalidate = 3600;

export const metadata: Metadata = publicPageMetadata(
  "BlackOut — Live Dealer Gamma & 0DTE SPX Options Flow",
  "BlackOut gives options traders live dealer gamma, 0DTE flow, and Trade Grade A–F SPX setups. See what the desks see — with quote age and session context on every read.",
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
 *
 * This page is ISR (`revalidate` below) — its gamma seed MUST use `readPublicGexSnapshotSeed`
 * (a cache-only read), never `buildPublicGexSnapshot` (which live-computes on a cache miss via a
 * `cache: "no-store"` fetch several layers down). Calling the live-compute path from a
 * statically-rendered page trips Next's "Dynamic server usage" bailout, which gets swallowed by
 * that fetch's error handling and converted into a broken "no options-chain data" result — which
 * then WRITES to the shared snapshot cache, poisoning it for every other reader (client polling
 * included) until the next successful compute. See `readPublicGexSnapshotSeed`'s own comment for
 * the full incident trace (2026-09-03). The client (`HomeGammaPromo`/`HomeLiveDeskStrip`) always
 * self-heals with its own live fetch on mount, so this seed only needs to be "best cached value."
 */
export default async function LandingPage() {
  const initialGamma = await readPublicGexSnapshotSeed("SPX");

  return (
    <MarketingPageShell showChart={false}>
      <FAQPageJsonLd items={selectFaqItems(HOME_FAQ_IDS).map((i) => ({ question: i.q, answer: i.a }))} />
      <WebPageJsonLd
        title="BlackOut — Live Dealer Gamma & 0DTE SPX Options Flow"
        description="BlackOut gives options traders live dealer gamma, 0DTE flow, and Trade Grade A–F SPX setups. See what the desks see — with quote age and session context on every read."
        path="/"
      />
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <RedesignHome initialGamma={initialGamma} />
    </MarketingPageShell>
  );
}
