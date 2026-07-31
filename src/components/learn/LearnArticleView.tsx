"use client";

import type { LearnArticle } from "@/lib/learn/articles";
import { LearnDoc } from "@/components/learn/LearnDoc";
import { LearnHeroGlow } from "@/components/learn/LearnMotion";
import { MarkdownBody } from "@/components/learn/MarkdownBody";

const KICKER: Record<string, string> = {
  pillar: "Pillar Guide",
  article: "Guide",
  glossary: "Reference",
};

export function LearnArticleView({ article }: { article: LearnArticle }) {
  const headings = [...article.body.matchAll(/^## (.+)$/gm)].map((m) => ({
    id: m[1]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    label: m[1],
  }));

  return (
    <div className="relative">
      <LearnHeroGlow />
      <LearnDoc
        title={article.title}
        description={article.description}
        kicker={KICKER[article.type] ?? "Guide"}
        sections={headings}
      >
        <MarkdownBody content={article.body} />
      </LearnDoc>
    </div>
  );
}
