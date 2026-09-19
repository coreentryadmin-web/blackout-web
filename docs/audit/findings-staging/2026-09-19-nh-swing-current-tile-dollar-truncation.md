# Night Hawk Swings "Current" P&L tile renders as unreadable "$-0…" — hides the trader's own number, found only by rendering the live UI (not the API)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Command Deck trade hero — `.nh-deck-trade-hero__metrics` / `.nh-deck--swing-largo` (`src/app/globals.css`), consumed by `TradeSummaryHero` (`src/features/nighthawk/command-deck/TerminalPremiumPanels.tsx`) on `/nighthawk?view=SWING` |
| **Severity** | P2 (member-facing — the live/realized dollar P&L on a selected swing play is illegible; every prior swing/Largo audit this session checked the API envelope only, never the rendered pixels, so this class of bug was structurally invisible to them) |
| **Status** | FIXED — `fix/nh-swing-current-tile-dollar-truncation` |

## Root cause

`TradeSummaryHero`'s "Current" tile is the only one of the 5 hero metrics (Current / Peak / Thesis
Strength / Rank / Age) whose value is **dollar-formatted** (`usd(dollar)`, e.g. `"-$1.88"`) rather
than a short percentage/rank/age string — the other four are always ≤~8 characters. Two rules
compounded against it:

1. `.nh-deck-trade-hero__metrics{grid-template-columns:repeat(5,minmax(0,1fr))}` gave the dollar tile
   the exact same track width as its structurally-shorter siblings.
2. `.nh-deck--swing-largo .nh-deck-trade-hero__metric.is-primary .v{font-size:28px}` — the Swings-view
   override — rendered that one tile at the **largest** font in the row (28px vs 18px for the other
   four), on the **narrowest available room**.

A prior fix (`nh-deck-metric-value-overflow-css.test.ts`, 2026-09-07) already caught the first-order
failure mode of this same tile ("+$4.80" bleeding into the next column's text) and added
`overflow:hidden;text-overflow:ellipsis` as a clip guard. That guard does its job — nothing bleeds —
but it also means a too-wide value degrades all the way down to **zero readable digits**: a real
`-$0.85` P&L (closed AAPL 332.5C 3DTE, entry $5.65, live-quoted mid $4.80) rendered as literal
`"$-0…"` on production. The member cannot recover their own P&L from that string; it isn't
"somewhat truncated," it's gone.

## Evidence

- **Live repro** (`proxy-browser.cjs`, minted premium Clerk session, desktop 1440×900 + `--desktop`,
  `https://blackouttrades.com/nighthawk?view=SWING`): the auto-selected play (AAPL 332.5C 3DTE,
  positionId 38, `GET /api/market/swing/record` confirms `entryPremium:5.65`, `exitPnlPct:-33.19`,
  `contract.mid:4.8`) rendered `CURRENT` as `$-0…` — cropped/zoomed confirms three literal ellipsis
  dots, not a decimal point.
- **Isolated local repro** (Playwright against a static HTML extract of the exact live CSS rules at
  the real ~500px hero width, no network needed): reproduces the identical `$-0….` clip for a bare
  `"$-0.85"` string in the pre-fix grid/font rules — confirms the CSS math, not just the one live
  sample.
- **Confirms this is a genuinely new class of finding**: every swing/Largo audit this session before
  this one (API envelope completeness, `/api/market/swing/play-brief` field-by-field checks) reads
  the same JSON `entryPremium`/`contract.mid` this tile derives from and would report it as
  correct — because it *is* correct data; the defect is purely in how the rendered pixels present it.
  CloudWatch (`/ecs/blackout-production`, 15 min, `TypeError`/`Unhandled`/`"undefined is not"`) was
  also checked this cycle and came back clean (0 events) — unrelated to this finding, logged for
  completeness per the cycle's standing checklist.

## Blast radius

Same root cause hits every play with a non-trivial dollar swing shown in the Swings view's trade
hero, not just the one sampled — any OPEN, HOLD, TRIM, or CLOSED swing row whose `mark - entry`
formats to more than a few characters (which `usd()`'s locale-grouped, up-to-3-decimal format
readily produces, e.g. `"+$1,240.75"` at the larger end). The 0DTE view shares the same base
`.nh-deck-trade-hero__metrics`/`.nh-deck-trade-hero__metric.is-primary` rules (22px, not the
swing-largo 28px) so it was already less exposed, but the widened primary column benefits it too.

## Fix rationale

Two changes, both verified against the live-extracted repro before shipping:

1. `.nh-deck-trade-hero__metrics` grid-template-columns: primary column widened from an even `1fr`
   to `minmax(0,1.5fr)` (siblings unchanged at `1fr` each) — gives the one structurally-longer value
   more room without touching the other four tiles' layout.
2. `.nh-deck--swing-largo .nh-deck-trade-hero__metric.is-primary .v` font-size: `28px` → `22px`,
   matching the base (non-swing-largo) is-primary size — still visually the emphasized tile against
   the 18px siblings, just no longer the single biggest contributor to running out of room first.

Deliberately did **not** remove the existing `overflow:hidden;text-overflow:ellipsis` clip guard
from the 2026-09-07 fix — it stays as a safety net for genuinely extreme values (verified an
unrealistic `+$1,240.75` case still clips gracefully post-fix, whereas the realistic `-$0.85`/
`+$4.80` range that actually occurs for this per-share-premium field now renders in full). Did not
change the dollar-formatting function (`usd()`) itself — it is shared with unrelated whole-dollar
membership-pricing surfaces and reformatting it here would be a wider, riskier change than the
layout fix this specific tile needed.

## Verification

- Independent RED→GREEN (`git stash` the CSS-only diff, keep the new test):
  `npx tsx --experimental-test-module-mocks --test
  src/features/nighthawk/command-deck/nh-deck-metric-value-overflow-css.test.ts` — 1/2 failed with
  source reverted (the new assertion on the widened grid column), 0/2 reapplied.
- Local Playwright before/after screenshots of the exact live CSS rules at the real hero width:
  pre-fix reproduces `"$-0…."`; post-fix renders `"$-0.85"` in full.
- `npx tsx --experimental-test-module-mocks --test
  src/features/nighthawk/command-deck/*.test.ts` — 435/435 pass (12 suites, includes
  `PlayTerminal.ssr.test.ts`, the other consumer of `nh-deck-trade-hero__metrics`).
- `npx tsc --noEmit` — clean (CSS-only change, no TS surface touched).
