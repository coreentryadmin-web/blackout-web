"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LearnArticle } from "@/lib/learn/articles";
import { articleNav, readingTime } from "@/lib/learn/articles";
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

  const { prev, next } = articleNav(article.slug);
  const minutes = readingTime(article.body);

  return (
    <div className="relative">
      <LearnHeroGlow />
      <LearnDoc
        title={article.title}
        description={article.description}
        kicker={KICKER[article.type] ?? "Guide"}
        sections={headings}
        badge={
          <span className="font-mono text-[11px] text-mute">{minutes} min read</span>
        }
      >
        <MarkdownBody content={article.body} />

        <nav
          aria-label="Article navigation"
          className="mt-16 grid gap-4 border-t border-white/10 pt-10 sm:grid-cols-2"
        >
          {prev ? (
            <Link href={prev.path} className="learn-chapter-nav-link learn-chapter-nav-link--prev group">
              <span className="learn-chapter-nav-label">
                <ChevronLeft className="size-4" aria-hidden />
                Previous
              </span>
              <span className="learn-chapter-nav-title">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={next.path} className="learn-chapter-nav-link learn-chapter-nav-link--next group text-right sm:text-right">
              <span className="learn-chapter-nav-label justify-end">
                Next
                <ChevronRight className="size-4" aria-hidden />
              </span>
              <span className="learn-chapter-nav-title">{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </LearnDoc>
    </div>
  );
}
