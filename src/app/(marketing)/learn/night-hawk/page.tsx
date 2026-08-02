import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { nightHawkGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Night Hawk Guide — Swing Trading Setups Explained",
  "Learn how Night Hawk grades swing trading setups and runs its evening scanner to surface the next day's best opportunities after the market closes.",
  "/learn/night-hawk",
  { kicker: "BlackOut Academy", ogType: "article" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="Night Hawk Guide — Swing Trading Setups Explained"
        description="Learn how Night Hawk grades swing trading setups and runs its evening scanner to surface the next day's best opportunities after the market closes."
        path="/learn/night-hawk"
        datePublished="2026-04-01"
        dateModified="2026-08-01"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Night Hawk", href: "/learn/night-hawk" },
      ]} />
      <LearnGuideView guide={nightHawkGuide} />
    </>
  );
}
