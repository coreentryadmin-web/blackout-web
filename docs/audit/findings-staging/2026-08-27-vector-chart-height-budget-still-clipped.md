> **kind:** FINDING

## Vector volume pane still clipped/below-fold at normal laptop heights, post-#2981 — FIXED

| **Status** | FIXED in `fix/vector-chart-height-budget-scroll-safe` |
| **Severity** | P1 — desk UX, common laptop viewport (1280-1599px wide) |
| **Surface** | `/vector` @ 1280-1599px wide (e.g. 1366×768/864/1080 — the ordinary laptop range) |

### Follow-up to

PR #2981 (merged) fixed the price/volume **share** — `PRICE_PANE_STRETCH`/`VOLUME_PANE_STRETCH`
7:2.2 → 8:2 (80/20) — but its own write-up flagged an unaddressed second factor: "the grid's
`calc(100dvh - 7rem)` budget... a budget deliberately shrunk on 2026-08-26." This finding is that
second factor, confirmed live and fixed.

### Symptom

Operator report + live screenshot at a normal laptop window size: the volume histogram was not
merely squeezed, it was **entirely below the fold inside the chart's own container** — only
candles visible, nothing scrolled to reveal it. A prior attempt to fix a related issue had made
the **whole page** scroll, which the operator explicitly does not want repeated.

### Root cause

`.vector-page-shell .vector-chart-terminal-grid` only ever carried `min-height:
calc(100dvh - 7rem)` — a **floor, not a size**. Below 1600px wide (1280-1599px — an entirely
ordinary laptop width bracket that includes 1366px, one of the most common laptop screen widths)
that floor was **never capped or converted to a definite height**: the fix that does that already
existed, but only inside `@media (min-width: 1600px)` (`#2936` and its wide-desktop follow-up).

With no definite height, CSS Grid's default `grid-auto-rows: auto` sized the row to the
**max-content of its tallest column** — completely independent of the viewport. At this
breakpoint `.vector-gex-ladder` and `.vector-odte-matrix-scroll` both explicitly strip their own
`max-height` (`max-height: none`, by design, so a tall rail's real scroll region can flex) and
`.vector-desk-terminal` carries a `min-height: min(72vh, 640px)` floor — all of which, lacking a
definite ancestor height to resolve `height: 100%` against, inflated the row's natural size
instead of being constrained by it. The chart column's own `flex: 1 1 0` chain then stretched (or
was clipped by its `overflow: hidden` ancestor) to match, at whatever height the ladder/terminal
happened to want that render — **not** a function of the screen.

Measured live at 1366×768 (two captures of the same page, same viewport, several seconds apart):
chart column 823px → grid 1316px one run, chart column 1955px → grid 2448px the next. Either way
the page scrolled 550-1680px past the fold before the volume sub-pane — at the very bottom of the
chart canvas — ever entered view.

### Blast radius

Same root cause as the wide-desktop bug #2936/its follow-up already fixed at `>=1600px` — this is
the **identical bug class**, just never extended down to the 1280-1599px breakpoint, which is a
much more commonly-hit width bracket than >=1600px for a "normal laptop."

### Fix

Applied the same "cap the shell to one viewport, force the grid row to actually BE that height via
`minmax(0, 1fr)`, let each rail scroll internally instead of inflating the page" technique used at
`>=1600px`, down to `>=1280px` — with one structural difference: at this breakpoint the action
rail (Play card / Technicals / Alerts) is still a full-width row **underneath** the 3-col section,
not a 4th column, so it needs **two** explicit grid rows instead of one:

```css
.vector-chart-terminal-grid {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
  max-height: none;
  overflow: hidden;
  grid-template-rows: minmax(0, 1fr) minmax(0, min(34vh, 380px));
}
.vector-action-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
```

Row 1 (`minmax(0, 1fr)`) takes whatever height remains after the shell cap and the capped action
row — this is what makes the ladder/terminal/chart columns actually shrink to fit instead of
inflating the page, the same mechanism `#2936`'s follow-up already proved for the single-row
`>=1600px` case. Row 2 is capped at `min(34vh, 380px)` rather than left `auto`, and
`.vector-action-rail` gets `overflow-y: auto`, so a long Play-card/Technicals/Alerts stack scrolls
**inside its own row** instead of either being clipped or re-inflating the page — the exact
purpose an unbounded `auto` row would have defeated.

The `>=1600px` block still wins at wider viewports (later in cascade, same specificity) by
overriding `grid-template-columns` to 4 columns and `grid-template-rows` back to a single
`minmax(0, 1fr)` once the action rail earns its own column and no longer needs a reserved row —
unchanged by this fix.

**Deliberately left unchanged:** the base (<1280px, mobile/stacked) rule stays a plain `min-height`
floor — that layout is a single column meant to scroll the whole page like any other stacked
mobile view, which is not the bug here.

### Evidence

Reproduced BOTH on production (`blackouttrades.com/vector?ticker=SPX`, via `proxy-browser.cjs` +
`mintClerkPremiumSession`) and locally (`next dev`, same auth flow, same viewport) at three
heights: 768px, 864px, 1080px (all 1366px wide, desktop UA).

**Before (bug reproduced live, both prod and local):**
- 768px: `docScrollHeight` 927-2663 vs `innerHeight` 768 (page scrolls up to ~1900px past the
  fold); `.vector-chart-stage` measured `clientHeight` 142 vs `scrollHeight` 320 — the chart's own
  container clipping ~178px of its own canvas via `overflow: hidden`, i.e. the exact "volume
  entirely below the fold inside the chart's own container" symptom reported.
- 864px: `docScrollHeight` 967 vs `innerHeight` 864 — page scrolls; volume bar reduced to a single
  visible sliver.
- 1080px: `docScrollHeight` 1183 vs `innerHeight` 1080 — page scrolls; volume bar reduced to a
  single visible sliver even at this taller height.

**After (fix applied, local — same auth/viewport harness):**
- 768px: `docScrollHeight` **768** = `innerHeight` 768. `pageHasVerticalScroll: false`. Grid capped
  to 656px (`100dvh - 7rem` floor, now also the ceiling). Volume canvas 71px of a 383px chart
  stage (~19%, inside the #2981 18-22% band). Action rail 261px with its own `overflow: auto`.
- 864px: `docScrollHeight` **864** = `innerHeight` 864. `pageHasVerticalScroll: false`. Volume pane
  fully visible with clear headroom.
- 1080px: `docScrollHeight` **1080** = `innerHeight` 1080. `pageHasVerticalScroll: false`. Volume
  pane fully visible; GEX ladder and action rail both visible and scroll internally.

No page-level (document) scroll at any of the three tested heights, confirmed both by the
`document.documentElement.scrollHeight` vs `window.innerHeight` measurement above and visually in
the captured screenshots — the specific regression the operator flagged from "last time" and asked
not to be repeated.

### Tests

`src/features/vector/components/vector-chart-viewport.test.ts` — new test
`"VectorChart: 1280-1599px desk (before the 4-col breakpoint) also flex-fills, no document scroll"`
asserts the shell-height cap, the grid's `flex`/`height: auto`/`overflow: hidden`, the two-row
`grid-template-rows: minmax(0, 1fr) minmax(0, ...)`, and `.vector-action-rail`'s
`height: 100%; overflow-y: auto` are all present in the vector-specific `1280px` block (anchored
off the vector base rule, since `globals.css` has several unrelated `1280px` media blocks for other
products) — and that the base `<1280px` rule is untouched. Full suite: 11094 pass / 0 fail (Node
20). `npx tsc --noEmit` clean.
