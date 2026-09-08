> **kind:** `FINDING`

## Ask Largo swing brief repeated the same `recNote` sentence in two sections — "Why this setup" read as a bullet dump — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (narrative quality — Largo "one trade-manager voice" standard, not a data-correctness bug) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` |
| **PR** | (pending) |

### Symptom

Found live during the 2026-09-06 5-engine monitor's standing Ask Largo deep-dive, on `SWING_NRG_34`
(NRG 110C, HOLD, thesis health 46%). `play.recNote` is already rendered verbatim, exactly once, by
`managementSection` for the open bucket (`play-brief.ts:64`) or by the Verdict section for the
watch bucket (`play-brief.ts:292`). `whyThisSetupSection` (`play-brief-intel.ts:55`) pushed the
SAME string a second time whenever `play.status !== "CLOSED"` — i.e. for every open AND watch
bucket play with a `recNote`, not just this one. Live output before the fix:

```
Management: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength."
...
Why this setup: "live hold — swing thesis Thesis health 46% — Thesis fading — tighten risk or trim into strength."

No pillar breakdown on this row — grade is from lane score only.
```

This is the opposite of the "one connected trade-manager-voice synthesis instead of separate
bullet-dump sections" standard #4084's `tradeManagerNarrativeSection` set for this product — a
member reads the identical sentence twice in one brief, and the duplication crowds out "Why this
setup"'s actual job (pillar/signal provenance behind the grade) since `factors` was empty here.

### Fix

Removed the duplicate `recNote` push from `whyThisSetupSection`. The section now surfaces only
signals-fired / archetype / regime / pillar-or-lane-score content — exactly its stated job, with
the already-rendered management/verdict note left to those sections alone.

### Evidence (RED → GREEN)

Added 2 tests to `play-brief-intel.test.ts`: `whyThisSetupSection` no longer contains the verbatim
`recNote` string, and still surfaces pillar/factor content when present. `git stash` on
`play-brief-intel.ts` alone: RED — 1/17 fail in that file. GREEN (post-fix): 17/17 in that file,
31/31 across `play-brief-intel.test.ts` + `play-brief.test.ts`.

Full `src/lib/swing/*.test.ts`: 660/660 pass. `npx tsc --noEmit`: clean.

### Blast radius

Only `whyThisSetupSection` in `play-brief-intel.ts`. `managementSection` (play-brief.ts) and the
Verdict section's own `recNote` rendering are unchanged — the note still appears exactly once per
brief, in the section that already owned it.
