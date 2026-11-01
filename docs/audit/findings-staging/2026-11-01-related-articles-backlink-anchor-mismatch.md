> **kind:** FINDING

## `relatedArticles()`'s incoming-backlink check used a different link parser than its outgoing one — FIXED

**Area:** Learn docs — `src/lib/learn/related-articles.ts` (the "related articles" widget on every
`/learn/<slug>` article page).

### Root cause

`relatedArticles(slug)` scores two kinds of evidence for "this article is related to `slug`":

1. **Outgoing** — every `/learn/<target>` markdown link `slug`'s own body contains, parsed with a
   regex that stops a link target at the first `)`, `/`, or `#`:
   `/\[(?:[^\]]*)\]\(\/learn\/([^)/#]+)/g`. So `[x](/learn/foo#section-2)` and `[x](/learn/foo/)`
   both correctly resolve to `foo`.
2. **Incoming** — for every *other* article, whether its body links back to `slug`. This half was
   written independently as a plain substring probe:
   `other.body.includes(\`(/learn/${slug})\`) || other.body.includes(\`(/learn/${slug}/\`)`.

   That probe only recognizes a link that closes immediately after the slug with `)` or continues
   with `/`. It never strips an anchor fragment, so a link written as
   `[x](/learn/foo#section-2)` — which the OUTGOING parser above correctly resolves to `foo` for
   the article that wrote it — is invisible to `foo`'s own incoming-backlink pass. The same real
   markdown edge ("article A links to article B") is recognized walking one direction and missed
   walking the other, because the two directions were never implemented against the same parser.

### Evidence

Added direct unit tests for the extracted `bodyLinksToSlug()` helper (see Fix rationale) using a
synthetic body string with an anchor-fragment link and one with a trailing slash. Confirmed
RED→GREEN by `git stash`-ing just the source fix while keeping the new tests:

```
# pre-fix (old substring-based reverse check):
not ok 4 - does not false-positive on a different link whose target merely starts with the slug
not ok 5 - returns false when there is no link to the slug at all
error: '(0 , import_related_articles.bodyLinksToSlug) is not a function'
# tests 7, pass 2, fail 5

# post-fix:
# tests 7, pass 7, fail 0
```

(The other 3 tests also failed to even load pre-fix for the same reason — `bodyLinksToSlug` did
not exist yet as a standalone export, since the old reverse-check logic was inlined.)

Checked the real corpus (`src/lib/learn/articles.ts`, 42 articles): no existing `/learn/` link
currently uses an anchor fragment or a trailing slash, so this bug is **currently latent** against
production content — it does not change `relatedArticles()`'s output for any article today. It
would silently under-count relatedness the moment any future article adds either link form
(anchors are a natural thing to add once the Learn pages grow in-page table-of-contents links), and
it is a genuine logic bug independent of whether today's content happens to trigger it.

### Blast radius

Single call site: `relatedArticles()` is the only consumer of the (now-shared) link-target parser;
nothing else duplicated the old substring-based reverse check. `LearnRelatedArticles.tsx` and
`LearnArticleView.tsx` call `relatedArticles()` but contain no link-parsing logic of their own, so
they're unaffected beyond getting the corrected (currently identical) output.

### Fix rationale

Extracted the existing outgoing-link regex into `parseLearnLinkTargets()` (renamed from
`parseOutgoingSlugs` to reflect that it's no longer outgoing-only) and added a thin
`bodyLinksToSlug(body, slug)` export built on top of it. Both the outgoing-scoring loop and the
reverse-scoring loop now call the same parser, so the two directions of a link can never disagree
about whether it exists — the same "parse once, use everywhere" anti-drift discipline this codebase
already applies elsewhere (e.g. `article-glossary-terms.ts`'s header comment makes the identical
argument for its own glossary-term extraction). Deliberately did NOT special-case anchors/slashes
only in the reverse check (a narrower patch) — reusing the shared parser is both simpler and
structurally guarantees the two directions stay in sync as the regex evolves, rather than relying on
two hand-maintained copies staying byte-identical forever.

| **Status** | FIXED |
|---|---|
| Branch | `fix/learn-audit` |
| Files | `src/lib/learn/related-articles.ts`, `src/lib/learn/related-articles.test.ts` |
