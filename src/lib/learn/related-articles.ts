import { LEARN_ARTICLES, getArticle, type LearnArticle } from "@/lib/learn/articles";

const slugSet = new Set(LEARN_ARTICLES.map((a) => a.slug));

function parseOutgoingSlugs(body: string): string[] {
  const re = /\[(?:[^\]]*)\]\(\/learn\/([^)/#]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (slugSet.has(m[1])) out.push(m[1]);
  }
  return out;
}

/** Topically related articles from body links + reverse link graph. */
export function relatedArticles(slug: string, limit = 4): LearnArticle[] {
  const article = getArticle(slug);
  if (!article) return [];

  const scores = new Map<string, number>();

  for (const target of parseOutgoingSlugs(article.body)) {
    if (target === slug) continue;
    scores.set(target, (scores.get(target) ?? 0) + 2);
  }

  for (const other of LEARN_ARTICLES) {
    if (other.slug === slug) continue;
    if (other.body.includes(`(/learn/${slug})`) || other.body.includes(`(/learn/${slug}/`)) {
      scores.set(other.slug, (scores.get(other.slug) ?? 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([s]) => getArticle(s))
    .filter((a): a is LearnArticle => Boolean(a));
}
