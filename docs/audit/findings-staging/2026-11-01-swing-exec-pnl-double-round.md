> **kind:** FINDING

## Night Hawk Swings / Ask Largo: Trough% and Exec P&L% disagree on the identical quote due to a double-rounding chain — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live audit of `GET /api/market/swing/play-brief` against production (real position
QXO, SWING positionId 2299, LONG 12C 2026-11-06), per the standing Ask Largo × Night Hawk Swings
ownership mandate (CLAUDE.md). Cross-checked against `GET /api/market/nighthawk/horizons` for the
same position (same session) and independently re-verified live (fresh Clerk temp-user session,
cleaned up in a `finally`) on 2026-11-01 before filing — the mismatch reproduces right now, not a
stale capture.

**Symptom:** the SAME play-brief markdown document rendered, a few lines apart, two different
percentages for the identical underlying fact (entry premium $0.22, current bid $0.10):
`Trough: **-54.5%**` and `Exec P&L: **-54.6%**` / `Executable P&L — mid -31.8% vs fill -54.6%`.
Both describe `(bid/entry - 1) * 100`; the raw value is -54.545...%, which should single-round to
-54.5% everywhere — instead the two lines disagreed by 0.1 percentage point.

**Root cause:** `executableFill()` (`src/lib/zerodte/terminal-ladder.ts`) pre-rounded its `pnl_pct`
field to 2 decimals-of-percent (`Math.round(((fill-entryPremium)/entryPremium)*10000)/100`) before
*any* caller ever formatted it for display. `adapters.ts`'s `troughDisplay`/`peakDisplay` compute
the identical kind of ratio with a **single** round straight to 1dp from the raw inputs. The
pre-rounded `pnl_pct` then got a **second** round (also to 1dp) from whichever renderer displayed
it — `fmtPct()` (`src/lib/fmt-money.ts`) in `src/lib/swing/play-brief.ts`'s "Exec P&L" line and
`src/lib/swing/play-brief-narrative-coaching.ts`'s `execSlippageCoaching()` "Executable P&L"
bullet. Two successive roundings of the same fact agree almost always — except when the first
round lands exactly on the second round's tie boundary, which is exactly what happened here:
`(0.10-0.22)/0.22*100 = -54.545...` single-rounds to **-54.5** (the Trough line's own math), but
pre-rounding to 2dp first lands on the *exact* tie **-54.55**, which `fmtPct`'s ties-away-from-zero
algorithm (its own documented 2026-10-26 sign-fix) then pushes to **-54.6** — one tenth of a point
off the mathematically identical fact. This is the same bug *class* as the already-fixed
2026-10-08 finding (`fmtPct`'s raw `toFixed` letting the structure-ladder UI double-round
`distancePct`) and violates the Largo Product Contract's C9 precision principle ("round exactly
once, at the model's tool boundary") — but that fix only touched `fmtPct`'s own single-vs-double-
round behavior and the structure ladder's route-level rounding; it never touched
`executableFill()`'s own pre-rounded `pnl_pct` field, which remained a separate, until-now-unfixed
site of the identical mechanism.

**Fix:** removed the internal pre-round from `executableFill()`'s `pnl_pct` — it now returns the
raw, unrounded ratio. The one legitimate round now happens exactly once, wherever this value is
finally rendered (`fmtPct` for the swing/LEAPS play-brief narrative, `toFixed(1)` for the Command
Deck's LEAPS `PnlPanel`, `roundFloats()` at the 0DTE board route's own wire boundary). `mid`/`fill`
(the dollar premiums) are unaffected — they still round to the cent via `round2()`, a legitimate,
*different* boundary (NBBO premiums are penny-quoted); only the percentage field, which is purely a
display/derived quantity, had the extra round removed.

**Why this fix and not an alternative:** the mismatch is a direct consequence of rounding the SAME
fact twice with two different algorithms/precisions. Changing `fmtPct`'s tie-breaking rule to match
whatever a single round happens to produce would not generalize (it would just move the tie
boundary, not eliminate the double round) and would re-diverge from the Trough/peak math's own
single-round formula on a different input. The only fix that eliminates the disagreement for every
input, not just this one, is to stop rounding twice.

**Evidence (RED → GREEN):** added a regression test to `src/lib/zerodte/terminal-ladder.test.ts`
reproducing the exact live numbers (entry $0.22, bid $0.10, ask $0.20 — QXO positionId 2299).
RED (pre-fix, via a temporary revert of just the `pnl_pct` line): `e.pnl_pct` was the pre-rounded
tie value `-54.55`, and the test's assertion that it be the raw unrounded ratio failed with
`expected the raw unrounded ratio, got -54.55`. GREEN (post-fix): `e.pnl_pct` is the raw ratio,
`fmtPct(e.pnl_pct)` renders `"-54.5%"`, matching the Trough line's own single-rounded math exactly.
Also updated one pre-existing test (`"executable: long sells into the BID, not the mid"`) that
asserted strict `pnl_pct === 20` — removing the internal round means IEEE-754 division of
`(2.4-2.0)/2.0` lands a hair off a clean 20 (`19.999999999999996`), so that assertion now uses a
`1e-9` tolerance, consistent with how every other float-sensitive test in this file already
asserts.

Test run (Node 20, `--experimental-test-module-mocks`):
- `src/lib/zerodte/terminal-ladder.test.ts`: 14/14 pass.
- Blast-radius sweep (same run): `src/features/nighthawk/command-deck/adapters.test.ts`,
  `src/lib/platform/zerodte-service.test.ts`, `src/lib/zerodte/marks-math.test.ts`,
  `src/lib/swing/play-brief.test.ts`, `src/lib/swing/play-brief-narrative-coaching.test.ts`,
  `src/lib/swing/play-brief-narrative.test.ts`, `src/lib/swing/play-brief-intel.test.ts`,
  `src/features/nighthawk/command-deck/use-live-marks.test.ts`,
  `src/features/nighthawk/command-deck/zerodte-sources.test.ts`: 1211/1211 pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20, `scripts/run-tests.mjs`): run as part of this PR's validation.

