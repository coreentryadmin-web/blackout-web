import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { publicPageMetadata } from "@/lib/page-metadata";
import { articleSchema } from "@/lib/schema";

const article = getArticle("0dte-spx-options-strategy")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path);

export default function ZeroDteSpxStrategy() {
  return (
    <>
      <JsonLd data={articleSchema(article)} />
      <LearnArticleView article={article} />
    </>
  );
}
