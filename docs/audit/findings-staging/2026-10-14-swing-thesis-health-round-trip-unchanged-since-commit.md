> **kind:** FINDING

## Ask Largo swing play-brief: "Thesis health" can claim "unchanged since commit" for a position that just round-tripped past breakeven, contradicting the SAME brief's "Trade manager read" section — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `computeSwingThesisHealth` (`src/lib/swing/thesis-health.ts`) scores five pillars
per committed position (persistence, entry geometry, flow corroboration/"Signal stack", regime/
"Regime fit", theta budget). Four of the five compute their `commit` and `current` scores from the
exact same single live-state input every call — `signalScore`/`regimeScore` literally
`return { commit: score, current: score, ... }` off one shared `score` variable (structurally
impossible to ever diverge), and `setupPersistenceScore`/`entryGeometryScore`'s switch-case
branches set `commit === current` for every real enum value. Only `theta_budget` (DTE decay) is
engineered to genuinely diverge, per that function's own comment ("Unlike the other score
functions in this file, theta budget's commit and current SCORES genuinely diverge..."). The 2026-
10-07 fix (same file) correctly disclosed when all five pillar deltas read zero ("— unchanged
since commit"), but it trusts `h.moves` staying at its fallback sentinel as proof nothing moved —
and `moves` can only be populated by a pillar flipping to "faded"/"lost" status (impossible for the
four structurally-static pillars outside two narrow overrides: `thesisBreak` hitting warn/break,
or `setupState` becoming `INVALIDATED`), a non-HOLD `manageAction`, or `pnlPct <= -40`. A real
round-trip through a genuine favorable peak into a current loss can fall through every one of
those triggers at once, leaving the headline to assert "unchanged" for a position that visibly has
not been.

**Evidence.** Live `GET /api/market/swing/play-brief?playId=SWING:INTC:56` (2026-10-14 ~20:42 UTC,
Ask Largo standing deep-dive, this cycle's hold-plan/thesis-health close read), real OPEN position:
peak **+15.3%**, trough **-36.6%**, currently **-36.5%** (3.5pts short of the -40% backstop
trigger; `thesisBreak` still reads "intact" per the live gate, so persistence never diverges
either). The "Thesis health" section rendered:

> **67%** · Weakening — unchanged since commit
>
> • **Persistence** — forming (Δ +0.0 pts)
> • **Entry geometry** — pre-trigger (Δ +0.0 pts)
> • **Signal stack** — FLOW+VECTOR+CATALYST (Δ +0.0 pts)
> • **Regime fit** — Regime (Δ +0.0 pts)
> • **Theta budget** — 9DTE runway (Δ +0.0 pts)

directly above the SAME brief's own "Trade manager read" section, which correctly narrates:

> **Hold the line** — thesis health 67%. Let the trade work while structure holds.
> **Round-tripped past breakeven** — was up 15% at peak, now -37% — consider protecting what's left.

Two sections of one envelope disagreeing about the single most important fact about the trade
right now ("has anything changed since I opened this") is exactly the narrative-self-contradiction
class this codebase has repeatedly fixed in the OTHER direction (duplicate restatement across
sections — see e.g. the `narrativeAlreadyNoted.roundTrip`/`.capture` guards already in this file);
this is the same class as a false negative instead of a duplicate positive.

**Blast radius.** `computeSwingThesisHealth` has exactly one real call site
(`src/features/nighthawk/command-deck/adapters.ts`, confirmed via
`grep -rn "computeSwingThesisHealth(" src --include="*.ts"` excluding its own definition and test
files) — `terminalPlayFromHorizon`, which builds every live SWING/LEAPS `TerminalPlay`. The payload
type (`ThesisHealthPayload`, `src/lib/zerodte/thesis-health.ts`) is shared with 0DTE's own
thesis-health panel; the new field is optional and 0DTE never sets it, so its own 883-test
collateral suite (thesis-health/adapters/terminal-display) is unaffected — confirmed green,
unchanged pass count. `h.moves` has a second, independent consumer
(`thesisPillarCoaching`/"What moved" in `play-brief-narrative-coaching.ts`) that already renders
this exact round-trip fact via its own path (`mfeCaptureOutcome`-driven, same as "Trade manager
read"'s own callout) — the fix deliberately does NOT thread the round-trip signal into `moves`
itself, to avoid reopening a NEW duplicate-narration bug of the exact kind this file has repeatedly
closed elsewhere.

**Fix.** Added `peak?: number | null` to `SwingThesisHealthInput` and computed a new,
independent `roundTripSinceCommit: boolean` on the returned payload via the SAME
`mfeCaptureOutcome(pnlPct, peak, null)?.kind === "round_trip"` check already used elsewhere in this
codebase to detect this exact condition (`play-brief-intel.ts`'s `holdPlanSection`/lessons
section). `play-brief.ts`'s `thesisHealthSection` now requires `!h.roundTripSinceCommit` in
addition to the existing `h.moves[0].includes("unchanged")` check before asserting "— unchanged
since commit"; when round-tripped, the headline falls back to `**{health}%** · {rungLabel}` with
no claim either way (consistent with this file's existing "omit, don't fabricate" discipline —
there is still no real historical comparison to report, so the fix states nothing false rather
than inventing a replacement claim). Threaded `peak` through the one real call site
(`adapters.ts`'s `terminalPlayFromHorizon`) using the identical peak-%-formula `peakDisplay`
(defined later in the same function) already uses from `src.peakPremium`/`entry`.

**Fix rationale.** Did not attempt to make the four structurally-static pillars (persistence,
entry geometry, signal stack, regime fit) genuinely time-varying — that would need a real "value
at actual commit time" snapshot persisted per position (a larger, separate schema/DB change, out
of scope for a single-issue PR) rather than the current lookup-table-from-current-state
reconstruction. The chosen fix closes the concrete, demonstrated contradiction (two sections of
one brief disagreeing) at its narrowest correct point — the headline's own "nothing changed" claim
— without touching pillar scoring, gates, or the aggregate `health`/`rung` computation at all.

**Tests.** `src/lib/swing/thesis-health.test.ts`: new `roundTripSinceCommit` describe block, 3
tests — true for the live-repro shape (negative pnlPct, real positive peak, `moves` still at its
"unchanged" fallback — pins the exact gap this fix closes), false for a flat position with no
recorded peak, false when currently favorable (peak and pnlPct both positive, no round-trip yet).
`src/lib/swing/play-brief.test.ts`: new test pinning a `thesisHealth` fixture with
`roundTripSinceCommit: true` and the "unchanged" `moves` sentinel (mirroring the adjacent
2026-10-07 test's structure) — asserts the rendered headline does NOT contain "unchanged since
commit" while still showing the real health %/band. RED→GREEN proven via `git stash` on the three
source files (`thesis-health.ts`, `play-brief.ts`, `zerodte/thesis-health.ts`, `adapters.ts`) with
the new tests left in place: pre-fix, 3 new `thesis-health.test.ts` subtests failed
(`roundTripSinceCommit` read `undefined`, not `true`/`false`) and the new `play-brief.test.ts` test
failed with the actual pre-fix output `**67%** · Weakening — unchanged since commit`; post-fix, all
green. Full collateral run (`thesis-health.test.ts` + `play-brief.test.ts` +
`play-brief-intel.test.ts` + `play-brief-narrative.test.ts` +
`play-brief-narrative-coaching.test.ts` + `play-brief-resolve.test.ts` +
`play-brief-confidence.test.ts` + `roll-plan.test.ts` + `zerodte/thesis-health.test.ts` +
`adapters.test.ts` + `terminal-display.test.ts`): **913/913 pass**. `npx tsc --noEmit` clean on
Node 20. `eslint` clean on every touched file.
