> **kind:** FINDING

## Ask Largo swing play-brief: plain "P&L:" / "next trim" distance line never disclosed the same stale quote Greeks/Spread/Exec P&L already flag — FIXED

| **Status** | FIXED (PR #TBD, this branch) |

### Root cause

`pnlSection()` (`src/lib/swing/play-brief.ts`) renders the Position section's `P&L:` line from
`play.pnlPct` — the identical `contract.bid`/`contract.ask`/`markAsOf` snapshot the `Mark:` line
above it renders and, when aged past `SWING_OPTION_MARK_STALE_MS`, tags `_(stale)_`. The function
already computes `staleCaveat = optionMarkStaleCaveat(play, readMs)` and appends it to Greeks
(fixed 2026-10-18), Spread (fixed 2026-10-18), and Exec P&L (fixed 2026-10-25, same day) — but the
plain `P&L:` line, built several lines earlier in the same function, was never one of the fixed
call sites. A member reading a brief saw `Mark: $1.10 (2026-10-23 16:00 ET) (stale)` immediately
followed by an unqualified `P&L: -9.8%` computed from that exact same aged quote — and, worse, the
identical `-9.8%` figure is rendered a *second* time in "Trade manager read"
(`execSlippageCoaching`'s "Executable P&L — mid -9.8% vs fill ...") where it **does** carry the
caveat, so one brief disclosed staleness for one rendering of a number and not the other.

A sibling gap of the same shape was found in `manageLifecycleCoaching()`
(`src/lib/swing/play-brief-narrative-coaching.ts`), which renders the "Manage plan" bullet's
"next trim at +100% — bid $X, needs $Y (+Z% from here)" distance clause from `play.execMark ??
play.mark` — the identical snapshot — but had **no `readMs` parameter at all** and never called
`optionMarkStaleCaveat`.

### Evidence

Found and adversarially verified (3/3 skeptics, 0 refuted each) via a 12-ticker parallel Largo
play-brief audit against live production:

- **SWING:NAIL:2093** — `P&L: **-9.8%**` unflagged in Position, but the identical `-9.8%` IS
  flagged `_(stale — same quote Mark flagged above)_` in the same brief's "Trade manager read"
  section.
- **SWING:BMNR:1974** — arithmetic-confirmed: bid $0.32/ask $0.37 → mid $0.345; `P&L: -51.4%` =
  (0.345/0.71-1)×100, unflagged, while Greeks/Spread/Exec P&L (all derived from the same mid/bid)
  carry the caveat.
- **SWING:TDOC:2018** — arithmetic-confirmed P&L is sourced from the raw unrounded mid (not the
  rounded displayed Mark), proving it shares the same snapshot as the flagged Spread/Exec P&L
  lines, yet renders with no caveat itself.
- **SWING:BLSH:2014** — `manageLifecycleCoaching`'s "Manage plan — ... bid $0.32, needs $2.20"
  renders unflagged two bullets above the sibling "Executable P&L — ... _(stale — same quote Mark
  flagged above)_" bullet, both priced off the identical snapshot.

### Fix

- `play-brief.ts`: moved `staleCaveat`'s computation earlier in `pnlSection()` (it only depends on
  `play`/`readMs`, both already in scope) and appended it to the `P&L:` line, mirroring the
  unconditional append already used for Exec P&L.
- `play-brief-narrative-coaching.ts`: added an optional `readMs` parameter to
  `manageLifecycleCoaching()` (threaded from its call site via `ctx.readMs`, same pattern as
  `execSlippageCoaching`) and appended `optionMarkStaleCaveat(play, readMs ?? Date.now())` to the
  rendered distance clause only (not the "already cleared" branch, which doesn't quote a dollar
  figure).

### Tests

- `composeSwingPlayBrief: plain P&L line carries the same stale-quote caveat as Greeks/Spread/Exec
  P&L` (`play-brief.test.ts`) — RED pre-fix, GREEN post-fix.
- `manageLifecycleCoaching: 'next trim' distance clause carries the same stale-quote caveat as the
  Position section` + a fresh-quote negative-control test (`play-brief-narrative-coaching.test.ts`)
  — RED pre-fix, GREEN post-fix.
- Full existing suite (both files, 371 tests) stays green; `tsc --noEmit` clean; full `npm test`
  (Node 20): 16910 pass / 0 fail / 3 pre-existing skips (one unrelated flake on the first run,
  confirmed clean on an immediate rerun).
