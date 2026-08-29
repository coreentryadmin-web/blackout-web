# Night Hawk mobile detail: swap → true overlay, plus a self-inflicted cascade bug caught before shipping

> **kind:** FINDING

## Symptom / context

Follow-up to #3117 (mobile play-list fix): the member asked whether the detail rail could be a
genuine overlay (list stays mounted underneath) rather than swapping the list out of the DOM/flex
layout, since a swap loses scroll position on every tap-in/tap-out round trip. Separately, while
building and OFFLINE-verifying this change (a static HTML harness against the actual compiled
`globals.css`, screenshotted with local Playwright — no auth/DB/tunnel needed), two of #3117's own
rules turned out to be silent no-ops on production.

## Root cause (the overlay ask)

`.nh-deck-right` (via `[data-mobile-view]`) previously toggled `display:none`/`flex` to swap it in
and out of the `.nh-deck` flex row alongside `.nh-deck-left` — that unmounts nothing in React, but
CSS `display:none` still drops the element from layout each time, and re-flowing the list back into
view after a detail visit is enough to lose native scroll restoration in some browsers.

## Root cause (the cascade bug — the actual finding worth writing up)

Three of #3117's `@media (max-width:820px)` rules were placed BEFORE the base (non-media,
unconditional) rules they were meant to override, later in the same file:
`.nh-deck-play-table{--nh-play-cols:...}`, `.nh-deck-play-cell--rating,--time{display:none}`, and
`.nh-deck-mobile-back{display:inline-flex}` (overridden by a later unconditional
`.nh-deck-mobile-back{display:none}`). **A `@media` query changes WHEN a rule applies, not its
precedence against an equal-specificity rule that appears later in source order** — so at ≤820px,
both the media rule and the later base rule matched, and the later one (non-media, "wins ties")
took effect. The Grade/Time columns never actually hid on mobile, the play-row grid never actually
narrowed to make room for the Play column, and the back button would have been invisible at every
mobile width. `#3117`'s regression test (`data-mobile-view="list"` on first render, back button
present in the SSR-rendered tree) could not catch this — it asserts the markup exists, not that CSS
gives it the intended visual effect, which is exactly the class of bug this repo's audit toolkit
keeps re-discovering it needs pixel-level checks for (see `gex-depth-validate.mjs`,
`largo-card-deadspace.mjs` in `CLAUDE.md`'s audit-toolkit section — "a visualization of a number
nobody has checked is worse than no visualization").

**Caught by**: an offline static-HTML harness that mounted the DOM structure `PlayLifecycleCardBody`
and `PlayTerminal` actually emit against the real, compiled `globals.css` (copied straight out of
`.next/static/css/`), screenshotted locally with Playwright (`file://`, no network/auth needed) —
the list screenshot showed GRADE visible and PLAY's header missing entirely, immediately visible as
wrong against the intent. Fixed by reordering `.nh-deck-mobile-back`'s base rule to before the media
block (natural cascade, no `!important` needed) and adding `!important` to the two rules whose base
definitions live in a part of the file not worth relocating (`--nh-play-cols`, the cell-hide rule) —
matching an existing `!important` convention already used twice elsewhere in this same CSS section
(`.nh-deck-prem-lg`, `.nh-deck-pnl-lg`).

## Fix

1. `.nh-deck-right` is `position:fixed;inset:0` at ≤820px, off-screen by default
   (`transform:translateY(100%)`, `pointer-events:none`) and slid fully into view
   (`transform:translateY(0)`, `pointer-events:auto`) only under
   `.nh-deck[data-mobile-view="detail"]`. `.nh-deck-left` is never hidden or re-flowed — it stays
   mounted and scrolled exactly where the member left it. `z-index:110`, above the shared
   `.nav-bar`'s `z-index:100` — a full takeover of the viewport is the standard mobile "detail
   screen" pattern, with `.nh-deck-mobile-back` as its own way back rather than the site nav.
   `prefers-reduced-motion` gets a no-transition variant.
2. The three cascade-order bugs above, fixed per the "Caught by" paragraph.

## Blast radius

`globals.css` only, and only the `@media (max-width:820px)` mobile-scoped rules plus the two
`.nh-deck-mobile-back` base-rule copies (now one, relocated). No component/TSX change — the
`data-mobile-view` attribute and `mobileDetailOpen` state from #3117 are reused as-is. Desktop
(≥821px) untouched.

## Evidence

`npx tsc --noEmit` clean. `npm run build` succeeds. Offline Playwright screenshots (list → tap a
play → detail slides in with back button visible → tap back → list, scroll-preserving) confirm the
overlay transform and the fixed cascade both behave as intended — before, the same harness showed
Grade visible/Play header missing/back button potentially invisible; after, exactly the 4-column
mobile layout (rank/status/play/pnl) with a working slide-in/out overlay. Full suite on Node 20:
11354/11356 pass, 0 fail (2 pre-existing skips) — includes #3117's own CommandDeck/PlayTerminal
SSR regression tests, still green (the markup they pin is unchanged; only the CSS was ever wrong).

| **Status** | FIXED |
