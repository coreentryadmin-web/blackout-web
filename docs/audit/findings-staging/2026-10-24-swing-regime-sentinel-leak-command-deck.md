# Command Deck "Regime" stat leaks the internal Banger-ledger sentinel as a fabricated live regime read

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Command Deck (`PlayTerminal.tsx`, `SwingCockpitStrip.tsx`) |
| **Found by** | Ask Largo standing mandate — deferred BMNR finding from the 2026-10-24 Largo fan-out audit, investigated and confirmed this cycle |

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

## Blast radius

Single call site (`terminalPlayFromHorizon`, `adapters.ts`) feeds both display consumers
(`PlayTerminal.tsx`, `SwingCockpitStrip.tsx`) — no separate fix needed in either component.
Confirmed via grep that no other `TerminalPlay.regime` consumer exists. 0DTE/Legacy/LEAPS
adapters never produce the Banger sentinel, so they are unaffected.

## Evidence

- RED→GREEN: new regression test in `adapters.test.ts` fails against pre-fix source
  (`banger.regime` returns `"BREAKOUT · BANGER"` instead of `null`), passes after.
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/adapters.test.ts`
  → 158/158 pass.
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/*.test.ts`
  → 458/458 pass.
- `npx tsc --noEmit` → clean.
