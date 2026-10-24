# Command Deck AND the Largo swing play-brief both leak the internal Banger-ledger sentinel as a fabricated live regime read

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Command Deck (`PlayTerminal.tsx`, `SwingCockpitStrip.tsx`) AND the Largo swing play-brief narrative (`whyThisSetupSection`, `play-brief-intel.ts`) |
| **Found by** | Ask Largo standing mandate — deferred BMNR finding from the 2026-10-24 Largo fan-out audit, investigated and confirmed this cycle |

**Confirmed live** (pulled `GET /api/market/swing/play-brief?playId=SWING:BMNR:1974&expandIntel=1`
against prod, 2026-10-24 ~21:15 UTC — the real BMNR position, before this fix deployed): the
envelope's own markdown narrative read, verbatim, `**Today's regime read:** BREAKOUT · BANGER` —
the exact live repro the deferred finding named. This is a SECOND, independent rendering of the
same sentinel, in the Largo play-brief pipeline rather than the Command Deck UI. Also confirmed
via `GET /api/market/nighthawk/horizons?view=swings`: of 93 currently-committed Swing rows, 90
carry this exact sentinel as their `regime` field (see the PR's own comment thread for the full
count).

## Symptom

Live repro BMNR: the Command Deck's Swing cockpit header showed a top-level "Regime" stat
reading `BREAKOUT · BANGER`, which reads as a current market-regime characterization for the
whole Swing lane. The same literal string also rendered under "Regime" in the per-position
play-detail panel (`PlayTerminal.tsx`) for any Banger-origin position.

`BREAKOUT · BANGER` is not a market regime at all — it is `BANGER_LEDGER_REGIME_LABEL`
(`banger-lane-merge.ts`), an internal sentinel `horizonPlayFromBangerPosition` stamps on every
Banger-origin ledger row to mean "no real per-position dossier exists for this play." Per
CLAUDE.md's own count, 78/81 of the live committed Swing book is Banger-origin, so this was the
dominant rendered state of both surfaces, not an edge case.

## Root cause

Every OTHER consumer of this exact sentinel already treats it as an internal fingerprint, never
a display value:
- `thesisHealthUncalibrated()` (`thesis-health.ts`) withholds the aggregate Thesis Health score.
- `watchForSection` (`play-brief-intel.ts`) suppresses a fabricated "Thesis intact" line.
- `attachThesisExplanation` (`serving-lane.ts`) refuses to let a fresh ticker-keyed dossier
  overwrite the sentinel.
- `terminalPlayFromHorizon`'s own `thesisBreakResolved` (`adapters.ts`) suppresses the derived
  thesis-break level to `"unknown"`.

`TerminalPlay.regime` itself was the one field that never got this treatment:
`regime: src.regime ?? null` forwarded the raw sentinel straight through with no guard. From
there:
- `PlayTerminal.tsx:575` renders `play.regime` verbatim under the label "Regime".
- `SwingCockpitStrip.tsx:42` picks `plays.find((p) => p.regime)?.regime` — the first play in the
  WHOLE Swing book with any truthy `regime` — and renders it as a single lane-level "Regime"
  cockpit stat. With the book dominated by Banger-origin rows, this arbitrary pick is very likely
  to resolve to the sentinel, mischaracterizing the entire lane's regime read.

A sibling test (`adapters.test.ts`, "horizon adapter: Banger-origin thesisLevel:'intact' is
suppressed...") already constructed a Banger-origin fixture with `regime: "BREAKOUT · BANGER"`
and asserted the derived `thesisBreak` was suppressed — but never asserted what `TerminalPlay.regime`
itself resolved to, leaving this exact gap uncovered.

## Fix

`terminalPlayFromHorizon` now computes a `regimeForDisplay` value immediately beside the
existing `thesisBreakResolved` guard: `src.regime === BANGER_LEDGER_REGIME_LABEL ? null :
(src.regime ?? null)`. The returned `TerminalPlay.regime` uses `regimeForDisplay`; the raw
`src.regime` (still carrying the sentinel) is passed unchanged into `computeSwingThesisHealth`
a few lines above, which needs to see the sentinel to correctly withhold its own aggregate score.

With the fix: a Banger-origin row's `TerminalPlay.regime` is `null` (nothing renders under
"Regime" in the play-detail panel), and `SwingCockpitStrip`'s lane-level pick skips past it to
the first row with a real regime value, or renders nothing if none exists — an honest omission
instead of a fabricated characterization.

The swing play-brief pipeline (`play-brief-resolve.ts`) always builds its `TerminalPlay` via the
SAME `terminalPlayFromHorizon`, so this one fix also closes the Largo narrative leak end-to-end —
confirmed with a direct unit-level repro (`terminalPlayFromHorizon` → `whyThisSetupSection`)
before writing the second fix below. `whyThisSetupSection`'s own `**Today's regime read:**` line
(`play-brief-intel.ts:266`) additionally gets its own explicit sentinel guard, defense-in-depth,
matching every other consumer of this exact sentinel already in that file
(`bangerOriginNoRealThesis`/`reviewedIsBangerOrigin`) — this file's own `attachThesisExplanation`
double-call history (serving-lane.ts) already proved an upstream-only fix point can be bypassed
by a future caller that doesn't route through the adapter.

## Blast radius

Two fix points, one root cause:
- `terminalPlayFromHorizon` (`adapters.ts`) feeds both Command Deck display consumers
  (`PlayTerminal.tsx`, `SwingCockpitStrip.tsx`) AND the swing play-brief pipeline's `play` object
  (`play-brief-resolve.ts`) — no separate fix needed in any of the three.
- `whyThisSetupSection` (`play-brief-intel.ts`) gets its own redundant guard as defense-in-depth.

Confirmed via grep that no other `TerminalPlay.regime` consumer exists. 0DTE/Legacy/LEAPS
adapters never produce the Banger sentinel, so they are unaffected.

## Evidence

- RED→GREEN (Command Deck adapter): new regression test in `adapters.test.ts` fails against
  pre-fix source (`banger.regime` returns `"BREAKOUT · BANGER"` instead of `null`), passes after.
- RED→GREEN (Largo narrative): new regression test in `play-brief-intel.test.ts` fails against
  pre-fix source with the EXACT live repro string (`**Today's regime read:** BREAKOUT · BANGER`
  present in the rendered section body), passes after.
- Live confirmation: `GET /api/market/swing/play-brief?playId=SWING:BMNR:1974&expandIntel=1`
  against prod showed this exact string in the live markdown before the fix; `GET
  /api/market/nighthawk/horizons?view=swings` showed 90/93 currently-committed Swing rows
  carrying the sentinel as their raw `regime` field.
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/adapters.test.ts`
  → 158/158 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts src/features/nighthawk/command-deck/*.test.ts`
  → 1609/1609 pass.
- `npx tsc --noEmit` → clean.
