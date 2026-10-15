## Ask Largo swing play-brief: MFE capture can read above 100% ("captured 101.4% of peak") on real closed positions — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `mfeCaptureOutcome` (`src/lib/swing/mfe-capture.ts`) computes the ratio-fallback
capture percentage as `(exitPnlPct / peak) * 100` with no upper bound. `exitPnlPct` is read straight
off the DB's own `exit_pnl_pct` column; the displayed `peak` is a **different derivation** of
conceptually the same quantity — `adapters.ts`'s `peakDisplay`:
`Math.round(((peakPremium / entry - 1) * 100) * 10) / 10`, a 1dp-rounded ratio off the raw premium.
The two percentages describe the same underlying fact through two different computation paths and
can disagree by a fraction of a point even though `exitPnlPct` is, by construction, always one of
the samples `peak` was latched from — the identical watermark invariant `play-brief.ts`'s own
`pnlForDisplay`/`peakForDisplay` guard states explicitly ("the current mark IS one of the samples
peak/trough were latched from, so ... pnlPct always lies inside [trough, peak] by construction").
Capture can never legitimately exceed 100%; any computed excess here is a rounding/precision
artifact, never a real move past the position's own recorded high.

This is the exact gap flagged, but deliberately left unfixed as out-of-scope, by this same session's
earlier `2026-10-15-swing-play-brief-peak-trough-bracket-guard.md` finding (PR #6029): *"on the SAME
live ENOV data this would compute `capturePct = (560/550)*100 = 101.8%` ... Left unchanged ...
flagging it here for blast-radius completeness ... not fixing it, since it's a different section
computing a different ... output."* This finding closes that gap.

**Evidence.** Pulled `GET /api/market/swing/record?days=365` live (2026-10-15) and replicated
`adapters.ts`'s exact `peakDisplay` formula against every `closedDeck` row (52 closed positions in
the 365-day window). Two real, currently-public positions violate the bracket:

- **ORCL** positionId 9: entry 9.03, peakPremium 9.15 → peakDisplay **1.3**, exitPnlPct **1.39**
  (ratio capture 106.9%)
- **NOW** positionId 21: entry 11.6, peakPremium 11.8 → peakDisplay **1.7**, exitPnlPct **1.72**
  (ratio capture 101.4%)

Confirmed live against the real play-brief API
(`GET /api/market/swing/play-brief?playId=SWING:NOW:21&positionId=21&ticker=NOW&status=CLOSED&expandIntel=1`).
Before this fix, production rendered verbatim, to real members:

```
Exited **+1.7%** vs peak **+1.7%**
**Strong discipline** — captured **+101.4%** of peak; replicate trim timing.
...
MFE capture: **+101.4%** of peak move
```

Not just odd phrasing — a literally impossible claim (capturing more than 100% of your own peak),
rendered in the exact sections (`closedCoaching` / `lessonsSection`) built to teach correct
trade-management lessons.

**Blast radius.** `mfeCaptureOutcome` is the single shared function all 5 call sites read from:
`play-brief-narrative.ts`'s live-giveback bullet (open-play "Gave back X%" line, two call sites
including the TRIM-rail round-trip guard), `play-brief-intel.ts`'s Hold-plan giveback bullet (open)
and closed-play Lessons section, and `play-brief-narrative-coaching.ts`'s `closedCoaching` verdict
line. Fixing the shared function fixes every one of them at once. Checked every test file for the
five call sites (`play-brief.test.ts`, `play-brief-intel.test.ts`, `play-brief-narrative.test.ts`,
`play-brief-narrative-coaching.test.ts`, `thesis-health.test.ts`) for any assertion of an
over-100% capture value — none exists, so the clamp introduces no regression against existing
expectations.

**Fix rationale.** Clamp the ratio-fallback branch to `Math.min(100, (exitPnlPct / peak) * 100)`.
Deliberately left unchanged: the authoritative `mfeCapturePct` branch (server-supplied, currently
never populated per the file's own header comment — dead code in production today; a future real
overshoot there would need its own investigation, not a blind clamp copied from the ratio branch);
the `round_trip` outcome kind (negative exits — already a distinct, correctly-handled branch); and
every normal (non-overshoot) capture computation, which the clamp cannot affect (verified by the
pre-existing "positive exit falls back to the exit/peak ratio" test, unchanged and still passing).

**Evidence of no regression.** New regression test in `mfe-capture.test.ts`: RED before the fix
(live ORCL repro asserted `capturePct === 100`, actual `106.92...`), GREEN after, plus a
big-overshoot case, an exact-at-peak boundary case, and confirmation normal captures are untouched.
`src/lib/swing/{play-brief,play-brief-intel,play-brief-narrative,play-brief-narrative-coaching,
thesis-health}.test.ts` (691 tests): all pass. Full `npm test` (Node 20, `scripts/run-tests.mjs`):
16067 pass / 0 fail / 3 skipped. `npx tsc --noEmit`: clean.