**Blast radius — other call sites of the SAME root cause:**
- `src/features/nighthawk/command-deck/adapters.ts` has TWO callers of `executableFill()`: the
  0DTE path (`terminalPlayFromZeroDte`, line ~573) and the shared SWING/LEAPS path
  (`terminalPlayFromHorizon`, line ~957, which is what the live QXO repro goes through). Both now
  carry the unrounded `pnl_pct` through to `TerminalPlay.execPnlPct` automatically — no separate
  edit needed at either call site.
- `src/features/nighthawk/command-deck/PlayTerminal.tsx`'s `PnlPanel` (`exec.toFixed(1)`, line
  ~910) reads `play.execPnlPct` straight off the SAME `terminalPlayFromHorizon` path (it serves the
  LEAPS horizon directly — `commandSinglePanel` routes ZERO_DTE/SWING to `ZeroDteCommandPanel`
  instead, which does not render `execPnlPct`). This was a second site of the identical
  double-round (pre-rounded `exec.pnl_pct` → a second round via plain `toFixed(1)`); it required no
  code change because it already does a single, correct round at display time — the double-round
  was entirely upstream, in `executableFill()`, and is fixed transitively by this PR.
- `src/lib/platform/zerodte-service.ts` computes the 0DTE board's own `live_pnl_pct_exec` field via
  `executableFill(...).pnl_pct` in two places (lines ~656, ~997). Verified this is **not** a
  regression for the 0DTE wire contract: `buildZeroDteBoardPayload()`'s `roundFloats()` call and
  the board route's (`src/app/api/market/zerodte/board/route.ts`) own `roundFloats(payload, 2,
  ZERODTE_BOARD_WIRE_DP)` pass both still round this field to 2dp at the wire boundary regardless
  of whether `executableFill()` pre-rounds internally — `live_pnl_pct_exec` is not in the
  `ZERODTE_BOARD_WIRE_DP` override map, so it falls through to the route's default dp=2. The
  client's own `adapters.ts` (0DTE path) prefers this server-rounded field (`fin(src.live_pnl_pct_exec)
  ?? exec.pnl_pct`) over a local recompute, so the 0DTE board's served precision is unchanged.
- **Found but deliberately NOT fixed here — a genuinely separate root cause, same bug class:**
  `src/features/nighthawk/command-deck/use-legacy-option-marks.ts` computes the Legacy horizon's
  own `execPnlPct` via `pinnedLivePnlPct(entryPrem, row.bid)` (`src/lib/zerodte/marks-math.ts`),
  which pre-rounds to 2dp with the *same* mechanism, independently of `executableFill()`. Its only
  display consumer found (`LegacyPlayManageRail.tsx`'s `formatPremiumPct` → `toFixed(0)`) rounds a
  second time, so the identical tie-boundary disagreement is structurally possible there too — but
  it is a different function with different callers, not "duplicated logic" of the bug this PR
  fixes, and touching the shared `pinnedLivePnlPct` (also read by SPX/Vector/Helix per
  `CLAUDE.md`'s own note on `DIRECTION_MIN_NET_PREMIUM`-adjacent shared constants) is a larger,
  cross-engine change out of scope for a single-issue PR. Flagging here for a future pass rather
  than silently leaving it undiscovered.

**Market-open validation:** the next live check of a Swing or LEAPS position's play-brief whose
Trough/peak or Exec P&L line lands near a `.x5` tie (not every position will — most ratios don't
land exactly on a 2dp tie) should show the two numbers agree. QXO positionId 2299 itself is the
best re-check candidate if still open.
