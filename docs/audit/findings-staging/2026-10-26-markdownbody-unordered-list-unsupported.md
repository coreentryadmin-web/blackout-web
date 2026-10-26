## MarkdownBody had no support for `- ` unordered lists — the entire Learn article library and /about rendered literal markdown dashes instead of a real list

> **kind:** `FINDING`

### Root cause

`src/components/learn/MarkdownBody.tsx` is a small, hand-rolled markdown renderer (no remark/MDX
dependency) backing every marketing/learn content page that uses it: `/about`
(`src/app/(marketing)/about/page.tsx`), `WhyBlackoutContent.tsx`, `MethodologyContent.tsx`, and
every `/learn/*` article via `LearnArticleView.tsx` reading from `src/lib/learn/articles.ts`.

Its block-level dispatcher handled `## `/`### ` headings, `> ` blockquotes, image blocks, GFM pipe
tables, and `\d+\. ` **ordered** lists — but had no branch at all for `-`/`*` **unordered** lists.
A block whose lines all start with `- ` (the single most common list style in this content —
`- **Term** — definition`) fell through to the final `else` and rendered as one plain `<p>`, with
the literal leading `- ` characters shown as part of the paragraph text instead of becoming a
`<ul><li>` list.

Confirmed live via a `proxy-browser.cjs` screenshot sweep (this session's standing live-UI
method) at both desktop (1440×900) and mobile (430×932) on `/about`: the "The Tools" section
rendered as one run-on paragraph — `- SPX Slayer — The 0DTE command center. ... - Thermal — GEX,
VEX, DEX... - HELIX — ...` — with every one of the 7 products' list markers showing as literal
text instead of a bulleted list.

### Evidence

Grep for the literal pattern across every file `MarkdownBody` renders content from:

```
grep -rcE "^\s*- " "src/app/(marketing)/about/page.tsx" src/lib/learn/articles.ts
src/app/(marketing)/about/page.tsx:7
src/lib/learn/articles.ts:187
```

187 separate list-item lines in the Learn article corpus alone (the site's entire educational
content library) plus the 7-item product list on `/about` were affected — every single one
rendered as broken run-on prose, not a defect limited to one page.

Added `src/components/learn/MarkdownBody.unordered-list.test.ts`: confirmed RED pre-fix (`git
stash` isolating the source change) — the real `/about` TOOLS content reproduced exactly as a
`<p>` containing literal `- <strong>SPX Slayer</strong> — ...` text, matching the live screenshot
byte-for-byte in shape. GREEN post-fix (3/3): real `<ul><li>` markup, bold terms preserved, and a
companion test confirms a plain paragraph containing a bare em dash (a different Unicode
character, `—`, not a hyphen-minus) is never misdetected as a list. Full related-suite run
(`MarkdownBody.table.test.tsx`, `MarkdownBody.image.test.ts`, every `src/lib/learn/*.test.ts`,
`WhyBlackoutContent.test.ts`, `methodology-lane-nav.test.ts`, `breadcrumbs-placement.test.ts`,
`about-taxonomy.test.ts`, `legal-sections.test.ts`, `homepage-gamma-seed.test.ts`): 55/55 pass.
`tsc --noEmit` and `eslint` both clean.

### Blast radius

Every content string ever passed through `MarkdownBody` that uses a `-`/`*` list — which, per the
grep above, is the majority of the Learn Academy's substantive reference content (glossary-style
`- **Term** — definition` lists are the dominant explanatory pattern used throughout
`src/lib/learn/articles.ts`) plus `/about`'s product list. `WhyBlackoutContent.tsx` and
`MethodologyContent.tsx` currently contain zero `- ` blocks (confirmed via the same grep), so they
were not visibly broken today, but any future edit adding a bulleted list to either would have hit
the identical defect — the fix is in the shared renderer, so it protects all current and future
callers at once, not just the one page that surfaced it.

### Fix rationale

Added a new block-dispatch branch, structurally mirroring the existing ordered-list (`\d+\. `)
branch exactly: detect a block where **every** line (not just the first, to avoid false-positives
on a paragraph that merely contains a bare hyphen) matches `/^[-*]\s/` after trimming, strip the
marker, and render a real `<ul className="my-4 list-disc space-y-2 pl-6">` with `parseInline()`
applied per item — so bold/italic/link formatting inside each bullet (`**SPX Slayer**`) still
works exactly as it already does for ordered-list items and plain paragraphs. No other branch's
behavior changed; the fallback `<p>` branch is now reached only by content that was never a list
to begin with, confirmed by the added false-positive guard test.

| **Status** | Fixed in PR #6829 (branch `fix/markdownbody-unordered-list-support`) |
|---|---|
