> **kind:** FINDING

## Ask Largo swing brief — DTE-runway context silently deleted for any live position with DTE > 7 — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief narrative composition (`src/lib/swing/play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching`, collapsed against `src/lib/swing/play-brief-intel.ts`'s `holdPlanSection` via `play-brief-intel-collapse.ts`) |
| **Severity** | P3 (narrative completeness — this is the "false 'folded into narrative' claim causes silent content loss" class of bug this repo has fixed multiple times before, not a duplicate-restatement this time but an outright deletion) |

### Root cause

`buildIntelSections` (`play-brief-intel.ts`) collapses the "Hold plan" section out of the envelope
whenever a "Trade manager read" narrative is present, via `collapseRedundantIntelSections`
(`play-brief-intel-collapse.ts`), which appends a note claiming *"Desk detail for N sections folded
into Trade manager read above."* "Hold plan" is in `NARRATIVE_COVERED_TITLES`, on the premise that
`manageLifecycleCoaching` (the narrative's own manage-plan bullet) already carries the same facts.

That premise held for time-stop, runner-fraction, and trim-ladder facts — but NOT for the DTE
runway/theta fact. `holdPlanSection`'s "Contract runway" line pushes **unconditionally** for any
matched DTE:
```ts
lines.push(`Contract runway: **${dte} DTE** — theta accelerates inside ~7 DTE`);
```
while `manageLifecycleCoaching`'s equivalent line only fires **when `dte <= 7`**:
```ts
if (dte <= 7) parts.push(`**${dte} DTE** — theta accelerating; don't over-hold`);
```
So for any live OPEN/HOLD/TRIM position with DTE > 7, the DTE-runway fact appeared in NEITHER
place: `holdPlanSection`'s version was collapsed away on the (false, for this fact) claim it was
"folded into Trade manager read," and the narrative's own version never fired because it hadn't hit
the ≤7 urgency threshold yet.

**Live repro (CRWD:19 brief, 2026-09-09, standing Ask Largo deep-dive cycle):** a 9DTE CRWD swing
position's "Trade manager read" section rendered a "Manage plan" bullet with manage-engine,
trim-ladder, session-exit and runner-fraction facts, but no DTE mention anywhere in the whole
17-bullet narrative — despite the collapse note at the bottom explicitly claiming "Hold plan"'s
content was folded in.

### Fix

Made `manageLifecycleCoaching`'s DTE line unconditional, with two framings depending on urgency:

```ts
if (dte <= 7) parts.push(`**${dte} DTE** — theta accelerating; don't over-hold`);
else parts.push(`**${dte} DTE** remaining`);
```

This makes the collapse mechanism's own claim ("folded into Trade manager read") actually true for
every DTE value, not just ≤7 — the fix lives at the source of the claim rather than un-collapsing
"Hold plan" (which would risk reintroducing the genuinely-duplicated trim-ladder/time-stop/runner
content the collapse was built to remove).

### Evidence

- New regression test `manageLifecycleCoaching: DTE > 7 still carries runway context, not just the
  <=7 urgency line` — reproduces the live CRWD 9DTE shape and asserts the "remaining" framing
  renders without the urgency phrase.
- New regression test `manageLifecycleCoaching: DTE <= 7 keeps the urgency framing, not the plain
  'remaining' line` — proves the fix didn't blur the two framings together.
- RED→GREEN proven via `git stash` (source-only revert): 1 failure pre-fix, 0 post-fix, 49/49 in
  the file.
- `npx tsc --noEmit`: clean.
- Full `src/lib/swing/*.test.ts` suite: 817/819 pass; the 2 failures (`ex-dividend-reads.test.ts`,
  `play-brief-resolve.test.ts`) are pre-existing on unmodified `origin/main` (confirmed earlier this
  session via the same isolation) and unrelated to this change.

### Blast radius

One function (`manageLifecycleCoaching`), one call site (`collectCoachingBullets`) — grepped for
every other `manageLifecycleCoaching(` reference; none found outside this file and its test.
