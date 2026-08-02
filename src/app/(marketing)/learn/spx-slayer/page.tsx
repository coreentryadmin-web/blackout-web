import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { spxSlayerGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "SPX Slayer Guide — Trading 0DTE SPX Options",
  "Learn how SPX Slayer's 0DTE desk works: gamma matrices, tick-by-tick data, and A–F graded SPX alerts, and how to act on the setups that survive screening.",
  "/learn/spx-slayer",
  { kicker: "BlackOut Academy", ogType: "article" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="SPX Slayer Guide — Trading 0DTE SPX Options"
        description="Learn how SPX Slayer's 0DTE desk works: gamma matrices, tick-by-tick data, and A–F graded SPX alerts, and how to act on the setups that survive screening."
        path="/learn/spx-slayer"
        datePublished="2026-01-15"
        dateModified="2026-08-01"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "SPX Slayer", href: "/learn/spx-slayer" },
      ]} />
      <LearnGuideView guide={spxSlayerGuide} />
    </>
  );
}
