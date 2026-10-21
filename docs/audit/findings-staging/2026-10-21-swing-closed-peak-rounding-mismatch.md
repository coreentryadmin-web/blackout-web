## 2026-10-21 — [FINDING, swing] CLOSED-play 'Peak' % derived from raw pre-rounding premium, disagreeing with the rounded dollar figures a member would hand-check against

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C9 precision — the same stored position renders two different "Peak %" figures on two real product surfaces) |
| **Surface** | `src/lib/swing/closed-plays.ts` — `closedDeckSourceFromRow()`'s `entryPremium`/`peakPremium`/`troughPremium` mapping |

### Root cause

`closedDeckSourceFromRow` (the shared mapper from a raw `SwingPositionRow` DB record into
`SwingClosedDeckSource`) passed `entry_premium`/`peak_premium`/`trough_premium` straight through
unrounded. Two real, independent consumers feed those same three DB columns through the identical
pure function, `terminalPlayFromClosedSwing` → `terminalPlayFromHorizon`'s `peakDisplay`/
`troughDisplay` (`Math.round(((peak/entry - 1) * 100) * 10) / 10`):

1. **Ask Largo's CLOSED play-brief** (`play-brief-resolve.ts:217-218`) calls
   `closedDeckSourceFromRow(target)` directly against the raw DB row — bypassing any HTTP route.
2. **The Command Deck UI's CLOSED tab** (`containers.tsx:294`) reads `swingRecord.closedDeck` from
   `GET /api/market/swing/record`, whose route (`record/route.ts:67-74`) wraps the ENTIRE response
   (including `closedDeck`, sourced from the SAME `closedDeckSourceFromRow`) in `roundFloats(...,
   dp=2)` before serving it.

So the same closed position's `entryPremium`/`peakPremium` reach the identical percentage-deriving
function via two different precision bases — raw (Largo brief) vs. 2dp-rounded (Command Deck UI,
and anything else reading `/record`). Whenever the raw values sit near a rounding boundary, the two
surfaces can render a genuinely different "Peak %" for the same closed position. This is the same
raw-vs-rounded shape already found and fixed for 0DTE (`docs/audit/FINDINGS.md`: "0DTE peak_pnl_pct/
mfe_capture_pct/floor_pnl_pct computed from the raw pre-rounding premium"), whose fix was correctly
scoped to `zerodte-service.ts` only and never reached this swing path.

### Evidence

Live repro (Ask Largo deep-dive, 2026-10-21, closed BE position):

```
Raw position data (from /api/market/swing/record closedDeck):
entryPremium $17.95 · peakPremium $45.03 · troughPremium $15.45 · exitPnlPct +70.61%

## Lessons
Peak was **+150.8%** · exited **+70.6%**
```

`(45.03 / 17.95 - 1) * 100 = 150.8635…`, which rounds to **150.9**, not the displayed 150.8 — the
brief's Lessons section derived its percentage from the raw, pre-rounding `entry_premium`/
`peak_premium` (≈17.952/≈45.025, both of which still 2dp-round-display as 17.95/45.03), not the
rounded dollar figures a reader would actually reconcile against.

Added a RED repro to `closed-plays.test.ts` (entry_premium: 17.952, peak_premium: 45.025,
trough_premium: 15.449 — a fixture chosen so raw math yields 150.8 but rounded math yields 150.9)
asserting `closedDeckSourceFromRow` now returns the rounded 17.95/45.03/15.45. RED→GREEN confirmed
via `git stash` on the source file alone: 29/30 (1 fail) before, 30/30 after.
`src/lib/swing/*.test.ts` + `adapters.test.ts`: 2134/2134 pass. `tsc --noEmit` clean.

### Blast radius

Single shared source (`closedDeckSourceFromRow`) — fixing it there makes BOTH real consumers
(the direct-DB Ask Largo brief path and the HTTP `/record` route feeding the Command Deck UI)
agree, and makes `/record`'s own `roundFloats()` call idempotent on these three fields (no behavior
change for existing UI consumers, since it was already rounding them to the same 2dp).

### Fix

Round `entryPremium`/`peakPremium`/`troughPremium` ONCE at `closedDeckSourceFromRow`
(`src/lib/swing/closed-plays.ts`) using the file's own existing `round2` helper, rather than
passing raw DB floats straight through. This is the "re-derive from the already-rounded value"
principle the analogous 0DTE fix used, applied at the one shared point both real callers pass
through.

### Why not a bigger fix

Did not touch `peakDisplay`/`troughDisplay`'s formula itself (correct, just fed inconsistent
inputs), the `/record` route's `roundFloats()` call (now idempotent, not removed — other fields in
that payload still need it), or `play-brief-resolve.ts` (correctly calls the now-fixed shared
mapper directly, no HTTP round-trip needed for a server-side Largo read).
