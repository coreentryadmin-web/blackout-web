import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignFaq } from "@/components/landing/RedesignFaq";
import JsonLd from "@/components/JsonLd";
import { publicPageMetadata } from "@/lib/page-metadata";
import { faqSchema } from "@/lib/schema";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut FAQ — Plans, Data, and How It Works",
  "Answers to common BlackOut questions: how the tools work, what data you get, whether it's investment advice, pricing, and how it compares to other platforms.",
  "/faq"
);

export default function FaqPage() {
  return (
    <MarketingPageShell>
      <JsonLd data={faqSchema} />
      <RedesignFaq />
    </MarketingPageShell>
  );
}
