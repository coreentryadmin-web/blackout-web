import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignPricing } from "@/components/landing/RedesignPricing";
import { SoftwareApplicationJsonLd, WebPageJsonLd, FAQPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { PRICING_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { publicPageMetadata } from "@/lib/page-metadata";
import { manifestProductCountWord } from "@/lib/marketing/product-manifest";

const PRICING_TITLE = "BlackOut Pricing — Plans From $49/mo, Cancel Anytime";
// Derived from the manifest's live product count, not hand-typed — a stale count survived
// here for a full product launch after the catalog expanded (P3 finding 2026-09-04) because
// this string had no link back to what actually ships.
const PRICING_DESCRIPTION = `Get BlackOut's SPX 0DTE desk from $49/mo, or all ${manifestProductCountWord()} products plus Discord from $199/mo. No contracts, cancel anytime. See plans and get access.`;

export const metadata: Metadata = publicPageMetadata(PRICING_TITLE, PRICING_DESCRIPTION, "/pricing");

export default function PricingPage() {
  return (
    <MarketingPageShell showChart={false}>
      <SoftwareApplicationJsonLd />
      <FAQPageJsonLd items={selectFaqItems(PRICING_FAQ_IDS).map((i) => ({ question: i.q, answer: i.a }))} />
      <WebPageJsonLd
        title={PRICING_TITLE}
        description={PRICING_DESCRIPTION}
        path="/pricing"
      />
      <div className="hide-in-ios-app">
        <RedesignPricing />
      </div>
      <div className="show-in-ios-app px-6 py-32 text-center">
        <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Pricing", href: "/pricing" },
      ]} />
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-sky-300">
          Your membership is managed on the web. Once active, sign in here to access the full desk.
        </p>
      </div>
    </MarketingPageShell>
  );
}
