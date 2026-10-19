> **kind:** FINDING

## Night Hawk mobile detail overlay: stale-dim opacity breaks the full-screen takeover — list bleeds through — FIXED

| **Status** | FIXED (PR pending merge) |

**Where:** `src/app/globals.css` — `.nh-deck-right.nh-deck-dim{opacity:.84}` (unconditional rule) vs
the `@media (max-width:820px)` mobile full-screen detail overlay for the same `.nh-deck-right`.

**Found via:** the standing "Ask Largo × Night Hawk Swings" deep-dive mandate, a live mobile
(~430px) screenshot of the swing play-brief panel through `proxy-browser.cjs`'s tunnel + a temp
Clerk premium session, following up on a desktop-only live UI pass earlier the same session.

**Root cause.** `.nh-deck-right` is the Night Hawk Command Deck's detail/right rail. On desktop it
sits beside the list in a normal 3-column flex layout, and `.nh-deck-right.nh-deck-dim{opacity:.84;
transition:opacity .3s}` (added for the "Terminal v2" staleness UX, own comment: *"the whole detail
dims when the mark is older than the stale window"*) is a reasonable, subtle cue there — the list
is in a visually separate panel, so a slightly-transparent detail rail reads as "this data is
dated," nothing more.

Below 820px, `.nh-deck-right` is re-purposed into something structurally different: a
`position:fixed;inset:0;z-index:110` full-screen takeover (2026-08-29 fix, member report: tapping a
play on a phone needs its own slide-in detail screen with the list still mounted underneath for
scroll-position preservation). That takeover depends on being **opaque** — the whole point is that
the list behind it is not supposed to be visible while the detail sheet is open. `.nh-deck-dim`
never got scoped out of that breakpoint, so a STALE play's mobile detail view renders at 84%
opacity **as a full-screen overlay**, and ~16% of the list rows behind it show through.

**Evidence.** Live screenshot (iPhone-width viewport, real authenticated session, a real STALE
swing position — CRWV 60C 12DTE, mark "● STALE · mark $5.40"): the Ask Largo panel's
"Unavailable — HELIX flow: pipeline stale" / "Unavailable — option mark: stale…" chip text visibly
double-exposed with list rows "#1 ● HOLD … NVDA 212.5C 3DTE", "#2 ● HOLD … CRWV 60C 12DTE", "#3
● HOLD … TSLA 352.5C 5DTE" etc. bleeding through from behind, both largely unreadable where they
overlap. Confirmed via `getComputedStyle` in the same live session: `.nh-deck-right` computed
`opacity: 0.84` (class list included `nh-deck-dim`), `position: fixed`, `background: rgb(12,12,14)`
— i.e. correctly fixed/opaque-by-declaration, undone by the inherited opacity.

**Not a one-off edge case.** A STALE mark is a routine, frequently-occurring state (after-hours,
data-provider lag), not a rare condition — this affects a real, recurring fraction of mobile detail
views, not a contrived input.

**Fix.** Added `.nh-deck-right.nh-deck-dim{opacity:1}` inside the existing
`@media (max-width:820px)` block, immediately after the `data-mobile-view="detail"` transform rule.
Same two-class specificity as the unconditional rule, positioned later in source, inside a matching
media condition — wins the cascade only at ≤820px, leaving the desktop dimming behavior completely
untouched. The textual "● STALE · mark $X" pill elsewhere in the panel already carries the
staleness signal independent of this opacity effect, so nothing is lost.

**Regression test.** `src/features/nighthawk/command-deck/nh-deck-mobile-css.test.ts` — new test
"mobile full-screen detail overlay is never dimmed by the stale indicator," following this file's
existing convention (string/regex assertions on `globals.css`'s raw text + relative source-order
checks, not a live browser). RED (assertion fails: override rule absent) with `src/app/globals.css`
reverted via `git stash`; GREEN restored. `npx tsc --noEmit` clean.

**Blast radius.** CSS-only. No TSX/logic changes. Affects only the mobile (≤820px) full-screen
detail overlay's opacity while a stale/closed play is open; the desktop side-panel dimming and the
mobile list view are unaffected.
