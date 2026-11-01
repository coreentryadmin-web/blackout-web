> **kind:** FINDING

## Night Hawk Legacy: `legacyPrimaryPnlPct`'s `stockMovePct` fallback showed a fabricated "position" P&L for WATCH/SKIP plays — FIXED

**Status:** Fixed, regression tests added (`legacy-primary-pnl.test.ts`, `PlayTerminal.ssr.test.ts`).

### Root cause

`legacyPrimaryPnlPct` (`src/features/nighthawk/lib/legacy-primary-pnl.ts`) is the shared helper
every Legacy render surface calls for the headline P&L number:

```ts
export function legacyPrimaryPnlPct(play: TerminalPlay): number | null {
  return play.pnlPct ?? play.stockMovePct ?? null;
}
```

The prior fix (#7105) correctly nulls `play.pnlPct` for WATCH (not-yet-entered) and SKIP
(invalidated/pulled, never entered) plays, in both `overlayLegacyOptionMarks` and
`overlayLegacyQuotes` — a WATCH play has no position to report a return on. But `stockMovePct`
— the fallback this helper reaches for once `pnlPct` is null — is computed **unconditionally for
every status**, WATCH/SKIP included, in `overlayLegacyQuotes` (`use-legacy-quotes.ts`):

```ts
const stockMovePct = entryMid > 0
  ? isLong
    ? ((q.price - entryMid) / entryMid) * 100
    : ((entryMid - q.price) / entryMid) * 100
  : null;
```

`stockMovePct` is the underlying's move from the published entry-band **midpoint** — honest
context for a setup that hasn't been entered yet, but not P&L. Because `legacyPrimaryPnlPct` had
no status gate of its own, a WATCH or SKIP Legacy play `ALWAYS` resolved this helper to that
hypothetical move, rendered everywhere as if it were a real position's return.

This is the **4th live instance** of this exact defect class in this file family, already fixed 3
times at other call sites:
- `overlayLegacyQuotes`'s `recommendation`/`recNote` SELL/TRIM override (same file,
  `2026-11-01-legacy-watch-quote-recommendation-leak.md`).
- `legacyZoneLabel`'s "cut the position"/"take profit" text (`legacy-play-geometry.tsx`,
  `2026-11-01-legacy-zonelabel-watch-skip-live-position-language.md`).
