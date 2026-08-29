# Night Hawk mobile: play list permanently squeezed by an always-visible detail rail + fixed table columns

> **kind:** FINDING

## Symptom

Member-supplied phone screenshot: the 0DTE play list truncates ticker/strike/expiry text hard
("QQQ 722.5C 0D...", "APP 332.5C 0D...", "SNDK 1520C 0D..."), and asks why the list can't default
to full width, opening the detail rails only once a play is clicked.

## Root cause

Two independent things compounded:

1. **The right rail (`PlayTerminal`, class `.nh-deck-right`) always rendered on mobile**, not only
   once a member picks a play. `CommandDeck` auto-selects a play the instant the board loads
   (`preferredPlayId(sorted) ?? sorted[0]`), so `selected` is essentially never `null` once any
   play exists — the mobile stacked layout (`@media (max-width:820px){.nh-deck{flex-direction:
   column}...}`, already present) showed the list capped to `max-height:42vh` ABOVE a full detail
   panel below it, permanently, regardless of whether the member had asked to see one.
2. **The play row/header grid (`--nh-play-cols:22px 80px minmax(0,1.5fr) 120px 96px 72px`,
   shared by `DeckPlayTableHeader` and `PlayLifecycleCardBody` via the same `.nh-deck-play-grid`
   class) reserves 390px of FIXED pixel columns** (rank/status/grade/time) before the flexible
   Play column gets any room at all — more than a phone's usable width, so even at full list
   width the Play column had nothing left to truncate into gracefully.

## Fix

1. `CommandDeck.tsx`: added `mobileDetailOpen` state, separate from the board's own default
   selection. A new `selectPlay()` wrapper (used by every `PlayCard`'s `onSelect`) sets it true;
   the auto-select-on-load effect does NOT (deliberately — that's the board choosing a default,
   not the member asking to see one); the cross-deck `focusTicker` navigation DOES (it's an
   explicit "go look at this play" action). `closeMobileDetail()` clears it, wired to a new
   `onBack` prop on `PlayTerminal` (a `‹ Plays` button, CSS-hidden above the mobile breakpoint so
   it's a no-op on desktop). The outer `.nh-deck` now carries `data-mobile-view="list"|"detail"`.
2. `globals.css`: under the existing `@media (max-width:820px)` block, `[data-mobile-view="list"]`
   hides `.nh-deck-right` and lets the list take the full column height (was hard-capped at 42vh);
   `[data-mobile-view="detail"]` hides `.nh-deck-left` instead. Both attributes are inert above
   820px — desktop always shows both rails side by side, exactly as the roadmap's live-verified
   3-rail layout already does. Also overrides `--nh-play-cols` on mobile to a 4-column layout
   (rank/status/play/pnl) and hides the Grade/Time cells — the two least-critical at a glance —
   so Play gets the room the fixed-width columns left it none of.

## Blast radius

`CommandDeck.tsx`, `PlayTerminal.tsx`, `globals.css` (mobile-scoped rules only). Desktop layout
(≥821px) is untouched — verified by reading every `.nh-deck-left`/`.nh-deck-right` rule outside
the `@media (max-width:820px)` block; none reference `data-mobile-view`. `PlayLifecycleCardBody`
and `DeckPlayTableHeader` are unchanged — the column-hiding is pure CSS on the shared cell classes
they already emit.

## Fix rationale

Chose CSS `display:none` + a redefined 4-column grid over removing/restructuring the header or
row components: it reuses the exact class names those components already render, so no component
logic changes and no test needed updating for the column set itself (Grade/Time remain fully
correct and visible on desktop and inside the detail rail — they're just not repeated in the
mobile list row). Chose a `data-mobile-view` attribute over a `matchMedia`-driven JS check so the
gate is free — the media query itself decides whether the attribute has any effect, with zero
risk of a desktop user ever seeing a hidden rail from a stale JS viewport read.

## Evidence

`npx tsc --noEmit` clean. New regression test in `CommandDeck.ssr.test.ts` pins that the first
render starts on `data-mobile-view="list"` (never "detail") and that the back button is present
in the tree. Full suite on Node 20: 11350/11352 pass, 0 fail (2 pre-existing skips).

| **Status** | FIXED |
