# Ask Largo swing LIVE-play "Gave back X% from peak" bullets are a percentage-POINT subtraction, not a relative retracement

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible, materially misleading number on a real open production position, not a crash) |
| **Area** | Swing / Ask Largo LIVE-play "Trade manager read" + "Hold plan" trade-manager coaching (four independent call sites, all in the live/open path — the analogous CLOSED-play bug was already fixed 2026-09-06, see `2026-09-06-swing-mfe-capture-roundtrip-nonsense.md`) |
| **Files** | `src/lib/swing/mfe-capture.ts` (doc-comment widening only, no logic change), `src/lib/swing/play-brief-narrative.ts` (2 call sites), `src/lib/swing/play-brief-narrative-coaching.ts` (1 call site), `src/lib/swing/play-brief-intel.ts` (1 call site), plus their four test files |

## Context

Live capture from `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&positionId=34` (a
real committed, still-open swing position) rendered this bullet in the "Trade manager read"
section:

> • **Hold the line**. Let the trade work while structure holds. Gave back **93%** from peak —
> consider protecting runner.

The position's real numbers (`board.lanes.SWING.committed[]` for NRG, positionId 34):
`entryPremium: 4.9`, `peakPremium: 11.4`, current mark P&L `livePnlPct: 39.8` (`play.pnlPct`), peak
P&L `play.peak` ≈ 132.7 — both already-computed percentage-RETURN numbers, not raw premiums.

## Root cause

Four independent call sites computed `play.peak - play.pnlPct` (a subtraction of two
already-percentage numbers) and labeled the result "Gave back X% from peak":

1. `play-brief-narrative.ts`'s `actionNarrative` — the "Hold the line" bullet in the live
   "Trade manager read" section, the one confirmed reachable in production above.
2. `play-brief-narrative-coaching.ts`'s `underlyingExcursionCoaching` — the "option gave back X%
   from peak" aside on the "Underlying tape" line.
3. `play-brief-intel.ts`'s `holdPlanSection` — the "Hold plan" section's own giveback bullet,
   gated behind `if (play.thesisHealth)`. Confirmed live-reachable, not dead code: `thesisHealth`
   is computed server-side by `terminalPlayFromHorizon` (`adapters.ts`) for every `working`
   (OPEN/HOLD/TRIM) play via `computeSwingThesisHealth`, and this is the exact same construction
   path `play-brief-resolve.ts`'s `loadOpenTerminalPlay` uses to build the play the `/play-brief`
   route serves — so any live open swing play with a computed thesis read exercises this bullet.
4. **A 4th call site not in the original bug report, found while fixing the other three**
   (blast radius): `play-brief-narrative.ts`'s `degradedReadLine` — the "Live read" fallback
   bullet that fires only when Vector spot isn't wired on a tick — independently carried the exact
   same `peak - pnl > 15` point-difference right beside `actionNarrative`'s copy in the same file.
   Caught because the RED test run for site 1 showed the SAME "93%" bug duplicated a second time
   in the same rendered body (once from "Hold the line", once from "Live read").

`peak - pnlPct` is 132.7 - 39.8 ≈ 92.9 → rounds to "93". The English phrasing "Gave back X% from
peak" unambiguously reads to a trader as a **relative retracement** — "you've lost X% of your peak
gain." The actual relative retracement here is `(132.7 - 39.8) / 132.7 * 100` ≈ **70%**
(equivalently: 39.8/132.7*100 ≈ **30%** of peak gain retained) — a materially different, much less
alarming picture than "gave back 93%," which reads as "almost totally round-tripped" on a position
still up +39.8%.

Worse, the point-difference formula's error is **not bounded** and scales with how large the peak
return itself is — exactly the plays worth talking about get the most misleading number:
- Overshoot case: peak +250%, current -10% → "gave back 260% from peak" (a number over 100%,
  nonsensical as a share of anything).
- Understatement case: peak +15%, current -60% → point-difference is only 75, understating how bad
  a full round-trip into a big loss actually is (the position round-tripped past breakeven
  entirely — a categorically different, more urgent event than "still holding most of a gain").

The codebase already had the correct, honest relative math — built for CLOSED plays 2026-09-06
(`mfeCaptureOutcome`, `mfe-capture.ts`) and explicitly reasoned about there:
- `{kind:"capture", capturePct}` = `(pnl/peak)*100` when `pnl >= 0` and `peak > 0` — the honest "%
  of peak retained."
- `{kind:"round_trip", peakPct, exitPnlPct}` when `pnl < 0` (was up at peak, now round-tripped into
  a loss) — deliberately NOT forced through the capture ratio, because a negative/peak ratio "has
  no honest reading as a percentage of anything captured."

That fix was applied to the two CLOSED-play post-mortem call sites in 2026-09-06's finding but
never extended to the LIVE/open-play path — this finding is that extension, plus the 4th call
site the earlier pass didn't need to look at (it only existed in the closed-play story).

## Fix

