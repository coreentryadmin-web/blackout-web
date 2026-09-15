> **kind:** FINDING

## Swing Command's mobile position list was pinned to ~51% viewport width, truncating every position's ticker/strike/expiry into illegibility — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**What was broken:** live-verified via a real screenshot at a 430px phone viewport (forensic batch
41, 2026-09-15, `proxy-browser.cjs` through the CONNECT-tunnel Chromium, authenticated real premium
session, `Routed: 186 ok, 0 fail`): the Swing Command position list rendered squeezed into roughly
the left half of the screen, with the right half entirely blank. The `PLAY` column header was
truncated to `"P..."`, the `CLOSED 21` filter tab clipped to `"CLO"`/`"21"`, and every visible row
showed only an `L` badge and a bare `.` — the actual ticker/strike/DTE text (e.g. `"AAPL 332.5C
6DTE"`) was completely invisible. A member on a phone could not tell which position was which.

**Root cause:** a CSS specificity trap. A 2026-08-29 fix (documented in `globals.css` and
`nh-deck-mobile-css.test.ts`) made the base 0DTE mobile list full-width via
`@media (max-width:820px){.nh-deck-left{width:100%;...}}`. But the Swing-specific 3-pane layout
(`.nh-deck--swing-largo`, applied whenever `deckHorizon === "SWING" && commandCenter` per
`CommandDeck.tsx:280`) carries its own unconditional, un-guarded rule:
`.nh-deck--swing-largo .nh-deck-left{width:30%;min-width:220px}`. That selector has higher
specificity (two classes vs. one) and no `!important`, so it wins the cascade over the mobile
media-query rule regardless of viewport — the EXACT same "later/higher-specificity base rule
silently overrides a media-query fix" trap this same file's own comments already document and
guard against for the sibling `--nh-play-cols` override and the `nh-deck-right-largo-mobile`
fallback, just missed for this one rule. `min-width:220px` on a 430px viewport works out to almost
exactly the ~51% squeeze observed in the screenshot — the math matches the visual defect exactly.

**What changed:** added a guarded mobile override,
`@media (max-width:820px){.nh-deck--swing-largo .nh-deck-left{width:100%!important;min-width:0!important}}`,
mirroring the established `!important`-guarded pattern already used two rules up in the same file.
No component/TS logic touched — CSS only.

**Fix rationale:** minimal, additive, matches an existing well-understood pattern in the same file
rather than inventing a new one. Zero risk to desktop layout (the override is scoped inside the
`@820px` media query) or to the base 0DTE mobile layout (the selector is scoped to
`.nh-deck--swing-largo`, which only applies to the Swing desk).

**Test:** RED→GREEN proven (git-stashed the CSS change, confirmed 2 of 3 new regression tests fail
— the override-presence test and the ordering test — pass after restoring the fix; the third test,
confirming the unconditional rule carries no `!important` of its own, passes either way since it's
a precondition check). Full `src/features/nighthawk/command-deck/*.test.ts` (408 tests, +3) green on
Node 20 with `--experimental-test-module-mocks` (required for `PlayTerminal.ssr.test.ts`'s
`mock.module` calls — confirmed this is a known, pre-existing environment flag requirement per
CLAUDE.md, not something this change introduced or broke), `tsc --noEmit` clean.
