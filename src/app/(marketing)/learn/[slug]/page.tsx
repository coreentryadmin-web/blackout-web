import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { LearnGlossaryPage } from "@/components/learn/LearnGlossaryPage";
import { ArticleJsonLd, FAQPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { LEARN_ARTICLES, getArticle } from "@/lib/learn/articles";
import { getLearnGuide } from "@/lib/learn/guides";
import { GUIDE_SEO, isLearnGuideSlug } from "@/lib/learn/guide-seo";
import { guideFaqs } from "@/lib/learn/types";
import { LEARN_NAV } from "@/lib/learn/nav";
import { getArticleFaqs } from "@/lib/learn/article-faqs";
import { ARTICLE_DATE_MODIFIED, ARTICLE_DATE_PUBLISHED } from "@/lib/seo/sitemap-dates";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const guideSlugs = LEARN_NAV.map((item) => ({ slug: item.slug }));
  const articleSlugs = LEARN_ARTICLES.map((a) => ({ slug: a.slug }));
  return [...guideSlugs, ...articleSlugs];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  if (isLearnGuideSlug(slug)) {
    const seo = GUIDE_SEO[slug];
    return publicPageMetadata(seo.metaTitle, seo.metaDescription, `/learn/${slug}`, {
      kicker: "BlackOut Academy",
      ogType: "article",
    });
  }

  const article = getArticle(slug);
  if (!article) return {};

  return publicPageMetadata(article.metaTitle, article.metaDescription, article.path, {
    ogType: "article",
    articleType: article.type,
  });
}

export default async function LearnSlugPage({ params }: Props) {
  const { slug } = await params;

  if (isLearnGuideSlug(slug)) {
    const seo = GUIDE_SEO[slug];
    const guide = getLearnGuide(slug);
    const faqs = guideFaqs(guide.sections);

    return (
      <>
        <ArticleJsonLd
          title={seo.metaTitle}
          description={seo.metaDescription}
          path={`/learn/${slug}`}
          datePublished={seo.datePublished}
          dateModified={seo.dateModified}
        />
        {faqs.length > 0 && <FAQPageJsonLd items={faqs} />}
        <Breadcrumbs
          items={[
            { name: "Home", href: "/" },
            { name: "Learn", href: "/learn" },
            { name: seo.breadcrumb, href: `/learn/${slug}` },
          ]}
        />
        {slug === "glossary" ? <LearnGlossaryPage /> : <LearnGuideView guide={guide} />}
      </>
    );
  }

  const article = getArticle(slug);
  if (!article) notFound();

  return (
    <>
      <ArticleJsonLd
        title={article.metaTitle}
        description={article.metaDescription}
        path={article.path}
        datePublished={ARTICLE_DATE_PUBLISHED}
        dateModified={ARTICLE_DATE_MODIFIED}
      />
      <FAQPageJsonLd items={getArticleFaqs(article.slug)} />
      <Breadcrumbs
        items={[
          { name: "Home", href: "/" },
          { name: "Learn", href: "/learn" },
          { name: article.title, href: article.path },
        ]}
      />
      <LearnArticleView article={article} />
    </>
  );
}
