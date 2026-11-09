# Command Deck verdict-band P&L badge shows raw open-runner P&L for a TRIM swing position instead of Ask Largo's own blended figure

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-visible, materially misleading headline number on live committed positions |
| **Horizon** | Night Hawk Swings (Command Deck, shared `ZeroDteCommandPanel.tsx`) |
| **Found via** | Live 5-engine audit, confirmed + adversarially verified, 2026-11-09 |

## Summary

The Command Deck's primary headline P&L badge (the verdict-band pill, shared between `ZERO_DTE`
and `SWING` horizons — both route through `ZeroDteCommandPanel.tsx`, per
`PlayTerminal.tsx:264`'s own `commandSinglePanel` comment) showed the raw, unblended live P&L on
the still-open runner leg for a SWING/Banger position that had already banked a partial trim —
with zero qualifier — even though Ask Largo's own play-brief for the identical position already
computes and discloses the correct blended figure.

Live repro: SWING positionId 2397 (APP, `liveStatus:'TRIM'`, entry $17.34, mark $98.00) showed
`livePnlPct=465.2` on the Command Deck/horizons route, while the same position's play-brief
showed `P&L: +465.2% (open runner only...)` / `Blended P&L: +282.6%` / `Banked: 50% @ +100%
($34.68)`. 8 of 40 live committed SWING positions shared this exact TRIM state at audit time
(HLF/2473, WEN/2467, MOS/2431, U/2409, APP/2397, REPL/2383, U/2363, APP/2355).

## Root cause

1. `src/lib/swing/live-plays.ts` — `livePnlPct(entry, mark)` is a plain mechanical
   `(mark/entry-1)*100`, computed identically regardless of trim state. Served as
   `src.livePnlPct` from `GET /api/market/nighthawk/horizons`.
