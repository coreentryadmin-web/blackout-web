import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

const article = getArticle("open-interest-options-explained")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path, { ogType: "article" });

export default function OpenInterestExplained() {
  return (
    <>
      <ArticleJsonLd
        title={article.metaTitle}
        description={article.metaDescription}
        path={article.path}
        datePublished="2026-08-02"
        dateModified="2026-08-02"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Open Interest", href: article.path },
      ]} />
      <LearnArticleView article={article} />
    </>
  );
}
