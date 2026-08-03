"use client";

import Link from "next/link";
import type { LearnArticle } from "@/lib/learn/articles";

export function LearnRelatedArticles({ articles }: { articles: LearnArticle[] }) {
  if (articles.length === 0) return null;

  return (
    <section aria-labelledby="related-articles-heading" className="mt-12 border-t border-white/10 pt-10">
      <h2 id="related-articles-heading" className="font-syne text-lg font-bold text-white">
        Related guides
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link
              href={a.path}
              className="block rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-cyan-400/30 hover:bg-cyan-400/5"
            >
              <p className="font-syne text-sm font-semibold text-white">{a.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-sky-300">{a.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