- `pnlPct`/`execPnlPct` in `overlayLegacyOptionMarks` (`use-legacy-option-marks.ts`, #7105).

This one is reached through `legacyPrimaryPnlPct`'s fallback chain — a still-open 4th site, now
closed.

### Evidence

- **RED (pre-fix, proven live by reverting the source changes and re-running the new tests):**
  - `legacyPrimaryPnlPct is unaffected for real-position statuses...` — unaffected (sanity).
  - `legacyPrimaryPnlPct returns null for WATCH/SKIP even when stockMovePct is a real non-null
    number...` — **failed**, `14.2 !== null`.
  - `Legacy single panel: WATCH status never shows a fabricated 'from entry' P&L...` — **failed**,
    rendered `+4.2% from entry` for a WATCH play with `pnlPct: null`, `stockMovePct: 4.2`.
  - `Legacy single panel: SKIP status never shows a fabricated 'from entry' P&L either` —
    **failed** the same way.
  - 3 failing / 39 passing on the two affected test files before the fix.
- **GREEN (fix applied):** `legacy-primary-pnl.test.ts` + `PlayTerminal.ssr.test.ts` 42/42 pass;
  `CommandDeck.ssr.test.ts` + `play-card-lifecycle.test.ts` + `play-card-display.test.ts` 78/78
  pass (no regression in the sibling WATCH-track rendering paths these touch).
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` run as part of this same PR's verification.

### Blast radius

Two **live, unconditionally-rendered** call sites for every Legacy play:

- `src/features/nighthawk/command-deck/LegacyPlayDetailPanel.tsx` — the verdict band, rendered
  literal text `"{movePct}% from entry"` right beside the BUY/HOLD/SELL badge. For a WATCH/SKIP
  play with no real entry, this read as if the member already held a position.
- `src/features/nighthawk/command-deck/PlayTerminal.tsx` — the header-stream block for LEGACY
  plays (`play.horizon === "LEGACY"` branch, rendered above `LegacyPlayDetailPanel` on the exact
  same single-panel view) carries the **identical** `"{movePct}% from entry"` text, independently
  computed from the same `legacyPrimaryPnlPct(play)` call — same root cause, same symptom, fixed
  at the shared helper so both sites correct together.

One **currently-dead-but-named** call site, fixed for consistency/defense-in-depth per this
finding's own scope (confirmed unreachable today: `useLifecyclePlayCard` in
`play-card-display.ts` unconditionally returns `true`, so `CommandDeck.tsx`'s `PlayCard` always
takes the `enhanced` branch and renders through `PlayLifecycleCardBody`/`PlayLifecycleCard.tsx`
instead — the real, live compact-card path. That live path's `playListReturnPct` already
short-circuits WATCH/SKIP to `watchMetricsValues(play).trackPct` before `legacyPrimaryPnlPct` is
ever consulted, and Legacy's `trackPct` is simply never populated, so it already rendered an
honest `"—"`, not a fabricated number — this was never a live-rendering bug on that path, unlike
the two above):
- `src/features/nighthawk/command-deck/CommandDeck.tsx` — the `nh-deck-pnl` span inside `PlayCard`'s
  second `return` block (the "now-dead legacy row" this file's own `CommandDeck.ssr.test.ts`
  comments already document — see test "watch compact row shows track and rank").

Other `legacyPrimaryPnlPct`/`legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` call sites
(`TerminalPremiumPanels.tsx`, `LegacyPlayManageRail.tsx`, `play-card-lifecycle.ts`'s
`openMetricsValues`) all benefit automatically from the shared-helper fix — none needed a
separate code change, since the gate lives at the one function every one of them calls.
`legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` have the identical `stockPeakPct`/`stockTroughPct`
unconditional-computation shape in `overlayLegacyQuotes` and are **not** touched by this fix —
out of scope here (this finding is scoped to the P&L headline, the one field every sibling fix in
this series has targeted one at a time); worth a follow-up finding if a live WATCH/SKIP peak/trough
rendering is ever found to leak the same way.

### Fix rationale

Added the same `notYetEntered` idiom the 3 prior sibling fixes already established — gate at
`legacyPrimaryPnlPct` itself (`play.status === "WATCH" || play.status === "SKIP"` → `null`)
rather than at each of the (currently 6) call sites individually, since this is the one shared
choke point every consumer already goes through. For the two live render sites, swapped in the
honest "Since flag" framing (the exact label `primaryReturnLabel`/`CommandDeck`'s existing
WATCH-track branch already use for this identical concept on SWING/LEAPS — `play.trackPct`) fed
from `play.stockMovePct` instead, since Legacy never populates `trackPct`
(`terminalPlayFromEdition`, `adapters.ts`, has no equivalent to `overlayHorizonWatchTrack`).
Rejected: inventing new copy for the WATCH/SKIP case — the task that produced this fix explicitly
called out reusing exactly what the sibling "Since flag" pattern already renders, so the fix reads
as "Legacy's own version of an existing concept," not a new one.

### Deliberately left unchanged

- `legacyPrimaryPeakPct`/`legacyPrimaryTroughPct` (same file) — same fallback shape, not in scope
  here; see Blast radius above.
- The dead `CommandDeck.tsx` branch's structure otherwise (still reachable only in theory) — fixed
  to mirror the live sites' framing rather than removed, since removing genuinely-dead code is a
  separate, already-tracked cleanup (see `play-card-lifecycle.ts`/`PlayLifecycleCard.tsx`'s own
  dead-code-removal history in this repo, e.g. the `LegacyPnlPanel` removal).
