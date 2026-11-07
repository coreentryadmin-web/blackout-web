> **kind:** FINDING

## 2026-11-07 — Ask Largo: `execSlippageCoaching` divided the bid/ask dollar gap by ENTRY premium, not the current MARK — overstated real slippage by up to ~5.6x on big winners — FIXED

| **Status** | FIXED on `fix/swing-exec-slippage-wrong-denominator` |
| --- | --- |

**Symptom (live-confirmed, APP SWING:APP:2397 OPEN/TRIM, +465% runner):** the swing play-brief's
"Trade manager read" rendered:

> **Executable P&L** — mid **+465.2%** vs fill **+439.8%** (**-25%** slippage). Size exits on the
> bid, not the mark.

The underlying real quotes on the SAME payload: Entry $17.34, Mark (mid) $98.00, bid $93.60. The
REAL bid/ask friction a member would pay crossing the spread right now is
`(98.00 − 93.60) / 98.00 ≈ 4.49%` — not 25%. A member sizing an exit off this bullet would believe
they were giving up a quarter of the position's value to the spread when the real cost was under a
nickel on the dollar.

**Root cause:** `execSlippageCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) computed
`gap = mid% - exec%`, where `mid%`/`exec%` (`play.pnlPct`/`play.execPnlPct`) are both
ENTRY-denominated returns: `(price - entry) / entry * 100`. Algebraically,
`gap = (mark - execMark) / entry * 100` — the same dollar bid/ask gap divided by the tiny original
entry premium instead of by the current mark. The distortion factor is `mark / entry`
(`98.00 / 17.34 ≈ 5.65×` on this live play), so the bullet is wrong in direct proportion to how good
the trade already is — worst exactly on the best-performing runners, where a member most needs an
accurate read of real exit friction, not least on marginal trades. The suppression threshold
(`Math.abs(gap) < 5`) was applied to this same inflated quantity, so it filtered almost nothing on a
real winner while still gating correctly on flat/losing positions where `mark ≈ entry`.

This is distinct from the already-FIXED 2026-10-25 finding (FINDINGS.md), which added a
staleness caveat to this exact bullet but never touched the `gap = mid - exec` calculation or the
"% slippage" label — that fix's own live repro (MRNA, gap ≈ 11pp) had a much smaller `mark/entry`
ratio, so the distortion was present but far less visible there.

**Fix:** `TerminalPlay` already carries the raw dollar quotes this bullet needs —
`play.mark` (mid) and `play.execMark` (the tradable bid/ask fill) — for exactly this purpose.
Compute real slippage directly off them: `slippagePct = |mark - execMark| / mark * 100`. The sign
(+/-) still comes from comparing the position's own already-direction-aware `exec%` against
`mid%` (unchanged, direction-safe for both LONG and SHORT), only the magnitude's denominator
changed. `mid%`/`exec%` stay in the sentence as context — they no longer feed the slippage
arithmetic. Honest-absence discipline: if either `mark` or `execMark` is unavailable, the function
now returns `null` (no bullet) rather than fabricating a number from the entry-denominated
percentages alone, since that is exactly the computation this fix removes.

**Blast radius:** `execSlippageCoaching` only — one function, one call site
(`play-brief-narrative-coaching.ts`'s bullet-collection pass, unchanged). No other coaching
function reads `pnlPct`/`execPnlPct` this way; grepped for the same `mid - exec` shape elsewhere in
the file and found none.

**Evidence:**
- Live repro (APP SWING:APP:2397, prod, 2026-11-07): real spread 4.49%, old formula reported -25%.
- RED→GREEN proven via `git stash` on just the source fix (test changes kept): the two existing
  `execSlippageCoaching` tests were updated to carry real `mark`/`execMark` fixtures (previously
  they only set `pnlPct`/`execPnlPct`, which is exactly how the bug went unnoticed — there was no
  test exercising the real-dollar-quote path at all), and three new regression tests were added:
  (1) the live APP numbers now correctly produce **no bullet** (real spread under the 5% floor);
  (2) a genuinely wide real spread (8.16% → "-8%") renders with the correct magnitude, not the old
  formula's ~46pp; (3) honest absence — no `mark`/`execMark` means no fabricated number. All three
  new tests FAIL against the pre-fix formula (confirmed) and PASS after the fix.
- Full `play-brief-narrative-coaching.test.ts` file: 206/206 pass post-fix.
- `npx tsc --noEmit` clean (repo-wide).
- Full `npm test` run before merge.

Found via the standing "5-ENGINE LIVE MONITOR + Ask Largo" deep-dive mandate (CLAUDE.md).
