> **kind:** FINDING

## Ask Largo swing play-brief's "Premium stop rail" cushion ignored the real executable (bid) price — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`watchForSection`'s "Premium stop rail" cushion percentage (`play-brief-intel.ts`, lines ~729-757)
computes `(mark − stop) / mark` off `play.mark` — the MID price — whenever it is a positive number
above the stop and not the true entry-fallback echo (`optionMarkGenuinelyUnknown`, an earlier fix
the same day for an adjacent edge case). It never checks `play.execMark`, the field
`TerminalPlay` already carries specifically to be "the honest, bid-side/executable realizable
price... Null without a live two-sided book" (`command-deck/types.ts`). A wide bid/ask spread — the
normal case for a lower-liquidity option a few weeks from expiry — means the mid can sit
comfortably above the stop while the price a member could actually sell into (the bid) has already
fallen to or through it. The cushion percentage is a safety-margin claim; computing it from the mid
alone overstates that margin exactly when it matters most (a position already under pressure,
heading toward its stop).

### Live repro (2026-09-12, real operator conversation, real NN position, positionId 32)

Surfaced directly while answering a live operator question about managing a real, currently-held
swing position (NN, 13 DTE $15 call). The position's real numbers at the time: `mark` (mid) $1.10,
`exitPolicy.stop_premium` $0.78, `execMark` (bid) $0.70 — already **below** the stop. The pre-fix
brief rendered:

> Premium stop rail: **$0.78** — 29% cushion from current mark — thesis breaks if mark closes below

A confident 29%-cushion claim on a position whose actual fillable price had already breached the
stop. The same envelope's own `execPnlPct` figure (already shown elsewhere in the brief,
-64.1%) is arithmetically consistent with `execMark` $0.70 vs entry $1.95 — the execMark data was
already there and already correct; this cushion line was simply the one place that didn't consult
it.

### Fix

Added an `execMark`-based guard: when `play.execMark` is known and already at or below the stop
(`executableCushionGone`), the cushion percentage is omitted and replaced with an explicit
"no real cushion on the executable side (bid already at/through this level)" note. The dollar stop
level itself is unchanged and always shown regardless — only the percentage changes. When
`execMark` is unavailable or still comfortably above the stop, behavior is byte-identical to before
(verified by a second new test using `execMark: 1.0` against the same $0.78 stop, which still
renders the normal 29% cushion line).

### Blast radius

Single function (`watchForSection`), single computed value (`cushionPct`/`cushionNote`), only
reached when `bucket === "open"` and `play.exitPolicy?.stop_premium != null`. No other call site
computes this cushion.

### Fix rationale

Considered gating the entire "Premium stop rail" line off `execMark` availability instead of adding
a third state, but that would silently drop a real, useful dollar level whenever `execMark` happens
to be null (e.g. no live two-sided book yet) — worse than today for that case. Instead, the fix adds
the narrowest possible additional guard: only the specific case where the executable price has
already crossed the stop gets a different sentence; every other case (no execMark data, execMark
still healthy) is untouched.

### Evidence of testing

- Two new tests in `play-brief-intel.test.ts` (immediately before the existing 2026-09-11
  catalysts-timing test block): one reproduces the exact NN-shaped case (`mark: 1.1, execMark: 0.7,
  stop_premium: 0.78`) and asserts the "no real cushion" note replaces the percentage; a sibling
  test (`execMark: 1.0`) asserts the normal 29%-cushion line is unaffected when the executable price
  is still healthy.
- RED confirmed pre-fix: 112/113 pass, the new "no real cushion" test failing with the actual
  rendered text `"...$0.78** — 29% cushion from current mark..."` (exactly reproducing the live NN
  bug).
- GREEN post-fix: 113/113 pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): pending at time of writing this doc — see PR for final count.

Found live, directly through a real operator conversation managing a real tracked swing position
(NN, positionId 32) — not a mechanical re-audit pass. Standing Ask Largo × Night Hawk Swings
ownership mandate (CLAUDE.md).
