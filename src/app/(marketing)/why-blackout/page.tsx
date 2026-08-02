import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WhyBlackoutContent } from "@/components/landing/WhyBlackoutContent";
import JsonLd from "@/components/JsonLd";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Why BlackOut? Dealer Gamma, Graded Setups & Public Logs",
  "Why traders choose BlackOut: live dealer gamma, A–F graded 0DTE setups, and every trade logged publicly. See what makes it different — and decide for yourself.",
  "/why-blackout"
);

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Why BlackOut?",
  description: "Why traders choose BlackOut: live dealer gamma, A–F graded 0DTE setups, and every trade logged publicly.",
  url: "https://blackouttrades.com/why-blackout",
  isPartOf: { "@type": "WebSite", name: "BlackOut Trades", url: "https://blackouttrades.com" },
};

export default function WhyBlackoutPage() {
  return (
    <MarketingPageShell>
      <JsonLd data={jsonLd} />
      <WhyBlackoutContent />
    </MarketingPageShell>
  );
}
