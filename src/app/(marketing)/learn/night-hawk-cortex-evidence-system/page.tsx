import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { ArticleJsonLd, FAQPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { getArticleFaqs } from "@/lib/learn/article-faqs";

const article = getArticle("night-hawk-cortex-evidence-system")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path, { ogType: "article" });

export default function NightHawkCortex() {
  return (
    <>
      <ArticleJsonLd
        title={article.metaTitle}
        description={article.metaDescription}
        path={article.path}
        datePublished="2026-08-02"
        dateModified="2026-08-02"
      />
      <FAQPageJsonLd items={getArticleFaqs(article.slug)} />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Learn", href: "/learn" },
        { name: "Night Hawk Cortex", href: article.path },
      ]} />
      <LearnArticleView article={article} />
    </>
  );
}
