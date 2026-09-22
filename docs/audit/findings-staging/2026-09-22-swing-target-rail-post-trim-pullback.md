# Swing "Premium target rail" self-contradicts once its own trim tranche already fired and the mark pulls back

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Lane** | Night Hawk Swings — Ask Largo play-brief |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate (2026-09-22) |

## Root cause

`watchForSection` (`src/lib/swing/play-brief-intel.ts`) renders a "Premium target rail" line
whenever the current mark/execMark is still below `play.exitPolicy.target_premium`, framed as
"**$X — Y% move still needed from current mark to reach target**". The gate only checked
`target > targetBasis` — it never checked whether the position had *already* reached that same
target level once, via an already-fired trim tranche, and has since pulled back below it again.

For swing positions this is not a rare edge case: `SWING_SCALE_OUT_POLICY` (`exit-policy.ts`)
prices `target_pct` identically to its one trim rung's `trigger_pct` (both `100`), so
`exitPolicy.target_premium` and the fired trim tranche's `premium` are the *literal same dollar
level*. Any swing position that scaled out at its one trim rung and has since drifted back below
that level — a completely ordinary post-trim state, not a malfunction — hits this every time.

## Live repro (MUU, 2026-09-22, TRIM status, positionId 1201)

Entry $1.20, peaked $2.85 (trim fired at the +100%/$2.40 rung, banking 50%), pulled back to a
mark of $2.025 by the time of this read. The SAME brief document rendered, a few lines apart:

- Management section: `Trim ladder: +100% ✓` — i.e. the target was already reached.
- What to watch: `Premium target rail: **$2.40** — **19%** move still needed from current mark
  to reach target` — i.e. the target has *not* been reached yet.

A member reading "What to watch" alone would believe there is a fresh, unmet objective ahead of
the runner, when the runner is actually trailing off a peak that already cleared this exact level
once. The runner's real remaining risk parameter is the trailing-stop-from-peak mechanic
(`SCALE_OUT_RULES.trail_from_peak`), not "climb back to $2.40" — the rail's own room% math was
correct arithmetic on a premise (this target is still pending) that was no longer true.

## Fix

`watchForSection` now also checks `play.exitPolicy.trim_levels` for any tranche that has already
`fired` at a `premium` at/above the target level; when one has, the room% line is omitted
entirely (same "never fabricate, only ever omit" discipline the sibling stop-rail cushion fix
already uses) rather than restating a target the position has already banked.

## Evidence

RED→GREEN via `git stash` on `play-brief-intel.ts` alone: 1 new test fails pre-fix (194/195
pass), 195/195 post-fix. A second new control test (a lower, not-yet-reached trim rung must NOT
suppress the room% for a higher, still-pending target) confirms the fix is scoped to "a fired
tranche at/above THIS target," not "any trim has ever fired." Full `src/lib/swing/*.test.ts`:
1498/1498 pass. `npx tsc --noEmit`: clean.

## Blast radius

One call site (`watchForSection`'s target-rail block); the sibling stop-rail cushion block a few
lines above was not touched (it already omits correctly once the basis is through the stop, and
has no analogous "already fired and bounced back" ambiguity — a stop breach doesn't un-happen the
way a profit target's relevance changes once trimmed). No other file renders `target_premium`
with a room% computation (confirmed by the original 2026-09-18 PR's own exhaustive grep, still
true — this file is the only place that math exists).
