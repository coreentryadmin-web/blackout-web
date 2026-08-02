import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { ArticleJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";

const article = getArticle("helix-dark-pool-analysis")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path, { ogType: "article" });

export default function HelixDarkPoolAnalysis() {
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
        { name: "HELIX Dark Pool Analysis", href: article.path },
      ]} />
      <LearnArticleView article={article} />
    </>
  );
}
