import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

const article = getArticle("0dte-spx-options-strategy")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path, { ogType: "article" });

export default function ZeroDteSpxStrategy() {
  return (
    <>
      <ArticleJsonLd
        title={article.metaTitle}
        description={article.metaDescription}
        path={article.path}
        datePublished="2026-07-31"
        dateModified="2026-08-02"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "0DTE SPX Strategy", href: article.path },
      ]} />
      <LearnArticleView article={article} />
    </>
  );
}
