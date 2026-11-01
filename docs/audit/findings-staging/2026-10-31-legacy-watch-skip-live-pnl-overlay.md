# Night Hawk Legacy — `overlayLegacyOptionMarks` computed a live P&L% for not-yet-entered WATCH/SKIP plays against the published entry premium — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 (member-facing): a WATCH (not yet entered) or SKIP (invalidated/pulled) Legacy play displayed a real, colored P&L% as if it were an open position. |
| **Area** | Night Hawk Legacy command deck — `src/features/nighthawk/command-deck/use-legacy-option-marks.ts` (`overlayLegacyOptionMarks`). |
| **Status** | FIXED |

### Root cause

A Legacy play stays `status: "WATCH"` from publish (~8pm ET) until the next morning's 9:15am ET
morning-confirm cron runs, and stays `WATCH` afterward for DEGRADED/UNVERIFIED verdicts too
(`terminalPlayFromEdition`, `adapters.ts` — only INVALIDATED/severe-pulled maps to `SKIP`, only
CONFIRMED maps to `OPEN`). `SKIP` means invalidated/pulled — never entered either.

`overlayLegacyOptionMarks()` overlays a live option quote onto each play, and until this fix
computed `pnlPct`/`execPnlPct` against `entryCostPerContract` (the *published* entry premium, not
a real fill) with **no status check at all**:

```ts
const mark = row.mark ?? p.mark ?? null;
const pnlPct = pinnedLivePnlPct(entryPrem, mark);
const execPnlPct = pinnedLivePnlPct(entryPrem, row.bid ?? null);
```

So a not-yet-actionable (or already-invalidated) setup was presented with a real, colored P&L —
exactly what the board's own status badge invariant ("never WATCH... not-yet-entered plays have
no real pnlPct", `legacy-board-table-utils.ts`) already protects against at the badge layer, but
this overlay bypassed by writing straight into `premiumPct`/`execPnlPct`, which feed the board's
"Premium vs entry" column (`legacy-board-columns.tsx`) and the detail panel's hero P&L
(`legacyPrimaryPnlPct`, `legacy-primary-pnl.ts`) with no status gate of their own.

The sibling `terminalPlayFromHorizon` (`adapters.ts`) already gates its own `pnlPct`/`execMark`/
`execPnlPct` on WATCH/SKIP — this overlay, which runs after that adapter and overwrites its
fields with a live quote, carried no equivalent gate.

### Fix

```ts
const notYetEntered = p.status === "WATCH" || p.status === "SKIP";

const mark = row.mark ?? p.mark ?? null;
const pnlPct = notYetEntered ? null : pinnedLivePnlPct(entryPrem, mark);
const execPnlPct = notYetEntered ? null : pinnedLivePnlPct(entryPrem, row.bid ?? null);
const latch = latchLiveExcursion({ ...p, mark, pnlPct }, pnlPct);
...
execMark: notYetEntered ? null : (row.bid ?? p.execMark),
```

`mark`/`markAsOf` stay live (same as `terminalPlayFromHorizon`'s own precedent) so the
"Entry → mark" display and freshness label keep working; only the computed *percentage* return is
withheld. `peak`/`trough` fall out of this for free: `latchLiveExcursion` with a null `pnlPct`
just carries over the play's existing (always-null, pre-overlay) peak/trough rather than latching
a new excursion.

### Fix rationale

Mirrors `terminalPlayFromHorizon`'s own WATCH/SKIP gate exactly, rather than inventing a second
convention. Left `OPEN`/`HOLD`/`TRIM`/`CLOSED` untouched — those are genuinely-entered or
genuinely-closed states where a live (or final) P&L% is correct and expected.

### Blast radius

Scoped to this one overlay function. `legacy-board-table-utils.ts`'s status-badge invariant,
`legacy-board-columns.tsx`, and `legacy-primary-pnl.ts` are unchanged — they already handle a
`null` pnlPct correctly (that's the whole reason the badge invariant exists); this fix just stops
feeding them a non-null value in the WATCH/SKIP case.

### Regression test

`src/features/nighthawk/command-deck/use-legacy-option-marks.test.ts` (new, 10 tests): WATCH and
SKIP plays get `null` `pnlPct`/`execPnlPct`/`execMark` from a real quote; WATCH still gets a live
`mark`/`markAsOf`; WATCH's `peak`/`trough` are not latched from the withheld `pnlPct`; OPEN
(morning-confirmed) and HOLD/TRIM get a real computed `pnlPct` (control); CLOSED is unchanged; the
no-entry-premium and no-resolvable-OCC pass-through paths are unchanged.

Scoped run (Node 20, `--experimental-test-module-mocks`): 10/10 pass. `npx tsc --noEmit` clean.
