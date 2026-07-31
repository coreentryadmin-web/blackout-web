import type { Metadata } from "next";
import { LearnArticleView } from "@/components/learn/LearnArticleView";
import { getArticle } from "@/lib/learn/articles";
import { publicPageMetadata } from "@/lib/page-metadata";

const article = getArticle("gamma-flip-explained")!;

export const metadata: Metadata = publicPageMetadata(article.metaTitle, article.metaDescription, article.path);

export default function GammaFlipExplained() {
  return <LearnArticleView article={article} />;
}
