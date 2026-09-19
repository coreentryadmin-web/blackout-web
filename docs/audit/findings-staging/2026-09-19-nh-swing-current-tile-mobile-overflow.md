# Night Hawk Swings "Current" P&L tile still overflows at phone width — #5257's desktop fix was never verified below 1024px

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Command Deck trade hero — `.nh-deck-trade-hero__metrics` / `.nh-deck-trade-hero__metric.is-primary .v` / `.nh-deck--swing-largo` (`src/app/globals.css`), consumed by `TradeSummaryHero` (`src/features/nighthawk/command-deck/TerminalPremiumPanels.tsx`) on `/nighthawk?view=SWING` |
| **Severity** | P2 (member-facing — the same defect class as #5257, at the viewport most members actually use for a quick position check) |
| **Status** | FIXED — `fix/nh-swing-current-tile-mobile-overflow` |

## Root cause

PR #5257 (merged earlier this cycle) fixed the "Current" tile's desktop truncation by widening the
primary grid column's *relative share* (`1fr` -> `1.5fr`) and dropping the swing-largo font-size
override back to 22px. Both changes are unconditional (not media-gated), so they apply at every
viewport — but the PR's own verification (local Playwright screenshots "at the real ~500px hero
width", plus the live desktop repro) never checked the *absolute* pixel result once the whole hero
shrinks to phone width. Its own write-up flagged this explicitly as unverified: "Also spot-check the
same tile at phone width (430px, mobile UA) — this fix only touched the swing-largo desktop-scale
override and the shared grid rule, so confirm mobile wasn't already fine and isn't now regressed."

This cycle's retry of exactly that check (`proxy-browser.cjs`, 430x932, minted premium session)
found it was NOT fine: a live click-through to a real HOLD swing position rendered "Current" as a
visibly truncated `"+$..."`. A direct DOM measurement on the SAME rendered tile confirmed it
mechanically, not just visually — `getBoundingClientRect`/`scrollWidth` vs `clientWidth` on
`.nh-deck-trade-hero__metric.is-primary .v` showed **scrollWidth 112px vs clientWidth 74px** for the
plain text `"+$0.00"` — the shortest, plainest dollar string this field ever produces (no negative
sign, no thousands separator, minimal digits). If the shortest possible value already overflows,
every realistic value overflows too: 1.5fr of a ~400px-wide phone hero still isn't enough absolute
room at 22px, even though it comfortably fixed the desktop case where the hero is ~2-3x wider.

## Evidence

- **Live repro** (`proxy-browser.cjs`, minted premium Clerk session, phone viewport 430x932,
  `https://blackouttrades.com/nighthawk?view=SWING`, clicked into a real HOLD swing position):
  "Current" tile visibly rendered `"+$..."` (CSS ellipsis, not a placeholder string — confirmed no
  such literal string exists anywhere in `TerminalPremiumPanels.tsx`, which only ever renders
  `${dollarSign}${usd(dollar)}` or an em dash).
- **Mechanical confirmation** (headless DOM measurement, same viewport, same live production page):
  `{"text":"+$0.00","scrollWidth":112,"clientWidth":74,"overflowing":true}` on
  `.nh-deck-trade-hero__metric.is-primary .v` post-hydration (8s initial wait + 8s post-click wait,
  ruling out a transient pre-hydration render as the cause — an earlier, shorter-waited measurement
  on a different play happened to catch a frame where the value fit, which is what necessitated this
  more deliberate re-measurement rather than trusting the first (non-overflowing) sample).
- CloudWatch (`/ecs/blackout-production`, 15 min then again ~10 min later,
  `TypeError`/`Unhandled`/`"undefined is not"`) checked twice this cycle, both clean (0 events) —
  unrelated to this finding, logged per the cycle's standing checklist.

## Blast radius

Same root cause hits every swing play with any dollar-formatted "Current" value viewed on a phone
(<=480px), not just the one sampled — this is the majority of real traffic to a quick-glance P&L
check. The 0DTE view shares the same base (non-swing-largo) `is-primary` rule, so it is exposed too,
just slightly less (18px base vs the swing-largo 22-28px history), and gets the same mobile-width
protection from this fix since the plain (non-swing-largo) selector is also covered.

## Fix rationale

Added a `@media (max-width:480px)` block, placed after both the base and `.nh-deck--swing-largo`
`is-primary .v` rules so it wins on source-order for equal specificity:

1. `.nh-deck-trade-hero__metrics` grid-template-columns: primary column widened further, `1.5fr` (the
   desktop #5257 value) -> `2.5fr`, only below 480px — desktop is completely untouched since the
   media query gates it.
2. Both `.nh-deck-trade-hero__metric.is-primary .v` and its `.nh-deck--swing-largo`-scoped
   counterpart get font-size dropped to `18px` (from 22px) only below 480px — re-capped both because
   the swing-largo-scoped rule is the one that actually renders on `/nighthawk?view=SWING`, and
   fixing only the plain selector would look fixed while leaving the real production repro broken.

Chose "more relative share + smaller font, mobile-only" over shrinking the four sibling tiles
(percentage/rank/age values are already short and don't need protecting) or removing the existing
overflow/ellipsis clip guard (still needed as a backstop for a genuinely extreme value, e.g. a
4-digit dollar P&L, which can still occur even at 18px). Verified with a headless DOM re-measurement
of the same live tile post-fix (not included in this repo, run ad hoc via `proxy-browser.cjs`'s
`createTunneledContext` helper) plus the new regression test below, which fails RED against the
pre-fix CSS (git-stash-verified) and passes GREEN post-fix.

Extended `nh-deck-metric-value-overflow-css.test.ts` with a third test asserting: the mobile media
block exists, its primary column fraction is strictly greater than the desktop 1.5fr, and both the
plain and swing-largo `is-primary .v` font-sizes inside it are strictly less than the desktop 22px.
436/436 nighthawk command-deck tests pass, `tsc --noEmit` clean.
