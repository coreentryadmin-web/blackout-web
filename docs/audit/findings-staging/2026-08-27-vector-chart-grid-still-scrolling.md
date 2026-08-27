> **kind:** `FINDING`

## Vector wide-desktop grid still forced the page to scroll after the "definite height" fix — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** PR #2932 (same day) gave `.vector-chart-terminal-grid` an explicit `height` and
`max-height` at the `>=1600px` breakpoint to fix the grid growing to fit content. That fix was
**incomplete**. The grid has no `grid-template-rows` declared, so its single implicit row uses the
CSS Grid default `grid-auto-rows: auto` — which sizes the row to the **max-content of whatever sits
in it**, entirely independent of the grid container's own `height`/`max-height`. Those two
properties bound the container's own box; they do nothing to the row track inside it. A grid
container can have a fixed height and an `auto` row that is taller than that height at the same
time — the row simply overflows the box (default `overflow: visible`), which is exactly what
happened: the ladder/chart/terminal/action columns' natural content height pushed the row (and the
whole page) taller than the viewport, and the member kept having to scroll to see the bottom of the
chart.

**Evidence.** Measured live on production (1920×1080, `/vector?ticker=SPX`), before this fix:
- `.vector-chart-terminal-grid` (the container): top 132, bottom 1100, **height 968px** — exactly
  matches `calc(100dvh - 7rem)` = 1080 − 112. The container-height fix WAS applying correctly.
- `.vector-chart-terminal-chart` (one row-track child, inside that same container): top 132,
  **bottom 2938, height 2806px** — nearly 3× the container's own height, extending 1838px past the
  container's bottom edge.
- `document.documentElement.scrollHeight`: **2938px** vs `window.innerHeight`: 1080px — confirms the
  page was scrolling by almost exactly the overflow amount (2938 − 1100 ≈ 1838).

This is why the member's fresh screenshot at the same width still showed the chart cut off at the
bottom after PR #2932 shipped — the container-height fix was real and deployed, but a fixed-height
grid container with an unconstrained `auto` row does not stop the row (and its children) from
growing past it.

**Fix.** Added `grid-template-rows: minmax(0, 1fr)` to the same `>=1600px` rule — this forces the
single row to actually **be** the container's available height (`1fr`) while still letting content
shrink below its own intrinsic size (the `0` floor), which is what finally lets the flex-column
chain inside `.vector-chart-terminal-chart` (`min-height: 0` already set) and the `height: 100%` +
`overflow-y: auto` internal scroll regions on the ladder/terminal/action rails (`.vector-odte-
matrix-scroll`, `.vector-helix-scroll`, `.vector-action-rail` — all pre-existing, per PR #2932's own
comment) actually get a real size to size against, instead of "auto" propagating "grow to fit
content" all the way down. Added `overflow: hidden` on the same rule as defense-in-depth — if any
descendant still doesn't shrink perfectly, it clips inside its own box rather than bleeding back
into document flow and reproducing this exact bug again.

**Verification — mechanical, not just re-reading the CSS.** Built a throwaway Next.js route
(deleted before this commit) using the exact same `.vector-chart-terminal-grid` /
`.vector-chart-terminal-chart` / `.vector-ladder-rail` / `.vector-terminal-rail` /
`.vector-action-rail` classes with synthetic children sized 1800–3000px tall (matching the live
measurement above), rendered through the real Tailwind-processed `globals.css` via `next dev`, and
measured with Playwright at 1920×1080:
- **Before this fix**: reproduced the exact live bug (columns overflow their row).
- **After this fix**: all four columns measured **exactly 968px** (matching the grid container),
  and `document.documentElement.scrollHeight` measured **1080px === window.innerHeight** — zero page
  scroll, even with a synthetic 3000px-tall child.

Added a regression test (`vector-chart-viewport.test.ts`) asserting the `>=1600px` grid rule carries
both `grid-template-rows: minmax(0, 1fr)` and `overflow: hidden`.

**Blast radius.** Only the `>=1600px` grid rule — the `<1280px` stacked-mobile rule intentionally
stays `min-height` only (that layout is supposed to scroll the whole page), and the `1280-1599px`
3-column-plus-action-row layout was never touched by either the container-height fix or this one.

**What was deliberately left unchanged.** The `calc(100dvh - 7rem)` height/max-height values
themselves (still correct — the container-height math was never the bug), and every rail's own
internal scroll-region CSS (`.vector-odte-matrix-scroll`, `.vector-helix-scroll`) — those were
already correctly built, per PR #2932's comment, and simply never had a real constraint to activate
against until this fix.
