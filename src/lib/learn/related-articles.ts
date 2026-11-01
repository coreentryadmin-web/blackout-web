import { LEARN_ARTICLES, getArticle, type LearnArticle } from "@/lib/learn/articles";

const slugSet = new Set(LEARN_ARTICLES.map((a) => a.slug));

/**
 * Parse every /learn/<slug> markdown link target out of a body. A target stops at the first `)`,
 * `/`, or `#`, so `(/learn/foo#section-2)` and `(/learn/foo/)` both resolve to `foo` — same
 * convention articles.test.ts's own link-graph checker documents.
 *
 * Shared by BOTH directions below (does THIS article link OUT to X, and does some OTHER article
 * link IN to X) on purpose: they used to be two independently-written checks — this one regex
 * for outgoing, a raw `body.includes("(/learn/" + slug + ")")`-style substring probe for
 * incoming — and the substring probe never stripped `#anchor`/trailing-`/` the way this regex
 * does. A real link using either form (e.g. a future in-page anchor link, or a trailing slash)
 * would be correctly counted as an OUTGOING link from the article that wrote it, but silently
 * miss being counted as an INCOMING backlink for the target article's own `relatedArticles()`
 * call — an asymmetry between two things that describe the exact same edge in the link graph.
 * Parsing both ends with the same function makes that drift structurally impossible.
 */
function parseLearnLinkTargets(body: string): string[] {
  const re = /\[(?:[^\]]*)\]\(\/learn\/([^)/#]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (slugSet.has(m[1])) out.push(m[1]);
  }
  return out;
}

/** True iff `body` carries a /learn/ link to `slug` — the reverse (incoming-backlink) test. */
export function bodyLinksToSlug(body: string, slug: string): boolean {
  return parseLearnLinkTargets(body).includes(slug);
}

/** Topically related articles from body links + reverse link graph. */
export function relatedArticles(slug: string, limit = 4): LearnArticle[] {
  const article = getArticle(slug);
  if (!article) return [];

  const scores = new Map<string, number>();

  for (const target of parseLearnLinkTargets(article.body)) {
    if (target === slug) continue;
    scores.set(target, (scores.get(target) ?? 0) + 2);
  }

  for (const other of LEARN_ARTICLES) {
    if (other.slug === slug) continue;
    if (bodyLinksToSlug(other.body, slug)) {
      scores.set(other.slug, (scores.get(other.slug) ?? 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([s]) => getArticle(s))
    .filter((a): a is LearnArticle => Boolean(a));
}
