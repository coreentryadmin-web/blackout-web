> **kind:** FINDING

## Swing play-brief: a confirmed $0.00 bid silently collapsed to the same shape as "no quote at all," getting WEAKER risk disclosure than a comparable nonzero-low-bid position — FIXED

| **Status** | FIXED (PR #TBD, this branch) |
|---|---|

### Root cause

`executableFill()` (`src/lib/zerodte/terminal-ladder.ts`) is the single source of truth every
swing play's executable (bid-based) exit fill is derived from. Its gate —

```ts
const fill = validBook && bid > 0 ? round2(bid) : null;
```

— treats a genuine, confirmed **zero bid** (a real two-sided quote where the bid happens to be
exactly `$0.00` — no buyer at any price) IDENTICALLY to **no quote at all** (missing bid/ask,
one-sided book, or a crossed book). Both produce `fill: null`, `pnl_pct: null`. That collapse is
correct for `executableFill()` in isolation (there genuinely is no honest nonzero price to report
for either case, and the existing `terminal-ladder.test.ts` "one-sided / no book" test already
locks this null-for-zero-bid behavior in — this fix does not change it), but every downstream
consumer treated `execMark == null` / `execPnlPct == null` as pure absence ("we don't have a
quote, say nothing"), with no way to tell "we don't know" apart from "we know, and it's worthless."

Live repro: `GET /api/market/swing/play-brief?playId=SWING:EXPE:2071` — a real, live two-sided
quote (`bid: 0.00`, `ask: 1.20`, `mid: 0.60 = (0 + 1.20) / 2`, which passes the brief's own
"is this a real quote" backstop check and renders normally elsewhere in the same brief). Because
`exec.fill`/`exec.pnl_pct` were both `null`, three separate consumers all silently treated EXPE as
if it had no quote, when in fact it has the single WORST real executable state a position can be
in:

1. **`src/lib/swing/play-brief.ts` (~line 824, the "Exec P&L" line in `pnlSection()`)** —
   `if (play.execPnlPct != null) lines.push(...)` — null means the entire line vanishes with zero
   caveat. A member reading the brief sees no "Exec P&L" line at all, identical to a position with
   no live quote yet.
2. **`src/lib/swing/play-brief-intel.ts` (~line 2224, the Premium stop rail cushion logic in
   `watchForSection()`)** — `const executableCushionGone = execMark != null && execMark <= stop;`
   — null `execMark` makes this `false`, so the rail fell through to the `cushionBasis = play.mark`
   branch and rendered a falsely-reassuring **mid-based** cushion percentage, despite the position
   having zero real executable value.
3. **`src/lib/swing/play-brief-narrative.ts` (~line 1660, the "Break watch — stop already
   breached" bullet in `tradeManagerNarrativeSection()`)** — `const execBreached = execStop != null
   && play.execMark != null && play.execMark <= execStop;` — null `execMark` means this never
   fires, so the brief fell through to the softer, forward-looking "Break watch — lose premium
   stop $X → cut size or exit" framing instead of the reserved, always-surfaced "already breached"
   headline this exact bullet exists for (added via three prior historical fixes, 2026-09-15/
   2026-10-17, specifically to surface this severity).

Net effect: EXPE (bid $0.00, no buyer exists at any price) rendered **weaker** disclosure than a
comparable position with a nonzero-but-low bid — e.g. BLSH (bid $0.32), which correctly gets all
three: an "Exec P&L" line, a "no real cushion on the executable side" rail caveat, and the
"stop already breached on the executable side" bullet — despite EXPE being strictly worse.

### Evidence

Live repro: `GET /api/market/swing/play-brief?playId=SWING:EXPE:2071` — `bid: 0.00`, `ask: 1.20`,
`mid: 0.60`. Before this fix: no "Exec P&L" line in the Position section; Premium stop rail
rendered a mid-based cushion percentage with no "no real cushion" caveat; no "Break watch —
already breached" bullet in "Trade manager read," despite the executable side being worth nothing.

RED→GREEN proof (temporary local revert of the six source-only files — `terminal-ladder.ts`,
`types.ts`, `adapters.ts`, `play-brief-intel.ts`, `play-brief-narrative.ts`, `play-brief.ts` — back
to `HEAD`, test files left in place, byte-exact restore afterward confirmed via `diff`): the four
new regression tests (one per file below) each failed exactly as expected (`not ok`, 1 failure
each, every pre-existing test in each file still passing), then passed 13/13, 182/182, 331/331,
155/155 respectively once the fix was restored.

### Blast radius

- `src/lib/zerodte/terminal-ladder.ts` — `executableFill()`'s return type gains one new additive
  field, `bidConfirmedZero: boolean`. `fill`/`pnl_pct`/`mid` are byte-identical to before for every
  existing caller (confirmed: the only other call sites, `zerodte-service.ts` ×2, destructure only
  `.pnl_pct` and are unaffected by an added field).
- `src/features/nighthawk/command-deck/types.ts` — `TerminalPlay` gains one new optional field,
  `execBidZero?: boolean | null`.
- `src/features/nighthawk/command-deck/adapters.ts` — only the **swing/LEAPS adapter**
  (`terminalPlayFromHorizon`, the one the finding's live repro traced to) is wired to populate
  `execBidZero`, gated identically to the existing `execMark`/`execPnlPct` null-out
  (`WATCH`/`SKIP`/`CLOSED` → `null`). The sibling **0DTE adapter** (`terminalPlayFromZeroDte`) is
  deliberately left untouched — its `executableFill()` call site has no narrative/rail consumer
  that reads this distinction today, and widening it there is out of scope for this finding (the
  0DTE condor/ladder code reads `.fill`/`.pnl_pct` only, unaffected either way).
- Three narrative/rail consumers in the swing lane (`play-brief.ts`, `play-brief-intel.ts`,
  `play-brief-narrative.ts`) each gained a minimal, additive branch keyed on `play.execBidZero`,
  described above. No existing branch's condition or output changed for any play where
  `execBidZero` is `false`/`null` (confirmed: all pre-existing tests in all three files still pass
  unmodified).

### Fix rationale

`executableFill()` already had the one fact that distinguishes the two null-shaped cases —
`validBook` (a confirmed, valid two-sided quote) combined with `bid === 0` — it just never
surfaced it. Added `bidConfirmedZero: validBook && bid === 0` to its return value rather than
changing `fill`/`pnl_pct`, which stay `null` exactly as `terminal-ladder.test.ts`'s existing
"one-sided / no book" test already locks in (a long genuinely cannot be SOLD at $0, so there is
still no honest nonzero fill price to report — fabricating one, e.g. setting `execMark: 0`, would
make the stop/target-rail "basis" math downstream subtly wrong in a different way). Threaded the
new field through `TerminalPlay`/the swing adapter the same way `execMark`/`execPnlPct` already
are, then updated each of the three consumers to treat a confirmed zero bid as the **most severe**
state rather than an absence:

- `play-brief.ts`: a new `else if (play.execBidZero === true)` branch renders
  `"Exec P&L: **-100.0%** _(bid is $0.00 — no real buyer at any price; the executable exit is a
  total loss)_"` — mathematically exact regardless of entry price (`(0 − entry) / entry = -100%`
  for any positive entry), and carries the same open-runner/stale-quote qualifiers the normal
  branch already does.
- `play-brief-intel.ts`: `executableCushionGone` now also fires on `play.execBidZero === true`,
  routing EXPE into the exact same "no real cushion on the executable side" message a nonzero
  at/through-stop bid already produces — no new message string, just a wider trigger condition.
- `play-brief-narrative.ts`: introduced `execMarkForBreach = play.execBidZero === true ? 0 :
  play.execMark` so the existing `execBreached` check and its rendered bid value both treat a
  confirmed zero bid as `$0.00`, at/through any positive stop — again reusing the existing bullet,
  not inventing new copy.

Deliberately left unchanged: `executableFill()`'s own `fill`/`pnl_pct`/`mid` computation (locked in
by the existing zero-bid test); the 0DTE adapter call site (no consumer reads this distinction
there today); the "Premium target rail" room% block in `play-brief-intel.ts` (the finding's quoted
defect is specifically the stop-side cushion logic — the target-side room% block shares the same
`execMark`-preferred-over-mid shape but was not named in the finding's reproduction, so it is left
for a separate pass rather than widened here without its own live repro).

