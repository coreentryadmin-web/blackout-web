import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { LearnGlossaryPage } from "@/components/learn/LearnGlossaryPage";
import { ArticleJsonLd, FAQPageJsonLd, DefinedTermSetJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata, buildOgImageUrl } from "@/lib/page-metadata";
import { LEARN_ARTICLES, getArticle } from "@/lib/learn/articles";
import { getLearnGuide } from "@/lib/learn/guides";
import { glossaryTermsFlat } from "@/lib/learn/guides/glossary";
import { GUIDE_SEO, isLearnGuideSlug } from "@/lib/learn/guide-seo";
import { guideFaqs } from "@/lib/learn/types";
import { LEARN_NAV } from "@/lib/learn/nav";
import { getArticleFaqs } from "@/lib/learn/article-faqs";
import { getArticleDates } from "@/lib/seo/sitemap-dates";

type Props = { params: Promise<{ slug: string }> };

/**
 * Every learn slug is known at build time, so an unknown one must 404 at the routing layer.
 *
 * The `(marketing)` layout sets `revalidate = 3600`, which puts this route on ISR. With the default
 * `dynamicParams: true`, a slug outside generateStaticParams took the on-demand render path and
 * came back **HTTP 200 with an empty page** instead of a 404 — a soft-404 on an indexable path
 * pattern, which invites Google to treat the URL as a thin page rather than drop it. Measured on
 * production: `/learn/totally-fake-slug-xyz` -> 200 (`cf-cache-status: MISS`, so origin, not edge),
 * while a non-learn unknown path -> 404 correctly.
 *
 * `dynamicParams = false` makes any param not in generateStaticParams a hard 404 before the
 * component runs. Nothing is lost: LEARN_NAV + LEARN_ARTICLES cover all 52 reachable slugs
 * (verified, GUIDE_SEO is a subset), and learn content lives in source, so a new article already
 * requires a deploy to exist.
 */
export const dynamicParams = false;

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
          image={buildOgImageUrl(seo.metaTitle, seo.metaDescription, {
            kicker: "BlackOut Academy",
          })}
          datePublished={seo.datePublished}
          dateModified={seo.dateModified}
        />
        {faqs.length > 0 && <FAQPageJsonLd items={faqs} />}
        {slug === "glossary" && (
          <DefinedTermSetJsonLd
            path="/learn/glossary"
            name="BlackOut Options & Dealer-Positioning Glossary"
            terms={glossaryTermsFlat()}
          />
        )}
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
  const articleDates = getArticleDates(article.slug);

  return (
    <>
      <ArticleJsonLd
        title={article.metaTitle}
        description={article.metaDescription}
        path={article.path}
        image={buildOgImageUrl(article.metaTitle, article.metaDescription, {
          articleType: article.type,
        })}
        datePublished={articleDates.datePublished}
        dateModified={articleDates.dateModified}
      />
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
