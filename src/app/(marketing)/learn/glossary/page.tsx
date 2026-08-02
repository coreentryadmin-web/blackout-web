import type { Metadata } from "next";
import { LearnGlossaryPage } from "@/components/learn/LearnGlossaryPage";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Options Trading Glossary — Gamma, 0DTE, Flow Terms",
  "A plain-English glossary of options trading terms: dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow, and more, explained simply.",
  "/learn/glossary",
  { kicker: "BlackOut Academy" }
);

export default function Page() {
  return (
    <>
      <ArticleJsonLd
        title="Options Trading Glossary — Gamma, 0DTE, Flow Terms"
        description="A plain-English glossary of options trading terms: dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow, and more, explained simply."
        path="/learn/glossary"
        datePublished="2026-01-15"
        dateModified="2026-08-01"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Glossary", href: "/learn/glossary" },
      ]} />
      <LearnGlossaryPage />
    </>
  );
}
