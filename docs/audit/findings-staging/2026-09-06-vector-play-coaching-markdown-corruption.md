# Ask Largo swing "Trade manager read" — `vectorPlayCoaching` corrupts its own markdown

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible rendering defect, not a crash) |
| **Area** | Swing / Ask Largo trade-manager narrative coaching layer |
| **Files** | `src/lib/swing/play-brief-narrative-coaching.ts`, `src/lib/swing/play-brief-narrative-coaching.test.ts` |

## Context

Flagged during peer review of PR #4104 ("deep trade-manager coaching — pillars, catalysts,
cross-desk, confluence"), part of the standing Ask Largo × Night Hawk Swings ownership mandate.
The review posted a ⏳ WAIT verdict with the exact repro before the PR merged; it merged anyway
without the fix, so this closes the gap directly on `main`.

## Root cause

`vectorPlayCoaching()`'s final line:
```ts
return line.startsWith("Vector") ? `**${line}` : line;
```
`line` already starts with `` `Vector desk: **${vp.headline}**` `` whenever `vp.headline` is set
(a common, normal Vector-desk state — not an edge case), so this branch always fires and prepends
an **unpaired** `**` to a string that already has balanced bold-marker pairs, turning an even
count odd.

Traced the actual rendering effect against this repo's own markdown tokenizer
(`parseMarkdownTokens`, `inline-markdown.tsx`, which matches balanced `\*\*[^*]+\*\*` pairs only).
For `headline="Bull flag breakout"`, `invalidation="95.00"`, `thesis` aligned with the swing
direction, the function returned:
```
**Vector desk: **Bull flag breakout** · invalidation **95.00** — **aligned** with swing lane.
```
Tokenized as: BOLD("Vector desk: ") → PLAIN("Bull flag breakout") → BOLD(" · invalidation ") →
PLAIN("95.00") → BOLD(" — ") → then a literal, unpaired `**aligned**` rendered as **literal
asterisk characters** to the member, because the pairing regex had nothing left to close against.

Net effect: the headline and invalidation level — the two numbers this coaching line exists to
surface — rendered in plain text, the connective words between them rendered bold instead, and
the final clause showed raw `**asterisks**`. Live-reachable: `vectorPlayCoaching` is called from
`collectCoachingBullets` (`play-brief-narrative.ts`) on every bucket, firing whenever
`vec.play.headline` or `.invalidation` is present. Zero test coverage existed for this function
before this fix (confirmed via grep before writing the fix).

## Fix

Deleted the stray ternary; the function now returns `line` directly. The individual `parts` each
already carry their own correctly-paired `**bold**` spans (`` `Vector desk: **${vp.headline}**` ``,
`` `invalidation **${vp.invalidation}**` ``, etc.) — nothing needed re-wrapping.

## Evidence (RED → GREEN)

New tests in `play-brief-narrative-coaching.test.ts`:
- null-safety for absent Vector play data.
- asserts the returned string has an EVEN count of `**` markers (the general regression guard —
  this class of bug always shows up as a parity break), plus specific assertions that the headline
  and invalidation level render inside their own `**bold**` pairs and the line does NOT start with
  the corrupted `**Vector desk: **` prefix.

`git stash` on `play-brief-narrative-coaching.ts` alone → the parity assertion **fails** (odd count
of 1 extra `**`). Restored → **9/9 pass** in the file. `tsc --noEmit` clean. Full `npm test` run in
progress at write time (Node 20).

## Blast radius

- Only `vectorPlayCoaching` changed — every other coaching function in the file (`crossDeskCoaching`,
  `catalystCoaching`, `laneRankCoaching`, etc.) was read and confirmed to have no equivalent
  re-wrap pattern; this was an isolated stray line specific to this one function.
- No caller passes options/config that this fix would affect — the function's signature is
  unchanged.

## Fix rationale — what was deliberately left unchanged

- Did not add a markdown-balance lint rule or shared "assert balanced bold" helper across the
  whole coaching file — this bug was localized to one function with an obviously-wrong extra
  line; a repo-wide guard would be solving a problem that (after this audit) doesn't recur
  elsewhere in the file.
- Did not touch the two CodeQL "unused function" findings on this same file (`fin`, `fmtUsd`) —
  separate, unrelated cosmetic dead-code items already flagged by CodeQL directly on the PR; out
  of scope for this specific rendering-correctness fix.
