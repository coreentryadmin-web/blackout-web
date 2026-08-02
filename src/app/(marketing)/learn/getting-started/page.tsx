import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { gettingStartedGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Getting Started With BlackOut — Trader's Quick Guide",
  "New to BlackOut? Start here. Learn how the platform scans, grades, and logs setups, and how to read your first dealer gamma and options flow signals.",
  "/learn/getting-started",
  { kicker: "BlackOut Academy" }
);

export default function GettingStartedPage() {
  return (
    <>
      <ArticleJsonLd
        title="Getting Started With BlackOut — Trader's Quick Guide"
        description="New to BlackOut? Start here. Learn how the platform scans, grades, and logs setups, and how to read your first dealer gamma and options flow signals."
        path="/learn/getting-started"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Getting Started", href: "/learn/getting-started" },
      ]} />
      <LearnGuideView guide={gettingStartedGuide} />
    </>
  );
}
