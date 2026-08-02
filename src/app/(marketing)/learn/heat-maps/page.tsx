import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { heatMapsGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Dealer Gamma Heatmap Guide — Flip, Call & Put Walls",
  "Learn to read a dealer gamma heatmap: find the gamma flip, call wall, and put wall, and understand how dealer positioning drives intraday SPX moves.",
  "/learn/heat-maps",
  { kicker: "BlackOut Academy" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="Dealer Gamma Heatmap Guide — Flip, Call & Put Walls"
        description="Learn to read a dealer gamma heatmap: find the gamma flip, call wall, and put wall, and understand how dealer positioning drives intraday SPX moves."
        path="/learn/heat-maps"
        datePublished="2026-01-15"
        dateModified="2026-08-01"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Thermal", href: "/learn/heat-maps" },
      ]} />
      <LearnGuideView guide={heatMapsGuide} />
    </>
  );
}
