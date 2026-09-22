> **kind:** FINDING

# Live-tape swing accumulation advance accepted DTE up to 30, three weeks after the real swing window narrowed to 15

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P2 (live data-quality bug on a production write path — corrupts cross-session persistence evidence, no capital/gating impact) |
| **Surface** | Night Hawk Swings — `src/lib/swing/event-trigger.ts`, wired from `src/lib/ws/uw-socket.ts` |

## Root cause

`event-trigger.ts`'s `SWING_EVENT_MAX_DTE` was a hardcoded literal (`30`) — correct when the module was
written (`HORIZONS.SWING.dteMax` was 30 then), but it never moved when the 2026-09-04 operator-directed
narrowing dropped Swing Command's real DTE ceiling from 30 to 15 (`horizons.ts`'s `SWING_MAX_DTE = 15`).
Its sibling constant, `SWING_EVENT_MIN_DTE`, was written to derive from `HORIZONS.SWING.dteMin` (per the
2026-08-06 cross-engine dual-admission bug this exact derive-don't-copy pattern was built to prevent — see
`taxonomy.ts`'s own header note) and so tracked that EARLIER floor move automatically. `SWING_EVENT_MAX_DTE`
was the one half of the pair that stayed a literal, and the later narrowing slipped past it.

This function gates a LIVE production write path: `uw-socket.ts`'s WS flow handler calls
`isMaterialSwingFlow` on every real UW flow-alert print, and when it passes (big, directional, "swing-dated")
calls `advanceSwingAccumulationFromFlow`, which accretes one observation into `swing_candidate_accumulation`
via `observeSwingCandidate` — keyed on `(ticker, direction, archetype: UNCLASSIFIED, sessionDay, signalKinds:
["FLOW"])`, with **no DTE field carried at all**. So a real 16-30 DTE print — now genuinely LEAPS territory;
`subLaneForDte` (taxonomy.ts) returns `null` for any DTE above 15, meaning no swing sub-lane could ever
commit a position at that DTE — was still silently treated as corroborating evidence toward that
ticker/direction's cross-session swing persistence, the same signal a genuinely in-window 5-15 DTE print for
the identical ticker/direction would produce. A candidate could accrete real "2nd independent signal"
corroboration (the anti-lone-print invariant `meetsPersistence` checks) from flow that was never actually
swing-dated.

## Evidence

`SWING_EVENT_MAX_DTE = 30` (literal) vs `HORIZONS.SWING.dteMax = 15` (`horizons.ts`, `SWING_MAX_DTE`)
confirmed live in source. Confirmed the live wiring: `grep -n advanceSwingAccumulationFromFlow src/lib/ws/uw-socket.ts`
→ line 1398, inside the WS message handler, gated only by `isMaterialSwingFlow(flow, now)`. Confirmed
`observeSwingCandidate`'s call in `event-trigger.ts` passes no DTE to the accumulation store. The existing
`event-trigger.test.ts` had itself baked in the stale assumption as a passing assertion — `"30 DTE is the
inclusive upper edge"` — a test written for the pre-2026-09-04 window that nobody updated when the window
narrowed, so it never caught the drift.

## Fix

- `SWING_EVENT_MAX_DTE` now derives from `HORIZONS.SWING.dteMax`, the same way `SWING_EVENT_MIN_DTE` already
  derives from `HORIZONS.SWING.dteMin` — both bounds now move together automatically on any future window
  change.
- Updated the three prose comments that described the window as "2–30 DTE" (this file's own two, plus
  `uw-socket.ts`'s two call-site comments) to describe the bounds by reference rather than by a literal
  range, so they can't silently go stale the same way again.
- Updated `event-trigger.test.ts`'s boundary test: added explicit assertions that 15 DTE is now the
  inclusive upper edge, 16 DTE is rejected (now LEAPS territory), and — the regression proof — 30 DTE (the
  OLD ceiling) must no longer read as material swing flow.

RED confirmed via `git stash` (the new "30 DTE must no longer be material" assertion fails: `isMaterialSwingFlow`
still returned `true` pre-fix). GREEN after restoring; all 6 tests in `event-trigger.test.ts` pass.
`npx tsc --noEmit` clean.

## Blast radius

Two files touched for behavior (`event-trigger.ts`'s constant + comments, `uw-socket.ts`'s comments only —
no logic change there, it just calls the now-corrected function). One test file updated. No other caller of
`SWING_EVENT_MAX_DTE`/`isMaterialSwingFlow` exists (grepped repo-wide). Does not touch the scheduled-scan
discovery path (`scan-cadence.ts`) or any commit-gate logic — this is exclusively the live-tape
out-of-band accumulation-advance path, which by design (per the file's own header) can only ever accrete
evidence, never commit a position; the fix stops it from accreting evidence for DTEs that are structurally
un-committable.

## Fix rationale

Derive, don't hardcode — the identical fix shape already applied to `SWING_EVENT_MIN_DTE` and to
`taxonomy.ts`'s `TACTICAL.dteMin` (per that file's own header comment on the 2026-08-06 incident), extended
to the one place in this exact neighborhood that still had a literal copy. No behavior was added or removed
beyond narrowing the accepted DTE window to match the window the rest of the swing engine has used since
2026-09-04.
