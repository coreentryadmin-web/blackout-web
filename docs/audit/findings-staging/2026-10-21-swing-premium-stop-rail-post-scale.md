## 2026-10-21 — [FINDING, swing] Premium stop rail rendered as a live thesis-break trigger after it has gone structurally inert post-scale — real governing floor never disclosed

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (direct, false management claim — a member could hold past a point the brief itself says is a hard stop, when the engine can no longer act on it) |
| **Surface** | `src/lib/swing/play-brief.ts` — `managementSection()`; `src/lib/swing/play-brief-intel.ts` — `watchForSection()`; new helpers in `src/lib/zerodte/terminal-ladder.ts` |

### Root cause

Swing's exit policy (`SWING_SCALE_OUT_POLICY`, `exit-policy.ts`) is sourced directly from
`SCALE_OUT_RULES` (`zerodte/scale-out.ts`): bank 50% at +100% premium, hard-stop at -60% pre-scale,
trail the runner at 50% of its peak post-scale. The live engine (`deriveScaleOutAction`/
`computeScaleOutTriggerInfo`) gates the hard stop `if (!scaledAlready)` — once any trim tranche
fires, `computeScaleOutTriggerInfo` returns `hard_stop_price: null` because "the hard stop no
longer applies (the partial is already locked in)", and `manage.ts`'s `premium_stop` GATE comment
says the same thing explicitly: "only fires pre-scale, by design."

`buildTerminalExitLadder` (`terminal-ladder.ts`) computes `stop_premium` unconditionally with no
equivalent awareness of trim state. Two render sites then show it as if it were still live:
- `play-brief.ts`'s `managementSection()` — the "Rails: stop X · target Y" line.
- `play-brief-intel.ts`'s `watchForSection()` — the "Premium stop rail: $X — thesis breaks if mark
  closes below" line, with a fully-gated cushion-percentage computation built on top of it.

Both files already have the equivalent fix on the **target** side (2026-09-22/2026-10-08 — once a
trim tranche at/above `target_premium` has fired, the target line is suppressed/annotated rather
than read as a fresh unmet objective) — the stop side was never given the symmetric treatment.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:MRNA&positionId=1958&status=TRIM`: Entry
**$6.49**, Peak **+103.4%**, "Trim ladder: +100% ✓", "Banked: 50% @ +100% ($12.98)". Management
section rendered "Rails: stop $2.60 · target $12.98 ✓ (reached)" and "What to watch" rendered
"Premium stop rail: **$2.60** — 79% cushion from current bid — thesis breaks if mark closes below"
with no caveat anywhere. Recomputing: $6.49 × 0.4 = $2.596 → $2.60 (matches the stop shown) — but
per the engine's own code, this level is structurally dead now that the position has scaled. The
real governing floor is the runner's trailing stop: peak premium (~$6.49 × 2.034 ≈ $13.21) × 0.5 ≈
**$6.60** — never mentioned anywhere in the brief.

Added `hasScaledOut`/`runnerTrailingStopPremium` pure helpers to `terminal-ladder.ts` (2 new unit
tests), and regression tests in both `play-brief.test.ts` and `play-brief-intel.test.ts` using the
exact live MRNA numbers (entry $6.49, peak +103.4%, fired trim at $12.98, stop $2.60 → expected
runner-trail floor $6.60). RED→GREEN, git-stash-verified on the source files alone:
- `terminal-ladder.test.ts`: 11/13 (the 2 new tests failed) → 13/13.
- `play-brief.test.ts`: 160/163 (3 fail, including 2 pre-existing fixtures whose assertions
  encoded the old buggy "stop always bare" behavior and needed correcting) → 163/163.
- `play-brief-intel.test.ts`: 308/309 (1 fail) → 309/309.

Broader regression sweep: `play-brief-narrative-coaching.test.ts` + `play-brief-narrative.test.ts`
+ `exit-policy-snapshot.test.ts` + `play-timeline.test.ts` + `strategy-version.test.ts` +
`scale-out.test.ts` — 395/395. `tsc --noEmit` clean.

### Blast radius

Two pre-existing tests (`play-brief.test.ts`, the NN "+sign" repro and the EXTR "target already
reached" repro) had fixtures where a trim had already fired, so their stop-side assertions
implicitly encoded the bug (stop always renders bare). Both were corrected to assert the new,
correct annotated text rather than loosened or deleted — their original point (no "+" sign on
absolute prices; target-reached annotation) is preserved and still verified.

### Fix

Two new pure helpers on `TerminalExitLadder` (`terminal-ladder.ts`): `hasScaledOut()` (any trim
tranche fired) and `runnerTrailingStopPremium(peakPremium)` (peakPremium × `SCALE_OUT_RULES.
trail_from_peak`, mirroring exactly what `computeScaleOutTriggerInfo` returns post-scale). Both
render sites now check `hasScaledOut` and, when true, annotate the dead stop_premium as "no longer
applies — already scaled" and surface the real runner-trail floor (derived from `play.entry` and
`play.peak`, the same fields the Position section already displays) instead of silently keeping
the "thesis breaks if mark closes below" framing.

### Why not a bigger fix

Did not change `buildTerminalExitLadder` itself to null out `stop_premium` post-scale (mirroring
the target side would suggest this) — `stop_premium` is also consumed elsewhere (e.g. as a
reference level in the ladder/structure render) where nulling it could lose information; the fix
is scoped to the two narrative render sites that make the false "still live" claim, per this
finding's own repro. Did not touch `premium_stop`/`deriveScaleOutAction`/`manage.ts` — those are
already correct; only the two display-layer render sites needed the equivalent awareness.
