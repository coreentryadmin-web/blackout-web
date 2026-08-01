import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignFaq } from "@/components/landing/RedesignFaq";
import { FAQPageJsonLd } from "@/components/seo/JsonLd";
import { FAQ_ITEMS } from "@/lib/faq/content";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut FAQ — Plans, Data, and How It Works",
  "Answers to common BlackOut questions: how the tools work, what data you get, whether it's investment advice, pricing, and how it compares to other platforms.",
  "/faq"
);

export default function FaqPage() {
  return (
    <MarketingPageShell>
      <FAQPageJsonLd items={FAQ_ITEMS.map((i) => ({ question: i.q, answer: i.a }))} />
      <RedesignFaq />
    </MarketingPageShell>
  );
}
