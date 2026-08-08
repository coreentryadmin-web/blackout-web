import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignPricing } from "@/components/landing/RedesignPricing";
import { SoftwareApplicationJsonLd, WebPageJsonLd, FAQPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { PRICING_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut Pricing — Plans From $49/mo, Cancel Anytime",
  "Get BlackOut's SPX 0DTE desk from $49/mo, or all six trading modules plus Discord from $199/mo. No contracts, cancel anytime. See plans and get access.",
  "/pricing"
);

export default function PricingPage() {
  return (
    <MarketingPageShell showChart={false}>
      <SoftwareApplicationJsonLd />
      <FAQPageJsonLd items={selectFaqItems(PRICING_FAQ_IDS).map((i) => ({ question: i.q, answer: i.a }))} />
      <WebPageJsonLd
        title="BlackOut Pricing — Plans From $49/mo, Cancel Anytime"
        description="Get BlackOut's SPX 0DTE desk from $49/mo, or all six trading modules plus Discord from $199/mo. No contracts, cancel anytime. See plans and get access."
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
