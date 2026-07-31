import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { publicPageMetadata } from "@/lib/page-metadata";

const article = getArticle("0dte-spx-options-strategy")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path);

export default function ZeroDteSpxStrategy() {
  return <LearnArticleView article={article} />;
}
