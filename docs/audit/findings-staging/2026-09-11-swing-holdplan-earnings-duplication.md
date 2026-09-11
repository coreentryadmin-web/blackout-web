## 2026-09-11 — Swing "Hold plan" duplicated the near-term-earnings warning already narrated in "Trade manager read" — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief, `holdPlanSection` (`src/lib/swing/play-brief-intel.ts`) |
| **Status** | FIXED |

**Symptom.** For any OPEN swing play within 14 days of a known earnings date, the play-brief
rendered the same near-term-earnings warning TWICE, in two different sections a member reads
top to bottom: "Trade manager read" and "Hold plan".

- `catalystCoaching` (`play-brief-narrative-coaching.ts:482-492`) is folded into `collectCoachingBullets`,
  which `tradeManagerNarrativeSection` always calls for WATCH/OPEN buckets — it renders
  `**Earnings in Nd** (DATE) — size down or exit before report unless thesis is earnings-driven.`
- `holdPlanSection` (`play-brief-intel.ts`, only rendered for bucket `"open"`) independently read
  the same `ecosystem.arsenal.earnings` field and pushed the near-identical sentence
  `**Earnings in Nd** (DATE) — size down or exit before report unless thesis is earnings-driven`
  into "Hold plan".

`buildIntelSections` (`play-brief-intel.ts:895-956`) pushes `narrative` (which carries "Trade
manager read") unconditionally, and `hold` (Hold plan) whenever `bucket === "open"` — so both
sections render together on the SAME brief for any live open swing position with earnings inside
the 14-day window, and the member sees the identical warning twice.

**Root cause.** Two independent call sites read the same `arsenal.earnings` field and apply the
same `days_until <= 14` threshold with the same copy, without either being aware of the other.
This is the exact same duplication class this file has already fixed twice for other fields on
`holdPlanSection` specifically — the recNote/rails duplication (#4261) and the thesis-health
advisory duplication (2026-09-06, same file, same function) — both of which left an explicit
"NOT repeated here" comment as the fix. The earnings block was added to `holdPlanSection`
independently of `catalystCoaching` and was never checked against it.

**Why not caught earlier.** No prior audit pass exercised BOTH sections together against a live
OPEN swing position whose earnings date fell inside the 14-day window at the same time — all four
committed swing positions checked live this cycle (NRG, NN, CG, CRWD) currently have earnings
50-82 days out, so the duplicate never rendered in a live spot-check; it was found by tracing the
code path (both functions read the identical `ecosystem.arsenal.earnings` field with the identical
threshold) rather than by observing it live, and confirmed with a unit test that constructs the
qualifying `days_until: 8` case directly.

**Fix.** Removed the earnings block from `holdPlanSection` entirely, with a comment matching the
established "NOT repeated here" pattern from the two prior fixes on this exact function. The fact
is not dropped — `catalystCoaching` still renders it in "Trade manager read", proven by a
dedicated regression test. `ecosystem` was also dropped from `holdPlanSection`'s destructure since
it was the only remaining use.

**Blast radius.** `holdPlanSection` only — its earnings block was a single, self-contained `if`
with no other consumer. No change to `catalystCoaching`, `collectCoachingBullets`, or any other
section.

**Tests.** `src/lib/swing/play-brief-intel.test.ts`:
- `holdPlanSection: does not repeat the near-term-earnings warning — already narrated by Trade
  manager read` — RED before the fix (body contained `**Earnings in 8d**`), GREEN after.
- `catalystCoaching: still carries the near-term-earnings warning (not duplicated, not dropped)` —
  proves the fact is still narrated exactly once, in the correct section.

`npx tsc --noEmit` clean. `play-brief-intel.test.ts` 75/75 pass (was 73 before this pass).
`play-brief-narrative-coaching.test.ts` 61/61 pass, unaffected.