2. `src/features/nighthawk/command-deck/adapters.ts`'s `terminalPlayFromHorizon` — the final
   `TerminalPlay.pnlPct` is `fin(src.exitPnlPct)` for CLOSED, `null` for WATCH/SKIP, and
   otherwise (OPEN/HOLD/**TRIM**) `livePnl ?? exec.pnl_pct` — the raw figure, unblended, for
   exactly the TRIM bucket.
3. `src/features/nighthawk/command-deck/ZeroDteCommandPanel.tsx` — `const pnlPct = isClosed ?
   realizedPct : play.pnlPct;`. A 2026-10-24 fix already special-cased CLOSED rows (routing them
   through `closedRealizedPct`, which already does the trim-scale blend for a closed position),
   but never extended the same treatment to a still-open TRIM row. This value feeds the
   verdict-band badge directly, with no qualifying text anywhere on the card.
4. Contrast: `src/lib/swing/play-brief.ts`'s `blendedPnlPct` (called from `pnlSection`)
   independently computes the identical blend for the identical position and renders both the
   raw runner-only line (qualified: "open runner only — trim already banked, see below") and a
   separate "Blended P&L (realized trim + open runner)" line. That logic lived ONLY in
   play-brief.ts; the Command Deck panel never reached it.

## Fix

**Option B chosen** (fix narrowly inside `ZeroDteCommandPanel.tsx`'s own `pnlPct` derivation,
parallel to the existing `isClosed` special-case) over Option A (changing `TerminalPlay.pnlPct`
at the adapter source). A repo-wide grep of `.pnlPct` consumers showed `play-brief.ts`/
`play-brief-narrative*.ts`/`thesis-health.ts` (all fed by the SAME `terminalPlayFromHorizon`
output via `play-brief-resolve.ts`) read `play.pnlPct` as the raw runner-only figure, on the SAME
basis as `play.peak`/`play.trough` (which are never blended), for MFE/giveback/round-trip/
thesis-health math. Changing `TerminalPlay.pnlPct` itself to the blended value for TRIM rows
would have silently mismatched it against those still-unblended peak/trough watermarks across a
dozen+ call sites, and would have double-blended play-brief.ts's own already-correct
`blendedPnlPct` (which reads `play.pnlPct` as its raw input). Fixing at the display layer only,
mirroring the exact precedent the 2026-10-24 CLOSED-row fix already set in this same file, keeps
the blast radius to the one place the bug was confirmed.

Extracted the blend arithmetic to a new shared function, `blendedTrimPnlPct` in
`src/lib/zerodte/terminal-ladder.ts` (a dependency-free leaf already imported by both
`play-brief.ts` and `adapters.ts`/`ZeroDteCommandPanel.tsx`), so the Command Deck panel does not
re-derive the formula from scratch. `play-brief.ts`'s own `blendedPnlPct` is deliberately left as
its own separate copy (not refactored to delegate) — that function's null-vs-throw boundary on a
malformed `exitPolicy.trim_levels` is load-bearing for a different reason (an existing error-
boundary test requires it to THROW on malformed input so `composeSwingPlayBrief` can catch it and
omit just the "Position" section); the new shared function deliberately never throws, since a
React render path has no equivalent per-section error boundary. Verified both compute the
identical formula on well-formed input via matching test fixtures in both files.

The fix is scoped to `play.horizon === "SWING"` only, not every TRIM row generically: a 0DTE
TRIM row's `pnlPct` is sourced through a different server-side path
(`reconcileLedgerLivePnlPct`/`marks-math.ts`) not audited here, so blending it on top of
whatever that path already does would risk an unmeasured double-blend. `blendedTrimPnlPct`
itself additionally no-ops (returns null, falling back to the raw figure) whenever nothing has
actually fired yet, so a fully-OPEN/HOLD swing position is provably unaffected, as is WATCH/SKIP
(pnlPct already null) and CLOSED (handled earlier in the same ternary, unconditionally).

## Blast radius

- `src/lib/zerodte/terminal-ladder.ts` — new exported pure function `blendedTrimPnlPct`, no
  existing exports changed.
- `src/features/nighthawk/command-deck/ZeroDteCommandPanel.tsx` — one new `const`, one changed
  line (`pnlPct` derivation). `managementFor`'s `progress` output (also fed by this `pnlPct`
  variable) is unaffected for SWING: `progress` is only non-null when `exitModel === "RATCHET"`,
  and SWING always has `exitModel: "SCALE_OUT"` (adapters.ts), so the blend change has no visible
  effect beyond the verdict-band badge itself. The `badge`/`recNote` recommendation text for
  SWING already prefers `play.recommendation`/`play.recNote` (stamped independently in
  adapters.ts) over this component's own `mgmt.recommendation`, so those are unaffected too.
- No change to `src/lib/swing/play-brief.ts`, `src/lib/swing/live-plays.ts`, or any server route —
  this is a pure display-layer fix.

## Evidence (RED → GREEN)

- New tests: `src/features/nighthawk/command-deck/ZeroDteCommandPanel.test.ts` (5 new cases) and
  `src/lib/zerodte/terminal-ladder.test.ts` (4 new cases for the new pure function).
- RED proof (plain file-copy backup/restore of the two touched source files, not `git stash`):
  reverting `ZeroDteCommandPanel.tsx` and `terminal-ladder.ts` to their pre-fix contents and
  re-running `ZeroDteCommandPanel.test.ts` fails exactly the new TRIM-blend assertion
  (`actual: '+465.2%'`, `expected: '+282.6%'`) while the sibling OPEN/CLOSED/no-exit-policy/
  ZERO_DTE-scope assertions in the SAME new `describe` block all pass pre-fix — proving the new
  test suite correctly isolates the TRIM case and that the fix is additive, not a rewrite.
- GREEN after restoring the fix: 14/14 in `ZeroDteCommandPanel.test.ts`, 18/18 in
  `terminal-ladder.test.ts`.
- `nighthawk/**` + `lib/swing/**` + `lib/zerodte/**` together: 2355/2355 pass, 0 fail (Node 20).
- `npx tsc --noEmit`: clean.

## Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` for the next-session RTH checklist entry: re-check the
live committed SWING book for any `liveStatus:'TRIM'` position and confirm the Command Deck
verdict-band badge now matches that position's Ask Largo play-brief "Blended P&L" line (not the
play-brief's separate, still-correctly-raw "P&L: ... (open runner only)" line).
