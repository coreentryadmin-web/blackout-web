## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] Four more play-brief render sites display a stale/closed-market snapshot with no disclosure caveat, while a sibling line on the identical snapshot already carries one — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief "Position" section (`pnlSection`, `src/lib/swing/play-brief.ts`); "What to watch" section (`watchForSection`, `src/lib/swing/play-brief-intel.ts`); "Trade manager read" (`actionNarrative`, `src/lib/swing/play-brief-narrative.ts`) and "Hold plan" (`holdPlanSection`, `src/lib/swing/play-brief-intel.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — adversarially-verified parallel correctness sweep, 2026-10-25 (same bug CLASS as the previously-shipped PR #6726 Exec P&L fix and PR #6731 structural-node fix — this batch is three further, independently-reachable instances) |
| **Status** | FIXED (PR #TBD, this branch) |

### Shared pattern

All three findings below are the identical defect shape: a rendered value sits directly beside a
sibling value that already carries a staleness/market-closed disclosure caveat for the exact same
underlying data snapshot, but the first value's own render path never threads the already-computed
caveat through. Each is fixed by reusing the shared helper the sibling line already calls
(`optionMarkStaleCaveat`/`closedMarketSessionNote`, both `play-brief-absence.ts`), not by
re-deriving a second copy of the staleness logic.

### Finding 1 — PANW: Peak/Trough premium-watermark lines render with zero staleness disclosure

**Symptom.** Live repro, a real PANW swing play-brief (`GET /api/market/swing/play-brief?playId=
SWING:PANW&ticker=PANW&expandIntel=1`), "Position" section:

```
Mark: **$19.45** (2026-10-23 16:00 ET) _(stale)_
P&L: **+9.9%** _(stale — same quote Mark flagged above)_
Peak: **+9.9%**
Trough: **-5.2%**
Greeks: ... _(stale — same quote Mark flagged above)_
Spread: ... _(stale — same quote Mark flagged above)_
Exec P&L: **+4.0%** _(stale — same quote Mark flagged above)_
```

Peak/Trough are the only two quote-derived lines in the block with no staleness qualifier.

**Root cause.** `peak_premium`/`trough_premium` are DB watermarks ratcheted `GREATEST`/`LEAST` on
the same live-tick cadence as `last_mark` (`db.ts`), so whenever the mark freezes/goes stale,
Peak/Trough are equally frozen/unverified. `pnlSection` already computes `const staleCaveat =
optionMarkStaleCaveat(play, readMs);` and appends it to the P&L line (and, per the prior PR #6726
fix, to Greeks/Spread/Exec P&L) — but the Peak (`fmtPct(peakForDisplay)`) and Trough
(`fmtPct(troughForDisplay)`) lines a few lines later never consulted it, only the
`markGenuinelyUnknown` gate deciding between "—" and a value.

**Fix.** Appended the same `staleCaveat` to the Peak and Trough lines, guarded the same way the
existing lines are: only in the non-`markGenuinelyUnknown` branch, so this never doubles up with
the distinct "(no live tick yet)" wording that branch already renders for a position that has never
received a live tick.

### Finding 2 — CRWD: "Reclaim/Lose gamma flip" bullet renders with no market-closed caveat

**Symptom.** Live repro, a real CRWD swing play-brief, "What to watch" section: `Reclaim gamma flip
**265.76** (2.8% away) — needed to restore dealer support for longs` — no caveat, even though
`envelope.levels[]` tags that same 265.76 gamma-flip level's provenance with `market_session_note:
"Computed 8s ago, but the market is CLOSED..."`.

**Root cause.** `watchForSection`'s gamma-flip bullet and its "Structural support/resistance node"
sibling bullet both resolve off the identical `vec`/`gexForLevels` Vector/GEX positioning snapshot.
PR #6731 (commit `3d571c919`, merged earlier the same day) added the market-closed
`closedMarketSessionNote(vec, gexForLevels, readMs)` disclosure to the structural-node bullet, for
every bucket — but the gamma-flip bullet, a few lines above it in the same function, never got the
equivalent treatment.

**Fix.** Moved the `sessionNote`/`sessionNoteSuffix` computation up (it only depends on `vec`/
`gexForLevels`/`readMs`, all already in scope earlier in the function) so the gamma-flip bullet can
use it too, and appended `sessionNoteSuffix` to all four gamma-flip wording branches (LONG/SHORT ×
above/below the flip) plus the CLOSED-bucket neutral-framing branch. The "Structural support/
resistance node" bullet now reads the shared `sessionNote`/`sessionNoteSuffix` computed once,
instead of its own now-redundant local declaration — byte-identical output, one definition instead
of two.

### Finding 3 — DKNG: "Gave back X% of peak" / round-trip giveback bullets carry no staleness caveat, at TWO independent call sites

**Symptom.** The "Position" section correctly flags a stale live P&L (`play.pnlPct`), but the
"Trade manager read" section's "Gave back X% of peak" / round-trip giveback bullet — computed from
that exact same stale `play.pnlPct` via `mfeCaptureOutcome(play.pnlPct, play.peak, null)` — renders
with zero staleness caveat.

**Root cause.** `actionNarrative(play, bucket)` (`play-brief-narrative.ts`) had **no**
`readMs`/staleness parameter in its signature at all, so it structurally could not call the shared
`optionMarkStaleCaveat()` helper that `pnlSection` already uses for the identical field. The call
site (`tradeManagerNarrativeSection`) already has `ctx.readMs` in scope two lines after the call
(for vectorStale/gexStale checks) but never threaded it into `actionNarrative`.

A **second, independent** call site has the same gap: `holdPlanSection`'s (`play-brief-intel.ts`)
"Hold plan" expandIntel giveback block (`const giveback = mfeCaptureOutcome(play.pnlPct, play.peak,
null);`) is only deduped against `actionNarrative`'s output via `narrativeAlreadyNoted?.capture`, so
it is live-reachable on its own whenever `actionNarrative`'s capture threshold (75) isn't crossed
but this section's own (70) is — not merely a redundant copy of the same bug.

**Fix.** Threaded `readMs` (default `Date.now()`, matching the convention every other staleness-
aware helper in these files already uses) into `actionNarrative()`'s signature, imported
`optionMarkStaleCaveat` into `play-brief-narrative.ts`, computed it once (`giveStaleCaveat`) and
appended it to both the `round_trip` and `capture` giveback bullets. Updated the one call site
(`tradeManagerNarrativeSection`) to pass its already-in-scope `readMs`. Applied the identical fix
to `holdPlanSection` in `play-brief-intel.ts`: added a local `const readMs = ctx.readMs ?? Date.now()`
(this function had none before), imported `optionMarkStaleCaveat`, and appended the caveat to both
of its own giveback bullets.

### Blast radius

Checked every other reader of `peakForDisplay`/`troughForDisplay` (Finding 1), of the gamma-flip
`flip`/`distAway` values (Finding 2), and of `mfeCaptureOutcome(play.pnlPct, ...)` (Finding 3) —
no other call site exists repo-wide besides the ones fixed above and the ones already fixed by
PR #6726/#6731. `actionNarrative` has exactly one caller, so widening its signature with a
defaulted parameter is a non-breaking change.

### Tests

- `play-brief.test.ts` — two new tests: Peak/Trough carry the same stale caveat as P&L/Greeks/
  Spread/Exec P&L when the mark is stale-but-known; a second test pins that the distinct "(no live
  tick yet)" wording is NOT doubled up with the stale caveat when the mark is genuinely unknown.
- `play-brief-intel.test.ts` — one new test: the gamma-flip bullet carries the market-closed
  session note (mirroring the existing structural-node test for the same fixture shape); one new
  test: `holdPlanSection`'s capture-branch giveback note carries the same stale-quote caveat.
- `play-brief-narrative.test.ts` — two new tests: the round-trip and capture-branch giveback
  bullets in `tradeManagerNarrativeSection` each carry the same stale-quote caveat as the Position
  section's P&L line.

All five new tests confirmed RED on pre-fix source (via `git apply -R` of the source-only diff,
tests kept in place) — the Peak/Trough/gamma-flip/round-trip/capture-branch assertions each failed
exactly as the live repros describe — then GREEN after restoring the fix. Full `src/lib/swing/
*.test.ts` (2072 tests) and `npx tsc --noEmit` both pass clean.
