import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { helixFlowsGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "HELIX Guide — Reading Institutional Options Flow",
  "Learn to read institutional options order flow with HELIX: premium filters, anomaly detection, and how to spot the unusual activity that moves markets.",
  "/learn/helix-flows",
  { kicker: "BlackOut Academy" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="HELIX Guide — Reading Institutional Options Flow"
        description="Learn to read institutional options order flow with HELIX: premium filters, anomaly detection, and how to spot the unusual activity that moves markets."
        path="/learn/helix-flows"
        datePublished="2026-01-15"
        dateModified="2026-08-01"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "HELIX", href: "/learn/helix-flows" },
      ]} />
      <LearnGuideView guide={helixFlowsGuide} />
    </>
  );
}
