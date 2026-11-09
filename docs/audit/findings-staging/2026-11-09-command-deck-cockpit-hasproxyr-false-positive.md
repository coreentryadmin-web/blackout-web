## Command Deck's Session P&L "proxy R" disclosure fires off a play's mere PRESENCE on the board, not whether it actually fed the R figure it is disclosing — FIXED

> **kind:** `FINDING`

### Summary
`sessionTape()` (`src/features/nighthawk/command-deck/cockpit.ts`) computes the Night Hawk Command
Deck's "SESSION P&L" cockpit figure in R units, and flags `hasProxyR: true` whenever the figure
mixes in a SWING/LEAPS/LEGACY play — because those lanes exit on thesis-primary logic, not the
0DTE −50% ratchet stop this module borrows as its 1R unit. `CommandDeck.tsx` renders that flag as a
`*` beside the P&L number with the tooltip *"R-unit includes Swing/LEAPS/Legacy plays — the −50%
stop is 0DTE-derived, not native to these models' thesis-primary exits."*

The bug: `horizons.add(p.horizon)` ran **unconditionally for every play in the input array**,
*before* the `if (p.pnlPct == null) continue;` skip-check that excludes WATCH/SKIP/un-marked rows
from the R sum entirely:

```ts
for (const p of plays) {
  horizons.add(p.horizon);                    // <- ran for EVERY play, contributing or not
  if (p.pnlPct == null) continue;              // WATCH/SKIP rows always have pnlPct:null
  const r = p.pnlPct / R_STOP_ABS_PCT;
  if (p.status === "CLOSED") { realizedR += r; realizedCount += 1; }
  else if (WORKING.has(p.status)) { openR += r; openCount += 1; }
}
const hasProxyR = horizons.has("SWING") || horizons.has("LEAPS") || horizons.has("LEGACY");
```

`CommandDeck.tsx` calls `sessionTape(plays)` with `plays` being the **full, unfiltered board** —
every horizon, every status, exactly the comment at the call site says ("Cockpit figures —
computed off the FULL board"). A Night Hawk board routinely carries SWING candidates sitting in
WATCH (or SKIP) alongside working/closed 0DTE positions, and `adapters.ts` stamps
`pnlPct: status === "WATCH" || status === "SKIP" ? null : pnlDisplay` — i.e. those rows are
*guaranteed* to hit the `continue` and contribute nothing to `realizedR`/`openR`. Yet because
`horizons.add` ran before that check, their mere existence on the board flipped `hasProxyR` to
`true` and planted the "* R-unit includes Swing/LEAPS/Legacy plays" disclosure on a P&L figure that
was, in fact, 100% 0DTE-derived — a false claim about where the number came from, displayed right
next to the number.

This also directly contradicts the type's own doc comment, one line above the field:
```ts
/** Horizons that contributed to this tape (so we can label when R is mixed/derived). */
horizons: Set<TerminalPlay["horizon"]>;
```
The implementation tracked *presence on the board*, not *contribution to the tape* — the exact
distinction the comment draws and the bug erases.

### Evidence
Pre-fix, three plays — two real 0DTE contributions and one non-contributing SWING WATCH row with
no mark yet:
```ts
sessionTape([
  play({ id: "1", status: "CLOSED", pnlPct: 100, horizon: "ZERO_DTE" }), // +2R realized
  play({ id: "2", status: "OPEN",   pnlPct: 25,  horizon: "ZERO_DTE" }), // +0.5R open
  play({ id: "3", status: "WATCH",  pnlPct: null, horizon: "SWING" }),  // never entered
])
// pre-fix:  hasProxyR === true   (WRONG — nothing SWING fed the +2.5R shown)
// post-fix: hasProxyR === false  (the +2.5R is entirely 0DTE)
```
Added two regression tests in `cockpit.test.ts` (`sessionTape: a non-contributing SWING WATCH row
must NOT flip hasProxyR…` and the SKIP/LEGACY sibling). RED → GREEN proven by `git stash` on only
`cockpit.ts` (keeping the new tests): 2 of 12 tests fail pre-fix (`hasProxyR` reads `true` when it
should be `false`), all 12 pass post-fix. The six pre-existing tests in the file (including the two
that assert `hasProxyR: true` for a SWING play that *does* carry a real `pnlPct` and *does*
contribute) are untouched and still pass — the fix narrows the flag, it does not disable it.
`npx tsc --noEmit` clean.

### Blast radius
`sessionTape` has exactly one call site (`CommandDeck.tsx`, checked via repo-wide grep — no other
module imports it), so the fix's effect is contained to the one cockpit strip (both the full and
`--compact` render variants read the same `tape.hasProxyR`). No other function in this file reads
or recomputes `horizons`/`hasProxyR` independently.

### Fix rationale
Moved `horizons.add(p.horizon)` inside the two branches that actually add to `realizedR`/`openR`
(the `CLOSED` branch and the `WORKING` branch), after the `pnlPct == null` skip. A horizon is now
only recorded once a play from it has genuinely fed the sum — matching the field's own doc comment
("contributed to this tape") instead of the mere-presence reading the old code implemented. Left
unchanged: the WATCH/SKIP exclusion itself, the R_STOP_ABS_PCT=50 unit, `deployedRisk`/
`workingTickersOf` (unrelated functions in the same file, already correct), and the UI rendering in
`CommandDeck.tsx` (it already reads `tape.hasProxyR` correctly — the defect was entirely in what
that flag measured, not in how it was consumed).
