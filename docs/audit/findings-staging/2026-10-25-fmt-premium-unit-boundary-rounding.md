## 2026-10-25 — [FINDING, P2 shared formatting] `fmtPremium` overflows at K→M and M→B unit boundaries — FIXED

> **kind:** `FINDING`

**Root cause.** `fmtPremium` (`src/lib/fmt-money.ts`) is the canonical "compact signed dollar
magnitude" formatter — its own header calls it the single source of truth that replaced ~15
duplicated copies across the codebase precisely because divergent copies had rendered different
strings for the same dollar figure before. It picks a unit bucket by comparing the RAW magnitude
against `1_000_000_000` / `1_000_000` / `1_000`, then separately rounds the quotient to 1 decimal
(millions/billions) or 0/1 decimals (thousands) for display. A value whose raw magnitude sits just
under a bucket threshold but whose ROUNDED quotient reaches `1000` of the current unit was never
promoted to the next unit — it printed the overflowed four-digit label instead:

```
fmtPremium(999_950_000) → "$1000.0M"   (should be "$1.0B")
fmtPremium(999_999_999) → "$1000.0M"   (should be "$1.0B")
fmtPremium(999_700)     → "$1000K"     (should be "$1.0M")
```

This is the exact same bug shape — compare-then-round-independently instead of rounding first and
checking whether the ROUNDED value crossed the next unit boundary — as the Thermal
`fmtCompactHeatMoney` defect fixed earlier today (PR #6686, `thermal-discord-card.ts` +
`thermal-compact-matrix.ts`). `fmt-money.ts`'s own `fmtPremium` is a third, independent
implementation of the identical "compact money" concept that was never audited for the same class
of boundary bug when the first two were fixed.

**Evidence.**
```js
> fmtPremium(999_950_000)
'$1000.0M'
> fmtPremium(999_999_999)
'$1000.0M'
> fmtPremium(-999_960_000)
'-$1000.0M'
> fmtPremium(999_700)
'$1000K'
```
No existing test in `src/lib/fmt-money.test.ts` exercised a value within 0.05% of a unit boundary —
every existing fixture (`38_200_000`, `22_100`, `456_700`, etc.) rounds cleanly within its bucket.

**Blast radius.** `fmtPremium` is imported directly or via `src/lib/api.ts`'s re-export by ~45
call sites across the product: every Helix flow/premium panel (`FlowFeed`, `NetPremiumLeaderboard`,
`CumulativeNetPremiumChart`, `DarkPoolPanel`, `ExecutionAnalysisPanel`, `SectorFlowPanel`,
`StrikeVolumeProfile`, `VelocityRadar`, `HelixSessionPulseBar`, `HelixHotTickersRail`,
`NightHawkFlowPanel`, and more), Vector (`VectorHelixRail`, `vector-flow-markers.ts`,
`vector-pulse.ts`, `vector-pick-evidence.ts`), Thermal's own `thermal-regime-strip.ts`, SPX
(`SpxSniperHeader`, `spx-pulse.ts`), Nighthawk (`format.ts`, `grounding.ts`), BIE
(`flow-brief.ts`, `spx-desk-brief.ts`, `spx-desk-intel.ts`, `vector-desk-intel.ts`), Meridian
(`meridian-cross-product-for-earnings-core.ts`, `meridian-event-brief.ts`,
`meridian-vector-for-earnings-core.ts`), Largo (`flow-strike-stacks.ts`, `mini-panel.ts`,
`slash-prompts.ts`), swing's own play-brief files, and `zerodte/intel.ts`. Any single large option
flow print or net-GEX figure landing in the `[999_950_000, 1_000_000_000)` or `[999_500, 1_000_000)`
window on any of these surfaces would have shown an overflowed four-digit label.

**Fix.** Mirrors the already-merged `fmtCompactHeatMoney` fix exactly: round the quotient FIRST,
then check whether the rounded value reached `1000` of the current unit before formatting —
promoting to the next unit when it does. Applied at both the millions→billions and
thousands→millions boundaries (the two places `fmtPremium` has a "next unit up" to promote into).
Left `fmtOptionUsd`/`fmtPriceLevel`/`fmtPct` in the same file untouched — they format absolute
prices/percentages, not magnitude-bucketed compact labels, so they have no unit-boundary concept to
share this bug.

**Test.** `src/lib/fmt-money.test.ts` — new case asserting `999_950_000 → "$1.0B"`,
`999_999_999 → "$1.0B"`, `-999_960_000 → "-$1.0B"`, `999_700 → "$1.0M"`, `-999_700 → "-$1.0M"`.
RED (pre-fix, reverted source only) → 19/20 pass, the new case failing exactly as expected; GREEN
(post-fix) → 20/20 pass. Also ran the full consuming test files
(`src/lib/fmt-premium.test.ts` — exercises the same function via `api.ts`'s re-export,
`src/lib/swing/play-brief-intel.test.ts`, `src/lib/bie/vector-desk-intel.test.ts`,
`src/lib/gex-heatmap-display.test.ts`) — 377/377 pass, no regression. `tsc --noEmit` clean on the
touched file.

| **Status** | FIXED |
