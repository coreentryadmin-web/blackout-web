## 2026-09-07 — [FINDING, P2 UI, Night Hawk] Swing play detail panel's "Current" $ value overlaps the adjacent "Peak" % value — FIXED

> **kind:** `FINDING`

### Symptom

Live UI sweep (desktop 1440×900, `/nighthawk?view=swings`, authenticated via a temp
admin+premium Clerk session and `proxy-browser.cjs`, per `docs/audit/LIVE-UI-CONNECTION.md`).
Selecting an open swing play (repro: NRG 110C 11DTE) renders the trade-hero metric row's
`Current`/`Peak` pair with the values overlapping — `+$4.80` (Current) painted directly on top of
`98%` (Peak), producing illegible merged text (`+$4.8098%`). Screenshot evidence captured before
the fix.

### Root cause

`.nh-deck-trade-hero__metric.is-primary .v` bumps the "Current" tile's value font-size to 22px
(base) / 28px (`.nh-deck--swing-largo` scope, which applies to this exact swing detail view) for a
DOLLAR-formatted value (e.g. `+$4.80`) rather than the shorter percentage strings the other four
metric tiles ("Peak", "Thesis Strength", "Rank", "Age") typically render. The parent
`.nh-deck-trade-hero__metric` flex column has `min-width:0`, which lets the grid TRACK shrink, but
the value `<span class="v">` itself had no `overflow`/`white-space`/`text-overflow` rule — nothing
clips a text node wider than its column, so it paints straight past the column edge and overlaps
whatever renders in the next `grid-template-columns` cell.

### Fix

Added `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%` to the base
`.nh-deck-trade-hero__metric .v` rule (`src/app/globals.css`). `.v` is a flex item of
`.nh-deck-trade-hero__metric{display:flex;flex-direction:column}`, and flex items are
automatically blockified per the CSS spec regardless of their source `display` — so
`text-overflow:ellipsis` applies correctly without needing an explicit `display:block` override. A
value that fits (the common case — most tiles render 3-5 characters) is completely unaffected;
only a value wide enough to overflow its column now truncates with `…` instead of bleeding into
the sibling tile.

### Evidence

- Live repro screenshot (desktop 1440×900, `/nighthawk?view=swings`, NRG 110C 11DTE) shows the
  overlap before the fix.
- RED→GREEN: new test `nh-deck-metric-value-overflow-css.test.ts` reads `globals.css` and asserts
  the base `.nh-deck-trade-hero__metric .v` rule carries all three overflow properties — fails
  against the pre-fix stylesheet (`git stash`), passes post-fix.
  - First regex attempt (`\.nh-deck-trade-hero__metric \.v\{...\}` with no anchor) silently
    matched the WRONG rule — the earlier `.nh-deck--swing-largo .nh-deck-trade-hero__metric
    .v{font-size:18px;color:#F8FAFC}` scoped override, since that selector contains the target
    selector as a tail substring. Caught by re-running RED against the corrected regex (negative
    lookbehind excluding `swing-largo `) and confirming it still failed pre-fix as expected before
    trusting the GREEN result.
- `src/features/nighthawk/command-deck/nh-deck-mobile-css.test.ts` (24/24, unrelated CSS rules in
  the same file, unaffected) and `PlayTerminal.ssr.test.ts` both still pass.
- `npx tsc --noEmit -p .`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/app/globals.css` — one rule, additive-only CSS properties (no existing property removed or
changed). Applies to every `.nh-deck-trade-hero__metric .v` render across Night Hawk (0DTE, Swings,
Legacy all share this component) — the fix only engages when a value is wide enough to overflow,
which was previously undefined/broken behavior, not a regression risk for the common short-value
case.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
