> **kind:** FINDING

## Night Hawk Legacy: `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct`'s `stockPeakPct`/`stockTroughPct` fallback showed a fabricated "Best"/"Worst" position excursion for WATCH/SKIP plays — FIXED

**Status:** Fixed, regression tests added (`legacy-primary-pnl.test.ts`).

### Root cause

`legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` (`src/features/nighthawk/lib/legacy-primary-pnl.ts`)
are the shared helpers `TradeExcursionGraphic` (`TerminalPremiumPanels.tsx`) calls for the
"Best"/"Worst" excursion stats on every Legacy play. Before this fix:

```ts
export function legacyPrimaryPeakPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.peak ?? play.pnlPct;
  }
  return play.stockPeakPct ?? play.peak ?? null;
}

export function legacyPrimaryTroughPct(play: TerminalPlay): number | null {
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) {
    return play.trough ?? play.pnlPct;
  }
  return play.stockTroughPct ?? play.trough ?? null;
}
```

Neither function had a WATCH/SKIP status gate. `play.pnlPct`/`play.peak`/`play.trough` are already
nulled upstream for both statuses (`overlayLegacyOptionMarks` / `overlayLegacyQuotes`, #7105), but
`play.stockPeakPct`/`play.stockTroughPct` — the fallback these helpers reach for — are computed
**unconditionally for every status** by the same `overlayLegacyQuotes` (`use-legacy-quotes.ts`):

```ts
// Session excursion of the UNDERLYING, on the same band-midpoint basis as stockMovePct — and
// therefore just as wrong to render as premium excursion.
let peak: number | null = null;
let trough: number | null = null;
if (entryMid > 0) {
  if (isLong) {
    peak = ((q.sessionHigh - entryMid) / entryMid) * 100;
    trough = ((q.sessionLow - entryMid) / entryMid) * 100;
  } else {
    peak = ((entryMid - q.sessionLow) / entryMid) * 100;
    trough = ((entryMid - q.sessionHigh) / entryMid) * 100;
  }
}
// ...
pnlPct: null,
peak: null,
trough: null,
stockPeakPct: round2(peak),
stockTroughPct: round2(trough),
```

`stockPeakPct`/`stockTroughPct` are the underlying's session high/low excursion from the published
entry-band midpoint — honest context for a setup that hasn't been entered yet, but not a position's
MFE/MAE. Because the two helpers had no status gate, a WATCH (never entered) or SKIP
(invalidated/pulled, never entered) play always resolved "Best"/"Worst" to that hypothetical
excursion, rendered as if a real position existed.

This is the **5th live instance** of this exact defect class in this file family. PR #7164
(`678b9390c`) fixed the 4th instance — the identical unconditional-fallback shape in the sibling
function `legacyPrimaryPnlPct` — and that PR's own staged finding (`2026-11-01-legacy-stockmovepct-
watch-skip-fallback.md`) explicitly named `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` as
carrying "the identical `stockPeakPct`/`stockTroughPct` unconditional-computation shape" and flagged
them as "not touched by this fix — out of scope here... worth a follow-up finding if a live
WATCH/SKIP peak/trough rendering is ever found to leak the same way." This finding is that
follow-up, found during the same audit pass.

### Evidence

- **RED (pre-fix, proven live by reverting the source fix and re-running the new tests):**
  `legacyPrimaryPeakPct returns null for WATCH/SKIP even when stockPeakPct is a real non-null
  number...` and `legacyPrimaryTroughPct returns null for WATCH/SKIP even when stockTroughPct is a
  real non-null number...` both **failed** — `6.2 !== null` and `-3.4 !== null` respectively.
  10 passing / 2 failing on `legacy-primary-pnl.test.ts` before the fix.
- **GREEN (fix applied):** `legacy-primary-pnl.test.ts` 12/12 pass;
  `PlayTerminal.ssr.test.ts` 34/34 pass (no regression — its existing excursion-bar test uses
  `status: "OPEN"`, unaffected by the new WATCH/SKIP gate).
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test`: 17659 pass / 0 fail / 3 skipped (pre-existing skips, unrelated).

### Blast radius

Two confirmed-reachable render sites, both via `TerminalPremiumPanels.tsx`'s
`TradeExcursionGraphic` (`const worst = legacyPrimaryTroughPct(play); const best =
legacyPrimaryPeakPct(play);`):

- `src/features/nighthawk/command-deck/LegacyPlayDetailPanel.tsx` (line ~196-197) — the sole Legacy
  detail render path (`legacySinglePanel` always diverts Legacy plays there, per `PlayTerminal.tsx`'s
  own dead-code-removal comment); mounts `TradeExcursionGraphic` whenever
  `play.stockPeakPct != null || play.stockTroughPct != null`, with no status check. Right next to
  the now-honestly-null "Current" from PR #7164's fix — before this fix, a WATCH/SKIP card showed a
  populated "Best"/"Worst" bar beside an honest "—" for Current, an internally contradictory render
  on the same card.
- `src/features/nighthawk/components/LegacyPlayManageRail.tsx` (line ~171-176) — `LegacyPickLogBoard`'s
  "Trade management" rail, mountable for any selected board row regardless of status; identical
  unconditional mount gate.

One call site checked and confirmed **not** exploitable:
`src/features/nighthawk/command-deck/play-card-lifecycle.ts:598` (`openMetricsValues`) — its only
caller, `playListReturnPct`, branches to `watchMetricsValues`/`trackPct` for `phase === "watch"`
(which `playLifecyclePhase` maps both WATCH and SKIP to) **before** `openMetricsValues` is ever
called, so the compact list "PNL" column was never affected by this defect.

No existing test in `legacy-primary-pnl.test.ts` covered a WATCH/SKIP status for either
`legacyPrimaryPeakPct` or `legacyPrimaryTroughPct` before this fix (only pnlPct-presence branches
were tested), so this gap would not have been caught by the pre-existing suite.

### Fix rationale

Mirrors PR #7164's fix exactly — added `if (play.status === "WATCH" || play.status === "SKIP")
return null;` as the first line of both `legacyPrimaryPeakPct` and `legacyPrimaryTroughPct`, the
same `notYetEntered` idiom already established at this file's other 4 sibling sites. Gating at the
two shared helper functions (rather than at each of the two call sites individually) means both
`LegacyPlayDetailPanel` and `LegacyPlayManageRail` correct together with one change, and any future
caller of these helpers inherits the same correctness for free.

Unlike `legacyPrimaryPnlPct`'s fix, no replacement "Since flag" framing was needed here: once both
helpers return `null` for WATCH/SKIP, `LegacyPlayDetailPanel`'s and `LegacyPlayManageRail`'s existing
mount gate (`play.stockPeakPct != null || play.stockTroughPct != null`) still evaluates on the raw
`play.stockPeakPct`/`play.stockTroughPct` fields (not the helper outputs), so `TradeExcursionGraphic`
still mounts for a WATCH/SKIP play with a live quote — but internally, `best`/`worst` are now
honestly `null`, and the component's own existing null-handling renders the bar without a
fabricated "Best"/"Worst" value. No change to either mount gate was needed or made.

### Deliberately left unchanged

- The `LegacyPlayDetailPanel.tsx` / `LegacyPlayManageRail.tsx` mount gates themselves — still check
  the raw `stockPeakPct`/`stockTroughPct` fields (honest underlying excursion data, still useful
  stock-level context for a WATCH/SKIP play), not the helper outputs. Only the fabricated
  **position** excursion numbers are suppressed, not the stock-context panel's ability to mount.
- `TradeExcursionGraphic`'s own rendering logic — not touched; it already handles a `null`
  best/worst correctly (same as it already does for a fresh position with no latched peak/trough,
  per the 2026-09-17 fix documented in this same file's `legacyPrimaryTroughPct` comment).
