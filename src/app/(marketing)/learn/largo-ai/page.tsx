import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { largoAiGuide } from "@/lib/learn/guides";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Largo Guide — Your AI Market Structure Analyst",
  "Learn how Largo, BlackOut's AI desk analyst, delivers structure-focused market context so you understand what the positioning data is actually telling you.",
  "/learn/largo-ai",
  { kicker: "BlackOut Academy" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="Largo Guide — Your AI Market Structure Analyst"
        description="Learn how Largo, BlackOut's AI desk analyst, delivers structure-focused market context so you understand what the positioning data is actually telling you."
        path="/learn/largo-ai"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Largo", href: "/learn/largo-ai" },
      ]} />
      <LearnGuideView guide={largoAiGuide} />
    </>
  );
}
