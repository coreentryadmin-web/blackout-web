# Ask Largo swing closed-play post-mortem — MFE capture renders a nonsensical negative percentage on a round-trip loss

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible, confusing/misleading number on a real production post-mortem, not a crash) |
| **Area** | Swing / Ask Largo closed-play "post-mortem" coaching (both the intel section and the narrative coaching layer) |
| **Files** | `src/lib/swing/mfe-capture.ts` (new), `src/lib/swing/mfe-capture.test.ts` (new), `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-narrative-coaching.ts`, plus their test files |

## Context

Found live during the standing Ask Largo × Night Hawk Swings ownership mandate's 5-engine
monitor cycle. Hit `GET /api/market/swing/play-brief` for two real CLOSED positions
(`SWING:AAPL:36`, `SWING:INTC:35`) and read the composed envelope. INTC:35's "Trade manager read"
section rendered:

> Exited **-40.8%** vs peak **+25.7%** **Gave back the move** — only **-158.9%** MFE capture;
> tighten at first trim rail next time.

"-158.9% MFE capture" has no honest reading as a percentage of anything — MFE (max favorable
excursion) capture is meant to answer "what fraction of the peak favorable move did the member
keep," a number that only makes sense in roughly the 0–100%+ range when the exit itself is still
a gain.

## Root cause

Both `lessonsSection` (`play-brief-intel.ts`) and `closedCoaching` (`play-brief-narrative-coaching.ts`)
independently computed the same fallback:
```ts
const capture = play.mfeCapturePct != null ? play.mfeCapturePct : play.peak > 0 ? (play.exitPnlPct / play.peak) * 100 : null;
```
`play.mfeCapturePct` is read from `src.mfe_capture_pct` in `terminalPlayFromHorizon`/
`terminalPlayFromClosedSwing` (`adapters.ts:591`), but grep across the codebase turns up **zero**
producers of `mfe_capture_pct` anywhere — the DB row (`SwingPositionRow`) has no such column, and
no builder ever sets it. So `play.mfeCapturePct` is always `null` in production today, and every
closed play always falls through to the ratio formula.

That formula is fine while the exit is still a gain (0 <= exit <= peak reads as "captured X% of
the move"). It silently stops making sense once the play **round-trips past breakeven into a
loss**: peak +25.7%, exit -40.8% divides to -158.9%, a number with no honest interpretation as a
"capture" of anything — the play didn't capture a negative fraction of its peak, it gave back the
entire gain and then lost more on top. This is a categorically different outcome (a round-trip),
not a worse point on the same capture scale, so forcing it through the capture language/formula
was always going to produce nonsense for any sufficiently large loss after a real peak.

## Fix

Extracted the shared math into a new pure helper, `mfeCaptureOutcome()` (`mfe-capture.ts`), used by
both call sites (this bug was duplicated verbatim in two files — the same class of duplication
this mandate has flagged before in review, just self-inflicted this time). It returns a tagged
union:
- `{ kind: "capture", capturePct }` when `mfeCapturePct` is explicitly supplied (future-proofing
  for when that field actually gets wired up), or when the fallback ratio applies to a non-negative
  exit.
- `{ kind: "round_trip", peakPct, exitPnlPct }` when the exit is negative despite a positive peak —
  the play round-tripped past breakeven, and the two call sites now render an honest, specific
  sentence ("Round-tripped past breakeven — was up +X% at peak, closed at -Y%") instead of forcing
  the ratio through the "MFE capture: N%" phrasing.
- `null` when there isn't enough data to say anything (no peak, or peak <= 0).

## Evidence (RED → GREEN)

New `mfe-capture.test.ts` (5 tests) unit-tests the helper in isolation, including the exact
reproduced production numbers (peak 25.7, exit -40.8).

`git stash` on the two consumer files (`play-brief-intel.ts`, `play-brief-narrative-coaching.ts`)
alone, keeping the new tests and the new `mfe-capture.ts` file in place → both new regression
tests **fail** on the exact live output (`'Exited **-40.8%** vs peak **+25.7%** **Gave back the
move** — only **-158.8%** MFE capture...'`), confirming the tests actually catch the bug rather
than passing vacuously. Restored → **24/24 pass** across
`play-brief-intel.test.ts`/`play-brief-narrative-coaching.test.ts`/`mfe-capture.test.ts`.
`tsc --noEmit` clean. Full `npm test` (Node 20): **12903/12903 pass, 0 fail, 3 skipped**.

## Blast radius

- Both call sites that computed this ratio (`lessonsSection` in `play-brief-intel.ts`,
  `closedCoaching` in `play-brief-narrative-coaching.ts`) — confirmed via grep these are the only
  two places `mfeCapturePct`/`peak`/`exitPnlPct` are combined this way; `play-brief.ts:111` only
  ever prints the raw `mfeCapturePct` field directly (no ratio fallback), so it was never affected
  (it just prints nothing today since the field is always null).
- No schema/API shape change — `TerminalPlay.mfeCapturePct` is untouched; this only changes how the
  two coaching functions interpret it when absent.

## Fix rationale — what was deliberately left unchanged

- Did not attempt to wire up a real `mfe_capture_pct` producer (DB column + write path) in this PR —
  that is a separate, larger change (schema migration, a write-time computation, a backfill
  decision for existing closed rows) and out of scope for a rendering-correctness fix. The new
  helper already prefers a real `mfeCapturePct` when one is supplied, so wiring one up later needs
  no further change here.
- Did not change the existing capture-based thresholds (`>= 75` strong discipline, `< 35` gave back,
  `35–75` partial) — those are unaffected; they still fire correctly for every non-negative exit.
