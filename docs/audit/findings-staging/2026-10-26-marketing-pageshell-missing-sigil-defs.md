## Marketing-group pages render `<ProductMark>` with dangling `url(#bo-glow)`/`url(#bo-accent-*)` references — the shared `<defs>` block never mounts there — FIXED

> **kind:** `FINDING`

### Root cause

`<ProductMark>` (`src/components/marks/ProductMark.tsx`) paints every product sigil's focal/bloom
group with `filter="url(#bo-glow)"` (or `#bo-glow-lg`) and fills with `url(#bo-accent-radial)` /
`url(#bo-accent-linear)` / `url(#bo-scan-sweep)` / `url(#bo-emerald-thread)` / `url(#bo-scan-clip)` /
`url(#nh-wedge)` (`src/components/marks/geometry.tsx`, every product's geometry block). These are
intentionally NOT duplicated per instance — `SharedSigilDefs.tsx`'s own header comment says so
explicitly ("5 copies of `id=\"bo-glow\"` would collide") — they are meant to be mounted exactly
once, with every `<ProductMark>` on the page referencing that one shared `<defs>` block by id.

That one mount point is `AppShellProviders` → `DeskShell` (`src/components/providers/
AppShellProviders.tsx`), which renders `<SharedSigilDefs/>` once alongside Clerk/motion/PWA/iOS
providers. `AppShellProviders` is deliberately NOT loaded on the lean marketing route group — its
own comment says exactly that: "Clerk + motion + desk client shell — NOT loaded on the public
marketing homepage." It is only wired into `(site)/layout.tsx`, `sign-in/layout.tsx`, and
`sign-up/layout.tsx`.

But `<ProductMark>` IS used on pages that live in the `(marketing)` route group, which never mounts
`AppShellProviders`:
- `/upgrade` → `AuthProofRail` (`variant="upgrade"`) and `FeatureComparison`, both rendered inside
  `UpgradePageShell` on `(marketing)/upgrade/page.tsx`, framed by `MarketingPageShell`.
- `/learn` and every `/learn/*` guide/article/glossary page → `LearnHub`, `LearnSidebar`,
  `LearnGuideView`, `LearnSectionBlocks`, all rendered under `(marketing)/learn/layout.tsx`, which
  also wraps its children in `MarketingPageShell`.

Neither `MarketingPageShell` nor any ancestor layout for these routes ever rendered
`<SharedSigilDefs/>`. So on every one of those pages, every `<ProductMark>`'s `filter`/`fill`
`url(#...)` references pointed at ids that did not exist anywhere in that page's DOM.

Per the CSS Filter Effects / SVG painting rules a browser actually implements, this is not a
cosmetic "loses its glow" gap — an element whose `filter` references a non-existent `<filter>` is
not rendered at all, and `fill`/`stroke`/`clip-path` referencing a missing paint server/clipPath
similarly resolve to no paint/fully clipped. Every sigil's focal "node"/"bloom"/"core" group (the
visual anchor of each icon — see `geometry.tsx`'s `bo-node`/`bo-bloom`/`bo-focal`/`bo-core` groups,
every one carrying a `filter="url(#bo-glow)"`) was affected, on every desk icon shown on `/upgrade`'s
trust rail and feature table, and on every product icon in `/learn`'s hub cards and sidebar nav.

### Evidence

Reproduced without a browser via `react-dom/server`'s `renderToStaticMarkup` — rendering
`MarketingPageShell` wrapping a `<ProductMark product="vector" />` (the exact composition `/learn`
and `/upgrade` use) showed `filter="url(#bo-glow)"` present in the markup with **no** matching
`id="bo-glow"` anywhere in the same output (confirmed `html.includes('id="bo-glow"') === false`
pre-fix). New regression test
`src/components/landing/MarketingPageShell.test.tsx` asserts both the `url(#bo-glow)` reference AND
the matching `id="bo-glow"`/`id="bo-accent-radial"`/`id="bo-accent-linear"` ids are present in the
same render — confirmed RED pre-fix (`git stash` isolating `MarketingPageShell.tsx`), GREEN
post-fix. `tsc --noEmit` clean.

### Blast radius

Every current `(marketing)`-group consumer of `<ProductMark>`: `/upgrade` (`AuthProofRail`,
`FeatureComparison`) and `/learn/*` (`LearnHub`, `LearnSidebar`, `LearnGuideView`,
`LearnSectionBlocks`). `(site)`-group desks, `/sign-in`, `/sign-up` were never affected — they
already mount `AppShellProviders`/`SharedSigilDefs` via their own layouts. The fix is mounted at the
single shared marketing-chrome component (`MarketingPageShell`), so it also covers any future
marketing page that adopts `<ProductMark>` without needing a second fix.

### Fix rationale

Mount `<SharedSigilDefs/>` once inside `MarketingPageShell` itself rather than pulling in the full
`AppShellProviders`/`DeskShell` bundle (which would reintroduce the Clerk/motion/PWA bundle-size cost
the marketing route group deliberately avoids, per that file's own stated purpose). `SharedSigilDefs`
is a plain, dependency-free server component — no "use client", no hooks, a static zero-size SVG —
so sharing it costs nothing toward that goal. Left `AppShellProviders`' own mount in place (desk pages
still only need one copy, and `SharedSigilDefs` rendering twice on a page that somehow nested both
shells would just be two identical, inert, non-conflicting `<defs>` blocks — ids are the same so
there's no collision risk even in that edge case, only redundant markup).

| **Status** | Fixed in PR #TBD (branch `fix/marketing-sigil-defs-missing`) |
|---|---|
