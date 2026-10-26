## Night Hawk Swings: `tradeManagerNarrativeSection`'s "Break watch — stop already breached" bullet compared against the DEAD pre-scale stop, not the live runner trail — a systemic blind spot on every TRIM/RUNNER position

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live production repro + independent code verification, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/swing/play-brief-narrative.ts` (`tradeManagerNarrativeSection`) |

### Root cause

Once a TRIM/RUNNER swing position has scaled out (a trim tranche fired — `hasScaledOut(exitPolicy)`
reads `true`), the live exit engine's own state machine (`deriveScaleOutAction`/
`computeScaleOutTriggerInfo`, `src/lib/zerodte/scale-out.ts`) **permanently disables** the original
pre-scale `stop_premium` — the real governing floor becomes the runner's trailing stop off its peak
(`runnerTrailingStopPremium(peakPremium)` = peak × `SCALE_OUT_RULES.trail_from_peak` (0.5),
`src/lib/zerodte/terminal-ladder.ts`).

THREE sibling call sites in this exact subsystem already apply this substitution correctly:
- `play-brief.ts`'s `managementSection` ("Rails: stop ... (no longer applies — already scaled;
  runner trail now $X)" line, ~L310-319).
- `play-brief.ts`'s evidence-fact builder (`evidence_numbers`, the Largo contract's C7 "specific
  numbers" field, ~L1908-1940 — fixed the SAME day as this finding).
- `play-brief-intel.ts`'s `watchForSection` ("Premium stop rail" bullet, ~L2208-2260).

`tradeManagerNarrativeSection`'s "Break watch — stop already breached on the executable side"
bullet — this function's own code comment calls it "the single most action-driving line in the
brief" — was the ONE remaining call site in this file that read the raw `play.exitPolicy?.
stop_premium` with **no** `hasScaledOut`/`runnerTrailingStopPremium` substitution at all (confirmed
by grep: zero hits for either helper name anywhere in `play-brief-narrative.ts` before this fix).
The same unguarded `execStop` also fed the function's forward-looking `!breakLine` fallback wording
("Break watch — lose premium stop $X → cut size or exit"), so both render paths carried the bug.

### Evidence — two confirmed live failure directions

1. **False alarm / mislabel (NN, positionId 2133):** "Trade manager read" said *"Break watch —
   stop already breached on the executable side — bid $0.05 is at/through your premium stop $0.22
   right now → exit or cut size"* while the SAME response's Management section correctly said
   *"stop $0.22 (no longer applies — already scaled; runner trail now $1.20)"*. Two sections of
   one brief flatly contradicting each other about whether $0.22 is the live number — and even
   where the bullet's underlying breach call happened to be directionally correct (the bid really
   had also breached the real $1.20 trail), it cited the wrong dollar figure and the wrong label.

2. **Silent miss — the dangerous direction (AI, positionId 2128):** the live bid was **exactly at**
   the real runner-trailing floor (per the brief's own already-fixed evidence fact) — a genuine
   live risk event — but **no** "stop already breached" bullet rendered anywhere, because
   `execStop` was still pinned to the dead, lower pre-scale stop and the bid sat above that dead
   number, so the comparison read "not breached" even though the position had genuinely hit its
   real managed floor.

### Why this is systemic, not a one-off

`runnerTrailingStopPremium` (peak × 0.5) is structurally **always ≥** the original pre-scale
`stop_premium` once a position has scaled out: scaling requires peak ≥ 2× entry (per
`SCALE_OUT_RULES`/`decideTrimScale`), so trail = peak × 0.5 ≥ entry > the original sub-entry stop.
So **any** TRIM/RUNNER position whose bid sits between the dead stop and the live trail got **no**
stop-breach alert at all, even though it has genuinely hit its real managed floor — a live,
systemic blind spot across the whole post-scale population, not limited to the two sampled
positions above. This is exactly the kind of defect the standing Ask Largo "own this feature,
100% correctness" mandate exists to catch.

### Fix

- Compute `scaledAlready = play.exitPolicy != null && hasScaledOut(play.exitPolicy)` and
  `peakPremiumDollarForStop` the same way the evidence-fact builder sibling derives it
  (`play.entry * (1 + play.peak / 100)`, guarded on both being present/finite).
- `runnerTrail = scaledAlready ? runnerTrailingStopPremium(peakPremiumDollarForStop) : null`.
- `effectiveStop = scaledAlready ? runnerTrail : (execStop ?? null)` — the real governing floor.
  Deliberately **not** `runnerTrail ?? execStop`: if a position has scaled out but the peak basis
  can't be priced (missing `entry`/`peak`), this never silently falls back to citing the confirmed-
  dead stop as if it were live — consistent with this codebase's "never fabricate, honest absence"
  discipline. In that (rare, disclosed) edge case the bullet simply has nothing to compare against
  and stays silent on this specific rail, rather than re-introducing the exact false-alarm bug this
  PR fixes.
- `stopRailLabel = scaledAlready ? "runner trailing stop" : "premium stop"` — relabels the bullet so
  it can never again disagree with Management/`evidence_numbers`/What-to-watch's own labeling of
  the same fact.
- `execBreached` now compares `execMarkForBreach` against `effectiveStop` instead of raw `execStop`.
- Applied the identical substitution to the `!breakLine` forward-looking fallback ("Break watch —
  lose premium stop $X → cut size or exit", both LONG and SHORT wording) — same root cause
  (unguarded `execStop`), same fix, same file.

### Fix rationale — what was deliberately left unchanged

- **The three sibling call sites were not touched.** They already apply this substitution
  correctly; this PR only brings the one remaining call site in line with them.
- **No change to `hasScaledOut`/`runnerTrailingStopPremium` themselves** (`terminal-ladder.ts`) —
  both already existed, built for exactly this bug class (see that file's own 2026-10-21 comment),
  and are imported here unchanged.
- **The missing-peak-basis edge case suppresses the bullet rather than fabricating a number** (see
  Fix above) — a deliberate, disclosed design choice over the alternative of falling back to the
  dead stop, which would reopen the false-alarm failure mode in that corner case.

### Regression test (RED → GREEN proof)

Two new tests in `src/lib/swing/play-brief-narrative.test.ts`:
1. *"Break watch fires off the LIVE runner trail (not the dead pre-scale stop) once scaled out —
   silent-miss repro (live AI#2128 shape)"* — TRIM/RUNNER play with `hasScaledOut=true`
   (`trim_levels: [{ trigger_pct: 100, fired: true }]`), entry $0.19 / peak +100% → runner trail
   $0.19, dead pre-scale stop $0.07, bid $0.19 (above the dead stop, exactly at the live trail).
   Asserts the "stop already breached" bullet DOES fire off the $0.19 runner trail, and that the
   soft "lose premium stop" fallback does NOT render instead.
2. *"Break watch cites the LIVE runner trail, not the dead pre-scale stop, once scaled out —
   false-alarm/mislabel repro (live NN#2133 shape)"* — entry $0.50 / peak +380% → runner trail
   $1.20, dead pre-scale stop $0.22, bid $0.05 (below both). Asserts the bullet fires citing the
   **runner trailing stop $1.20**, not the dead **premium stop $0.22**.

Verified RED → GREEN exactly as this repo's policy requires: reverted `play-brief-narrative.ts` to
its pre-fix `origin/main` content (test file kept in place) — both new tests FAILED (162/164 pass,
2/164 fail, matching the two live repros exactly: the silent-miss case rendered only the soft
"lose premium stop $0.07" fallback with no breach bullet at all, and the mislabel case rendered
"premium stop $0.22" instead of the runner trail). Restored the fix — both tests PASS, 164/164.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts`
  (Node 20) — RED (162/164) confirmed pre-fix, GREEN (164/164) confirmed post-fix.
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
