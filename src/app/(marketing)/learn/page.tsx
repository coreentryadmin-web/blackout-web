import type { Metadata } from "next";
import { LearnHub } from "@/components/learn/LearnHub";
import { WebSiteJsonLd, CollectionPageJsonLd, ItemListJsonLd, CourseJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { LEARN_ARTICLES } from "@/lib/learn/articles";
import { LEARN_NAV, learnHref } from "@/lib/learn/nav";
import { GUIDE_SEO } from "@/lib/learn/guide-seo";
import { SITE } from "@/lib/site";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut Academy — Learn Options Flow & Dealer Gamma",
  "Free guides to dealer gamma, 0DTE options strategy, order flow, and reading market positioning like the desks do. Learn the concepts behind BlackOut.",
  "/learn"
);

export default function LearnPage() {
  const featured = LEARN_ARTICLES.filter((a) => a.type === "pillar" || a.type === "article")
    .slice(0, 12)
    .map((a) => ({ name: a.title, url: `${SITE.url}${a.path}` }));

  return (
    <>
      <WebSiteJsonLd />
      <CollectionPageJsonLd
        title="BlackOut Academy — Learn Options Flow & Dealer Gamma"
        description="Free guides to dealer gamma, 0DTE options strategy, order flow, and reading market positioning like the desks do."
        path="/learn"
      />
      <ItemListJsonLd name="BlackOut Academy guides" items={featured} />
      <CourseJsonLd
        chapters={LEARN_NAV.map((item) => ({
          name: GUIDE_SEO[item.slug].metaTitle,
          description: GUIDE_SEO[item.slug].metaDescription,
          url: `${SITE.url}${learnHref(item.slug)}`,
        }))}
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
      ]} />
      <LearnHub />
    </>
  );
}
