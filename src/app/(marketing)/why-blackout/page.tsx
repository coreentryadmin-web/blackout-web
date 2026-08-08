import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WhyBlackoutContent } from "@/components/landing/WhyBlackoutContent";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Why BlackOut? Dealer Gamma, Graded Setups & Public Logs",
  "Why traders choose BlackOut: live dealer gamma, A–F graded 0DTE setups, and every trade logged publicly. See what makes it different — and decide for yourself.",
  "/why-blackout"
);

export default function WhyBlackoutPage() {
  return (
    <MarketingPageShell>
      <WebPageJsonLd
        title="Why BlackOut?"
        description="Why traders choose BlackOut: live dealer gamma, A–F graded 0DTE setups, and every trade logged publicly."
        path="/why-blackout"
      />
      <WhyBlackoutContent breadcrumbs={<Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Why BlackOut?", href: "/why-blackout" },
      ]} />} />
    </MarketingPageShell>
  );
}
