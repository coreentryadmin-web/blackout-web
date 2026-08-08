import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignFaq } from "@/components/landing/RedesignFaq";
import { FAQPageJsonLd, WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
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
      <WebPageJsonLd
        title="BlackOut FAQ — Plans, Data, and How It Works"
        description="Answers to common BlackOut questions: how the tools work, what data you get, whether it's investment advice, pricing, and how it compares to other platforms."
        path="/faq"
      />
      <RedesignFaq breadcrumbs={<Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "FAQ", href: "/faq" },
      ]} />} />
    </MarketingPageShell>
  );
}
