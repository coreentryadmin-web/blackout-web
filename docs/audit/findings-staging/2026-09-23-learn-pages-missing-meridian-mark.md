## Meridian shows a generic "?"/"Abc" placeholder instead of its own mark on the public /learn pages — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Marketing site, public `/learn` Academy pages — `LearnSidebar.tsx`, `LearnHub.tsx`, `LearnSectionBlocks.tsx` |
| **Severity** | P3 — cosmetic branding inconsistency on public marketing pages, no functional/data defect |
| **Status** | FIXED |
| **Found via** | Live UI screenshots through `proxy-browser.cjs` during a routine DISCOVERY sweep |

### Root cause

Meridian is a real, live desk product (see `/meridian`, extensively referenced throughout
`CLAUDE.md`), but it has no entry in `ProductMark.tsx`'s `MarkProduct` union (`"spx" | "helix" |
"heatmap" | "largo" | "nighthawk" | "vector"` — "the six product sigils", per that file's own
comment) — it never got a hand-crafted animated SVG sigil the way the other six products did.
Because of that, `src/lib/learn/nav.ts` classifies Meridian's `LEARN_NAV` entry as `product:
"docs"` (the same bucket as the genuinely-docs-only "Getting Started" and "Glossary" chapters) —
which is an accurate classification on its own, since Meridian truly has no `ProductMark` sigil to
render.

The real app's own navigation already solved this: `Nav.tsx` and `DeskSidebar.tsx` both
special-case `href === "/meridian"` **before** falling through to `ProductMark`, rendering a
dedicated `<span className="meridian-mark">✦</span>` sparkle glyph instead. But the three
marketing-page components that also render `LEARN_NAV`/guide entries never got the same special
case — they only ever branched on `item.product === "docs"` vs. `ProductMark`, so Meridian fell
straight into the generic "this is a docs page, not a product" treatment on every one of them:

- `LearnSidebar.tsx` (Academy sidebar, present on every `/learn/*` page) — rendered a bare `?` box.
- `LearnHub.tsx` (the `/learn` hub's chapter-card grid) — rendered a bare `Abc` box.
- `LearnSectionBlocks.tsx`'s `tool-map` and `cross-links` section renderers (used inside individual
  guide articles) — rendered **no icon at all** for Meridian (the `item.product !== "docs"` guard
  suppressed the icon entirely with nothing to replace it).

Meanwhile every other real product (SPX Slayer, HELIX, Largo, Night Hawk, Thermal, Vector) renders
its own distinct colored animated sigil in all of these same spots — so Meridian is the one live
product that visibly reads as "not really a product" on the site's own Academy pages, identical in
treatment to a meta/docs page.

### Evidence

Live screenshots via `node proxy-browser.cjs <url> out.png --viewport 1440x900 --desktop --wait
6000` (repo root, `NODE_USE_ENV_PROXY=1` not needed for Chromium — see
`docs/audit/LIVE-UI-CONNECTION.md`):

- `https://blackouttrades.com/learn/dealer-gamma-options-flow-guide` — Academy sidebar entry #8
  ("Meridian") rendered a plain `?` in a bordered box, entries #1 ("Getting Started") and #9
  ("Glossary") rendered the identical `?` box, while entries #2–#7 (the six real products) each
  rendered their own distinct colored animated sigil.
- `https://blackouttrades.com/learn` — chapter card 08 ("Meridian") rendered `Abc`, identical to
  chapter 09 ("Glossary"), while chapters 02–07 each rendered their own sigil.

### Fix

Added the same `item.slug === "meridian"` (`guide.slug === "meridian"` in `LearnHub.tsx`) special
case already used in `Nav.tsx`/`DeskSidebar.tsx`, rendering the identical `meridian-mark` ✦ span,
in all four render sites across the three files — checked **before** the `product === "docs"` /
`product !== "docs"` branch so "Getting Started" and "Glossary" still correctly fall through to
their existing generic-docs treatment. No new CSS needed — `meridian-mark` has no dedicated CSS
rule anywhere in the codebase (confirmed by grep); it relies on inherited text color plus a
Tailwind `text-[N rem]` sizing utility, exactly as it already does in the two files this pattern
was copied from.

### Blast radius

Four render sites across three files, all on public, unauthenticated marketing pages
(`/learn/[slug]`, `/learn`). No app logic, data, or authenticated desk surfaces touched — `Nav.tsx`
and `DeskSidebar.tsx` (the real in-app navigation) already had this fix and were left unchanged.

### What was deliberately left unchanged

`LearnSectionBlocks.tsx`'s `tool-map`/`cross-links` sections don't currently have any live content
referencing the `meridian` slug (the shared `meridian(...)` cross-link helper in
`src/lib/learn/guides/shared.ts` exists but grep found zero call sites) — so those two fixes are
currently dormant, not yet visibly reachable. Fixed anyway since it's the identical root cause and
a future guide referencing Meridian in either section type would otherwise silently regress into
the same no-icon gap.

### Regression test

`src/components/learn/learn-meridian-mark.test.ts` (4 tests, source-text assertions against the
three fixed files plus a precedent check against `Nav.tsx`/`DeskSidebar.tsx`, matching this repo's
existing convention for untested `.tsx` components — see `marketing-mobile-nav.test.ts`). RED→GREEN
proof: `git stash`-ed the three component fixes with the new test active — 1 pass / 3 fail (the
untouched Nav.tsx/DeskSidebar.tsx precedent check still passed). Restored — 4/4 pass. Full
`src/components/learn/` + `src/lib/learn/` suite: 45/45 pass, 0 regressions. `npx tsc --noEmit`
clean. `npx eslint` on all four changed files clean.