### Tests

- `src/lib/zerodte/terminal-ladder.test.ts` — extended the existing "one-sided / no book" test with
  two new assertions: `executableFill(0, 0.1, 2.0).bidConfirmedZero === true` (a real two-sided
  book with `bid === 0` is a CONFIRMED zero) and `executableFill(null, 2.6, 2.0).bidConfirmedZero
  === false` (no book at all must not be confused with a confirmed zero bid). 13/13 green.
- `src/lib/swing/play-brief.test.ts` — new test reproducing the exact EXPE shape
  (`entry: 0.95, mark: 0.6, execMark: null, execPnlPct: null, execBidZero: true`), asserting the
  Position section renders the `-100.0%` total-loss disclosure instead of silently omitting the
  Exec P&L line. 182/182 green.
- `src/lib/swing/play-brief-intel.test.ts` — new test (sibling of the existing NN#32 "no real
  cushion" regression test) with `execMark: null, execBidZero: true`, asserting the Premium stop
  rail still renders "no real cushion on the executable side" and never falls back to "cushion from
  current mark." 331/331 green.
- `src/lib/swing/play-brief-narrative.test.ts` — new test (sibling of the existing NN#32
  "already breached" regression test) with `execMark: null, execBidZero: true`, asserting the
  "Break watch — stop already breached on the executable side" bullet fires with `bid **$0.00**`
  rather than falling through to the forward-looking "lose premium stop" framing. 155/155 green.

RED→GREEN confirmed for all four files (one new failure pre-fix each, zero pre-existing
regressions, full green post-fix — exact counts above). `npx tsc --noEmit` clean (no errors).
