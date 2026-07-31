import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { publicPageMetadata } from "@/lib/page-metadata";
import { articleSchema } from "@/lib/schema";

const article = getArticle("is-0dte-gambling")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path);

export default function Is0dteGambling() {
  return (
    <>
      <JsonLd data={articleSchema(article)} />
      <LearnArticleView article={article} />
    </>
  );
}