`mfeCaptureOutcome`'s `exitPnlPct` parameter is really just "the pnl to compare against peak" —
nothing about its logic is exit-specific. Reused it verbatim at all four live call sites, passing
the play's current `pnlPct` and `null` for `mfeCapturePct` (that field only ever exists post-close,
so it is never available pre-close by construction). No change to `mfeCaptureOutcome`'s core logic
at all — only its file-header doc comment was widened to describe the now-dual (closed + live)
use; `mfe-capture.test.ts` gained one additional test proving the function works identically when
fed the live NRG numbers, but the 5 pre-existing tests are untouched.

Each site's gating condition was reworked from a raw point-difference threshold to a relative
**capture-floor** threshold (fire once retained capture drops below the floor, i.e. the play has
given back at least `100 - floor`% of its peak gain) — chosen per site's own urgency, documented
in-line at each site:
- `underlyingExcursionCoaching` (secondary aside, not a standalone recommendation): floor **80**
  (most sensitive of the four).
- `degradedReadLine`'s "Live read" clause (secondary clause on an already-degraded line): floor
  **80**.
- `actionNarrative`'s "Hold the line" bullet (a standalone "consider protecting runner"
  recommendation): floor **75**.
- `holdPlanSection`'s "Hold plan" bullet (only renders alongside an already-surfaced thesis-health
  read): floor **70** (least sensitive).

All four thresholds were checked against the live NRG ground truth (peak 132.7, pnl 39.8 → capture
≈30.0%, giveback ≈70%) and all four correctly fire on it (30 < every floor above).

The `round_trip` case (current pnl negative after a positive peak) is arguably **more** urgent to
flag for a still-open, still-decidable position than for a closed one, so each site got its own
present-tense wording: `"**Round-tripped past breakeven** — was up **X%** at peak, now **Y%**"`
(vs. the closed-play phrasing's past tense "closed at").

## Evidence (RED → GREEN)

Extended all four call sites' nearest test files with the live NRG numbers as the concrete ground-
truth case, plus a capture-floor boundary case (no bullet) and a round-trip case, for a total of 13
new/rewritten test assertions across `mfe-capture.test.ts`, `play-brief-narrative.test.ts` (3 new
tests + 1 pre-existing test extended to cover the 4th call site), `play-brief-narrative-coaching.test.ts`
(3 new tests), and `play-brief-intel.test.ts` (1 pre-existing test rewritten onto the NRG numbers —
its old 129/95 fixture no longer cleared the new capture floor and would have silently stopped
testing the bullet at all — plus 2 new tests).

RED (source reverted to the pre-fix point-difference logic via `git checkout --` on just the 4
source files, keeping the new/updated tests in place; verified with `git status --short` that only
source files were reverted): **8 failures**, all showing the exact bug — e.g.
`"Gave back **93%** from peak"` where the new assertions expect `"Gave back **70%** of peak"`, and
the boundary-case test showing a spurious `"gave back **22%**"` firing where honest math says
nothing should. Restored → **GREEN, 167/167** across all four test files.

Full `npm test` (Node 20, `/opt/node20/bin/node` v20.20.2): **13441 pass, 0 fail, 3 skipped**.
`npx tsc --noEmit`: clean.

## Blast radius

- All four call sites that computed `peak - pnlPct` for a live/open play were found and fixed (see
  Root cause above) — confirmed via `grep -rn "peak - .*pnlPct\|pnlPct.*- .*peak"` across
  `src/lib/swing/*.ts` and `src/features/nighthawk/**/*.ts` post-fix: the only remaining match is
  this finding's own explanatory code comment, not live logic.
- No schema/API shape change. `TerminalPlay.peak`/`pnlPct` are untouched; this only changes how
  four coaching functions phrase the comparison between them.

## Fix rationale — what was deliberately left unchanged

- Did **not** touch `play-brief-narrative-coaching.ts`'s `closedCoaching`, `play-brief-intel.ts`'s
  `lessonsSection`, or `mfe-capture.ts`'s core `mfeCaptureOutcome` logic — all three were already
  fixed and correct as of the 2026-09-06 finding; this PR only adds new call sites that reuse that
  existing math, it does not change what the math computes.
- Chose four different capture-floor thresholds (70/75/80/80) rather than one shared constant,
  because the four bullets carry genuinely different urgency/redundancy in context (a standalone
  recommendation vs. a secondary aside vs. a bullet gated behind an already-surfaced signal) — the
  original code already expressed this via four different point-difference thresholds (15/20/25),
  so preserving relative ordering (not the literal numbers, which don't convert 1:1 across units)
  seemed truer to the original intent than collapsing to one number.
- Did not add a shared formatting helper/wrapper in `mfe-capture.ts` for the display string itself
  — each site's exact phrasing differs enough (inline appended fragment vs. standalone sentence vs.
  different trailing calls-to-action) that a shared formatter would need as many branches as it
  saved call sites. Reusing the bare `mfeCaptureOutcome` classification (as `closedCoaching`
  already does) and letting each site format its own sentence keeps the diff minimal and consistent
  with the existing closed-play call sites' style.
